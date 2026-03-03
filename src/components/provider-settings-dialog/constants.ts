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
  azure: [
    { modelId: 'gpt-5.2', displayName: 'GPT-5.2' },
    { modelId: 'gpt-5-mini', displayName: 'GPT-5 Mini' },
    { modelId: 'gpt-5-nano', displayName: 'GPT-5 Nano' },
  ],
  anthropic: [
    { modelId: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
    { modelId: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
    { modelId: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
  ],
  gemini: [
    { modelId: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview' },
    { modelId: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash Preview' },
  ],
  openrouter: [
    { modelId: 'openai/gpt-5.2', displayName: 'OpenAI: GPT-5.2' },
    { modelId: 'openai/gpt-5-mini', displayName: 'OpenAI: GPT-5 Mini' },
    { modelId: 'openai/gpt-5-nano', displayName: 'OpenAI: GPT-5 Nano' },
    { modelId: 'anthropic/claude-opus-4-6', displayName: 'Anthropic: Claude Opus 4.6' },
    { modelId: 'anthropic/claude-sonnet-4-6', displayName: 'Anthropic: Claude Sonnet 4.6' },
    { modelId: 'anthropic/claude-haiku-4-5', displayName: 'Anthropic: Claude Haiku 4.5' },
    { modelId: 'google/gemini-3.1-pro-preview', displayName: 'Google: Gemini 3.1 Pro Preview' },
    { modelId: 'google/gemini-3-flash-preview', displayName: 'Google: Gemini 3 Flash Preview' },
    { modelId: 'minimax/minimax-m2.5', displayName: 'MiniMax: MiniMax M2.5' },
    { modelId: 'moonshotai/kimi-k2.5', displayName: 'MoonshotAI: Kimi K2.5' },
    { modelId: 'deepseek/deepseek-v3.2', displayName: 'DeepSeek: DeepSeek V3.2' },
    { modelId: 'deepseek/deepseek-r1', displayName: 'DeepSeek: DeepSeek R1' },
  ],
  deepseek: [
    { modelId: 'deepseek-chat', displayName: 'DeepSeek Chat' },
    { modelId: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner' },
  ],
  groq: [
    { modelId: 'groq/compound', displayName: 'Groq: Compound' },
    { modelId: 'openai/gpt-oss-120b', displayName: 'OpenAI: GPT-OSS 120B' },
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
    { modelId: 'grok-4-1-fast-reasoning', displayName: 'Grok 4.1 Fast Reasoning' },
    { modelId: 'grok-4-1-fast-non-reasoning', displayName: 'Grok 4.1 Fast Non-Reasoning' },
  ],
  cohere: [
    { modelId: 'command-r-plus', displayName: 'Command R+' },
    { modelId: 'command-r', displayName: 'Command R' },
  ],
  moonshot: [
    { modelId: 'kimi-k2.5', displayName: 'Kimi K2.5' },
  ],
  hyperbolic: [
    { modelId: 'meta-llama/Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B' },
    { modelId: 'deepseek-ai/DeepSeek-V3', displayName: 'DeepSeek V3' },
  ],
  galadriel: [
    { modelId: 'llama3.3:70b', displayName: 'Llama 3.3 70B' },
  ],
  minimax: [
    { modelId: 'minimax-m2.5', displayName: 'MiniMax M2.5' },
  ],
  minimax_cn: [
    { modelId: 'MiniMax-M2.5', displayName: 'MiniMax M2.5' },
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
