import type { UserAttachment } from './attachment'
import type { ContextEnrichment } from './context'
import type { ProcessStep } from './process-step'

// ==========================================================================
// MESSAGE RESOURCES (Combined Response)
// ==========================================================================

// All resources associated with a message
export interface MessageResources {
  attachments: UserAttachment[]
  contexts: ContextEnrichment[]
  steps: ProcessStep[]
}

// ==========================================================================
// LEGACY COMPATIBILITY (deprecated - use specific types above)
// ==========================================================================

// @deprecated Use UserAttachment, ContextEnrichment, or ProcessStep instead
export type Attachment = UserAttachment | ContextEnrichment | ProcessStep

