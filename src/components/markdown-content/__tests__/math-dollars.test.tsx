import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import i18n from '@/lib/i18n'
import { MarkdownContent } from '../index'
import { escapeNonMathDollars } from '../math-dollars'

void i18n

describe('escapeNonMathDollars', () => {
  it.each([
    [
      'annual salaries run $28,000–$216,856 (median $83,381), hourly $16.34–$62.50 (median $26.08).',
      'annual salaries run \\$28,000–\\$216,856 (median \\$83,381), hourly \\$16.34–\\$62.50 (median \\$26.08).',
    ],
    [
      'Irvine (n=267) medians $100,000; Austin $40,019; Cork $40,000; Versailles $46,953.',
      'Irvine (n=267) medians \\$100,000; Austin \\$40,019; Cork \\$40,000; Versailles \\$46,953.',
    ],
    [
      '| Software Engineering | 74 | $129,552 | $107,250–$154,050 |',
      '| Software Engineering | 74 | \\$129,552 | \\$107,250–\\$154,050 |',
    ],
    ['It costs $5, so $x$ dollars.', 'It costs \\$5, so $x$ dollars.'],
    ['Between $5 and $10.', 'Between \\$5 and \\$10.'],
  ])('escapes currency: %s', (input, expected) => {
    expect(escapeNonMathDollars(input)).toBe(expected)
  })

  it.each([
    'Euler: $e^{i\\pi} + 1 = 0$ and $x_1$, $2^n$.',
    'Display $$\\sum_{i=1}^n i$$ inline.',
    'Already escaped \\$5 and \\$10.',
    'Code `price = $5` and ``a $ b``.',
    '| $a$ | $b$ |',
    'No dollars at all.',
  ])('leaves math, code, and escapes alone: %s', (input) => {
    expect(escapeNonMathDollars(input)).toBe(input)
  })

  it('leaves fenced code and display blocks alone', () => {
    const input = [
      '```bash',
      'echo $HOME costs $5',
      '```',
      '$$',
      'a = $5 + b',
      '$$',
      'Then $5.',
    ].join('\n')
    expect(escapeNonMathDollars(input)).toBe(
      ['```bash', 'echo $HOME costs $5', '```', '$$', 'a = $5 + b', '$$', 'Then \\$5.'].join('\n')
    )
  })
})

describe('MarkdownContent with dollar amounts', () => {
  it('renders prices as text and real formulas as math', () => {
    const { container } = render(
      <MarkdownContent
        content={
          'Salaries run $28,000–$216,856 (median $83,381), hourly $16.34.\n\nEnergy: $E = mc^2$.'
        }
      />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('$28,000–$216,856 (median $83,381), hourly $16.34.')
    const math = container.querySelectorAll('.katex')
    expect(math).toHaveLength(1)
    expect(math[0].textContent).toContain('E=mc')
  })
})
