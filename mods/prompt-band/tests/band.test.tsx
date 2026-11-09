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
