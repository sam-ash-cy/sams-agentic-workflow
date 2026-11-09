import { expect, test } from 'claude-code/testing'

const measure = (percent: number) => ({ context: { tokens: percent * 2000, window: 200000, percent }, rateLimits: [], changed: ['context' as const] })

test('past the force limit an ordinary prompt is held, /handoff is not', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))
  await $.session.measure(measure(85))
  const held = await $.prompt.submit({ text: 'add a feature' })
  expect(held.drop).toContain('85%')
  const over = await $.prompt.submit({ text: '!override just this one' })
  expect(over.text).toBe('just this one')
})

test('under the limit prompts pass', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.measure(measure(40))
  const r = await $.prompt.submit({ text: 'hello' })
  expect(r.text).toBe('hello')
})
