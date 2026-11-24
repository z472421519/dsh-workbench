/**
 * Host half of `dsh-high-level`: the `/hl` command that appends a high-level
 * summary card for one assistant reply.
 *
 * The summary is recorded through the ordinary command lifecycle
 * (`command/run` + `command/done`), so Chat renders it as a normal command row
 * below the turn and it stays in the Session log without any new event type.
 * The summarized reply itself is never rewritten and the model never receives
 * the summary as context.
 *
 * No package imports: Context services and the recorded Session facts are the
 * whole dependency surface, so the bundle loads in any composed profile.
 */

/** Cordis plugin name; the loader row id matches it. */
export const name = 'high-level'

/** Human-command registry and model runtime are mandatory. */
export const inject = ['commands', 'llm']

/** Reply budgets for one summary request. */
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_TOKENS = 400
const DEFAULT_MAX_INPUT_CHARS = 16_000
const DEFAULT_MIN_REPLY_CHARS = 160
const DEFAULT_MIN_REPLY_LINES = 4

const USAGE = 'Usage: /hl [n | #messageId | model <auto|current|provider/id> | status]'

/** Read the accepted configuration with defaults applied. */
function settings(input) {
  const config = input !== null && typeof input === 'object' ? input : {}
  const positive = (value, fallback) => typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback
  return {
    model: typeof config.model === 'string' ? config.model.trim() : '',
    timeoutMs: Math.min(120_000, positive(config.timeoutMs, DEFAULT_TIMEOUT_MS)),
    maxOutputTokens: positive(config.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS),
    maxInputChars: positive(config.maxInputChars, DEFAULT_MAX_INPUT_CHARS),
    minReplyChars: positive(config.minReplyChars, DEFAULT_MIN_REPLY_CHARS),
    minReplyLines: positive(config.minReplyLines, DEFAULT_MIN_REPLY_LINES),
  }
}

/** Join the text blocks of one message content array. */
function textOf(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    const text = block.text.trim()
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}

/** Count non-empty lines. */
function lineCount(text) {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).length
}

/** Whether a reply is too short to be worth summarizing. */
function isBrief(reply, config) {
  return reply.length < config.minReplyChars && lineCount(reply) < config.minReplyLines
}

/** Clip long text in the middle so both the opening and the conclusion survive. */
function clip(text, limit) {
  if (text.length <= limit) return text
  const half = Math.floor(limit / 2)
  return `${text.slice(0, half)}\n\n[...middle omitted...]\n\n${text.slice(-half)}`
}

/** Collect text-bearing assistant replies with the prompt that produced them. */
function repliesOf(messages) {
  const replies = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message === null || typeof message !== 'object' || message.role !== 'assistant') continue
    const text = textOf(message.content)
    if (!text) continue
    let question = ''
    for (let back = index - 1; back >= 0; back -= 1) {
      const candidate = messages[back]
      if (candidate?.role !== 'user') continue
      question = textOf(candidate.content)
      break
    }
    replies.push({ id: message.id === undefined ? undefined : String(message.id), text, question })
  }
  return replies
}

/** Resolve the route the Session's latest request used. */
function routeOf(session) {
  const context = typeof session.requestContext === 'function' ? session.requestContext() : undefined
  if (typeof context?.provider === 'string' && typeof context?.model === 'string') {
    return { provider: context.provider, model: context.model }
  }
  const header = typeof session.requestHeader === 'function' ? session.requestHeader() : undefined
  const config = header?.config
  if (typeof config?.provider === 'string' && typeof config?.model === 'string') {
    return { provider: config.provider, model: config.model }
  }
  return undefined
}

/** Resolve the summary route from the setting, falling back to the Session route. */
function chooseRoute(session, setting) {
  const current = routeOf(session)
  const requested = setting.trim()
  if (!requested || requested === 'current' || requested === 'auto') return current
  const slash = requested.indexOf('/')
  if (slash > 0) {
    return { provider: requested.slice(0, slash), model: requested.slice(slash + 1) }
  }
  if (current === undefined) return undefined
  return { provider: current.provider, model: requested }
}

/** Build the one-shot summarization instruction. */
function summaryPrompt(reply, config) {
  const answer = clip(reply.text, config.maxInputChars).replaceAll('</reply>', '</ reply>')
  const lines = [
    'Summarize one assistant reply at a high level.',
    "Write 3 to 5 short bullet lines, in the reply's own language.",
    'State the conclusion, the key decision or trade-off, and the concrete result or next step.',
    'Do not repeat intermediate steps, tool names, code blocks, or long file lists.',
    'Do not add a title or a preamble.',
  ]
  if (reply.question) {
    lines.push('', '<question>', clip(reply.question, 1200).replaceAll('</question>', '</ question>'), '</question>')
  }
  lines.push('', '<reply>', answer, '</reply>')
  return lines.join('\n')
}

/** Run one summary request and return its text. */
async function requestSummary(ctx, session, reply, config, signal) {
  const route = chooseRoute(session, config.model)
  if (route === undefined) {
    throw new Error('no recorded model route yet; send one message first')
  }
  const call = await ctx.llm.prepareCall(
    { provider: route.provider, model: route.model },
    signal,
    (controls) => ({ ...controls, maxTokens: config.maxOutputTokens }),
  )
  const request = {
    ...call.config,
    messages: [{ role: 'user', content: [{ type: 'text', text: summaryPrompt(reply, config) }] }],
    signal,
  }
  let text = ''
  let failure
  for await (const chunk of call.stream(request)) {
    if (chunk.type === 'text-delta') text += chunk.text
    if (chunk.type === 'finish' && chunk.reason.kind === 'error') failure = chunk.reason.failure
    if (chunk.type === 'finish' && chunk.reason.kind === 'aborted') failure = chunk.reason.failure
  }
  if (failure) throw new Error(failure.message ?? failure.code ?? 'model request failed')
  const summary = text.trim()
  if (!summary) throw new Error('the model returned no summary text')
  return { summary, route }
}

/** Format one settled summary as the command row's text. */
function cardText(summary, route, reply, elapsedMs) {
  const seconds = (elapsedMs / 1000).toFixed(elapsedMs < 10_000 ? 1 : 0)
  const bullets = lineCount(summary)
  // The first line is the card's detail line; its shape is what the browser
  // card recognizes, so status and model replies stay ordinary command rows.
  return [
    `${bullets} lines · ${reply.text.length} chars · ${route.provider}/${route.model} · ${seconds}s`,
    summary,
  ].join('\n')
}

/** Persist the chosen summary model in the profile patch. */
async function saveModel(ctx, spec) {
  const fiber = ctx.fiber
  const entry = fiber?.entry
  const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined
  if (entry === undefined || editor === undefined) return false
  await editor.edit(entry, (current) => ({ ...current, model: spec }))
  return true
}

/**
 * Register `/hl` on the command registry.
 * @param ctx - Host context carrying commands and the model runtime.
 * @param config - optional row configuration from the profile patch.
 */
export function apply(ctx, config = {}) {
  const runtime = settings(config)

  ctx.effect(() => ctx.commands.register({
    name: 'hl',
    description: 'Append a high-level summary card for one assistant reply',
    input: { hint: '[n | #messageId | model <spec> | status]' },
    async handler(invocation) {
      const argument = invocation.rawInput.trim()
      const setting = settings(config)

      if (argument === 'status') {
        const session = invocation.agent.session
        const route = chooseRoute(session, setting.model)
        return {
          kind: 'success',
          text: [
            `high-level · model=${setting.model || 'current'} (${route ? `${route.provider}/${route.model}` : 'no recorded route'})`,
            `timeout=${Math.round(setting.timeoutMs / 1000)}s · maxOutputTokens=${setting.maxOutputTokens} · key=/hl`,
          ].join('\n'),
        }
      }

      const modelMatch = /^model(?:\s+(\S+))?$/u.exec(argument)
      if (modelMatch) {
        const spec = modelMatch[1] ?? ''
        if (!spec) {
          return { kind: 'success', text: `high-level model setting: ${setting.model || 'current (session route)'}` }
        }
        const next = spec === 'current' || spec === 'default' ? '' : spec
        try {
          const saved = await saveModel(ctx, next)
          return {
            kind: 'success',
            text: saved
              ? `high-level model set to ${next || 'current (session route)'}`
              : `high-level model is ${next || 'current'} for this run only; the profile has no configuration editor to save it`,
          }
        } catch (error) {
          return { kind: 'error', text: `could not save the model setting: ${error instanceof Error ? error.message : String(error)}` }
        }
      }

      const session = invocation.agent.session
      const replies = repliesOf(session.deriveMessages())
      if (replies.length === 0) {
        return { kind: 'error', text: 'No assistant reply to summarize yet.' }
      }

      let target
      const byId = /^#(\S+)$/u.exec(argument)
      if (byId) {
        target = replies.find((reply) => reply.id === byId[1])
        if (target === undefined) {
          return { kind: 'error', text: `No assistant reply with message id ${byId[1]} is in this Session.` }
        }
      } else if (argument === '') {
        target = replies[replies.length - 1]
      } else if (/^\d+$/u.test(argument)) {
        const offset = Number.parseInt(argument, 10)
        target = replies[replies.length - offset]
        if (target === undefined || offset < 1) {
          return { kind: 'error', text: `This Session has ${replies.length} assistant replies; ${argument} is out of range.` }
        }
      } else {
        return { kind: 'error', text: USAGE }
      }

      if (isBrief(target.text, setting)) {
        return {
          kind: 'error',
          text: `That reply is already brief (under ${setting.minReplyChars} characters and ${setting.minReplyLines} lines); nothing to summarize.`,
        }
      }

      const timeout = AbortSignal.timeout(setting.timeoutMs)
      const signal = AbortSignal.any([invocation.signal, timeout])
      const startedAt = Date.now()
      try {
        const { summary, route } = await requestSummary(ctx, session, target, setting, signal)
        return { kind: 'success', text: cardText(summary, route, target, Date.now() - startedAt) }
      } catch (error) {
        if (invocation.signal.aborted) return { kind: 'error', text: 'High-level summary cancelled.' }
        if (timeout.aborted) return { kind: 'error', text: `High-level summary timed out after ${Math.round(setting.timeoutMs / 1000)}s.` }
        const message = error instanceof Error ? error.message : String(error)
        return { kind: 'error', text: `High-level summary failed: ${message}` }
      }
    },
  }), 'high-level: /hl command')
}
