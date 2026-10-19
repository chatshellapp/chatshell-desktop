import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, screen, act } from '@testing-library/react'
import { useInputResize, type UseInputResizeReturn } from '../useInputResize'

// jsdom has no ResizeObserver; capture instances so tests can drive callbacks
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

function triggerResize() {
  const observer = FakeResizeObserver.instances.at(-1)
  if (!observer) throw new Error('no ResizeObserver instance')
  observer.cb([], {} as ResizeObserver)
}

let latest: UseInputResizeReturn
let rootRect: { top: number; bottom: number; height: number }
let inputAreaHeight: number

function Host() {
  const r = useInputResize()
  latest = r
  return (
    <div ref={r.rootRef} data-testid="root">
      <div ref={r.inputAreaRef} data-testid="input-area" />
    </div>
  )
}

function setup() {
  const utils = render(<Host />)
  const root = screen.getByTestId('root')
  const inputArea = screen.getByTestId('input-area')
  rootRect = { top: 200, bottom: 600, height: 400 }
  inputAreaHeight = 0
  Object.defineProperty(root, 'getBoundingClientRect', {
    configurable: true,
    value: () => rootRect,
  })
  Object.defineProperty(inputArea, 'offsetHeight', {
    configurable: true,
    get: () => inputAreaHeight,
  })
  // The mount-time ResizeObserver already observes this element, so driving
  // its callback re-measures against the stubbed offsetHeight
  return utils
}

function mouseMove(clientY: number) {
  fireEvent(window, new MouseEvent('mousemove', { clientY }))
}

describe('useInputResize', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  it('starts with no measured height and no manual override', () => {
    setup()

    expect(latest.inputAreaHeight).toBe(0)
    expect(latest.manualInputHeight).toBeNull()
  })

  it('measures the input area height once the element reports one', () => {
    setup()

    inputAreaHeight = 160
    act(() => {
      triggerResize()
    })

    expect(latest.inputAreaHeight).toBe(160)
  })

  it('re-measures when the input area resizes', () => {
    setup()

    inputAreaHeight = 160
    act(() => {
      triggerResize()
    })
    inputAreaHeight = 220
    act(() => {
      triggerResize()
    })

    expect(latest.inputAreaHeight).toBe(220)
  })

  it('marks the drag with a global resize cursor', () => {
    setup()

    const event = { preventDefault: vi.fn() } as unknown as React.MouseEvent
    act(() => {
      latest.handleDragStart(event)
    })

    expect(event.preventDefault).toHaveBeenCalled()
    expect(document.body.style.cursor).toBe('ns-resize')
    expect(document.body.style.userSelect).toBe('none')
  })

  it('clamps manual heights between the initial height and half the root', () => {
    setup()

    // Establish the minimum height from a real measurement
    inputAreaHeight = 160
    act(() => {
      triggerResize()
    })

    const event = { preventDefault: vi.fn() } as unknown as React.MouseEvent
    act(() => {
      latest.handleDragStart(event)
    })

    // Root spans 200..600, so half is 200; anything above clamps there
    mouseMove(50)
    expect(latest.manualInputHeight).toBe(200)

    // Dragging far below the root clamps to the measured minimum
    mouseMove(590)
    expect(latest.manualInputHeight).toBe(160)
  })

  it('falls back to a 140px minimum before any measurement', () => {
    setup()

    const event = { preventDefault: vi.fn() } as unknown as React.MouseEvent
    act(() => {
      latest.handleDragStart(event)
    })

    mouseMove(590)
    expect(latest.manualInputHeight).toBe(140)
  })

  it('stops tracking the pointer on mouseup and clears the cursor', () => {
    setup()

    const event = { preventDefault: vi.fn() } as unknown as React.MouseEvent
    act(() => {
      latest.handleDragStart(event)
    })
    mouseMove(300) // somewhere in range

    fireEvent(window, new MouseEvent('mouseup'))
    expect(document.body.style.cursor).toBe('')

    const frozen = latest.manualInputHeight
    mouseMove(50)
    expect(latest.manualInputHeight).toBe(frozen)
  })

  it('clears the drag cursor when the component unmounts mid-drag', () => {
    const utils = setup()

    const event = { preventDefault: vi.fn() } as unknown as React.MouseEvent
    act(() => {
      latest.handleDragStart(event)
    })
    expect(document.body.style.cursor).toBe('ns-resize')

    utils.unmount()
    expect(document.body.style.cursor).toBe('')
  })
})
