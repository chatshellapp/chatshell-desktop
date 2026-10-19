import { describe, it, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useState } from 'react'
import { MessageList } from '../MessageList'
import type { Message } from '@/types'
import type { DisplayInfo } from '../hooks'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

const DISPLAY: DisplayInfo = { displayName: 'Model', senderType: 'model' }
const getDisplayInfo = () => DISPLAY
const getMessageDisplayInfo = () => DISPLAY
const noop = () => {}
const EMPTY_REFS = { current: null }

function makeMessages(conv: string, n: number): Message[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${conv}-${i}`,
    conversation_id: conv,
    sender_type: i % 2 === 0 ? 'user' : 'model',
    content: `message ${conv} ${i}`,
    created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
  }))
}

let switchTo: ((conv: string, revealAll: boolean) => void) | null = null

function Host() {
  const [state, setState] = useState(() => ({
    conv: 'a',
    msgs: makeMessages('a', 40),
    revealAll: false,
  }))
  switchTo = (conv, revealAll) => setState({ conv, msgs: makeMessages(conv, 40), revealAll })
  return (
    <MessageList
      conversationId={state.conv}
      messages={state.msgs}
      lastUserMessage={null}
      showStreamingMessage={false}
      messageResources={{}}
      urlStatuses={{}}
      apiError={null}
      isLoadingOlder={false}
      revealAll={state.revealAll}
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

async function nextFrame() {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 50)
    await promise
  })
}

async function flushProgressive(container: HTMLElement) {
  for (let guard = 0; guard < 20; guard++) {
    const before = container.querySelectorAll('[data-message-id]').length
    await nextFrame()
    const after = container.querySelectorAll('[data-message-id]').length
    if (before === after && after > 0) return after
  }
  return container.querySelectorAll('[data-message-id]').length
}

describe('MessageList conversation switch mounting', () => {
  it('mounts the initial tail synchronously on first render', () => {
    const { container } = render(<Host />)
    // Fresh mount (app start): the first chunk is part of the first commit.
    expect(container.querySelectorAll('[data-message-id]').length).toBe(16)
  })

  it('switch commit unmounts only; content arrives on the next frame', async () => {
    const utils = render(<Host />)
    await flushProgressive(utils.container)
    expect(utils.container.querySelectorAll('[data-message-id]').length).toBe(40)

    // Re-entry with a cached window: the switch commit must not mount heavy
    // rows (that froze the previous conversation's frame on screen). It
    // unmounts the outgoing rows and paints the loading line instead.
    act(() => {
      switchTo!('b', false)
    })
    expect(utils.container.querySelectorAll('[data-message-id]').length).toBe(0)
    expect(utils.container.textContent).toContain('loadingMessages')

    // The growth effect mounts the tail chunk on the following frame.
    await nextFrame()
    const mounted = utils.container.querySelectorAll('[data-message-id]').length
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThanOrEqual(40)
    expect(utils.container.textContent).not.toContain('loadingMessages')

    await flushProgressive(utils.container)
    expect(utils.container.querySelectorAll('[data-message-id]').length).toBe(40)
  })

  it('revealAll mounts the whole window in the switch commit (search jump)', () => {
    const utils = render(<Host />)
    act(() => {
      switchTo!('c', true)
    })
    // The search-jump path needs the target row in the DOM synchronously.
    expect(utils.container.querySelectorAll('[data-message-id]').length).toBe(40)
  })
})
