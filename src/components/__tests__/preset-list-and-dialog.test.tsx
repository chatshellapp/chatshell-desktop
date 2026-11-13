import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PresetList } from '@/components/preset-list'
import { PresetDialog } from '@/components/preset-dialog'
import { usePresetStore } from '@/stores/presetStore'
import type { ModelParameterPreset } from '@/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// The Radix slider measures itself with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const NOW = '2026-01-01T00:00:00Z'
const make = (id: string, overrides: Partial<ModelParameterPreset> = {}): ModelParameterPreset => ({
  id,
  name: id,
  is_system: false,
  is_default: false,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
})

describe('PresetList', () => {
  const handlers = () => ({
    onPresetClick: vi.fn(),
    onPresetActivate: vi.fn(),
    onPresetSetDefault: vi.fn(),
    onPresetEdit: vi.fn(),
  })
  const row = (name: string) => screen.getByText(name).closest('[role="button"]') as HTMLElement

  it('groups custom presets before built-in ones and marks the default', () => {
    render(
      <PresetList
        presets={[make('Balanced', { is_system: true, is_default: true }), make('Mine')]}
        {...handlers()}
      />
    )

    const groups = screen.getAllByText(/myPresets|builtInPresets/).map((el) => el.textContent)
    expect(groups).toEqual(['myPresets', 'builtInPresets'])
    expect(screen.getByText('defaultPresetBadge')).toBeInTheDocument()
  })

  it('shows an empty state when there are no custom presets', () => {
    render(<PresetList presets={[make('Balanced', { is_system: true })]} {...handlers()} />)
    expect(screen.getByText('noCustomPresets')).toBeInTheDocument()
  })

  it('selects on click and starts a chat on double-click and Enter', () => {
    const h = handlers()
    render(<PresetList presets={[make('Mine')]} {...h} />)

    fireEvent.click(row('Mine'))
    expect(h.onPresetClick).toHaveBeenCalledTimes(1)

    fireEvent.doubleClick(row('Mine'))
    fireEvent.keyDown(row('Mine'), { key: 'Enter' })
    expect(h.onPresetActivate).toHaveBeenCalledTimes(2)
  })

  it('offers edit only for custom presets', () => {
    const h = handlers()
    render(<PresetList presets={[make('Mine'), make('Balanced', { is_system: true })]} {...h} />)

    const [mineMenu, builtInMenu] = screen.getAllByRole('button', { name: 'moreActions' })
    fireEvent.pointerDown(mineMenu, { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole('menuitem', { name: 'edit' }))
    expect(h.onPresetEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'Mine' }))

    fireEvent.pointerDown(builtInMenu, { button: 0, ctrlKey: false })
    expect(screen.queryByRole('menuitem', { name: 'edit' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'setAsDefault' }))
    expect(h.onPresetSetDefault).toHaveBeenCalledWith(expect.objectContaining({ id: 'Balanced' }))
  })
})

describe('PresetDialog', () => {
  let createPreset: ReturnType<typeof vi.fn>
  let updatePreset: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createPreset = vi.fn().mockResolvedValue(make('new'))
    updatePreset = vi.fn().mockResolvedValue(make('p-1'))
    usePresetStore.setState({
      createPreset: createPreset as never,
      updatePreset: updatePreset as never,
    })
  })

  it('requires a name', () => {
    render(<PresetDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    expect(screen.getByText('nameIsRequired')).toBeInTheDocument()
    expect(createPreset).not.toHaveBeenCalled()
  })

  it('creates a preset with only the enabled parameters', async () => {
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    render(<PresetDialog open onOpenChange={onOpenChange} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText(/name/), { target: { value: 'Fast' } })
    // Turn top_p off and max tokens on
    fireEvent.click(screen.getByRole('switch', { name: 'topP' }))
    fireEvent.click(screen.getByRole('switch', { name: 'maxTokens' }))
    fireEvent.click(screen.getByRole('switch', { name: 'setAsDefaultForNewAssistants' }))
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() =>
      expect(createPreset).toHaveBeenCalledWith({
        name: 'Fast',
        description: undefined,
        temperature: 0.7,
        max_tokens: 4096,
        is_default: true,
      })
    )
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('clears switched-off parameters when editing', async () => {
    render(
      <PresetDialog
        open
        onOpenChange={vi.fn()}
        preset={make('p-1', { name: 'Old', temperature: 0.4, top_p: 0.9 })}
      />
    )

    expect(screen.queryByRole('switch', { name: 'setAsDefaultForNewAssistants' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'temperature' }))
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() =>
      expect(updatePreset).toHaveBeenCalledWith('p-1', {
        name: 'Old',
        description: null,
        temperature: null,
        top_p: 0.9,
        max_tokens: null,
        frequency_penalty: null,
        presence_penalty: null,
      })
    )
  })

  it('shows backend errors and stays open', async () => {
    createPreset.mockRejectedValue('UNIQUE constraint failed: name')
    const onOpenChange = vi.fn()
    render(<PresetDialog open onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText(/name/), { target: { value: 'Dup' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))

    expect(await screen.findByText(/UNIQUE constraint/)).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
