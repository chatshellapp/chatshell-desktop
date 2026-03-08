'use client'

import { useTranslation } from 'react-i18next'
import { Search, Loader2, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Checkbox } from '@/components/ui/checkbox'
import type { ModelInfo, LLMProvider } from './types'

interface FetchModelsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedProvider: LLMProvider
  isLoading: boolean
  fetchError: string | null
  availableModels: ModelInfo[]
  modelSearchQuery: string
  onModelSearchQueryChange: (query: string) => void
  groupedModels: Record<string, ModelInfo[]>
  onToggleImportModel: (model: ModelInfo) => void
  isModelImported: (rawModelId: string) => boolean
  onRetry: () => void
  onAddManually: () => void
}

export function FetchModelsDialog({
  open,
  onOpenChange,
  selectedProvider,
  isLoading,
  fetchError,
  availableModels,
  modelSearchQuery,
  onModelSearchQueryChange,
  groupedModels,
  onToggleImportModel,
  isModelImported,
  onRetry,
  onAddManually,
}: FetchModelsDialogProps) {
  const { t } = useTranslation('providers')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[600px] flex flex-col">
        <div className="space-y-2">
          <DialogTitle>{t('availableModels')}</DialogTitle>
          <DialogDescription>
            {t('selectModelsFrom', { provider: selectedProvider.name })}
          </DialogDescription>
        </div>

        {/* Search Input */}
        {!isLoading && !fetchError && availableModels.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder={t('searchModels')}
              value={modelSearchQuery}
              onChange={(e) => onModelSearchQueryChange(e.target.value)}
              className="pl-9"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center min-h-32 py-6 text-center">
              <p className="text-sm text-destructive mb-1 font-medium">{t('fetchFailed')}</p>
              <div className="mx-4 mb-3 px-3 py-2 bg-destructive/5 rounded-md max-h-24 overflow-y-auto w-full">
                <p className="text-xs text-destructive/80 font-mono whitespace-pre-wrap break-all text-left">
                  {fetchError}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onRetry}>
                  {t('common:retry')}
                </Button>
                <Button variant="outline" size="sm" onClick={onAddManually}>
                  {t('addManually')}
                </Button>
              </div>
            </div>
          ) : availableModels.length > 0 ? (
            <div className="space-y-3">
              {Object.keys(groupedModels).length === 0 && modelSearchQuery && (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  {t('noModelsMatching', { query: modelSearchQuery })}
                </div>
              )}
              {Object.entries(groupedModels).map(([groupName, groupModels]) => (
                <Collapsible key={groupName} defaultOpen={Object.keys(groupedModels).length <= 5}>
                  <div className="rounded-md border">
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className="w-full justify-between p-3 h-auto hover:bg-accent"
                      >
                        <span className="font-semibold">{groupName}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {groupModels.length}{' '}
                            {groupModels.length === 1 ? t('modelUnit') : t('modelsUnit')}
                          </span>
                          <ChevronDown className="size-4" />
                        </div>
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t">
                        <Table>
                          <TableBody>
                            {groupModels.map((model) => {
                              const imported = isModelImported(model.id)
                              return (
                                <TableRow
                                  key={model.id}
                                  className="cursor-pointer hover:bg-accent/50"
                                  onClick={() => onToggleImportModel(model)}
                                >
                                  <TableCell className="w-[40px]">
                                    <Checkbox
                                      checked={imported}
                                      onCheckedChange={() => onToggleImportModel(model)}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </TableCell>
                                  <TableCell className="font-medium max-w-[200px]">
                                    <div className="truncate" title={model.name}>
                                      {model.name}
                                    </div>
                                    <div
                                      className="text-xs text-muted-foreground truncate"
                                      title={model.id}
                                    >
                                      {model.id}
                                    </div>
                                  </TableCell>
                                  {model.context_length && (
                                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                      {(model.context_length / 1000).toFixed(0)}K ctx
                                    </TableCell>
                                  )}
                                  {model.description && (
                                    <TableCell
                                      className="text-xs text-muted-foreground max-w-[200px] truncate"
                                      title={model.description}
                                    >
                                      {model.description}
                                    </TableCell>
                                  )}
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              {t('noModelsFound')}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:ok')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
