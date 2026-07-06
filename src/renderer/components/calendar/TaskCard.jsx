import React from 'react';

const PRIORITY_CONFIG = {
  P0: { color: 'var(--priority-p0)', label: '紧急' },
  P1: { color: 'var(--priority-p1)', label: '重要' },
  P2: { color: 'var(--priority-p2)', label: '普通' },
  P3: { color: 'var(--priority-p3)', label: '低优' },
};

export default function TaskCard({ task, onClick, onComplete, onDelete, onDragEnd, style }) {
  const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.P2;
  const isCompleted = task.status === 'completed';
  const isPast = task.end_time && new Date(task.end_time) < new Date() && !isCompleted;

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  };

  const handleDrag = (e) => {
    // Prevent default to allow drop
    if (e.clientY === 0) return;
  };

  const handleDragEndEvent = (e) => {
    const deltaY = e.clientY - (e.target.getBoundingClientRect?.().top || 0);
    // Better approach: track start position
    if (onDragEnd && e.screenY) {
      const rect = e.target.closest('.task-area')?.getBoundingClientRect();
      if (rect) {
        const dropY = e.clientY - rect.top;
        const startTop = parseFloat(e.target.style.top) || 0;
        const deltaYPx = dropY - startTop;
        onDragEnd(deltaYPx);
      }
    }
  };

  return (
    <div
      className={`task-card ${isCompleted ? 'completed' : ''} ${isPast ? 'past' : ''}`}
      onClick={onClick}
      style={style}
      draggable={!isCompleted}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEndEvent}
    >
      <div className="task-priority-bar" style={{ background: priority.color }} />
      <div className="task-body">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {task.start_time && (
            <span className="task-time">
              {formatTime(task.start_time)}
              {task.end_time && ` - ${formatTime(task.end_time)}`}
            </span>
          )}
          {task.tags && JSON.parse(task.tags || '[]').map((tag, i) => (
            <span key={i} className="task-tag">{tag}</span>
          ))}
        </div>
      </div>
      <div className="task-actions">
        {!isCompleted && (
          <button
            className="task-action-btn task-complete-btn"
            onClick={(e) => { e.stopPropagation(); onComplete?.(); }}
            title="标记完成"
          >
            ✓
          </button>
        )}
        <button
          className="task-action-btn task-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`确定删除「${task.title}」吗？`)) {
              onDelete?.(task.id);
            }
          }}
          title="删除"
        >
          ✕
        </button>
      </div>

      <style>{`
        .task-card {
          display: flex;
          align-items: stretch;
          background: var(--bg-surface);
          border-radius: 6px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.15s ease;
          z-index: 5;
          margin-bottom: 2px;
        }
        .task-card:hover {
          background: var(--bg-elevated);
        }
        .task-card.completed {
          opacity: 0.5;
        }
        .task-card.completed .task-title {
          text-decoration: line-through;
        }
        .task-card.past:not(.completed) {
          border: 1px solid rgba(233, 69, 96, 0.3);
        }
        .task-priority-bar {
          width: 3px;
          flex-shrink: 0;
        }
        .task-body {
          flex: 1;
          padding: 6px 10px;
          min-width: 0;
        }
        .task-title {
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .task-meta {
          display: flex;
          gap: 8px;
          margin-top: 2px;
          font-size: 11px;
          color: var(--text-muted);
        }
        .task-tag {
          background: var(--bg-elevated);
          padding: 0 6px;
          border-radius: 3px;
          font-size: 10px;
        }
        .task-actions {
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          opacity: 0;
          transition: opacity 0.15s;
        }
        .task-card:hover .task-actions {
          opacity: 1;
        }
        .task-action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 50%;
          border: none;
          background: transparent;
          color: var(--text-muted);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .task-complete-btn:hover {
          color: var(--success);
          background: rgba(74, 222, 128, 0.15);
        }
        .task-delete-btn:hover {
          color: var(--danger);
          background: rgba(233, 69, 96, 0.15);
        }
      `}</style>
    </div>
  );
}

function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
