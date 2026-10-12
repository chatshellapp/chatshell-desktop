import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useAttachmentBlobStore } from '../attachmentBlobStore'
import type { BlobFetchStatus } from '@/types/generated/BlobFetchStatus'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

const mockInvoke = vi.mocked(invoke)

const status = (content_hash: string, s: string): BlobFetchStatus => ({
  content_hash,
  status: s,
})

describe('useAttachmentBlobStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAttachmentBlobStore.setState({ states: {} })
  })

  // Runs first on purpose: `activeConversationId` is module state that
  // survives between tests, so the no-op case must be observed cold.
  it('refreshAfterMerge is a no-op without an open conversation', async () => {
    await useAttachmentBlobStore.getState().refreshAfterMerge()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('maps backend statuses onto the tri-state machine', async () => {
    mockInvoke.mockResolvedValue([
      status('aaa', 'cached'),
      status('bbb', 'fetched'),
      status('ccc', 'gone'),
      status('ddd', 'skipped'),
    ])

    await useAttachmentBlobStore.getState().fetchForConversation('c1')

    expect(mockInvoke).toHaveBeenCalledWith('fetch_conversation_blobs', {
      conversationId: 'c1',
    })
    expect(useAttachmentBlobStore.getState().states).toEqual({
      aaa: 'cached',
      bbb: 'cached',
      ccc: 'gone',
      ddd: 'missing',
    })
  })

  it('replaces state per conversation open instead of accumulating', async () => {
    mockInvoke.mockResolvedValue([status('aaa', 'cached')])
    await useAttachmentBlobStore.getState().fetchForConversation('c1')
    expect(useAttachmentBlobStore.getState().states.aaa).toBe('cached')

    mockInvoke.mockResolvedValue([status('bbb', 'gone')])
    await useAttachmentBlobStore.getState().fetchForConversation('c2')
    expect(useAttachmentBlobStore.getState().states).toEqual({ bbb: 'gone' })
  })

  it('refreshAfterMerge re-runs the pass for the open conversation (self-heal)', async () => {
    mockInvoke.mockResolvedValueOnce([status('ccc', 'gone')])
    await useAttachmentBlobStore.getState().fetchForConversation('c1')
    expect(useAttachmentBlobStore.getState().states.ccc).toBe('gone')

    // A merge brought the blob in: gone becomes cached.
    mockInvoke.mockResolvedValueOnce([status('ccc', 'fetched')])
    await useAttachmentBlobStore.getState().refreshAfterMerge()
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(useAttachmentBlobStore.getState().states.ccc).toBe('cached')
  })

  // Real-device S9 finding 2026-09-12: a pass that materializes blobs also
  // repairs the referencing rows' storage_path, so chat-view must re-resolve
  // already-rendered message resources. The boolean return is that contract.
  it('fetchForConversation reports whether the pass materialized anything', async () => {
    mockInvoke.mockResolvedValue([status('aaa', 'cached'), status('bbb', 'skipped')])
    await expect(
      useAttachmentBlobStore.getState().fetchForConversation('c-materialized')
    ).resolves.toBe(false)

    mockInvoke.mockResolvedValue([
      status('aaa', 'cached'),
      status('bbb', 'fetched'),
      status('ccc', 'gone'),
    ])
    await expect(useAttachmentBlobStore.getState().fetchForConversation('c-quiet')).resolves.toBe(
      true
    )
  })

  it('fetchForConversation resolves false when the pass throws', async () => {
    mockInvoke.mockRejectedValue(new Error('ladder said NeedPassphrase'))
    await expect(useAttachmentBlobStore.getState().fetchForConversation('c-error')).resolves.toBe(
      false
    )
  })
})
