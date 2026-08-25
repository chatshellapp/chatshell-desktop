import i18n from '@/lib/i18n'

/**
 * Map known backend tool error substrings to short, human-readable messages
 * (a common agent-terminal pattern). The raw error stays available behind a details
 * disclosure in the UI. Unmatched errors pass through unchanged.
 */
const ERROR_PATTERNS: ReadonlyArray<{ pattern: RegExp; key: string }> = [
  { pattern: /old_string and new_string are identical/i, key: 'errors.noOpEdit' },
  { pattern: /would leave the file byte-identical/i, key: 'errors.noOpEdit' },
  { pattern: /identical no-op edit was already attempted/i, key: 'errors.noOpRetry' },
  { pattern: /old_string appears \d+ times/i, key: 'errors.ambiguousMatch' },
  { pattern: /old_string was not found/i, key: 'errors.staleFile' },
  { pattern: /Content anchor is stale/i, key: 'errors.staleAnchor' },
  { pattern: /File not found/i, key: 'errors.fileNotFound' },
  { pattern: /Not a file:|Path is a directory/i, key: 'errors.notAFile' },
  { pattern: /File is not valid UTF-8/i, key: 'errors.binaryFile' },
  { pattern: /Write blocked: outside project directory/i, key: 'errors.outsideProject' },
  { pattern: /Image too large/i, key: 'errors.imageTooLarge' },
  { pattern: /timed out/i, key: 'errors.timedOut' },
]

export function humanizeToolError(error: string): string {
  for (const { pattern, key } of ERROR_PATTERNS) {
    if (pattern.test(error)) {
      return i18n.t(key, { ns: 'tools' })
    }
  }
  return error
}
