import { describe, it, expect, vi } from 'vitest'
import {
  requestTranscriptScroll,
  requestSentMessageScroll,
  subscribeTranscriptScroll,
  type TranscriptScrollRequest,
} from '../transcript-scroll'

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe('transcript scroll coordinator', () => {
  it('runs only the highest-priority request per conversation within one turn', async () => {
    const handler = vi.fn()
    const unsubscribe = subscribeTranscriptScroll('c1', handler)

    requestTranscriptScroll({
      conversationId: 'c1',
      reason: 'jumpToLatest',
      placement: { kind: 'end' },
    })
    requestTranscriptScroll({
      conversationId: 'c1',
      reason: 'search',
      messageId: 'hit',
      placement: { kind: 'center' },
    })
    requestTranscriptScroll({
      conversationId: 'c1',
      reason: 'send',
      messageId: 'sent',
      placement: { kind: 'top' },
    })
    await flushMicrotasks()

    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0][0] as TranscriptScrollRequest).reason).toBe('search')
    unsubscribe()
  })

  it('gives ties to the latest request and keeps conversations apart', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribeTranscriptScroll('c1', first)
    const unsubscribeSecond = subscribeTranscriptScroll('c2', second)

    requestTranscriptScroll({
      conversationId: 'c1',
      reason: 'send',
      messageId: 'a',
      placement: { kind: 'top' },
    })
    requestTranscriptScroll({
      conversationId: 'c1',
      reason: 'send',
      messageId: 'b',
      placement: { kind: 'top' },
    })
    requestTranscriptScroll({
      conversationId: 'c2',
      reason: 'jumpToLatest',
      placement: { kind: 'end' },
    })
    await flushMicrotasks()

    expect(first).toHaveBeenCalledTimes(1)
    expect(first.mock.calls[0][0].messageId).toBe('b')
    expect(second).toHaveBeenCalledTimes(1)
    expect(second.mock.calls[0][0].reason).toBe('jumpToLatest')
    unsubscribeFirst()
    unsubscribeSecond()
  })

  it('a later turn starts a fresh batch', async () => {
    const handler = vi.fn()
    const unsubscribe = subscribeTranscriptScroll('c1', handler)

    requestTranscriptScroll({
      conversationId: 'c1',
      reason: 'search',
      messageId: 'a',
      placement: { kind: 'center' },
    })
    await flushMicrotasks()
    requestTranscriptScroll({
      conversationId: 'c1',
      reason: 'jumpToLatest',
      placement: { kind: 'end' },
    })
    await flushMicrotasks()

    expect(handler.mock.calls.map((call) => call[0].reason)).toEqual(['search', 'jumpToLatest'])
    unsubscribe()
  })

  it('requests the sent user message at the top, and nothing for a non-user tail', async () => {
    const handler = vi.fn()
    const unsubscribe = subscribeTranscriptScroll('c1', handler)

    requestSentMessageScroll('c1', [{ id: 'a1', sender_type: 'assistant' }])
    await flushMicrotasks()
    expect(handler).not.toHaveBeenCalled()

    requestSentMessageScroll('c1', [
      { id: 'a1', sender_type: 'assistant' },
      { id: 'u2', sender_type: 'user' },
    ])
    await flushMicrotasks()
    expect(handler.mock.calls[0][0]).toMatchObject({
      reason: 'send',
      messageId: 'u2',
      placement: { kind: 'top' },
    })
    unsubscribe()
  })
})
