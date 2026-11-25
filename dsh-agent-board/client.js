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
       * Waiting on the human: violet. The theme has no violet alias, so this is
       * the one hard-coded static step; it clears AA on both sidebar
       * backgrounds.
       */
      attention: 'var(--dsw-static-violet-400)',
      /** Live work: the business accent, so it follows light/dark like every alias. */
      running: 'var(--dsw-alias-state-business-primary)',
      /** A finished turn: green. */
      done: 'var(--dsw-alias-state-success-primary)',
      /** Quiet: gray. */
      idle: 'var(--dsw-alias-label-caption)',
      /** Quiet and old: the same gray, drawn fainter. */
      sleeping: 'var(--dsw-alias-label-caption)',
    }

    /**
     * Strength of the whole-row tint per state. The tint is the state color at
     * this alpha, so the strip reads as colored without the text losing
     * contrast. Set a state to 0 to keep its rows flat.
     */
    const TINTS = {
      attention: 1,
      running: 0.8,
      done: 0.65,
      idle: 0.8,
      sleeping: 0.4,
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
.dshAb_root{display:flex;flex-direction:column;box-sizing:border-box;width:100%;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);--dshAb-nerd:'Symbols Nerd Font','Symbols Nerd Font Mono','Nerd Font Symbols','MesloLGS NF','MesloLGL Nerd Font','0xProto Nerd Font'}
.dshAb_scroll{display:flex;flex-direction:column;gap:10px;box-sizing:border-box;width:100%;height:100%;min-height:0;padding:4px 8px 12px;overflow-y:auto}
.dshAb_section{display:flex;flex-direction:column;gap:1px;flex:none}
.dshAb_head{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:4px 6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:16px;font-weight:500;letter-spacing:.02em;text-align:left;cursor:pointer}
@media (hover:hover){.dshAb_head:hover{color:var(--dsw-alias-label-secondary)}}
.dshAb_head:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dshAb_chevron{flex:none;width:8px;height:8px;transition:transform 120ms ease}
.dshAb_chevron[data-open]{transform:rotate(90deg)}
.dshAb_headCount{margin-left:auto;color:var(--dsw-alias-label-caption);font-weight:400}
.dshAb_row{position:relative;display:flex;align-items:center;gap:7px;box-sizing:border-box;width:100%;min-height:28px;padding:4px 6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:${SMALL};line-height:calc(18px + ${ZERO});text-align:left;cursor:pointer}
/* The whole strip carries the state color as a low-alpha tint; the text keeps
   its theme foreground, so contrast never depends on the accent. */
.dshAb_row::before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--dshAb-tint);opacity:calc(.2 * var(--dshAb-alpha,1));pointer-events:none;transition:opacity 120ms ease}
@media (hover:hover){.dshAb_row:hover::before{opacity:calc(.32 * var(--dshAb-alpha,1))}}
.dshAb_row[data-current]::before{opacity:calc(.36 * var(--dshAb-alpha,1))}
/* Keep the glyph and labels above the tint layer. */
/* A 3px rail in the state color carries the state where a faint tint cannot. */
.dshAb_row::after{content:'';position:absolute;left:0;top:4px;bottom:4px;width:3px;border-radius:2px;background:var(--dshAb-tint);opacity:var(--dshAb-alpha,1);pointer-events:none}
.dshAb_row>span{position:relative;z-index:1}
/* The title takes the free width and is the only part allowed to shrink; the
   time beside it keeps its intrinsic width so the column of ages stays aligned. */
.dshAb_name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshAb_time{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.dshAb_empty{padding:12px 8px;color:var(--dsw-alias-label-tertiary);font-size:${SMALL};line-height:20px;text-align:center}
.dshAb_row:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
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
        return { id: summary.id, title: summary.displayTitle, time: summary.updatedAt, state: 'attention', detail: label }
      }
      if (status?.running === true || summary.running) {
        return { id: summary.id, title: summary.displayTitle, time: summary.updatedAt, state: 'running', detail: t('runningLabel') }
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
        return { id: summary.id, title: summary.displayTitle, time: summary.updatedAt, state: 'done', detail: t('doneLabel') }
      }
      // Age out last, on the only timestamp the list exposes. DSH defines
      // `summary.updatedAt` as `max(createdAt, lastPromptAt)` — the question
      // time, not the end-of-turn time — so it cannot date a turn's finish.
      // The safe reading is: a Session still carrying an unread completion
      // returned above and never sleeps, so a turn that ran all night does not
      // drop into the archive the moment it lands. Only a Session with nothing
      // to report and no question in `SLEEP_AFTER_MS` sleeps.
      if (now - summary.updatedAt >= SLEEP_AFTER_MS) {
        return { id: summary.id, title: summary.displayTitle, time: summary.updatedAt, state: 'sleeping', detail: '' }
      }
      return { id: summary.id, title: summary.displayTitle, time: summary.updatedAt, state: 'idle', detail: '' }
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
      attention: '\uF075',
      done: '\uF0134',
      sleeping: '\uF04B2',
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
    let nerdFontState
    function hasNerdFont() {
      if (nerdFontState !== undefined) return nerdFontState
      nerdFontState = false
      try {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (context === null) return nerdFontState
        const pua = String.fromCodePoint(0xF0134)
        context.font = '32px monospace'
        const notdef = context.measureText(pua).width
        // Compare against a box drawn with a known-missing code point in the
        // same cell: identical widths mean both are the fallback box.
        const missing = context.measureText(String.fromCodePoint(0x10FFFD)).width
        nerdFontState = notdef > 0 && notdef !== missing
      } catch {
        nerdFontState = false
      }
      return nerdFontState
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
    function Glyph({ state }) {
      const nerd = hasNerdFont()
      const common = {
        className: 'dshAb_glyph',
        'data-state': state,
        style: { color: COLORS[state] ?? COLORS.idle },
        'aria-hidden': true,
      }
      if (state === 'running') {
        return h(Spinner, { common })
      }
      if (nerd) {
        const glyph = GLYPHS[state]
        if (glyph !== undefined) return h('span', common, glyph)
      }
      if (state === 'attention') return h('span', common, FALLBACK.attention)
      if (state === 'done') return h('span', common, FALLBACK.done)
      if (state === 'sleeping') return h('span', common, FALLBACK.sleeping)
      return h('span', common, '\u00B7')
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

      const list = useSessions ? useSessions((state) => state) : undefined
      const statuses = useSessionStatus ? useSessionStatus((state) => state) : undefined
      const panelActive = usePanelInfo ? usePanelInfo((info) => info.activePanelId !== null) : false
      // Sections that start folded. Sleeping is an archive, not something to
      // scan on every glance, so it costs one header until you open it.
      const [collapsed, setCollapsed] = useState({ sleeping: true })


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
          ...shown.map((row) => h('button', {
            type: 'button',
            className: 'dshAb_row',
            key: row.id,
            'data-state': row.state,
            'data-current': row.id === groups.current ? '' : undefined,
            style: {
              '--dshAb-tint': COLORS[row.state] ?? COLORS.idle,
              '--dshAb-alpha': String(TINTS[row.state] ?? 0.12),
            },
            title: row.detail === '' ? row.title : `${row.title} — ${row.detail}`,
            onClick: () => { open(row.id) },
          },
            h(Glyph, { state: row.state }),
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
             * Bring the Conversation back to the centre column.
             *
             * `uiWorkspace` is a module-private instance inside
             * `dsh-client-ui-workspace`, never a registered service, so reading
             * it off the context yields `undefined` and the click did nothing.
             * The public path is the layout service: `selectPanel(null)` shows
             * the Conversation, and selecting the Session itself is the frame's
             * job once that panel is visible.
             *
             * `layout` is deliberately NOT listed in `inject`: declaring a
             * service there gates `apply`, and an earlier revision gated it on a
             * service that does not exist, which left the whole board unregistered.
             * @param sessionId - the row's Session.
             */
            openSession: (sessionId) => {
              void sessionId
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
      plugin.testing = { entryOf, bucketOf, rowsFor, CSS, SLEEP_AFTER_MS }
    }

    return plugin
  },
})
