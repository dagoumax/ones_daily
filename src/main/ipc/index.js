const { ipcMain } = require('electron');
const { getDatabase } = require('../database');
const { v4: uuidv4 } = require('uuid');

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
  const db = () => getDatabase();

  ipcMain.handle('task:getAll', (_, params = {}) => {
    const { status, startDate, endDate, limit = 100, offset = 0 } = params;
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const args = [];

    if (status) { sql += ' AND status = ?'; args.push(status); }
    if (startDate) { sql += ' AND start_time >= ?'; args.push(startDate); }
    if (endDate) { sql += ' AND start_time <= ?'; args.push(endDate); }
    sql += ' ORDER BY start_time ASC, priority ASC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    return db().prepare(sql).all(...args);
  });

  ipcMain.handle('task:getById', (_, id) => {
    return db().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  });

  ipcMain.handle('task:create', (_, task) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    const stmt = db().prepare(`
      INSERT INTO tasks (id, title, description, priority, start_time, end_time, location, participants, tags, repeat_rule, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      task.title,
      task.description || '',
      task.priority || 'P2',
      task.startTime || null,
      task.endTime || null,
      task.location || '',
      JSON.stringify(task.participants || []),
      JSON.stringify(task.tags || []),
      task.repeatRule ? JSON.stringify(task.repeatRule) : null,
      task.source || 'manual',
      now,
      now
    );
    return db().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  });

  ipcMain.handle('task:update', (_, id, updates) => {
    const fields = [];
    const args = [];
    for (const [key, value] of Object.entries(updates)) {
      const column = camelToSnake(key);
      fields.push(`${column} = ?`);
      args.push(value);
    }
    fields.push("updated_at = ?");
    args.push(new Date().toISOString());
    args.push(id);

    db().prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...args);
    return db().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  });

  ipcMain.handle('task:delete', (_, id) => {
    db().prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return { success: true };
  });

  ipcMain.handle('task:search', (_, query) => {
    return db().prepare(
      "SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ? ORDER BY start_time DESC LIMIT 50"
    ).all(`%${query}%`, `%${query}%`);
  });

  ipcMain.handle('task:getByDateRange', (_, start, end) => {
    return db().prepare(
      'SELECT * FROM tasks WHERE start_time >= ? AND start_time <= ? ORDER BY start_time ASC'
    ).all(start, end);
  });

  ipcMain.handle('task:complete', (_, id) => {
    const now = new Date().toISOString();
    db().prepare(
      "UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
    ).run(now, now, id);
    return db().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  });
}

// ============================================
// 知识库 Handlers
// ============================================

function registerKnowledgeHandlers() {
  const db = () => getDatabase();

  ipcMain.handle('knowledge:getAllNodes', (_, params = {}) => {
    const { type, limit = 100, offset = 0 } = params;
    let sql = 'SELECT * FROM knowledge_nodes WHERE 1=1';
    const args = [];
    if (type) { sql += ' AND type = ?'; args.push(type); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);
    return db().prepare(sql).all(...args);
  });

  ipcMain.handle('knowledge:getNodeById', (_, id) => {
    return db().prepare('SELECT * FROM knowledge_nodes WHERE id = ?').get(id);
  });

  ipcMain.handle('knowledge:createNode', (_, node) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    db().prepare(`
      INSERT INTO knowledge_nodes (id, type, title, content, metadata, source_task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, node.type, node.title, node.content || '', JSON.stringify(node.metadata || {}), node.sourceTaskId || null, now, now);
    return db().prepare('SELECT * FROM knowledge_nodes WHERE id = ?').get(id);
  });

  ipcMain.handle('knowledge:updateNode', (_, id, updates) => {
    const fields = [];
    const args = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      args.push(value);
    }
    fields.push("updated_at = ?");
    args.push(new Date().toISOString());
    args.push(id);
    db().prepare(`UPDATE knowledge_nodes SET ${fields.join(', ')} WHERE id = ?`).run(...args);
    return db().prepare('SELECT * FROM knowledge_nodes WHERE id = ?').get(id);
  });

  ipcMain.handle('knowledge:deleteNode', (_, id) => {
    db().prepare('DELETE FROM knowledge_nodes WHERE id = ?').run(id);
    db().prepare('DELETE FROM knowledge_edges WHERE source_id = ? OR target_id = ?').run(id, id);
    return { success: true };
  });

  ipcMain.handle('knowledge:getEdges', (_, params = {}) => {
    return db().prepare('SELECT * FROM knowledge_edges ORDER BY created_at DESC').all();
  });

  ipcMain.handle('knowledge:createEdge', (_, edge) => {
    const id = uuidv4();
    db().prepare(`
      INSERT OR IGNORE INTO knowledge_edges (id, source_id, target_id, type, description, weight, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(id, edge.sourceId, edge.targetId, edge.type, edge.description || '', edge.weight || 1.0);
    return db().prepare('SELECT * FROM knowledge_edges WHERE id = ?').get(id);
  });

  ipcMain.handle('knowledge:deleteEdge', (_, id) => {
    db().prepare('DELETE FROM knowledge_edges WHERE id = ?').run(id);
    return { success: true };
  });

  ipcMain.handle('knowledge:search', (_, query) => {
    return db().prepare(
      "SELECT * FROM knowledge_fts WHERE knowledge_fts MATCH ? LIMIT 50"
    ).all(query);
  });

  ipcMain.handle('knowledge:findSimilar', (_, nodeId, k = 5) => {
    // 向量相似度搜索 — 在 M5 阶段完整实现
    // MVP 阶段返回空数组
    return [];
  });

  ipcMain.handle('knowledge:generateSummary', (_, period) => {
    // AI 周期总结 — 在 M6 阶段实现
    return { status: 'not_implemented', period };
  });
}

// ============================================
// 模型管理 Handlers（M4 阶段完整实现）
// ============================================

function registerModelHandlers() {
  const db = () => getDatabase();

  ipcMain.handle('model:getAll', () => {
    return db().prepare('SELECT * FROM model_configs ORDER BY created_at DESC').all();
  });

  ipcMain.handle('model:create', (_, model) => {
    const id = uuidv4();
    db().prepare(`
      INSERT INTO model_configs (id, name, type, endpoint, api_key_encrypted, model_identifier, extra_params, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
    `).run(id, model.name, model.type, model.endpoint, model.apiKeyEncrypted, model.modelIdentifier, JSON.stringify(model.extraParams || {}));
    return db().prepare('SELECT * FROM model_configs WHERE id = ?').get(id);
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
    db().prepare(`UPDATE model_configs SET ${fields.join(', ')} WHERE id = ?`).run(...args);
    return db().prepare('SELECT * FROM model_configs WHERE id = ?').get(id);
  });

  ipcMain.handle('model:delete', (_, id) => {
    db().prepare('DELETE FROM model_configs WHERE id = ?').run(id);
    return { success: true };
  });

  ipcMain.handle('model:testConnection', (_, id) => {
    // M4 阶段实现
    return { status: 'not_implemented', id };
  });

  ipcMain.handle('model:getBindings', () => {
    return db().prepare('SELECT * FROM scene_bindings').all();
  });

  ipcMain.handle('model:setBinding', (_, scene, modelId) => {
    const id = uuidv4();
    db().prepare(`
      INSERT OR REPLACE INTO scene_bindings (id, scene, model_id, updated_at)
      VALUES (?, ?, ?, datetime('now','localtime'))
    `).run(id, scene, modelId);
    return { success: true, scene, modelId };
  });

  ipcMain.handle('model:getUsageStats', (_, period) => {
    // M7 阶段实现详细统计
    return { status: 'not_implemented', period };
  });
}

// ============================================
// 语音 Handlers（M3 阶段完整实现）
// ============================================

function registerVoiceHandlers() {
  ipcMain.handle('voice:transcribe', (_, audioPath) => {
    // M3 阶段实现
    return { status: 'not_implemented', audioPath };
  });

  ipcMain.handle('voice:getStatus', () => {
    return { state: 'not_initialized', modelLoaded: false };
  });

  ipcMain.handle('voice:speak', (_, text, options) => {
    // M6 阶段实现
    return { status: 'not_implemented' };
  });
}

// ============================================
// 系统 Handlers
// ============================================

function registerSystemHandlers() {
  ipcMain.handle('system:backup', () => {
    // M9 阶段实现
    return { status: 'not_implemented' };
  });

  ipcMain.handle('system:restore', (_, backupPath) => {
    return { status: 'not_implemented' };
  });

  ipcMain.handle('system:export', (_, format) => {
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
