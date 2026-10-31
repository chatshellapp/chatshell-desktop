import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from '@/lib/i18n'
import { WelcomeState } from '../WelcomeState'
import { useConversationStore } from '@/stores/conversation'
import { useModelStore } from '@/stores/modelStore'
import { useProviderSettingsStore } from '@/stores/providerSettingsStore'
import type { Model } from '@/types'

void i18n

const model = (overrides: Partial<Model> = {}): Model => ({
  id: 'm1',
  name: 'Model',
  provider_id: 'p1',
  model_id: 'model',
  is_starred: false,
  is_deleted: false,
  created_at: '',
  updated_at: '',
  ...overrides,
})

describe('WelcomeState', () => {
  beforeEach(() => {
    useConversationStore.setState({ pendingInput: null })
    useModelStore.setState({ models: [] })
    useProviderSettingsStore.setState({ open: false })
  })

  it('prefills the composer from a starter instead of sending', () => {
    render(<WelcomeState canChat />)

    fireEvent.click(screen.getByText('Help me write'))

    expect(useConversationStore.getState().pendingInput).toMatch(/^Help me write a short/)
  })

  it('offers to connect a model when none is configured', () => {
    render(<WelcomeState canChat={false} />)

    fireEvent.click(screen.getByRole('button', { name: /Connect a model/ }))

    expect(useProviderSettingsStore.getState().open).toBe(true)
  })

  it('asks to pick a model when models exist but none is selected', () => {
    useModelStore.setState({ models: [model()] })
    render(<WelcomeState canChat={false} />)

    expect(screen.getByText('Choose a model to start')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Connect a model/ })).not.toBeInTheDocument()
  })

  it('ignores deleted models when deciding what to show', () => {
    useModelStore.setState({ models: [model({ is_deleted: true })] })
    render(<WelcomeState canChat={false} />)

    expect(screen.getByText('Connect an AI model to start')).toBeInTheDocument()
  })
})
