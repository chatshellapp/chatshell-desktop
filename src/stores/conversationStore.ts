import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { 
  Conversation, 
  CreateConversationRequest, 
  ConversationParticipant, 
  CreateConversationParticipantRequest, 
  ParticipantSummary,
  User,
  Model, 
  Assistant 
} from '@/types';
import { useMessageStore } from './messageStore';

interface ConversationStore {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  currentParticipants: ConversationParticipant[];
  
  // User can select EITHER a model OR an assistant (not both)
  selectedModel: Model | null;
  selectedAssistant: Assistant | null;
  
  isLoading: boolean;
  error: string | null;

  // Conversation actions
  loadConversations: () => Promise<void>;
  createConversation: (title: string) => Promise<Conversation>;
  updateConversation: (id: string, title: string) => Promise<Conversation>;
  deleteConversation: (id: string) => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  setCurrentConversation: (conversation: Conversation | null) => void;
  
  // Participant actions
  loadParticipants: (conversationId: string) => Promise<void>;
  addParticipant: (conversationId: string, participantType: string, participantId?: string, displayName?: string) => Promise<void>;
  removeParticipant: (participantId: string) => Promise<void>;
  
  // Selection actions
  setSelectedModel: (model: Model | null) => void;
  setSelectedAssistant: (assistant: Assistant | null) => void;
  
  // Helper to get current effective model
  getCurrentModel: () => Model | null;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: [],
  currentConversation: null,
  currentParticipants: [],
  selectedModel: null,
  selectedAssistant: null,
  isLoading: false,
  error: null,

  loadConversations: async () => {
    set({ isLoading: true, error: null });
    try {
      const conversations = await invoke<Conversation[]>('list_conversations');
      console.log('[conversationStore] Loaded conversations:', conversations);
      set({ conversations, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
      console.error('Failed to load conversations:', error);
    }
  },

  createConversation: async (title: string) => {
    set({ isLoading: true, error: null });
    try {
      const req: CreateConversationRequest = { title };
      const conversation = await invoke<Conversation>('create_conversation', { req });
      console.log('[conversationStore] Created conversation:', conversation);
      
      set((state) => ({
        conversations: [conversation, ...state.conversations],
        isLoading: false,
      }));
      
      return conversation;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  updateConversation: async (id: string, title: string) => {
    set({ isLoading: true, error: null });
    try {
      const conversation = await invoke<Conversation>('update_conversation', { id, title });
      set((state) => ({
        conversations: state.conversations.map((c) => (c.id === id ? conversation : c)),
        currentConversation: state.currentConversation?.id === id ? conversation : state.currentConversation,
        isLoading: false,
      }));
      return conversation;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  deleteConversation: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('delete_conversation', { id });
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== id),
        currentConversation: state.currentConversation?.id === id ? null : state.currentConversation,
        isLoading: false,
      }));
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  selectConversation: async (id: string) => {
    try {
      // Cleanup message store before switching conversations
      useMessageStore.getState().cleanup();
      
      const conversation = await invoke<Conversation | null>('get_conversation', { id });
      console.log('[conversationStore] Selected conversation:', conversation);
      
      if (conversation) {
        set({ currentConversation: conversation });
        // Load participants for this conversation
        await get().loadParticipants(id);
      } else {
        set({ currentConversation: null, currentParticipants: [] });
      }
    } catch (error) {
      console.error('Failed to select conversation:', error);
      set({ error: String(error) });
    }
  },

  setCurrentConversation: (conversation: Conversation | null) => {
    // Cleanup message store before switching conversations
    useMessageStore.getState().cleanup();
    set({ currentConversation: conversation });
  },

  loadParticipants: async (conversationId: string) => {
    try {
      const participants = await invoke<ConversationParticipant[]>('list_conversation_participants', { conversationId });
      console.log('[conversationStore] Loaded participants:', participants);
      set({ currentParticipants: participants });
    } catch (error) {
      console.error('Failed to load participants:', error);
      set({ error: String(error) });
    }
  },

  addParticipant: async (conversationId: string, participantType: string, participantId?: string, displayName?: string) => {
    try {
      const req: CreateConversationParticipantRequest = {
        conversation_id: conversationId,
        participant_type: participantType,
        participant_id: participantId,
        display_name: displayName,
      };
      const participant = await invoke<ConversationParticipant>('add_conversation_participant', { req });
      console.log('[conversationStore] Added participant:', participant);
      
      set((state) => ({
        currentParticipants: [...state.currentParticipants, participant],
      }));
    } catch (error) {
      console.error('Failed to add participant:', error);
      set({ error: String(error) });
      throw error;
    }
  },

  removeParticipant: async (participantId: string) => {
    try {
      await invoke('remove_conversation_participant', { id: participantId });
      set((state) => ({
        currentParticipants: state.currentParticipants.filter((p) => p.id !== participantId),
      }));
    } catch (error) {
      console.error('Failed to remove participant:', error);
      set({ error: String(error) });
      throw error;
    }
  },

  setSelectedModel: (model: Model | null) => {
    console.log('[conversationStore] Setting selected model:', model?.name);
    set({ 
      selectedModel: model,
      // When selecting a model, clear assistant selection
      selectedAssistant: null,
    });
  },

  setSelectedAssistant: (assistant: Assistant | null) => {
    console.log('[conversationStore] Setting selected assistant:', assistant?.name);
    set({ 
      selectedAssistant: assistant,
      // When selecting an assistant, clear model selection
      selectedModel: null,
    });
  },

  getCurrentModel: () => {
    const state = get();
    // If assistant is selected, return its model (would need to fetch from modelStore)
    // If model is selected, return it directly
    return state.selectedModel;
  },
}));

