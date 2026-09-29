import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/Switch.module.css', import.meta.url)), 'utf8')

describe('Switch.module.css', () => {
  it('colors an enabled switch thumb with the theme business blue', () => {
    expect(css).toMatch(/\.switch\[aria-checked='true'\]\s+\.thumb\s*\{[^}]*background:\s*var\(--dsw-alias-state-business-primary\)/su)
  })
})
