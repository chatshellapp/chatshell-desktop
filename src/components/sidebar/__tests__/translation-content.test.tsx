import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LONG_INPUT_CHARS, TranslationContent } from '../translation-content'
import { useTranslationStore } from '@/stores/translationStore'
import type { Model } from '@/types'

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
})
