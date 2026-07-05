import React, { useState } from 'react';

export default function TaskForm({ onSubmit, onClose, initialData }) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [priority, setPriority] = useState(initialData?.priority || 'P2');
  const [startTime, setStartTime] = useState(initialData?.start_time?.slice(0, 16) || '');
  const [endTime, setEndTime] = useState(initialData?.end_time?.slice(0, 16) || '');
  const [description, setDescription] = useState(initialData?.description || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      priority,
      startTime: startTime ? new Date(startTime).toISOString() : null,
      endTime: endTime ? new Date(endTime).toISOString() : null,
      description,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="task-form" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3>新建事项</h3>

        <input
          className="input"
          placeholder="事项标题"
          value={title}
          onChange={e => setTitle(e.target.value)}
          autoFocus
        />

        <div className="form-row">
          <label>优先级</label>
          <select className="input" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="P0">🔴 P0 紧急</option>
            <option value="P1">🟠 P1 重要</option>
            <option value="P2">🔵 P2 普通</option>
            <option value="P3">⚪ P3 低优</option>
          </select>
        </div>

        <div className="form-row">
          <label>开始时间</label>
          <input className="input" type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} />
        </div>

        <div className="form-row">
          <label>结束时间</label>
          <input className="input" type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>

        <textarea
          className="input"
          placeholder="备注（可选）"
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
        />

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="btn btn-primary">创建</button>
        </div>
      </form>

      <style jsx>{`
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center; z-index: 500;
        }
        .task-form {
          background: var(--bg-secondary); border-radius: 12px; padding: 24px;
          width: 420px; max-width: 90vw; display: flex; flex-direction: column; gap: 14px;
          border: 1px solid var(--border-default);
        }
        .task-form h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
        .form-row { display: flex; align-items: center; gap: 10px; }
        .form-row label { width: 64px; font-size: 13px; color: var(--text-secondary); flex-shrink: 0; }
        .form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
        textarea.input { resize: vertical; min-height: 60px; }
      `}</style>
    </div>
  );
}
