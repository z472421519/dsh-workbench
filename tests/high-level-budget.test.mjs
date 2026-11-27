/**
 * Regression tests for the `/hl` empty-summary failure.
 *
 * A reasoning model spends `maxOutputTokens` on hidden reasoning before it
 * writes any visible text, so a cap sized for "3–5 bullets" truncates the
 * request with `finish: max-tokens` and zero text — which used to surface as
 * the indistinguishable message "the model returned no summary text".
 *
 * These assert the Host half's decisions as source text and by running the
 * module's pure pieces; no model is called and no browser is started.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HOST_PATH = fileURLToPath(new URL('../dsh-high-level/index.js', import.meta.url))
const source = readFileSync(HOST_PATH, 'utf8')

/**
 * Import the Host module with a throwaway context, then return it.
 * `apply` is never called, so nothing registers.
 * @returns the module namespace.
 */
async function loadHost() {
  return import(`${HOST_PATH}?t=${Date.now()}`)
}

// ---------------------------------------------------------------------------
// The budget was the defect.
// ---------------------------------------------------------------------------

test('the default output budget covers reasoning plus bullets, not just bullets', () => {
  const match = source.match(/const DEFAULT_MAX_OUTPUT_TOKENS = (\d[\d_]*)/)
  assert.ok(match !== null, 'the default must stay a named constant')
  const budget = Number(match[1].replaceAll('_', ''))
  // Measured on deepseek-v4.1-flash over a 1.3k-char reply: reasoning alone ran
  // 780-1790 tokens. 400 truncated 5 of 6 attempts.
  assert.ok(budget >= 800, `a ${budget}-token default is below the observed reasoning floor`)
})

test('the budget is documented as a total completion budget', () => {
  assert.match(
    source,
    /total\*? completion budget/,
    'the constant must say that reasoning spends the same budget',
  )
})

// ---------------------------------------------------------------------------
// A truncated request must not report the generic message.
// ---------------------------------------------------------------------------

test('the stream records a max-tokens finish', () => {
  assert.match(source, /chunk\.reason\.kind === 'max-tokens'/, 'the finish reason must be captured')
})

test('an empty summary after truncation explains the budget', () => {
  const block = source.slice(source.indexOf('if (!summary) {'))
  const body = block.slice(0, block.indexOf('return { summary'))
  assert.match(body, /truncated/, 'the empty-text error branches on truncation')
  assert.match(body, /maxOutputTokens/, 'the message names the setting to raise')
})

test('the generic message survives for a genuinely empty response', () => {
  assert.match(source, /the model returned no summary text/, 'a real empty response keeps its own message')
})

// ---------------------------------------------------------------------------
// The pure helpers still behave.
// ---------------------------------------------------------------------------

test('module loads and exports the same inject list', async () => {
  const host = await loadHost()
  assert.equal(host.name, 'high-level')
  assert.deepEqual(host.inject, ['commands', 'llm'])
})
