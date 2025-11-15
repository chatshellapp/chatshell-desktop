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
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  messages: [],
  isLoading: false,
  isSending: false,
  isStreaming: false,
  streamingContent: '',
  scrapingStatus: 'idle',
  error: null,

  loadMessages: async (topicId: string) => {
    set({ isLoading: true, error: null });
    try {
      const messages = await invoke<Message[]>('list_messages', { topicId });
      set({ messages, isLoading: false });
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
    set({ isSending: true, error: null, streamingContent: '', isStreaming: true });
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
      
      set({ error: String(error), isSending: false, isStreaming: false });
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
    set((state) => ({
      streamingContent: state.streamingContent + chunk,
    }));
  },
}));

