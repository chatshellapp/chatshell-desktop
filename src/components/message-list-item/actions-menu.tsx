import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ActionsMenuProps {
  isVisible: boolean
  onGenerateTitle?: () => void
  onRename?: () => void
  onDelete?: () => void
}

export function ActionsMenu({
  isVisible,
  onGenerateTitle,
  onRename,
  onDelete,
}: ActionsMenuProps) {
  const hasActions = onGenerateTitle || onRename || onDelete

  if (!hasActions) {
    return null
  }

  return (
    <div
      className={cn(
        'absolute right-0 top-1/2 -translate-y-1/2 flex items-center transition-opacity bg-accent rounded-md',
        !isVisible && 'opacity-0 pointer-events-none'
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {onGenerateTitle && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onGenerateTitle()
              }}
            >
              Auto Title
            </DropdownMenuItem>
          )}
          {onRename && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onRename()
              }}
            >
              Rename
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="text-destructive focus:text-destructive"
            >
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

