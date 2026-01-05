import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useAssistantStore } from '../assistantStore'
import type { Assistant, CreateAssistantRequest } from '@/types'

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

const createMockAssistant = (id: string, name: string): Assistant => ({
  id,
  name,
  model_id: 'model-1',
  system_prompt: 'You are a helpful assistant',
  avatar_type: 'text',
  avatar_text: '🤖',
  avatar_bg: '#00E5FF',
  is_starred: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

describe('useAssistantStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to initial values
    useAssistantStore.setState({
      assistants: [],
      currentAssistant: null,
      lastCreatedModelId: null,
      isLoading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('should have empty assistants array', () => {
      const state = useAssistantStore.getState()
      expect(state.assistants).toEqual([])
    })

    it('should have no current assistant initially', () => {
      const state = useAssistantStore.getState()
      expect(state.currentAssistant).toBeNull()
    })

    it('should not be loading initially', () => {
      const state = useAssistantStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have no error initially', () => {
      const state = useAssistantStore.getState()
      expect(state.error).toBeNull()
    })

    it('should have no lastCreatedModelId initially', () => {
      const state = useAssistantStore.getState()
      expect(state.lastCreatedModelId).toBeNull()
    })
  })

  describe('loadAssistants', () => {
    it('should populate assistants on successful load', async () => {
      const mockAssistants: Assistant[] = [
        createMockAssistant('assistant-1', 'Helper'),
        createMockAssistant('assistant-2', 'Coder'),
      ]
      mockInvoke.mockResolvedValue(mockAssistants)

      await useAssistantStore.getState().loadAssistants()

      expect(mockInvoke).toHaveBeenCalledWith('list_assistants')
      expect(useAssistantStore.getState().assistants).toEqual(mockAssistants)
      expect(useAssistantStore.getState().isLoading).toBe(false)
      expect(useAssistantStore.getState().error).toBeNull()
    })

    it('should set error on failed load', async () => {
      const errorMessage = 'Failed to load assistants'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await useAssistantStore.getState().loadAssistants()

      expect(useAssistantStore.getState().assistants).toEqual([])
      expect(useAssistantStore.getState().isLoading).toBe(false)
      expect(useAssistantStore.getState().error).toContain(errorMessage)
    })
  })

  describe('createAssistant', () => {
    it('should create a new assistant and add to store', async () => {
      const newAssistant = createMockAssistant('new-assistant', 'New Helper')
      mockInvoke.mockResolvedValue(newAssistant)

      const req: CreateAssistantRequest = {
        name: 'New Helper',
        model_id: 'model-1',
        system_prompt: 'You are helpful',
      }
      const result = await useAssistantStore.getState().createAssistant(req)

      expect(mockInvoke).toHaveBeenCalledWith('create_assistant', { req })
      expect(result).toEqual(newAssistant)
      expect(useAssistantStore.getState().assistants).toContainEqual(newAssistant)
    })

    it('should update lastCreatedModelId after creation', async () => {
      const newAssistant = createMockAssistant('new-assistant', 'New Helper')
      newAssistant.model_id = 'model-special'
      mockInvoke.mockResolvedValue(newAssistant)

      const req: CreateAssistantRequest = {
        name: 'New Helper',
        model_id: 'model-special',
        system_prompt: 'You are helpful',
      }
      await useAssistantStore.getState().createAssistant(req)

      expect(useAssistantStore.getState().lastCreatedModelId).toBe('model-special')
    })

    it('should throw and set error on failure', async () => {
      const errorMessage = 'Failed to create assistant'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      const req: CreateAssistantRequest = {
        name: 'Test',
        model_id: 'model-1',
        system_prompt: 'You are helpful',
      }
      await expect(useAssistantStore.getState().createAssistant(req)).rejects.toThrow()

      expect(useAssistantStore.getState().error).toContain(errorMessage)
    })
  })

  describe('updateAssistant', () => {
    it('should update assistant and update store', async () => {
      const assistant = createMockAssistant('assistant-1', 'Old Name')
      useAssistantStore.setState({ assistants: [assistant] })

      const updatedAssistant = { ...assistant, name: 'New Name' }
      mockInvoke.mockResolvedValue(updatedAssistant)

      const req: CreateAssistantRequest = {
        name: 'New Name',
        model_id: 'model-1',
        system_prompt: 'You are helpful',
      }
      const result = await useAssistantStore.getState().updateAssistant('assistant-1', req)

      expect(mockInvoke).toHaveBeenCalledWith('update_assistant', { id: 'assistant-1', req })
      expect(result.name).toBe('New Name')
      expect(useAssistantStore.getState().assistants[0].name).toBe('New Name')
    })

    it('should update currentAssistant if it matches', async () => {
      const assistant = createMockAssistant('assistant-1', 'Old Name')
      useAssistantStore.setState({
        assistants: [assistant],
        currentAssistant: assistant,
      })

      const updatedAssistant = { ...assistant, name: 'New Name' }
      mockInvoke.mockResolvedValue(updatedAssistant)

      const req: CreateAssistantRequest = {
        name: 'New Name',
        model_id: 'model-1',
        system_prompt: 'You are helpful',
      }
      await useAssistantStore.getState().updateAssistant('assistant-1', req)

      expect(useAssistantStore.getState().currentAssistant?.name).toBe('New Name')
    })

    it('should throw and set error on failure', async () => {
      const assistant = createMockAssistant('assistant-1', 'Test')
      useAssistantStore.setState({ assistants: [assistant] })

      const errorMessage = 'Failed to update assistant'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      const req: CreateAssistantRequest = {
        name: 'New Name',
        model_id: 'model-1',
        system_prompt: 'You are helpful',
      }
      await expect(
        useAssistantStore.getState().updateAssistant('assistant-1', req)
      ).rejects.toThrow()

      expect(useAssistantStore.getState().error).toContain(errorMessage)
    })
  })

  describe('deleteAssistant', () => {
    it('should delete assistant and remove from store', async () => {
      const assistants = [
        createMockAssistant('assistant-1', 'Helper 1'),
        createMockAssistant('assistant-2', 'Helper 2'),
      ]
      useAssistantStore.setState({ assistants })
      mockInvoke.mockResolvedValue(undefined)

      await useAssistantStore.getState().deleteAssistant('assistant-1')

      expect(mockInvoke).toHaveBeenCalledWith('delete_assistant', { id: 'assistant-1' })
      expect(useAssistantStore.getState().assistants).toHaveLength(1)
      expect(useAssistantStore.getState().assistants[0].id).toBe('assistant-2')
    })

    it('should clear currentAssistant if deleted', async () => {
      const assistant = createMockAssistant('assistant-1', 'Helper')
      useAssistantStore.setState({
        assistants: [assistant],
        currentAssistant: assistant,
      })
      mockInvoke.mockResolvedValue(undefined)

      await useAssistantStore.getState().deleteAssistant('assistant-1')

      expect(useAssistantStore.getState().currentAssistant).toBeNull()
    })

    it('should throw and set error on failure', async () => {
      const assistant = createMockAssistant('assistant-1', 'Test')
      useAssistantStore.setState({ assistants: [assistant] })

      const errorMessage = 'Failed to delete assistant'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await expect(useAssistantStore.getState().deleteAssistant('assistant-1')).rejects.toThrow()

      expect(useAssistantStore.getState().error).toContain(errorMessage)
      // Assistant should still be in the store since delete failed
      expect(useAssistantStore.getState().assistants).toHaveLength(1)
    })
  })

  describe('setCurrentAssistant', () => {
    it('should set current assistant', () => {
      const assistant = createMockAssistant('assistant-1', 'Helper')

      useAssistantStore.getState().setCurrentAssistant(assistant)

      expect(useAssistantStore.getState().currentAssistant).toEqual(assistant)
    })

    it('should clear current assistant when set to null', () => {
      const assistant = createMockAssistant('assistant-1', 'Helper')
      useAssistantStore.setState({ currentAssistant: assistant })

      useAssistantStore.getState().setCurrentAssistant(null)

      expect(useAssistantStore.getState().currentAssistant).toBeNull()
    })
  })

  describe('getAssistant', () => {
    it('should fetch assistant by id', async () => {
      const assistant = createMockAssistant('assistant-1', 'Helper')
      mockInvoke.mockResolvedValue(assistant)

      const result = await useAssistantStore.getState().getAssistant('assistant-1')

      expect(mockInvoke).toHaveBeenCalledWith('get_assistant', { id: 'assistant-1' })
      expect(result).toEqual(assistant)
    })

    it('should return null on error', async () => {
      mockInvoke.mockRejectedValue(new Error('Not found'))

      const result = await useAssistantStore.getState().getAssistant('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('getAssistantById', () => {
    it('should return assistant from local store by id', () => {
      const assistants = [
        createMockAssistant('assistant-1', 'Helper 1'),
        createMockAssistant('assistant-2', 'Helper 2'),
      ]
      useAssistantStore.setState({ assistants })

      const result = useAssistantStore.getState().getAssistantById('assistant-2')

      expect(result).toEqual(assistants[1])
    })

    it('should return undefined for non-existent id', () => {
      const assistant = createMockAssistant('assistant-1', 'Helper')
      useAssistantStore.setState({ assistants: [assistant] })

      const result = useAssistantStore.getState().getAssistantById('non-existent')

      expect(result).toBeUndefined()
    })
  })
})

