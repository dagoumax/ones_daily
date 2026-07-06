# PRD — AI 智能创建任务 v1.1

> 版本：v1.1 | 日期：2026.07.07 | 状态：已评审，进入开发  
> 关联文档：`docs/llm-deep-requirement-analysis.md` v0.2 | `docs/prd-review-ai-create-task.md`  
> 对应迭代：Phase 1

---

## 一、背景与目标

### 1.1 背景

当前 `CreateView` 已支持：
- 自然语言手动输入 + `parseInput.js` 本地解析（时间/优先级/标签）
- 语音转文字输入（Whisper）

但存在明显局限：
- `parseInput.js` 只能处理格式规范的输入，遇到模糊表述（"下午开个会"）无法追问
- 用户需要手动填写缺失字段，操作步骤多
- 无法利用 LLM 的语义理解能力处理自然语言变体

### 1.2 目标

在 CreateView 中增加 **"AI 模式"**，用户通过自然语言（文字/语音）一句话描述任务，AI 完成智能解析、信息补全、自动创建。核心体验提升：**3 步变 1 步**。

### 1.3 Phase 1 范围边界

| 包含 | 不包含（延至后续 Phase） |
|------|------------------------|
| 单任务创建（AI 对话） | 批量创建任务 |
| 意图识别 + 槽位填充（合并为一次 LLM 调用） | 历史数据驱动的自动决策 |
| 线性多轮追问（最多 3 轮） | query/update/delete 意图（仅占位） |
| 确认卡片 + 行内编辑 + 自然语言修改 | 流式输出 |
| 优雅降级（API 失败 / JSON 异常 / 未配置模型） | 自由对话面板 |

### 1.4 成功指标

| 指标 | 目标值 | 测量方式 |
|------|--------|----------|
| AI 创建任务成功率 | ≥ 85% | 对话完成 → 任务成功创建 / 总 AI 对话次数 |
| 平均对话轮数 | ≤ 2.5 轮 | conversations 表统计 |
| AI 模式使用率 | ≥ 30% | AI 创建任务数 / 总创建任务数 |
| 本地预筛命中率 | ≥ 60% | 直接走 parseInput 的输入 / 总输入数 |
| 单次 AI 调用延迟 | ≤ 3s (P95) | usage_logs 表 duration_ms |

---

## 二、用户故事

| ID | 角色 | 场景 | 期望 |
|----|------|------|------|
| US-1 | 上班族 | 语音说"下午3点开会讨论Q3规划" | 任务自动创建，时间/标题/优先级都填好，无需手动操作 |
| US-2 | 上班族 | 输入"开个会"（信息不全） | AI 追问时间、主题、参与人，直到信息完整才创建 |
| US-3 | 新用户 | 第一次使用 AI 模式 | AI 友好引导，即使没有历史数据也能正常工作 |
| US-4 | 所有人 | 输入明确时间+标题 | 直接本地解析创建，不经过 LLM（零延迟） |
| US-5 | 所有人 | API Key 未配置或网络异常 | 自动回退到 parseInput.js 本地解析，功能不中断 |

> **变更说明**（v1.1）：原 US-3 "批量创建任务" 移至 Phase 2。

---

## 三、功能清单

### F1. AI 模式入口

**EARS — Event-driven**  
When 用户在 CreateView 页面点击"AI 模式"切换按钮，the system shall 将输入区从 textarea 切换为对话气泡界面（AICreatePanel 组件），并显示 AI 欢迎语。

**EARS — State-driven**  
While AI 模式处于激活状态，the system shall 在输入框底部显示"AI 模式 · 使用 {模型名}"标识。

**EARS — Ubiquitous**  
The system shall 在手动模式和 AI 模式之间保持用户输入内容不丢失（切换时不重置）。

**EARS — Unwanted**  
If 用户未配置任何模型，then the system shall 将"AI 模式"按钮显示为禁用态，tooltip 提示"请先在模型管理中配置 AI 模型"。

### F2. 本地预筛层

**判定规则**（v1.1 新增）：

```
有效 title     = title.length ≥ 2 && title 不全是标点/数字/空格
有效 startTime = startTime ≠ null && startTime > now
命中条件      = 有效 title && 有效 startTime
```

**EARS — Event-driven**  
When 用户在 AI 模式下提交输入，the system shall 首先调用 `parseInput()` 进行本地解析。

**EARS — Event-driven**  
When 本地解析命中（有效 title + 有效 startTime），the system shall 直接创建任务，不调用 LLM。

**EARS — Event-driven**  
When `parseInput()` 返回有效 title 但无有效 startTime，the system shall 发起 1 轮追问（"请问具体什么时间？"），收到回复后用 parseInput 重新解析时间，直接创建。

**EARS — Event-driven**  
When `parseInput()` 返回有效 startTime 但无有效 title，the system shall 发起 1 轮追问（"请问要做什么？"），收到回复后直接创建。

**EARS — Event-driven**  
When `parseInput()` 无法解析有效信息（title 和 startTime 均无效），the system shall 将输入发送给 LLM 进行合并的意图识别 + 槽位填充。

### F3. 合并意图识别 + 槽位填充（v1.1 合并）

> **架构决策**：意图识别和槽位填充合并为 **一次 LLM 调用**，减少延迟和成本。

**EARS — Event-driven**  
When 用户输入需要 LLM 处理（本地预筛未命中），the system shall 调用 LLM 同时完成意图分类和槽位提取，返回统一的 JSON 响应。

**EARS — State-driven**  
While LLM 返回 `intent = "create_task"`，the system shall 检查必填槽位完整性。

**EARS — Unwanted**  
If 意图为 `unknown`（置信度 < 0.7），then the system shall 回复"抱歉，我不太理解。你可以试试说'明天下午开会'或'帮我记一下买牛奶'"。

**EARS — Unwanted**  
If 意图为 `query_tasks`、`chat` 等非 create_task 意图，then the system shall 返回占位提示"此功能将在后续版本支持，现在可以试试创建任务"。

### F4. 槽位填充

**EARS — Event-driven**  
When 意图确认为 `create_task`，the system shall 从 LLM 响应中提取以下槽位：

| 槽位 | 必填 | Phase 1 实现方式 |
|------|------|-----------------|
| `title` | ✅ | LLM 提取核心动作描述 |
| `start_time` | ✅ | LLM 提取时间表达式 → ISO 8601 |
| `end_time` | ❌ | **默认 start_time + 1h**（Phase 2 改为历史推断） |
| `priority` | ❌ | LLM 语义推断 + 关键词匹配（#P1 等） |
| `tags` | ❌ | LLM 语义提取，最多 3 个 |
| `participants` | ❌ | LLM 提取人名词汇 |
| `location` | ❌ | LLM 提取地点词汇 |
| `notes` | ❌ | LLM 生成建议（可选展示，质量不稳定时隐藏） |

**EARS — Event-driven**  
When 必填槽位（title、start_time）已填充，the system shall 进入确认阶段。

**EARS — Event-driven**  
When 必填槽位缺失，the system shall 使用 LLM 返回的 `follow_up_question` 展示追问消息，等待用户回复。

**EARS — State-driven**  
While 处于追问状态，the system shall 将对话状态设为 `WAITING`，用户回复后合并已有槽位重新发送给 LLM 提取。

### F5. 多轮对话状态机（v1.1 简化）

```
                    ┌─────────┐
        ┌──────────→│  IDLE   │←─────────────────┐
        │           └────┬────┘                  │
        │                │ 用户输入               │
        │                ↓                       │
        │        ┌──────────────┐                │
        │        │ 本地预筛      │                │
        │        └──┬───────┬───┘                │
        │     命中   │       │ 未命中             │
        │     直接创建│       ↓                   │
        │           │  ┌──────────────────┐      │
        │           │  │ LLM 意图+槽位填充  │      │
        │           │  │   (一次调用)       │      │
        │           │  └────┬─────────────┘      │
        │           │       │                    │
        │      ┌────┴───────┴────┐               │
        │      │  必填槽位完整?   │               │
        │      └──┬──────────┬──┘               │
        │    是   │          │ 否                │
        │         ↓          ↓                   │
        │  ┌──────────┐ ┌──────────┐            │
        │  │ CONFIRM  │ │ WAITING  │──→用户回复──┘
        │  └────┬─────┘ └──────────┘
        │       │                                │
        │  ┌────┴────────┐                       │
        │  │ 用户操作     │                       │
        │  ├─确认→CREATING                       │
        │  ├─行内编辑→更新卡片                     │
        │  ├─自然语言修改→LLM重解析(不计轮数)       │
        │  └─取消→IDLE                           │
        │       │                                │
        │   ┌───┴──────────┐                     │
        │   │ 超过3轮/用户取消│                     │
        │   ↓               │                    │
        │  FALLBACK ←───────┘                    │
        │   │ 回退手动+预填                        │
        └───┘                                    │
```

**EARS — State-driven**  
While 同一会话的追问轮数 ≥ 3 轮仍未完成创建，the system shall 回退到手动模式，将已提取的槽位填入表单让用户手动补全。

> **变更说明**（v1.1）：意图识别 + 槽位填充合并为一步，状态机从 10 状态简化为 6 状态（IDLE → CHECKING → LLM_CALL → CONFIRM / WAITING → CREATING / FALLBACK）。

### F6. 确认与创建（v1.1 增强）

**确认卡片内容**：

```
┌──────────────────────────────────────┐
│ 📋 [Q3产品规划讨论          ] [✎]    │  ← 行内编辑按钮
│ 🕐 [15:00] → [16:30]        [✎]    │  ← 点击直接修改（纯前端）
│ 🔴 [P1 ▼]  理由: 关键词"规划"        │  ← 下拉修改优先级
│ 👥 产品组                     [✎]    │
│ #产品 #会议 #Q3               [✎]    │
│                                      │
│ 💡 建议：会前回顾上次产品评审结论      │
│                                      │
│ [✓ 确认创建]  [✕ 取消]               │
└──────────────────────────────────────┘
```

**EARS — Event-driven**  
When 所有必填槽位填充完毕，the system shall 向用户展示确认卡片，每个可编辑字段旁显示行内编辑按钮 [✎]。

**EARS — Event-driven**  
When 用户点击行内编辑按钮，the system shall 将对应字段切换为可编辑状态（纯前端操作，不调 LLM），修改后实时更新卡片。

**EARS — Event-driven**  
When 用户点击"确认创建"，the system shall 调用 `task:create` IPC 创建任务并显示成功提示。

**EARS — Event-driven**  
When 用户输入自然语言修改（如"改成下午4点"、"优先级改成P1"），the system shall 将修改意图 + 已有槽位发送给 LLM 重新解析，更新确认卡片。**此操作不计入追问轮数**。

**EARS — Event-driven**  
When 用户点击"取消"或输入"算了"/"不用了"，the system shall 清除当前对话状态，回到 IDLE。

### F7. 自动决策（Phase 1 简化版）

**EARS — Ubiquitous**  
The system shall 在确认卡片中为每个自动推断的字段附带 `reason` 说明。

**EARS — Event-driven**  
When 优先级无法从输入中直接提取（无 #P1 等标记），the system shall 使用 LLM 推断优先级（基于关键词和语义）。

**EARS — Ubiquitous**  
The system shall 为无结束时间的任务默认设置 `end_time = start_time + 1h`。

**EARS — Ubiquitous**  
The system shall 将 LLM 推断的标签数量限制为最多 3 个。

> Phase 2 将引入历史数据驱动的自动决策（基于 ai_decisions 反馈闭环）。

### F8. 优雅降级

**EARS — Unwanted**  
If LLM API 调用失败（网络错误 / 认证失败 / 超时），then the system shall：
1. 记录错误到 usage_logs
2. 自动回退到 parseInput.js 本地解析
3. 显示提示"AI 服务暂时不可用，已切换到本地解析模式"

**EARS — Unwanted**  
If LLM 返回的 JSON 无法解析（格式错误、被 markdown 代码块包裹等），then the system shall：
1. 尝试清理响应文本（去掉 ```json 包裹）
2. 重试一次（相同 prompt + temperature=0）
3. 仍失败则回退到本地解析

**EARS — Unwanted**  
If 用户未配置任何模型，then the system shall "AI 模式"按钮显示为禁用态。

### F9. 对话历史

**EARS — Event-driven**  
When 每次 AI 对话完成（创建成功/失败/取消），the system shall 将对话记录写入 `conversations` 表。

**EARS — Ubiquitous**  
The system shall 为每个会话生成唯一 `session_id`（格式：`{date}-{uuid前8位}`）。

**EARS — Ubiquitous**  
The system shall 在对话记录的 metadata JSON 中存储：intent、slots、duration_ms、prompt_tokens、completion_tokens。

---

## 四、交互流程

### 4.1 主流程

```
用户打开 CreateView
        │
        ├── 看到两个模式切换按钮：[✎ 手动模式] [🤖 AI 模式]
        │
        ├── 手动模式（默认）：现有 textarea + 实时解析预览 + 确认创建
        │
        └── AI 模式 → 渲染 AICreatePanel：
                │
                ├── 欢迎语
                ├── 对话气泡列表（AIChatMessage × N）
                ├── 确认卡片（AIConfirmCard，槽位完整时显示）
                └── 底部输入栏（AIInputBar）
                    ┌──────────────────────────────────┐
                    │ [🎤] 输入回复...   [发送]  [✕退出] │
                    │ AI 模式 · DeepSeek V4 Flash       │
                    └──────────────────────────────────┘
```

### 4.2 异常流程

```
┌── API 调用失败
│   → 提示 + 自动切换手动模式 + textarea 保留原始输入 + parseInput 解析
│
├── LLM 返回非 JSON
│   → 清理 markdown 包裹 → 重试(temperature=0) → 仍失败则回退本地解析
│
├── 3 轮未完成
│   → 回退手动模式 + 预填已提取槽位
│
└── 未配置模型
    → AI 模式按钮禁用 + tooltip 提示
```

### 4.3 状态流转表（v1.1 简化版）

| 当前状态 | 触发事件 | 下一状态 | 动作 |
|----------|----------|----------|------|
| IDLE | 用户提交输入 | CHECKING | 调用 parseInput() 本地预筛 |
| CHECKING | 本地解析命中 | CREATING | 直接创建任务 |
| CHECKING | 本地解析未命中 | LLM_CALL | 发送合并 Prompt（意图+槽位） |
| LLM_CALL | 必填槽位完整 | CONFIRM | 展示确认卡片 |
| LLM_CALL | 必填槽位缺失 | WAITING | 展示追问消息 |
| LLM_CALL | 意图 ≠ create_task | IDLE | 返回占位提示 |
| WAITING | 用户回复 | LLM_CALL | 合并已有槽位重新调用 LLM |
| WAITING | 轮数 ≥ 3 | FALLBACK | 回退手动模式 + 预填 |
| CONFIRM | 用户确认 | CREATING | 调用 task:create |
| CONFIRM | 行内编辑 | CONFIRM | 纯前端更新卡片 |
| CONFIRM | 自然语言修改 | LLM_CALL | LLM 重新解析（不计轮数） |
| CONFIRM | 用户取消/说"算了" | IDLE | 清除对话状态 |
| CREATING | 创建成功 | IDLE | 显示成功 + 刷新日历 |
| CREATING | 创建失败 | IDLE | 显示错误信息 |
| 任意状态 | API 错误 | FALLBACK | 回退本地解析 |

---

## 五、数据结构

### 5.1 LLM 请求格式（v1.1 合并版）

```json
{
  "model": "deepseek-chat",
  "temperature": 0.1,
  "messages": [
    {
      "role": "system",
      "content": "你是智能任务解析器。从用户输入中同时完成意图分类和槽位提取，返回 JSON。\n\n当前时间：2026-07-07T14:30:00+08:00（星期三）\n\n## 意图类型\n- create_task: 创建新任务/提醒/日程\n- query_tasks: 查看已有任务\n- chat: 闲聊或请求建议\n- unknown: 无法分类\n\n## 槽位定义（仅 create_task 时填充）\n- title: 任务标题（必填）\n- start_time: ISO 8601 开始时间（必填，含时区）\n- end_time: ISO 8601 结束时间\n- priority: P0/P1/P2/P3\n- tags: 标签数组（最多3个）\n- participants: 参与人数组\n- location: 地点\n- notes: AI 补充建议\n\n## 规则\n1. 未指定时间 → 默认当前时间后最近整点/半点\n2. 未指定优先级 → 默认 P2\n3. 未指定结束时间 → 默认开始时间+1h\n4. 只提取明确信息，不要编造\n5. 信息不足时在 missing_fields 列出，follow_up_question 生成友好追问\n6. \"明天\"指下一个日历日，不是24小时后\n7. \"晚上\"默认 19:00，\"早上\"默认 09:00\n\n## 负面示例\n❌ \"下午开会\" → 不要编造具体时间，标记 missing_fields: [\"start_time\"]\n❌ \"买菜\" → 不要编造地点\n❌ \"嗯\" → 意图应为 unknown\n❌ 输入含多任务 → 只提取第一个"
    },
    {
      "role": "user",
      "content": "下午3点开会讨论Q3产品规划 #重要"
    }
  ],
  "response_format": { "type": "json_object" }
}
```

### 5.2 LLM 响应格式（v1.1 合并版）

```json
{
  "intent": "create_task",
  "confidence": 0.95,
  "slots": {
    "title": "Q3产品规划讨论",
    "start_time": "2026-07-07T15:00:00+08:00",
    "end_time": "2026-07-07T16:00:00+08:00",
    "priority": "P1",
    "tags": ["产品", "会议", "Q3"],
    "participants": [],
    "location": "",
    "notes": "建议会前回顾上次产品评审结论"
  },
  "missing_fields": [],
  "follow_up_question": null
}
```

**JSON 解析容错**（v1.1 新增）：如果响应被 markdown 代码块包裹（\`\`\`json ... \`\`\`），自动去掉包裹层再解析。

### 5.3 对话消息格式

```typescript
interface ChatMessage {
  id: string;              // UUID
  sessionId: string;       // 会话 ID
  role: 'user' | 'assistant' | 'system';
  content: string;         // 消息文本
  intent?: string;         // 识别到的意图
  slots?: TaskSlots;       // 提取的槽位
  confirmCard?: boolean;   // 是否展示确认卡片
  timestamp: number;       // Unix ms
}

interface TaskSlots {
  title: string;
  startTime: string;       // ISO 8601
  endTime?: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  tags: string[];
  participants: string[];
  location: string;
  notes: string;
}
```

### 5.4 conversations 表存储

```sql
INSERT INTO conversations (id, session_id, role, content, intent, metadata)
VALUES (
  'uuid-1',
  '2026-07-07-a1b2c3d4',
  'assistant',
  '已创建：📋 Q3产品规划讨论...',
  'create_task',
  '{"slots": {...}, "duration_ms": 1234, "prompt_tokens": 300, "completion_tokens": 150}'
);
```

---

## 六、组件设计（v1.1 简化）

### 6.1 组件结构

```
CreateView.jsx
├── 手动模式（现有）
│   ├── textarea
│   ├── 解析预览
│   ├── VoiceButton
│   └── 确认创建按钮
│
└── AI 模式 → AICreatePanel.jsx（新增主组件）
    ├── AIChatMessage.jsx × N       ← 对话气泡
    ├── AIConfirmCard.jsx           ← 确认卡片（条件渲染）
    └── AIInputBar.jsx              ← 底部输入栏（文字+语音）
```

### 6.2 组件清单

| 组件 | 文件 | 说明 |
|------|------|------|
| `AICreatePanel` | `src/renderer/components/ai/AICreatePanel.jsx` | AI 模式主容器，管理消息列表 + 状态机 |
| `AIChatMessage` | `src/renderer/components/ai/AIChatMessage.jsx` | 单条消息气泡（user/assistant/system） |
| `AIConfirmCard` | `src/renderer/components/ai/AIConfirmCard.jsx` | 任务确认卡片（行内编辑 + 确认/取消） |
| `AIInputBar` | `src/renderer/components/ai/AIInputBar.jsx` | 底部输入栏（文字+语音，复用 VoiceButton） |

### 6.3 修改组件

| 组件 | 变更 |
|------|------|
| `CreateView.jsx` | 增加模式切换逻辑；AI 模式时渲染 `AICreatePanel`；传递 `onCreated`/`onCancel` 回调 |
| `App.jsx` | 无需修改 |

### 6.4 AIConfirmCard 行内编辑交互

```
普通状态：
  📋 Q3产品规划讨论        [✎]
  
点击 [✎] 后：
  📋 [Q3产品规划讨论      ] [✓] [✕]
  ← 变为 input，修改后点 ✓ 确认 / ✕ 取消
  
优先级下拉：
  🔴 [P1 ▼]  ← 点击展开 P0/P1/P2/P3 选项
```

---

## 七、IPC 接口定义

### 7.1 `ai:chat`（v1.1 合并版）

```
请求：{
  message: string,
  sessionId?: string,
  history?: ChatMessage[],     // 对话历史（多轮上下文）
  existingSlots?: TaskSlots    // 已有槽位（追问/修改场景）
}

响应：{
  success: boolean,
  intent: string,
  confidence: number,
  slots?: TaskSlots,
  missingFields?: string[],
  followUpQuestion?: string,
  reply: string,               // AI 回复文本
  error?: string
}
```

### 7.2 `ai:chatStream`（Phase 4 使用，Phase 1 仅骨架）

```
主进程 → 渲染进程推送
事件：ai:chatStream
数据：{ chunk: string, done: boolean }
```

---

## 八、验收标准（v1.1 修订）

### 9.1 功能验收

- [ ] **AC-1**：用户点击"AI 模式"按钮后，界面切换为 AICreatePanel 对话界面，显示欢迎语
- [ ] **AC-2**：用户输入"明天下午3点开会讨论项目"，系统直接本地解析创建任务（不调 LLM）
- [ ] **AC-3**：用户输入"开个会"（模糊），系统调用 LLM（一次调用同时完成意图识别+槽位填充），追问缺失信息
- [ ] **AC-4**：用户连续回答追问后，系统正确填充所有槽位，展示确认卡片
- [ ] **AC-5**：用户点击"确认创建"，任务成功写入数据库并刷新日历视图
- [ ] **AC-6**：用户在确认卡片上点击行内编辑按钮 [✎]，可直接修改字段（纯前端，不调 LLM）
- [ ] **AC-7**：用户输入"改成下午4点"（自然语言修改），系统调 LLM 重新解析并更新确认卡片
- [ ] **AC-8**：用户点击"取消"或输入"算了"/"不用了"，对话状态重置为 IDLE
- [ ] **AC-9**：追问超过 3 轮未完成，自动回退到手动模式，预填已提取的槽位
- [ ] **AC-10**：LLM API 调用失败时，自动回退到 parseInput.js 本地解析，显示降级提示
- [ ] **AC-11**：LLM 返回非 JSON 格式（如被 markdown 包裹），系统清理后重试，仍失败则回退
- [ ] **AC-12**：未配置模型时，"AI 模式"按钮禁用，显示提示
- [ ] **AC-13**：切换手动/AI 模式时，用户输入内容不丢失
- [ ] **AC-14**：每次 AI 对话完成后，对话记录正确写入 conversations 表
- [ ] **AC-15**：语音输入在 AI 模式下同样可用，语音转文字后触发 AI 解析，显示分步进度（"🎤 识别中..." → "🤖 AI 解析中..."）

### 9.2 性能验收

- [ ] **AC-16**：本地预筛路径响应时间 < 100ms
- [ ] **AC-17**：AI 调用 P95 延迟 < 3s
- [ ] **AC-18**：对话界面滚动流畅，不出现卡顿

### 9.3 兼容验收

- [ ] **AC-19**：DeepSeek API 正常工作
- [ ] **AC-20**：OpenAI 兼容 API 正常工作
- [ ] **AC-21**：Anthropic API 正常工作（如已配置）

---

## 九、边界场景（v1.1 补充）

| 场景 | 处理方式 |
|------|----------|
| 用户输入为空 | 不发送，输入框保持焦点 |
| 用户输入纯标点/表情 | LLM 意图识别为 unknown → 友好提示 |
| 用户输入超长（>500字） | 截断为前 500 字符发送给 LLM，并提示用户 |
| 用户输入含多句话（"开会，然后吃饭"） | 仅处理第一个任务，后续提示"可以再创建一个" |
| LLM 返回时间格式错误 | 尝试本地 parseInput 兜底解析时间 |
| LLM 返回时间无时区（UTC） | 自动转换为本地时区 |
| 创建任务时数据库写入失败 | 显示错误提示"创建失败，请重试"，保留对话上下文 |
| 用户快速连续发送消息 | 忽略新消息，显示"正在处理中..." |
| 网络中断 | 超时 10s 后回退本地解析 |
| 确认阶段连续自然语言修改 3 次以上 | 提示"可以直接在卡片上点击 ✎ 修改"，避免滥用 LLM |

---

## 十、数据埋点

| 事件 | 参数 | 用途 |
|------|------|------|
| `ai_mode_entered` | model_id, has_history | 统计 AI 模式使用率 |
| `ai_local_preset_hit` | input_length | 统计本地预筛命中率 |
| `ai_llm_call` | intent, confidence, duration_ms, prompt_tokens, completion_tokens | 评估 LLM 调用质量 |
| `ai_task_created` | total_rounds, total_duration_ms, source (local/llm) | 评估端到端体验 |
| `ai_fallback_triggered` | reason (api_error/json_parse/timeout) | 追踪降级频率和原因 |
| `ai_confirm_edited` | field, method (inline/natural_language) | 统计修改行为 |

---

## 十一、变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0 | 2026.07.07 | 初版 |
| v1.1 | 2026.07.07 | 评审修订：合并意图识别+槽位填充、定义行内编辑+自然语言修改双通道、移除批量创建、量化预筛规则、补充 AC-11/AC-15、Prompt 增加 negative examples + 时区注入、简化状态机、组件从 4 个独立组件改为 1 主+3 子 |

---

## 十二、下一步

1. ✅ PRD v1.1 已评审通过
2. 🔜 研发拆解任务并开始 Phase 1 实现
3. 🔜 Prompt 模板调优 → 多轮状态机 → AICreatePanel 组件 → CreateView 集成
