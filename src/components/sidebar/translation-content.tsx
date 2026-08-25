import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRightLeft,
  Check,
  ChevronsUpDown,
  Copy,
  Loader2,
  MessageSquareShare,
  X,
} from 'lucide-react'
import type { Model } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModelAvatar } from '@/components/model-avatar'
import { cn } from '@/lib/utils'
import {
  useTranslationStore,
  LANGUAGES,
  initializeTranslationModel,
  type Language,
} from '@/stores/translationStore'
import { useModelStore } from '@/stores/modelStore'

export function TranslationContent() {
  const { t } = useTranslation('sidebar')

  const {
    sourceLanguage,
    targetLanguage,
    inputText,
    outputText,
    isTranslating,
    error,
    selectedModel,
    canContinue,
  } = useTranslationStore()

  const setSourceLanguage = useTranslationStore((s) => s.setSourceLanguage)
  const setTargetLanguage = useTranslationStore((s) => s.setTargetLanguage)
  const setInputText = useTranslationStore((s) => s.setInputText)
  const setSelectedModel = useTranslationStore((s) => s.setSelectedModel)
  const translate = useTranslationStore((s) => s.translate)
  const stopTranslation = useTranslationStore((s) => s.stopTranslation)
  const swapLanguages = useTranslationStore((s) => s.swapLanguages)
  const continueInConversation = useTranslationStore((s) => s.continueInConversation)
  const clear = useTranslationStore((s) => s.clear)

  const models = useModelStore((s) => s.models.filter((m) => !m.is_deleted))
  const getProviderById = useModelStore((s) => s.getProviderById)

  const vendors = useMemo(() => {
    const vendorMap = new Map<string, { id: string; name: string; models: Model[] }>()
    models.forEach((model) => {
      const provider = getProviderById(model.provider_id)
      if (!provider) return
      const key = provider.id
      if (!vendorMap.has(key)) {
        vendorMap.set(key, { id: provider.id, name: provider.name, models: [] })
      }
      vendorMap.get(key)!.models.push(model)
    })
    const starred = models.filter((m) => m.is_starred)
    const result = Array.from(vendorMap.values())
    if (starred.length > 0) {
      result.unshift({ id: '__starred__', name: t('starred'), models: starred })
    }
    return result
  }, [models, getProviderById, t])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const outputRef = useRef<HTMLTextAreaElement>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      initializeTranslationModel()
    }
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.keyCode === 229 || e.nativeEvent.isComposing) {
        return
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const textarea = e.currentTarget
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const newValue = inputText.substring(0, start) + '\n' + inputText.substring(end)
        setInputText(newValue)
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1
        })
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!isTranslating && inputText.trim()) {
          translate()
        }
      }
    },
    [inputText, isTranslating, setInputText, translate]
  )

  const handleTranslate = useCallback(() => {
    if (isTranslating) {
      stopTranslation()
    } else if (inputText.trim()) {
      translate()
    }
  }, [isTranslating, inputText, stopTranslation, translate])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [outputText])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="shrink-0 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1">
          <LanguageSelect value={sourceLanguage} onChange={setSourceLanguage} includeAuto />
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={swapLanguages}
            disabled={sourceLanguage === 'auto'}
            title={t('swapLanguages')}
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
          </Button>
          <LanguageSelect value={targetLanguage} onChange={setTargetLanguage} />
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        <ModelSelect
          vendors={vendors}
          selectedModel={selectedModel}
          onSelect={setSelectedModel}
          placeholder={t('selectModel')}
        />
        <Button
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          onClick={handleTranslate}
          disabled={!isTranslating && (!inputText.trim() || !selectedModel)}
        >
          {isTranslating ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('translating')}
            </>
          ) : (
            t('translate')
          )}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="relative flex-1 min-h-0 rounded-md border border-input bg-background">
          <textarea
            ref={inputRef}
            className="absolute inset-0 resize-none rounded-md bg-background p-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('translationInputPlaceholder')}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isTranslating}
          />
          {inputText && !isTranslating && (
            <button
              className="absolute right-2 top-2 z-10 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              onClick={clear}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="relative flex-1 min-h-0 rounded-md border border-input bg-muted/50">
          <textarea
            ref={outputRef}
            className="absolute inset-0 resize-none rounded-md bg-transparent p-3 pb-8 text-sm focus:outline-none"
            placeholder={t('translationOutputPlaceholder')}
            value={outputText}
            readOnly
          />
          {outputText && (
            <div className="absolute bottom-1.5 right-2 z-10 flex items-center gap-1">
              {canContinue && !isTranslating && (
                <button
                  className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                  onClick={continueInConversation}
                  title={t('continueInConversation')}
                >
                  <MessageSquareShare className="h-3.5 w-3.5" />
                </button>
              )}
              <CopyButton text={outputText} />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 break-all rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="shrink-0 text-[11px] text-muted-foreground">
        <kbd className="rounded border px-1 font-mono text-[10px]">↵</kbd> {t('toTranslate')}{' '}
        <kbd className="rounded border px-1 font-mono text-[10px]">⌘↵</kbd> {t('toNewline')}
      </div>
    </div>
  )
}

function LanguageSelect({
  value,
  onChange,
  includeAuto = false,
}: {
  value: string
  onChange: (code: string) => void
  includeAuto?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation('sidebar')
  const languages = includeAuto ? LANGUAGES : LANGUAGES.filter((l) => l.code !== 'auto')
  const selected = languages.find((l) => l.code === value)
  const getDisplayName = (lang: Language) => (lang.code === 'auto' ? t('autoDetect') : lang.name)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          className="flex h-7 w-full items-center justify-between gap-1 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <span className="truncate">
            {selected ? getDisplayName(selected) : t('selectLanguage')}
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={t('searchLanguage')} />
          <CommandList>
            <CommandEmpty>{t('noLanguageFound')}</CommandEmpty>
            <CommandGroup>
              {languages.map((lang) => (
                <CommandItem
                  key={lang.code}
                  value={lang.name}
                  keywords={[lang.code, getDisplayName(lang)]}
                  onSelect={() => {
                    onChange(lang.code)
                    setOpen(false)
                  }}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      'mr-1 h-3 w-3',
                      value === lang.code ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {getDisplayName(lang)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ModelSelect({
  vendors,
  selectedModel,
  onSelect,
  placeholder,
}: {
  vendors: { id: string; name: string; models: Model[] }[]
  selectedModel: Model | null
  onSelect: (model: Model | null) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation('sidebar')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          className="flex h-7 flex-1 items-center justify-between gap-1 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {selectedModel ? (
            <span className="flex items-center gap-1.5 truncate">
              <ModelAvatar modelId={selectedModel.model_id} name={selectedModel.name} size="xs" />
              <span className="truncate">{selectedModel.name}</span>
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={t('searchModel')} />
          <CommandList>
            <CommandEmpty>{t('noModelFound')}</CommandEmpty>
            {vendors.map((vendor) => (
              <CommandGroup key={vendor.id} heading={vendor.name}>
                {vendor.models.map((model) => (
                  <CommandItem
                    key={model.id}
                    value={model.name}
                    keywords={[model.model_id]}
                    onSelect={() => {
                      onSelect(model)
                      setOpen(false)
                    }}
                    className="text-xs"
                  >
                    <ModelAvatar modelId={model.model_id} name={model.name} size="xs" />
                    <span className="truncate">{model.name}</span>
                    <Check
                      className={cn(
                        'ml-auto h-3 w-3',
                        selectedModel?.id === model.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [text])

  return (
    <button
      className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
      onClick={handleCopy}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}
