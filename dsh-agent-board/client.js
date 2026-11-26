/**
 * Browser half of `dsh-agent-board`.
 *
 * Occupies the sidebar's `sidebar.workspaces` seat — the whole browsing region
 * between the panel rows and the footer — and renders an agentbar-style live
 * board: four sections (needs you / running / recent / sleeping), one compact
 * row per Session with a status glyph, the title, and a relative timestamp.
 * Selecting a row opens that Session.
 *
 * Ageing uses the only timestamp the list exposes. DSH derives
 * `summary.updatedAt` as `max(createdAt, lastPromptAt)` (see
 * `dsh-api-session-controller`'s list projection), so it is the last time the
 * human *asked*, not the last time the turn *ended* — a turn that ran all
 * night and just finished still carries last night's prompt time. The board
 * therefore never ages out a Session that carries an unread completion:
 * `sleeping` means "no update for `SLEEP_AFTER_MS`, nothing to report, not
 * running", so a long task that just landed stays in `recent`.
 *
 * Rows come from `useSessions` and `useSessionStatus`, both already supplied by
 * the frame, so drawing the list retains no Session and reads no log.
 */

window.__ModuleLoader__.load({
  id: 'dsh-agent-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useState } = React

    const NS = 'agentBoard'
    /** Sections, in display order. */
    const SECTIONS = ['attention', 'running', 'recent', 'sleeping']
    /**
     * Colors per state, following the agentbar palette rather than the
     * amber/green "traffic light" reading:
     *
     * | state     | agentbar              | here                        |
     * | --------- | --------------------- | --------------------------- |
     * | working   | cyan (`palette.info`) | business blue — no cyan     |
     * | waiting   | magenta (`accent`)    | violet                      |
     * | done      | green (`success`)     | green                       |
     * | idle      | white / dimmed        | gray                        |
     * | stale     | dimmed + sleep glyph  | gray, fainter               |
     *
     * Every value is still a theme token, so light/dark and brand overrides
     * apply. Two substitutions: the DSH palette ships no cyan family (so the
     * business accent stands in for agentbar's cyan) and no violet alias (so
     * one static step is named directly).
     */
    const COLORS = {
      /**
       * Waiting on the human. agentbar maps `waiting` to MAGENTA
       * (`agentbar/ui.py` LABELS + color pair 2), which is the lilac bubble in
       * the reference; violet is the closest DSH step, and it clears AA on both
       * sidebar backgrounds.
       */
      attention: 'var(--dsw-static-violet-400)',
      /** Live work: the business accent, so it follows light/dark like every alias. */
      running: 'var(--dsw-alias-state-business-primary)',
      /**
       * A finished turn: GREEN, matching agentbar's `done` -> COLOR_GREEN
       * (color pair 3), i.e. the green circled check in the reference.
       */
      done: 'var(--dsw-alias-state-success-primary)',
      /** Quiet: gray. */
      idle: 'var(--dsw-alias-label-caption)',
      /** Quiet and old: the same gray, drawn fainter. */
      sleeping: 'var(--dsw-alias-label-caption)',
    }


    /**
     * How long a Session may go without an update before it counts as
     * sleeping. Twelve hours: long enough that a conversation you paused over
     * lunch stays in `recent`, short enough that yesterday's work is out of
     * the way. Change this one constant to move the threshold.
     */
    const SLEEP_AFTER_MS = 12 * 60 * 60 * 1000

    const ZERO = 'var(--dsh-content-font-delta,0px)'
    const SMALL = 'var(--dsh-content-font-size-secondary,13px)'

    const CSS = `
.dshAb_root{display:flex;flex-direction:column;box-sizing:border-box;width:100%;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);--dshAb-nerd:'Symbols Nerd Font','Symbols Nerd Font Mono','MesloLGL Nerd Font','MesloLGM Nerd Font','MesloLGS Nerd Font','MesloLGLDZ Nerd Font','0xProto Nerd Font','JetBrainsMono Nerd Font','FiraCode Nerd Font'}
.dshAb_scroll{display:flex;flex-direction:column;gap:10px;box-sizing:border-box;width:100%;height:100%;min-height:0;padding:4px 8px 12px;overflow-y:auto}
/* Rows sit flush against each other: the separator is each row's own 1px
   bottom border, never a gap (a gap would let the sidebar background show
   through and break the single dark strip the reference draws). */
.dshAb_section{display:flex;flex-direction:column;flex:none}
.dshAb_head{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:4px 6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:16px;font-weight:500;letter-spacing:.02em;text-align:left;cursor:pointer}
@media (hover:hover){.dshAb_head:hover{color:var(--dsw-alias-label-secondary)}}
.dshAb_head:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dshAb_chevron{flex:none;width:8px;height:8px;transition:transform 120ms ease}
.dshAb_chevron[data-open]{transform:rotate(90deg)}
.dshAb_headCount{margin-left:auto;color:var(--dsw-alias-label-caption);font-weight:400}
/* One row: a full-width dark strip with a 4px state rail flush to its left
   edge, then icon, label, title, and the right-hand age. Square (2px) corners
   and a 1px bottom rule between rows, as in the agentbar reference. */
.dshAb_row{position:relative;display:flex;align-items:center;gap:7px;box-sizing:border-box;width:100%;min-height:30px;padding:4px 6px 4px 12px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:${SMALL};line-height:calc(20px + ${ZERO});text-align:left;cursor:pointer}
.dshAb_row::before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--dsw-alias-interactive-bg-hover);opacity:0;pointer-events:none;transition:opacity 120ms ease}
@media (hover:hover){.dshAb_row:hover::before{opacity:1}}
.dshAb_row[data-current]::before{opacity:1}
/* The only carried-over trait from the reference: a state-colored rail down
   the leading edge. Everything else stays the host's own list look. */
.dshAb_row::after{content:'';position:absolute;left:0;top:3px;bottom:3px;width:3px;border-radius:1.5px;background:var(--dshAb-tint);pointer-events:none}
/* Keep the glyph and labels above both overlay layers. */
.dshAb_row>span{position:relative;z-index:1}
/* The title takes the free width and is the only part allowed to shrink; the
   time beside it keeps its intrinsic width so the column of ages stays aligned. */
.dshAb_name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshAb_time{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.dshAb_empty{padding:12px 8px;color:var(--dsw-alias-label-tertiary);font-size:${SMALL};line-height:20px;text-align:center}
.dshAb_row:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
/* State icon in the state color, never shrinking. */
.dshAb_glyph{flex:none;display:grid;place-items:center;width:14px;height:14px;font-size:12px;line-height:1;font-family:var(--dshAb-nerd),var(--dsw-font-family)}
.dshAb_glyph[data-state=sleeping]{opacity:.6}
/* Collapsed 56px rail: one dot per state that has members. The dot needs a
   real box, or a color with no size paints nothing. */
.dshAb_rail{display:flex;flex-direction:column;align-items:center;gap:6px;box-sizing:border-box;width:100%;padding:10px 0}
.dshAb_railDot{flex:none;display:block;width:8px;height:8px;border-radius:50%}
@media (prefers-reduced-motion:reduce){.dshAb_chevron{transition:none}.dshAb_pulse{animation:none}}
`

    const ZH = {
      attention: '需操作',
      running: '运行中',
      recent: '最近',
      sleeping: '睡眠',
      empty: '还没有会话',
      sleepingHint: '12 小时内无更新的会话',
      collapse: '折叠',
      expand: '展开',
      approval: '等待审批',
      question: '等待回答',
      planReview: '等待确认计划',
      runningLabel: '运行中',
      doneLabel: '已完成',
    }
    const EN = {
      attention: 'Needs you',
      running: 'Running',
      recent: 'Recent',
      sleeping: 'Sleeping',
      empty: 'No sessions yet',
      sleepingHint: 'No update for 12 hours',
      collapse: 'Collapse',
      expand: 'Expand',
      approval: 'Waiting for approval',
      question: 'Waiting for an answer',
      planReview: 'Waiting for a plan review',
      runningLabel: 'Running',
      doneLabel: 'Done',
    }

    /**
     * Substitute the single `{n}` placeholder a count label carries.
     * @param template - localized label.
     * @param value - the count.
     * @returns the label with the count filled in.
     */
    function fill(template, value) {
      return typeof template === 'string' ? template.replace('{n}', String(value)) : String(value)
    }

    /**
     * Relative age of one timestamp.
     * @param time - epoch milliseconds.
     * @returns a compact age such as `3m`, `5h`, `2d`.
     */
    function relative(time) {
      const delta = Date.now() - time
      if (!Number.isFinite(delta) || delta < 60_000) return 'now'
      const minutes = Math.floor(delta / 60_000)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours}h`
      return `${Math.floor(hours / 24)}d`
    }

    /**
     * Fold one Session's list row and live status into a board entry.
     *
     * Precedence is: pending interaction, running, unread completion, sleep,
     * idle. The completion test comes *before* the age test on purpose: the
     * only timestamp the list exposes is the last prompt time, not the last
     * activity time, so a freshly finished long turn must not be aged out by
     * the age of the question that started it.
     * @param summary - the list row.
     * @param status - that Session's live UI status, when known.
     * @param t - active dictionary.
     * @param now - epoch milliseconds sampled once per render.
     * @returns the row model the board renders.
     */
    function entryOf(summary, status, t, now) {
      if (summary.blank) return undefined
      if (summary.origin === 'subagent') return undefined
      // Two titles, deliberately kept apart. `title` is what the row paints:
      // `displayTitle`, which falls back to the project basename and then the
      // session id. `storedTitle` is the durable name the Session actually
      // has, empty until one is projected or typed. The Session menu takes the
      // *stored* one — ui-workspace's row passes `row.title` — so the rename
      // dialog seeds its draft with the real name instead of prefilling a
      // directory-derived label the user then "confirms" into a rename.
      const base = {
        id: summary.id,
        title: summary.displayTitle,
        storedTitle: typeof summary.title === 'string' ? summary.title : '',
        time: summary.updatedAt,
      }
      const pending = status?.pendingInteraction
      if (pending !== undefined) {
        // The interaction's `kind` is a domain-owned discriminator; the three
        // the shipped domains use get their own sentence, anything else falls
        // back to the generic attention label.
        const label = pending.kind === 'approval' || pending.kind === 'permission-approval'
          ? t('approval')
          : pending.kind === 'question' || pending.kind === 'user-question'
            ? t('question')
            : pending.kind === 'plan-review'
              ? t('planReview')
              : t('attention')
        return { ...base, state: 'attention', detail: label }
      }
      if (status?.running === true || summary.running) {
        return { ...base, state: 'running', detail: t('runningLabel') }
      }
      // `completionUnread` is the only "a turn finished" evidence the client
      // holds: ui-session raises it when a Session it observed running stops,
      // and only while that Session sits outside the main view. It is therefore
      // deliberately *not* inferred from a title — DSH projects the title as
      // soon as the first user message commits, so a turn that failed or was
      // interrupted still carries one, and reading it as "done" painted failed
      // Sessions green. A Session in the main view has no completion marker at
      // all; it stays idle (or running) here rather than being guessed at.
      if (status?.completionUnread === true) {
        return { ...base, state: 'done', detail: t('doneLabel') }
      }
      // Age out last, on the only timestamp the list exposes. DSH defines
      // `summary.updatedAt` as `max(createdAt, lastPromptAt)` — the question
      // time, not the end-of-turn time — so it cannot date a turn's finish.
      // The safe reading is: a Session still carrying an unread completion
      // returned above and never sleeps, so a turn that ran all night does not
      // drop into the archive the moment it lands. Only a Session with nothing
      // to report and no question in `SLEEP_AFTER_MS` sleeps.
      if (now - summary.updatedAt >= SLEEP_AFTER_MS) {
        return { ...base, state: 'sleeping', detail: '' }
      }
      return { ...base, state: 'idle', detail: '' }
    }

    /**
     * Group every listed Session into the four board sections.
     *
     * Pure, and kept out of the component so the grouping rules can be
     * exercised without a renderer. Order inside `attention` and `running`
     * follows the frame's own list order; `recent` and `sleeping` are newest
     * first.
     * @param list - the Session list snapshot (`ids` plus `byId`).
     * @param statuses - the live status map, keyed by Session id.
     * @param t - active dictionary.
     * @param now - epoch milliseconds sampled once per render.
     * @returns one array per section, in `SECTIONS` order.
     */
    function bucketOf(list, statuses, t, now) {
      const buckets = { attention: [], running: [], recent: [], sleeping: [] }
      for (const id of list?.ids ?? []) {
        const summary = list.byId?.[id]
        if (summary === undefined) continue
        const entry = entryOf(summary, statuses?.get?.(id), t, now)
        if (entry === undefined) continue
        if (entry.state === 'attention') buckets.attention.push(entry)
        else if (entry.state === 'running') buckets.running.push(entry)
        else if (entry.state === 'sleeping') buckets.sleeping.push(entry)
        else buckets.recent.push(entry)
      }
      buckets.recent.sort((a, b) => b.time - a.time)
      buckets.sleeping.sort((a, b) => b.time - a.time)
      return buckets
    }

    /**
     * The rows one section actually renders.
     *
     * An expanded section renders every row it holds. There is no cap and no
     * "show more" control: the sidebar already gives the seat one scrolling
     * viewport (`.dshAb_scroll`), so a capped list would only make row 13+
     * permanently unreachable — and the "needs you" section is exactly where
     * hiding a row costs the most. A folded section renders nothing; its header
     * still shows the true count.
     * @param buckets - output of `bucketOf`.
     * @param collapsed - fold state per section.
     * @param state - the section to read.
     * @returns the rows to draw, or an empty array when folded.
     */
    function rowsFor(buckets, collapsed, state) {
      if (collapsed[state] === true) return []
      return buckets[state] ?? []
    }

    /**
     * Agentbar's own glyph set, from `agentbar-rs`'s sidebar renderer:
     * `nf-fa-comment` while waiting on you, `nf-md-check_circle` when done,
     * `nf-md-sleep` for a stale Session, and a braille spinner while working.
     * The first three live in the Private Use Area and render only when a Nerd
     * Font is installed; the braille spinner is ordinary Unicode.
     */
    const GLYPHS = {
      // Plane-16/15 code points need the braced form: '\uF0134' would instead be
      // U+F013 followed by the character "4".
      attention: '\u{F075}',
      done: '\u{F0134}',
      sleeping: '\u{F04B2}',
    }
    /** Braille spinner frames, exactly the pair sequence agentbar cycles. */
    const GLYPH_FRAMES = ['\u280B\u2819', '\u2819\u2839', '\u2839\u2838', '\u2838\u283C',
      '\u283C\u2834', '\u2834\u2826', '\u2826\u2827', '\u2827\u2807',
      '\u2807\u280F', '\u280F\u280B']
    /** Cadence of one spinner frame; agentbar redraws on the same order. */
    const SPINNER_INTERVAL_MS = 100

    /** Fallbacks that need no special font. */
    const FALLBACK = {
      attention: '?',
      done: '\u2713',
      sleeping: '\u25CB',
      running: '\u25CF',
    }

    /**
     * Whether the private-use glyphs actually paint in this browser.
     *
     * A family name is not evidence: an uninstalled font silently falls back to
     * a tofu box or a zero-width box. Measuring a PUA code point against a
     * wide reference distinguishes "a glyph in that cell" from "nothing there",
     * and a Nerd Font glyph is never wider than two Latin characters.
     */
    /** Families probed with FontFace; a missing family rejects rather than
     * silently measuring the fallback, which is what a canvas probe does. */
    const FONT_FACES = [
      'MesloLGL Nerd Font', 'MesloLGM Nerd Font', 'MesloLGS Nerd Font',
      'MesloLGLDZ Nerd Font', '0xProto Nerd Font',
      'JetBrainsMono Nerd Font', 'FiraCode Nerd Font',
    ]
    const ICON_FAMILY = 'DshBoardIcons'

    /**
     * Load a local Nerd Font and report whether an icon face is usable.
     *
     * `FontFace.load()` rejects when no listed `local()` source exists, so this
     * distinguishes a real face from a fallback. A canvas `measureText` probe
     * cannot: it measures whatever the fallback draws and reports a width for
     * both the icon and a known-missing code point.
     * @param FontFaceClass - the page's FontFace constructor.
     * @param fonts - `document.fonts`, when present.
     * @returns the installed face, or null when no icon font is available.
     */
    async function loadIconFace(FontFaceClass, fonts) {
      if (typeof FontFaceClass !== 'function' || fonts === undefined) return null
      const sources = FONT_FACES.map((family) => `local("${family}")`).join(', ')
      try {
        const face = new FontFaceClass(ICON_FAMILY, sources)
        await face.load()
        fonts.add(face)
        return face
      } catch {
        return null
      }
    }

    /**
     * The two-cell braille spinner.
     *
     * The frames are swapped in JavaScript rather than by a CSS animation:
     * `content` is not an animatable property in any current engine, so a
     * keyframe sequence over it renders the first frame and stops. A timer
     * advancing the index is the only way to get the character sequence
     * agentbar draws. Two cells per frame also keeps the glyph an even width,
     * so the title beside it never nudges sideways.
     * @param props - the shared glyph attributes and whether a Nerd Font paints.
     */
    function Spinner({ common }) {
      const [frame, setFrame] = useState(0)
      useEffect(() => {
        // Braille is ordinary Unicode, so the sequence runs without a Nerd
        // Font; a reader who asked for reduced motion keeps the first frame.
        const reduced = typeof window !== 'undefined'
          && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (reduced) return undefined
        const timer = setInterval(() => {
          setFrame((value) => (value + 1) % GLYPH_FRAMES.length)
        }, SPINNER_INTERVAL_MS)
        return () => { clearInterval(timer) }
      }, [])
      return h('span', common, GLYPH_FRAMES[frame] ?? GLYPH_FRAMES[0])
    }

    /**
     * One status glyph, distinct in shape as well as color.
     * @param props - the row state.
     * @returns the agentbar glyph, or its no-special-font fallback.
     */
    function Glyph({ state, iconFace }) {
      const common = {
        className: 'dshAb_glyph',
        'data-state': state,
        style: {
          color: COLORS[state] ?? COLORS.idle,
          // Only claim the icon family once FontFace actually loaded it.
          ...(iconFace === true ? { fontFamily: `${ICON_FAMILY}, monospace` } : {}),
        },
        'aria-hidden': true,
      }
      if (state === 'running') {
        return h(Spinner, { common })
      }
      if (iconFace === true) {
        const glyph = GLYPHS[state]
        if (glyph !== undefined) return h('span', common, glyph)
      }
      if (state === 'attention') return h('span', common, FALLBACK.attention)
      if (state === 'done') return h('span', common, FALLBACK.done)
      if (state === 'sleeping') return h('span', common, FALLBACK.sleeping)
      return h('span', common, '\u00B7')
    }

    /**
     * Props of one Session row, including the shared context-menu gesture.
     *
     * The menu itself is not ours: `ui-workspace` registers the Session
     * actions (pin, rename, fork, copy id, archive) on `ctx.contextMenus`
     * with `target: 'session'`, and the dialog they raise lives in
     * `shell.overlay`. All of that is owned by whoever renders the row, so
     * replacing `sidebar.workspaces` cut the only trigger: our row was a bare
     * `<button>` with `onClick` and never dispatched a context menu, which is
     * why right-click — and with it rename — did nothing.
     *
     * `getTriggerProps` is the frame's binding for that: it returns the
     * caller's handlers plus `onContextMenu`, the ContextMenu/Shift+F10
     * keyboard gesture and a focus stop, and captures the target when the
     * gesture runs. Passing the row's `onClick` through it keeps one code
     * path for both a plain click and a menu action.
     *
     * The target carries the row's **stored** title, matching what
     * ui-workspace's own row passes (`row.title`, empty until one exists). The
     * rename dialog seeds its draft from this value, so handing it the painted
     * `displayTitle` would prefill a project-basename fallback and turn a
     * no-op confirm into an accidental rename.
     * @param row - the entry being rendered.
     * @param current - id of the Session in the main view, when known.
     * @param open - opens one Session.
     * @param getTriggerProps - menu binding, or undefined when no menu plugin is composed.
     * @returns props for the row button.
     */
    function rowPropsOf(row, current, open, getTriggerProps) {
      const handlers = { onClick: () => { open(row.id) } }
      // The Session the menu acts on travels with the gesture, not with the
      // selection that may change while the menu is open.
      const menu = getTriggerProps === undefined
        ? undefined
        : getTriggerProps(
          { kind: 'session', value: { sessionId: row.id, displayTitle: row.storedTitle ?? '' } },
          handlers,
        )
      return {
        type: 'button',
        className: 'dshAb_row',
        key: row.id,
        'data-state': row.state,
        'data-current': row.id === current ? '' : undefined,
        style: { '--dshAb-tint': COLORS[row.state] ?? COLORS.idle },
        title: row.detail === '' ? row.title : `${row.title} — ${row.detail}`,
        ...(menu ?? handlers),
      }
    }

    /**
     * Render the sidebar board.
     * @param props - the shell's fold state plus the frame's selector hooks.
     */
    function BoardSection(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => EN[key] ?? key
      const wide = props.wide !== false
      const useSessions = props.useSessions
      const useSessionStatus = props.useSessionStatus
      const usePanelInfo = props.usePanelInfo
      const scroller = props.hooks?.sectionScroller
        ? props.hooks.sectionScroller()
        : undefined
      // `useContextMenu` is a plain prop the frame publishes to every seat
      // (`ctx.slots.provideRoot`), not a React hook, so reading it
      // unconditionally is safe and an unwired composition just loses the
      // gesture instead of throwing.
      const menuBindings = typeof props.useContextMenu === 'function'
        ? props.useContextMenu()
        : undefined
      const getTriggerProps = menuBindings?.getTriggerProps

      const list = useSessions ? useSessions((state) => state) : undefined
      const statuses = useSessionStatus ? useSessionStatus((state) => state) : undefined
      const panelActive = usePanelInfo ? usePanelInfo((info) => info.activePanelId !== null) : false
      // Sections that start folded. Sleeping is an archive, not something to
      // scan on every glance, so it costs one header until you open it.
      const [collapsed, setCollapsed] = useState({ sleeping: true })
      // Icon glyphs render only after the local face is confirmed usable; until
      // then the Unicode fallbacks keep the board readable.
      const [iconFace, setIconFace] = useState(false)
      useEffect(() => {
        let live = true
        let installed
        void loadIconFace(window.FontFace, document.fonts).then((face) => {
          if (!live || face === null) return
          installed = face
          setIconFace(true)
        })
        return () => {
          live = false
          if (installed !== undefined && document.fonts?.delete !== undefined) document.fonts.delete(installed)
        }
      }, [])


      const groups = useMemo(() => {
        const now = Date.now()
        const current = panelActive
          ? undefined
          : Object.values(list?.byId ?? {}).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id
        return { current, buckets: bucketOf(list, statuses, t, now) }
      }, [list, statuses, panelActive, t])

      const open = (id) => {
        const workspace = typeof props.openSession === 'function' ? props.openSession : undefined
        workspace?.(id)
      }

      const total = SECTIONS.reduce((sum, state) => sum + groups.buckets[state].length, 0)

      // The collapsed rail keeps one dot per state that has members, so the
      // attention state is still visible without expanding the sidebar.
      if (!wide) {
        const states = ['attention', 'running']
        const dots = states.filter((state) => groups.buckets[state].length > 0)
        return h('div', { className: 'dshAb_rail' },
          dots.length === 0
            ? h('span', {
              className: 'dshAb_railDot',
              style: { background: COLORS.idle },
              'aria-hidden': true,
            })
            : dots.map((state) => h('span', {
              key: state,
              className: 'dshAb_railDot dshAb_pulse',
              style: { background: COLORS[state] ?? COLORS.idle },
              title: `${t(state)}: ${groups.buckets[state].length}`,
            })))
      }

      // An expanded section renders every row it holds; a folded one renders
      // none. See `rowsFor` for why there is no cap any more.
      const shownFor = (state) => rowsFor(groups.buckets, collapsed, state)

      const section = (state) => {
        const all = groups.buckets[state]
        if (all.length === 0) return null
        const isOpen = collapsed[state] !== true
        const shown = shownFor(state)
        return h('div', { className: 'dshAb_section', key: state },
          h('button', {
            type: 'button',
            className: 'dshAb_head',
            'aria-expanded': isOpen,
            // A long section says what its threshold is, so the rule behind
            // the grouping is discoverable without reading the source.
            title: state === 'sleeping' ? t('sleepingHint') : isOpen ? t('collapse') : t('expand'),
            onClick: () => { setCollapsed((prev) => ({ ...prev, [state]: isOpen })) },
          },
            h('svg', {
              className: 'dshAb_chevron',
              viewBox: '0 0 8 8',
              'aria-hidden': true,
              'data-open': isOpen ? '' : undefined,
            }, h('path', {
              d: 'M2.5 1 5.5 4 2.5 7',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.3,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            })),
            h('span', null, t(state)),
            h('span', { className: 'dshAb_headCount' }, String(all.length))),
          ...shown.map((row) => h(
            'button',
            rowPropsOf(row, groups.current, open, getTriggerProps),
            h(Glyph, { state: row.state, iconFace }),
            h('span', { className: 'dshAb_name' }, row.title),
            h('span', { className: 'dshAb_time' }, relative(row.time)))))
      }

      return h(React.Fragment, null,
        h('style', { 'data-agent-board': '' }, CSS),
        h('div', { className: 'dshAb_root' },
          h('div', {
            className: 'dshAb_scroll',
            ref: scroller === undefined ? undefined : scroller.bindScrollerRef,
          },
            total === 0 ? h('div', { className: 'dshAb_empty' }, t('empty')) : null,
            ...SECTIONS.map(section))))
    }

    const plugin = {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'agent-board: dictionaries')

        ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
          name: 'sidebar.workspaces',
          locale: NS,
          inject: () => ({
            /**
             * Open one Session in the centre column: select it *and* show its
             * Conversation, then (only if neither is available) fall back to
             * merely revealing the Conversation.
             *
             * `UiWorkspace.openSession` is the documented navigation action
             * ("Select a Session and show its Conversation as one UI navigation
             * action" — `@deepseek-ai/dsh-client-ui-workspace/src/client/navigation.ts`),
             * and the service *is* reachable here: `UiWorkspaceService extends
             * Service` and calls `super(ctx, 'uiWorkspace')`, and Cordis's
             * `Service` constructor ends with `this.ctx.reflect.provide(name,
             * self, ...)`. So the module-private `new UiWorkspaceService(...)`
             * instance in `ui-workspace/src/client/index.ts` is still a
             * registered service; `ctx.get('uiWorkspace')` reads it. The
             * shipped `dsh-experimental-liveshare` relies on exactly that
             * (`inject = ['slots', 'locale', 'remote']`, then
             * `ctx.get('uiWorkspace')` and `workspace.openSession(...)`).
             *
             * `uiWorkspace` is NOT listed in `inject` on purpose: declaring it
             * makes Cordis gate `apply` on the service's presence, and an
             * earlier revision parked the whole plugin that way. Read lazily
             * through `ctx.get`, exactly as liveshare does; a missing service
             * then costs a fallback, not the board.
             *
             * `layout.selectPanel(null)` alone does not select a Session — it
             * only shows the Conversation panel — which is why clicking a row
             * changed nothing. It stays as the last-resort fallback.
             * @param sessionId - the row's Session.
             */
            openSession: (sessionId) => {
              const uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
              if (uiWorkspace !== undefined && typeof uiWorkspace.openSession === 'function') {
                try {
                  uiWorkspace.openSession(sessionId)
                  return
                } catch {
                  // A refused navigation must not swallow the fallback below.
                }
              }
              const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
              if (layout === undefined || typeof layout.selectPanel !== 'function') return
              try {
                layout.selectPanel(null)
              } catch {
                // An unregistered main key must not throw out of a click handler.
              }
            },
          }),
        }, BoardSection))
      },
    }

    // Test seam: the pure helpers and the stylesheet, reachable from Node
    // without a renderer. Off by default, so the object the Host loads keeps
    // exactly the two keys a Cordis plugin declares.
    if (globalThis.__DSH_AGENT_BOARD_TEST__ === true) {
      plugin.testing = {
        entryOf, bucketOf, rowsFor, rowPropsOf, CSS, SLEEP_AFTER_MS, loadIconFace, ICON_FAMILY, FONT_FACES, GLYPHS,
      }
    }

    return plugin
  },
})
