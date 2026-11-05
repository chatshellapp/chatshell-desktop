// @-mentions in the composer: find the mention being typed at the caret and
// rank working-directory files against it.

export interface ActiveMention {
  /** Index of the `@`. */
  start: number
  /** Text typed after the `@`, up to the caret. */
  query: string
}

/**
 * The mention under the caret: an `@` at the start of the text or after
 * whitespace, followed by non-whitespace up to the caret.
 */
export function activeMention(text: string, caret: number): ActiveMention | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (/\s/.test(query)) return null
  return { start: at, query }
}

/** Replace the mention at `mention.start` with `@<path> `; returns text and caret. */
export function applyMention(
  text: string,
  mention: ActiveMention,
  path: string
): { text: string; caret: number } {
  const end = mention.start + 1 + mention.query.length
  const insert = `@${path} `
  return {
    text: text.slice(0, mention.start) + insert + text.slice(end),
    caret: mention.start + insert.length,
  }
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return needle.length === 0
}

function score(path: string, query: string): number | null {
  if (!query) return 0
  const lowerPath = path.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const base = lowerPath.slice(lowerPath.lastIndexOf('/') + 1)
  if (base.startsWith(lowerQuery)) return 0
  if (base.includes(lowerQuery)) return 1
  if (lowerPath.includes(lowerQuery)) return 2
  if (isSubsequence(lowerQuery, lowerPath)) return 3
  return null
}

/** Best matches first (basename prefix, basename, path, subsequence), then shorter paths. */
export function rankMentionCandidates(paths: string[], query: string, limit = 50): string[] {
  const scored: Array<[number, string]> = []
  for (const path of paths) {
    const s = score(path, query)
    if (s !== null) scored.push([s, path])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]))
  return scored.slice(0, limit).map(([, path]) => path)
}
