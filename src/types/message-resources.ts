// Message resources type is generated from Rust models (src-tauri/src/models/message_resources.rs)
// via ts-rs. Run `pnpm types:generate` in src-tauri to regenerate.

export type { MessageResources } from './generated/MessageResources'

import type { UserAttachment } from './generated/UserAttachment'
import type { ContextEnrichment } from './generated/ContextEnrichment'
import type { ProcessStep } from './generated/ProcessStep'

// ==========================================================================
// LEGACY COMPATIBILITY (deprecated - use specific types above)
// ==========================================================================

// @deprecated Use UserAttachment, ContextEnrichment, or ProcessStep instead
export type Attachment = UserAttachment | ContextEnrichment | ProcessStep
