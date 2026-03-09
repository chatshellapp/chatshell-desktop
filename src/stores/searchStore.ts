import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { SearchResults } from '@/types'

const SEARCH_DEBOUNCE_MS = 300

interface SearchStoreState {
  isOpen: boolean
  query: string
  results: SearchResults | null
  isSearching: boolean
  targetMessageId: string | null
}

interface SearchStoreActions {
  setOpen: (open: boolean) => void
  toggle: () => void
  setQuery: (query: string) => void
  search: (query: string) => Promise<void>
  clearSearch: () => void
  navigateToMessage: (messageId: string, conversationId: string) => void
  clearTarget: () => void
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

export const useSearchStore = create<SearchStoreState & SearchStoreActions>((set) => ({
  isOpen: false,
  query: '',
  results: null,
  isSearching: false,
  targetMessageId: null,

  setOpen: (open) => set({ isOpen: open }),

  toggle: () => set((state) => ({ isOpen: !state.isOpen })),

  setQuery: (query) => set({ query }),

  search: async (query: string) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }

    set({ query })

    const trimmed = query.trim()
    if (!trimmed) {
      set({ results: null, isSearching: false })
      return
    }

    set({ isSearching: true })

    debounceTimer = setTimeout(async () => {
      debounceTimer = null
      try {
        const results = await invoke<SearchResults>('search_chat_history', {
          query: trimmed,
          limit: 20,
          offset: 0,
        })
        set({ results, isSearching: false })
      } catch {
        set({ results: null, isSearching: false })
      }
    }, SEARCH_DEBOUNCE_MS)
  },

  clearSearch: () =>
    set({
      query: '',
      results: null,
      isSearching: false,
    }),

  navigateToMessage: async (messageId: string, conversationId: string) => {
    const { useConversationStore } = await import('./conversation')
    await useConversationStore.getState().selectConversation(conversationId)
    set({ isOpen: false, targetMessageId: messageId })
  },

  clearTarget: () => set({ targetMessageId: null }),
}))
