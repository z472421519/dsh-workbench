/**
 * Host half of `dsh-forest-theme`.
 *
 * The palette is a browser concern: `client.js` stacks a token layer over the
 * active theme through `ctx.theme.overrideTokens()`. This row exists so the
 * bundle has a Loader entry for its Client module to hang from, and stays empty
 * on purpose — no Host service, no configuration, no session state.
 */

/** Cordis plugin name; the loader row id matches it. */
export const name = 'forest-theme'

/** Nothing to apply on the Host side. */
export function apply() {}
