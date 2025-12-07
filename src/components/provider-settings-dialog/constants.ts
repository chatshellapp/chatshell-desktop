import type { LLMProvider } from './types'

import openaiLogo from '@/assets/avatars/providers/openai.png'
// import anthropicLogo from '@/assets/avatars/providers/anthropic.png'
// import googleLogo from '@/assets/avatars/providers/google.png'
import openrouterLogo from '@/assets/avatars/providers/openrouter.png'
import ollamaLogo from '@/assets/avatars/providers/ollama.png'
// import azureLogo from '@/assets/avatars/providers/azure.png'
// import cohereLogo from '@/assets/avatars/providers/cohere.png'
// import huggingfaceLogo from '@/assets/avatars/providers/huggingface.png'

export const llmProviders: LLMProvider[] = [
  { id: 'openai', name: 'OpenAI', logo: openaiLogo, baseUrl: 'https://api.openai.com/v1' },
  // { id: 'anthropic', name: 'Anthropic', logo: anthropicLogo, baseUrl: 'https://api.anthropic.com' },
  // {
  //   id: 'google',
  //   name: 'Google AI',
  //   logo: googleLogo,
  //   baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  // },
  { id: 'openrouter', name: 'OpenRouter', logo: openrouterLogo, baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'ollama', name: 'Ollama', logo: ollamaLogo, baseUrl: 'http://localhost:11434' },
  // { id: 'azure', name: 'Azure OpenAI', logo: azureLogo, baseUrl: 'https://{resource}.openai.azure.com' },
  // { id: 'cohere', name: 'Cohere', logo: cohereLogo, baseUrl: 'https://api.cohere.ai/v1' },
  // {
  //   id: 'huggingface',
  //   name: 'Hugging Face',
  //   logo: huggingfaceLogo,
  //   baseUrl: 'https://api-inference.huggingface.co',
  // },
]

// Supported provider types for model fetching
export const SUPPORTED_FETCH_PROVIDERS = ['openai', 'openrouter', 'ollama'] as const
export type SupportedFetchProvider = (typeof SUPPORTED_FETCH_PROVIDERS)[number]

export function isSupportedFetchProvider(id: string): id is SupportedFetchProvider {
  return SUPPORTED_FETCH_PROVIDERS.includes(id as SupportedFetchProvider)
}

