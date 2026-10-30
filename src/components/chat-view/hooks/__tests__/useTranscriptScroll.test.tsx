import { act, fireEvent, render } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Message } from '@/types'
import { requestTranscriptScroll } from '@/lib/transcript-scroll'
import {
  useTranscriptScroll,
  TOP_INSET_PX,
  type UseTranscriptScrollReturn,
} from '../useTranscriptScroll'

// ---------------------------------------------------------------------------
// Fake layout. jsdom has no layout, so rows, the container and the floor
// report geometry from this model: rows sit at fixed content offsets, the
// viewport starts at y=0, and scrollHeight is the rows plus the floor.
// ---------------------------------------------------------------------------
interface RowBox {
  top: number
  height: number
}

const BOTTOM_PADDING = 16

let geo: {
  scrollTop: number
  clientHeight: number
  rows: Map<string, RowBox>
}
let floorEl: HTMLElement | null

function floorHeight() {
  return parseFloat(floorEl?.style.height || '0') || 0
}
function rowsBottom() {
  let bottom = 0
  for (const box of geo.rows.values()) bottom = Math.max(bottom, box.top + box.height)
  return bottom + BOTTOM_PADDING
}
function scrollHeight() {
  return Math.max(geo.clientHeight, rowsBottom() + floorHeight())
}
function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 800,
    width: 800,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

const originalRect = Element.prototype.getBoundingClientRect
function installGeometry() {
  Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const id = this.dataset?.messageId
    if (id) {
      const box = geo.rows.get(id)
      if (box) return rect(box.top - geo.scrollTop, box.height)
    }
    if (this.dataset?.testid === 'floor') return rect(rowsBottom() - geo.scrollTop, floorHeight())
    if (this.dataset?.testid === 'container') return rect(0, geo.clientHeight)
    return rect(0, 0)
  }
}

function stubContainer(el: HTMLElement) {
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => geo.scrollTop,
    set: (v: number) => {
      geo.scrollTop = Math.min(Math.max(0, v), scrollHeight() - geo.clientHeight)
    },
  })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => geo.clientHeight })
  el.scrollTo = ((options: ScrollToOptions) => {
    el.scrollTop = options.top ?? 0
  }) as typeof el.scrollTo
}

// Deterministic animation frames (the self-scroll guard clears on them)
let rafQueue: FrameRequestCallback[]
function runFrames() {
  for (let i = 0; i < 4 && rafQueue.length > 0; i++) {
    const batch = rafQueue
    rafQueue = []
    for (const cb of batch) cb(0)
  }
}

// ResizeObserver: capture instances so tests can deliver layout changes
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
function layoutChanged() {
  act(() => {
    for (const observer of FakeResizeObserver.instances) {
      observer.cb([], observer as unknown as ResizeObserver)
    }
  })
}

// ---------------------------------------------------------------------------

const CONV = 'conv-1'
const msg = (id: string, sender_type: 'user' | 'assistant'): Message => ({
  id,
  conversation_id: CONV,
  sender_type,
  content: id,
  created_at: '2026-01-01T00:00:00Z',
})

let hook: UseTranscriptScrollReturn
const onNearTop = vi.fn()

function Harness({ messages, mountRows = true }: { messages: Message[]; mountRows?: boolean }) {
  hook = useTranscriptScroll({ conversationId: CONV, messages, onNearTop })
  return (
    <div
      data-testid="container"
      ref={(el) => {
        if (el) stubContainer(el)
        hook.containerRef.current = el
      }}
      onScroll={hook.handleScroll}
    >
      <div ref={hook.contentRef}>
        {mountRows && messages.map((m) => <div key={m.id} data-message-id={m.id} />)}
        <div
          data-testid="floor"
          ref={(el) => {
            floorEl = el
            hook.floorRef.current = el
          }}
        />
      </div>
    </div>
  )
}

/** Lay rows out top to bottom from y=16 with the given heights. */
function layout(heights: [string, number][], start = 16) {
  geo.rows.clear()
  let y = start
  for (const [id, height] of heights) {
    geo.rows.set(id, { top: y, height })
    y += height
  }
}

function userScroll(top: number) {
  runFrames()
  geo.scrollTop = top
  fireEvent.scroll(document.querySelector('[data-testid="container"]')!)
}

const flushMicrotasks = () => act(() => new Promise<void>((resolve) => queueMicrotask(resolve)))

describe('useTranscriptScroll', () => {
  beforeEach(() => {
    geo = { scrollTop: 0, clientHeight: 400, rows: new Map() }
    floorEl = null
    rafQueue = []
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafQueue.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    installGeometry()
    onNearTop.mockReset()
  })

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect
    vi.unstubAllGlobals()
  })

  const conversation = [
    msg('u1', 'user'),
    msg('a1', 'assistant'),
    msg('u2', 'user'),
    msg('a2', 'assistant'),
  ]

  it('opens with the last user message at the top, even when its reply is short', () => {
    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 80],
    ])
    render(<Harness messages={conversation} />)

    const u2 = geo.rows.get('u2')!
    expect(geo.scrollTop).toBe(u2.top - TOP_INSET_PX)
    // The floor made the position reachable despite the short reply
    expect(floorHeight()).toBeGreaterThan(0)
  })

  it('falls back to the last message without a user message, and stays put when empty', () => {
    layout([
      ['a1', 900],
      ['a2', 900],
    ])
    const { unmount } = render(
      <Harness messages={[msg('a1', 'assistant'), msg('a2', 'assistant')]} />
    )
    expect(geo.scrollTop).toBe(geo.rows.get('a2')!.top - TOP_INSET_PX)
    unmount()

    geo.scrollTop = 0
    layout([])
    render(<Harness messages={[]} />)
    expect(geo.scrollTop).toBe(0)
  })

  it('does not move the viewport while the reply below grows', () => {
    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 80],
    ])
    render(<Harness messages={conversation} />)
    const before = geo.scrollTop

    geo.rows.get('a2')!.height = 3000
    layoutChanged()

    expect(geo.scrollTop).toBe(before)
  })

  it('holds the reader’s top row while older rows prepend above it', () => {
    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 800],
    ])
    render(<Harness messages={conversation} />)
    userScroll(400) // reading inside a1
    expect(onNearTop).not.toHaveBeenCalled()

    // An older page lands above: every row shifts down by 500
    for (const box of geo.rows.values()) box.top += 500
    geo.rows.set('old', { top: 16, height: 500 })
    layoutChanged()

    expect(geo.scrollTop).toBe(900)
  })

  it('asks for older messages when the reader scrolls near the top', () => {
    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 800],
    ])
    render(<Harness messages={conversation} />)

    userScroll(50)

    expect(onNearTop).toHaveBeenCalled()
  })

  it('offers jump-to-latest when the end is out of view and jumps on request', async () => {
    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 2000],
    ])
    render(<Harness messages={conversation} />)
    expect(hook.showJumpToLatest).toBe(true)

    act(() => hook.jumpToLatest())
    await flushMicrotasks()

    expect(geo.scrollTop).toBe(scrollHeight() - geo.clientHeight)
    expect(hook.showJumpToLatest).toBe(false)
  })

  it('puts a sent message at the top', async () => {
    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 800],
    ])
    const { rerender } = render(<Harness messages={conversation} />)
    userScroll(100)

    const next = [...conversation, msg('u3', 'user')]
    geo.rows.set('u3', { top: 16 + 100 + 900 + 60 + 800, height: 60 })
    rerender(<Harness messages={next} />)
    requestTranscriptScroll({
      conversationId: CONV,
      reason: 'send',
      messageId: 'u3',
      placement: { kind: 'top' },
    })
    await flushMicrotasks()

    expect(geo.scrollTop).toBe(geo.rows.get('u3')!.top - TOP_INSET_PX)
  })

  it('a switched-to sibling takes the old sibling’s on-screen position', async () => {
    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 800],
    ])
    const { rerender } = render(<Harness messages={conversation} />)
    userScroll(800) // a1 is partly visible above u2
    const u2ScreenTop = geo.rows.get('u2')!.top - geo.scrollTop

    requestTranscriptScroll({
      conversationId: CONV,
      reason: 'branch',
      messageId: 'u2b',
      placement: { kind: 'swap', fromId: 'u2' },
    })
    await flushMicrotasks()

    // The reloaded window replaces the branch: u2b sits where u2 was in the
    // content, but the page above it grew by 300
    geo.rows.delete('u2')
    geo.rows.delete('a2')
    geo.rows.get('a1')!.height = 1200
    geo.rows.set('u2b', { top: 16 + 100 + 1200, height: 60 })
    geo.rows.set('a2b', { top: 16 + 100 + 1200 + 60, height: 800 })
    rerender(
      <Harness
        messages={[
          msg('u1', 'user'),
          msg('a1', 'assistant'),
          msg('u2b', 'user'),
          msg('a2b', 'assistant'),
        ]}
      />
    )

    expect(geo.rows.get('u2b')!.top - geo.scrollTop).toBe(u2ScreenTop)
  })

  // Regressions found by the real-data UI run (WKWebView).

  it('a browser clamp during the switch does not cancel the opening position', () => {
    const { rerender } = render(<Harness messages={[]} />)
    // The old rows leave, content shrinks, the browser clamps scrollTop:
    // a scroll event that is not the reader
    fireEvent.scroll(document.querySelector('[data-testid="container"]')!)

    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 800],
    ])
    rerender(<Harness messages={conversation} />)

    expect(geo.scrollTop).toBe(geo.rows.get('u2')!.top - TOP_INSET_PX)
  })

  it('real input cancels a pending opening position', () => {
    const { rerender } = render(<Harness messages={[]} />)
    fireEvent.wheel(document.querySelector('[data-testid="container"]')!)

    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 800],
    ])
    rerender(<Harness messages={conversation} />)

    expect(geo.scrollTop).toBe(0)
  })

  it('a row partly above the viewport growing does not move the row the reader sees', () => {
    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 800],
    ])
    render(<Harness messages={conversation} />)
    // The reader nudges the view: the anchor is re-recorded from what is on
    // screen (a1 still covers the top, u2 starts inside the viewport)
    userScroll(geo.scrollTop - 1)
    const u2Screen = geo.rows.get('u2')!.top - geo.scrollTop

    // a1, mostly above the viewport, resolves to its real (taller) height
    geo.rows.get('a1')!.height += 135
    geo.rows.get('u2')!.top += 135
    geo.rows.get('a2')!.top += 135
    layoutChanged()

    expect(geo.rows.get('u2')!.top - geo.scrollTop).toBe(u2Screen)
  })

  it('a short transcript still opens with the last user message at the top', () => {
    // Rows end well inside the viewport; the wrapper is one viewport tall
    layout([
      ['u1', 60],
      ['a1', 120],
      ['u2', 60],
    ])
    render(<Harness messages={conversation.slice(0, 3)} />)

    expect(geo.scrollTop).toBe(geo.rows.get('u2')!.top - TOP_INSET_PX)
  })

  it('retries a pending target until its row mounts, without any layout signal', () => {
    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 800],
    ])
    const { rerender } = render(<Harness messages={conversation} mountRows={false} />)
    expect(geo.scrollTop).toBe(0)

    // Rows mount a frame later (progressive mounting) with no size change
    // reported and the window unchanged
    rerender(<Harness messages={conversation} mountRows={true} />)
    act(() => runFrames())

    expect(geo.scrollTop).toBe(geo.rows.get('u2')!.top - TOP_INSET_PX)
  })

  it('keeps the opening hidden until the position held, then shows it', () => {
    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 800],
    ])
    render(<Harness messages={conversation} />)
    const content = hook.contentRef.current!
    expect(content.style.opacity).toBe('0')

    act(() => runFrames())

    expect(content.style.opacity).toBe('')
  })

  it('a reader scroll right after our own write is not mistaken for it', () => {
    layout([
      ['u1', 100],
      ['a1', 900],
      ['u2', 60],
      ['a2', 800],
    ])
    render(<Harness messages={conversation} />)
    // No frame has passed since the opening write; the reader scrolls up
    geo.scrollTop = 300
    fireEvent.scroll(document.querySelector('[data-testid="container"]')!)

    // A later layout change must hold the reader's position, not the opening
    geo.rows.get('a2')!.height += 50
    layoutChanged()

    expect(geo.scrollTop).toBe(300)
  })
})
