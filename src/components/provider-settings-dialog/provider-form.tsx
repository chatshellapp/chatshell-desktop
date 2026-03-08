'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { Eye, EyeOff, Loader2, Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { LLMProvider, ModelItem } from './types'
import { isCustomProvider } from './types'
import { DEFAULT_PROVIDER_MODELS } from './constants'

type CheckStatus = 'idle' | 'checking' | 'success' | 'failed'

interface CheckApiResult {
  success: boolean
  latency_ms: number
  error: string | null
}

function getTestModelId(
  selectedProvider: LLMProvider,
  compatibilityType: string,
  models: ModelItem[]
): string | null {
  if (models.length > 0) {
    return models[models.length - 1].modelId
  }

  const providerType = isCustomProvider(selectedProvider)
    ? compatibilityType === 'anthropic'
      ? 'custom_anthropic'
      : 'custom_openai'
    : selectedProvider.id

  const defaults = DEFAULT_PROVIDER_MODELS[providerType]
  if (defaults && defaults.length > 0) {
    return defaults[defaults.length - 1].modelId
  }

  return null
}

interface ProviderFormProps {
  apiKey: string
  onApiKeyChange: (key: string) => void
  showApiKey: boolean
  onShowApiKeyChange: (show: boolean) => void
  apiBaseUrl: string
  onApiBaseUrlChange: (url: string) => void
  selectedProvider: LLMProvider
  providerName: string
  onProviderNameChange: (name: string) => void
  apiStyle: string
  onApiStyleChange: (style: string) => void
  compatibilityType: string
  onCompatibilityTypeChange: (type: string) => void
  models: ModelItem[]
}

export function ProviderForm({
  apiKey,
  onApiKeyChange,
  showApiKey,
  onShowApiKeyChange,
  apiBaseUrl,
  onApiBaseUrlChange,
  selectedProvider,
  providerName,
  onProviderNameChange,
  apiStyle,
  onApiStyleChange,
  compatibilityType,
  onCompatibilityTypeChange,
  models,
}: ProviderFormProps) {
  const { t } = useTranslation('providers')
  const isCustom = isCustomProvider(selectedProvider)

  const [checkStatus, setCheckStatus] = React.useState<CheckStatus>('idle')
  const [checkError, setCheckError] = React.useState<string | null>(null)
  const [checkLatency, setCheckLatency] = React.useState<number | null>(null)
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    setCheckStatus('idle')
    setCheckError(null)
    setCheckLatency(null)
  }, [selectedProvider.id])

  React.useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  const handleCheckApi = React.useCallback(async () => {
    const providerType = isCustom
      ? compatibilityType === 'anthropic'
        ? 'custom_anthropic'
        : 'custom_openai'
      : selectedProvider.id

    const testModelId = getTestModelId(selectedProvider, compatibilityType, models)
    if (!testModelId) {
      setCheckStatus('failed')
      setCheckError(t('noModelForTesting'))
      return
    }

    setCheckStatus('checking')
    setCheckError(null)
    setCheckLatency(null)

    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)

    try {
      const result = await invoke<CheckApiResult>('check_provider_api', {
        providerType,
        modelId: testModelId,
        apiKey: apiKey || null,
        baseUrl: apiBaseUrl || null,
        apiStyle: isCustom && compatibilityType === 'openai' ? apiStyle : null,
      })

      if (result.success) {
        setCheckStatus('success')
        setCheckLatency(result.latency_ms)
        resetTimerRef.current = setTimeout(() => {
          setCheckStatus('idle')
          setCheckLatency(null)
        }, 5000)
      } else {
        setCheckStatus('failed')
        setCheckError(result.error || 'Connection failed')
      }
    } catch (e) {
      setCheckStatus('failed')
      setCheckError(e instanceof Error ? e.message : String(e))
    }
  }, [selectedProvider, isCustom, compatibilityType, apiKey, apiBaseUrl, apiStyle, models])

  return (
    <div className="space-y-4">
      {isCustom && (
        <>
          <div className="space-y-2">
            <Label htmlFor="provider-name">{t('providerName')}</Label>
            <Input
              id="provider-name"
              type="text"
              placeholder={t('customProviderPlaceholder')}
              value={providerName}
              onChange={(e) => onProviderNameChange(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('apiCompatibility')}</Label>
            <RadioGroup
              value={compatibilityType}
              onValueChange={onCompatibilityTypeChange}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="openai" id="compat-openai" />
                <Label htmlFor="compat-openai" className="font-normal cursor-pointer">
                  {t('openaiCompatible')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="anthropic" id="compat-anthropic" />
                <Label htmlFor="compat-anthropic" className="font-normal cursor-pointer">
                  {t('anthropicCompatible')}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {compatibilityType === 'openai' && (
            <div className="space-y-2">
              <Label>{t('apiStyle')}</Label>
              <RadioGroup value={apiStyle} onValueChange={onApiStyleChange} className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="chat_completions" id="api-style-cc" />
                  <Label htmlFor="api-style-cc" className="font-normal cursor-pointer">
                    {t('chatCompletionsApi')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="responses" id="api-style-resp" />
                  <Label htmlFor="api-style-resp" className="font-normal cursor-pointer">
                    {t('responsesApi')}
                  </Label>
                </div>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">{t('apiStyleDescription')}</p>
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="api-key">{t('apiKey')}</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="api-key"
              type={showApiKey ? 'text' : 'password'}
              placeholder={t('apiKeyPlaceholder')}
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              className="pr-10"
              disabled={selectedProvider.id === 'ollama'}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
              onClick={() => onShowApiKeyChange(!showApiKey)}
            >
              {showApiKey ? (
                <EyeOff className="size-4 text-muted-foreground" />
              ) : (
                <Eye className="size-4 text-muted-foreground" />
              )}
            </Button>
          </div>
          <Button
            type="button"
            variant={
              checkStatus === 'success'
                ? 'default'
                : checkStatus === 'failed'
                  ? 'destructive'
                  : 'outline'
            }
            size="sm"
            className="h-9 shrink-0"
            onClick={handleCheckApi}
            disabled={checkStatus === 'checking' || (!apiKey && selectedProvider.id !== 'ollama')}
          >
            {checkStatus === 'checking' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : checkStatus === 'success' ? (
              <>
                <Check className="size-4" />
                {checkLatency != null && <span className="ml-1 text-xs">{checkLatency}ms</span>}
              </>
            ) : checkStatus === 'failed' ? (
              <>
                <AlertTriangle className="size-4" />
                <span className="ml-1">{t('failed')}</span>
              </>
            ) : (
              t('testConnection')
            )}
          </Button>
        </div>
        {checkStatus === 'failed' && checkError && (
          <div className="text-xs text-destructive space-y-1">
            <p className="font-medium">{t('connectionFailed')}</p>
            <div className="px-2 py-1.5 bg-destructive/5 rounded max-h-24 overflow-y-auto">
              <p className="font-mono text-destructive/80 whitespace-pre-wrap break-all">
                {checkError}
              </p>
            </div>
          </div>
        )}
        {checkStatus === 'success' && (
          <p className="text-xs text-green-600 dark:text-green-400">{t('connectionSuccessful')}</p>
        )}
        {checkStatus !== 'failed' && checkStatus !== 'success' && (
          <p className="text-xs text-muted-foreground">{t('yourApiKeyWillBeStored')}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="api-base-url">
          {t('apiBaseUrl')}
          {isCustom && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        <Input
          id="api-base-url"
          type="url"
          placeholder="https://api.example.com/v1"
          value={apiBaseUrl}
          onChange={(e) => onApiBaseUrlChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {isCustom ? (
            t('apiBaseUrlRequired')
          ) : (
            <>
              {t('apiBaseUrlOptional')}
              {apiBaseUrl !== selectedProvider.baseUrl && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => onApiBaseUrlChange(selectedProvider.baseUrl)}
                  >
                    {t('restoreDefault')}
                  </button>
                </>
              )}
            </>
          )}
        </p>
      </div>
    </div>
  )
}
