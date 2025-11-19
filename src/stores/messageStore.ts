import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Message, Conversation } from '@/types';

// Per-conversation state
interface ConversationState {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  isWaitingForAI: boolean;
  scrapingStatus: 'idle' | 'scraping' | 'complete' | 'error';
}

// Default state for a new conversation
const createDefaultConversationState = (): ConversationState => ({
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: '',
  isWaitingForAI: false,
  scrapingStatus: 'idle',
});

interface MessageStore {
  // Map of conversationId -> state
  conversationStates: Map<string, ConversationState>;
  
  // Global states
  isSending: boolean;
  error: string | null;

  // Get state for specific conversation (creates if doesn't exist)
  getConversationState: (conversationId: string) => ConversationState;
  
  // Actions with conversationId
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (
    content: string,
    conversationId: string | null,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    includeHistory?: boolean,
    systemPrompt?: string,
    userPrompt?: string,
    modelDbId?: string,
    assistantDbId?: string
  ) => Promise<void>;
  stopGeneration: (conversationId: string) => Promise<void>;
  clearMessages: (conversationId: string) => Promise<void>;
  addMessage: (conversationId: string, message: Message) => void;
  setStreamingContent: (conversationId: string, content: string) => void;
  setIsStreaming: (conversationId: string, isStreaming: boolean) => void;
  setScrapingStatus: (conversationId: string, status: 'idle' | 'scraping' | 'complete' | 'error') => void;
  appendStreamingChunk: (conversationId: string, chunk: string) => void;
  setIsWaitingForAI: (conversationId: string, isWaiting: boolean) => void;
  cleanupConversation: (conversationId: string) => void;
}

// Throttling mechanism for streaming updates
const pendingChunks: Map<string, string[]> = new Map();
const updateScheduled: Map<string, boolean> = new Map();
const updateTimeoutIds: Map<string, NodeJS.Timeout> = new Map();
const THROTTLE_MS = 50; // Update UI every 50ms for smooth rendering

// Maximum messages to keep in memory to prevent memory leaks
const MAX_MESSAGES_IN_MEMORY = 100;

export const useMessageStore = create<MessageStore>((set, get) => ({
  conversationStates: new Map(),
  isSending: false,
  error: null,

  getConversationState: (conversationId: string) => {
    const state = get();
    let convState = state.conversationStates.get(conversationId);
    
    if (!convState) {
      // Create new state for this conversation
      convState = createDefaultConversationState();
      const newMap = new Map(state.conversationStates);
      newMap.set(conversationId, convState);
      set({ conversationStates: newMap });
    }
    
    return convState;
  },

  loadMessages: async (conversationId: string) => {
    const currentState = get().getConversationState(conversationId);
    
    // Update the state to loading
    const newMap = new Map(get().conversationStates);
    newMap.set(conversationId, { ...currentState, isLoading: true });
    set({ conversationStates: newMap, error: null });
    
    try {
      const messages = await invoke<Message[]>('list_messages_by_conversation', { conversationId });
      // Limit messages in memory to prevent memory leaks
      const limitedMessages = messages.slice(-MAX_MESSAGES_IN_MEMORY);
      
      const updatedMap = new Map(get().conversationStates);
      const state = updatedMap.get(conversationId) || createDefaultConversationState();
      updatedMap.set(conversationId, { ...state, messages: limitedMessages, isLoading: false });
      set({ conversationStates: updatedMap });
    } catch (error) {
      const updatedMap = new Map(get().conversationStates);
      const state = updatedMap.get(conversationId) || createDefaultConversationState();
      updatedMap.set(conversationId, { ...state, isLoading: false });
      set({ conversationStates: updatedMap, error: String(error) });
      console.error('Failed to load messages:', error);
    }
  },

  sendMessage: async (
    content: string,
    conversationId: string | null,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    includeHistory?: boolean,
    systemPrompt?: string,
    userPrompt?: string,
    modelDbId?: string,
    assistantDbId?: string
  ) => {
    set({ isSending: true, error: null });
    
    try {
      // If no conversationId, create a new conversation first
      let targetId = conversationId;
      if (!targetId) {
        console.log('[messageStore] No conversation ID provided, creating new conversation...');
        const newConversation = await invoke<Conversation>('create_conversation', {
          req: { title: 'New Conversation' }
        });
        targetId = newConversation.id;
        console.log('[messageStore] Created new conversation:', newConversation);
        
        // Update conversationStore to set this as current and add to list
        const { useConversationStore } = await import('./conversationStore');
        const conversationStore = useConversationStore.getState();
        conversationStore.setCurrentConversation(newConversation);
        // Also add to conversations list if not already there
        if (!conversationStore.conversations.find(c => c.id === newConversation.id)) {
          conversationStore.loadConversations(); // Reload to include the new one
        }
      }
      
      // Set waiting state for this conversation
      const currentState = get().getConversationState(targetId);
      const newMap = new Map(get().conversationStates);
      newMap.set(targetId, {
        ...currentState,
        isStreaming: true,
        isWaitingForAI: true,
        streamingContent: '',
      });
      set({ conversationStates: newMap });
      
      console.log('[messageStore] Invoking send_message command with params:', {
        conversationId: targetId,
        contentLength: content.length,
        provider,
        model,
        hasApiKey: !!apiKey,
        baseUrl,
        includeHistory,
        hasSystemPrompt: !!systemPrompt,
        hasUserPrompt: !!userPrompt,
        modelDbId,
        assistantDbId
      });

      // This will return the user message immediately
      const userMessage = await invoke<Message>('send_message', {
        conversationId: targetId,
        content,
        provider,
        model,
        apiKey,
        baseUrl,
        includeHistory,
        systemPrompt,
        userPrompt,
        modelDbId,
        assistantDbId,
      });

      console.log('[messageStore] Received user message:', userMessage);

      // Add user message to the conversation
      const updatedState = get().getConversationState(targetId);
      const updatedMap = new Map(get().conversationStates);
      updatedMap.set(targetId, {
        ...updatedState,
        messages: [...updatedState.messages, userMessage],
      });
      set({ conversationStates: updatedMap, isSending: false });

      console.log('[messageStore] User message added to store, waiting for assistant response...');

      // The assistant message will be added via the chat-complete event
    } catch (error) {
      console.error('[messageStore] Error in sendMessage:', error);
      console.error('[messageStore] Error type:', typeof error);
      console.error('[messageStore] Error details:', {
        error,
        errorString: String(error),
        errorKeys: error ? Object.keys(error) : 'null'
      });
      
      set({ error: String(error), isSending: false });
      throw error;
    }
  },

  stopGeneration: async (conversationId: string) => {
    try {
      console.log('[messageStore] Stopping generation for conversation:', conversationId);
      await invoke('stop_generation', { conversationId });
      
      // Only reset sending flag
      set({ isSending: false });
      
      console.log('[messageStore] Generation stopped successfully');
    } catch (error) {
      console.error('[messageStore] Failed to stop generation:', error);
    }
  },

  clearMessages: async (conversationId: string) => {
    const currentState = get().getConversationState(conversationId);
    const newMap = new Map(get().conversationStates);
    newMap.set(conversationId, { ...currentState, isLoading: true });
    set({ conversationStates: newMap, error: null });
    
    try {
      await invoke('clear_messages_by_conversation', { conversationId });
      
      const updatedMap = new Map(get().conversationStates);
      const state = updatedMap.get(conversationId) || createDefaultConversationState();
      updatedMap.set(conversationId, { ...state, messages: [], isLoading: false });
      set({ conversationStates: updatedMap });
    } catch (error) {
      const updatedMap = new Map(get().conversationStates);
      const state = updatedMap.get(conversationId) || createDefaultConversationState();
      updatedMap.set(conversationId, { ...state, isLoading: false });
      set({ conversationStates: updatedMap, error: String(error) });
      throw error;
    }
  },

  addMessage: (conversationId: string, message: Message) => {
    console.log('[messageStore] Adding message to conversation:', conversationId);
    const currentState = get().getConversationState(conversationId);
    
    // Check if message already exists (Entity Adapter pattern from Cherry Studio)
    const existingIndex = currentState.messages.findIndex(m => m.id === message.id);
    
    let updatedMessages;
    if (existingIndex >= 0) {
      // Replace existing message (idempotent behavior)
      console.log('[messageStore] Message exists, replacing:', message.id);
      updatedMessages = [...currentState.messages];
      updatedMessages[existingIndex] = message;
    } else {
      // Add new message
      updatedMessages = [...currentState.messages, message];
    }
    
    const newMap = new Map(get().conversationStates);
    newMap.set(conversationId, {
      ...currentState,
      messages: updatedMessages,
      isWaitingForAI: false,
    });
    set({ conversationStates: newMap });
  },

  setStreamingContent: (conversationId: string, content: string) => {
    const currentState = get().getConversationState(conversationId);
    const newMap = new Map(get().conversationStates);
    newMap.set(conversationId, { ...currentState, streamingContent: content });
    set({ conversationStates: newMap });
  },

  setIsStreaming: (conversationId: string, isStreaming: boolean) => {
    const currentState = get().getConversationState(conversationId);
    const newMap = new Map(get().conversationStates);
    newMap.set(conversationId, { ...currentState, isStreaming });
    set({ conversationStates: newMap });
  },

  setScrapingStatus: (conversationId: string, status: 'idle' | 'scraping' | 'complete' | 'error') => {
    const currentState = get().getConversationState(conversationId);
    const newMap = new Map(get().conversationStates);
    newMap.set(conversationId, { ...currentState, scrapingStatus: status });
    set({ conversationStates: newMap });
  },

  appendStreamingChunk: (conversationId: string, chunk: string) => {
    // Initialize arrays for this conversation if needed
    if (!pendingChunks.has(conversationId)) {
      pendingChunks.set(conversationId, []);
    }
    if (!updateScheduled.has(conversationId)) {
      updateScheduled.set(conversationId, false);
    }
    
    pendingChunks.get(conversationId)!.push(chunk);
    
    if (!updateScheduled.get(conversationId)) {
      updateScheduled.set(conversationId, true);
      
      // Clear any existing timeout to prevent leaks
      const existingTimeout = updateTimeoutIds.get(conversationId);
      if (existingTimeout !== undefined) {
        clearTimeout(existingTimeout);
      }
      
      // Use setTimeout for consistent throttling
      const timeoutId = setTimeout(() => {
        const currentState = get().getConversationState(conversationId);
        const chunks = pendingChunks.get(conversationId) || [];
        const allChunks = chunks.join('');
        pendingChunks.set(conversationId, []);
        updateScheduled.set(conversationId, false);
        updateTimeoutIds.delete(conversationId);
        
        const newMap = new Map(get().conversationStates);
        newMap.set(conversationId, {
          ...currentState,
          streamingContent: currentState.streamingContent + allChunks,
          isWaitingForAI: false,
        });
        set({ conversationStates: newMap });
      }, THROTTLE_MS);
      
      updateTimeoutIds.set(conversationId, timeoutId);
    }
  },

  setIsWaitingForAI: (conversationId: string, isWaiting: boolean) => {
    const currentState = get().getConversationState(conversationId);
    const newMap = new Map(get().conversationStates);
    newMap.set(conversationId, { ...currentState, isWaitingForAI: isWaiting });
    set({ conversationStates: newMap });
  },

  cleanupConversation: (conversationId: string) => {
    // Clear any pending timeouts for this conversation
    const timeoutId = updateTimeoutIds.get(conversationId);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      updateTimeoutIds.delete(conversationId);
    }
    
    // Clear pending chunks
    pendingChunks.delete(conversationId);
    updateScheduled.delete(conversationId);
    
    // Reset streaming state for this conversation
    const currentState = get().getConversationState(conversationId);
    const newMap = new Map(get().conversationStates);
    newMap.set(conversationId, {
      ...currentState,
      streamingContent: '',
      isStreaming: false,
      isWaitingForAI: false,
      scrapingStatus: 'idle',
    });
    set({ conversationStates: newMap });
  },
}));
