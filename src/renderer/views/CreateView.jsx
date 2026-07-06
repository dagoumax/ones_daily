import React, { useState, useRef, useCallback, useEffect } from 'react';
import { parseInput } from '../utils/parseInput';
import AICreatePanel from '../components/ai/AICreatePanel';
import useAiStore from '../stores/aiStore';

const PRIORITY_CONFIG = {
  P0: { label: 'P0 紧急', color: '#e94560', bg: 'rgba(233,69,96,0.15)' },
  P1: { label: 'P1 重要', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  P2: { label: 'P2 普通', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  P3: { label: 'P3 低优', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
};

export default function CreateView({ date, onCreated, onCancel }) {
  const [input, setInput] = useState('');
  const [parsed, setParsed] = useState(null);
  const [priority, setPriority] = useState('P2');
  const [creating, setCreating] = useState(false);
  const [voiceText, setVoiceText] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('idle'); // idle | recording | processing | error
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [chatMode, setChatMode] = useState(false);
  const [hasModels, setHasModels] = useState(true);
  const inputRef = useRef(null);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  const { resetChat } = useAiStore();

  // 检查是否有可用模型
  useEffect(() => {
    (async () => {
      try {
        const models = await window.electronAPI?.models.getAll();
        setHasModels(models && models.length > 0);
      } catch { setHasModels(false); }
    })();
  }, []);

  // 自动聚焦（仅在手动模式）
  useEffect(() => {
    if (!chatMode) {
      inputRef.current?.focus();
    }
  }, [chatMode]);

  // 实时解析
  const handleInputChange = useCallback((e) => {
    const val = e.target.value;
    setInput(val);
    if (val.trim()) {
      const result = parseInput(val);
      setParsed(result);
    } else {
      setParsed(null);
    }
  }, []);

  // 语音文字回填
  useEffect(() => {
    if (voiceText) {
      setInput(prev => prev ? `${prev} ${voiceText}` : voiceText);
      setVoiceText('');
    }
  }, [voiceText]);

  // ── 语音录制 ──────────────────────────────

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
        setVoiceText(result.text.trim());
        setVoiceStatus('idle');
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

  // ── 确认创建 ──────────────────────────────

  const handleCreate = async () => {
    const final = parsed && parsed.title ? parsed : parseInput(input);
    if (!final.title && !input.trim()) return;

    setCreating(true);
    try {
      await window.electronAPI?.tasks.create({
        title: final.title || input.trim(),
        priority: final.priority || priority,
        startTime: final.startTime || (date ? date.toISOString() : new Date().toISOString()),
        endTime: final.endTime || null,
        tags: final.tags || [],
        source: 'quick_create',
      });
      setInput('');
      setParsed(null);
      onCreated?.();
    } catch (e) {
      console.error('Create failed:', e);
    } finally {
      setCreating(false);
    }
  };

  // 快捷键：回车创建，Escape 取消
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCreate();
    } else if (e.key === 'Escape') {
      onCancel?.();
    }
  };

  // ── 渲染 ──────────────────────────────────

  const hasContent = input.trim().length > 0;
  const displayTitle = parsed?.title || input.trim();
  const displayPriority = parsed?.priority || priority;
  const pc = PRIORITY_CONFIG[displayPriority] || PRIORITY_CONFIG.P2;

  const formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    return `${month}月${day}日 周${weekDays[d.getDay()]} ${hour}:${min}`;
  };

  const voiceIcons = { idle: '🎤', recording: '⏹', processing: '⏳', error: '❌' };
  const voiceColors = { idle: 'var(--accent)', recording: '#e94560', processing: '#f59e0b', error: '#e94560' };

  return (
    <div className="create-view">
      {chatMode ? (
        <div className="create-container" style={{ width: '580px', paddingTop: 0 }}>
          <div className="create-header" style={{ marginBottom: 0 }}>
            <div className="mode-switch-bar">
              <button className="mode-switch-btn" onClick={() => { setChatMode(false); resetChat(); }}>
                ✎ 手动模式
              </button>
              <button className="mode-switch-btn active">
                🤖 AI 模式
              </button>
            </div>
          </div>
          <AICreatePanel onCreated={onCreated} onCancel={() => { setChatMode(false); resetChat(); onCancel?.(); }} />
        </div>
      ) : (
      <div className="create-container">
        {/* 标题 + 模式切换 */}
        <div className="create-header">
          <h1>快速创建</h1>
          <span className="create-subtitle">打字或语音，一句话创建事项</span>
          <div className="mode-switch-bar">
            <button className="mode-switch-btn active">
              ✎ 手动模式
            </button>
            <button
              className={`mode-switch-btn ${!hasModels ? 'disabled' : ''}`}
              onClick={() => hasModels && setChatMode(true)}
              title={!hasModels ? '请先在模型管理中配置 AI 模型' : '切换到 AI 智能创建模式'}
              disabled={!hasModels}
            >
              🤖 AI 模式
            </button>
          </div>
        </div>

        {/* 输入区 */}
        <div className="create-input-area">
          <textarea
            ref={inputRef}
            className="create-textarea"
            placeholder={'试试输入：\n"明天下午3点开会讨论项目进度 #P1"\n"后天上午10点去医院体检 #重要"\n"下周五晚上聚餐 2小时"'}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={4}
          />

          {/* 语音按钮 */}
          <button
            className={`create-voice-btn ${voiceStatus === 'recording' ? 'is-recording' : ''}`}
            onClick={handleVoiceClick}
            disabled={voiceStatus === 'processing'}
            style={{ '--voice-color': voiceColors[voiceStatus] }}
            title={voiceStatus === 'idle' ? '语音输入' : voiceStatus === 'recording' ? '停止录音' : ''}
          >
            <span className="voice-icon">{voiceIcons[voiceStatus]}</span>
            <span className="voice-label">
              {voiceStatus === 'idle' ? '语音' :
               voiceStatus === 'recording' ? `${voiceDuration}s` :
               voiceStatus === 'processing' ? '识别中...' : '重试'}
            </span>
          </button>
        </div>

        {/* 解析预览 */}
        {hasContent && (
          <div className="create-preview">
            <div className="preview-header">📋 智能解析预览</div>
            <div className="preview-body">
              {/* 标题 */}
              <div className="preview-row">
                <span className="preview-label">标题</span>
                <span className="preview-value preview-title">
                  {displayTitle || <em className="text-muted">（请输入事项标题）</em>}
                </span>
              </div>

              {/* 时间 */}
              <div className="preview-row">
                <span className="preview-label">时间</span>
                <span className="preview-value">
                  {parsed?.startTime ? (
                    <span className="time-badge">
                      🕐 {formatTime(parsed.startTime)}
                      {parsed.endTime && ` → ${formatTime(parsed.endTime)}`}
                    </span>
                  ) : date ? (
                    <span className="time-badge">
                      🕐 {formatTime(date.toISOString())}（默认日期）
                    </span>
                  ) : (
                    <em className="text-muted">未指定</em>
                  )}
                </span>
              </div>

              {/* 优先级 */}
              <div className="preview-row">
                <span className="preview-label">优先级</span>
                <span className="preview-value">
                  <span className="priority-badge" style={{ background: pc.bg, color: pc.color }}>
                    {pc.label}
                  </span>
                </span>
              </div>

              {/* 标签 */}
              {parsed?.tags?.length > 0 && (
                <div className="preview-row">
                  <span className="preview-label">标签</span>
                  <span className="preview-value">
                    {parsed.tags.map((t, i) => (
                      <span key={i} className="tag-badge">#{t}</span>
                    ))}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="create-actions">
          <button className="btn btn-secondary" onClick={onCancel}>取消</button>
          <button
            className="btn btn-primary btn-create"
            onClick={handleCreate}
            disabled={!hasContent || creating}
          >
            {creating ? '创建中...' : '✓ 确认创建'}
          </button>
        </div>

        {/* 快捷提示 */}
        <div className="create-tips">
          <span>💡 提示：</span>
          输入中可包含 <code>#P1</code> 设置优先级、
          <code>明天下午3点</code> 设置时间、
          <code>#标签名</code> 添加标签
        </div>
      </div>
      )}

      <style>{`
        .create-view {
          height: 100%;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 60px;
          overflow-y: auto;
        }
        .create-container {
          width: 520px;
          max-width: 100%;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .create-header {
          text-align: center;
        }
        .create-header h1 {
          font-size: var(--text-xl);
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 6px;
        }
        .create-subtitle {
          font-size: var(--text-sm);
          color: var(--text-muted);
        }
        .create-input-area {
          position: relative;
        }
        .create-textarea {
          width: 100%;
          padding: 16px;
          padding-right: 56px;
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          color: var(--text-primary);
          font-size: var(--text-base);
          font-family: inherit;
          line-height: 1.6;
          resize: vertical;
          min-height: 110px;
          outline: none;
          transition: border-color 0.2s;
        }
        .create-textarea:focus {
          border-color: var(--accent);
        }
        .create-textarea::placeholder {
          color: var(--text-muted);
          font-size: var(--text-sm);
          line-height: 1.5;
        }
        .create-voice-btn {
          position: absolute;
          right: 12px;
          bottom: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--bg-secondary);
          color: var(--text-secondary);
          cursor: pointer;
          font-size: var(--text-sm);
          font-family: inherit;
          transition: all 0.2s;
        }
        .create-voice-btn:hover {
          border-color: var(--voice-color, var(--accent));
          color: var(--voice-color, var(--accent));
        }
        .create-voice-btn.is-recording {
          border-color: #e94560;
          color: #e94560;
          animation: voice-pulse 1.5s infinite;
        }
        .create-voice-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .voice-icon { font-size: var(--text-lg); }
        .voice-label { font-size: 12px; }

        .create-preview {
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }
        .preview-header {
          padding: 10px 16px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 1px solid var(--border-default);
          background: var(--bg-secondary);
        }
        .preview-body {
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .preview-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .preview-label {
          width: 52px;
          flex-shrink: 0;
          font-size: 12px;
          color: var(--text-muted);
        }
        .preview-value {
          font-size: var(--text-base);
          color: var(--text-primary);
        }
        .preview-title {
          font-weight: 500;
        }
        .text-muted {
          color: var(--text-muted);
          font-style: normal;
        }
        .time-badge {
          font-size: var(--text-sm);
          color: var(--accent);
        }
        .priority-badge {
          display: inline-block;
          padding: 2px 10px;
          border-radius: var(--radius-md);
          font-size: 12px;
          font-weight: 600;
        }
        .tag-badge {
          display: inline-block;
          padding: 2px 8px;
          margin-right: 6px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          font-size: 12px;
          color: var(--text-secondary);
        }
        .create-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        .btn-create {
          min-width: 120px;
        }
        .create-tips {
          text-align: center;
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.6;
        }
        .create-tips code {
          background: var(--bg-surface);
          padding: 1px 6px;
          border-radius: var(--radius-sm);
          font-size: var(--text-xs);
          color: var(--accent);
        }

        /* 模式切换按钮 */
        .mode-switch-bar {
          display: flex;
          gap: 0;
          margin-top: 10px;
          background: var(--bg-surface);
          border-radius: var(--radius-md);
          padding: 3px;
          border: 1px solid var(--border-default);
        }
        .mode-switch-btn {
          flex: 1;
          padding: 6px 12px;
          border: none;
          background: transparent;
          color: var(--text-secondary);
          font-size: var(--text-sm);
          font-family: inherit;
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: all 0.15s;
        }
        .mode-switch-btn:hover:not(.disabled):not(.active) {
          color: var(--text-primary);
          background: var(--bg-elevated);
        }
        .mode-switch-btn.active {
          background: var(--accent);
          color: #000;
          font-weight: 500;
        }
        .mode-switch-btn.disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        @keyframes voice-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(233,69,96,0.3); }
          50% { box-shadow: 0 0 0 8px rgba(233,69,96,0); }
        }
      `}</style>
    </div>
  );
}
