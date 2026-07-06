/**
 * llmService — 通用 LLM 调用服务
 * 
 * 支持 DeepSeek / OpenAI / Anthropic / 其他 OpenAI 兼容 API
 */

const { getDatabase } = require('../database');

/**
 * 通用 LLM 调用函数
 * @param {Object} modelConfig - 从 model_configs 表查出的模型配置对象
 * @param {Array} messages - [{role, content}] 消息数组
 * @param {Object} options - {temperature, maxTokens, timeout}
 * @returns {Object} - { content, promptTokens, completionTokens, durationMs }
 */
async function callLLM(modelConfig, messages, options = {}) {
  const https = require('https');
  const http = require('http');
  const url = require('url');
  
  const parsedUrl = url.parse(modelConfig.endpoint);
  const isHttps = parsedUrl.protocol === 'https:';
  const transport = isHttps ? https : http;
  const isAnthropic = parsedUrl.hostname.includes('anthropic');
  const isDeepSeek = parsedUrl.hostname.includes('deepseek');
  const basePath = (parsedUrl.path || '/').replace(/\/$/, '');
  
  // 构建请求路径
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
  
  // 构建请求体
  let postData;
  if (isAnthropic) {
    // Anthropic: 分离 system message
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
  
  // 构建 headers
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
  
  // 发送请求
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: apiPath,
      method: 'POST',
      timeout: options.timeout || 15000,
      headers,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const durationMs = Date.now() - startTime;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(body);
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
            resolve({ content, promptTokens, completionTokens, durationMs });
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

/**
 * 构建任务创建 Prompt
 * @param {string} userMessage - 用户输入文本
 * @param {Object} existingSlots - 已有的槽位信息
 * @returns {Object} - { systemPrompt, messages }
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
 * 解析 LLM 返回的原始 JSON 字符串
 * @param {string} rawContent - LLM 返回的原始内容
 * @returns {Object|null} - 解析后的 JSON 对象，失败返回 null
 */
function parseLLMResponse(rawContent) {
  if (!rawContent || !rawContent.trim()) {
    return null;
  }
  
  let jsonStr = rawContent.trim();
  
  // 去掉 markdown 代码块包裹
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }
  
  // 尝试找到 JSON 对象（有些 LLM 会在 JSON 前后加文字）
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }
  
  try {
    const parsed = JSON.parse(jsonStr);
    // 验证必填字段
    if (!parsed.intent) {
      return null;
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * 获取默认模型配置
 * 优先查找 scene_bindings 中的默认对话模型，否则返回第一个 active 模型
 * @returns {Object|null} - 模型配置对象
 */
function getDefaultModel() {
  const db = getDatabase();
  // 优先查找 scene_bindings 中的默认对话模型
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
    if (modelStmt.step()) {
      model = modelStmt.getAsObject();
    }
    modelStmt.free();
    if (model) return model;
  }
  
  // fallback: 取第一个 active 模型
  const fallbackStmt = db.prepare("SELECT * FROM model_configs WHERE status = 'active' LIMIT 1");
  let fallback = null;
  if (fallbackStmt.step()) {
    fallback = fallbackStmt.getAsObject();
  }
  fallbackStmt.free();
  return fallback;
}

module.exports = { callLLM, buildTaskCreationPrompt, parseLLMResponse, getDefaultModel };
