import React, { useState, useEffect, useCallback } from 'react';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export default function MonthView({ date, onDateChange, onDayClick }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const year = date.getFullYear();
  const month = date.getMonth();

  // 计算本月日历网格
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay(); // 前面补几个空白
  const totalDays = lastDay.getDate();
  const weeks = Math.ceil((startPad + totalDays) / 7);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
      const data = await window.electronAPI?.tasks.getByDateRange(
        monthStart.toISOString(), monthEnd.toISOString()
      ) || [];
      setTasks(data);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // 按天分组任务
  const tasksByDay = {};
  tasks.forEach(t => {
    if (t.start_time) {
      const d = new Date(t.start_time).getDate();
      if (!tasksByDay[d]) tasksByDay[d] = [];
      tasksByDay[d].push(t);
    }
  });

  const isToday = (d) => new Date().toDateString() === new Date(year, month, d).toDateString();

  const goMonth = (delta) => {
    const d = new Date(year, month + delta, 1);
    onDateChange(d);
  };

  const handleDayClick = (d) => {
    if (d && onDayClick) {
      onDayClick(new Date(year, month, d));
    }
  };

  return (
    <div className="month-view">
      <div className="mv-header">
        <div className="mv-title">
          <button className="btn btn-secondary" onClick={() => goMonth(-1)}>←</button>
          <h1>{year}年{month + 1}月</h1>
          <button className="btn btn-secondary" onClick={() => goMonth(1)}>→</button>
        </div>
        <button className="btn btn-primary" onClick={() => onDateChange(new Date())}>今天</button>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: '400px', marginTop: '16px' }} />
      ) : (
        <div className="mv-grid">
          {/* 星期头 */}
          {WEEKDAYS.map(w => (
            <div key={w} className="mv-weekday">{w}</div>
          ))}

          {/* 空白填充 */}
          {Array.from({ length: startPad }).map((_, i) => (
            <div key={`pad-${i}`} className="mv-day mv-day-empty" />
          ))}

          {/* 日期格子 */}
          {Array.from({ length: totalDays }).map((_, i) => {
            const d = i + 1;
            const dayTasks = tasksByDay[d] || [];
            const today = isToday(d);
            return (
              <div
                key={d}
                className={`mv-day ${today ? 'mv-today' : ''}`}
                onClick={() => handleDayClick(d)}
              >
                <span className="mv-day-num">{d}</span>
                <div className="mv-dots">
                  {dayTasks.slice(0, 3).map(t => (
                    <div
                      key={t.id}
                      className="mv-dot"
                      style={{ background: priorityColor(t.priority) }}
                      title={t.title}
                    />
                  ))}
                  {dayTasks.length > 3 && (
                    <span className="mv-more">+{dayTasks.length - 3}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .month-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
        .mv-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-shrink: 0; }
        .mv-title { display: flex; align-items: center; gap: 12px; }
        .mv-title h1 { font-size: 18px; font-weight: 600; min-width: 120px; text-align: center; }
        .mv-grid { display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: auto repeat(6, 1fr); gap: 2px; flex: 1; min-height: 0; }
        .mv-weekday { text-align: center; font-size: 12px; color: var(--text-muted); padding: 8px 0; font-weight: 500; }
        .mv-day { background: var(--bg-surface); border-radius: 4px; padding: 6px; cursor: pointer; transition: background 0.15s; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
        .mv-day:hover { background: var(--bg-elevated); }
        .mv-day-empty { background: transparent; cursor: default; }
        .mv-day-empty:hover { background: transparent; }
        .mv-today { border: 1px solid var(--accent); }
        .mv-today .mv-day-num { color: var(--accent); font-weight: 700; }
        .mv-day-num { font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
        .mv-dots { display: flex; flex-wrap: wrap; gap: 3px; }
        .mv-dot { width: 6px; height: 6px; border-radius: 50%; }
        .mv-more { font-size: 10px; color: var(--text-muted); }
      `}</style>
    </div>
  );
}

function priorityColor(p) {
  return { P0: '#e94560', P1: '#f59e0b', P2: '#4fc3f7', P3: '#666666' }[p] || '#666666';
}
