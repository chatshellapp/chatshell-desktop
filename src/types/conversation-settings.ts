// Conversation-level parameter settings
// These override assistant preset parameters when set

export interface ModelParameterOverrides {
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
}

export interface ConversationSettings {
  // Use provider defaults - when true, no parameters are sent to API
  useProviderDefaults: boolean

  // Parameter overrides (for custom mode)
  useCustomParameters: boolean
  parameterOverrides: ModelParameterOverrides

  // Context settings
  // null = unlimited (send all history)
  // number = max number of messages to include
  contextMessageCount: number | null

  // Which preset is currently selected (for UI display)
  // null when using default or custom parameters
  selectedPresetId: string | null
}

// Default conversation settings
export const createDefaultConversationSettings = (): ConversationSettings => ({
  useProviderDefaults: true, // Default: use provider's default settings
  useCustomParameters: false,
  parameterOverrides: {},
  contextMessageCount: null,
  selectedPresetId: null,
})

// Parameter limits for validation
export const PARAMETER_LIMITS = {
  temperature: { min: 0, max: 2, step: 0.1, defaultValue: 0.7 },
  max_tokens: { min: 1, max: 128000, step: 1, defaultValue: 4096 },
  top_p: { min: 0, max: 1, step: 0.01, defaultValue: 0.8 },
  frequency_penalty: { min: -2, max: 2, step: 0.1, defaultValue: 0 },
  presence_penalty: { min: -2, max: 2, step: 0.1, defaultValue: 0 },
} as const

export const CONTEXT_COUNT_OPTIONS = [
  { value: null, label: 'Unlimited' },
  { value: 5, label: '5 messages' },
  { value: 10, label: '10 messages' },
  { value: 20, label: '20 messages' },
  { value: 50, label: '50 messages' },
  { value: 100, label: '100 messages' },
] as const

