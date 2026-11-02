import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import i18n from '@/lib/i18n'
import { ProviderSettingsDialog } from '../provider-settings-dialog'
import { LLMProviderSettings } from '@/components/settings-dialog/llm-provider-settings'
import { SidebarProvider } from '@/components/ui/sidebar'
import { useModelStore } from '@/stores/modelStore'
import type { Model, Provider } from '@/types'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const mockedInvoke = vi.mocked(invoke)

const NOW = '2026-01-01T00:00:00Z'

const provider: Provider = {
  id: 'provider-1',
  name: 'Acme',
  provider_type: 'custom_openai',
  api_key: 'sk-test',
  base_url: 'http://127.0.0.1:18080/llm/v1',
  api_style: 'chat_completions',
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

function mockBackend({ models, providers }: { models: Model[]; providers: Provider[] }) {
  mockedInvoke.mockImplementation((async (cmd: string) => {
    switch (cmd) {
      case 'list_all_models':
        return [...models]
      case 'list_providers':
        return [...providers]
      case 'fetch_provider_models':
        return [{ id: 'acme-1', name: 'Acme One' }]
      case 'is_keychain_available':
        return true
      default:
        return null
    }
  }) as never)
}

function renderDialog(initialProviderId?: string) {
  return render(
    <ProviderSettingsDialog open initialProviderId={initialProviderId} onOpenChange={vi.fn()} />
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
  mockedInvoke.mockReset()
  useModelStore.setState({ models: [], providers: [] })
})

describe('ProviderSettingsDialog deep link', () => {
  it('focuses the provider and opens model selection when it has no models', async () => {
    mockBackend({ models: [], providers: [provider] })

    renderDialog(provider.id)

    expect(await screen.findByText('Available Models')).toBeInTheDocument()
    expect(mockedInvoke).toHaveBeenCalledWith('fetch_provider_models', {
      providerType: 'openai',
      apiKey: 'sk-test',
      baseUrl: provider.base_url,
    })
  })

  it('does not fetch when the focused provider already has a model', async () => {
    mockBackend({ models: [model], providers: [provider] })

    renderDialog(provider.id)

    await waitFor(() => {
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_providers')
    })

    const fetched = mockedInvoke.mock.calls.some(([cmd]) => cmd === 'fetch_provider_models')
    expect(fetched).toBe(false)
  })

  it('does not auto-fetch for Anthropic-compatible custom providers', async () => {
    const anthropic: Provider = { ...provider, provider_type: 'custom_anthropic' }
    mockBackend({ models: [], providers: [anthropic] })

    renderDialog(anthropic.id)

    await waitFor(() => {
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_providers')
    })

    const fetched = mockedInvoke.mock.calls.some(([cmd]) => cmd === 'fetch_provider_models')
    expect(fetched).toBe(false)
  })

  it('enables Save once a new provider has a key, even without models', async () => {
    mockBackend({ models: [], providers: [] })

    renderDialog()

    const save = await screen.findByRole('button', { name: 'Save Configuration' })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } })

    await waitFor(() => {
      expect(save).toBeEnabled()
    })
  })
})

describe.each(['dialog', 'settings'] as const)('Add Provider in %s', (entryPoint) => {
  function renderSettings() {
    if (entryPoint === 'dialog') return renderDialog()
    return render(
      <SidebarProvider>
        <LLMProviderSettings open />
      </SidebarProvider>
    )
  }

  function expectEmptyForm() {
    expect(screen.getByLabelText('Provider Name')).toHaveValue('')
    expect(screen.getByLabelText('API Key')).toHaveValue('')
    expect(screen.getByLabelText(/^API Base URL/)).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save Configuration' })).toBeDisabled()
    expect(screen.queryByText(model.name)).not.toBeInTheDocument()
  }

  it('starts a fresh form after editing a custom provider', async () => {
    mockBackend({ models: [model], providers: [provider] })
    renderSettings()

    fireEvent.click(await screen.findByRole('button', { name: /Acme/ }))
    await waitFor(() => expect(screen.getByLabelText('API Key')).toHaveValue(provider.api_key))

    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }))

    await waitFor(expectEmptyForm)
  })

  it('starts a fresh form after saving a new custom provider', async () => {
    const providers: Provider[] = []
    mockBackend({ models: [], providers })
    const backend = mockedInvoke.getMockImplementation()!
    mockedInvoke.mockImplementation((async (cmd: string, args: unknown) => {
      if (cmd === 'create_provider') {
        const saved = {
          ...provider,
          ...(args as { req: Partial<Provider> }).req,
        }
        providers.push(saved)
        return saved
      }
      return backend(cmd, args as never)
    }) as never)
    renderSettings()

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith('list_providers'))
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }))
    fireEvent.change(screen.getByLabelText('Provider Name'), { target: { value: provider.name } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: provider.api_key } })
    fireEvent.change(screen.getByLabelText(/^API Base URL/), {
      target: { value: provider.base_url },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Anthropic Compatible' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument())
    expect(mockedInvoke).toHaveBeenCalledWith('create_provider', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }))

    await waitFor(expectEmptyForm)
  })
})
