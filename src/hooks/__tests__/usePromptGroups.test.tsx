import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { usePromptConversations, usePromptGroups, useSelectedPrompt } from '../usePromptGroups'
import { usePromptStore } from '@/stores/promptStore'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import type { Prompt } from '@/types'

const mockInvoke = vi.mocked(invoke)

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'

const makePrompt = (overrides: Partial<Prompt> & { id: string }): Prompt => ({
  name: `Prompt ${overrides.id}`,
  content: 'content',
  is_system: false,
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
})

describe('usePromptGroups', () => {
  beforeEach(() => {
    usePromptStore.setState({ prompts: [] })
  })

  it('groups by category in store order with prefixed ids', () => {
    usePromptStore.setState({
      prompts: [
        makePrompt({ id: 'p-1', category: 'Writing' }),
        makePrompt({ id: 'p-2' }),
        makePrompt({ id: 'p-3', category: 'Writing', is_starred: true, is_system: true }),
      ],
    })

    const { result } = renderHook(() => usePromptGroups())

    expect(result.current.map((g) => g.id)).toEqual(['category:Writing', 'category:Uncategorized'])
    expect(result.current[0].prompts.map((p) => p.id)).toEqual(['p-1', 'p-3'])
    expect(result.current[0].prompts[1]).toEqual(
      expect.objectContaining({ isStarred: true, isSystem: true })
    )
  })

  it('keeps categories that only differ by case and spacing distinct', () => {
    usePromptStore.setState({
      prompts: [
        makePrompt({ id: 'p-1', category: 'My Notes' }),
        makePrompt({ id: 'p-2', category: 'my-notes' }),
      ],
    })

    const { result } = renderHook(() => usePromptGroups())

    expect(new Set(result.current.map((g) => g.id)).size).toBe(2)
  })
})

describe('useSelectedPrompt', () => {
  it('resolves the selected prompt and returns null once it is gone', () => {
    const prompt = makePrompt({ id: 'p-1' })
    usePromptStore.setState({ prompts: [prompt] })
    useLibrarySelectionStore.setState({ selectedPromptId: null })
    const { result } = renderHook(() => useSelectedPrompt())

    expect(result.current).toBeNull()

    act(() => useLibrarySelectionStore.getState().selectPrompt('p-1'))
    expect(result.current).toEqual(prompt)

    act(() => usePromptStore.setState({ prompts: [] }))
    expect(result.current).toBeNull()
  })
})

describe('usePromptConversations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries by prompt id', async () => {
    mockInvoke.mockResolvedValue([])
    const { result } = renderHook(() => usePromptConversations('p-1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockInvoke).toHaveBeenCalledWith('list_conversation_ids_by_prompt', { promptId: 'p-1' })
  })

  it('skips the query without a prompt', () => {
    renderHook(() => usePromptConversations(null))
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
