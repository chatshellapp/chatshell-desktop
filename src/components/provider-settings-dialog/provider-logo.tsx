import openaiLogo from '@/assets/avatars/providers/openai.png'
import anthropicLogo from '@/assets/avatars/providers/anthropic.png'
import googleLogo from '@/assets/avatars/providers/google.png'
import openrouterLogo from '@/assets/avatars/providers/openrouter.png'
import ollamaLogo from '@/assets/avatars/providers/ollama.png'
import azureLogo from '@/assets/avatars/providers/azure.png'
import cohereLogo from '@/assets/avatars/providers/cohere.png'
import xaiLogo from '@/assets/avatars/providers/xai.png'

const PROVIDER_LOGOS: Record<string, string> = {
  openai: openaiLogo,
  anthropic: anthropicLogo,
  gemini: googleLogo,
  openrouter: openrouterLogo,
  ollama: ollamaLogo,
  azure: azureLogo,
  cohere: cohereLogo,
  xai: xaiLogo,
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  azure: 'Azure OpenAI',
  cohere: 'Cohere',
  deepseek: 'DeepSeek',
  galadriel: 'Galadriel',
  groq: 'Groq',
  hyperbolic: 'Hyperbolic',
  minimax: 'MiniMax',
  minimax_cn: 'MiniMax CN',
  mira: 'Mira',
  mistral: 'Mistral',
  moonshot: 'Moonshot',
  perplexity: 'Perplexity',
  together: 'Together AI',
  xai: 'xAI',
  custom: 'Custom Provider',
  custom_openai: 'OpenAI Compatible',
  custom_anthropic: 'Anthropic Compatible',
}

/** Get the logo URL for a provider type. Returns undefined if no logo exists. */
export function getProviderLogo(providerType: string): string | undefined {
  return PROVIDER_LOGOS[providerType]
}

/** Get a human-readable display name for a provider type. */
export function getProviderDisplayName(providerType: string): string {
  return PROVIDER_DISPLAY_NAMES[providerType] ?? providerType
}

interface ProviderLogoProps {
  /** Provider type identifier (e.g. "openai", "anthropic"). Logo is resolved internally. */
  providerType: string
  /** Optional override for the display name used in alt text and letter fallback. */
  name?: string
  className?: string
}

export function ProviderLogo({ providerType, name, className = 'size-4' }: ProviderLogoProps) {
  const logo = PROVIDER_LOGOS[providerType]
  const displayName = name ?? getProviderDisplayName(providerType)

  if (logo) {
    return <img src={logo} alt={displayName} className={`${className} rounded`} />
  }

  return (
    <span
      className={`${className} inline-flex items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground`}
    >
      {displayName[0]}
    </span>
  )
}
