/**
 * toolExecutor — Tool 执行器
 * 
 * 实现 7 个 tool 的实际执行逻辑：
 * create_task / delete_task / complete_task / query_tasks / update_task / daily_brief / daily_review
 * 
 * 所有函数接收 tool call arguments，返回结构化结果。
 * 需要确认的操作返回 require_confirmation: true，Agent 循环会中断等待用户确认。
 */

const { getDatabase } = require('../database');
const { v4: uuidv4 } = require('uuid');

// ============================================
// 主入口
// ============================================

/**
 * 执行单个 tool call
 * @param {Object} toolCall - LLM 返回的 tool_call 对象 { id, type, function: { name, arguments } }
 * @returns {Object} - { success, require_confirmation?, ... }
 */
async function executeToolCall(toolCall) {
  const { name, arguments: argsJson } = toolCall.function;

  let args;
  try {
    args = JSON.parse(argsJson);
  } catch (e) {
    return { success: false, error: `Tool 参数解析失败: ${e.message}` };
  }

  switch (name) {
    case 'create_task':    return executeCreateTask(args);
    case 'delete_task':    return executeDeleteTask(args);
    case 'complete_task':  return executeCompleteTask(args);
    case 'query_tasks':    return executeQueryTasks(args);
    case 'update_task':    return executeUpdateTask(args);
    case 'daily_brief':    return executeDailyBrief(args);
    case 'daily_review':   return executeDailyReview(args);
    default:
      return { success: false, error: `未知的 tool: ${name}` };
  }
}

// ============================================
// Tool: create_task
// ============================================

function executeCreateTask(args) {
  // 槽位完整性检查
  const missing = [];
  if (!args.title || args.title.trim().length < 2) missing.push('title');
  if (!args.start_time) missing.push('start_time');

  if (missing.length > 0) {
    return {
      success: true,
      require_confirmation: false,
      missing_fields: missing,
      follow_up: missing.includes('title')
        ? '请问任务的具体内容是什么？'
        : '请问任务的具体时间？',
    };
  }

  // 清理 title（去掉可能的否定前缀）
  let title = args.title.trim();
  title = title.replace(/^(不去|不做|不搞|取消|删除|不要)\s*/g, '');

  if (title.length < 2) {
    return {
      success: true,
      require_confirmation: false,
      missing_fields: ['title'],
      follow_up: '请问任务的具体内容是什么？',
    };
  }

  // 计算默认 end_time（开始 +1h）
  let endTime = args.end_time || null;
  if (!endTime && args.start_time) {
    try {
      const startDate = new Date(args.start_time);
      if (!isNaN(startDate.getTime())) {
        startDate.setHours(startDate.getHours() + 1);
        endTime = startDate.toISOString();
      }
    } catch (_) { /* 保持 null */ }
  }

  return {
    success: true,
    require_confirmation: true,  // 创建始终需要确认
    task_preview: {
      title,
      start_time: args.start_time,
      end_time: endTime,
      priority: args.priority || 'P2',
      tags: args.tags || [],
      location: args.location || '',
      notes: args.notes || '',
    },
    message: `即将创建任务「${title}」`,
  };
}

// ============================================
// Tool: delete_task
// ============================================

function executeDeleteTask(args) {
  const db = getDatabase();

  // 如果有 task_id，直接查找
  if (args.task_id) {
    const task = dbGet("SELECT * FROM tasks WHERE id = ?", [args.task_id]);
    if (!task) {
      return {
        success: true,
        require_confirmation: false,
        not_found: true,
        message: '未找到该任务，可能已被删除。',
      };
    }
    return {
      success: true,
      require_confirmation: true,
      task: formatTask(task),
      candidates: null,
      message: `确认删除「${task.title}」？此操作不可撤销。`,
    };
  }

  // 模糊匹配
  const candidates = findTasksForDelete(args);

  if (candidates.length === 0) {
    // Q3决策：无匹配时友好提示
    const dateLabel = args.task_date || '今天';
    const keywordLabel = args.task_keyword ? `「${args.task_keyword}」相关的` : '';
    return {
      success: true,
      require_confirmation: false,
      not_found: true,
      message: `${dateLabel}没有${keywordLabel}任务。`,
    };
  }

  if (candidates.length === 1) {
    return {
      success: true,
      require_confirmation: true,
      task: candidates[0],
      candidates: null,
      message: `确认删除「${candidates[0].title}」？此操作不可撤销。`,
    };
  }

  // 多个匹配
  return {
    success: true,
    require_confirmation: true,
    task: null,
    candidates,
    message: `找到 ${candidates.length} 个匹配任务，请确认要删除哪一个。`,
  };
}

/**
 * 为 delete 场景模糊匹配任务
 * 支持 keyword LIKE、date 精确日期、time ±30 分钟窗口
 */
function findTasksForDelete(args) {
  const conditions = [];
  const params = [];

  // 只查 pending 状态
  conditions.push("status = 'pending'");

  if (args.task_keyword) {
    conditions.push("title LIKE ?");
    params.push(`%${args.task_keyword}%`);
  }

  if (args.task_date) {
    conditions.push("date(start_time) = date(?)");
    params.push(args.task_date);
  }

  // 先执行基础查询
  let tasks = dbAll(
    `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY start_time ASC`,
    params
  );

  // 如果有 task_time，进一步按时间窗口过滤（±30 分钟）
  if (args.task_time && tasks.length > 1) {
    const targetMinutes = parseTimeToMinutes(args.task_time);
    if (targetMinutes !== null) {
      tasks = tasks.filter(t => {
        if (!t.start_time) return true; // 无时间的任务保留
        const taskMinutes = extractMinutesFromISO(t.start_time);
        if (taskMinutes === null) return true;
        return Math.abs(taskMinutes - targetMinutes) <= 30;
      });
    }
  }

  return tasks.map(formatTask);
}

// ============================================
// Tool: complete_task
// ============================================

function executeCompleteTask(args) {
  const db = getDatabase();

  if (args.task_id) {
    const task = dbGet(
      "SELECT * FROM tasks WHERE id = ? AND status = 'pending'",
      [args.task_id]
    );
    if (!task) {
      return {
        success: true,
        require_confirmation: false,
        not_found: true,
        message: '未找到该待完成任务，可能已完成或已删除。',
      };
    }
    return {
      success: true,
      require_confirmation: true,  // Q5决策：1条也确认
      task: formatTask(task),
      candidates: null,
      message: `确认将「${task.title}」标记为完成？`,
    };
  }

  // 模糊匹配
  const conditions = ["status = 'pending'"];
  const params = [];

  if (args.task_keyword) {
    conditions.push("title LIKE ?");
    params.push(`%${args.task_keyword}%`);
  }

  if (args.task_date) {
    conditions.push("date(start_time) = date(?)");
    params.push(args.task_date);
  } else {
    // 默认今天
    conditions.push("date(start_time) = date('now','localtime')");
  }

  const candidates = dbAll(
    `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY start_time ASC`,
    params
  ).map(formatTask);

  if (candidates.length === 0) {
    return {
      success: true,
      require_confirmation: false,
      not_found: true,
      message: '未找到匹配的待完成任务。',
    };
  }

  if (candidates.length === 1) {
    return {
      success: true,
      require_confirmation: true,
      task: candidates[0],
      candidates: null,
      message: `确认将「${candidates[0].title}」标记为完成？`,
    };
  }

  return {
    success: true,
    require_confirmation: true,
    task: null,
    candidates,
    message: `找到 ${candidates.length} 个匹配任务，请选择要标记为完成的任务。`,
  };
}

// ============================================
// Tool: query_tasks
// ============================================

function executeQueryTasks(args) {
  const conditions = [];
  const params = [];
  const limit = Math.min(args.limit || 10, 50);

  // status 过滤
  if (args.status && args.status !== 'all') {
    conditions.push("status = ?");
    params.push(args.status);
  } else if (!args.status) {
    // 默认查 pending
    conditions.push("status = 'pending'");
  }

  // date_range 快捷方式
  if (args.date_range) {
    const now = new Date().toISOString().slice(0, 10);
    switch (args.date_range) {
      case 'today':
        conditions.push("date(start_time) = date(?)");
        params.push(now);
        break;
      case 'tomorrow': {
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        conditions.push("date(start_time) = date(?)");
        params.push(tomorrow);
        break;
      }
      case 'this_week': {
        const startOfWeek = getWeekStart();
        const endOfWeek = getWeekEnd();
        conditions.push("date(start_time) >= date(?) AND date(start_time) <= date(?)");
        params.push(startOfWeek, endOfWeek);
        break;
      }
      case 'next_week': {
        const nextStart = getWeekStart(7);
        const nextEnd = getWeekEnd(7);
        conditions.push("date(start_time) >= date(?) AND date(start_time) <= date(?)");
        params.push(nextStart, nextEnd);
        break;
      }
      case 'overdue':
        conditions.push("status = 'pending'");
        conditions.push("date(start_time) < date('now','localtime')");
        break;
    }
  }

  // 具体日期
  if (args.date && !args.date_range) {
    conditions.push("date(start_time) = date(?)");
    params.push(args.date);
  }

  // 优先级
  if (args.priority) {
    conditions.push("priority = ?");
    params.push(args.priority);
  }

  // 关键词
  if (args.keyword) {
    conditions.push("title LIKE ?");
    params.push(`%${args.keyword}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const tasks = dbAll(
    `SELECT * FROM tasks ${whereClause} ORDER BY start_time ASC LIMIT ?`,
    [...params, limit]
  ).map(formatTask);

  return {
    success: true,
    require_confirmation: false,
    tasks,
    count: tasks.length,
    has_more: tasks.length >= limit,
    summary: tasks.length === 0
      ? '没有找到匹配的任务。'
      : `找到 ${tasks.length} 个任务。`,
  };
}

// ============================================
// Tool: update_task
// ============================================

function executeUpdateTask(args) {
  const db = getDatabase();

  let task = null;

  // 按 ID 查找
  if (args.task_id) {
    task = dbGet("SELECT * FROM tasks WHERE id = ? AND status = 'pending'", [args.task_id]);
  }

  // 按关键词查找
  if (!task && args.task_keyword) {
    const conditions = ["status = 'pending'", "title LIKE ?"];
    const params = [`%${args.task_keyword}%`];
    if (args.task_date) {
      conditions.push("date(start_time) = date(?)");
      params.push(args.task_date);
    }
    task = dbGet(
      `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY start_time ASC LIMIT 1`,
      params
    );
  }

  if (!task) {
    return {
      success: true,
      require_confirmation: false,
      not_found: true,
      message: '未找到要修改的任务。可以先查询确认任务信息。',
    };
  }

  task = formatTask(task);

  // 提取要更新的字段
  const updates = {};
  const updateFields = ['title', 'start_time', 'end_time', 'priority', 'location'];
  for (const field of updateFields) {
    if (args[field] !== undefined && args[field] !== null && args[field] !== '') {
      if (args[field] !== task[field]) {
        updates[field] = { from: task[field], to: args[field] };
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return {
      success: true,
      require_confirmation: false,
      no_changes: true,
      message: '没有检测到需要修改的内容。',
    };
  }

  const changesDesc = Object.entries(updates)
    .map(([field, { from, to }]) => `${fieldLabel(field)}从「${from || '无'}」改为「${to}」`)
    .join('，');

  return {
    success: true,
    require_confirmation: true,
    task_id: task.id,
    original: task,
    updates,
    message: `确认将「${task.title}」${changesDesc}？`,
  };
}

// ============================================
// Tool: daily_brief
// ============================================

function executeDailyBrief(args) {
  const date = args.date || new Date().toISOString().slice(0, 10);
  const style = args.style || 'brief';

  const todayTasks = dbAll(
    "SELECT * FROM tasks WHERE date(start_time) = date(?) ORDER BY start_time ASC",
    [date]
  ).map(formatTask);

  const completed = todayTasks.filter(t => t.status === 'completed');
  const pending = todayTasks.filter(t => t.status === 'pending');
  const total = todayTasks.length;
  const completionRate = total > 0 ? Math.round((completed.length / total) * 100) : 0;

  // 过期未完成的任务
  const overdueTasks = dbAll(
    "SELECT * FROM tasks WHERE status = 'pending' AND date(start_time) < date(?) ORDER BY start_time ASC LIMIT 5",
    [date]
  ).map(formatTask);

  return {
    success: true,
    require_confirmation: false,  // tool 只返回数据，LLM 下一轮生成播报
    date,
    style,
    tasks: todayTasks,
    stats: {
      total,
      completed: completed.length,
      pending: pending.length,
      completion_rate: completionRate,
    },
    overdue: overdueTasks,
    // 给 LLM 的提示：用这些数据生成自然语言播报
    _llm_instruction: '请根据以上数据生成自然语言每日播报。根据 style 决定详细程度。',
  };
}

// ============================================
// Tool: daily_review
// ============================================

function executeDailyReview(args) {
  const date = args.date || new Date().toISOString().slice(0, 10);

  const todayTasks = dbAll(
    "SELECT * FROM tasks WHERE date(start_time) = date(?) ORDER BY start_time ASC",
    [date]
  ).map(formatTask);

  const completed = todayTasks.filter(t => t.status === 'completed');
  const pending = todayTasks.filter(t => t.status === 'pending');
  const total = todayTasks.length;
  const completionRate = total > 0 ? Math.round((completed.length / total) * 100) : 0;

  // 明日任务
  const tomorrowDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const tomorrowTasks = dbAll(
    "SELECT * FROM tasks WHERE date(start_time) = date(?) ORDER BY start_time ASC",
    [tomorrowDate]
  ).map(formatTask);

  // 本周统计
  const weekStart = getWeekStart();
  const weekTasks = dbAll(
    `SELECT status, COUNT(*) as count FROM tasks 
     WHERE date(start_time) >= date(?) AND date(start_time) <= date(?)
     GROUP BY status`,
    [weekStart, date]
  );
  const weekCompleted = weekTasks.find(r => r.status === 'completed')?.count || 0;
  const weekTotal = weekTasks.reduce((sum, r) => sum + r.count, 0);

  return {
    success: true,
    require_confirmation: false,  // tool 只返回数据，LLM 下一轮生成复盘
    date,
    completed,
    pending,
    tomorrow: tomorrowTasks,
    stats: {
      total,
      completed_count: completed.length,
      pending_count: pending.length,
      completion_rate: completionRate,
    },
    week_stats: {
      total: weekTotal,
      completed: weekCompleted,
      completion_rate: weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 0,
    },
    // 给 LLM 的提示
    _llm_instruction: '请根据以上数据生成每日复盘分析，包括完成情况总结、未完成任务原因分析、效率评估和改进建议。',
  };
}

// ============================================
// 辅助函数
// ============================================

function dbAll(sql, params = []) {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbGet(sql, params = []) {
  const rows = dbAll(sql, params);
  return rows[0] || null;
}

function dbRun(sql, params = []) {
  const db = getDatabase();
  db.run(sql, params);
}

/**
 * 格式化 task 对象，解析 JSON 字段
 */
function formatTask(task) {
  if (!task) return null;
  return {
    ...task,
    tags: safeJsonParse(task.tags, []),
    participants: safeJsonParse(task.participants, []),
  };
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * 将时间描述（如 "19:00"、"晚上"、"下午"）转为分钟数
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;

  // 尝试 HH:MM 格式
  const hhmmMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmmMatch) {
    return parseInt(hhmmMatch[1]) * 60 + parseInt(hhmmMatch[2]);
  }

  // 语义时间
  const semanticMap = {
    '早上': 9 * 60,
    '上午': 10 * 60,
    '中午': 12 * 60,
    '下午': 14 * 60,
    '傍晚': 17 * 60,
    '晚上': 19 * 60,
    '深夜': 22 * 60,
  };

  for (const [label, minutes] of Object.entries(semanticMap)) {
    if (timeStr.includes(label)) return minutes;
  }

  return null;
}

/**
 * 从 ISO 时间字符串中提取小时+分钟数
 */
function extractMinutesFromISO(isoStr) {
  try {
    const date = new Date(isoStr);
    if (isNaN(date.getTime())) return null;
    return date.getHours() * 60 + date.getMinutes();
  } catch {
    return null;
  }
}

/**
 * 获取本周一的日期
 */
function getWeekStart(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day; // 周一为起始
  now.setDate(now.getDate() + diff);
  return now.toISOString().slice(0, 10);
}

/**
 * 获取本周日的日期
 */
function getWeekEnd(offsetDays = 0) {
  const start = new Date(getWeekStart(offsetDays));
  start.setDate(start.getDate() + 6);
  return start.toISOString().slice(0, 10);
}

/**
 * 字段名中文标签
 */
function fieldLabel(field) {
  const map = {
    title: '标题',
    start_time: '开始时间',
    end_time: '结束时间',
    priority: '优先级',
    location: '地点',
  };
  return map[field] || field;
}

module.exports = { executeToolCall };
