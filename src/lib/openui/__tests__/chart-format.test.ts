import { describe, expect, it } from 'vitest'

import { dateTicks, isoDay, isoDays, valueFormat } from '../chart-format'

const day = (iso: string) => isoDay(iso)!
const labels = (first: string, last: string) => dateTicks(day(first), day(last)).map((t) => t.label)
const monthDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
const month = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })

describe('valueFormat', () => {
  it('formats a currency code as money', () => {
    const usd = valueFormat('USD')
    const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })
    expect(usd.full(350.69)).toBe(money.format(350.69))
    expect(usd.compact(1_200_000)).toBe(
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
      }).format(1_200_000)
    )
  })

  it('appends symbols flush and word units after a space', () => {
    expect(valueFormat('%').full(19.8)).toMatch(/19.8%$/)
    expect(valueFormat('ms').full(12)).toMatch(/12 ms$/)
  })

  it('ignores a missing or prose unit', () => {
    const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
    expect(valueFormat().full(292.684)).toBe(plain.format(292.684))
    expect(valueFormat('USD thousands').full(120)).toBe(plain.format(120))
  })
})

describe('isoDays', () => {
  it('reads ascending ISO dates', () => {
    expect(isoDays(['2026-05-11', '2026-05-15'])).toEqual([day('2026-05-11'), day('2026-05-15')])
  })

  it('keeps labels as categories unless every one is a real date in order', () => {
    expect(isoDays(['May 11', 'May 15'])).toBeNull()
    expect(isoDays(['2026-05-11', 'May 15'])).toBeNull()
    expect(isoDays(['2026-02-30'])).toBeNull()
    expect(isoDays(['2026-05-15', '2026-05-11'])).toBeNull()
    expect(isoDays(['2026-05-11', '2026-05-11'])).toBeNull()
    expect(isoDays([])).toBeNull()
  })
})

describe('dateTicks', () => {
  it('marks the ends and the month starts clear of them', () => {
    // Jun 1 and Nov 1 sit too close to May 11 and Nov 9.
    expect(labels('2026-05-11', '2026-11-09')).toEqual([
      monthDay('2026-05-11'),
      month('2026-07-01'),
      month('2026-08-01'),
      month('2026-09-01'),
      month('2026-10-01'),
      monthDay('2026-11-09'),
    ])
    const ticks = dateTicks(day('2026-05-11'), day('2026-11-09'))
    expect(ticks[0].edge).toBe('start')
    expect(ticks[ticks.length - 1].edge).toBe('end')
  })

  it('thins month ticks over long spans and names years', () => {
    // Jan 2026 sits inside the gap before the Mar 15 end.
    const ticks = labels('2021-03-15', '2026-03-15')
    expect(ticks.slice(1, -1)).toEqual(['2022', '2023', '2024', '2025'])
  })

  it('uses days for spans of a few weeks', () => {
    const ticks = dateTicks(day('2026-05-01'), day('2026-05-29'))
    const inner = ticks.slice(1, -1).map((t) => t.day - day('2026-05-01'))
    expect(inner).toEqual([7, 14, 21])
  })

  it('handles a single date', () => {
    expect(dateTicks(day('2026-05-11'), day('2026-05-11'))).toHaveLength(1)
  })
})
