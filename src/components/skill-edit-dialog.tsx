import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSkillStore } from '@/stores/skillStore'
import type { Skill } from '@/types'

/** Mirrors the backend's folder-name rule (`is_safe_dir_name`), kept stricter. */
const FOLDER_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/

interface SkillEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Skill to edit; omitted to create a new ChatShell skill */
  skill?: Skill | null
  /** Called with the new skill after a successful create */
  onCreated?: (skill: Skill) => void
}

/**
 * Create one of ChatShell's own skills, or edit its SKILL.md.
 */
export function SkillEditDialog({ open, onOpenChange, skill, onCreated }: SkillEditDialogProps) {
  const { t } = useTranslation('skills')
  const createSkill = useSkillStore((s) => s.createSkill)
  const saveSkillContent = useSkillStore((s) => s.saveSkillContent)
  const readSkillContent = useSkillStore((s) => s.readSkillContent)
  const isEdit = Boolean(skill)

  const [folder, setFolder] = React.useState('')
  const [content, setContent] = React.useState('')
  const [original, setOriginal] = React.useState<string | null>(null)
  const [contentTouched, setContentTouched] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Reset on open: a template for create, the current SKILL.md for edit.
  React.useEffect(() => {
    if (!open) return
    setError(null)
    setSaving(false)
    setContentTouched(false)
    if (skill) {
      setOriginal(null)
      let cancelled = false
      readSkillContent(skill.id)
        .then((text) => {
          if (cancelled) return
          setOriginal(text)
          setContent(text)
        })
        .catch((err) => !cancelled && setError(String(err)))
      return () => {
        cancelled = true
      }
    }
    setFolder('')
    setOriginal(null)
    setContent(t('template', { name: 'my-skill' }))
  }, [open, skill, readSkillContent, t])

  const folderValid = FOLDER_NAME.test(folder.trim())
  const canSave = isEdit
    ? original !== null && content !== original && content.trim() !== ''
    : folderValid && content.trim() !== ''

  const handleFolderChange = (value: string) => {
    setFolder(value)
    // Keep the template's name in step with the folder until the user
    // edits SKILL.md themselves.
    if (!contentTouched) {
      setContent(t('template', { name: value.trim() || 'my-skill' }))
    }
  }

  const handleSubmit = async () => {
    if (!content.trim()) {
      setError(t('contentRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (skill) {
        await saveSkillContent(skill.id, content)
        toast.success(t('saved'))
      } else {
        if (!folderValid) {
          setError(t('folderNameInvalid'))
          return
        }
        const created = await createSkill(folder.trim(), content)
        toast.success(t('created'))
        onCreated?.(created)
      }
      onOpenChange(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('editSkill') : t('newSkill')}</DialogTitle>
          <DialogDescription>
            {isEdit ? t('editSkillDescription') : t('newSkillDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto">
          {!isEdit && (
            <div className="grid gap-2">
              <Label htmlFor="skill-folder">{t('folderName')}</Label>
              <Input
                id="skill-folder"
                value={folder}
                autoFocus
                placeholder={t('folderNamePlaceholder')}
                onChange={(e) => handleFolderChange(e.target.value)}
                aria-invalid={folder.length > 0 && !folderValid}
              />
              <p className="text-xs text-muted-foreground">
                {folder.length > 0 && !folderValid ? t('folderNameInvalid') : t('folderNameHelp')}
              </p>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="skill-content">{t('instructions')}</Label>
            {isEdit && original === null && !error ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('loadingContent')}
              </p>
            ) : (
              <Textarea
                id="skill-content"
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  setContentTouched(true)
                }}
                className="min-h-[320px] font-mono text-xs"
              />
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving || !canSave}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {isEdit ? t('save') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
