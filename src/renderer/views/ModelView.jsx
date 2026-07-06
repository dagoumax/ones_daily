import React, { useState, useEffect, useCallback } from 'react';

const MODEL_TYPES = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'ollama', label: 'Ollama (本地)' },
  { value: 'custom', label: '自定义' },
];

const INITIAL_FORM = { name: '', type: 'openai', endpoint: '', apiKeyEncrypted: '', modelIdentifier: '' };

export default function ModelView() {
  const [models, setModels] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [testing, setTesting] = useState({});
  const [testResult, setTestResult] = useState({});

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI?.models.getAll() || [];
      setModels(data);
      const s = await window.electronAPI?.models.getUsageStats('7d');
      setStats(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.endpoint.trim()) return;
    try {
      if (editing) {
        await window.electronAPI?.models.update(editing, form);
      } else {
        await window.electronAPI?.models.create(form);
      }
      setShowForm(false);
      setEditing(null);
      setForm(INITIAL_FORM);
      loadModels();
    } catch (e) {
      console.error('Save model failed:', e);
    }
  };

  const handleEdit = (m) => {
    setForm({
      name: m.name,
      type: m.type,
      endpoint: m.endpoint,
      apiKeyEncrypted: m.api_key_encrypted,
      modelIdentifier: m.model_identifier,
    });
    setEditing(m.id);
    setShowForm(true);
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`确定删除模型「${name}」吗？`)) return;
    await window.electronAPI?.models.delete(id);
    loadModels();
  };

  const handleTest = async (id) => {
    setTesting(prev => ({ ...prev, [id]: true }));
    setTestResult(prev => ({ ...prev, [id]: null }));
    try {
      const result = await window.electronAPI?.models.testConnection(id);
      setTestResult(prev => ({ ...prev, [id]: result }));
    } catch (e) {
      setTestResult(prev => ({ ...prev, [id]: { success: false, error: e.message } }));
    } finally {
      setTesting(prev => ({ ...prev, [id]: false }));
    }
  };

  const typeLabel = (t) => MODEL_TYPES.find(m => m.value === t)?.label || t;

  return (
    <div className="model-view">
      <div className="mv-header">
        <div>
          <h1>模型管理</h1>
          <p className="mv-subtitle">管理 AI 模型连接，支持 OpenAI 兼容 API 和本地模型</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setForm(INITIAL_FORM); setShowForm(true); }}>
          + 添加模型
        </button>
      </div>

      {/* 使用统计 */}
      {stats && (
        <div className="mv-stats">
          <div className="mv-stat-item">
            <span className="mv-stat-num">{stats.totalCalls}</span>
            <span className="mv-stat-label">近7天调用</span>
          </div>
          <div className="mv-stat-item">
            <span className="mv-stat-num">${(stats.totalCost || 0).toFixed(4)}</span>
            <span className="mv-stat-label">总费用</span>
          </div>
          <div className="mv-stat-item">
            <span className="mv-stat-num">{models.length}</span>
            <span className="mv-stat-label">已配置模型</span>
          </div>
        </div>
      )}

      {/* 模型列表 */}
      {loading ? (
        <div className="skeleton" style={{ height: '200px', marginTop: '16px' }} />
      ) : models.length === 0 ? (
        <div className="empty-state">
          <span style={{ fontSize: '32px' }}>🤖</span>
          <p>还没有配置模型</p>
          <p className="empty-hint">点击「+ 添加模型」连接你的 AI 服务</p>
        </div>
      ) : (
        <div className="mv-list">
          {models.map(m => {
            const isTesting = testing[m.id];
            const result = testResult[m.id];
            return (
              <div key={m.id} className="mv-card">
                <div className="mv-card-main">
                  <div className="mv-card-header">
                    <h3>{m.name}</h3>
                    <span className={`mv-type-badge mv-type-${m.type}`}>{typeLabel(m.type)}</span>
                    {result && (
                      <span className={`mv-status ${result.success ? 'mv-ok' : 'mv-fail'}`}>
                        {result.success ? `✅ ${result.latency}ms` : `❌ ${result.error}`}
                      </span>
                    )}
                  </div>
                  <div className="mv-card-meta">
                    <span title={m.endpoint}>{m.endpoint}</span>
                    {m.model_identifier && <span>模型: {m.model_identifier}</span>}
                  </div>
                </div>
                <div className="mv-card-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleTest(m.id)}
                    disabled={isTesting}
                  >
                    {isTesting ? '测试中...' : '测试连接'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(m)}>编辑</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(m.id, m.name)}>删除</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 添加/编辑弹窗 */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <form className="task-form" onClick={e => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
            <h3>{editing ? '编辑模型' : '添加模型'}</h3>

            <input
              className="input"
              placeholder="模型名称（如 GPT-4o）"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              autoFocus
            />

            <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {MODEL_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            <input
              className="input"
              placeholder="API 地址（如 https://api.openai.com）"
              value={form.endpoint}
              onChange={e => setForm({ ...form, endpoint: e.target.value })}
            />

            <input
              className="input"
              placeholder="API Key"
              type="password"
              value={form.apiKeyEncrypted}
              onChange={e => setForm({ ...form, apiKeyEncrypted: e.target.value })}
            />

            <input
              className="input"
              placeholder="模型标识符（如 gpt-4o，留空自动检测）"
              value={form.modelIdentifier}
              onChange={e => setForm({ ...form, modelIdentifier: e.target.value })}
            />

            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>取消</button>
              <button type="submit" className="btn btn-primary">保存</button>
            </div>
          </form>
        </div>
      )}

      <style>{`
        .model-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
        .mv-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; flex-shrink: 0; }
        .mv-header h1 { font-size: 20px; font-weight: 600; }
        .mv-subtitle { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
        .mv-stats { display: flex; gap: 16px; margin-bottom: 20px; flex-shrink: 0; }
        .mv-stat-item { flex: 1; background: var(--bg-surface); border-radius: 8px; padding: 14px; text-align: center; }
        .mv-stat-num { display: block; font-size: 22px; font-weight: 700; color: var(--accent); }
        .mv-stat-label { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
        .mv-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
        .mv-card { background: var(--bg-surface); border-radius: 10px; padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; transition: background 0.15s; }
        .mv-card:hover { background: var(--bg-elevated); }
        .mv-card-main { flex: 1; min-width: 0; }
        .mv-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
        .mv-card-header h3 { font-size: 14px; font-weight: 600; }
        .mv-type-badge { font-size: 11px; padding: 1px 8px; border-radius: 10px; font-weight: 500; }
        .mv-type-openai { background: rgba(74, 222, 128, 0.15); color: var(--success); }
        .mv-type-ollama { background: rgba(79, 195, 247, 0.15); color: var(--accent); }
        .mv-type-custom { background: rgba(107, 114, 128, 0.15); color: var(--text-muted); }
        .mv-status { font-size: 11px; padding: 1px 8px; border-radius: 10px; }
        .mv-ok { background: rgba(74, 222, 128, 0.1); color: var(--success); }
        .mv-fail { background: rgba(233, 69, 96, 0.1); color: var(--danger); }
        .mv-card-meta { font-size: 12px; color: var(--text-muted); display: flex; gap: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mv-card-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .btn-sm { font-size: 12px !important; padding: 4px 10px !important; }
        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 0; color: var(--text-secondary); }
        .empty-state p { margin-top: 12px; font-size: 16px; }
        .empty-hint { font-size: 13px !important; color: var(--text-muted); }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 500; }
        .task-form { background: var(--bg-secondary); border-radius: 12px; padding: 24px; width: 440px; max-width: 90vw; display: flex; flex-direction: column; gap: 14px; border: 1px solid var(--border-default); }
        .task-form h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
        .form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
        select.input { width: 100%; cursor: pointer; }
      `}</style>
    </div>
  );
}
