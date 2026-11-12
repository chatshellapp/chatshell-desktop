import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { PresetDetail } from '../index'
import { useAssistantStore } from '@/stores/assistantStore'
import { useConversationStore } from '@/stores/conversation'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import type { Assistant, ModelParameterPreset } from '@/types'

const mockInvoke = vi.mocked(invoke)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.name !== undefined
        ? `${key}:${String(options.name)}`
        : options?.count !== undefined
          ? `${key}:${String(options.count)}`
          : key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/components/preset-dialog', () => ({
  PresetDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="preset-dialog" /> : null,
}))

const actions = {
  startChatWithPreset: vi.fn(),
  duplicatePreset: vi.fn(),
  setDefaultPreset: vi.fn(),
  deletePreset: vi.fn(),
}
vi.mock('@/hooks/usePresets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/usePresets')>()
  return { ...actual, usePresetActions: () => actions }
})
const handlers = { handleConversationClick: vi.fn() }
vi.mock('@/hooks/useSidebarHandlers', () => ({ useSidebarHandlers: () => handlers }))

const NOW = '2026-01-01T00:00:00Z'
const custom: ModelParameterPreset = {
  id: 'p-1',
  name: 'Focused',
  description: 'For reviews',
  temperature: 0,
  max_tokens: 1024,
  additional_params: { seed: 7 },
  is_system: false,
  is_default: false,
  created_at: NOW,
  updated_at: NOW,
}
const builtIn: ModelParameterPreset = {
  ...custom,
  id: 'p-sys',
  name: 'Balanced',
  is_system: true,
  is_default: true,
  additional_params: undefined,
}
const user = (presetId: string): Assistant => ({
  id: 'a-1',
  name: 'Reviewer',
  role: 'Code reviewer',
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

const openMenu = () =>
  fireEvent.pointerDown(screen.getByRole('button', { name: 'moreActions' }), {
    button: 0,
    ctrlKey: false,
  })

describe('PresetDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(['c-1'])
    useAssistantStore.setState({ assistants: [] })
    useConversationStore.setState({
      conversations: [{ id: 'c-1', title: 'PR review', created_at: NOW, updated_at: NOW }],
    })
    useLibrarySelectionStore.setState({ selectedPresetId: 'p-1' })
  })

  const renderDetail = (
    preset: ModelParameterPreset,
    overrides: Partial<{ onChatOpened: () => void; onOpenAssistant: (a: Assistant) => void }> = {}
  ) => {
    const props = { onChatOpened: vi.fn(), onOpenAssistant: vi.fn(), ...overrides }
    render(<PresetDetail preset={preset} {...props} />)
    return props
  }

  it('shows parameters, provider defaults and additional params', () => {
    renderDetail(custom)

    expect(screen.getByRole('heading', { name: 'Focused' })).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('1024')).toBeInTheDocument()
    expect(screen.getAllByText('providerDefault')).toHaveLength(3)
    expect(screen.getByText(/"seed": 7/)).toBeInTheDocument()
  })

  it('starts a chat and leaves the page', () => {
    const { onChatOpened } = renderDetail(custom)

    fireEvent.click(screen.getByRole('button', { name: /useInNewChat/ }))

    expect(actions.startChatWithPreset).toHaveBeenCalledWith(custom)
    expect(onChatOpened).toHaveBeenCalled()
  })

  it('lists conversations and opens them', async () => {
    const { onChatOpened } = renderDetail(custom)

    fireEvent.click(await screen.findByText('PR review'))

    expect(mockInvoke).toHaveBeenCalledWith('list_conversation_ids_by_preset', { presetId: 'p-1' })
    expect(handlers.handleConversationClick).toHaveBeenCalledWith('c-1')
    expect(onChatOpened).toHaveBeenCalled()
  })

  it('lists assistants and opens them', () => {
    useAssistantStore.setState({ assistants: [user('p-1')] })
    const { onOpenAssistant } = renderDetail(custom)

    fireEvent.click(screen.getByText('Reviewer'))

    expect(onOpenAssistant).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-1' }))
  })

  it('offers edit and delete for custom presets and deletes after confirmation', async () => {
    actions.deletePreset.mockResolvedValue(true)
    renderDetail(custom)

    openMenu()
    expect(screen.getByRole('menuitem', { name: /edit/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/ }))
    const confirm = screen
      .getAllByRole('button', { name: 'delete' })
      .find((button) => button.closest('[role="alertdialog"]'))
    fireEvent.click(confirm!)

    expect(actions.deletePreset).toHaveBeenCalledWith(custom)
    await waitFor(() => expect(useLibrarySelectionStore.getState().selectedPresetId).toBeNull())
  })

  it('keeps the selection when deletion fails', async () => {
    actions.deletePreset.mockResolvedValue(false)
    renderDetail(custom)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/ }))
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'delete' })
        .find((button) => button.closest('[role="alertdialog"]'))!
    )

    await waitFor(() => expect(actions.deletePreset).toHaveBeenCalled())
    expect(useLibrarySelectionStore.getState().selectedPresetId).toBe('p-1')
  })

  it('explains why a preset in use cannot be deleted', () => {
    useAssistantStore.setState({ assistants: [user('p-1')] })
    renderDetail(custom)

    openMenu()

    expect(screen.getByRole('menuitem', { name: /delete/ })).toHaveAttribute('data-disabled')
    expect(screen.getByText('presetDeleteBlockedInUse:1')).toBeInTheDocument()
  })

  it('explains why the default preset cannot be deleted', () => {
    renderDetail({ ...custom, is_default: true })

    openMenu()

    expect(screen.getByRole('menuitem', { name: /delete/ })).toHaveAttribute('data-disabled')
    expect(screen.getByText('presetDeleteBlockedDefault')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /setAsDefault/ })).not.toBeInTheDocument()
  })

  it('makes built-in presets read-only but allows duplicating', async () => {
    actions.duplicatePreset.mockResolvedValue({ ...builtIn, id: 'p-copy' })
    renderDetail(builtIn)

    expect(screen.getByText('builtInPresetHint')).toBeInTheDocument()
    openMenu()
    expect(screen.queryByRole('menuitem', { name: /edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/ }))

    expect(actions.duplicatePreset).toHaveBeenCalledWith(builtIn, 'presetCopyName:Balanced')
    await waitFor(() => expect(useLibrarySelectionStore.getState().selectedPresetId).toBe('p-copy'))
  })

  it('sets a preset as default', () => {
    renderDetail(custom)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /setAsDefault/ }))

    expect(actions.setDefaultPreset).toHaveBeenCalledWith(custom)
  })

  it('opens the edit dialog', () => {
    renderDetail(custom)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /edit/ }))

    expect(screen.getByTestId('preset-dialog')).toBeInTheDocument()
  })
})
