'use client'

import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { LLMProvider } from './types'
import { isCustomProvider } from './types'

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
}: ProviderFormProps) {
  const isCustom = isCustomProvider(selectedProvider)

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
              <RadioGroup
                value={apiStyle}
                onValueChange={onApiStyleChange}
                className="flex gap-4"
              >
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
        <div className="relative">
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
        <p className="text-xs text-muted-foreground">Your API key will be stored securely</p>
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
