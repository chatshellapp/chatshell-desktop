import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ConversationList } from '../conversation-list'
import { useConversationStore } from '@/stores/conversation'
import { useModelStore } from '@/stores/modelStore'
import type * as UtilsModule from '@/lib/utils'
import type { Conversation, ParticipantSummary } from '@/types'

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

const TS = '2024-06-15T12:00:00Z'

function makeConversation(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: `Title ${id}`,
    created_at: TS,
    updated_at: TS,
    ...overrides,
  }
}

interface ListHandlers {
  onConversationClick?: (conversationId: string) => void
  onGenerateTitle?: (conversationId: string) => void
  onEditTitle?: (conversationId: string, newTitle: string) => void
  onDelete?: (conversationId: string) => void
}

function renderList(handlers: ListHandlers = {}, map?: Map<string, ParticipantSummary[]>) {
  render(
    <ConversationList
      conversationParticipantsMap={map ?? new Map()}
      onConversationClick={handlers.onConversationClick ?? vi.fn()}
      onGenerateTitle={handlers.onGenerateTitle}
      onEditTitle={handlers.onEditTitle}
      onDelete={handlers.onDelete}
    />
  )
}

function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest('[role="button"]')
  if (!(row instanceof HTMLElement)) throw new Error(`no row found for ${text}`)
  return row
}

describe('ConversationList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConversationStore.setState({
      conversations: [],
      currentConversation: null,
      currentParticipants: [],
      selectedModel: null,
      selectedAssistant: null,
    })
    useModelStore.setState({ models: [], providers: [], isLoading: false, error: null })
  })

  it('shows empty-state copy when there are no conversations', () => {
    renderList()
    expect(screen.getByText('noConversations')).toBeInTheDocument()
    expect(screen.getByText('startChatting')).toBeInTheDocument()
  })

  it('renders each conversation with title, timestamp and last message', () => {
    useConversationStore.setState({
      conversations: [
        makeConversation('c1', { title: 'Alpha', last_message: 'first message' }),
        makeConversation('c2', { title: 'Beta', last_message: 'second message' }),
      ],
    })
    renderList()

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getAllByText(TS)).toHaveLength(2)
    expect(screen.getByText('first message')).toBeInTheDocument()
    expect(screen.getByText('second message')).toBeInTheDocument()
  })

  it('falls back to the placeholder title and no-message copy for fresh conversations', () => {
    useConversationStore.setState({
      conversations: [makeConversation('c1', { title: '' })],
    })
    renderList()

    expect(screen.getByText('newConversation')).toBeInTheDocument()
    expect(screen.getByText('noMessages')).toBeInTheDocument()
  })

  it('truncates long last messages to 50 characters', () => {
    const long = 'x'.repeat(60)
    useConversationStore.setState({
      conversations: [makeConversation('c1', { last_message: long })],
    })
    renderList()

    expect(screen.getByText(`${'x'.repeat(50)}...`)).toBeInTheDocument()
    expect(screen.queryByText(long)).toBeNull()
  })

  it('marks the current conversation as active', () => {
    const active = makeConversation('c2', { title: 'Beta' })
    useConversationStore.setState({
      conversations: [makeConversation('c1', { title: 'Alpha' }), active],
      currentConversation: active,
    })
    renderList()

    expect(rowOf('Beta').className).toMatch(/(^|\s)bg-accent(\s|$)/)
    expect(rowOf('Alpha').className).not.toMatch(/(^|\s)bg-accent(\s|$)/)
  })

  it('invokes onConversationClick with the conversation id', () => {
    useConversationStore.setState({
      conversations: [makeConversation('c2', { title: 'Beta' })],
    })
    const onConversationClick = vi.fn()
    renderList({ onConversationClick })

    fireEvent.click(screen.getByText('Beta'))
    expect(onConversationClick).toHaveBeenCalledWith('c2')
    expect(onConversationClick).toHaveBeenCalledTimes(1)
  })

  it('renders participant initials and a hidden placeholder avatar otherwise', () => {
    useConversationStore.setState({
      conversations: [
        makeConversation('c1', { title: 'Alpha' }),
        makeConversation('c2', { title: 'Beta' }),
      ],
    })
    const map = new Map<string, ParticipantSummary[]>([
      ['c1', [{ participant_type: 'user', display_name: 'Alice', avatar_type: 'text' }]],
    ])
    renderList({}, map)

    const aliceFallback = within(rowOf('Alpha')).getByText('A')
    expect(aliceFallback.className).not.toContain('opacity-0')

    const betaFallback = rowOf('Beta').querySelector('[data-slot="avatar-fallback"]')
    expect(betaFallback?.className).toContain('opacity-0')
  })

  it('omits row actions when no action handlers are provided', () => {
    useConversationStore.setState({
      conversations: [makeConversation('c1', { title: 'Alpha' })],
    })
    renderList()

    expect(within(rowOf('Alpha')).queryByRole('button')).toBeNull()
  })

  it('mounts the row action menu when handlers are provided', () => {
    useConversationStore.setState({
      conversations: [makeConversation('c1', { title: 'Alpha' })],
    })
    renderList({
      onGenerateTitle: vi.fn(),
      onEditTitle: vi.fn(),
      onDelete: vi.fn(),
    })

    expect(within(rowOf('Alpha')).getByRole('button')).toBeInTheDocument()
  })
})
