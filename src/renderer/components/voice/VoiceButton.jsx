import React, { useState, useRef, useEffect, useCallback } from 'react';

const MAX_DURATION = 60; // 秒

export default function VoiceButton({ onTaskCreated }) {
  const [status, setStatus] = useState('idle'); // idle|recording|processing|done|error
  const [duration, setDuration] = useState(0);
  const [bars, setBars] = useState([]);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const animRef = useRef(null);
  const streamRef = useRef(null);

  // 快捷键触发
  useEffect(() => {
    const handler = () => {
      // 使用 ref 避免闭包过期
      if (mediaRecorderRef.current?.state === 'inactive' || !mediaRecorderRef.current) {
        startRecordingRef.current?.();
      }
    };
    window.electronAPI?.on('shortcut:voice-record', handler);
    return () => window.electronAPI?.removeListener('shortcut:voice-record', handler);
  }, []); // 只注册一次

  const startRecordingRef = useRef(null);

  const startRecording = useCallback(async () => {
    try {
      // 先初始化 whisper（如果还没初始化）
      await window.electronAPI?.voice.init();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Try WAV first, fall back to webm
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/wav')) mimeType = 'audio/wav';
      else if (MediaRecorder.isTypeSupported('audio/webm;codecs=pcm')) mimeType = 'audio/webm;codecs=pcm';
      const mr = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
        cancelAnimationFrame(animRef.current);
        setBars([]);
        if (chunksRef.current.length === 0) {
          setStatus('idle');
          return;
        }
        setStatus('processing');
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await processAudio(blob);
      };

      mr.start(100); // 每100ms一片
      setStatus('recording');
      setDuration(0);
      timerRef.current = setInterval(() => {
        setDuration(d => {
          if (d >= MAX_DURATION) { stopRecording(); return d; }
          return d + 1;
        });
      }, 1000);

      // 波形动画
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const animate = () => {
        analyser.getByteFrequencyData(buf);
        setBars(Array.from(buf.slice(0, 16)).map(v => v / 255));
        animRef.current = requestAnimationFrame(animate);
      };
      animate();
    } catch (e) {
      console.error('Voice start failed:', e);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  }, []);

  // 保持 ref 同步
  startRecordingRef.current = startRecording;

  const stopRecording = () => {
    mediaRecorderRef.current?.state === 'recording' && mediaRecorderRef.current?.stop();
  };

  const processAudio = async (blob) => {
    try {
      // Decode webm/opus to PCM using Web Audio API
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const arrayBuf = await blob.arrayBuffer();
      const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
      audioCtx.close();

      // Convert to 16-bit PCM mono 16kHz
      const pcmData = audioBuf.getChannelData(0); // mono
      const wavBuf = buildWav(pcmData, 16000);

      // Convert to base64 in chunks
      const bytes = new Uint8Array(wavBuf);
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 8192) {
        chunks.push(String.fromCharCode(...bytes.slice(i, i + 8192)));
      }
      const base64 = btoa(chunks.join(''));
      const result = await window.electronAPI?.voice.transcribe(base64);
      if (result?.text) {
        await window.electronAPI?.tasks.create({
          title: result.text.trim(),
          priority: 'P2',
          source: 'voice',
          startTime: new Date().toISOString(),
        });
        onTaskCreated?.();
        setStatus('done');
      } else {
        setStatus('error');
      }
    } catch (e) {
      console.error('Transcribe failed:', e);
      setStatus('error');
    }
    setTimeout(() => setStatus('idle'), 2000);
  };

  const handleClick = () => {
    if (status === 'idle') startRecording();
    else if (status === 'recording') stopRecording();
  };

  const statusStyles = {
    idle: {},
    recording: { background: '#e94560', animation: 'pulse 1.5s infinite' },
    processing: { background: '#f59e0b' },
    done: { background: '#4ade80' },
    error: { background: '#e94560' },
  };

  const icons = { idle: '🎤', recording: '⏹', processing: '⏳', done: '✅', error: '❌' };

  return (
    <div className="voice-wrapper">
      {/* 波形 */}
      {status === 'recording' && bars.length > 0 && (
        <div className="voice-waveform">
          {bars.map((h, i) => (
            <div key={i} className="voice-bar" style={{ height: `${Math.max(4, h * 40)}px` }} />
          ))}
        </div>
      )}

      {/* 计时 */}
      {status === 'recording' && (
        <div className="voice-timer">{duration}s / {MAX_DURATION}s</div>
      )}

      {/* 按钮 */}
      <button
        className="voice-button"
        onClick={handleClick}
        style={statusStyles[status]}
        title={status === 'idle' ? '语音创建事项 (Ctrl+Shift+V)' : status === 'recording' ? '停止录音' : ''}
      >
        {icons[status]}
      </button>

      <style>{`
        .voice-wrapper { position: fixed; bottom: 24px; right: 24px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; z-index: 200; }
        .voice-button {
          width: 48px; height: 48px; border-radius: 50%; border: none;
          background: var(--accent); color: #000; font-size: 20px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3); transition: all 0.2s ease;
        }
        .voice-button:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
        .voice-waveform { display: flex; align-items: flex-end; gap: 3px; padding: 8px 12px; background: var(--bg-surface); border-radius: 8px; }
        .voice-bar { width: 4px; background: var(--danger); border-radius: 2px; transition: height 0.1s ease; min-height: 4px; }
        .voice-timer { font-size: 12px; color: var(--text-secondary); background: var(--bg-surface); padding: 4px 10px; border-radius: 6px; }
        @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(233,69,96,0.4); } 50% { box-shadow: 0 0 0 12px rgba(233,69,96,0); } }
      `}</style>
    </div>
  );
}

function buildWav(samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  return buf;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
