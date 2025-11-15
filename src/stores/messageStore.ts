import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Message, CreateMessageRequest } from '@/types';

interface MessageStore {
  messages: Message[];
  isLoading: boolean;
  isSending: boolean;
  isStreaming: boolean;
  streamingContent: string;
  scrapingStatus: 'idle' | 'scraping' | 'complete' | 'error';
  error: string | null;
  isWaitingForAI: boolean;

  loadMessages: (topicId: string) => Promise<void>;
  sendMessage: (
    content: string,
    topicId: string,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    includeHistory?: boolean
  ) => Promise<void>;
  clearMessages: (topicId: string) => Promise<void>;
  addMessage: (message: Message) => void;
  setStreamingContent: (content: string) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setScrapingStatus: (status: 'idle' | 'scraping' | 'complete' | 'error') => void;
  appendStreamingChunk: (chunk: string) => void;
  setIsWaitingForAI: (isWaiting: boolean) => void;
  cleanup: () => void;
}

// Throttling mechanism for streaming updates
let pendingChunks: string[] = [];
let updateScheduled = false;
let updateTimeoutId: NodeJS.Timeout | null = null;
const THROTTLE_MS = 50; // Update UI every 50ms for smooth rendering

// Maximum messages to keep in memory to prevent memory leaks
const MAX_MESSAGES_IN_MEMORY = 100;

export const useMessageStore = create<MessageStore>((set, get) => ({
  messages: [],
  isLoading: false,
  isSending: false,
  isStreaming: false,
  streamingContent: '',
  scrapingStatus: 'idle',
  error: null,
  isWaitingForAI: false,

  loadMessages: async (topicId: string) => {
    set({ isLoading: true, error: null });
    try {
      const messages = await invoke<Message[]>('list_messages', { topicId });
      // Limit messages in memory to prevent memory leaks
      const limitedMessages = messages.slice(-MAX_MESSAGES_IN_MEMORY);
      set({ messages: limitedMessages, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
      console.error('Failed to load messages:', error);
    }
  },

  sendMessage: async (
    content: string,
    topicId: string,
    provider: string,
    model: string,
    apiKey?: string,
    baseUrl?: string,
    includeHistory?: boolean
  ) => {
    set({ isSending: true, error: null, streamingContent: '', isStreaming: true, isWaitingForAI: true });
    try {
      console.log('[messageStore] Invoking send_message command with params:', {
        topicId,
        contentLength: content.length,
        provider,
        model,
        hasApiKey: !!apiKey,
        baseUrl,
        includeHistory
      });

      // This will return the user message immediately
      const userMessage = await invoke<Message>('send_message', {
        topicId,
        content,
        provider,
        model,
        apiKey,
        baseUrl,
        includeHistory,
      });

      console.log('[messageStore] Received user message:', userMessage);

      // Add user message to the list
      set((state) => ({
        messages: [...state.messages, userMessage],
        isSending: false,
      }));

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
      
      set({ error: String(error), isSending: false, isStreaming: false, isWaitingForAI: false });
      throw error;
    }
  },

  clearMessages: async (topicId: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('clear_messages', { topicId });
      set({ messages: [], isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  addMessage: (message: Message) => {
    set((state) => ({
      messages: [...state.messages, message],
      isWaitingForAI: false,
    }));
  },

  setStreamingContent: (content: string) => {
    set({ streamingContent: content });
  },

  setIsStreaming: (isStreaming: boolean) => {
    set({ isStreaming });
  },

  setScrapingStatus: (status: 'idle' | 'scraping' | 'complete' | 'error') => {
    set({ scrapingStatus: status });
  },

  appendStreamingChunk: (chunk: string) => {
    pendingChunks.push(chunk);
    
    if (!updateScheduled) {
      updateScheduled = true;
      
      // Clear any existing timeout to prevent leaks
      if (updateTimeoutId !== null) {
        clearTimeout(updateTimeoutId);
      }
      
      // Use setTimeout for consistent throttling
      updateTimeoutId = setTimeout(() => {
        const currentState = get();
        const allChunks = pendingChunks.join('');
        pendingChunks = [];
        updateScheduled = false;
        updateTimeoutId = null;
        
        set({
          streamingContent: currentState.streamingContent + allChunks,
          isWaitingForAI: false,
        });
      }, THROTTLE_MS);
    }
  },

  setIsWaitingForAI: (isWaiting: boolean) => {
    set({ isWaitingForAI: isWaiting });
  },

  cleanup: () => {
    // Clear any pending timeouts
    if (updateTimeoutId !== null) {
      clearTimeout(updateTimeoutId);
      updateTimeoutId = null;
    }
    
    // Clear pending chunks
    pendingChunks = [];
    updateScheduled = false;
    
    // Reset streaming state
    set({
      streamingContent: '',
      isStreaming: false,
      isWaitingForAI: false,
      scrapingStatus: 'idle',
    });
  },
}));

