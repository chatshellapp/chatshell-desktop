import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { ContactProfile } from '../index'
import { useModelStore } from '@/stores/modelStore'
import { useConversationStore } from '@/stores/conversation'
import { useProviderSettingsStore } from '@/stores/providerSettingsStore'
import { useContactSelectionStore } from '@/stores/contactSelectionStore'
import type * as UtilsModule from '@/lib/utils'
import type { Assistant, Model, Provider } from '@/types'

const mockInvoke = vi.mocked(invoke)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.name ? `${key}:${String(options.name)}` : key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof UtilsModule>()
  return { ...actual, formatConversationTimestamp: (value: string) => value }
})

// The edit dialog pulls in most of the app; it is not under test here
vi.mock('@/components/assistant-dialog', () => ({
  AssistantDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="assistant-dialog" /> : null,
}))

const handlers = {
  handleModelClick: vi.fn(),
  handleAssistantClick: vi.fn(),
  handleModelStarToggle: vi.fn(),
  handleAssistantStarToggle: vi.fn(),
  handleModelDelete: vi.fn(),
  handleAssistantDelete: vi.fn(),
  handleAssistantDuplicate: vi.fn(),
  handleConversationClick: vi.fn(),
}
vi.mock('@/hooks/useSidebarHandlers', () => ({ useSidebarHandlers: () => handlers }))

const NOW = '2026-01-01T00:00:00Z'

const provider = { id: 'provider-1', name: 'OpenAI' } as Provider

const model: Model = {
  id: 'model-1',
  provider_id: 'provider-1',
  name: 'GPT-4o',
  model_id: 'gpt-4o',
  description: 'Flagship model',
  is_starred: false,
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW,
}

const assistant: Assistant = {
  id: 'assistant-1',
  name: 'Chef',
  role: 'Cooking expert',
  description: 'Plans meals',
  system_prompt: 'You are a chef.',
  model_id: 'model-1',
  tool_ids: ['web_fetch'],
  skill_ids: [],
  avatar_type: 'text',
  group_name: 'Kitchen',
  is_starred: true,
  created_at: NOW,
  updated_at: NOW,
}

describe('ContactProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(['c-1'])
    useModelStore.setState({ models: [model], providers: [provider] })
    useConversationStore.setState({
      conversations: [
        { id: 'c-1', title: 'Dinner plans', created_at: NOW, updated_at: NOW, last_message: 'Hi' },
        { id: 'c-2', title: 'Unrelated', created_at: NOW, updated_at: NOW },
      ],
    })
    useContactSelectionStore.setState({ selected: { kind: 'assistant', id: 'assistant-1' } })
  })

  describe('model', () => {
    const renderModel = (onChatOpened = vi.fn()) => {
      render(<ContactProfile contact={{ kind: 'model', model }} onChatOpened={onChatOpened} />)
      return onChatOpened
    }

    it('shows the model details', () => {
      renderModel()

      expect(screen.getByRole('heading', { name: 'GPT-4o' })).toBeInTheDocument()
      expect(screen.getAllByText('OpenAI').length).toBeGreaterThan(0)
      expect(screen.getByText('Flagship model')).toBeInTheDocument()
    })

    it('starts a chat and leaves the profile', () => {
      const onChatOpened = renderModel()

      fireEvent.click(screen.getByRole('button', { name: /startChat/ }))

      expect(handlers.handleModelClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'model-1' })
      )
      expect(onChatOpened).toHaveBeenCalled()
    })

    it('toggles the star', () => {
      renderModel()

      fireEvent.click(screen.getByRole('button', { name: 'star' }))

      expect(handlers.handleModelStarToggle).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'model-1' })
      )
    })

    it('lists only conversations with this model and opens them', async () => {
      const onChatOpened = renderModel()

      const row = await screen.findByText('Dinner plans')
      expect(screen.queryByText('Unrelated')).not.toBeInTheDocument()
      expect(invoke).toHaveBeenCalledWith('list_conversation_ids_by_participant', {
        participantType: 'model',
        participantId: 'model-1',
      })

      fireEvent.click(row)
      expect(handlers.handleConversationClick).toHaveBeenCalledWith('c-1')
      expect(onChatOpened).toHaveBeenCalled()
    })

    it('shows an empty state without conversations', async () => {
      mockInvoke.mockResolvedValue([])
      renderModel()

      expect(await screen.findByText('noRecentConversations')).toBeInTheDocument()
    })

    it('opens provider settings for the model provider', () => {
      const openProviderSettings = vi.fn()
      useProviderSettingsStore.setState({ openProviderSettings })
      renderModel()

      fireEvent.pointerDown(screen.getByRole('button', { name: 'moreActions' }), {
        button: 0,
        ctrlKey: false,
      })
      fireEvent.click(screen.getByRole('menuitem', { name: /configuration/ }))

      expect(openProviderSettings).toHaveBeenCalledWith('provider-1')
    })
  })

  describe('assistant', () => {
    const renderAssistant = (contact: Assistant = assistant, onChatOpened = vi.fn()) => {
      render(
        <ContactProfile
          contact={{ kind: 'assistant', assistant: contact }}
          onChatOpened={onChatOpened}
        />
      )
      return onChatOpened
    }

    const openMenu = () =>
      fireEvent.pointerDown(screen.getByRole('button', { name: 'moreActions' }), {
        button: 0,
        ctrlKey: false,
      })

    it('shows role, group, model, tools and system prompt', () => {
      renderAssistant()

      expect(screen.getByRole('heading', { name: 'Chef' })).toBeInTheDocument()
      expect(screen.getByText('Cooking expert')).toBeInTheDocument()
      expect(screen.getByText('Kitchen')).toBeInTheDocument()
      expect(screen.getByText('GPT-4o')).toBeInTheDocument()
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('You are a chef.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'unstar' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('flags a missing model', () => {
      renderAssistant({ ...assistant, model_id: 'gone' })

      expect(screen.getByText('modelUnavailable')).toBeInTheDocument()
    })

    it('starts a chat with the assistant', () => {
      const onChatOpened = renderAssistant()

      fireEvent.click(screen.getByRole('button', { name: /startChat/ }))

      expect(handlers.handleAssistantClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'assistant-1' })
      )
      expect(onChatOpened).toHaveBeenCalled()
    })

    it('duplicates and selects the copy', async () => {
      handlers.handleAssistantDuplicate.mockResolvedValue({ ...assistant, id: 'assistant-2' })
      renderAssistant()

      openMenu()
      fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/ }))

      expect(handlers.handleAssistantDuplicate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'assistant-1' }),
        'assistantCopyName:Chef'
      )
      await waitFor(() =>
        expect(useContactSelectionStore.getState().selected).toEqual({
          kind: 'assistant',
          id: 'assistant-2',
        })
      )
    })

    it('opens the edit dialog', () => {
      renderAssistant()

      openMenu()
      fireEvent.click(screen.getByRole('menuitem', { name: /edit/ }))

      expect(screen.getByTestId('assistant-dialog')).toBeInTheDocument()
    })

    it('deletes after confirmation and clears the selection', () => {
      renderAssistant()

      openMenu()
      fireEvent.click(screen.getByRole('menuitem', { name: /delete/ }))
      expect(handlers.handleAssistantDelete).not.toHaveBeenCalled()

      const confirm = screen
        .getAllByRole('button', { name: 'delete' })
        .find((button) => button.closest('[role="alertdialog"]'))
      fireEvent.click(confirm!)

      expect(handlers.handleAssistantDelete).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'assistant-1' })
      )
      expect(useContactSelectionStore.getState().selected).toBeNull()
    })
  })
})
