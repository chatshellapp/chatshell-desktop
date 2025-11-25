import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
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
  // Track URLs being scraped for each message: { messageId: [urls] }
  scrapingUrls: Record<string, string[]>;
}

// Default state for a new conversation
const createDefaultConversationState = (): ConversationState => ({
  messages: [],
  isLoading: false,
  isStreaming: false,
  streamingContent: '',
  isWaitingForAI: false,
  scrapingStatus: 'idle',
  scrapingUrls: {},
});

interface MessageStore {
  // Record of conversationId -> state
  conversationStates: Record<string, ConversationState>;
  
  // Global states
  isSending: boolean;
  error: string | null;

  // Callback for inter-store communication (avoids direct store imports)
  onNewConversationCreated?: (conversation: Conversation) => void;

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
  setScrapingUrls: (conversationId: string, messageId: string, urls: string[]) => void;
  clearScrapingUrls: (conversationId: string, messageId: string) => void;
  appendStreamingChunk: (conversationId: string, chunk: string) => void;
  setIsWaitingForAI: (conversationId: string, isWaiting: boolean) => void;
  cleanupConversation: (conversationId: string) => void;
  removeConversationState: (conversationId: string) => void;
}

// Throttling mechanism for streaming updates
const pendingChunks: Map<string, string[]> = new Map();
const updateScheduled: Map<string, boolean> = new Map();
const updateTimeoutIds: Map<string, NodeJS.Timeout> = new Map();
const THROTTLE_MS = 50; // Update UI every 50ms for smooth rendering

// Maximum messages to keep in memory to prevent memory leaks
const MAX_MESSAGES_IN_MEMORY = 100;

export const useMessageStore = create<MessageStore>()(
  immer((set, get) => ({
  conversationStates: {},
  isSending: false,
  error: null,
  onNewConversationCreated: undefined,

  getConversationState: (conversationId: string) => {
    const state = get();
    let convState = state.conversationStates[conversationId];
    
    if (!convState) {
      // Create new state for this conversation
      convState = createDefaultConversationState();
      set((draft) => {
        draft.conversationStates[conversationId] = convState!;
      });
    }
    
    return convState;
  },

  loadMessages: async (conversationId: string) => {
    get().getConversationState(conversationId); // Ensure state exists
    
    // Update the state to loading
    set((draft) => {
      const convState = draft.conversationStates[conversationId];
      if (convState) {
        convState.isLoading = true;
      }
      draft.error = null;
    });
    
    try {
      const messages = await invoke<Message[]>('list_messages_by_conversation', { conversationId });
      // Limit messages in memory to prevent memory leaks
      const limitedMessages = messages.slice(-MAX_MESSAGES_IN_MEMORY);
      
      set((draft) => {
        const convState = draft.conversationStates[conversationId];
        if (convState) {
          convState.messages = limitedMessages;
          convState.isLoading = false;
        }
      });
    } catch (error) {
      set((draft) => {
        const convState = draft.conversationStates[conversationId];
        if (convState) {
          convState.isLoading = false;
        }
        draft.error = String(error);
      });
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
    set((draft) => {
      draft.isSending = true;
      draft.error = null;
    });
    
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
        
        // Notify via callback (avoids direct store coupling)
        const callback = get().onNewConversationCreated;
        if (callback) {
          callback(newConversation);
        }
      }
      
      // Set waiting state for this conversation
      get().getConversationState(targetId); // Ensure state exists
      set((draft) => {
        const convState = draft.conversationStates[targetId];
        if (convState) {
          convState.isStreaming = true;
          convState.isWaitingForAI = true;
          convState.streamingContent = '';
        }
      });
      
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
      set((draft) => {
        const convState = draft.conversationStates[targetId];
        if (convState) {
          convState.messages.push(userMessage);
        }
        draft.isSending = false;
      });

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
      
      set((draft) => {
        draft.error = String(error);
        draft.isSending = false;
      });
      throw error;
    }
  },

  stopGeneration: async (conversationId: string) => {
    try {
      console.log('[messageStore] Stopping generation for conversation:', conversationId);
      await invoke('stop_generation', { conversationId });
      
      // Only reset sending flag
      set((draft) => {
        draft.isSending = false;
      });
      
      console.log('[messageStore] Generation stopped successfully');
    } catch (error) {
      console.error('[messageStore] Failed to stop generation:', error);
    }
  },

  clearMessages: async (conversationId: string) => {
    get().getConversationState(conversationId); // Ensure state exists
    
    set((draft) => {
      const convState = draft.conversationStates[conversationId];
      if (convState) {
        convState.isLoading = true;
      }
      draft.error = null;
    });
    
    try {
      await invoke('clear_messages_by_conversation', { conversationId });
      
      set((draft) => {
        const convState = draft.conversationStates[conversationId];
        if (convState) {
          convState.messages = [];
          convState.isLoading = false;
        }
      });
    } catch (error) {
      set((draft) => {
        const convState = draft.conversationStates[conversationId];
        if (convState) {
          convState.isLoading = false;
        }
        draft.error = String(error);
      });
      throw error;
    }
  },

  addMessage: (conversationId: string, message: Message) => {
    console.log('[messageStore] Adding message to conversation:', conversationId);
    get().getConversationState(conversationId); // Ensure state exists
    
    set((draft) => {
      const convState = draft.conversationStates[conversationId];
      if (convState) {
        // Check if message already exists (Entity Adapter pattern from Cherry Studio)
        const existingIndex = convState.messages.findIndex((m: Message) => m.id === message.id);
        
        if (existingIndex >= 0) {
          // Replace existing message (idempotent behavior)
          console.log('[messageStore] Message exists, replacing:', message.id);
          convState.messages[existingIndex] = message;
        } else {
          // Add new message
          convState.messages.push(message);
        }
        
        convState.isWaitingForAI = false;
      }
    });
  },

  setStreamingContent: (conversationId: string, content: string) => {
    get().getConversationState(conversationId); // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId];
      if (convState) {
        convState.streamingContent = content;
      }
    });
  },

  setIsStreaming: (conversationId: string, isStreaming: boolean) => {
    get().getConversationState(conversationId); // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId];
      if (convState) {
        convState.isStreaming = isStreaming;
      }
    });
  },

  setScrapingStatus: (conversationId: string, status: 'idle' | 'scraping' | 'complete' | 'error') => {
    get().getConversationState(conversationId); // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId];
      if (convState) {
        convState.scrapingStatus = status;
      }
    });
  },

  setScrapingUrls: (conversationId: string, messageId: string, urls: string[]) => {
    get().getConversationState(conversationId); // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId];
      if (convState) {
        convState.scrapingUrls[messageId] = urls;
      }
    });
  },

  clearScrapingUrls: (conversationId: string, messageId: string) => {
    get().getConversationState(conversationId); // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId];
      if (convState) {
        delete convState.scrapingUrls[messageId];
      }
    });
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
        get().getConversationState(conversationId); // Ensure state exists
        const chunks = pendingChunks.get(conversationId) || [];
        const allChunks = chunks.join('');
        pendingChunks.set(conversationId, []);
        updateScheduled.set(conversationId, false);
        updateTimeoutIds.delete(conversationId);
        
        set((draft) => {
          const convState = draft.conversationStates[conversationId];
          if (convState) {
            convState.streamingContent = convState.streamingContent + allChunks;
            convState.isWaitingForAI = false;
          }
        });
      }, THROTTLE_MS);
      
      updateTimeoutIds.set(conversationId, timeoutId);
    }
  },

  setIsWaitingForAI: (conversationId: string, isWaiting: boolean) => {
    get().getConversationState(conversationId); // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId];
      if (convState) {
        convState.isWaitingForAI = isWaiting;
      }
    });
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
    get().getConversationState(conversationId); // Ensure state exists
    set((draft) => {
      const convState = draft.conversationStates[conversationId];
      if (convState) {
        convState.streamingContent = '';
        convState.isStreaming = false;
        convState.isWaitingForAI = false;
        convState.scrapingStatus = 'idle';
      }
    });
  },

  removeConversationState: (conversationId: string) => {
    // Clear any pending timeouts for this conversation
    const timeoutId = updateTimeoutIds.get(conversationId);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      updateTimeoutIds.delete(conversationId);
    }
    
    // Clear pending chunks
    pendingChunks.delete(conversationId);
    updateScheduled.delete(conversationId);
    
    // Completely remove conversation state from memory
    set((draft) => {
      delete draft.conversationStates[conversationId];
    });
    
    console.log('[messageStore] Removed conversation state for:', conversationId);
  },
})));
