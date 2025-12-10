'use client'

import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { LLMProvider } from './types'

interface ProviderFormProps {
  apiKey: string
  onApiKeyChange: (key: string) => void
  showApiKey: boolean
  onShowApiKeyChange: (show: boolean) => void
  apiBaseUrl: string
  onApiBaseUrlChange: (url: string) => void
  selectedProvider: LLMProvider
}

export function ProviderForm({
  apiKey,
  onApiKeyChange,
  showApiKey,
  onShowApiKeyChange,
  apiBaseUrl,
  onApiBaseUrlChange,
  selectedProvider,
}: ProviderFormProps) {
  return (
    <div className="space-y-4">
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
        <Label htmlFor="api-base-url">API Base URL</Label>
        <Input
          id="api-base-url"
          type="url"
          placeholder="https://api.example.com/v1"
          value={apiBaseUrl}
          onChange={(e) => onApiBaseUrlChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
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
        </p>
      </div>
    </div>
  )
}
