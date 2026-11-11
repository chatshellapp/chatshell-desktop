import { describe, it, expect } from 'vitest'
import { protectSpecialTokens, restoreSpecialTokens } from '../specialTokens'

const ZWSP = '​'

describe('protectSpecialTokens', () => {
  it.each([
    ['<|im_end|>', `<${ZWSP}|im_end|>`],
    ['<|endoftext|>', `<${ZWSP}|endoftext|>`],
    ['<｜end▁of▁sentence｜>', `<${ZWSP}｜end▁of▁sentence｜>`],
    ['</s>', `<${ZWSP}/s>`],
    ['<eos>', `<${ZWSP}eos>`],
    ['<end_of_turn>', `<${ZWSP}end_of_turn>`],
    ['<think>', `<${ZWSP}think>`],
    ['</THINK>', `<${ZWSP}/THINK>`],
    ['[INST]', `[${ZWSP}INST]`],
    ['[/INST]', `[${ZWSP}/INST]`],
  ])('breaks up %s', (input, expected) => {
    expect(protectSpecialTokens(`a ${input} b`)).toBe(`a ${expected} b`)
  })

  it('leaves ordinary markup and text alone', () => {
    const text = 'if a < b and <div>x</div> or [link](url) or a | b > c'
    expect(protectSpecialTokens(text)).toBe(text)
  })

  it('round-trips through restoreSpecialTokens', () => {
    const text = 'Say <|im_end|> then </s> and <think>x</think> [INST]hi[/INST]'
    const protectedText = protectSpecialTokens(text)
    expect(protectedText).not.toBe(text)
    expect(restoreSpecialTokens(protectedText)).toBe(text)
  })

  it('only removes zero-width spaces it inserted', () => {
    const text = `keep <${ZWSP}div> and a${ZWSP}b`
    expect(restoreSpecialTokens(text)).toBe(text)
  })
})
