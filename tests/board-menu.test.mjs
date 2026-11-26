/**
 * Regression tests for the Session context menu on board rows.
 *
 * Replacing `sidebar.workspaces` handed this plugin the only Session row, but
 * the row was a bare `<button onClick>` that never dispatched a context menu.
 * `ui-workspace` still registers every Session action (pin, rename, fork,
 * copy id, archive) on `ctx.contextMenus` and still mounts the rename dialog
 * in `shell.overlay`; with no gesture to open them, all of it became
 * unreachable — which is what "rename stopped working after installing the
 * plugin" actually was.
 *
 * These assert the row's props only. No DOM, no React render: the gesture
 * wiring is the frame's (it ships `getTriggerProps`), so what is checked here
 * is that we ask for it, hand it the right target, and keep the click.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../dsh-agent-board/client.js', import.meta.url))
const source = readFileSync(CLIENT_PATH, 'utf8')

/** Load the bundle and return the exported test seam. */
function loadTesting() {
  const registered = []
  const window = { __ModuleLoader__: { load(registration) { registered.push(registration) } } }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
    useMemo: (factory) => factory(),
    useEffect: () => undefined,
  }
  globalThis.window = window
  globalThis.__DSH_AGENT_BOARD_TEST__ = true
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'module', 'exports', source)(window, { exports: {} }, {})
    return registered[0].factory((name) => {
      if (name === 'react') return react
      throw new Error(`unexpected bare import: ${name}`)
    }).testing
  } finally {
    globalThis.__DSH_AGENT_BOARD_TEST__ = false
  }
}

const { rowPropsOf, entryOf } = loadTesting()

/** Dictionary stand-in: entry labels are not what these tests assert. */
const t = (key) => key

const ROW = {
  id: 'sess-42',
  title: 'Fix the parser',
  storedTitle: 'Fix the parser',
  state: 'idle',
  time: Date.now(),
  detail: '',
}

/**
 * A `getTriggerProps` stand-in that records its arguments and returns the
 * handler set the shipped one returns.
 * @param calls - array collecting each invocation.
 * @returns the binding object.
 */
function recordingMenu(calls) {
  return {
    getTriggerProps(target, handlers = {}) {
      calls.push({ target, handlers })
      return { ...handlers, onContextMenu: () => undefined, onKeyDown: () => undefined, tabIndex: 0 }
    },
  }
}

test('the row asks the frame for the menu gesture', () => {
  const calls = []
  const props = rowPropsOf(ROW, undefined, () => undefined, recordingMenu(calls).getTriggerProps)
  assert.equal(calls.length, 1, 'one binding per row')
  assert.equal(typeof props.onContextMenu, 'function', 'a right-click now opens the menu')
})

test('the menu target is the plain session id and the row title', () => {
  // `ContextMenuTargetMap.session` is `{ sessionId, displayTitle }`; the
  // shipped resolve() reads both, and rename seeds its draft from the title.
  const calls = []
  rowPropsOf(ROW, undefined, () => undefined, recordingMenu(calls).getTriggerProps)
  assert.deepEqual(calls[0].target, {
    kind: 'session',
    value: { sessionId: 'sess-42', displayTitle: 'Fix the parser' },
  })
})

test('the plain click survives the menu binding', () => {
  // `getTriggerProps` merges the caller's handlers rather than replacing them,
  // so routing the click through it must not cost the row its own action.
  const calls = []
  const opened = []
  rowPropsOf(ROW, undefined, (id) => { opened.push(id) }, recordingMenu(calls).getTriggerProps)
  assert.equal(typeof calls[0].handlers.onClick, 'function')
  calls[0].handlers.onClick()
  assert.deepEqual(opened, ['sess-42'])
})

test('the menu carries the stored title, not the painted fallback', () => {
  // `displayTitle` falls back to the project basename and then the session id.
  // The rename dialog seeds its draft from the target's displayTitle, so
  // passing the painted title would prefill a name the Session does not have —
  // and a confirm that changes nothing would then write it.
  const calls = []
  rowPropsOf(
    { ...ROW, title: 'dsh-workbench', storedTitle: '' },
    undefined, () => undefined, recordingMenu(calls).getTriggerProps,
  )
  assert.equal(calls[0].target.value.displayTitle, '', 'an unnamed Session offers an empty draft')
})

test('entryOf keeps the painted and stored titles apart', () => {
  const summary = {
    id: 's9', displayTitle: 'dsh-workbench', title: '', updatedAt: Date.now(),
    running: false, blank: false, retainedBy: {},
  }
  const entry = entryOf(summary, undefined, t, Date.now())
  assert.equal(entry.title, 'dsh-workbench', 'the row still paints the fallback')
  assert.equal(entry.storedTitle, '', 'but the menu sees no name')

  const named = entryOf({ ...summary, title: 'Parser work' }, undefined, t, Date.now())
  assert.equal(named.title, 'dsh-workbench', 'displayTitle wins for painting')
  assert.equal(named.storedTitle, 'Parser work')
})

test('row identity, state and rail survive the refactor', () => {
  const props = rowPropsOf(
    { ...ROW, state: 'attention', detail: 'waiting for approval' },
    'sess-42', () => undefined, recordingMenu([]).getTriggerProps,
  )
  assert.equal(props.type, 'button')
  assert.equal(props.className, 'dshAb_row')
  assert.equal(props.key, 'sess-42')
  assert.equal(props['data-state'], 'attention')
  assert.equal(props['data-current'], '', 'the main-view Session still marks itself')
  assert.match(props.style['--dshAb-tint'], /var\(--dsw-/)
  assert.match(props.title, /Fix the parser — waiting for approval/)
})

test('a composition without the menu still yields a working row', () => {
  // The menu plugin may be absent; losing the gesture must not lose the row.
  const opened = []
  const props = rowPropsOf(ROW, undefined, (id) => { opened.push(id) }, undefined)
  assert.equal(props.onContextMenu, undefined)
  props.onClick()
  assert.deepEqual(opened, ['sess-42'])
})

test('the component reads the menu binding off its own props', () => {
  // `useContextMenu` arrives through `ctx.slots.provideRoot` on every seat, so
  // it is read here rather than injected — declaring it would gate `apply`.
  assert.match(source, /props\.useContextMenu/, 'the seat reads the shared binding')
  assert.match(source, /getTriggerProps/)
  const declaredInjects = [...source.matchAll(/inject:\s*\[([^\]]*)\]/g)].map((m) => m[1])
  assert.equal(declaredInjects.length, 1)
  assert.ok(!declaredInjects[0].includes('contextMenus'), 'the menu service is not a dependency')
  assert.ok(!/require\(\s*['"](?!react['"])/.test(source), 'still zero external dependencies')
})
