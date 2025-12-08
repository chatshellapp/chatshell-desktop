import * as React from 'react'
import type { LLMProvider, ModelInfo } from './types'

export interface UseModelFilteringReturn {
  filteredModels: ModelInfo[]
  groupedModels: Record<string, ModelInfo[]>
}

interface UseModelFilteringParams {
  availableModels: ModelInfo[]
  modelSearchQuery: string
  selectedProvider: LLMProvider
}

/**
 * Filters and groups models based on search query and provider
 */
export function useModelFiltering({
  availableModels,
  modelSearchQuery,
  selectedProvider,
}: UseModelFilteringParams): UseModelFilteringReturn {
  // Filter models by search query
  const filteredModels = React.useMemo(() => {
    if (!modelSearchQuery.trim()) {
      return availableModels
    }
    const query = modelSearchQuery.toLowerCase()
    return availableModels.filter(
      (model) =>
        model.id.toLowerCase().includes(query) ||
        model.name.toLowerCase().includes(query) ||
        model.description?.toLowerCase().includes(query)
    )
  }, [availableModels, modelSearchQuery])

  // Group models by vendor/family
  const groupedModels = React.useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {}
    filteredModels.forEach((model) => {
      let groupName: string

      if (selectedProvider.id === 'openrouter') {
        // For OpenRouter, group by vendor prefix (e.g., "anthropic/claude-3" -> "anthropic")
        const slashIndex = model.id.indexOf('/')
        groupName = slashIndex > 0 ? model.id.substring(0, slashIndex) : 'Other'
        // Capitalize first letter
        groupName = groupName.charAt(0).toUpperCase() + groupName.slice(1)
      } else {
        // For other providers, use a single group
        groupName = selectedProvider.name
      }

      if (!groups[groupName]) {
        groups[groupName] = []
      }
      groups[groupName].push(model)
    })

    // Sort groups alphabetically
    const sortedGroups: Record<string, ModelInfo[]> = {}
    Object.keys(groups)
      .sort()
      .forEach((key) => {
        sortedGroups[key] = groups[key]
      })

    return sortedGroups
  }, [filteredModels, selectedProvider])

  return {
    filteredModels,
    groupedModels,
  }
}
