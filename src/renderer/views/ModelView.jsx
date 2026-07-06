import React, { useState, useEffect, useCallback } from 'react';
import BrandIcon from '../components/common/BrandIcon';

const MODEL_TYPES = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'ollama', label: 'Ollama (本地)' },
  { value: 'custom', label: '自定义' },
];

const INITIAL_FORM = { name: '', type: 'openai', endpoint: '', apiKeyEncrypted: '', modelIdentifier: '' };

// 预设主流模型 — 用户只需选模型 + 填 Key
// 数据来源：各厂商官方文档（2026.07 验证）
// OpenAI: https://platform.openai.com/docs/models
// Anthropic: https://docs.anthropic.com/en/docs/about-claude/models
// Google: https://ai.google.dev/models/gemini
// DeepSeek: https://api.deepseek.com
// 智谱: https://docs.bigmodel.cn/cn/guide/start/model-overview
// 通义千问: https://help.aliyun.com/zh/model-studio/models
// Kimi: https://platform.moonshot.cn/docs
// MiMo: https://api.mimo.mi.com
const PRESET_MODELS = [
  // ── OpenAI ──
  { id: 'gpt-5.5',       name: 'GPT-5.5',         brand: 'openai',    type: 'openai', endpoint: 'https://api.openai.com/v1',        model: 'gpt-5.5',             color: '#10a37f' },
  { id: 'gpt-5.4',       name: 'GPT-5.4',         brand: 'openai',    type: 'openai', endpoint: 'https://api.openai.com/v1',        model: 'gpt-5.4',             color: '#10a37f' },
  { id: 'gpt-5.4-mini',  name: 'GPT-5.4 Mini',    brand: 'openai',    type: 'openai', endpoint: 'https://api.openai.com/v1',        model: 'gpt-5.4-mini',        color: '#10a37f' },

  // ── Anthropic Claude ──
  { id: 'claude-fable-5',  name: 'Claude Fable 5',   brand: 'anthropic', type: 'openai', endpoint: 'https://api.anthropic.com/v1', model: 'claude-fable-5',      color: '#d97706' },
  { id: 'claude-opus-4.8', name: 'Claude Opus 4.8',  brand: 'anthropic', type: 'openai', endpoint: 'https://api.anthropic.com/v1', model: 'claude-opus-4-8',     color: '#d97706' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5',  brand: 'anthropic', type: 'openai', endpoint: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5',     color: '#d97706' },

  // ── Google Gemini ──
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', brand: 'google',   type: 'openai', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.5-flash',     color: '#4285f4' },
  { id: 'gemini-3.1-pro',   name: 'Gemini 3.1 Pro',   brand: 'google',   type: 'openai', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-pro-preview', color: '#4285f4' },

  // ── DeepSeek ──
  { id: 'deepseek-v4-pro',  name: 'DeepSeek V4 Pro',  brand: 'deepseek',  type: 'openai', endpoint: 'https://api.deepseek.com',     model: 'deepseek-v4-pro',    color: '#4f46e5' },
  { id: 'deepseek-v4-flash',name: 'DeepSeek V4 Flash',brand: 'deepseek',  type: 'openai', endpoint: 'https://api.deepseek.com',     model: 'deepseek-v4-flash',  color: '#4f46e5' },

  // ── 阿里通义千问 ──
  { id: 'qwen3.7-max',   name: 'Qwen3.7 Max',     brand: 'qwen',       type: 'openai', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-max',   color: '#6366f1' },
  { id: 'qwen3.7-plus',  name: 'Qwen3.7 Plus',    brand: 'qwen',       type: 'openai', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-plus',  color: '#6366f1' },
  { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash',   brand: 'qwen',       type: 'openai', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.6-flash', color: '#6366f1' },

  // ── 智谱 GLM ──
  { id: 'glm-5.2',       name: 'GLM-5.2',         brand: 'chatglm',    type: 'openai', endpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2',          color: '#059669' },
  { id: 'glm-4.7',       name: 'GLM-4.7',         brand: 'chatglm',    type: 'openai', endpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7',          color: '#059669' },
  { id: 'glm-4.7-flashx',name: 'GLM-4.7 FlashX',  brand: 'chatglm',    type: 'openai', endpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flashx',   color: '#059669' },

  // ── Kimi（月之暗面）──
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code',  brand: 'moonshot',   type: 'openai', endpoint: 'https://api.moonshot.cn/v1',       model: 'kimi-k2.7-code',     color: '#1e1e1e' },
  { id: 'kimi-k2.6',      name: 'Kimi K2.6',       brand: 'moonshot',   type: 'openai', endpoint: 'https://api.moonshot.cn/v1',       model: 'kimi-k2.6',          color: '#1e1e1e' },

  // ── 小米 MiMo ──
  { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro',   brand: 'xiaomimimo', type: 'openai', endpoint: 'https://api.mimo.mi.com/v1',        model: 'mimo-v2.5-pro',      color: '#ff6900' },
  { id: 'mimo-v2.5',     name: 'MiMo V2.5',       brand: 'xiaomimimo', type: 'openai', endpoint: 'https://api.mimo.mi.com/v1',        model: 'mimo-v2.5',          color: '#ff6900' },

  // ── 本地 Ollama ──
  { id: 'ollama',       name: 'Ollama 本地',      brand: 'ollama',     type: 'ollama', endpoint: 'http://localhost:11434',           model: 'llama3.1',           color: '#f59e0b' },
];

export default function ModelView() {
  const [models, setModels] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [testing, setTesting] = useState({});
  const [testResult, setTestResult] = useState({});
  const [quickModel, setQuickModel] = useState(null); // 当前选中的预设模型
  const [quickKey, setQuickKey] = useState('');

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

  // 快捷添加预设模型
  const handleQuickAdd = async () => {
    if (!quickModel || !quickKey.trim()) return;
    try {
      await window.electronAPI?.models.create({
        name: quickModel.name,
        type: quickModel.type,
        endpoint: quickModel.endpoint,
        apiKeyEncrypted: quickKey.trim(),
        modelIdentifier: quickModel.model,
        extraParams: {},
      });
      setQuickModel(null);
      setQuickKey('');
      loadModels();
    } catch (e) {
      console.error('Quick add failed:', e);
    }
  };

  // 检查预设模型是否已配置
  const isPresetConfigured = (preset) => {
    return models.some(m =>
      m.endpoint === preset.endpoint &&
      (m.model_identifier === preset.model || m.name === preset.name)
    );
  };

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

      {/* 快捷配置 */}
      <div className="mv-quick-section">
        <div className="mv-quick-header">
          <span>⚡ 快捷配置</span>
          <span className="mv-quick-hint">选择模型，输入 API Key 即可一键添加</span>
        </div>
        <div className="mv-quick-grid">
          {PRESET_MODELS.map(p => {
            const configured = isPresetConfigured(p);
            return (
              <button
                key={p.id}
                className={`mv-quick-card ${configured ? 'mv-quick-configured' : ''} ${quickModel?.id === p.id ? 'mv-quick-selected' : ''}`}
                onClick={() => { setQuickModel(p); setQuickKey(''); }}
                style={{ '--card-color': p.color }}
              >
                <span className="mv-quick-icon">
                  <BrandIcon brand={p.brand} size={18} color={p.color} />
                </span>
                <span className="mv-quick-name">{p.name}</span>
                {configured && <span className="mv-quick-check">✓</span>}
              </button>
            );
          })}
        </div>

        {/* 选中预设后的 Key 输入面板 */}
        {quickModel && (
          <div className="mv-quick-panel">
            <div className="mv-quick-panel-header">
              <span><BrandIcon brand={quickModel.brand} size={18} color={quickModel.color} /> {quickModel.name}</span>
              <span className="mv-quick-endpoint">{quickModel.endpoint}</span>
            </div>
            <div className="mv-quick-panel-body">
              <input
                className="input"
                type="password"
                placeholder={`输入 ${quickModel.name} 的 API Key`}
                value={quickKey}
                onChange={e => setQuickKey(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }}
                autoFocus
              />
              <div className="mv-quick-panel-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => setQuickModel(null)}>取消</button>
                <button className="btn btn-primary btn-sm" onClick={handleQuickAdd} disabled={!quickKey.trim()}>
                  一键添加
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
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
        .mv-header h1 { font-size: var(--text-xl); font-weight: 600; }
        .mv-subtitle { font-size: var(--text-sm); color: var(--text-muted); margin-top: 4px; }
        .mv-stats { display: flex; gap: 16px; margin-bottom: 20px; flex-shrink: 0; }
        .mv-stat-item { flex: 1; background: var(--bg-surface); border-radius: var(--radius-md); padding: 14px; text-align: center; }
        .mv-stat-num { display: block; font-size: var(--text-xl); font-weight: 700; color: var(--accent); }
        .mv-stat-label { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

        /* 快捷配置 */
        .mv-quick-section { margin-bottom: 20px; flex-shrink: 0; }
        .mv-quick-header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
        .mv-quick-hint { font-size: 12px; font-weight: 400; color: var(--text-muted); }
        .mv-quick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; }
        .mv-quick-card {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 12px;
          border: 1px solid var(--border-default); border-radius: var(--radius-md);
          background: var(--bg-surface); color: var(--text-secondary);
          cursor: pointer; font-size: var(--text-sm); font-family: inherit;
          transition: all 0.15s; position: relative;
        }
        .mv-quick-card:hover { border-color: var(--card-color, var(--accent)); color: var(--text-primary); background: var(--bg-elevated); }
        .mv-quick-card.mv-quick-selected { border-color: var(--card-color, var(--accent)); box-shadow: inset 0 0 0 1px var(--card-color, var(--accent)); }
        .mv-quick-card.mv-quick-configured { opacity: 0.6; }
        .mv-quick-icon { display: flex; align-items: center; flex-shrink: 0; }
        .mv-quick-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mv-quick-check { position: absolute; top: 4px; right: 6px; font-size: var(--text-xs); color: var(--success); }
        .mv-quick-panel {
          margin-top: 10px; padding: 14px;
          background: var(--bg-surface); border: 1px solid var(--border-default);
          border-radius: var(--radius-md); border-left: 3px solid var(--card-color, var(--accent));
        }
        .mv-quick-panel-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: var(--text-base); font-weight: 600; }
        .mv-quick-endpoint { font-size: var(--text-xs); color: var(--text-muted); font-weight: 400; }
        .mv-quick-panel-body { display: flex; gap: 8px; align-items: center; }
        .mv-quick-panel-body .input { flex: 1; }
        .mv-quick-panel-actions { display: flex; gap: 6px; flex-shrink: 0; }

        .mv-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
        .mv-card { background: var(--bg-surface); border-radius: var(--radius-md); padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; transition: background 0.15s; }
        .mv-card:hover { background: var(--bg-elevated); }
        .mv-card-main { flex: 1; min-width: 0; }
        .mv-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
        .mv-card-header h3 { font-size: var(--text-base); font-weight: 600; }
        .mv-type-badge { font-size: var(--text-xs); padding: 1px 8px; border-radius: var(--radius-md); font-weight: 500; }
        .mv-type-openai { background: rgba(74, 222, 128, 0.15); color: var(--success); }
        .mv-type-ollama { background: rgba(79, 195, 247, 0.15); color: var(--accent); }
        .mv-type-custom { background: rgba(107, 114, 128, 0.15); color: var(--text-muted); }
        .mv-status { font-size: var(--text-xs); padding: 1px 8px; border-radius: var(--radius-md); }
        .mv-ok { background: rgba(74, 222, 128, 0.1); color: var(--success); }
        .mv-fail { background: rgba(233, 69, 96, 0.1); color: var(--danger); }
        .mv-card-meta { font-size: 12px; color: var(--text-muted); display: flex; gap: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mv-card-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .task-form { width: 440px; }
      `}</style>
    </div>
  );
}
