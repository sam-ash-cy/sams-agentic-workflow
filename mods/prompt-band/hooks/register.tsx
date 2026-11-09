import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Busy } from '../types'

// Buttons above the prompt. Text-only buttons fill the draft; Improve and
// Handoff call a model, so they share a cooldown and a daily cap.

const busy = atom({ plugin: 'prompt-band', key: 'busy' } as const, null as Busy)
const lastPressAt = atom({ plugin: 'prompt-band', key: 'lastPressAt' } as const, 0)
const contextPct = atom({ plugin: 'prompt-band', key: 'contextPct' } as const, 0)
const isTurnRunning = atom({ plugin: 'prompt-band', key: 'isTurnRunning' } as const, false)

const MAX_DRAFT = 8000
const HANDOFF_PATH = '.claude/handoff.md'

const IMPROVE_SYSTEM = `You rewrite a developer's draft prompt for a coding agent so it is specific and actionable.
Keep the author's intent, voice and every fact they gave. Do not invent requirements, files or names.
Where it helps, add: the goal in one line, constraints, files or areas named in the draft, and how to tell it is done.
Keep it short: no longer than needed, plain text, no preamble. Reply with the rewritten prompt only.`

const HANDOFF_ASK = `Write a handoff note so a fresh session can continue this work without the transcript.
Sections: Goal; Decisions made (and why); Files touched (path:line where known); Done; Not done / next steps; Watch out.
Be concise and concrete. Markdown only, no preamble.`

type Options = {
  improveDailyLimit?: number
  cooldownSec?: number
  model?: string
  reviewCommand?: string
  compactAtPct?: number
}

const today = (now: number): string => new Date(now).toISOString().slice(0, 10)

// Returns why a model-backed press is refused, or null after recording the use.
async function takeQuota($: EngineInterface, opts: Options): Promise<string | null> {
  const now = await $.clock.now()
  const cooldownMs = (opts.cooldownSec ?? 10) * 1000
  const last = await read($, lastPressAt)
  if (now - last < cooldownMs) return `Wait ${Math.ceil((cooldownMs - (now - last)) / 1000)}s between presses.`
  const key = `uses:${today(now)}`
  const used = Number((await $.store.get(key)) ?? 0)
  const limit = opts.improveDailyLimit ?? 30
  if (used >= limit) return `Daily limit reached (${limit}). Change it in /config.`
  await $.store.set(key, used + 1)
  await update($, lastPressAt, () => now)
  return null
}

// A failed model call gives its use back (the cooldown stays).
async function refundQuota($: EngineInterface): Promise<void> {
  const key = `uses:${today(await $.clock.now())}`
  const used = Number((await $.store.get(key)) ?? 0)
  if (used > 0) await $.store.set(key, used - 1)
}

function fill($: EngineInterface, text: string) {
  return $.prompt.fill({ text, mode: 'replace' })
}

async function improve($: EngineInterface, opts: Options): Promise<string> {
  if (await read($, busy)) return 'Busy.'
  const { text } = await $.prompt.read()
  if (!text.trim()) return 'Type a prompt first, then press Improve.'
  if (text.length > MAX_DRAFT) return `Draft is over ${MAX_DRAFT} characters; Improve skips it.`
  const refused = await takeQuota($, opts)
  if (refused) return refused
  await update($, busy, () => 'improve')
  try {
    const r = await $.model.complete({
      model: opts.model ?? 'haiku',
      system: IMPROVE_SYSTEM,
      prompt: text,
      maxTokens: 800,
      timeoutMs: 30000,
    })
    if (!r.isAnswered || !r.text.trim()) {
      await refundQuota($)
      return 'Improve got no answer; draft left as it was.'
    }
    await fill($, r.text.trim())
    return 'Improved: edit or send.'
  } catch (err) {
    await refundQuota($)
    throw err
  } finally {
    await update($, busy, () => null)
  }
}

async function handoff($: EngineInterface, opts: Options): Promise<string> {
  if (await read($, busy)) return 'Busy.'
  const refused = await takeQuota($, opts)
  if (refused) return refused
  await update($, busy, () => 'handoff')
  try {
    const r = await $.model.fork({ prompt: HANDOFF_ASK }).catch(async err => {
      await refundQuota($)
      throw err
    })
    if (!r.isAnswered || !r.text.trim()) {
      await refundQuota($)
      return 'Handoff got no answer; nothing written.'
    }
    const cwd = await $.session.cwd()
    const now = await $.clock.now()
    await $.fs.write(`${cwd}/${HANDOFF_PATH}`, `<!-- handoff ${new Date(now).toISOString()} -->\n${r.text.trim()}\n`)
    await fill($, '/clear')
    return `Handoff written to ${HANDOFF_PATH}. Send /clear; your next prompt picks it up.`
  } finally {
    await update($, busy, () => null)
  }
}

// The handoff note when one under 24 h old is waiting, else null.
async function freshHandoff($: EngineInterface): Promise<string | null> {
  const path = `${await $.session.cwd()}/${HANDOFF_PATH}`
  if (!(await $.fs.exists(path))) return null
  const note = String(await $.fs.read(path))
  const stat = await $.fs.stat(path)
  if (!note.trim() || (await $.clock.now()) - stat.mtimeMs > 24 * 3600 * 1000) return null
  return note
}

async function pressButton($: EngineInterface, opts: Options, id: string): Promise<void> {
  if ((await read($, busy)) !== null || (await read($, isTurnRunning))) return void $.ui.toast('Wait for the current turn to finish.')
  if (id === 'improve') return void $.ui.toast(await improve($, opts))
  if (id === 'handoff') return void $.ui.toast(await handoff($, opts))
  if (id === 'plan') {
    const { text } = await $.prompt.read()
    return void (await fill($, `Plan this before writing code, then ask me before implementing.

${text}`))
  }
  const fixed: Record<string, string> = {
    review: opts.reviewCommand ?? '/code-review low',
    ship: 'Ship check: run the relevant tests and the formatter, run trail check, run any pre-PR skills from workflow.toml, then list what is ready to commit. Do not commit or push.',
    compact: '/compact keep decisions, open tasks, file:line references and my rules; drop tool output',
  }
  if (fixed[id]) await fill($, fixed[id])
}

export const register: Register = (on, options) => {
  const opts = options as Options

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'improve', description: 'Rewrite the draft prompt to be specific (prompt-band)' })
    await $.command.register({ name: 'handoff', description: 'Write a handoff note, then /clear for a fresh session (prompt-band)' })
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => ({ text: await handoff($, opts) }))
  on('command.run', { command: 'improve' }, async $ => ({ text: await improve($, opts) }))

  // A fresh handoff (under 24 h) rides along with the first prompt after it, once.
  // The turn counts as running, and the handoff as used, only once the prompt
  // was accepted: a prompt another mod drops (context-guard) changes neither.
  on('prompt.submit', async ($, e, next) => {
    const note = e.command || e.isMeta ? null : await freshHandoff($)
    const r = note
      ? await next({ ...e, context: [...(e.context ?? []), `Handoff from the previous session:\n${note}`] })
      : await next(e)
    if (r.drop !== undefined) return r
    if (!e.command && !e.isMeta) await update($, isTurnRunning, () => true)
    if (note) {
      const cwd = await $.session.cwd()
      await $.fs.write(`${cwd}/.claude/handoff.used.md`, note)
      await $.fs.write(`${cwd}/${HANDOFF_PATH}`, '')
      $.ui.toast('Resumed from handoff.')
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    await update($, isTurnRunning, () => false)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const pct = e.context.percent
    if (pct !== undefined) await update($, contextPct, () => pct)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const working = await read($, busy)
    const off = working !== null || (await read($, isTurnRunning))
    const pct = await read($, contextPct)
    const press = (id: string) => () => void pressButton($, opts, id)

    return (
      <Box>
        {working && <Text dimColor>{working === 'improve' ? 'Improving… ' : 'Writing handoff… '}</Text>}
        <Button key="improve" label="Improve" dimColor={off} onPress={press('improve')} />
        <Button key="plan" label="Plan first" dimColor={off} onPress={press('plan')} />
        <Button key="review" label="Review" dimColor={off} onPress={press('review')} />
        <Button key="ship" label="Ship check" dimColor={off} onPress={press('ship')} />
        {pct >= (opts.compactAtPct ?? 50) && (
          <Button key="compact" label={`Compact (${pct}%)`} dimColor={off} onPress={press('compact')} />
        )}
        <Button key="handoff" label="Handoff" dimColor={off} onPress={press('handoff')} />
      </Box>
    )
  })
}
