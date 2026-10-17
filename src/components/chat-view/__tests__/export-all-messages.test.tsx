import { useRef } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { MessageList } from '../MessageList'
import { useMessageHandlers } from '../hooks/useMessageHandlers'
import { useMessageStore, createDefaultConversationState } from '@/stores/message'
import { useConversationStore } from '@/stores/conversation'
import type { DisplayInfo } from '../hooks'

const captured = vi.hoisted(() => ({ count: 0, called: false }))

vi.mock('@/lib/screenshot', () => ({
  saveScreenshot: vi.fn(async (element: HTMLElement) => {
    captured.count = element.querySelectorAll('[data-message-id]').length
    captured.called = true
    return true
  }),
  saveScreenshotMulti: vi.fn(async () => true),
  findMessageElement: vi.fn(() => null),
  findStreamingMessageElement: vi.fn(() => null),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

const CONV = 'conv-export-all'
const MESSAGE_COUNT = 40
const DISPLAY: DisplayInfo = { displayName: 'Model', senderType: 'model' }
const getDisplayInfo = () => DISPLAY
const getMessageDisplayInfo = () => DISPLAY
// Stable module-level callbacks: MessageItem's memo comparator compares
// identity, matching ChatView's useCallback-stable props.
const noop = () => {}
const setIsAtBottom = () => {}

function Host() {
  const messagesContentRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const { handleExportAll } = useMessageHandlers({
    messagesEndRef,
    messagesContentRef,
    setIsAtBottom,
  })
  const messages = useMessageStore((s) => s.conversationStates[CONV]?.messages ?? [])
  const conversationId = useConversationStore((s) => s.currentConversation?.id ?? '')

  return (
    <div>
      <button onClick={() => void handleExportAll()}>export-all</button>
      <div>
        <div ref={messagesContentRef}>
          <MessageList
            conversationId={conversationId}
            messages={messages}
            lastUserMessage={null}
            showStreamingMessage={false}
            messageResources={{}}
            urlStatuses={{}}
            apiError={null}
            isLoadingOlder={false}
            messagesContentRef={messagesContentRef}
            messagesEndRef={messagesEndRef}
            getDisplayInfo={getDisplayInfo}
            getMessageDisplayInfo={getMessageDisplayInfo}
            onClearApiError={noop}
            onCopy={noop}
            onRevert={noop}
            onFork={noop}
            onExportAll={noop}
            onExportConversation={noop}
            onExportStreamingConversation={noop}
            onExportMessage={noop}
          />
        </div>
      </div>
    </div>
  )
}

describe('export all messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.count = 0
    captured.called = false

    const state = createDefaultConversationState()
    state.messages = Array.from({ length: MESSAGE_COUNT }, (_, i) => ({
      id: `msg-${i}`,
      conversation_id: CONV,
      sender_type: i % 2 === 0 ? 'user' : 'model',
      content: `message ${i}`,
      created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    }))
    state.hasOlderMessages = false

    useMessageStore.setState({
      conversationStates: { [CONV]: state },
      isSending: false,
      error: null,
      onNewConversationCreated: undefined,
    })
    useConversationStore.setState({
      currentConversation: {
        id: CONV,
        title: 'Export',
        created_at: new Date(2026, 0, 1).toISOString(),
        updated_at: new Date(2026, 0, 1).toISOString(),
      },
    })
  })

  it('waits for the progressive list to mount every message before capturing', async () => {
    render(<Host />)

    fireEvent.click(screen.getByText('export-all'))

    await waitFor(() => expect(captured.called).toBe(true))
    expect(captured.count).toBe(MESSAGE_COUNT)
  })

  it('pages in older history before capturing', async () => {
    const conversationState = useMessageStore.getState().getConversationState(CONV)
    useMessageStore.setState({
      conversationStates: {
        [CONV]: { ...conversationState, hasOlderMessages: true },
      },
    })
    vi.mocked(invoke).mockResolvedValueOnce(
      Array.from({ length: 3 }, (_, i) => ({
        id: `old-${i}`,
        conversation_id: CONV,
        sender_type: 'user' as const,
        content: `older message ${i}`,
        created_at: new Date(2025, 11, 31, 0, 0, i).toISOString(),
      }))
    )

    render(<Host />)

    fireEvent.click(screen.getByText('export-all'))

    await waitFor(() => expect(captured.called).toBe(true))
    expect(captured.count).toBe(MESSAGE_COUNT + 3)
  })
})
