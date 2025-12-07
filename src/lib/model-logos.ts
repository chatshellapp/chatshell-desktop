/**
 * Model logo mapping utility - simplified version
 * Maps model IDs/names to their corresponding logo images using regex patterns
 */

import type { Model } from '@/types'

// Import model logo assets
import gptAvatar from '@/assets/avatars/models/gpt.png'
import claudeAvatar from '@/assets/avatars/models/claude.png'
import geminiAvatar from '@/assets/avatars/models/gemini.png'
import llamaAvatar from '@/assets/avatars/models/llama.png'
import gemmaAvatar from '@/assets/avatars/models/gemma.png'
import grokAvatar from '@/assets/avatars/models/grok.png'
import deepseekAvatar from '@/assets/avatars/models/deepseek.png'
import doubaoAvatar from '@/assets/avatars/models/doubao.png'
import qwenAvatar from '@/assets/avatars/models/qwen.png'
import glmAvatar from '@/assets/avatars/models/glm.png'
import minimaxAvatar from '@/assets/avatars/models/minimax.png'
// Import more model logos as needed...

type LogoMap = Record<string, string>

/**
 * Get model logo URL by model ID or name using regex matching
 * Returns undefined if no match is found
 */
export function getModelLogoById(modelId: string): string | undefined {
  if (!modelId) {
    return undefined
  }

  // Define logo mapping with regex patterns (case-insensitive)
  // Key is a regex pattern, value is the logo path
  const logoMap: LogoMap = {
    // OpenAI models - unified pattern
    '(o[1-9]|gpt-[3-9]|gpt|chatgpt|text-moderation|text-embedding|dall-e|whisper|tts)': gptAvatar,

    // Anthropic Claude models
    '(claude|anthropic)': claudeAvatar,

    // Google models
    '(gemini|palm|bison)': geminiAvatar,
    gemma: gemmaAvatar,

    // Meta models
    llama: llamaAvatar,

    // Alibaba models
    '(qwen|qwq|qvq)': qwenAvatar,

    // DeepSeek models
    deepseek: deepseekAvatar, // Replace with deepseek logo

    // Mistral models
    // '(mixtral|mistral|codestral|ministral|magistral)': gptAvatar, // Replace with mistral logo

    // Moonshot models
    // '(moonshot|kimi)': gptAvatar, // Replace with moonshot logo

    // Zhipu AI models
    '(glm|chatglm|cogview|zhipu)': glmAvatar,

    // ByteDance models
    '(doubao|seedream|ep-202)': doubaoAvatar, // Replace with doubao logo

    // Baidu models
    // '(ernie|wenxin|tao-)': gptAvatar, // Replace with wenxin logo

    // Tencent models
    // 'hunyuan': gptAvatar, // Replace with hunyuan logo

    // iFlytek models
    // '(sparkdesk|generalv)': gptAvatar, // Replace with sparkdesk logo

    // 01.AI models
    // 'yi-': gptAvatar, // Replace with yi logo

    // Cohere models
    // '(cohere|command)': gptAvatar, // Replace with cohere logo

    // StepFun models
    // 'step': gptAvatar, // Replace with step logo

    // MiniMax models
    '(minimax|abab)': minimaxAvatar,

    // Stability AI models
    // '(stable-|sdxl|sd3|sd2)': gptAvatar, // Replace with stability logo

    // Grok models
    grok: grokAvatar,

    // Microsoft models
    // '(phi|wizardlm|microsoft)': gptAvatar, // Replace with microsoft logo

    // Baichuan models
    // 'baichuan': gptAvatar, // Replace with baichuan logo

    // GitHub Copilot
    // '(copilot|creative|balanced|precise)': gptAvatar, // Replace with copilot logo

    // Other models
    // '(minicpm|360|aimass|codegeex|dbrx|flashaudio|flux|hailuo|internlm|internvl|llava|magic|midjourney|mj-)': gptAvatar,
    // '(nvidia|upstage|rakutenai|ibm|hugging|youdao|embedding|perplexity|sonar|bge-|voyage-|tokenflux|nomic-|pangu-|bytedance|ling|ring)': gptAvatar,
  }

  // Try to match against each pattern
  for (const [pattern, logo] of Object.entries(logoMap)) {
    try {
      const regex = new RegExp(pattern, 'i') // Case-insensitive
      if (regex.test(modelId)) {
        return logo
      }
    } catch (error) {
      console.warn(`Invalid regex pattern: ${pattern}`, error)
    }
  }

  return undefined
}

/**
 * Get model logo from a Model object
 * Tries to match against model.id first, then falls back to model.name
 */
export function getModelLogo(model: Model | undefined | null): string | undefined {
  if (!model) return undefined

  // Try model.model_id first (e.g., "gpt-4-turbo")
  let logo = getModelLogoById(model.model_id)
  if (logo) return logo

  // Fall back to model.name (e.g., "GPT-4 Turbo")
  logo = getModelLogoById(model.name)
  if (logo) return logo

  return undefined
}

/**
 * Get model logo with fallback character
 * Returns an object indicating whether to use an image or a fallback character
 */
export function getModelAvatarData(model: Model | undefined | null): {
  logo?: string
  fallback: string
} {
  const logo = getModelLogo(model)
  const fallback = model?.name?.charAt(0)?.toUpperCase() || 'M'

  return { logo, fallback }
}
