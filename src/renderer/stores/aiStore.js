import { create } from 'zustand';

const useAiStore = create((set, get) => ({
  // 对话状态
  isChatting: false,           // 是否正在对话中
  chatMode: false,             // 是否处于 AI 对话模式（vs 手动填表模式）
  messages: [],                // [{ role: 'user'|'assistant'|'system', content, intent?, slots?, timestamp }]
  
  // 当前对话上下文
  currentIntent: null,         // 当前识别的意图
  pendingSlots: {},            // 待填充的槽位
  missingSlots: [],            // 缺失的必填槽位
  
  // 流式输出
  streamingContent: '',        // 当前流式内容
  
  // 自动决策
  lastDecision: null,          // 最近一次自动决策
  
  // 播报/复盘状态
  briefData: null,             // 今日播报数据
  reviewData: null,            // 复盘数据

  // 状态机
  dialogState: 'IDLE',         // IDLE | CHECKING | LLM_CALL | CONFIRM | WAITING | CREATING | FALLBACK
  roundCount: 0,               // 当前追问轮数
  sessionId: null,              // 当前会话 ID
  
  // Actions
  setChatMode: (mode) => set({ chatMode: mode }),
  setIsChatting: (v) => set({ isChatting: v }),
  addMessage: (msg) => set(s => ({ 
    messages: [...s.messages, { ...msg, timestamp: Date.now() }] 
  })),
  appendStreamContent: (chunk) => set(s => ({ 
    streamingContent: s.streamingContent + chunk 
  })),
  clearStreamContent: () => set({ streamingContent: '' }),
  setCurrentIntent: (intent) => set({ currentIntent: intent }),
  setPendingSlots: (slots) => set({ pendingSlots: slots }),
  setMissingSlots: (slots) => set({ missingSlots: slots }),
  setLastDecision: (d) => set({ lastDecision: d }),
  setBriefData: (d) => set({ briefData: d }),
  setReviewData: (d) => set({ reviewData: d }),

  // 状态机 actions
  setDialogState: (state) => set({ dialogState: state }),
  incrementRound: () => set(s => ({ roundCount: s.roundCount + 1 })),
  resetRoundCount: () => set({ roundCount: 0 }),
  setSessionId: (id) => set({ sessionId: id }),

  resetChat: () => set({ 
    messages: [], currentIntent: null, pendingSlots: {}, 
    missingSlots: [], streamingContent: '', isChatting: false, chatMode: false,
    dialogState: 'IDLE', roundCount: 0, sessionId: null,
  }),
}));

export default useAiStore;
