import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { PromptDetail } from '../index'
import { usePromptStore } from '@/stores/promptStore'
import { useConversationStore } from '@/stores/conversation'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import type * as UtilsModule from '@/lib/utils'
import type { Prompt } from '@/types'

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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof UtilsModule>()
  return { ...actual, formatConversationTimestamp: (value: string) => value }
})

vi.mock('@/components/prompt-dialog', () => ({
  PromptDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="prompt-dialog" /> : null,
}))

const handlers = {
  handlePromptUse: vi.fn(),
  handlePromptInsert: vi.fn(),
  handlePromptDuplicate: vi.fn(),
  handlePromptDelete: vi.fn(),
  handleConversationClick: vi.fn(),
}
vi.mock('@/hooks/useSidebarHandlers', () => ({ useSidebarHandlers: () => handlers }))

const NOW = '2026-01-01T00:00:00Z'

const userPrompt: Prompt = {
  id: 'p-user',
  name: 'Summarize',
  content: 'Summarize this:\n- point one',
  description: 'Short summaries',
  category: 'Writing',
  is_system: false,
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
}

const systemPrompt: Prompt = {
  ...userPrompt,
  id: 'p-sys',
  name: 'Reviewer',
  content: 'You review code.',
  category: undefined,
  is_system: true,
  is_starred: true,
}

const openMenu = () =>
  fireEvent.pointerDown(screen.getByRole('button', { name: 'moreActions' }), {
    button: 0,
    ctrlKey: false,
  })

describe('PromptDetail', () => {
  let togglePromptStar: Mock<(id: string) => Promise<Prompt>>

  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(['c-1'])
    togglePromptStar = vi.fn<(id: string) => Promise<Prompt>>()
    usePromptStore.setState({ prompts: [userPrompt, systemPrompt], togglePromptStar })
    useConversationStore.setState({
      conversations: [{ id: 'c-1', title: 'Code review', created_at: NOW, updated_at: NOW }],
    })
    useLibrarySelectionStore.setState({ selectedPromptId: 'p-user' })
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  const renderDetail = (prompt: Prompt, onChatOpened = vi.fn()) => {
    render(<PromptDetail prompt={prompt} onChatOpened={onChatOpened} />)
    return onChatOpened
  }

  it('shows the user prompt content and details', () => {
    renderDetail(userPrompt)

    expect(screen.getByRole('heading', { name: 'Summarize' })).toBeInTheDocument()
    expect(screen.getByText('Short summaries')).toBeInTheDocument()
    expect(screen.getByTestId('prompt-content')).toHaveTextContent('Summarize this: - point one')
    expect(screen.getAllByText('Writing').length).toBeGreaterThan(0)
    expect(screen.getByText(`characterCount:${userPrompt.content.length}`)).toBeInTheDocument()
  })

  it('uses the prompt in a new chat and leaves the page', () => {
    const onChatOpened = renderDetail(userPrompt)

    fireEvent.click(screen.getByRole('button', { name: /useInNewChat/ }))

    expect(handlers.handlePromptUse).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-user' }))
    expect(onChatOpened).toHaveBeenCalled()
  })

  it('inserts a user prompt into the current chat', () => {
    const onChatOpened = renderDetail(userPrompt)

    fireEvent.click(screen.getByRole('button', { name: 'insertIntoChat' }))

    expect(handlers.handlePromptInsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-user' })
    )
    expect(onChatOpened).toHaveBeenCalled()
  })

  it('copies the content and confirms with a toast', async () => {
    renderDetail(userPrompt)

    fireEvent.click(screen.getByRole('button', { name: 'copyContent' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('promptCopied'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(userPrompt.content)
  })

  it('reports a failed copy', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    renderDetail(userPrompt)

    fireEvent.click(screen.getByRole('button', { name: 'copyContent' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('failedToCopyPrompt'))
  })

  it('does not query or show conversations for user prompts', () => {
    renderDetail(userPrompt)

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(screen.queryByText('usedInConversations')).not.toBeInTheDocument()
  })

  it('lists conversations using a system prompt and hides insert', async () => {
    const onChatOpened = renderDetail(systemPrompt)

    expect(screen.queryByRole('button', { name: 'insertIntoChat' })).not.toBeInTheDocument()
    expect(screen.getAllByText('uncategorized').length).toBeGreaterThan(0)
    const row = await screen.findByText('Code review')
    expect(mockInvoke).toHaveBeenCalledWith('list_conversation_ids_by_prompt', {
      promptId: 'p-sys',
    })

    fireEvent.click(row)
    expect(handlers.handleConversationClick).toHaveBeenCalledWith('c-1')
    expect(onChatOpened).toHaveBeenCalled()
  })

  it('shows the prompt-specific empty state', async () => {
    mockInvoke.mockResolvedValue([])
    renderDetail(systemPrompt)

    expect(await screen.findByText('noPromptConversations')).toBeInTheDocument()
  })

  it('toggles the star', () => {
    renderDetail(systemPrompt)

    fireEvent.click(screen.getByRole('button', { name: 'unstar' }))

    expect(togglePromptStar).toHaveBeenCalledWith('p-sys')
  })

  it('duplicates and selects the copy', async () => {
    handlers.handlePromptDuplicate.mockResolvedValue({ ...userPrompt, id: 'p-copy' })
    renderDetail(userPrompt)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/ }))

    expect(handlers.handlePromptDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-user' }),
      'promptCopyName:Summarize'
    )
    await waitFor(() => expect(useLibrarySelectionStore.getState().selectedPromptId).toBe('p-copy'))
  })

  it('opens the edit dialog', () => {
    renderDetail(userPrompt)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /edit/ }))

    expect(screen.getByTestId('prompt-dialog')).toBeInTheDocument()
  })

  it('deletes after confirmation and clears the selection', () => {
    renderDetail(userPrompt)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/ }))
    expect(handlers.handlePromptDelete).not.toHaveBeenCalled()

    const confirm = screen
      .getAllByRole('button', { name: 'delete' })
      .find((button) => button.closest('[role="alertdialog"]'))
    fireEvent.click(confirm!)

    expect(handlers.handlePromptDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-user' })
    )
    expect(useLibrarySelectionStore.getState().selectedPromptId).toBeNull()
  })
})
