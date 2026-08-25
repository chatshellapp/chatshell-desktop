// Conversation settings types are generated from Rust models
// (src-tauri/src/models/conversation_settings.rs) via ts-rs.
// Run `pnpm types:generate` in src-tauri to regenerate.

import type { ModelParameterOverrides } from './generated/ModelParameterOverrides'
import type { PromptMode } from './generated/PromptMode'
export type { ModelParameterOverrides } from './generated/ModelParameterOverrides'
export type { PromptMode } from './generated/PromptMode'

// Wire format (snake_case) re-exported under its historical alias
import type { ConversationSettings as ConversationSettingsResponse } from './generated/ConversationSettings'
export type { ConversationSettingsResponse }

// Frontend view model (camelCase) kept hand-written; mirrors the wire shape above
export interface ConversationSettings {
  // Conversation ID this settings belongs to
  conversationId: string

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

  // System prompt settings
  // 'none' = no override (use assistant's system prompt)
  // 'existing' = use a selected existing prompt
  // 'custom' = use custom content
  systemPromptMode: PromptMode
  selectedSystemPromptId: string | null
  customSystemPrompt: string | null

  // User prompt settings
  // 'none' = no user prompt
  // 'existing' = use a selected existing prompt
  // 'custom' = use custom content
  userPromptMode: PromptMode
  selectedUserPromptId: string | null
  customUserPrompt: string | null

  // MCP server IDs enabled for this conversation
  enabledMcpServerIds: string[]

  // Skill IDs enabled for this conversation
  enabledSkillIds: string[]

  // Working directory for bash tool (overrides default home directory)
  workingDirectory: string | null
}

// Request to update conversation settings (all fields optional for partial updates).
// The snake_case wire request is generated at ./generated/UpdateConversationSettingsRequest
// (not re-exported); the camelCase input view below is what UI code builds.
export interface UpdateConversationSettingsRequest {
  useProviderDefaults?: boolean
  useCustomParameters?: boolean
  parameterOverrides?: ModelParameterOverrides
  contextMessageCount?: number | null
  selectedPresetId?: string | null
  systemPromptMode?: PromptMode
  selectedSystemPromptId?: string | null
  customSystemPrompt?: string | null
  userPromptMode?: PromptMode
  selectedUserPromptId?: string | null
  customUserPrompt?: string | null
  enabledMcpServerIds?: string[]
  enabledSkillIds?: string[]
  workingDirectory?: string | null
}

// Convert backend response to frontend format
export function fromBackendSettings(response: ConversationSettingsResponse): ConversationSettings {
  return {
    conversationId: response.conversation_id,
    useProviderDefaults: response.use_provider_defaults,
    useCustomParameters: response.use_custom_parameters,
    parameterOverrides: response.parameter_overrides,
    contextMessageCount: response.context_message_count,
    selectedPresetId: response.selected_preset_id,
    systemPromptMode: response.system_prompt_mode,
    selectedSystemPromptId: response.selected_system_prompt_id,
    customSystemPrompt: response.custom_system_prompt,
    userPromptMode: response.user_prompt_mode,
    selectedUserPromptId: response.selected_user_prompt_id,
    customUserPrompt: response.custom_user_prompt,
    enabledMcpServerIds: response.enabled_mcp_server_ids ?? [],
    enabledSkillIds: response.enabled_skill_ids ?? [],
    workingDirectory: response.working_directory ?? null,
  }
}

// Convert frontend request to backend format (snake_case)
export function toBackendRequest(req: UpdateConversationSettingsRequest): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (req.useProviderDefaults !== undefined) result.use_provider_defaults = req.useProviderDefaults
  if (req.useCustomParameters !== undefined) result.use_custom_parameters = req.useCustomParameters
  if (req.parameterOverrides !== undefined) result.parameter_overrides = req.parameterOverrides
  if (req.contextMessageCount !== undefined) result.context_message_count = req.contextMessageCount
  if (req.selectedPresetId !== undefined) result.selected_preset_id = req.selectedPresetId
  if (req.systemPromptMode !== undefined) result.system_prompt_mode = req.systemPromptMode
  if (req.selectedSystemPromptId !== undefined)
    result.selected_system_prompt_id = req.selectedSystemPromptId
  if (req.customSystemPrompt !== undefined) result.custom_system_prompt = req.customSystemPrompt
  if (req.userPromptMode !== undefined) result.user_prompt_mode = req.userPromptMode
  if (req.selectedUserPromptId !== undefined)
    result.selected_user_prompt_id = req.selectedUserPromptId
  if (req.customUserPrompt !== undefined) result.custom_user_prompt = req.customUserPrompt
  if (req.enabledMcpServerIds !== undefined) result.enabled_mcp_server_ids = req.enabledMcpServerIds
  if (req.enabledSkillIds !== undefined) result.enabled_skill_ids = req.enabledSkillIds
  if (req.workingDirectory !== undefined) result.working_directory = req.workingDirectory

  return result
}

// Default conversation settings
export const createDefaultConversationSettings = (
  conversationId: string,
  enabledMcpServerIds: string[] = [],
  enabledSkillIds: string[] = []
): ConversationSettings => ({
  conversationId,
  useProviderDefaults: true, // Default: use provider's default settings
  useCustomParameters: false,
  parameterOverrides: {},
  contextMessageCount: null,
  selectedPresetId: null,
  // Prompt defaults - 'none' means use assistant's prompts
  systemPromptMode: 'none',
  selectedSystemPromptId: null,
  customSystemPrompt: null,
  userPromptMode: 'none',
  selectedUserPromptId: null,
  customUserPrompt: null,
  enabledMcpServerIds,
  enabledSkillIds,
  workingDirectory: null,
})

// Parameter limits for validation
export const PARAMETER_LIMITS = {
  temperature: { min: 0, max: 2, step: 0.1, defaultValue: 0.7 },
  max_tokens: { min: 1, max: 128000, step: 1, defaultValue: 4096 },
  top_p: { min: 0, max: 1, step: 0.01, defaultValue: 0.8 },
  frequency_penalty: { min: -2, max: 2, step: 0.1, defaultValue: 0 },
  presence_penalty: { min: -2, max: 2, step: 0.1, defaultValue: 0 },
} as const

import type { TFunction } from 'i18next'

export function getContextCountOptions(
  t: TFunction
): Array<{ value: number | null; label: string }> {
  return [
    { value: null, label: t('settings:contextUnlimited') },
    { value: 5, label: t('settings:context5Messages') },
    { value: 10, label: t('settings:context10Messages') },
    { value: 20, label: t('settings:context20Messages') },
    { value: 50, label: t('settings:context50Messages') },
    { value: 100, label: t('settings:context100Messages') },
  ]
}
