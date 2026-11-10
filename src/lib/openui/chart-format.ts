// Value and date formatting for OpenUI charts. The model sends only strings
// and numbers, so the chart reads two hints from them: an optional `unit`
// (an ISO currency code or a short suffix) and labels that are all ISO dates,
// which turn a line or area chart's x-axis into a time axis.
// Design: internal-docs/features/openui-blocks.md.

export interface ValueFormat {
  /** A value as the tooltip and point labels show it: "$350.69", "19.8%". */
  full: (value: number) => string
  /** An axis tick: "$350", "$1.2K", "40%". */
  compact: (value: number) => string
}

/** Longer "units" are prose ("USD thousands") the description should carry. */
const MAX_SUFFIX_LENGTH = 8

/** How a chart writes its values. `unit` is an ISO 4217 currency code
 * ("USD") or a suffix ("%", "pt", "ms"); anything else is ignored. */
export function valueFormat(unit?: string): ValueFormat {
  const trimmed = unit?.trim() ?? ''
  if (/^[A-Z]{3}$/.test(trimmed)) {
    try {
      const full = new Intl.NumberFormat(undefined, { style: 'currency', currency: trimmed })
      const compact = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: trimmed,
        notation: 'compact',
      })
      return { full: (v) => full.format(v), compact: (v) => compact.format(v) }
    } catch {
      // Not a currency Intl knows; fall through to a plain suffix.
    }
  }
  const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact' })
  if (!trimmed || trimmed.length > MAX_SUFFIX_LENGTH) {
    return { full: (v) => plain.format(v), compact: (v) => compact.format(v) }
  }
  // "19.8%" and "4°" sit flush; a word unit takes a space: "12 ms".
  const suffix = /^[\p{L}\p{N}]/u.test(trimmed) ? ` ${trimmed}` : trimmed
  return {
    full: (v) => `${plain.format(v)}${suffix}`,
    compact: (v) => `${compact.format(v)}${suffix}`,
  }
}

const MS_PER_DAY = 86_400_000

/** Days since the epoch for an ISO date ("2026-05-11"), or null. */
export function isoDay(label: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label.trim())
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const time = Date.UTC(year, month - 1, day)
  const date = new Date(time)
  // Reject dates Date.UTC rolls over, such as 2026-02-30.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null
  if (date.getUTCDate() !== day) return null
  return time / MS_PER_DAY
}

/** The labels' days when every label is an ISO date, oldest first with no
 * repeats; otherwise null and the labels stay categories. */
export function isoDays(labels: string[]): number[] | null {
  if (labels.length === 0) return null
  const days: number[] = []
  for (const label of labels) {
    const day = isoDay(label)
    if (day === null || (days.length > 0 && day <= days[days.length - 1])) return null
    days.push(day)
  }
  return days
}

const dateOf = (day: number) => new Date(day * MS_PER_DAY)
const spansYears = (first: number, last: number) =>
  dateOf(first).getUTCFullYear() !== dateOf(last).getUTCFullYear()

const formatters = {
  monthDay: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  monthDayYear: new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }),
  month: new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }),
  year: new Intl.DateTimeFormat(undefined, { year: 'numeric', timeZone: 'UTC' }),
}

/** A date in the tooltip: always with its year. */
export const formatFullDate = (day: number) => formatters.monthDayYear.format(dateOf(day))

/** A date as an axis label, with the year only when the data spans years. */
export function formatShortDate(day: number, days: number[]): string {
  const multiYear = spansYears(days[0], days[days.length - 1])
  return (multiYear ? formatters.monthDayYear : formatters.monthDay).format(dateOf(day))
}

export interface DateTick {
  day: number
  label: string
  /** The first and last ticks align to the plot's edges instead of centering. */
  edge?: 'start' | 'end'
}

/** At most this many ticks between the first and last date. */
const MAX_INNER_TICKS = 5
/** Inner ticks closer than this share of the span to an edge collide with it. */
const EDGE_GAP = 0.12
const MONTH_STEPS = [1, 2, 3, 6, 12]
const DAY_STEPS = [1, 2, 7, 14]

/** Time-axis ticks: the first and last dates, and between them month starts
 * (every 1, 2, 3, 6 or 12 months) or, for spans under about six weeks,
 * days. January ticks name the year when the data spans years. */
export function dateTicks(first: number, last: number): DateTick[] {
  const multiYear = spansYears(first, last)
  const edgeLabel = (day: number) =>
    (multiYear ? formatters.monthDayYear : formatters.monthDay).format(dateOf(day))
  if (last <= first) return [{ day: first, label: edgeLabel(first) }]

  const span = last - first
  const clear = (day: number) => day - first >= span * EDGE_GAP && last - day >= span * EDGE_GAP
  let inner: DateTick[] = []
  if (span >= 45) {
    const start = dateOf(first)
    const months: number[] = []
    for (
      let y = start.getUTCFullYear(), m = start.getUTCMonth() + 1;
      Date.UTC(y, m, 1) / MS_PER_DAY < last;
      m++
    ) {
      const day = Date.UTC(y, m, 1) / MS_PER_DAY
      if (clear(day)) months.push(day)
    }
    const step =
      MONTH_STEPS.find(
        (s) => months.filter((d) => dateOf(d).getUTCMonth() % s === 0).length <= MAX_INNER_TICKS
      ) ?? 12
    inner = months
      .filter((d) => dateOf(d).getUTCMonth() % step === 0)
      .map((day) => {
        const january = dateOf(day).getUTCMonth() === 0
        const label =
          step === 12 || (multiYear && january)
            ? formatters.year.format(dateOf(day))
            : formatters.month.format(dateOf(day))
        return { day, label }
      })
  } else {
    const step = DAY_STEPS.find((s) => Math.ceil(span / s) - 1 <= MAX_INNER_TICKS) ?? 14
    for (let day = first + step; day < last; day += step) {
      if (clear(day)) inner.push({ day, label: formatters.monthDay.format(dateOf(day)) })
    }
  }

  return [
    { day: first, label: edgeLabel(first), edge: 'start' },
    ...inner,
    { day: last, label: edgeLabel(last), edge: 'end' },
  ]
}
