import React, { useState, useEffect, useCallback } from 'react';

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default function WeekView({ date, onDateChange, onDayClick }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  // 计算本周一
  const dayOfWeek = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const start = new Date(weekDays[0]);
      start.setHours(0, 0, 0, 0);
      const end = new Date(weekDays[6]);
      end.setHours(23, 59, 59, 999);
      const data = await window.electronAPI?.tasks.getByDateRange(
        start.toISOString(), end.toISOString()
      ) || [];
      setTasks(data);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // 按天分组
  const tasksByDay = {};
  weekDays.forEach((_, i) => { tasksByDay[i] = []; });
  tasks.forEach(t => {
    if (t.start_time) {
      const td = new Date(t.start_time);
      for (let i = 0; i < 7; i++) {
        if (td.toDateString() === weekDays[i].toDateString()) {
          tasksByDay[i].push(t);
          break;
        }
      }
    }
  });

  const isToday = (d) => new Date().toDateString() === d.toDateString();

  const goWeek = (delta) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + delta * 7);
    onDateChange(d);
  };

  const formatDay = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

  return (
    <div className="week-view">
      <div className="wv-header">
        <div className="wv-title">
          <button className="btn btn-secondary" onClick={() => goWeek(-1)}>←</button>
          <h1>
            {weekDays[0].getFullYear()}年 {formatDay(weekDays[0])} — {formatDay(weekDays[6])}
          </h1>
          <button className="btn btn-secondary" onClick={() => goWeek(1)}>→</button>
        </div>
        <button className="btn btn-primary" onClick={() => onDateChange(new Date())}>今天</button>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: '400px', marginTop: '16px' }} />
      ) : (
        <div className="wv-grid">
          {weekDays.map((d, i) => {
            const dayTasks = tasksByDay[i] || [];
            const today = isToday(d);
            return (
              <div key={i} className={`wv-col ${today ? 'wv-today' : ''}`} onClick={() => onDayClick && onDayClick(d)}>
                <div className="wv-col-header">
                  <span className="wv-day-label">{DAY_LABELS[i]}</span>
                  <span className="wv-day-date">{formatDay(d)}</span>
                </div>
                <div className="wv-col-body">
                  {dayTasks.length === 0 ? (
                    <div className="wv-empty">—</div>
                  ) : (
                    dayTasks.map(task => (
                      <div key={task.id} className="wv-task">
                        <div className="wv-task-bar" style={{ background: priorityColor(task.priority) }} />
                        <div className="wv-task-info">
                          <div className="wv-task-title">{task.title}</div>
                          {task.start_time && (
                            <div className="wv-task-time">{formatTime(task.start_time)}</div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .week-view { height: 100%; display: flex; flex-direction: column; }
        .wv-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .wv-title { display: flex; align-items: center; gap: 12px; }
        .wv-title h1 { font-size: 16px; font-weight: 600; }
        .wv-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; flex: 1; }
        .wv-col { background: var(--bg-surface); border-radius: 6px; display: flex; flex-direction: column; overflow: hidden; }
        .wv-today { border: 1px solid var(--accent); }
        .wv-col-header { text-align: center; padding: 10px 4px 6px; border-bottom: 1px solid var(--border-default); }
        .wv-day-label { display: block; font-size: 11px; color: var(--text-muted); }
        .wv-day-date { display: block; font-size: 15px; font-weight: 600; margin-top: 2px; }
        .wv-col-body { flex: 1; padding: 6px; overflow-y: auto; }
        .wv-empty { text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px 0; }
        .wv-task { display: flex; align-items: stretch; margin-bottom: 4px; background: var(--bg-elevated); border-radius: 4px; overflow: hidden; cursor: pointer; }
        .wv-task:hover { background: #333; }
        .wv-task-bar { width: 3px; flex-shrink: 0; }
        .wv-task-info { padding: 5px 8px; min-width: 0; }
        .wv-task-title { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wv-task-time { font-size: 10px; color: var(--text-muted); margin-top: 1px; }
      `}</style>
    </div>
  );
}

function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function priorityColor(p) {
  return { P0: '#e94560', P1: '#f59e0b', P2: '#4fc3f7', P3: '#666666' }[p] || '#666666';
}
