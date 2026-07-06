import React from 'react';

export default function AIChatMessage({ message }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  
  return (
    <div className={`ai-message ${isUser ? 'ai-message-user' : isSystem ? 'ai-message-system' : 'ai-message-assistant'}`}>
      <div className="ai-message-avatar">
        {isUser ? '👤' : isSystem ? '⚙' : '🤖'}
      </div>
      <div className="ai-message-bubble">
        <div className="ai-message-content">{message.content}</div>
        {message.intent && message.intent !== 'chat' && (
          <div className="ai-message-meta">意图: {message.intent}</div>
        )}
      </div>
      <style>{`
        .ai-message {
          display: flex;
          gap: 10px;
          margin-bottom: 16px;
          animation: aiMsgIn 0.3s ease;
        }
        .ai-message-user {
          flex-direction: row-reverse;
        }
        .ai-message-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          flex-shrink: 0;
          background: var(--bg-surface);
        }
        .ai-message-bubble {
          max-width: 80%;
          padding: 10px 14px;
          border-radius: var(--radius-lg);
          font-size: var(--text-base);
          line-height: 1.55;
        }
        .ai-message-user .ai-message-bubble {
          background: var(--accent);
          color: #000;
          border-bottom-right-radius: var(--radius-sm);
        }
        .ai-message-assistant .ai-message-bubble {
          background: var(--bg-surface);
          color: var(--text-primary);
          border: 1px solid var(--border-default);
          border-bottom-left-radius: var(--radius-sm);
        }
        .ai-message-system .ai-message-bubble {
          background: transparent;
          color: var(--text-muted);
          font-size: var(--text-sm);
          text-align: center;
          max-width: 100%;
        }
        .ai-message-content {
          white-space: pre-wrap;
          word-break: break-word;
        }
        .ai-message-meta {
          margin-top: 4px;
          font-size: var(--text-xs);
          color: var(--text-muted);
        }
        @keyframes aiMsgIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
