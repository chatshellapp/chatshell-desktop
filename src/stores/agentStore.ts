import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Agent, CreateAgentRequest } from '@/types';

interface AgentStore {
  agents: Agent[];
  currentAgent: Agent | null;
  isLoading: boolean;
  error: string | null;

  loadAgents: () => Promise<void>;
  createAgent: (req: CreateAgentRequest) => Promise<Agent>;
  updateAgent: (id: string, req: CreateAgentRequest) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<void>;
  setCurrentAgent: (agent: Agent | null) => void;
  getAgent: (id: string) => Promise<Agent | null>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  currentAgent: null,
  isLoading: false,
  error: null,

  loadAgents: async () => {
    set({ isLoading: true, error: null });
    try {
      const agents = await invoke<Agent[]>('list_agents');
      set({ agents, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
      console.error('Failed to load agents:', error);
    }
  },

  createAgent: async (req: CreateAgentRequest) => {
    set({ isLoading: true, error: null });
    try {
      const agent = await invoke<Agent>('create_agent', { req });
      set((state) => ({
        agents: [...state.agents, agent],
        isLoading: false,
      }));
      return agent;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  updateAgent: async (id: string, req: CreateAgentRequest) => {
    set({ isLoading: true, error: null });
    try {
      const agent = await invoke<Agent>('update_agent', { id, req });
      set((state) => ({
        agents: state.agents.map((a) => (a.id === id ? agent : a)),
        currentAgent: state.currentAgent?.id === id ? agent : state.currentAgent,
        isLoading: false,
      }));
      return agent;
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  deleteAgent: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('delete_agent', { id });
      set((state) => ({
        agents: state.agents.filter((a) => a.id !== id),
        currentAgent: state.currentAgent?.id === id ? null : state.currentAgent,
        isLoading: false,
      }));
    } catch (error) {
      set({ error: String(error), isLoading: false });
      throw error;
    }
  },

  setCurrentAgent: (agent: Agent | null) => {
    set({ currentAgent: agent });
  },

  getAgent: async (id: string) => {
    try {
      const agent = await invoke<Agent | null>('get_agent', { id });
      return agent;
    } catch (error) {
      console.error('Failed to get agent:', error);
      return null;
    }
  },
}));

