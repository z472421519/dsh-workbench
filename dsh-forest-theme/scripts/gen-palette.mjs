/**
 * Project the forest palette onto DSH alias tokens.
 *
 * Source of truth is the user's own pi theme generator,
 * `~/Work/agent/pi-forest-theme/lib/palette.mjs`, plus its `forest-tuning.json`.
 * pi speaks pi's token vocabulary and DSH speaks `--dsw-*`; this script owns the
 * mapping, resolves both palettes through the pi generator, and writes
 *
 *   src/palette.js  the readable token record and the mapping table
 *   client.js       the shipped Client module with both records inlined
 *
 * Run `npm run gen` after changing the tuning or the mapping.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { okhsl } from 'okhsl'

const here = dirname(fileURLToPath(import.meta.url))
const packageDir = join(here, '..')

/**
 * Where the pi forest theme lives. Override with `PI_FOREST_DIR` when the
 * checkout sits elsewhere; the script refuses to guess, because a wrong
 * directory would silently regenerate a different palette.
 */
const piThemeDir = resolve(process.env.PI_FOREST_DIR ?? join(process.env.HOME ?? '', 'Work/agent/pi-forest-theme'))
if (!existsSync(join(piThemeDir, 'lib/palette.mjs'))) {
  throw new Error(`pi forest theme not found at ${piThemeDir}; set PI_FOREST_DIR to its directory`)
}

const { buildThemeJson, resolveThemeColors, normalizeTuning } = await import(join(piThemeDir, 'lib/palette.mjs'))
const tuning = normalizeTuning(JSON.parse(readFileSync(join(piThemeDir, 'forest-tuning.json'), 'utf8')))

/** pi's `okhsl(h s% l%)` string as a hex color. */
function toHex(value) {
  const match = /okhsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)/u.exec(value)
  return match === null ? value : `#${okhsl(Number(match[1]), Number(match[2]), Number(match[3]))}`
}

/** One appearance's complete, reference-free forest colors. */
function forestColors(appearance) {
  const theme = buildThemeJson(appearance, tuning)
  const colors = {}
  for (const [token, value] of Object.entries(resolveThemeColors(theme).resolved)) colors[token] = toHex(value)
  colors.pageBg = toHex(theme.export.pageBg)
  colors.cardBg = toHex(theme.export.cardBg)
  return colors
}

/**
 * Forest role → DSH alias tokens.
 *
 * Every row names the DSH surface on the left and the forest role it should
 * read as on the right. Tunings carry over automatically; only a new DSH
 * surface or a new forest role needs a row here.
 *
 * Deliberately not mapped: `--dsw-static-*` (the raw scale the aliases resolve
 * from — overriding those would recolour every consumer at once), and the
 * overlay masks (`--dsw-alias-bg-mask-*`), which are dark by design in both
 * schemes and would turn into white veils if derived from the forest text
 * role. The toolbar button fills are scheme-neutral greys and also stay stock.
 */
const MAP = [
  // Canvas and raised surfaces.
  ['--dsw-alias-bg-base', 'pageBg'],
  ['--dsw-alias-bg-document-selection', 'selectedBg'],

  // Text.
  ['--dsw-alias-label-primary', 'text'],
  ['--dsw-alias-label-secondary', 'muted'],
  ['--dsw-alias-label-tertiary', 'tertiary'],
  ['--dsw-alias-label-caption', 'tertiary'],
  ['--dsw-alias-label-dimmed', 'borderMuted'],
  ['--dsw-alias-label-primary-dimmed', 'text'],
  ['--dsw-alias-label-primary-bluish', 'text'],
  ['--dsw-alias-label-primary-inverted', 'pageBg'],
  ['--dsw-alias-label-primary-foreground', 'pageBg'],
  ['--dsw-alias-label-document-preview', 'muted'],
  ['--dsw-alias-label-on-color', 'pageBg'],
  ['--dsw-alias-menu-icon', 'muted'],
  ['--dsw-alias-markdown-placeholder', 'tertiary'],

  // Borders.
  ['--dsw-alias-border-selected', 'border'],

  // Brand, links, interactive states.
  ['--dsw-alias-brand-primary', 'accent'],
  ['--dsw-alias-brand-primary-new-colorprimary-new-color', 'accent'],
  ['--dsw-alias-brand-text', 'text'],
  ['--dsw-alias-button-primary-fill', 'accent'],
  ['--dsw-alias-button-primary-hover', 'border'],
  ['--dsw-alias-button-primary-dimmed', 'selectedBg'],
  ['--dsw-alias-button-info-fill', 'customMessageLabel'],
  ['--dsw-alias-button-info-hover', 'success'],
  ['--dsw-alias-state-business-primary', 'customMessageLabel'],
  ['--dsw-alias-state-business-tertiary', 'customMessageBg'],
  ['--dsw-alias-link', 'mdLink'],
  ['--dsw-alias-trajectory-accent', 'accent'],
  ['--dsw-alias-interactive-bg-hover', 'toolPendingBg'],
  ['--dsw-alias-interactive-bg-hover-solid', 'selectedBg'],
  ['--dsw-alias-interactive-bg-hover-accent', 'userMessageBg'],
  ['--dsw-alias-interactive-bg-active', 'selectedBg'],

  // Semantic states.
  ['--dsw-alias-state-success-primary', 'success'],
  ['--dsw-alias-state-success-secondary', 'success'],
  ['--dsw-alias-state-success-tertiary', 'toolSuccessBg'],
  ['--dsw-alias-state-error-primary', 'error'],
  ['--dsw-alias-state-error-secondary', 'toolErrorBg'],
  ['--dsw-alias-state-warn-primary', 'warning'],
  ['--dsw-alias-state-warn-secondary', 'warning'],
  ['--dsw-alias-state-idle-primary', 'thinkingOff'],
  ['--dsw-alias-state-done-primary', 'thinkingXhigh'],

  // Sidebar and composer.
  ['--dsw-specific-sidebar-nav-item-active-accent', 'accent'],
  ['--dsw-specific-sidebar-right-flash', 'thinkingMedium'],
  ['--dsw-specific-guide-hero', 'toolSuccessBg'],
  ['--dsw-specific-file-upload-track', 'toolSuccessBg'],

  // Markdown and code.
  ['--dsw-alias-markdown-code-segment-selected', 'cardBg'],
  ['--dsw-alias-markdown-code-segment-unselected', 'toolSuccessBg'],
  ['--dsw-alias-markdown-tag', 'toolPendingBg'],
  ['--dsw-alias-markdown-citation', 'toolSuccessBg'],

  // Menus, tooltips, toasts, hovercards.
  ['--dsw-alias-hovercard-state-done', 'thinkingXhigh'],
  ['--dsw-alias-hovercard-state-error', 'error'],

  // Scrollbars.
  ['--dsw-alias-scrollbar-bg-l1', 'scrollbarTrack'],
  ['--dsw-alias-scrollbar-bg-l2', 'scrollbarTrack'],
  ['--dsw-alias-scrollbar-hover-l1', 'scrollbarThumb'],
  ['--dsw-alias-scrollbar-hover-l2', 'scrollbarThumb'],

  // Diffs.
  ['--dsw-alias-file-diff-added-bg', 'toolSuccessBg'],
  ['--dsw-alias-file-diff-added-gutter', 'toolSuccessBg'],
  ['--dsw-alias-file-diff-added-marker', 'success'],
  ['--dsw-alias-file-diff-deleted-bg', 'toolErrorBg'],
  ['--dsw-alias-file-diff-deleted-gutter', 'toolErrorBg'],
  ['--dsw-alias-file-diff-deleted-marker', 'error'],


  // Neutral chrome: surfaces that must follow the palette's own greys rather
  // than keep the stock bluish ramp, plus masks that stay translucent.
  ['--dsw-alias-button-elevated-fill', 'cardBg'],
  ['--dsw-alias-button-floating-fill', 'cardBg'],
  ['--dsw-alias-button-floating-hover', 'toolPendingBg'],
  ['--dsw-alias-button-ghost-active-fill', 'selectedBg'],
  ['--dsw-alias-button-ghost-active-hover', 'userMessageBg'],
  ['--dsw-alias-button-ghost-active-border', 'borderMuted'],
  ['--dsw-alias-button-contrast-fill', 'muted'],
  ['--dsw-alias-brand-primary-invert', 'text'],
  ['--dsw-alias-illustration-inset', 'toolSuccessBg'],
  ['--dsw-alias-illustration-shadow', 'toolPendingBg'],
  ['--dsw-alias-json-tree-hover', 'toolPendingBg'],
  ['--dsw-alias-json-tree-icon', 'muted'],
  ['--dsw-alias-json-tree-keyword', 'mdLink'],
  ['--dsw-alias-json-tree-number', 'syntaxNumber'],
  ['--dsw-alias-json-tree-property', 'syntaxVariable'],
  ['--dsw-alias-json-tree-punctuation', 'text'],
  ['--dsw-alias-json-tree-string', 'syntaxString'],

  // Charts and meters.
  ['--dsw-alias-chart-messages', 'mdLink'],
  ['--dsw-alias-chart-system', 'thinkingLow'],
  ['--dsw-alias-chart-tools', 'thinkingHigh'],

  // Misc chrome.
  ['--dsw-alias-switch-thumb', 'text'],
  ['--dsw-alias-label-shimmer', 'dim'],
  ['--dsw-alias-illustration-background', 'toolPendingBg'],
  ['--dsw-alias-illustration-surface', 'toolSuccessBg'],
  ['--dsw-alias-illustration-backing', 'borderMuted'],
  ['--dsw-alias-illustration-detail', 'borderMuted'],
]

/** One scheme's `{ token: value }` record, failing loudly on an unmapped role. */
function project(colors) {
  const tokens = {}
  for (const [dshToken, forestToken] of MAP) {
    const value = colors[forestToken]
    if (value === undefined) throw new Error(`forest palette has no "${forestToken}" (mapped to ${dshToken})`)
    tokens[dshToken] = value
  }
  return tokens
}

/** `#rrggbb` plus an alpha channel, as `rgba()`. */
function alpha(hex, a) {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/**
 * Derived tokens whose value is a function of the palette rather than a copy of
 * one role: the macOS sidebar's vibrancy tint, glass and wash layers, and the
 * hover tint for destructive actions. Each receives the scheme's forest colors
 * and its appearance name, because several DSH alphas differ per scheme.
 */
const DERIVED = [
  // macOS sidebar glass. The tint composes over the fill this layer already set;
  // the washes carry the palette hue so a green sidebar gets a green sheen
  // instead of the stock blue-violet one.
  ['--dsw-specific-sidebar-tint', (c, s) => `color-mix(in srgb, var(--dsw-specific-sidebar-fill) ${s === 'light' ? 40 : 50}%, transparent)`],
  ['--dsw-specific-sidebar-wash-top', c => alpha(c.accent, 0.10)],
  ['--dsw-specific-sidebar-wash-top-clear', c => alpha(c.accent, 0)],
  ['--dsw-specific-sidebar-wash-bottom', c => alpha(c.mdLink, 0.09)],
  ['--dsw-specific-sidebar-wash-bottom-clear', c => alpha(c.mdLink, 0)],
  ['--dsw-specific-sidebar-glass-fill', (c, s) => s === 'light' ? 'rgb(255 255 255 / 0.55)' : 'rgb(255 255 255 / 0.15)'],
  ['--dsw-specific-sidebar-glass-hover', (c, s) => s === 'light' ? 'rgb(255 255 255 / 0.3)' : 'rgb(255 255 255 / 0.2)'],
  ['--dsw-specific-sidebar-glass-collapsed-fill', () => 'transparent'],
  ['--dsw-specific-sidebar-glass-collapsed-hover', (c, s) => alpha(c.text, s === 'light' ? 0.06 : 0.10)],

  // Hover tint for destructive actions and the deep-diving activity label.
  ['--dsw-alias-interactive-bg-hover-danger', c => alpha(c.error, 0.06)],
  ['--dsw-alias-label-deep-diving', c => c.mdLink],
  ['--dsw-alias-label-deep-diving-shimmer', c => alpha(c.mdLink, 0.3)],
]

/**
 * Tokens DSH declares as translucent layers rather than solid colours: borders,
 * the skeleton shimmer, and the dark tooltip/toast/hovercard surfaces.
 *
 * These keep DSH's own alpha ramp and take only the palette hue, because a
 * solid forest tone would erase the hierarchy the ramp encodes — four identical
 * opaque greys lose "l1 is the faintest, l4 the strongest", and the dark
 * tooltip family must stay darker than the surfaces it floats over.
 */
const VEILS = [
  ['--dsw-alias-border-l1', (c, s) => alpha(c.text, s === 'light' ? 0.04 : 0.06)],
  ['--dsw-alias-border-l2', (c, s) => alpha(c.text, s === 'light' ? 0.10 : 0.12)],
  ['--dsw-alias-border-l2-darkmode-thin', (c, s) => alpha(c.text, s === 'light' ? 0.10 : 0.12)],
  ['--dsw-alias-border-l3', (c, s) => alpha(c.text, s === 'light' ? 0.12 : 0.16)],
  ['--dsw-alias-border-l4', (c, s) => alpha(c.text, s === 'light' ? 0.16 : 0.20)],
  ['--dsw-alias-bg-skeleton', (c, s) => alpha(c.text, s === 'light' ? 0.04 : 0.08)],
  // Tooltip, toast and hovercard are dark "ink" surfaces in both schemes (DSH
  // stock does the same), so they take the forest dark card and the forest
  // light text regardless of the active palette; a light tooltip in light mode
  // would read as a normal card instead of an overlay.
  ['--dsw-alias-tooltip-bg', (c, s) => s === 'light' ? INK.bg : alpha(c.pageBg, 0.96)],
  ['--dsw-alias-toast-bg', (c, s) => s === 'light' ? INK.bg : alpha(c.pageBg, 0.96)],
  ['--dsw-alias-hovercard-bg', (c, s) => s === 'light' ? INK.bg : alpha(c.pageBg, 0.96)],
  ['--dsw-alias-tooltip-key-bg', () => 'color-mix(in srgb, var(--dsw-alias-tooltip-bg), white 18%)'],

  // The warn label must out-read the wash beneath it: stock reaches 5.27 with a
  // dark amber on amber-100, which a single mid-tone amber cannot do.
  ['--dsw-alias-state-warn-label', (c, s) => s === 'light' ? INK.warnLabelLight : c.warning],

  // Warning banners paint this as a BACKGROUND and the warn label on top of it,
  // so it has to stay a faint wash; an opaque forest amber made the two identical.
  ['--dsw-alias-state-warn-tertiary', (c, s) => alpha(c.warning, s === 'light' ? 0.12 : 0.20)],

  // Diff rows paint their own `success`/`error` text over these, and DSH stock
  // uses the 8% alpha steps for the same reason: an opaque fill erased the text.
  ['--dsw-alias-code-diff-added', (c, s) => alpha(c.toolDiffAdded, s === 'light' ? 0.08 : 0.16)],
  ['--dsw-alias-code-diff-deleted', (c, s) => alpha(c.toolDiffRemoved, s === 'light' ? 0.08 : 0.18)],

  // The toast action sits on the dark ink surface, so it takes the ink's own
  // link step rather than the page-level `mdLink`, which is far too dark there.
  ['--dsw-alias-toast-action', (c, s) => s === 'light' ? INK.link : c.mdLink],

  // The overlay family's own text: dark ink surface, light label, in both schemes.
  ['--dsw-alias-tooltip-label', () => INK.label],
  ['--dsw-alias-toast-label', () => INK.label],
  ['--dsw-alias-hovercard-label-primary', () => INK.label],
  ['--dsw-alias-hovercard-label-secondary', () => INK.muted],
  ['--dsw-alias-hovercard-label-tertiary', () => INK.tertiary],
]


/**
 * Wallpaper mode.
 *
 * When a wallpaper sits behind the app (`z-index: -1` on the window), the canvas
 * must stop painting a solid colour and the raised surfaces must become glass,
 * or the wallpaper is invisible. DSH needs two things at once for that:
 *
 *   1. `--dsw-alias-bg-base: transparent`, so `body` and the app frame stop
 *      painting; without it nothing behind them shows.
 *   2. A colour somewhere behind, so the UI is not a bare Electron window when
 *      no wallpaper is installed. The client module paints that on `<html>`.
 *
 * Surface alphas follow `dsh-wallpaper-bg`'s measured values rather than fresh
 * guesses: it solved the same problem against this same token set.
 */
const GLASS = {
  light: {
    layer1: 'rgba(249, 249, 249, 0.68)',
    layer2: 'rgba(233, 236, 233, 0.74)',
    sidebar: 'rgba(233, 236, 233, 0.62)',
    menu: 'rgba(249, 249, 249, 0.92)',
    // The composer is the one surface the user types into; a neutral white
    // glass reads as a blank sheet against the forest panels. This takes the
    // palette's own light green (the role `selectedBg`/`userMessageBg` use in
    // pi) instead, so the input belongs to the theme.
    input: 'rgba(221, 233, 221, 0.90)',
    card: 'rgba(249, 249, 249, 0.74)',
    code: 'rgba(233, 236, 233, 0.78)',
    bubble: 'rgba(221, 233, 223, 0.82)',
  },
  dark: {
    layer1: 'rgba(37, 43, 38, 0.62)',
    layer2: 'rgba(49, 55, 49, 0.68)',
    sidebar: 'rgba(49, 55, 49, 0.56)',
    menu: 'rgba(37, 43, 38, 0.92)',
    input: 'rgba(32, 46, 35, 0.90)',
    card: 'rgba(37, 43, 38, 0.68)',
    code: 'rgba(49, 55, 49, 0.72)',
    bubble: 'rgba(34, 51, 38, 0.82)',
  },
}

/** Token → glass role, for wallpaper mode only. */
const GLASS_TOKENS = [
  ['--dsw-alias-bg-base', () => 'transparent'],
  ['--dsw-alias-bg-layer-1', (c, s) => GLASS[s].layer1],
  ['--dsw-alias-bg-layer-2', (c, s) => GLASS[s].layer2],
  ['--dsw-alias-bg-layer-3', (c, s) => GLASS[s].layer2],
  ['--dsw-alias-bg-overlay', (c, s) => GLASS[s].layer1],
  ['--dsw-alias-bg-module-platform', (c, s) => GLASS[s].layer2],
  ['--dsw-alias-bg-multi-select', (c, s) => GLASS[s].layer2],
  ['--dsw-alias-bg-document-preview', (c, s) => GLASS[s].layer2],
  ['--dsw-alias-card-fill', (c, s) => GLASS[s].card],
  ['--dsw-alias-card-fill-hover', (c, s) => GLASS[s].layer2],
  ['--dsw-alias-card-tile-fill', (c, s) => GLASS[s].card],
  ['--dsw-specific-sidebar-fill', (c, s) => GLASS[s].sidebar],
  ['--dsw-specific-menu', (c, s) => GLASS[s].menu],
  ['--dsw-menu-surface-fill', (c, s) => GLASS[s].menu],
  ['--dsw-alias-menu-group-header-fill', (c, s) => GLASS[s].layer2],
  ['--dsw-specific-input-major', (c, s) => GLASS[s].input],
  ['--dsw-specific-login-input', (c, s) => GLASS[s].input],
  ['--dsw-specific-bubble', (c, s) => GLASS[s].bubble],
  ['--dsw-specific-bubble-highlight', (c, s) => GLASS[s].bubble],
  ['--dsw-alias-markdown-code-block', (c, s) => GLASS[s].code],
  ['--dsw-alias-markdown-code-block-banner', (c, s) => GLASS[s].layer2],
  ['--dsw-alias-markdown-inline-code', (c, s) => GLASS[s].code],
  ['--dsw-alias-turn-trigger-bg', (c, s) => GLASS[s].code],
  ['--dsw-alias-turn-trigger-bg-hover', (c, s) => GLASS[s].layer2],
  ['--dsw-specific-selector', (c, s) => GLASS[s].layer2],
  ['--dsw-specific-tip', (c, s) => GLASS[s].card],
  ['--dsw-specific-sidebar-nav-item-active', (c, s) => GLASS[s].layer2],
  ['--dsw-alias-bg-skeleton', (c, s) => alpha(c.text, s === 'light' ? 0.06 : 0.10)],
]

/**
 * Solid mode (the default).
 *
 * Wallpaper mode cannot simply be "works whenever a wallpaper is installed":
 * the canvas token cannot detect one. Instead the solid palette keeps a dark
 * backdrop painted on `<html>` in the same way, so the two modes differ only in
 * whether the surfaces in front of it are opaque — the wallpaper, when present,
 * shows through the transparent canvas either way.
 */
const SOLID_TOKENS = [
  ['--dsw-alias-bg-base', () => 'transparent'],
  ['--dsw-alias-bg-layer-1', (c) => c.cardBg],
  ['--dsw-alias-bg-layer-2', (c) => c.toolPendingBg],
  ['--dsw-alias-bg-layer-3', (c) => c.toolSuccessBg],
  ['--dsw-alias-bg-overlay', (c) => c.cardBg],
  ['--dsw-alias-bg-module-platform', (c) => c.toolPendingBg],
  ['--dsw-alias-bg-multi-select', (c) => c.selectedBg],
  ['--dsw-alias-bg-document-preview', (c) => c.toolPendingBg],
  ['--dsw-alias-card-fill', (c) => c.cardBg],
  ['--dsw-alias-card-fill-hover', (c) => c.toolPendingBg],
  ['--dsw-alias-card-tile-fill', (c) => c.toolSuccessBg],
  ['--dsw-specific-sidebar-fill', (c) => c.toolPendingBg],
  ['--dsw-specific-menu', (c) => c.cardBg],
  ['--dsw-menu-surface-fill', (c) => c.cardBg],
  ['--dsw-alias-menu-group-header-fill', (c) => c.toolPendingBg],
  ['--dsw-specific-input-major', (c) => c.cardBg],
  ['--dsw-specific-login-input', (c) => c.cardBg],
  ['--dsw-specific-bubble', (c) => c.userMessageBg],
  ['--dsw-specific-bubble-highlight', (c) => c.selectedBg],
  ['--dsw-alias-markdown-code-block', (c) => c.toolPendingBg],
  ['--dsw-alias-markdown-code-block-banner', (c) => c.toolSuccessBg],
  ['--dsw-alias-markdown-inline-code', (c) => c.toolSuccessBg],
  ['--dsw-alias-turn-trigger-bg', (c) => c.toolPendingBg],
  ['--dsw-alias-turn-trigger-bg-hover', (c) => c.toolSuccessBg],
  ['--dsw-specific-selector', (c) => c.selectedBg],
  ['--dsw-specific-tip', (c) => c.toolPendingBg],
  ['--dsw-specific-sidebar-nav-item-active', (c) => c.selectedBg],
  ['--dsw-alias-bg-skeleton', (c, s) => alpha(c.text, s === 'light' ? 0.04 : 0.08)],
]

/** One surface layer per mode. */
function surfaceLayer(colors, scheme, mode) {
  const tokens = {}
  for (const [name, make] of mode === 'wallpaper' ? GLASS_TOKENS : SOLID_TOKENS) tokens[name] = make(colors, scheme)
  return tokens
}

/** Veil token values for one scheme. */
function veilLayer(colors, scheme) {
  const tokens = {}
  for (const [name, make] of VEILS) tokens[name] = make(colors, scheme)
  return tokens
}

/** Derived token values for one scheme. */
function derivedLayer(colors, scheme) {
  const tokens = {}
  for (const [name, make] of DERIVED) tokens[name] = make(colors, scheme)
  return tokens
}

const lightForest = forestColors('light')
const darkForest = forestColors('dark')

/**
 * The dark palette's own ink surface for the overlay family (tooltip, toast,
 * hovercard). DSH paints those dark in both schemes and switches their label to
 * white; matching that keeps an overlay legible and recognisable as an overlay
 * instead of reading as an ordinary card.
 */
/**
 * Forest has no "tertiary label" step. Its `dim` is tuned for pi's own chrome and
 * lands at 4.34 on the dark canvas, below the 4.5 that DSH's small captions need
 * at their size, so derive one from the same hue family: a step darker in light,
 * two steps lighter in dark. No new hue enters the palette.
 */
const tertiaryOf = scheme => `#${okhsl(149, scheme === 'light' ? 12 : 10, scheme === 'light' ? 52 : 70)}`
lightForest.tertiary = tertiaryOf('light')
darkForest.tertiary = tertiaryOf('dark')

const INK = {
  bg: darkForest.cardBg,
  label: darkForest.text,
  muted: darkForest.muted,
  dim: darkForest.dim,
  tertiary: darkForest.tertiary,
  link: darkForest.mdLink,
  /** A darkened forest amber for the warn label on the pale light wash. */
  warnLabelLight: `#${okhsl(74, 95, 32)}`,
}
/** Assemble one scheme's token record for one surface mode. */
function assemble(colors, scheme, mode) {
  return { ...project(colors), ...surfaceLayer(colors, scheme, mode), ...veilLayer(colors, scheme), ...derivedLayer(colors, scheme) }
}

/**
 * Surface mode. `solid` is the default: opaque forest surfaces over a forest
 * backdrop on `<html>`. `wallpaper` keeps the same backdrop but makes every
 * raised surface glass, so a wallpaper behind the window shows through.
 *
 * The switch lives in this file because a Client module cannot read its own
 * row config (the boot wire carries id/inject/immediately only), so the choice
 * is baked at generation time. Changing it is one `npm run gen` away.
 */
const MODE = 'wallpaper'

const light = assemble(lightForest, 'light', MODE)
const dark = assemble(darkForest, 'dark', MODE)

mkdirSync(join(packageDir, 'src'), { recursive: true })

writeFileSync(join(packageDir, 'src', 'palette.js'), `/**
 * Forest palette projected onto DSH alias tokens.
 *
 * Generated by \`scripts/gen-palette.mjs\` from the pi forest theme generator;
 * \`client.js\` carries the same two records for the browser. Edit the mapping
 * in the script, never here.
 *
 * Tuning: hue ${tuning.hue}, saturation ${tuning.saturation}%.
 */

/** Tuning both apps share (hue and saturation of the green family). */
export const TUNING = ${JSON.stringify(tuning)}

/** DSH alias token → forest palette role. */
export const MAP = ${JSON.stringify(MAP, null, 2)}

/** Surface mode these records were generated for. */
export const MODE = ${JSON.stringify(MODE)}

/** Token values for the light palette. */
export const LIGHT_TOKENS = ${JSON.stringify(light, null, 2)}

/** Token values for the dark palette. */
export const DARK_TOKENS = ${JSON.stringify(dark, null, 2)}
`)

/**
 * `client.js` is generated in full, so a hand edit would be lost silently.
 * Refuse to overwrite a file that carries an edit marker instead.
 */
const clientPath = join(packageDir, 'client.js')
if (existsSync(clientPath) && readFileSync(clientPath, 'utf8').includes('@hand-edited')) {
  throw new Error('client.js is marked @hand-edited; move the change into scripts/gen-palette.mjs first')
}

writeFileSync(clientPath, `/**
 * Browser half of \`dsh-forest-theme\`: project the forest palette onto DSH's
 * alias tokens through \`ctx.theme.overrideTokens()\`.
 *
 * The override is a layered token record, not a registered theme, so the
 * user's light/dark/system preference keeps working: DSH picks the palette and
 * this module supplies that palette's forest values. Disabling the bundle
 * removes the layer and restores the stock tokens — nothing is written to the
 * user's settings, so there is no state to migrate back.
 *
 * Generated by \`scripts/gen-palette.mjs\`; edit the mapping there.
 */

window.__ModuleLoader__.load({
  id: 'dsh-forest-theme',
  factory() {
    /** Override-layer identity; one layer per source, so re-applying replaces it. */
    const SOURCE = 'dsh-forest-theme'

    /** Forest values for the light palette. */
    const LIGHT = ${JSON.stringify(light, null, 6)}

    /** Forest values for the dark palette. */
    const DARK = ${JSON.stringify(dark, null, 6)}

    /**
     * The window colour behind the (transparent) canvas. A wallpaper layer
     * covers it; without one this is what the user sees.
     */
    const BACKDROP = { light: ${JSON.stringify(lightForest.pageBg)}, dark: ${JSON.stringify(darkForest.pageBg)} }

    /** \`overrideTokens\` records carry both palettes per token. */
    const TOKENS = Object.fromEntries(
      Object.keys(LIGHT).map(name => [name, { light: LIGHT[name], dark: DARK[name] ?? LIGHT[name] }]),
    )

    return {
      inject: ['theme'],
      apply(ctx) {
        ctx.effect(() => ctx.theme.overrideTokens(SOURCE, TOKENS), 'forest: alias token layer')
        // The canvas token is transparent in every mode, so something has to
        // paint the window itself. A wallpaper layer, when one is installed,
        // sits at z-index -1 above this backdrop and below the app.
        ctx.effect(() => {
          const root = document.documentElement
          const previous = root.style.backgroundColor
          // ui-layout's presenter sets body[data-ds-dark-theme] from the
          // resolved snapshot, so reading it here agrees with the palette in
          // force even when the preference is system.
          const paint = () => {
            root.style.backgroundColor = document.body.hasAttribute('data-ds-dark-theme')
              ? BACKDROP.dark
              : BACKDROP.light
          }
          paint()
          const stop = ctx.on('theme/change', paint)
          return () => {
            stop()
            root.style.backgroundColor = previous
          }
        }, 'forest: canvas backdrop')

        // The bundle has no settings surface, so the console line is the only
        // way to tell "layer stacked" from "another plugin's tokens won".
        ctx.effect(() => {
          console.info(
            '[forest-theme] stacked ' + Object.keys(TOKENS).length + ' tokens · theme revision '
            + ctx.theme.getTheme().revision,
          )
        }, 'forest: activation trace')
      },
    }
  },
})
`)

/**
 * `src/palette.js` exists for humans and has no runtime consumer, so nothing
 * structural keeps it in step with `client.js`. Load the generated Client module
 * in a stub loader, let it register, and compare the record it would actually
 * apply against the readable copy — a mismatch means one side was edited by hand.
 */
const applied = (() => {
  const style = { getPropertyValue: () => '', setProperty() {}, removeProperty() {} }
  const root = { style, dataset: {}, }
  const body = { hasAttribute: () => false, style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, removeAttribute() {} }
  const sandbox = {
    window: { __ModuleLoader__: { load: definition => { sandbox.definition = definition } } },
  }
  new Function('window', 'document', readFileSync(join(packageDir, 'client.js'), 'utf8'))(
    sandbox.window,
    { documentElement: root, body, createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, remove() {} }), head: { append() {}, } },
  )
  let tokens
  sandbox.definition.factory().apply({
    theme: { overrideTokens: (_source, value) => { tokens = value; return () => {} }, getTheme: () => ({ revision: 0 }) },
    effect: run => { run(); return () => {} },
    on: () => () => {},
  })
  return tokens
})()

const readable = readFileSync(join(packageDir, 'src', 'palette.js'), 'utf8')
for (const [label, pattern] of [
  ['LIGHT', /export const LIGHT_TOKENS = (\{[\s\S]*?\n\})/u],
  ['DARK', /export const DARK_TOKENS = (\{[\s\S]*?\n\})/u],
]) {
  const fromFile = JSON.parse(pattern.exec(readable)[1])
  const fromClient = Object.fromEntries(Object.entries(applied).map(([name, modes]) => [name, modes[label === 'LIGHT' ? 'light' : 'dark']]))
  const a = JSON.stringify(Object.entries(fromFile).sort())
  const b = JSON.stringify(Object.entries(fromClient).sort())
  if (a !== b) throw new Error(`${label} tokens differ between src/palette.js and client.js`)
}

console.log(`forest → ${Object.keys(light).length} DSH tokens per palette · hue ${tuning.hue} · saturation ${tuning.saturation}`)
console.log(`done · ${Object.keys(light).length} tokens per palette, both schemes verified`)
