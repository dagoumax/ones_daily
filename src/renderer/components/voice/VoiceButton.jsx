import React, { useState } from 'react';

export default function VoiceButton() {
  const [status, setStatus] = useState('idle'); // idle | recording | processing | done | error

  const handleClick = () => {
    if (status === 'idle') {
      setStatus('recording');
      // M3 阶段实现实际录音逻辑
      setTimeout(() => setStatus('processing'), 2000);
      setTimeout(() => setStatus('done'), 3500);
      setTimeout(() => setStatus('idle'), 5000);
    }
  };

  const statusStyles = {
    idle: {},
    recording: { background: '#e94560', animation: 'pulse 1.5s infinite' },
    processing: { background: '#f59e0b' },
    done: { background: '#4ade80' },
    error: { background: '#e94560' },
  };

  return (
    <button
      className="voice-button"
      onClick={handleClick}
      style={statusStyles[status]}
      title="语音创建事项 (Ctrl+Shift+V)"
    >
      {status === 'idle' && '🎤'}
      {status === 'recording' && '🔴'}
      {status === 'processing' && '⏳'}
      {status === 'done' && '✅'}
      {status === 'error' && '❌'}

      <style jsx>{`
        .voice-button {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: none;
          background: var(--accent);
          color: #000;
          font-size: 20px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
          transition: all 0.2s ease;
          z-index: 200;
        }
        .voice-button:hover {
          transform: scale(1.1);
          box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(233, 69, 96, 0.4); }
          50% { box-shadow: 0 0 0 12px rgba(233, 69, 96, 0); }
        }
      `}</style>
    </button>
  );
}
