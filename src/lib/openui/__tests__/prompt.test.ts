import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

import { createParser } from '@openuidev/lang-core'
import { describe, expect, it } from 'vitest'

import { chatShellOpenUiLibrary, OPENUI_COMPONENTS } from '../library'
import { generateOpenUiPrompt, OPENUI_EXAMPLE_PROGRAMS, OPENUI_SIGNATURES } from '../prompt'

// The core crate embeds this file with include_str!; it must match the
// prompt written here. Rewrite it with UPDATE_OPENUI_PROMPT=1.
const CORE_PROMPT_PATH = path.resolve(
  __dirname,
  '../../../../../chatshell-agent/crates/chatshell-agent-core/src/visual_output/openui_prompt.txt'
)

/** `Name(a, b, c?)` from a component's zod schema, in argument order. */
function signatureOf(component: (typeof OPENUI_COMPONENTS)[number]): string {
  const shape = component.props.shape as Record<
    string,
    { safeParse(v: unknown): { success: boolean } }
  >
  const args = Object.entries(shape).map(([name, schema]) =>
    schema.safeParse(undefined).success ? `${name}?` : name
  )
  return `${component.name}(${args.join(', ')})`
}

describe('OpenUI prompt', () => {
  const prompt = generateOpenUiPrompt()

  it('matches the copy committed in chatshell-agent-core', () => {
    if (process.env.UPDATE_OPENUI_PROMPT === '1') {
      writeFileSync(CORE_PROMPT_PATH, prompt)
    }
    expect(existsSync(CORE_PROMPT_PATH)).toBe(true)
    expect(readFileSync(CORE_PROMPT_PATH, 'utf8')).toBe(prompt)
  })

  it('is deterministic and ASCII', () => {
    expect(generateOpenUiPrompt()).toBe(prompt)
    expect([...prompt].every((char) => char.charCodeAt(0) < 128)).toBe(true)
  })

  it('stays within its token budget', () => {
    // About 4 characters per token.
    expect(prompt.length).toBeLessThan(3_000)
  })

  it('teaches every component with the signature the library parses', () => {
    expect(OPENUI_SIGNATURES).toEqual(OPENUI_COMPONENTS.map(signatureOf))
    for (const signature of OPENUI_SIGNATURES) {
      expect(prompt).toContain(signature)
    }
  })

  it('names no component outside the library', () => {
    const known = new Set(Object.keys(chatShellOpenUiLibrary.components))
    const called = [...prompt.matchAll(/\b([A-Z][A-Za-z]+)\(/g)].map((match) => match[1])
    expect(called.filter((name) => !known.has(name))).toEqual([])
  })

  it('teaches static blocks only', () => {
    for (const dynamic of ['@', 'ActionExpression', 'Query(', 'Mutation(']) {
      expect(prompt).not.toContain(dynamic)
    }
    // No $state bindings; "$48.2k" in an example is a value, not a binding.
    expect(prompt).not.toMatch(/\$[A-Za-z_]/)
  })

  it('teaches the fenced form instead of whole-response OpenUI', () => {
    expect(prompt.startsWith('OpenUI blocks: a ```openui-lang fenced block')).toBe(true)
    expect(prompt).not.toContain('ENTIRE response')
  })

  it.each(OPENUI_EXAMPLE_PROGRAMS)('example parses without errors: %s', (program) => {
    const parser = createParser(chatShellOpenUiLibrary.toJSONSchema(), 'Chart')
    const result = parser.parse(program)
    expect(result.root).not.toBeNull()
    expect(result.meta.errors).toEqual([])
    expect(result.meta.unresolved).toEqual([])
    expect(result.meta.orphaned).toEqual([])
  })
})
