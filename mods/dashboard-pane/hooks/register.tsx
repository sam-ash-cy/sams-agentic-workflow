import { atom, read, update } from 'claude-code'
import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult, Register } from 'claude-code'

import type { ModRow, Project, Scope, SettingRow, Tab, View } from '../types'

// The saw dashboard (saw dashboard --serve) in a pane. A pane draws native elements and cannot
// embed a page, so this reads the dashboard's JSON API and writes through it: every write is
// checked by the server the same way as in the browser (cookie, own origin, csrf key, project
// folder). The pane starts its own server on a free port, so it never meets the browser
// dashboard on the configured port, and stops it when the pane closes.

const PANE = 'dashboard'
const START_TIMEOUT_MS = 15000
const PAGE_ROWS = 7

const EMPTY: View = { phase: 'idle', message: '', writable: false, tab: 'settings', project: '', scope: 'project', group: '', page: 0, filter: '', projects: [], rows: [], mods: [], restart: '' }
const view = atom({ plugin: 'dashboard-pane', key: 'view' } as const, EMPTY, { shape: 'view-4' })

type Options = { sawCommand?: string }
type Conn = { base: string; session: string; csrf: string }
type Child = HookStream<ProcessSpawnChunk, ProcessSpawnResult>
type Api = { ok: boolean; status: number; body: Record<string, any> }

// The connection and the child live here, never in the atom: the session cookie and the csrf key
// are not for any drawing, state dump or other plugin to read. A reload starts them over, and
// unloading the module kills the child, so the two always go together.
let conn: Conn | undefined
let child: Child | undefined
let starting: Promise<Conn> | undefined
// Bumped by every stop(), so a start that was superseded by a close can tell and stay quiet.
let epoch = 0

// "saw dashboard: open http://127.0.0.1:<port>/?k=<code> (one use; Ctrl+C to stop)". Only a
// loopback address with a long launch code counts, whatever else the child might print.
export function parseLaunch(out: string): { base: string; code: string } | undefined {
  const m = /http:\/\/127\.0\.0\.1:(\d{1,5})\/\?k=([0-9a-f]{64})(?![0-9a-f])/.exec(out)
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 65535) return undefined
  return { base: `http://127.0.0.1:${m[1]}`, code: m[2]! }
}

let resolved: string[] | undefined

const explicit = (opts: Options): string[] | undefined => (opts.sawCommand && opts.sawCommand !== 'saw' ? opts.sawCommand.split(' ').filter(Boolean) : undefined)

const SHIM = /[\\/]bin[\\/]saw(\.cmd)?$/i
const parent = (dir: string): string => dir.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')

// The app that runs this mod often has no `saw` on its PATH (only the user's terminal does), so
// when spawning plain `saw` fails, look for a saw checkout that has the pane route, and run its CLI
// with bun: the session's folder and its parents, then folders on PATH, then the installed plugin.
async function checkoutArgv($: EngineInterface): Promise<{ argv?: string[]; why: string }> {
  const seen: string[] = []
  const usable = async (root: string): Promise<boolean> => {
    if (!root || seen.includes(root)) return false
    seen.push(root)
    try {
      return (await $.fs.read(`${root}/cli/src/dashboard-server.ts`)).includes('pane-session')
    } catch {
      return false
    }
  }
  const via = (root: string): { argv: string[]; why: string } => ({ argv: ['bun', `${root}/cli/src/main.ts`], why: '' })

  let dir = await $.session.cwd()
  for (let i = 0; i < 8 && dir; i++, dir = parent(dir)) if (await usable(dir)) return via(dir)

  const path = (await $.env.get('PATH')) ?? ''
  for (const folder of path.split(/[;:](?![\\/])/).filter(Boolean)) {
    if (SHIM.test(`${folder.replace(/[\\/]+$/, '')}/saw`) && (await usable(parent(folder)))) return via(parent(folder))
  }

  const home = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''}/.claude`
  const cache = `${home}/plugins/cache/sams-agentic-workflow/sams-agentic-workflow`
  try {
    const versions = (await $.fs.list(cache)).map(e => e.name).sort().reverse()
    for (const v of versions) if (await usable(`${cache}/${v}`)) return via(`${cache}/${v}`)
  } catch {
    /* no plugin cache */
  }
  return { why: `no saw checkout with the pane route found (looked in ${seen.length} folders from ${await $.session.cwd()}, PATH and ${cache})` }
}

function release(): void {
  const c = child
  child = undefined
  conn = undefined
  starting = undefined
  // Ending the loop kills the child: return() is how the engine hears it.
  if (c) void c.return({ code: null, signal: null }).catch(() => undefined)
}

// A close or the end of the session: also marks any start still under way as superseded.
function stop(): void {
  epoch += 1
  release()
}

async function start($: EngineInterface, opts: Options): Promise<Conn> {
  const given = explicit(opts)
  const first = resolved ?? given ?? ['saw']
  try {
    const c = await launchWith($, first)
    resolved = first
    return c
  } catch (e) {
    // Only a spawn that could not start is retried, and only when the user did not choose a command.
    if (given || resolved || !/could not run saw dashboard/i.test((e as Error).message)) throw e
    const shim = await checkoutArgv($)
    if (!shim.argv) throw new Error(`${(e as Error).message} (no fallback: ${shim.why})`)
    const c = await launchWith($, shim.argv)
    resolved = shim.argv
    return c
  }
}

async function launchWith($: EngineInterface, argv: string[]): Promise<Conn> {
  const run: Child = $.process.spawn({ argv: [...argv, 'dashboard', '--serve', '--port', '0'], cwd: await $.session.cwd() })
  child = run
  let found: (a: { base: string; code: string }) => void = () => {}
  let failed: (e: Error) => void = () => {}
  const launch = new Promise<{ base: string; code: string }>((resolve, reject) => {
    found = resolve
    failed = reject
  })
  void (async () => {
    let out = ''
    try {
      for await (const { text } of run) {
        out += text
        const a = parseLaunch(out)
        if (a) found(a)
      }
      failed(new Error(`saw dashboard stopped: ${out.trim().split('\n').pop() || 'no output'}`))
    } catch (e) {
      failed(new Error(`could not run saw dashboard: ${(e as Error).message}`))
    } finally {
      // The server is gone, whatever ended it.
      if (child === run) {
        child = undefined
        conn = undefined
      }
    }
  })()
  const timer = $.clock.after(START_TIMEOUT_MS, () => failed(new Error('saw dashboard did not print a local address in time')))
  try {
    const { base, code } = await launch
    const res = await $.http.fetch(`${base}/pane-session?k=${code}`)
    const body = JSON.parse(res.text) as { ok?: boolean; session?: string; csrf?: string }
    if (!res.ok || !body.ok || !body.session || !body.csrf) throw new Error('the dashboard refused the launch code')
    conn = { base, session: body.session, csrf: body.csrf }
    return conn
  } catch (e) {
    if (child === run) release()
    throw e
  } finally {
    timer.cancel()
  }
}

// One server at a time: a second open while it starts waits for the first, and one that is
// already running is reused.
async function connect($: EngineInterface, opts: Options): Promise<Conn> {
  if (conn) return conn
  if (!starting) {
    const p: Promise<Conn> = start($, opts).finally(() => {
      if (starting === p) starting = undefined
    })
    starting = p
  }
  return starting
}

async function api($: EngineInterface, c: Conn, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Api> {
  const headers: Record<string, string> = { cookie: `saw_session=${c.session}` }
  if (method === 'POST') {
    headers.origin = c.base
    headers['x-saw-csrf'] = c.csrf
    headers['content-type'] = 'application/json'
  }
  let res: { ok: boolean; status: number; text: string }
  try {
    res = await $.http.fetch(`${c.base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  } catch (e) {
    return { ok: false, status: 0, body: { problem: `the dashboard did not answer: ${(e as Error).message}` } }
  }
  let parsed: Record<string, any> = {}
  try {
    parsed = JSON.parse(res.text)
  } catch {
    /* a non-JSON answer is reported by status */
  }
  return { ok: res.ok && parsed.ok !== false, status: res.status, body: parsed }
}

const problem = (r: Api): string => String(r.body.problem ?? `the dashboard answered ${r.status}`)
const folderOf = (v: View): string => v.projects.find(p => p.id === v.project)?.path ?? ''

// Reads the project list, then the settings and mods of the chosen project.
async function load($: EngineInterface, c: Conn, patch: Partial<View> = {}): Promise<void> {
  const before = { ...(await read($, view)), ...patch }
  const list = await api($, c, 'GET', '/api/projects')
  if (!list.ok || !Array.isArray(list.body.projects)) {
    await update($, view, () => ({ ...before, phase: 'error', message: list.ok ? 'the dashboard sent no project list' : problem(list) }))
    return
  }
  const projects = list.body.projects as Project[]
  const project = projects.some(p => p.id === before.project) ? before.project : String(list.body.current)
  const global = project === 'global'
  const scope: Scope = global ? 'global' : before.scope === 'global' ? 'project' : before.scope
  const q = `project=${encodeURIComponent(project)}`
  const [settings, mods] = await Promise.all([api($, c, 'GET', `/api/settings?${q}&scope=${scope}`), api($, c, 'GET', `/api/mods?${q}`)])
  const rows = (settings.ok ? settings.body.rows : []) as SettingRow[]
  const groups = [...new Set(rows.map(r => r.group))]
  const group = groups.includes(before.group) ? before.group : (groups[0] ?? '')
  const message = settings.ok ? (mods.ok ? before.message : problem(mods)) : problem(settings)
  await update($, view, () => ({
    ...before,
    phase: 'ready',
    message,
    writable: list.body.writable === true,
    project,
    scope,
    group,
    projects,
    rows,
    mods: (mods.ok ? mods.body.mods : []) as ModRow[],
    restart: String(mods.body.restart ?? ''),
  }))
}

async function ensure($: EngineInterface, opts: Options): Promise<Conn | undefined> {
  const seen = epoch
  try {
    return await connect($, opts)
  } catch (e) {
    // A start that a close already superseded must not paint an error over the closed pane.
    if (epoch === seen) await update($, view, v => ({ ...v, phase: 'error', message: (e as Error).message }))
    return undefined
  }
}

// Sends one write; on success reloads, on refusal shows the server's reason.
// What a write says when it worked: the words to show, and a check made on the data read back
// afterwards, so "saved" means the server now reports the value, not only that it answered 200.
type Note = { saved: string; check?: (after: View) => boolean; unverified?: string }

async function write($: EngineInterface, opts: Options, path: string, body: Record<string, unknown>, note?: Note): Promise<void> {
  const c = await ensure($, opts)
  if (!c) return
  const v = await read($, view)
  await update($, view, s => ({ ...s, message: '' }))
  const r = await api($, c, 'POST', path, { project: v.project, ...(v.project === 'global' ? {} : { path: folderOf(v) }), ...body })
  if (!r.ok) {
    await update($, view, s => ({ ...s, message: `Not saved: ${problem(r)}` }))
    return
  }
  // Removing or adding a project shifts the list positions, so go back to the opening project.
  const moved = path === '/api/projects' ? { project: '', page: 0 } : {}
  await load($, c, { ...moved, message: typeof r.body.warning === 'string' ? r.body.warning : '' })
  if (!note) return
  const after = await read($, view)
  if (after.phase === 'error') return
  if (note.check && !note.check(after)) {
    await update($, view, s => ({ ...s, message: note.unverified ?? 'The server accepted the change but it did not read back as expected. Press Refresh and check.' }))
    return
  }
  await $.ui.toast(`✓ ${note.saved}`, { timeoutMs: 6000 })
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const show = (x: unknown): string => (Array.isArray(x) ? x.join(', ') : String(x))

export const register: Register = (on, options) => {
  const opts = options as Options

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dashboard-pane', description: 'Open the saw settings dashboard in a pane' })
    return next(e)
  })

  on('command.run', { command: 'dashboard-pane' }, async $ => {
    await update($, view, v => ({ ...v, phase: 'starting', message: '' }))
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Dashboard' })
    const c = await ensure($, opts)
    if (c) await load($, c)
    const v = await read($, view)
    if (v.phase === 'error') return { text: `Dashboard pane: ${v.message}` }
    return { text: isPlaced ? 'Dashboard pane opened. Closing it stops the dashboard server it started.' : 'This surface cannot show panes; run saw dashboard --serve for the browser dashboard.' }
  })

  // The server lives as long as the pane (and the session).
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      stop()
      await update($, view, () => EMPTY)
    }
    return next(e)
  })
  on('session.end', async ($, e, next) => {
    stop()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Select, Input } = $.ui.resolve(e)
    const v = await read($, view)
    const retry = async (): Promise<void> => {
      await update($, view, s => ({ ...s, phase: 'starting', message: '' }))
      const c = await ensure($, opts)
      if (c) await load($, c)
    }
    if (v.phase === 'idle') return <Box padding={1}><Text dimColor>Run /dashboard-pane to open the dashboard.</Text></Box>
    if (v.phase === 'starting') return <Box padding={1}><Text dimColor>Starting the dashboard…</Text></Box>
    if (v.phase === 'error') {
      return (
        <Box flexDirection="column" padding={1} gap={1}>
          <Text color="red">{v.message}</Text>
          <Box><Button key="retry" variant="primary" onPress={retry}>Try again</Button></Box>
        </Box>
      )
    }

    const global = v.project === 'global'
    const refresh = async (): Promise<void> => {
      const c = await ensure($, opts)
      if (c) await load($, c)
    }
    const go = (patch: Partial<View>) => async (): Promise<void> => {
      const c = await ensure($, opts)
      if (c) await load($, c, patch)
    }
    const where = v.scope === 'global' ? 'all projects (~/.saw/config.toml)' : v.scope === 'local' ? 'this project, only you (workflow.local.toml)' : 'this project, shared (workflow.toml)'
    const same = (x: unknown, y: unknown): boolean => JSON.stringify(x) === JSON.stringify(y)
    const set = (key: string, value: unknown) =>
      write($, opts, '/api/settings', { scope: v.scope, key, value }, { saved: `${key}: ${typeof value === 'boolean' ? (value ? 'on' : 'off') : show(value)}`, check: a => same(a.rows.find(r => r.key === key)?.layer, value), unverified: `${key} was written but reads back differently. Press Refresh and check ${where}.` })
    const reset = (key: string) =>
      write($, opts, '/api/settings', { scope: v.scope, key, unset: true }, { saved: `${key}: reset`, check: a => a.rows.find(r => r.key === key)?.layer === undefined })
    const current = v.projects.find(p => p.id === v.project)

    // A row of buttons where the chosen one is filled: a switch for on/off, a picker for a few options.
    const seg = (base: string, options: { value: string; label: string }[], chosen: string, pick: (value: string) => unknown) => (
      <Box>
        {options.map(o => (
          <Button key={`${base}:${o.value}`} variant={o.value === chosen ? 'primary' : 'secondary'} onPress={() => (o.value === chosen ? undefined : pick(o.value))}>{o.label}</Button>
        ))}
      </Box>
    )
    const chip = (state: string) => <Text bold color={state === 'ready' || state === 'enabled' ? 'green' : state === 'not set up' || state === 'disabled' || state === 'not installed' ? 'yellow' : 'red'}>{state}</Text>
    const tabs: [Tab, string][] = [['settings', 'Settings'], ['mods', 'Mods'], ['projects', 'Projects']]

    const header = (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between" alignItems="center">
          <Text size="heading" weight="bold">saw dashboard</Text>
          <Box gap={1}>
            <Button key="refresh" dimColor onPress={refresh}>Refresh</Button>
            <Button key="close" dimColor onPress={async () => { stop(); await update($, view, () => EMPTY); await $.ui.close({ id: PANE }) }}>Close</Button>
          </Box>
        </Box>
        <Box flexDirection="column">
          <Select key="project" label="Project" value={v.project} options={v.projects.map(p => ({ value: p.id, label: p.name }))} onSelect={id => go({ project: id, group: '', page: 0, filter: '' })()} />
          {current && <Text dimColor wrap="truncate-middle">{current.path}</Text>}
        </Box>
        <Box gap={1}>
          {tabs.map(([t, label]) => <Button key={`tab:${t}`} variant={v.tab === t ? 'primary' : 'secondary'} onPress={() => update($, view, s => ({ ...s, tab: t, message: '' }))}>{label}</Button>)}
        </Box>
        {v.message !== '' && <Box borderStyle="round" borderColor="yellow" paddingX={1}><Text color="yellow">{v.message}</Text></Box>}
        {!v.writable && <Text dimColor>Read-only here: the switches are off.</Text>}
      </Box>
    )

    let body
    if (v.tab === 'mods') {
      body = (
        <Box flexDirection="column">
          {v.mods.map(m => (
            <Box key={`modcard:${m.name}`} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
              <Box justifyContent="space-between"><Text bold>{m.name}</Text>{chip(m.state)}</Box>
              <Text dimColor>{clip(m.description, 140)}</Text>
              <Box marginTop={1}>
                {m.state === 'not installed' ? <Text dimColor mono>{m.install}</Text> : v.writable ? seg(`mod:${m.name}`, [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], m.state === 'enabled' ? 'on' : 'off', val => write($, opts, '/api/mods', { name: m.name, enabled: val === 'on' }, { saved: `${m.name}: ${val}`, check: a => a.mods.find(x => x.name === m.name)?.state === (val === 'on' ? 'enabled' : 'disabled') })) : <Text dimColor>{m.state}{m.own ? ' (this project)' : ''}</Text>}
              </Box>
            </Box>
          ))}
          {v.restart !== '' && <Text dimColor>{v.restart}</Text>}
        </Box>
      )
    } else if (v.tab === 'projects') {
      const open = (id: string) => go({ project: id, tab: 'settings', group: '', page: 0, filter: '' })
      body = (
        <Box flexDirection="column">
          {v.writable && <Box marginBottom={1}><Input key="add-project" label="Add a project (full folder path)" placeholder="C:\work\app" onSubmit={path => write($, opts, '/api/projects', { action: 'add', path }, { saved: 'Project added' })} /></Box>}
          {v.projects.map(p => (
            <Box key={`projcard:${p.id}`} flexDirection="column" borderStyle="round" borderColor={p.id === v.project ? 'cyan' : 'gray'} paddingX={1} marginBottom={1}>
              <Box justifyContent="space-between"><Text bold>{p.name}</Text>{chip(p.state)}</Box>
              {p.id !== 'global' && <Text dimColor wrap="truncate-middle">{p.path}</Text>}
              <Text dimColor>{p.summary}</Text>
              <Box marginTop={1} gap={1}>
                <Button key={`open:${p.id}`} variant={p.id === v.project ? 'primary' : 'secondary'} onPress={open(p.id)}>{p.id === v.project ? 'Open settings' : 'Open'}</Button>
                {v.writable && p.id !== 'global' && p.state === 'not set up' && <Button key={`setup:${p.id}`} variant="secondary" onPress={() => write($, opts, '/api/projects', { action: 'setup', project: p.id, path: p.path }, { saved: `${p.name}: set up` })}>Set up</Button>}
                {v.writable && p.id !== 'global' && <Button key={`remove:${p.id}`} dimColor onPress={() => write($, opts, '/api/projects', { action: 'remove', project: p.id, path: p.path }, { saved: `${p.name}: removed from the list`, check: a => !a.projects.some(x => x.path === p.path) })}>Remove from list</Button>}
              </Box>
            </Box>
          ))}
        </Box>
      )
    } else {
      const groups = [...new Set(v.rows.map(r => r.group))]
      const needle = v.filter.trim().toLowerCase()
      const shown = needle ? v.rows.filter(r => `${r.key} ${r.description}`.toLowerCase().includes(needle)) : v.rows.filter(r => r.group === v.group)
      const pages = Math.max(1, Math.ceil(shown.length / PAGE_ROWS))
      const page = Math.min(v.page, pages - 1)
      body = (
        <Box flexDirection="column" gap={1}>
          {!global && (
            <Box alignItems="center" gap={1}>
              <Text dimColor>Save to</Text>
              {seg('scope', [{ value: 'project', label: 'Shared' }, { value: 'local', label: 'Only me' }], v.scope, val => go({ scope: val as Scope })())}
            </Box>
          )}
          <Input key="filter" label="Filter" placeholder="Search settings" value={v.filter} onInput={t => update($, view, s => ({ ...s, filter: t, page: 0 }))} onSubmit={t => update($, view, s => ({ ...s, filter: t, page: 0 }))} />
          {!needle && (
            <Box flexWrap="wrap" gap={1}>
              {groups.map(g => <Button key={`group:${g}`} variant={g === v.group ? 'primary' : 'secondary'} onPress={() => update($, view, s => ({ ...s, group: g, page: 0 }))}>{g}</Button>)}
            </Box>
          )}
          <Box flexDirection="column">
            {shown.length === 0 && <Text dimColor>No settings match.</Text>}
            {shown.slice(page * PAGE_ROWS, (page + 1) * PAGE_ROWS).map((r: SettingRow) => {
              const allowed = (val: boolean): boolean => !(r.blocked ?? []).includes(val)
              const lockedOut = r.type === 'boolean' && (!allowed(true) || !allowed(false))
              return (
                <Box key={`row:${r.key}`} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
                  <Box justifyContent="space-between"><Text bold mono>{r.key}</Text><Text dimColor>{r.source}</Text></Box>
                  <Text dimColor>{clip(r.description, 140)}</Text>
                  {r.note && <Text color="yellow">{r.note}</Text>}
                  <Box marginTop={1} alignItems="center" gap={1}>
                    {!v.writable || r.type === 'list' ? <Text>{show(r.value)}</Text> : r.type === 'boolean' ? (
                      <Box alignItems="center" gap={1}>
                        {seg(`set:${r.key}`, [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }].filter(o => allowed(o.value === 'on')), r.value ? 'on' : 'off', val => set(r.key, val === 'on'))}
                        {lockedOut && <Text dimColor>the shared file can only tighten this</Text>}
                      </Box>
                    ) : r.type === 'enum' && (r.options ?? []).length <= 4 ? (
                      seg(`set:${r.key}`, (r.options ?? []).map(o => ({ value: o, label: o })), String(r.value), val => set(r.key, val))
                    ) : r.type === 'enum' ? (
                      <Select key={`set:${r.key}`} value={String(r.value)} options={(r.options ?? []).map(o => ({ value: o }))} onSelect={o => set(r.key, o)} />
                    ) : (
                      <Input key={`set:${r.key}`} value={String(r.value)} onSubmit={t => set(r.key, r.type === 'number' ? Number(t) : t)} />
                    )}
                    {v.writable && r.layer !== undefined && <Button key={`unset:${r.key}`} dimColor onPress={() => reset(r.key)}>Reset</Button>}
                  </Box>
                </Box>
              )
            })}
          </Box>
          {pages > 1 && (
            <Box justifyContent="space-between" alignItems="center">
              <Button key="prev" variant="secondary" onPress={() => update($, view, s => ({ ...s, page: Math.max(0, page - 1) }))}>Prev</Button>
              <Text dimColor>{page + 1} / {pages}</Text>
              <Button key="next" variant="secondary" onPress={() => update($, view, s => ({ ...s, page: Math.min(pages - 1, page + 1) }))}>Next</Button>
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" padding={1} gap={1}>
        {header}
        {body}
      </Box>
    )
  })
}
