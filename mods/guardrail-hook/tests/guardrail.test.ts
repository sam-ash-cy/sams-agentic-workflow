import { expect, test } from 'claude-code/testing'

const branch = (name: string) => () => ({ value: { exitCode: 0, stdout: `${name}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('a commit on an auto-generated branch is denied', async ($, on) => {
  on('process.run', branch('claude/nice-hodgkin-31b3aa'))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: {} }))
  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })
  expect(r.deny).toBeDefined()
  expect(String(r.deny)).toContain('auto-generated')
})

test('AI attribution in a commit message is denied', async ($, on) => {
  on('process.run', branch('feat/good-name'))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: {} }))
  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"' })
  expect(String(r.deny)).toContain('attribution')
})

test('a commit on a well-named branch goes through', async ($, on) => {
  on('process.run', branch('fix/edit-global-dirs'))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: { stdout: 'ok' } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix: y"' })
  expect(r.deny).toBeUndefined()
})

test('a push on release/v1.0.1 goes through', async ($, on) => {
  on('process.run', branch('release/v1.0.1'))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: { stdout: 'ok' } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(r.deny).toBeUndefined()
})

test('a push on hotfix/broken-icon goes through', async ($, on) => {
  on('process.run', branch('hotfix/broken-icon'))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: { stdout: 'ok' } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' })
  expect(r.deny).toBeUndefined()
})

test('a commit on a later line, after git -c options, is still checked', async ($, on) => {
  on('process.run', branch('claude/xyz'))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: {} }))
  const r = await $.tool.call({ tool: 'Bash', command: 'git add .\ngit -c user.name=x commit -m "feat: x"' })
  expect(String(r.deny)).toContain('auto-generated')
})
