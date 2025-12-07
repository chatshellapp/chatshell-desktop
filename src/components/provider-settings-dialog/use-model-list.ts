import * as React from 'react'
import { useModelStore } from '@/stores/modelStore'
import type { ModelItem, ModelInfo } from './types'

export interface UseModelListReturn {
  models: ModelItem[]
  setModels: React.Dispatch<React.SetStateAction<ModelItem[]>>
  modelsToDelete: string[]
  setModelsToDelete: React.Dispatch<React.SetStateAction<string[]>>
  originalModelNames: Record<string, string>
  setOriginalModelNames: React.Dispatch<React.SetStateAction<Record<string, string>>>
  handleUpdateModelName: (id: string, newDisplayName: string) => void
  handleDeleteModel: (id: string) => void
  handleToggleImportModel: (model: ModelInfo) => void
  isModelImported: (rawModelId: string) => boolean
}

/**
 * Manages the list of models and their operations (add, update, delete)
 */
export function useModelList(): UseModelListReturn {
  const storeModels = useModelStore((state) => state.models)
  const [models, setModels] = React.useState<ModelItem[]>([])
  const [modelsToDelete, setModelsToDelete] = React.useState<string[]>([])
  const [originalModelNames, setOriginalModelNames] = React.useState<Record<string, string>>({})

  const handleUpdateModelName = React.useCallback((id: string, newDisplayName: string) => {
    setModels((prev) =>
      prev.map((model) => (model.id === id ? { ...model, displayName: newDisplayName } : model))
    )
  }, [])

  const handleDeleteModel = React.useCallback((id: string) => {
    setModels((prev) => prev.filter((model) => model.id !== id))
  }, [])

  const handleToggleImportModel = React.useCallback(
    (model: ModelInfo) => {
      setModels((prevModels) => {
        const existingIndex = prevModels.findIndex((m) => m.modelId === model.id)
        if (existingIndex >= 0) {
          // Model is currently in list - remove it
          const existingModel = prevModels[existingIndex]
          if (existingModel.isExisting) {
            // Mark for soft delete
            setModelsToDelete((prev) => [...prev, existingModel.id])
          }
          return prevModels.filter((_, idx) => idx !== existingIndex)
        } else {
          // Model not in list - check if it was marked for deletion and restore it
          const markedForDelete = modelsToDelete.find((id) => {
            const m = storeModels.find((sm) => sm.id === id)
            return m && m.model_id === model.id
          })

          if (markedForDelete) {
            // Restore from delete list
            const originalModel = storeModels.find((sm) => sm.id === markedForDelete)
            setModelsToDelete((prev) => prev.filter((id) => id !== markedForDelete))
            if (originalModel) {
              return [
                ...prevModels,
                {
                  id: originalModel.id,
                  displayName: originalModel.name,
                  modelId: originalModel.model_id,
                  isExisting: true,
                },
              ]
            }
          }

          // Add as new model
          return [
            ...prevModels,
            {
              id: Date.now().toString(),
              displayName: model.name,
              modelId: model.id,
            },
          ]
        }
      })
    },
    [modelsToDelete, storeModels]
  )

  const isModelImported = React.useCallback(
    (rawModelId: string) => {
      return models.some((m) => m.modelId === rawModelId)
    },
    [models]
  )

  return {
    models,
    setModels,
    modelsToDelete,
    setModelsToDelete,
    originalModelNames,
    setOriginalModelNames,
    handleUpdateModelName,
    handleDeleteModel,
    handleToggleImportModel,
    isModelImported,
  }
}

