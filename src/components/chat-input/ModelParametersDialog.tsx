import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ModelParameterPreset, ModelParameterOverrides } from '@/types'
import { PARAMETER_LIMITS } from '@/types'
import { cn } from '@/lib/utils'

interface ModelParametersDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  // Current state
  useProviderDefaults: boolean
  useCustomParameters: boolean
  selectedPresetId: string | null
  parameterOverrides: ModelParameterOverrides
  // Callbacks
  onUseProviderDefaults: () => void
  onSelectPreset: (presetId: string) => void
  onUseCustom: () => void
  onSaveCustomParameters: (overrides: ModelParameterOverrides) => void
}

interface ParameterSliderProps {
  label: string
  value: number | undefined
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  defaultValue: number
}

function ParameterSlider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  defaultValue,
}: ParameterSliderProps) {
  const currentValue = value ?? defaultValue

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <Input
          type="number"
          value={currentValue}
          onChange={(e) => onChange(parseFloat(e.target.value) || defaultValue)}
          min={min}
          max={max}
          step={step}
          className="w-20 h-7 text-right text-sm"
        />
      </div>
      <Slider
        value={[currentValue]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        className="w-full"
      />
    </div>
  )
}

export function ModelParametersDialog({
  isOpen,
  onOpenChange,
  useProviderDefaults,
  useCustomParameters,
  selectedPresetId,
  parameterOverrides,
  onUseProviderDefaults,
  onSelectPreset,
  onUseCustom,
  onSaveCustomParameters,
}: ModelParametersDialogProps) {
  const [presets, setPresets] = useState<ModelParameterPreset[]>([])
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>(
    useCustomParameters ? 'custom' : 'presets'
  )

  // Local state for custom parameters
  const [localOverrides, setLocalOverrides] = useState<ModelParameterOverrides>(parameterOverrides)

  // Load presets on mount
  useEffect(() => {
    const loadPresets = async () => {
      try {
        const result = await invoke<ModelParameterPreset[]>('list_model_parameter_presets')
        // Sort presets: Creative, Balanced, Precise, then others
        const presetOrder: Record<string, number> = {
          'Creative': 0,
          'Balanced': 1,
          'Precise': 2,
        }
        const sorted = [...result].sort((a, b) => {
          const orderA = presetOrder[a.name] ?? 99
          const orderB = presetOrder[b.name] ?? 99
          return orderA - orderB
        })
        setPresets(sorted)
      } catch (error) {
        console.error('Failed to load presets:', error)
      }
    }
    if (isOpen) {
      loadPresets()
    }
  }, [isOpen])

  // Reset local state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setLocalOverrides(parameterOverrides)
      setActiveTab(useCustomParameters ? 'custom' : 'presets')
    }
  }, [isOpen, parameterOverrides, useCustomParameters])

  const handleDefaultSelect = () => {
    onUseProviderDefaults()
    onOpenChange(false)
  }

  const handlePresetSelect = (presetId: string) => {
    onSelectPreset(presetId)
    onOpenChange(false)
  }

  const handleApplyCustom = () => {
    onUseCustom()
    onSaveCustomParameters(localOverrides)
    onOpenChange(false)
  }

  const updateOverride = <K extends keyof ModelParameterOverrides>(
    key: K,
    value: ModelParameterOverrides[K]
  ) => {
    setLocalOverrides((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Model Parameters</DialogTitle>
          <DialogDescription>
            Configure parameters for this conversation. Choose a preset or customize values.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'presets' | 'custom')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="presets">Presets</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>

          <TabsContent value="presets" className="mt-4">
            <div className="grid gap-2">
              {/* Default option - uses provider defaults */}
              <button
                onClick={handleDefaultSelect}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                  useProviderDefaults
                    ? 'border-primary bg-accent'
                    : 'border-border'
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">Default</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  Use provider's default settings. No parameters will be sent.
                </span>
              </button>

              {/* Presets */}
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handlePresetSelect(preset.id)}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                    selectedPresetId === preset.id && !useCustomParameters && !useProviderDefaults
                      ? 'border-primary bg-accent'
                      : 'border-border'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{preset.name}</span>
                  </div>
                  {preset.description && (
                    <span className="text-xs text-muted-foreground">{preset.description}</span>
                  )}
                  <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                    {preset.temperature !== undefined && (
                      <span>Temp: {preset.temperature}</span>
                    )}
                    {preset.top_p !== undefined && <span>Top P: {preset.top_p}</span>}
                    {preset.max_tokens !== undefined && (
                      <span>Max: {preset.max_tokens}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="custom" className="mt-4 space-y-6">
            <ParameterSlider
              label="Temperature"
              value={localOverrides.temperature}
              onChange={(v) => updateOverride('temperature', v)}
              {...PARAMETER_LIMITS.temperature}
            />

            <ParameterSlider
              label="Top P"
              value={localOverrides.top_p}
              onChange={(v) => updateOverride('top_p', v)}
              {...PARAMETER_LIMITS.top_p}
            />

            <ParameterSlider
              label="Max Tokens"
              value={localOverrides.max_tokens}
              onChange={(v) => updateOverride('max_tokens', Math.round(v))}
              {...PARAMETER_LIMITS.max_tokens}
            />

            <ParameterSlider
              label="Frequency Penalty"
              value={localOverrides.frequency_penalty}
              onChange={(v) => updateOverride('frequency_penalty', v)}
              {...PARAMETER_LIMITS.frequency_penalty}
            />

            <ParameterSlider
              label="Presence Penalty"
              value={localOverrides.presence_penalty}
              onChange={(v) => updateOverride('presence_penalty', v)}
              {...PARAMETER_LIMITS.presence_penalty}
            />

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleApplyCustom}>Apply</Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
