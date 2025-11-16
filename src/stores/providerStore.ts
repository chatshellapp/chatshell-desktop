import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Provider, CreateProviderRequest } from '@/types';

interface ProviderStore {
  providers: Provider[];
  isLoading: boolean;
  error: string | null;

  loadProviders: () => Promise<void>;
  createProvider: (req: CreateProviderRequest) => Promise<Provider>;
  updateProvider: (id: string, req: CreateProviderRequest) => Promise<Provider>;
  deleteProvider: (id: string) => Promise<void>;
  getProviderById: (id: string) => Provider | undefined;
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  providers: [],
  isLoading: false,
  error: null,

  loadProviders: async () => {
    set({ isLoading: true, error: null });
    try {
      const providers = await invoke<Provider[]>('list_providers');
      set({ providers, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
      console.error('Failed to load providers:', error);
    }
  },

  createProvider: async (req: CreateProviderRequest) => {
    set({ isLoading: true, error: null });
    try {
      const provider = await invoke<Provider>('create_provider', { req });
      set((state) => ({
        providers: [...state.providers, provider],
        isLoading: false,
      }));
      return provider;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  updateProvider: async (id: string, req: CreateProviderRequest) => {
    set({ isLoading: true, error: null });
    try {
      const provider = await invoke<Provider>('update_provider', { id, req });
      set((state) => ({
        providers: state.providers.map((p) => (p.id === id ? provider : p)),
        isLoading: false,
      }));
      return provider;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  deleteProvider: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('delete_provider', { id });
      set((state) => ({
        providers: state.providers.filter((p) => p.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  getProviderById: (id: string) => {
    return get().providers.find((p) => p.id === id);
  },
}));

