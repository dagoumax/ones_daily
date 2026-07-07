import React, { useEffect, useRef, useCallback } from 'react';
import useAiStore from '../../stores/aiStore';
import AIChatMessage from './AIChatMessage';
import AIConfirmCard from './AIConfirmCard';
import AIInputBar from './AIInputBar';

/**
 * AI 对话面板 — 纯 Agent/Tool-calling 模式
 *
 * 所有输入直接交给 LLM，由 LLM 自主选择 tool。
 * 无本地预筛、无正则意图分类、无 parseInput 快速路径。
 *
 * 状态机:
 *   IDLE → AGENT_RUNNING → REPLY（文本回复）
 *                         → CONFIRM_CREATE / DELETE / COMPLETE / UPDATE（确认卡片）
 *                         → FALLBACK（API 不可用时降级提示）
 */
export default function AICreatePanel({ onCreated, onCancel }) {
  const {
    messages, isChatting, dialogState,
    pendingConfirmId, confirmToolName, confirmPreview,
    sessionId,
    addMessage, setIsChatting, setDialogState,
    setConfirmState, clearConfirmState,
    setSessionId, resetRoundCount, resetChat,
  } = useAiStore();

  const messagesEndRef = useRef(null);

  // 初始化欢迎消息
  useEffect(() => {
    if (messages.length === 0) {
      addMessage({
        role: 'assistant',
        content: '你好！我是 AI 任务助手。直接告诉我你想做什么，我会自动判断：\n• "明天下午开会" → 创建任务\n• "今天不去健身房了" → 取消任务\n• "项目评审做完了" → 完成任务\n• "今天有什么安排" → 查看任务',
      });
    }
  }, []);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, dialogState]);

  // ── 主入口：所有输入统一走 Agent 循环 ──
  const handleInput = useCallback(async (text) => {
    if (isChatting) return;

    addMessage({ role: 'user', content: text });
    setIsChatting(true);
    setDialogState('AGENT_RUNNING');

    try {
      const response = await window.electronAPI?.ai.chat({
        message: text,
        sessionId: sessionId || undefined,
        history: messages.slice(-10),
      });

      if (!response?.success) {
        handleFallback(response?.error);
        return;
      }

      if (response.sessionId) setSessionId(response.sessionId);
      handleAgentResponse(response);

    } catch (e) {
      console.error('[AICreatePanel] Error:', e);
      handleFallback(e.message);
    } finally {
      setIsChatting(false);
    }
  }, [isChatting, messages, sessionId]);

  // ── 处理 Agent 响应 ──
  const handleAgentResponse = useCallback((response) => {
    switch (response.type) {
      case 'confirm': {
        const stateMap = {
          create_task: 'CONFIRM_CREATE',
          delete_task: 'CONFIRM_DELETE',
          complete_task: 'CONFIRM_COMPLETE',
          update_task: 'CONFIRM_UPDATE',
        };
        let newState = stateMap[response.toolName] || 'REPLY';

        setConfirmState({
          confirmId: response.confirmId,
          toolName: response.toolName,
          preview: response.preview,
        });

        if (response.preview?.candidates) {
          newState = 'CONFIRM_CANDIDATES';
        }
        setDialogState(newState);

        addMessage({
          role: 'assistant',
          content: response.preview?.message || '请确认操作：',
          toolCallType: response.toolName,
        });
        break;
      }

      case 'reply':
        setDialogState('REPLY');
        resetRoundCount();
        addMessage({
          role: 'assistant',
          content: response.content || '好的，已完成。',
        });
        break;

      default:
        setDialogState('REPLY');
        addMessage({ role: 'assistant', content: '收到，还有什么需要帮你的？' });
    }
  }, []);

  // ── API 不可用时降级 ──
  const handleFallback = useCallback((errorMsg) => {
    setDialogState('FALLBACK');
    addMessage({
      role: 'system',
      content: `AI 服务暂时不可用${errorMsg ? `（${errorMsg}）` : ''}。请稍后重试，或切换到手动模式创建任务。`,
    });
  }, []);

  // ── 用户点击确认 ──
  const handleConfirm = useCallback(async (data) => {
    setIsChatting(true);
    setDialogState('AGENT_RUNNING');

    // 规范化 toolArgs：确保 task_id 字段存在（formatTask 返回的是 id 字段）
    const toolArgs = { ...data };
    if (!toolArgs.task_id && toolArgs.id) {
      toolArgs.task_id = toolArgs.id;
    }

    try {
      const response = await window.electronAPI?.ai.chat({
        confirmedToolCall: {
          confirmId: pendingConfirmId,
          toolName: confirmToolName,
          toolArgs,
          action: 'confirm',
        },
      });

      clearConfirmState();

      if (response?.success) {
        if (response.type === 'confirm') {
          handleAgentResponse(response);
        } else {
          setDialogState('REPLY');
          resetRoundCount();
          addMessage({ role: 'system', content: getSuccessMessage(confirmToolName, data) });
          addMessage({ role: 'assistant', content: response?.content || '操作完成。' });
          // 只有创建任务时才跳转到日视图
          if (confirmToolName === 'create_task') {
            setTimeout(() => onCreated?.(), 800);
          }
        }
      } else {
        addMessage({ role: 'system', content: `操作失败: ${response?.error || '未知错误'}` });
        setDialogState('REPLY');
      }
    } catch (e) {
      console.error('[AICreatePanel] Confirm error:', e);
      addMessage({ role: 'system', content: `操作失败: ${e.message}` });
      setDialogState('REPLY');
    } finally {
      setIsChatting(false);
    }
  }, [pendingConfirmId, confirmToolName]);

  // ── 用户取消确认 ──
  const handleCancelConfirm = useCallback(async () => {
    setIsChatting(true);
    try {
      const response = await window.electronAPI?.ai.chat({
        confirmedToolCall: {
          confirmId: pendingConfirmId,
          toolName: confirmToolName,
          toolArgs: {},
          action: 'cancel',
        },
      });
      clearConfirmState();
      setDialogState('REPLY');
      addMessage({ role: 'assistant', content: response?.content || '已取消。还有什么需要帮你的？' });
    } catch (e) {
      clearConfirmState();
      setDialogState('REPLY');
      addMessage({ role: 'assistant', content: '已取消。' });
    } finally {
      setIsChatting(false);
    }
  }, [pendingConfirmId, confirmToolName]);

  // ── 确认状态下的快捷词处理 ──
  const isConfirming = ['CONFIRM_CREATE', 'CONFIRM_DELETE', 'CONFIRM_COMPLETE', 'CONFIRM_UPDATE', 'CONFIRM_CANDIDATES'].includes(dialogState);

  const handleUserInput = useCallback((text) => {
    if (isConfirming) {
      const lower = text.trim();
      if (['好的', '可以', 'ok', '确认', '行', '好'].includes(lower)) {
        const data = confirmPreview?.task_preview || confirmPreview?.task;
        if (data) { handleConfirm(data); return; }
      }
      if (['算了', '不用了', '取消'].includes(lower)) {
        handleCancelConfirm();
        return;
      }
    }
    handleInput(text);
  }, [isConfirming, confirmPreview, handleConfirm, handleCancelConfirm, handleInput]);

  return (
    <div className="ai-create-panel">
      <div className="ai-messages-container">
        {messages.map((msg, i) => (
          <AIChatMessage key={i} message={msg} />
        ))}

        {isConfirming && confirmPreview && (
          <AIConfirmCard
            toolName={confirmToolName}
            preview={confirmPreview}
            onConfirm={handleConfirm}
            onCancel={handleCancelConfirm}
          />
        )}

        {isChatting && (
          <div className="ai-message ai-message-assistant">
            <div className="ai-message-avatar">🤖</div>
            <div className="ai-message-bubble">
              <div className="ai-loading">
                <span className="ai-loading-dot" />
                <span className="ai-loading-dot" />
                <span className="ai-loading-dot" />
                <span className="ai-loading-text">AI 思考中...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <AIInputBar
        onSend={handleUserInput}
        disabled={isChatting}
        modelName="Agent 模式"
        onExit={onCancel}
      />

      <style>{`
        .ai-create-panel { display: flex; flex-direction: column; height: 100%; }
        .ai-messages-container { flex: 1; overflow-y: auto; padding: 16px; padding-bottom: 8px; }
        .ai-loading { display: flex; align-items: center; gap: 6px; padding: 4px 0; }
        .ai-loading-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); animation: aiDotPulse 1.4s infinite; }
        .ai-loading-dot:nth-child(2) { animation-delay: 0.2s; }
        .ai-loading-dot:nth-child(3) { animation-delay: 0.4s; }
        .ai-loading-text { margin-left: 6px; font-size: var(--text-sm); color: var(--text-muted); }
        @keyframes aiDotPulse { 0%,80%,100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}

function getSuccessMessage(toolName, data) {
  switch (toolName) {
    case 'create_task':  return `✅ 任务「${data.title}」已创建成功！`;
    case 'delete_task':  return `🗑 任务「${data.title}」已删除。`;
    case 'complete_task': return `✅ 任务「${data.title}」已标记为完成！`;
    case 'update_task':   return `✏️ 任务已更新。`;
    default:             return '✅ 操作完成。';
  }
}
