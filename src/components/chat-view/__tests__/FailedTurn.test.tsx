import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from '@/lib/i18n'
import { FailedTurn, RunOutcomeFooter } from '../FailedTurn'

void i18n

const handlers = () => ({
  onRetry: vi.fn(),
  onDismiss: vi.fn(),
  onShowPreviousReply: vi.fn(),
})

describe('FailedTurn', () => {
  it('shows the failure, a one-line error and the turn actions', () => {
    const h = handlers()
    render(
      <FailedTurn
        failedTurn={{ kind: 'failed', error: '[HTTP 429] slow down', previousReplyId: null }}
        disabled={false}
        {...h}
      />
    )

    expect(screen.getByText('Send failed')).toBeInTheDocument()
    expect(screen.getByText('slow down')).toBeInTheDocument()
    expect(screen.queryByText('Show previous reply')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(h.onRetry).toHaveBeenCalledTimes(1)
    expect(h.onDismiss).toHaveBeenCalledTimes(1)
  })

  it('offers the previous reply after a failed regenerate', () => {
    const h = handlers()
    render(
      <FailedTurn
        failedTurn={{ kind: 'failed', error: 'boom', previousReplyId: 'reply-1' }}
        disabled={false}
        {...h}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show previous reply' }))
    expect(h.onShowPreviousReply).toHaveBeenCalledTimes(1)
  })

  it('describes a stop before any output and disables retry while streaming', () => {
    render(
      <FailedTurn
        failedTurn={{ kind: 'stopped', error: null, previousReplyId: null }}
        disabled={true}
        {...handlers()}
      />
    )

    expect(screen.getByText('Stopped before a response')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/ })).toBeDisabled()
  })
})

describe('RunOutcomeFooter', () => {
  it('marks a failed run with its error and retries', () => {
    const onRetry = vi.fn()
    render(<RunOutcomeFooter outcome={{ kind: 'failed', error: 'reset' }} onRetry={onRetry} />)

    expect(screen.getByText('Run failed')).toBeInTheDocument()
    expect(screen.getByText('reset')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('marks a stopped run', () => {
    render(<RunOutcomeFooter outcome={{ kind: 'stopped' }} onRetry={vi.fn()} />)

    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })
})
