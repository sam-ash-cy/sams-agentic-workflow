import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// A gentle reminder, added after the tool's own result, in repos that have
// a trail map (.trail/). It never blocks, and repeats at most every 5th call.

const nudges = atom({ plugin: 'trail-nudge', key: 'nudges' } as const, 0)
const hasTrail = atom({ plugin: 'trail-nudge', key: 'hasTrail' } as const, null as boolean | null)

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|php|py|go|rs|java|kt|rb|cs|swift|vue|svelte)$/i

export function hint(tool: string, input: Record<string, unknown>): string | null {
  if (tool === 'Read' && typeof input.file_path === 'string' && CODE.test(input.file_path)) {
    return `trail skeleton ${input.file_path} (signatures only) before reading a large file`
  }
  if (tool === 'Grep' && typeof input.pattern === 'string') return `trail grep "${input.pattern}" (grouped by symbol) or trail ask "<task>"`
  if (tool === 'Glob') return 'trail ask "<task>" to locate code by meaning'
  return null
}

async function trailOn($: EngineInterface): Promise<boolean> {
  const known = await read($, hasTrail)
  if (known !== null) return known
  const found = await $.fs.exists(`${await $.session.cwd()}/.trail`)
  await update($, hasTrail, () => found)
  return found
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!['Read', 'Grep', 'Glob'].includes(e.tool) || ran.deny !== undefined) return ran
    const text = hint(e.tool, e as unknown as Record<string, unknown>)
    if (!text || !(await trailOn($))) return ran
    const n = await update($, nudges, k => k + 1)
    $.ui.status(`trail nudges: ${n}`)
    if (n % 5 !== 1) return ran
    return { ...ran, context: [...(ran.context ?? []), `Reminder (trail-nudge): prefer ${text}.`] }
  })
}
