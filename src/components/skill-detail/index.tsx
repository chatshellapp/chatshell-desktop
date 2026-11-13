import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Cloud,
  CloudDownload,
  EyeOff,
  FolderOpen,
  MonitorSmartphone,
  Pencil,
  Power,
  PowerOff,
  Trash2,
  Zap,
} from 'lucide-react'
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
import {
  CollapsibleText,
  DetailHeader,
  DetailList,
  DetailPage,
  DetailSection,
} from '@/components/detail-page'
import { SkillEditDialog } from '@/components/skill-edit-dialog'
import { useSkillActions } from '@/hooks/useSkills'
import { useSkillStore } from '@/stores/skillStore'
import { useLibrarySelectionStore } from '@/stores/librarySelectionStore'
import { isChatShellSkill, isSkillAvailable, isSyncedSkill, type Skill } from '@/types'

interface SkillDetailProps {
  skill: Skill
}

/**
 * Library skill page. Skills have no "use" action: every enabled skill is
 * offered to the model in new chats (unless its SKILL.md opts out).
 */
export function SkillDetail({ skill }: SkillDetailProps) {
  const { t } = useTranslation('skills')
  const { t: tCommon } = useTranslation('common')
  const actions = useSkillActions()
  const readSkillContent = useSkillStore((state) => state.readSkillContent)
  const clearSkill = useLibrarySelectionStore((state) => state.clearSkill)
  const [content, setContent] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [showEditDialog, setShowEditDialog] = React.useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)

  const available = isSkillAvailable(skill)
  const ownSkill = isChatShellSkill(skill)
  const sourceLabel = t(`sourceLabels.${skill.source}` as never, { defaultValue: skill.source })

  // Reload SKILL.md when the files change underneath (edit, sync, rescan).
  React.useEffect(() => {
    if (!available) return
    let cancelled = false
    setLoadError(null)
    readSkillContent(skill.id)
      .then((text) => !cancelled && setContent(text))
      .catch((err) => !cancelled && setLoadError(String(err)))
    return () => {
      cancelled = true
    }
  }, [available, skill.id, skill.content_hash, readSkillContent])

  // The filled button is the common action: turning a disabled skill back
  // on, otherwise editing your own skill or opening another agent's
  // folder. Disabling is rare and stays in the menu.
  const canEdit = ownSkill && available
  const primary: 'enable' | 'edit' | 'openFolder' | null = !skill.is_enabled
    ? 'enable'
    : canEdit
      ? 'edit'
      : available
        ? 'openFolder'
        : null
  const primaryAction =
    primary === 'enable'
      ? {
          label: t('enable'),
          icon: <Power />,
          onClick: () => void actions.toggleSkill(skill),
        }
      : primary === 'edit'
        ? { label: tCommon('edit'), icon: <Pencil />, onClick: () => setShowEditDialog(true) }
        : primary === 'openFolder'
          ? {
              label: t('openFolder'),
              icon: <FolderOpen />,
              onClick: () => void actions.openSkillFolder(skill),
            }
          : undefined

  const handleDelete = async () => {
    if (await actions.deleteSkill(skill)) clearSkill()
  }

  const files = skill.files_manifest

  return (
    <DetailPage>
      <DetailHeader
        avatar={
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-3xl">
            {skill.icon ?? <Zap className="size-8 text-muted-foreground" />}
          </div>
        }
        name={skill.name}
        subtitle={skill.description}
        badges={
          <>
            <Badge variant="secondary">{sourceLabel}</Badge>
            {isSyncedSkill(skill) ? (
              <Badge variant="outline" className="gap-1">
                <Cloud className="size-3" />
                {t('synced')}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <MonitorSmartphone className="size-3" />
                {t('thisDeviceOnly')}
              </Badge>
            )}
            {!available && (
              <Badge variant="outline" className="gap-1">
                <CloudDownload className="size-3" />
                {t('notOnThisDevice')}
              </Badge>
            )}
            {!skill.is_enabled && <Badge variant="outline">{t('disabled')}</Badge>}
            {!skill.allow_model_invocation && (
              <Badge variant="outline" className="gap-1">
                <EyeOff className="size-3" />
                {t('hiddenFromModel')}
              </Badge>
            )}
          </>
        }
        primaryAction={primaryAction}
        menuItems={
          <>
            {canEdit && primary !== 'edit' && (
              <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
                <Pencil />
                {tCommon('edit')}
              </DropdownMenuItem>
            )}
            {available && primary !== 'openFolder' && (
              <DropdownMenuItem onClick={() => void actions.openSkillFolder(skill)}>
                <FolderOpen />
                {t('openFolder')}
              </DropdownMenuItem>
            )}
            {skill.is_enabled && (
              <DropdownMenuItem onClick={() => void actions.toggleSkill(skill)}>
                <PowerOff />
                {t('disable')}
              </DropdownMenuItem>
            )}
            {ownSkill && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                  <Trash2 />
                  {tCommon('delete')}
                </DropdownMenuItem>
              </>
            )}
          </>
        }
      />

      <DetailSection title={t('instructions')}>
        {!available ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t('notOnThisDeviceDescription')}
          </p>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : content === null ? (
          <p className="text-sm text-muted-foreground">{t('loadingContent')}</p>
        ) : (
          <CollapsibleText text={content} />
        )}
        {!ownSkill && available && (
          <p className="text-xs text-muted-foreground">{t('readOnlyHint')}</p>
        )}
      </DetailSection>

      <DetailSection title={t('details')}>
        <DetailList
          items={[
            { label: t('source'), value: sourceLabel },
            { label: t('folder'), value: skill.local_path ?? skill.path },
            {
              label: t('requiredTools'),
              value:
                skill.required_tool_ids.length > 0 ? skill.required_tool_ids.join(', ') : undefined,
            },
            {
              label: t('offeredToModel'),
              value: !skill.allow_model_invocation
                ? t('offeredNoOptOut')
                : skill.is_enabled
                  ? t('offeredYes')
                  : t('offeredNoDisabled'),
            },
          ]}
        />
      </DetailSection>

      {files.length > 0 && (
        <DetailSection title={`${t('files')} · ${t('fileCount', { count: files.length })}`}>
          <ul className="divide-y rounded-lg border font-mono text-xs">
            {files.map((file) => (
              <li key={file.path} className="flex gap-4 px-4 py-2">
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      {ownSkill && (
        <SkillEditDialog open={showEditDialog} onOpenChange={setShowEditDialog} skill={skill} />
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle', { name: skill.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDescription')}</AlertDialogDescription>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
