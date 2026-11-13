import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAssistantGroups } from '../useAssistantGroups'
import { useAssistantStore } from '@/stores/assistantStore'
import { useModelStore } from '@/stores/modelStore'
import type { Assistant, Model } from '@/types'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'

const gptModel: Model = {
  id: 'model-1',
  provider_id: 'provider-1',
  name: 'GPT-4o',
  model_id: 'gpt-4o',
  is_starred: false,
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW,
}

const makeAssistant = (overrides: Partial<Assistant> & { id: string }): Assistant => ({
  name: `Assistant ${overrides.id}`,
  system_prompt: 'fallback system prompt',
  model_id: 'model-1',
  tool_ids: [],
  skill_ids: [],
  avatar_type: 'text',
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
})

describe('useAssistantGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAssistantStore.setState({
      assistants: [],
      currentAssistant: null,
      lastCreatedModelId: null,
      isLoading: false,
      error: null,
    })
    useModelStore.setState({
      models: [gptModel],
      providers: [],
      isLoading: false,
      error: null,
    })
  })

  it('returns no groups when there are no assistants', () => {
    const { result } = renderHook(() => useAssistantGroups())

    expect(result.current).toEqual([])
  })

  it('groups assistants with ungrouped first and the rest alphabetically', () => {
    useAssistantStore.setState({
      assistants: [
        makeAssistant({ id: 'a-work', group_name: 'Work' }),
        makeAssistant({ id: 'a-alpha', group_name: 'Alpha' }),
        makeAssistant({ id: 'a-free-1' }),
        makeAssistant({ id: 'a-free-2' }),
      ],
    })

    const { result } = renderHook(() => useAssistantGroups())

    const groups = result.current
    expect(groups.map((g) => g.name)).toEqual(['Ungrouped', 'Alpha', 'Work'])
    expect(groups.map((g) => g.id)).toEqual(['group:Ungrouped', 'group:Alpha', 'group:Work'])
    expect(groups[0].assistants.map((a) => a.id)).toEqual(['a-free-1', 'a-free-2'])
    expect(groups.map((g) => g.defaultOpen)).toEqual([true, false, false])
  })

  it('maps assistant display fields with sensible defaults', () => {
    useAssistantStore.setState({
      assistants: [
        makeAssistant({
          id: 'a-role',
          name: 'Chef',
          role: 'Kitchen helper',
          is_starred: true,
        }),
      ],
    })

    const { result } = renderHook(() => useAssistantGroups())

    const [assistant] = result.current[0].assistants
    expect(assistant.name).toBe('Chef')
    expect(assistant.persona).toBe('Kitchen helper')
    expect(assistant.avatarBg).toBe('#3b82f6')
    expect(assistant.avatarText).toBe('C')
    expect(assistant.isStarred).toBe(true)
    expect(assistant.capabilities?.hasModel).toBe(true)
  })

  it('prefers description over a truncated system prompt for the persona', () => {
    const systemPrompt =
      'You are a meticulous assistant that helps with very long and detailed prompts.'
    useAssistantStore.setState({
      assistants: [
        makeAssistant({ id: 'a-desc', description: 'Short description' }),
        makeAssistant({ id: 'a-prompt', system_prompt: systemPrompt }),
      ],
    })

    const { result } = renderHook(() => useAssistantGroups())
    const [descAssistant, promptAssistant] = result.current[0].assistants

    expect(descAssistant.persona).toBe('Short description')
    expect(promptAssistant.persona).toBe(`${systemPrompt.substring(0, 50)}...`)
  })

  it('links the model name and logo when the model is known', () => {
    useAssistantStore.setState({
      assistants: [makeAssistant({ id: 'a-known', name: 'GPT Helper' })],
    })

    const { result } = renderHook(() => useAssistantGroups())

    const [assistant] = result.current[0].assistants
    expect(assistant.modelName).toBe('GPT-4o')
    expect(assistant.capabilities?.modelLogo).toBeTruthy()
  })

  it('degrades gracefully when the linked model is missing', () => {
    useAssistantStore.setState({
      assistants: [makeAssistant({ id: 'a-orphan', model_id: 'model-gone' })],
    })

    const { result } = renderHook(() => useAssistantGroups())

    const [assistant] = result.current[0].assistants
    expect(assistant.modelName).toBeUndefined()
    expect(assistant.capabilities?.modelLogo).toBeUndefined()
  })

  it('keeps groups whose names only differ by case and spacing distinct', () => {
    useAssistantStore.setState({
      assistants: [
        makeAssistant({ id: 'a-1', group_name: 'My Group' }),
        makeAssistant({ id: 'a-2', group_name: 'my-group' }),
      ],
    })

    const { result } = renderHook(() => useAssistantGroups())

    const ids = result.current.map((g) => g.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('does not append an ellipsis to short prompts and omits the subtitle when empty', () => {
    useAssistantStore.setState({
      assistants: [
        makeAssistant({ id: 'a-short', system_prompt: 'Be brief.' }),
        makeAssistant({ id: 'a-empty', system_prompt: '' }),
      ],
    })

    const { result } = renderHook(() => useAssistantGroups())
    const [shortAssistant, emptyAssistant] = result.current[0].assistants

    expect(shortAssistant.persona).toBe('Be brief.')
    expect(emptyAssistant.persona).toBeUndefined()
  })

  it('uses the image avatar only when the avatar type is image', () => {
    useAssistantStore.setState({
      assistants: [
        makeAssistant({
          id: 'a-image',
          avatar_type: 'image',
          avatar_image_url: 'https://example.com/a.png',
        }),
        makeAssistant({
          id: 'a-text',
          avatar_type: 'text',
          avatar_image_url: 'https://example.com/b.png',
        }),
      ],
    })

    const { result } = renderHook(() => useAssistantGroups())
    const [imageAssistant, textAssistant] = result.current[0].assistants

    expect(imageAssistant.logo).toBe('https://example.com/a.png')
    expect(textAssistant.logo).toBeUndefined()
  })

  it('flags tools when the assistant has tools or skills attached', () => {
    useAssistantStore.setState({
      assistants: [
        makeAssistant({ id: 'a-tools', tool_ids: ['web_fetch'] }),
        makeAssistant({ id: 'a-skills', skill_ids: ['skill-1'] }),
        makeAssistant({ id: 'a-none' }),
      ],
    })

    const { result } = renderHook(() => useAssistantGroups())
    const [withTools, withSkills, none] = result.current[0].assistants

    expect(withTools.capabilities?.hasTools).toBe(true)
    expect(withSkills.capabilities?.hasTools).toBe(true)
    expect(none.capabilities?.hasTools).toBe(false)
  })
})
