import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Zap, RotateCcw, ToggleLeft, ToggleRight, Info, Search } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSkillStore } from '@/stores/skillStore'
import { getSkillsBySource, SKILL_SOURCE_ORDER } from '@/types/skill'
import type { SkillSource } from '@/types/skill'

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
  const [searchQuery, setSearchQuery] = React.useState('')

  React.useEffect(() => {
    if (open) {
      ensureLoaded()
    } else {
      setSearchQuery('')
    }
  }, [open, ensureLoaded])

  const query = searchQuery.toLowerCase().trim()
  const filteredSkills = query
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          (s.description && s.description.toLowerCase().includes(query))
      )
    : skills

  const sourceLabelMap: Record<SkillSource, string> = {
    builtin: t('builtinSkills'),
    user: t('userSkills'),
    claude: t('claudeSkills'),
    agents: t('agentSkills'),
  }

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

  const hasNoSkills = skills.length === 0

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
            <p
              className="text-xs text-muted-foreground max-w-[280px] line-clamp-2"
              title={skill.description}
            >
              {skill.description}
            </p>
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

        {!hasNoSkills && (
          <div className="px-6 pb-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('common:search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-8 text-sm"
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0 grid gap-4">
          {hasNoSkills ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t('noSkillsAvailable')}
            </p>
          ) : filteredSkills.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t('common:noResults')}
            </p>
          ) : (
            <>
              {SKILL_SOURCE_ORDER.map((source, idx) => {
                const sourceSkills = getSkillsBySource(filteredSkills, source)
                if (sourceSkills.length === 0) return null
                return (
                  <React.Fragment key={source}>
                    {idx > 0 &&
                      SKILL_SOURCE_ORDER.slice(0, idx).some(
                        (prev) => getSkillsBySource(filteredSkills, prev).length > 0
                      ) && <Separator />}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Zap className="h-4 w-4" />
                        {sourceLabelMap[source] ?? source}
                      </h4>
                      {sourceSkills.map(renderSkillItem)}
                    </div>
                  </React.Fragment>
                )
              })}
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
