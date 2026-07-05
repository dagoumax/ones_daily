/**
 * vector-store.js — 基于 SQLite 的轻量向量存储
 * 
 * 设计思路：
 * - 向量以 Float32Array BLOB 形式存储在 SQLite 中
 * - 搜索时从 SQLite 加载所有向量到内存，用 cosine-similarity.js 计算
 * - 适合 < 50000 条向量的场景
 * 
 * 依赖：better-sqlite3（Electron 主进程）
 */

const Database = require('better-sqlite3');
const { topKSimilarity, fastTopKSimilarity } = require('./cosine-similarity');

class VectorStore {
  /**
   * @param {string} dbPath - SQLite 数据库路径（与主数据库同一文件）
   * @param {object} options
   * @param {number} options.dimension - 向量维度，默认 1024
   */
  constructor(dbPath, options = {}) {
    this.db = new Database(dbPath);
    this.dimension = options.dimension || 1024;
    this._initTable();
  }

  _initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_embeddings (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        vector BLOB NOT NULL,
        model_name TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ve_node ON vector_embeddings(node_id);
    `);
  }

  /**
   * 插入向量
   * @param {string} id - 向量唯一 ID
   * @param {string} nodeId - 关联的知识节点 ID
   * @param {Float32Array} vector - 向量数据
   * @param {string} modelName - 生成向量的 Embedding 模型名
   */
  insert(id, nodeId, vector, modelName = 'unknown') {
    if (vector.length !== this.dimension) {
      throw new Error(`Vector dimension mismatch: expected ${this.dimension}, got ${vector.length}`);
    }
    const buffer = Buffer.from(vector.buffer);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO vector_embeddings (id, node_id, vector, model_name)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, nodeId, buffer, modelName);
  }

  /**
   * 批量插入
   * @param {Array<{id: string, nodeId: string, vector: Float32Array, modelName?: string}>} items
   */
  insertBatch(items) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO vector_embeddings (id, node_id, vector, model_name)
      VALUES (?, ?, ?, ?)
    `);
    const transaction = this.db.transaction((items) => {
      for (const item of items) {
        const buffer = Buffer.from(item.vector.buffer);
        insert.run(item.id, item.nodeId, buffer, item.modelName || 'unknown');
      }
    });
    transaction(items);
  }

  /**
   * 删除向量
   */
  delete(id) {
    this.db.prepare('DELETE FROM vector_embeddings WHERE id = ?').run(id);
  }

  /**
   * 按节点 ID 删除
   */
  deleteByNodeId(nodeId) {
    this.db.prepare('DELETE FROM vector_embeddings WHERE node_id = ?').run(nodeId);
  }

  /**
   * 获取向量数量
   */
  count() {
    return this.db.prepare('SELECT COUNT(*) as cnt FROM vector_embeddings').get().cnt;
  }

  /**
   * 加载所有向量到内存（用于搜索）
   * @returns {Array<{id: string, nodeId: string, vector: Float32Array}>}
   */
  _loadAll() {
    const rows = this.db.prepare('SELECT id, node_id, vector FROM vector_embeddings').all();
    return rows.map(row => ({
      id: row.id,
      nodeId: row.node_id,
      vector: new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.length / 4),
    }));
  }

  /**
   * 向量相似度搜索
   * @param {Float32Array} queryVec - 查询向量
   * @param {number} k - 返回 Top-K
   * @param {boolean} useFast - 是否使用快速近似（> 10000 条时推荐）
   * @returns {Array<{id: string, nodeId: string, similarity: number}>}
   */
  search(queryVec, k = 10, useFast = false) {
    const all = this._loadAll();
    if (all.length === 0) return [];

    const results = useFast
      ? fastTopKSimilarity(queryVec, all, k)
      : topKSimilarity(queryVec, all, k);

    return results.map(r => ({
      id: r.id,
      nodeId: all.find(v => v.id === r.id)?.nodeId || '',
      similarity: r.similarity,
    }));
  }

  /**
   * 获取与指定节点最相似的节点（用于 AI 关联发现）
   * @param {string} nodeId - 源节点 ID
   * @param {number} k
   * @returns {Array<{nodeId: string, similarity: number}>}
   */
  findSimilarNodes(nodeId, k = 5) {
    const source = this.db.prepare(
      'SELECT id, vector FROM vector_embeddings WHERE node_id = ?'
    ).get(nodeId);

    if (!source) return [];

    const queryVec = new Float32Array(
      source.vector.buffer,
      source.vector.byteOffset,
      source.vector.length / 4
    );

    const results = this.search(queryVec, k + 1); // +1 排除自身
    return results
      .filter(r => r.nodeId !== nodeId)
      .slice(0, k);
  }

  /**
   * 获取存储统计
   */
  stats() {
    const count = this.count();
    const size = this.db.prepare(
      "SELECT SUM(LENGTH(vector)) as total FROM vector_embeddings"
    ).get().total || 0;

    return {
      count,
      dimension: this.dimension,
      totalBytes: size,
      estimatedMemoryMB: (count * this.dimension * 4 / 1048576).toFixed(1),
    };
  }

  /**
   * 关闭数据库连接
   */
  close() {
    this.db.close();
  }
}

// ============================================================
// 测试
// ============================================================

if (require.main === module) {
  const path = require('path');
  const fs = require('fs');

  const dbPath = path.join(__dirname, '_test_vectors.db');
  // 清理旧测试数据
  try { fs.unlinkSync(dbPath); } catch (_) {}

  const store = new VectorStore(dbPath, { dimension: 1024 });

  console.log('=== VectorStore 性能测试 ===\n');

  // 插入 5000 条随机向量
  const COUNT = 5000;
  console.log(`插入 ${COUNT} 条向量...`);
  const insertStart = performance.now();

  const items = [];
  for (let i = 0; i < COUNT; i++) {
    const vec = new Float32Array(1024);
    for (let j = 0; j < 1024; j++) {
      vec[j] = (Math.random() * 2) - 1;
    }
    items.push({ id: `v_${i}`, nodeId: `node_${i}`, vector: vec });
  }
  store.insertBatch(items);

  const insertTime = (performance.now() - insertStart).toFixed(0);
  console.log(`✅ 插入完成: ${insertTime}ms`);

  // 搜索测试
  const queryVec = new Float32Array(1024);
  for (let j = 0; j < 1024; j++) {
    queryVec[j] = (Math.random() * 2) - 1;
  }

  console.log('\n精确搜索 Top-10...');
  const searchStart = performance.now();
  const results = store.search(queryVec, 10);
  const searchTime = (performance.now() - searchStart).toFixed(2);
  console.log(`✅ 搜索完成: ${searchTime}ms`);
  console.log(`   Top-1: nodeId=${results[0]?.nodeId}, sim=${results[0]?.similarity.toFixed(4)}`);

  // 统计
  const s = store.stats();
  console.log(`\n存储统计:`);
  console.log(`  向量数: ${s.count}`);
  console.log(`  维度: ${s.dimension}`);
  console.log(`  存储: ${(s.totalBytes / 1048576).toFixed(1)} MB`);
  console.log(`  内存估算: ${s.estimatedMemoryMB} MB`);

  store.close();
  try { fs.unlinkSync(dbPath); } catch (_) {}
  console.log('\n测试完成 ✅');
}

module.exports = { VectorStore };
