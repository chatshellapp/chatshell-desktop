// Model (LLM) types are generated from Rust models via ts-rs.
// Run `pnpm types:generate` in src-tauri to regenerate.

export type { Model } from './generated/Model'
export type { CreateModelRequest } from './generated/CreateModelRequest'

// ==========================================================================
// MODEL PARAMETERS - Reusable LLM generation configuration
// ==========================================================================

// Model parameters for LLM configuration.
// Can be used independently (for direct model calls) or embedded in an Assistant.
export type { ModelParameters } from './generated/ModelParameters'

// Model info types
export type { ModelInfo } from './generated/ModelInfo'
export type { ModelPricing } from './generated/ModelPricing'

// Model capabilities resolved from models.dev data.
// `null` means unknown (assume capable); `false` means confirmed unsupported.
export type { ModelCapabilities } from './generated/ModelCapabilities'
