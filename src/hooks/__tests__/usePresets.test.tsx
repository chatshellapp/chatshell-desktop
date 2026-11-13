import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { toast } from 'sonner'
import {
  usePresetActions,
  usePresetAssistants,
  usePresetConversations,
  useSelectedPreset,
} from '../usePresets'
import { usePresetStore } from '@/stores/presetStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { useConversationStore } from '@/stores/conversation'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import { invoke } from '@tauri-apps/api/core'
import type { Assistant, Conversation, ModelParameterPreset } from '@/types'

const mockInvoke = vi.mocked(invoke)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'
const preset: ModelParameterPreset = {
  id: 'p-1',
  name: 'Focused',
  temperature: 0.2,
  is_system: false,
  is_default: false,
  created_at: NOW,
  updated_at: NOW,
}
const assistant = (id: string, presetId?: string): Assistant => ({
  id,
  name: id,
  system_prompt: '',
  model_id: 'm',
  model_parameter_preset_id: presetId,
  tool_ids: [],
  skill_ids: [],
  avatar_type: 'text',
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
})
const draft: Conversation = { id: 'draft-1', title: '', created_at: NOW, updated_at: NOW }

describe('preset hooks', () => {
  const realOpenDraft = useConversationStore.getState().openDraftConversation
  const realSetPreset = useConversationSettingsStore.getState().setSelectedPresetId

  afterEach(() => {
    useConversationStore.setState({ openDraftConversation: realOpenDraft })
    useConversationSettingsStore.setState({ setSelectedPresetId: realSetPreset })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    usePresetStore.setState({ presets: [preset] })
    useLibrarySelectionStore.setState({ selectedPresetId: null })
  })

  it('resolves the selected preset', () => {
    const { result } = renderHook(() => useSelectedPreset())
    expect(result.current).toBeNull()

    act(() => useLibrarySelectionStore.getState().selectPreset('p-1'))
    expect(result.current).toEqual(preset)

    act(() => usePresetStore.setState({ presets: [] }))
    expect(result.current).toBeNull()
  })

  it('lists assistants using the preset', () => {
    useAssistantStore.setState({
      assistants: [assistant('a-1', 'p-1'), assistant('a-2', 'other'), assistant('a-3')],
    })
    const { result } = renderHook(() => usePresetAssistants('p-1'))
    expect(result.current.map((a) => a.id)).toEqual(['a-1'])
  })

  it('queries conversations by preset', () => {
    mockInvoke.mockResolvedValue([])
    renderHook(() => usePresetConversations('p-1'))
    expect(mockInvoke).toHaveBeenCalledWith('list_conversation_ids_by_preset', { presetId: 'p-1' })
  })

  it('starts a draft with the preset selected', async () => {
    const openDraftConversation = vi.fn().mockResolvedValue(draft)
    const setSelectedPresetId = vi.fn().mockResolvedValue(undefined)
    useConversationStore.setState({ openDraftConversation })
    useConversationSettingsStore.setState({ setSelectedPresetId })
    const { result } = renderHook(() => usePresetActions())

    await act(async () => {
      await result.current.startChatWithPreset(preset)
    })

    expect(setSelectedPresetId).toHaveBeenCalledWith('draft-1', 'p-1')
  })

  it('toasts when starting a chat fails', async () => {
    useConversationStore.setState({
      openDraftConversation: vi.fn().mockRejectedValue(new Error('no model')),
    })
    const { result } = renderHook(() => usePresetActions())

    await act(async () => {
      await result.current.startChatWithPreset(preset)
    })

    expect(toast.error).toHaveBeenCalledWith('failedToUsePreset', { description: 'no model' })
  })

  it('duplicates as a non-default copy', async () => {
    const createPreset = vi.fn().mockResolvedValue({ ...preset, id: 'p-2' })
    usePresetStore.setState({ createPreset })
    const { result } = renderHook(() => usePresetActions())

    let copy: ModelParameterPreset | null = null
    await act(async () => {
      copy = await result.current.duplicatePreset({ ...preset, is_default: true }, 'Copy')
    })

    expect(copy).toEqual(expect.objectContaining({ id: 'p-2' }))
    expect(createPreset).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Copy', temperature: 0.2, is_default: false })
    )
  })

  it('reports delete failures and returns false', async () => {
    usePresetStore.setState({ deletePreset: vi.fn().mockRejectedValue(new Error('in use')) })
    const { result } = renderHook(() => usePresetActions())

    let ok = true
    await act(async () => {
      ok = await result.current.deletePreset(preset)
    })

    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('failedToDeletePreset', { description: 'in use' })
  })

  it('reports set-default failures', async () => {
    usePresetStore.setState({ setDefaultPreset: vi.fn().mockRejectedValue(new Error('x')) })
    const { result } = renderHook(() => usePresetActions())

    await act(async () => {
      await result.current.setDefaultPreset(preset)
    })

    expect(toast.error).toHaveBeenCalledWith('failedToSetDefaultPreset', { description: 'x' })
  })
})
