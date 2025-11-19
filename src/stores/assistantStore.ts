import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Assistant, CreateAssistantRequest } from '@/types';

interface AssistantStore {
  assistants: Assistant[];
  currentAssistant: Assistant | null;
  isLoading: boolean;
  error: string | null;

  loadAssistants: () => Promise<void>;
  createAssistant: (req: CreateAssistantRequest) => Promise<Assistant>;
  updateAssistant: (id: string, req: CreateAssistantRequest) => Promise<Assistant>;
  deleteAssistant: (id: string) => Promise<void>;
  setCurrentAssistant: (assistant: Assistant | null) => void;
  getAssistant: (id: string) => Promise<Assistant | null>;
  getAssistantById: (id: string) => Assistant | undefined;
}

export const useAssistantStore = create<AssistantStore>((set, get) => ({
  assistants: [],
  currentAssistant: null,
  isLoading: false,
  error: null,

  loadAssistants: async () => {
    set({ isLoading: true, error: null });
    try {
      const assistants = await invoke<Assistant[]>('list_assistants');
      set({ assistants, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
      console.error('Failed to load assistants:', error);
    }
  },

  createAssistant: async (req: CreateAssistantRequest) => {
    set({ isLoading: true, error: null });
    try {
      const assistant = await invoke<Assistant>('create_assistant', { req });
      set((state) => ({
        assistants: [...state.assistants, assistant],
        isLoading: false,
      }));
      return assistant;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  updateAssistant: async (id: string, req: CreateAssistantRequest) => {
    set({ isLoading: true, error: null });
    try {
      const assistant = await invoke<Assistant>('update_assistant', { id, req });
      set((state) => ({
        assistants: state.assistants.map((a) => (a.id === id ? assistant : a)),
        currentAssistant: state.currentAssistant?.id === id ? assistant : state.currentAssistant,
        isLoading: false,
      }));
      return assistant;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  deleteAssistant: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('delete_assistant', { id });
      set((state) => ({
        assistants: state.assistants.filter((a) => a.id !== id),
        currentAssistant: state.currentAssistant?.id === id ? null : state.currentAssistant,
        isLoading: false,
      }));
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  setCurrentAssistant: (assistant: Assistant | null) => {
    // Note: No cleanup needed - messages are per-conversation, not per-assistant
    set({ currentAssistant: assistant });
  },

  getAssistant: async (id: string) => {
    try {
      const assistant = await invoke<Assistant | null>('get_assistant', { id });
      return assistant;
    } catch (error) {
      console.error('Failed to get assistant:', error);
      return null;
    }
  },

  getAssistantById: (id: string) => {
    return get().assistants.find(a => a.id === id);
  },
}));

