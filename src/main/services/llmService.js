/**
 * llmService — 通用 LLM 调用服务
 * 
 * 支持 DeepSeek / OpenAI / Anthropic / 其他 OpenAI 兼容 API
 * 
 * 两个主要函数：
 * - callLLM() — 传统 JSON 模式调用（降级兼容）
 * - callLLMWithTools() — Agent 模式调用（支持 tool_calls，不加 response_format）
 */

const { getDatabase } = require('../database');

// ============================================
// 底层 HTTP 请求
// ============================================

/**
 * 发送 HTTP 请求到 LLM API
 * @returns {Promise<Object>} - { json, durationMs }
 */
function _doRequest(modelConfig, postData, options = {}) {
  const https = require('https');
  const http = require('http');
  const url = require('url');

  const parsedUrl = url.parse(modelConfig.endpoint);
  const isHttps = parsedUrl.protocol === 'https:';
  const transport = isHttps ? https : http;
  const isAnthropic = parsedUrl.hostname.includes('anthropic');
  const isDeepSeek = parsedUrl.hostname.includes('deepseek');
  const basePath = (parsedUrl.path || '/').replace(/\/$/, '');

  let apiPath;
  if (isAnthropic) {
    apiPath = '/v1/messages';
  } else if (isDeepSeek) {
    apiPath = basePath + '/chat/completions';
  } else if (/\/v1$/.test(basePath) || /\/v1beta$/.test(basePath)) {
    apiPath = basePath + '/chat/completions';
  } else {
    apiPath = basePath + '/v1/chat/completions';
  }

  const headers = isAnthropic ? {
    'x-api-key': modelConfig.api_key_encrypted || '',
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
  } : {
    'Authorization': `Bearer ${modelConfig.api_key_encrypted || ''}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
  };

  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: apiPath,
      method: 'POST',
      timeout: options.timeout || 30000,
      headers,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const durationMs = Date.now() - startTime;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ json: JSON.parse(body), durationMs });
          } catch (e) {
            reject(new Error(`JSON 解析失败: ${e.message}`));
          }
        } else {
          let detail = '';
          try { detail = JSON.parse(body).error?.message || body.slice(0, 200); } catch (_) { detail = body.slice(0, 200); }
          reject(new Error(`API 错误 (HTTP ${res.statusCode})${detail ? ': ' + detail : ''}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.on('error', e => reject(new Error(`网络错误: ${e.message}`)));
    req.write(postData);
    req.end();
  });
}

// ============================================
// 传统 JSON 模式（降级兼容）
// ============================================

/**
 * 传统 LLM 调用 — 强制 JSON 输出模式
 * 用于降级兼容旧的 Prompt 分类模式
 */
async function callLLM(modelConfig, messages, options = {}) {
  const url = require('url');
  const parsedUrl = url.parse(modelConfig.endpoint);
  const isAnthropic = parsedUrl.hostname.includes('anthropic');

  let postData;
  if (isAnthropic) {
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    postData = JSON.stringify({
      model: modelConfig.model_identifier || 'claude-sonnet-4-20250514',
      system: systemMsg ? systemMsg.content : '',
      messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature ?? 0.1,
    });
  } else {
    postData = JSON.stringify({
      model: modelConfig.model_identifier || 'default',
      messages: messages,
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature ?? 0.1,
      response_format: { type: 'json_object' },
    });
  }

  const { json, durationMs } = await _doRequest(modelConfig, postData, options);

  let content, promptTokens = 0, completionTokens = 0;
  if (isAnthropic) {
    content = json.content?.[0]?.text || '';
    promptTokens = json.usage?.input_tokens || 0;
    completionTokens = json.usage?.output_tokens || 0;
  } else {
    content = json.choices?.[0]?.message?.content || '';
    promptTokens = json.usage?.prompt_tokens || 0;
    completionTokens = json.usage?.completion_tokens || 0;
  }
  return { content, promptTokens, completionTokens, durationMs };
}

// ============================================
// Agent 模式（支持 tool_calls）
// ============================================

/**
 * Agent 模式 LLM 调用
 * 
 * 与 callLLM 的核心区别：
 * 1. 不加 response_format 约束（让 LLM 自由选择 text 或 tool_calls）
 * 2. 传入 tools 参数
 * 3. 返回完整的 choices[0].message（含 content 和 tool_calls）
 * 
 * @param {Object} modelConfig - 模型配置
 * @param {Array} messages - 消息数组，可含 assistant(tool_calls) 和 tool 角色
 * @param {Object} options - { temperature, maxTokens, tools, tool_choice }
 * @returns {Object} - { choices: [{ message }], usage }
 */
async function callLLMWithTools(modelConfig, messages, options = {}) {
  const url = require('url');
  const parsedUrl = url.parse(modelConfig.endpoint);
  const isAnthropic = parsedUrl.hostname.includes('anthropic');

  let postData;
  if (isAnthropic) {
    // Anthropic: 转换 OpenAI tool 格式 → Anthropic tool 格式
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const anthropicTools = (options.tools || []).map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    // 转换 messages 中的 tool_calls → Anthropic tool_use 格式
    const anthropicMessages = chatMessages.map(m => {
      if (m.role === 'assistant' && m.tool_calls) {
        return {
          role: 'assistant',
          content: m.tool_calls.map(tc => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          })),
        };
      }
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }],
        };
      }
      return { role: m.role, content: m.content };
    });

    postData = JSON.stringify({
      model: modelConfig.model_identifier || 'claude-sonnet-4-20250514',
      system: systemMsg ? systemMsg.content : '',
      messages: anthropicMessages,
      max_tokens: options.maxTokens || 2048,
      temperature: options.temperature ?? 0.1,
      tools: anthropicTools,
    });
  } else {
    // DeepSeek / OpenAI: 原生 tools 格式
    postData = JSON.stringify({
      model: modelConfig.model_identifier || 'default',
      messages: messages,
      max_tokens: options.maxTokens || 2048,
      temperature: options.temperature ?? 0.1,
      tools: options.tools || [],
      tool_choice: options.tool_choice || 'auto',
      // 注意：Agent 模式不加 response_format，让 LLM 自由选择返回 text 或 tool_calls
    });
  }

  const { json, durationMs } = await _doRequest(modelConfig, postData, options);

  // 标准化为 OpenAI 格式
  if (isAnthropic) {
    return _normalizeAnthropicResponse(json);
  }

  return {
    choices: json.choices || [],
    usage: json.usage || null,
    _durationMs: durationMs,
  };
}

/**
 * Anthropic 响应 → OpenAI choices 格式标准化
 */
function _normalizeAnthropicResponse(json) {
  const content = json.content || [];
  const textParts = content.filter(c => c.type === 'text').map(c => c.text);
  const toolUseParts = content.filter(c => c.type === 'tool_use');

  const message = {
    role: 'assistant',
    content: textParts.join('\n') || null,
  };

  if (toolUseParts.length > 0) {
    message.tool_calls = toolUseParts.map(tu => ({
      id: tu.id,
      type: 'function',
      function: {
        name: tu.name,
        arguments: JSON.stringify(tu.input),
      },
    }));
  }

  return {
    choices: [{ message }],
    usage: {
      prompt_tokens: json.usage?.input_tokens || 0,
      completion_tokens: json.usage?.output_tokens || 0,
      total_tokens: (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0),
    },
  };
}

// ============================================
// 向后兼容：保留旧接口
// ============================================

/**
 * 构建任务创建 Prompt（旧模式，降级用）
 */
function buildTaskCreationPrompt(userMessage, existingSlots = {}) {
  const now = new Date();
  const weekDayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const currentTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:00+08:00（星期${weekDayNames[now.getDay()]}）`;

  const existingSlotsStr = Object.keys(existingSlots).length > 0
    ? `\n已有信息：${JSON.stringify(existingSlots)}`
    : '';

  const systemPrompt = `你是智能任务解析器。从用户输入中同时完成意图分类和槽位提取，返回 JSON。

当前时间：${currentTime}

## 意图类型
- create_task: 创建新任务/提醒/日程
- query_tasks: 查看已有任务
- chat: 闲聊或请求建议
- unknown: 无法分类

## 槽位定义（仅 create_task 时填充）
- title: 任务标题（必填，提取核心动作描述）
- start_time: ISO 8601 开始时间（必填，含时区如 +08:00）
- end_time: ISO 8601 结束时间（可选）
- priority: P0/P1/P2/P3（可选，默认 P2）
- tags: 标签数组（可选，最多3个）
- participants: 参与人数组（可选）
- location: 地点（可选）
- notes: AI 补充建议（可选）

## 规则
1. 未指定时间 → 默认为当前时间后最近的整点或半点
2. 未指定优先级 → 默认为 P2
3. 未指定结束时间 → 默认为开始时间+1小时
4. 只提取明确信息，不要编造
5. 信息不足时在 missing_fields 列出缺失字段名，follow_up_question 生成友好追问
6. "明天"指下一个日历日，不是24小时后
7. "晚上"默认 19:00，"早上"默认 09:00，"下午"保持原时间+12h处理

## 负面示例
❌ "下午开会" → 不要编造具体时间，标记 missing_fields: ["start_time"]
❌ "买菜" → 不要编造地点
❌ "嗯" → 意图应为 unknown
❌ 输入含多任务 → 只提取第一个

返回格式：
{
  "intent": "create_task",
  "confidence": 0.95,
  "slots": {
    "title": "任务标题",
    "start_time": "2026-07-07T15:00:00+08:00",
    "end_time": "2026-07-07T16:00:00+08:00",
    "priority": "P2",
    "tags": [],
    "participants": [],
    "location": "",
    "notes": ""
  },
  "missing_fields": [],
  "follow_up_question": null
}`;

  return {
    systemPrompt,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage + existingSlotsStr },
    ]
  };
}

/**
 * 解析 LLM JSON 响应（旧模式，降级用）
 */
function parseLLMResponse(rawContent) {
  if (!rawContent || !rawContent.trim()) return null;

  let jsonStr = rawContent.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.intent) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * 获取默认模型配置
 */
function getDefaultModel() {
  const db = getDatabase();
  const stmt = db.prepare("SELECT model_id FROM scene_bindings WHERE scene = 'chat' LIMIT 1");
  let modelId = null;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    modelId = row.model_id;
  }
  stmt.free();

  if (modelId) {
    const modelStmt = db.prepare("SELECT * FROM model_configs WHERE id = ? AND status = 'active'");
    modelStmt.bind([modelId]);
    let model = null;
    if (modelStmt.step()) model = modelStmt.getAsObject();
    modelStmt.free();
    if (model) return model;
  }

  const fallbackStmt = db.prepare("SELECT * FROM model_configs WHERE status = 'active' LIMIT 1");
  let fallback = null;
  if (fallbackStmt.step()) fallback = fallbackStmt.getAsObject();
  fallbackStmt.free();
  return fallback;
}

module.exports = {
  callLLM,
  callLLMWithTools,
  buildTaskCreationPrompt,
  parseLLMResponse,
  getDefaultModel,
};
