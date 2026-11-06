import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AutoReviewMarker } from '../AutoReviewMarker'
import {
  COMPOSE_SUBMIT_EVENT,
  useAutoReviewStore,
  type AutoReviewDecidedEvent,
  type ComposeSubmitDetail,
} from '@/stores/autoReviewStore'
import { useMessageStore } from '@/stores/message'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

function decided(overrides: Partial<AutoReviewDecidedEvent>): AutoReviewDecidedEvent {
  return {
    conversation_id: 'conv-1',
    tool_call_id: 'call-1',
    decision_id: 'dec-1',
    kind: 'allowed',
    tool_name: 'bash',
    subject: 'curl https://example.com',
    risk_level: 'medium',
    rationale: null,
    suggest_mode_switch: false,
    ...overrides,
  }
}

describe('AutoReviewMarker', () => {
  beforeEach(() => {
    invoke.mockReset()
    useAutoReviewStore.getState().reset()
    useMessageStore.setState({ conversationStates: {} })
  })

  it('renders nothing for a tool call without a judgment', () => {
    const { container } = render(<AutoReviewMarker toolCallId="call-x" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders each marker kind with its copy', () => {
    const cases: [AutoReviewDecidedEvent, RegExp][] = [
      [decided({ kind: 'allowed', risk_level: 'high' }), /auto-approved · high risk/i],
      [decided({ kind: 'denied', rationale: 'Uploads a key.' }), /auto-blocked: uploads a key/i],
      [decided({ kind: 'failed', risk_level: null }), /review could not finish/i],
      [decided({ kind: 'jail_denied', risk_level: null }), /blocked by the sandbox/i],
    ]
    for (const [event, text] of cases) {
      useAutoReviewStore.getState().reset()
      useAutoReviewStore.getState().receive(event)
      const { unmount } = render(<AutoReviewMarker toolCallId="call-1" />)
      expect(screen.getByText(text)).toBeInTheDocument()
      expect(screen.getByTestId('auto-review-marker')).toHaveAttribute('data-kind', event.kind)
      unmount()
    }
  })

  it('offers run-anyway only on denials, failures, and sandbox blocks', () => {
    useAutoReviewStore.getState().receive(decided({ kind: 'allowed' }))
    const { rerender } = render(<AutoReviewMarker toolCallId="call-1" />)
    expect(screen.queryByRole('button', { name: /run anyway/i })).not.toBeInTheDocument()
    useAutoReviewStore.getState().receive(decided({ kind: 'jail_denied' }))
    rerender(<AutoReviewMarker toolCallId="call-1" />)
    expect(screen.getByRole('button', { name: /run outside sandbox/i })).toBeInTheDocument()
  })

  it('runs anyway: arms the override, then asks the composer to send the retry', async () => {
    invoke.mockResolvedValue({ toolName: 'bash', subject: 'rm -rf ~/old', unsandboxed: false })
    const requests: ComposeSubmitDetail[] = []
    const listener = (event: Event) =>
      requests.push((event as CustomEvent<ComposeSubmitDetail>).detail)
    window.addEventListener(COMPOSE_SUBMIT_EVENT, listener)
    useAutoReviewStore.getState().receive(decided({ kind: 'denied', rationale: 'Not requested.' }))
    render(<AutoReviewMarker toolCallId="call-1" />)
    fireEvent.click(screen.getByRole('button', { name: /run anyway/i }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('auto_review_run_anyway', {
        conversationId: 'conv-1',
        decisionId: 'dec-1',
      })
    )
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toEqual({ conversationId: 'conv-1', text: 'Run it anyway: rm -rf ~/old' })
    // Used: the button is gone and the marker notes the override.
    expect(screen.queryByRole('button', { name: /run anyway/i })).not.toBeInTheDocument()
    expect(screen.getByText(/you ran it anyway/i)).toBeInTheDocument()
    window.removeEventListener(COMPOSE_SUBMIT_EVENT, listener)
  })

  it('disables run-anyway while the conversation is streaming', () => {
    useMessageStore.getState().getConversationState('conv-1')
    useMessageStore.setState((state) => ({
      conversationStates: {
        ...state.conversationStates,
        'conv-1': { ...state.conversationStates['conv-1'], isStreaming: true },
      },
    }))
    useAutoReviewStore.getState().receive(decided({ kind: 'denied' }))
    render(<AutoReviewMarker toolCallId="call-1" />)
    expect(screen.getByRole('button', { name: /run anyway/i })).toBeDisabled()
  })
})
