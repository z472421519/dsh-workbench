/**
 * Browser half of `dsh-agent-board`.
 *
 * Occupies the sidebar's `sidebar.workspaces` seat — the whole browsing region
 * between the panel rows and the footer — and renders an agentbar-style live
 * board: four sections (needs you / running / recent / sleeping), one compact
 * row per Session with a status glyph, the title, and a relative timestamp.
 * Selecting a row opens that Session.
 *
 * Sleep is time-based only: a Session with no pending interaction, no running
 * work, and no update for `SLEEP_AFTER_MS` drops out of `recent` into
 * `sleeping`, so a long tail of stale conversations does not push live ones
 * off the panel.
 *
 * Rows come from `useSessions` and `useSessionStatus`, both already supplied by
 * the frame, so drawing the list retains no Session and reads no log.
 */

window.__ModuleLoader__.load({
  id: 'dsh-agent-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useMemo, useState } = React

    const NS = 'agentBoard'
    /** Sections, in display order. */
    const SECTIONS = ['attention', 'running', 'recent', 'sleeping']
    /** Rows shown per section before the "show more" row. */
    const SECTION_LIMIT = 12
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
      running: 0.55,
      done: 0.3,
      idle: 1,
      sleeping: 0.45,
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
.dshAb_root{display:flex;flex-direction:column;box-sizing:border-box;width:100%;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary)}
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
.dshAb_row::before{content:'';position:absolute;inset:0;border-radius:inherit;background:var(--dshAb-tint);opacity:calc(.12 * var(--dshAb-alpha,1));pointer-events:none;transition:opacity 120ms ease}
@media (hover:hover){.dshAb_row:hover::before{opacity:calc(.2 * var(--dshAb-alpha,1))}}
.dshAb_row[data-current]::before{opacity:calc(.22 * var(--dshAb-alpha,1))}
/* Keep the glyph and labels above the tint layer. */
.dshAb_row>span{position:relative;z-index:1}
.dshAb_row:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dshAb_glyph{flex:none;display:grid;place-items:center;width:12px;height:12px;font-size:10px;line-height:1}
.dshAb_glyph[data-state=sleeping]{opacity:.6}
.dshAb_name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Sleeping rows recede by their tint alone; the title keeps its normal color
   so a sleeping conversation still reads as a live link. */
.dshAb_time{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.dshAb_empty{padding:10px 6px;color:var(--dsw-alias-label-tertiary);font-size:${SMALL};line-height:20px}
.dshAb_more{width:100%;padding:3px 6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:16px;text-align:left;cursor:pointer}
@media (hover:hover){.dshAb_more:hover{color:var(--dsw-alias-label-secondary)}}
.dshAb_more:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dshAb_rail{display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 0}
.dshAb_railDot{width:6px;height:6px;border-radius:50%}
.dshAb_pulse{animation:dshAb_pulse 1.4s ease-in-out infinite}
@keyframes dshAb_pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.dshAb_chevron{transition:none}.dshAb_pulse{animation:none}}
`

    const ZH = {
      attention: '需操作',
      running: '运行中',
      recent: '最近',
      sleeping: '睡眠',
      empty: '还没有会话',
      showMore: (n) => `再显示 ${n} 个`,
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
      showMore: (n) => `Show ${n} more`,
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
      if (status?.completionUnread === true) {
        return { id: summary.id, title: summary.displayTitle, time: summary.updatedAt, state: 'done', detail: t('doneLabel') }
      }
      // Only a quiet Session can sleep: pending interaction and running work
      // returned above, so an approval never ages out of `attention`.
      if (now - summary.updatedAt >= SLEEP_AFTER_MS) {
        return { id: summary.id, title: summary.displayTitle, time: summary.updatedAt, state: 'sleeping', detail: '' }
      }
      return { id: summary.id, title: summary.displayTitle, time: summary.updatedAt, state: 'idle', detail: '' }
    }

    /** One status glyph, distinct in shape as well as color. */
    function Glyph({ state }) {
      const common = {
        className: 'dshAb_glyph',
        'data-state': state,
        style: { color: COLORS[state] ?? COLORS.idle },
        'aria-hidden': true,
      }
      if (state === 'attention') return h('span', common, '?')
      if (state === 'done') return h('span', common, '\u2713')
      if (state === 'running') return h('span', { ...common, className: 'dshAb_glyph dshAb_pulse' }, '\u25CF')
      if (state === 'sleeping') return h('span', common, '\u25CB')
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
      const [collapsed, setCollapsed] = useState({})
      const [shownLimit, setShownLimit] = useState(SECTION_LIMIT)

      const groups = useMemo(() => {
        const now = Date.now()
        const current = panelActive
          ? undefined
          : Object.values(list?.byId ?? {}).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id
        const buckets = { attention: [], running: [], recent: [], sleeping: [] }
        for (const id of list?.ids ?? []) {
          const summary = list.byId[id]
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
        return { current, buckets }
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

      const paged = (state) => state === 'recent' || state === 'sleeping'
      const rowsFor = (state) => (collapsed[state] === true
        ? []
        : groups.buckets[state].slice(0, paged(state) ? shownLimit : undefined))

      const section = (state) => {
        const all = groups.buckets[state]
        if (all.length === 0) return null
        const isOpen = collapsed[state] !== true
        const shown = rowsFor(state)
        const hidden = all.length - shown.length
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
            h('span', { className: 'dshAb_time' }, relative(row.time)))),
          paged(state) && hidden > 0
            ? h('button', {
              type: 'button',
              className: 'dshAb_more',
              onClick: () => { setShownLimit((value) => value + SECTION_LIMIT) },
            }, t('showMore')(hidden))
            : null)
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

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'agent-board: dictionaries')

        ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
          name: 'sidebar.workspaces',
          locale: NS,
          inject: () => ({
            /**
             * Open one Session in the conversation column, leaving the current
             * main panel for the Conversation.
             * @param sessionId - the row's Session.
             */
            openSession: (sessionId) => {
              const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
              workspace?.openSession(sessionId)
            },
          }),
        }, BoardSection))
      },
    }
  },
})
