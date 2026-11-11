import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import i18n from '@/lib/i18n'
import { WaitingForResponse, formatElapsed } from '../WaitingForResponse'

void i18n

describe('formatElapsed', () => {
  it('shows seconds, then minutes and padded seconds', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(59)).toBe('59s')
    expect(formatElapsed(65)).toBe('1:05')
    expect(formatElapsed(600)).toBe('10:00')
  })
})

describe('WaitingForResponse', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the waiting copy and counts elapsed time', () => {
    vi.useFakeTimers()
    render(<WaitingForResponse />)

    expect(screen.getByText('Waiting for response')).toBeInTheDocument()
    expect(screen.getByText('0s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.getByText('3s')).toBeInTheDocument()
  })

  it('counts from startedAt so a remount keeps the elapsed time', () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    vi.advanceTimersByTime(42_000)
    render(<WaitingForResponse startedAt={startedAt} />)

    expect(screen.getByText('42s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.getByText('44s')).toBeInTheDocument()
  })
})
