import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDisplayInfo } from '../useDisplayInfo'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import type { Assistant, Model, Provider } from '@/types'

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

const provider: Provider = {
  id: 'provider-1',
  name: 'OpenAI',
  provider_type: 'openai',
  is_enabled: true,
  created_at: NOW,
  updated_at: NOW,
}

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: 'assistant-1',
    name: 'Helper',
    role: 'Writer',
    description: 'writes things',
    system_prompt: 'sys',
    model_id: 'model-1',
    tool_ids: [],
    skill_ids: [],
    avatar_type: 'text',
    is_starred: false,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

describe('useDisplayInfo', () => {
  let selectedModel: Model | null
  let selectedAssistant: Assistant | null

  function renderInfo() {
    return renderHook(() => useDisplayInfo({ selectedModel, selectedAssistant })).result.current
  }

  beforeEach(() => {
    selectedModel = null
    selectedAssistant = null
    useModelStore.setState({
      models: [model],
      providers: [provider],
      isLoading: false,
      error: null,
    })
    useAssistantStore.setState({ assistants: [], currentAssistant: null, lastCreatedModelId: null })
  })

  describe('getDisplayInfo for the selected sender', () => {
    it('formats the model name with its provider', () => {
      selectedModel = model

      const info = renderInfo().getDisplayInfo()

      expect(info.displayName).toBe('GPT-4o - OpenAI')
      expect(info.senderType).toBe('model')
    })

    it('falls back to the bare model name when the provider vanished', () => {
      selectedModel = model
      useModelStore.setState({ models: [model], providers: [] })

      const info = renderInfo().getDisplayInfo()

      expect(info.displayName).toBe('GPT-4o')
    })

    it('describes an image-avatar assistant and its model', () => {
      selectedAssistant = makeAssistant({
        avatar_type: 'image',
        avatar_image_url: 'https://cdn.example.com/a.png',
        avatar_image_path: '/local/a.png',
      })

      const info = renderInfo().getDisplayInfo()

      expect(info.displayName).toBe('Helper · Writer')
      expect(info.senderType).toBe('assistant')
      expect(info.assistantLogo).toBe('https://cdn.example.com/a.png')
      expect(info.assistantName).toBe('Helper')
      expect(info.assistantRole).toBe('Writer')
      expect(info.assistantDescription).toBe('writes things')
      expect(info.assistantModelName).toBe('GPT-4o')
      expect(info.assistantModelId).toBe('gpt-4o')
    })

    it('describes a text-avatar assistant', () => {
      selectedAssistant = makeAssistant({
        avatar_type: 'text',
        avatar_bg: '#112233',
        avatar_text: 'H',
      })

      const info = renderInfo().getDisplayInfo()

      expect(info.displayName).toBe('Helper · Writer')
      expect(info.avatarBg).toBe('#112233')
      expect(info.avatarText).toBe('H')
      expect(info.assistantLogo).toBeUndefined()
    })

    it('omits the role separator when the assistant has no role', () => {
      selectedAssistant = makeAssistant({ role: undefined })

      const info = renderInfo().getDisplayInfo()

      expect(info.displayName).toBe('Helper')
    })

    it('falls back to a generic assistant when nothing is selected', () => {
      const info = renderInfo().getDisplayInfo()

      expect(info.displayName).toBe('AI Assistant')
      expect(info.senderType).toBe('model')
    })
  })

  describe('getMessageDisplayInfo for history rows', () => {
    it('returns the generic assistant for messages without a sender id', () => {
      const info = renderInfo().getMessageDisplayInfo({
        id: 'm1',
        sender_type: 'model',
        content: 'hi',
        created_at: NOW,
      })

      expect(info.displayName).toBe('AI Assistant')
      expect(info.senderType).toBe('model')
    })

    it('resolves model messages to the model card', () => {
      const info = renderInfo().getMessageDisplayInfo({
        id: 'm1',
        sender_type: 'model',
        sender_id: 'model-1',
        content: 'hi',
        created_at: NOW,
      })

      expect(info.displayName).toBe('GPT-4o - OpenAI')
      expect(info.senderType).toBe('model')
    })

    it('falls back to the generic assistant for unknown model ids', () => {
      const info = renderInfo().getMessageDisplayInfo({
        id: 'm1',
        sender_type: 'model',
        sender_id: 'model-gone',
        content: 'hi',
        created_at: NOW,
      })

      expect(info.displayName).toBe('AI Assistant')
    })

    it('resolves assistant messages with an image avatar', () => {
      useAssistantStore.setState({
        assistants: [
          makeAssistant({
            avatar_type: 'image',
            avatar_image_url: 'https://cdn.example.com/b.png',
          }),
        ],
        currentAssistant: null,
        lastCreatedModelId: null,
      })

      const info = renderInfo().getMessageDisplayInfo({
        id: 'm1',
        sender_type: 'assistant',
        sender_id: 'assistant-1',
        content: 'hi',
        created_at: NOW,
      })

      expect(info.displayName).toBe('Helper · Writer')
      expect(info.senderType).toBe('assistant')
      expect(info.assistantLogo).toBe('https://cdn.example.com/b.png')
      expect(info.assistantModelName).toBe('GPT-4o')
    })

    it('resolves assistant messages with a text avatar', () => {
      useAssistantStore.setState({
        assistants: [
          makeAssistant({ avatar_type: 'text', avatar_bg: '#abcdef', avatar_text: 'X' }),
        ],
        currentAssistant: null,
        lastCreatedModelId: null,
      })

      const info = renderInfo().getMessageDisplayInfo({
        id: 'm1',
        sender_type: 'assistant',
        sender_id: 'assistant-1',
        content: 'hi',
        created_at: NOW,
      })

      expect(info.avatarBg).toBe('#abcdef')
      expect(info.avatarText).toBe('X')
    })

    it('falls back to the generic assistant for unknown assistant ids', () => {
      const info = renderInfo().getMessageDisplayInfo({
        id: 'm1',
        sender_type: 'assistant',
        sender_id: 'assistant-gone',
        content: 'hi',
        created_at: NOW,
      })

      expect(info.displayName).toBe('AI Assistant')
    })

    it('falls back to the generic assistant for user messages', () => {
      const info = renderInfo().getMessageDisplayInfo({
        id: 'm1',
        sender_type: 'user',
        sender_id: 'model-1',
        content: 'hi',
        created_at: NOW,
      })

      expect(info.displayName).toBe('AI Assistant')
    })
  })
})
