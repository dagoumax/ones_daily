# Agent/Tool-calling 架构深度分析

> 版本: v1.1 | 日期: 2025-07-06 | 状态: ✅ Phase A/B/C 已实现，Phase D 测试待进行

---

## 目录

1. [现状诊断](#1-现状诊断)
2. [架构对比](#2-架构对比)
3. [Tool 定义](#3-tool-定义)
4. [Agent 循环设计](#4-agent-循环设计)
5. [代码改造方案](#5-代码改造方案)
6. [前端适配](#6-前端适配)
7. [迁移路径与风险](#7-迁移路径与风险)
8. [附录](#8-附录)

---

## 1. 现状诊断

### 1.1 当前架构：Prompt 意图分类

```
用户输入 → [本地预筛 parseInput.js] → [LLM Prompt 分类]
                                         ↓
                        buildTaskCreationPrompt()  ← 硬编码 4 种意图
                                         ↓
                        callLLM(response_format=json_object)
                                         ↓
                        parseLLMResponse() → { intent, slots }
                                         ↓
                        buildReplyContent()  ← 只处理 create_task
                                         ↓
                        前端 AICreatePanel 状态机
```

### 1.2 核心问题清单

| # | 问题 | 位置 | 严重程度 |
|---|------|------|----------|
| 1 | **Prompt 只定义 4 种意图**，不支持删除/完成/更新 | `llmService.js:143-144` | 🔴 阻塞 |
| 2 | **`buildReplyContent()` 硬编码忽略非 create_task** | `ipc/index.js:538` | 🔴 阻塞 |
| 3 | **前端状态机只走 create_task 路径** | `AICreatePanel.jsx:110` | 🔴 阻塞 |
| 4 | **Prompt 中的 JSON 约束 `response_format: { type: 'json_object' }` 与 tool_calls 冲突** | `llmService.js:59` | 🟡 需注意 |
| 5 | **无 Agent 循环** — LLM 单次调用，无法多步骤推理 | `ipc/index.js:289` | 🟡 架构限制 |
| 6 | **无 tool result 注入机制** — LLM 调用工具后无法感知执行结果 | 全局 | 🟡 架构限制 |

### 1.3 用户反馈的 Bug 根因

> 用户输入："我今天七点不去健身房了"

**执行路径**：
1. `parseInput.js` 本地预筛 → 提取到 `title: "不去健身房了"`, `startTime: "今天19:00"` → 命中本地预筛 → **直接创建了任务**
2. 即使绕过本地预筛到达 LLM，Prompt 只定义了 `create_task` / `query_tasks` / `chat` / `unknown`，**没有 `delete_task` 意图** → 被分类为 `create_task` 或 `unknown`
3. 即使 LLM 正确识别为 `delete_task`，`buildReplyContent()` 第 538 行硬编码返回 "此功能将在后续版本支持"

**结论**: 当前架构在**意图层面就无法正确处理删除/取消语义**。这是 Prompt 驱动的固有限制。

---

## 2. 架构对比

### 2.1 Prompt 意图分类 vs Agent Tool-calling

| 维度 | Prompt 意图分类（当前） | Agent Tool-calling（目标） |
|------|-------------------------|---------------------------|
| **决策方式** | 硬编码 Prompt 枚举 4 种意图 | LLM 自主选择 tool |
| **扩展性** | 每加一个操作需改 Prompt + IPC + 前端 | 只需注册新 tool + 实现执行器 |
| **多步骤** | ❌ 不支持 | ✅ LLM 可在循环中多次调用 tool |
| **模糊语义** | 依赖 Prompt 规则，容易误分类 | LLM 推理能力更强，边界情况更稳 |
| **确认机制** | 前端硬编码确认卡片 | tool 返回 `require_confirmation` 标记 |
| **执行反馈** | LLM 不感知任务创建结果 | tool 执行结果注入回 messages |
| **API 格式** | `response_format: { type: 'json_object' }` | `tools: [...]` 参数 |
| **DeepSeek 兼容** | ✅ 支持 | ✅ 原生支持（非 strict 模式） |
| **Anthropic 兼容** | ✅ 支持 | ✅ 支持（tool_use content block） |
| **Token 开销** | ~500 tokens prompt | ~800 tokens tool definitions |

### 2.2 为什么 Agent 模式更适合

```
场景："查一下明天下午的会，全部取消"

Prompt 分类方式：
  → LLM 只能返回一个 intent，无法同时 query + delete
  → 需要多次对话轮次，用户体验差

Agent Tool-calling 方式：
  → LLM 第一次调用: query_tasks({ date: "明天", time_range: "下午" })
  → 系统执行查询，返回 [task1, task2, task3]
  → LLM 第二次调用: delete_task({ id: "task1" }), delete_task({ id: "task2" }), delete_task({ id: "task3" })
  → LLM 第三次调用: 无 tool_calls，自然语言回复 "已取消明天下午的 3 个会议"
  → 用户一次输入完成整个操作
```

---

## 3. Tool 定义

### 3.1 Tool 总览

| Tool | 描述 | 确认策略 | 优先级 |
|------|------|----------|--------|
| `create_task` | 创建新任务 | 展示确认卡片 | P0 |
| `delete_task` | 删除任务 | 需确认（不可逆） | P0 |
| `complete_task` | 完成任务 | 直接执行 | P0 |
| `query_tasks` | 查询任务列表 | 无需确认 | P0 |
| `update_task` | 更新任务字段 | 展示确认卡片 | P1 |
| `daily_brief` | 每日播报 | 无需确认 | P1 |
| `daily_review` | 每日复盘 | 无需确认 | P1 |
| `cancel` | 取消当前操作 | 无需确认 | P2（暂不实现） |

### 3.2 完整 Tool Schema（DeepSeek/OpenAI 格式）

```javascript
const TOOLS = [
  {
    type: "function",
    function: {
      name: "create_task",
      description: "创建一个新的任务/日程/提醒。当用户表达'要做某事'时使用。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "任务标题，提取核心动作描述。不要包含否定词（如'不去'、'不做了'），否定语义应使用 delete_task" },
          start_time: { type: "string", description: "ISO 8601 开始时间。LLM 根据 System Prompt 中的时间规则自行推理，如无法确定则留空触发追问。如 '2025-07-07T15:00:00+08:00'" },
          end_time: { type: "string", description: "ISO 8601 结束时间（可选，默认开始+1h）" },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "优先级，默认 P2" },
          tags: { type: "array", items: { type: "string" }, description: "标签列表（最多3个）。Q1决策：暂不加 participants 参数，等后续版本" },
          location: { type: "string", description: "地点（可选）" },
          notes: { type: "string", description: "备注/补充说明（可选）" }
        },
        required: ["title", "start_time"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "删除/取消一个已有任务。当用户表达'取消'、'不去'、'删除'、'不做了'等否定语义时使用。如果精确时间匹配到0条，返回提示（如'今天没有健身计划'）；±30分钟窗口内模糊匹配，1条直接确认，多条返回候选。Q4决策：硬删除。",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "要删除的任务 ID（如果已知）" },
          task_keyword: { type: "string", description: "任务关键词，用于模糊匹配（如'健身房'、'开会'）" },
          task_date: { type: "string", description: "任务日期，ISO 8601 日期格式，如 '2025-07-07'。默认今天" },
          task_time: { type: "string", description: "任务时间，如 '19:00'、'晚上'、'下午'。匹配时使用 ±30 分钟窗口" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: "标记一个任务为已完成。当用户表达'做完了'、'完成了'、'搞定了'时使用。Q5决策：LLM 先做初步判断选择最匹配的任务，匹配到1条直接确认，匹配到多条返回候选列表让用户选择。",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "任务 ID（如果已知）" },
          task_keyword: { type: "string", description: "任务关键词，用于模糊匹配" },
          task_date: { type: "string", description: "任务日期，如 '2025-07-07'" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_tasks",
      description: "查询已有任务列表。当用户询问'今天有什么'、'明天的安排'、'查看任务'时使用。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "日期，ISO 8601 格式，如 '2025-07-07'" },
          date_range: { type: "string", enum: ["today", "tomorrow", "this_week", "next_week", "overdue"], description: "日期范围" },
          status: { type: "string", enum: ["pending", "completed", "all"], description: "任务状态过滤" },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "优先级过滤" },
          keyword: { type: "string", description: "标题关键词搜索" },
          limit: { type: "integer", description: "返回数量限制，默认 10" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "更新已有任务的字段。当用户表达'改成'、'改为'、'推迟'、'提前'时使用。",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "任务 ID" },
          task_keyword: { type: "string", description: "任务关键词用于查找" },
          title: { type: "string", description: "新的标题" },
          start_time: { type: "string", description: "新的开始时间" },
          end_time: { type: "string", description: "新的结束时间" },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "新的优先级" },
          location: { type: "string", description: "新的地点" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "daily_brief",
      description: "生成每日播报：汇总今日任务、统计完成情况、提供建议。当用户表达'今天怎么样'、'播报'、'总结'时使用。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "日期，默认今天" },
          style: { type: "string", enum: ["brief", "detailed"], description: "播报风格" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "daily_review",
      description: "生成每日复盘：回顾今日完成/未完成任务，分析效率，给出改进建议。当用户表达'复盘'、'回顾今天'时使用。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "日期，默认今天" }
        },
        required: []
      }
    }
  }
];
```

### 3.3 关键设计决策

**为什么 delete_task 的 task_id 不是 required？**
> 用户通常不知道任务 ID。LLM 会传入 `task_keyword` + `task_date` + `task_time`，后端模糊匹配后返回候选列表，LLM 二次确认。

**为什么 confirm 不是 tool？**
> 确认是 UI 层概念。tool 执行后返回 `require_confirmation: true`，前端展示确认卡片。用户确认后，前端再次调用 `ai:chat` 但带上 `confirmed: true` 上下文。

---

## 4. Agent 循环设计

### 4.1 核心循环

```
┌──────────────────────────────────────────────────┐
│                  Agent 循环                        │
│                                                    │
│  用户输入                                          │
│     ↓                                              │
│  ┌──────────────────┐                              │
│  │ 1. 本地预筛       │ ← parseInput.js (保留)       │
│  │    命中? → 直接创建 │                              │
│  └──────┬───────────┘                              │
│         ↓ 未命中                                    │
│  ┌──────────────────┐                              │
│  │ 2. 构建 messages  │ ← system prompt + tools     │
│  │    + tools 定义   │                              │
│  └──────┬───────────┘                              │
│         ↓                                          │
│  ┌──────────────────┐                              │
│  │ 3. 调用 LLM      │ ← callLLM(messages, tools)   │
│  │    (no json_mode) │   去掉 response_format       │
│  └──────┬───────────┘                              │
│         ↓                                          │
│    有 tool_calls?                                  │
│    ├─ YES ──→ 4. 执行 tool                         │
│    │            ↓                                  │
│    │         5. 注入 tool result 到 messages        │
│    │            ↓                                  │
│    │         6. 回到步骤 3 (最多 5 轮)              │
│    │                                               │
│    └─ NO ──→ 7. 返回自然语言响应给前端              │
│                                                    │
│  最大轮数: 5 (防止无限循环)                          │
│  超时: 30s 总计                                     │
└──────────────────────────────────────────────────┘
```

### 4.2 伪代码实现

```javascript
async function agentLoop(userMessage, sessionId, history) {
  const systemPrompt = buildAgentSystemPrompt(); // 含当前时间、用户画像
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,                                   // 最近 N 条历史
    { role: 'user', content: userMessage },
  ];

  const MAX_ROUNDS = 5;
  let finalResponse = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await callLLM(model, messages, {
      temperature: 0.1,
      maxTokens: 2048,
      tools: TOOLS,          // ← 传入 tool 定义
      // 注意：不加 response_format，让 LLM 自由选择 text 或 tool_calls
    });

    const choice = response.choices[0];
    const msg = choice.message;

    // 检查是否有 tool_calls
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // 将 assistant 消息（含 tool_calls）加入 messages
      messages.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      });

      // 执行每个 tool_call
      for (const tc of msg.tool_calls) {
        const toolResult = await executeToolCall(tc);
        
        // 将 tool 执行结果注入 messages
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult),
        });

        // 如果需要确认，中断循环，返回给前端
        if (toolResult.require_confirmation) {
          return {
            type: 'confirm',
            toolName: tc.function.name,
            toolArgs: JSON.parse(tc.function.arguments),
            toolResult,
            messages, // 保存当前 messages 状态用于恢复
          };
        }
      }
      // 继续循环，让 LLM 处理 tool 结果
      continue;
    }

    // 无 tool_calls → 最终自然语言回复
    finalResponse = {
      type: 'reply',
      content: msg.content,
      messages,
    };
    break;
  }

  return finalResponse || {
    type: 'reply',
    content: '抱歉，处理超时，请简化你的请求。',
  };
}
```

### 4.3 Tool 执行器

```javascript
async function executeToolCall(toolCall) {
  const { name, arguments: argsJson } = toolCall.function;
  const args = JSON.parse(argsJson);

  switch (name) {
    case 'create_task':
      // 检查槽位完整性
      if (!args.title || !args.start_time) {
        return {
          success: false,
          error: 'missing_fields',
          missing: [!args.title && 'title', !args.start_time && 'start_time'].filter(Boolean),
          require_confirmation: false,
          follow_up: '请提供任务的标题和时间',
        };
      }
      return {
        success: true,
        require_confirmation: true, // ← 创建需要确认
        task_preview: {
          title: args.title,
          start_time: args.start_time,
          end_time: args.end_time || null,
          priority: args.priority || 'P2',
          tags: args.tags || [],
          location: args.location || '',
          notes: args.notes || '',
        },
        message: `即将创建任务"${args.title}"`,
      };

    case 'delete_task': {
      // Q3决策：keyword + date + time 模糊匹配，±30分钟窗口
      // Q4决策：硬删除
      const candidates = findTasks(args, { timeWindowMinutes: 30 });
      if (candidates.length === 0) {
        // Q3决策：无匹配时给出友好提示
        return {
          success: true, // success=true 让 LLM 生成自然语言回复
          require_confirmation: false,
          not_found: true,
          message: args.task_date 
            ? `${args.task_date} 没有${args.task_keyword ? '"' + args.task_keyword + '"相关' : ''}任务`
            : `没有找到${args.task_keyword ? '"' + args.task_keyword + '"相关' : '匹配的'}任务`,
        };
      }
      if (candidates.length === 1) {
        return {
          success: true,
          require_confirmation: true,
          task: candidates[0],
          message: `确认删除"${candidates[0].title}"？此操作不可撤销。`,
        };
      }
      return {
        success: true,
        require_confirmation: true,
        candidates,
        message: `找到 ${candidates.length} 个匹配任务，请确认要删除哪一个。`,
      };
    }

    case 'complete_task': {
      // Q5决策：LLM 初步判断后返回匹配结果，1条确认，多条候选
      const completeCandidates = findTasks(args, { status: 'pending' });
      if (completeCandidates.length === 0) {
        return { success: true, not_found: true, message: '未找到匹配的待完成任务。' };
      }
      if (completeCandidates.length === 1) {
        return {
          success: true,
          require_confirmation: true, // Q5决策：1条也确认
          task: completeCandidates[0],
          task_id: completeCandidates[0].id,
          message: `确认将"${completeCandidates[0].title}"标记为完成？`,
        };
      }
      return {
        success: true,
        require_confirmation: true,
        candidates: completeCandidates,
        message: `找到 ${completeCandidates.length} 个匹配任务，请选择要标记为完成的任务。`,
      };
    }

    case 'query_tasks':
      const tasks = queryTasksFromDB(args);
      return {
        success: true,
        tasks,
        count: tasks.length,
        summary: tasks.length === 0 
          ? '没有找到匹配的任务。' 
          : `找到 ${tasks.length} 个任务。`,
      };

    case 'update_task':
      const targetTask = findTaskByIdOrKeyword(args);
      if (!targetTask) return { success: false, message: '未找到要修改的任务。' };
      const updates = extractUpdates(args, targetTask);
      return {
        success: true,
        require_confirmation: true,
        task_id: targetTask.id,
        original: targetTask,
        updates,
        message: `确认将"${targetTask.title}"${describeUpdates(updates)}？`,
      };

    case 'daily_brief':
      const briefData = await buildDailyBrief(args.date);
      return { success: true, ...briefData };

    case 'daily_review':
      const reviewData = await buildDailyReview(args.date);
      return { success: true, ...reviewData };

    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}
```

### 4.4 System Prompt

```javascript
function buildAgentSystemPrompt() {
  const now = new Date();
  const weekDayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const currentTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}（星期${weekDayNames[now.getDay()]}）`;

  return `你是个人 AI 效率管家，帮助用户管理日程和任务。

## 当前时间
${currentTime}

## 核心原则
1. **理解意图优先**：仔细分析用户的真实意图，不要机械匹配关键词
2. **否定语义 = 删除**："不去"、"取消"、"算了"、"不做了"、"删除" → 使用 delete_task
3. **完成语义 = 完成**："做完了"、"搞定了"、"完成了" → 使用 complete_task
4. **时间默认规则**：
   - "早上" = 09:00，"上午" = 10:00
   - "中午" = 12:00，"下午" = 14:00
   - "晚上" = 19:00
   - "明天" = 下一个日历日
   - 未指定时间默认下一个整点
5. **不确定时先查询**：如果不确定要操作哪个任务，先用 query_tasks 查询
6. **删除前确认**：delete_task 必须经过用户确认
7. **信息不足时追问**：如果 tool 返回 missing_fields，生成友好的追问

## 禁止行为
- 不要编造不存在的任务 ID
- 不要在没有查询的情况下假设任务存在
- 不要在用户表达否定语义时创建任务`;
}
```

---

## 5. 代码改造方案

### 5.1 改造清单

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/main/services/llmService.js` | 🔧 重大 | 新增 `agentLoop()`，保留旧函数做兼容 |
| `src/main/services/toolExecutor.js` | ✨ 新建 | 7 个 tool 的执行逻辑 |
| `src/main/services/agentPrompt.js` | ✨ 新建 | System prompt + tool definitions |
| `src/main/ipc/index.js` | 🔧 重大 | `ai:chat` handler 改用 agentLoop |
| `src/renderer/components/ai/AICreatePanel.jsx` | 🔧 重大 | 状态机从单意图 → 多 tool 通用流程 |
| `src/renderer/components/ai/AIConfirmCard.jsx` | 🔧 中等 | 支持 delete/update 确认卡片 |
| `src/renderer/stores/aiStore.js` | 🔧 中等 | 新增 toolCallState, pendingToolResult |

### 5.2 llmService.js 改造

```javascript
// 新增函数：支持 tools 参数的 LLM 调用
async function callLLMWithTools(modelConfig, messages, options = {}) {
  // ... 与 callLLM 相同的连接逻辑 ...
  
  // 关键区别：
  const postData = {
    model: modelConfig.model_identifier,
    messages: messages,
    max_tokens: options.maxTokens || 2048,
    temperature: options.temperature ?? 0.1,
    tools: options.tools || [],          // ← 新增
    tool_choice: options.tool_choice || 'auto', // ← 新增
    // 注意：不再有 response_format: { type: 'json_object' }
  };
  
  // 返回格式：
  // response.choices[0].message.tool_calls → [{ id, type, function: { name, arguments } }]
  // response.choices[0].message.content → 自然语言文本（可能为 null）
}

// 保留旧 callLLM 做降级兼容
async function callLLM(modelConfig, messages, options = {}) {
  // 不变，但内部判断：如果有 options.tools → 使用新逻辑
}
```

### 5.3 ipc/index.js ai:chat 改造

```javascript
// 改造前 (约 280 行)
ipcMain.handle('ai:chat', async (_, { message, sessionId, history, existingSlots }) => {
  // ... 本地预筛 ...
  const { systemPrompt, messages } = buildTaskCreationPrompt(message, existingSlots);
  const result = await callLLM(model, messages, { temperature: 0.1, maxTokens: 1024 });
  const parsed = parseLLMResponse(result.content);
  const replyContent = buildReplyContent(parsed);
  return buildChatResponse(parsed, replyContent, session);
});

// 改造后 (核心流程)
ipcMain.handle('ai:chat', async (_, { message, sessionId, history, existingSlots, confirmedToolCall }) => {
  
  // 1. 如果是确认回调 (用户点了确认卡片)
  if (confirmedToolCall) {
    return handleConfirmedToolCall(confirmedToolCall, sessionId);
  }

  // 2. 本地预筛 (保留)
  const localParsed = localPreScreen(message);
  if (localParsed.hit) {
    return buildConfirmResponse('create_task', localParsed.slots, sessionId);
  }

  // 3. Agent 循环
  const model = getDefaultModel();
  const systemPrompt = buildAgentSystemPrompt();
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(history || []).slice(-10),
    { role: 'user', content: message },
  ];

  const result = await agentLoop(model, messages, sessionId);

  // 4. 根据 agentLoop 返回类型处理
  switch (result.type) {
    case 'confirm':
      // 需要前端确认
      return {
        success: true,
        type: 'confirm',
        toolName: result.toolName,
        toolArgs: result.toolArgs,
        preview: result.toolResult,
        confirmId: result.confirmId,
        sessionId,
      };
    
    case 'reply':
      // 纯文本回复（查询结果、闲聊等）
      return {
        success: true,
        type: 'reply',
        content: result.content,
        sessionId,
      };
    
    case 'error':
      return {
        success: false,
        error: result.error,
        fallback: true,
        sessionId,
      };
  }
});
```

### 5.4 agentLoop 完整实现

```javascript
// src/main/services/agentLoop.js

async function agentLoop(model, messages, sessionId, maxRounds = 5) {
  const db = getDatabase();
  let confirmId = null;

  for (let round = 0; round < maxRounds; round++) {
    const response = await callLLMWithTools(model, messages, {
      temperature: 0.1,
      maxTokens: 2048,
      tools: TOOLS,
      tool_choice: 'auto',
    });

    const choice = response.choices?.[0];
    if (!choice) throw new Error('LLM 返回为空');

    const msg = choice.message;

    // 无 tool_calls → 最终回复
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return {
        type: 'reply',
        content: msg.content || '好的，已完成。',
        messages,
      };
    }

    // 有 tool_calls → 执行
    messages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: msg.tool_calls,
    });

    for (const tc of msg.tool_calls) {
      const toolResult = await executeToolCall(tc, db);

      // 需要确认 → 中断循环
      if (toolResult.require_confirmation) {
        confirmId = uuidv4();
        
        // 保存循环状态到 ai_decisions 表，用于恢复
        db.run(
          `INSERT INTO ai_decisions (id, scene, input_context, ai_suggestion, user_choice, accepted) 
           VALUES (?, 'agent_confirm', ?, ?, NULL, 0)`,
          [confirmId, JSON.stringify({ messages, toolCall: tc }), JSON.stringify(toolResult)]
        );

        return {
          type: 'confirm',
          toolName: tc.function.name,
          toolArgs: JSON.parse(tc.function.arguments),
          toolResult,
          confirmId,
        };
      }

      // 不需要确认 → 注入结果
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      });

      // 如果是直接执行的操作（如 complete_task），记录日志
      if (tc.function.name === 'complete_task' && toolResult.task_id) {
        // 已执行完成操作
      }
    }
    // 继续下一轮
  }

  // 超过最大轮数
  return {
    type: 'reply',
    content: '抱歉，处理步骤过多。请尝试简化你的请求。',
  };
}
```

---

## 6. 前端适配

### 6.1 AICreatePanel 状态机变更

```
改造前（仅 create_task）:
  IDLE → CHECKING → LLM_CALL → CONFIRM → CREATING → IDLE
                  ↘ WAITING ↗      ↘ FALLBACK

改造后（通用 Agent）:
  IDLE → CHECKING → AGENT_LOOP → CONFIRM_CREATE → CREATING → IDLE
                               → CONFIRM_DELETE → DELETING → IDLE
                               → CONFIRM_UPDATE → UPDATING → IDLE
                               → REPLY (显示查询结果/闲聊)
                               → FALLBACK
```

### 6.2 IPC 响应格式变更

```javascript
// 改造前
{
  success: true,
  intent: "create_task",
  slots: { title, start_time, ... },
  confirmCard: true,
  reply: null,
}

// 改造后 — 确认类响应
{
  success: true,
  type: "confirm",
  toolName: "delete_task",
  preview: {
    task: { id: "xxx", title: "去健身房", start_time: "2025-07-06T19:00:00+08:00" },
    message: "确认删除"去健身房"？此操作不可撤销。",
    candidates: null, // 单个匹配
  },
  confirmId: "uuid",
}

// 改造后 — 回复类响应
{
  success: true,
  type: "reply",
  content: "你今天有 3 个任务：\n1. 09:00 晨会\n2. 14:00 项目评审\n3. 19:00 去健身房",
}

// 改造后 — 多候选确认
{
  success: true,
  type: "confirm",
  toolName: "delete_task",
  preview: {
    candidates: [
      { id: "t1", title: "去健身房", start_time: "2025-07-06T19:00" },
      { id: "t2", title: "健身房私教课", start_time: "2025-07-07T10:00" },
    ],
    message: "找到 2 个匹配任务，请选择要删除的任务。",
  },
}
```

### 6.3 AIConfirmCard 改造

```jsx
// 改造前：只渲染 create_task 确认卡片
<AIConfirmCard slots={slots} onConfirm={handleConfirm} />

// 改造后：根据 toolName 渲染不同卡片
function renderConfirmCard(preview, toolName) {
  switch (toolName) {
    case 'create_task':
      return <CreateConfirmCard task={preview.task_preview} onConfirm={...} />;
    case 'delete_task':
      if (preview.candidates) {
        return <DeleteCandidateList candidates={preview.candidates} onSelect={...} />;
      }
      return <DeleteConfirmCard task={preview.task} onConfirm={...} />;
    case 'update_task':
      return <UpdateConfirmCard original={preview.original} updates={preview.updates} onConfirm={...} />;
  }
}
```

### 6.4 确认回调流程

```
用户点击确认
    ↓
前端调用 ai:chat({
  message: null,           // 无需新消息
  confirmedToolCall: {
    confirmId: "uuid",
    toolName: "delete_task",
    toolArgs: { task_id: "t1" },
    action: "confirm",     // "confirm" | "cancel"
  }
})
    ↓
后端 handleConfirmedToolCall():
  1. 从 ai_decisions 恢复 messages 状态
  2. 注入 tool result (success: true)
  3. 继续 agentLoop
  4. 返回最终结果
```

---

## 7. 迁移路径与风险

### 7.1 分阶段迁移

```
Phase A (1-2天): Tool 基础设施
  ├── ✨ 新建 toolExecutor.js (7 个 tool 执行器)
  ├── ✨ 新建 agentPrompt.js (system prompt + tool defs)
  ├── ✨ 新建 agentLoop.js (核心循环)
  └── 🔧 llmService.js 新增 callLLMWithTools()

Phase B (1天): IPC 改造
  ├── 🔧 ai:chat handler 切换为 agentLoop
  ├── 🔧 buildReplyContent / buildChatResponse 重构
  ├── 🔧 新增 confirmedToolCall 处理
  └── 🔧 保留旧路径做降级开关

Phase C (1-2天): 前端适配
  ├── 🔧 AICreatePanel 状态机重构
  ├── 🔧 AIConfirmCard 多类型支持
  ├── ✨ 新建 DeleteConfirmCard
  ├── ✨ 新建 TaskListCard (查询结果展示)
  └── 🔧 aiStore 新增 toolCall 相关状态

Phase D (1天): 测试与降级
  ├── 🧪 7 种 tool 端到端测试
  ├── 🧪 多步骤 Agent 场景测试
  ├── 🔧 本地预筛兼容（保留 parseInput.js）
  └── 🔧 降级开关（出问题切回旧 Prompt 模式）
```

### 7.2 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| DeepSeek tool_calling 不稳定 | 中 | 高 | 降级开关切回 Prompt 模式 |
| Token 消耗增加 | 高 | 低 | 设置 max_rounds=5，监控 usage_logs |
| 多轮循环超时 | 中 | 中 | 总超时 30s，超时返回部分结果 |
| 用户确认中断循环恢复失败 | 低 | 中 | ai_decisions 表持久化状态 |
| Anthropic 工具格式不兼容 | 低 | 中 | 适配层转换 tool_calls ↔ tool_use |
| 前端状态机复杂度激增 | 中 | 中 | 提取 useAgentChat hook 封装 |

### 7.3 降级开关设计

```javascript
// config.json 或环境变量
const USE_AGENT_MODE = process.env.AI_AGENT_MODE !== 'false'; // 默认开启

ipcMain.handle('ai:chat', async (params) => {
  if (USE_AGENT_MODE) {
    return handleAgentChat(params);
  }
  // 降级到旧 Prompt 模式
  return handleLegacyChat(params);
});
```

### 7.4 兼容性矩阵

| 模型提供商 | Tool Calling 支持 | 格式 | 备注 |
|-----------|-------------------|------|------|
| DeepSeek | ✅ 原生支持 | `tools: [{type:"function", function:{...}}]` | 非 strict 模式无需 beta endpoint |
| OpenAI | ✅ 原生支持 | 同 DeepSeek | GPT-4/GPT-4o |
| Anthropic | ✅ 原生支持 | `tools: [{name, description, input_schema}]` | 需格式转换 |
| Ollama | ⚠️ 部分支持 | 同 OpenAI | 需模型支持（llama3.1+） |

---

## 8. 附录

### 8.1 用户场景覆盖矩阵

| 用户输入 | 旧架构结果 | Agent 架构结果 |
|---------|-----------|---------------|
| "明天下午3点开会" | ✅ create_task | ✅ create_task → confirm |
| "我今天七点不去健身房了" | ❌ 创建了"不去健身房"任务 | ✅ delete_task(keyword="健身房", date="今天", time="19:00") → confirm |
| "查一下明天的会，全部取消" | ❌ 不支持多步骤 | ✅ query_tasks → delete_task × N |
| "项目评审做完了" | ❌ unknown → "后续版本支持" | ✅ complete_task(keyword="项目评审") → done |
| "把明天的会议改到下午4点" | ❌ unknown | ✅ query_tasks → update_task |
| "今天怎么样" | ❌ unknown | ✅ daily_brief |
| "复盘一下本周" | ❌ unknown | ✅ daily_review |

### 8.2 关键代码量估算

| 模块 | 新增行数 | 修改行数 |
|------|---------|---------|
| toolExecutor.js | ~300 | - |
| agentLoop.js | ~150 | - |
| agentPrompt.js | ~120 | - |
| llmService.js | ~80 | ~30 |
| ipc/index.js | ~200 | ~100 |
| AICreatePanel.jsx | ~150 | ~200 |
| AIConfirmCard.jsx | ~100 | ~80 |
| aiStore.js | ~50 | ~30 |
| **总计** | **~1150** | **~440** |

### 8.3 与现有 PRD 的关系

本分析文档是 `docs/prd-ai-create-task.md` v1.1 的架构升级方案。PRD v1.1 中定义的功能范围（智能对话、每日播报、每日复盘、上下文记忆）在 Agent 架构下**全部保留**，但实现方式从"Prompt 分类 + 各模块独立调用 LLM"变为"统一 Agent 循环 + Tool 调度"。

建议将本文档作为 **PRD v2.0 的技术附件**，在 PRD 下次修订时合并。

---

## 9. Tool 定义确认决策记录

> 日期: 2025-07-06 | 状态: ✅ 已确认

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| Q1 | `participants` 字段 | **暂不加** | 当前前端无使用场景，避免过度设计 |
| Q2 | 默认时间推理 | **LLM 推理** | System Prompt 含时间规则，LLM 理解比硬编码灵活；无法判断时触发追问 |
| Q3 | 删除时间匹配精度 | **±30 分钟窗口** | 精确匹配太严格，全量太宽松。无匹配时友好提示（如"今天没有健身计划"） |
| Q4 | 删除策略 | **硬删除** | 实现简单，等后续有回收站需求再加软删除 |
| Q5 | complete_task 多匹配 | **确认式** | LLM 初步判断 → 1 条确认 / 多条候选列表，防止误操作 |
| Q6 | query 返回粒度 | **全量对象** | LLM 自主决定自然语言回复中展示哪些字段 |
| Q7 | update 前是否强制 query | **LLM 自主** | LLM 不确定时先 query 再 update，确定时直接 update |
| Q8 | brief/review 播报生成 | **tool 返回数据 + LLM 生成** | 职责分离：tool 执行器只管数据，LLM 负责自然语言生成 |
