import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIsMobile } from '../useMobile'

type ChangeListener = (event: { matches: boolean }) => void

const originalMatchMedia = window.matchMedia
let changeListeners: ChangeListener[]

function fireViewportChange() {
  changeListeners.forEach((listener) => listener({ matches: window.innerWidth < 768 }))
}

describe('useIsMobile', () => {
  beforeEach(() => {
    changeListeners = []
    window.matchMedia = ((query: string) => ({
      matches: window.innerWidth < 768,
      media: query,
      addEventListener: (_event: string, listener: ChangeListener) => {
        changeListeners.push(listener)
      },
      removeEventListener: (_event: string, listener: ChangeListener) => {
        changeListeners = changeListeners.filter((registered) => registered !== listener)
      },
    })) as typeof window.matchMedia
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('reports desktop for wide viewports', () => {
    window.innerWidth = 1024

    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(false)
    expect(changeListeners).toHaveLength(1)
  })

  it('reports mobile for narrow viewports', () => {
    window.innerWidth = 500

    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(true)
  })

  it('updates when the viewport crosses the breakpoint', () => {
    window.innerWidth = 1024
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    window.innerWidth = 500
    act(() => {
      fireViewportChange()
    })

    expect(result.current).toBe(true)

    window.innerWidth = 1200
    act(() => {
      fireViewportChange()
    })

    expect(result.current).toBe(false)
  })

  it('stops listening after unmount', () => {
    window.innerWidth = 1024
    const { result, unmount } = renderHook(() => useIsMobile())

    unmount()

    expect(changeListeners).toHaveLength(0)

    window.innerWidth = 500
    fireViewportChange()

    expect(result.current).toBe(false)
  })
})
