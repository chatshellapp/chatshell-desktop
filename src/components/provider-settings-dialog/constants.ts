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
  // International
  { id: 'github_models', name: 'GitHub Models', baseUrl: 'https://models.inference.ai.azure.com' },
  { id: 'fireworks', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1' },
  { id: 'nvidia', name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  { id: 'huggingface', name: 'Hugging Face', baseUrl: 'https://api-inference.huggingface.co/v1' },
  { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1' },
  // Chinese AI
  { id: 'zhipu', name: 'Zhipu AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'yi', name: '01.AI', baseUrl: 'https://api.lingyiwanwu.com/v1' },
  { id: 'baichuan', name: 'Baichuan', baseUrl: 'https://api.baichuan-ai.com/v1' },
  {
    id: 'dashscope',
    name: 'Alibaba Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  { id: 'stepfun', name: 'StepFun', baseUrl: 'https://api.stepfun.com/v1' },
  { id: 'doubao', name: 'Doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'hunyuan', name: 'Tencent Hunyuan', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1' },
  {
    id: 'tencent_cloud_ti',
    name: 'Tencent Cloud TI',
    baseUrl: 'https://api.lkeap.cloud.tencent.com/v1',
  },
  { id: 'baidu_cloud', name: 'Baidu Cloud', baseUrl: 'https://qianfan.baidubce.com/v2' },
  { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'modelscope', name: 'ModelScope', baseUrl: 'https://api-inference.modelscope.cn/v1' },
  { id: 'xirang', name: 'Xirang', baseUrl: 'https://wishub-x1.ctyun.cn/v1' },
  { id: 'mimo', name: 'Xiaomi MiMo', baseUrl: 'https://api.xiaomimimo.com/v1' },
  // Local
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434' },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { id: 'gpustack', name: 'GPUStack', baseUrl: 'http://localhost:80/v1' },
  { id: 'ovms', name: 'OVMS', baseUrl: 'http://localhost:8000/v1' },
]

/**
 * Default models pre-populated for each provider so users don't have to
 * configure them manually. Users can still delete or add more models.
 * Aggregators like OpenRouter have more defaults.
 */
export const DEFAULT_PROVIDER_MODELS: Record<
  string,
  Array<{ modelId: string; displayName: string }>
> = {
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
  moonshot: [{ modelId: 'kimi-k2.5', displayName: 'Kimi K2.5' }],
  hyperbolic: [
    { modelId: 'meta-llama/Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B' },
    { modelId: 'deepseek-ai/DeepSeek-V3', displayName: 'DeepSeek V3' },
  ],
  galadriel: [{ modelId: 'llama3.3:70b', displayName: 'Llama 3.3 70B' }],
  minimax: [{ modelId: 'minimax-m2.5', displayName: 'MiniMax M2.5' }],
  minimax_cn: [{ modelId: 'MiniMax-M2.5', displayName: 'MiniMax M2.5' }],
  mira: [{ modelId: 'mira/llama-3.1-70b', displayName: 'Llama 3.1 70B' }],
  // International
  github_models: [{ modelId: 'gpt-4o', displayName: 'GPT-4o' }],
  fireworks: [
    {
      modelId: 'accounts/fireworks/models/llama-v3-70b-instruct',
      displayName: 'Llama 3 70B Instruct',
    },
  ],
  nvidia: [{ modelId: 'meta/llama-3.1-405b-instruct', displayName: 'Llama 3.1 405B Instruct' }],
  cerebras: [
    { modelId: 'gpt-oss-120b', displayName: 'GPT OSS 120B' },
    { modelId: 'qwen-3-235b-a22b-instruct-2507', displayName: 'Qwen 3 235B Instruct' },
  ],
  // Chinese AI
  zhipu: [
    { modelId: 'glm-5', displayName: 'GLM-5' },
    { modelId: 'glm-4.7', displayName: 'GLM-4.7' },
    { modelId: 'glm-4.6', displayName: 'GLM-4.6' },
    { modelId: 'glm-4.5-flash', displayName: 'GLM-4.5 Flash' },
  ],
  yi: [{ modelId: 'yi-lightning', displayName: 'Yi Lightning' }],
  baichuan: [
    { modelId: 'Baichuan4', displayName: 'Baichuan 4' },
    { modelId: 'Baichuan4-Turbo', displayName: 'Baichuan 4 Turbo' },
    { modelId: 'Baichuan3-Turbo', displayName: 'Baichuan 3 Turbo' },
  ],
  dashscope: [
    { modelId: 'qwen3.5-plus', displayName: 'Qwen 3.5 Plus' },
    { modelId: 'qwen3-max', displayName: 'Qwen 3 Max' },
    { modelId: 'qwen-max', displayName: 'Qwen Max' },
    { modelId: 'qwen-plus', displayName: 'Qwen Plus' },
    { modelId: 'qwen-flash', displayName: 'Qwen Flash' },
  ],
  stepfun: [
    { modelId: 'step-1-8k', displayName: 'Step 1 8K' },
    { modelId: 'step-1-flash', displayName: 'Step 1 Flash' },
  ],
  doubao: [
    { modelId: 'doubao-seed-1-8-251228', displayName: 'Doubao Seed 1.8' },
    { modelId: 'doubao-1-5-pro-32k-250115', displayName: 'Doubao 1.5 Pro 32K' },
    { modelId: 'doubao-1-5-lite-32k-250115', displayName: 'Doubao 1.5 Lite 32K' },
    { modelId: 'deepseek-v3-250324', displayName: 'DeepSeek V3' },
  ],
  hunyuan: [
    { modelId: 'hunyuan-turbo', displayName: 'Hunyuan Turbo' },
    { modelId: 'hunyuan-pro', displayName: 'Hunyuan Pro' },
    { modelId: 'hunyuan-standard', displayName: 'Hunyuan Standard' },
    { modelId: 'hunyuan-lite', displayName: 'Hunyuan Lite' },
  ],
  tencent_cloud_ti: [
    { modelId: 'deepseek-r1', displayName: 'DeepSeek R1' },
    { modelId: 'deepseek-v3', displayName: 'DeepSeek V3' },
  ],
  baidu_cloud: [
    { modelId: 'ernie-4.0-8k-latest', displayName: 'ERNIE 4.0' },
    { modelId: 'ernie-4.0-turbo-8k-latest', displayName: 'ERNIE 4.0 Turbo' },
    { modelId: 'deepseek-r1', displayName: 'DeepSeek R1' },
    { modelId: 'deepseek-v3', displayName: 'DeepSeek V3' },
  ],
  siliconflow: [
    { modelId: 'deepseek-ai/DeepSeek-V3.2', displayName: 'DeepSeek V3.2' },
    { modelId: 'Qwen/Qwen3-8B', displayName: 'Qwen 3 8B' },
  ],
  modelscope: [
    { modelId: 'Qwen/Qwen2.5-72B-Instruct', displayName: 'Qwen 2.5 72B Instruct' },
    { modelId: 'deepseek-ai/DeepSeek-R1', displayName: 'DeepSeek R1' },
    { modelId: 'deepseek-ai/DeepSeek-V3', displayName: 'DeepSeek V3' },
  ],
  mimo: [{ modelId: 'mimo-v2-flash', displayName: 'MiMo V2 Flash' }],
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
  // International
  'github_models',
  'fireworks',
  'nvidia',
  'huggingface',
  'cerebras',
  // Chinese AI
  'zhipu',
  'yi',
  'baichuan',
  'dashscope',
  'stepfun',
  'doubao',
  'hunyuan',
  'tencent_cloud_ti',
  'baidu_cloud',
  'siliconflow',
  'modelscope',
  'xirang',
  'mimo',
  // Local
  'lmstudio',
  'gpustack',
  'ovms',
])

export function isSupportedFetchProvider(id: string): boolean {
  return FETCH_SUPPORTED_PROVIDERS.has(id)
}
