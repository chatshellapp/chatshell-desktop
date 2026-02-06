import * as React from 'react'
import { Zap, RotateCcw } from 'lucide-react'
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
import { useSkillStore } from '@/stores/skillStore'
import { isBuiltinSkill, isUserSkill } from '@/types/skill'

interface SkillsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  enabledSkillIds: string[]
  onSkillIdsChange: (skillIds: string[]) => void
}

export function SkillsDialog({
  open,
  onOpenChange,
  enabledSkillIds,
  onSkillIdsChange,
}: SkillsDialogProps) {
  const skills = useSkillStore((state) => state.skills)
  const ensureLoaded = useSkillStore((state) => state.ensureLoaded)

  React.useEffect(() => {
    if (open) {
      ensureLoaded()
    }
  }, [open, ensureLoaded])

  // Separate builtin and user skills (only show globally enabled ones)
  const builtinSkills = skills.filter((s) => isBuiltinSkill(s) && s.is_enabled)
  const userSkills = skills.filter((s) => isUserSkill(s) && s.is_enabled)

  // "Global default" = all globally enabled skills
  const globalEnabledIds = React.useMemo(
    () => [...builtinSkills, ...userSkills].map((s) => s.id),
    [builtinSkills, userSkills],
  )

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

  const hasNoSkills = builtinSkills.length === 0 && userSkills.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] max-h-[70vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Skills
          </DialogTitle>
          <DialogDescription>
            Select which skills to enable for this conversation. Skills inject specialized
            instructions and can auto-enable required tools.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0 grid gap-4">
          {hasNoSkills ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No skills available. Add skill files to the skills directory or enable existing ones in
              Settings.
            </p>
          ) : (
            <>
              {/* Builtin Skills Section */}
              {builtinSkills.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Built-in Skills
                  </h4>
                  {builtinSkills.map((skill) => (
                    <div key={skill.id} className="flex items-center justify-between py-2 pl-2">
                      <div className="grid gap-1">
                        <Label htmlFor={skill.id} className="text-sm font-medium leading-none">
                          {skill.icon ? `${skill.icon} ` : ''}
                          {skill.name}
                        </Label>
                        {skill.description && (
                          <p className="text-xs text-muted-foreground max-w-[280px]">
                            {skill.description}
                          </p>
                        )}
                      </div>
                      <Switch
                        id={skill.id}
                        checked={enabledSkillIds.includes(skill.id)}
                        onCheckedChange={(checked) =>
                          handleToggleSkill(skill.id, checked === true)
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Separator between sections */}
              {builtinSkills.length > 0 && userSkills.length > 0 && <Separator />}

              {/* User Skills Section */}
              {userSkills.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    User Skills
                  </h4>
                  {userSkills.map((skill) => (
                    <div key={skill.id} className="flex items-center justify-between py-2 pl-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor={skill.id} className="text-sm font-medium leading-none">
                          {skill.icon ? `${skill.icon} ` : ''}
                          {skill.name}
                        </Label>
                        {skill.description && (
                          <p className="text-xs text-muted-foreground max-w-[280px]">
                            {skill.description}
                          </p>
                        )}
                      </div>
                      <Switch
                        id={skill.id}
                        checked={enabledSkillIds.includes(skill.id)}
                        onCheckedChange={(checked) =>
                          handleToggleSkill(skill.id, checked === true)
                        }
                      />
                    </div>
                  ))}
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
                Reset to Global Settings
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
