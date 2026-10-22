// Pending tool-approval state fed by `permission-requested` /
// `permission-resolved` backend events. Held in RAM only: grants never
// persist and never sync (a grant made on one device must not take
// effect on another).

import { create } from 'zustand'

export type PermissionTier = 'read' | 'write' | 'exec'

/** What an "allow for this session" answer covers; mirrors the backend
 * GrantScope, sent as the `grant` field of permission-requested. */
export type PermissionGrant =
  | { kind: 'bash'; bases: string[] }
  | { kind: 'tool'; tool: string }
  | { kind: 'server_tool'; server: string; tool: string }

export interface PermissionRequest {
  requestId: string
  conversationId: string
  toolName: string
  subject: string
  tier: PermissionTier
  grant: PermissionGrant | null
}

interface PermissionState {
  /** FIFO queue. rig executes tool calls concurrently, so several
   * approvals can be pending at once; the dialog always shows queue[0]. */
  pending: PermissionRequest[]
  show: (request: PermissionRequest) => void
  /** Remove one request by id (stale resolves cannot close a newer
   * prompt); with no id, clear the whole queue (generation stopped). */
  clear: (requestId?: string) => void
}

export const usePermissionStore = create<PermissionState>()((set) => ({
  pending: [],
  show: (request) => set((state) => ({ pending: [...state.pending, request] })),
  clear: (requestId) =>
    set((state) => ({
      pending: requestId ? state.pending.filter((request) => request.requestId !== requestId) : [],
    })),
}))
