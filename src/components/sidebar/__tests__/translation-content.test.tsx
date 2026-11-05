import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DETECTION_DEBOUNCE_MS, LONG_INPUT_CHARS, TranslationContent } from '../translation-content'
import { useTranslationStore } from '@/stores/translationStore'
import { useTranslationHistoryStore } from '@/stores/translationHistoryStore'
import type { Model, TranslationHistoryEntry } from '@/types'

vi.mock('react-i18next', () => ({
  // Render interpolated values so labels stay distinguishable, e.g.
  // "translateToLabel(French)".
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const values = Object.entries(options ?? {})
        .filter(([name]) => name !== 'count')
        .map(([, value]) => String(value))
      return values.length ? `${key}(${values.join('|')})` : key
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('@/components/model-avatar', () => ({ ModelAvatar: () => null }))

// cmdk measures its list with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}

const model: Model = {
  id: 'model-1',
  provider_id: 'provider-1',
  model_id: 'test-model',
  name: 'Test model',
  is_starred: false,
  is_deleted: false,
  created_at: '',
  updated_at: '',
}
const translateToSlot = vi.fn()
const translateToOther = vi.fn()
const retranslate = vi.fn()
const stopTranslation = vi.fn()
const detectInputLanguage = vi.fn()
const restoreFromHistory = vi.fn()
const removeHistoryEntry = vi.fn().mockResolvedValue(undefined)
const setHistoryEnabled = vi.fn()

const historyEntry = (
  id: string,
  overrides: Partial<TranslationHistoryEntry> = {}
): TranslationHistoryEntry => ({
  id,
  source_text: `source ${id}`,
  translated_text: `translated ${id}`,
  source_language: 'auto',
  target_language: 'fr',
  model_id: 'model-1',
  created_at: new Date().toISOString(),
  ...overrides,
})

const primaryButton = () =>
  screen.getByRole('button', { name: 'translateToWithShortcut(English|Enter)' })
const secondaryButton = () =>
  screen.getByRole('button', { name: 'translateToWithShortcut(French|Alt+Enter)' })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useTranslationStore.setState({
    sourceLanguage: 'auto',
    primaryLanguage: 'en',
    secondaryLanguage: 'fr',
    recentLanguages: [],
    otherLanguage: null,
    lastTarget: 'primary',
    languagesSetByUser: true,
    languagesLoaded: true,
    defaultsHintDismissed: true,
    inputText: 'Hello',
    outputText: 'Bonjour',
    selectedModel: model,
    isTranslating: false,
    activeTargetLanguage: null,
    lastAttempt: null,
    canContinue: false,
    error: null,
    translateToSlot,
    translateToOther,
    retranslate,
    stopTranslation,
    detectInputLanguage,
    detection: null,
    primarySuggestion: null,
    restoreFromHistory,
  })
  // Loaded up front so the popover's mount-time load is a no-op.
  useTranslationHistoryStore.setState({
    entries: [],
    enabled: true,
    isLoaded: true,
    loadPromise: null,
    remove: removeHistoryEntry,
    setEnabled: setHistoryEnabled,
  })
})

describe('TranslationContent', () => {
  it('renders editable source, read-only translation and one button per language', () => {
    render(<TranslationContent />)
    expect(screen.getByRole('textbox', { name: 'translationInputPlaceholder' })).toHaveValue(
      'Hello'
    )
    expect(screen.getByRole('textbox', { name: 'translationOutputPlaceholder' })).toHaveAttribute(
      'readonly'
    )
    expect(screen.getByRole('combobox', { name: 'sourceLanguage' })).toBeEnabled()
    expect(primaryButton()).toHaveAttribute('aria-keyshortcuts', 'Enter')
    expect(secondaryButton()).toHaveAttribute('aria-keyshortcuts', 'Alt+Enter')
    fireEvent.click(primaryButton())
    expect(translateToSlot).toHaveBeenLastCalledWith('primary')
    fireEvent.click(secondaryButton())
    expect(translateToSlot).toHaveBeenLastCalledWith('secondary')
  })

  it('makes the last used button the Enter target', () => {
    useTranslationStore.setState({ lastTarget: 'secondary' })
    render(<TranslationContent />)
    expect(
      screen.getByRole('button', { name: 'translateToWithShortcut(French|Enter)' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'translateToWithShortcut(English|Alt+Enter)' })
    ).toBeInTheDocument()
  })

  it('translates with Enter and Alt+Enter, and keeps modified Enter for a newline', () => {
    render(<TranslationContent />)
    const input = screen.getByRole('textbox', { name: 'translationInputPlaceholder' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(translateToSlot).toHaveBeenLastCalledWith('primary')
    fireEvent.keyDown(input, { key: 'Enter', altKey: true })
    expect(translateToSlot).toHaveBeenLastCalledWith('secondary')
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(translateToSlot).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(useTranslationStore.getState().inputText).toContain('\n')
    expect(translateToSlot).toHaveBeenCalledTimes(2)
  })

  it('ignores Enter during IME composition', () => {
    render(<TranslationContent />)
    const input = screen.getByRole('textbox', { name: 'translationInputPlaceholder' })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(translateToSlot).not.toHaveBeenCalled()
  })

  it('turns the active button into Stop and locks everything else', () => {
    useTranslationStore.setState({ isTranslating: true, activeTargetLanguage: 'fr' })
    render(<TranslationContent />)
    for (const control of screen.getAllByRole('combobox')) expect(control).toBeDisabled()
    expect(primaryButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'moreLanguages' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common:clear' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'stopTranslation' }))
    expect(stopTranslation).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(stopTranslation).toHaveBeenCalledTimes(2)
  })

  it('retains the text across navigation and clears both panes on request', () => {
    const view = render(<TranslationContent />)
    fireEvent.change(screen.getByRole('textbox', { name: 'translationInputPlaceholder' }), {
      target: { value: 'Updated source' },
    })
    view.unmount()
    render(<TranslationContent />)
    expect(screen.getByRole('textbox', { name: 'translationInputPlaceholder' })).toHaveValue(
      'Updated source'
    )
    fireEvent.click(screen.getByRole('button', { name: 'common:clear' }))
    expect(screen.getByRole('textbox', { name: 'translationInputPlaceholder' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'translationOutputPlaceholder' })).toHaveValue('')
  })

  it('disables translation without a model and offers to pick one', async () => {
    useTranslationStore.setState({ selectedModel: null })
    render(<TranslationContent />)
    expect(primaryButton()).toBeDisabled()
    expect(secondaryButton()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'selectModelToTranslate' }))
    expect(await screen.findByPlaceholderText('searchModel')).toBeInTheDocument()
  })

  it('announces errors with a retry for the same direction', () => {
    render(<TranslationContent />)
    act(() =>
      useTranslationStore.setState({
        error: 'Request failed',
        lastAttempt: { sourceLanguage: 'auto', targetLanguage: 'fr' },
      })
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Request failed')
    fireEvent.click(screen.getByRole('button', { name: 'common:retry' }))
    expect(retranslate).toHaveBeenCalledOnce()
  })

  it('shows the direction of the last translation and moves output to the input', () => {
    useTranslationStore.setState({
      lastAttempt: { sourceLanguage: 'auto', targetLanguage: 'fr' },
      moveOutputToInput: useTranslationStore.getState().moveOutputToInput,
    })
    render(<TranslationContent />)
    expect(screen.getByText('translationDirection(autoDetect|French)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'retranslate' }))
    expect(retranslate).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'useAsInput' }))
    expect(screen.getByRole('textbox', { name: 'translationInputPlaceholder' })).toHaveValue(
      'Bonjour'
    )
    expect(screen.getByRole('textbox', { name: 'translationOutputPlaceholder' })).toHaveValue('')
  })

  it('offers to choose a secondary language when none is set', () => {
    useTranslationStore.setState({ secondaryLanguage: null })
    render(<TranslationContent />)
    expect(screen.getByRole('button', { name: /chooseLanguage/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'moreLanguages' })).not.toBeInTheDocument()
  })

  it('translates to another language from the menu', async () => {
    useTranslationStore.setState({ recentLanguages: ['de'] })
    render(<TranslationContent />)
    fireEvent.click(screen.getByRole('button', { name: 'moreLanguages' }))
    const menu = await screen.findByRole('listbox')
    expect(within(menu).getByText('recentLanguages')).toBeInTheDocument()
    fireEvent.click(within(menu).getAllByText('German')[0])
    expect(translateToOther).toHaveBeenCalledWith('de')
  })

  it('shows a removable temporary button for another language', () => {
    useTranslationStore.setState({
      otherLanguage: 'de',
      closeOtherLanguage: useTranslationStore.getState().closeOtherLanguage,
    })
    render(<TranslationContent />)
    fireEvent.click(screen.getByRole('button', { name: 'translateToLabel(German)' }))
    expect(translateToSlot).toHaveBeenLastCalledWith('other')
    fireEvent.click(screen.getByRole('button', { name: 'removeLanguageButton(German)' }))
    expect(
      screen.queryByRole('button', { name: 'translateToLabel(German)' })
    ).not.toBeInTheDocument()
  })

  it('explains system-based defaults and opens language settings from the hint', async () => {
    useTranslationStore.setState({ languagesSetByUser: false, defaultsHintDismissed: false })
    render(<TranslationContent />)
    expect(screen.getByText(/translationDefaultsHint/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'changeLanguages' }))
    expect(await screen.findByText('yourLanguages')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'primaryLanguage' })).toHaveTextContent('English')
    expect(screen.getByRole('combobox', { name: 'secondaryLanguage' })).toHaveTextContent('French')
  })

  it('shows the detected language and moves Enter to the other language', () => {
    useTranslationStore.setState({
      detection: { text: 'Hello', result: { language: 'en', confidence: 0.9, reliable: true } },
    })
    render(<TranslationContent />)
    expect(screen.getByRole('combobox', { name: 'sourceLanguage' })).toHaveTextContent(
      'detectedLanguage(English)'
    )
    expect(
      screen.getByRole('button', { name: 'translateToWithShortcut(French|Enter)' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'translateToWithShortcut(English|Alt+Enter)' })
    ).toBeInTheDocument()
  })

  it('shows Auto while detection is uncertain', () => {
    useTranslationStore.setState({
      detection: { text: 'Hello', result: { language: 'en', confidence: 0.1, reliable: false } },
    })
    render(<TranslationContent />)
    expect(screen.getByRole('combobox', { name: 'sourceLanguage' })).toHaveTextContent('autoDetect')
    expect(primaryButton()).toBeInTheDocument()
  })

  it('detects the input language after typing pauses', () => {
    vi.useFakeTimers()
    try {
      render(<TranslationContent />)
      detectInputLanguage.mockClear()
      fireEvent.change(screen.getByRole('textbox', { name: 'translationInputPlaceholder' }), {
        target: { value: 'Bonjour tout le monde' },
      })
      act(() => vi.advanceTimersByTime(DETECTION_DEBOUNCE_MS - 1))
      expect(detectInputLanguage).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(1))
      expect(detectInputLanguage).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers to change the primary language after a usage streak', () => {
    const acceptPrimarySuggestion = vi.fn()
    const dismissPrimarySuggestion = vi.fn()
    useTranslationStore.setState({
      primarySuggestion: 'ko',
      acceptPrimarySuggestion,
      dismissPrimarySuggestion,
    })
    render(<TranslationContent />)
    expect(screen.getByRole('status')).toHaveTextContent('primarySuggestion(Korean)')
    fireEvent.click(screen.getByRole('button', { name: 'makePrimary' }))
    expect(acceptPrimarySuggestion).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'notNow' }))
    expect(dismissPrimarySuggestion).toHaveBeenCalledOnce()
  })

  it('flags very long input without blocking translation', () => {
    useTranslationStore.setState({ inputText: 'a'.repeat(LONG_INPUT_CHARS + 1) })
    render(<TranslationContent />)
    expect(screen.getByText('longInputHint')).toBeInTheDocument()
    expect(primaryButton()).toBeEnabled()
  })

  it('renders Markdown in preview and preserves the editable source when switching back', () => {
    useTranslationStore.setState({ inputText: '# Heading\n\nSome **bold** text.' })
    render(<TranslationContent />)
    const source = screen.getByRole('region', { name: 'sourceLanguage' })
    fireEvent.mouseDown(within(source).getByRole('tab', { name: 'markdownPreview' }), {
      button: 0,
      ctrlKey: false,
    })
    expect(within(source).getByRole('heading', { name: 'Heading' })).toBeInTheDocument()
    expect(within(source).getByText('bold').tagName).toBe('STRONG')
    fireEvent.mouseDown(within(source).getByRole('tab', { name: 'markdownRaw' }), {
      button: 0,
      ctrlKey: false,
    })
    expect(within(source).getByRole('textbox')).toHaveValue('# Heading\n\nSome **bold** text.')
  })

  it('updates the translated Markdown preview as streaming text changes', () => {
    useTranslationStore.setState({ outputText: '# Translation', isTranslating: true })
    render(<TranslationContent />)
    const target = screen.getByRole('region', { name: 'targetLanguage' })
    fireEvent.mouseDown(within(target).getByRole('tab', { name: 'markdownPreview' }), {
      button: 0,
      ctrlKey: false,
    })
    expect(within(target).getByRole('heading', { name: 'Translation' })).toBeInTheDocument()
    act(() => useTranslationStore.setState({ outputText: '# Translation\n\nUpdated paragraph.' }))
    expect(within(target).getByText('Updated paragraph.')).toBeInTheDocument()
  })

  it('follows streamed output only after scrolling to the bottom, and stops on scroll up', () => {
    useTranslationStore.setState({ outputText: 'Part 1', isTranslating: true })
    render(<TranslationContent />)
    const output = screen.getByRole('textbox', { name: 'translationOutputPlaceholder' })
    let scrollHeight = 1000
    Object.defineProperty(output, 'clientHeight', { configurable: true, get: () => 200 })
    Object.defineProperty(output, 'scrollHeight', { configurable: true, get: () => scrollHeight })
    const scrollTo = (top: number) => {
      output.scrollTop = top
      fireEvent.scroll(output)
    }
    const stream = (text: string) => {
      scrollHeight += 100
      act(() => useTranslationStore.setState({ outputText: text }))
    }

    // Not following by default.
    stream('Part 1 2')
    expect(output.scrollTop).toBe(0)

    // Reaching the bottom starts following, even after an elastic bounce back.
    scrollTo(scrollHeight - 200 + 30)
    scrollTo(scrollHeight - 200)
    stream('Part 1 2 3')
    expect(output.scrollTop).toBe(scrollHeight)

    // Scrolling up stops following.
    scrollTo(scrollHeight - 200)
    scrollTo(300)
    stream('Part 1 2 3 4')
    expect(output.scrollTop).toBe(300)

    // An upward wheel gesture stops following even within the bottom tolerance.
    scrollTo(scrollHeight - 200)
    fireEvent.wheel(output, { deltaY: -2 })
    stream('Part 1 2 3 4 5')
    expect(output.scrollTop).toBe(scrollHeight - 200 - 100)
  })

  it('imports a Markdown file into the editable source without translating automatically', async () => {
    render(<TranslationContent />)
    const file = new File(['# Imported'], 'notes.md', { type: 'text/markdown' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('# Imported') })
    fireEvent.change(screen.getByLabelText('importMarkdown', { selector: 'input' }), {
      target: { files: [file] },
    })
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'translationInputPlaceholder' })).toHaveValue(
        '# Imported'
      )
    )
    expect(translateToSlot).not.toHaveBeenCalled()
  })

  it('keeps the current source if reading an imported file fails', async () => {
    render(<TranslationContent />)
    const file = new File([], 'unreadable.md')
    Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('Read failed')) })
    fireEvent.change(screen.getByLabelText('importMarkdown', { selector: 'input' }), {
      target: { files: [file] },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'importMarkdown' })).toBeEnabled()
    )
    expect(screen.getByRole('textbox', { name: 'translationInputPlaceholder' })).toHaveValue(
      'Hello'
    )
  })

  describe('history', () => {
    const openHistory = () =>
      fireEvent.click(screen.getByRole('button', { name: 'translationHistory' }))

    it('explains the empty and turned-off states', () => {
      render(<TranslationContent />)
      openHistory()
      expect(screen.getByText('translationHistoryEmpty')).toBeInTheDocument()

      act(() => useTranslationHistoryStore.setState({ enabled: false }))
      expect(screen.getByText('translationHistoryOff')).toBeInTheDocument()
    })

    it('restores an entry and closes the popover', () => {
      useTranslationHistoryStore.setState({
        entries: [historyEntry('a', { source_text: 'Good morning', translated_text: 'Bonjour' })],
      })
      render(<TranslationContent />)
      openHistory()

      fireEvent.click(screen.getByText('Good morning'))

      expect(restoreFromHistory).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a', translated_text: 'Bonjour' })
      )
      expect(screen.queryByText('Good morning')).not.toBeInTheDocument()
    })

    it('filters entries by source or translation and removes one', () => {
      useTranslationHistoryStore.setState({
        entries: [
          historyEntry('a', { source_text: 'Good morning', translated_text: 'Bonjour' }),
          historyEntry('b', { source_text: 'Thank you', translated_text: 'Merci' }),
        ],
      })
      render(<TranslationContent />)
      openHistory()

      fireEvent.change(screen.getByRole('textbox', { name: 'translationHistorySearch' }), {
        target: { value: 'MERCI' },
      })
      expect(screen.queryByText('Good morning')).not.toBeInTheDocument()
      const list = screen.getByRole('list', { name: 'translationHistory' })
      expect(within(list).getByText('Thank you')).toBeInTheDocument()

      fireEvent.click(within(list).getByRole('button', { name: 'translationHistoryDelete' }))
      expect(removeHistoryEntry).toHaveBeenCalledWith('b')
    })

    it('toggles saving history', () => {
      render(<TranslationContent />)
      openHistory()

      fireEvent.click(screen.getByRole('switch', { name: 'translationHistorySave' }))
      expect(setHistoryEnabled).toHaveBeenCalledWith(false)
    })

    it('is unavailable while translating', () => {
      useTranslationStore.setState({ isTranslating: true, activeTargetLanguage: 'en' })
      render(<TranslationContent />)
      expect(screen.getByRole('button', { name: 'translationHistory' })).toBeDisabled()
    })
  })
})
