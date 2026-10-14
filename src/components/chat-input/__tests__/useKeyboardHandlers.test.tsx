import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'

import { useKeyboardHandlers } from '../useKeyboardHandlers'

// Newest-first sent-message history, as produced by ChatInput
const HISTORY = ['latest question', 'middle question', 'first question']

function Harness({
  history = HISTORY,
  onSubmit = vi.fn(),
}: {
  history?: string[]
  onSubmit?: () => void
}) {
  const [input, setInput] = useState('')
  const { handleKeyDown } = useKeyboardHandlers({
    input,
    setInput,
    onSubmit,
    inputHistory: history,
  })
  return (
    <textarea
      value={input}
      onChange={(e) => setInput(e.target.value)}
      onKeyDown={handleKeyDown}
      aria-label="input"
    />
  )
}

function pressArrow(key: 'ArrowUp' | 'ArrowDown', modifiers: object = {}) {
  return (input: HTMLElement) => {
    fireEvent.keyDown(input, { key, ...modifiers })
    return input
  }
}

const up = pressArrow('ArrowUp')
const down = pressArrow('ArrowDown')

function type(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } })
}

describe('useKeyboardHandlers input history', () => {
  it('recalls messages from newest to oldest on ArrowUp', () => {
    render(<Harness />)
    const input = screen.getByLabelText('input')

    up(input)
    expect(input).toHaveValue(HISTORY[0])

    up(input)
    expect(input).toHaveValue(HISTORY[1])

    up(input)
    expect(input).toHaveValue(HISTORY[2])

    // Clamped at the oldest entry
    up(input)
    expect(input).toHaveValue(HISTORY[2])
  })

  it('moves back toward newer on ArrowDown and clears past the newest', () => {
    render(<Harness />)
    const input = screen.getByLabelText('input')

    up(input)
    up(input)
    up(input)
    down(input)
    expect(input).toHaveValue(HISTORY[1])

    down(input)
    expect(input).toHaveValue(HISTORY[0])

    down(input)
    expect(input).toHaveValue('')
  })

  it('does not enter history browsing when input is non-empty', () => {
    render(<Harness />)
    const input = screen.getByLabelText('input')

    type(input, 'draft')
    up(input)
    expect(input).toHaveValue('draft')
  })

  it('exits browsing when the recalled text is edited', () => {
    render(<Harness />)
    const input = screen.getByLabelText('input')

    up(input)
    up(input)
    type(input, 'middle question!')
    expect(input).toHaveValue('middle question!')

    // Editing left browsing mode: Up no longer navigates from non-empty input
    up(input)
    expect(input).toHaveValue('middle question!')

    // After clearing, browsing restarts from the newest entry
    type(input, '')
    up(input)
    expect(input).toHaveValue(HISTORY[0])
  })

  it('exits browsing safely when the history array shifts behind a new entry', () => {
    // The global store emits a new array when a send lands elsewhere; the
    // old index now points at different text, so browsing exits instead of
    // showing a wrong entry, and arrows stay inert until the input clears
    const { rerender } = render(<Harness />)
    const input = screen.getByLabelText('input')

    up(input)
    up(input) // "middle question"
    rerender(<Harness history={['just sent elsewhere', ...HISTORY]} />)

    down(input)
    expect(input).toHaveValue(HISTORY[1])
    up(input)
    expect(input).toHaveValue(HISTORY[1])

    // Clearing lets Up recall the new newest entry
    type(input, '')
    up(input)
    expect(input).toHaveValue('just sent elsewhere')
  })

  it('ignores modifier-combined arrows', () => {
    render(<Harness />)
    const input = screen.getByLabelText('input')

    pressArrow('ArrowUp', { shiftKey: true })(input)
    expect(input).toHaveValue('')
    pressArrow('ArrowUp', { ctrlKey: true })(input)
    expect(input).toHaveValue('')
  })

  it('keeps Enter sending and Cmd+Enter inserting a newline', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    const input = screen.getByLabelText('input')

    type(input, 'hello')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue('hello') // submit does not clear in the harness

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1) // Cmd+Enter must not send
    await waitFor(() => expect(input).toHaveValue('hello\n'))
  })

  it('does nothing with an empty history', () => {
    render(<Harness history={[]} />)
    const input = screen.getByLabelText('input')

    up(input)
    expect(input).toHaveValue('')
    down(input)
    expect(input).toHaveValue('')
  })
})
