import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ReadMark } from '../types'

const reads = atom({ plugin: 'context-saver', key: 'reads' } as const, {} as Record<string, ReadMark>, { shape: 'reads-1' })
const turn = atom({ plugin: 'context-saver', key: 'turn' } as const, 0)

type Options = { maxOutputChars?: number; dedupeReads?: boolean; steerCompaction?: boolean }

const KEEP_LINE = /error|fail|exception|panic|traceback|warn|✘|✗|FAIL|ERR!/i

const COMPACT_STEER =
  'Keep verbatim: the user\'s instructions and rules, decisions made and why, open tasks and next steps, file:line references, commands that worked, and unresolved errors. Drop raw tool output, file dumps and superseded attempts.'

// Head, tail and every error-looking line of a long output, plus where the full copy is.
// The result never exceeds `max`: when it would, the head gives way first,
// so the error lines and the tail (where summaries are) survive.
export function trimOutput(text: string, max: number, savedAt: string): string {
  if (text.length <= max) return text
  const lines = text.split('\n')
  if (lines.length <= 80) {
    // Few, long lines (minified code, one-line JSON): cut by characters.
    const half = Math.floor((max - 200) / 2)
    return `${text.slice(0, half)}\n… [context-saver: ${text.length - 2 * half} chars trimmed; full output saved at ${savedAt}] …\n${text.slice(-half)}`
  }
  const clip = (l: string): string => (l.length > 300 ? `${l.slice(0, 300)} …` : l)
  const head = lines.slice(0, 40).map(clip).join('\n')
  const middle = lines.slice(40, -40).filter(l => KEEP_LINE.test(l)).slice(0, 60).map(clip)
  const marker = `… [context-saver: ${lines.length - 80} lines trimmed (${text.length} chars); full output saved at ${savedAt}; ${middle.length} error/warning lines kept below] …`
  const tail = lines.slice(-40).map(clip).join('\n')
  const kept = middle.join('\n')
  const rest = [marker, kept, '…', tail].join('\n')
  if (rest.length < max) return `${head.slice(0, max - rest.length - 1)}\n${rest}`
  // No room for the head: the error lines get up to a third, the tail the rest.
  const keptPart = kept.slice(0, Math.floor(max / 3))
  const room = max - marker.length - keptPart.length - 5
  return [marker, keptPart, '…', tail.slice(-room)].join('\n')
}

async function saveFull($: EngineInterface, id: string, text: string): Promise<string> {
  const path = `${await $.session.cwd()}/.claude/output/${id}.txt`
  await $.fs.write(path, text)
  return path
}

// Keyed per agent loop: a subagent's read is not a copy the main loop holds.
function readKey(input: { file_path?: unknown; offset?: unknown; limit?: unknown; agentId?: string }): string | null {
  if (typeof input.file_path !== 'string') return null
  return `${input.agentId ?? 'main'}|${input.file_path}#${String(input.offset ?? 0)}:${String(input.limit ?? 'all')}`
}

export const register: Register = (on, options) => {
  const opts = options as Options

  on('prompt.submit', async ($, e, next) => {
    await update($, turn, n => n + 1)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const max = opts.maxOutputChars ?? 8000
    if (max <= 0 || ran.deny !== undefined) return ran
    const result = ran.result as { stdout?: unknown } | undefined
    const stdout = result?.stdout
    if (typeof stdout !== 'string' || stdout.length <= max) return ran
    const savedAt = await saveFull($, e.tool_use_id, stdout)
    return { ...ran, result: { ...result, stdout: trimOutput(stdout, max, savedAt) } as typeof ran.result }
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (opts.dedupeReads === false) return next(e)
    const key = readKey(e as { file_path?: unknown; offset?: unknown; limit?: unknown; agentId?: string })
    if (!key) return next(e)
    const path = key.slice(key.indexOf('|') + 1, key.lastIndexOf('#'))
    const stat = (await $.fs.exists(path)) ? await $.fs.stat(path) : null
    const seen = (await read($, reads))[key]
    if (stat && seen && seen.mtimeMs === stat.mtimeMs) {
      return { deny: `context-saver: ${path} (this range) is unchanged since you read it in turn ${seen.turn}; use that copy. To force a fresh read, pass a different offset/limit.` }
    }
    const ran = await next(e)
    if (stat && ran.deny === undefined && !ran.isError) {
      const now = await read($, turn)
      await update($, reads, all => ({ ...all, [key]: { mtimeMs: stat.mtimeMs, turn: now } }))
    }
    return ran
  })

  // A compaction forgets what was read: start the read marks over.
  on('session.compact', async ($, e, next) => {
    await update($, reads, () => ({}))
    if (opts.steerCompaction === false) return next(e)
    return next({ ...e, instructions: [e.instructions, COMPACT_STEER].filter(Boolean).join('\n\n') })
  })
}
