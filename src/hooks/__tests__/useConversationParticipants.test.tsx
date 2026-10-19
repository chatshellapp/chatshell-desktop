import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { logger } from '@/lib/logger'
import { useConversationParticipants } from '../useConversationParticipants'
import { useConversationStore } from '@/stores/conversation'
import { useUserStore } from '@/stores/userStore'
import type { Conversation, ParticipantSummary, User } from '@/types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
  emit: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'

const conversationA: Conversation = { id: 'conv-a', title: 'A', created_at: NOW, updated_at: NOW }
const conversationB: Conversation = { id: 'conv-b', title: 'B', created_at: NOW, updated_at: NOW }

const selfUser: User = {
  id: 'user-1',
  username: 'sean',
  display_name: 'Sean',
  avatar_type: 'text',
  is_self: true,
  status: 'online',
  created_at: NOW,
  updated_at: NOW,
}

const participantsA: ParticipantSummary[] = [
  {
    participant_type: 'human',
    participant_id: 'user-1',
    display_name: 'Sean',
    avatar_type: 'text',
  },
]
const participantsB: ParticipantSummary[] = [
  {
    participant_type: 'model',
    participant_id: 'model-1',
    display_name: 'GPT-4o',
    avatar_type: 'text',
  },
]

let loadConversations: Mock
let unlisten: Mock
let chatCompleteHandler: ((event: { payload: { conversation_id?: string } }) => void) | undefined

function mockParticipantLookup() {
  vi.mocked(invoke).mockImplementation((async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'get_conversation_participant_summary') {
      if (args?.conversationId === 'conv-a') return participantsA
      return participantsB
    }
    return undefined
  }) as typeof invoke)
}

function setupStores(conversations: Conversation[], selfUserValue: User | null) {
  loadConversations = vi.fn().mockResolvedValue(undefined)
  useConversationStore.setState({
    conversations,
    currentConversation: null,
    currentParticipants: [],
    selectedModel: null,
    selectedAssistant: null,
    lastUsedModel: null,
    lastUsedAssistant: null,
    isFirstConversationSinceStartup: true,
    isLoading: false,
    error: null,
    pendingInput: null,
    loadConversations,
  })
  useUserStore.setState({
    selfUser: selfUserValue,
    users: [],
    isLoading: false,
    error: null,
  })
}

describe('useConversationParticipants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockReset()
    mockParticipantLookup()
    unlisten = vi.fn()
    chatCompleteHandler = undefined
    vi.mocked(listen).mockReset()
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === 'chat-complete')
        chatCompleteHandler = handler as unknown as typeof chatCompleteHandler
      return unlisten
    })
    setupStores([conversationA, conversationB], selfUser)
  })

  it('loads participants for every conversation with the current user id', async () => {
    const { result } = renderHook(() => useConversationParticipants())

    await waitFor(() => expect(result.current.conversationParticipantsMap.size).toBe(2))
    expect(result.current.conversationParticipantsMap.get('conv-a')).toEqual(participantsA)
    expect(result.current.conversationParticipantsMap.get('conv-b')).toEqual(participantsB)
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_conversation_participant_summary', {
      conversationId: 'conv-a',
      currentUserId: 'user-1',
    })
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_conversation_participant_summary', {
      conversationId: 'conv-b',
      currentUserId: 'user-1',
    })
  })

  it('skips loading while there is no self user', async () => {
    setupStores([conversationA], null)
    const { result } = renderHook(() => useConversationParticipants())

    await act(async () => {
      await Promise.resolve()
    })

    expect(vi.mocked(invoke)).not.toHaveBeenCalled()
    expect(result.current.conversationParticipantsMap.size).toBe(0)
  })

  it('skips loading when there are no conversations', async () => {
    setupStores([], selfUser)
    const { result } = renderHook(() => useConversationParticipants())

    await act(async () => {
      await Promise.resolve()
    })

    expect(vi.mocked(invoke)).not.toHaveBeenCalled()
    expect(result.current.conversationParticipantsMap.size).toBe(0)
  })

  it('stores an empty list for conversations whose lookup fails', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('db down'))
    const { result } = renderHook(() => useConversationParticipants())

    await waitFor(() => expect(result.current.conversationParticipantsMap.size).toBe(2))
    expect(result.current.conversationParticipantsMap.get('conv-a')).toEqual([])
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to load participants for conversation conv-a:',
      expect.any(Error)
    )
  })

  it('refreshes a single conversation without touching the others', async () => {
    const refreshed: ParticipantSummary[] = [
      {
        participant_type: 'model',
        participant_id: 'model-2',
        display_name: 'Claude',
        avatar_type: 'text',
      },
    ]
    const { result } = renderHook(() => useConversationParticipants())
    await waitFor(() => expect(result.current.conversationParticipantsMap.size).toBe(2))

    vi.mocked(invoke).mockResolvedValue(refreshed)
    await act(async () => {
      await result.current.refreshConversationParticipants('conv-a')
    })

    expect(result.current.conversationParticipantsMap.get('conv-a')).toEqual(refreshed)
    expect(result.current.conversationParticipantsMap.get('conv-b')).toEqual(participantsB)
  })

  it('does nothing on refresh without a self user', async () => {
    setupStores([conversationA], null)
    const { result } = renderHook(() => useConversationParticipants())

    await act(async () => {
      await result.current.refreshConversationParticipants('conv-a')
    })

    expect(vi.mocked(invoke)).not.toHaveBeenCalled()
  })

  it('keeps the previous participants when a refresh fails', async () => {
    const { result } = renderHook(() => useConversationParticipants())
    await waitFor(() => expect(result.current.conversationParticipantsMap.size).toBe(2))

    vi.mocked(invoke).mockRejectedValue(new Error('db down'))
    await act(async () => {
      await result.current.refreshConversationParticipants('conv-a')
    })

    expect(result.current.conversationParticipantsMap.get('conv-a')).toEqual(participantsA)
    expect(logger.error).toHaveBeenCalledWith('Failed to refresh participants:', expect.any(Error))
  })

  it('refreshes participants and reloads conversations after chat-complete', async () => {
    const { result } = renderHook(() => useConversationParticipants())
    await waitFor(() => expect(result.current.conversationParticipantsMap.size).toBe(2))
    expect(loadConversations).not.toHaveBeenCalled()

    await act(async () => {
      chatCompleteHandler?.({ payload: { conversation_id: 'conv-a' } })
    })

    await waitFor(() => expect(loadConversations).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_conversation_participant_summary', {
        conversationId: 'conv-a',
        currentUserId: 'user-1',
      })
    })
  })

  it('ignores chat-complete events without a conversation id', async () => {
    const { result } = renderHook(() => useConversationParticipants())
    await waitFor(() => expect(result.current.conversationParticipantsMap.size).toBe(2))

    await act(async () => {
      chatCompleteHandler?.({ payload: {} })
    })

    expect(loadConversations).not.toHaveBeenCalled()
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes from chat-complete on unmount', async () => {
    const { unmount } = renderHook(() => useConversationParticipants())

    unmount()
    await act(async () => {
      await Promise.resolve()
    })

    expect(unlisten).toHaveBeenCalledTimes(1)
  })
})
