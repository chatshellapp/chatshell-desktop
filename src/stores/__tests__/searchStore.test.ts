import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSearchStore } from '../searchStore'
import type { SearchResults } from '@/types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const { selectConversation } = vi.hoisted(() => ({
  selectConversation: vi.fn(),
}))

// searchStore dynamically imports ./conversation inside navigateToMessage
vi.mock('../conversation', () => ({
  useConversationStore: {
    getState: () => ({ selectConversation }),
  },
}))

const invokeMock = vi.mocked(invoke)

const emptyResults: SearchResults = {
  messages: [],
  conversations: [],
  total_message_count: 0,
  search_time_ms: 3,
}

describe('useSearchStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    invokeMock.mockResolvedValue(undefined)
    useSearchStore.setState({
      isOpen: false,
      query: '',
      results: null,
      isSearching: false,
      targetMessageId: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('starts closed with empty query, no results and no target', () => {
      const state = useSearchStore.getState()
      expect(state.isOpen).toBe(false)
      expect(state.query).toBe('')
      expect(state.results).toBeNull()
      expect(state.isSearching).toBe(false)
      expect(state.targetMessageId).toBeNull()
    })
  })

  describe('setOpen / toggle', () => {
    it('setOpen sets the open flag', () => {
      useSearchStore.getState().setOpen(true)
      expect(useSearchStore.getState().isOpen).toBe(true)
      useSearchStore.getState().setOpen(false)
      expect(useSearchStore.getState().isOpen).toBe(false)
    })

    it('toggle flips the open flag', () => {
      useSearchStore.getState().toggle()
      expect(useSearchStore.getState().isOpen).toBe(true)
      useSearchStore.getState().toggle()
      expect(useSearchStore.getState().isOpen).toBe(false)
    })
  })

  describe('setQuery', () => {
    it('stores the raw query without searching', () => {
      useSearchStore.getState().setQuery('hello')
      expect(useSearchStore.getState().query).toBe('hello')
      expect(useSearchStore.getState().isSearching).toBe(false)
      expect(invokeMock).not.toHaveBeenCalled()
    })
  })

  describe('search', () => {
    it('clears results immediately for a blank query without invoking', async () => {
      useSearchStore.setState({ results: emptyResults })

      await useSearchStore.getState().search('   ')

      const state = useSearchStore.getState()
      expect(state.query).toBe('   ')
      expect(state.results).toBeNull()
      expect(state.isSearching).toBe(false)
      await vi.advanceTimersByTimeAsync(400)
      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('marks searching immediately and invokes after the debounce', async () => {
      invokeMock.mockResolvedValue(emptyResults)

      const promise = useSearchStore.getState().search('  hello  ')
      expect(useSearchStore.getState().isSearching).toBe(true)
      expect(useSearchStore.getState().query).toBe('  hello  ')

      await vi.advanceTimersByTimeAsync(299)
      expect(invokeMock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      await promise

      expect(invokeMock).toHaveBeenCalledWith('search_chat_history', {
        query: 'hello',
        limit: 20,
        offset: 0,
      })
      const state = useSearchStore.getState()
      expect(state.results).toEqual(emptyResults)
      expect(state.isSearching).toBe(false)
    })

    it('debounces consecutive calls and only runs the last query', async () => {
      invokeMock.mockResolvedValue(emptyResults)

      await useSearchStore.getState().search('fir')
      await vi.advanceTimersByTimeAsync(200)
      await useSearchStore.getState().search('final query')
      await vi.advanceTimersByTimeAsync(200)
      expect(invokeMock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(100)

      expect(invokeMock).toHaveBeenCalledTimes(1)
      expect(invokeMock).toHaveBeenCalledWith('search_chat_history', {
        query: 'final query',
        limit: 20,
        offset: 0,
      })
      expect(useSearchStore.getState().isSearching).toBe(false)
    })

    it('clears results and stops searching when the backend rejects', async () => {
      useSearchStore.setState({ results: emptyResults })
      invokeMock.mockRejectedValue(new Error('search failed'))

      await useSearchStore.getState().search('hello')
      await vi.advanceTimersByTimeAsync(400)

      const state = useSearchStore.getState()
      expect(state.results).toBeNull()
      expect(state.isSearching).toBe(false)
    })
  })

  describe('clearSearch', () => {
    it('resets query, results and searching flag', async () => {
      invokeMock.mockResolvedValue(emptyResults)
      await useSearchStore.getState().search('hello')
      await vi.advanceTimersByTimeAsync(400)
      expect(useSearchStore.getState().results).not.toBeNull()

      useSearchStore.getState().clearSearch()

      const state = useSearchStore.getState()
      expect(state.query).toBe('')
      expect(state.results).toBeNull()
      expect(state.isSearching).toBe(false)
    })
  })

  describe('navigateToMessage', () => {
    it('selects the conversation, closes the panel and targets the message', async () => {
      useSearchStore.setState({ isOpen: true })

      await useSearchStore.getState().navigateToMessage('msg-7', 'conv-3')

      expect(selectConversation).toHaveBeenCalledWith('conv-3')
      const state = useSearchStore.getState()
      expect(state.isOpen).toBe(false)
      expect(state.targetMessageId).toBe('msg-7')
    })
  })

  describe('clearTarget', () => {
    it('clears the target message id', () => {
      useSearchStore.setState({ targetMessageId: 'msg-7' })

      useSearchStore.getState().clearTarget()

      expect(useSearchStore.getState().targetMessageId).toBeNull()
    })
  })
})
