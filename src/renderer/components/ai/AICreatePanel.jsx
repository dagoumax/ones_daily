import React, { useEffect, useRef, useCallback } from 'react';
import useAiStore from '../../stores/aiStore';
import AIChatMessage from './AIChatMessage';
import AIConfirmCard from './AIConfirmCard';
import AIInputBar from './AIInputBar';

/**
 * AI 对话面板 — Agent/Tool-calling 模式
 * 
 * 状态机:
 *   IDLE → CHECKING → AGENT_RUNNING → REPLY（文本回复）
 *                                    → CONFIRM_CREATE（创建确认卡片）
 *                                    → CONFIRM_DELETE（删除确认卡片）
 *                                    → CONFIRM_COMPLETE（完成确认卡片）
 *                                    → CONFIRM_UPDATE（更新确认卡片）
 *                                    → FALLBACK（降级本地解析）
 */
export default function AICreatePanel({ onCreated, onCancel }) {
  const {
    messages, isChatting, dialogState,
    pendingConfirmId, confirmToolName, confirmPreview,
    sessionId, roundCount,
    addMessage, setIsChatting, setDialogState,
    setConfirmState, clearConfirmState,
    setSessionId, incrementRound, resetRoundCount, resetChat,
    // 兼容旧模式
    setPendingSlots, setMissingSlots,
  } = useAiStore();

  const messagesEndRef = useRef(null);

  // 初始化欢迎消息
  useEffect(() => {
    if (messages.length === 0) {
      addMessage({
        role: 'assistant',
        content: '你好！我是 AI 任务助手。你可以直接告诉我：\n• "明天下午开会" — 创建任务\n• "今天不去健身房了" — 取消任务\n• "项目评审做完了" — 完成任务\n• "今天有什么安排" — 查看任务',
      });
    }
  }, []);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, dialogState]);

  // ── 主入口：处理用户输入 ──
  const handleInput = useCallback(async (text) => {
    if (isChatting) return;

    addMessage({ role: 'user', content: text });
    setIsChatting(true);
    setDialogState('CHECKING');

    try {
      // 1. 本地预筛（保留 parseInput.js，快速路径）
      const { parseInput } = await import('../../utils/parseInput');
      const parsed = parseInput(text);
      const isValidTitle = parsed.title && parsed.title.length >= 2 && !/^[\s\d\p{P}]+$/u.test(parsed.title);
      const isValidTime = parsed.startTime && new Date(parsed.startTime) > new Date();

      if (isValidTitle && isValidTime) {
        // 本地命中 → 直接走创建确认
        const taskPreview = {
          title: parsed.title,
          start_time: parsed.startTime,
          end_time: parsed.endTime || null,
          priority: parsed.priority || 'P2',
          tags: parsed.tags || [],
          location: '',
          notes: '',
        };
        setConfirmState({
          confirmId: null,
          toolName: 'create_task',
          preview: { task_preview: taskPreview, message: `即将创建任务「${parsed.title}」` },
        });
        setDialogState('CONFIRM_CREATE');
        addMessage({ role: 'assistant', content: '已解析任务信息，请确认：', toolCallType: 'create_task' });
        setIsChatting(false);
        return;
      }

      if (isValidTitle && !isValidTime) {
        addMessage({ role: 'assistant', content: `好的，已记录「${parsed.title}」。请问具体什么时间？` });
        setPendingSlots({ title: parsed.title, priority: parsed.priority || 'P2', tags: parsed.tags || [] });
        setMissingSlots(['startTime']);
        setDialogState('REPLY');
        setIsChatting(false);
        return;
      }

      // 2. 本地未命中 → 走 Agent 循环
      setDialogState('AGENT_RUNNING');
      const response = await window.electronAPI?.ai.chat({
        message: text,
        sessionId: sessionId || undefined,
        history: messages.slice(-10),
      });

      if (!response?.success) {
        handleFallback(text, response?.error);
        return;
      }

      if (response.sessionId) setSessionId(response.sessionId);

      // 3. 处理 Agent 响应
      handleAgentResponse(response, text);

    } catch (e) {
      console.error('[AICreatePanel] Error:', e);
      handleFallback(text, e.message);
    } finally {
      setIsChatting(false);
    }
  }, [isChatting, messages, sessionId]);

  // ── 处理 Agent 循环响应 ──
  const handleAgentResponse = useCallback((response, originalText) => {
    switch (response.type) {
      case 'confirm': {
        // 需要确认的操作
        const stateMap = {
          create_task: 'CONFIRM_CREATE',
          delete_task: 'CONFIRM_DELETE',
          complete_task: 'CONFIRM_COMPLETE',
          update_task: 'CONFIRM_UPDATE',
        };
        const newState = stateMap[response.toolName] || 'REPLY';

        setConfirmState({
          confirmId: response.confirmId,
          toolName: response.toolName,
          preview: response.preview,
        });
        setDialogState(newState);

        // 如果有候选列表 → CONFIRM_CANDIDATES
        if (response.preview?.candidates) {
          setDialogState('CONFIRM_CANDIDATES');
        }

        addMessage({
          role: 'assistant',
          content: response.preview?.message || '请确认操作：',
          toolCallType: response.toolName,
        });
        break;
      }

      case 'reply': {
        setDialogState('REPLY');
        resetRoundCount();
        addMessage({
          role: 'assistant',
          content: response.content || '好的，已完成。',
        });
        break;
      }

      default: {
        setDialogState('REPLY');
        addMessage({
          role: 'assistant',
          content: '收到，还有什么需要帮你的？',
        });
      }
    }
  }, []);

  // ── 降级处理 ──
  const handleFallback = useCallback(async (text, errorMsg) => {
    setDialogState('FALLBACK');
    const { parseInput } = await import('../../utils/parseInput');
    const parsed = parseInput(text);

    addMessage({
      role: 'system',
      content: `AI 服务暂时不可用${errorMsg ? `（${errorMsg}）` : ''}，已切换到本地解析模式。`,
    });

    if (parsed.title) {
      await createTaskDirectly({
        title: parsed.title,
        startTime: parsed.startTime || new Date().toISOString(),
        endTime: parsed.endTime || null,
        priority: parsed.priority || 'P2',
        tags: parsed.tags || [],
      });
    } else {
      addMessage({ role: 'assistant', content: '无法解析输入，请手动填写任务信息或稍后重试。' });
      setTimeout(() => onCancel?.(), 3000);
    }
  }, []);

  // ── 确认操作（用户点击确认按钮）──
  const handleConfirm = useCallback(async (data) => {
    setIsChatting(true);

    try {
      if (!pendingConfirmId) {
        // 本地预筛路径：直接创建
        await createTaskDirectly({
          title: data.title,
          startTime: data.start_time || data.startTime,
          endTime: data.end_time || data.endTime,
          priority: data.priority || 'P2',
          tags: data.tags || [],
          location: data.location || '',
          notes: data.notes || '',
        });
        return;
      }

      // Agent 路径：发送确认回调
      setDialogState('AGENT_RUNNING');
      const response = await window.electronAPI?.ai.chat({
        confirmedToolCall: {
          confirmId: pendingConfirmId,
          toolName: confirmToolName,
          toolArgs: data,
          action: 'confirm',
        },
      });

      clearConfirmState();

      if (response?.success) {
        if (response.type === 'confirm') {
          // Agent 返回了新的确认（罕见：删除后 LLM 可能建议创建替代任务）
          handleAgentResponse(response);
        } else {
          // 操作完成
          setDialogState('REPLY');
          resetRoundCount();
          addMessage({
            role: 'system',
            content: getSuccessMessage(confirmToolName, data),
          });
          addMessage({
            role: 'assistant',
            content: response?.content || '操作完成。还有什么需要帮你的？',
          });
          setTimeout(() => onCreated?.(), 800);
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

  // ── 取消确认 ──
  const handleCancelConfirm = useCallback(async () => {
    if (pendingConfirmId) {
      // Agent 路径：发送取消回调
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
        addMessage({
          role: 'assistant',
          content: response?.content || '已取消操作。还有什么需要帮你的？',
        });
      } catch (e) {
        clearConfirmState();
        setDialogState('REPLY');
        addMessage({ role: 'assistant', content: '已取消。' });
      } finally {
        setIsChatting(false);
      }
    } else {
      // 本地预筛路径
      clearConfirmState();
      resetChat();
      addMessage({ role: 'assistant', content: '已取消。还有什么我可以帮你的？' });
    }
  }, [pendingConfirmId, confirmToolName]);

  // ── 直接创建任务（本地预筛 / 降级路径）──
  const createTaskDirectly = async (task) => {
    try {
      await window.electronAPI?.tasks.create({
        title: task.title,
        priority: task.priority || 'P2',
        startTime: task.startTime,
        endTime: task.endTime || null,
        tags: task.tags || [],
        participants: [],
        location: task.location || '',
        description: task.notes || '',
        source: 'ai_create',
      });

      addMessage({ role: 'system', content: `✅ 任务「${task.title}」已创建成功！` });
      setDialogState('REPLY');
      resetRoundCount();
      setTimeout(() => onCreated?.(), 800);
    } catch (e) {
      addMessage({ role: 'system', content: `创建失败: ${e.message}。请重试。` });
    }
  };

  // ── 3 轮追问保护 ──
  useEffect(() => {
    if (roundCount >= 3) {
      handleFallback('', '已超过 3 轮追问');
    }
  }, [roundCount]);

  // ── 判断是否在确认状态 ──
  const isConfirming = ['CONFIRM_CREATE', 'CONFIRM_DELETE', 'CONFIRM_COMPLETE', 'CONFIRM_UPDATE', 'CONFIRM_CANDIDATES'].includes(dialogState);

  // 确认状态下的用户输入处理（简化：直接走 Agent）
  const handleConfirmInput = useCallback((text) => {
    const lower = text.trim();
    // 快捷确认/取消词
    if (['好的', '可以', 'ok', '确认', '行', '好'].includes(lower)) {
      if (confirmPreview?.task_preview) {
        handleConfirm(confirmPreview.task_preview);
      } else if (confirmPreview?.task) {
        handleConfirm(confirmPreview.task);
      }
      return;
    }
    if (['算了', '不用了', '取消'].includes(lower)) {
      handleCancelConfirm();
      return;
    }
    // 否则当作新对话
    handleInput(text);
  }, [confirmPreview, handleConfirm, handleCancelConfirm, handleInput]);

  const handleUserInput = useCallback((text) => {
    if (isConfirming) {
      handleConfirmInput(text);
    } else {
      handleInput(text);
    }
  }, [isConfirming, handleConfirmInput, handleInput]);

  return (
    <div className="ai-create-panel">
      <div className="ai-messages-container">
        {messages.map((msg, i) => (
          <AIChatMessage key={i} message={msg} />
        ))}

        {/* 确认卡片 */}
        {isConfirming && confirmPreview && (
          <AIConfirmCard
            toolName={confirmToolName === 'create_task' && !pendingConfirmId ? 'create_task'
              : confirmToolName === 'delete_task' ? (confirmPreview.candidates ? 'delete_task' : 'delete_task')
              : confirmToolName === 'complete_task' ? (confirmPreview.candidates ? 'complete_task' : 'complete_task')
              : confirmToolName}
            preview={confirmPreview}
            onConfirm={handleConfirm}
            onCancel={handleCancelConfirm}
          />
        )}

        {/* Loading */}
        {isChatting && (
          <div className="ai-message ai-message-assistant">
            <div className="ai-message-avatar">🤖</div>
            <div className="ai-message-bubble">
              <div className="ai-loading">
                <span className="ai-loading-dot" />
                <span className="ai-loading-dot" />
                <span className="ai-loading-dot" />
                <span className="ai-loading-text">
                  {dialogState === 'CHECKING' ? '解析中...'
                    : dialogState === 'AGENT_RUNNING' ? 'AI 思考中...'
                    : '处理中...'}
                </span>
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
        .ai-create-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .ai-messages-container {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          padding-bottom: 8px;
        }
        .ai-loading {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 0;
        }
        .ai-loading-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-muted);
          animation: aiDotPulse 1.4s infinite;
        }
        .ai-loading-dot:nth-child(2) { animation-delay: 0.2s; }
        .ai-loading-dot:nth-child(3) { animation-delay: 0.4s; }
        .ai-loading-text {
          margin-left: 6px;
          font-size: var(--text-sm);
          color: var(--text-muted);
        }
        @keyframes aiDotPulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── 辅助 ──
function getSuccessMessage(toolName, data) {
  switch (toolName) {
    case 'create_task':
      return `✅ 任务「${data.title}」已创建成功！`;
    case 'delete_task':
      return `🗑 任务「${data.title}」已删除。`;
    case 'complete_task':
      return `✅ 任务「${data.title}」已标记为完成！`;
    case 'update_task':
      return `✏️ 任务已更新。`;
    default:
      return '✅ 操作完成。';
  }
}
