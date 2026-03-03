'use client'

import * as React from 'react'
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
      setCheckError('No model available for testing. Add a model first.')
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
            <Label htmlFor="provider-name">Provider Name</Label>
            <Input
              id="provider-name"
              type="text"
              placeholder="e.g. My Local LLM"
              value={providerName}
              onChange={(e) => onProviderNameChange(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>API Compatibility</Label>
            <RadioGroup
              value={compatibilityType}
              onValueChange={onCompatibilityTypeChange}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="openai" id="compat-openai" />
                <Label htmlFor="compat-openai" className="font-normal cursor-pointer">
                  OpenAI Compatible
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="anthropic" id="compat-anthropic" />
                <Label htmlFor="compat-anthropic" className="font-normal cursor-pointer">
                  Anthropic Compatible
                </Label>
              </div>
            </RadioGroup>
          </div>

          {compatibilityType === 'openai' && (
            <div className="space-y-2">
              <Label>API Style</Label>
              <RadioGroup value={apiStyle} onValueChange={onApiStyleChange} className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="chat_completions" id="api-style-cc" />
                  <Label htmlFor="api-style-cc" className="font-normal cursor-pointer">
                    Chat Completions API
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="responses" id="api-style-resp" />
                  <Label htmlFor="api-style-resp" className="font-normal cursor-pointer">
                    Responses API
                  </Label>
                </div>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">
                Most providers use Chat Completions API. Responses API is an OpenAI-specific format.
              </p>
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="api-key">API Key</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="api-key"
              type={showApiKey ? 'text' : 'password'}
              placeholder="Enter your API key"
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
            variant={checkStatus === 'success' ? 'default' : checkStatus === 'failed' ? 'destructive' : 'outline'}
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
                {checkLatency != null && (
                  <span className="ml-1 text-xs">{checkLatency}ms</span>
                )}
              </>
            ) : checkStatus === 'failed' ? (
              <>
                <AlertTriangle className="size-4" />
                <span className="ml-1">Failed</span>
              </>
            ) : (
              'Check'
            )}
          </Button>
        </div>
        {checkStatus === 'failed' && checkError && (
          <p className="text-xs text-destructive">{checkError}</p>
        )}
        {checkStatus === 'success' && (
          <p className="text-xs text-green-600 dark:text-green-400">Connection successful</p>
        )}
        {checkStatus !== 'failed' && checkStatus !== 'success' && (
          <p className="text-xs text-muted-foreground">Your API key will be stored securely</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="api-base-url">
          API Base URL{isCustom && <span className="text-destructive ml-0.5">*</span>}
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
            'Required: The API endpoint for this provider'
          ) : (
            <>
              Optional: Override the default API endpoint
              {apiBaseUrl !== selectedProvider.baseUrl && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => onApiBaseUrlChange(selectedProvider.baseUrl)}
                  >
                    Restore default
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
