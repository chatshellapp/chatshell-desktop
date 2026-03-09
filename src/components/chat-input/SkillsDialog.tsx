import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Zap, RotateCcw, ToggleLeft, ToggleRight, Info } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSkillStore } from '@/stores/skillStore'
import { isBuiltinSkill, isUserSkill } from '@/types/skill'

interface SkillsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  enabledSkillIds: string[]
  onSkillIdsChange: (skillIds: string[]) => void
  modelSupportsToolUse?: boolean | null
}

export function SkillsDialog({
  open,
  onOpenChange,
  enabledSkillIds,
  onSkillIdsChange,
  modelSupportsToolUse,
}: SkillsDialogProps) {
  const { t } = useTranslation(['chat', 'common'])
  const skills = useSkillStore((state) => state.skills)
  const ensureLoaded = useSkillStore((state) => state.ensureLoaded)

  React.useEffect(() => {
    if (open) {
      ensureLoaded()
    }
  }, [open, ensureLoaded])

  const builtinSkills = skills.filter((s) => isBuiltinSkill(s))
  const userSkills = skills.filter((s) => isUserSkill(s))

  // "Global default" = all globally enabled skills
  const globalEnabledIds = React.useMemo(
    () => skills.filter((s) => s.is_enabled).map((s) => s.id),
    [skills]
  )

  // All skill IDs that are available (globally enabled)
  const allAvailableIds = globalEnabledIds

  const isDifferentFromGlobal = React.useMemo(() => {
    if (enabledSkillIds.length !== globalEnabledIds.length) return true
    const sortedCurrent = [...enabledSkillIds].sort()
    const sortedGlobal = [...globalEnabledIds].sort()
    return !sortedCurrent.every((id, index) => id === sortedGlobal[index])
  }, [enabledSkillIds, globalEnabledIds])

  const handleToggleSkill = (skillId: string, checked: boolean) => {
    if (checked) {
      onSkillIdsChange([...enabledSkillIds, skillId])
    } else {
      onSkillIdsChange(enabledSkillIds.filter((id) => id !== skillId))
    }
  }

  const handleResetToGlobal = () => {
    onSkillIdsChange(globalEnabledIds)
  }

  const handleEnableAll = () => {
    onSkillIdsChange(allAvailableIds)
  }

  const handleDisableAll = () => {
    onSkillIdsChange([])
  }

  const hasNoSkills = builtinSkills.length === 0 && userSkills.length === 0

  // Check if all available (globally enabled) skills are enabled/disabled for this conversation
  const allEnabled =
    allAvailableIds.length > 0 && allAvailableIds.every((id) => enabledSkillIds.includes(id))
  const noneEnabled =
    allAvailableIds.length > 0 && !allAvailableIds.some((id) => enabledSkillIds.includes(id))

  const renderSkillItem = (skill: (typeof skills)[number]) => {
    const isGloballyDisabled = !skill.is_enabled
    const isConversationEnabled = enabledSkillIds.includes(skill.id)

    return (
      <div
        key={skill.id}
        className={`flex items-center justify-between py-2 pl-2 ${isGloballyDisabled ? 'opacity-50' : ''}`}
      >
        <div className="grid gap-1">
          <Label
            htmlFor={skill.id}
            className={`text-sm font-medium leading-none ${isGloballyDisabled ? 'text-muted-foreground' : ''}`}
          >
            {skill.icon ? `${skill.icon} ` : ''}
            {skill.name}
          </Label>
          {skill.description && (
            <p className="text-xs text-muted-foreground max-w-[280px]">{skill.description}</p>
          )}
          {isGloballyDisabled && (
            <p className="text-xs text-muted-foreground/70 italic">
              {t('skillsDisabledInSettings')}
            </p>
          )}
        </div>
        {isGloballyDisabled ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Switch id={skill.id} checked={false} disabled />
              </div>
            </TooltipTrigger>
            <TooltipContent>{t('skillsEnableInSettingsFirst')}</TooltipContent>
          </Tooltip>
        ) : (
          <Switch
            id={skill.id}
            checked={isConversationEnabled}
            onCheckedChange={(checked) => handleToggleSkill(skill.id, checked === true)}
          />
        )}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] max-h-[70vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            {t('skills')}
          </DialogTitle>
          <DialogDescription>{t('skillsDescription')}</DialogDescription>
        </DialogHeader>

        {modelSupportsToolUse === false && (
          <div className="mx-6 mt-1 flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{t('toolsUnsupportedByModelBanner')}</span>
          </div>
        )}

        {/* Enable All / Disable All buttons */}
        {!hasNoSkills && allAvailableIds.length > 0 && (
          <div className="flex gap-2 px-6 pb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEnableAll}
              disabled={allEnabled}
              className="gap-1.5"
            >
              <ToggleRight className="h-3.5 w-3.5" />
              {t('common:enableAll')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisableAll}
              disabled={noneEnabled}
              className="gap-1.5"
            >
              <ToggleLeft className="h-3.5 w-3.5" />
              {t('common:disableAll')}
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0 grid gap-4">
          {hasNoSkills ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t('noSkillsAvailable')}
            </p>
          ) : (
            <>
              {/* Builtin Skills Section */}
              {builtinSkills.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    {t('builtinSkills')}
                  </h4>
                  {builtinSkills.map(renderSkillItem)}
                </div>
              )}

              {/* Separator between sections */}
              {builtinSkills.length > 0 && userSkills.length > 0 && <Separator />}

              {/* User Skills Section */}
              {userSkills.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    {t('userSkills')}
                  </h4>
                  {userSkills.map(renderSkillItem)}
                </div>
              )}
            </>
          )}
        </div>

        {isDifferentFromGlobal && (
          <div className="px-6 pb-6">
            <Separator className="mb-4" />
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={handleResetToGlobal} className="gap-2">
                <RotateCcw className="h-4 w-4" />
                {t('resetToGlobalSettings')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
