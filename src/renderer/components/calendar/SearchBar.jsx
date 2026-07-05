import React, { useState, useRef, useEffect } from 'react';

export default function SearchBar({ onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    setSearching(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const data = await window.electronAPI?.tasks.search(query.trim()) || [];
        setResults(data);
        setOpen(true);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    const handleClick = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', handleEsc);
    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.removeEventListener('click', handleClick);
    };
  }, []);

  const handleSelect = (task) => {
    setQuery('');
    setOpen(false);
    onSelect?.(task);
  };

  return (
    <div className="search-bar-wrapper" ref={inputRef}>
      <div className="search-bar">
        <span className="search-icon">🔍</span>
        <input
          className="search-input"
          placeholder="搜索事项..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {searching && <span className="search-spinner">⏳</span>}
      </div>

      {open && results.length > 0 && (
        <div className="search-dropdown">
          {results.map(task => (
            <div
              key={task.id}
              className="search-item"
              onClick={() => handleSelect(task)}
            >
              <div className="search-item-bar" style={{ background: priorityColor(task.priority) }} />
              <div className="search-item-info">
                <div className="search-item-title">{task.title}</div>
                <div className="search-item-meta">
                  {task.start_time && formatDate(task.start_time)}
                  <span className="search-item-priority">{task.priority}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && query && results.length === 0 && !searching && (
        <div className="search-dropdown">
          <div className="search-empty">未找到匹配事项</div>
        </div>
      )}

      <style>{`
        .search-bar-wrapper { position: relative; margin-bottom: 16px; z-index: 50; }
        .search-bar { display: flex; align-items: center; gap: 8px; background: var(--bg-surface); border-radius: 8px; padding: 8px 14px; border: 1px solid var(--border-default); transition: border-color 0.2s; }
        .search-bar:focus-within { border-color: var(--accent); }
        .search-icon { font-size: 14px; }
        .search-input { flex: 1; background: transparent; border: none; color: var(--text-primary); font-size: 14px; outline: none; }
        .search-input::placeholder { color: var(--text-muted); }
        .search-spinner { font-size: 12px; }
        .search-dropdown { position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px; background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 8px; overflow: hidden; max-height: 300px; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
        .search-item { display: flex; align-items: stretch; padding: 10px 14px; cursor: pointer; transition: background 0.1s; }
        .search-item:hover { background: var(--bg-elevated); }
        .search-item-bar { width: 3px; border-radius: 2px; margin-right: 10px; flex-shrink: 0; }
        .search-item-info { min-width: 0; }
        .search-item-title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .search-item-meta { display: flex; gap: 8px; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .search-item-priority { color: var(--accent); }
        .search-empty { padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px; }
      `}</style>
    </div>
  );
}

function priorityColor(p) {
  return { P0: '#e94560', P1: '#f59e0b', P2: '#4fc3f7', P3: '#666666' }[p] || '#666666';
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
