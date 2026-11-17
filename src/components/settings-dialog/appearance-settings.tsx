// Settings > Appearance: Light, Dark, or System theme. The choice is stored
// per device and applied immediately (see `lib/theme`).

import { Check, ChevronDown, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { THEME_PREFERENCES, useThemeStore, type ThemePreference } from '@/lib/theme'

const THEME_OPTIONS: Record<ThemePreference, { labelKey: string; icon: LucideIcon }> = {
  system: { labelKey: 'themeSystem', icon: Monitor },
  light: { labelKey: 'themeLight', icon: Sun },
  dark: { labelKey: 'themeDark', icon: Moon },
}

export function AppearanceSettings() {
  const { t } = useTranslation('settings')
  const preference = useThemeStore((state) => state.preference)
  const setPreference = useThemeStore((state) => state.setPreference)
  const current = THEME_OPTIONS[preference]
  const CurrentIcon = current.icon

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Label>{t('theme')}</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full max-w-md justify-between">
              <span className="flex items-center gap-2">
                <CurrentIcon className="h-4 w-4 text-muted-foreground" />
                {t(current.labelKey)}
              </span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[400px]">
            {THEME_PREFERENCES.map((option) => {
              const { labelKey, icon: Icon } = THEME_OPTIONS[option]
              const selected = option === preference
              return (
                <DropdownMenuItem key={option} onClick={() => setPreference(option)}>
                  <div className="flex w-full items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className={selected ? 'font-medium' : ''}>{t(labelKey)}</span>
                    {selected && <Check className="ml-auto h-4 w-4 text-primary" />}
                  </div>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="text-xs text-muted-foreground max-w-md">{t('themeDescription')}</p>
      </div>
    </div>
  )
}
