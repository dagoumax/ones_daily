const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, Notification } = require('electron');
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
    title: 'AI Efficiency',
    backgroundColor: '#0f0f0f',
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

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

  // Ctrl+N: 快速创建事项
  globalShortcut.register('Ctrl+N', () => {
    mainWindow?.webContents.send('shortcut:quick-create');
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
    // 即使初始化失败也尝试创建窗口（但不重复注册 IPC）
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
