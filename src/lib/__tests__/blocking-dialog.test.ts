import { afterEach, describe, expect, it } from 'vitest'
import { hasBlockingDialog } from '../blocking-dialog'

describe('hasBlockingDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('is false with no dialogs', () => {
    expect(hasBlockingDialog()).toBe(false)
  })

  it('detects an open dialog or alert dialog', () => {
    document.body.innerHTML = '<div role="dialog"></div>'
    expect(hasBlockingDialog()).toBe(true)

    document.body.innerHTML = '<div role="alertdialog"></div>'
    expect(hasBlockingDialog()).toBe(true)
  })

  it('ignores inert and non-modal dialogs such as devtools drawers', () => {
    document.body.innerHTML = `
      <aside role="dialog" aria-modal="false" inert></aside>
      <aside role="dialog" aria-modal="false"></aside>
      <div role="dialog" inert></div>
    `
    expect(hasBlockingDialog()).toBe(false)
  })

  it('still detects a modal dialog next to ignored drawers', () => {
    document.body.innerHTML = `
      <aside role="dialog" aria-modal="false" inert></aside>
      <div role="dialog" aria-modal="true"></div>
    `
    expect(hasBlockingDialog()).toBe(true)
  })
})
