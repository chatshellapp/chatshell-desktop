import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AskUserOutput, getToolInputSummary, parseAskUserOutput } from '../tool-output-renderers'

const answered = [
  'The user answered your questions. Skipped questions are not consent: do not assume an answer for them.',
  JSON.stringify({
    status: 'answered',
    answers: [
      { id: 'database', question: 'Which database?', selected: ['SQLite'], note: 'for now' },
      { id: 'name', question: 'Project name?', skipped: true },
    ],
  }),
].join('\n')

describe('ask_user transcript output', () => {
  it('parses the JSON line after the instruction', () => {
    expect(parseAskUserOutput(answered)?.answers).toHaveLength(2)
    expect(parseAskUserOutput('not json')).toBeNull()
  })

  it('renders each question with its answer, note, or skipped marker', () => {
    render(<AskUserOutput toolOutput={answered} />)
    expect(screen.getByText('Which database?')).toBeInTheDocument()
    expect(screen.getByText('SQLite')).toBeInTheDocument()
    expect(screen.getByText('Note: for now')).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
  })

  it('explains a declined request', () => {
    render(<AskUserOutput toolOutput={'Dismissed.\n{"status":"declined"}'} />)
    expect(
      screen.getByText('The user dismissed the questions without answering.')
    ).toBeInTheDocument()
  })

  it('summarizes the call by question count', () => {
    expect(getToolInputSummary('ask_user', JSON.stringify({ questions: [{}, {}] }))).toBe(
      '2 question(s)'
    )
  })
})
