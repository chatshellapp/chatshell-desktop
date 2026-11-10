// The `Chart` component of ChatShell's OpenUI library, drawn the way shadcn's
// charts are: a Card around a Recharts chart in a ChartContainer, colored
// from the app's --chart-1..5 tokens. Colors and config keys never come
// from the model: series are keyed s0, s1, ... and slices p0, p1, ..., so
// model text never reaches the <style> tag ChartContainer writes.
// Design: internal-docs/features/openui-blocks.md.

import { useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from 'recharts'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'radar' | 'radial'
export type ChartVariant = 'stacked' | 'horizontal' | 'donut'

export interface ChartSeries {
  name: string
  values: number[]
  total?: string
}

export interface OpenUiChartProps {
  type: ChartType
  title?: string
  labels: string[]
  series: ChartSeries[]
  description?: string
  variant?: ChartVariant
}

/** The app palette has five chart colors; later series reuse them. */
const PALETTE_SIZE = 5

const color = (index: number) => `var(--chart-${(index % PALETTE_SIZE) + 1})`

const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact' })
const formatTick = (value: unknown) =>
  typeof value === 'number' ? compactNumber.format(value) : String(value)

const seriesKey = (index: number) => `s${index}`
const sliceKey = (index: number) => `p${index}`

/** Charts with one category per slice instead of an x-axis. */
const isSliced = (type: ChartType) => type === 'pie' || type === 'radial'
const isCartesian = (type: ChartType) => type === 'bar' || type === 'line' || type === 'area'

export function OpenUiChart({
  type,
  title,
  labels,
  series,
  description,
  variant,
}: OpenUiChartProps) {
  const [active, setActive] = useState(0)

  // Tiles: every series states its total, as in shadcn's interactive bar chart.
  const tiles = isCartesian(type) && series.length > 0 && series.every((s) => s.total)
  const activeIndex = Math.min(active, Math.max(series.length - 1, 0))

  const header = (
    <div className="flex flex-1 flex-col justify-center gap-1.5">
      {title && <CardTitle>{title}</CardTitle>}
      {description && <CardDescription>{description}</CardDescription>}
    </div>
  )

  const body =
    labels.length > 0 && series.length > 0 ? (
      <ChartBody
        type={type}
        labels={labels}
        series={series}
        variant={variant}
        only={tiles ? activeIndex : undefined}
      />
    ) : null

  if (tiles) {
    return (
      <Card className="@container/openui-chart gap-0 py-0">
        <CardHeader className="flex flex-col items-stretch gap-0 border-b !p-0 @xl/openui-chart:flex-row">
          <div className="flex flex-1 px-6 pt-4 pb-3 @xl/openui-chart:py-5">{header}</div>
          <div className="flex">
            {series.map((s, index) => (
              <button
                key={index}
                type="button"
                data-active={index === activeIndex}
                aria-pressed={index === activeIndex}
                onClick={() => setActive(index)}
                className="relative flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l data-[active=true]:bg-muted/50 @xl/openui-chart:border-t-0 @xl/openui-chart:border-l @xl/openui-chart:px-8 @xl/openui-chart:py-5"
              >
                <span className="text-xs text-muted-foreground">{s.name}</span>
                <span className="text-lg leading-none font-bold tabular-nums @xl/openui-chart:text-3xl">
                  {s.total}
                </span>
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-2 py-4 @xl/openui-chart:p-6">{body}</CardContent>
      </Card>
    )
  }

  return (
    <Card className="gap-4">
      {(title || description) && <CardHeader>{header}</CardHeader>}
      <CardContent className="px-2 @xl:px-6">{body}</CardContent>
    </Card>
  )
}

interface ChartBodyProps {
  type: ChartType
  labels: string[]
  series: ChartSeries[]
  variant?: ChartVariant
  /** Plot only this series (the active tile). */
  only?: number
}

function ChartBody({ type, labels, series, variant, only }: ChartBodyProps) {
  if (isSliced(type)) {
    return <SlicedChart type={type} labels={labels} values={series[0].values} variant={variant} />
  }

  const shown = series
    .map((s, index) => ({ ...s, key: seriesKey(index), index }))
    .filter((s) => only === undefined || s.index === only)

  const config: ChartConfig = Object.fromEntries(
    shown.map((s) => [s.key, { label: s.name, color: color(s.index) }])
  )
  const data = labels.map((label, i) => {
    const row: Record<string, string | number | null> = { label }
    for (const s of shown) row[s.key] = s.values[i] ?? null
    return row
  })
  const legend = shown.length > 1 && <ChartLegend content={<ChartLegendContent />} />
  const stacked = variant === 'stacked'

  if (type === 'radar') {
    return (
      <ChartContainer config={config} className="mx-auto aspect-square max-h-[300px]">
        <RadarChart accessibilityLayer data={data}>
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <PolarGrid />
          <PolarAngleAxis dataKey="label" />
          {shown.map((s) => (
            <Radar
              key={s.key}
              dataKey={s.key}
              fill={`var(--color-${s.key})`}
              stroke={`var(--color-${s.key})`}
              fillOpacity={shown.length > 1 ? 0.35 : 0.6}
              isAnimationActive={false}
            />
          ))}
          {legend}
        </RadarChart>
      </ChartContainer>
    )
  }

  const containerClass = 'aspect-auto h-[250px] w-full'

  if (type === 'bar' && variant === 'horizontal') {
    return (
      <ChartContainer
        config={config}
        className={cn(containerClass, labels.length > 8 && 'h-[360px]')}
      >
        <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 0, right: 12 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={formatTick} />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width="auto"
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          {shown.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={`var(--color-${s.key})`}
              radius={stacked ? 0 : 4}
              isAnimationActive={false}
            />
          ))}
          {legend}
        </BarChart>
      </ChartContainer>
    )
  }

  const axes = [
    <CartesianGrid key="grid" vertical={false} />,
    <XAxis
      key="x"
      dataKey="label"
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      minTickGap={24}
    />,
    <YAxis
      key="y"
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      width="auto"
      tickFormatter={formatTick}
    />,
  ]

  if (type === 'line') {
    return (
      <ChartContainer config={config} className={containerClass}>
        <LineChart accessibilityLayer data={data} margin={{ left: 0, right: 12 }}>
          {axes}
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          {shown.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              type="natural"
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              dot={labels.length <= 12}
              isAnimationActive={false}
            />
          ))}
          {legend}
        </LineChart>
      </ChartContainer>
    )
  }

  if (type === 'area') {
    return (
      <ChartContainer config={config} className={containerClass}>
        <AreaChart accessibilityLayer data={data} margin={{ left: 0, right: 12 }}>
          {axes}
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          {shown.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              type="natural"
              fill={`var(--color-${s.key})`}
              fillOpacity={0.4}
              stroke={`var(--color-${s.key})`}
              stackId={stacked ? 'stack' : undefined}
              isAnimationActive={false}
            />
          ))}
          {legend}
        </AreaChart>
      </ChartContainer>
    )
  }

  return (
    <ChartContainer config={config} className={containerClass}>
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 12 }}>
        {axes}
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dashed" />} />
        {shown.map((s, position) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            fill={`var(--color-${s.key})`}
            stackId={stacked ? 'stack' : undefined}
            radius={
              stacked
                ? position === shown.length - 1
                  ? [4, 4, 0, 0]
                  : position === 0
                    ? [0, 0, 4, 4]
                    : 0
                : 4
            }
            isAnimationActive={false}
          />
        ))}
        {legend}
      </BarChart>
    </ChartContainer>
  )
}

interface SlicedChartProps {
  type: 'pie' | 'radial' | ChartType
  labels: string[]
  values: number[]
  variant?: ChartVariant
}

/** Pie and radial charts: one slice per label, from the first series. */
function SlicedChart({ type, labels, values, variant }: SlicedChartProps) {
  const config: ChartConfig = Object.fromEntries(
    labels.map((label, index) => [sliceKey(index), { label, color: color(index) }])
  )
  const data = labels
    .map((label, index) => ({
      key: sliceKey(index),
      label,
      value: values[index],
      fill: `var(--color-${sliceKey(index)})`,
    }))
    .filter((row) => typeof row.value === 'number')

  const tooltip = (
    <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="key" hideLabel />} />
  )
  const legend = (
    <ChartLegend
      content={<ChartLegendContent nameKey="key" />}
      className="-translate-y-2 flex-wrap gap-2 *:basis-1/4 *:justify-center"
    />
  )

  if (type === 'radial') {
    return (
      <ChartContainer config={config} className="mx-auto aspect-square max-h-[300px]">
        <RadialBarChart data={data} innerRadius={30} outerRadius={110}>
          {tooltip}
          <RadialBar dataKey="value" background isAnimationActive={false} />
          {legend}
        </RadialBarChart>
      </ChartContainer>
    )
  }

  return (
    <ChartContainer config={config} className="mx-auto aspect-square max-h-[300px]">
      <PieChart>
        {tooltip}
        <Pie
          data={data}
          dataKey="value"
          nameKey="key"
          innerRadius={variant === 'donut' ? 60 : 0}
          isAnimationActive={false}
        />
        {legend}
      </PieChart>
    </ChartContainer>
  )
}
