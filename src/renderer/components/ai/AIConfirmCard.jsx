import React, { useState } from 'react';

const PRIORITY_CONFIG = {
  P0: { label: 'P0 紧急', color: '#e94560' },
  P1: { label: 'P1 重要', color: '#f59e0b' },
  P2: { label: 'P2 普通', color: '#3b82f6' },
  P3: { label: 'P3 低优', color: '#6b7280' },
};

/**
 * 通用确认卡片 — 根据 toolName 渲染不同 UI
 * 
 * 支持类型：
 * - create_task: 任务创建确认（行内编辑）
 * - delete_task: 删除确认（危险操作警告）
 * - complete_task: 完成确认
 * - update_task: 更新确认（前后对比）
 * - candidates: 多候选列表选择
 */
export default function AIConfirmCard({ toolName, preview, onConfirm, onCancel, onEdit }) {
  const [isProcessing, setIsProcessing] = useState(false);
  if (!toolName || !preview) return null;

  const wrapConfirm = (data) => {
    if (isProcessing) return;
    setIsProcessing(true);
    onConfirm(data);
  };
  const wrapCancel = () => {
    if (isProcessing) return;
    setIsProcessing(true);
    onCancel();
  };

  const common = {
    onConfirm: wrapConfirm,
    onCancel: wrapCancel,
    isProcessing,
  };

  switch (toolName) {
    case 'create_task':
      return <CreateConfirmCard preview={preview} onConfirm={wrapConfirm} onCancel={wrapCancel} onEdit={onEdit} isProcessing={isProcessing} />;
    case 'delete_task':
      return preview.candidates
        ? <CandidateListCard preview={preview} {...common} mode="delete" />
        : <DeleteConfirmCard preview={preview} {...common} />;
    case 'complete_task':
      return preview.candidates
        ? <CandidateListCard preview={preview} {...common} mode="complete" />
        : <CompleteConfirmCard preview={preview} {...common} />;
    case 'update_task':
      return <UpdateConfirmCard preview={preview} {...common} />;
    default:
      return null;
  }
}

// ============================================
// 创建任务确认卡片
// ============================================
function CreateConfirmCard({ preview, onConfirm, onCancel, onEdit, isProcessing }) {
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');
  const task = preview.task_preview || preview;
  const [localSlots, setLocalSlots] = useState(task);

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
  const cancelEdit = () => { setEditingField(null); setEditValue(''); };

  const formatTime = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return iso; }
  };

  const pc = PRIORITY_CONFIG[localSlots.priority] || PRIORITY_CONFIG.P2;

  const EditableField = ({ label, field, value, icon }) => (
    <div className="ac-field">
      <span className="ac-field-icon">{icon}</span>
      <span className="ac-field-label">{label}</span>
      {editingField === field ? (
        <span className="ac-field-edit-group">
          <input className="ac-field-input" value={editValue} onChange={e => setEditValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') cancelEdit(); }} autoFocus />
          <button className="ac-edit-btn ac-edit-confirm" onClick={confirmEdit}>✓</button>
          <button className="ac-edit-btn ac-edit-cancel" onClick={cancelEdit}>✕</button>
        </span>
      ) : (
        <span className="ac-field-value">
          {value || <em className="ac-empty">未填写</em>}
          <button className="ac-edit-trigger" onClick={() => startEdit(field, value)}>✎</button>
        </span>
      )}
    </div>
  );

  return (
    <div className="ai-confirm-card">
      <div className="ac-header ac-header-create">📋 任务确认</div>
      <div className="ac-body">
        <EditableField label="标题" field="title" value={localSlots.title} icon="📌" />
        <div className="ac-field">
          <span className="ac-field-icon">🕐</span><span className="ac-field-label">时间</span>
          <span className="ac-field-value">
            {formatTime(localSlots.start_time)}
            {localSlots.end_time && ` → ${formatTime(localSlots.end_time)}`}
          </span>
        </div>
        <div className="ac-field">
          <span className="ac-field-icon">🚩</span><span className="ac-field-label">优先级</span>
          <select className="ac-priority-select" value={localSlots.priority || 'P2'}
            onChange={e => { const u = { ...localSlots, priority: e.target.value }; setLocalSlots(u); onEdit?.(u); }}
            style={{ color: pc.color, borderColor: pc.color }}>
            {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        {localSlots.location && (
          <div className="ac-field"><span className="ac-field-icon">📍</span><span className="ac-field-label">地点</span><span className="ac-field-value">{localSlots.location}</span></div>
        )}
        {localSlots.tags?.length > 0 && (
          <div className="ac-field"><span className="ac-field-icon">🏷</span><span className="ac-field-label">标签</span>
            <span className="ac-field-value">{localSlots.tags.map((t, i) => <span key={i} className="ac-tag">#{t}</span>)}</span></div>
        )}
        {localSlots.notes && (
          <div className="ac-notes"><span className="ac-notes-icon">💡</span><span className="ac-notes-text">{localSlots.notes}</span></div>
        )}
      </div>
      <div className="ac-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={isProcessing}>✕ 取消</button>
        <button className="btn btn-primary" onClick={() => onConfirm(localSlots)} disabled={isProcessing}>
          {isProcessing ? '处理中...' : '✓ 确认创建'}
        </button>
      </div>
    </div>
  );
}

// ============================================
// 删除确认卡片
// ============================================
function DeleteConfirmCard({ preview, onConfirm, onCancel, isProcessing }) {
  const task = preview.task;
  if (!task) return null;

  const formatTime = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return iso; }
  };

  return (
    <div className="ai-confirm-card ai-confirm-danger">
      <div className="ac-header ac-header-danger">⚠️ 确认删除</div>
      <div className="ac-body">
        <div className="ac-warning">{preview.message || `确认删除此任务？此操作不可撤销。`}</div>
        <div className="ac-task-summary">
          <div className="ac-task-title">{task.title}</div>
          {task.start_time && <div className="ac-task-time">🕐 {formatTime(task.start_time)}</div>}
          {task.priority && (
            <span className="ac-task-priority" style={{ color: PRIORITY_CONFIG[task.priority]?.color }}>
              {PRIORITY_CONFIG[task.priority]?.label}
            </span>
          )}
        </div>
      </div>
      <div className="ac-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={isProcessing}>保留</button>
        <button className="btn btn-danger" onClick={() => onConfirm(task)} disabled={isProcessing}>
          {isProcessing ? '删除中...' : '🗑 确认删除'}
        </button>
      </div>
    </div>
  );
}

// ============================================
// 完成确认卡片
// ============================================
function CompleteConfirmCard({ preview, onConfirm, onCancel, isProcessing }) {
  const task = preview.task;
  if (!task) return null;

  return (
    <div className="ai-confirm-card ai-confirm-success">
      <div className="ac-header ac-header-success">✅ 确认完成</div>
      <div className="ac-body">
        <div className="ac-task-summary">
          <div className="ac-task-title">{task.title}</div>
          {task.priority && (
            <span className="ac-task-priority" style={{ color: PRIORITY_CONFIG[task.priority]?.color }}>
              {PRIORITY_CONFIG[task.priority]?.label}
            </span>
          )}
        </div>
      </div>
      <div className="ac-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={isProcessing}>取消</button>
        <button className="btn btn-success" onClick={() => onConfirm(task)} disabled={isProcessing}>
          {isProcessing ? '处理中...' : '✓ 确认完成'}
        </button>
      </div>
    </div>
  );
}

// ============================================
// 更新确认卡片（前后对比）
// ============================================
function UpdateConfirmCard({ preview, onConfirm, onCancel, isProcessing }) {
  const { original, updates } = preview;
  if (!original || !updates) return null;

  const fieldLabelMap = { title: '标题', start_time: '开始时间', end_time: '结束时间', priority: '优先级', location: '地点' };

  return (
    <div className="ai-confirm-card">
      <div className="ac-header ac-header-update">✏️ 确认修改</div>
      <div className="ac-body">
        <div className="ac-task-summary">
          <div className="ac-task-title">{original.title}</div>
        </div>
        <div className="ac-changes">
          {Object.entries(updates).map(([field, { from, to }]) => (
            <div key={field} className="ac-change-row">
              <span className="ac-change-label">{fieldLabelMap[field] || field}</span>
              <span className="ac-change-from">{from || '无'}</span>
              <span className="ac-change-arrow">→</span>
              <span className="ac-change-to">{to}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="ac-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={isProcessing}>取消</button>
        <button className="btn btn-primary" onClick={() => onConfirm({ task_id: original.id, ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, v.to])) })} disabled={isProcessing}>
          {isProcessing ? '处理中...' : '✓ 确认修改'}
        </button>
      </div>
    </div>
  );
}

// ============================================
// 多候选列表卡片（删除/完成共用）
// ============================================
function CandidateListCard({ preview, onConfirm, onCancel, mode, isProcessing }) {
  const candidates = preview.candidates || [];
  const [selected, setSelected] = useState(null);

  const formatTime = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return iso; }
  };

  const isDelete = mode === 'delete';
  const headerIcon = isDelete ? '⚠️' : '✅';
  const headerLabel = isDelete ? '选择要删除的任务' : '选择已完成的任务';
  const confirmLabel = isDelete ? '🗑 确认删除' : '✓ 确认完成';
  const confirmClass = isDelete ? 'btn-danger' : 'btn-success';

  return (
    <div className={`ai-confirm-card ${isDelete ? 'ai-confirm-danger' : 'ai-confirm-success'}`}>
      <div className={`ac-header ${isDelete ? 'ac-header-danger' : 'ac-header-success'}`}>{headerIcon} {headerLabel}</div>
      <div className="ac-body">
        <div className="ac-candidate-hint">{preview.message}</div>
        {candidates.map((t, i) => (
          <div key={t.id || i}
            className={`ac-candidate-item ${selected?.id === t.id ? 'ac-candidate-selected' : ''}`}
            onClick={() => setSelected(t)}>
            <div className="ac-candidate-radio">{selected?.id === t.id ? '◉' : '○'}</div>
            <div className="ac-candidate-info">
              <div className="ac-task-title">{t.title}</div>
              {t.start_time && <div className="ac-task-time">🕐 {formatTime(t.start_time)}</div>}
              {t.priority && (
                <span className="ac-task-priority" style={{ color: PRIORITY_CONFIG[t.priority]?.color }}>
                  {PRIORITY_CONFIG[t.priority]?.label}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="ac-actions">
        <button className="btn btn-secondary" onClick={onCancel} disabled={isProcessing}>取消</button>
        <button className={`btn ${confirmClass}`} disabled={!selected || isProcessing} onClick={() => selected && onConfirm(selected)}>
          {isProcessing ? '处理中...' : confirmLabel}
        </button>
      </div>
    </div>
  );
}

// ============================================
// 内联样式（追加到 CreateConfirmCard 已有样式）
// ============================================
const CARD_STYLES = `
.ai-confirm-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  margin: 8px 0;
  overflow: hidden;
}
.ai-confirm-danger { border-color: rgba(233,69,96,0.3); }
.ai-confirm-success { border-color: rgba(74,222,128,0.3); }

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
.ac-header-create { color: var(--accent); }
.ac-header-danger { color: #e94560; background: rgba(233,69,96,0.08); }
.ac-header-success { color: #4ade80; background: rgba(74,222,128,0.08); }
.ac-header-update { color: #f59e0b; background: rgba(245,158,11,0.08); }

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
.ac-field-label { width: 52px; flex-shrink: 0; font-size: 12px; color: var(--text-muted); }
.ac-field-value { flex: 1; display: flex; align-items: center; gap: 6px; color: var(--text-primary); }
.ac-empty { color: var(--text-muted); font-style: normal; }
.ac-edit-trigger {
  background: none; border: none; color: var(--text-muted); cursor: pointer;
  font-size: 12px; padding: 2px 4px; border-radius: var(--radius-sm);
  opacity: 0; transition: opacity 0.15s;
}
.ac-field:hover .ac-edit-trigger { opacity: 1; }
.ac-edit-trigger:hover { color: var(--accent); background: rgba(79,195,247,0.1); }
.ac-field-edit-group { display: flex; align-items: center; gap: 4px; flex: 1; }
.ac-field-input {
  flex: 1; background: var(--bg-primary); border: 1px solid var(--accent);
  border-radius: var(--radius-sm); color: var(--text-primary);
  padding: 4px 8px; font-size: var(--text-base); font-family: inherit; outline: none;
}
.ac-edit-btn { background: none; border: none; cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: var(--radius-sm); }
.ac-edit-confirm { color: var(--success); }
.ac-edit-cancel { color: var(--text-muted); }
.ac-edit-confirm:hover { background: rgba(74,222,128,0.15); }
.ac-edit-cancel:hover { background: rgba(255,255,255,0.05); }
.ac-priority-select {
  background: var(--bg-primary); border: 1px solid var(--border-default);
  border-radius: var(--radius-sm); padding: 3px 8px; font-size: var(--text-sm);
  font-weight: 600; cursor: pointer; outline: none; font-family: inherit;
}
.ac-tag {
  display: inline-block; padding: 1px 8px; margin-right: 4px;
  background: var(--bg-secondary); border: 1px solid var(--border-default);
  border-radius: var(--radius-md); font-size: 12px; color: var(--text-secondary);
}
.ac-notes {
  display: flex; gap: 8px; padding: 8px; margin-top: 4px;
  background: rgba(79,195,247,0.05); border-radius: var(--radius-md);
  font-size: var(--text-sm); color: var(--text-secondary);
}
.ac-notes-icon { flex-shrink: 0; }

/* 删除/完成卡片 */
.ac-warning { padding: 8px 0; color: #f87171; font-size: var(--text-sm); }
.ac-task-summary {
  padding: 10px; background: var(--bg-primary);
  border-radius: var(--radius-md); border: 1px solid var(--border-default);
}
.ac-task-title { font-size: var(--text-base); font-weight: 600; color: var(--text-primary); margin-bottom: 4px; }
.ac-task-time { font-size: var(--text-sm); color: var(--text-secondary); }
.ac-task-priority { font-size: var(--text-xs); font-weight: 600; margin-left: 8px; }

/* 更新卡片 */
.ac-changes { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.ac-change-row { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); }
.ac-change-label { width: 60px; color: var(--text-muted); flex-shrink: 0; }
.ac-change-from { color: var(--text-muted); text-decoration: line-through; }
.ac-change-arrow { color: var(--text-muted); }
.ac-change-to { color: var(--accent); font-weight: 600; }

/* 候选列表 */
.ac-candidate-hint { font-size: var(--text-sm); color: var(--text-muted); margin-bottom: 4px; }
.ac-candidate-item {
  display: flex; align-items: center; gap: 10px; padding: 10px;
  background: var(--bg-primary); border: 1px solid var(--border-default);
  border-radius: var(--radius-md); cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.ac-candidate-item:hover { border-color: var(--accent); }
.ac-candidate-selected { border-color: var(--accent); background: rgba(79,195,247,0.05); }
.ac-candidate-radio { font-size: 16px; color: var(--accent); flex-shrink: 0; }
.ac-candidate-info { flex: 1; }

.ac-actions {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 10px 14px; border-top: 1px solid var(--border-default);
}

.btn { padding: 6px 16px; border-radius: var(--radius-md); font-size: var(--text-sm); font-weight: 500; cursor: pointer; border: none; font-family: inherit; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: #000; }
.btn-secondary { background: var(--bg-secondary); color: var(--text-secondary); border: 1px solid var(--border-default); }
.btn-danger { background: #e94560; color: #fff; }
.btn-success { background: #22c55e; color: #fff; }
.btn-primary:hover { filter: brightness(1.1); }
.btn-danger:hover { filter: brightness(1.1); }
.btn-success:hover { filter: brightness(1.1); }
`;

// 注入全局样式（幂等）
if (typeof document !== 'undefined' && !document.getElementById('ai-confirm-card-styles')) {
  const style = document.createElement('style');
  style.id = 'ai-confirm-card-styles';
  style.textContent = CARD_STYLES;
  document.head.appendChild(style);
}
