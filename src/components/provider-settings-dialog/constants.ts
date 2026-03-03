import type { LLMProvider, ModelItem } from './types'

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

/**
 * Default models pre-populated for each provider so users don't have to
 * configure them manually. Users can still delete or add more models.
 * Aggregators like OpenRouter have more defaults.
 */
export const DEFAULT_PROVIDER_MODELS: Record<string, Array<{ modelId: string; displayName: string }>> = {
  openai: [
    { modelId: 'gpt-5.2', displayName: 'GPT-5.2' },
    { modelId: 'gpt-5-mini', displayName: 'GPT-5 Mini' },
    { modelId: 'gpt-5-nano', displayName: 'GPT-5 Nano' },
  ],
  anthropic: [
    { modelId: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' },
    { modelId: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku' },
  ],
  gemini: [
    { modelId: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { modelId: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
    { modelId: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
  ],
  openrouter: [
    { modelId: 'openai/gpt-4o', displayName: 'GPT-4o' },
    { modelId: 'openai/o3-mini', displayName: 'o3-mini' },
    { modelId: 'anthropic/claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' },
    { modelId: 'anthropic/claude-3.5-haiku', displayName: 'Claude 3.5 Haiku' },
    { modelId: 'google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { modelId: 'google/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
    { modelId: 'deepseek/deepseek-chat-v3-0324', displayName: 'DeepSeek V3' },
    { modelId: 'deepseek/deepseek-r1', displayName: 'DeepSeek R1' },
    { modelId: 'meta-llama/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B' },
    { modelId: 'qwen/qwen-2.5-72b-instruct', displayName: 'Qwen 2.5 72B' },
  ],
  deepseek: [
    { modelId: 'deepseek-chat', displayName: 'DeepSeek Chat (V3)' },
    { modelId: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner (R1)' },
  ],
  groq: [
    { modelId: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B' },
    { modelId: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant' },
    { modelId: 'mixtral-8x7b-32768', displayName: 'Mixtral 8x7B' },
  ],
  mistral: [
    { modelId: 'mistral-large-latest', displayName: 'Mistral Large' },
    { modelId: 'mistral-small-latest', displayName: 'Mistral Small' },
    { modelId: 'codestral-latest', displayName: 'Codestral' },
  ],
  perplexity: [
    { modelId: 'sonar', displayName: 'Sonar' },
    { modelId: 'sonar-pro', displayName: 'Sonar Pro' },
    { modelId: 'sonar-reasoning', displayName: 'Sonar Reasoning' },
  ],
  together: [
    { modelId: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', displayName: 'Llama 3.3 70B Turbo' },
    { modelId: 'Qwen/Qwen2.5-72B-Instruct-Turbo', displayName: 'Qwen 2.5 72B Turbo' },
    { modelId: 'deepseek-ai/DeepSeek-V3', displayName: 'DeepSeek V3' },
  ],
  xai: [
    { modelId: 'grok-3', displayName: 'Grok 3' },
    { modelId: 'grok-3-mini', displayName: 'Grok 3 Mini' },
  ],
  cohere: [
    { modelId: 'command-r-plus', displayName: 'Command R+' },
    { modelId: 'command-r', displayName: 'Command R' },
  ],
  moonshot: [
    { modelId: 'moonshot-v1-128k', displayName: 'Moonshot v1 128K' },
    { modelId: 'moonshot-v1-32k', displayName: 'Moonshot v1 32K' },
    { modelId: 'moonshot-v1-8k', displayName: 'Moonshot v1 8K' },
  ],
  hyperbolic: [
    { modelId: 'meta-llama/Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B' },
    { modelId: 'deepseek-ai/DeepSeek-V3', displayName: 'DeepSeek V3' },
  ],
  galadriel: [
    { modelId: 'llama3.3:70b', displayName: 'Llama 3.3 70B' },
  ],
  minimax: [
    { modelId: 'MiniMax-Text-01', displayName: 'MiniMax Text 01' },
  ],
  minimax_cn: [
    { modelId: 'MiniMax-Text-01', displayName: 'MiniMax Text 01' },
  ],
  mira: [
    { modelId: 'mira/llama-3.1-70b', displayName: 'Llama 3.1 70B' },
  ],
}

/**
 * Get default ModelItem list for a provider type.
 * Each item gets a unique timestamp-based ID for the UI.
 */
export function getDefaultModelsForProvider(providerType: string): ModelItem[] {
  const defaults = DEFAULT_PROVIDER_MODELS[providerType]
  if (!defaults || defaults.length === 0) return []
  return defaults.map((m, i) => ({
    id: `default-${Date.now()}-${i}`,
    displayName: m.displayName,
    modelId: m.modelId,
  }))
}

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
