import type { Model, Provider } from '@/types'

/** Whether a conversation can actually send, derived from enabled providers
 * and their non-deleted models. "Configured" (a provider row exists) is not
 * the same thing: a provider saved with zero models leaves the composer with
 * nothing to select. */
export type ModelSetupState =
  | { kind: 'needsProvider' }
  | { kind: 'needsModels'; providerId: string; providerName: string }
  | { kind: 'ready' }

export function activeModels(models: Model[]): Model[] {
  return models.filter((model) => !model.is_deleted)
}

/** Non-deleted model count per provider id — used by provider rows. */
export function modelCountsByProvider(models: Model[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const model of activeModels(models)) {
    counts[model.provider_id] = (counts[model.provider_id] ?? 0) + 1
  }
  return counts
}

export function computeModelSetupState(providers: Provider[], models: Model[]): ModelSetupState {
  const enabled = providers.filter((provider) => provider.is_enabled)
  const enabledIds = new Set(enabled.map((provider) => provider.id))
  if (activeModels(models).some((model) => enabledIds.has(model.provider_id))) {
    return { kind: 'ready' }
  }
  if (enabled.length === 0) return { kind: 'needsProvider' }

  // Oldest provider first, matching the store's creation order, so the CTA
  // always names the same provider across surfaces.
  const first = [...enabled].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
  return { kind: 'needsModels', providerId: first.id, providerName: first.name }
}

/** Starred model first, else the last active model (desktop's existing
 * default-selection rule). Returns null when nothing is selectable. */
export function pickDefaultModel(models: Model[]): Model | null {
  const active = activeModels(models)
  if (active.length === 0) return null
  const starred = active.filter((model) => model.is_starred)
  return starred.length > 0 ? starred[starred.length - 1] : active[active.length - 1]
}
