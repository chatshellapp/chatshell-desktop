import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface ParameterSliderProps {
  label: string
  value: number | undefined
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  defaultValue: number
  /**
   * When provided, a switch lets the parameter be left unset (the provider
   * default applies) and the controls are disabled while it is off
   */
  enabled?: boolean
  onEnabledChange?: (enabled: boolean) => void
  /** Text shown in place of the value while the parameter is unset */
  unsetLabel?: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function ParameterSlider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  defaultValue,
  enabled = true,
  onEnabledChange,
  unsetLabel,
}: ParameterSliderProps) {
  const currentValue = value ?? defaultValue
  const isOptional = !!onEnabledChange

  return (
    <div className={cn('space-y-3', !enabled && 'opacity-60')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isOptional && (
            <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label={label} />
          )}
          <Label className="text-sm font-medium">{label}</Label>
        </div>
        {enabled ? (
          <Input
            type="number"
            value={currentValue}
            onChange={(e) => {
              const parsed = parseFloat(e.target.value)
              // 0 is a valid value; only fall back when the input is not a number
              onChange(Number.isNaN(parsed) ? defaultValue : clamp(parsed, min, max))
            }}
            min={min}
            max={max}
            step={step}
            aria-label={label}
            className="w-20 h-7 text-right text-sm"
          />
        ) : (
          <span className="text-xs text-muted-foreground">{unsetLabel}</span>
        )}
      </div>
      <Slider
        value={[currentValue]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        disabled={!enabled}
        className="w-full"
      />
    </div>
  )
}
