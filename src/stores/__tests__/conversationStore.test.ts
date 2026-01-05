import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useConversationStore } from '../conversation'
import type { Conversation, Model, Assistant } from '@/types'

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

const createMockConversation = (id: string, title: string): Conversation => ({
  id,
  title,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

const createMockModel = (id: string, name: string): Model => ({
  id,
  provider_id: 'provider-1',
  name,
  model_id: name.toLowerCase(),
  is_starred: false,
  is_deleted: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

describe('useConversationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to initial values
    useConversationStore.setState({
      conversations: [],
      currentConversation: null,
      currentParticipants: [],
      selectedModel: null,
      selectedAssistant: null,
      lastUsedModel: null,
      lastUsedAssistant: null,
      isFirstConversationSinceStartup: true,
      isLoading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('should have empty conversations array', () => {
      const state = useConversationStore.getState()
      expect(state.conversations).toEqual([])
    })

    it('should have no current conversation initially', () => {
      const state = useConversationStore.getState()
      expect(state.currentConversation).toBeNull()
    })

    it('should not be loading initially', () => {
      const state = useConversationStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have no error initially', () => {
      const state = useConversationStore.getState()
      expect(state.error).toBeNull()
    })

    it('should have no selected model or assistant initially', () => {
      const state = useConversationStore.getState()
      expect(state.selectedModel).toBeNull()
      expect(state.selectedAssistant).toBeNull()
    })
  })

  describe('loadConversations', () => {
    it('should populate conversations on successful load', async () => {
      const mockConversations: Conversation[] = [
        createMockConversation('conv-1', 'Test Conversation 1'),
        createMockConversation('conv-2', 'Test Conversation 2'),
      ]
      mockInvoke.mockResolvedValue(mockConversations)

      await useConversationStore.getState().loadConversations()

      expect(mockInvoke).toHaveBeenCalledWith('list_conversations')
      expect(useConversationStore.getState().conversations).toEqual(mockConversations)
      expect(useConversationStore.getState().isLoading).toBe(false)
      expect(useConversationStore.getState().error).toBeNull()
    })

    it('should set error on failed load', async () => {
      const errorMessage = 'Failed to load conversations'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await useConversationStore.getState().loadConversations()

      expect(useConversationStore.getState().conversations).toEqual([])
      expect(useConversationStore.getState().isLoading).toBe(false)
      expect(useConversationStore.getState().error).toContain(errorMessage)
    })
  })

  describe('createConversation', () => {
    it('should create a new conversation and add to store', async () => {
      const newConversation = createMockConversation('new-conv', 'New Conversation')
      mockInvoke.mockResolvedValue(newConversation)

      const result = await useConversationStore.getState().createConversation('New Conversation')

      expect(mockInvoke).toHaveBeenCalledWith('create_conversation', {
        req: { title: 'New Conversation' },
      })
      expect(result).toEqual(newConversation)
      expect(useConversationStore.getState().conversations).toContainEqual(newConversation)
    })

    it('should add new conversation at the beginning of the list', async () => {
      const existingConversation = createMockConversation('existing', 'Existing')
      useConversationStore.setState({ conversations: [existingConversation] })

      const newConversation = createMockConversation('new-conv', 'New Conversation')
      mockInvoke.mockResolvedValue(newConversation)

      await useConversationStore.getState().createConversation('New Conversation')

      const conversations = useConversationStore.getState().conversations
      expect(conversations[0]).toEqual(newConversation)
      expect(conversations[1]).toEqual(existingConversation)
    })

    it('should throw and set error on failure', async () => {
      const errorMessage = 'Failed to create conversation'
      mockInvoke.mockRejectedValue(new Error(errorMessage))

      await expect(useConversationStore.getState().createConversation('Test')).rejects.toThrow()

      expect(useConversationStore.getState().error).toContain(errorMessage)
    })
  })

  describe('updateConversation', () => {
    it('should update conversation title', async () => {
      const conversation = createMockConversation('conv-1', 'Old Title')
      useConversationStore.setState({ conversations: [conversation] })

      const updatedConversation = { ...conversation, title: 'New Title' }
      mockInvoke.mockResolvedValue(updatedConversation)

      const result = await useConversationStore.getState().updateConversation('conv-1', 'New Title')

      expect(mockInvoke).toHaveBeenCalledWith('update_conversation', {
        id: 'conv-1',
        title: 'New Title',
      })
      expect(result.title).toBe('New Title')
      expect(useConversationStore.getState().conversations[0].title).toBe('New Title')
    })

    it('should update currentConversation if it matches', async () => {
      const conversation = createMockConversation('conv-1', 'Old Title')
      useConversationStore.setState({
        conversations: [conversation],
        currentConversation: conversation,
      })

      const updatedConversation = { ...conversation, title: 'New Title' }
      mockInvoke.mockResolvedValue(updatedConversation)

      await useConversationStore.getState().updateConversation('conv-1', 'New Title')

      expect(useConversationStore.getState().currentConversation?.title).toBe('New Title')
    })
  })

  describe('deleteConversation', () => {
    it('should delete conversation and remove from store', async () => {
      const conversation = createMockConversation('conv-1', 'Test')
      useConversationStore.setState({ conversations: [conversation] })
      mockInvoke.mockResolvedValue(undefined)

      await useConversationStore.getState().deleteConversation('conv-1')

      expect(mockInvoke).toHaveBeenCalledWith('delete_conversation', { id: 'conv-1' })
      expect(useConversationStore.getState().conversations).toHaveLength(0)
    })

    it('should clear currentConversation if deleted', async () => {
      const conversation = createMockConversation('conv-1', 'Test')
      useConversationStore.setState({
        conversations: [conversation],
        currentConversation: conversation,
      })
      mockInvoke.mockResolvedValue(undefined)

      await useConversationStore.getState().deleteConversation('conv-1')

      expect(useConversationStore.getState().currentConversation).toBeNull()
    })
  })

  describe('setCurrentConversation', () => {
    it('should set current conversation', () => {
      const conversation = createMockConversation('conv-1', 'Test')

      useConversationStore.getState().setCurrentConversation(conversation)

      expect(useConversationStore.getState().currentConversation).toEqual(conversation)
    })

    it('should clear current conversation when set to null', () => {
      const conversation = createMockConversation('conv-1', 'Test')
      useConversationStore.setState({ currentConversation: conversation })

      useConversationStore.getState().setCurrentConversation(null)

      expect(useConversationStore.getState().currentConversation).toBeNull()
    })
  })

  describe('setSelectedModel', () => {
    it('should set selected model and clear assistant', () => {
      const model = createMockModel('model-1', 'GPT-4')

      useConversationStore.getState().setSelectedModel(model)

      const state = useConversationStore.getState()
      expect(state.selectedModel).toEqual(model)
      expect(state.selectedAssistant).toBeNull()
      expect(state.lastUsedModel).toEqual(model)
    })

    it('should not select soft-deleted model', () => {
      const deletedModel = { ...createMockModel('model-1', 'GPT-4'), is_deleted: true }

      useConversationStore.getState().setSelectedModel(deletedModel)

      const state = useConversationStore.getState()
      expect(state.selectedModel).toBeNull()
    })

    it('should clear selection when set to null', () => {
      const model = createMockModel('model-1', 'GPT-4')
      useConversationStore.setState({ selectedModel: model })

      useConversationStore.getState().setSelectedModel(null)

      expect(useConversationStore.getState().selectedModel).toBeNull()
    })
  })

  describe('setSelectedAssistant', () => {
    it('should set selected assistant and clear model', () => {
      const assistant: Assistant = {
        id: 'assistant-1',
        name: 'My Assistant',
        model_id: 'model-1',
        system_prompt: 'You are helpful',
        avatar_type: 'text',
        is_starred: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }
      const model = createMockModel('model-1', 'GPT-4')
      useConversationStore.setState({ selectedModel: model })

      useConversationStore.getState().setSelectedAssistant(assistant)

      const state = useConversationStore.getState()
      expect(state.selectedAssistant).toEqual(assistant)
      expect(state.selectedModel).toBeNull()
      expect(state.lastUsedAssistant).toEqual(assistant)
    })
  })

  describe('getCurrentModel', () => {
    it('should return selected model when set', () => {
      const model = createMockModel('model-1', 'GPT-4')
      useConversationStore.setState({ selectedModel: model })

      const currentModel = useConversationStore.getState().getCurrentModel()

      expect(currentModel).toEqual(model)
    })

    it('should return null when no model selected', () => {
      const currentModel = useConversationStore.getState().getCurrentModel()

      expect(currentModel).toBeNull()
    })
  })
})
