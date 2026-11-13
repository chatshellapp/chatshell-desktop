import { logger } from '@/lib/logger'
import type { CreatePromptRequest, Prompt } from '@/types'

/**
 * Category name used for prompts without a category
 */
export const UNCATEGORIZED_CATEGORY = 'Uncategorized'

/**
 * Build a full update request from an existing prompt.
 *
 * `update_prompt` replaces every editable column, so start from this snapshot
 * and override only what changes. The starred flag is not part of the request
 * and is kept by the backend.
 */
export function toPromptRequest(
  prompt: Prompt,
  overrides: Partial<CreatePromptRequest> = {}
): CreatePromptRequest {
  return {
    name: prompt.name,
    content: prompt.content,
    description: prompt.description,
    category: prompt.category,
    is_system: prompt.is_system,
    ...overrides,
  }
}

/**
 * Copy prompt content to the clipboard. Returns false when copying failed.
 */
export async function copyPromptContent(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content)
    return true
  } catch (error) {
    logger.error('Failed to copy to clipboard:', error)
    return false
  }
}
