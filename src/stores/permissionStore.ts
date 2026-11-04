// Pending tool-approval state fed by `permission-requested` /
// `permission-resolved` backend events. Held in RAM only: grants never
// persist and never sync (a grant made on one device must not take
// effect on another).

import { create } from 'zustand'

export type PermissionTier = 'read' | 'write' | 'exec'

/** What an approval covers; mirrors the backend GrantScope. Sent as the
 * `grant` (allow for this session) and `remember` (remember on this
 * device) fields of permission-requested. Bash `bases` are segment keys:
 * the base command, plus its first subcommand for tools like git/npm. */
export type PermissionGrant =
  | { kind: 'bash'; bases: string[] }
  | { kind: 'tool'; tool: string }
  | { kind: 'server_tool'; server: string; tool: string }
  | { kind: 'directory'; tool: string; dir: string }

/** Why a prompt was forced past session grants; mirrors the backend
 * ForcedPromptKind. Forced prompts never carry a grant. */
export type PermissionWarningKind = 'security' | 'unparsed' | 'network' | 'private_network'

export interface PermissionWarning {
  kind: PermissionWarningKind
  detail: string
}

export interface PermissionRequest {
  requestId: string
  conversationId: string
  toolName: string
  subject: string
  tier: PermissionTier
  grant: PermissionGrant | null
  warning?: PermissionWarning | null
  /** Scope persisted by "remember on this device"; null when the prompt
   * cannot be remembered (forced prompts, relative paths). */
  remember?: PermissionGrant | null
}

interface PermissionState {
  /** FIFO queue across conversations: each stream has at most one pending
   * approval, but several conversations can stream at once. The dialog
   * always shows queue[0]. */
  pending: PermissionRequest[]
  show: (request: PermissionRequest) => void
  /** Remove one request by id (stale resolves cannot close a newer prompt). */
  remove: (requestId: string) => void
  /** Remove every request of one conversation (its generation stopped);
   * other conversations' pending requests stay visible and answerable. */
  clearConversation: (conversationId: string) => void
  /** Drop the whole queue. */
  reset: () => void
}

export const usePermissionStore = create<PermissionState>()((set) => ({
  pending: [],
  show: (request) => set((state) => ({ pending: [...state.pending, request] })),
  remove: (requestId) =>
    set((state) => ({
      pending: state.pending.filter((request) => request.requestId !== requestId),
    })),
  clearConversation: (conversationId) =>
    set((state) => ({
      pending: state.pending.filter((request) => request.conversationId !== conversationId),
    })),
  reset: () => set({ pending: [] }),
}))
