import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Setting, ModelInfo } from '@/types';

interface SettingsStore {
  settings: Record<string, string>;
  models: { [provider: string]: ModelInfo[] };
  isLoading: boolean;
  error: string | null;

  loadSettings: () => Promise<void>;
  getSetting: (key: string) => Promise<string | null>;
  saveSetting: (key: string, value: string) => Promise<void>;
  fetchModels: (provider: string, apiKeyOrUrl?: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: {},
  models: {},
  isLoading: false,
  error: null,

  loadSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const settingsArray = await invoke<Setting[]>('get_all_settings');
      const settingsMap: Record<string, string> = {};
      settingsArray.forEach((setting) => {
        settingsMap[setting.key] = setting.value;
      });
      set({ settings: settingsMap, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
      console.error('Failed to load settings:', error);
    }
  },

  getSetting: async (key: string) => {
    try {
      const value = await invoke<string | null>('get_setting', { key });
      return value;
    } catch (error) {
      console.error('Failed to get setting:', error);
      return null;
    }
  },

  saveSetting: async (key: string, value: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('set_setting', { key, value });
      set((state) => ({
        settings: { ...state.settings, [key]: value },
        isLoading: false,
      }));
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  fetchModels: async (provider: string, apiKeyOrUrl?: string) => {
    set({ isLoading: true, error: null });
    try {
      let models: ModelInfo[] = [];

      if (provider === 'openai' && apiKeyOrUrl) {
        models = await invoke<ModelInfo[]>('fetch_openai_models', {
          apiKey: apiKeyOrUrl,
        });
      } else if (provider === 'openrouter' && apiKeyOrUrl) {
        models = await invoke<ModelInfo[]>('fetch_openrouter_models', {
          apiKey: apiKeyOrUrl,
        });
      } else if (provider === 'ollama') {
        const baseUrl = apiKeyOrUrl || 'http://localhost:11434';
        models = await invoke<ModelInfo[]>('fetch_ollama_models', {
          baseUrl,
        });
      }

      set((state) => ({
        models: { ...state.models, [provider]: models },
        isLoading: false,
      }));
    } catch (error) {
      set({ error: String(error), isLoading: false });
      console.error('Failed to fetch models:', error);
      throw error;
    }
  },
}));

