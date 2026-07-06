import React, { useState } from 'react';

const PRIORITY_CONFIG = {
  P0: { label: 'P0 紧急', color: '#e94560' },
  P1: { label: 'P1 重要', color: '#f59e0b' },
  P2: { label: 'P2 普通', color: '#3b82f6' },
  P3: { label: 'P3 低优', color: '#6b7280' },
};

export default function AIConfirmCard({ slots, onConfirm, onCancel, onEdit }) {
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [localSlots, setLocalSlots] = useState(slots);

  const startEdit = (field, currentValue) => {
    setEditingField(field);
    setEditValue(currentValue || '');
  };

  const confirmEdit = () => {
    if (editingField) {
      const updated = { ...localSlots, [editingField]: editValue };
      setLocalSlots(updated);
      onEdit?.(updated);
    }
    setEditingField(null);
    setEditValue('');
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const handlePriorityChange = (newPriority) => {
    const updated = { ...localSlots, priority: newPriority };
    setLocalSlots(updated);
    onEdit?.(updated);
  };

  const formatTime = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const hour = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${d.getMonth() + 1}月${d.getDate()}日 ${hour}:${min}`;
    } catch { return iso; }
  };

  const pc = PRIORITY_CONFIG[localSlots.priority] || PRIORITY_CONFIG.P2;

  const EditableField = ({ label, field, value, icon }) => (
    <div className="ac-field">
      <span className="ac-field-icon">{icon}</span>
      <span className="ac-field-label">{label}</span>
      {editingField === field ? (
        <span className="ac-field-edit-group">
          <input
            className="ac-field-input"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') cancelEdit(); }}
            autoFocus
          />
          <button className="ac-edit-btn ac-edit-confirm" onClick={confirmEdit}>✓</button>
          <button className="ac-edit-btn ac-edit-cancel" onClick={cancelEdit}>✕</button>
        </span>
      ) : (
        <span className="ac-field-value">
          {value || <em className="ac-empty">未填写</em>}
          <button className="ac-edit-trigger" onClick={() => startEdit(field, value)} title="编辑">✎</button>
        </span>
      )}
    </div>
  );

  return (
    <div className="ai-confirm-card">
      <div className="ac-header">📋 任务确认</div>
      <div className="ac-body">
        <EditableField label="标题" field="title" value={localSlots.title} icon="📌" />
        
        <div className="ac-field">
          <span className="ac-field-icon">🕐</span>
          <span className="ac-field-label">时间</span>
          <span className="ac-field-value">
            {formatTime(localSlots.startTime)}
            {localSlots.endTime && ` → ${formatTime(localSlots.endTime)}`}
            <button className="ac-edit-trigger" onClick={() => startEdit('startTime', localSlots.startTime)} title="编辑时间">✎</button>
          </span>
        </div>

        <div className="ac-field">
          <span className="ac-field-icon">🚩</span>
          <span className="ac-field-label">优先级</span>
          <span className="ac-field-value">
            <select 
              className="ac-priority-select"
              value={localSlots.priority || 'P2'}
              onChange={e => handlePriorityChange(e.target.value)}
              style={{ color: pc.color, borderColor: pc.color }}
            >
              {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </span>
        </div>

        {localSlots.participants?.length > 0 && (
          <div className="ac-field">
            <span className="ac-field-icon">👥</span>
            <span className="ac-field-label">参与人</span>
            <span className="ac-field-value">{localSlots.participants.join(', ')}</span>
          </div>
        )}

        {localSlots.location && (
          <div className="ac-field">
            <span className="ac-field-icon">📍</span>
            <span className="ac-field-label">地点</span>
            <span className="ac-field-value">{localSlots.location}</span>
          </div>
        )}

        {localSlots.tags?.length > 0 && (
          <div className="ac-field">
            <span className="ac-field-icon">🏷</span>
            <span className="ac-field-label">标签</span>
            <span className="ac-field-value">
              {localSlots.tags.map((t, i) => (
                <span key={i} className="ac-tag">#{t}</span>
              ))}
            </span>
          </div>
        )}

        {localSlots.notes && (
          <div className="ac-notes">
            <span className="ac-notes-icon">💡</span>
            <span className="ac-notes-text">{localSlots.notes}</span>
          </div>
        )}
      </div>
      
      <div className="ac-actions">
        <button className="btn btn-secondary" onClick={onCancel}>✕ 取消</button>
        <button className="btn btn-primary" onClick={() => onConfirm(localSlots)}>✓ 确认创建</button>
      </div>

      <style>{`
        .ai-confirm-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          margin: 8px 0;
          overflow: hidden;
        }
        .ac-header {
          padding: 10px 14px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 1px solid var(--border-default);
          background: var(--bg-secondary);
        }
        .ac-body {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ac-field {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: var(--text-base);
        }
        .ac-field-icon { font-size: 14px; width: 20px; text-align: center; }
        .ac-field-label {
          width: 52px;
          flex-shrink: 0;
          font-size: 12px;
          color: var(--text-muted);
        }
        .ac-field-value {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-primary);
        }
        .ac-empty { color: var(--text-muted); font-style: normal; }
        .ac-edit-trigger {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 12px;
          padding: 2px 4px;
          border-radius: var(--radius-sm);
          opacity: 0;
          transition: opacity 0.15s;
        }
        .ac-field:hover .ac-edit-trigger { opacity: 1; }
        .ac-edit-trigger:hover { color: var(--accent); background: rgba(79,195,247,0.1); }
        .ac-field-edit-group {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 1;
        }
        .ac-field-input {
          flex: 1;
          background: var(--bg-primary);
          border: 1px solid var(--accent);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          padding: 4px 8px;
          font-size: var(--text-base);
          font-family: inherit;
          outline: none;
        }
        .ac-edit-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 12px;
          padding: 2px 6px;
          border-radius: var(--radius-sm);
        }
        .ac-edit-confirm { color: var(--success); }
        .ac-edit-cancel { color: var(--text-muted); }
        .ac-edit-confirm:hover { background: rgba(74,222,128,0.15); }
        .ac-edit-cancel:hover { background: rgba(255,255,255,0.05); }
        .ac-priority-select {
          background: var(--bg-primary);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-sm);
          padding: 3px 8px;
          font-size: var(--text-sm);
          font-weight: 600;
          cursor: pointer;
          outline: none;
          font-family: inherit;
        }
        .ac-tag {
          display: inline-block;
          padding: 1px 8px;
          margin-right: 4px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          font-size: 12px;
          color: var(--text-secondary);
        }
        .ac-notes {
          display: flex;
          gap: 8px;
          padding: 8px;
          margin-top: 4px;
          background: rgba(79,195,247,0.05);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }
        .ac-notes-icon { flex-shrink: 0; }
        .ac-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 10px 14px;
          border-top: 1px solid var(--border-default);
        }
      `}</style>
    </div>
  );
}
