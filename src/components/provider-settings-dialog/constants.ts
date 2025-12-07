import { Bot, Database, Server } from 'lucide-react'
import type { LLMProvider } from './types'

export const llmProviders: LLMProvider[] = [
  { id: 'openai', name: 'OpenAI', icon: Bot, baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', icon: Bot, baseUrl: 'https://api.anthropic.com' },
  {
    id: 'google',
    name: 'Google AI',
    icon: Bot,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  { id: 'openrouter', name: 'OpenRouter', icon: Server, baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'ollama', name: 'Ollama', icon: Database, baseUrl: 'http://localhost:11434' },
  { id: 'azure', name: 'Azure OpenAI', icon: Bot, baseUrl: 'https://{resource}.openai.azure.com' },
  { id: 'cohere', name: 'Cohere', icon: Bot, baseUrl: 'https://api.cohere.ai/v1' },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    icon: Bot,
    baseUrl: 'https://api-inference.huggingface.co',
  },
]

// Supported provider types for model fetching
export const SUPPORTED_FETCH_PROVIDERS = ['openai', 'openrouter', 'ollama'] as const
export type SupportedFetchProvider = (typeof SUPPORTED_FETCH_PROVIDERS)[number]

export function isSupportedFetchProvider(id: string): id is SupportedFetchProvider {
  return SUPPORTED_FETCH_PROVIDERS.includes(id as SupportedFetchProvider)
}

