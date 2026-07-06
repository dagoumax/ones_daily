const { ipcMain } = require('electron');
const { getDatabase, saveToDisk } = require('../database');
const { app } = require('electron');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { callLLM, buildTaskCreationPrompt, parseLLMResponse, getDefaultModel } = require('../services/llmService');

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
function registerIpcHandlers(mainWindow) {
  registerTaskHandlers();
  registerKnowledgeHandlers();
  registerModelHandlers();
  registerVoiceHandlers();
  registerSystemHandlers();
  registerAiHandlers(mainWindow);
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
  ipcMain.handle('model:testConnection', async (_, id) => {
    const model = dbGet('SELECT * FROM model_configs WHERE id = ?', [id]);
    if (!model) return { success: false, error: '模型不存在' };

    const startTime = Date.now();
    try {
      const response = await testModelConnection(model);
      const latency = Date.now() - startTime;
      return { success: true, latency, ...response };
    } catch (e) {
      const latency = Date.now() - startTime;
      return { success: false, error: e.message, latency };
    }
  });
  ipcMain.handle('model:getBindings', () => dbAll('SELECT * FROM scene_bindings'));
  ipcMain.handle('model:setBinding', (_, scene, modelId) => {
    const id = uuidv4();
    dbRun("INSERT OR REPLACE INTO scene_bindings (id,scene,model_id,updated_at) VALUES (?,?,?,datetime('now','localtime'))", [id, scene, modelId]);
    return { success: true, scene, modelId };
  });
  ipcMain.handle('model:getUsageStats', (_, period = '7d') => {
    const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const logs = dbAll(
      'SELECT model_id, COUNT(*) as calls, SUM(prompt_tokens) as total_prompt, SUM(completion_tokens) as total_completion, SUM(cost_estimated) as total_cost, AVG(duration_ms) as avg_duration FROM usage_logs WHERE created_at >= ? GROUP BY model_id',
      [since]
    );
    const total = dbGet(
      'SELECT COUNT(*) as total_calls, SUM(cost_estimated) as total_cost FROM usage_logs WHERE created_at >= ?',
      [since]
    );
    return {
      period,
      since,
      models: logs,
      totalCalls: total?.total_calls || 0,
      totalCost: total?.total_cost || 0,
    };
  });
}

function registerVoiceHandlers() {
  const whisperModule = (() => {
    try { return require('../services/whisper-processor'); } catch { return null; }
  })();

  // Auto-detect whisper paths
  // Directory layout:
  //   resources/
  //   ├── whisper/            ← whisper.cpp executable + DLLs
  //   │   ├── whisper-cli.exe
  //   │   └── ggml-*.dll
  //   ├── models/             ← whisper model files
  //   │   └── ggml-small.bin
  //   └── tray-icon.png
  const appRoot = path.join(__dirname, '..', '..', '..');
  const exePath = path.join(appRoot, 'resources', 'whisper', 'whisper-cli.exe');
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
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      console.log('[IPC] Audio buffer size:', audioBuffer.length, 'bytes');
      const result = await whisperModule.whisper.transcribeBuffer(audioBuffer);
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

// ============================================
// AI 智能对话引擎（Phase 0 骨架）
// ============================================
function registerAiHandlers(mainWindow) {
  // ai:chat — 真实 LLM 调用
  ipcMain.handle('ai:chat', async (_, { message, sessionId, history, existingSlots }) => {
    const session = sessionId || uuidv4();
    const startTime = Date.now();
    
    try {
      // 1. 获取默认模型
      const model = getDefaultModel();
      if (!model) {
        return { 
          success: false, 
          error: '未配置 AI 模型', 
          fallback: true,
          sessionId: session 
        };
      }
      
      // 2. 构建 Prompt
      const { messages } = buildTaskCreationPrompt(message, existingSlots);
      
      // 3. 注入对话历史（如果有）
      if (history && history.length > 0) {
        const historyMsgs = history.map(h => ({ role: h.role, content: h.content }));
        messages.splice(1, 0, ...historyMsgs);
      }
      
      // 4. 保存用户消息
      dbRun(
        'INSERT INTO conversations (id, session_id, role, content, intent, metadata) VALUES (?,?,?,?,?,?)',
        [uuidv4(), session, 'user', message, 'chat', JSON.stringify({ existingSlots: existingSlots || {} })]
      );
      
      // 5. 调用 LLM
      const result = await callLLM(model, messages, { temperature: 0.1, maxTokens: 1024 });
      const durationMs = Date.now() - startTime;
      
      // 6. 解析响应
      const parsed = parseLLMResponse(result.content);
      
      if (!parsed) {
        // JSON 解析失败，重试一次
        const retryResult = await callLLM(model, messages, { temperature: 0, maxTokens: 1024 });
        const retryParsed = parseLLMResponse(retryResult.content);
        
        if (!retryParsed) {
          // 两次都失败，记录并降级
          dbRun(
            'INSERT INTO conversations (id, session_id, role, content, intent, metadata) VALUES (?,?,?,?,?,?)',
            [uuidv4(), session, 'assistant', result.content, 'parse_error', JSON.stringify({ durationMs, error: 'JSON parse failed' })]
          );
          return {
            success: false,
            error: 'AI 响应解析失败',
            fallback: true,
            sessionId: session,
            rawContent: result.content.slice(0, 200),
          };
        }
        
        // 重试成功
        const retryDurationMs = Date.now() - startTime;
        const replyContent = buildReplyContent(retryParsed);
        const replyId = uuidv4();
        dbRun(
          'INSERT INTO conversations (id, session_id, role, content, intent, metadata) VALUES (?,?,?,?,?,?)',
          [replyId, session, 'assistant', replyContent, retryParsed.intent, JSON.stringify({
            slots: retryParsed.slots, durationMs: retryDurationMs,
            promptTokens: retryResult.promptTokens, completionTokens: retryResult.completionTokens
          })]
        );
        
        recordUsage(model.id, 'chat', retryResult.promptTokens, retryResult.completionTokens, retryDurationMs);
        
        return buildChatResponse(retryParsed, replyContent, session);
      }
      
      // 7. 构建回复
      const replyContent = buildReplyContent(parsed);
      const replyId = uuidv4();
      dbRun(
        'INSERT INTO conversations (id, session_id, role, content, intent, metadata) VALUES (?,?,?,?,?,?)',
        [replyId, session, 'assistant', replyContent, parsed.intent, JSON.stringify({
          slots: parsed.slots, durationMs,
          promptTokens: result.promptTokens, completionTokens: result.completionTokens
        })]
      );
      
      // 8. 记录 usage_logs
      recordUsage(model.id, 'chat', result.promptTokens, result.completionTokens, durationMs);
      
      return buildChatResponse(parsed, replyContent, session);
      
    } catch (e) {
      const durationMs = Date.now() - startTime;
      console.error('[ai:chat] Error:', e.message);
      
      // 记录错误
      try {
        dbRun(
          'INSERT INTO conversations (id, session_id, role, content, intent, metadata) VALUES (?,?,?,?,?,?)',
          [uuidv4(), session, 'assistant', e.message, 'error', JSON.stringify({ durationMs, error: e.message })]
        );
      } catch (_) {}
      
      return {
        success: false,
        error: e.message,
        fallback: true,
        sessionId: session,
      };
    }
  });

  // ai:chatStream — 流式输出（骨架：直接发送占位内容）
  ipcMain.handle('ai:chatStream', async (_, { message, sessionId }) => {
    const session = sessionId || uuidv4();
    dbRun(
      'INSERT INTO conversations (id, session_id, role, content, intent) VALUES (?,?,?,?,?)',
      [uuidv4(), session, 'user', message, 'chat']
    );
    // 模拟流式输出
    const placeholder = 'AI 流式回复占位内容...';
    if (mainWindow && !mainWindow.isDestroyed()) {
      for (let i = 0; i < placeholder.length; i++) {
        mainWindow.webContents.send('ai:chatStream', placeholder[i]);
        await new Promise(r => setTimeout(r, 30));
      }
    }
    const replyId = uuidv4();
    dbRun(
      'INSERT INTO conversations (id, session_id, role, content, intent) VALUES (?,?,?,?,?)',
      [replyId, session, 'assistant', placeholder, 'chat']
    );
    return { sessionId: session };
  });

  // ai:getConversation — 获取历史对话
  ipcMain.handle('ai:getConversation', (_, sessionId) => {
    const rows = dbAll(
      'SELECT * FROM conversations WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId]
    );
    return { sessionId, messages: rows };
  });

  // ai:clearConversation — 清除对话
  ipcMain.handle('ai:clearConversation', (_, sessionId) => {
    dbRun('DELETE FROM conversations WHERE session_id = ?', [sessionId]);
    return { success: true };
  });

  // ai:brief — 每日播报（骨架：查询今日任务 + 统计）
  ipcMain.handle('ai:brief', () => {
    const today = new Date().toISOString().slice(0, 10);
    const todayTasks = dbAll(
      "SELECT * FROM tasks WHERE date(start_time) = date(?) ORDER BY start_time ASC",
      [today]
    );
    const completedToday = todayTasks.filter(t => t.status === 'completed').length;
    const pendingToday = todayTasks.filter(t => t.status !== 'completed').length;

    // 上周统计（骨架）
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const weekTasks = dbAll(
      'SELECT status, COUNT(*) as count FROM tasks WHERE date(start_time) >= date(?) AND date(start_time) < date(?) GROUP BY status',
      [weekAgo, today]
    );
    const weekCompleted = weekTasks.find(r => r.status === 'completed')?.count || 0;
    const weekTotal = weekTasks.reduce((sum, r) => sum + r.count, 0);

    return {
      date: today,
      todayTasks,
      todayStats: { total: todayTasks.length, completed: completedToday, pending: pendingToday },
      lastWeekStats: { total: weekTotal, completed: weekCompleted },
      message: '今日播报骨架数据',
    };
  });

  // ai:review — 每日复盘（骨架：查询完成/未完成任务）
  ipcMain.handle('ai:review', () => {
    const today = new Date().toISOString().slice(0, 10);
    const todayTasks = dbAll(
      "SELECT * FROM tasks WHERE date(start_time) = date(?) ORDER BY start_time ASC",
      [today]
    );
    const completedTasks = todayTasks.filter(t => t.status === 'completed');
    const pendingTasks = todayTasks.filter(t => t.status !== 'completed');

    // 明日任务（骨架：查询明天的任务）
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const tomorrowTasks = dbAll(
      "SELECT * FROM tasks WHERE date(start_time) = date(?) ORDER BY start_time ASC",
      [tomorrow]
    );

    return {
      date: today,
      completed: completedTasks,
      pending: pendingTasks,
      tomorrow: tomorrowTasks,
      stats: {
        completedCount: completedTasks.length,
        pendingCount: pendingTasks.length,
        completionRate: todayTasks.length > 0 
          ? Math.round((completedTasks.length / todayTasks.length) * 100) 
          : 0,
      },
      message: '每日复盘骨架数据',
    };
  });

  // ai:getSuggestions — 槽位补全建议（骨架：返回空建议）
  ipcMain.handle('ai:getSuggestions', (_, { partialTask, context }) => {
    return {
      suggestions: {
        title: partialTask?.title ? [] : ['建议填写标题'],
        priority: partialTask?.priority || 'P2',
        startTime: partialTask?.startTime || null,
        endTime: partialTask?.endTime || null,
        tags: partialTask?.tags || [],
      },
      message: '槽位补全骨架数据',
    };
  });

  // ai:getUserProfile — 获取用户画像
  ipcMain.handle('ai:getUserProfile', () => {
    let profile = dbGet("SELECT * FROM user_profile WHERE id = 'default'");
    if (!profile) {
      // 首次访问时创建默认画像
      dbRun(
        "INSERT OR IGNORE INTO user_profile (id, work_hours_start, work_hours_end, default_priority, common_tags, preferences) VALUES ('default','09:00','18:00','P2','[]','{}')"
      );
      profile = dbGet("SELECT * FROM user_profile WHERE id = 'default'");
    }
    // 解析 JSON 字段
    return {
      ...profile,
      common_tags: safeJsonParse(profile.common_tags, []),
      preferences: safeJsonParse(profile.preferences, {}),
    };
  });

  // ai:updateUserProfile — 更新用户画像
  ipcMain.handle('ai:updateUserProfile', (_, updates) => {
    const existing = dbGet("SELECT * FROM user_profile WHERE id = 'default'");
    if (!existing) {
      dbRun(
        "INSERT INTO user_profile (id, work_hours_start, work_hours_end, default_priority, common_tags, preferences) VALUES ('default','09:00','18:00','P2','[]','{}')"
      );
    }
    const fields = [];
    const args = [];
    for (const [k, v] of Object.entries(updates)) {
      const col = camelToSnake(k);
      fields.push(`${col} = ?`);
      args.push(typeof v === 'object' ? JSON.stringify(v) : v);
    }
    fields.push("updated_at = datetime('now','localtime')");
    args.push('default');
    dbRun(`UPDATE user_profile SET ${fields.join(', ')} WHERE id = ?`, args);
    const profile = dbGet("SELECT * FROM user_profile WHERE id = 'default'");
    return {
      ...profile,
      common_tags: safeJsonParse(profile.common_tags, []),
      preferences: safeJsonParse(profile.preferences, {}),
    };
  });
}

function camelToSnake(str) { return str.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`); }

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// 辅助：构建 AI 回复文本
function buildReplyContent(parsed) {
  if (parsed.intent === 'unknown' || parsed.confidence < 0.7) {
    return "抱歉，我不太理解。你可以试试说'明天下午开会'或'帮我记一下买牛奶'";
  }
  if (parsed.intent !== 'create_task') {
    return '此功能将在后续版本支持。现在可以试试创建任务，比如"明天下午3点开会"';
  }
  if (parsed.missing_fields && parsed.missing_fields.length > 0) {
    return parsed.follow_up_question || `请补充以下信息：${parsed.missing_fields.join('、')}`;
  }
  // 槽位完整，确认卡片由前端渲染
  return null; // null 表示需要展示确认卡片
}

// 辅助：构建 IPC 响应
function buildChatResponse(parsed, replyContent, session) {
  return {
    success: true,
    intent: parsed.intent,
    confidence: parsed.confidence,
    slots: parsed.slots || null,
    missingFields: parsed.missing_fields || [],
    followUpQuestion: parsed.follow_up_question || null,
    reply: replyContent,
    confirmCard: parsed.intent === 'create_task' && (!parsed.missing_fields || parsed.missing_fields.length === 0),
    sessionId: session,
  };
}

// 辅助：记录使用日志
function recordUsage(modelId, scene, promptTokens, completionTokens, durationMs) {
  try {
    const costEstimated = (promptTokens * 0.000001 + completionTokens * 0.000002);
    dbRun(
      'INSERT INTO usage_logs (id, model_id, scene, prompt_tokens, completion_tokens, cost_estimated, duration_ms, status) VALUES (?,?,?,?,?,?,?,?)',
      [uuidv4(), modelId, scene, promptTokens, completionTokens, costEstimated, durationMs, 'success']
    );
  } catch (e) {
    console.error('[ai:chat] Failed to record usage:', e.message);
  }
}

// ============================================
// 模型连接测试
// ============================================
async function testModelConnection(model) {
  const https = require('https');
  const http = require('http');
  const url = require('url');

  const parsedUrl = url.parse(model.endpoint);
  const isHttps = parsedUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const isAnthropic = parsedUrl.hostname.includes('anthropic');
  const isDeepSeek = parsedUrl.hostname.includes('deepseek');
  const basePath = (parsedUrl.path || '/').replace(/\/$/, '');

  // 各厂商 chat completions 路径不同
  let path;
  if (isAnthropic) {
    path = '/v1/messages';
  } else if (isDeepSeek) {
    // DeepSeek: /chat/completions (不带 /v1)
    path = basePath + '/chat/completions';
  } else if (/\/v1$/.test(basePath) || /\/v1beta$/.test(basePath)) {
    // 已含 /v1 或 /v1beta 的 endpoint
    path = basePath + '/chat/completions';
  } else {
    // 默认 OpenAI 兼容路径
    path = basePath + '/v1/chat/completions';
  }

  const postData = JSON.stringify(isAnthropic ? {
    model: model.model_identifier || 'claude-sonnet-5',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  } : {
    model: model.model_identifier || 'default',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  });

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path,
    method: 'POST',
    timeout: 10000,
    headers: isAnthropic ? {
      'x-api-key': model.api_key_encrypted || '',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    } : {
      'Authorization': `Bearer ${model.api_key_encrypted || ''}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode, message: '连接成功' });
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error(`认证失败 (HTTP ${res.statusCode})`));
        } else {
          let detail = '';
          try { detail = JSON.parse(body).error?.message || body.slice(0, 200); } catch (_) { detail = body.slice(0, 200); }
          reject(new Error(`请求失败 (HTTP ${res.statusCode})${detail ? ': ' + detail : ''}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('连接超时')); });
    req.on('error', (e) => reject(new Error(`连接失败: ${e.message}`)));
    req.write(postData);
    req.end();
  });
}

module.exports = { registerIpcHandlers };
