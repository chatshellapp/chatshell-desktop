// Model (LLM) types
export interface Model {
  id: string
  name: string
  provider_id: string // Foreign key to providers table
  model_id: string
  description?: string
  is_starred: boolean // For quick access in chat interface
  is_deleted?: boolean // Soft delete flag
  created_at: string
  updated_at: string
}

export interface CreateModelRequest {
  name: string
  provider_id: string
  model_id: string
  description?: string
  is_starred?: boolean
}

// ==========================================================================
// MODEL PARAMETERS - Reusable LLM generation configuration
// ==========================================================================

/**
 * Model parameters for LLM configuration.
 * Can be used independently (for direct model calls) or embedded in an Assistant.
 * These parameters control the behavior of the language model during generation.
 */
export interface ModelParameters {
  /** Controls randomness in output (0.0 = deterministic, 2.0 = very random) */
  temperature?: number
  /** Maximum number of tokens to generate */
  max_tokens?: number
  /** Nucleus sampling: only consider tokens with top_p cumulative probability */
  top_p?: number
  /** Penalize tokens based on their frequency in the text so far */
  frequency_penalty?: number
  /** Penalize tokens that have already appeared in the text */
  presence_penalty?: number
  /** Additional provider-specific parameters */
  additional_params?: Record<string, unknown>
}

// Model info types
export interface ModelInfo {
  id: string
  name: string
  description?: string
  context_length?: number
  pricing?: ModelPricing
}

export interface ModelPricing {
  prompt?: number
  completion?: number
}

