/**
 * sttService — STT（语音转文字）服务抽象层
 *
 * 支持多提供商切换：
 * - whisper: 本地 whisper.cpp（默认，离线可用）
 * - mimo: 小米 MiMo API（云端，OpenAI 兼容格式）
 *
 * 接口：
 *   const provider = getSTTProvider();
 *   const { text, confidence } = await provider.transcribe(audioBuffer);
 */

const { getDatabase } = require('../database');

// ============================================================
// STT 配置存储（model_configs 表扩展字段）
// ============================================================

function getSTTConfig() {
  const db = getDatabase();
  try {
    const stmt = db.prepare("SELECT value FROM settings WHERE key = 'stt_provider'");
    let provider = 'whisper';
    if (stmt.step()) provider = stmt.getAsObject().value;
    stmt.free();

    const apiKeyStmt = db.prepare("SELECT value FROM settings WHERE key = 'stt_api_key'");
    let apiKey = '';
    if (apiKeyStmt.step()) apiKey = apiKeyStmt.getAsObject().value;
    apiKeyStmt.free();

    const endpointStmt = db.prepare("SELECT value FROM settings WHERE key = 'stt_endpoint'");
    let endpoint = '';
    if (endpointStmt.step()) endpoint = endpointStmt.getAsObject().value;
    endpointStmt.free();

    return { provider, apiKey, endpoint };
  } catch (e) {
    console.warn('[sttService] Failed to read config, using defaults:', e.message);
    return { provider: 'whisper', apiKey: '', endpoint: '' };
  }
}

function setSTTConfig(provider, apiKey, endpoint) {
  const db = getDatabase();
  try {
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('stt_provider', ?)", [provider]);
    if (apiKey !== undefined) {
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('stt_api_key', ?)", [apiKey]);
    }
    if (endpoint !== undefined) {
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('stt_endpoint', ?)", [endpoint]);
    }
    return true;
  } catch (e) {
    console.error('[sttService] Failed to save config:', e.message);
    return false;
  }
}

// ============================================================
// WhisperProvider（本地 whisper.cpp）
// ============================================================

class WhisperProvider {
  constructor() {
    this.name = 'whisper';
    this.label = 'Whisper 本地';
    this.description = '离线可用，无需网络';
  }

  async isAvailable() {
    try {
      const whisperModule = require('./whisper-processor');
      return !!whisperModule.whisper;
    } catch {
      return false;
    }
  }

  async transcribe(audioBuffer) {
    const whisperModule = require('./whisper-processor');
    const startTime = Date.now();

    if (!whisperModule.whisper) {
      throw new Error('Whisper 未初始化');
    }

    const result = await whisperModule.whisper.transcribeBuffer(audioBuffer);
    return {
      text: result.text,
      confidence: result.confidence || 0.85,
      provider: 'whisper',
      duration: result.duration || (Date.now() - startTime),
    };
  }
}

// ============================================================
// MiMoProvider（小米 MiMo API）
// ============================================================

class MiMoProvider {
  constructor() {
    this.name = 'mimo';
    this.label = 'MiMo 云端';
    this.description = '小米 MiMo-V2.5-ASR，需联网';
  }

  async isAvailable() {
    const config = getSTTConfig();
    return !!(config.apiKey);
  }

  /**
   * 通过 MiMo API 转写音频
   * MiMo 使用 OpenAI 兼容的 Chat Completions 格式
   * 通过 input_audio content type 传入 Base64 音频
   */
  async transcribe(audioBuffer) {
    const config = getSTTConfig();
    const apiKey = config.apiKey;
    const endpoint = config.endpoint || 'https://api.xiaomimimo.com/v1/chat/completions';

    if (!apiKey) {
      throw new Error('MiMo API Key 未配置');
    }

    const startTime = Date.now();
    const base64 = audioBuffer.toString('base64');

    const postData = JSON.stringify({
      model: 'mimo-v2.5-asr',
      messages: [{
        role: 'user',
        content: [{
          type: 'input_audio',
          input_audio: {
            data: `data:audio/webm;base64,${base64}`,
            format: 'wav',
          },
        }],
      }],
      asr_options: { language: 'zh' },
    });

    const https = require('https');
    const http = require('http');
    const url = require('url');
    const parsedUrl = url.parse(endpoint);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const response = await new Promise((resolve, reject) => {
      const req = transport.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.path,
        method: 'POST',
        timeout: 30000,
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`MiMo 响应解析失败: ${e.message}`));
            }
          } else {
            let detail = '';
            try { detail = JSON.parse(body).error?.message || body.slice(0, 200); } catch (_) { detail = body.slice(0, 200); }
            reject(new Error(`MiMo API 错误 (HTTP ${res.statusCode}): ${detail}`));
          }
        });
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('MiMo API 请求超时')); });
      req.on('error', e => reject(new Error(`MiMo 网络错误: ${e.message}`)));
      req.write(postData);
      req.end();
    });

    const text = response.choices?.[0]?.message?.content || '';
    const duration = Date.now() - startTime;

    return {
      text: text.trim(),
      confidence: 0.9,
      provider: 'mimo',
      duration,
    };
  }
}

// ============================================================
// 工厂函数
// ============================================================

const providers = {
  whisper: new WhisperProvider(),
  mimo: new MiMoProvider(),
};

/**
 * 获取当前 STT provider
 * @returns {WhisperProvider|MiMoProvider}
 */
function getSTTProvider() {
  const config = getSTTConfig();
  const provider = providers[config.provider];
  if (!provider) {
    console.warn(`[sttService] Unknown provider: ${config.provider}, falling back to whisper`);
    return providers.whisper;
  }
  return provider;
}

/**
 * 获取所有可用 provider 列表
 */
function getAvailableProviders() {
  return Object.values(providers).map(p => ({
    name: p.name,
    label: p.label,
    description: p.description,
  }));
}

module.exports = {
  getSTTProvider,
  getAvailableProviders,
  getSTTConfig,
  setSTTConfig,
  WhisperProvider,
  MiMoProvider,
};
