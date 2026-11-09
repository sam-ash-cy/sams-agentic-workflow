import { expect, test } from 'claude-code/testing'

test('long Bash output is trimmed and the full copy saved', async ($, on) => {
  const big = Array.from({ length: 2000 }, (_, i) => (i === 1000 ? 'Error: boom' : `line ${i}`)).join('\n')
  let saved = ''
  on('fs.write', (_, e) => ((saved = e.path), { value: undefined }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: { stdout: big, stderr: '', interrupted: false } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'bun test' })
  const out = (r.result as { stdout: string }).stdout
  expect(out.length).toBeLessThan(big.length)
  expect(out).toContain('Error: boom')
  expect(saved).toMatch(/claude.output/)
})

test('one huge line is cut to the limit, keeping both ends', async ($, on) => {
  const big = `START${'x'.repeat(50000)}END`
  on('fs.write', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: { stdout: big, stderr: '', interrupted: false } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'cat app.min.js' })
  const out = (r.result as { stdout: string }).stdout
  expect(out.length).toBeLessThanOrEqual(8000)
  expect(out.startsWith('START')).toBe(true)
  expect(out.endsWith('END')).toBe(true)
})

test('long lines never push the error lines or the tail out', async ($, on) => {
  const big = Array.from({ length: 300 }, (_, i) => (i === 150 ? 'FAIL: case 7' : i === 299 ? 'Tests: 1 failed' : `${i} ${'y'.repeat(400)}`)).join('\n')
  on('fs.write', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', () => ({ result: { stdout: big, stderr: '', interrupted: false } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'bun test' })
  const out = (r.result as { stdout: string }).stdout
  expect(out.length).toBeLessThanOrEqual(8000)
  expect(out).toContain('FAIL: case 7')
  expect(out).toContain('Tests: 1 failed')
})
