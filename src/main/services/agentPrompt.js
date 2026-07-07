/**
 * agentPrompt — Agent 模式的 System Prompt 与 Tool 定义
 * 
 * 供 Agent 循环使用，包含：
 * 1. 7 个 tool 的完整 JSON Schema（DeepSeek/OpenAI 兼容格式）
 * 2. buildAgentSystemPrompt() 生成含时间上下文的 System Prompt
 */

// ============================================
// Tool 定义
// ============================================

const TOOLS = [
  // ── Tool 1: create_task ──
  {
    type: "function",
    function: {
      name: "create_task",
      description:
        "创建一个新的任务/日程/提醒。仅在信息足够完整时使用（有时间、有明确内容）。" +
        "调用前必须检查信息完整性：如果用户只给了日期没给时间（如'明天有约会'），不要调用此 tool，先追问用户具体时间。" +
        "注意：如果用户表达的是否定语义（'不去'、'不做了'、'取消'），不要使用此 tool，应使用 delete_task。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "任务标题，提取核心动作描述。不要包含否定词（如'不去'、'不做了'）。"
          },
          start_time: {
            type: "string",
            description: "ISO 8601 开始时间，如 '2025-07-07T15:00:00+08:00'。" +
              "仅当用户提供了具体时间信息时才填写（如'下午3点'、'晚上'、'明天上午'）。" +
              "如果用户只说了日期没有具体时间（如'明天有约会'、'后天开会'），传空字符串 ''。不要自行猜测时间。"
          },
          end_time: {
            type: "string",
            description: "ISO 8601 结束时间。可选，不传则默认开始时间 +1 小时。"
          },
          priority: {
            type: "string",
            enum: ["P0", "P1", "P2", "P3"],
            description: "优先级。P0=紧急重要，P1=重要，P2=普通（默认），P3=低优先级。"
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "标签列表，最多 3 个。从任务内容中提取关键主题词。"
          },
          location: {
            type: "string",
            description: "地点。只在用户明确提到地点时填写。"
          },
          notes: {
            type: "string",
            description: "AI 补充备注。可以是对任务的建议、提醒事项等。"
          }
        },
        required: ["title", "start_time"]
      }
    }
  },

  // ── Tool 2: delete_task ──
  {
    type: "function",
    function: {
      name: "delete_task",
      description:
        "删除/取消一个已有任务。当用户表达否定语义时使用：" +
        "'取消'、'不去'、'算了'、'不做了'、'删除'、'不要了'、'取消掉'。" +
        "系统会使用关键词 + 日期 + 时间（±30分钟窗口）进行模糊匹配。" +
        "如果找不到匹配任务，系统会返回提示信息。",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "要删除的任务 ID。如果从之前的查询结果中已知任务 ID，直接传入。"
          },
          task_keyword: {
            type: "string",
            description: "任务关键词，用于模糊匹配标题。如用户说'不去健身房了'，传 '健身房'。"
          },
          task_date: {
            type: "string",
            description: "任务日期，ISO 8601 日期格式如 '2025-07-07'。" +
              "根据用户语义推理：'今天'=当前日期，'明天'=明天日期。默认今天。"
          },
          task_time: {
            type: "string",
            description: "任务时间描述，如 '19:00'、'晚上'、'下午'。用于辅助精确匹配。"
          }
        },
        required: []
      }
    }
  },

  // ── Tool 3: complete_task ──
  {
    type: "function",
    function: {
      name: "complete_task",
      description:
        "标记一个任务为已完成。当用户表达完成语义时使用：" +
        "'做完了'、'完成了'、'搞定了'、'已做完'、'结束了'。" +
        "系统会先用关键词模糊匹配，1 条匹配时返回确认，多条时返回候选列表。",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "任务 ID。如果从之前的查询结果中已知，直接传入。"
          },
          task_keyword: {
            type: "string",
            description: "任务关键词，用于模糊匹配。如'项目评审做完了'，传 '项目评审'。"
          },
          task_date: {
            type: "string",
            description: "任务日期，ISO 8601 格式。默认今天。"
          }
        },
        required: []
      }
    }
  },

  // ── Tool 4: query_tasks ──
  {
    type: "function",
    function: {
      name: "query_tasks",
      description:
        "查询已有任务列表。当用户询问'今天有什么'、'明天安排'、'查看任务'、" +
        "'这周的任务'、'还有哪些没做完'时使用。" +
        "返回全量任务对象，由你（LLM）决定在回复中展示哪些字段。",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "具体日期，ISO 8601 格式如 '2025-07-07'。"
          },
          date_range: {
            type: "string",
            enum: ["today", "tomorrow", "this_week", "next_week", "overdue"],
            description: "日期范围快捷方式。today=今天，overdue=已过期未完成。"
          },
          status: {
            type: "string",
            enum: ["pending", "completed", "all"],
            description: "任务状态过滤，默认 pending。"
          },
          priority: {
            type: "string",
            enum: ["P0", "P1", "P2", "P3"],
            description: "优先级过滤。"
          },
          keyword: {
            type: "string",
            description: "标题关键词搜索（LIKE 匹配）。"
          },
          limit: {
            type: "integer",
            description: "返回数量限制，默认 10，最大 50。"
          }
        },
        required: []
      }
    }
  },

  // ── Tool 5: update_task ──
  {
    type: "function",
    function: {
      name: "update_task",
      description:
        "更新已有任务的字段。当用户表达修改语义时使用：" +
        "'改成'、'改为'、'推迟到'、'提前到'、'换个时间'、'改一下'。" +
        "如果不确定要修改哪个任务，先调用 query_tasks 查找。" +
        "系统会展示修改前后的对比确认卡片。",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "任务 ID。如果已知，直接传入。"
          },
          task_keyword: {
            type: "string",
            description: "任务关键词，用于查找目标任务。"
          },
          task_date: {
            type: "string",
            description: "任务日期，辅助定位。"
          },
          title: {
            type: "string",
            description: "新的任务标题。"
          },
          start_time: {
            type: "string",
            description: "新的开始时间，ISO 8601 格式。"
          },
          end_time: {
            type: "string",
            description: "新的结束时间。"
          },
          priority: {
            type: "string",
            enum: ["P0", "P1", "P2", "P3"],
            description: "新的优先级。"
          },
          location: {
            type: "string",
            description: "新的地点。"
          }
        },
        required: []
      }
    }
  },

  // ── Tool 6: daily_brief ──
  {
    type: "function",
    function: {
      name: "daily_brief",
      description:
        "生成每日播报。当用户表达'今天怎么样'、'播报'、'今天总结'、" +
        "'汇报今天'时使用。系统返回今日任务数据，由你（LLM）生成自然语言播报。",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "播报日期，ISO 8601 格式。默认今天。"
          },
          style: {
            type: "string",
            enum: ["brief", "detailed"],
            description: "播报风格。brief=简洁摘要，detailed=详细列表。默认 brief。"
          }
        },
        required: []
      }
    }
  },

  // ── Tool 7: daily_review ──
  {
    type: "function",
    function: {
      name: "daily_review",
      description:
        "生成每日复盘。当用户表达'复盘'、'回顾今天'、'今天复盘'、" +
        "'总结今天'时使用。系统返回今日完成/未完成任务、完成率等数据，" +
        "由你（LLM）分析效率并给出改进建议。",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "复盘日期，ISO 8601 格式。默认今天。"
          }
        },
        required: []
      }
    }
  }
];

// ============================================
// System Prompt
// ============================================

/**
 * 构建 Agent 模式的 System Prompt
 * 包含当前时间上下文、时间推理规则、核心行为原则
 */
function buildAgentSystemPrompt() {
  const now = new Date();
  const weekDayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const currentTime = [
    now.getFullYear(),
    '-',
    String(now.getMonth() + 1).padStart(2, '0'),
    '-',
    String(now.getDate()).padStart(2, '0'),
    ' ',
    String(now.getHours()).padStart(2, '0'),
    ':',
    String(now.getMinutes()).padStart(2, '0'),
    '（星期',
    weekDayNames[now.getDay()],
    '）',
  ].join('');

  return `你是个人 AI 效率管家，帮助用户管理日程和任务。你可以通过调用工具（tools）来完成用户的操作请求。

## 当前时间
${currentTime}

---

## 一、调用 create_task 前的信息完整性检查（最高优先级）

创建任务前，你必须评估信息是否足够。**宁可追问，绝不猜测**。

### 必须追问的场景：
- 用户只说了日期没有具体时间（如"明天有约会"、"后天开会"）→ 追问"几点？上午还是下午？"
- 用户只说了时间段没有日期（如"下午开会"）→ 追问"哪天？"
- 任务内容模糊，可能需要更多上下文（如"帮我记个事"）→ 追问"什么事？"
- 用户说了一个泛指事件（如"约会"、"聚餐"、"面试"），但没给具体时间 → 追问

### 可以直接创建的场景：
- 时间明确：如"明天下午3点开会"、"今晚7点健身"
- 用户明确表示不关心具体时间：如"随便记一下，明天" → 可以默认 09:00
- 上下文补全：上一轮用户已经提到了时间，这一轮只是确认

### 核心判断标准：
**如果你的心里冒出"几点的？""在哪？""和谁？"这些问题，就不要调用 create_task，先追问。**

---

## 二、多意图识别（关键能力）

用户一句话可能包含多个独立意图，你必须识别并处理所有意图，而不是只处理一个。

### 示例（一个 user message 可以触发多个 tool）：
- "明天有一个约会，不去健身了" → 同时包含：创建约会（待追问时间）+ 删除健身任务
- "下午开会改到明天，买菜做完了" → 更新会议 + 完成买菜
- "帮我记下午买药，顺便把买菜标记完成" → 创建买药 + 完成买菜

### 处理原则：
- 识别出多少个独立意图，就可以调用多少个对应 tool
- 如果某个创建意图信息不完整，对这个意图追问，但不要影响其他已明确的操作
- 同一事件不会既是创建又是删除（语义矛盾），但不同事件可以同时进行不同操作

仔细分析用户的真实意图，不要机械匹配关键词：
- **否定语义 = 删除**："不去"、"取消"、"算了"、"不做了"、"删除"、"不要了" → 调用 delete_task
- **完成语义 = 完成**："做完了"、"搞定了"、"完成了"、"结束了" → 调用 complete_task
- **修改语义 = 更新**："改成"、"推迟"、"提前"、"换时间" → 调用 update_task
- **查询语义 = 查询**："今天有什么"、"明天安排"、"这周" → 调用 query_tasks
- **创建语义 = 创建**：经过信息完整性检查后，调用 create_task

---

## 三、时间推理规则

当时间信息足够时，根据当前时间推理：
- "早上" = 09:00，"上午" = 10:00
- "中午" = 12:00，"下午" = 14:00
- "晚上" = 19:00，"深夜" = 22:00
- "明天" = 下一个日历日（不是 24 小时后）
- "后天" = 当前日期 +2 天
- "下周X" = 下周对应的星期X

---

## 四、操作策略
- **不确定时先查询**：如果不确定要操作哪个任务，先调用 query_tasks 查找，再操作
- **删除/更新必须确认**：delete_task 和 update_task 会返回确认卡片，用户确认后才真正执行
- **确认后一句话收尾**：操作成功后，用一句话简洁确认（如"已删除「去健身房」。"），不要追加"还有什么需要帮你的？"等冗余话术
- **信息不足时追问**：如果 tool 返回了 missing_fields 或需要更多信息，生成友好的追问

---

## 五、禁止行为
- 不要编造不存在的任务 ID
- 不要在没有查询的情况下假设某个任务存在
- 不要在用户表达否定语义时调用 create_task
- 模糊输入（如"嗯"、"好"、"哦"）→ 询问意图，不要猜测并调用 tool
- **绝对不要替用户编造时间**：用户没说几点就不要填 start_time，不要默认 09:00 或当前时间`;
}

module.exports = { TOOLS, buildAgentSystemPrompt };
