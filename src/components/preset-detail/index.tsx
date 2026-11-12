import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, MessageSquarePlus, Pencil, SlidersHorizontal, Star, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AssistantAvatar } from '@/components/assistant-avatar'
import { PresetDialog } from '@/components/preset-dialog'
import {
  DetailHeader,
  DetailList,
  DetailPage,
  DetailSection,
  RecentConversations,
} from '@/components/detail-page'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import { useSidebarHandlers } from '@/hooks/useSidebarHandlers'
import { usePresetActions, usePresetAssistants, usePresetConversations } from '@/hooks/usePresets'
import { PRESET_PARAMETERS } from '@/lib/preset-utils'
import { getAssistantAvatarImage } from '@/lib/assistant-utils'
import type { Assistant, ModelParameterPreset } from '@/types'

interface PresetDetailProps {
  preset: ModelParameterPreset
  /** Called after a chat was opened from this page, to leave it */
  onChatOpened: () => void
  /** Open an assistant that uses this preset */
  onOpenAssistant: (assistant: Assistant) => void
}

export function PresetDetail({ preset, onChatOpened, onOpenAssistant }: PresetDetailProps) {
  const { t } = useTranslation('sidebar')
  const { t: tCommon } = useTranslation('common')
  const { t: tChat } = useTranslation('chat')
  const handlers = useSidebarHandlers()
  const actions = usePresetActions()
  const selectPreset = useLibrarySelectionStore((state) => state.selectPreset)
  const clearPreset = useLibrarySelectionStore((state) => state.clearPreset)
  const assistants = usePresetAssistants(preset.id)
  const { conversations, isLoading } = usePresetConversations(preset.id)
  const [showEditDialog, setShowEditDialog] = React.useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)

  // Mirrors the backend guards so the reason is visible before trying
  const deleteBlockedReason = preset.is_system
    ? null
    : preset.is_default
      ? t('presetDeleteBlockedDefault')
      : assistants.length > 0
        ? t('presetDeleteBlockedInUse', { count: assistants.length })
        : null

  const handleDuplicate = async () => {
    const copy = await actions.duplicatePreset(preset, t('presetCopyName', { name: preset.name }))
    if (copy) selectPreset(copy.id)
  }

  const handleDelete = async () => {
    if (await actions.deletePreset(preset)) clearPreset()
  }

  const additionalParams =
    preset.additional_params !== undefined && preset.additional_params !== null
      ? JSON.stringify(preset.additional_params, null, 2)
      : null

  return (
    <DetailPage>
      <DetailHeader
        avatar={
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
            <SlidersHorizontal className="size-8 text-muted-foreground" />
          </div>
        }
        name={preset.name}
        subtitle={preset.description}
        badges={
          <>
            <Badge variant="secondary">
              {preset.is_system ? t('builtInPreset') : t('customPreset')}
            </Badge>
            {preset.is_default && <Badge variant="outline">{t('defaultPresetBadge')}</Badge>}
          </>
        }
        primaryAction={{
          label: t('useInNewChat'),
          icon: <MessageSquarePlus />,
          onClick: () => {
            void actions.startChatWithPreset(preset)
            onChatOpened()
          },
        }}
        menuItems={
          <>
            {!preset.is_system && (
              <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
                <Pencil />
                {tCommon('edit')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => void handleDuplicate()}>
              <Copy />
              {t('duplicate')}
            </DropdownMenuItem>
            {!preset.is_default && (
              <DropdownMenuItem onClick={() => void actions.setDefaultPreset(preset)}>
                <Star />
                {t('setAsDefault')}
              </DropdownMenuItem>
            )}
            {!preset.is_system && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!!deleteBlockedReason}
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 />
                  {tCommon('delete')}
                </DropdownMenuItem>
                {deleteBlockedReason && (
                  <p className="max-w-56 px-2 pb-1.5 text-xs text-muted-foreground">
                    {deleteBlockedReason}
                  </p>
                )}
              </>
            )}
          </>
        }
      />

      <DetailSection title={t('presetParameters')}>
        <DetailList
          items={PRESET_PARAMETERS.map(({ key, labelKey }) => {
            const value = preset[key]
            return {
              label: tChat(labelKey),
              value:
                value === undefined || value === null ? (
                  <span className="text-muted-foreground">{t('providerDefault')}</span>
                ) : (
                  String(value)
                ),
            }
          })}
        />
        {preset.is_system && (
          <p className="text-xs text-muted-foreground">{t('builtInPresetHint')}</p>
        )}
      </DetailSection>

      {additionalParams && (
        <DetailSection title={t('additionalParameters')}>
          <pre className="overflow-x-auto rounded-lg border bg-muted/30 px-4 py-3 font-mono text-xs">
            {additionalParams}
          </pre>
        </DetailSection>
      )}

      <DetailSection title={t('usedByAssistants')}>
        {assistants.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {assistants.map((assistant) => (
              <li key={assistant.id}>
                <button
                  type="button"
                  onClick={() => onOpenAssistant(assistant)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                >
                  <AssistantAvatar
                    logo={getAssistantAvatarImage(assistant)}
                    avatarBg={assistant.avatar_bg || '#3b82f6'}
                    avatarText={assistant.avatar_text || assistant.name.charAt(0)}
                    name={assistant.name}
                    size="sm"
                  />
                  <span className="flex-1 truncate font-medium">{assistant.name}</span>
                  {assistant.role && (
                    <span className="truncate text-xs text-muted-foreground">{assistant.role}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t('noPresetAssistants')}
          </p>
        )}
      </DetailSection>

      <DetailSection title={t('usedInConversations')}>
        <RecentConversations
          conversations={conversations}
          isLoading={isLoading}
          emptyText={t('noPresetConversations')}
          onOpen={(id) => {
            void handlers.handleConversationClick(id)
            onChatOpened()
          }}
        />
      </DetailSection>

      {!preset.is_system && (
        <PresetDialog open={showEditDialog} onOpenChange={setShowEditDialog} preset={preset} />
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deletePreset')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmDeletePreset', { name: `"${preset.name}"` })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DetailPage>
  )
}
