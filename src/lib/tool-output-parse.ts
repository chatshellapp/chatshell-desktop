/**
 * Parsers for built-in tool output text (see src-tauri/src/llm/tools/*).
 * Kept pure so both collapsed-header summaries and expanded renderers
 * share one interpretation of the backend formats.
 */

export interface ReadLine {
  /** Real file line number, null when the backend emitted no prefix */
  n: number | null
  text: string
}

export interface ParsedReadOutput {
  lines: ReadLine[]
  /** Trailing "... (N more lines, M total)" note emitted by the backend */
  footer: string | null
}

// read.rs emits "{:>6}\t{content}" per line (right-aligned number + TAB).
const READ_LINE_PREFIX = /^\s*(\d+)\t/

/**
 * Parse read tool output: split line-number prefixes into real file line
 * numbers, extract the trailing truncation footer, and detect non-contiguous
 * ranges (gap between consecutive numbers) so the renderer can draw "…" rows.
 */
export function parseReadOutput(output: string): ParsedReadOutput {
  const lines: ReadLine[] = []
  let footer: string | null = null

  const rawLines = output.replace(/\n$/, '').split('\n')
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]
    // The footer is a bare note line at the end, preceded by a blank separator
    if (i === rawLines.length - 1 && /^\s*\.\.\. \(/.test(raw)) {
      footer = raw.trim()
      while (
        lines.length > 0 &&
        lines[lines.length - 1].text === '' &&
        lines[lines.length - 1].n === null
      ) {
        lines.pop()
      }
      continue
    }
    // Skip snapshot header lines: [path#XXXX] emitted by the backend
    if (/^\[.+#[0-9A-Fa-f]{4}\]$/.test(raw.trim())) continue
    const match = raw.match(READ_LINE_PREFIX)
    if (match) {
      lines.push({
        n: parseInt(match[1], 10),
        text: raw.slice(match[0].length).replace(/^\s+/, ''),
      })
    } else {
      lines.push({ n: null, text: raw })
    }
  }

  return { lines, footer }
}

/** True when the numbered lines jump (e.g. offset reads), meaning a gap row belongs between a and b */
export function isReadGap(a: ReadLine, b: ReadLine): boolean {
  return a.n !== null && b.n !== null && b.n > a.n + 1
}

/**
 * Count grep matches: match lines look like "path:12:content" (or
 * "path:12-content" for a -A/-B/-C context flag); context lines look like
 * "path-12-content" / "path-12:content". Only true match lines count.
 */
export function countGrepMatches(output: string): number {
  let count = 0
  for (const line of output.split('\n')) {
    if (line === '--' || line === '') continue
    if (/^.+:\d+:/.test(line) || /^[^:\s]+-\d+:/.test(line)) count++
    // count mode emits "path:N" per file; N is the per-file match count
    else if (/^[^:\s]+:\d+$/.test(line)) count += parseInt(line.split(':').pop() ?? '0', 10)
  }
  return count
}

/**
 * Unique file paths referenced by grep output, in first-seen order.
 * Handles content mode ("path:12:content"), count mode ("path:N"), and
 * files_with_matches mode (one bare path per line).
 */
export function grepFilePaths(output: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const line of output.split('\n')) {
    if (line === '--' || line === '') continue
    const match = line.match(/^([^:\s]+)(?:[:-]\d+)?[:-]/)
    const path = match ? match[1] : looksLikeBarePath(line) ? line : null
    if (path && !seen.has(path)) {
      seen.add(path)
      paths.push(path)
    }
  }
  return paths
}

// files_with_matches mode prints one path per line with no separator; accept
// whitespace-free lines that carry a path shape (slash or extension dot).
function looksLikeBarePath(line: string): boolean {
  return !/\s/.test(line) && (line.includes('/') || /\.[A-Za-z0-9]+$/.test(line))
}
