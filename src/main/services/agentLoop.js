/**
 * agentLoop — Agent 循环
 * 
 * 核心循环逻辑：
 * 1. 调用 LLM（带 tools 定义）
 * 2. 如果 LLM 返回 tool_calls → 执行 tool → 注入结果 → 回到步骤 1
 * 3. 如果 LLM 返回自然语言 → 结束循环
 * 4. 如果需要用户确认 → 中断循环，保存状态，返回确认信息
 * 
 * 最大循环轮数：5（防止无限循环和 token 爆炸）
 */

const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../database');
const { callLLMWithTools } = require('./llmService');
const { TOOLS } = require('./agentPrompt');
const { executeToolCall } = require('./toolExecutor');

/**
 * 运行 Agent 循环
 * @param {Object} model - 模型配置对象
 * @param {Array} messages - 初始消息数组 [{role, content}]
 * @param {string} sessionId - 会话 ID
 * @param {Object} options - { maxRounds, temperature }
 * @returns {Object} - { type: 'reply'|'confirm'|'error', ... }
 */
async function agentLoop(model, messages, sessionId, options = {}) {
  const maxRounds = options.maxRounds || 5;
  const db = getDatabase();
  let confirmId = null;

  for (let round = 0; round < maxRounds; round++) {
    console.log(`[AgentLoop] Round ${round + 1}/${maxRounds}`);

    let response;
    try {
      response = await callLLMWithTools(model, messages, {
        temperature: options.temperature ?? 0.1,
        maxTokens: 2048,
        tools: TOOLS,
        tool_choice: 'auto',
      });
    } catch (e) {
      console.error(`[AgentLoop] LLM call failed at round ${round}:`, e.message);
      return {
        type: 'error',
        error: `AI 调用失败: ${e.message}`,
        fallback: true,
        sessionId,
      };
    }

    const choice = response.choices?.[0];
    if (!choice) {
      return {
        type: 'error',
        error: 'AI 返回为空',
        fallback: true,
        sessionId,
      };
    }

    const msg = choice.message;

    // ── 情况 A：无 tool_calls → 最终自然语言回复 ──
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      console.log('[AgentLoop] No tool_calls, returning final reply');
      return {
        type: 'reply',
        content: msg.content || '好的，已完成。',
        messages,
        usage: response.usage || null,
      };
    }

    // ── 情况 B：有 tool_calls → 执行 ──
    console.log(`[AgentLoop] ${msg.tool_calls.length} tool call(s):`,
      msg.tool_calls.map(tc => tc.function.name).join(', '));

    // 将 assistant 消息（含 tool_calls）加入 messages
    messages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: msg.tool_calls,
    });

    for (const tc of msg.tool_calls) {
      console.log(`[AgentLoop] Executing: ${tc.function.name}(${tc.function.arguments})`);

      let toolResult;
      try {
        toolResult = await executeToolCall(tc);
      } catch (e) {
        console.error(`[AgentLoop] Tool execution failed: ${tc.function.name}`, e.message);
        toolResult = {
          success: false,
          error: `工具执行失败: ${e.message}`,
        };
      }

      // ── 需要确认 → 中断循环 ──
      if (toolResult.require_confirmation) {
        confirmId = uuidv4();

        // 保存循环状态到 ai_decisions 表
        try {
          db.run(
            `INSERT INTO ai_decisions (id, scene, input_context, ai_suggestion, user_choice, accepted) 
             VALUES (?, 'agent_confirm', ?, ?, NULL, 0)`,
            [
              confirmId,
              JSON.stringify({ messages, toolCall: tc, sessionId }),
              JSON.stringify(toolResult),
            ]
          );
        } catch (e) {
          console.error('[AgentLoop] Failed to save confirm state:', e.message);
        }

        console.log(`[AgentLoop] Confirmation required, pausing loop. confirmId=${confirmId}`);
        return {
          type: 'confirm',
          toolName: tc.function.name,
          toolArgs: JSON.parse(tc.function.arguments),
          toolResult,
          confirmId,
          messages,  // 保存 messages 用于恢复
          sessionId,
        };
      }

      // ── 不需要确认 → 注入 tool result 到 messages ──
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      });
    }

    // 继续下一轮
  }

  // 超过最大轮数
  console.warn('[AgentLoop] Max rounds exceeded');
  return {
    type: 'reply',
    content: '抱歉，处理步骤过多。请尝试简化你的请求。',
    messages,
    sessionId,
  };
}

/**
 * 恢复被确认中断的 Agent 循环
 * @param {string} confirmId - 确认 ID
 * @param {string} action - 'confirm' | 'cancel'
 * @param {Object} model - 模型配置
 * @returns {Object} - Agent 循环结果
 */
async function resumeAgentLoop(confirmId, action, model) {
  const db = getDatabase();

  // 从 ai_decisions 恢复状态
  let decision = null;
  const stmt = db.prepare("SELECT * FROM ai_decisions WHERE id = ?");
  stmt.bind([confirmId]);
  if (stmt.step()) decision = stmt.getAsObject();
  stmt.free();

  if (!decision) {
    return {
      type: 'error',
      error: '确认会话已过期，请重新操作。',
      fallback: true,
    };
  }

  let state;
  try {
    state = JSON.parse(decision.input_context);
  } catch (e) {
    return {
      type: 'error',
      error: '确认状态数据损坏，请重新操作。',
      fallback: true,
    };
  }

  const { messages, toolCall } = state;

  // 注入用户确认结果
  const confirmResult = {
    success: action === 'confirm',
    confirmed: action === 'confirm',
    cancelled: action === 'cancel',
  };

  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: JSON.stringify(confirmResult),
  });

  // 更新 ai_decisions 记录
  db.run(
    "UPDATE ai_decisions SET user_choice = ?, accepted = ? WHERE id = ?",
    [action, action === 'confirm' ? 1 : 0, confirmId]
  );

  // 继续 Agent 循环
  const result = await agentLoop(model, messages, state.sessionId, {
    maxRounds: 5,  // 恢复后给完整的 5 轮
  });

  return result;
}

module.exports = { agentLoop, resumeAgentLoop };
