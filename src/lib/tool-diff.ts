import { structuredPatch, diffWordsWithSpace } from 'diff'

export type DiffRowType = 'context' | 'add' | 'remove' | 'hunk'

export interface DiffSegment {
  text: string
  changed: boolean
}

export interface DiffRow {
  type: DiffRowType
  oldLine?: number
  newLine?: number
  content: string
  /** Word-level highlight segments (paired add/remove rows only) */
  segments?: DiffSegment[]
}

export interface DiffResult {
  rows: DiffRow[]
  additions: number
  deletions: number
  /** Number of rows dropped beyond maxRows */
  truncated: number
}

export const DIFF_MAX_ROWS = 500
export const DIFF_CONTEXT_LINES = 3

// Word-diffing very long lines is expensive and visually noisy; skip above this.
const WORD_DIFF_MAX_LINE_LENGTH = 500

interface HunkLine {
  prefix: ' ' | '+' | '-' | '\\'
  text: string
}

function parseHunkLines(lines: string[]): HunkLine[] {
  return lines.map((line) => {
    if (line.startsWith('+')) return { prefix: '+', text: line.slice(1) }
    if (line.startsWith('-')) return { prefix: '-', text: line.slice(1) }
    if (line.startsWith('\\')) return { prefix: '\\', text: line.slice(1) }
    return { prefix: ' ', text: line.slice(1) }
  })
}

/**
 * Build word-level segments for a paired remove/add line so only the changed
 * words get the stronger highlight (jackpoint/paseo pattern). For the remove
 * row only removed parts are marked changed; for the add row only added parts.
 */
function wordSegments(
  oldLine: string,
  newLine: string,
  side: 'remove' | 'add'
): DiffSegment[] | undefined {
  if (
    !oldLine ||
    !newLine ||
    oldLine.length > WORD_DIFF_MAX_LINE_LENGTH ||
    newLine.length > WORD_DIFF_MAX_LINE_LENGTH ||
    oldLine === newLine
  ) {
    return undefined
  }
  try {
    const parts = diffWordsWithSpace(oldLine, newLine)
    const segments: DiffSegment[] = []
    for (const part of parts) {
      const changed = side === 'remove' ? !!part.removed : !!part.added
      const skip = side === 'remove' ? !!part.added : !!part.removed
      if (skip) continue
      segments.push({ text: part.value, changed })
    }
    return segments.length > 1 ? segments : undefined
  } catch {
    return undefined
  }
}

/**
 * Compute a unified diff between two texts as renderable rows.
 *
 * Rows carry old/new line numbers (GitHub-unified style), hunk headers, and
 * word-level segments on paired remove/add lines. Identical inputs yield no
 * rows. Rows beyond maxRows are dropped and reported via `truncated`.
 */
export function computeUnifiedDiff(
  oldText: string,
  newText: string,
  context: number = DIFF_CONTEXT_LINES,
  maxRows: number = DIFF_MAX_ROWS
): DiffResult {
  const rows: DiffRow[] = []
  let additions = 0
  let deletions = 0

  let patch
  try {
    patch = structuredPatch('', '', oldText, newText, '', '', { context })
  } catch {
    return { rows: [], additions: 0, deletions: 0, truncated: 0 }
  }

  for (const hunk of patch.hunks) {
    rows.push({
      type: 'hunk',
      content: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    })

    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    const lines = parseHunkLines(hunk.lines)

    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (line.prefix === '\\') {
        i++
        continue
      }
      if (line.prefix === ' ') {
        rows.push({ type: 'context', oldLine, newLine, content: line.text })
        oldLine++
        newLine++
        i++
        continue
      }

      // Collect the remove run followed by the add run so they can be paired
      // for word-level highlighting.
      const removes: string[] = []
      while (i < lines.length && lines[i].prefix === '-') {
        removes.push(lines[i].text)
        i++
      }
      const adds: string[] = []
      while (i < lines.length && lines[i].prefix === '+') {
        adds.push(lines[i].text)
        i++
      }

      deletions += removes.length
      additions += adds.length

      removes.forEach((text, idx) => {
        rows.push({
          type: 'remove',
          oldLine: oldLine + idx,
          content: text,
          segments: adds[idx] !== undefined ? wordSegments(text, adds[idx], 'remove') : undefined,
        })
      })
      oldLine += removes.length

      adds.forEach((text, idx) => {
        rows.push({
          type: 'add',
          newLine: newLine + idx,
          content: text,
          segments:
            removes[idx] !== undefined ? wordSegments(removes[idx], text, 'add') : undefined,
        })
      })
      newLine += adds.length
    }
  }

  const truncated = Math.max(0, rows.length - maxRows)
  return {
    rows: truncated > 0 ? rows.slice(0, maxRows) : rows,
    additions,
    deletions,
    truncated,
  }
}

/**
 * Cheap +/- line counts for collapsed headers (no row building, no cap).
 */
export function diffStatCounts(
  oldText: string,
  newText: string
): { additions: number; deletions: number } {
  const patch = structuredPatch('', '', oldText, newText, '', '', { context: 0 })
  let additions = 0
  let deletions = 0
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) additions++
      else if (line.startsWith('-')) deletions++
    }
  }
  return { additions, deletions }
}
