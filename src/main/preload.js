const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload 脚本 — 暴露安全的 IPC API 给渲染进程
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ==========================================
  // 事项操作
  // ==========================================
  tasks: {
    getAll: (params) => ipcRenderer.invoke('task:getAll', params),
    getById: (id) => ipcRenderer.invoke('task:getById', id),
    create: (task) => ipcRenderer.invoke('task:create', task),
    update: (id, task) => ipcRenderer.invoke('task:update', id, task),
    delete: (id) => ipcRenderer.invoke('task:delete', id),
    search: (query) => ipcRenderer.invoke('task:search', query),
    getByDateRange: (start, end) => ipcRenderer.invoke('task:getByDateRange', start, end),
    complete: (id) => ipcRenderer.invoke('task:complete', id),
  },

  // ==========================================
  // 知识库操作
  // ==========================================
  knowledge: {
    getAllNodes: (params) => ipcRenderer.invoke('knowledge:getAllNodes', params),
    getNodeById: (id) => ipcRenderer.invoke('knowledge:getNodeById', id),
    createNode: (node) => ipcRenderer.invoke('knowledge:createNode', node),
    updateNode: (id, node) => ipcRenderer.invoke('knowledge:updateNode', id, node),
    deleteNode: (id) => ipcRenderer.invoke('knowledge:deleteNode', id),
    getEdges: (params) => ipcRenderer.invoke('knowledge:getEdges', params),
    createEdge: (edge) => ipcRenderer.invoke('knowledge:createEdge', edge),
    deleteEdge: (id) => ipcRenderer.invoke('knowledge:deleteEdge', id),
    search: (query) => ipcRenderer.invoke('knowledge:search', query),
    findSimilar: (nodeId, k) => ipcRenderer.invoke('knowledge:findSimilar', nodeId, k),
    generateSummary: (period) => ipcRenderer.invoke('knowledge:generateSummary', period),
  },

  // ==========================================
  // 模型管理
  // ==========================================
  models: {
    getAll: () => ipcRenderer.invoke('model:getAll'),
    create: (model) => ipcRenderer.invoke('model:create', model),
    update: (id, model) => ipcRenderer.invoke('model:update', id, model),
    delete: (id) => ipcRenderer.invoke('model:delete', id),
    testConnection: (id) => ipcRenderer.invoke('model:testConnection', id),
    getBindings: () => ipcRenderer.invoke('model:getBindings'),
    setBinding: (scene, modelId) => ipcRenderer.invoke('model:setBinding', scene, modelId),
    getUsageStats: (period) => ipcRenderer.invoke('model:getUsageStats', period),
  },

  // ==========================================
  // 语音操作
  // ==========================================
  voice: {
    transcribe: (audioPath) => ipcRenderer.invoke('voice:transcribe', audioPath),
    getStatus: () => ipcRenderer.invoke('voice:getStatus'),
    speak: (text, options) => ipcRenderer.invoke('voice:speak', text, options),
  },

  // ==========================================
  // 系统操作
  // ==========================================
  system: {
    backup: () => ipcRenderer.invoke('system:backup'),
    restore: (backupPath) => ipcRenderer.invoke('system:restore', backupPath),
    export: (format) => ipcRenderer.invoke('system:export', format),
    getStorageStats: () => ipcRenderer.invoke('system:getStorageStats'),
    getAppVersion: () => ipcRenderer.invoke('system:getAppVersion'),
  },

  // ==========================================
  // 事件监听（主进程 → 渲染进程）
  // ==========================================
  on: (channel, callback) => {
    const validChannels = [
      'shortcut:voice-record',
      'notification:reminder',
      'model:status-changed',
      'data:sync-update',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },

  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
