import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModelListItem } from '@/components/model-list-item'
import { AssistantListItem } from '@/components/assistant-list-item'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

const cases = [
  {
    name: 'ModelListItem',
    renderItem: (onClick: () => void, onActivate?: () => void) =>
      render(
        <ModelListItem name="GPT-4o" modelId="gpt-4o" onClick={onClick} onActivate={onActivate} />
      ),
    label: 'GPT-4o',
  },
  {
    name: 'AssistantListItem',
    renderItem: (onClick: () => void, onActivate?: () => void) =>
      render(<AssistantListItem name="Chef" onClick={onClick} onActivate={onActivate} />),
    label: 'Chef',
  },
]

describe.each(cases)('$name activation', ({ renderItem, label }) => {
  const row = () => screen.getByText(label).closest('[role="button"]') as HTMLElement

  it('selects on click and activates on double-click', () => {
    const onClick = vi.fn()
    const onActivate = vi.fn()
    renderItem(onClick, onActivate)

    fireEvent.click(row())
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onActivate).not.toHaveBeenCalled()

    fireEvent.doubleClick(row())
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('activates on Enter and selects on Space', () => {
    const onClick = vi.fn()
    const onActivate = vi.fn()
    renderItem(onClick, onActivate)

    fireEvent.keyDown(row(), { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()

    fireEvent.keyDown(row(), { key: ' ' })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('falls back to click on Enter without an activate handler', () => {
    const onClick = vi.fn()
    renderItem(onClick)

    fireEvent.keyDown(row(), { key: 'Enter' })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('ignores keys pressed on nested controls', () => {
    const onClick = vi.fn()
    const onActivate = vi.fn()
    renderItem(onClick, onActivate)

    const nestedButton = row().querySelector('button') as HTMLElement
    fireEvent.keyDown(nestedButton, { key: 'Enter' })

    expect(onActivate).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })
})
