# Whisper.cpp Windows 集成指南

> **状态**：待本地 Windows 验证  
> **目标**：在 Windows 10/11 上编译 whisper.cpp 并通过 Electron 子进程调用

---

## 一、Windows 编译 Whisper.cpp

### 方案 A：使用 MSVC（推荐）

```powershell
# 1. 安装前置依赖
# - Visual Studio 2022 Build Tools（含 C++ 工作负载）
# - CMake 3.20+
# - Git

# 2. 克隆 whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp

# 3. 编译（CPU 版本，无需 CUDA）
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release

# 4. 验证编译产物
.\build\bin\Release\whisper-cli.exe --help
```

### 方案 B：使用 MinGW（备选）

```powershell
cmake -B build -G "MinGW Makefiles"
cmake --build build
```

### 方案 C：下载预编译二进制（最快）

从 https://github.com/ggerganov/whisper.cpp/releases 下载 Windows 预编译包。

---

## 二、下载模型文件

```powershell
# 推荐 small 模型（1.5GB，速度和精度平衡）
# 下载到 Electron 应用的资源目录
mkdir models
cd models
curl -L -o ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

**模型选择参考**：

| 模型 | 大小 | 内存 | 30s音频转写耗时 | 中文准确率 |
|------|------|------|----------------|-----------|
| tiny | 150MB | ~500MB | ~1s | 一般 |
| base | 280MB | ~800MB | ~2s | 可接受 |
| small | 1.5GB | ~2GB | ~5s | 良好 |
| medium | 3GB | ~4GB | ~10s | 优秀 |

**推荐 MVP 使用 small 模型**。

---

## 三、Electron 集成

### 3.1 目录结构

```
electron-app/
├── resources/
│   ├── whisper-cli.exe        # 预编译的可执行文件
│   └── models/
│       └── ggml-small.bin     # 模型文件
├── src/
│   ├── main/
│   │   ├── index.js           # Electron 主进程
│   │   └── whisper-processor.js  # 子进程管理模块
│   └── renderer/
│       └── App.jsx
└── package.json
```

### 3.2 主进程集成代码

```javascript
// src/main/index.js
const { app, ipcMain } = require('electron');
const path = require('path');
const { init, whisper } = require('./whisper-processor');

app.whenReady().then(async () => {
  // 初始化 Whisper
  await init({
    executablePath: path.join(
      process.resourcesPath, 
      'whisper-cli.exe'
    ),
    modelPath: path.join(
      process.resourcesPath, 
      'models', 'ggml-small.bin'
    ),
    debug: !app.isPackaged,
  });

  // 预热模型（可选）
  try {
    await whisper.warmup();
    console.log('Whisper model pre-loaded');
  } catch (err) {
    console.warn('Whisper warmup failed (will load on first use):', err.message);
  }

  // 注册 IPC handler
  ipcMain.handle('whisper:transcribe', async (event, audioFilePath) => {
    try {
      const result = await whisper.transcribe(audioFilePath);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('whisper:status', () => {
    return whisper.status;
  });
});
```

### 3.3 打包配置（electron-builder）

```json
{
  "build": {
    "extraResources": [
      {
        "from": "resources/whisper-cli.exe",
        "to": "whisper-cli.exe"
      },
      {
        "from": "resources/models",
        "to": "models"
      }
    ]
  }
}
```

---

## 四、性能验证清单

在 Windows 上执行以下测试：

- [ ] `whisper-cli.exe` 能正常运行（`--help` 输出正常）
- [ ] 5 秒中文音频 → 转写成功，耗时 < 3 秒
- [ ] 30 秒中文音频 → 转写成功，耗时 < 5 秒
- [ ] 60 秒中文音频 → 转写成功，耗时 < 10 秒
- [ ] Electron spawn 子进程 → 转写成功
- [ ] 子进程崩溃时主进程不受影响
- [ ] 连续 3 次转写，内存不泄漏
- [ ] 模型首次加载时间 < 10 秒

---

## 五、已知风险与缓解

| 风险 | 缓解 |
|------|------|
| MSVC 编译失败 | 使用预编译二进制 |
| 模型下载慢 | 打包时内置模型 |
| 子进程中文路径问题 | 使用英文路径存放 whisper-cli.exe 和模型 |
| Windows Defender 误报 | 提交二进制到 Microsoft 进行安全审查 |
| 4GB RAM 设备 OOM | 使用 base 模型降级（280MB） |
