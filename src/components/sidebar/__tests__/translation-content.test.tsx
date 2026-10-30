import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TranslationContent } from '../translation-content'
import { useTranslationStore } from '@/stores/translationStore'
import type { Model } from '@/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))
vi.mock('@/components/model-avatar', () => ({ ModelAvatar: () => null }))

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
const translate = vi.fn()
const stopTranslation = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useTranslationStore.setState({
    sourceLanguage: 'en',
    targetLanguage: 'fr',
    inputText: 'Hello',
    outputText: 'Bonjour',
    selectedModel: model,
    isTranslating: false,
    canContinue: false,
    error: null,
    translate,
    stopTranslation,
  })
})

describe('TranslationContent', () => {
  it('renders editable source and read-only translation with labeled controls', () => {
    render(<TranslationContent />)
    expect(screen.getByRole('textbox', { name: 'translationInputPlaceholder' })).toHaveValue(
      'Hello'
    )
    expect(screen.getByRole('textbox', { name: 'translationOutputPlaceholder' })).toHaveAttribute(
      'readonly'
    )
    expect(screen.getByRole('combobox', { name: 'sourceLanguage' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'targetLanguage' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'translate' }))
    expect(translate).toHaveBeenCalledOnce()
  })

  it('locks configuration during translation while keeping stop available', () => {
    useTranslationStore.setState({ isTranslating: true })
    render(<TranslationContent />)
    for (const control of screen.getAllByRole('combobox')) expect(control).toBeDisabled()
    expect(screen.getByRole('button', { name: 'swapLanguages' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common:clear' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'stopTranslation' }))
    expect(stopTranslation).toHaveBeenCalledOnce()
  })

  it('preserves Enter to translate and modified Enter for a newline', () => {
    render(<TranslationContent />)
    const input = screen.getByRole('textbox', { name: 'translationInputPlaceholder' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(translate).toHaveBeenCalledOnce()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(translate).toHaveBeenCalledOnce()
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(useTranslationStore.getState().inputText).toContain('\n')
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

  it('disables translate without a model and announces errors', () => {
    useTranslationStore.setState({ selectedModel: null })
    render(<TranslationContent />)
    expect(screen.getByRole('button', { name: 'translate' })).toBeDisabled()
    act(() => useTranslationStore.setState({ error: 'Request failed' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Request failed')
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
    expect(translate).not.toHaveBeenCalled()
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
