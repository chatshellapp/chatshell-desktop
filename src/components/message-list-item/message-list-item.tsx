import * as React from 'react'
import { Item, ItemContent, ItemTitle, ItemDescription, ItemHeader } from '@/components/ui/item'
import { cn } from '@/lib/utils'
import type { MessageListItemProps } from './types'
import { MessageAvatarGroup } from './message-avatar'
import { ActionsMenu } from './actions-menu'
import { RenameDialog } from './rename-dialog'
import { DeleteDialog } from './delete-dialog'

export function MessageListItem({
  avatars,
  summary,
  timestamp,
  lastMessage,
  onClick,
  className,
  isActive = false,
  onGenerateTitle,
  onEditTitle,
  onDelete,
}: MessageListItemProps) {
  const [isHovered, setIsHovered] = React.useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)
  const [showRenameDialog, setShowRenameDialog] = React.useState(false)

  const hasActions = onGenerateTitle || onEditTitle || onDelete

  return (
    <>
      <Item
        className={cn(
          'cursor-pointer hover:bg-accent/50 transition-colors',
          isActive && 'bg-accent',
          className
        )}
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        tabIndex={0}
        role="button"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick?.()
          }
        }}
      >
        <ItemContent>
          {/* First line: Summary (can wrap) with action overlay */}
          <ItemHeader className="relative">
            <ItemTitle className="line-clamp-2">{summary}</ItemTitle>

            {/* Floating action overlay */}
            {hasActions && (
              <ActionsMenu
                isVisible={isHovered}
                onGenerateTitle={onGenerateTitle}
                onRename={onEditTitle ? () => setShowRenameDialog(true) : undefined}
                onDelete={onDelete ? () => setShowDeleteDialog(true) : undefined}
              />
            )}
          </ItemHeader>

          {/* Second line: Last message content (truncated) */}
          <ItemDescription className="line-clamp-1 text-xs">{lastMessage}</ItemDescription>

          {/* Third line: Timestamp and small avatars */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{timestamp}</span>
            <MessageAvatarGroup avatars={avatars} summary={summary} />
          </div>
        </ItemContent>
      </Item>

      {/* Rename dialog */}
      {onEditTitle && (
        <RenameDialog
          open={showRenameDialog}
          onOpenChange={setShowRenameDialog}
          currentTitle={summary}
          onRename={onEditTitle}
        />
      )}

      {/* Delete confirmation dialog */}
      {onDelete && (
        <DeleteDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={onDelete}
        />
      )}
    </>
  )
}
