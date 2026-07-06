const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;

async function initDatabase() {
  // sql.js needs to locate its WASM file. In Electron/Node, we pass the path explicitly.
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  const dbPath = path.join(app.getPath('userData'), 'ai-efficiency.db');

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');
  createTables();
  saveToDisk(dbPath);
  console.log(`[Database] Initialized at ${dbPath}`);
  return db;
}

function saveToDisk(dbPath) {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function createTables() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', priority TEXT NOT NULL DEFAULT 'P2',
      start_time TEXT, end_time TEXT, location TEXT DEFAULT '',
      participants TEXT DEFAULT '[]', repeat_rule TEXT, tags TEXT DEFAULT '[]',
      source TEXT DEFAULT 'manual', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      completed_at TEXT, archived_to_kb INTEGER DEFAULT 0)`,
    'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_start_time ON tasks(start_time)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)',
    `CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, content TEXT DEFAULT '',
      metadata TEXT DEFAULT '{}', source_task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
    'CREATE INDEX IF NOT EXISTS idx_kn_type ON knowledge_nodes(type)',
    'CREATE INDEX IF NOT EXISTS idx_kn_source ON knowledge_nodes(source_task_id)',
    `CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'reference', description TEXT DEFAULT '',
      weight REAL DEFAULT 1.0, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(source_id, target_id, type))`,
    'CREATE INDEX IF NOT EXISTS idx_ke_source ON knowledge_edges(source_id)',
    'CREATE INDEX IF NOT EXISTS idx_ke_target ON knowledge_edges(target_id)',
    `CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      endpoint TEXT NOT NULL, api_key_encrypted TEXT NOT NULL,
      model_identifier TEXT NOT NULL, extra_params TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS scene_bindings (
      id TEXT PRIMARY KEY, scene TEXT NOT NULL UNIQUE, model_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY, model_id TEXT NOT NULL, scene TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0,
      cost_estimated REAL DEFAULT 0, duration_ms INTEGER, status TEXT DEFAULT 'success',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
    'CREATE INDEX IF NOT EXISTS idx_ul_model ON usage_logs(model_id)',
    'CREATE INDEX IF NOT EXISTS idx_ul_created ON usage_logs(created_at)',
    `CREATE TABLE IF NOT EXISTS vector_embeddings (
      id TEXT PRIMARY KEY, node_id TEXT NOT NULL, vector TEXT NOT NULL,
      model_name TEXT DEFAULT 'unknown', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
    'CREATE INDEX IF NOT EXISTS idx_ve_node ON vector_embeddings(node_id)',
    // AI 对话记录表
    `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      intent TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
    'CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id)',
    'CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations(created_at)',
    // AI 决策记录表（用于学习用户偏好）
    `CREATE TABLE IF NOT EXISTS ai_decisions (
      id TEXT PRIMARY KEY,
      scene TEXT NOT NULL,
      input_context TEXT,
      ai_suggestion TEXT,
      user_choice TEXT,
      accepted INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
    'CREATE INDEX IF NOT EXISTS idx_aid_scene ON ai_decisions(scene)',
    // 用户画像表
    `CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY DEFAULT 'default',
      work_hours_start TEXT DEFAULT '09:00',
      work_hours_end TEXT DEFAULT '18:00',
      default_priority TEXT DEFAULT 'P2',
      common_tags TEXT DEFAULT '[]',
      preferences TEXT DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`,
  ];
  stmts.forEach(s => db.run(s));
  console.log('[Database] Tables created successfully');
}

function getDatabase() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function closeDatabase() {
  if (db) {
    const dbPath = path.join(app.getPath('userData'), 'ai-efficiency.db');
    saveToDisk(dbPath);
    db.close();
    db = null;
    console.log('[Database] Closed');
  }
}

module.exports = { initDatabase, getDatabase, closeDatabase, saveToDisk };
