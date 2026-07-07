import { create } from 'zustand';

/**
 * AI Store — Agent 模式状态管理
 * 
 * 状态机（Agent 模式）:
 *   IDLE → CHECKING → AGENT_RUNNING → REPLY（展示文本回复）
 *                                    → CONFIRM_CREATE（创建确认）
 *                                    → CONFIRM_DELETE（删除确认）
 *                                    → CONFIRM_COMPLETE（完成确认）
 *                                    → CONFIRM_UPDATE（更新确认）
 *                                    → CONFIRM_CANDIDATES（多候选选择）
 *                                    → FALLBACK（降级）
 */

const useAiStore = create((set, get) => ({
  // ── 对话基础状态 ──
  isChatting: false,
  chatMode: false,
  messages: [],                // [{ role, content, toolCallType?, timestamp }]

  // ── Agent 模式状态 ──
  dialogState: 'IDLE',        // IDLE | CHECKING | AGENT_RUNNING | REPLY | CONFIRM_* | FALLBACK
  roundCount: 0,
  sessionId: null,

  // ── 确认相关 ──
  pendingConfirmId: null,     // Agent 循环的确认 ID（用于恢复）
  confirmToolName: null,      // 当前确认的 tool 名称
  confirmPreview: null,       // tool 返回的预览数据

  // ── 兼容旧模式（降级时用）──
  currentIntent: null,
  pendingSlots: {},
  missingSlots: [],
  streamingContent: '',
  lastDecision: null,
  briefData: null,
  reviewData: null,

  // ── Actions: 基础 ──
  setChatMode: (mode) => set({ chatMode: mode }),
  setIsChatting: (v) => set({ isChatting: v }),
  addMessage: (msg) => set(s => ({
    messages: [...s.messages, { ...msg, timestamp: Date.now() }],
  })),
  appendStreamContent: (chunk) => set(s => ({
    streamingContent: s.streamingContent + chunk,
  })),
  clearStreamContent: () => set({ streamingContent: '' }),

  // ── Actions: 状态机 ──
  setDialogState: (state) => set({ dialogState: state }),
  incrementRound: () => set(s => ({ roundCount: s.roundCount + 1 })),
  resetRoundCount: () => set({ roundCount: 0 }),
  setSessionId: (id) => set({ sessionId: id }),

  // ── Actions: Agent 确认流程 ──
  setConfirmState: ({ confirmId, toolName, preview }) => set({
    pendingConfirmId: confirmId,
    confirmToolName: toolName,
    confirmPreview: preview,
  }),
  clearConfirmState: () => set({
    pendingConfirmId: null,
    confirmToolName: null,
    confirmPreview: null,
  }),

  // ── Actions: 兼容旧模式 ──
  setCurrentIntent: (intent) => set({ currentIntent: intent }),
  setPendingSlots: (slots) => set({ pendingSlots: slots }),
  setMissingSlots: (slots) => set({ missingSlots: slots }),
  setLastDecision: (d) => set({ lastDecision: d }),
  setBriefData: (d) => set({ briefData: d }),
  setReviewData: (d) => set({ reviewData: d }),

  // ── Action: 重置 ──
  resetChat: () => set({
    messages: [], currentIntent: null, pendingSlots: {},
    missingSlots: [], streamingContent: '', isChatting: false, chatMode: false,
    dialogState: 'IDLE', roundCount: 0, sessionId: null,
    pendingConfirmId: null, confirmToolName: null, confirmPreview: null,
  }),
}));

export default useAiStore;
