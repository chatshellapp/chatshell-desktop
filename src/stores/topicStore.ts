import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Topic, CreateTopicRequest } from '@/types';

interface TopicStore {
  topics: Topic[];
  currentTopic: Topic | null;
  isLoading: boolean;
  error: string | null;

  loadTopics: (agentId: string) => Promise<void>;
  createTopic: (req: CreateTopicRequest) => Promise<Topic>;
  updateTopic: (id: string, title: string) => Promise<Topic>;
  deleteTopic: (id: string) => Promise<void>;
  selectTopic: (id: string) => Promise<void>;
  setCurrentTopic: (topic: Topic | null) => void;
}

export const useTopicStore = create<TopicStore>((set, get) => ({
  topics: [],
  currentTopic: null,
  isLoading: false,
  error: null,

  loadTopics: async (agentId: string) => {
    set({ isLoading: true, error: null });
    try {
      const topics = await invoke<Topic[]>('list_topics', { agentId });
      set({ topics, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
      console.error('Failed to load topics:', error);
    }
  },

  createTopic: async (req: CreateTopicRequest) => {
    set({ isLoading: true, error: null });
    try {
      const topic = await invoke<Topic>('create_topic', { req });
      set((state) => ({
        topics: [topic, ...state.topics],
        isLoading: false,
      }));
      return topic;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  updateTopic: async (id: string, title: string) => {
    set({ isLoading: true, error: null });
    try {
      const topic = await invoke<Topic>('update_topic', { id, title });
      set((state) => ({
        topics: state.topics.map((t) => (t.id === id ? topic : t)),
        currentTopic: state.currentTopic?.id === id ? topic : state.currentTopic,
        isLoading: false,
      }));
      return topic;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  deleteTopic: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('delete_topic', { id });
      set((state) => ({
        topics: state.topics.filter((t) => t.id !== id),
        currentTopic: state.currentTopic?.id === id ? null : state.currentTopic,
        isLoading: false,
      }));
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  selectTopic: async (id: string) => {
    try {
      const topic = await invoke<Topic | null>('get_topic', { id });
      set({ currentTopic: topic });
    } catch (error) {
      console.error('Failed to select topic:', error);
      set({ error: String(error) });
    }
  },

  setCurrentTopic: (topic: Topic | null) => {
    set({ currentTopic: topic });
  },
}));

