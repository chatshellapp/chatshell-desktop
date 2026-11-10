// ChatShell's OpenUI component library: statistical charts and KPI cards,
// drawn with shadcn's Card and Chart (Recharts). Only the OpenUI language,
// parser, and Renderer come from OpenUI; the components are ChatShell's own,
// so the prompt that teaches them stays small (see `prompt.ts`).
//
// Blocks only display: nothing in them sends a message, opens a link, or
// calls a tool. The only interaction is local to the view (tooltips, and the
// total tiles that switch the plotted series).
// Design: internal-docs/features/openui-blocks.md.

import { createElement } from 'react'
import { createLibrary, defineComponent } from '@openuidev/react-lang'
import { z } from 'zod/v4'

import { OpenUiChart, type ChartSeries } from '@/components/openui/openui-chart'
import { OpenUiStats, type StatItem } from '@/components/openui/openui-stats'

export const Series = defineComponent({
  name: 'Series',
  props: z.object({
    name: z.string(),
    values: z.array(z.number()),
    total: z.string().optional(),
  }),
  description: 'One data series: a name and one number per label.',
  component: () => null,
})

export const Chart = defineComponent({
  name: 'Chart',
  props: z.object({
    type: z.enum(['bar', 'line', 'area', 'pie', 'radar', 'radial']),
    title: z.string(),
    labels: z.array(z.string()),
    // A lone series is accepted too: models often write `price` for `[price]`.
    series: z.union([z.array(Series.ref), Series.ref]),
    description: z.string().optional(),
    variant: z.enum(['stacked', 'horizontal', 'donut']).optional(),
  }),
  description: 'A statistical chart in a card.',
  component: ({ props }) => {
    if (!props.type) return null
    return createElement(OpenUiChart, {
      type: props.type,
      title: props.title,
      labels: stringArray(props.labels),
      series: elementProps(props.series).flatMap(toSeries),
      description: props.description,
      variant: props.variant,
    })
  },
})

export const Stat = defineComponent({
  name: 'Stat',
  props: z.object({
    label: z.string(),
    value: z.string(),
    change: z.string().optional(),
    note: z.string().optional(),
  }),
  description: 'One KPI: a label, a formatted value, an optional change and note.',
  component: () => null,
})

export const Stats = defineComponent({
  name: 'Stats',
  props: z.object({ items: z.union([z.array(Stat.ref), Stat.ref]) }),
  description: 'A row of KPI cards.',
  component: ({ props }) => {
    const items = elementProps(props.items).flatMap(toStat)
    return items.length ? createElement(OpenUiStats, { items }) : null
  },
})

/** Every component, in the order the prompt teaches them. */
export const OPENUI_COMPONENTS = [Chart, Series, Stats, Stat]

/** The library ChatShell renders and describes to the model. A block's root
 * is `Chart` or `Stats`; the parser takes whatever `root = ...` names. */
export const chatShellOpenUiLibrary = createLibrary({
  root: 'Chart',
  components: OPENUI_COMPONENTS,
})

// While a block streams, arrays and child calls can be cut short; keep only
// the parts that are already usable.

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? '')) : []
}

/** Props of the child calls in `value`: a list of them, or a single one. */
function elementProps(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : [value])
    .filter(
      (item): item is { type: 'element'; props: Record<string, unknown> } =>
        typeof item === 'object' &&
        item !== null &&
        (item as { type?: unknown }).type === 'element' &&
        typeof (item as { props?: unknown }).props === 'object'
    )
    .map((item) => item.props)
}

function toSeries(props: Record<string, unknown>): ChartSeries[] {
  if (typeof props.name !== 'string' || !Array.isArray(props.values)) return []
  return [
    {
      name: props.name,
      values: props.values.filter((value): value is number => typeof value === 'number'),
      total: typeof props.total === 'string' ? props.total : undefined,
    },
  ]
}

function toStat(props: Record<string, unknown>): StatItem[] {
  if (typeof props.label !== 'string' || typeof props.value !== 'string') return []
  return [
    {
      label: props.label,
      value: props.value,
      change: typeof props.change === 'string' ? props.change : undefined,
      note: typeof props.note === 'string' ? props.note : undefined,
    },
  ]
}
