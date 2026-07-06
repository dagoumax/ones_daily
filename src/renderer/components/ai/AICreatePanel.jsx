import React, { useEffect, useRef, useCallback } from 'react';
import useAiStore from '../../stores/aiStore';
import AIChatMessage from './AIChatMessage';
import AIConfirmCard from './AIConfirmCard';
import AIInputBar from './AIInputBar';

export default function AICreatePanel({ onCreated, onCancel }) {
  const {
    messages, isChatting, dialogState, pendingSlots, sessionId, roundCount,
    addMessage, setIsChatting, setDialogState, setPendingSlots, setMissingSlots,
    setSessionId, incrementRound, resetRoundCount, resetChat,
  } = useAiStore();

  const messagesEndRef = useRef(null);

  // 初始化欢迎消息
  useEffect(() => {
    if (messages.length === 0) {
      addMessage({
        role: 'assistant',
        content: '你好！我是 AI 任务助手。直接告诉我你想做什么，比如"明天下午开会讨论项目"或"帮我记一下买牛奶"。',
      });
    }
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 处理用户发送消息
  const handleSend = useCallback(async (text) => {
    if (isChatting) return;

    // 添加用户消息
    addMessage({ role: 'user', content: text });
    setIsChatting(true);
    setDialogState('CHECKING');

    try {
      // 1. 本地预筛
      const { parseInput } = await import('../../utils/parseInput');
      const parsed = parseInput(text);

      const isValidTitle = parsed.title && parsed.title.length >= 2 && !/^[\s\d\p{P}]+$/u.test(parsed.title);
      const isValidTime = parsed.startTime && new Date(parsed.startTime) > new Date();

      if (isValidTitle && isValidTime) {
        // 本地预筛命中：直接创建
        await createTaskFromSlots({
          title: parsed.title,
          startTime: parsed.startTime,
          endTime: parsed.endTime || null,
          priority: parsed.priority || 'P2',
          tags: parsed.tags || [],
        });
        return;
      }

      if (isValidTitle && !isValidTime) {
        // 只有标题，追问时间
        addMessage({
          role: 'assistant',
          content: `好的，已记录"${parsed.title}"。请问具体什么时间？`,
        });
        setPendingSlots({ title: parsed.title, priority: parsed.priority || 'P2', tags: parsed.tags || [] });
        setMissingSlots(['startTime']);
        setDialogState('WAITING');
        setIsChatting(false);
        return;
      }

      if (!isValidTitle && isValidTime) {
        // 只有时间，追问标题
        addMessage({
          role: 'assistant',
          content: '请问要做什么？',
        });
        setPendingSlots({ startTime: parsed.startTime, priority: parsed.priority || 'P2', tags: parsed.tags || [] });
        setMissingSlots(['title']);
        setDialogState('WAITING');
        setIsChatting(false);
        return;
      }

      // 2. 本地预筛未命中，调用 LLM
      setDialogState('LLM_CALL');
      const currentPendingSlots = useAiStore.getState().pendingSlots;

      const response = await window.electronAPI?.ai.chat({
        message: text,
        sessionId: sessionId || undefined,
        history: messages.slice(-6), // 最近 6 条消息作为上下文
        existingSlots: Object.keys(currentPendingSlots).length > 0 ? currentPendingSlots : undefined,
      });

      if (!response?.success) {
        // LLM 调用失败，降级
        handleFallback(text, response?.error);
        return;
      }

      // 保存 sessionId
      if (response.sessionId) {
        setSessionId(response.sessionId);
      }

      const { intent, slots, missingFields, followUpQuestion, reply, confirmCard } = response;

      if (confirmCard && slots) {
        // 槽位完整，展示确认卡片
        setPendingSlots(slots);
        setDialogState('CONFIRM');
        addMessage({
          role: 'assistant',
          content: reply || '已解析任务信息，请确认：',
          slots,
          confirmCard: true,
        });
        resetRoundCount();
      } else if (missingFields && missingFields.length > 0) {
        // 信息不足，追问
        setPendingSlots(slots || {});
        setMissingSlots(missingFields);
        setDialogState('WAITING');
        incrementRound();
        addMessage({
          role: 'assistant',
          content: followUpQuestion || reply || `请补充以下信息：${missingFields.join('、')}`,
          slots,
        });
      } else {
        // 非 create_task 意图
        setDialogState('IDLE');
        addMessage({
          role: 'assistant',
          content: reply || '此功能将在后续版本支持。现在可以试试创建任务，比如"明天下午3点开会"。',
          intent,
        });
        resetRoundCount();
      }

    } catch (e) {
      console.error('AI chat error:', e);
      handleFallback(text, e.message);
    } finally {
      setIsChatting(false);
    }
  }, [isChatting, messages, sessionId]);

  // 降级处理
  const handleFallback = useCallback(async (text, errorMsg) => {
    setDialogState('FALLBACK');
    const { parseInput } = await import('../../utils/parseInput');
    const parsed = parseInput(text);

    addMessage({
      role: 'system',
      content: `AI 服务暂时不可用${errorMsg ? `（${errorMsg}）` : ''}，已切换到本地解析模式。`,
    });

    if (parsed.title) {
      await createTaskFromSlots({
        title: parsed.title,
        startTime: parsed.startTime || new Date().toISOString(),
        endTime: parsed.endTime || null,
        priority: parsed.priority || 'P2',
        tags: parsed.tags || [],
      });
    } else {
      addMessage({
        role: 'assistant',
        content: '无法解析输入，请手动填写任务信息或稍后重试。',
      });
      // 3 秒后自动退出 AI 模式
      setTimeout(() => onCancel?.(), 3000);
    }
  }, []);

  // 确认创建任务
  const handleConfirm = useCallback(async (slots) => {
    setIsChatting(true);
    setDialogState('CREATING');
    await createTaskFromSlots(slots);
  }, []);

  // 行内编辑
  const handleEdit = useCallback((updatedSlots) => {
    setPendingSlots(updatedSlots);
  }, []);

  // 自然语言修改
  const handleNaturalEdit = useCallback(async (text) => {
    // 作为普通消息处理，但不计入追问轮数
    addMessage({ role: 'user', content: text });
    setIsChatting(true);
    setDialogState('LLM_CALL');

    try {
      const currentSlots = useAiStore.getState().pendingSlots;
      const response = await window.electronAPI?.ai.chat({
        message: text,
        sessionId,
        existingSlots: currentSlots,
      });

      if (response?.success && response.slots) {
        setPendingSlots(response.slots);
        setDialogState('CONFIRM');
        addMessage({
          role: 'assistant',
          content: '已更新，请确认：',
          slots: response.slots,
          confirmCard: true,
        });
      }
    } catch (e) {
      addMessage({
        role: 'system',
        content: `修改失败: ${e.message}`,
      });
    } finally {
      setIsChatting(false);
    }
  }, [sessionId]);

  // 取消确认
  const handleCancelConfirm = useCallback(() => {
    resetChat();
    addMessage({
      role: 'assistant',
      content: '已取消。还有什么我可以帮你的？',
    });
  }, []);

  // 创建任务
  const createTaskFromSlots = async (slots) => {
    try {
      await window.electronAPI?.tasks.create({
        title: slots.title,
        priority: slots.priority || 'P2',
        startTime: slots.startTime,
        endTime: slots.endTime || null,
        tags: slots.tags || [],
        participants: slots.participants || [],
        location: slots.location || '',
        description: slots.notes || '',
        source: 'ai_create',
      });

      addMessage({
        role: 'system',
        content: `✅ 任务"${slots.title}"已创建成功！`,
      });

      setDialogState('IDLE');
      resetRoundCount();
      setIsChatting(false);

      // 通知父组件
      setTimeout(() => onCreated?.(), 800);
    } catch (e) {
      addMessage({
        role: 'system',
        content: `创建失败: ${e.message}。请重试。`,
      });
      setIsChatting(false);
    }
  };

  // 检查是否超过 3 轮追问
  useEffect(() => {
    if (roundCount >= 3 && dialogState === 'WAITING') {
      handleFallback('', '已超过 3 轮追问');
    }
  }, [roundCount, dialogState]);

  // 判断确认卡片中的用户回复：是修改还是确认/取消
  const processConfirmReply = useCallback((text) => {
    const lower = text.toLowerCase().trim();
    if (lower === '好的' || lower === '可以' || lower === 'ok' || lower === '确认' || lower === '行' || lower === '好') {
      const slots = useAiStore.getState().pendingSlots;
      if (slots && slots.title) {
        handleConfirm(slots);
        return true;
      }
    }
    if (lower === '算了' || lower === '不用了' || lower === '取消') {
      handleCancelConfirm();
      return true;
    }
    // 自然语言修改（包含"改"字或直接输入新值）
    if (lower.includes('改成') || lower.includes('改为') || lower.includes('换成')) {
      handleNaturalEdit(text);
      return true;
    }
    return false; // 不是确认/取消/修改
  }, [handleConfirm, handleCancelConfirm, handleNaturalEdit]);

  // 包装 handleSend，在 CONFIRM 状态时先检查
  const handleInput = useCallback((text) => {
    if (dialogState === 'CONFIRM') {
      const handled = processConfirmReply(text);
      if (handled) return;
    }
    handleSend(text);
  }, [dialogState, processConfirmReply, handleSend]);

  // 查找最后一条 confirmCard 消息
  const lastConfirmMsg = [...messages].reverse().find(m => m.confirmCard);

  return (
    <div className="ai-create-panel">
      <div className="ai-messages-container">
        {messages.map((msg, i) => (
          <AIChatMessage key={i} message={msg} />
        ))}

        {/* 确认卡片（在最后一条 confirmCard 消息后） */}
        {dialogState === 'CONFIRM' && lastConfirmMsg?.slots && (
          <AIConfirmCard
            slots={lastConfirmMsg.slots}
            onConfirm={handleConfirm}
            onCancel={handleCancelConfirm}
            onEdit={handleEdit}
          />
        )}

        {/* Loading 状态 */}
        {isChatting && (
          <div className="ai-message ai-message-assistant">
            <div className="ai-message-avatar">🤖</div>
            <div className="ai-message-bubble">
              <div className="ai-loading">
                <span className="ai-loading-dot" />
                <span className="ai-loading-dot" />
                <span className="ai-loading-dot" />
                <span className="ai-loading-text">
                  {dialogState === 'CHECKING' ? '解析中...' : 'AI 思考中...'}
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <AIInputBar
        onSend={handleInput}
        disabled={isChatting}
        modelName="默认模型"
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
