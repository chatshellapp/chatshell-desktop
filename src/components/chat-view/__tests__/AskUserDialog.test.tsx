import { describe, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AskUserDialog, buildAnswers } from '../AskUserDialog'
import { useAskUserStore, type AskUserQuestion } from '@/stores/askUserStore'

// Radix radio/checkbox measure themselves with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

const questions: AskUserQuestion[] = [
  {
    id: 'database',
    question: 'Which database should the service use?',
    header: 'Database',
    multi: false,
    options: [
      { id: 'o1', label: 'PostgreSQL', description: 'Server, scales', recommended: true },
      { id: 'o2', label: 'SQLite', description: 'Embedded', recommended: false },
    ],
  },
  { id: 'name', question: 'What should the project be called?', multi: false, options: [] },
]

function show(requestId = 'q1') {
  useAskUserStore.getState().show({ requestId, conversationId: 'c1', questions })
}

describe('buildAnswers', () => {
  it('returns one trimmed answer per question, null for empty text', () => {
    expect(
      buildAnswers(questions, {
        database: { selected: ['o2'], text: '  ' },
        name: { selected: [], text: ' atlas ' },
      })
    ).toEqual([
      { question_id: 'database', selected: ['o2'], text: null },
      { question_id: 'name', selected: [], text: 'atlas' },
    ])
    expect(buildAnswers(questions, {})).toEqual([
      { question_id: 'database', selected: [], text: null },
      { question_id: 'name', selected: [], text: null },
    ])
  })
})

describe('AskUserDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAskUserStore.getState().reset()
    invoke.mockResolvedValue(true)
  })

  it('renders nothing without a request', () => {
    const { container } = render(<AskUserDialog />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows questions, options and the recommended badge', () => {
    show()
    render(<AskUserDialog />)
    expect(screen.getByText('The assistant has 2 questions')).toBeInTheDocument()
    expect(screen.getByText('Which database should the service use?')).toBeInTheDocument()
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getByText('Embedded')).toBeInTheDocument()
  })

  it('submits the selected option and typed answers', async () => {
    show()
    render(<AskUserDialog />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled())
    fireEvent.click(screen.getByRole('radio', { name: /SQLite/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'What should the project be called?' }), {
      target: { value: 'atlas' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resolve_ask_user', {
        requestId: 'q1',
        action: 'submit',
        answers: [
          { question_id: 'database', selected: ['o2'], text: null },
          { question_id: 'name', selected: [], text: 'atlas' },
        ],
      })
    )
    expect(useAskUserStore.getState().pending).toHaveLength(0)
  })

  it('skip declines without answers', async () => {
    show('q2')
    render(<AskUserDialog />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resolve_ask_user', {
        requestId: 'q2',
        action: 'decline',
        answers: null,
      })
    )
  })

  it('discuss keeps the answers given so far', async () => {
    show('q3')
    render(<AskUserDialog />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Chat about this instead' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('radio', { name: /PostgreSQL/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Chat about this instead' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('resolve_ask_user', {
        requestId: 'q3',
        action: 'discuss',
        answers: [
          { question_id: 'database', selected: ['o1'], text: null },
          { question_id: 'name', selected: [], text: null },
        ],
      })
    )
  })

  it('buttons stay disarmed briefly so a keystroke cannot answer', () => {
    show('q4')
    render(<AskUserDialog />)
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })
})
