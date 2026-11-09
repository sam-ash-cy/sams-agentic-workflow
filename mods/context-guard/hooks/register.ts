import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Watches the context window. Past warnPct it warns once; past forcePct it
// holds ordinary prompts until the person hands off (/handoff, /clear,
// /compact) or overrides with a prompt starting "!override".

const pct = atom({ plugin: 'context-guard', key: 'pct' } as const, 0)
const warned = atom({ plugin: 'context-guard', key: 'warned' } as const, false)

const ALLOWED = new Set(['handoff', 'clear', 'compact', 'improve', 'context', 'cost', 'config'])

type Options = { warnPct?: number; forcePct?: number }

async function onMeasure($: EngineInterface, opts: Options, now: number): Promise<void> {
  await update($, pct, () => now)
  const warn = opts.warnPct ?? 60
  const force = opts.forcePct ?? 80
  if (now >= force && force < 100) {
    $.ui.status(`Context ${now}%: hand off before the next task (/handoff)`)
  } else if (now >= warn) {
    $.ui.status(`Context ${now}%`)
    if (!(await read($, warned))) {
      await update($, warned, () => true)
      $.ui.toast(`Context ${now}% full: finish this step, then /handoff to a fresh session.`)
    }
  } else {
    $.ui.status(undefined)
    await update($, warned, () => false)
  }
}

export const register: Register = (on, options) => {
  const opts = options as Options

  on('session.measure', async ($, e, next) => {
    const now = e.context.percent
    if (now !== undefined) await onMeasure($, opts, now)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const force = opts.forcePct ?? 80
    const now = await read($, pct)
    if (force >= 100 || now < force || e.isMeta) return next(e)
    if (e.command && ALLOWED.has(e.command.name)) {
      const r = await next(e)
      // /clear empties the context: don't hold the next prompt on the old figure.
      if (e.command.name === 'clear' && r.drop === undefined) {
        await update($, pct, () => 0)
        await update($, warned, () => false)
        $.ui.status(undefined)
      }
      return r
    }
    if (e.text.trimStart().startsWith('!override')) {
      return next({ ...e, text: e.text.trimStart().slice('!override'.length).trimStart() })
    }
    return {
      drop: `Context is ${now}% full (limit ${force}%). Run /handoff (or press Handoff) to continue in a fresh session, or start the prompt with !override.`,
    }
  }).catch(($, e, next) => next(e)) // fail open: a broken guard never locks the session

  on('session.end', async ($, e, next) => {
    await update($, pct, () => 0)
    await update($, warned, () => false)
    return next(e)
  })
}
