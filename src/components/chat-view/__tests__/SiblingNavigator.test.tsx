import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SiblingNavigator } from '../SiblingNavigator'
import { useMessageStore, createDefaultConversationState } from '@/stores/message'
import type { Message } from '@/types'

const CONV = 'conv-1'
const message = (id: string, parent_id?: string): Message => ({
  id,
  conversation_id: CONV,
  parent_id,
  sender_type: 'user',
  content: id,
  created_at: '2026-01-01T00:00:00Z',
})

function seed(messages: Message[], groups: Record<string, string[]>) {
  useMessageStore.setState({
    conversationStates: {
      [CONV]: { ...createDefaultConversationState(), messages, siblingGroups: groups },
    },
  })
}

describe('SiblingNavigator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMessageStore.setState({ conversationStates: {} })
  })

  it('renders nothing for a message without siblings', () => {
    seed([message('u1')], {})
    const { container } = render(<SiblingNavigator conversationId={CONV} messageId="u1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the 1-based position among siblings and switches variants', () => {
    const setActiveBranch = vi.fn().mockResolvedValue(undefined)
    useMessageStore.setState({ setActiveBranch })

    seed(
      [message('u1'), message('u2')],
      { '': ['u1', 'u2'] } // first-turn sibling group
    )
    render(<SiblingNavigator conversationId={CONV} messageId="u2" />)

    expect(screen.getByText('2/2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous variant' }))
    expect(setActiveBranch).toHaveBeenCalledWith(CONV, 'u1')

    // At the tail of the group (the mocked switch does not move the
    // window), Previous stays enabled and Next is disabled.
    expect(screen.getByRole('button', { name: 'Previous variant' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next variant' })).toBeDisabled()
  })
})
