import React from 'react';

const NAV_ITEMS = [
  { key: 'day', icon: '📅', label: '日程' },
  { key: 'week', icon: '📊', label: '周视图' },
  { key: 'month', icon: '🗓️', label: '月视图' },
  { key: 'year', icon: '📈', label: '年视图' },
];

export default function Sidebar({ currentView, onViewChange }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-logo">⚡</span>
      </div>

      {/* 快速创建 — 独立于导航区域 */}
      <div className="sidebar-create">
        <button
          className={`sidebar-item sidebar-create-btn ${currentView === 'create' ? 'active' : ''}`}
          onClick={() => onViewChange('create')}
          title="快速创建 (Ctrl+N)"
        >
          <span className="sidebar-icon">➕</span>
          <span className="sidebar-label">快速创建</span>
        </button>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            className={`sidebar-item ${currentView === item.key ? 'active' : ''}`}
            onClick={() => onViewChange(item.key)}
            title={item.label}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          className={`sidebar-item ${currentView === 'models' ? 'active' : ''}`}
          onClick={() => onViewChange('models')}
          title="模型管理"
        >
          <span className="sidebar-icon">🤖</span>
          <span className="sidebar-label">模型管理</span>
        </button>
        <button className="sidebar-item" title="知识库（即将推出）">
          <span className="sidebar-icon">🧠</span>
          <span className="sidebar-label">知识库</span>
        </button>
        <button className="sidebar-item" title="图谱（即将推出）">
          <span className="sidebar-icon">🔗</span>
          <span className="sidebar-label">图谱</span>
        </button>
        <button className="sidebar-item" title="设置（即将推出）">
          <span className="sidebar-icon">⚙️</span>
          <span className="sidebar-label">设置</span>
        </button>
      </div>

      <style>{`
        .sidebar {
          width: 56px;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 12px 0;
          background: var(--bg-secondary);
          border-right: 1px solid var(--border-default);
          transition: width 0.2s ease;
          z-index: 100;
        }
        .sidebar:hover {
          width: 160px;
        }
        .sidebar-brand {
          margin-bottom: 8px;
        }
        .sidebar-logo {
          font-size: 22px;
        }
        .sidebar-create {
          width: 100%;
          padding: 0 8px;
          margin-bottom: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-default);
        }
        .sidebar-create-btn {
          background: var(--accent) !important;
          color: #000 !important;
          font-weight: 600;
          border-radius: var(--radius-md) !important;
        }
        .sidebar-create-btn:hover {
          filter: brightness(1.1);
        }
        .sidebar-create-btn.active {
          filter: brightness(0.9);
        }
        .sidebar-nav {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 100%;
          padding: 0 8px;
        }
        .sidebar-footer {
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 100%;
          padding: 0 8px;
        }
        .sidebar-item {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 100%;
          padding: 10px 8px;
          border: none;
          border-radius: var(--radius-md);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.15s ease;
          font-size: var(--text-sm);
          white-space: nowrap;
          overflow: hidden;
        }
        .sidebar:hover .sidebar-item {
          justify-content: flex-start;
          padding: 10px 12px;
        }
        .sidebar:not(:hover) .sidebar-label {
          display: none;
        }
        .sidebar-item:hover {
          background: var(--bg-surface);
          color: var(--text-primary);
        }
        .sidebar-item.active {
          background: var(--bg-surface);
          color: var(--accent);
        }
        .sidebar-icon {
          font-size: 18px;
          flex-shrink: 0;
          width: 24px;
          text-align: center;
        }
        .sidebar-label {
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .sidebar:hover .sidebar-label {
          opacity: 1;
        }
      `}</style>
    </aside>
  );
}
