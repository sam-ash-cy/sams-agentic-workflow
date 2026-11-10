import { expect, mock, test } from 'claude-code/testing'

const BAND = { plugin: 'prompt-band', component: 'AbovePrompt', props: { hasSurvey: false } } as const
const box = (text: string) => ({ isFilled: true as const, text, cursor: 0 })

test('Plan first wraps the draft, on terminal and desktop', async ($, on) => {
  let filled = ''
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: 'add dark mode', cursor: 0 } }))
  on('prompt.fill', (_, e) => ((filled = e.text), box(e.text)))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'plan' })
    expect(filled).toContain('Plan this before writing code')
    expect(filled).toContain('add dark mode')
    await ui.unmount()
  }
})

test('Improve respects the cooldown', { options: { cooldownSec: 60 } }, async ($, on) => {
  let calls = 0
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('prompt.read', () => ({ value: { text: 'fix the bug', cursor: 0 } }))
  on('prompt.fill', (_, e) => box(e.text))
  on('model.complete', () => {
    calls += 1
    return { value: { isAnswered: true, text: 'Fix the login bug in auth.ts', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  })
  const first = await $.command.run({ command: 'improve' })
  await clock.advance(1000)
  const second = await $.command.run({ command: 'improve' })
  expect(String(first.text)).toContain('Improved')
  expect(String(second.text)).toContain('Wait')
  expect(calls).toBe(1)
})

const measure = (usd: number) => ({ context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits: [], cost: { usd }, changed: ['cost' as const] })
const task = (started: string) => JSON.stringify({ tier: 'standard', playbook: 'feature', started })

test('cost band shows the session cost with no task open', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('fs.read', () => { throw new Error('ENOENT') })
  await $.session.measure(measure(1.5))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '$1.50 session' })).toBeDefined()
  await ui.unmount()
})

test('cost band counts the task from where it started', async ($, on) => {
  let file = task('2026-11-10T10:00:00Z')
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('fs.read', () => ({ value: file }))
  await $.session.measure(measure(2))
  await $.session.measure(measure(2.4))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '$0.40 task · $2.40 session' })).toBeDefined()
  file = task('2026-11-10T11:00:00Z')
  await $.session.measure(measure(2.5))
  expect(await ui.find({ type: 'Text', text: '$0.00 task · $2.50 session' })).toBeDefined()
  await ui.unmount()
})

test('cost band warns once at the budget share and once past it', { options: { budgetUsd: 1 } }, async ($, on) => {
  const toasts: string[] = []
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('fs.read', () => ({ value: task('2026-11-10T10:00:00Z') }))
  on('ui.toast', (_, e) => (toasts.push(String(e.text)), { value: undefined }))
  await $.session.measure(measure(0))
  await $.session.measure(measure(0.85))
  await $.session.measure(measure(0.9))
  await $.session.measure(measure(1.2))
  await $.session.measure(measure(1.3))
  expect(toasts).toHaveLength(2)
  expect(toasts[0]).toContain('85%')
  expect(toasts[1]).toContain('over')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '$1.30 task of $1.00 · $1.30 session' })).toBeDefined()
  await ui.unmount()
})
