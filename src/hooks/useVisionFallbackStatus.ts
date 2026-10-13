import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'

export interface VisionFallbackStatus {
  available: boolean
  provider_type: string | null
  model_id: string | null
}
let cached: Promise<VisionFallbackStatus> | null = null
const listeners = new Set<() => void>()

export function invalidateVisionFallbackStatus(): void {
  cached = null
  listeners.forEach((notify) => notify())
}

export function fetchVisionFallbackStatus(): Promise<VisionFallbackStatus> {
  if (!cached) {
    cached = invoke<VisionFallbackStatus>('get_vision_fallback_status').catch((error) => {
      // Failed probes read as "no fallback" so the input gate stays closed.
      cached = null
      logger.error('Failed to get vision fallback status:', error)
      return { available: false, provider_type: null, model_id: null }
    })
  }
  return cached
}

/**
 * Whether a vision-capable fallback model can serve a text-only main model
 * (aux vision setting or any configured vision model). Re-resolves when
 * `invalidateVisionFallbackStatus()` fires (aux-model settings save).
 */
export function useVisionFallbackStatus(): VisionFallbackStatus {
  const [status, setStatus] = useState<VisionFallbackStatus>({
    available: false,
    provider_type: null,
    model_id: null,
  })

  useEffect(() => {
    let cancelled = false
    const refetch = () => {
      fetchVisionFallbackStatus().then((result) => {
        if (!cancelled) setStatus(result)
      })
    }
    refetch()
    listeners.add(refetch)
    return () => {
      cancelled = true
      listeners.delete(refetch)
    }
  }, [])

  return status
}
