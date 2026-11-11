import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PendingMessageItem } from '../PendingMessageItem'

describe('PendingMessageItem', () => {
  it('shows only the remove action for a message waiting its turn', () => {
    const onRemove = vi.fn()
    render(<PendingMessageItem content="later" onRetry={vi.fn()} onRemove={onRemove} />)

    expect(screen.getByText('later')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry sending' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from queue' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('shows the error and a retry action for a message that failed to send', () => {
    const onRetry = vi.fn()
    render(
      <PendingMessageItem
        content="later"
        error="Attachments are too large to send"
        onRetry={onRetry}
        onRemove={vi.fn()}
      />
    )

    expect(screen.getByText('Attachments are too large to send')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry sending' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
