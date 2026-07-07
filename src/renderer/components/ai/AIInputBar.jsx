import React, { useState, useRef, useCallback, useEffect } from 'react';

export default function AIInputBar({ onSend, disabled, modelName, onExit }) {
  const [input, setInput] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('idle');
  const [voiceDuration, setVoiceDuration] = useState(0);
  const inputRef = useRef(null);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [disabled]);

  const handleSend = () => {
    if (!input.trim() || disabled) return;
    onSend(input.trim());
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 语音录制（复用 CreateView 的逻辑）
  const startRecording = useCallback(async () => {
    try {
      await window.electronAPI?.voice.init();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mrRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
        if (chunksRef.current.length === 0) {
          setVoiceStatus('idle');
          return;
        }
        setVoiceStatus('processing');
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await processAudio(blob);
      };

      mr.start(100);
      setVoiceStatus('recording');
      setVoiceDuration(0);
      timerRef.current = setInterval(() => {
        setVoiceDuration(d => {
          if (d >= 60) { stopRecording(); return d; }
          return d + 1;
        });
      }, 1000);
    } catch (e) {
      console.error('Voice start failed:', e);
      setVoiceStatus('error');
      setTimeout(() => setVoiceStatus('idle'), 2000);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mrRef.current?.state === 'recording') {
      mrRef.current.stop();
    }
  }, []);

  const processAudio = async (blob) => {
    try {
      const arrayBuf = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 8192) {
        chunks.push(String.fromCharCode(...bytes.slice(i, i + 8192)));
      }
      const base64 = btoa(chunks.join(''));
      const result = await window.electronAPI?.voice.transcribe(base64);
      if (result?.text) {
        setVoiceStatus('idle');
        // 转写完成 → 自动发送到 Agent，不回填输入框
        onSend(result.text.trim());
      } else {
        setVoiceStatus('error');
        setTimeout(() => setVoiceStatus('idle'), 2000);
      }
    } catch (e) {
      console.error('Transcribe failed:', e);
      setVoiceStatus('error');
      setTimeout(() => setVoiceStatus('idle'), 2000);
    }
  };

  const handleVoiceClick = () => {
    if (voiceStatus === 'idle') startRecording();
    else if (voiceStatus === 'recording') stopRecording();
  };

  const voiceIcons = { idle: '🎤', recording: '⏹', processing: '⏳', error: '❌' };
  const voiceColors = { idle: 'var(--accent)', recording: '#e94560', processing: '#f59e0b', error: '#e94560' };

  return (
    <div className="ai-input-bar">
      <div className="ai-input-row">
        <button
          className="ai-voice-btn"
          onClick={handleVoiceClick}
          disabled={voiceStatus === 'processing' || disabled}
          style={{ color: voiceColors[voiceStatus] }}
          title={voiceStatus === 'idle' ? '语音输入' : voiceStatus === 'recording' ? '停止录音' : ''}
        >
          <span>{voiceIcons[voiceStatus]}</span>
          {voiceStatus === 'recording' && <span className="ai-voice-duration">{voiceDuration}s</span>}
          {voiceStatus === 'processing' && <span className="ai-voice-label">识别中</span>}
        </button>

        <textarea
          ref={inputRef}
          className="ai-input"
          placeholder={voiceStatus === 'processing' ? '正在识别语音...' : disabled ? 'AI 正在思考...' : '输入回复... (Enter 发送)'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
        />

        <button
          className="ai-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || disabled}
        >
          发送
        </button>
      </div>

      <div className="ai-bar-footer">
        <span className="ai-model-name">AI 模式 · {modelName || '默认模型'}</span>
        <button className="ai-exit-btn" onClick={onExit}>✕ 退出</button>
      </div>

      <style>{`
        .ai-input-bar {
          border-top: 1px solid var(--border-default);
          padding: 10px 12px;
          background: var(--bg-secondary);
        }
        .ai-input-row {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          margin-bottom: 6px;
        }
        .ai-voice-btn {
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          padding: 8px 10px;
          cursor: pointer;
          font-size: 16px;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.2s;
          flex-shrink: 0;
          font-family: inherit;
          color: inherit;
        }
        .ai-voice-btn:hover:not(:disabled) {
          border-color: var(--accent);
        }
        .ai-voice-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .ai-voice-duration {
          font-size: var(--text-xs);
          font-family: monospace;
        }
        .ai-voice-label {
          font-size: var(--text-xs);
        }
        .ai-input {
          flex: 1;
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          padding: 8px 12px;
          font-size: var(--text-base);
          font-family: inherit;
          line-height: 1.5;
          resize: none;
          outline: none;
          min-height: 38px;
          max-height: 100px;
        }
        .ai-input:focus {
          border-color: var(--accent);
        }
        .ai-input:disabled {
          opacity: 0.5;
        }
        .ai-input::placeholder {
          color: var(--text-muted);
          font-size: var(--text-sm);
        }
        .ai-send-btn {
          background: var(--accent);
          color: #000;
          border: none;
          border-radius: var(--radius-md);
          padding: 8px 16px;
          font-size: var(--text-sm);
          font-weight: 500;
          cursor: pointer;
          flex-shrink: 0;
          font-family: inherit;
          transition: opacity 0.15s;
        }
        .ai-send-btn:hover:not(:disabled) {
          opacity: 0.85;
        }
        .ai-send-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .ai-bar-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 6px;
        }
        .ai-model-name {
          font-size: var(--text-xs);
          color: var(--text-muted);
        }
        .ai-exit-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: var(--text-xs);
          padding: 2px 6px;
          font-family: inherit;
          border-radius: var(--radius-sm);
        }
        .ai-exit-btn:hover {
          color: var(--danger);
          background: rgba(233,69,96,0.1);
        }
      `}</style>
    </div>
  );
}
