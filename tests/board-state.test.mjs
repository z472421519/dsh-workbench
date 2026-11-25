/**
 * Sectioning tests for `dsh-agent-board`.
 *
 * Covers defects 1–3 of the review: what counts as "done", when a Session may
 * sleep, and how many rows a section renders. Everything here calls the pure
 * helpers the browser half exports through its test seam; nothing renders.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../dsh-agent-board/client.js', import.meta.url))

/**
 * A React stand-in. `createElement` returns a plain object and the hooks are
 * inert: only `entryOf`/`bucketOf`/`rowsFor` are exercised, never a component.
 * @returns the fake React namespace.
 */
function fakeReact() {
  const noop = () => undefined
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, noop],
    useMemo: (factory) => factory(),
    useEffect: () => undefined,
  }
}

/** Load the bundle with a capturing `window.__ModuleLoader__` stub. */
function loadBoard() {
  const source = readFileSync(CLIENT_PATH, 'utf8')
  const registered = []
  const window = { __ModuleLoader__: { load(registration) { registered.push(registration) } } }
  const hadDocument = 'document' in globalThis
  const previousDocument = globalThis.document
  delete globalThis.document

  globalThis.window = window
  globalThis.__DSH_AGENT_BOARD_TEST__ = true
  let plugin
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'module', 'exports', source)(window, { exports: {} }, {})
    assert.equal(registered.length, 1, 'the bundle registers exactly once')
    const react = fakeReact()
    // The seam is read inside the factory, so the flag stays on until the
    // factory has run.
    plugin = registered[0].factory((name) => {
      if (name === 'react') return react
      throw new Error(`unexpected bare import: ${name}`)
    })
  } finally {
    globalThis.__DSH_AGENT_BOARD_TEST__ = false
    if (hadDocument) globalThis.document = previousDocument
  }
  return { plugin, source, testing: plugin.testing }
}

const { plugin, source, testing } = loadBoard()
const { entryOf, bucketOf, rowsFor, SLEEP_AFTER_MS } = testing
const t = (key) => key
const HOUR = 60 * 60 * 1000

/**
 * One `SessionSummary`-shaped row.
 * @param overrides - fields to override.
 * @returns that row.
 */
function row(overrides) {
  return {
    id: 's1',
    displayTitle: 'A session',
    updatedAt: Date.now(),
    running: false,
    blank: false,
    retainedBy: {},
    ...overrides,
  }
}

/**
 * One `{ ids, byId }` list snapshot from rows.
 * @param rows - rows to include.
 * @returns that snapshot.
 */
function listOf(rows) {
  const byId = {}
  for (const item of rows) byId[item.id] = item
  return { ids: rows.map((item) => item.id), byId }
}

/** A status map like the frame's `Map<SessionId, SessionStatus>`. */
function statusMap(entries = []) {
  return new Map(entries)
}

/** Build `count` idle rows with distinct ids/titles. */
function manyRows(count, prefix) {
  return Array.from({ length: count }, (_, index) => row({
    id: `${prefix}-${index + 1}`,
    displayTitle: `${prefix} ${index + 1}`,
    updatedAt: Date.now() - index,
  }))
}

// ---------------------------------------------------------------------------
// Defect 1 — a title is not evidence of a finished turn.
// ---------------------------------------------------------------------------

test('a titled Session with completionUnread false is idle, not done', () => {
  const summary = row({ id: 'titled', displayTitle: 'Summarize the repo', title: 'Summarize the repo' })
  const entry = entryOf(summary, { running: false, pendingInteraction: undefined, completionUnread: false }, t, Date.now())
  assert.equal(entry.state, 'idle')
  assert.equal(entry.detail, '')
})

test('a titled Session with no status at all is idle, not done', () => {
  // A first turn that failed leaves a title behind; DSH projects the title when
  // the user message commits, before any turn outcome exists.
  const summary = row({ id: 'titled-unobserved', displayTitle: 'Broken run', title: 'Broken run' })
  const entry = entryOf(summary, undefined, t, Date.now())
  assert.equal(entry.state, 'idle')
})

test('a titled Session with completionUnread undefined is idle, not done', () => {
  const summary = row({ id: 'undefined-flag', displayTitle: 'Interrupted', title: 'Interrupted' })
  const entry = entryOf(summary, { running: false, pendingInteraction: undefined, completionUnread: undefined }, t, Date.now())
  assert.equal(entry.state, 'idle')
})

test('completionUnread true is the only path to done', () => {
  const summary = row({ id: 'finished', displayTitle: 'Finished', title: 'Finished' })
  const entry = entryOf(summary, { running: false, pendingInteraction: undefined, completionUnread: true }, t, Date.now())
  assert.equal(entry.state, 'done')
  assert.equal(entry.detail, 'doneLabel')
})

test('a running Session stays running even with completionUnread set', () => {
  const summary = row({ id: 'busy', displayTitle: 'Busy', title: 'Busy' })
  const entry = entryOf(summary, { running: true, pendingInteraction: undefined, completionUnread: true }, t, Date.now())
  assert.equal(entry.state, 'running')
})

test('entryOf no longer reads summary.title as a completion signal', () => {
  // Guards the fix itself: the title field may only appear as display text.
  const body = source.slice(source.indexOf('function entryOf'), source.indexOf('function bucketOf'))
  assert.ok(!body.includes('summary.title'), 'entryOf must not branch on summary.title')
})

// ---------------------------------------------------------------------------
// Defect 2 — updatedAt is the last *prompt* time, not the last activity time.
// ---------------------------------------------------------------------------

test('a long turn that just finished with an unread completion stays recent after 13 idle hours', () => {
  const old = Date.now() - 13 * HOUR
  const summary = row({ id: 'overnight', displayTitle: 'Nightly sweep', updatedAt: old })
  const statuses = statusMap([['overnight', { running: false, pendingInteraction: undefined, completionUnread: true }]])
  const entry = entryOf(summary, statuses.get('overnight'), t, Date.now())
  assert.equal(entry.state, 'done')
  assert.notEqual(entry.state, 'sleeping')
})

test('a completionUnread Session 13 hours stale lands in recent, not sleeping', () => {
  const old = Date.now() - 13 * HOUR
  const summary = row({ id: 'overnight', displayTitle: 'Nightly sweep', updatedAt: old })
  const statuses = statusMap([['overnight', { running: false, pendingInteraction: undefined, completionUnread: true }]])
  const buckets = bucketOf(listOf([summary]), statuses, t, Date.now())
  assert.deepEqual(buckets.recent.map((entry) => entry.id), ['overnight'])
  assert.deepEqual(buckets.sleeping, [])
})

test('a Session with no completion marker 13 hours stale sleeps', () => {
  const old = Date.now() - 13 * HOUR
  const summary = row({ id: 'quiet', displayTitle: 'Old chat', updatedAt: old })
  const entry = entryOf(summary, { running: false, pendingInteraction: undefined, completionUnread: false }, t, Date.now())
  assert.equal(entry.state, 'sleeping')
})

test('a quiet Session 13 hours stale lands in the sleeping bucket', () => {
  const old = Date.now() - 13 * HOUR
  const summary = row({ id: 'quiet', displayTitle: 'Old chat', updatedAt: old })
  const buckets = bucketOf(listOf([summary]), statusMap(), t, Date.now())
  assert.deepEqual(buckets.sleeping.map((entry) => entry.id), ['quiet'])
  assert.deepEqual(buckets.recent, [])
})

test('the sleep threshold is still twelve hours', () => {
  assert.equal(SLEEP_AFTER_MS, 12 * HOUR)
  const justUnder = row({ id: 'edge', updatedAt: Date.now() - (12 * HOUR - 60_000) })
  assert.equal(entryOf(justUnder, statusMap().get('edge'), t, Date.now()).state, 'idle')
})

test('a running Session never sleeps regardless of age', () => {
  const summary = row({ id: 'still-running', updatedAt: Date.now() - 30 * HOUR })
  const entry = entryOf(summary, { running: true, pendingInteraction: undefined, completionUnread: false }, t, Date.now())
  assert.equal(entry.state, 'running')
})

test('a pending interaction never sleeps regardless of age', () => {
  const summary = row({ id: 'waiting', updatedAt: Date.now() - 30 * HOUR })
  const status = { running: false, completionUnread: false, pendingInteraction: { key: 'k', kind: 'approval', sessionId: 'waiting' } }
  assert.equal(entryOf(summary, status, t, Date.now()).state, 'attention')
})

// ---------------------------------------------------------------------------
// Defect 3 — no per-section cap; the sidebar's own scroller is the only limit.
// ---------------------------------------------------------------------------

test('19 attention rows all render instead of being capped at 12', () => {
  const rows = manyRows(19, 'attn').map((item) => ({ ...item }))
  const statuses = statusMap(rows.map((item) => [item.id, {
    running: false,
    completionUnread: false,
    pendingInteraction: { key: `k-${item.id}`, kind: 'approval', sessionId: item.id },
  }]))
  const buckets = bucketOf(listOf(rows), statuses, t, Date.now())
  assert.equal(buckets.attention.length, 19)
  assert.equal(rowsFor(buckets, {}, 'attention').length, 19)
})

test('19 recent rows all render instead of being capped at 12', () => {
  const rows = manyRows(19, 'recent')
  const buckets = bucketOf(listOf(rows), statusMap(), t, Date.now())
  assert.equal(buckets.recent.length, 19)
  assert.equal(rowsFor(buckets, {}, 'recent').length, 19)
})

test('a folded section renders nothing while its header retains the true count', () => {
  const rows = manyRows(19, 'sleeping').map((item) => ({ ...item, updatedAt: Date.now() - 13 * HOUR }))
  const buckets = bucketOf(listOf(rows), statusMap(), t, Date.now())
  assert.equal(buckets.sleeping.length, 19)
  assert.equal(rowsFor(buckets, { sleeping: true }, 'sleeping').length, 0)
  assert.equal(rowsFor(buckets, {}, 'sleeping').length, 19)
})

test('the SECTION_LIMIT constant and its slice are gone', () => {
  assert.ok(!source.includes('SECTION_LIMIT'), 'SECTION_LIMIT must be removed')
  assert.ok(!source.includes('.slice(0,'), 'the truncating slice must be removed')
})

test('no paging control is reintroduced', () => {
  // The user asked for the old "show more" button to stay gone; the sidebar's
  // own scroller is the only way to reach further rows.
  assert.ok(!source.includes('dshAb_more'), 'no extra row class for a paging control')
  assert.ok(!/moreLabel|showMore/.test(source), 'no paging label may come back')
})

test('the board still reports its four sections and skips blank/subagent rows', () => {
  const rows = [
    row({ id: 'blank', blank: true }),
    row({ id: 'child', origin: 'subagent' }),
    row({ id: 'kept' }),
  ]
  const buckets = bucketOf(listOf(rows), statusMap(), t, Date.now())
  assert.deepEqual(buckets.recent.map((entry) => entry.id), ['kept'])
})

test('the plugin object still exposes apply and the unchanged inject list', () => {
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
  assert.equal(typeof plugin.apply, 'function')
})
