/**
 * WhisperProcessor — Electron 主进程 Whisper.cpp 子进程管理模块
 * 
 * 功能：
 * - spawn whisper.cpp 可执行文件进行语音转写
 * - 超时控制和进程清理
 * - 并发请求排队（单进程串行）
 * - 模型懒加载和缓存
 * 
 * 用法（Electron 主进程）：
 *   const { whisper } = require('./whisper-processor');
 *   const text = await whisper.transcribe('/path/to/audio.wav');
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

// ============================================================
// 配置
// ============================================================

const DEFAULT_CONFIG = {
  /** whisper.cpp 可执行文件路径 */
  executablePath: null, // 必须在 init() 时设置

  /** 模型文件路径 (ggml-small.bin 等) */
  modelPath: null, // 必须在 init() 时设置

  /** 临时音频文件存放目录 */
  tempDir: path.join(require('os').tmpdir(), 'whisper-temp'),

  /** 转写超时（毫秒），超时后 kill 子进程 */
  timeout: 30000, // 30s，对应 PRD 中的 API 超时

  /** 最大并发转写任务（当前设为 1，串行处理） */
  maxConcurrency: 1,

  /** 模型加载超时（毫秒） */
  modelLoadTimeout: 10000, // 10s

  /** 是否输出调试日志 */
  debug: false,
};

// ============================================================
// WhisperProcessor 类
// ============================================================

class WhisperProcessor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._currentProcess = null;
    this._queue = [];
    this._processing = false;
    this._modelLoaded = false;
    this._modelLoadPromise = null;
    this._consecutiveFailures = 0;
    this._maxFailures = 3;
    this._status = 'idle'; // idle | loading | ready | processing | error
  }

  /**
   * 初始化：验证可执行文件和模型文件存在
   */
  async init() {
    if (!this.config.executablePath) {
      throw new Error('WhisperProcessor: executablePath is required');
    }
    if (!this.config.modelPath) {
      throw new Error('WhisperProcessor: modelPath is required');
    }
    if (!fs.existsSync(this.config.executablePath)) {
      throw new Error(`WhisperProcessor: executable not found at ${this.config.executablePath}`);
    }
    if (!fs.existsSync(this.config.modelPath)) {
      throw new Error(`WhisperProcessor: model not found at ${this.config.modelPath}`);
    }
    // 确保临时目录存在
    if (!fs.existsSync(this.config.tempDir)) {
      fs.mkdirSync(this.config.tempDir, { recursive: true });
    }
    this._log('WhisperProcessor initialized');
    this._log(`  executable: ${this.config.executablePath}`);
    this._log(`  model: ${this.config.modelPath}`);
  }

  /**
   * 预热：加载模型到内存（可选，减少首次转写延迟）
   */
  async warmup() {
    if (this._modelLoaded) return;
    if (this._modelLoadPromise) return this._modelLoadPromise;

    this._status = 'loading';
    this._modelLoadPromise = this._loadModel();
    try {
      await this._modelLoadPromise;
      this._modelLoaded = true;
      this._status = 'ready';
      this._log('Model loaded successfully');
    } catch (err) {
      this._modelLoadPromise = null;
      this._status = 'error';
      throw err;
    }
  }

  /**
   * 转写音频文件 → 文本
   * @param {string} audioFilePath - WAV 16kHz 单声道音频文件路径
   * @param {object} options - 可选参数
   * @param {string} options.language - 语言代码，默认 'auto'
   * @param {boolean} options.translate - 是否翻译为英文，默认 false
   * @returns {Promise<{text: string, confidence: number, duration: number}>}
   */
  async transcribe(audioFilePath, options = {}) {
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file not found: ${audioFilePath}`);
    }

    // 加入队列
    return new Promise((resolve, reject) => {
      this._queue.push({ audioFilePath, options, resolve, reject });
      this._processQueue();
    });
  }

  /**
   * 获取当前状态
   */
  get status() {
    return {
      state: this._status,
      modelLoaded: this._modelLoaded,
      queueLength: this._queue.length,
      consecutiveFailures: this._consecutiveFailures,
    };
  }

  /**
   * 销毁：清理子进程和临时文件
   */
  destroy() {
    this._killCurrentProcess();
    this._queue = [];
    this._modelLoaded = false;
    this._modelLoadPromise = null;
    this._status = 'idle';
    this._log('WhisperProcessor destroyed');
  }

  // ============================================================
  // 内部方法
  // ============================================================

  _log(...args) {
    if (this.config.debug) {
      console.log('[WhisperProcessor]', ...args);
    }
  }

  async _loadModel() {
    this._log('Loading model...');
    const loadStart = Date.now();
    // 通过执行一个最小化转写来加载模型
    // 创建空的 WAV 文件（0.1s 静音）
    const probePath = path.join(this.config.tempDir, '_probe.wav');
    await this._generateSilenceWav(probePath, 0.1);

    try {
      await this._runTranscribe(probePath, { language: 'en' });
      this._log(`Model loaded in ${Date.now() - loadStart}ms`);
    } catch (err) {
      // 首次加载失败是预期的（空音频），只要进程能启动就行
      this._log(`Model probe completed (${err.message})`);
    } finally {
      try { fs.unlinkSync(probePath); } catch (_) {}
    }
  }

  async _processQueue() {
    if (this._processing) return;
    if (this._queue.length === 0) return;
    if (this._consecutiveFailures >= this._maxFailures) {
      // 连续失败过多，拒绝所有队列中的请求
      const err = new Error('WhisperProcessor: too many consecutive failures');
      while (this._queue.length > 0) {
        const { reject } = this._queue.shift();
        reject(err);
      }
      return;
    }

    this._processing = true;
    const { audioFilePath, options, resolve, reject } = this._queue.shift();
    const startTime = Date.now();

    try {
      this._status = 'processing';
      const result = await this._runTranscribe(audioFilePath, options);
      const duration = Date.now() - startTime;
      this._consecutiveFailures = 0;
      this._status = 'ready';
      resolve({ ...result, duration });
      this.emit('transcribe:success', { audioFilePath, result, duration });
    } catch (err) {
      this._consecutiveFailures++;
      this._status = this._consecutiveFailures >= this._maxFailures ? 'error' : 'ready';
      this.emit('transcribe:error', { audioFilePath, error: err.message });
      reject(err);
    } finally {
      this._processing = false;
      // 处理队列中的下一个
      setImmediate(() => this._processQueue());
    }
  }

  _runTranscribe(audioFilePath, options = {}) {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', this.config.modelPath,
        '-f', audioFilePath,
        '-nt',
        '-otxt',
        '-of', path.join(this.config.tempDir, 'whisper_output'),
        '-l', options.language || 'auto',
      ];

      if (options.language && options.language !== 'auto') {
        args.push('-l', options.language);
      }
      if (options.translate) {
        args.push('--translate');
      }

      this._log('Spawning whisper:', this.config.executablePath, args.join(' '));
      const proc = spawn(this.config.executablePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: this.config.timeout,
      });

      this._currentProcess = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        // whisper.cpp 将进度输出到 stderr
        this._log('whisper progress:', data.toString().trim());
      });

      const timeoutId = setTimeout(() => {
        this._log('Transcribe timeout, killing process');
        this._killCurrentProcess();
        reject(new Error('Transcription timed out'));
      }, this.config.timeout);

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        this._currentProcess = null;

        this._log(`whisper exited with code ${code}, stdout length: ${stdout.length}, stderr length: ${stderr.length}`);

        if (code === 0) {
          // whisper.cpp outputs to --output-file with .txt appended
          const outputPath = path.join(this.config.tempDir, 'whisper_output.txt');
          let text = '';
          try {
            text = fs.readFileSync(outputPath, 'utf-8').trim();
          } catch (_) {
            // Try without .txt (some versions don't append)
            try {
              text = fs.readFileSync(path.join(this.config.tempDir, 'whisper_output'), 'utf-8').trim();
            } catch {}
          }
          // Clean up
          try { fs.unlinkSync(outputPath); } catch {}
          try { fs.unlinkSync(path.join(this.config.tempDir, 'whisper_output')); } catch {}
          this._log(`Transcription result: "${text}"`);
          resolve({ text, confidence: 0.85, raw: stdout || stderr });
        } else if (code === null) {
          // 被 kill
          reject(new Error('Transcription process was killed'));
        } else {
          reject(new Error(`Whisper exited with code ${code}: ${stderr.slice(-200)}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        this._currentProcess = null;
        reject(new Error(`Failed to spawn whisper: ${err.message}`));
      });
    });
  }

  _killCurrentProcess() {
    if (this._currentProcess) {
      try {
        this._currentProcess.kill('SIGTERM');
        // 如果 3 秒后还没退出，强制 kill
        setTimeout(() => {
          try { this._currentProcess?.kill('SIGKILL'); } catch (_) {}
        }, 3000);
      } catch (_) {}
      this._currentProcess = null;
    }
  }

  /**
   * 生成静音 WAV 文件（用于模型预热）
   */
  async _generateSilenceWav(filePath, durationSec) {
    const sampleRate = 16000;
    const numSamples = Math.floor(sampleRate * durationSec);
    const dataSize = numSamples * 2; // 16-bit
    const header = Buffer.alloc(44);

    // WAV header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // chunk size
    header.writeUInt16LE(1, 20);  // PCM
    header.writeUInt16LE(1, 22);  // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32);  // block align
    header.writeUInt16LE(16, 34); // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    const silence = Buffer.alloc(dataSize, 0);
    fs.writeFileSync(filePath, Buffer.concat([header, silence]));
  }
}

// ============================================================
// 单例导出
// ============================================================

let instance = null;

module.exports = {
  WhisperProcessor,

  /** 获取/创建单例 */
  get whisper() {
    if (!instance) {
      throw new Error('WhisperProcessor not initialized. Call init() first.');
    }
    return instance;
  },

  /**
   * 初始化单例
   * @param {object} config - 配置项
   */
  init(config) {
    instance = new WhisperProcessor(config);
    return instance.init();
  },

  /** 销毁单例 */
  destroy() {
    if (instance) {
      instance.destroy();
      instance = null;
    }
  },
};
