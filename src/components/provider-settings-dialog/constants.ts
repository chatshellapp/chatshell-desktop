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
  // International
  { id: 'github_models', name: 'GitHub Models', baseUrl: 'https://models.inference.ai.azure.com' },
  { id: 'fireworks', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1' },
  { id: 'nvidia', name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  { id: 'huggingface', name: 'Hugging Face', baseUrl: 'https://api-inference.huggingface.co/v1' },
  { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1' },
  { id: 'zenmux', name: 'ZenMux', baseUrl: 'https://zenmux.ai/api/v1' },
  // Chinese AI
  { id: 'zai', name: 'Z.ai', baseUrl: 'https://api.z.ai/api/paas/v4' },
  { id: 'zhipu', name: 'Zhipu AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'yi', name: '01.AI', baseUrl: 'https://api.lingyiwanwu.com/v1' },
  { id: 'baichuan', name: 'Baichuan', baseUrl: 'https://api.baichuan-ai.com/v1' },
  {
    id: 'dashscope',
    name: 'Alibaba Cloud Bailian',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  { id: 'stepfun', name: 'StepFun', baseUrl: 'https://api.stepfun.com/v1' },
  { id: 'doubao', name: 'Volcengine', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  {
    id: 'tokenhub',
    name: 'Tencent Cloud TokenHub',
    baseUrl: 'https://tokenhub.tencentmaas.com/v1',
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
  'anthropic',
  'custom',
  'custom_anthropic',
  'custom_openai',
  // International
  'github_models',
  'fireworks',
  'nvidia',
  'huggingface',
  'cerebras',
  'zenmux',
  // Chinese AI
  'zai',
  'zhipu',
  'yi',
  'baichuan',
  'dashscope',
  'stepfun',
  'doubao',
  'tokenhub',
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

// Providers whose model list can be fetched without an API key.
const NO_KEY_FETCH_PROVIDERS = new Set(['ollama', 'lmstudio', 'gpustack', 'ovms'])

export function requiresApiKeyForFetch(id: string): boolean {
  return !NO_KEY_FETCH_PROVIDERS.has(id)
}
