import type { LLMProvider } from './types'

export const CUSTOM_PROVIDER: LLMProvider = {
  id: 'custom',
  name: 'Custom Provider',
  baseUrl: '',
  isCustom: true,
}

export const BUILTIN_PROVIDERS: LLMProvider[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com' },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
  },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'azure', name: 'Azure OpenAI', baseUrl: '' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai' },
  { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz' },
  { id: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai' },
  { id: 'cohere', name: 'Cohere', baseUrl: 'https://api.cohere.ai' },
  { id: 'moonshot', name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'hyperbolic', name: 'Hyperbolic', baseUrl: 'https://api.hyperbolic.xyz' },
  { id: 'galadriel', name: 'Galadriel', baseUrl: 'https://api.galadriel.com/v1/verified' },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.io/v1' },
  { id: 'minimax_cn', name: 'MiniMax CN', baseUrl: 'https://api.minimaxi.com/v1' },
  { id: 'mira', name: 'Mira', baseUrl: 'https://api.mira.network' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434' },
]

export const LLM_PROVIDERS: LLMProvider[] = [...BUILTIN_PROVIDERS]

// Providers that support auto-fetching models via API
const FETCH_SUPPORTED_PROVIDERS = new Set([
  'openai',
  'openrouter',
  'ollama',
  'deepseek',
  'groq',
  'together',
  'xai',
  'moonshot',
  'perplexity',
  'hyperbolic',
  'mistral',
  'minimax',
  'minimax_cn',
  'mira',
  'galadriel',
  'cohere',
  'custom',
  'custom_openai',
])

export function isSupportedFetchProvider(id: string): boolean {
  return FETCH_SUPPORTED_PROVIDERS.has(id)
}
