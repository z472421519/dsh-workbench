/**
 * Browser half of `dsh-high-level`.
 *
 * Two contributions, both built on the host's existing command lifecycle:
 * - a summary card replacing the generic row for a settled `/hl` run, so the
 *   result reads as one collapsed panel instead of a command line;
 * - one icon action in the finalized assistant message's action row, which
 *   runs `/hl #<messageId>` for exactly that reply.
 *
 * A `/hl` that answers a status or model question keeps the plain command
 * row: the card is selected by the reply's own shape, not by the command name.
 */

window.__ModuleLoader__.load({
  id: 'dsh-high-level',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    const NS = 'highLevel'
    /** Body lines shown before the card is expanded. */
    const COLLAPSED_LINES = 5

    const ZERO = 'var(--dsh-content-font-delta,0px)'
    const SMALL = 'var(--dsh-content-font-size-secondary,13px)'
    /** A duration segment such as `1.2s` or `11s`, ending the detail line. */
    const DURATION = /^\d+(?:\.\d+)?s$/u

    const CSS = `
/* The card carries the harness business blue instead of the neutral code-block
   fill, so a summary reads as its own surface beside the transcript. The tint
   is mixed into the theme's own code-block token, never a literal color: light
   and dark both keep their intended weight, and the blue follows the palette
   the way every other accent in the app does.
   --dshHl-accent is the one knob. Unset, it takes the business accent; a theme
   or host page may define it on any ancestor to recolor the card without
   touching this bundle. Percentages are tuned so the existing body and header
   label steps keep their contrast on the tinted fill (>= 4.9:1 for the small
   secondary text in light, higher in dark). */
.dshHl_card{--dshHl-tint:var(--dshHl-accent,var(--dsw-alias-state-business-primary));--dshHl-surface:color-mix(in srgb, var(--dshHl-tint) 9%, var(--dsw-alias-markdown-code-block));--dshHl-edge:color-mix(in srgb, var(--dshHl-tint) 28%, transparent);display:flex;flex-direction:column;box-sizing:border-box;width:100%;border:.5px solid var(--dshHl-edge);border-radius:var(--dsw-radius-lg);background:var(--dshHl-surface);overflow:hidden}
/* A failed summary keeps the neutral fill: the red body stays the only signal,
   and an error card is never mistaken for a completed summary. The marker and
   border take the error step so no blue survives on a failed card. */
.dshHl_card[data-error]{--dshHl-tint:var(--dsw-alias-state-error-primary);--dshHl-surface:var(--dsw-alias-markdown-code-block);--dshHl-edge:var(--dsw-alias-border-l1)}
.dshHl_head{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:8px 12px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:${SMALL};line-height:calc(20px + ${ZERO});text-align:left;cursor:pointer}
.dshHl_head[data-static]{cursor:default}
@media (hover:hover){.dshHl_head:hover:not([data-static]){background:var(--dsw-alias-interactive-bg-hover)}}
.dshHl_head:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
/* The leading rule repeats the fill's accent instead of the near-black (light)
   brand step, which read as a neutral marker once the card itself is blue. */
.dshHl_badge{flex:none;width:2px;height:14px;border-radius:1px;background:var(--dshHl-tint)}
.dshHl_title{flex:none}
.dshHl_meta{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}
.dshHl_chevron{flex:none;width:12px;height:12px;transition:transform 120ms ease}
.dshHl_chevron[data-open]{transform:rotate(180deg)}
.dshHl_body{padding:0 12px 10px;color:var(--dsw-alias-label-primary);font-size:${SMALL};line-height:calc(21px + ${ZERO});white-space:pre-wrap;word-break:break-word}
.dshHl_body[data-error]{color:var(--dsw-alias-state-error-primary)}
.dshHl_more{padding:0 12px 10px;color:var(--dsw-alias-label-tertiary);font-size:calc(${SMALL} - 1px);line-height:20px}
.dshHl_shimmer{background:linear-gradient(90deg,var(--dsw-alias-label-tertiary) 0%,var(--dsw-alias-label-primary) 50%,var(--dsw-alias-label-tertiary) 100%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:dshHl_shimmer 1.8s linear infinite}
@keyframes dshHl_shimmer{from{background-position:100% 0}to{background-position:-100% 0}}
.dshHl_action{display:inline-flex;align-items:center;justify-content:center;width:calc(28px + ${ZERO});height:calc(28px + ${ZERO});padding:6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dshHl_action svg{width:calc(17px + ${ZERO});height:calc(17px + ${ZERO})}
@media (hover:hover){.dshHl_action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.dshHl_action:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dshHl_action:disabled{cursor:default;opacity:.4}
.dshHl_action[data-done]{color:var(--dsw-alias-brand-primary)}
.dshHl_failure{max-width:320px;padding-left:4px;overflow:hidden;color:var(--dsw-alias-state-error-primary);font-size:${SMALL};line-height:20px;text-overflow:ellipsis;white-space:nowrap}
@media (prefers-reduced-motion:reduce){.dshHl_chevron{transition:none}.dshHl_shimmer{animation:none;color:var(--dsw-alias-label-tertiary)}}
`

    const ZH = {
      title: '高层总结',
      running: '正在总结…',
      failed: '总结失败',
      expand: '展开全部',
      collapse: '收起',
      more: '未显示的行',
      action: '追加高层总结',
      done: '已生成总结',
      info: '/hl 结果',
    }
    const EN = {
      title: 'High-level summary',
      running: 'Summarizing…',
      failed: 'Summary failed',
      expand: 'Show all',
      collapse: 'Collapse',
      more: 'more lines',
      action: 'Add a high-level summary',
      done: 'Summary added',
      info: '/hl result',
    }

    /**
     * Whether one Session is a subagent conversation, which exposes no slash
     * command surface.
     * @param ctx - the client plugin context.
     * @param sessionId - Session being rendered.
     * @returns true when the Session belongs to a subagent.
     */
    function isSubagentSession(ctx, sessionId) {
      const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
      if (sessions === undefined || typeof sessions.subagentAddress !== 'function') return false
      try {
        return sessions.subagentAddress(sessionId) !== undefined
      } catch {
        return false
      }
    }

    function Chevron(props) {
      return h('svg', {
        className: 'dshHl_chevron',
        viewBox: '0 0 12 12',
        'aria-hidden': true,
        ...props,
      }, h('path', {
        d: 'M2.5 4.5 6 8l3.5-3.5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    /**
     * Read a summary's detail line, if the first row is one.
     * Accepts both `<n> lines · <n> chars · …` and the older
     * `High-level summary · <n> lines · …` spelling.
     * @param rows - the reply split into lines.
     * @returns the detail line without any leading label, or '' when absent.
     */
    function detailLine(rows) {
      const first = rows[0]
      if (first === undefined || rows.length < 2) return ''
      const parts = first.split(' · ')
      if (parts.length < 3) return ''
      if (!DURATION.test(parts[parts.length - 1])) return ''
      if (parts[0] === EN.title) return parts.slice(1).join(' · ')
      return first
    }

    /**
     * Render one settled `/hl` summary as a collapsed card.
     * @param props - the command row owner payload plus the locale `t` seat.
     */
    function HighLevelCard(props) {
      const node = props.node
      const t = typeof props.t === 'function' ? props.t : (key) => EN[key] ?? key
      const outcome = node === undefined ? null : node.outcome
      const running = outcome === null
      const failed = outcome !== null && outcome.kind === 'error'
      const [open, setOpen] = useState(false)
      const [elapsed, setElapsed] = useState(0)
      // A running row reports how long the request has been open, so a slow
      // model never looks like a hang.
      const startedAt = useRef(Date.now())
      useEffect(() => {
        if (!running) return undefined
        const timer = setInterval(() => { setElapsed(Math.round((Date.now() - startedAt.current) / 1000)) }, 1000)
        return () => { clearInterval(timer) }
      }, [running])

      const text = outcome === null || outcome.text === undefined ? '' : outcome.text
      const rows = text === '' ? [] : text.split('\n')
      // The detail line is recognized by its own shape rather than a fixed
      // prefix, so this card also renders output written by an older host
      // build. Anything unrecognized stays visible as an ordinary card body.
      const meta = !running && !failed ? detailLine(rows) : ''
      const bodyRows = meta === '' ? rows : rows.slice(1)
      // A `status` or `model` answer is not a summary: it keeps the neutral
      // title so the card never claims to report a summary it does not have.
      const isSummary = running || failed || meta !== ''
      const expandable = !running && !failed && bodyRows.length > COLLAPSED_LINES
      const shown = open || !expandable ? bodyRows : bodyRows.slice(0, COLLAPSED_LINES)
      const hidden = bodyRows.length - shown.length

      const title = running
        ? t('running')
        : failed ? t('failed') : isSummary ? t('title') : t('info')
      const headerMeta = running && elapsed > 0 ? `${elapsed}s` : meta
      const onToggle = expandable ? () => { setOpen((value) => !value) } : undefined

      const children = [
        h('span', { key: 'badge', className: 'dshHl_badge', 'aria-hidden': true }),
        h('span', {
          key: 'title',
          className: running ? 'dshHl_title dshHl_shimmer' : 'dshHl_title',
        }, title),
        headerMeta === '' ? null : h('span', { key: 'meta', className: 'dshHl_meta' }, headerMeta),
        expandable ? h(Chevron, { key: 'chevron', 'data-open': open ? '' : undefined }) : null,
      ]
      // A header with nothing to expand is not a control: no tab stop, no
      // button semantics.
      const head = expandable
        ? h('button', {
          type: 'button',
          className: 'dshHl_head',
          'aria-expanded': open,
          title: open ? t('collapse') : t('expand'),
          onClick: onToggle,
        }, children)
        : h('div', { className: 'dshHl_head', 'data-static': '' }, children)

      return h(React.Fragment, null,
        h('style', { 'data-high-level': '' }, CSS),
        h('div', { className: 'dshHl_card', 'data-error': failed ? '' : undefined },
          head,
          bodyRows.length === 0 ? null : h('div',
            { className: 'dshHl_body', 'data-error': failed ? '' : undefined }, shown.join('\n')),
          hidden > 0 ? h('div', { className: 'dshHl_more' }, `+${hidden} ${t('more')}`) : null))
    }

    /**
     * One icon action that summarizes this message through `/hl #<messageId>`.
     * @param props - the message identity, the injected command channel, and locale copy.
     */
    function SummaryAction(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => EN[key] ?? key
      const [pending, setPending] = useState(false)
      const [failure, setFailure] = useState(null)
      const [done, setDone] = useState(false)
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])
      // Subagent conversations have no command surface, so the action is
      // absent there instead of failing on click.
      if (props.available === false) return null

      const run = () => {
        if (pending) return
        setPending(true)
        setFailure(null)
        void props.run(`/hl #${props.messageId}`).then((message) => {
          if (!alive.current) return
          if (message === null) setDone(true)
          else setFailure(message)
        }).finally(() => {
          if (alive.current) setPending(false)
        })
      }

      const label = done ? t('done') : t('action')
      return h(React.Fragment, null,
        h('style', { 'data-high-level': '' }, CSS),
        h('button', {
          type: 'button',
          className: 'dshHl_action',
          'aria-label': label,
          title: label,
          'data-done': done ? '' : undefined,
          'aria-disabled': done || undefined,
          disabled: pending || done,
          onClick: done ? undefined : run,
        }, h('svg', { viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none' },
          h('rect', { x: 2.5, y: 3.5, width: 11, height: 2, rx: 1, fill: 'currentColor' }),
          h('rect', { x: 4.5, y: 7.2, width: 7, height: 1.6, rx: 0.8, fill: 'currentColor', fillOpacity: 0.75 }),
          h('rect', { x: 4.5, y: 10.2, width: 5, height: 1.6, rx: 0.8, fill: 'currentColor', fillOpacity: 0.75 }))),
        failure === null ? null : h('span', { className: 'dshHl_failure', role: 'status', title: failure }, failure))
    }

    const plugin = {
      inject: ['slots', 'remote', 'remote.commands', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'high-level: dictionaries')

        ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
          name: 'conversation.chat.commandview',
          key: 'hl',
          locale: NS,
        }, HighLevelCard))

        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'high-level',
          order: 20,
          locale: NS,
          inject: (sessionId) => ({
            available: !isSubagentSession(ctx, sessionId),
            /**
             * Execute one `/hl` line against this Session's agent. The Remote
             * acknowledges admission; a refused or failed run arrives as its
             * own result, which becomes the inline failure line.
             * @param line - the full command line.
             * @returns a user-visible failure line, or null when the summary landed.
             */
            run: async (line) => {
              try {
                const result = await ctx.remote.commands.execute(sessionId, line, [])
                if (!result.ok) return `${result.error?.message ?? 'command failed'} (${result.error?.code ?? 'error'})`
                const settled = result.value?.result
                if (settled === undefined) return 'the /hl command is not available here'
                if (settled.kind === 'error') return settled.text
                return null
              } catch (error) {
                return error instanceof Error ? error.message : String(error)
              }
            },
          }),
        }, SummaryAction))
      },
    }

    // Test seam: no browser is started here, so the stylesheet is asserted as
    // text by `tests/high-level-css.test.mjs`.
    if (globalThis.__DSH_HIGH_LEVEL_TEST__ === true) plugin.testing = { CSS, detailLine, ZH, EN }

    return plugin
  },
})
