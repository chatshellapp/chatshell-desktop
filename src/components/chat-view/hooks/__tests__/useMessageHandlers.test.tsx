import { useRef, useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import {
  saveScreenshot,
  saveScreenshotMulti,
  findMessageElement,
  findStreamingMessageElement,
} from '@/lib/screenshot'
import { useMessageHandlers, type UseMessageHandlersReturn } from '../useMessageHandlers'
import { useMessageStore, createDefaultConversationState } from '@/stores/message'
import { useConversationStore } from '@/stores/conversation'
import { useModelStore } from '@/stores/modelStore'
import { useConversationSettingsStore } from '@/stores/conversationSettingsStore'
import { usePromptStore } from '@/stores/promptStore'
import { createDefaultConversationSettings } from '@/types'
import type {
  Assistant,
  Conversation,
  ContextEnrichment,
  ConversationSettingsResponse,
  Message,
  MessageResources,
  Model,
  Prompt,
  Provider,
  UserAttachment,
} from '@/types'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/screenshot', () => ({
  saveScreenshot: vi.fn(),
  saveScreenshotMulti: vi.fn(),
  findMessageElement: vi.fn(() => null),
  findStreamingMessageElement: vi.fn(() => null),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

const NOW = '2026-01-01T00:00:00Z'
const CONV = 'conv-handlers'

const backendSettings = (
  overrides: Partial<ConversationSettingsResponse> = {}
): ConversationSettingsResponse => ({
  conversation_id: CONV,
  use_provider_defaults: false,
  use_custom_parameters: false,
  parameter_overrides: {},
  context_message_count: null,
  selected_preset_id: null,
  system_prompt_mode: 'none',
  selected_system_prompt_id: null,
  custom_system_prompt: null,
  user_prompt_mode: 'none',
  selected_user_prompt_id: null,
  custom_user_prompt: null,
  enabled_mcp_server_ids: [],
  enabled_skill_ids: [],
  working_directory: null,
  ...overrides,
})

const conversation: Conversation = {
  id: CONV,
  title: 'Handlers',
  created_at: NOW,
  updated_at: NOW,
}

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
  api_key: 'sk-test',
  base_url: 'https://api.example.com',
  api_style: 'responses',
  is_enabled: true,
  created_at: NOW,
  updated_at: NOW,
}

const assistant: Assistant = {
  id: 'assistant-1',
  name: 'Helper',
  role: 'Writer',
  system_prompt: 'assistant system prompt',
  user_prompt: 'assistant user prompt',
  model_id: 'model-1',
  tool_ids: [],
  skill_ids: [],
  avatar_type: 'text',
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
}

const prompt: Prompt = {
  id: 'prompt-1',
  name: 'Existing prompt',
  content: 'existing prompt content',
  is_system: false,
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
}

const imageAttachment: UserAttachment = {
  type: 'file',
  id: 'att-img',
  file_name: 'pic.png',
  file_size: 3,
  mime_type: 'image/png',
  storage_path: '/store/pic.png',
  content_hash: 'h1',
  created_at: NOW,
}

const textAttachment: UserAttachment = {
  type: 'file',
  id: 'att-txt',
  file_name: 'notes.txt',
  file_size: 4,
  mime_type: 'text/plain',
  storage_path: '/store/notes.txt',
  content_hash: 'h2',
  created_at: NOW,
}

const userLinkContext: ContextEnrichment = {
  type: 'fetch_result',
  id: 'ctx-user-link',
  source_type: 'user_link',
  url: 'https://example.com/a',
  storage_path: '/store/a',
  content_type: 'text/html',
  status: 'ok',
  content_hash: null,
  created_at: NOW,
  updated_at: NOW,
}

const searchContext: ContextEnrichment = {
  type: 'fetch_result',
  id: 'ctx-search',
  source_type: 'search',
  url: 'https://example.com/b',
  storage_path: '/store/b',
  content_type: 'text/html',
  status: 'ok',
  content_hash: null,
  created_at: NOW,
  updated_at: NOW,
}

const revertResources: MessageResources = {
  attachments: [imageAttachment, textAttachment],
  contexts: [userLinkContext, searchContext],
  steps: [],
}

function makeMessage(id: string, sender_type: string, content: string): Message {
  return { id, conversation_id: CONV, sender_type, content, created_at: NOW }
}

const sendMessage = vi.fn()
const deleteMessagesFrom = vi.fn()
const loadAllMessages = vi.fn()
const loadConversations = vi.fn()
const selectConversation = vi.fn()

let latestHandlers: UseMessageHandlersReturn
let exportTarget: string | null = 'msg-user-1'

let renderContent = true

function Host() {
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const messagesContentRef = useRef<HTMLDivElement | null>(null)
  const [atBottom, setIsAtBottom] = useState(false)
  const handlers = useMessageHandlers({ messagesEndRef, messagesContentRef, setIsAtBottom })
  latestHandlers = handlers
  const messages = useMessageStore((s) => s.conversationStates[CONV]?.messages ?? [])
  return (
    <div>
      <button data-testid="copy" onClick={() => handlers.handleCopy()}>
        copy
      </button>
      <button data-testid="revert" onClick={() => void handlers.handleRevert('msg-user-1')}>
        revert
      </button>
      <button data-testid="fork" onClick={() => void handlers.handleFork('msg-user-1')}>
        fork
      </button>
      <button data-testid="export-all" onClick={() => void handlers.handleExportAll()}>
        export-all
      </button>
      <button
        data-testid="export-conv"
        onClick={() => void handlers.handleExportConversation(exportTarget)}
      >
        export-conv
      </button>
      <button data-testid="export-msg" onClick={() => handlers.handleExportMessage('msg-user-1')}>
        export-msg
      </button>
      <button data-testid="scroll-bottom" onClick={() => handlers.handleScrollToBottom()}>
        scroll-bottom
      </button>
      {renderContent ? (
        <div data-testid="scroll-parent">
          <div ref={messagesContentRef} data-testid="content">
            {messages.map((m) => (
              <div key={m.id} data-message-id={m.id} />
            ))}
          </div>
        </div>
      ) : null}
      <div ref={messagesEndRef} data-testid="end" />
      <span data-testid="at-bottom">{String(atBottom)}</span>
    </div>
  )
}

function seedMessages(messages: Message[]) {
  const state = createDefaultConversationState()
  state.messages = messages
  state.hasOlderMessages = false
  useMessageStore.setState({ conversationStates: { [CONV]: state } })
}

function click(testId: string) {
  fireEvent.click(screen.getByTestId(testId))
}

describe('useMessageHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exportTarget = 'msg-user-1'
    renderContent = true

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'fork_conversation') {
        return { id: 'fork-1', title: 'Fork', created_at: NOW, updated_at: NOW }
      }
      if (cmd === 'get_message_resources') return revertResources
      if (cmd === 'get_conversation_settings') return backendSettings()
      if (cmd === 'read_image_base64') return 'IMG64'
      if (cmd === 'read_file_content') return 'TXT'
      throw new Error(`unexpected command: ${cmd}`)
    })

    sendMessage.mockReset().mockResolvedValue(undefined)
    deleteMessagesFrom.mockReset().mockResolvedValue(undefined)
    loadAllMessages.mockReset().mockResolvedValue(undefined)
    loadConversations.mockReset().mockResolvedValue(undefined)
    selectConversation.mockReset().mockResolvedValue(undefined)

    useMessageStore.setState({
      conversationStates: {},
      isSending: false,
      error: null,
      onNewConversationCreated: undefined,
      sendMessage,
      deleteMessagesFrom,
      loadAllMessages,
    })
    useConversationStore.setState({
      conversations: [],
      currentConversation: conversation,
      currentParticipants: [],
      selectedModel: model,
      selectedAssistant: null,
      lastUsedModel: null,
      lastUsedAssistant: null,
      isFirstConversationSinceStartup: false,
      isLoading: false,
      error: null,
      pendingInput: null,
      loadConversations,
      selectConversation,
    })
    useModelStore.setState({
      models: [model],
      providers: [provider],
      isLoading: false,
      error: null,
    })
    useConversationSettingsStore.setState({ settings: {}, loading: {}, error: null })
    usePromptStore.setState({ prompts: [prompt], isLoading: false, error: null })

    seedMessages([
      makeMessage('msg-user-1', 'user', 'hello there'),
      makeMessage('msg-model-1', 'model', 'hi back'),
      makeMessage('msg-user-2', 'user', 'second question'),
    ])
  })

  describe('handleCopy', () => {
    it('logs the copy action', () => {
      render(<Host />)
      click('copy')
      expect(sendMessage).not.toHaveBeenCalled()
      expect(invoke).not.toHaveBeenCalled()
    })
  })

  describe('handleScrollToBottom', () => {
    it('scrolls the end marker into view and re-enters follow mode', () => {
      render(<Host />)
      const end = screen.getByTestId('end')
      const scrollIntoView = vi.fn()
      end.scrollIntoView = scrollIntoView

      click('scroll-bottom')

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' })
      expect(screen.getByTestId('at-bottom').textContent).toBe('true')
    })
  })

  describe('handleRevert', () => {
    it('re-sends the user message with its attachments and reusable contexts', async () => {
      render(<Host />)

      click('revert')
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))

      expect(invoke).toHaveBeenCalledWith('get_message_resources', { messageId: 'msg-user-1' })
      expect(invoke).toHaveBeenCalledWith('read_image_base64', { storagePath: '/store/pic.png' })
      expect(invoke).toHaveBeenCalledWith('read_file_content', { storagePath: '/store/notes.txt' })
      expect(deleteMessagesFrom).toHaveBeenCalledWith(CONV, 'msg-user-1')

      const args = sendMessage.mock.calls[0]
      expect(args[0]).toBe('hello there')
      expect(args[1]).toBe(CONV)
      expect(args[2]).toBe('openai')
      expect(args[3]).toBe('gpt-4o')
      expect(args[4]).toBe('sk-test')
      expect(args[5]).toBe('https://api.example.com')
      expect(args[6]).toBe('responses')
      expect(args[13]).toEqual([{ name: 'pic.png', base64: 'IMG64', mimeType: 'image/png' }])
      expect(args[14]).toEqual([{ name: 'notes.txt', content: 'TXT', mimeType: 'text/plain' }])
      // Only user-provided link contexts are reused, not search results
      expect(args[19]).toEqual(['ctx-user-link'])
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('routes through the assistant model and prompts when one is selected', async () => {
      useConversationStore.setState({ selectedModel: null, selectedAssistant: assistant })
      // Settings load when a conversation opens; their 'none' prompt modes
      // hand prompt control to the assistant
      useConversationSettingsStore.setState({
        settings: { [CONV]: createDefaultConversationSettings(CONV) },
      })
      render(<Host />)

      click('revert')
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))

      const args = sendMessage.mock.calls[0]
      expect(args[8]).toBe('assistant system prompt')
      expect(args[9]).toBe('assistant user prompt')
      expect(args[10]).toBeUndefined() // model db id dropped for assistants
      expect(args[11]).toBe('assistant-1')
    })

    it('loads settings from the backend when the cache is cold so assistant prompts survive revert', async () => {
      useConversationStore.setState({ selectedModel: null, selectedAssistant: assistant })
      render(<Host />)

      click('revert')
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))

      expect(invoke).toHaveBeenCalledWith('get_conversation_settings', { conversationId: CONV })
      const args = sendMessage.mock.calls[0]
      expect(args[8]).toBe('assistant system prompt')
      expect(args[9]).toBe('assistant user prompt')
      expect(args[11]).toBe('assistant-1')
    })

    it('prefers conversation settings over the assistant defaults', async () => {
      useConversationSettingsStore.setState({
        settings: {
          [CONV]: {
            ...createDefaultConversationSettings(CONV),
            systemPromptMode: 'existing',
            selectedSystemPromptId: 'prompt-1',
            useCustomParameters: true,
            parameterOverrides: { temperature: 0.5 },
            contextMessageCount: 10,
            useProviderDefaults: true,
          },
        },
      })
      render(<Host />)

      click('revert')
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))

      const args = sendMessage.mock.calls[0]
      expect(args[8]).toBe('existing prompt content')
      expect(args[16]).toEqual({ temperature: 0.5 })
      expect(args[17]).toBe(10)
      expect(args[18]).toBe(true)
    })

    it('uses the custom system prompt when the settings ask for one', async () => {
      useConversationSettingsStore.setState({
        settings: {
          [CONV]: {
            ...createDefaultConversationSettings(CONV),
            systemPromptMode: 'custom',
            customSystemPrompt: 'be terse',
          },
        },
      })
      render(<Host />)

      click('revert')
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))

      expect(sendMessage.mock.calls[0][8]).toBe('be terse')
    })

    it('rejects the revert with a toast when no conversation is active', async () => {
      useConversationStore.setState({ currentConversation: null })
      render(<Host />)

      click('revert')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('noActiveConversation'))
      expect(invoke).not.toHaveBeenCalled()
    })

    it('rejects unknown or non-user messages', async () => {
      render(<Host />)

      await act(async () => {
        await latestHandlers.handleRevert('missing-message')
      })
      expect(toast.error).toHaveBeenCalledWith('cannotRevertMessage')

      await act(async () => {
        await latestHandlers.handleRevert('msg-model-1')
      })
      expect(toast.error).toHaveBeenCalledWith('cannotRevertMessage')
      expect(invoke).not.toHaveBeenCalled()
    })

    it('requires a model or assistant to be selected', async () => {
      useConversationStore.setState({ selectedModel: null, selectedAssistant: null })
      render(<Host />)

      click('revert')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('pleaseSelectModelOrAssistant'))
      expect(invoke).not.toHaveBeenCalled()
    })

    it('requires the provider configuration to exist', async () => {
      useModelStore.setState({ models: [model], providers: [] })
      render(<Host />)

      click('revert')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('providerConfigNotFound'))
      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('reports failures with the underlying message', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('disk on fire'))
      render(<Host />)

      click('revert')
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('failedToRevertMessage', {
          description: 'disk on fire',
        })
      )
      expect(sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('handleFork', () => {
    it('forks, reloads the list and selects the new conversation', async () => {
      render(<Host />)

      click('fork')
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('conversationForked'))

      expect(invoke).toHaveBeenCalledWith('fork_conversation', {
        conversationId: CONV,
        messageId: 'msg-user-1',
      })
      expect(loadConversations).toHaveBeenCalledTimes(1)
      expect(selectConversation).toHaveBeenCalledWith('fork-1')
    })

    it('rejects with a toast when no conversation is active', async () => {
      useConversationStore.setState({ currentConversation: null })
      render(<Host />)

      click('fork')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('noActiveConversation'))
      expect(invoke).not.toHaveBeenCalled()
    })

    it('reports fork failures without selecting anything', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('fork blew up'))
      render(<Host />)

      click('fork')
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('failedToForkConversation', {
          description: 'fork blew up',
        })
      )
      expect(selectConversation).not.toHaveBeenCalled()
    })
  })

  describe('handleExportAll', () => {
    it('captures once every row is mounted', async () => {
      vi.mocked(saveScreenshot).mockResolvedValue(true)
      render(<Host />)

      click('export-all')
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('screenshotSaved'))

      const captured = vi.mocked(saveScreenshot).mock.calls[0][0]
      expect(captured).toBe(screen.getByTestId('content'))
    })

    it('refuses to capture when the content element is gone', async () => {
      renderContent = false
      render(<Host />)

      click('export-all')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('noMessagesToCapture'))
      expect(saveScreenshot).not.toHaveBeenCalled()
    })

    it('refuses to capture when older messages stay unloaded', async () => {
      const state = useMessageStore.getState().conversationStates[CONV]
      useMessageStore.setState({
        conversationStates: { [CONV]: { ...state, hasOlderMessages: true } },
      })
      render(<Host />)

      click('export-all')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('failedToExportAllMessages'))
      expect(loadAllMessages).toHaveBeenCalledWith(CONV)
      expect(saveScreenshot).not.toHaveBeenCalled()
    })

    it('refuses to capture when rows never finish mounting', async () => {
      // Exhaust the 10s mount deadline: the clock advances 5s per call, so
      // the deadline is passed after a couple of skipped frames
      let calls = 0
      vi.spyOn(performance, 'now').mockImplementation(() => (calls += 5000))
      // Render a window whose rows cannot mount (empty content element)
      seedMessages([
        makeMessage('msg-user-1', 'user', 'hello there'),
        makeMessage('msg-model-1', 'model', 'hi back'),
        makeMessage('msg-user-2', 'user', 'second question'),
        makeMessage('msg-model-2', 'model', 'never mounted'),
      ])
      render(<Host />)
      const content = screen.getByTestId('content')
      for (const row of content.querySelectorAll('[data-message-id]')) {
        row.remove()
      }

      click('export-all')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('failedToExportAllMessages'))
      expect(saveScreenshot).not.toHaveBeenCalled()
      vi.mocked(performance.now).mockRestore()
    })

    it('shifts the viewport by the height the paged-in history added', async () => {
      vi.mocked(saveScreenshot).mockResolvedValue(true)
      render(<Host />)

      const scrollParent = screen.getByTestId('scroll-parent')
      let scrollHeight = 100
      const scrollTopWrites: number[] = []
      Object.defineProperty(scrollParent, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      })
      Object.defineProperty(scrollParent, 'scrollTop', {
        configurable: true,
        get: () => scrollTopWrites.at(-1) ?? 40,
        set: (v: number) => scrollTopWrites.push(v),
      })
      // History paged in doubles the scrollable height
      loadAllMessages.mockImplementation(async () => {
        scrollHeight = 300
      })

      click('export-all')
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('screenshotSaved'))
      expect(scrollTopWrites).toEqual([240]) // 40 previous top + 200 growth
    })
  })

  describe('handleExportConversation', () => {
    it('pairs the last user message with the streaming element when no id is given', async () => {
      exportTarget = null
      vi.mocked(saveScreenshotMulti).mockResolvedValue(true)
      const userEl = document.createElement('div')
      const streamingEl = document.createElement('div')
      vi.mocked(findMessageElement).mockReturnValue(userEl)
      vi.mocked(findStreamingMessageElement).mockReturnValue(streamingEl)
      render(<Host />)

      click('export-conv')
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('screenshotSaved'))

      expect(findMessageElement).toHaveBeenCalledWith('msg-user-2')
      expect(saveScreenshotMulti).toHaveBeenCalledWith([userEl, streamingEl])
    })

    it('pairs a user message with the assistant answer that follows it', async () => {
      exportTarget = 'msg-user-1'
      vi.mocked(saveScreenshotMulti).mockResolvedValue(true)
      const els: Record<string, HTMLElement> = {
        'msg-user-1': document.createElement('div'),
        'msg-model-1': document.createElement('div'),
      }
      vi.mocked(findMessageElement).mockImplementation((id: string) => els[id] ?? null)
      render(<Host />)

      click('export-conv')
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('screenshotSaved'))

      expect(saveScreenshotMulti).toHaveBeenCalledWith([els['msg-user-1'], els['msg-model-1']])
    })

    it('pairs an assistant message with the user message that precedes it', async () => {
      exportTarget = 'msg-model-1'
      vi.mocked(saveScreenshotMulti).mockResolvedValue(true)
      const els: Record<string, HTMLElement> = {
        'msg-user-1': document.createElement('div'),
        'msg-model-1': document.createElement('div'),
      }
      vi.mocked(findMessageElement).mockImplementation((id: string) => els[id] ?? null)
      render(<Host />)

      click('export-conv')
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('screenshotSaved'))

      expect(saveScreenshotMulti).toHaveBeenCalledWith([els['msg-user-1'], els['msg-model-1']])
    })

    it('skips runt user messages that have no answer yet', async () => {
      exportTarget = 'msg-user-2'
      vi.mocked(saveScreenshotMulti).mockResolvedValue(true)
      const el = document.createElement('div')
      vi.mocked(findMessageElement).mockImplementation((id: string) =>
        id === 'msg-user-2' ? el : null
      )
      render(<Host />)

      click('export-conv')
      await waitFor(() => expect(saveScreenshotMulti).toHaveBeenCalledWith([el]))
    })

    it('rejects unknown message ids', async () => {
      exportTarget = 'missing'
      render(<Host />)

      click('export-conv')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('couldNotFindMessage'))
      expect(saveScreenshotMulti).not.toHaveBeenCalled()
    })

    it('rejects when neither element can be found', async () => {
      vi.mocked(findMessageElement).mockReturnValue(null)
      vi.mocked(findStreamingMessageElement).mockReturnValue(null)
      render(<Host />)

      click('export-conv')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('couldNotFindMessage'))
      expect(saveScreenshotMulti).not.toHaveBeenCalled()
    })

    it('stays quiet when the capture is declined', async () => {
      vi.mocked(saveScreenshotMulti).mockResolvedValue(false)
      const el = document.createElement('div')
      vi.mocked(findMessageElement).mockReturnValue(el)
      render(<Host />)

      click('export-conv')
      await waitFor(() => expect(saveScreenshotMulti).toHaveBeenCalled())
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('rejects with a toast when no conversation is active', async () => {
      useConversationStore.setState({ currentConversation: null })
      render(<Host />)

      click('export-conv')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('noActiveConversation'))
    })
  })

  describe('handleExportMessage', () => {
    it('captures the single message element', async () => {
      vi.mocked(saveScreenshot).mockResolvedValue(true)
      const el = document.createElement('div')
      vi.mocked(findMessageElement).mockReturnValue(el)
      render(<Host />)

      click('export-msg')
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('screenshotSaved'))
      expect(saveScreenshot).toHaveBeenCalledWith(el)
    })

    it('rejects when the message element is gone', async () => {
      vi.mocked(findMessageElement).mockReturnValue(null)
      render(<Host />)

      click('export-msg')
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('couldNotFindMessage'))
      expect(saveScreenshot).not.toHaveBeenCalled()
    })

    it('stays quiet when the capture is declined', async () => {
      vi.mocked(saveScreenshot).mockResolvedValue(false)
      vi.mocked(findMessageElement).mockReturnValue(document.createElement('div'))
      render(<Host />)

      click('export-msg')
      await waitFor(() => expect(saveScreenshot).toHaveBeenCalled())
      expect(toast.success).not.toHaveBeenCalled()
    })
  })
})
