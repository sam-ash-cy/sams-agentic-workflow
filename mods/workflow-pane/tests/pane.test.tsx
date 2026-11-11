import { expect, test } from 'claude-code/testing'

import { parseStatus } from '../hooks/register'

const PANE = { plugin: 'workflow-pane', component: 'Pane', props: {}, requestId: 'workflow' } as const
const ran = (exitCode: number, stdout: string, stderr = '') => () => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

test('task line says no task open in a saw project', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', ran(1, '', 'saw: no open task; start one with saw task start --tier <t> --playbook <p>'))
  on('fs.read', () => ({ value: '[project]\n' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'workflow-pane' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'saw: no task open. Start one with saw task start --tier <t> --playbook <p>.' })).toBeDefined()
  await ui.unmount()
})

test('task line says when the folder is not a saw project', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', ran(1, '', 'saw: no open task; start one with saw task start --tier <t> --playbook <p>'))
  on('fs.read', () => { throw new Error('ENOENT') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'workflow-pane' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Not a saw project (no workflow.toml).' })).toBeDefined()
  await ui.unmount()
})

test('task line shows the open task and why it is not verified', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', ran(0, 'trivial / feature: Not verified\n  tier too low: the diff needs at least critical\n  not configured test (set checks.<name> in workflow.toml, or list it in verify.allow_unconfigured)\n'))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'workflow-pane' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'trivial / feature: Not verified' })).toBeDefined()
  await ui.unmount()
})

test('status parsing keeps check names, unconfigured checks and the tier floor', () => {
  const s = parseStatus('standard / feature: Not verified\n  passed  test\n  not run code_review, skill:x\n  tier too low: needs critical\n  not configured lint, typecheck (set checks.<name> in workflow.toml, or list it in verify.allow_unconfigured)\n')
  expect(s.header).toBe('standard / feature: Not verified')
  expect(s.passed).toEqual(['test'])
  expect(s.missing).toEqual(['code_review', 'skill:x'])
  expect(s.unconfigured).toEqual(['lint', 'typecheck'])
  expect(s.floor).toBe('needs critical')
})
