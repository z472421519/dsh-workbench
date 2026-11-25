/**
 * Stylesheet tests for `dsh-high-level`.
 *
 * The tint cannot be checked visually from here — no renderer is started — so
 * this file asserts the stylesheet *text*: that the card is tinted through the
 * theme's business accent rather than a baked-in blue, that the tint stays a
 * token mix in both palettes, and that the failure state opts out so an error
 * card never reads as a finished summary.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../dsh-high-level/client.js', import.meta.url))
const source = readFileSync(CLIENT_PATH, 'utf8')

/**
 * Load the browser half and return its plugin object (with the test seam).
 * @returns the plugin the loader registered.
 */
function loadPlugin() {
  const registered = []
  const window = { __ModuleLoader__: { load(registration) { registered.push(registration) } } }
  globalThis.window = window
  globalThis.__DSH_HIGH_LEVEL_TEST__ = true
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [initial, () => undefined],
    useEffect: () => undefined,
    useRef: (initial) => ({ current: initial }),
    Fragment: 'fragment',
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'module', 'exports', source)(window, { exports: {} }, {})
    return registered[0].factory((name) => {
      if (name === 'react') return react
      throw new Error(`unexpected bare import: ${name}`)
    })
  } finally {
    globalThis.__DSH_HIGH_LEVEL_TEST__ = false
  }
}

const plugin = loadPlugin()
const css = plugin.testing.CSS

/**
 * The declaration block of one rule.
 * @param selector - a CSS selector as written in the stylesheet, e.g. `.dshHl_card`.
 * @returns the text between that selector's braces.
 */
function ruleOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\{([^}]*)\\}`))
  assert.ok(match !== null, `missing rule ${selector}`)
  return match[1]
}

// ---------------------------------------------------------------------------
// The card is tinted by the harness accent, not by a literal blue.
// ---------------------------------------------------------------------------

test('the card derives its fill from the business accent token', () => {
  const card = ruleOf('.dshHl_card')
  assert.match(card, /--dshHl-tint:var\(--dshHl-accent,var\(--dsw-alias-state-business-primary\)\)/)
  assert.match(card, /background:var\(--dshHl-surface\)/)
  assert.match(card, /color-mix\(in srgb, ?var\(--dshHl-tint\) \d+%/, 'the fill is a mix of the accent')
})

test('the tint mixes into the theme code-block token so both palettes resolve', () => {
  // Mixing into a surface token rather than into `transparent` keeps the card
  // opaque: a translucent tint would pick up whatever scrolls behind it.
  const card = ruleOf('.dshHl_card')
  assert.match(card, /var\(--dsw-alias-markdown-code-block\)/, 'the mix base is a theme surface token')
  assert.ok(!/transparent\)/.test(card.split('--dshHl-edge')[0]), 'the fill itself is not translucent')
})

test('the tint weight stays readable, not a saturated banner', () => {
  const card = ruleOf('.dshHl_card')
  const percent = Number(card.match(/--dshHl-surface:color-mix\(in srgb, ?var\(--dshHl-tint\) (\d+)%/)[1])
  // Light mode at 9% keeps the small secondary header at 4.99:1 on the fill;
  // darker than ~20% would fight the blue-tinted body text that sits on it.
  assert.ok(percent >= 4 && percent <= 14, `tint weight ${percent}% is outside the readable band`)
})

test('the headline rule uses the same accent as the fill', () => {
  const badge = ruleOf('.dshHl_badge')
  assert.match(badge, /background:var\(--dshHl-tint\)/, 'the marker tracks the tint')
})

// ---------------------------------------------------------------------------
// Failure keeps the neutral surface.
// ---------------------------------------------------------------------------

test('an error card drops the tint and its accent border', () => {
  const error = ruleOf('.dshHl_card[data-error]')
  assert.match(error, /--dshHl-surface:var\(--dsw-alias-markdown-code-block\)/)
  assert.match(error, /--dshHl-edge:var\(--dsw-alias-border-l1\)/)
})

test('the card element is the one that carries data-error', () => {
  // The rule above only applies if the rendered card actually gets the flag.
  assert.match(source, /className: 'dshHl_card', 'data-error': failed \? '' : undefined/)
})

// ---------------------------------------------------------------------------
// No literal colors: the tint must follow light/dark and any theme override.
// ---------------------------------------------------------------------------

test('the stylesheet names no static palette step or literal color', () => {
  assert.ok(!css.includes('--dsw-static-'), 'CSS must not name a --dsw-static-* step')
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'CSS must not contain a literal hex color')
  assert.ok(!/\brgba?\(/.test(css), 'CSS must not contain a literal rgb()/rgba() color')
})
