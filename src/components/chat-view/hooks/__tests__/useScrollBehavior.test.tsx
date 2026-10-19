import { render, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useScrollBehavior, type UseScrollBehaviorReturn } from '../useScrollBehavior'
import { useMessageStore, createDefaultConversationState } from '@/stores/message'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Deterministic animation-frame driver: the hook dedupes and chains rAF
// callbacks, so tests control exactly when frames run.
// ---------------------------------------------------------------------------
type RafCallback = (time: number) => void
let rafQueue: { id: number; cb: RafCallback }[]
let rafNextId: number

function runFrame() {
  const batch = rafQueue
  rafQueue = []
  for (const { cb } of batch) cb(0)
}

function drainFrames(max = 200) {
  let guard = 0
  while (rafQueue.length > 0 && guard < max) {
    runFrame()
    guard++
  }
}

// ---------------------------------------------------------------------------
// ResizeObserver is not implemented in jsdom; capture instances so tests can
// deliver synthetic entries.
// ---------------------------------------------------------------------------
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
    FakeResizeObserver.instances.push(this)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function triggerResizeEntry(width: number) {
  const observer = FakeResizeObserver.instances.at(-1)
  if (!observer) throw new Error('no ResizeObserver instance')
  observer.cb([{ contentRect: { width } } as unknown as ResizeObserverEntry], {} as ResizeObserver)
}

interface ScrollMetrics {
  scrollTop?: number
  scrollHeight?: number
  clientHeight?: number
}

interface MetricsStub {
  setScrollTop: (value: number) => void
  writes: number[]
}
/** Replace jsdom's zero layout with controllable accessors. Programmatic
 * writes to scrollTop are recorded so tests can count pins. */
function stubMetrics(
  el: HTMLElement,
  { scrollTop = 0, scrollHeight = 1000, clientHeight = 400 }: ScrollMetrics = {}
): MetricsStub {
  let top = scrollTop
  const writes: number[] = []
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v
      writes.push(v)
    },
  })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
  return {
    setScrollTop: (v: number) => {
      top = v
    },
    writes,
  }
}

interface HostProps {
  messagesLength?: number
  conversationId?: string | null
  onNearTop?: () => void
  attachContent?: boolean
}

const CONV = 'conv-scroll'
const OTHER = 'conv-other'

let latest: UseScrollBehaviorReturn
let metrics: MetricsStub
let contentRect: { left: number; width: number; height: number }

function Host({
  messagesLength = 0,
  conversationId = null as string | null,
  onNearTop,
  attachContent = true,
}: HostProps) {
  const sb = useScrollBehavior({ messagesLength, conversationId, onNearTop })
  latest = sb
  return (
    <div ref={sb.messagesContainerRef} data-testid="container" onScroll={sb.handleScroll}>
      {attachContent ? (
        <div ref={sb.messagesContentRef} data-testid="content">
          <div ref={sb.messagesEndRef} />
        </div>
      ) : null}
    </div>
  )
}

function setup(props: HostProps = {}) {
  // Prime with a different messagesLength so the rerender below re-runs the
  // layout effects once the jsdom layout stubs are in place.
  const utils = render(<Host {...props} messagesLength={(props.messagesLength ?? 0) + 1} />)
  const container = utils.getByTestId('container')
  metrics = stubMetrics(container)
  const content = utils.queryByTestId('content')
  contentRect = { left: 100, width: 400, height: 800 }
  if (content) {
    Object.defineProperty(content, 'getBoundingClientRect', {
      configurable: true,
      value: () => contentRect,
    })
  }
  // Re-run the layout effects against the freshly stubbed elements: the
  // initial pass saw null layout values in jsdom.
  act(() => {
    utils.rerender(<Host {...props} />)
  })
  return utils
}

/** Drain the open/append settle loops so later assertions see only the pins
 * the test itself triggers. */
function settleMount() {
  drainFrames()
  metrics.writes.length = 0
  metrics.setScrollTop(0)
}

function seedStore(id: string, overrides: Record<string, unknown> = {}) {
  const state = createDefaultConversationState()
  Object.assign(state, overrides)
  act(() => {
    useMessageStore.setState((prev) => ({
      conversationStates: { ...prev.conversationStates, [id]: state },
    }))
  })
}

describe('useScrollBehavior', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    rafQueue = []
    rafNextId = 1
    vi.stubGlobal('requestAnimationFrame', (cb: RafCallback) => {
      rafQueue.push({ id: rafNextId, cb })
      return rafNextId++
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const idx = rafQueue.findIndex((entry) => entry.id === id)
      if (idx >= 0) rafQueue.splice(idx, 1)
    })
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    FakeResizeObserver.instances = []
    useMessageStore.setState({
      conversationStates: {},
      isSending: false,
      error: null,
      onNewConversationCreated: undefined,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('bottom detection', () => {
    it('starts in follow mode pinned to the bottom', () => {
      setup()

      expect(latest.isAtBottom).toBe(true)
      // First settle step runs synchronously in the layout effect
      expect(metrics.writes).toContain(1000)
    })

    it('flips isAtBottom to false only after the scroll debounce settles far from the bottom', () => {
      const utils = setup()
      const container = utils.getByTestId('container')
      settleMount()

      metrics.setScrollTop(0) // 1000 - 0 - 400 = 600px from the bottom
      fireEvent.scroll(container)
      expect(latest.isAtBottom).toBe(true) // debounce not elapsed yet

      act(() => {
        vi.advanceTimersByTime(150)
      })
      expect(latest.isAtBottom).toBe(false)
    })

    it('stays at the bottom when the user rests within 100px of the end', () => {
      const utils = setup()
      const container = utils.getByTestId('container')
      settleMount()
      latest.setIsAtBottom(false)

      metrics.setScrollTop(950) // 1000 - 950 - 400 < 100
      fireEvent.scroll(container)
      act(() => {
        vi.advanceTimersByTime(150)
      })
      expect(latest.isAtBottom).toBe(true)
    })

    it('re-enters follow mode and re-pins when the conversation switches', () => {
      const utils = setup()
      settleMount()
      metrics.setScrollTop(0)
      fireEvent.scroll(utils.getByTestId('container'))
      act(() => {
        vi.advanceTimersByTime(150)
      })
      expect(latest.isAtBottom).toBe(false)

      metrics.writes.length = 0
      act(() => {
        utils.rerender(<Host conversationId={CONV} />)
      })

      expect(latest.isAtBottom).toBe(true)
      expect(metrics.writes).toContain(1000)
    })
  })

  describe('upward paging', () => {
    it('fires onNearTop when a user scroll lands within 200px of the top', () => {
      const onNearTop = vi.fn()
      const utils = setup({ onNearTop })
      const container = utils.getByTestId('container')
      settleMount()

      metrics.setScrollTop(100)
      fireEvent.scroll(container)
      metrics.setScrollTop(100)
      fireEvent.scroll(container)
      expect(onNearTop).toHaveBeenCalledTimes(2)

      metrics.setScrollTop(300)
      fireEvent.scroll(container)
      expect(onNearTop).toHaveBeenCalledTimes(2)

      act(() => {
        vi.advanceTimersByTime(150)
      })
    })

    it('does not fire onNearTop while the user is resting mid-list', () => {
      const onNearTop = vi.fn()
      const utils = setup({ onNearTop })
      settleMount()

      metrics.setScrollTop(500)
      fireEvent.scroll(utils.getByTestId('container'))
      act(() => {
        vi.advanceTimersByTime(150)
      })

      expect(onNearTop).not.toHaveBeenCalled()
    })
  })

  describe('self-scroll guard', () => {
    it('classifies scroll events from own writes as non-user input until two frames pass', () => {
      const onNearTop = vi.fn()
      const utils = setup({ onNearTop, conversationId: CONV })
      const container = utils.getByTestId('container')
      settleMount()

      // Trigger one programmatic pin via the streaming follow-along path
      seedStore(CONV, { isStreaming: true })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame() // followTail pins and marks the write
      expect(metrics.writes).toEqual([1000])

      // A scroll event arriving inside the 2-frame mark window is ignored,
      // even though the position is near the top
      metrics.setScrollTop(10)
      fireEvent.scroll(container)
      expect(onNearTop).not.toHaveBeenCalled()

      // Guard clears after two frames; the same event is now user input
      runFrame()
      runFrame()
      fireEvent.scroll(container)
      expect(onNearTop).toHaveBeenCalledTimes(1)

      act(() => {
        vi.advanceTimersByTime(150)
      })
    })

    it('never treats own pins as user scrolling (no lock after pin)', () => {
      const utils = setup({ conversationId: CONV })
      settleMount()

      seedStore(CONV, { isWaitingForAI: true })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([1000])

      // No user-scroll lock: a subsequent append effect may still settle
      metrics.writes.length = 0
      metrics.setScrollTop(0)
      act(() => {
        utils.rerender(<Host conversationId={CONV} messagesLength={1} />)
      })
      expect(metrics.writes).toContain(1000)

      act(() => {
        vi.advanceTimersByTime(150)
      })
    })
  })

  describe('streaming follow-along', () => {
    it('pins to the bottom on store updates while the conversation streams', () => {
      const utils = setup({ conversationId: CONV })
      settleMount()

      seedStore(CONV, { isStreaming: true })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([1000])
      void utils
    })

    it('dedupes pins to one per frame across bursts of store updates', () => {
      setup({ conversationId: CONV })
      settleMount()

      seedStore(CONV, { isStreaming: true })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([1000]) // exactly one pin for the frame

      // Next burst schedules the next frame's pin as usual
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([1000, 1000])
    })

    it('follows while waiting for the first AI token', () => {
      setup({ conversationId: CONV })
      settleMount()

      seedStore(CONV, { isWaitingForAI: true })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([1000])
    })

    it('stops following once the user has scrolled away from the bottom', () => {
      setup({ conversationId: CONV })
      settleMount()
      act(() => {
        latest.setIsAtBottom(false)
      })

      seedStore(CONV, { isStreaming: true })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([])

      // Re-entering follow mode resumes the tail
      act(() => {
        latest.setIsAtBottom(true)
      })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([1000])
    })

    it('stops following while the user is actively scrolling', () => {
      const utils = setup({ conversationId: CONV })
      const container = utils.getByTestId('container')
      settleMount()

      metrics.setScrollTop(0)
      fireEvent.scroll(container) // user-scroll lock engages

      seedStore(CONV, { isStreaming: true })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([])

      act(() => {
        vi.advanceTimersByTime(150)
      })
    })

    it('ignores updates about other conversations', () => {
      setup({ conversationId: CONV })
      settleMount()

      seedStore(OTHER, { isStreaming: true })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([])
    })

    it('ignores updates when the tracked conversation is not streaming', () => {
      setup({ conversationId: CONV })
      settleMount()

      seedStore(CONV, { isStreaming: false, isWaitingForAI: false })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([])
    })

    it('resubscribes when the conversation id changes', () => {
      const utils = setup({ conversationId: CONV })
      settleMount()

      act(() => {
        utils.rerender(<Host conversationId={OTHER} />)
      })
      drainFrames()
      metrics.writes.length = 0
      metrics.setScrollTop(0)

      seedStore(CONV, { isStreaming: true })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([]) // old conversation no longer followed

      seedStore(OTHER, { isStreaming: true })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      runFrame()
      expect(metrics.writes).toEqual([1000])
    })

    it('cancels pending follow frames on unmount', () => {
      const utils = setup({ conversationId: CONV })
      settleMount()

      seedStore(CONV, { isStreaming: true })
      act(() => {
        useMessageStore.setState({ isSending: false })
      })
      utils.unmount()

      // Draining after unmount must not throw on the cancelled handle
      expect(() => drainFrames()).not.toThrow()
    })
  })

  describe('append settle', () => {
    it('re-pins briefly when a message is appended while following', () => {
      const utils = setup({ conversationId: CONV, messagesLength: 2 })
      settleMount()

      metrics.writes.length = 0
      act(() => {
        utils.rerender(<Host conversationId={CONV} messagesLength={3} />)
      })
      expect(metrics.writes).toContain(1000) // first settle step is synchronous

      // The append settle keeps re-pinning for a handful of frames
      runFrame()
      expect(metrics.writes.filter((v) => v === 1000).length).toBeGreaterThan(1)

      act(() => {
        vi.advanceTimersByTime(150)
      })
    })

    it('skips the append settle while the user is scrolling', () => {
      const utils = setup({ conversationId: CONV, messagesLength: 2 })
      const container = utils.getByTestId('container')
      settleMount()

      metrics.setScrollTop(600)
      fireEvent.scroll(container) // user-scroll lock engages

      metrics.writes.length = 0
      act(() => {
        utils.rerender(<Host conversationId={CONV} messagesLength={3} />)
      })
      expect(metrics.writes).toEqual([])

      act(() => {
        vi.advanceTimersByTime(150)
      })
    })

    it('the settle loop yields as soon as the user scrolls away', () => {
      const utils = setup({ messagesLength: 1 })
      settleMount()

      metrics.writes.length = 0
      act(() => {
        utils.rerender(<Host messagesLength={2} />)
      })
      const pinsAfterAppend = metrics.writes.length
      expect(pinsAfterAppend).toBeGreaterThan(0)

      act(() => {
        latest.setIsAtBottom(false)
      })
      runFrame()
      runFrame()
      runFrame()
      expect(metrics.writes.length).toBe(pinsAfterAppend) // loop stopped
    })
  })

  describe('scroll-to-bottom button position', () => {
    it('falls back to 50% when there is no content element', () => {
      setup({ attachContent: false })
      expect(latest.buttonLeft).toBe('50%')
    })

    it('centers over the content column from its bounding rect', () => {
      setup()
      expect(latest.buttonLeft).toBe(300) // 100 + 400 / 2
    })

    it('recomputes on window resize', () => {
      const utils = setup()
      contentRect.left = 40

      fireEvent(window, new Event('resize'))

      expect(latest.buttonLeft).toBe(240) // 40 + 400 / 2
      void utils
    })

    it('recomputes when the content width changes via ResizeObserver', () => {
      setup()

      act(() => {
        contentRect.left = 100
        contentRect.width = 500
        triggerResizeEntry(500)
      })

      expect(latest.buttonLeft).toBe(350) // 100 + 500 / 2
    })

    it('ignores ResizeObserver entries whose width has not changed', () => {
      setup()

      // Height-only growth must not recompute the position
      triggerResizeEntry(400)
      contentRect.left = 999
      act(() => {
        useMessageStore.setState({ isSending: false })
      })

      expect(latest.buttonLeft).toBe(300)
    })
  })
})
