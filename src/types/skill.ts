// ==========================================================================
// SKILL - Prompt instructions + required tools bundled together
// ==========================================================================

export interface Skill {
  id: string
  name: string
  description?: string
  /** "builtin" | "user" */
  source: string
  /** Filesystem path to skill directory */
  path: string
  /** Emoji or icon identifier */
  icon?: string
  /** Required tool IDs for this skill */
  required_tool_ids: string[]
  /** Whether the LLM can auto-invoke this skill */
  allow_model_invocation: boolean
  /** Whether the user can manually invoke this skill */
  allow_user_invocation: boolean
  /** Blake3 hash for change detection */
  content_hash?: string
  /** Cached parsed instructions */
  cached_instructions?: string
  /** Whether globally enabled */
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export interface CreateSkillRequest {
  name: string
  description?: string
  source: string
  path: string
  icon?: string
  required_tool_ids?: string[]
  allow_model_invocation?: boolean
  allow_user_invocation?: boolean
  content_hash?: string
  cached_instructions?: string
  is_enabled?: boolean
}

export function isBuiltinSkill(skill: Skill): boolean {
  return skill.source === 'builtin'
}

export function isUserSkill(skill: Skill): boolean {
  return skill.source === 'user'
}
