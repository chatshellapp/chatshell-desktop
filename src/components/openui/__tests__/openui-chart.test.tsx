import { beforeAll, describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Bar, BarChart, Line, LineChart, YAxis } from 'recharts'
import { valueFormat } from '@/lib/openui/chart-format'
import { LineDot, OpenUiChart, valueDomain } from '../openui-chart'

// Weekly AAPL closes: a 19.8% climb that a zero baseline flattens.
const PRICES = [292.68, 308.82, 291.13, 283.78, 333.74, 308.91, 305.93, 332.27, 347.73, 350.69]
const data = PRICES.map((value, i) => ({ label: `w${i}`, value }))

/** The tick values Recharts draws. Recharts 3 renders tick labels in a
 * z-index layer outside the axis group, so these charts have no x-axis and
 * every tick label belongs to the y-axis. */
const yTicks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.recharts-cartesian-axis-tick-value')).map((tick) =>
    Number(tick.textContent)
  )

describe('valueDomain', () => {
  it('fits a line chart axis to the data instead of starting at zero', () => {
    const { container } = render(
      <LineChart width={600} height={300} data={data}>
        <YAxis domain={valueDomain('line')} />
        <Line dataKey="value" isAnimationActive={false} />
      </LineChart>
    )
    const ticks = yTicks(container)
    expect(ticks.length).toBeGreaterThan(1)
    expect(Math.min(...ticks)).toBeGreaterThan(200)
    expect(Math.min(...ticks)).toBeLessThanOrEqual(Math.min(...PRICES))
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(Math.max(...PRICES))
  })

  it('keeps bar and area axes anchored at zero', () => {
    expect(valueDomain('bar')).toEqual([0, 'auto'])
    expect(valueDomain('area')).toEqual([0, 'auto'])
    const { container } = render(
      <BarChart width={600} height={300} data={data}>
        <YAxis domain={valueDomain('bar')} />
        <Bar dataKey="value" isAnimationActive={false} />
      </BarChart>
    )
    expect(Math.min(...yTicks(container))).toBe(0)
  })
})

describe('LineDot', () => {
  it('labels only the first and last points of a long series', () => {
    const { container } = render(
      <LineChart width={600} height={300} data={data}>
        <YAxis domain={valueDomain('line')} />
        <Line
          dataKey="value"
          type="linear"
          isAnimationActive={false}
          dot={(props) => (
            <LineDot
              key={props.index}
              {...props}
              last={data.length - 1}
              all={false}
              format={valueFormat('USD').full}
            />
          )}
        />
      </LineChart>
    )
    const labels = Array.from(container.querySelectorAll('.openui-chart-endpoint text')).map(
      (text) => text.textContent
    )
    const usd = valueFormat('USD').full
    expect(labels).toEqual([usd(292.68), usd(350.69)])
    expect(container.querySelectorAll('.recharts-line-dots circle')).toHaveLength(2)
  })
})

describe('OpenUiChart', () => {
  // ChartContainer measures itself; report a fixed size so Recharts draws.
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, contentRect: { width: 600, height: 250 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver
        )
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  const DATES = ['2026-05-11', '2026-05-15', '2026-05-22', '2026-06-26', '2026-07-02', '2026-11-09']
  const CLOSES = [292.68, 300.23, 308.82, 283.78, 308.63, 350.69]

  it('draws dated lines on a time axis with units', () => {
    const { container } = render(
      <OpenUiChart
        type="line"
        title="AAPL"
        labels={DATES}
        series={[{ name: 'AAPL', values: CLOSES }]}
        unit="USD"
      />
    )
    const ticks = Array.from(
      container.querySelectorAll(
        '.recharts-xAxis-tick-labels text, .recharts-cartesian-axis-tick-value'
      )
    ).map((t) => t.textContent)
    expect(ticks).toContain('Jul')
    const usd = valueFormat('USD').full
    const endpoints = Array.from(container.querySelectorAll('.openui-chart-endpoint text')).map(
      (t) => t.textContent
    )
    expect(endpoints).toEqual([usd(292.68), usd(350.69)])
    // Points sit by date: the 5-week gap is wider than the 4-day one.
    const path = container.querySelector('.recharts-line-curve')?.getAttribute('d') ?? ''
    const xs = [...path.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1]))
    expect(xs).toHaveLength(DATES.length)
    expect(xs[3] - xs[2]).toBeGreaterThan(5 * (xs[1] - xs[0]))
  })

  it('keeps plain labels as evenly spaced categories', () => {
    const { container } = render(
      <OpenUiChart
        type="line"
        labels={['May 11', 'May 15', 'May 22']}
        series={[{ name: 'AAPL', values: [1, 2, 3] }]}
      />
    )
    const path = container.querySelector('.recharts-line-curve')?.getAttribute('d') ?? ''
    const xs = [...path.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1]))
    expect(xs[2] - xs[1]).toBeCloseTo(xs[1] - xs[0], 5)
  })
})
