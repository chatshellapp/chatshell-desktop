import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ParameterSlider } from '@/components/parameter-slider'
import { usePresetStore } from '@/stores/presetStore'
import {
  emptyPresetForm,
  formToCreateRequest,
  formToUpdateRequest,
  PRESET_PARAMETERS,
  presetToForm,
  type PresetFormValues,
} from '@/lib/preset-utils'
import { logger } from '@/lib/logger'
import { PARAMETER_LIMITS } from '@/types'
import type { ModelParameterPreset } from '@/types'

interface PresetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preset to edit; omit to create a new one */
  preset?: ModelParameterPreset | null
  /** Called with the saved preset after a successful create or edit */
  onSaved?: (preset: ModelParameterPreset) => void
}

export function PresetDialog({ open, onOpenChange, preset, onSaved }: PresetDialogProps) {
  const { t } = useTranslation('sidebar')
  const { t: tCommon } = useTranslation('common')
  const { t: tChat } = useTranslation('chat')
  const createPreset = usePresetStore((state) => state.createPreset)
  const updatePreset = usePresetStore((state) => state.updatePreset)
  const isEdit = !!preset
  const [form, setForm] = React.useState<PresetFormValues>(emptyPresetForm)
  const [makeDefault, setMakeDefault] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setForm(preset ? presetToForm(preset) : emptyPresetForm())
    setMakeDefault(false)
    setError(null)
  }, [open, preset])

  const setParameter = (key: keyof PresetFormValues['parameters'], value: number | undefined) =>
    setForm((current) => {
      const parameters = { ...current.parameters }
      if (value === undefined) delete parameters[key]
      else parameters[key] = value
      return { ...current, parameters }
    })

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError(tCommon('nameIsRequired'))
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const saved = preset
        ? await updatePreset(preset.id, formToUpdateRequest(form))
        : await createPreset({ ...formToCreateRequest(form), is_default: makeDefault })
      onSaved?.(saved)
      onOpenChange(false)
    } catch (err) {
      logger.error('Failed to save preset:', err)
      setError(String(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('editPreset') : t('newPreset')}</DialogTitle>
          <DialogDescription>{t('presetDialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-5 overflow-y-auto px-1">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="preset-name">{tCommon('name')} *</Label>
            <Input
              id="preset-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('presetNamePlaceholder')}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="preset-description">{tCommon('description')}</Label>
            <Textarea
              id="preset-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('presetDescriptionPlaceholder')}
              rows={2}
            />
          </div>

          <div className="space-y-5">
            <p className="text-xs text-muted-foreground">{t('presetParametersHint')}</p>
            {PRESET_PARAMETERS.map(({ key, labelKey }) => {
              const limits = PARAMETER_LIMITS[key]
              const enabled = form.parameters[key] !== undefined
              return (
                <ParameterSlider
                  key={key}
                  label={tChat(labelKey)}
                  value={form.parameters[key]}
                  onChange={(v) => setParameter(key, key === 'max_tokens' ? Math.round(v) : v)}
                  enabled={enabled}
                  onEnabledChange={(on) => setParameter(key, on ? limits.defaultValue : undefined)}
                  unsetLabel={t('providerDefault')}
                  {...limits}
                />
              )
            })}
          </div>

          {!isEdit && (
            <div className="flex items-center gap-2">
              <Switch id="preset-default" checked={makeDefault} onCheckedChange={setMakeDefault} />
              <Label htmlFor="preset-default" className="font-normal">
                {t('setAsDefaultForNewAssistants')}
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
