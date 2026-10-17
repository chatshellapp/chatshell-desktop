import { describe, it, expect } from 'vitest'
import { releaseContentVisibility, restoreContentVisibility } from '../screenshot'

function makeRow(chatMessageId: string): HTMLElement {
  const row = document.createElement('div')
  row.dataset.messageId = chatMessageId
  row.style.contentVisibility = 'auto'
  row.style.containIntrinsicSize = 'auto 120px'
  return row
}

describe('screenshot capture visibility', () => {
  it('lays out culled message rows before capture and restores their culling', () => {
    const container = document.createElement('div')
    const first = makeRow('m1')
    const second = makeRow('m2')
    container.append(first, second)

    const restorations = releaseContentVisibility(container)

    expect(restorations).toHaveLength(2)
    expect(first.style.contentVisibility).toBe('visible')
    expect(second.style.contentVisibility).toBe('visible')
    expect(first.style.containIntrinsicSize).toBe('none')
    expect(second.style.containIntrinsicSize).toBe('none')

    restoreContentVisibility(restorations)

    expect(first.style.contentVisibility).toBe('auto')
    expect(second.style.contentVisibility).toBe('auto')
    expect(first.style.containIntrinsicSize).toBe('auto 120px')
    expect(second.style.containIntrinsicSize).toBe('auto 120px')
  })

  it('handles a single message row as the capture root', () => {
    const row = makeRow('m1')

    const restorations = releaseContentVisibility(row)

    expect(row.style.contentVisibility).toBe('visible')

    restoreContentVisibility(restorations)

    expect(row.style.contentVisibility).toBe('auto')
  })
})
