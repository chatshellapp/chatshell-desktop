import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'
import { useMessageResources } from '../useMessageResources'
import type { Message, MessageResources } from '@/types'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const NOW = '2026-01-01T00:00:00Z'

function makeMessage(id: string): Message {
  return { id, sender_type: 'user', content: `content ${id}`, created_at: NOW }
}

const m1 = makeMessage('m1')
const m2 = makeMessage('m2')
const m3 = makeMessage('m3')

const resourcesFor = (id: string): MessageResources => ({
  attachments: [
    {
      type: 'file',
      id: `att-${id}`,
      file_name: 'a.txt',
      file_size: 1,
      mime_type: 'text/plain',
      storage_path: `/store/${id}.txt`,
      content_hash: 'h',
      created_at: NOW,
    },
  ],
  contexts: [],
  steps: [],
})

interface HookProps {
  messages: Message[]
  attachmentStatus: string
  attachmentRefreshKey: number
}

function renderResources(props: Partial<HookProps> = {}) {
  const initial: HookProps = {
    messages: [],
    attachmentStatus: 'idle',
    attachmentRefreshKey: 0,
    ...props,
  }
  return renderHook((next: HookProps = initial) => useMessageResources(next), {
    initialProps: initial,
  })
}

describe('useMessageResources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue({})
  })

  it('fetches nothing for an empty message window', () => {
    renderResources()

    expect(invoke).not.toHaveBeenCalled()
  })

  it('bulk-fetches resources for every message on first load', async () => {
    vi.mocked(invoke).mockResolvedValue({ m1: resourcesFor('m1') })
    const { result } = renderResources({ messages: [m1, m2] })

    await waitFor(() => expect(result.current.m1).toEqual(resourcesFor('m1')))
    expect(invoke).toHaveBeenCalledWith('get_message_resources_batch', {
      messageIds: ['m1', 'm2'],
    })
    expect(result.current.m2).toBeUndefined()
  })

  it('caches resolved and known-empty messages across identical windows', async () => {
    vi.mocked(invoke).mockResolvedValue({ m1: resourcesFor('m1') })
    const { result, rerender } = renderResources({ messages: [m1, m2] })
    await waitFor(() => expect(result.current.m1).toBeDefined())
    expect(invoke).toHaveBeenCalledTimes(1)

    // Same ids, new array identity: m1 is cached, m2 is known empty
    rerender({ messages: [m1, m2], attachmentStatus: 'idle', attachmentRefreshKey: 0 })
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
  })

  it('fetches only newly appended messages', async () => {
    vi.mocked(invoke).mockResolvedValue({})
    const { rerender } = renderResources({ messages: [m1] })
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))

    rerender({ messages: [m1, m2, m3], attachmentStatus: 'idle', attachmentRefreshKey: 0 })
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))

    expect(vi.mocked(invoke).mock.calls[1][1]).toEqual({
      messageIds: ['m2', 'm3'],
    })
  })

  it('re-fetches the latest message when attachment processing completes', async () => {
    vi.mocked(invoke).mockResolvedValue({})
    const { rerender } = renderResources({ messages: [m1, m2] })
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))

    rerender({ messages: [m1, m2], attachmentStatus: 'complete', attachmentRefreshKey: 0 })
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))

    expect(vi.mocked(invoke).mock.calls[1][1]).toEqual({ messageIds: ['m2'] })
  })

  it('re-resolves everything when the refresh key is bumped', async () => {
    vi.mocked(invoke).mockResolvedValue({})
    const { rerender } = renderResources({ messages: [m1, m2] })
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))

    rerender({ messages: [m1, m2], attachmentStatus: 'idle', attachmentRefreshKey: 1 })
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))

    expect(vi.mocked(invoke).mock.calls[1][1]).toEqual({ messageIds: ['m1', 'm2'] })
  })

  it('keeps previous resources when the batch fetch fails', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ m1: resourcesFor('m1') })
    const { result, rerender } = renderResources({ messages: [m1] })
    await waitFor(() => expect(result.current.m1).toBeDefined())

    vi.mocked(invoke).mockRejectedValueOnce(new Error('db locked'))
    rerender({ messages: [m1, m2], attachmentStatus: 'idle', attachmentRefreshKey: 0 })
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))

    expect(result.current.m1).toEqual(resourcesFor('m1'))
    expect(result.current.m2).toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to fetch message resources (batch)',
      expect.any(Error)
    )
  })
})
