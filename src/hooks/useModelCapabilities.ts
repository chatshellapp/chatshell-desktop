import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'
import type { Model, Provider, ModelCapabilities } from '@/types'

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  supports_tool_use: null,
  supports_vision: null,
  supports_image_generation: null,
  supports_reasoning: null,
  max_context_length: null,
  max_output_length: null,
}

const cache = new Map<string, ModelCapabilities>()

function cacheKey(providerType: string, modelId: string): string {
  return `${providerType}::${modelId}`
}

// Resolve one model's capabilities: cache hit first, backend lookup
// otherwise. Errors fall back to all-unknown instead of rejecting.
export async function fetchModelCapabilities(
  providerType: string,
  modelId: string
): Promise<ModelCapabilities> {
  const key = cacheKey(providerType, modelId)
  const cached = cache.get(key)
  if (cached) return cached
  try {
    const result = await invoke<ModelCapabilities>('get_model_capabilities', {
      providerType,
      modelId,
    })
    cache.set(key, result)
    return result
  } catch (error) {
    logger.error('Failed to get model capabilities:', error)
    return DEFAULT_CAPABILITIES
  }
}

export function useModelCapabilities(
  model: Model | null,
  provider: Provider | null
): ModelCapabilities {
  const [capabilities, setCapabilities] = useState<ModelCapabilities>(DEFAULT_CAPABILITIES)

  const providerType = provider?.provider_type ?? null
  const modelId = model?.model_id ?? null

  useEffect(() => {
    if (!providerType || !modelId) {
      setCapabilities(DEFAULT_CAPABILITIES)
      return
    }

    const key = cacheKey(providerType, modelId)
    const cached = cache.get(key)
    if (cached) {
      setCapabilities(cached)
      return
    }

    let cancelled = false

    fetchModelCapabilities(providerType, modelId).then((result) => {
      if (!cancelled) {
        setCapabilities(result)
      }
    })

    return () => {
      cancelled = true
    }
  }, [providerType, modelId])

  return capabilities
}

export function invalidateCapabilitiesCache(): void {
  cache.clear()
}
