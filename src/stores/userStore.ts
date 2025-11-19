import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '@tauri-apps/api/core';
import type { User } from '@/types';

interface UserStore {
  selfUser: User | null;
  users: User[];
  isLoading: boolean;
  error: string | null;

  // Actions
  loadSelfUser: () => Promise<void>;
  loadUsers: () => Promise<void>;
  getSelfUserId: () => string | null;
}

export const useUserStore = create<UserStore>()(
  immer((set, get) => ({
  selfUser: null,
  users: [],
  isLoading: false,
  error: null,

  loadSelfUser: async () => {
    set((draft) => {
      draft.isLoading = true;
      draft.error = null;
    });
    try {
      const selfUser = await invoke<User | null>('get_self_user');
      console.log('[userStore] Loaded self user:', selfUser);
      set((draft) => {
        draft.selfUser = selfUser;
        draft.isLoading = false;
      });
    } catch (error) {
      set((draft) => {
        draft.error = String(error);
        draft.isLoading = false;
      });
      console.error('Failed to load self user:', error);
    }
  },

  loadUsers: async () => {
    set((draft) => {
      draft.isLoading = true;
      draft.error = null;
    });
    try {
      const users = await invoke<User[]>('list_users');
      console.log('[userStore] Loaded users:', users);
      set((draft) => {
        draft.users = users;
        draft.isLoading = false;
      });
    } catch (error) {
      set((draft) => {
        draft.error = String(error);
        draft.isLoading = false;
      });
      console.error('Failed to load users:', error);
    }
  },

  getSelfUserId: () => {
    const { selfUser } = get();
    return selfUser?.id || null;
  },
})));
