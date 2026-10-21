// Pending tool-approval state fed by `permission-requested` /
// `permission-resolved` backend events. Held in RAM only: grants never
// persist and never sync (a grant made on one device must not take
// effect on another).

import { create } from 'zustand'

export type PermissionTier = 'read' | 'write' | 'exec'

export interface PermissionRequest {
  requestId: string
  conversationId: string
  toolName: string
  subject: string
  tier: PermissionTier
  allowSession: boolean
}

interface PermissionState {
  pending: PermissionRequest | null
  show: (request: PermissionRequest) => void
  /** Clear only when the id matches (stale resolves can't close a newer prompt). */
  clear: (requestId?: string) => void
}

export const usePermissionStore = create<PermissionState>()((set, get) => ({
  pending: null,
  show: (request) => set({ pending: request }),
  clear: (requestId) => {
    const pending = get().pending
    if (requestId && pending?.requestId !== requestId) return
    set({ pending: null })
  },
}))
