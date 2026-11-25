/**
 * Assembly tests for `dsh-agent-board`.
 *
 * These answer the question "does this bundle still load?" without a browser:
 * the module registers under the expected id, the plugin declares the same
 * `inject` list as the working baseline, `apply(ctx)` runs against a recording
 * stand-in for the two services it declares, and the registration it lands is
 * the one the sidebar seat expects.
 *
 * No DOM, no React render, no screenshot: whether the panel *looks* right is
 * out of scope and is called out as unverified in the delivery notes.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../dsh-agent-board/client.js', import.meta.url))
const source = readFileSync(CLIENT_PATH, 'utf8')

/**
 * Load the browser half with the loader stub and a React stand-in.
 * @returns the registered id, the plugin object, and the source text.
 */
function loadBoard() {
  const registered = []
  const window = { __ModuleLoader__: { load(registration) { registered.push(registration) } } }
  globalThis.window = window
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
    useMemo: (factory) => factory(),
    useEffect: () => undefined,
  }
  // eslint-disable-next-line no-new-func
  new Function('window', 'module', 'exports', source)(window, { exports: {} }, {})
  assert.equal(registered.length, 1)
  const plugin = registered[0].factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected bare import: ${name}`)
  })
  return { id: registered[0].id, plugin }
}

const { id, plugin } = loadBoard()

/**
 * A minimal ctx that records what `apply` touches.
 * @param options - `layout` service value to return from `ctx.get`, if any.
 * @returns the recording ctx plus the captured registration.
 */
function recordingCtx({ layout } = {}) {
  const captured = { locale: [], registrations: [], effects: [] }
  const ctx = {
    get(name) {
      captured.getCalls = (captured.getCalls ?? []).concat(name)
      return name === 'layout' ? layout : undefined
    },
    effect(factory, label) {
      captured.effects.push(label)
      const dispose = factory()
      return typeof dispose === 'function' ? dispose : () => undefined
    },
    locale: {
      register(namespace, dictionaries) {
        captured.locale.push({ namespace, dictionaries })
        return () => undefined
      },
    },
    slots: {
      inject(name, factory) {
        captured.registrations.push({ injectName: name, factory })
      },
      register(options, Component) {
        captured.registrations.push({ options, Component })
        return () => undefined
      },
    },
  }
  return { ctx, captured }
}

// ---------------------------------------------------------------------------
// Module contract.
// ---------------------------------------------------------------------------

test('the module registers under the dsh-agent-board id', () => {
  assert.equal(id, 'dsh-agent-board')
})

test('inject is exactly [slots, locale] — unchanged from the working baseline', () => {
  // The one red line from the review: adding a service here (previously
  // `uiWorkspace`) parks the plugin and it silently never applies.
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
})

test('the inject literal in source is the expected pair', () => {
  assert.match(source, /inject:\s*\['slots',\s*'locale'\]/)
  // The only `inject:` declaration in the file must be that pair; a second one
  // is how a stray service dependency (previously `uiWorkspace`) got added and
  // parked the plugin.
  const declared = [...source.matchAll(/inject:\s*\[([^\]]*)\]/g)].map((m) => m[1])
  assert.equal(declared.length, 1, `expected one inject declaration, found ${declared.length}`)
  assert.ok(!declared[0].includes('uiWorkspace'), 'uiWorkspace is module-private, never a service')
  assert.ok(!declared[0].includes('layout'), 'layout is read lazily; declaring it would gate apply')
})

test('there is no bare import and no external dependency', () => {
  // The bundle is linked into the profile, so it must resolve nothing itself.
  const importLike = source.match(/^\s*import\s/m)
  assert.equal(importLike, null, 'no ESM import statement may appear')
  assert.ok(!/require\(\s*['"](?!react['"])/.test(source), 'require() may only resolve react')
  const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(requires)], ['react'])
})

test('the host half the client pairs with stays a no-op plugin', () => {
  // A quick contract read of the sibling file, so a broken pair is caught here
  // rather than at profile load. The file is not modified by this task.
  const host = readFileSync(new URL('../dsh-agent-board/index.js', import.meta.url), 'utf8')
  assert.match(host, /export const name = 'agent-board'/)
  assert.match(host, /export function apply\(\)/)
})

// ---------------------------------------------------------------------------
// apply(ctx) against a recording context.
// ---------------------------------------------------------------------------

test('apply registers the locale dictionaries and the sidebar seat', () => {
  const { ctx, captured } = recordingCtx()
  plugin.apply(ctx)

  assert.equal(captured.locale.length, 1)
  assert.equal(captured.locale[0].namespace, 'agentBoard')
  assert.ok(captured.locale[0].dictionaries.zh !== undefined)
  assert.ok(captured.locale[0].dictionaries.en !== undefined)

  const injectCall = captured.registrations.find((entry) => entry.injectName !== undefined)
  assert.equal(injectCall.injectName, 'sidebar.workspaces', 'the board fills the workspaces seat')
})

test('the sidebar registration names the seat and takes the board component', () => {
  const { ctx, captured } = recordingCtx()
  plugin.apply(ctx)

  // `ctx.slots.inject` returns the registration factory; invoking it mirrors
  // what the slot runtime does once the sidebar is present.
  const injectCall = captured.registrations.find((entry) => entry.injectName !== undefined)
  injectCall.factory()
  const registration = captured.registrations.find((entry) => entry.options !== undefined)
  assert.ok(registration !== undefined, 'a slot registration was produced')
  assert.equal(registration.options.name, 'sidebar.workspaces')
  assert.equal(registration.options.locale, 'agentBoard')
  assert.equal(typeof registration.Component, 'function')
  assert.equal(typeof registration.options.inject, 'function')
})

/**
 * Run `apply` and hand back the injected prop factory plus the recorded ctx.
 * @param options - passed through to `recordingCtx`.
 * @returns the injected props and the recording ctx.
 */
function applyAndInject(options) {
  const recording = recordingCtx(options)
  plugin.apply(recording.ctx)
  // `ctx.slots.inject` only declares the seat; the runtime calls the returned
  // factory once the seat exists, which is when `register` runs.
  const injectCall = recording.captured.registrations.find((entry) => entry.injectName !== undefined)
  assert.ok(injectCall !== undefined, 'apply must declare the sidebar.workspaces seat')
  injectCall.factory()
  const registration = recording.captured.registrations.find((entry) => entry.options !== undefined)
  assert.ok(registration !== undefined, 'apply must produce a slot registration')
  return { injected: registration.options.inject(), recording }
}

test('openSession shows the Conversation through the layout service', () => {
  // `uiWorkspace` is module-private inside ui-workspace and never a registered
  // service. The public path to the Conversation is `layout.selectPanel(null)`.
  const panels = []
  const { injected } = applyAndInject({ layout: { selectPanel: (panel) => panels.push(panel) } })
  injected.openSession('session-42')
  assert.deepEqual(panels, [null], 'null selects the reserved Conversation panel')
})

test('openSession is inert, not throwing, when the layout service is absent or partial', () => {
  // A missing service is a reason not to navigate, never a reason to take
  // `apply` or a click handler down.
  for (const options of [undefined, { layout: {} }, { layout: { selectPanel: null } }]) {
    const { injected } = applyAndInject(options)
    assert.doesNotThrow(() => { injected.openSession('session-42') })
  }
})

test('openSession survives a selectPanel that throws', () => {
  const { injected } = applyAndInject({ layout: { selectPanel: () => { throw new Error('unregistered panel') } } })
  assert.doesNotThrow(() => { injected.openSession('session-42') })
})

test('the test seam is off unless explicitly enabled', () => {
  // Loading without the flag must yield a plain plugin object: the Host's
  // loader only ever sees `inject` and `apply`.
  const registered = []
  const window = { __ModuleLoader__: { load(registration) { registered.push(registration) } } }
  globalThis.window = window
  delete globalThis.__DSH_AGENT_BOARD_TEST__
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'module', 'exports', source)(window, { exports: {} }, {})
    const plain = registered[0].factory(() => ({
      createElement: () => ({}), useState: (v) => [v, () => undefined],
      useMemo: (f) => f(), useEffect: () => undefined,
    }))
    assert.deepEqual(Object.keys(plain).sort(), ['apply', 'inject'])
  } finally {
    delete globalThis.window
  }
})
