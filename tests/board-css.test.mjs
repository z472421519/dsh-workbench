/**
 * Stylesheet tests for `dsh-agent-board`.
 *
 * The rules under test cannot be verified visually from here — no renderer is
 * started — so this file asserts the stylesheet *text*: that the five classes
 * the board's markup depends on exist, that the ones that prevent layout
 * breakage carry their required declarations, and that every color resolves
 * through a theme token rather than a baked-in palette step where one exists.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../dsh-agent-board/client.js', import.meta.url))
const source = readFileSync(CLIENT_PATH, 'utf8')

/**
 * Load the bundle and return its plugin + stylesheet.
 *
 * Same capture stub as the sectioning tests: `window.__ModuleLoader__.load`
 * records the registration, the factory is called with a React stand-in, and
 * the test seam exposes `CSS`.
 * @returns the plugin object and the stylesheet text.
 */
function loadBoard() {
  const registered = []
  const window = { __ModuleLoader__: { load(registration) { registered.push(registration) } } }
  globalThis.window = window
  globalThis.__DSH_AGENT_BOARD_TEST__ = true
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [initial, () => undefined],
    useMemo: (factory) => factory(),
    useEffect: () => undefined,
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'module', 'exports', source)(window, { exports: {} }, {})
    const plugin = registered[0].factory((name) => {
      if (name === 'react') return react
      throw new Error(`unexpected bare import: ${name}`)
    })
    return { plugin, css: plugin.testing.CSS }
  } finally {
    globalThis.__DSH_AGENT_BOARD_TEST__ = false
  }
}

const { css } = loadBoard()

/**
 * The declaration block of one class rule.
 * @param selector - class name without the leading dot, e.g. `dshAb_name`.
 * @returns the text between that selector's braces.
 */
function ruleOf(selector) {
  const match = css.match(new RegExp(`\\.${selector}\\{([^}]*)\\}`))
  assert.ok(match !== null, `missing rule .${selector}`)
  return match[1]
}

// ---------------------------------------------------------------------------
// The classes the markup emits must all be styled.
// ---------------------------------------------------------------------------

test('the stylesheet defines every class the board renders', () => {
  for (const selector of [
    'dshAb_root', 'dshAb_scroll', 'dshAb_section', 'dshAb_head', 'dshAb_chevron',
    'dshAb_headCount', 'dshAb_row', 'dshAb_glyph', 'dshAb_name', 'dshAb_time',
    'dshAb_tag', 'dshAb_empty', 'dshAb_rail', 'dshAb_railDot',
  ]) {
    assert.match(css, new RegExp(`\\.${selector}\\{`), `missing .${selector}`)
  }
})

test('every class the component emits has a matching rule', () => {
  // Guards against a rule being dropped in a later edit: pull the class names
  // out of the rendered tree and require a rule for each of them.
  const emitted = new Set()
  for (const match of source.matchAll(/className: '([^']+)'/g)) {
    for (const name of match[1].split(/\s+/)) if (name !== '') emitted.add(name)
  }
  assert.ok(emitted.has('dshAb_name'), 'the row still emits a title span')
  for (const name of emitted) {
    assert.match(css, new RegExp(`\\.${name}\\{`), `rendered class .${name} has no rule`)
  }
})

// ---------------------------------------------------------------------------
// The declarations that stop the row from breaking.
// ---------------------------------------------------------------------------

test('.dshAb_name shrinks and ellipsises instead of widening the row', () => {
  const body = ruleOf('dshAb_name')
  assert.match(body, /flex:1 1 auto/, 'the title must be the flexible part')
  assert.match(body, /min-width:0/, 'a flex item needs min-width:0 to shrink below content')
  assert.match(body, /overflow:hidden/)
  assert.match(body, /text-overflow:ellipsis/)
  assert.match(body, /white-space:nowrap/)
})

test('.dshAb_time is fixed-width and tabular', () => {
  const body = ruleOf('dshAb_time')
  assert.match(body, /flex:none/, 'the age must not shrink or grow')
  assert.match(body, /font-variant-numeric:tabular-nums/, 'ages must align in a column')
  assert.match(body, /color:var\(--dsw-alias-label-/, 'the age uses a theme label step')
})

test('.dshAb_empty has padding and a tertiary label color', () => {
  const body = ruleOf('dshAb_empty')
  assert.match(body, /padding:/)
  assert.match(body, /color:var\(--dsw-alias-label-tertiary\)/)
})

test('.dshAb_rail and .dshAb_railDot give the collapsed marker a real box', () => {
  const rail = ruleOf('dshAb_rail')
  assert.match(rail, /display:flex/)
  const dot = ruleOf('dshAb_railDot')
  // A dot with no width/height paints nothing at all, which is how the
  // collapsed rail silently disappeared.
  const width = dot.match(/width:(\d+)px/)
  const height = dot.match(/height:(\d+)px/)
  assert.ok(width !== null, '.dshAb_railDot needs an explicit width')
  assert.ok(height !== null, '.dshAb_railDot needs an explicit height')
  assert.ok(Number(width[1]) >= 6 && Number(width[1]) <= 12, `dot width ${width[1]}px is out of range`)
  assert.ok(Number(height[1]) >= 6 && Number(height[1]) <= 12, `dot height ${height[1]}px is out of range`)
})

// ---------------------------------------------------------------------------
// Theme tokens only.
// ---------------------------------------------------------------------------

test('the stylesheet uses no static palette steps', () => {
  // Static steps pin one theme; aliases follow light/dark and brand overrides.
  assert.ok(!css.includes('--dsw-static-'), 'CSS must not name a --dsw-static-* step')
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'CSS must not contain a literal hex color')
  assert.ok(!/\brgba?\(/.test(css), 'CSS must not contain a literal rgb()/rgba() color')
})

test('every color declaration in the stylesheet resolves through a token', () => {
  for (const match of css.matchAll(/(?:^|[;{])(?:background|color|border-color):([^;}]*)/g)) {
    const value = match[1].trim()
    assert.ok(
      value.startsWith('var(--') || value === 'transparent' || value === 'currentColor',
      `unexpected color value: ${value}`,
    )
  }
})

// ---------------------------------------------------------------------------
// The agentbar row structure: dark strip, full-height state rail, big icon,
// monospace tag, larger white title. Asserted as *rules*, not as pixels —
// nothing here starts a renderer, so this proves the shape was written, never
// that it looks right.
// ---------------------------------------------------------------------------

test('.dshAb_row is one dark strip with a near-square corner', () => {
  const body = ruleOf('dshAb_row')
  assert.match(
    body,
    /background:var\(--dsw-alias-bg-layer-1\)/,
    'the row needs a dark theme layer fill, not a transparent background',
  )
  assert.match(body, /border-radius:2px/, 'the reference wants little or no rounding')
  // 48–56px per the reference (190px for two rows at 2x).
  const minHeight = body.match(/min-height:(\d+)px/)
  assert.ok(minHeight !== null, 'the row needs a min-height')
  assert.ok(
    Number(minHeight[1]) >= 48 && Number(minHeight[1]) <= 56,
    `row min-height ${minHeight[1]}px is outside the 48–56px range`,
  )
})

test('.dshAb_row is separated by a 1px rule, not by a gap', () => {
  const body = ruleOf('dshAb_row')
  assert.match(
    body,
    /border-bottom:1px solid var\(--dsw-alias-border-l1\)/,
    'rows must be divided by a hairline border in a theme token',
  )
  // A column gap would let the sidebar background show between rows and break
  // the single dark strip the reference draws.
  const section = ruleOf('dshAb_section')
  assert.ok(!/gap:/.test(section), 'the section must not introduce a gap between rows')
})

test('.dshAb_row::after is a 4px rail spanning the full row height', () => {
  const body = ruleOf('dshAb_row::after')
  const width = body.match(/width:(\d+)px/)
  assert.ok(width !== null, 'the rail needs an explicit width')
  assert.ok(Number(width[1]) >= 3 && Number(width[1]) <= 4, `rail width ${width[1]}px is outside 3–4px`)
  assert.match(body, /top:0/, 'the rail must start at the row top')
  assert.match(body, /bottom:0/, 'the rail must reach the row bottom')
  assert.match(body, /left:0/, 'the rail must sit flush against the left edge')
  assert.match(body, /background:var\(--dshAb-tint\)/, 'the rail carries the per-state color')
})

test('.dshAb_row::before is the hover overlay, not the row fill', () => {
  // The fill is a flat alias on the row itself; emphasis rides an overlay so the
  // strip never changes hue between states.
  const body = ruleOf('dshAb_row::before')
  assert.match(body, /background:var\(--dsw-alias-interactive-bg-hover\)/)
  assert.match(body, /opacity:0/, 'the overlay is hidden until hover or current')
})

test('.dshAb_glyph is an 18–20px icon box', () => {
  const body = ruleOf('dshAb_glyph')
  const width = body.match(/width:(\d+)px/)
  const height = body.match(/height:(\d+)px/)
  assert.ok(width !== null && height !== null, 'the glyph needs an explicit box')
  assert.ok(Number(width[1]) >= 18 && Number(width[1]) <= 20, `glyph width ${width[1]}px is outside 18–20px`)
  assert.ok(Number(height[1]) >= 18 && Number(height[1]) <= 20, `glyph height ${height[1]}px is outside 18–20px`)
})

test('.dshAb_name is a large primary-color title', () => {
  const body = ruleOf('dshAb_name')
  const size = body.match(/font-size:(\d+)px/)
  assert.ok(size !== null, 'the title needs an explicit size')
  assert.ok(Number(size[1]) >= 15 && Number(size[1]) <= 16, `title size ${size[1]}px is outside 15–16px`)
  assert.match(body, /color:var\(--dsw-alias-label-primary\)/, 'the title uses the primary label color')
})

test('.dshAb_tag is monospace, small, and uppercasing', () => {
  const body = ruleOf('dshAb_tag')
  assert.match(body, /font-family:var\(--ds-font-family-code\)/, 'the tag must be a code font')
  assert.match(body, /text-transform:uppercase/, 'the tag renders uppercase')
  assert.match(body, /color:var\(--dsw-alias-/, 'the tag color comes from a theme alias')
  assert.match(body, /flex:none/, 'the tag must not shrink the title out of its column')
})

test('the state rail and icon keep using the live COLORS mapping', () => {
  // Both are fed from the same per-state token, so a new state cannot pick up a
  // hard-coded color on one surface and a token on the other.
  assert.match(source, /'--dshAb-tint': COLORS\[row\.state\] \?\? COLORS\.idle/)
  const glyph = source.slice(source.indexOf('function Glyph'))
  assert.match(glyph, /color: COLORS\[state\] \?\? COLORS\.idle/, 'the glyph keeps its state color')
})

test('the tag is derived from the Session cwd, never invented per state', () => {
  // `TAG_FOR` (a state-to-letters table) would have been a fabrication: the
  // reference's "CX" is the agent type, which DSH does not project onto a list
  // row. The tag reads the row's real cwd instead.
  assert.ok(!source.includes('TAG_FOR'), 'no state-to-tag lookup table')
  assert.match(source, /function tagOf\(cwd\)/)
  assert.match(source, /tag: tagOf\(summary\.cwd\)/)
})

test('a row without a cwd renders no tag rather than a placeholder', () => {
  const render = source.slice(source.indexOf("row.tag === ''"), source.indexOf("className: 'dshAb_name'"))
  assert.match(render, /row\.tag === '' \? null/, 'an unknown tag omits the element')
})

test('the reduced-motion rule still covers the pulse and the chevron', () => {
  // The block holds two rules, so match to the end of the block rather than to
  // the first closing brace.
  const reduced = css.match(/@media \(prefers-reduced-motion:reduce\)\{.*?\}\}/)
  assert.ok(reduced !== null, 'the reduced-motion block must survive')
  assert.match(reduced[0], /\.dshAb_pulse\{animation:none\}/, 'the pulse is disabled under reduced motion')
  assert.match(reduced[0], /\.dshAb_chevron\{transition:none\}/)
})

test('the collapsed rail is not widened by the row restyle', () => {
  // The rail renders dots, never rows; the row's 48px height must not leak into
  // the 56px collapsed column.
  const rail = ruleOf('dshAb_rail')
  assert.match(rail, /flex-direction:column/)
  assert.match(rail, /padding:10px 0/)
})

test('the sleep threshold constant and section list are untouched by the restyle', () => {
  assert.match(source, /SLEEP_AFTER_MS = 12 \* 60 \* 60 \* 1000/)
  assert.match(source, /const SECTIONS = \['attention', 'running', 'recent', 'sleeping'\]/)
})

test('the board keeps its 12-hour sleep threshold and its four sections', () => {
  assert.match(source, /SLEEP_AFTER_MS = 12 \* 60 \* 60 \* 1000/)
  assert.match(source, /const SECTIONS = \['attention', 'running', 'recent', 'sleeping'\]/)
})
