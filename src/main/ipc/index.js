const { ipcMain } = require('electron');
const { getDatabase, saveToDisk } = require('../database');
const { app } = require('electron');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ============================================
// sql.js helper — 将 db 操作包装为类 better-sqlite3 API
// ============================================

function dbQuery(sql, params = []) {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  persistDB();
  return rows;
}

function dbRun(sql, params = []) {
  const db = getDatabase();
  db.run(sql, params);
  persistDB();
}

function dbGet(sql, params = []) {
  const rows = dbQuery(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function persistDB() {
  try {
    saveToDisk(path.join(app.getPath('userData'), 'ai-efficiency.db'));
  } catch (e) {
    // ignore persist errors
  }
}

// ============================================
// 注册所有 IPC Handlers
// ============================================

function registerIpcHandlers() {
  registerTaskHandlers();
  registerKnowledgeHandlers();
  registerModelHandlers();
  registerVoiceHandlers();
  registerSystemHandlers();
}

// ============================================
// 事项 Handlers
// ============================================

function registerTaskHandlers() {
  ipcMain.handle('task:getAll', (_, params = {}) => {
    const { status, startDate, endDate, limit = 100, offset = 0 } = params;
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const args = [];

    if (status) { sql += ' AND status = ?'; args.push(status); }
    if (startDate) { sql += ' AND start_time >= ?'; args.push(startDate); }
    if (endDate) { sql += ' AND start_time <= ?'; args.push(endDate); }
    sql += ' ORDER BY start_time ASC, priority ASC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    return dbQuery(sql, args);
  });

  ipcMain.handle('task:getById', (_, id) => {
    return dbGet('SELECT * FROM tasks WHERE id = ?', [id]);
  });

  ipcMain.handle('task:create', (_, task) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO tasks (id, title, description, priority, start_time, end_time, location, participants, tags, repeat_rule, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, task.title, task.description || '', task.priority || 'P2',
        task.startTime || null, task.endTime || null, task.location || '',
        JSON.stringify(task.participants || []), JSON.stringify(task.tags || []),
        task.repeatRule ? JSON.stringify(task.repeatRule) : null,
        task.source || 'manual', now, now
      ]
    );
    return dbGet('SELECT * FROM tasks WHERE id = ?', [id]);
  });

  ipcMain.handle('task:update', (_, id, updates) => {
    const fields = [];
    const args = [];
    for (const [key, value] of Object.entries(updates)) {
      const column = camelToSnake(key);
      fields.push(`${column} = ?`);
      args.push(value);
    }
    fields.push('updated_at = ?');
    args.push(new Date().toISOString());
    args.push(id);

    dbRun(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, args);
    return dbGet('SELECT * FROM tasks WHERE id = ?', [id]);
  });

  ipcMain.handle('task:delete', (_, id) => {
    dbRun('DELETE FROM tasks WHERE id = ?', [id]);
    return { success: true };
  });

  ipcMain.handle('task:search', (_, query) => {
    return dbQuery(
      'SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ? ORDER BY start_time DESC LIMIT 50',
      [`%${query}%`, `%${query}%`]
    );
  });

  ipcMain.handle('task:getByDateRange', (_, start, end) => {
    return dbQuery(
      'SELECT * FROM tasks WHERE start_time >= ? AND start_time <= ? ORDER BY start_time ASC',
      [start, end]
    );
  });

  ipcMain.handle('task:complete', (_, id) => {
    const now = new Date().toISOString();
    dbRun(
      "UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
      [now, now, id]
    );
    return dbGet('SELECT * FROM tasks WHERE id = ?', [id]);
  });
}

// ============================================
// 知识库 Handlers
// ============================================

function registerKnowledgeHandlers() {
  ipcMain.handle('knowledge:getAllNodes', (_, params = {}) => {
    const { type, limit = 100, offset = 0 } = params;
    let sql = 'SELECT * FROM knowledge_nodes WHERE 1=1';
    const args = [];
    if (type) { sql += ' AND type = ?'; args.push(type); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);
    return dbQuery(sql, args);
  });

  ipcMain.handle('knowledge:getNodeById', (_, id) => {
    return dbGet('SELECT * FROM knowledge_nodes WHERE id = ?', [id]);
  });

  ipcMain.handle('knowledge:createNode', (_, node) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO knowledge_nodes (id, type, title, content, metadata, source_task_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, node.type, node.title, node.content || '', JSON.stringify(node.metadata || {}), node.sourceTaskId || null, now, now]
    );
    return dbGet('SELECT * FROM knowledge_nodes WHERE id = ?', [id]);
  });

  ipcMain.handle('knowledge:updateNode', (_, id, updates) => {
    const fields = [];
    const args = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      args.push(value);
    }
    fields.push('updated_at = ?');
    args.push(new Date().toISOString());
    args.push(id);
    dbRun(`UPDATE knowledge_nodes SET ${fields.join(', ')} WHERE id = ?`, args);
    return dbGet('SELECT * FROM knowledge_nodes WHERE id = ?', [id]);
  });

  ipcMain.handle('knowledge:deleteNode', (_, id) => {
    dbRun('DELETE FROM knowledge_nodes WHERE id = ?', [id]);
    dbRun('DELETE FROM knowledge_edges WHERE source_id = ? OR target_id = ?', [id, id]);
    return { success: true };
  });

  ipcMain.handle('knowledge:getEdges', () => {
    return dbQuery('SELECT * FROM knowledge_edges ORDER BY created_at DESC');
  });

  ipcMain.handle('knowledge:createEdge', (_, edge) => {
    const id = uuidv4();
    dbRun(
      `INSERT OR IGNORE INTO knowledge_edges (id, source_id, target_id, type, description, weight, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
      [id, edge.sourceId, edge.targetId, edge.type, edge.description || '', edge.weight || 1.0]
    );
    return dbGet('SELECT * FROM knowledge_edges WHERE id = ?', [id]);
  });

  ipcMain.handle('knowledge:deleteEdge', (_, id) => {
    dbRun('DELETE FROM knowledge_edges WHERE id = ?', [id]);
    return { success: true };
  });

  ipcMain.handle('knowledge:search', (_, query) => {
    // sql.js 不支持 FTS5，改用 LIKE 搜索
    return dbQuery(
      'SELECT * FROM knowledge_nodes WHERE title LIKE ? OR content LIKE ? LIMIT 50',
      [`%${query}%`, `%${query}%`]
    );
  });

  ipcMain.handle('knowledge:findSimilar', () => {
    return [];
  });

  ipcMain.handle('knowledge:generateSummary', (_, period) => {
    return { status: 'not_implemented', period };
  });
}

// ============================================
// 模型管理 Handlers
// ============================================

function registerModelHandlers() {
  ipcMain.handle('model:getAll', () => {
    return dbQuery('SELECT * FROM model_configs ORDER BY created_at DESC');
  });

  ipcMain.handle('model:create', (_, model) => {
    const id = uuidv4();
    dbRun(
      `INSERT INTO model_configs (id, name, type, endpoint, api_key_encrypted, model_identifier, extra_params, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
      [id, model.name, model.type, model.endpoint, model.apiKeyEncrypted, model.modelIdentifier, JSON.stringify(model.extraParams || {})]
    );
    return dbGet('SELECT * FROM model_configs WHERE id = ?', [id]);
  });

  ipcMain.handle('model:update', (_, id, updates) => {
    const fields = [];
    const args = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      args.push(value);
    }
    fields.push("updated_at = datetime('now','localtime')");
    args.push(id);
    dbRun(`UPDATE model_configs SET ${fields.join(', ')} WHERE id = ?`, args);
    return dbGet('SELECT * FROM model_configs WHERE id = ?', [id]);
  });

  ipcMain.handle('model:delete', (_, id) => {
    dbRun('DELETE FROM model_configs WHERE id = ?', [id]);
    return { success: true };
  });

  ipcMain.handle('model:testConnection', (_, id) => {
    return { status: 'not_implemented', id };
  });

  ipcMain.handle('model:getBindings', () => {
    return dbQuery('SELECT * FROM scene_bindings');
  });

  ipcMain.handle('model:setBinding', (_, scene, modelId) => {
    const id = uuidv4();
    dbRun(
      `INSERT OR REPLACE INTO scene_bindings (id, scene, model_id, updated_at)
       VALUES (?, ?, ?, datetime('now','localtime'))`,
      [id, scene, modelId]
    );
    return { success: true, scene, modelId };
  });

  ipcMain.handle('model:getUsageStats', (_, period) => {
    return { status: 'not_implemented', period };
  });
}

// ============================================
// 语音 Handlers
// ============================================

function registerVoiceHandlers() {
  ipcMain.handle('voice:transcribe', (_, audioPath) => {
    return { status: 'not_implemented', audioPath };
  });

  ipcMain.handle('voice:getStatus', () => {
    return { state: 'not_initialized', modelLoaded: false };
  });

  ipcMain.handle('voice:speak', () => {
    return { status: 'not_implemented' };
  });
}

// ============================================
// 系统 Handlers
// ============================================

function registerSystemHandlers() {
  ipcMain.handle('system:backup', () => {
    return { status: 'not_implemented' };
  });

  ipcMain.handle('system:restore', () => {
    return { status: 'not_implemented' };
  });

  ipcMain.handle('system:export', () => {
    return { status: 'not_implemented' };
  });

  ipcMain.handle('system:getStorageStats', () => {
    return { status: 'not_implemented' };
  });

  ipcMain.handle('system:getAppVersion', () => {
    return { version: '1.0.0' };
  });
}

// ============================================
// 工具函数
// ============================================

function camelToSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

module.exports = { registerIpcHandlers };
