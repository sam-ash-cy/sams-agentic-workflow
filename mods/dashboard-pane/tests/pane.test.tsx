import { expect, mock, test } from 'claude-code/testing'

import { parseLaunch } from '../hooks/register'

const PANE = { plugin: 'dashboard-pane', component: 'Pane', props: {}, requestId: 'dashboard' } as const
const BASE = 'http://127.0.0.1:41234'
const LAUNCH = `saw dashboard: open ${BASE}/?k=${'a'.repeat(64)} (one use; Ctrl+C to stop)\n`

const row = (key: string, over: Record<string, unknown> = {}) => ({ key, group: key.split('.')[0], description: `about ${key}`, type: 'boolean', default: false, value: false, source: 'default', ...over })
const PROJECTS = { writable: true, current: '0', projects: [{ id: 'global', name: 'Global', path: 'global/config.toml', state: 'ready', summary: 'applies to every project' }, { id: '0', name: 'demo', path: '/repo/demo', state: 'ready', summary: '3 tasks' }] }
const ROWS = { rows: [row('features.grilling'), row('features.docs_step', { value: true, layer: true, source: 'project' }), row('verify.mode', { type: 'enum', options: ['soft', 'hard'], value: 'soft', group: 'verify' })], warnings: [] }
const MODS = { writable: true, restart: 'A change takes effect in a new Claude session.', scope: '.claude/settings.local.json', mods: [{ name: 'prompt-band', description: 'Buttons above the prompt', state: 'enabled', own: false, install: 'claude plugin install prompt-band@sams-agentic-workflow' }, { name: 'trail-nudge', description: 'Nudges', state: 'not installed', own: false, install: 'claude plugin install trail-nudge@sams-agentic-workflow' }] }

type Seen = { url: string; method: string; headers: Record<string, string>; body?: string }
const reply = (status: number, body: unknown) => ({ value: { status, ok: status < 300, headers: {}, text: JSON.stringify(body) } })

// A fake dashboard server behind http.fetch, and a fake `saw dashboard --serve` child behind process.spawn.
function fake($: any, on: any, over: { fetchFails?: boolean; output?: string; projects?: unknown; post?: (e: Seen) => ReturnType<typeof reply> } = {}) {
  const clock = mock.clock(on)
  const seen: Seen[] = []
  const spawned: { argv: string[]; ended: boolean }[] = []
  on('session.cwd', () => ({ value: '/repo/demo' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.end', (_: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('process.spawn', async function* (_: unknown, e: { argv: string[] }, next: { signal: AbortSignal }) {
    const child = { argv: e.argv, ended: false }
    spawned.push(child)
    try {
      yield { stream: 'stdout', text: over.output ?? LAUNCH }
      await new Promise<void>(done => next.signal.addEventListener('abort', () => done()))
      return { value: { code: null, signal: 'SIGTERM' } }
    } finally {
      child.ended = true
    }
  })
  on('http.fetch', (_: unknown, e: Seen & { init?: { method?: string; headers?: Record<string, string>; body?: string } }) => {
    const call: Seen = { url: e.url, method: e.init?.method ?? 'GET', headers: e.init?.headers ?? {}, body: e.init?.body }
    seen.push(call)
    const path = new URL(call.url).pathname
    if (over.fetchFails && path !== '/pane-session') throw new Error('connection refused')
    if (path === '/pane-session') return reply(200, { ok: true, session: 'S'.repeat(64), csrf: 'C'.repeat(64), writable: true })
    if (call.method === 'POST') return over.post ? over.post(call) : reply(200, { ok: true })
    if (path === '/api/projects') return reply(200, over.projects ?? PROJECTS)
    if (path === '/api/settings') return reply(200, ROWS)
    if (path === '/api/mods') return reply(200, MODS)
    return reply(404, { ok: false })
  })
  return { seen, spawned, clock }
}

test('launch address parsing accepts only the loopback address the server prints', () => {
  expect(parseLaunch(LAUNCH)).toEqual({ base: BASE, code: 'a'.repeat(64) })
  expect(parseLaunch('saw dashboard: open http://evil.example:80/?k=' + 'a'.repeat(64))).toBeUndefined()
  expect(parseLaunch('saw dashboard: open http://127.0.0.1:99999/?k=' + 'a'.repeat(64))).toBeUndefined()
  expect(parseLaunch('could not serve on port 0: in use')).toBeUndefined()
  expect(parseLaunch('saw dashboard: open http://127.0.0.1:41234/?k=short')).toBeUndefined()
})

test('the command starts one server on a free port, trades the launch code and shows the settings', async ($, on) => {
  const { seen, spawned } = fake($, on)
  await $.command.run({ command: 'dashboard-pane' })
  expect(spawned).toHaveLength(1)
  expect(spawned[0]!.argv).toEqual(['saw', 'dashboard', '--serve', '--port', '0'])
  expect(seen[0]!.url).toBe(`${BASE}/pane-session?k=${'a'.repeat(64)}`)
  // Every read after the trade carries the session cookie and nothing else secret.
  const reads = seen.slice(1)
  expect(reads.length).toBeGreaterThan(0)
  for (const r of reads) expect(r.headers.cookie).toBe(`saw_session=${'S'.repeat(64)}`)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'features.grilling' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'about features.grilling' })).toBeDefined()
  await ui.unmount()
})

test('opening the pane twice does not start a second server', async ($, on) => {
  const { spawned } = fake($, on)
  await Promise.all([$.command.run({ command: 'dashboard-pane' }), $.command.run({ command: 'dashboard-pane' })])
  await $.command.run({ command: 'dashboard-pane' })
  expect(spawned).toHaveLength(1)
})

test('closing the pane stops the server it started, and the next open starts a fresh one', async ($, on) => {
  const { spawned, clock } = fake($, on)
  await $.command.run({ command: 'dashboard-pane' })
  expect(spawned[0]!.ended).toBe(false)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'dashboard-pane', key: 'close' })
  await ui.unmount()
  await clock.settle()
  expect(spawned[0]!.ended).toBe(true)
  await $.command.run({ command: 'dashboard-pane' })
  expect(spawned).toHaveLength(2)
})

test('ending the session stops the server too', async ($, on) => {
  const { spawned } = fake($, on)
  await $.command.run({ command: 'dashboard-pane' })
  await $.session.end({ reason: 'other', sessionId: 's1' } as never)
  expect(spawned[0]!.ended).toBe(true)
})

test('a switch posts from the dashboard origin with the csrf key, the project folder and the scope', async ($, on) => {
  const { seen } = fake($, on)
  await $.command.run({ command: 'dashboard-pane' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'dashboard-pane', key: 'set:features.grilling' })
  const post = seen.find(s => s.method === 'POST')!
  expect(post.url).toBe(`${BASE}/api/settings`)
  expect(post.headers.origin).toBe(BASE)
  expect(post.headers['x-saw-csrf']).toBe('C'.repeat(64))
  expect(post.headers.cookie).toBe(`saw_session=${'S'.repeat(64)}`)
  expect(JSON.parse(post.body!)).toEqual({ project: '0', path: '/repo/demo', scope: 'project', key: 'features.grilling', value: true })
  await ui.unmount()
})

test('a write the server refuses shows its reason', async ($, on) => {
  fake($, on, { post: () => reply(400, { ok: false, problem: 'The shared workflow.toml can only tighten verify.mode.' }) })
  await $.command.run({ command: 'dashboard-pane' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'dashboard-pane', key: 'set:features.grilling' })
  expect(await ui.find({ type: 'Text', text: 'The shared workflow.toml can only tighten verify.mode.' })).toBeDefined()
  await ui.unmount()
})

test('a read-only dashboard offers no switches', async ($, on) => {
  fake($, on, { projects: { ...PROJECTS, writable: false } })
  await $.command.run({ command: 'dashboard-pane' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'features.grilling' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'set:features.grilling' })).toBeUndefined()
  await ui.unmount()
})

test('a mod switch posts to /api/mods', async ($, on) => {
  const { seen } = fake($, on)
  await $.command.run({ command: 'dashboard-pane' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ plugin: 'dashboard-pane', key: 'tab:mods' })
  await ui.press({ plugin: 'dashboard-pane', key: 'mod:prompt-band' })
  const post = seen.find(s => s.method === 'POST')!
  expect(post.url).toBe(`${BASE}/api/mods`)
  expect(JSON.parse(post.body!)).toEqual({ project: '0', path: '/repo/demo', name: 'prompt-band', enabled: false })
  await ui.unmount()
})

test('a server that never prints its address leaves an error after a wait, not a hang', async ($, on) => {
  const { spawned, clock } = fake($, on, { output: 'saw dashboard: starting\n' })
  const run = $.command.run({ command: 'dashboard-pane' })
  await clock.advance(30000)
  await run
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /did not print/ })).toBeDefined()
  await ui.unmount()
  expect(spawned[0]!.ended).toBe(true)
})

test('an address that is not on this machine is never visited', async ($, on) => {
  const { seen, spawned, clock } = fake($, on, { output: `saw dashboard: open http://evil.example:80/?k=${'a'.repeat(64)}\n` })
  const run = $.command.run({ command: 'dashboard-pane' })
  await clock.advance(30000)
  await run
  expect(seen.filter(s => s.url.includes('evil.example'))).toHaveLength(0)
  expect(spawned[0]!.ended).toBe(true)
})

test('a server that stops answering shows an error with a way to try again, not a stuck spinner', async ($, on) => {
  fake($, on, { fetchFails: true })
  await $.command.run({ command: 'dashboard-pane' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /did not answer/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'retry' })).toBeDefined()
  await ui.unmount()
})
