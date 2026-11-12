import femaleNames from '@/assets/data/names/female_names.json'
import maleNames from '@/assets/data/names/male_names.json'
import type { Assistant } from '@/types/generated/Assistant'
import type { CreateAssistantRequest } from '@/types/generated/CreateAssistantRequest'

/**
 * Group name used for assistants without a group_name
 */
export const UNGROUPED_GROUP_NAME = 'Ungrouped'

export const PRESET_COLORS = ['#00E5FF', '#FF4081', '#E040FB']
export const FEMALE_EMOJIS = ['👩‍💼', '🤵‍♀️', '👩‍💻', '👩‍🎤']
export const MALE_EMOJIS = ['👨‍💼', '🤵‍♂️', '👨‍💻', '👨‍🎤']

export function getRandomPresetColor() {
  return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
}

export function getRandomNameAndEmoji() {
  // Randomly decide gender
  const isFemale = Math.random() < 0.5

  // Select random name based on gender
  const names = isFemale ? femaleNames : maleNames
  const randomName = names[Math.floor(Math.random() * names.length)]

  // Select random emoji based on gender
  const emojis = isFemale ? FEMALE_EMOJIS : MALE_EMOJIS
  const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)]

  return { name: randomName, emoji: randomEmoji }
}

/**
 * Generate random avatar data for a new assistant
 */
export function generateRandomAvatarData() {
  const { name, emoji } = getRandomNameAndEmoji()
  const color = getRandomPresetColor()
  return { name, emoji, color }
}

/**
 * Build a full update request from an existing assistant.
 *
 * `update_assistant` replaces every column, so partial requests silently
 * clear fields such as role, description, preset and image avatar. Always
 * start from this snapshot and override only what changes. Tool and skill
 * links are omitted on purpose: the backend keeps them when they are absent.
 */
export function toAssistantRequest(
  assistant: Assistant,
  overrides: Partial<CreateAssistantRequest> = {}
): CreateAssistantRequest {
  return {
    name: assistant.name,
    role: assistant.role,
    description: assistant.description,
    system_prompt: assistant.system_prompt,
    user_prompt: assistant.user_prompt,
    model_id: assistant.model_id,
    model_parameter_preset_id: assistant.model_parameter_preset_id,
    avatar_type: assistant.avatar_type,
    avatar_bg: assistant.avatar_bg,
    avatar_text: assistant.avatar_text,
    avatar_image_path: assistant.avatar_image_path,
    avatar_image_url: assistant.avatar_image_url,
    group_name: assistant.group_name,
    is_starred: assistant.is_starred,
    ...overrides,
  }
}

/**
 * Image source for an assistant avatar, or undefined for text avatars
 */
export function getAssistantAvatarImage(assistant: Assistant): string | undefined {
  if (assistant.avatar_type !== 'image') return undefined
  return assistant.avatar_image_url || assistant.avatar_image_path || undefined
}

/**
 * Short subtitle for an assistant list row: role, then description, then a
 * truncated system prompt. Returns undefined when nothing is available.
 */
export function getAssistantSubtitle(assistant: Assistant, maxLength = 50): string | undefined {
  const role = assistant.role?.trim()
  if (role) return role
  const description = assistant.description?.trim()
  if (description) return description
  const prompt = assistant.system_prompt?.trim()
  if (!prompt) return undefined
  return prompt.length > maxLength ? `${prompt.slice(0, maxLength).trimEnd()}...` : prompt
}
