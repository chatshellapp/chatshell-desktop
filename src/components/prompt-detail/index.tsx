import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ClipboardCopy,
  Copy,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  SquareTerminal,
  TextCursorInput,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { PromptDialog } from '@/components/prompt-dialog'
import { DeletePromptDialog } from '@/components/prompt-list-item/delete-dialog'
import {
  DetailHeader,
  DetailList,
  DetailPage,
  DetailSection,
  RecentConversations,
} from '@/components/detail-page'
import { usePromptStore } from '@/stores/promptStore'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import { useSidebarHandlers } from '@/hooks/useSidebarHandlers'
import { usePromptConversations } from '@/hooks/usePromptGroups'
import { copyPromptContent } from '@/lib/prompt-utils'
import { formatConversationTimestamp } from '@/lib/utils'
import type { Prompt } from '@/types'

interface PromptDetailProps {
  prompt: Prompt
  /** Called after a chat was opened from this page, to leave it */
  onChatOpened: () => void
}

export function PromptDetail({ prompt, onChatOpened }: PromptDetailProps) {
  const { t } = useTranslation('sidebar')
  const { t: tCommon } = useTranslation('common')
  const { t: tPrompts } = useTranslation('prompts')
  const handlers = useSidebarHandlers()
  const togglePromptStar = usePromptStore((state) => state.togglePromptStar)
  const selectPrompt = useLibrarySelectionStore((state) => state.selectPrompt)
  const clearPrompt = useLibrarySelectionStore((state) => state.clearPrompt)
  const [showEditDialog, setShowEditDialog] = React.useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)
  // Only system prompts are recorded in conversation settings
  const { conversations, isLoading } = usePromptConversations(prompt.is_system ? prompt.id : null)

  const listItem = { id: prompt.id, name: prompt.name, content: prompt.content }
  const TypeIcon = prompt.is_system ? SquareTerminal : MessageSquare
  const typeLabel = prompt.is_system ? tPrompts('systemPrompt') : tPrompts('userPrompt')

  const handleCopy = async () => {
    if (await copyPromptContent(prompt.content)) toast.success(t('promptCopied'))
    else toast.error(t('failedToCopyPrompt'))
  }

  const handleDuplicate = async () => {
    const copy = await handlers.handlePromptDuplicate(
      listItem,
      t('promptCopyName', { name: prompt.name })
    )
    if (copy) selectPrompt(copy.id)
  }

  return (
    <DetailPage>
      <DetailHeader
        avatar={
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
            <TypeIcon className="size-8 text-muted-foreground" />
          </div>
        }
        name={prompt.name}
        subtitle={prompt.description}
        badges={
          <>
            <Badge variant="secondary">{typeLabel}</Badge>
            <Badge variant="outline">{prompt.category || t('uncategorized')}</Badge>
          </>
        }
        primaryAction={{
          label: t('useInNewChat'),
          icon: <MessageSquarePlus />,
          onClick: () => {
            void handlers.handlePromptUse(listItem)
            onChatOpened()
          },
        }}
        extraActions={
          <>
            {!prompt.is_system && (
              <Button
                variant="outline"
                size="icon"
                aria-label={t('insertIntoChat')}
                title={t('insertIntoChat')}
                onClick={() => {
                  void handlers.handlePromptInsert(listItem)
                  onChatOpened()
                }}
              >
                <TextCursorInput />
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              aria-label={tPrompts('copyContent')}
              title={tPrompts('copyContent')}
              onClick={() => void handleCopy()}
            >
              <ClipboardCopy />
            </Button>
          </>
        }
        isStarred={prompt.is_starred}
        onStarToggle={() => void togglePromptStar(prompt.id)}
        menuItems={
          <>
            <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
              <Pencil />
              {tCommon('edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleDuplicate()}>
              <Copy />
              {t('duplicate')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              <Trash2 />
              {tCommon('delete')}
            </DropdownMenuItem>
          </>
        }
      />

      <DetailSection title={t('promptContentTitle')}>
        <div
          className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 px-4 py-3 font-mono text-xs leading-relaxed"
          data-testid="prompt-content"
        >
          {prompt.content}
        </div>
      </DetailSection>

      <DetailSection title={t('contactDetails')}>
        <DetailList
          items={[
            { label: t('promptType'), value: typeLabel },
            { label: tPrompts('category'), value: prompt.category || t('uncategorized') },
            {
              label: t('promptLength'),
              value: t('characterCount', { count: prompt.content.length }),
            },
            { label: t('updatedAt'), value: formatConversationTimestamp(prompt.updated_at) },
          ]}
        />
      </DetailSection>

      {prompt.is_system && (
        <DetailSection title={t('usedInConversations')}>
          <RecentConversations
            conversations={conversations}
            isLoading={isLoading}
            emptyText={t('noPromptConversations')}
            onOpen={(id) => {
              void handlers.handleConversationClick(id)
              onChatOpened()
            }}
          />
        </DetailSection>
      )}

      <PromptDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        prompt={prompt}
        mode="edit"
      />

      <DeletePromptDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        promptName={prompt.name}
        onConfirm={() => {
          clearPrompt()
          void handlers.handlePromptDelete(listItem)
        }}
      />
    </DetailPage>
  )
}
