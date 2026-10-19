import llamaAvatar from '@/assets/avatars/models/llama.png'
import { describe, it, expect, vi } from 'vitest'
import { getModelLogoById, getModelLogo, getModelAvatarData } from '../model-logos'
import type { Model } from '@/types'
import gptAvatar from '@/assets/avatars/models/gpt.png'
import claudeAvatar from '@/assets/avatars/models/claude.png'
import geminiAvatar from '@/assets/avatars/models/gemini.png'
import gemmaAvatar from '@/assets/avatars/models/gemma.png'
import qwenAvatar from '@/assets/avatars/models/qwen.png'
import glmAvatar from '@/assets/avatars/models/glm.png'
import doubaoAvatar from '@/assets/avatars/models/doubao.png'
import mistralAvatar from '@/assets/avatars/models/mistral.png'
import kimiAvatar from '@/assets/avatars/models/kimi.png'
import minimaxAvatar from '@/assets/avatars/models/minimax.png'
import grokAvatar from '@/assets/avatars/models/grok.png'
import copilotAvatar from '@/assets/avatars/models/copilot.png'
import perplexityAvatar from '@/assets/avatars/models/perplexity.png'
import midjourneyAvatar from '@/assets/avatars/models/midjourney.png'
import upstageAvatar from '@/assets/avatars/models/upstage.png'
import voyageAvatar from '@/assets/avatars/models/voyage.png'

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

const makeModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'model-1',
  name: 'Custom Model',
  provider_id: 'provider-1',
  model_id: 'custom-model',
  is_starred: false,
  is_deleted: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('getModelLogoById', () => {
  it.each([
    ['gpt-4-turbo', gptAvatar],
    ['gpt-4o-mini', gptAvatar],
    ['chatgpt-4o-latest', gptAvatar],
    ['o3-mini', gptAvatar],
    ['text-embedding-3-small', gptAvatar],
    ['dall-e-3', gptAvatar],
    ['whisper-1', gptAvatar],
    ['claude-3-5-sonnet-20241022', claudeAvatar],
    ['anthropic/claude-opus-4', claudeAvatar],
    ['gemini-1.5-pro', geminiAvatar],
    ['palm-2', geminiAvatar],
    ['bison-001', geminiAvatar],
    ['gemma-2-9b-it', gemmaAvatar],
    ['qwen2.5-72b-instruct', qwenAvatar],
    ['qwq-32b-preview', qwenAvatar],
    ['qvq-72b', qwenAvatar],
    ['glm-4.5-air', glmAvatar],
    ['chatglm3-6b', glmAvatar],
    ['doubao-pro-32k', doubaoAvatar],
    ['ep-20240903144317', doubaoAvatar],
    ['mistral-large-latest', mistralAvatar],
    ['codestral-latest', mistralAvatar],
    ['moonshot-v1-8k', kimiAvatar],
    ['kimi-k2-instruct', kimiAvatar],
    ['minimax-m2', minimaxAvatar],
    ['abab6.5s-chat', minimaxAvatar],
    ['grok-4', grokAvatar],
    ['copilot-creative', copilotAvatar],
    ['creative', copilotAvatar],
    ['sonar-reasoning-pro', perplexityAvatar],
    ['github-copilot', copilotAvatar],
    ['mj-v6', midjourneyAvatar],
    ['solar-pro', upstageAvatar],
    ['voyage-3', voyageAvatar],
  ])('maps %s to the vendor logo', (modelId, expected) => {
    expect(getModelLogoById(modelId)).toBe(expected)
  })

  it('matches case-insensitively', () => {
    expect(getModelLogoById('GPT-4-TURBO')).toBe(gptAvatar)
    expect(getModelLogoById('Claude-Sonnet-4')).toBe(claudeAvatar)
    expect(getModelLogoById('Qwen2.5-Max')).toBe(qwenAvatar)
  })

  it('matches substrings anywhere in the id', () => {
    expect(getModelLogoById('openai/gpt-4o')).toBe(gptAvatar)
    expect(getModelLogoById('together/meta-llama-3')).toBe(llamaAvatar)
  })

  it('returns undefined for empty ids', () => {
    expect(getModelLogoById('')).toBeUndefined()
  })

  it('returns undefined for unknown vendors', () => {
    expect(getModelLogoById('totally-unknown-model')).toBeUndefined()
    expect(getModelLogoById('my-own-inhouse-llm')).toBeUndefined()
  })

  it('returns undefined for plain digits or symbols that match no pattern', () => {
    expect(getModelLogoById('12345')).toBeUndefined()
  })
})

describe('getModelLogo', () => {
  it('returns undefined for missing models', () => {
    expect(getModelLogo(undefined)).toBeUndefined()
    expect(getModelLogo(null)).toBeUndefined()
  })

  it('prefers the model_id match over the display name', () => {
    const model = makeModel({ model_id: 'gpt-4o', name: 'Some Fancy Label' })

    expect(getModelLogo(model)).toBe(gptAvatar)
  })

  it('falls back to the display name when model_id does not match', () => {
    const model = makeModel({ model_id: 'internal-alias-7', name: 'Claude 3.5 Sonnet' })

    expect(getModelLogo(model)).toBe(claudeAvatar)
  })

  it('returns undefined when neither model_id nor name matches', () => {
    const model = makeModel({ model_id: 'internal-alias-7', name: 'House Model' })

    expect(getModelLogo(model)).toBeUndefined()
  })
})

describe('getModelAvatarData', () => {
  it('returns the logo with the uppercased first letter of the name', () => {
    const model = makeModel({ model_id: 'gpt-4o', name: 'gpt-4o' })

    expect(getModelAvatarData(model)).toEqual({ logo: gptAvatar, fallback: 'G' })
  })

  it('falls back to a letter when no logo matches', () => {
    const model = makeModel({ model_id: 'internal-alias-7', name: 'zephyr-custom' })

    expect(getModelAvatarData(model)).toEqual({ logo: undefined, fallback: 'Z' })
  })

  it('uses the generic M fallback for models without a name', () => {
    const model = makeModel({ name: '' })

    expect(getModelAvatarData(model)).toEqual({ logo: undefined, fallback: 'M' })
  })

  it('uses the generic M fallback for a missing model', () => {
    expect(getModelAvatarData(undefined)).toEqual({ logo: undefined, fallback: 'M' })
  })
})
