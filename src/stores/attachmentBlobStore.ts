import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'
import type { BlobFetchStatus } from '@/types/generated/BlobFetchStatus'

/**
 * Tri-state lifecycle of one attachment's bytes (plan §5): `missing` is
 * fetchable, `downloading` is in flight, `cached` never refetches, and
 * `gone` stops retrying until the next sync merge (self-heal).
 */
export type AttachmentBlobState = 'missing' | 'downloading' | 'cached' | 'gone'

interface AttachmentBlobStoreState {
  /** Attachment state per BLAKE3 content hash. Absent = missing. */
  states: Record<string, AttachmentBlobState>
}

interface AttachmentBlobStoreActions {
  /**
   * Fetch-on-open: run one backend blob pass for the conversation and fold
   * the per-hash statuses into the store. Remembered so a sync-merged event
   * can re-run it for the open conversation (self-heal for gone entries).
   * Resolves to whether the pass MATERIALIZED anything — a repair rewrites
   * referencing rows' `storage_path` (iOS-authored rows carry absolute
   * sandbox paths), so callers must re-resolve already-rendered resources.
   */
  fetchForConversation: (conversationId: string) => Promise<boolean>
  /** Re-run the pass for the last fetched conversation; no-op if none. */
  refreshAfterMerge: () => Promise<boolean>
}

let activeConversationId: string | null = null
async function runPass(
  conversationId: string,
  set: (partial: Partial<AttachmentBlobStoreState>) => void
): Promise<boolean> {
  const statuses = await invoke<BlobFetchStatus[]>('fetch_conversation_blobs', {
    conversationId,
  })
  set({
    states: statuses.reduce<Record<string, AttachmentBlobState>>((acc, s) => {
      // cached|fetched -> cached (bytes are local either way);
      // skipped stays missing: over-budget entries remain clickable.
      acc[s.content_hash] =
        s.status === 'gone' ? 'gone' : s.status === 'skipped' ? 'missing' : 'cached'
      return acc
    }, {}),
  })
  // 'fetched' = bytes materialized this pass AND referencing rows repaired —
  // resources resolved before the pass may still hold the stale paths.
  return statuses.some((s) => s.status === 'fetched')
}

let inFlight: Promise<boolean> | null = null
export const useAttachmentBlobStore = create<AttachmentBlobStoreState & AttachmentBlobStoreActions>(
  (set) => ({
    states: {},

    fetchForConversation: async (conversationId: string): Promise<boolean> => {
      if (inFlight && activeConversationId === conversationId) return inFlight
      activeConversationId = conversationId
      set({ states: {} })
      inFlight = runPass(conversationId, set)
        .catch((err) => {
          logger.error('Attachment blob fetch failed:', err)
          return false
        })
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },

    refreshAfterMerge: async (): Promise<boolean> => {
      // Self-heal: a merge may have brought previously-gone blobs into the
      // container, so drop the terminal states and re-run the pass.
      const conversationId = activeConversationId
      if (!conversationId) return false
      return useAttachmentBlobStore.getState().fetchForConversation(conversationId)
    },
  })
)
