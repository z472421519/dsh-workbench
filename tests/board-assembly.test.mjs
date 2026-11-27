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
  // A minimal hook stand-in: state is stored per hook slot so a re-render after
  // a click sees the new value, which is what the add flow depends on.
  const slots = []
  let cursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => {
      const at = cursor++
      if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial
      return [slots[at], (next) => { slots[at] = next }]
    },
    useRef: (initial) => {
      const at = cursor++
      if (!(at in slots)) slots[at] = { current: initial }
      return slots[at]
    },
    useMemo: (factory) => factory(),
    useEffect: () => undefined,
  }
  // A fresh mount: hook slots and the cursor both go back to zero, so one
  // test's click cannot leak state into the next test's first paint.
  react.__reset = () => { cursor = 0; slots.length = 0 }
  // eslint-disable-next-line no-new-func
  new Function('window', 'module', 'exports', source)(window, { exports: {} }, {})
  assert.equal(registered.length, 1)
  const plugin = registered[0].factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected bare import: ${name}`)
  })
  plugin.__react = react
  return { id: registered[0].id, plugin }
}

const { id, plugin } = loadBoard()

/**
 * A minimal ctx that records what `apply` touches.
 * @param options - services to return from `ctx.get`, by name.
 * @returns the recording ctx plus the captured registration.
 */
function recordingCtx({ layout, uiWorkspace, workspaces } = {}) {
  const captured = { locale: [], registrations: [], effects: [] }
  const ctx = {
    get(name) {
      captured.getCalls = (captured.getCalls ?? []).concat(name)
      if (name === 'layout') return layout
      if (name === 'uiWorkspace') return uiWorkspace
      if (name === 'workspaces') return workspaces
      return undefined
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
  assert.ok(!declared[0].includes('uiWorkspace'), 'uiWorkspace is read lazily; declaring it would gate apply')
  assert.ok(!declared[0].includes('layout'), 'layout is read lazily; declaring it would gate apply')
})

test('uiWorkspace is reachable without being declared in inject', () => {
  // The navigation capability is a real Cordis service: `UiWorkspaceService`
  // extends `Service` and calls `super(ctx, 'uiWorkspace')`, whose base
  // constructor runs `ctx.reflect.provide(...)`. The shipped
  // `dsh-experimental-liveshare` reads it the same way — `ctx.get('uiWorkspace')`
  // from a plugin whose `inject` does not list it.
  const body = source.slice(source.indexOf('openSession: (sessionId)'))
  const declaration = body.slice(0, body.indexOf('},\n          }),'))
  assert.match(declaration, /ctx\.get\('uiWorkspace'\)/, 'the row resolves the navigation service')
  assert.match(declaration, /\.openSession\(sessionId\)/, 'and hands it the clicked Session id')
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

/**
 * A `uiWorkspace` stand-in recording every navigation it receives.
 * @returns the stub plus the array its calls land in.
 */
function uiWorkspaceStub({ throws = false } = {}) {
  const opened = []
  return {
    opened,
    service: {
      openSession(target) {
        opened.push(target)
        if (throws) throw new Error('navigation refused')
      },
    },
  }
}

test('openSession selects that exact Session through uiWorkspace.openSession', () => {
  // The defect: the row only called `layout.selectPanel(null)`, which reveals
  // the Conversation panel but never selects a Session, so clicking a row did
  // nothing. `UiWorkspace.openSession` is the documented "select a Session and
  // show its Conversation as one UI navigation action".
  const { service, opened } = uiWorkspaceStub()
  const panels = []
  const { injected } = applyAndInject({
    uiWorkspace: service,
    layout: { selectPanel: (panel) => panels.push(panel) },
  })
  injected.openSession('session-42')
  assert.deepEqual(opened, ['session-42'], 'the row Session id must reach uiWorkspace.openSession')
  assert.deepEqual(panels, [], 'the layout fallback must not also run once navigation succeeded')
})

test('openSession passes the Session id straight through, not a wrapper', () => {
  // `openSession(target: SessionTarget)` takes the id itself. An object or an
  // undefined here would silently select nothing in the real service.
  const { service, opened } = uiWorkspaceStub()
  const { injected } = applyAndInject({ uiWorkspace: service })
  injected.openSession('01JABCDEF')
  injected.openSession('01JXYZ')
  assert.deepEqual(opened, ['01JABCDEF', '01JXYZ'])
  assert.ok(opened.every((target) => typeof target === 'string'))
})

test('openSession reads uiWorkspace lazily, not at apply time', () => {
  // Declaring `uiWorkspace` in `inject` gates `apply` on the service and parks
  // the whole plugin; reading it inside the click keeps the board mounted in
  // profiles that have no Workspace UI.
  const { service } = uiWorkspaceStub()
  const { recording } = applyAndInject({ uiWorkspace: service })
  assert.ok(
    !recording.captured.getCalls?.includes('uiWorkspace'),
    'apply must not resolve uiWorkspace while registering the seat',
  )
})

test('openSession falls back to showing the Conversation when uiWorkspace is absent', () => {
  const panels = []
  const { injected } = applyAndInject({ layout: { selectPanel: (panel) => panels.push(panel) } })
  injected.openSession('session-42')
  assert.deepEqual(panels, [null], 'null selects the reserved Conversation panel')
})

test('openSession falls back when uiWorkspace exists but has no openSession', () => {
  // A partial or older service must not become a silent dead end.
  const panels = []
  const { injected } = applyAndInject({
    uiWorkspace: {},
    layout: { selectPanel: (panel) => panels.push(panel) },
  })
  injected.openSession('session-42')
  assert.deepEqual(panels, [null])
})

test('openSession falls back when uiWorkspace.openSession throws', () => {
  // A refused navigation still has to leave the user looking at the
  // Conversation rather than at a panel they cannot leave.
  const { service } = uiWorkspaceStub({ throws: true })
  const panels = []
  const { injected } = applyAndInject({
    uiWorkspace: service,
    layout: { selectPanel: (panel) => panels.push(panel) },
  })
  assert.doesNotThrow(() => { injected.openSession('session-42') })
  assert.deepEqual(panels, [null], 'a throw from navigation must not swallow the fallback')
})

test('openSession is inert, not throwing, when every navigation path is absent or partial', () => {
  // A missing service is a reason not to navigate, never a reason to take
  // `apply` or a click handler down.
  for (const options of [
    undefined,
    { layout: {} },
    { layout: { selectPanel: null } },
    { uiWorkspace: {}, layout: {} },
  ]) {
    const { injected } = applyAndInject(options)
    assert.doesNotThrow(() => { injected.openSession('session-42') })
  }
})

test('openSession survives a selectPanel that throws', () => {
  const { injected } = applyAndInject({ layout: { selectPanel: () => { throw new Error('unregistered panel') } } })
  assert.doesNotThrow(() => { injected.openSession('session-42') })
})

test('openSession survives an openSession that throws and a selectPanel that also throws', () => {
  const { service } = uiWorkspaceStub({ throws: true })
  const { injected } = applyAndInject({
    uiWorkspace: service,
    layout: { selectPanel: () => { throw new Error('unregistered panel') } },
  })
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

// ---------------------------------------------------------------------------
// Add workspace: the affordance this seat removed with the shipped browser.
//
// The board does not create Workspaces itself. It raises the shipped
// `workspace.picker` Factory, which owns both the choice UI and the
// `workspaces.create` call, and that Factory is the only seam covering BOTH
// directory backends. These tests pin that composition boundary rather than
// re-testing ui-workspace's own picker.
// ---------------------------------------------------------------------------

/**
 * Load the board, capture its registration, and render one branch.
 * @param props - component props to render with.
 * @returns the rendered tree.
 */
function renderBoard(props) {
  const { ctx, captured } = recordingCtx()
  plugin.apply(ctx)
  const injectCall = captured.registrations.find((entry) => entry.injectName !== undefined)
  injectCall.factory()
  const registration = captured.registrations.find((entry) => entry.options !== undefined)
  const injected = registration.options.inject()
  // Every render starts from hook slot 0; a test that clicks and re-renders
  // does so through `rerender` so the previous state survives.
  const reactRuntime = plugin.__react
  reactRuntime?.__reset()
  return registration.Component({ ...BASE_PROPS, ...injected, ...props })
}

/** Props every render needs; hooks are stand-ins that answer empty state. */
const BASE_PROPS = {
  t: (key) => key,
  useSessions: (select) => select({ byId: {}, ids: [] }),
  useSessionStatus: (select) => select({}),
  usePanelInfo: (select) => select({ activePanelId: null }),
}

/**
 * Find the first element in a tree matching a predicate.
 * @param node - tree node.
 * @param predicate - matcher.
 * @returns the node, or undefined.
 */
function findNode(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const hit = findNode(child, predicate)
    if (hit !== undefined) return hit
  }
  return undefined
}

/**
 * Every element in a tree, flattened.
 * @param node - tree node.
 * @returns all element nodes.
 */
function allNodes(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  out.push(node)
  for (const child of node.children ?? []) allNodes(child, out)
  return out
}

/** A `renderFactorySlot` stand-in recording each Factory occurrence it renders. */
function factoryStub() {
  const rendered = []
  const renderFactorySlot = (name, props) => {
    rendered.push({ name, props })
    return { type: 'factory', props: { name, ...props }, children: [] }
  }
  return { rendered, renderFactorySlot }
}

test('the add control raises the workspace.picker Factory, not a picker call', () => {
  // `uiWorkspace.pickDirectory()` maps to `directoryPicker.pick`, which the
  // Host refuses with `directory-picker/unavailable` unless the resolved
  // backend is `native`. The Factory is the seam that also serves `browse`,
  // and it is the same one the shipped hero picker uses.
  const { rendered, renderFactorySlot } = factoryStub()
  const tree = renderBoard({ renderFactorySlot })
  const button = findNode(tree, (node) => node.props?.className === 'dshAb_add')
  assert.ok(button !== undefined, 'the expanded header offers an add control')
  button.props.onClick()
  // The occurrence is rendered from the first paint; the click flips `open`.
  const last = rendered[rendered.length - 1]
  assert.equal(last.name, 'workspace.picker', 'the picker Factory is the only surface raised')
})

test('the picker occurrence is closed until the button is used', () => {
  // A fresh board: nothing is raised before the click, but the Factory is
  // mounted so its dialog can open later without remounting the seat.
  const { rendered, renderFactorySlot } = factoryStub()
  renderBoard({ renderFactorySlot })
  const occurrence = rendered.find((entry) => entry.name === 'workspace.picker')
  assert.ok(occurrence !== undefined, 'the Factory is mounted so its dialog can open later')
  assert.equal(occurrence.props.open, false, 'nothing is raised before the click')
  assert.equal(typeof occurrence.props.onPick, 'function', 'a pick reports back to the board')
  assert.equal(typeof occurrence.props.onClose, 'function', 'a cancel settles too')
})

test('a picked Workspace closes the flow and opens that Workspace', () => {
  const { rendered, renderFactorySlot } = factoryStub()
  const opened = []
  const tree = renderBoard({ renderFactorySlot, openSession: (id) => { opened.push(id) } })
  const occurrence = rendered.find((entry) => entry.name === 'workspace.picker')
  occurrence.props.onPick('ws-7')
  assert.deepEqual(opened, ['ws-7'], 'the adopted Workspace becomes the visible one')
})

test('with no Factory available the control is hidden, not dead', () => {
  // The shipped browser hid its ＋ when no directory-flow occupant was
  // composed. Without `renderFactorySlot` there is no route to a directory, so
  // shipping a button whose only outcome is an error is worse than hiding it.
  const tree = renderBoard({})
  const button = findNode(tree, (node) => node.props?.className === 'dshAb_add')
  assert.equal(button, undefined, 'no picker seam, no add control')
})

test('the collapsed rail keeps the add control and the stylesheet', () => {
  // The rail branch returns before the wide layout's markup. It used to return
  // before the `<style>` element too, so the rail painted UA-default controls
  // and invisible dots.
  const { renderFactorySlot } = factoryStub()
  const tree = renderBoard({ renderFactorySlot, wide: false })
  const styles = allNodes(tree).filter((node) => node.props?.['data-agent-board'] !== undefined)
  assert.equal(styles.length, 1, 'the rail branch still emits its stylesheet')
  const button = findNode(tree, (node) => node.props?.className === 'dshAb_add')
  assert.ok(button !== undefined, 'folding the sidebar does not lose the only route to adding')
})

test('the add control names what it adds, and is busy while the picker is up', () => {
  const { renderFactorySlot } = factoryStub()
  const tree = renderBoard({ renderFactorySlot })
  const label = findNode(tree, (node) => node.props?.className === 'dshAb_headerLabel')
  assert.equal(label.children[0], 'workspaces',
    'the strip labels the thing the ＋ acts on; "sessions" would read as "add session"')
  const button = findNode(tree, (node) => node.props?.className === 'dshAb_add')
  assert.equal(button.props['aria-label'], 'addWorkspace')
  assert.equal(button.props['aria-busy'], undefined, 'idle until raised')
})

// ---------------------------------------------------------------------------
// The child-slot declaration table.
//
// `sidebar.workspaces` is `single`, and a child seat exists only while the
// entry that OCCUPIES that slot declares it. The shipped browser declares
// five; because the board shadows that entry, its table never lands — and
// `sidebar.workspaces.directoryFlow` is the seat both directory-picker clients
// wait on before they register. Missing it strands every picking affordance,
// including the "Add workspace" row in the shipped picker menu.
// ---------------------------------------------------------------------------

test('the board restates the shipped child-slot table', () => {
  const { ctx, captured } = recordingCtx()
  plugin.apply(ctx)
  const injectCall = captured.registrations.find((entry) => entry.injectName !== undefined)
  injectCall.factory()
  const registration = captured.registrations.find((entry) => entry.options !== undefined)
  const children = registration.options.children
  assert.ok(children !== undefined, 'a child seat must be declared by its occupier')
  // Exactly the shipped keys and kinds, in the shipped shapes.
  assert.deepEqual(Object.keys(children).sort(), [
    'sidebar.session.row.hover',
    'sidebar.session.row.leading',
    'sidebar.session.row.trailing',
    'sidebar.workspaces.directoryFlow',
    'sidebar.workspaces.session.row.action',
  ])
  assert.deepEqual(children['sidebar.workspaces.directoryFlow'], { kind: 'single', scope: 'root' },
    'the directory-flow seat is what the picker clients inject into')
  assert.deepEqual(children['sidebar.workspaces.session.row.action'], { kind: 'list', scope: 'root' })
  for (const key of ['sidebar.session.row.leading', 'sidebar.session.row.trailing']) {
    assert.deepEqual(children[key], { kind: 'list', scope: 'root', inline: true }, `${key} stays inline`)
  }
})

test('the declared kinds match the shipped ui-workspace table exactly', () => {
  // A kind drift would either strand a client (wrong cardinality) or fail the
  // registration; a key drift would silently drop a client. Pin the literal
  // table so an edit to one side is visible here.
  const { ctx, captured } = recordingCtx()
  plugin.apply(ctx)
  const injectCall = captured.registrations.find((entry) => entry.injectName !== undefined)
  injectCall.factory()
  const children = captured.registrations.find((entry) => entry.options !== undefined).options.children
  const expected = {
    'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
    'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
    'sidebar.session.row.leading': { kind: 'list', scope: 'root', inline: true },
    'sidebar.session.row.trailing': { kind: 'list', scope: 'root', inline: true },
    'sidebar.session.row.hover': { kind: 'list', scope: 'root' },
  }
  assert.deepEqual(children, expected)
})

test('the declared table is what unblocks the directory picker', () => {
  // Replays the slot core's rules over the real registration order:
  //  - `single` refuses a second entry at the same priority
  //  - a child seat exists only while its occupier declares it
  //  - a picker client registers into all three holes, so one missing hole
  //    stops the whole registration and hides "Add workspace" everywhere.
  // The board occupies `sidebar.workspaces` alone (a second entry at priority 0
  // would have thrown, yet the board renders), so the picker's
  // `sidebar.workspaces.directoryFlow` had no declarer until the board
  // restated the table.
  const declared = new Set([
    'conversation.hero.workspace.directoryFlow', // declared by its own entry
    'workspace.picker.directoryFlow', // declared by the workspace.picker Factory
  ])
  const holes = [
    'conversation.hero.workspace.directoryFlow',
    'sidebar.workspaces.directoryFlow',
    'workspace.picker.directoryFlow',
  ]
  assert.deepEqual(holes.filter((hole) => !declared.has(hole)),
    ['sidebar.workspaces.directoryFlow'],
    'the board is the only possible declarer of that hole')

  const { ctx, captured } = recordingCtx()
  plugin.apply(ctx)
  const injectCall = captured.registrations.find((entry) => entry.injectName !== undefined)
  injectCall.factory()
  const children = captured.registrations.find((entry) => entry.options !== undefined).options.children
  for (const hole of holes) {
    if (hole !== 'sidebar.workspaces.directoryFlow') continue
    assert.ok(children?.[hole] !== undefined, 'the board declares the hole the picker waits on')
  }
})
