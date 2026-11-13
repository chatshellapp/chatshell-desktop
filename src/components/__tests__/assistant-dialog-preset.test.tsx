import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AssistantDialog } from '@/components/assistant-dialog'
import { useAssistantStore } from '@/stores/assistantStore'
import { useModelStore } from '@/stores/modelStore'
import { usePromptStore } from '@/stores/promptStore'
import { useMcpStore } from '@/stores/mcpStore'
import { useSkillStore } from '@/stores/skillStore'
import { usePresetStore } from '@/stores/presetStore'
import type { Assistant, Model, ModelParameterPreset } from '@/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

// The dialog's sidebar layout checks the viewport width
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const NOW = '2026-01-01T00:00:00Z'
const model: Model = {
  id: 'model-1',
  provider_id: 'provider-1',
  name: 'GPT-4o',
  model_id: 'gpt-4o',
  is_starred: false,
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW,
}
const preset = (
  id: string,
  overrides: Partial<ModelParameterPreset> = {}
): ModelParameterPreset => ({
  id,
  name: id,
  temperature: 0.7,
  is_system: false,
  is_default: false,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
})
const assistant: Assistant = {
  id: 'assistant-1',
  name: 'Chef',
  system_prompt: 'You cook.',
  model_id: 'model-1',
  model_parameter_preset_id: 'Balanced',
  tool_ids: [],
  skill_ids: [],
  avatar_type: 'image',
  avatar_image_url: 'https://example.com/chef.png',
  is_starred: false,
  created_at: NOW,
  updated_at: NOW,
}

let createAssistant: ReturnType<typeof vi.fn>
let updateAssistant: ReturnType<typeof vi.fn>

const openModelSection = () => fireEvent.click(screen.getByText('common:model'))
const openPicker = () =>
  fireEvent.pointerDown(screen.getByTestId('preset-picker'), { button: 0, ctrlKey: false })

describe('AssistantDialog parameter preset', () => {
  beforeEach(() => {
    createAssistant = vi.fn().mockResolvedValue(assistant)
    updateAssistant = vi.fn().mockResolvedValue(assistant)
    useModelStore.setState({
      models: [model],
      providers: [],
      loadModels: vi.fn() as never,
    })
    useAssistantStore.setState({
      assistants: [assistant],
      createAssistant: createAssistant as never,
      updateAssistant: updateAssistant as never,
      lastCreatedModelId: null,
    })
    usePromptStore.setState({ prompts: [], ensureLoaded: vi.fn() as never })
    useMcpStore.setState({ servers: [], loadServers: vi.fn() as never })
    useSkillStore.setState({ skills: [], ensureLoaded: vi.fn() as never })
    usePresetStore.setState({
      presets: [
        preset('Balanced', { is_system: true, is_default: true }),
        preset('Focused', { temperature: 0.2 }),
      ],
      ensureLoaded: vi.fn() as never,
    })
  })

  it("shows the assistant's preset and saves a new choice", async () => {
    render(<AssistantDialog open onOpenChange={vi.fn()} assistant={assistant} mode="edit" />)
    openModelSection()

    expect(screen.getByTestId('preset-picker')).toHaveTextContent('Balanced')
    openPicker()
    expect(screen.getByText('T 0.2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Focused/ }))
    expect(screen.getByTestId('preset-picker')).toHaveTextContent('Focused')

    fireEvent.click(screen.getByRole('button', { name: 'common:saveChanges' }))

    await waitFor(() =>
      expect(updateAssistant).toHaveBeenCalledWith(
        'assistant-1',
        expect.objectContaining({
          model_parameter_preset_id: 'Focused',
          // The image avatar is still carried over
          avatar_type: 'image',
          avatar_image_url: 'https://example.com/chef.png',
        })
      )
    )
  })

  it('can clear the preset so provider defaults apply', async () => {
    render(<AssistantDialog open onOpenChange={vi.fn()} assistant={assistant} mode="edit" />)
    openModelSection()
    openPicker()
    fireEvent.click(screen.getByRole('menuitem', { name: 'noPreset' }))

    fireEvent.click(screen.getByRole('button', { name: 'common:saveChanges' }))

    await waitFor(() => expect(updateAssistant).toHaveBeenCalled())
    expect(updateAssistant.mock.calls[0][1].model_parameter_preset_id).toBeUndefined()
  })

  it('flags a preset that no longer exists', () => {
    render(
      <AssistantDialog
        open
        onOpenChange={vi.fn()}
        assistant={{ ...assistant, model_parameter_preset_id: 'gone' }}
        mode="edit"
      />
    )
    openModelSection()

    expect(screen.getByTestId('preset-picker')).toHaveTextContent('presetUnavailable')
  })

  it('preselects the default preset for new assistants', async () => {
    render(<AssistantDialog open onOpenChange={vi.fn()} mode="create" />)
    openModelSection()

    expect(screen.getByTestId('preset-picker')).toHaveTextContent('Balanced')

    fireEvent.click(screen.getByRole('button', { name: 'createAssistant' }))

    await waitFor(() =>
      expect(createAssistant).toHaveBeenCalledWith(
        expect.objectContaining({ model_parameter_preset_id: 'Balanced' })
      )
    )
  })
})
