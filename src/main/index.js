const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu } = require('electron');
const path = require('path');
const { initDatabase, closeDatabase } = require('./database');
const { registerIpcHandlers } = require('./ipc');

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'AI效率管家',
    backgroundColor: '#0f0f0f',
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 开发模式加载 webpack dev server，生产模式加载本地文件
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:9000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist-renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 注册全局快捷键
  globalShortcut.register('Ctrl+Shift+V', () => {
    mainWindow?.webContents.send('shortcut:voice-record');
  });
}

function createTray() {
  // 系统托盘 — 最小化到托盘
  const iconPath = path.join(__dirname, '..', '..', 'resources', 'tray-icon.png');
  try {
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show Window', click: () => mainWindow?.show() },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setToolTip('AI Efficiency');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow?.show());
  } catch (e) {
    console.warn('[Tray] Failed to create tray icon:', e.message);
  }
}

app.whenReady().then(async () => {
  try {
    // 初始化数据库
    await initDatabase();

    // 注册 IPC handlers
    registerIpcHandlers();

    // 创建窗口
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (err) {
    console.error('[App] Failed to start:', err);
    // 即使数据库初始化失败也尝试创建窗口
    registerIpcHandlers();
    createWindow();
  }
});

// 捕获未处理的错误，防止窗口闪退
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  closeDatabase();
});
