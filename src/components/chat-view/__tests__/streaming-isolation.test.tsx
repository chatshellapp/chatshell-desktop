import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, act } from '@testing-library/react'
import { MessageList } from '../MessageList'
import { useMessageStore } from '@/stores/message'
import type { DisplayInfo } from '../hooks'

// Count every ChatMessage render (content prop) by wrapping the real one.
const chatMessageRenders: string[] = []
vi.mock('@/components/chat-message', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/chat-message')>()
  return {
    ChatMessage: function CountingChatMessage(props: {
      content: string
      role: 'user' | 'assistant'
      children?: React.ReactNode
      [key: string]: unknown
    }) {
      chatMessageRenders.push(props.content ?? '')
      return <actual.ChatMessage {...props} />
    },
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

const CONV = 'conv-perf'

// Stable module-level callbacks/objects: MessageItem's memo comparator
// compares prop identity, so the host below must pass the same references a
// well-behaved parent does (ChatView uses useCallback for all of these).
const DISPLAY: DisplayInfo = { displayName: 'Model', senderType: 'model' }
const getDisplayInfo = () => DISPLAY
const getMessageDisplayInfo = () => DISPLAY
const noop = () => {}
const EMPTY_REFS = { current: null }

function seedHistory(count: number) {
  const store = useMessageStore.getState()
  store.getConversationState(CONV)
  for (let i = 0; i < count; i++) {
    store.addMessage(CONV, {
      id: `hist-${i}`,
      conversation_id: CONV,
      sender_type: i % 2 === 0 ? 'user' : 'model',
      content: `history message ${i}`,
      created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    })
  }
}

/**
 * Worst-case parent: subscribes to the ENTIRE conversation-state object,
 * which immer replaces on every streaming tick. If streaming isolation
 * (memoized MessageItem + slice comparison) regresses, this host re-renders
 * all history rows per token and the assertion below fails.
 */
function WorstCaseHost() {
  const cs = useMessageStore((s) => s.conversationStates[CONV])
  const messages = cs?.messages ?? []
  const lastUserMessage = messages.at(-1)?.sender_type === 'user' ? messages.at(-1)! : null
  return (
    <MessageList
      conversationId={CONV}
      messages={messages}
      lastUserMessage={lastUserMessage}
      showStreamingMessage
      messageResources={{}}
      urlStatuses={{}}
      apiError={null}
      isLoadingOlder={false}
      messagesContentRef={EMPTY_REFS}
      messagesEndRef={EMPTY_REFS}
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
  )
}

describe('streaming isolation', () => {
  beforeAll(() => {
    seedHistory(4)
    act(() => {
      useMessageStore.getState().setIsWaitingForAI(CONV, false)
      useMessageStore.getState().setIsStreaming(CONV, true)
    })
  })

  it('streaming ticks re-render only the streaming row; history rows render once', async () => {
    render(<WorstCaseHost />)

    chatMessageRenders.length = 0
    for (let i = 1; i <= 5; i++) {
      // One act per tick: each throttled store update must flush its own
      // commit, the way 50ms throttle spacing does in the real app.
      await act(async () => {
        useMessageStore.getState().setStreamingContent(CONV, `token-batch-${i}`)
      })
    }

    const historyRenderCount = chatMessageRenders.filter((c) =>
      c.startsWith('history message')
    ).length
    const streamingRenderCount = chatMessageRenders.filter((c) =>
      c.startsWith('token-batch')
    ).length

    // Zero history re-renders across all ticks (the counter was zeroed
    // after mount; memoized rows render exactly once, at mount).
    expect(historyRenderCount).toBe(0)
    // The streaming row re-rendered for every tick (5 ticks after the
    // counter reset; no initial render counted).
    expect(streamingRenderCount).toBe(5)
  })

  it('history rows stay frozen when a new message finalizes into the window', async () => {
    render(<WorstCaseHost />)
    chatMessageRenders.length = 0
    await act(async () => {
      useMessageStore.getState().setStreamingContent(CONV, '')
      useMessageStore.getState().setIsStreaming(CONV, false)
      useMessageStore.getState().addMessage(CONV, {
        id: 'final-1',
        conversation_id: CONV,
        sender_type: 'model',
        content: 'history message 4',
        created_at: new Date(2026, 0, 1, 0, 0, 30).toISOString(),
      })
    })

    // The newly appended row renders; the four existing rows do not.
    const historyRenderCount = chatMessageRenders.filter((c) =>
      c.startsWith('history message')
    ).length
    expect(historyRenderCount).toBe(1)
  })
})
