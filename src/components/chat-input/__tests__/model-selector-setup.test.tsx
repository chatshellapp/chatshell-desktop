import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import i18n from '@/lib/i18n'
import { ModelSelectorDropdown } from '../ModelSelectorDropdown'
import { useConversationStore } from '@/stores/conversation'
import { useModelStore } from '@/stores/modelStore'
import { useAssistantStore } from '@/stores/assistantStore'
import { useProviderSettingsStore } from '@/stores/providerSettingsStore'
import type { Model, Provider } from '@/types'

void i18n

const NOW = '2026-01-01T00:00:00Z'

const provider: Provider = {
  id: 'provider-1',
  name: 'Acme',
  provider_type: 'custom_openai',
  base_url: 'http://127.0.0.1:18080/llm/v1',
  is_enabled: true,
  created_at: NOW,
  updated_at: NOW,
}

const model: Model = {
  id: 'model-1',
  provider_id: provider.id,
  name: 'Acme One',
  model_id: 'acme-1',
  is_starred: false,
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW,
}

function renderSelector(open = false) {
  return render(
    <ModelSelectorDropdown
      isOpen={open}
      onOpenChange={() => {}}
      activeTab="models"
      onActiveTabChange={() => {}}
    />
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useModelStore.setState({ models: [], providers: [] })
  useAssistantStore.setState({ assistants: [] })
  useConversationStore.setState({ selectedModel: null, selectedAssistant: null })
  useProviderSettingsStore.setState({ open: false, initialProviderId: null })
})

describe('ModelSelectorDropdown provider setup', () => {
  it('offers provider setup when nothing is configured', () => {
    renderSelector()

    expect(screen.getByText('Set up provider')).toBeInTheDocument()
  })

  it('names the provider that has no models', () => {
    useModelStore.setState({ providers: [provider] })

    renderSelector()

    expect(screen.getByText('Add models for Acme')).toBeInTheDocument()
  })

  it('deep-links the setup CTA to the provider without models', () => {
    useModelStore.setState({ providers: [provider] })
    useProviderSettingsStore.setState({ open: false, initialProviderId: null })

    renderSelector(true)
    const cta = screen.getAllByText('Add models for Acme').at(-1)
    expect(cta).toBeDefined()
    fireEvent.click(cta!)

    expect(useProviderSettingsStore.getState().open).toBe(true)
    expect(useProviderSettingsStore.getState().initialProviderId).toBe(provider.id)
  })

  it('keeps the plain selector once models exist', () => {
    useModelStore.setState({ providers: [provider], models: [model] })

    renderSelector()

    expect(screen.getByText('Select model or assistant')).toBeInTheDocument()
    expect(screen.queryByText('Add models for Acme')).not.toBeInTheDocument()
  })
})
