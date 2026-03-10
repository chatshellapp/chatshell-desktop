'use client'

import { useTranslation } from 'react-i18next'
import { MoreHorizontal, ListChecks, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ModelItem, LLMProvider } from './types'
import { isSupportedFetchProvider } from './constants'

interface ModelsTableProps {
  models: ModelItem[]
  selectedProvider: LLMProvider
  apiKey: string
  onOpenFetchModal: () => void
  onOpenAddModelDialog: () => void
  onUpdateModelName: (id: string, newDisplayName: string) => void
  onDeleteModel: (id: string) => void
  onModelSettings: (model: ModelItem) => void
}

export function ModelsTable({
  models,
  selectedProvider,
  apiKey,
  onOpenFetchModal,
  onOpenAddModelDialog,
  onUpdateModelName,
  onDeleteModel,
  onModelSettings,
}: ModelsTableProps) {
  const { t } = useTranslation('providers')

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t('models')}</Label>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onOpenAddModelDialog}>
            <Plus className="size-4 mr-2" />
            {t('addModel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenFetchModal}
            disabled={
              !isSupportedFetchProvider(selectedProvider.id) ||
              (selectedProvider.id !== 'ollama' && !apiKey)
            }
          >
            <ListChecks className="size-4 mr-2" />
            {t('manageModels')}
          </Button>
        </div>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[45%]">{t('modelId')}</TableHead>
              <TableHead className="w-[45%]">{t('modelName')}</TableHead>
              <TableHead className="w-[10%]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.length > 0 ? (
              models.map((model) => (
                <TableRow key={model.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    <div className="truncate" title={model.modelId}>
                      {model.modelId}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={model.displayName}
                      onChange={(e) => onUpdateModelName(model.id, e.target.value)}
                      className="h-8 w-full"
                      title={model.modelId} // Show raw model ID on hover
                    />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onModelSettings(model)}>
                          {t('common:edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => onDeleteModel(model.id)}
                        >
                          {t('common:delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  {t('noModelsAdded')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
