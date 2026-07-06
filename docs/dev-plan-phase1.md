# Phase 1 研发任务清单 — AI 智能创建任务

> 基于 PRD v1.1 | 预估工时：3-4 天 | 任务数：6

---

## 任务依赖图

```
T1 (LLM 调用服务)
  └→ T2 (多轮对话状态机)
       └→ T3 (AICreatePanel 组件)
            └→ T4 (CreateView 集成)
T5 (优雅降级) ← 可并行于 T3/T4
T6 (对话历史) ← 可并行于 T3/T4
```

---

## T1：LLM 调用服务 — callLLM + 合并 Prompt

**工时**：1 天  
**文件**：新建 `src/main/services/llmService.js`，修改 `src/main/ipc/index.js`

### 子任务

- [ ] T1.1 抽取通用 `callLLM(modelConfig, messages, options)` 函数
  - 复用现有 `testModelConnection` 的多厂商路径逻辑
  - 支持 DeepSeek（`/chat/completions`）、OpenAI（`/v1/chat/completions`）、Anthropic（`/v1/messages`）
  - 超时 15s
  - 返回 `{ content, promptTokens, completionTokens, durationMs }`

- [ ] T1.2 实现合并 Prompt 模板函数 `buildTaskCreationPrompt(userMessage, currentTime, existingSlots)`
  - 基于 PRD 5.1 的 system prompt
  - 注入当前时间（含时区 + 星期）
  - 合并已有槽位到 user message 中

- [ ] T1.3 实现 `parseLLMResponse(rawContent)` 容错解析
  - 去掉 markdown 代码块包裹（```json ... ```）
  - JSON.parse 失败时返回 null
  - 验证必填字段（intent, confidence）

- [ ] T1.4 实现 `ai:chat` IPC handler 真实逻辑
  - 替换骨架占位
  - 查找用户默认模型（scene_bindings 或 model_configs 第一个 active）
  - 调用 callLLM → parseLLMResponse → 返回结构化响应
  - 记录 usage_logs

### 验收
- 调用 DeepSeek API 返回正确 JSON 解析结果
- 非 JSON 响应正确容错
- usage_logs 正确记录 token 消耗

---

## T2：多轮对话状态机

**工时**：0.5 天  
**文件**：新建 `src/renderer/stores/chatStateMachine.js`

### 子任务

- [ ] T2.1 实现状态机核心逻辑
  ```
  状态：IDLE | CHECKING | LLM_CALL | CONFIRM | WAITING | CREATING | FALLBACK
  ```

- [ ] T2.2 实现状态转移函数 `transition(currentState, event) → nextState + actions`
  - 基于 PRD 4.3 状态流转表
  - 追问轮数计数器（reset on IDLE）

- [ ] T2.3 集成到 aiStore
  - 在 aiStore 中增加 `dialogState`、`roundCount`
  - 增加 `transition(event)` action

### 验收
- 所有状态转移路径与 PRD 一致
- 追问 3 轮后正确触发 FALLBACK

---

## T3：AICreatePanel 组件

**工时**：1 天  
**文件**：新建 4 个组件文件

### 子任务

- [ ] T3.1 `AICreatePanel.jsx` — 主容器
  - 消息列表渲染（auto-scroll to bottom）
  - 状态机驱动：根据 dialogState 渲染不同内容
  - 欢迎语（IDLE 状态）
  - loading 状态（"🤖 AI 解析中..."）
  - 调用 `window.electronAPI.ai.chat()`

- [ ] T3.2 `AIChatMessage.jsx` — 消息气泡
  - 三种角色样式：user（右对齐，accent 背景）、assistant（左对齐，bg-surface）、system（居中，text-muted）
  - 支持多行文本
  - 确认卡片内的消息特殊渲染

- [ ] T3.3 `AIConfirmCard.jsx` — 确认卡片
  - 展示所有槽位 + 推断理由
  - 行内编辑：点击 [✎] 切换为 input，✓/✕ 确认/取消
  - 优先级下拉选择
  - [确认创建] [取消] 按钮
  - 支持键盘操作（Enter 确认，Esc 取消）

- [ ] T3.4 `AIInputBar.jsx` — 底部输入栏
  - 文字输入框 + 发送按钮
  - 语音按钮（复用现有 VoiceButton 逻辑）
  - Enter 发送，Shift+Enter 换行
  - 发送中禁用输入
  - 显示当前模型名

### 验收
- 所有交互与 PRD 4.1 主流程一致
- 行内编辑功能正常
- 语音输入 → 文字回填 → 触发 AI 解析

---

## T4：CreateView 集成

**工时**：0.5 天  
**文件**：修改 `src/renderer/views/CreateView.jsx`

### 子任务

- [ ] T4.1 增加模式切换逻辑
  - `chatMode` 状态（默认 false）
  - 顶部模式切换按钮组：[✎ 手动模式] [🤖 AI 模式]
  - 切换时保留输入内容

- [ ] T4.2 条件渲染
  - `chatMode === false` → 现有手动模式 UI（不变）
  - `chatMode === true` → `<AICreatePanel />`

- [ ] T4.3 回调桥接
  - `onCreated` → 任务创建成功，切换到 day 视图
  - `onCancel` → 退出 AI 模式

- [ ] T4.4 未配置模型检测
  - 调用 `window.electronAPI.models.getAll()` 检查是否有模型
  - 无模型时 AI 模式按钮 disabled + tooltip

### 验收
- 模式切换流畅，无闪烁
- 切换时输入内容不丢失
- AI 创建成功后正确跳转日历视图

---

## T5：优雅降级

**工时**：0.5 天  
**文件**：修改 `src/main/ipc/index.js`、`AICreatePanel.jsx`

### 子任务

- [ ] T5.1 API 调用失败降级
  - catch 网络/认证/超时错误
  - 返回 `{ success: false, fallback: true, error: '...' }`
  - 前端显示降级提示，自动切换手动模式，预填 parseInput 解析结果

- [ ] T5.2 JSON 解析失败降级
  - 第一次失败：重试（temperature=0）
  - 第二次失败：降级到 parseInput

- [ ] T5.3 降级埋点
  - 记录 `ai_fallback_triggered` 事件

### 验收
- 断网后输入"明天下午开会"，显示降级提示 + parseInput 解析结果
- 错误被正确记录到 usage_logs

---

## T6：对话历史持久化

**工时**：0.5 天  
**文件**：修改 `src/main/ipc/index.js`（ai:chat handler 中）

### 子任务

- [ ] T6.1 对话写入 conversations 表
  - 每次 ai:chat 调用后，写入 user 消息和 assistant 消息
  - metadata 包含 slots、duration_ms、prompt_tokens、completion_tokens

- [ ] T6.2 session_id 生成
  - 格式：`{YYYY-MM-DD}-{uuid前8位}`
  - 同一对话会话复用 session_id

### 验收
- conversations 表有完整的对话记录
- metadata JSON 可正常解析

---

## 工时汇总

| 任务 | 工时 | 依赖 |
|------|------|------|
| T1 LLM 调用服务 | 1d | 无 |
| T2 状态机 | 0.5d | T1 |
| T3 AICreatePanel | 1d | T2 |
| T4 CreateView 集成 | 0.5d | T3 |
| T5 优雅降级 | 0.5d | T1（可并行 T3/T4） |
| T6 对话历史 | 0.5d | T1（可并行 T3/T4） |
| **合计** | **3.5d** | |

---

## 风险提示

| 风险 | 缓解 |
|------|------|
| Prompt 调优可能需要多轮迭代 | 预留 0.5d buffer，优先验证 DeepSeek |
| Anthropic API 格式差异大 | Phase 1 先确保 DeepSeek/OpenAI，Anthropic 可降级 |
| 行内编辑 UI 交互复杂 | 第一版可简化为仅支持优先级下拉 + 文本点击编辑 |
