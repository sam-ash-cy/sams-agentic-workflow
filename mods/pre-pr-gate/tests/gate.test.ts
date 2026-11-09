import { expect, test } from 'claude-code/testing'

const status = (stdout: string) => () => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('gh pr create is denied while a pre-PR skill has not run', async ($, on) => {
  on('process.run', status('standard / feature: incomplete\n  passed  tests\n  not run skill:security-review, code_review\n'))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: {} }))
  const r = await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  expect(r.deny).toBeDefined()
  expect(String(r.deny)).toContain('security-review')
})

test('gh pr create goes through once the skills are recorded', async ($, on) => {
  on('process.run', status('standard / feature: ready\n  passed  tests, skill:security-review\n'))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: { stdout: 'https://github.com/o/r/pull/1' } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  expect(r.deny).toBeUndefined()
})
