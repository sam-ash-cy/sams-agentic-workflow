import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Status } from '../types'

const PANE = 'workflow'
const status = atom({ plugin: 'workflow-pane', key: 'status' } as const, null as Status | null, { shape: 'status-1' })

type Options = { sawCommand?: string }

export function parseStatus(out: string): Status {
  const lines = out.split('\n')
  const list = (label: string): string[] => {
    const l = lines.find(x => x.trim().startsWith(label))
    return l ? l.trim().slice(label.length).split(',').map(s => s.trim()).filter(Boolean) : []
  }
  return { header: (lines[0] ?? '').trim(), passed: list('passed'), failed: list('failed'), missing: list('not run') }
}

// In a saw project (workflow.toml) a missing task is the thing to fix, so say it plainly.
async function noTaskMessage($: EngineInterface): Promise<string> {
  try {
    await $.fs.read('workflow.toml')
    return 'saw: no task open. Start one with saw task start --tier <t> --playbook <p>.'
  } catch {
    return 'Not a saw project (no workflow.toml).'
  }
}

async function refresh($: EngineInterface, opts: Options): Promise<void> {
  const argv = (opts.sawCommand ?? 'saw').split(' ').filter(Boolean)
  const r = await $.process.run([...argv, 'task', 'status'], { cwd: await $.session.cwd(), timeoutMs: 15000 })
  const out = (r.stderr || r.stdout).trim()
  const next: Status =
    r.exitCode === 0
      ? parseStatus(r.stdout)
      : { header: '', passed: [], failed: [], missing: [], error: /no open task/.test(out) ? await noTaskMessage($) : out.split('\n')[0] || 'No open task.' }
  await update($, status, () => next)
}

export const register: Register = (on, options) => {
  const opts = options as Options

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'workflow-pane', description: 'Show the current task and its checks in a pane' })
    return next(e)
  })

  on('command.run', { command: 'workflow-pane' }, async $ => {
    await refresh($, opts)
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Workflow' })
    return { text: isPlaced ? 'Workflow pane opened.' : 'This surface cannot show panes; run saw task status.' }
  })

  // Refresh after each turn and after any saw command.
  on('turn.complete', async ($, e, next) => {
    await refresh($, opts)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bsaw\b|main\.ts\s+task/.test(e.command)) await refresh($, opts)
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, status)
    if (!s) return <Text dimColor>Loading…</Text>
    if (s.error) return <Text dimColor>{s.error}</Text>
    const skills = [...s.passed, ...s.failed, ...s.missing].filter(x => x.startsWith('skill:'))

    return (
      <Box flexDirection="column">
        <Text bold>{s.header}</Text>
        {s.passed.filter(x => !x.startsWith('skill:')).map(x => <Text color="green">✓ {x}</Text>)}
        {s.failed.filter(x => !x.startsWith('skill:')).map(x => <Text color="red">✗ {x}</Text>)}
        {s.missing.filter(x => !x.startsWith('skill:')).map(x => <Text dimColor>○ {x}</Text>)}
        {skills.length > 0 && <Text bold>Pre-PR skills</Text>}
        {skills.map(x => (
          <Text color={s.passed.includes(x) ? 'green' : s.failed.includes(x) ? 'red' : undefined} dimColor={s.missing.includes(x)}>
            {s.passed.includes(x) ? '✓' : s.failed.includes(x) ? '✗' : '○'} {x.slice('skill:'.length)}
          </Text>
        ))}
      </Box>
    )
  })
}
