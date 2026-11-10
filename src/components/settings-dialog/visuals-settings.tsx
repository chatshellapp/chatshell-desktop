// Settings > Visuals: which visual formats the assistant may draw inline in
// its answers. Each switch both renders its fences and tells the model it may
// use them (see `commands::visual_output`). Mermaid and math always render.
// Design: internal-docs/features/visual-output-formats.md.

import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { logger } from '@/lib/logger'
import { isOpenUiBlocksEnabled, RENDER_OPENUI_BLOCKS_SETTING } from '@/lib/openui/settings'
import { RENDER_SVG_FIGURES_SETTING } from '@/lib/svg-figure'
import { useSettingsStore } from '@/stores/settingsStore'

interface VisualSwitchProps {
  id: string
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

function VisualSwitch({ id, label, description, checked, onCheckedChange }: VisualSwitchProps) {
  return (
    <div className="flex items-center justify-between gap-4 max-w-md">
      <div className="grid gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export function VisualsSettings() {
  const { t } = useTranslation('settings')
  const saveSetting = useSettingsStore((state) => state.saveSetting)
  const svgFigures = useSettingsStore(
    (state) => state.settings[RENDER_SVG_FIGURES_SETTING] !== 'false'
  )
  const openUiBlocks = useSettingsStore((state) =>
    isOpenUiBlocksEnabled(state.settings[RENDER_OPENUI_BLOCKS_SETTING])
  )

  const save = (key: string, checked: boolean) => {
    saveSetting(key, checked ? 'true' : 'false').catch((error) =>
      logger.error(`Failed to save setting ${key}:`, error)
    )
  }

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground max-w-md">{t('visualsSectionDescription')}</p>
      <VisualSwitch
        id="render-openui-blocks"
        label={t('renderOpenUiBlocksLabel')}
        description={t('renderOpenUiBlocksDescription')}
        checked={openUiBlocks}
        onCheckedChange={(checked) => save(RENDER_OPENUI_BLOCKS_SETTING, checked)}
      />
      <VisualSwitch
        id="render-svg-figures"
        label={t('renderSvgFiguresLabel')}
        description={t('renderSvgFiguresDescription')}
        checked={svgFigures}
        onCheckedChange={(checked) => save(RENDER_SVG_FIGURES_SETTING, checked)}
      />
    </div>
  )
}
