import React, { useState, useEffect, useCallback } from 'react';

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

export default function YearView({ date, onDateChange, onMonthClick }) {
  const [monthCounts, setMonthCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const year = date.getFullYear();

  const loadYearData = useCallback(async () => {
    setLoading(true);
    try {
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31, 23, 59, 59, 999);
      const data = await window.electronAPI?.tasks.getByDateRange(
        start.toISOString(), end.toISOString()
      ) || [];

      const counts = {};
      data.forEach(t => {
        if (t.start_time) {
          const m = new Date(t.start_time).getMonth();
          counts[m] = (counts[m] || 0) + 1;
        }
      });
      setMonthCounts(counts);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { loadYearData(); }, [loadYearData]);

  const goYear = (delta) => {
    onDateChange(new Date(year + delta, 0, 1));
  };

  const isCurrentMonth = (m) => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() === m;
  };

  return (
    <div className="year-view">
      <div className="yv-header">
        <div className="yv-title">
          <button className="btn btn-secondary" onClick={() => goYear(-1)}>←</button>
          <h1>{year}年</h1>
          <button className="btn btn-secondary" onClick={() => goYear(1)}>→</button>
        </div>
        <button className="btn btn-primary" onClick={() => onDateChange(new Date())}>今天</button>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: '400px', marginTop: '16px' }} />
      ) : (
        <div className="yv-grid">
          {MONTHS.map((label, i) => {
            const count = monthCounts[i] || 0;
            const active = isCurrentMonth(i);
            return (
              <div
                key={i}
                className={`yv-month ${active ? 'yv-current' : ''}`}
                onClick={() => onMonthClick && onMonthClick(i)}
              >
                <span className="yv-month-label">{label}</span>
                <span className="yv-month-count">
                  {count > 0 ? `${count} 事项` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .year-view { height: 100%; display: flex; flex-direction: column; }
        .yv-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
        .yv-title { display: flex; align-items: center; gap: 12px; }
        .yv-title h1 { font-size: var(--text-lg); font-weight: 600; min-width: 100px; text-align: center; }
        .yv-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; flex: 1; }
        .yv-month { background: var(--bg-surface); border-radius: var(--radius-md); padding: 20px; cursor: pointer; transition: all 0.15s; display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; min-height: 100px; }
        .yv-month:hover { background: var(--bg-elevated); }
        .yv-current { border: 1px solid var(--accent); }
        .yv-month-label { font-size: var(--text-lg); font-weight: 600; color: var(--text-primary); }
        .yv-month-count { font-size: var(--text-sm); color: var(--text-muted); }
      `}</style>
    </div>
  );
}
