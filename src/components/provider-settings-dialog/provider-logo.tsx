import openaiLogo from '@/assets/avatars/providers/openai.png'
import anthropicLogo from '@/assets/avatars/providers/anthropic.png'
import googleLogo from '@/assets/avatars/providers/google.png'
import openrouterLogo from '@/assets/avatars/providers/openrouter.png'
import azureLogo from '@/assets/avatars/providers/azure.png'
import deepseekLogo from '@/assets/avatars/providers/deepseek.png'
import groqLogo from '@/assets/avatars/providers/groq.png'
import mistralLogo from '@/assets/avatars/providers/mistral.png'
import perplexityLogo from '@/assets/avatars/providers/perplexity.png'
import togetherLogo from '@/assets/avatars/providers/together.png'
import xaiLogo from '@/assets/avatars/providers/xai.png'
import cohereLogo from '@/assets/avatars/providers/cohere.png'
import moonshotLogo from '@/assets/avatars/providers/moonshot.png'
import hyperbolicLogo from '@/assets/avatars/providers/hyperbolic.png'
import minimaxLogo from '@/assets/avatars/providers/minimax.png'
import githubLogo from '@/assets/avatars/providers/github.png'
import fireworksLogo from '@/assets/avatars/providers/fireworks.png'
import nvidiaLogo from '@/assets/avatars/providers/nvidia.png'
import huggingfaceLogo from '@/assets/avatars/providers/huggingface.png'
import cerebrasLogo from '@/assets/avatars/providers/cerebras.png'
import zhipuLogo from '@/assets/avatars/providers/zhipu.png'
import yiLogo from '@/assets/avatars/providers/yi.png'
import baichuanLogo from '@/assets/avatars/providers/baichuan.png'
import alibabaLogo from '@/assets/avatars/providers/alibaba.png'
import stepfunLogo from '@/assets/avatars/providers/stepfun.png'
import doubaoLogo from '@/assets/avatars/providers/doubao.png'
import hunyuanLogo from '@/assets/avatars/providers/hunyuan.png'
import tencentLogo from '@/assets/avatars/providers/tencent.png'
import baiduLogo from '@/assets/avatars/providers/baidu.png'
import siliconflowLogo from '@/assets/avatars/providers/siliconflow.png'
import modelscopeLogo from '@/assets/avatars/providers/modelscope.png'
import mimoLogo from '@/assets/avatars/providers/mimo.png'
import ollamaLogo from '@/assets/avatars/providers/ollama.png'
import lmstudioLogo from '@/assets/avatars/providers/lmstudio.png'

const PROVIDER_LOGOS: Record<string, string> = {
  openai: openaiLogo,
  anthropic: anthropicLogo,
  gemini: googleLogo,
  openrouter: openrouterLogo,
  azure: azureLogo,
  deepseek: deepseekLogo,
  groq: groqLogo,
  mistral: mistralLogo,
  perplexity: perplexityLogo,
  together: togetherLogo,
  xai: xaiLogo,
  cohere: cohereLogo,
  moonshot: moonshotLogo,
  hyperbolic: hyperbolicLogo,
  minimax: minimaxLogo,
  minimax_cn: minimaxLogo,
  github_models: githubLogo,
  fireworks: fireworksLogo,
  nvidia: nvidiaLogo,
  huggingface: huggingfaceLogo,
  cerebras: cerebrasLogo,
  zhipu: zhipuLogo,
  yi: yiLogo,
  baichuan: baichuanLogo,
  dashscope: alibabaLogo,
  stepfun: stepfunLogo,
  doubao: doubaoLogo,
  hunyuan: hunyuanLogo,
  tencent_cloud_ti: tencentLogo,
  baidu_cloud: baiduLogo,
  siliconflow: siliconflowLogo,
  modelscope: modelscopeLogo,
  mimo: mimoLogo,
  ollama: ollamaLogo,
  lmstudio: lmstudioLogo,
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
  // International
  github_models: 'GitHub Models',
  fireworks: 'Fireworks AI',
  nvidia: 'NVIDIA NIM',
  huggingface: 'Hugging Face',
  cerebras: 'Cerebras',
  lmstudio: 'LM Studio',
  gpustack: 'GPUStack',
  ovms: 'OVMS',
  // Chinese AI
  zhipu: 'Zhipu AI',
  yi: '01.AI',
  baichuan: 'Baichuan',
  dashscope: 'Alibaba Qwen',
  stepfun: 'StepFun',
  doubao: 'Doubao',
  hunyuan: 'Tencent Hunyuan',
  tencent_cloud_ti: 'Tencent Cloud TI',
  baidu_cloud: 'Baidu Cloud',
  siliconflow: 'SiliconFlow',
  modelscope: 'ModelScope',
  xirang: 'Xirang',
  mimo: 'Xiaomi MiMo',
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
