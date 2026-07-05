const { ipcMain } = require('electron');
const { getDatabase, saveToDisk } = require('../database');
const { app } = require('electron');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function dbAll(sql, params = []) {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  persist();
  return rows;
}

function dbGet(sql, params = []) {
  const rows = dbAll(sql, params);
  return rows[0] || null;
}

function dbRun(sql, params = []) {
  const db = getDatabase();
  db.run(sql, params);
  persist();
}

function persist() {
  try { saveToDisk(path.join(app.getPath('userData'), 'ai-efficiency.db')); } catch {}
}

// ============================================
function registerIpcHandlers() {
  registerTaskHandlers();
  registerKnowledgeHandlers();
  registerModelHandlers();
  registerVoiceHandlers();
  registerSystemHandlers();
}

function registerTaskHandlers() {
  ipcMain.handle('task:getAll', (_, p = {}) => {
    const { status, startDate, endDate, limit = 100, offset = 0 } = p;
    let sql = 'SELECT * FROM tasks WHERE 1=1'; const args = [];
    if (status) { sql += ' AND status = ?'; args.push(status); }
    if (startDate) { sql += ' AND start_time >= ?'; args.push(startDate); }
    if (endDate) { sql += ' AND start_time <= ?'; args.push(endDate); }
    sql += ' ORDER BY start_time ASC, priority ASC LIMIT ? OFFSET ?';
    args.push(limit, offset);
    return dbAll(sql, args);
  });
  ipcMain.handle('task:getById', (_, id) => dbGet('SELECT * FROM tasks WHERE id = ?', [id]));
  ipcMain.handle('task:create', (_, task) => {
    const id = uuidv4(); const now = new Date().toISOString();
    dbRun(`INSERT INTO tasks (id,title,description,priority,start_time,end_time,location,participants,tags,repeat_rule,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, task.title, task.description || '', task.priority || 'P2', task.startTime || null, task.endTime || null, task.location || '',
       JSON.stringify(task.participants || []), JSON.stringify(task.tags || []),
       task.repeatRule ? JSON.stringify(task.repeatRule) : null, task.source || 'manual', now, now]);
    // 桌面通知
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        new Notification({ title: '✅ 事项已创建', body: task.title, silent: true }).show();
      }
    } catch {}
    return dbGet('SELECT * FROM tasks WHERE id = ?', [id]);
  });
  ipcMain.handle('task:update', (_, id, updates) => {
    const fields = []; const args = [];
    for (const [k, v] of Object.entries(updates)) { fields.push(`${camelToSnake(k)} = ?`); args.push(v); }
    fields.push('updated_at = ?'); args.push(new Date().toISOString()); args.push(id);
    dbRun(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, args);
    return dbGet('SELECT * FROM tasks WHERE id = ?', [id]);
  });
  ipcMain.handle('task:delete', (_, id) => { dbRun('DELETE FROM tasks WHERE id = ?', [id]); return { success: true }; });
  ipcMain.handle('task:search', (_, q) => dbAll("SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ? ORDER BY start_time DESC LIMIT 50", [`%${q}%`, `%${q}%`]));
  ipcMain.handle('task:getByDateRange', (_, s, e) => dbAll('SELECT * FROM tasks WHERE start_time >= ? AND start_time <= ? ORDER BY start_time ASC', [s, e]));
  ipcMain.handle('task:complete', (_, id) => {
    const now = new Date().toISOString();
    dbRun("UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
    return dbGet('SELECT * FROM tasks WHERE id = ?', [id]);
  });
}

function registerKnowledgeHandlers() {
  ipcMain.handle('knowledge:getAllNodes', (_, p = {}) => {
    const { type, limit = 100, offset = 0 } = p;
    let sql = 'SELECT * FROM knowledge_nodes WHERE 1=1'; const args = [];
    if (type) { sql += ' AND type = ?'; args.push(type); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'; args.push(limit, offset);
    return dbAll(sql, args);
  });
  ipcMain.handle('knowledge:getNodeById', (_, id) => dbGet('SELECT * FROM knowledge_nodes WHERE id = ?', [id]));
  ipcMain.handle('knowledge:createNode', (_, node) => {
    const id = uuidv4(); const now = new Date().toISOString();
    dbRun('INSERT INTO knowledge_nodes (id,type,title,content,metadata,source_task_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, node.type, node.title, node.content || '', JSON.stringify(node.metadata || {}), node.sourceTaskId || null, now, now]);
    return dbGet('SELECT * FROM knowledge_nodes WHERE id = ?', [id]);
  });
  ipcMain.handle('knowledge:updateNode', (_, id, updates) => {
    const fields = []; const args = [];
    for (const [k, v] of Object.entries(updates)) { fields.push(`${k} = ?`); args.push(v); }
    fields.push('updated_at = ?'); args.push(new Date().toISOString()); args.push(id);
    dbRun(`UPDATE knowledge_nodes SET ${fields.join(', ')} WHERE id = ?`, args);
    return dbGet('SELECT * FROM knowledge_nodes WHERE id = ?', [id]);
  });
  ipcMain.handle('knowledge:deleteNode', (_, id) => {
    dbRun('DELETE FROM knowledge_nodes WHERE id = ?', [id]);
    dbRun('DELETE FROM knowledge_edges WHERE source_id = ? OR target_id = ?', [id, id]);
    return { success: true };
  });
  ipcMain.handle('knowledge:getEdges', () => dbAll('SELECT * FROM knowledge_edges ORDER BY created_at DESC'));
  ipcMain.handle('knowledge:createEdge', (_, edge) => {
    const id = uuidv4();
    dbRun('INSERT OR IGNORE INTO knowledge_edges (id,source_id,target_id,type,description,weight,created_at) VALUES (?,?,?,?,?,?,datetime(\'now\',\'localtime\'))',
      [id, edge.sourceId, edge.targetId, edge.type, edge.description || '', edge.weight || 1.0]);
    return dbGet('SELECT * FROM knowledge_edges WHERE id = ?', [id]);
  });
  ipcMain.handle('knowledge:deleteEdge', (_, id) => { dbRun('DELETE FROM knowledge_edges WHERE id = ?', [id]); return { success: true }; });
  ipcMain.handle('knowledge:search', (_, q) => dbAll('SELECT * FROM knowledge_nodes WHERE title LIKE ? OR content LIKE ? LIMIT 50', [`%${q}%`, `%${q}%`]));
  ipcMain.handle('knowledge:findSimilar', () => []);
  ipcMain.handle('knowledge:generateSummary', (_, period) => ({ status: 'not_implemented', period }));
}

function registerModelHandlers() {
  ipcMain.handle('model:getAll', () => dbAll('SELECT * FROM model_configs ORDER BY created_at DESC'));
  ipcMain.handle('model:create', (_, m) => {
    const id = uuidv4();
    dbRun('INSERT INTO model_configs (id,name,type,endpoint,api_key_encrypted,model_identifier,extra_params,created_at,updated_at) VALUES (?,?,?,?,?,?,?,datetime(\'now\',\'localtime\'),datetime(\'now\',\'localtime\'))',
      [id, m.name, m.type, m.endpoint, m.apiKeyEncrypted, m.modelIdentifier, JSON.stringify(m.extraParams || {})]);
    return dbGet('SELECT * FROM model_configs WHERE id = ?', [id]);
  });
  ipcMain.handle('model:update', (_, id, updates) => {
    const fields = []; const args = [];
    for (const [k, v] of Object.entries(updates)) { fields.push(`${k} = ?`); args.push(v); }
    fields.push("updated_at = datetime('now','localtime')"); args.push(id);
    dbRun(`UPDATE model_configs SET ${fields.join(', ')} WHERE id = ?`, args);
    return dbGet('SELECT * FROM model_configs WHERE id = ?', [id]);
  });
  ipcMain.handle('model:delete', (_, id) => { dbRun('DELETE FROM model_configs WHERE id = ?', [id]); return { success: true }; });
  ipcMain.handle('model:testConnection', (_, id) => ({ status: 'not_implemented', id }));
  ipcMain.handle('model:getBindings', () => dbAll('SELECT * FROM scene_bindings'));
  ipcMain.handle('model:setBinding', (_, scene, modelId) => {
    const id = uuidv4();
    dbRun("INSERT OR REPLACE INTO scene_bindings (id,scene,model_id,updated_at) VALUES (?,?,?,datetime('now','localtime'))", [id, scene, modelId]);
    return { success: true, scene, modelId };
  });
  ipcMain.handle('model:getUsageStats', (_, period) => ({ status: 'not_implemented', period }));
}

function registerVoiceHandlers() {
  const whisperModule = (() => {
    try { return require('../services/whisper-processor'); } catch { return null; }
  })();

  // Auto-detect whisper paths
  const appRoot = path.join(__dirname, '..', '..', '..');
  const exePath = path.join(appRoot, 'resources', 'whisper-cli.exe');
  const modelPath = path.join(appRoot, 'resources', 'models', 'ggml-small.bin');
  let whisperReady = false;

  ipcMain.handle('voice:init', async () => {
    console.log('[IPC] voice:init called, module:', !!whisperModule, 'ready:', whisperReady);
    if (!whisperModule) return { success: false, error: 'Whisper module not available' };
    if (whisperReady) return { success: true, status: whisperModule.whisper.status };
    try {
      console.log('[IPC] Initializing whisper with:', exePath, modelPath);
      await whisperModule.init({
        executablePath: exePath,
        modelPath: modelPath,
        debug: true,
      });
      whisperReady = true;
      console.log('[IPC] Whisper init success, status:', whisperModule.whisper.status);
      return { success: true, status: whisperModule.whisper.status };
    } catch (e) {
      console.error('[IPC] Whisper init failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('voice:transcribe', async (_, audioBase64) => {
    if (!whisperModule || !whisperReady) return { text: '', error: 'Whisper not initialized' };
    try {
      const fs = require('fs');
      const os = require('os');
      // Save as .ogg (webm is essentially ogg container, whisper supports it)
      const tmpFile = path.join(os.tmpdir(), `voice-${Date.now()}.ogg`);
      fs.writeFileSync(tmpFile, Buffer.from(audioBase64, 'base64'));
      console.log('[IPC] Audio saved to:', tmpFile, 'size:', fs.statSync(tmpFile).size);
      const result = await whisperModule.whisper.transcribe(tmpFile);
      try { fs.unlinkSync(tmpFile); } catch {}
      return { text: result.text, confidence: result.confidence };
    } catch (e) {
      return { text: '', error: e.message };
    }
  });

  ipcMain.handle('voice:getStatus', () => {
    if (!whisperModule || !whisperReady) return { state: 'not_available', modelLoaded: false };
    return whisperModule.whisper.status;
  });

  ipcMain.handle('voice:speak', () => ({ status: 'not_implemented' }));
}

function registerSystemHandlers() {
  ipcMain.handle('system:backup', () => ({ status: 'not_implemented' }));
  ipcMain.handle('system:restore', () => ({ status: 'not_implemented' }));
  ipcMain.handle('system:export', () => ({ status: 'not_implemented' }));
  ipcMain.handle('system:getStorageStats', () => ({ status: 'not_implemented' }));
  ipcMain.handle('system:getAppVersion', () => ({ version: '1.0.0' }));
}

function camelToSnake(str) { return str.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`); }

module.exports = { registerIpcHandlers };
