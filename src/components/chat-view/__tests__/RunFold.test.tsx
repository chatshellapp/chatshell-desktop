import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import i18n from '@/lib/i18n'
import { RunFold, savedRunStatus } from '../RunFold'
import { liveRunFoldKey, useRunFoldStore } from '@/stores/runFoldStore'

void i18n

function renderFold(props: Partial<Parameters<typeof RunFold>[0]> = {}) {
  return render(
    <RunFold foldKey="m1" live={false} status="completed" steps={3} failedTools={0} {...props}>
      <p>process body</p>
    </RunFold>
  )
}

describe('RunFold', () => {
  beforeEach(() => {
    useRunFoldStore.setState({ overrides: {} })
  })

  it('closes a finished run and shows its summary', () => {
    renderFold()

    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('3 steps')).toBeInTheDocument()
    expect(screen.queryByText('process body')).not.toBeInTheDocument()
  })

  it('opens a live run', () => {
    renderFold({ live: true, status: 'running', foldKey: liveRunFoldKey('c1') })

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('process body')).toBeInTheDocument()
  })

  it('shows failed tools without expanding', () => {
    renderFold({ status: 'failed', failedTools: 1 })

    expect(screen.getByText('Run failed')).toBeInTheDocument()
    expect(screen.getByText('1 tool failed')).toBeInTheDocument()
    expect(screen.queryByText('process body')).not.toBeInTheDocument()
  })

  it('keeps a manual toggle for the session', () => {
    const { unmount } = renderFold()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('process body')).toBeInTheDocument()

    // Lazy rows remount; the override survives
    unmount()
    renderFold()
    expect(screen.getByText('process body')).toBeInTheDocument()
  })

  it('carries a toggle on the live run over to the saved reply', () => {
    renderFold({ live: true, status: 'running', foldKey: liveRunFoldKey('c1') })
    fireEvent.click(screen.getByRole('button')) // collapse while live

    act(() => useRunFoldStore.getState().adoptLiveOverride('c1', 'saved-1'))

    expect(useRunFoldStore.getState().overrides).toEqual({ 'saved-1': false })
  })

  it('leaves an untouched live run to the default once saved', () => {
    act(() => useRunFoldStore.getState().adoptLiveOverride('c1', 'saved-1'))
    expect(useRunFoldStore.getState().overrides).toEqual({})
  })
})

describe('savedRunStatus', () => {
  it('prefers the session outcome, then cancelled tool calls', () => {
    expect(savedRunStatus({ kind: 'failed', error: 'x' }, ['success'])).toBe('failed')
    expect(savedRunStatus({ kind: 'stopped' }, ['success'])).toBe('stopped')
    expect(savedRunStatus(undefined, ['success', 'cancelled'])).toBe('stopped')
    expect(savedRunStatus(undefined, ['success', 'error'])).toBe('completed')
  })
})
