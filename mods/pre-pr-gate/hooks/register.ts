import type { EngineInterface, Register } from 'claude-code'

// Before `gh pr create`, asks `saw task status` which required checks have
// not run; any `skill:<name>` among them (the [pre_pr] skills) blocks the PR.

const PR_CREATE = /(^|[;&|\n(]\s*)gh\s+pr\s+create\b(?![^\n]*--dry-run)/

type Options = { sawCommand?: string }

export function missingSkills(status: string): string[] {
  const line = status.split('\n').find(l => l.trim().startsWith('not run'))
  if (!line) return []
  return line
    .trim()
    .slice('not run'.length)
    .split(',')
    .map(s => s.trim())
    .filter(s => s.startsWith('skill:'))
    .map(s => s.slice('skill:'.length))
}

async function check($: EngineInterface, opts: Options): Promise<string | null> {
  const argv = (opts.sawCommand ?? 'saw').split(' ').filter(Boolean)
  const cwd = await $.session.cwd()
  const run = (cmd: string[]) => $.process.run(cmd, { cwd, timeoutMs: 15000 })
  let r: Awaited<ReturnType<typeof run>>
  try {
    r = await run([...argv, 'task', 'status'])
  } catch {
    // Windows spawns only .exe files: saw is bin/saw.cmd there, which needs cmd.
    try {
      r = await run(['cmd', '/c', ...argv, 'task', 'status'])
    } catch {
      return `pre-pr-gate: could not run \`${argv.join(' ')} task status\`; set the pre-pr-gate sawCommand option to a command that runs saw.`
    }
  }
  if (r.exitCode !== 0) return null // no open task, or saw missing: the saw hooks decide
  const missing = missingSkills(r.stdout)
  if (missing.length === 0) return null
  return `pre-pr-gate: run these pre-PR skills first, then record each with \`saw task record skill:<name> pass --note "<result>"\`: ${missing.join(', ')}.`
}

export const register: Register = (on, options) => {
  const opts = options as Options

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!PR_CREATE.test(e.command)) return next(e)
    const reason = await check($, opts)
    return reason ? { deny: reason } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'pre-pr-gate: its check failed; run saw task status.' }))
}
