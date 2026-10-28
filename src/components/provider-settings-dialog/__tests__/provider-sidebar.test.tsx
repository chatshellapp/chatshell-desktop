import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '@/lib/i18n'
import { ProviderSidebar } from '../provider-sidebar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { useModelStore } from '@/stores/modelStore'
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

function renderSidebar() {
  return render(
    <SidebarProvider>
      <ProviderSidebar
        selectedProvider={{
          id: provider.provider_type,
          name: provider.name,
          baseUrl: provider.base_url ?? '',
          isCustom: true,
        }}
        onSelectProvider={() => {}}
        storeProviders={[provider]}
        editingCustomProviderId={provider.id}
      />
    </SidebarProvider>
  )
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

beforeEach(() => {
  useModelStore.setState({ models: [], providers: [] })
})

describe('ProviderSidebar status', () => {
  it('warns when a saved provider has no models', () => {
    renderSidebar()

    expect(screen.getByText('Needs models')).toBeInTheDocument()
  })

  it('shows the visible model count once models exist', () => {
    useModelStore.setState({ models: [model] })

    renderSidebar()

    expect(screen.getByTitle('1 models')).toHaveTextContent('1')
    expect(screen.queryByText('Needs models')).not.toBeInTheDocument()
  })

  it('ignores deleted models in the count', () => {
    useModelStore.setState({ models: [{ ...model, is_deleted: true }] })

    renderSidebar()

    expect(screen.getByText('Needs models')).toBeInTheDocument()
  })
})
