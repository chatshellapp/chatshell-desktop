import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
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

interface ConversationStore {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  currentParticipants: ConversationParticipant[];
  
  // User can select EITHER a model OR an assistant (not both)
  selectedModel: Model | null;
  selectedAssistant: Assistant | null;
  
  // Track last used model/assistant for default selection
  lastUsedModel: Model | null;
  lastUsedAssistant: Assistant | null;
  isFirstConversationSinceStartup: boolean;
  
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

export const useConversationStore = create<ConversationStore>()(
  immer((set, get) => ({
  conversations: [],
  currentConversation: null,
  currentParticipants: [],
  selectedModel: null,
  selectedAssistant: null,
  lastUsedModel: null,
  lastUsedAssistant: null,
  isFirstConversationSinceStartup: true,
  isLoading: false,
  error: null,

  loadConversations: async () => {
    set((draft) => {
      draft.isLoading = true;
      draft.error = null;
    });
    try {
      const conversations = await invoke<Conversation[]>('list_conversations');
      console.log('[conversationStore] Loaded conversations:', conversations);
      set((draft) => {
        draft.conversations = conversations;
        draft.isLoading = false;
      });
    } catch (error) {
      set((draft) => {
        draft.error = String(error);
        draft.isLoading = false;
      });
      console.error('Failed to load conversations:', error);
    }
  },

  createConversation: async (title: string) => {
    set((draft) => {
      draft.isLoading = true;
      draft.error = null;
    });
    try {
      const req: CreateConversationRequest = { title };
      const conversation = await invoke<Conversation>('create_conversation', { req });
      console.log('[conversationStore] Created conversation:', conversation);
      
      set((draft) => {
        draft.conversations.unshift(conversation);
        draft.isLoading = false;
      });
      
      return conversation;
    } catch (error) {
      set((draft) => {
        draft.error = String(error);
        draft.isLoading = false;
      });
      throw error;
    }
  },

  updateConversation: async (id: string, title: string) => {
    set((draft) => {
      draft.isLoading = true;
      draft.error = null;
    });
    try {
      const conversation = await invoke<Conversation>('update_conversation', { id, title });
      set((draft) => {
        const index = draft.conversations.findIndex((c: Conversation) => c.id === id);
        if (index >= 0) {
          draft.conversations[index] = conversation;
        }
        if (draft.currentConversation?.id === id) {
          draft.currentConversation = conversation;
        }
        draft.isLoading = false;
      });
      return conversation;
    } catch (error) {
      set((draft) => {
        draft.error = String(error);
        draft.isLoading = false;
      });
      throw error;
    }
  },

  deleteConversation: async (id: string) => {
    set((draft) => {
      draft.isLoading = true;
      draft.error = null;
    });
    try {
      await invoke('delete_conversation', { id });
      
      // Clean up message store state for this conversation
      const { useMessageStore } = await import('./messageStore');
      useMessageStore.getState().removeConversationState(id);
      
      set((draft) => {
        draft.conversations = draft.conversations.filter((c: Conversation) => c.id !== id);
        if (draft.currentConversation?.id === id) {
          draft.currentConversation = null;
        }
        draft.isLoading = false;
      });
    } catch (error) {
      set((draft) => {
        draft.error = String(error);
        draft.isLoading = false;
      });
      throw error;
    }
  },

  selectConversation: async (id: string) => {
    try {
      // Don't cleanup here - preserve streaming state across conversation switches
      // The streaming state is now tracked per conversation ID
      
      const conversation = await invoke<Conversation | null>('get_conversation', { id });
      console.log('[conversationStore] Selected conversation:', conversation);
      
      if (conversation) {
        set((draft) => {
          draft.currentConversation = conversation;
        });
        // Load participants for this conversation
        await get().loadParticipants(id);
        
        // Set selected model/assistant based on conversation participants (select the LAST joined one)
        const participants = get().currentParticipants;
        const modelOrAssistantParticipants = participants.filter(
          p => p.participant_type === 'model' || p.participant_type === 'assistant'
        );
        const modelOrAssistantParticipant = modelOrAssistantParticipants.length > 0 
          ? modelOrAssistantParticipants[modelOrAssistantParticipants.length - 1]
          : null;
        
        if (modelOrAssistantParticipant) {
          // Import stores dynamically to avoid circular dependencies
          const { useModelStore } = await import('./modelStore');
          const { useAssistantStore } = await import('./assistantStore');
          
          if (modelOrAssistantParticipant.participant_type === 'model' && modelOrAssistantParticipant.participant_id) {
            const model = useModelStore.getState().getModelById(modelOrAssistantParticipant.participant_id);
            if (model) {
              get().setSelectedModel(model);
              console.log('[conversationStore] Set selected model from conversation:', model.name);
            }
          } else if (modelOrAssistantParticipant.participant_type === 'assistant' && modelOrAssistantParticipant.participant_id) {
            const assistant = useAssistantStore.getState().assistants.find(
              (a: Assistant) => a.id === modelOrAssistantParticipant.participant_id
            );
            if (assistant) {
              get().setSelectedAssistant(assistant);
              console.log('[conversationStore] Set selected assistant from conversation:', assistant.name);
            }
          }
        } else {
          // No participants yet - use lastUsed model/assistant to maintain continuity
          const state = get();
          if (state.lastUsedModel) {
            get().setSelectedModel(state.lastUsedModel);
            console.log('[conversationStore] No participant found, using lastUsedModel:', state.lastUsedModel.name);
          } else if (state.lastUsedAssistant) {
            get().setSelectedAssistant(state.lastUsedAssistant);
            console.log('[conversationStore] No participant found, using lastUsedAssistant:', state.lastUsedAssistant.name);
          } else {
            // Only clear if we have no lastUsed either
            set((draft) => {
              draft.selectedModel = null;
              draft.selectedAssistant = null;
            });
            console.log('[conversationStore] No model/assistant found, cleared selection');
          }
        }
      } else {
        set((draft) => {
          draft.currentConversation = null;
          draft.currentParticipants = [];
        });
      }
    } catch (error) {
      console.error('Failed to select conversation:', error);
      set((draft) => {
        draft.error = String(error);
      });
    }
  },

  setCurrentConversation: (conversation: Conversation | null) => {
    // Don't cleanup here - preserve streaming state across conversation switches
    // The streaming state is now tracked per conversation ID
    set((draft) => {
      draft.currentConversation = conversation;
    });
  },

  loadParticipants: async (conversationId: string) => {
    try {
      const participants = await invoke<ConversationParticipant[]>('list_conversation_participants', { conversationId });
      console.log('[conversationStore] Loaded participants:', participants);
      set((draft) => {
        draft.currentParticipants = participants;
      });
    } catch (error) {
      console.error('Failed to load participants:', error);
      set((draft) => {
        draft.error = String(error);
      });
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
      
      set((draft) => {
        draft.currentParticipants.push(participant);
      });
    } catch (error) {
      console.error('Failed to add participant:', error);
      set((draft) => {
        draft.error = String(error);
      });
      throw error;
    }
  },

  removeParticipant: async (participantId: string) => {
    try {
      await invoke('remove_conversation_participant', { id: participantId });
      set((draft) => {
        draft.currentParticipants = draft.currentParticipants.filter((p: ConversationParticipant) => p.id !== participantId);
      });
    } catch (error) {
      console.error('Failed to remove participant:', error);
      set((draft) => {
        draft.error = String(error);
      });
      throw error;
    }
  },

  setSelectedModel: (model: Model | null) => {
    console.log('[conversationStore] Setting selected model:', model?.name);
    set((draft) => {
      draft.selectedModel = model;
      draft.selectedAssistant = null;
      draft.lastUsedModel = model;
      draft.lastUsedAssistant = null;
    });
  },

  setSelectedAssistant: (assistant: Assistant | null) => {
    console.log('[conversationStore] Setting selected assistant:', assistant?.name);
    set((draft) => {
      draft.selectedAssistant = assistant;
      draft.selectedModel = null;
      draft.lastUsedAssistant = assistant;
      draft.lastUsedModel = null;
    });
  },

  getCurrentModel: () => {
    const state = get();
    // If assistant is selected, return its model (would need to fetch from modelStore)
    // If model is selected, return it directly
    return state.selectedModel;
  },
})));

