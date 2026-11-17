import { describe, it, expect } from 'vitest'
import {
  emptyPresetForm,
  formToCreateRequest,
  formToUpdateRequest,
  parseAdditionalParams,
  presetToCopyRequest,
  presetToForm,
  summarizePreset,
} from '../preset-utils'
import type { ModelParameterPreset } from '@/types'

const NOW = '2026-01-01T00:00:00Z'

const preset: ModelParameterPreset = {
  id: 'p-1',
  name: 'Review',
  description: 'Careful',
  temperature: 0,
  max_tokens: 2048,
  top_p: undefined,
  frequency_penalty: 0.1,
  presence_penalty: undefined,
  additional_params: { seed: 7 },
  is_system: false,
  is_default: true,
  created_at: NOW,
  updated_at: NOW,
}

describe('preset-utils', () => {
  it('keeps zero values and drops unset ones when building a form', () => {
    expect(presetToForm(preset)).toEqual({
      name: 'Review',
      description: 'Careful',
      parameters: { temperature: 0, max_tokens: 2048, frequency_penalty: 0.1 },
      additionalParams: '{\n  "seed": 7\n}',
    })
  })

  it('omits unset parameters on create', () => {
    const req = formToCreateRequest({
      name: '  New  ',
      description: '  ',
      parameters: { temperature: 0.3 },
      additionalParams: '',
    })
    expect(req).toEqual({ name: 'New', description: undefined, temperature: 0.3 })
  })

  it('sends additional parameters on create when the field holds an object', () => {
    const req = formToCreateRequest({
      name: 'New',
      description: '',
      parameters: {},
      additionalParams: ' {"reasoning_effort": "low"} ',
    })
    expect(req.additional_params).toEqual({ reasoning_effort: 'low' })
  })

  it('accepts only an empty field or a JSON object as additional parameters', () => {
    expect(parseAdditionalParams('')).toEqual({ ok: true, value: null })
    expect(parseAdditionalParams('  \n ')).toEqual({ ok: true, value: null })
    expect(parseAdditionalParams('{"seed": 1}')).toEqual({ ok: true, value: { seed: 1 } })
    for (const bad of ['[1]', '"text"', '3', 'null', '{seed: 1}', '{']) {
      expect(parseAdditionalParams(bad)).toEqual({ ok: false })
    }
  })

  it('sends null for unset parameters on update so they are cleared', () => {
    const req = formToUpdateRequest({
      name: 'X',
      description: '',
      parameters: { top_p: 0.5 },
      additionalParams: '',
    })
    expect(req).toEqual({
      name: 'X',
      description: null,
      temperature: null,
      top_p: 0.5,
      max_tokens: null,
      frequency_penalty: null,
      presence_penalty: null,
      additional_params: null,
    })
    // Untouched by the form, so the backend keeps it
    expect(req).not.toHaveProperty('is_default')

    const withExtra = formToUpdateRequest({
      name: 'X',
      description: '',
      parameters: {},
      additionalParams: '{"seed": 2}',
    })
    expect(withExtra.additional_params).toEqual({ seed: 2 })
  })

  it('copies every parameter but never the default flag', () => {
    expect(presetToCopyRequest(preset, 'Review (Copy)')).toEqual({
      name: 'Review (Copy)',
      description: 'Careful',
      temperature: 0,
      max_tokens: 2048,
      frequency_penalty: 0.1,
      additional_params: { seed: 7 },
      is_default: false,
    })
  })

  it('summarizes the main parameters', () => {
    expect(summarizePreset(preset)).toBe('T 0 · 2048 tok')
    expect(summarizePreset({ ...preset, temperature: undefined, max_tokens: undefined })).toBe('')
  })

  it('starts new presets with temperature and top_p set', () => {
    expect(Object.keys(emptyPresetForm().parameters).sort()).toEqual(['temperature', 'top_p'])
  })
})
