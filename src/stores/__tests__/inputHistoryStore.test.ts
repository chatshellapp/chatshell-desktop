import { describe, it, expect, beforeEach, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import { useInputHistoryStore } from '../inputHistoryStore'

describe('inputHistoryStore', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    // addEntry fire-and-forget calls .catch on the invoke result
    invokeMock.mockResolvedValue(undefined)
    useInputHistoryStore.setState({ history: [], isLoaded: false })
  })

  it('loads history from the backend once', async () => {
    invokeMock.mockResolvedValue(['a', 'b'])

    await useInputHistoryStore.getState().ensureLoaded()
    await useInputHistoryStore.getState().ensureLoaded()

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('get_prompt_history')
    expect(useInputHistoryStore.getState().history).toEqual(['a', 'b'])
  })

  it('retries loading after a failure', async () => {
    invokeMock.mockRejectedValueOnce(new Error('db locked'))
    invokeMock.mockResolvedValue(['a'])

    await useInputHistoryStore.getState().ensureLoaded()
    await useInputHistoryStore.getState().ensureLoaded()

    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(useInputHistoryStore.getState().history).toEqual(['a'])
  })

  it('prepends new entries optimistically and persists', () => {
    useInputHistoryStore.getState().addEntry('first')
    useInputHistoryStore.getState().addEntry('second')

    expect(useInputHistoryStore.getState().history).toEqual(['second', 'first'])
    expect(invokeMock).toHaveBeenCalledWith('add_prompt_history_entry', { content: 'second' })
  })

  it('moves duplicates to the front', () => {
    useInputHistoryStore.getState().addEntry('a')
    useInputHistoryStore.getState().addEntry('b')
    useInputHistoryStore.getState().addEntry('a')

    expect(useInputHistoryStore.getState().history).toEqual(['a', 'b'])
  })

  it('ignores empty and whitespace-only entries', () => {
    useInputHistoryStore.getState().addEntry('')
    useInputHistoryStore.getState().addEntry('   ')

    expect(useInputHistoryStore.getState().history).toEqual([])
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('keeps the optimistic update when persistence fails', () => {
    invokeMock.mockRejectedValue(new Error('boom'))
    useInputHistoryStore.getState().addEntry('kept')

    expect(useInputHistoryStore.getState().history).toEqual(['kept'])
  })
})
