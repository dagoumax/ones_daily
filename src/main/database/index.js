const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;

/**
 * 初始化数据库连接和表结构（sql.js — 纯 JS，无需编译）
 */
async function initDatabase() {
  const SQL = await initSqlJs();
  const dbPath = path.join(app.getPath('userData'), 'ai-efficiency.db');

  // 如果已有数据库文件，加载它
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 启用 WAL 模式（sql.js 不支持，跳过）
  db.run('PRAGMA foreign_keys = ON');

  createTables();
  saveToDisk(dbPath);
  console.log(`[Database] Initialized at ${dbPath}`);
  return db;
}

function saveToDisk(dbPath) {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'P2',
      start_time TEXT,
      end_time TEXT,
      location TEXT DEFAULT '',
      participants TEXT DEFAULT '[]',
      repeat_rule TEXT,
      tags TEXT DEFAULT '[]',
      source TEXT DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      completed_at TEXT,
      archived_to_kb INTEGER DEFAULT 0
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_start_time ON tasks(start_time)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)');

  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      metadata TEXT DEFAULT '{}',
      source_task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_kn_type ON knowledge_nodes(type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_kn_source ON knowledge_nodes(source_task_id)');

  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'reference',
      description TEXT DEFAULT '',
      weight REAL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(source_id, target_id, type)
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_ke_source ON knowledge_edges(source_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ke_target ON knowledge_edges(target_id)');

  db.run(`
    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      model_identifier TEXT NOT NULL,
      extra_params TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS scene_bindings (
      id TEXT PRIMARY KEY,
      scene TEXT NOT NULL UNIQUE,
      model_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      scene TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      cost_estimated REAL DEFAULT 0,
      duration_ms INTEGER,
      status TEXT DEFAULT 'success',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_ul_model ON usage_logs(model_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ul_created ON usage_logs(created_at)');

  // sql.js 不支持 FTS5 和触发器，后续知识库搜索用纯 JS 实现
  db.run(`
    CREATE TABLE IF NOT EXISTS vector_embeddings (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      vector TEXT NOT NULL,
      model_name TEXT DEFAULT 'unknown',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_ve_node ON vector_embeddings(node_id)');

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
