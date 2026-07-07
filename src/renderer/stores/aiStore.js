import { create } from 'zustand';

/**
 * AI Store — 纯 Agent 模式状态管理
 *
 * 状态机:
 *   IDLE → AGENT_RUNNING → REPLY（文本回复）
 *                         → CONFIRM_CREATE（创建确认）
 *                         → CONFIRM_DELETE（删除确认）
 *                         → CONFIRM_COMPLETE（完成确认）
 *                         → CONFIRM_UPDATE（更新确认）
 *                         → CONFIRM_CANDIDATES（多候选选择）
 *                         → FALLBACK（API 不可用）
 */

const useAiStore = create((set) => ({
  // ── 对话基础状态 ──
  isChatting: false,
  chatMode: false,
  messages: [],                // [{ role, content, toolCallType?, timestamp }]

  // ── Agent 状态 ──
  dialogState: 'IDLE',        // IDLE | AGENT_RUNNING | REPLY | CONFIRM_* | FALLBACK
  roundCount: 0,
  sessionId: null,

  // ── 确认流程 ──
  pendingConfirmId: null,
  confirmToolName: null,
  confirmPreview: null,

  // ── Actions ──
  setChatMode: (mode) => set({ chatMode: mode }),
  setIsChatting: (v) => set({ isChatting: v }),
  addMessage: (msg) => set(s => ({
    messages: [...s.messages, { ...msg, timestamp: Date.now() }],
  })),
  setDialogState: (state) => set({ dialogState: state }),
  incrementRound: () => set(s => ({ roundCount: s.roundCount + 1 })),
  resetRoundCount: () => set({ roundCount: 0 }),
  setSessionId: (id) => set({ sessionId: id }),
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
  resetChat: () => set({
    messages: [], isChatting: false, chatMode: false,
    dialogState: 'IDLE', roundCount: 0, sessionId: null,
    pendingConfirmId: null, confirmToolName: null, confirmPreview: null,
  }),
}));

export default useAiStore;
