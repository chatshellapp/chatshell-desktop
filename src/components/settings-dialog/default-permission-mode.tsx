// Default permission mode for new conversations (device setting
// `default_permission_mode`). Fresh installs start in `ask`; `auto` is
// offered only where an OS sandbox exists; choosing `yolo` asks for
// confirmation, so new conversations never start unconfined by accident.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Shield, ShieldCheck, ShieldOff, ShieldHalf } from 'lucide-react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { SettingsCard } from './settings-card'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  DEFAULT_PERMISSION_MODE_KEY,
  defaultPermissionMode,
  displayedPermissionMode,
  useSandboxAvailable,
} from '@/lib/permission-mode'
import type { PermissionMode } from '@/types'

const ICONS: Record<PermissionMode, typeof Shield> = {
  ask: Shield,
  auto: ShieldCheck,
  yolo: ShieldOff,
}

export function DefaultPermissionMode() {
  const { t } = useTranslation('settings')
  const { t: tChat } = useTranslation('chat')
  const settings = useSettingsStore((state) => state.settings)
  const saveSetting = useSettingsStore((state) => state.saveSetting)
  const sandboxAvailable = useSandboxAvailable()
  const [confirmYolo, setConfirmYolo] = useState(false)

  const current = displayedPermissionMode(defaultPermissionMode(settings), sandboxAvailable)
  const modes: PermissionMode[] = sandboxAvailable ? ['ask', 'auto', 'yolo'] : ['ask', 'yolo']

  const select = (value: string) => {
    const mode = value as PermissionMode
    if (mode === current) return
    if (mode === 'yolo') {
      setConfirmYolo(true)
      return
    }
    void saveSetting(DEFAULT_PERMISSION_MODE_KEY, mode)
  }

  return (
    <SettingsCard
      icon={ShieldHalf}
      title={t('defaultPermissionMode')}
      description={t('defaultPermissionModeDescription')}
    >
      <RadioGroup value={current} onValueChange={select} className="grid gap-2">
        {modes.map((mode) => {
          const Icon = ICONS[mode]
          return (
            // The radio (16px) is centered on the 20px first line via mt-0.5.
            <div key={mode} className="flex items-start gap-3">
              <RadioGroupItem value={mode} id={`default-mode-${mode}`} className="mt-0.5" />
              <Label
                htmlFor={`default-mode-${mode}`}
                className="grid cursor-pointer gap-0.5 font-normal"
              >
                <span className="flex items-center gap-1.5 text-sm leading-5 font-medium">
                  <Icon className="size-4 text-muted-foreground" />
                  {tChat(`permission.mode.${mode}`)}
                </span>
                <span className="text-xs leading-4 text-muted-foreground">
                  {tChat(`permission.mode.${mode}Hint`)}
                </span>
              </Label>
            </div>
          )
        })}
      </RadioGroup>

      <AlertDialog open={confirmYolo} onOpenChange={setConfirmYolo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('defaultPermissionModeYoloTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{tChat('permission.escalateBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tChat('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void saveSetting(DEFAULT_PERMISSION_MODE_KEY, 'yolo')}
            >
              {tChat('permission.escalateConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  )
}
