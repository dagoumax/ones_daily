/**
 * ContextBuilder — 构建 LLM 上下文
 * 
 * 负责从数据库收集相关上下文信息，构建发送给 LLM 的 system prompt 和 user context
 * Phase 0 仅骨架，Phase 1 填充真实逻辑
 */

const { getDatabase } = require('../database');

class ContextBuilder {
  constructor() {
    this.maxTokens = 4000;
  }

  /**
   * 构建任务创建的上下文
   * @param {Object} options - { userId, partialTask, recentTasks }
   * @returns {Object} - { systemPrompt, userContext, stats }
   */
  buildCreateTaskContext(options = {}) {
    return {
      systemPrompt: '你是一个智能任务管理助手...',
      userContext: JSON.stringify(options.partialTask || {}),
      stats: { recentTaskCount: 0 }
    };
  }

  /**
   * 构建每日播报上下文
   * @param {Object} options
   * @returns {Object}
   */
  buildBriefContext(todayTasks, lastWeekStats) {
    return {
      systemPrompt: '你是一个日程播报助手...',
      todayTasks: todayTasks || [],
      lastWeekStats: lastWeekStats || {}
    };
  }

  /**
   * 构建每日复盘上下文
   * @param {Object} options
   * @returns {Object}
   */
  buildReviewContext(completedTasks, pendingTasks, tomorrowTasks) {
    return {
      systemPrompt: '你是一个复盘总结助手...',
      completed: completedTasks || [],
      pending: pendingTasks || [],
      tomorrow: tomorrowTasks || []
    };
  }

  /**
   * 从数据库收集用户习惯统计
   * @returns {Object}
   */
  collectUserStats() {
    const db = getDatabase();
    // Phase 1 实现
    return {
      avgTaskDuration: 60,
      commonPriority: 'P2',
      frequentTags: [],
      totalCompletedTasks: 0
    };
  }
}

module.exports = new ContextBuilder();
