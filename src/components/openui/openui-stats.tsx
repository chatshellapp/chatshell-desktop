// The `Stats` component of ChatShell's OpenUI library: a row of KPI cards
// in the style of shadcn's dashboard section cards, minus their gradient:
// plain cards, like the chart blocks. The trend arrow follows
// the sign of the change; the badge stays neutral because "down" is good
// news for some metrics (churn) and bad for others (revenue).
// Design: internal-docs/features/openui-blocks.md.

import { TrendingDown, TrendingUp } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export interface StatItem {
  label: string
  value: string
  change?: string
  note?: string
}

/** +1 for a rising change, -1 for a falling one, 0 when there is no sign. */
export function changeDirection(change: string | undefined): -1 | 0 | 1 {
  const sign = change?.trim().charAt(0)
  if (sign === '+') return 1
  // ASCII hyphen and the Unicode minus sign.
  if (sign === '-' || sign === '−') return -1
  return 0
}

export function OpenUiStats({ items }: { items: StatItem[] }) {
  return (
    <div className="@container/openui-stats">
      <div className="grid grid-cols-1 gap-4 @md/openui-stats:grid-cols-2 @4xl/openui-stats:grid-cols-4">
        {items.map((item, index) => (
          <StatCard key={index} {...item} />
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value, change, note }: StatItem) {
  const direction = changeDirection(change)
  const Trend = direction > 0 ? TrendingUp : direction < 0 ? TrendingDown : null
  return (
    <Card className="@container/card gap-4">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {value}
        </CardTitle>
        {change && (
          <CardAction>
            <Badge variant="outline">
              {Trend && <Trend />}
              {change}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      {note && (
        <CardFooter className="text-sm text-muted-foreground">
          <span className="line-clamp-2">{note}</span>
        </CardFooter>
      )}
    </Card>
  )
}
