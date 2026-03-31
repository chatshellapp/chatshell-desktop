/**
 * Model logo mapping utility - simplified version
 * Maps model IDs/names to their corresponding logo images using regex patterns
 */

import type { Model } from '@/types'

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
import mistralAvatar from '@/assets/avatars/models/mistral.png'
import kimiAvatar from '@/assets/avatars/models/kimi.png'
import wenxinAvatar from '@/assets/avatars/models/wenxin.png'
import hunyuanAvatar from '@/assets/avatars/models/hunyuan.png'
import sparkAvatar from '@/assets/avatars/models/spark.png'
import yiAvatar from '@/assets/avatars/models/yi.png'
import cohereAvatar from '@/assets/avatars/models/cohere.png'
import stepfunAvatar from '@/assets/avatars/models/stepfun.png'
import stabilityAvatar from '@/assets/avatars/models/stability.png'
import microsoftAvatar from '@/assets/avatars/models/microsoft.png'
import baichuanAvatar from '@/assets/avatars/models/baichuan.png'
import copilotAvatar from '@/assets/avatars/models/copilot.png'
import perplexityAvatar from '@/assets/avatars/models/perplexity.png'
import groqAvatar from '@/assets/avatars/models/groq.png'
import mimoAvatar from '@/assets/avatars/models/mimo.png'
import jambaAvatar from '@/assets/avatars/models/jamba.png'
import nvidiaAvatar from '@/assets/avatars/models/nvidia.png'
import internlmAvatar from '@/assets/avatars/models/internlm.png'
import fluxAvatar from '@/assets/avatars/models/flux.png'
import dbrxAvatar from '@/assets/avatars/models/dbrx.png'
import hailuoAvatar from '@/assets/avatars/models/hailuo.png'
import midjourneyAvatar from '@/assets/avatars/models/midjourney.png'
import codegeexAvatar from '@/assets/avatars/models/codegeex.png'
import rwkvAvatar from '@/assets/avatars/models/rwkv.png'
import dolphinAvatar from '@/assets/avatars/models/dolphin.png'
import upstageAvatar from '@/assets/avatars/models/upstage.png'
import voyageAvatar from '@/assets/avatars/models/voyage.png'
import { logger } from '@/lib/logger'

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

    deepseek: deepseekAvatar,
    '(mixtral|mistral|codestral|ministral|magistral)': mistralAvatar,
    '(moonshot|kimi)': kimiAvatar,
    '(glm|chatglm|cogview|zhipu)': glmAvatar,
    '(doubao|seedream|ep-202)': doubaoAvatar,
    '(ernie|wenxin|tao-)': wenxinAvatar,
    hunyuan: hunyuanAvatar,
    '(sparkdesk|generalv|spark)': sparkAvatar,
    'yi-': yiAvatar,
    '(cohere|command-r)': cohereAvatar,
    'step-': stepfunAvatar,
    '(minimax|abab)': minimaxAvatar,
    '(stable-|sdxl|sd3|sd2)': stabilityAvatar,
    grok: grokAvatar,
    '(phi-|wizardlm|microsoft)': microsoftAvatar,
    baichuan: baichuanAvatar,
    '(copilot|creative|balanced|precise)': copilotAvatar,
    '(sonar|perplexity)': perplexityAvatar,
    'groq/': groqAvatar,
    mimo: mimoAvatar,
    jamba: jambaAvatar,
    nemotron: nvidiaAvatar,
    '(internlm|internvl)': internlmAvatar,
    flux: fluxAvatar,
    dbrx: dbrxAvatar,
    hailuo: hailuoAvatar,
    '(midjourney|mj-)': midjourneyAvatar,
    codegeex: codegeexAvatar,
    rwkv: rwkvAvatar,
    dolphin: dolphinAvatar,
    '(solar|upstage)': upstageAvatar,
    'voyage-': voyageAvatar,
  }

  // Try to match against each pattern
  for (const [pattern, logo] of Object.entries(logoMap)) {
    try {
      const regex = new RegExp(pattern, 'i') // Case-insensitive
      if (regex.test(modelId)) {
        return logo
      }
    } catch (error) {
      logger.warn(`Invalid regex pattern: ${pattern}`, error)
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
