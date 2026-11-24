/** Host half of `dsh-agent-board`: the board is entirely a browser surface. */

/** Cordis plugin name; the loader row id matches it. */
export const name = 'agent-board'

/** No Host service is required; the empty body keeps the row loadable. */
export function apply() {}
