const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db = null;

async function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'ai-efficiency.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('page_size = 8192');
  db.pragma('cache_size = -64000');

  createTables();
  console.log(`[Database] Initialized at ${dbPath}`);
  return db;
}

function createTables() {
  db.exec(`
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
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_start_time ON tasks(start_time);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);

    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      metadata TEXT DEFAULT '{}',
      source_task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_kn_type ON knowledge_nodes(type);
    CREATE INDEX IF NOT EXISTS idx_kn_source ON knowledge_nodes(source_task_id);

    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'reference',
      description TEXT DEFAULT '',
      weight REAL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(source_id, target_id, type)
    );
    CREATE INDEX IF NOT EXISTS idx_ke_source ON knowledge_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_ke_target ON knowledge_edges(target_id);

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
    );

    CREATE TABLE IF NOT EXISTS scene_bindings (
      id TEXT PRIMARY KEY,
      scene TEXT NOT NULL UNIQUE,
      model_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

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
    );
    CREATE INDEX IF NOT EXISTS idx_ul_model ON usage_logs(model_id);
    CREATE INDEX IF NOT EXISTS idx_ul_created ON usage_logs(created_at);

    CREATE TABLE IF NOT EXISTS vector_embeddings (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      vector BLOB NOT NULL,
      model_name TEXT DEFAULT 'unknown',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_ve_node ON vector_embeddings(node_id);
  `);

  console.log('[Database] Tables created successfully');
}

function getDatabase() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('[Database] Closed');
  }
}

module.exports = { initDatabase, getDatabase, closeDatabase };
