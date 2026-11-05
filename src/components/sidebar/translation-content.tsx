import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Copy,
  FileUp,
  Languages,
  Loader2,
  MessageSquareShare,
  RefreshCw,
  Settings2,
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
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModelAvatar } from '@/components/model-avatar'
import { TranslationHistoryPopover } from './translation-history-popover'
import { cn } from '@/lib/utils'
import {
  useTranslationStore,
  initializeTranslationLanguages,
  initializeTranslationModel,
  getDetectedLanguage,
  resolveMainSlot,
  type TargetSlot,
} from '@/stores/translationStore'
import { useModelStore } from '@/stores/modelStore'
import {
  AUTO_LANGUAGE,
  TRANSLATION_LANGUAGES,
  getDisplayName,
  getEnglishName,
  getNativeName,
  getShortCode,
} from '@/lib/translationLanguages'

/** Character count above which the input is flagged as long. */
export const LONG_INPUT_CHARS = 20000

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

const SHORTCUTS = {
  main: { aria: 'Enter', label: 'Enter', hint: '↵' },
  alternate: {
    aria: 'Alt+Enter',
    label: IS_MAC ? 'Option+Enter' : 'Alt+Enter',
    hint: IS_MAC ? '⌥↵' : 'Alt+↵',
  },
} as const

type Shortcut = (typeof SHORTCUTS)[keyof typeof SHORTCUTS]

/** Delay before detecting the input language while the user types. */
export const DETECTION_DEBOUNCE_MS = 300

function useUiLocale(): string {
  const { i18n } = useTranslation('sidebar')
  return i18n?.language || 'en'
}

export function TranslationContent() {
  const { t } = useTranslation('sidebar')
  const uiLocale = useUiLocale()

  const translationState = useTranslationStore()
  const {
    sourceLanguage,
    secondaryLanguage,
    inputText,
    outputText,
    isTranslating,
    lastAttempt,
    error,
    selectedModel,
    canContinue,
  } = translationState

  const setSourceLanguage = useTranslationStore((s) => s.setSourceLanguage)
  const setInputText = useTranslationStore((s) => s.setInputText)
  const setSelectedModel = useTranslationStore((s) => s.setSelectedModel)
  const translateToSlot = useTranslationStore((s) => s.translateToSlot)
  const retranslate = useTranslationStore((s) => s.retranslate)
  const stopTranslation = useTranslationStore((s) => s.stopTranslation)
  const moveOutputToInput = useTranslationStore((s) => s.moveOutputToInput)
  const continueInConversation = useTranslationStore((s) => s.continueInConversation)
  const clear = useTranslationStore((s) => s.clear)
  const detectInputLanguage = useTranslationStore((s) => s.detectInputLanguage)

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
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      initializeTranslationModel()
      initializeTranslationLanguages()
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => detectInputLanguage(), DETECTION_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [inputText, detectInputLanguage])

  const detectedLanguage = getDetectedLanguage(translationState)
  const detectedLabel = detectedLanguage
    ? t('detectedLanguage', { language: getDisplayName(detectedLanguage, uiLocale) })
    : null
  const mainSlot = resolveMainSlot(translationState)
  const alternateSlot: TargetSlot | null =
    mainSlot === 'primary' ? (secondaryLanguage ? 'secondary' : null) : 'primary'
  const canTranslate = !!inputText.trim() && !!selectedModel && !isImporting && !isTranslating

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.keyCode === 229 || e.nativeEvent.isComposing) {
        return
      }
      if (e.key !== 'Enter') return

      if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        const textarea = e.currentTarget
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const newValue = inputText.substring(0, start) + '\n' + inputText.substring(end)
        setInputText(newValue)
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1
        })
      } else if (!e.shiftKey) {
        e.preventDefault()
        const slot = e.altKey ? alternateSlot : mainSlot
        if (canTranslate && slot) translateToSlot(slot)
      }
    },
    [inputText, setInputText, alternateSlot, mainSlot, canTranslate, translateToSlot]
  )

  // Page-level shortcuts: the input is disabled while translating, so Esc
  // cannot rely on the textarea having focus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTranslating) {
        e.preventDefault()
        stopTranslation()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c' && outputText) {
        e.preventDefault()
        navigator.clipboard
          .writeText(outputText)
          .then(() => toast.success(t('common:copied')))
          .catch(() => toast.error(t('common:error')))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isTranslating, outputText, stopTranslation, t])

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

  const characterCount = Array.from(inputText).length
  const isLongInput = characterCount > LONG_INPUT_CHARS
  const directionLabel = lastAttempt
    ? t('translationDirection', {
        source:
          lastAttempt.sourceLanguage === AUTO_LANGUAGE
            ? t('autoDetect')
            : getDisplayName(lastAttempt.sourceLanguage, uiLocale),
        target: getDisplayName(lastAttempt.targetLanguage, uiLocale),
      })
    : null

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
              open={modelPickerOpen}
              onOpenChange={setModelPickerOpen}
            />
          </div>
          <TranslationHistoryPopover uiLocale={uiLocale} disabled={isTranslating} />
          <LanguageSettingsPopover
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            uiLocale={uiLocale}
            disabled={isTranslating}
          />
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
                autoLabel={detectedLabel ?? t('autoDetect')}
                disabled={isTranslating}
                ariaLabel={t('sourceLanguage')}
                uiLocale={uiLocale}
              />
              <span className="sr-only" aria-live="polite">
                {sourceLanguage === AUTO_LANGUAGE ? (detectedLabel ?? '') : ''}
              </span>
            </>
          }
          footer={
            <>
              <div
                className={cn(
                  'flex min-w-0 items-center gap-2 truncate text-xs text-muted-foreground',
                  isLongInput && 'text-amber-600 dark:text-amber-500'
                )}
              >
                <span>{t('characterCount', { count: characterCount })}</span>
                {isLongInput && (
                  <span className="hidden truncate lg:inline">{t('longInputHint')}</span>
                )}
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
              <span className="truncate px-1 text-sm font-medium">
                {directionLabel ?? t('targetLanguage')}
              </span>
              {isTranslating ? (
                <Loader2
                  className="size-4 shrink-0 animate-spin text-muted-foreground"
                  aria-label={t('translating')}
                />
              ) : (
                lastAttempt && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={retranslate}
                    disabled={!canTranslate}
                    title={t('retranslate')}
                    aria-label={t('retranslate')}
                  >
                    <RefreshCw />
                  </Button>
                )
              )}
            </>
          }
          footer={
            <div className="-mr-2 ml-auto flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={moveOutputToInput}
                disabled={!outputText || isTranslating}
                title={t('useAsInput')}
                aria-label={t('useAsInput')}
              >
                <ArrowUp data-icon="inline-start" />
                <span className="hidden lg:inline">{t('useAsInput')}</span>
              </Button>
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
          }
          notice={
            error && (
              <div className="flex items-start gap-2">
                <p
                  role="alert"
                  className="max-h-24 min-w-0 flex-1 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm [overflow-wrap:anywhere] text-destructive"
                >
                  {error}
                </p>
                {lastAttempt && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={retranslate}
                    disabled={!canTranslate}
                  >
                    <RefreshCw data-icon="inline-start" />
                    {t('common:retry')}
                  </Button>
                )}
              </div>
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

      <TranslationActionBar
        uiLocale={uiLocale}
        mainSlot={mainSlot}
        alternateSlot={alternateSlot}
        canTranslate={canTranslate}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenModelPicker={() => setModelPickerOpen(true)}
      />
    </section>
  )
}

function TranslationActionBar({
  uiLocale,
  mainSlot,
  alternateSlot,
  canTranslate,
  onOpenSettings,
  onOpenModelPicker,
}: {
  uiLocale: string
  mainSlot: TargetSlot
  alternateSlot: TargetSlot | null
  canTranslate: boolean
  onOpenSettings: () => void
  onOpenModelPicker: () => void
}) {
  const { t } = useTranslation('sidebar')
  const {
    primaryLanguage,
    secondaryLanguage,
    otherLanguage,
    recentLanguages,
    isTranslating,
    activeTargetLanguage,
    selectedModel,
    languagesLoaded,
    languagesSetByUser,
    defaultsHintDismissed,
    primarySuggestion,
  } = useTranslationStore()
  const translateToSlot = useTranslationStore((s) => s.translateToSlot)
  const translateToOther = useTranslationStore((s) => s.translateToOther)
  const setSecondaryLanguage = useTranslationStore((s) => s.setSecondaryLanguage)
  const closeOtherLanguage = useTranslationStore((s) => s.closeOtherLanguage)
  const dismissDefaultsHint = useTranslationStore((s) => s.dismissDefaultsHint)
  const acceptPrimarySuggestion = useTranslationStore((s) => s.acceptPrimarySuggestion)
  const dismissPrimarySuggestion = useTranslationStore((s) => s.dismissPrimarySuggestion)
  const [menuOpen, setMenuOpen] = useState(false)
  const [chooseOpen, setChooseOpen] = useState(false)

  const shortcutFor = (slot: TargetSlot): Shortcut | undefined => {
    if (slot === mainSlot) return SHORTCUTS.main
    if (slot === alternateSlot) return SHORTCUTS.alternate
    return undefined
  }
  const isActive = (language: string | null) =>
    isTranslating && !!language && activeTargetLanguage === language

  const showDefaultsHint = languagesLoaded && !languagesSetByUser && !defaultsHintDismissed

  return (
    <div className="shrink-0 border-t px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <TargetButton
          language={primaryLanguage}
          uiLocale={uiLocale}
          isMain={mainSlot === 'primary'}
          isActive={isActive(primaryLanguage)}
          shortcut={shortcutFor('primary')}
          disabled={!canTranslate}
          onClick={() => translateToSlot('primary')}
        />

        {secondaryLanguage ? (
          <div className="flex">
            <TargetButton
              language={secondaryLanguage}
              uiLocale={uiLocale}
              isMain={mainSlot === 'secondary'}
              isActive={isActive(secondaryLanguage)}
              shortcut={shortcutFor('secondary')}
              disabled={!canTranslate}
              onClick={() => translateToSlot('secondary')}
              className="rounded-r-none"
            />
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant={mainSlot === 'secondary' ? 'default' : 'outline'}
                  size="icon"
                  disabled={isTranslating}
                  aria-label={t('moreLanguages')}
                  title={t('moreLanguages')}
                  className={cn(
                    'rounded-l-none',
                    mainSlot === 'secondary'
                      ? 'border-l border-primary-foreground/25'
                      : 'border-l-0'
                  )}
                >
                  <ChevronDown />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="end">
                <LanguageCommand
                  uiLocale={uiLocale}
                  recent={recentLanguages}
                  exclude={[primaryLanguage, secondaryLanguage]}
                  allHeading={t('allLanguages')}
                  onSelect={(code) => {
                    setMenuOpen(false)
                    translateToOther(code)
                  }}
                  footer={
                    <CommandGroup>
                      <CommandItem
                        value="__language-settings__"
                        onSelect={() => {
                          setMenuOpen(false)
                          onOpenSettings()
                        }}
                        className="text-xs"
                      >
                        <Settings2 className="mr-1 h-3 w-3" />
                        {t('languageSettingsMenu')}
                      </CommandItem>
                    </CommandGroup>
                  }
                />
              </PopoverContent>
            </Popover>
          </div>
        ) : (
          <Popover open={chooseOpen} onOpenChange={setChooseOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={isTranslating}
                title={t('chooseSecondaryLanguage')}
              >
                {t('chooseLanguage')}
                <ChevronDown data-icon="inline-end" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="center">
              <LanguageCommand
                uiLocale={uiLocale}
                exclude={[primaryLanguage]}
                onSelect={(code) => {
                  setChooseOpen(false)
                  setSecondaryLanguage(code)
                  if (canTranslate) translateToSlot('secondary')
                }}
              />
            </PopoverContent>
          </Popover>
        )}

        {otherLanguage && (
          <div className="flex">
            <TargetButton
              language={otherLanguage}
              uiLocale={uiLocale}
              isMain={mainSlot === 'other'}
              isActive={isActive(otherLanguage)}
              shortcut={shortcutFor('other')}
              disabled={!canTranslate}
              onClick={() => translateToSlot('other')}
              className="rounded-r-none"
            />
            <Button
              variant={mainSlot === 'other' ? 'default' : 'outline'}
              size="icon"
              onClick={closeOtherLanguage}
              disabled={isTranslating}
              aria-label={t('removeLanguageButton', {
                language: getDisplayName(otherLanguage, uiLocale),
              })}
              className={cn(
                'rounded-l-none',
                mainSlot === 'other' ? 'border-l border-primary-foreground/25' : 'border-l-0'
              )}
            >
              <X />
            </Button>
          </div>
        )}
      </div>

      {!selectedModel && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={onOpenModelPicker}
          >
            {t('selectModelToTranslate')}
          </Button>
        </p>
      )}
      {primarySuggestion && !isTranslating && (
        <p role="status" className="mt-2 text-center text-xs text-muted-foreground">
          {t('primarySuggestion', { language: getDisplayName(primarySuggestion, uiLocale) })}{' '}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={acceptPrimarySuggestion}
          >
            {t('makePrimary')}
          </Button>
          {' · '}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={dismissPrimarySuggestion}
          >
            {t('notNow')}
          </Button>
        </p>
      )}
      {showDefaultsHint && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {t('translationDefaultsHint')}
          {' · '}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => {
              dismissDefaultsHint()
              onOpenSettings()
            }}
          >
            {t('changeLanguages')}
          </Button>
        </p>
      )}
    </div>
  )
}

function TargetButton({
  language,
  uiLocale,
  isMain,
  isActive,
  shortcut,
  disabled,
  onClick,
  className,
}: {
  language: string
  uiLocale: string
  isMain: boolean
  isActive: boolean
  shortcut?: Shortcut
  disabled: boolean
  onClick: () => void
  className?: string
}) {
  const { t } = useTranslation('sidebar')
  const stopTranslation = useTranslationStore((s) => s.stopTranslation)
  const variant = isMain ? 'default' : 'outline'

  if (isActive) {
    return (
      <Button
        variant={variant}
        onClick={stopTranslation}
        aria-label={t('stopTranslation')}
        aria-keyshortcuts="Escape"
        className={className}
      >
        <Square data-icon="inline-start" />
        {t('stopTranslation')}
      </Button>
    )
  }

  const languageName = getDisplayName(language, uiLocale)
  const label = shortcut
    ? t('translateToWithShortcut', { language: languageName, shortcut: shortcut.label })
    : t('translateToLabel', { language: languageName })

  return (
    <Button
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-keyshortcuts={shortcut?.aria}
      title={label}
      className={className}
    >
      <span className="hidden sm:inline">{t('translateTo', { language: languageName })}</span>
      <span className="sm:hidden">{getShortCode(language)}</span>
      {shortcut && (
        <kbd
          aria-hidden
          className={cn(
            'hidden rounded border px-1 font-mono text-[10px] md:inline',
            isMain ? 'border-primary-foreground/30' : 'text-muted-foreground'
          )}
        >
          {shortcut.hint}
        </kbd>
      )}
    </Button>
  )
}

function LanguageSettingsPopover({
  open,
  onOpenChange,
  uiLocale,
  disabled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  uiLocale: string
  disabled: boolean
}) {
  const { t } = useTranslation('sidebar')
  const primaryLanguage = useTranslationStore((s) => s.primaryLanguage)
  const secondaryLanguage = useTranslationStore((s) => s.secondaryLanguage)
  const setPrimaryLanguage = useTranslationStore((s) => s.setPrimaryLanguage)
  const setSecondaryLanguage = useTranslationStore((s) => s.setSecondaryLanguage)
  const swapPrimaryAndSecondary = useTranslationStore((s) => s.swapPrimaryAndSecondary)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={t('languageSettings')}
          title={t('languageSettings')}
        >
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <h2 className="mb-3 text-sm font-semibold">{t('yourLanguages')}</h2>
        <div className="flex flex-col gap-3">
          <LanguageSettingRow
            label={t('primaryLanguage')}
            description={t('primaryLanguageDescription')}
          >
            <LanguageSelect
              value={primaryLanguage}
              onChange={setPrimaryLanguage}
              ariaLabel={t('primaryLanguage')}
              uiLocale={uiLocale}
              variant="outline"
            />
          </LanguageSettingRow>
          <LanguageSettingRow
            label={t('secondaryLanguage')}
            description={t('secondaryLanguageDescription')}
          >
            <LanguageSelect
              value={secondaryLanguage}
              onChange={setSecondaryLanguage}
              ariaLabel={t('secondaryLanguage')}
              uiLocale={uiLocale}
              variant="outline"
              placeholder={t('notSet')}
            />
          </LanguageSettingRow>
          <Button
            variant="ghost"
            size="sm"
            className="self-end"
            onClick={swapPrimaryAndSecondary}
            disabled={!secondaryLanguage}
          >
            <ArrowUpDown data-icon="inline-start" />
            {t('swapLanguages')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function LanguageSettingRow({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
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

/** Searchable language list with optional recent group and footer items. */
function LanguageCommand({
  uiLocale,
  value,
  includeAuto = false,
  recent = [],
  exclude = [],
  allHeading,
  onSelect,
  footer,
}: {
  uiLocale: string
  value?: string | null
  includeAuto?: boolean
  recent?: string[]
  exclude?: Array<string | null>
  allHeading?: string
  onSelect: (code: string) => void
  footer?: React.ReactNode
}) {
  const { t } = useTranslation('sidebar')
  const recentCodes = recent.filter((code) => !exclude.includes(code))
  const languages = TRANSLATION_LANGUAGES.filter((l) => !exclude.includes(l.code))

  const renderItem = (code: string, group: string) => {
    const displayName = getDisplayName(code, uiLocale)
    const nativeName = getNativeName(code)
    return (
      <CommandItem
        key={`${group}:${code}`}
        value={`${group}:${code}`}
        keywords={[code, getEnglishName(code), displayName, nativeName]}
        onSelect={() => onSelect(code)}
        className="text-xs"
      >
        <Check className={cn('mr-1 h-3 w-3', value === code ? 'opacity-100' : 'opacity-0')} />
        <span className="truncate">{displayName}</span>
        {nativeName !== displayName && (
          <span className="ml-auto truncate text-muted-foreground">{nativeName}</span>
        )}
      </CommandItem>
    )
  }

  return (
    <Command>
      <CommandInput placeholder={t('searchLanguage')} />
      <CommandList>
        <CommandEmpty>{t('noLanguageFound')}</CommandEmpty>
        {recentCodes.length > 0 && (
          <CommandGroup heading={t('recentLanguages')}>
            {recentCodes.map((code) => renderItem(code, 'recent'))}
          </CommandGroup>
        )}
        <CommandGroup heading={allHeading}>
          {includeAuto && (
            <CommandItem
              value={`all:${AUTO_LANGUAGE}`}
              keywords={[AUTO_LANGUAGE, t('autoDetect')]}
              onSelect={() => onSelect(AUTO_LANGUAGE)}
              className="text-xs"
            >
              <Check
                className={cn(
                  'mr-1 h-3 w-3',
                  value === AUTO_LANGUAGE ? 'opacity-100' : 'opacity-0'
                )}
              />
              {t('autoDetect')}
            </CommandItem>
          )}
          {languages.map((l) => renderItem(l.code, 'all'))}
        </CommandGroup>
        {footer && (
          <>
            <CommandSeparator />
            {footer}
          </>
        )}
      </CommandList>
    </Command>
  )
}

function LanguageSelect({
  value,
  onChange,
  ariaLabel,
  uiLocale,
  includeAuto = false,
  disabled = false,
  variant = 'ghost',
  placeholder,
  autoLabel,
}: {
  value: string | null
  onChange: (code: string) => void
  ariaLabel: string
  uiLocale: string
  /** Trigger text while the value is `auto`, e.g. the detected language. */
  autoLabel?: string
  includeAuto?: boolean
  disabled?: boolean
  variant?: 'ghost' | 'outline'
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation('sidebar')
  const label =
    value === AUTO_LANGUAGE
      ? (autoLabel ?? t('autoDetect'))
      : value
        ? getDisplayName(value, uiLocale)
        : (placeholder ?? t('selectLanguage'))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'h-8 max-w-48 justify-between gap-2 px-2 font-medium',
            variant === 'ghost' && '-ml-2'
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <LanguageCommand
          uiLocale={uiLocale}
          value={value}
          includeAuto={includeAuto}
          onSelect={(code) => {
            onChange(code)
            setOpen(false)
          }}
        />
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
  open,
  onOpenChange,
}: {
  vendors: { id: string; name: string; models: Model[] }[]
  selectedModel: Model | null
  onSelect: (model: Model | null) => void
  placeholder: string
  disabled?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('sidebar')

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
                      onOpenChange(false)
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
