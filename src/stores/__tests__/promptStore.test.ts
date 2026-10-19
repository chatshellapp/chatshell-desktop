import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePromptStore } from '../promptStore'
import type { Prompt } from '@/types'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock logger to avoid console noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

const mockInvoke = vi.mocked(invoke)

const createMockPrompt = (overrides: Partial<Prompt> = {}): Prompt => ({
  id: 'prompt-1',
  name: 'Code review',
  content: 'Review this code carefully',
  category: 'coding',
  is_system: false,
  is_starred: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('usePromptStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePromptStore.setState({
      prompts: [],
      isLoading: false,
      error: null,
    })
  })

  describe('loadPrompts', () => {
    it('stores prompts returned by list_prompts and stops loading', async () => {
      const prompts = [createMockPrompt(), createMockPrompt({ id: 'prompt-2' })]
      mockInvoke.mockResolvedValueOnce(prompts)

      await usePromptStore.getState().loadPrompts()

      expect(mockInvoke).toHaveBeenCalledWith('list_prompts')
      const state = usePromptStore.getState()
      expect(state.prompts).toEqual(prompts)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('replaces stale prompts so the list stays in sync with the backend', async () => {
      usePromptStore.setState({
        prompts: [createMockPrompt({ id: 'stale-prompt' })],
      })
      mockInvoke.mockResolvedValueOnce([createMockPrompt({ id: 'fresh-prompt' })])

      await usePromptStore.getState().loadPrompts()

      expect(usePromptStore.getState().prompts.map((p) => p.id)).toEqual(['fresh-prompt'])
    })

    it('stores the error and stops loading when invoke fails', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('db locked'))

      await usePromptStore.getState().loadPrompts()

      const state = usePromptStore.getState()
      expect(state.error).toBe('Error: db locked')
      expect(state.isLoading).toBe(false)
      expect(state.prompts).toEqual([])
    })

    it('clears a previous error on the next successful load', async () => {
      usePromptStore.setState({ error: 'old failure' })
      mockInvoke.mockResolvedValueOnce([createMockPrompt()])

      await usePromptStore.getState().loadPrompts()

      expect(usePromptStore.getState().error).toBeNull()
    })
  })

  describe('ensureLoaded', () => {
    it('loads prompts when the store is empty and idle', async () => {
      const prompts = [createMockPrompt()]
      mockInvoke.mockResolvedValueOnce(prompts)

      await usePromptStore.getState().ensureLoaded()

      expect(mockInvoke).toHaveBeenCalledWith('list_prompts')
      expect(usePromptStore.getState().prompts).toEqual(prompts)
    })

    it('skips loading when prompts are already present', async () => {
      usePromptStore.setState({ prompts: [createMockPrompt()] })

      await usePromptStore.getState().ensureLoaded()

      expect(mockInvoke).not.toHaveBeenCalled()
      expect(usePromptStore.getState().prompts).toHaveLength(1)
    })

    it('skips loading while another load is in flight', async () => {
      usePromptStore.setState({ isLoading: true })

      await usePromptStore.getState().ensureLoaded()

      expect(mockInvoke).not.toHaveBeenCalled()
      expect(usePromptStore.getState().isLoading).toBe(true)
    })
  })

  describe('loadPromptsByCategory', () => {
    it('requests the category and stores the returned prompts', async () => {
      const prompts = [createMockPrompt({ id: 'cat-1', category: 'writing' })]
      mockInvoke.mockResolvedValueOnce(prompts)

      await usePromptStore.getState().loadPromptsByCategory('writing')

      expect(mockInvoke).toHaveBeenCalledWith('list_prompts_by_category', {
        category: 'writing',
      })
      const state = usePromptStore.getState()
      expect(state.prompts).toEqual(prompts)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('replaces prompts from other categories', async () => {
      usePromptStore.setState({
        prompts: [createMockPrompt({ id: 'coding-1', category: 'coding' })],
      })
      mockInvoke.mockResolvedValueOnce([createMockPrompt({ id: 'writing-1', category: 'writing' })])

      await usePromptStore.getState().loadPromptsByCategory('writing')

      expect(usePromptStore.getState().prompts.map((p) => p.category)).toEqual(['writing'])
    })

    it('stores the error when invoke fails', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('bad category'))

      await usePromptStore.getState().loadPromptsByCategory('nope')

      const state = usePromptStore.getState()
      expect(state.error).toBe('Error: bad category')
      expect(state.isLoading).toBe(false)
    })
  })

  describe('createPrompt', () => {
    it('appends the created prompt and returns it', async () => {
      usePromptStore.setState({ prompts: [createMockPrompt({ id: 'old' })] })
      const created = createMockPrompt({ id: 'new', name: 'Summarize' })
      mockInvoke.mockResolvedValueOnce(created)

      const req = {
        name: 'Summarize',
        content: 'Summarize the following text',
        category: 'writing',
      }
      const result = await usePromptStore.getState().createPrompt(req)

      expect(mockInvoke).toHaveBeenCalledWith('create_prompt', { req })
      expect(result).toEqual(created)
      const state = usePromptStore.getState()
      expect(state.prompts.map((p) => p.id)).toEqual(['old', 'new'])
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('propagates the error and leaves the list unchanged', async () => {
      usePromptStore.setState({ prompts: [createMockPrompt({ id: 'old' })] })
      mockInvoke.mockRejectedValueOnce(new Error('name too long'))

      await expect(
        usePromptStore.getState().createPrompt({
          name: '',
          content: 'x'.repeat(10_000),
        })
      ).rejects.toThrow('name too long')

      const state = usePromptStore.getState()
      expect(state.error).toBe('Error: name too long')
      expect(state.isLoading).toBe(false)
      expect(state.prompts.map((p) => p.id)).toEqual(['old'])
    })
  })

  describe('updatePrompt', () => {
    it('replaces the matching prompt with the updated one and returns it', async () => {
      usePromptStore.setState({
        prompts: [
          createMockPrompt({ id: 'prompt-a', name: 'Old name' }),
          createMockPrompt({ id: 'prompt-b' }),
        ],
      })
      const updated = createMockPrompt({
        id: 'prompt-a',
        name: 'New name',
        content: 'Rewritten content',
      })
      mockInvoke.mockResolvedValueOnce(updated)

      const req = { name: 'New name', content: 'Rewritten content' }
      const result = await usePromptStore.getState().updatePrompt('prompt-a', req)

      expect(mockInvoke).toHaveBeenCalledWith('update_prompt', {
        id: 'prompt-a',
        req,
      })
      expect(result).toEqual(updated)
      const state = usePromptStore.getState()
      expect(state.prompts[0]).toEqual(updated)
      // Sibling prompt is untouched
      expect(state.prompts[1].name).toBe('Code review')
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('leaves the list unchanged when the id is unknown', async () => {
      const existing = [createMockPrompt({ id: 'prompt-a' })]
      usePromptStore.setState({ prompts: existing })
      const orphan = createMockPrompt({ id: 'ghost' })
      mockInvoke.mockResolvedValueOnce(orphan)

      const result = await usePromptStore.getState().updatePrompt('ghost', {
        name: 'Ghost',
        content: 'Boo',
      })

      expect(result).toEqual(orphan)
      expect(usePromptStore.getState().prompts).toEqual(existing)
    })

    it('propagates the error, stores it and keeps the old prompt', async () => {
      usePromptStore.setState({
        prompts: [createMockPrompt({ id: 'prompt-a', name: 'Old name' })],
      })
      mockInvoke.mockRejectedValueOnce(new Error('update rejected'))

      await expect(
        usePromptStore.getState().updatePrompt('prompt-a', {
          name: 'New name',
          content: 'Rewritten',
        })
      ).rejects.toThrow('update rejected')

      const state = usePromptStore.getState()
      expect(state.error).toBe('Error: update rejected')
      expect(state.isLoading).toBe(false)
      expect(state.prompts[0].name).toBe('Old name')
    })
  })

  describe('deletePrompt', () => {
    it('removes the prompt from the list', async () => {
      usePromptStore.setState({
        prompts: [createMockPrompt({ id: 'prompt-a' }), createMockPrompt({ id: 'prompt-b' })],
      })
      mockInvoke.mockResolvedValueOnce(null)

      await usePromptStore.getState().deletePrompt('prompt-a')

      expect(mockInvoke).toHaveBeenCalledWith('delete_prompt', {
        id: 'prompt-a',
      })
      const state = usePromptStore.getState()
      expect(state.prompts.map((p) => p.id)).toEqual(['prompt-b'])
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('propagates the error and keeps the prompt', async () => {
      usePromptStore.setState({
        prompts: [createMockPrompt({ id: 'prompt-a' })],
      })
      mockInvoke.mockRejectedValueOnce(new Error('delete denied'))

      await expect(usePromptStore.getState().deletePrompt('prompt-a')).rejects.toThrow(
        'delete denied'
      )

      const state = usePromptStore.getState()
      expect(state.error).toBe('Error: delete denied')
      expect(state.isLoading).toBe(false)
      expect(state.prompts).toHaveLength(1)
    })
  })

  describe('togglePromptStar', () => {
    it('replaces the prompt with the backend version flipping is_starred', async () => {
      usePromptStore.setState({
        prompts: [createMockPrompt({ id: 'prompt-a', is_starred: false })],
      })
      const toggled = createMockPrompt({ id: 'prompt-a', is_starred: true })
      mockInvoke.mockResolvedValueOnce(toggled)

      const result = await usePromptStore.getState().togglePromptStar('prompt-a')

      expect(mockInvoke).toHaveBeenCalledWith('toggle_prompt_star', {
        id: 'prompt-a',
      })
      expect(result.is_starred).toBe(true)
      expect(usePromptStore.getState().prompts[0].is_starred).toBe(true)
      expect(usePromptStore.getState().isLoading).toBe(false)
    })

    it('leaves the list unchanged when the id is unknown', async () => {
      const existing = [createMockPrompt({ id: 'prompt-a' })]
      usePromptStore.setState({ prompts: existing })
      mockInvoke.mockResolvedValueOnce(createMockPrompt({ id: 'ghost', is_starred: true }))

      await usePromptStore.getState().togglePromptStar('ghost')

      expect(usePromptStore.getState().prompts).toEqual(existing)
    })

    it('propagates the error and stores it', async () => {
      usePromptStore.setState({
        prompts: [createMockPrompt({ id: 'prompt-a', is_starred: false })],
      })
      mockInvoke.mockRejectedValueOnce(new Error('toggle failed'))

      await expect(usePromptStore.getState().togglePromptStar('prompt-a')).rejects.toThrow(
        'toggle failed'
      )

      const state = usePromptStore.getState()
      expect(state.error).toBe('Error: toggle failed')
      expect(state.isLoading).toBe(false)
      expect(state.prompts[0].is_starred).toBe(false)
    })
  })

  describe('getPromptById', () => {
    it('returns the prompt with the matching id', () => {
      const target = createMockPrompt({ id: 'prompt-b' })
      usePromptStore.setState({
        prompts: [createMockPrompt({ id: 'prompt-a' }), target],
      })

      expect(usePromptStore.getState().getPromptById('prompt-b')).toEqual(target)
    })

    it('returns undefined for an unknown id', () => {
      usePromptStore.setState({ prompts: [createMockPrompt()] })

      expect(usePromptStore.getState().getPromptById('nope')).toBeUndefined()
    })
  })
})
