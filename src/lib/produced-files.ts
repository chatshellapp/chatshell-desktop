// Files an assistant turn created or modified, derived from its tool calls
// (no stored state): `write` reports "Created" for new files and "Wrote"
// for overwrites, `edit` always modifies. Failed calls produce nothing.
// Bash-made changes are not tracked.

import type { ToolCall } from '@/types'

export type ProducedFileRole = 'created' | 'modified'

export interface ProducedFile {
  path: string
  role: ProducedFileRole
}

function pathArgument(toolInput: string | undefined): string | null {
  if (!toolInput) return null
  try {
    const args = JSON.parse(toolInput) as { path?: unknown; file_path?: unknown }
    const path = args.path ?? args.file_path
    return typeof path === 'string' && path.trim() ? path.trim() : null
  } catch {
    return null
  }
}

function roleOf(call: ToolCall): ProducedFileRole | null {
  if (call.status !== 'success') return null
  if (call.tool_name === 'edit') return 'modified'
  if (call.tool_name === 'write') {
    return call.tool_output?.startsWith('Created ') ? 'created' : 'modified'
  }
  return null
}

/**
 * Produced files in first-touch order. A file created and later edited in
 * the same turn stays "created".
 */
export function deriveProducedFiles(toolCalls: ToolCall[]): ProducedFile[] {
  const byPath = new Map<string, ProducedFile>()
  const ordered = [...toolCalls].sort((a, b) => a.display_order - b.display_order)
  for (const call of ordered) {
    const role = roleOf(call)
    const path = role ? pathArgument(call.tool_input) : null
    if (!role || !path) continue
    const existing = byPath.get(path)
    if (!existing) byPath.set(path, { path, role })
  }
  return [...byPath.values()]
}

/** Last path component, for chip labels. */
export function fileLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed
}
