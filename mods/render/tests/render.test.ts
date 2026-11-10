import { expect, test } from 'claude-code/testing'

test('/render answers under its saw name', async ($, on) => {
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: false } }))
  const r = await $.command.run({ command: 'render', args: 'help' })
  expect(r).toBeDefined()
})
