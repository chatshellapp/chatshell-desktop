// Shared layout for the permission cards in Settings > Built-in Tools:
// icon and title on one row (optional action on the right), description
// and body flush left underneath.

import type { ComponentType, ReactNode } from 'react'

interface SettingsCardProps {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  action?: ReactNode
  children?: ReactNode
}

export function SettingsCard({
  icon: Icon,
  title,
  description,
  action,
  children,
}: SettingsCardProps) {
  return (
    <div className="grid max-w-lg gap-3 rounded-lg border p-4">
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">{title}</span>
          </div>
          {action}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}
