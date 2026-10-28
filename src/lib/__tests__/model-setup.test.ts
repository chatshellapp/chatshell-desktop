import { describe, expect, it } from 'vitest'
import type { Model, Provider } from '@/types'
import { computeModelSetupState, modelCountsByProvider, pickDefaultModel } from '@/lib/model-setup'

const NOW = '2026-01-01T00:00:00Z'

const makeProvider = (id: string, overrides: Partial<Provider> = {}): Provider => ({
  id,
  name: `Provider ${id}`,
  provider_type: 'openai',
  is_enabled: true,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
})

const makeModel = (id: string, providerId: string, overrides: Partial<Model> = {}): Model => ({
  id,
  provider_id: providerId,
  name: `Model ${id}`,
  model_id: id,
  is_starred: false,
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
})

describe('computeModelSetupState', () => {
  it('needs a provider when none are saved', () => {
    expect(computeModelSetupState([], [])).toEqual({ kind: 'needsProvider' })
  })

  it('names the oldest configured provider when it has no models', () => {
    const providers = [
      makeProvider('newer', { name: 'Newer', created_at: '2026-02-01T00:00:00Z' }),
      makeProvider('older', { name: 'Older', created_at: '2026-01-01T00:00:00Z' }),
    ]

    expect(computeModelSetupState(providers, [])).toEqual({
      kind: 'needsModels',
      providerId: 'older',
      providerName: 'Older',
    })
  })

  it('is ready when any enabled provider has a visible model', () => {
    const providers = [makeProvider('a'), makeProvider('b')]
    const models = [makeModel('m1', 'b')]

    expect(computeModelSetupState(providers, models)).toEqual({ kind: 'ready' })
  })

  it('ignores deleted models and disabled providers', () => {
    const providers = [makeProvider('disabled', { is_enabled: false })]
    const models = [
      makeModel('deleted', 'disabled', { is_deleted: true }),
      makeModel('live-but-provider-off', 'disabled'),
    ]

    expect(computeModelSetupState(providers, models)).toEqual({ kind: 'needsProvider' })
  })

  it('ignores models that belong to a removed provider', () => {
    expect(computeModelSetupState([makeProvider('a')], [makeModel('orphan', 'gone')])).toEqual({
      kind: 'needsModels',
      providerId: 'a',
      providerName: 'Provider a',
    })
  })
})

describe('modelCountsByProvider', () => {
  it('counts only visible models per provider', () => {
    const models = [
      makeModel('a1', 'a'),
      makeModel('a2', 'a'),
      makeModel('a3', 'a', { is_deleted: true }),
      makeModel('b1', 'b'),
    ]

    expect(modelCountsByProvider(models)).toEqual({ a: 2, b: 1 })
  })
})

describe('pickDefaultModel', () => {
  it('returns null without visible models', () => {
    expect(pickDefaultModel([])).toBeNull()
    expect(pickDefaultModel([makeModel('a', 'p', { is_deleted: true })])).toBeNull()
  })

  it('prefers the last starred model', () => {
    const models = [
      makeModel('plain', 'p'),
      makeModel('star-1', 'p', { is_starred: true }),
      makeModel('star-2', 'p', { is_starred: true }),
    ]

    expect(pickDefaultModel(models)?.id).toBe('star-2')
  })

  it('falls back to the last visible model', () => {
    const models = [makeModel('a', 'p'), makeModel('b', 'p')]

    expect(pickDefaultModel(models)?.id).toBe('b')
  })
})
