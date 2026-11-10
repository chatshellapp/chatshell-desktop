// Keep currency from turning into math. remark-math pairs any two single
// dollar signs, so "$28,000-$216,856 (median $83,381)" renders "28,000-" and
// "83,381), hourly " as KaTeX. Before parsing, every single `$` that cannot
// delimit inline math is escaped as `\$`, using Pandoc's rule:
//
// - an opening `$` is followed by a non-space character;
// - a closing `$` follows a non-space character and is not followed by a
//   digit (so a price never closes math).
//
// micromark closes inline math at the next single `$`, so a `$` only opens
// math when that next `$` can close it. Fenced code, inline code, `$$`
// display math, and escaped dollars are left as written. Inline math is
// paired within one line (and one table cell), which is how models write it.

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** `content` with dollars that cannot delimit inline math escaped. */
export function escapeNonMathDollars(content: string): string {
  if (!content.includes('$')) return content

  const lines = content.split('\n')
  let fence: string | null = null
  let displayMath = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (fence) {
      const close = line.match(FENCE)
      if (
        close &&
        close[1][0] === fence[0] &&
        close[1].length >= fence.length &&
        line.trim() === close[1]
      ) {
        fence = null
      }
      continue
    }
    const open = line.match(FENCE)
    if (open) {
      fence = open[1]
      continue
    }

    // A `$$` display block spans lines until the next line with `$$`.
    const displayDelimiters = line.split('$$').length - 1
    if (displayMath) {
      if (displayDelimiters % 2 === 1) displayMath = false
      continue
    }
    if (line.trimStart().startsWith('$$') && displayDelimiters % 2 === 1) {
      displayMath = true
      continue
    }

    if (line.includes('$')) lines[i] = escapeLine(line)
  }
  return lines.join('\n')
}

function escapeLine(line: string): string {
  const tableRow = line.trimStart().startsWith('|')
  // Single dollars, grouped by table cell.
  const groups: number[][] = [[]]

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '\\') {
      i++ // An escaped character, including an escaped dollar.
    } else if (char === '`') {
      let run = 1
      while (line[i + run] === '`') run++
      const close = findBacktickRun(line, i + run, run)
      i = close === -1 ? i + run - 1 : close + run - 1
    } else if (char === '$' && line[i + 1] === '$') {
      // Inline `$$...$$` stays as written.
      const close = line.indexOf('$$', i + 2)
      i = close === -1 ? i + 1 : close + 1
    } else if (char === '$') {
      groups[groups.length - 1].push(i)
    } else if (char === '|' && tableRow) {
      groups.push([])
    }
  }

  const escape = new Set<number>()
  for (const dollars of groups) {
    let k = 0
    while (k < dollars.length) {
      const next = dollars[k + 1]
      if (canOpen(line, dollars[k]) && next !== undefined && canClose(line, next)) {
        k += 2
      } else {
        escape.add(dollars[k])
        k += 1
      }
    }
  }
  if (escape.size === 0) return line

  let out = ''
  for (let i = 0; i < line.length; i++) {
    out += escape.has(i) ? '\\$' : line[i]
  }
  return out
}

/** Start of the next run of exactly `length` backticks at or after `from`. */
function findBacktickRun(line: string, from: number, length: number): number {
  for (let i = from; i < line.length; i++) {
    if (line[i] !== '`') continue
    let run = 1
    while (line[i + run] === '`') run++
    if (run === length) return i
    i += run - 1
  }
  return -1
}

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char)

function canOpen(line: string, at: number): boolean {
  return !isSpace(line[at + 1])
}

function canClose(line: string, at: number): boolean {
  return !isSpace(line[at - 1]) && !/[0-9]/.test(line[at + 1] ?? '')
}
