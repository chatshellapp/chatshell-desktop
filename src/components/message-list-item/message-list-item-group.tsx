import * as React from 'react'
import { cn } from '@/lib/utils'

interface MessageListItemGroupProps {
  children: React.ReactNode
  className?: string
}

export function MessageListItemGroup({ children, className }: MessageListItemGroupProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)} role="list">
      {children}
    </div>
  )
}

