import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { useContactConversations, useSelectedContact } from '../useContactProfile'
import { useContactSelectionStore } from '@/stores/contactSelectionStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { useModelStore } from '@/stores/modelStore'
import { useConversationStore } from '@/stores/conversation'
import type { Assistant, Conversation, Model } from '@/types'

const mockInvoke = vi.mocked(invoke)

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'

const model: Model = {
  id: 'model-1',
  provider_id: 'provider-1',
  name: 'GPT-4o',
  model_id: 'gpt-4o',
  is_starred: false,
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW,
}

const assistant: Assistant = {
  id: 'assistant-1',
  name: 'Helper',
  system_prompt: 'prompt',
  model_id: 'model-1',
  tool_ids: [],
  skill_ids: [],
  avatar_type: 'text',
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
}

const conversation = (id: string): Conversation => ({
  id,
  title: `Title ${id}`,
  created_at: NOW,
  updated_at: NOW,
})

describe('useSelectedContact', () => {
  beforeEach(() => {
    useContactSelectionStore.setState({ selected: null })
    useModelStore.setState({ models: [model, { ...model, id: 'model-gone', is_deleted: true }] })
    useAssistantStore.setState({ assistants: [assistant] })
  })

  it('returns null without a selection', () => {
    const { result } = renderHook(() => useSelectedContact())
    expect(result.current).toBeNull()
  })

  it('resolves models and assistants from their stores', () => {
    const { result } = renderHook(() => useSelectedContact())

    act(() => useContactSelectionStore.getState().selectContact({ kind: 'model', id: 'model-1' }))
    expect(result.current).toEqual({ kind: 'model', model })

    act(() =>
      useContactSelectionStore.getState().selectContact({ kind: 'assistant', id: 'assistant-1' })
    )
    expect(result.current).toEqual({ kind: 'assistant', assistant })
  })

  it('returns null for deleted or unknown contacts', () => {
    const { result } = renderHook(() => useSelectedContact())

    act(() =>
      useContactSelectionStore.getState().selectContact({ kind: 'model', id: 'model-gone' })
    )
    expect(result.current).toBeNull()

    act(() =>
      useContactSelectionStore.getState().selectContact({ kind: 'assistant', id: 'missing' })
    )
    expect(result.current).toBeNull()
  })
})

describe('useContactConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConversationStore.setState({
      conversations: [conversation('c-1'), conversation('c-2'), conversation('c-3')],
    })
  })

  it('maps backend ids to store conversations in backend order', async () => {
    mockInvoke.mockResolvedValue(['c-3', 'c-1', 'c-unknown'])

    const { result } = renderHook(() =>
      useContactConversations({ kind: 'assistant', id: 'assistant-1' })
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(invoke).toHaveBeenCalledWith('list_conversation_ids_by_participant', {
      participantType: 'assistant',
      participantId: 'assistant-1',
    })
    expect(result.current.conversations.map((c) => c.id)).toEqual(['c-3', 'c-1'])
  })

  it('does not query without a selection', () => {
    const { result } = renderHook(() => useContactConversations(null))

    expect(invoke).not.toHaveBeenCalled()
    expect(result.current.conversations).toEqual([])
  })

  it('falls back to an empty list when the query fails', async () => {
    mockInvoke.mockRejectedValue(new Error('db locked'))

    const { result } = renderHook(() => useContactConversations({ kind: 'model', id: 'model-1' }))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.conversations).toEqual([])
  })

  it('re-queries when the conversation list changes', async () => {
    mockInvoke.mockResolvedValue(['c-1'])
    const { result } = renderHook(() => useContactConversations({ kind: 'model', id: 'model-1' }))
    await waitFor(() => expect(result.current.conversations).toHaveLength(1))
    mockInvoke.mockResolvedValue(['c-4', 'c-1'])
    act(() => {
      useConversationStore.setState({
        conversations: [conversation('c-4'), ...useConversationStore.getState().conversations],
      })
    })

    await waitFor(() =>
      expect(result.current.conversations.map((c) => c.id)).toEqual(['c-4', 'c-1'])
    )
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
