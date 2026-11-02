import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import i18n from '@/lib/i18n'
import { MarkdownContent } from '../index'

void i18n

function renderMarkdown(content: string): HTMLElement {
  return render(<MarkdownContent content={content} />).container
}

describe('MarkdownContent HTML sanitizing', () => {
  it('drops scripts, event handlers and active elements from raw HTML', () => {
    const container = renderMarkdown(
      [
        'Hello <img src="x" onerror="window.__pwned = 1">',
        '',
        '<script>window.__pwned = 2</script>',
        '',
        '<svg onload="window.__pwned = 3"><circle r="5"/></svg>',
        '',
        '<iframe src="https://evil.example"></iframe>',
        '',
        '<form action="https://evil.example"><input name="q"></form>',
        '',
        '<a href="javascript:alert(1)">click</a>',
        '',
        '<div style="position:fixed;inset:0">overlay</div>',
      ].join('\n')
    )
    const html = container.innerHTML
    expect(container.querySelector('script, iframe, form, svg')).toBeNull()
    expect(html).not.toMatch(/onerror|onload|javascript:/i)
    expect(container.querySelector('[style]')).toBeNull()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    // Text content survives.
    expect(container).toHaveTextContent('click')
    expect(container).toHaveTextContent('overlay')
  })

  it('keeps ordinary formatting HTML', () => {
    const container = renderMarkdown(
      '<details><summary>More</summary>Hidden</details>\n\nPress <kbd>Ctrl</kbd> x<sup>2</sup>'
    )
    expect(container.querySelector('details summary')).toHaveTextContent('More')
    expect(container.querySelector('kbd')).toHaveTextContent('Ctrl')
    expect(container.querySelector('sup')).toHaveTextContent('2')
  })

  it('keeps math rendering, task lists and fenced code languages', () => {
    const container = renderMarkdown(
      'Inline $a^2$ and\n\n$$\nb^2\n$$\n\n- [x] done\n\n```python\nprint(1)\n```'
    )
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('.katex-display')).not.toBeNull()
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull()
    expect(container).toHaveTextContent('python')
  })

  it('keeps https image sources and drops script URLs', () => {
    const container = renderMarkdown(
      '![a](https://example.com/a.png) <img src="javascript:alert(1)" alt="c">'
    )
    const sources = Array.from(container.querySelectorAll('img')).map((img) =>
      img.getAttribute('src')
    )
    expect(sources).toContain('https://example.com/a.png')
    expect(sources.some((src) => src?.startsWith('javascript:'))).toBe(false)
  })
})
