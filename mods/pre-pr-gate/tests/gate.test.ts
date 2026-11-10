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

test('on Windows a saw that only exists as saw.cmd is run through cmd /c', async ($, on) => {
  const seen: string[][] = []
  on('process.run', (_, e) => {
    seen.push([...e.argv])
    if (e.argv[0] === 'saw') throw new Error('spawn saw ENOENT')
    return status('standard / feature: ready\n  passed  tests, skill:security-review\n')()
  })
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: { stdout: 'https://github.com/o/r/pull/1' } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  expect(r.deny).toBeUndefined()
  expect(seen.at(-1)).toEqual(['cmd', '/c', 'saw', 'task', 'status'])
})

test('when saw cannot run at all the gate still denies', async ($, on) => {
  on('process.run', () => { throw new Error('ENOENT') })
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: {} }))
  const r = await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  expect(String(r.deny)).toContain('could not run')
})
