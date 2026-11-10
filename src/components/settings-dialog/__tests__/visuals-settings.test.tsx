import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import i18n from '@/lib/i18n'
import { RENDER_OPENUI_BLOCKS_SETTING } from '@/lib/openui/settings'
import { RENDER_SVG_FIGURES_SETTING } from '@/lib/svg-figure'
import { useSettingsStore } from '@/stores/settingsStore'
import { VisualsSettings } from '../visuals-settings'

void i18n

const saveSetting = vi.fn(() => Promise.resolve())

beforeEach(() => {
  saveSetting.mockClear()
  useSettingsStore.setState({ settings: {}, saveSetting })
})

describe('Settings > Visuals', () => {
  it('turns OpenUI blocks and SVG figures on by default', () => {
    render(<VisualsSettings />)
    expect(screen.getByRole('switch', { name: /OpenUI/ })).toBeChecked()
    expect(screen.getByRole('switch', { name: /SVG/ })).toBeChecked()
  })

  it('saves "false" when a switch is turned off', () => {
    render(<VisualsSettings />)
    fireEvent.click(screen.getByRole('switch', { name: /OpenUI/ }))
    expect(saveSetting).toHaveBeenCalledWith(RENDER_OPENUI_BLOCKS_SETTING, 'false')
    fireEvent.click(screen.getByRole('switch', { name: /SVG/ }))
    expect(saveSetting).toHaveBeenCalledWith(RENDER_SVG_FIGURES_SETTING, 'false')
  })

  it('shows a saved "false" as off', () => {
    useSettingsStore.setState({ settings: { [RENDER_OPENUI_BLOCKS_SETTING]: 'false' } })
    render(<VisualsSettings />)
    expect(screen.getByRole('switch', { name: /OpenUI/ })).not.toBeChecked()
  })
})
