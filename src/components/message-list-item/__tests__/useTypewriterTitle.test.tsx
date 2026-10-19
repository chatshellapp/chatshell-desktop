import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTypewriterTitle } from '../useTypewriterTitle'

const PLACEHOLDER = 'New chat'
const TITLE = 'Hello World'

function setup(title: string, placeholder?: string) {
  return renderHook(
    (props: { title: string; placeholder?: string }) =>
      useTypewriterTitle(props.title, props.placeholder),
    { initialProps: { title, placeholder } }
  )
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('useTypewriterTitle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial title on mount', () => {
    const { result } = setup(TITLE, PLACEHOLDER)
    expect(result.current).toBe(TITLE)
  })

  it('applies ordinary title changes instantly without scheduling timers', () => {
    const { result, rerender } = setup('First', PLACEHOLDER)
    rerender({ title: 'Second', placeholder: PLACEHOLDER })
    expect(result.current).toBe('Second')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('applies the new title instantly while it is still the placeholder', () => {
    const { result, rerender } = setup(PLACEHOLDER, PLACEHOLDER)
    rerender({ title: 'New chat v2', placeholder: 'New chat v2' })
    expect(result.current).toBe('New chat v2')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('applies the new title instantly when no placeholder is configured', () => {
    const { result, rerender } = setup('Draft', undefined)
    rerender({ title: 'Final', placeholder: undefined })
    expect(result.current).toBe('Final')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('applies an empty title instantly instead of animating', () => {
    const { result, rerender } = setup(PLACEHOLDER, PLACEHOLDER)
    rerender({ title: '', placeholder: PLACEHOLDER })
    expect(result.current).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the display unchanged when the title does not change', () => {
    const { result, rerender } = setup(TITLE, PLACEHOLDER)
    rerender({ title: TITLE, placeholder: PLACEHOLDER })
    expect(result.current).toBe(TITLE)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('deletes the placeholder before typing the real title char by char', () => {
    const { result, rerender } = setup(PLACEHOLDER, PLACEHOLDER)
    rerender({ title: TITLE, placeholder: PLACEHOLDER })

    // The first delete tick runs synchronously when the change commits
    expect(result.current).toBe('New cha')

    advance(18)
    expect(result.current).toBe('New ch')

    advance(18 * 6)
    expect(result.current).toBe('')

    advance(18)
    expect(result.current).toBe('H')

    advance(15)
    expect(result.current).toBe('He')

    advance(15 * 9)
    expect(result.current).toBe(TITLE)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honors custom delete and type speeds', () => {
    const { result, rerender } = renderHook(
      (props: { title: string; placeholder?: string }) =>
        useTypewriterTitle(props.title, props.placeholder, 5, 3),
      { initialProps: { title: PLACEHOLDER, placeholder: PLACEHOLDER } }
    )
    rerender({ title: 'Go', placeholder: PLACEHOLDER })

    expect(result.current).toBe('New cha')

    advance(5 * 7)
    expect(result.current).toBe('')

    advance(5)
    expect(result.current).toBe('G')

    advance(3)
    expect(result.current).toBe('Go')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('snaps to the new title when the title changes mid-animation', () => {
    const { result, rerender } = setup(PLACEHOLDER, PLACEHOLDER)
    rerender({ title: TITLE, placeholder: PLACEHOLDER })
    advance(54)
    expect(result.current).toBe('New ')

    rerender({ title: 'Interrupted', placeholder: PLACEHOLDER })
    expect(result.current).toBe('Interrupted')

    // The abandoned animation's timers were cancelled
    advance(5000)
    expect(result.current).toBe('Interrupted')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears pending timers on unmount', () => {
    const { result, rerender, unmount } = setup(PLACEHOLDER, PLACEHOLDER)
    rerender({ title: TITLE, placeholder: PLACEHOLDER })
    advance(36)
    expect(result.current).toBe('New c')
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
