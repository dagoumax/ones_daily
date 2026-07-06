import React, { useState, useEffect, useCallback } from 'react';
import TaskCard from '../components/calendar/TaskCard';
import TaskForm from '../components/calendar/TaskForm';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function DayView({ date, onDateChange }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const data = await window.electronAPI?.tasks.getByDateRange(
        dayStart.toISOString(),
        dayEnd.toISOString()
      ) || [];
      setTasks(data);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const handleTaskClick = (task) => {
    setSelectedTask(task);
  };

  const handleCreateTask = async (taskData) => {
    try {
      await window.electronAPI?.tasks.create({
        ...taskData,
        startTime: taskData.startTime || new Date().toISOString(),
        source: 'manual',
      });
      setShowForm(false);
      loadTasks();
    } catch (err) {
      console.error('Create task failed:', err);
    }
  };

  const handleComplete = async (id) => {
    await window.electronAPI?.tasks.complete(id);
    loadTasks();
  };

  const handleDelete = async (id) => {
    await window.electronAPI?.tasks.delete(id);
    loadTasks();
  };

  const handleDragEnd = async (task, deltaY) => {
    if (!task.start_time) return;
    const pxPerHour = 60; // 60px = 1 hour
    const deltaMinutes = Math.round((deltaY / pxPerHour) * 60);
    if (deltaMinutes === 0) return;
    const start = new Date(task.start_time);
    start.setMinutes(start.getMinutes() + deltaMinutes);
    let end = task.end_time ? new Date(task.end_time) : null;
    if (end) end.setMinutes(end.getMinutes() + deltaMinutes);
    try {
      await window.electronAPI?.tasks.update(task.id, {
        startTime: start.toISOString(),
        endTime: end ? end.toISOString() : null,
      });
      loadTasks();
    } catch (e) {
      console.error('Drag update failed:', e);
    }
  };

  const getCurrentTimePosition = () => {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    return (minutes / 1440) * 100;
  };

  const formatDate = (d) => {
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return `${d.getMonth() + 1}月${d.getDate()}日 星期${days[d.getDay()]}`;
  };

  const isToday = new Date().toDateString() === date.toDateString();

  return (
    <div className="day-view">
      {/* 头部 */}
      <div className="day-header">
        <div className="day-title">
          <h1>{formatDate(date)}</h1>
          {isToday && <span className="today-badge">今天</span>}
        </div>
        <div className="day-actions">
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            + 新建事项
          </button>
        </div>
      </div>

      {/* 时间轴 */}
      <div className="timeline">
        {loading ? (
          <div className="skeleton" style={{ height: '400px', marginTop: '16px' }} />
        ) : tasks.length === 0 ? (
          <div className="empty-state">
            <span style={{ fontSize: '32px' }}>📋</span>
            <p>今日无事</p>
            <p className="empty-hint">点击「+ 新建事项」或按 Ctrl+Shift+V 语音创建</p>
          </div>
        ) : (
          <div className="timeline-body">
            {/* 时间标尺 */}
            <div className="time-ruler">
              {HOURS.map(h => (
                <div key={h} className="time-tick">
                  <span className="time-label">{String(h).padStart(2, '0')}:00</span>
                </div>
              ))}
            </div>

            {/* 事项区域 */}
            <div className="task-area">
              {/* 当前时间红线 */}
              {isToday && (
                <div
                  className="now-line"
                  style={{ top: `${getCurrentTimePosition()}%` }}
                />
              )}

              {/* 事项卡片 */}
              {tasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={() => handleTaskClick(task)}
                  onComplete={() => handleComplete(task.id)}
                  onDelete={() => handleDelete(task.id)}
                  onDragEnd={(deltaY) => handleDragEnd(task, deltaY)}
                  style={getTaskPosition(task)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 创建表单弹窗 */}
      {showForm && (
        <TaskForm
          onSubmit={handleCreateTask}
          onClose={() => setShowForm(false)}
        />
      )}

      <style>{`
        .day-view { height: 100%; display: flex; flex-direction: column; }
        .day-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
        .day-title { display: flex; align-items: center; gap: 12px; }
        .day-title h1 { font-size: 20px; font-weight: 600; color: var(--text-primary); }
        .today-badge { font-size: 11px; background: var(--accent); color: #000; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
        .day-actions { display: flex; gap: 8px; }
        .timeline { flex: 1; overflow-y: auto; padding-top: 16px; }
        .timeline-body { display: flex; position: relative; min-height: 1440px; }
        .time-ruler { width: 56px; flex-shrink: 0; }
        .time-tick { height: 60px; position: relative; border-top: 1px solid var(--border-default); }
        .time-tick:first-child { border-top: none; }
        .time-label { position: absolute; top: -9px; right: 8px; font-size: 11px; color: var(--text-muted); }
        .task-area { flex: 1; position: relative; }
        .now-line { position: absolute; left: 0; right: 0; height: 2px; background: var(--danger); z-index: 10; pointer-events: none; }
        .now-line::before { content: ''; position: absolute; left: -6px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--danger); }
        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 0; color: var(--text-secondary); }
        .empty-state p { margin-top: 12px; font-size: 16px; }
        .empty-hint { font-size: 13px !important; color: var(--text-muted); }
      `}</style>
    </div>
  );
}

function getTaskPosition(task) {
  if (!task.start_time) return {};
  const start = new Date(task.start_time);
  const topPercent = ((start.getHours() * 60 + start.getMinutes()) / 1440) * 100;

  let height = 60; // 默认 1 小时
  if (task.end_time) {
    const end = new Date(task.end_time);
    const durationMin = (end - start) / 60000;
    height = Math.max(30, (durationMin / 1440) * 100 * 14.4);
  }

  return {
    position: 'absolute',
    top: `${topPercent}%`,
    height: `${height}px`,
    left: '8px',
    right: '8px',
  };
}
