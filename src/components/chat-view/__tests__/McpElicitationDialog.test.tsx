import { describe, beforeEach, afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { McpElicitationDialog, buildContent } from '../McpElicitationDialog'
import { useElicitationStore, type ElicitationSchema } from '@/stores/elicitationStore'

// The Radix checkbox measures itself with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const invoke = vi.fn()
const openUrl = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...args: unknown[]) => openUrl(...args),
}))

const schema: ElicitationSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    age: { type: 'integer', title: 'Age' },
    plan: { type: 'string', title: 'Plan', enum: ['free', 'pro'] },
    notify: { type: 'boolean', title: 'Notify me' },
  },
  required: ['name'],
}

describe('buildContent', () => {
  it('parses numbers, keeps booleans, and drops empty optional fields', () => {
    expect(buildContent(schema, { name: ' Ada ', age: '36', plan: '', notify: true })).toEqual({
      content: { name: 'Ada', age: 36, notify: true },
    })
  })

  it('reports a missing required field or a bad number', () => {
    expect(buildContent(schema, { name: '', age: '', plan: '', notify: false })).toEqual({
      error: 'name',
    })
    expect(buildContent(schema, { name: 'Ada', age: '1.5', plan: '', notify: false })).toEqual({
      error: 'age',
    })
  })
})

describe('McpElicitationDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useElicitationStore.getState().reset()
    invoke.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing without a request', () => {
    const { container } = render(<McpElicitationDialog />)
    expect(container).toBeEmptyDOMElement()
  })

  it('submits a filled form as accept with typed content', async () => {
    useElicitationStore.getState().show({
      requestId: 'e1',
      serverName: 'GitHub',
      mode: 'form',
      message: 'Who are you?',
      schema,
    })
    render(<McpElicitationDialog />)
    expect(screen.getByText('GitHub needs your input')).toBeInTheDocument()
    expect(screen.getByText('Who are you?')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText(/Age/), { target: { value: '36' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resolve_mcp_elicitation', {
        requestId: 'e1',
        action: 'accept',
        content: { name: 'Ada', age: 36, notify: false },
      })
    )
    expect(useElicitationStore.getState().pending).toHaveLength(0)
  })

  it('blocks submit until required fields are filled', async () => {
    useElicitationStore.getState().show({
      requestId: 'e2',
      serverName: 'GitHub',
      mode: 'form',
      message: 'Who are you?',
      schema,
    })
    render(<McpElicitationDialog />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Name')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('declines without sending content', async () => {
    useElicitationStore.getState().show({
      requestId: 'e3',
      serverName: 'GitHub',
      mode: 'form',
      message: 'Who are you?',
      schema,
    })
    render(<McpElicitationDialog />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resolve_mcp_elicitation', {
        requestId: 'e3',
        action: 'decline',
        content: null,
      })
    )
  })

  it('opens a URL request only when the user clicks', async () => {
    useElicitationStore.getState().show({
      requestId: 'e4',
      serverName: 'Linear',
      mode: 'url',
      message: 'Authorize access',
      url: 'https://linear.app/oauth/authorize?x=1',
    })
    render(<McpElicitationDialog />)
    expect(screen.getByText('Opens a page on linear.app in your browser')).toBeInTheDocument()
    expect(openUrl).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open link' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }))
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith('https://linear.app/oauth/authorize?x=1')
    )
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resolve_mcp_elicitation', {
        requestId: 'e4',
        action: 'accept',
        content: null,
      })
    )
  })
})
