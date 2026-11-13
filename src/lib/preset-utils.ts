import { PARAMETER_LIMITS } from '@/types'
import type {
  CreateModelParameterPresetRequest,
  ModelParameterPreset,
  UpdateModelParameterPresetRequest,
} from '@/types'

export type PresetParameterKey =
  | 'temperature'
  | 'top_p'
  | 'max_tokens'
  | 'frequency_penalty'
  | 'presence_penalty'

/** Display order and chat-namespace label key for each preset parameter */
export const PRESET_PARAMETERS: ReadonlyArray<{ key: PresetParameterKey; labelKey: string }> = [
  { key: 'temperature', labelKey: 'temperature' },
  { key: 'top_p', labelKey: 'topP' },
  { key: 'max_tokens', labelKey: 'maxTokens' },
  { key: 'frequency_penalty', labelKey: 'frequencyPenalty' },
  { key: 'presence_penalty', labelKey: 'presencePenalty' },
]

/** Editable form state; an undefined parameter means "provider default" */
export interface PresetFormValues {
  name: string
  description: string
  parameters: Partial<Record<PresetParameterKey, number>>
}

export function emptyPresetForm(): PresetFormValues {
  return {
    name: '',
    description: '',
    parameters: {
      temperature: PARAMETER_LIMITS.temperature.defaultValue,
      top_p: PARAMETER_LIMITS.top_p.defaultValue,
    },
  }
}

export function presetToForm(preset: ModelParameterPreset): PresetFormValues {
  const parameters: PresetFormValues['parameters'] = {}
  for (const { key } of PRESET_PARAMETERS) {
    const value = preset[key]
    if (value !== undefined && value !== null) parameters[key] = value
  }
  return { name: preset.name, description: preset.description ?? '', parameters }
}

export function formToCreateRequest(form: PresetFormValues): CreateModelParameterPresetRequest {
  const req: CreateModelParameterPresetRequest = {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
  }
  for (const { key } of PRESET_PARAMETERS) {
    const value = form.parameters[key]
    if (value !== undefined) req[key] = value
  }
  return req
}

/**
 * Full update from the form: every parameter is sent, with null clearing the
 * ones that were switched off so the provider default applies again
 */
export function formToUpdateRequest(form: PresetFormValues): UpdateModelParameterPresetRequest {
  const req: UpdateModelParameterPresetRequest = {
    name: form.name.trim(),
    description: form.description.trim() || null,
  }
  for (const { key } of PRESET_PARAMETERS) {
    req[key] = form.parameters[key] ?? null
  }
  return req
}

/** Create request that copies a preset under a new name, never as default */
export function presetToCopyRequest(
  preset: ModelParameterPreset,
  name: string
): CreateModelParameterPresetRequest {
  return {
    ...formToCreateRequest(presetToForm(preset)),
    name,
    additional_params: preset.additional_params ?? undefined,
    is_default: false,
  }
}

/** Compact one-line summary for list rows, e.g. "T 0.7 · P 0.8 · 4096 tok" */
export function summarizePreset(preset: ModelParameterPreset): string {
  const parts: string[] = []
  if (preset.temperature != null) parts.push(`T ${preset.temperature}`)
  if (preset.top_p != null) parts.push(`P ${preset.top_p}`)
  if (preset.max_tokens != null) parts.push(`${preset.max_tokens} tok`)
  return parts.join(' · ')
}
