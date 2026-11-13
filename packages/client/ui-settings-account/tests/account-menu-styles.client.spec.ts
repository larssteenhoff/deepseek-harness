/** Account-owned sidebar spacing and total control heights. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/AccountMenu.module.css', import.meta.url), 'utf8')

it('lets the launcher root fill the footer without a fixed inset', () => {
  expect(css).toMatch(/\.root\s*\{[^}]*flex: 1;[^}]*min-width: 0;/)
  expect(css).not.toMatch(/data-inset/)
})

it('includes padding and borders in the 32px Settings row and the 36px collapsed button', () => {
  const trigger = css.match(/\.trigger\s*\{([^}]+)\}/)?.[1]
  expect(trigger).toContain('box-sizing: border-box;')
  expect(css).toMatch(/\.trigger\[data-row='true'\]:not\(\[data-collapsed='true'\]\)\s*\{[^}]*height: 32px;/)
  expect(css).toMatch(/\.trigger\[data-collapsed='true'\]\s*\{[^}]*width: 36px;[^}]*height: 36px;/)
})
