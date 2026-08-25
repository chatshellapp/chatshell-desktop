// Skill types are generated from Rust models (src-tauri/src/models/skill.rs)
// via ts-rs. Run `pnpm types:generate` in src-tauri to regenerate.

export type { Skill } from './generated/Skill'
export type { CreateSkillRequest } from './generated/CreateSkillRequest'
export type { SkillSourceInfo } from './generated/SkillSourceInfo'

import type { Skill } from './generated/Skill'

export type SkillSource = 'builtin' | 'user' | 'claude' | 'agents'

export const SKILL_SOURCE_ORDER: SkillSource[] = ['builtin', 'user', 'claude', 'agents']

export function isBuiltinSkill(skill: Skill): boolean {
  return skill.source === 'builtin'
}

export function isUserSkill(skill: Skill): boolean {
  return skill.source !== 'builtin'
}

export function getSkillsBySource(skills: Skill[], source: SkillSource): Skill[] {
  return skills.filter((s) => s.source === source)
}

export function getSkillSourceLabel(source: SkillSource): string {
  const labels: Record<SkillSource, string> = {
    builtin: 'Built-in',
    user: 'ChatShell',
    claude: 'Claude',
    agents: 'Agent Skills',
  }
  return labels[source] ?? source
}
