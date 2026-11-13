import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = (name: string): string => readFileSync(fileURLToPath(new URL(`../src/client/skeleton/${name}`, import.meta.url)), 'utf8')

describe('composer and hero visibility styles', () => {
  it('lets the empty-draft send arrow honor its hidden attribute despite the primary grid display', () => {
    expect(styles('InputBar.module.css')).toMatch(/\.sendPrimary\[hidden\]\s*\{\s*display:\s*none\s*;/u)
  })

  it('hides the blank-session hero identity block', () => {
    expect(styles('HeroShell.module.css')).toMatch(/\.headline\s*\{[^}]*display:\s*none\s*;/su)
  })
})
