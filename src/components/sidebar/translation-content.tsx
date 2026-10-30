import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  ArrowRightLeft,
  Languages,
  FileUp,
  Check,
  ChevronsUpDown,
  Copy,
  Loader2,
  MessageSquareShare,
  Square,
  X,
} from 'lucide-react'
import type { Model } from '@/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MarkdownContent } from '@/components/markdown-content'
import { toast } from 'sonner'
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isImporting, setIsImporting] = useState(false)
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
        if (!isTranslating && !isImporting && inputText.trim()) {
          translate()
        }
      }
    },
    [inputText, isTranslating, isImporting, setInputText, translate]
  )

  const handleTranslate = useCallback(() => {
    if (isTranslating) {
      stopTranslation()
    } else if (inputText.trim()) {
      translate()
    }
  }, [isTranslating, inputText, stopTranslation, translate])

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || isTranslating) return
    setIsImporting(true)
    try {
      const text = await file.text()
      setInputText(text)
    } catch {
      toast.error(t('markdownImportError'))
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <section aria-label={t('translation')} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between gap-6 border-b px-4 sm:px-6">
        <div className="hidden items-center gap-2.5 md:flex">
          <Languages className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold tracking-tight">{t('translation')}</h1>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:flex-initial">
          <div className="flex min-w-0 flex-1 items-center md:w-72 md:flex-initial">
            <ModelSelect
              vendors={vendors}
              selectedModel={selectedModel}
              onSelect={setSelectedModel}
              placeholder={t('selectModel')}
              disabled={isTranslating}
            />
          </div>
          <Button
            onClick={handleTranslate}
            disabled={isImporting || (!isTranslating && (!inputText.trim() || !selectedModel))}
          >
            {isTranslating ? (
              <Square data-icon="inline-start" />
            ) : (
              <ArrowRight data-icon="inline-start" />
            )}
            {isTranslating ? t('stopTranslation') : t('translate')}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1">
        <TranslationTextPane
          label={t('sourceLanguage')}
          className="border-b sm:border-r sm:border-b-0"
          toolbar={
            <>
              <LanguageSelect
                value={sourceLanguage}
                onChange={setSourceLanguage}
                includeAuto
                disabled={isTranslating}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={swapLanguages}
                disabled={sourceLanguage === 'auto' || isTranslating}
                title={t('swapLanguages')}
                aria-label={t('swapLanguages')}
              >
                <ArrowRightLeft />
              </Button>
            </>
          }
          footer={
            <>
              <div className="flex min-w-0 items-center gap-3 truncate text-xs text-muted-foreground">
                <span>{t('characterCount', { count: Array.from(inputText).length })}</span>
                <span className="hidden xl:inline">
                  <kbd className="rounded border px-1 font-mono">↵</kbd> {t('toTranslate')}
                  {' · '}
                  <kbd className="rounded border px-1 font-mono">⌘ / Ctrl + ↵</kbd> {t('toNewline')}
                </span>
              </div>
              <div className="-mr-2 flex shrink-0 items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,text/markdown"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label={t('importMarkdown')}
                  disabled={isTranslating || isImporting}
                  onChange={handleFileImport}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isTranslating || isImporting}
                  onClick={() => fileInputRef.current?.click()}
                  title={t('importMarkdown')}
                  aria-label={t('importMarkdown')}
                >
                  <FileUp data-icon="inline-start" />
                  <span className="hidden lg:inline">{t('importMarkdown')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clear}
                  disabled={isTranslating || (!inputText && !outputText)}
                >
                  <X data-icon="inline-start" />
                  {t('common:clear')}
                </Button>
              </div>
            </>
          }
        >
          <TranslationTextBody
            text={inputText}
            placeholder={t('translationInputPlaceholder')}
            textareaRef={inputRef}
            onChange={setInputText}
            onKeyDown={handleKeyDown}
            disabled={isTranslating || isImporting}
          />
        </TranslationTextPane>

        <TranslationTextPane
          label={t('targetLanguage')}
          busy={isTranslating}
          className="bg-muted/20"
          toolbar={
            <>
              <LanguageSelect
                value={targetLanguage}
                onChange={setTargetLanguage}
                disabled={isTranslating}
              />
              {isTranslating && (
                <Loader2
                  className="size-4 shrink-0 animate-spin text-muted-foreground"
                  aria-label={t('translating')}
                />
              )}
            </>
          }
          footer={
            <>
              <div className="-mr-2 ml-auto flex shrink-0 items-center gap-1">
                {canContinue && !isTranslating && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={continueInConversation}
                    title={t('continueInConversation')}
                  >
                    <MessageSquareShare data-icon="inline-start" />
                    <span className="hidden lg:inline">{t('continueInConversation')}</span>
                    <span className="sr-only lg:hidden">{t('continueInConversation')}</span>
                  </Button>
                )}
                <CopyButton text={outputText} />
              </div>
            </>
          }
          notice={
            error && (
              <p
                role="alert"
                className="max-h-24 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm [overflow-wrap:anywhere] text-destructive"
              >
                {error}
              </p>
            )
          }
        >
          <TranslationTextBody
            text={outputText}
            placeholder={t('translationOutputPlaceholder')}
            readOnly
          />
        </TranslationTextPane>
      </div>
    </section>
  )
}

function TranslationTextPane({
  label,
  toolbar,
  footer,
  notice,
  busy,
  className,
  children,
}: {
  label: string
  toolbar: React.ReactNode
  footer: React.ReactNode
  notice?: React.ReactNode
  busy?: boolean
  className?: string
  children: React.ReactNode
}) {
  const { t } = useTranslation('sidebar')
  const [view, setView] = useState('raw')

  return (
    <Tabs
      value={view}
      onValueChange={setView}
      aria-label={label}
      aria-busy={busy}
      role="region"
      className={cn('min-h-0 min-w-0 gap-0', className)}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-1">{toolbar}</div>
        <TabsList aria-label={t('markdownView', { pane: label })} className="h-8">
          <TabsTrigger value="raw" className="text-xs">
            {t('markdownRaw')}
          </TabsTrigger>
          <TabsTrigger value="preview" className="text-xs">
            {t('markdownPreview')}
          </TabsTrigger>
        </TabsList>
      </div>
      {children}
      {notice && <div className="shrink-0 px-4 pb-2 sm:px-6">{notice}</div>}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-t px-4 sm:px-6">
        {footer}
      </div>
    </Tabs>
  )
}

function TranslationTextBody({
  text,
  placeholder,
  textareaRef,
  onChange,
  onKeyDown,
  disabled,
  readOnly = false,
}: {
  text: string
  placeholder: string
  textareaRef?: React.Ref<HTMLTextAreaElement>
  onChange?: (text: string) => void
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
  disabled?: boolean
  readOnly?: boolean
}) {
  const rawRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // Follow streamed output in whichever view is mounted.
  useEffect(() => {
    if (!readOnly) return
    for (const element of [previewRef.current, rawRef.current]) {
      if (element) element.scrollTop = element.scrollHeight
    }
  }, [text, readOnly])

  return (
    <>
      <TabsContent value="raw" className="relative min-h-0">
        <Textarea
          ref={textareaRef ?? rawRef}
          aria-label={placeholder}
          className="absolute inset-0 h-full min-h-0 resize-none rounded-none border-0 bg-transparent px-4 py-4 leading-6 shadow-none focus-visible:ring-inset disabled:cursor-default disabled:opacity-70 dark:bg-transparent sm:px-6"
          placeholder={placeholder}
          value={text}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          readOnly={readOnly}
          dir="auto"
        />
      </TabsContent>
      <TabsContent
        value="preview"
        ref={previewRef}
        className="min-h-0 overflow-auto px-4 py-4 sm:px-6"
        dir="auto"
      >
        {text ? (
          <MarkdownContent content={text} className="text-sm leading-7 [overflow-wrap:anywhere]" />
        ) : (
          <p className="text-sm text-muted-foreground">{placeholder}</p>
        )}
      </TabsContent>
    </>
  )
}

function LanguageSelect({
  value,
  onChange,
  includeAuto = false,
  disabled = false,
}: {
  value: string
  onChange: (code: string) => void
  includeAuto?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation('sidebar')
  const languages = includeAuto ? LANGUAGES : LANGUAGES.filter((l) => l.code !== 'auto')
  const selected = languages.find((l) => l.code === value)
  const getDisplayName = (lang: Language) => (lang.code === 'auto' ? t('autoDetect') : lang.name)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-label={t(includeAuto ? 'sourceLanguage' : 'targetLanguage')}
          aria-expanded={open}
          disabled={disabled}
          className="-ml-2 h-8 max-w-48 justify-between gap-2 px-2 font-medium"
        >
          <span className="truncate">
            {selected ? getDisplayName(selected) : t('selectLanguage')}
          </span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
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
  disabled = false,
}: {
  vendors: { id: string; name: string; models: Model[] }[]
  selectedModel: Model | null
  onSelect: (model: Model | null) => void
  placeholder: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation('sidebar')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-label={placeholder}
          aria-expanded={open}
          disabled={disabled}
          className="min-w-0 flex-1 justify-between"
        >
          {selectedModel ? (
            <span className="flex items-center gap-1.5 truncate">
              <ModelAvatar modelId={selectedModel.model_id} name={selectedModel.name} size="xs" />
              <span className="truncate">{selectedModel.name}</span>
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
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
  const { t } = useTranslation('common')

  useEffect(() => {
    setCopied(false)
  }, [text])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      toast.error(t('error'))
    }
  }, [text, t])

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} disabled={!text}>
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? t('copied') : t('copy')}
    </Button>
  )
}
