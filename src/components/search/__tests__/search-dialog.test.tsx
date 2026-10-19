import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { SearchDialog } from '../search-dialog'
import { useSearchStore } from '@/stores/searchStore'
import { useConversationStore } from '@/stores/conversation'
import type * as UtilsModule from '@/lib/utils'
import type { SearchResults } from '@/types'

// jsdom lacks ResizeObserver, which cmdk's list relies on
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// jsdom does not implement scrollIntoView, which cmdk uses for the active item
window.HTMLElement.prototype.scrollIntoView = () => {}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// Keep rendered timestamps deterministic instead of locale/now dependent
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof UtilsModule>()
  return {
    ...actual,
    formatConversationTimestamp: (dateString: string) => dateString,
  }
})

const mockInvoke = vi.mocked(invoke)

const CONV_TS = '2024-05-01T10:00:00Z'

function makeResults(overrides: Partial<SearchResults> = {}): SearchResults {
  return {
    conversations: [
      { id: 'conv-1', title: 'Project Ideas', updated_at: CONV_TS, last_message: 'hello' },
    ],
    messages: [
      {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        conversation_title: 'Project Ideas',
        sender_type: 'user',
        content_snippet: 'Hello <mark>wor</mark>ld',
        created_at: CONV_TS,
      },
    ],
    total_message_count: 7,
    search_time_ms: 5000,
    ...overrides,
  }
}

interface SearchStatePatch {
  isOpen?: boolean
  query?: string
  results?: SearchResults | null
  isSearching?: boolean
  targetMessageId?: string | null
}

function setSearchState(patch: SearchStatePatch) {
  act(() => {
    useSearchStore.setState(patch)
  })
}

describe('SearchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_conversation') return Promise.resolve(null)
      if (cmd === 'search_chat_history') {
        return Promise.resolve(makeResults({ conversations: [], messages: [] }))
      }
      return Promise.resolve(undefined)
    })
    setSearchState({
      isOpen: false,
      query: '',
      results: null,
      isSearching: false,
      targetMessageId: null,
    })
    useConversationStore.setState({
      conversations: [],
      currentConversation: null,
      currentParticipants: [],
      selectedModel: null,
      selectedAssistant: null,
    })
  })

  it('renders no dialog while closed', () => {
    render(<SearchDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens as a command palette with an empty search input', () => {
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('placeholder')).toHaveValue('')
  })

  it('renders conversation hits with title and timestamp', () => {
    setSearchState({ results: makeResults({ messages: [] }) })
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    expect(screen.getByText('Project Ideas')).toBeInTheDocument()
    expect(screen.getByText(CONV_TS)).toBeInTheDocument()
    expect(screen.getByText('conversations')).toBeInTheDocument()
    expect(screen.queryByText('noResults')).toBeNull()
  })

  it('renders message hits with a highlighted snippet and the conversation meta line', () => {
    setSearchState({ results: makeResults({ conversations: [] }) })
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    expect(screen.getByText('wor').tagName).toBe('MARK')
    expect(screen.getByText('messages')).toBeInTheDocument()
    expect(screen.getByText(/inConversation/)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`^.*${CONV_TS}$`))).toBeInTheDocument()
  })

  it('shows the stats footer when hits exist', () => {
    setSearchState({ results: makeResults() })
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    expect(screen.getByText('stats')).toBeInTheDocument()
  })

  it('shows the no-results empty state for a query without hits', () => {
    setSearchState({
      query: 'nothing-matches',
      results: makeResults({ conversations: [], messages: [] }),
    })
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    expect(screen.getByText('noResults')).toBeInTheDocument()
    expect(screen.queryByText('stats')).toBeNull()
    expect(screen.queryByText('conversations')).toBeNull()
    expect(screen.queryByText('messages')).toBeNull()
  })

  it('hides the empty state while a search is in flight', () => {
    setSearchState({ query: 'x', isSearching: true, results: null })
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    expect(screen.queryByText('noResults')).toBeNull()
  })

  it('hides the empty state when the query is blank', () => {
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    expect(screen.queryByText('noResults')).toBeNull()
  })

  it('stores the typed query and invokes the backend search after the debounce', async () => {
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    fireEvent.change(screen.getByPlaceholderText('placeholder'), { target: { value: 'hello' } })

    expect(useSearchStore.getState().query).toBe('hello')
    expect(useSearchStore.getState().isSearching).toBe(true)
    expect(mockInvoke).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('search_chat_history', {
        query: 'hello',
        limit: 20,
        offset: 0,
      })
    })
    await waitFor(() => {
      expect(useSearchStore.getState().isSearching).toBe(false)
    })
  })

  it('clears results immediately for a whitespace-only query without invoking the backend', () => {
    setSearchState({ results: makeResults({ conversations: [], messages: [] }) })
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    fireEvent.change(screen.getByPlaceholderText('placeholder'), { target: { value: '   ' } })

    const state = useSearchStore.getState()
    expect(state.query).toBe('   ')
    expect(state.results).toBeNull()
    expect(state.isSearching).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('closes and clears the search when the dialog is dismissed', () => {
    setSearchState({
      query: 'hello',
      results: makeResults({ conversations: [], messages: [] }),
    })
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    const state = useSearchStore.getState()
    expect(state.isOpen).toBe(false)
    expect(state.query).toBe('')
    expect(state.results).toBeNull()
  })

  it('selects a conversation hit and closes the palette', async () => {
    setSearchState({ results: makeResults({ messages: [] }) })
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    fireEvent.click(screen.getByText('Project Ideas'))

    await waitFor(() => {
      expect(useSearchStore.getState().isOpen).toBe(false)
    })
    expect(mockInvoke).toHaveBeenCalledWith('get_conversation', { id: 'conv-1' })
  })

  it('navigates to a message hit and records the target message', async () => {
    setSearchState({ results: makeResults({ conversations: [] }) })
    render(<SearchDialog />)
    setSearchState({ isOpen: true })
    fireEvent.click(screen.getByText('wor'))

    await waitFor(() => {
      expect(useSearchStore.getState().isOpen).toBe(false)
    })
    expect(useSearchStore.getState().targetMessageId).toBe('msg-1')
    expect(mockInvoke).toHaveBeenCalledWith('get_conversation', { id: 'conv-1' })
  })
})
