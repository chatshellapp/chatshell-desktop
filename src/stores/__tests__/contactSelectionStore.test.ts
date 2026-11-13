import { describe, it, expect, beforeEach } from 'vitest'
import { useContactSelectionStore } from '../contactSelectionStore'

describe('contactSelectionStore', () => {
  beforeEach(() => useContactSelectionStore.setState({ selected: null, activeTab: 'models' }))

  it('switches to the tab of the selected contact', () => {
    useContactSelectionStore.getState().selectContact({ kind: 'assistant', id: 'a-1' })
    expect(useContactSelectionStore.getState().activeTab).toBe('assistants')

    useContactSelectionStore.getState().selectContact({ kind: 'model', id: 'm-1' })
    expect(useContactSelectionStore.getState().activeTab).toBe('models')
  })

  it('keeps the tab when the selection is cleared', () => {
    useContactSelectionStore.getState().selectContact({ kind: 'assistant', id: 'a-1' })
    useContactSelectionStore.getState().clearContact()
    expect(useContactSelectionStore.getState()).toEqual(
      expect.objectContaining({ selected: null, activeTab: 'assistants' })
    )
  })
})
