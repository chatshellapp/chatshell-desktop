import { useMemo } from 'react'
import { useModelStore } from '@/stores/modelStore'
import { getModelLogo } from '@/lib/model-logos'
import type { ModelVendor } from '@/components/model-list'

export function useVendorsList(): ModelVendor[] {
  const models = useModelStore((state) => state.models)
  const providers = useModelStore((state) => state.providers)

  return useMemo(() => {
    if (providers.length === 0) return []

    return providers
      .map((provider) => {
        const providerModels = models
          // Filter out soft-deleted models for selection UI
          .filter((m) => m.provider_id === provider.id && !m.is_deleted)
          .map((m) => ({
            id: m.id,
            name: m.name,
            modelId: m.model_id,
            logo: getModelLogo(m),
            isStarred: m.is_starred || false,
          }))

        return {
          id: provider.id,
          name: provider.name,
          models: providerModels,
        }
      })
      .filter((vendor) => vendor.models.length > 0)
  }, [models, providers])
}
