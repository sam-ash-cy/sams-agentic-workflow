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
const PAGE_ROWS = 6

const EMPTY: View = { phase: 'idle', message: '', writable: false, tab: 'settings', project: '', scope: 'project', group: '', page: 0, projects: [], rows: [], mods: [], restart: '' }
const view = atom({ plugin: 'dashboard-pane', key: 'view' } as const, EMPTY, { shape: 'view-1' })

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

// How to run saw. An explicit sawCommand wins. Otherwise plain `saw` if it starts; on Windows the
// `saw` on PATH is a shell shim that cannot be spawned without a shell, so find the repo it lives
// in (where saw) and run its CLI with bun, which is a real executable.
async function sawArgv($: EngineInterface, opts: Options): Promise<string[]> {
  if (opts.sawCommand && opts.sawCommand !== 'saw') return opts.sawCommand.split(' ').filter(Boolean)
  if (resolved) return resolved
  try {
    await $.process.run(['saw', '--version'], { timeoutMs: 10000 })
    resolved = ['saw']
    return resolved
  } catch {
    /* not startable here: look for the checkout it lives in */
  }
  try {
    const found = await $.process.run(['where', 'saw'], { timeoutMs: 10000 })
    const shim = found.stdout.split('\n').map(l => l.trim()).find(l => /[\\/]bin[\\/]saw(\.cmd)?$/i.test(l))
    if (shim) {
      resolved = ['bun', shim.replace(/[\\/]bin[\\/]saw(\.cmd)?$/i, '/cli/src/main.ts')]
      return resolved
    }
  } catch {
    /* no where.exe: fall through to the plain name and its error */
  }
  return ['saw']
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
  const run: Child = $.process.spawn({ argv: [...(await sawArgv($, opts)), 'dashboard', '--serve', '--port', '0'], cwd: await $.session.cwd() })
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
async function write($: EngineInterface, opts: Options, path: string, body: Record<string, unknown>): Promise<void> {
  const c = await ensure($, opts)
  if (!c) return
  const v = await read($, view)
  const r = await api($, c, 'POST', path, { project: v.project, ...(v.project === 'global' ? {} : { path: folderOf(v) }), ...body })
  if (!r.ok) {
    await update($, view, s => ({ ...s, message: problem(r) }))
    return
  }
  // Removing or adding a project shifts the list positions, so go back to the opening project.
  const moved = path === '/api/projects' ? { project: '', page: 0 } : {}
  await load($, c, { ...moved, message: typeof r.body.warning === 'string' ? r.body.warning : '' })
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
    if (v.phase === 'idle') return <Text dimColor>Run /dashboard-pane to open the dashboard.</Text>
    if (v.phase === 'starting') return <Text dimColor>Starting the dashboard…</Text>
    if (v.phase === 'error') {
      return (
        <Box flexDirection="column">
          <Text color="red">{v.message}</Text>
          <Button key="retry" onPress={async () => { await update($, view, s => ({ ...s, phase: 'starting', message: '' })); const c = await ensure($, opts); if (c) await load($, c) }}>Try again</Button>
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
    const set = (key: string, value: unknown) => write($, opts, '/api/settings', { scope: v.scope, key, value })
    const tabs: [Tab, string][] = [['settings', 'Settings'], ['mods', 'Mods'], ['projects', 'Projects']]
    const current = v.projects.find(p => p.id === v.project)

    const header = (
      <Box flexDirection="column">
        <Text bold>saw dashboard <Text dimColor>{current ? current.name : ''}</Text></Text>
        <Select key="project" label="Project" value={v.project} options={v.projects.map(p => ({ value: p.id, label: p.name }))} onSelect={id => go({ project: id, group: '', page: 0 })()} />
        <Box>
          {tabs.map(([t, label]) => <Button key={`tab:${t}`} variant={v.tab === t ? 'primary' : undefined} onPress={() => update($, view, s => ({ ...s, tab: t, message: '' }))}>{label}</Button>)}
          <Button key="refresh" dimColor onPress={refresh}>Refresh</Button>
          <Button key="close" dimColor onPress={async () => { stop(); await update($, view, () => EMPTY); await $.ui.close({ id: PANE }) }}>Close</Button>
        </Box>
        {v.message !== '' && <Text color="yellow">{v.message}</Text>}
        {!v.writable && <Text dimColor>Read-only here: switches are off.</Text>}
      </Box>
    )

    if (v.tab === 'mods') {
      return (
        <Box flexDirection="column">
          {header}
          {v.mods.map(m => (
            <Box flexDirection="column">
              <Text bold>{m.name} <Text dimColor>{m.state}{m.own ? ' (this project)' : ''}</Text></Text>
              <Text dimColor>{clip(m.description, 90)}</Text>
              {m.state === 'not installed' ? <Text dimColor>{m.install}</Text> : v.writable && <Button key={`mod:${m.name}`} onPress={() => write($, opts, '/api/mods', { name: m.name, enabled: m.state !== 'enabled' })}>{m.state === 'enabled' ? '[x] on' : '[ ] off'}</Button>}
            </Box>
          ))}
          {v.restart !== '' && <Text dimColor>{v.restart}</Text>}
        </Box>
      )
    }

    if (v.tab === 'projects') {
      return (
        <Box flexDirection="column">
          {header}
          {v.projects.filter(p => p.id !== 'global').map(p => (
            <Box flexDirection="column">
              <Text bold>{p.name} <Text dimColor>{p.state}</Text></Text>
              <Text dimColor>{clip(p.path, 90)} · {p.summary}</Text>
              {v.writable && (
                <Box>
                  {p.state === 'not set up' && <Button key={`setup:${p.id}`} onPress={() => write($, opts, '/api/projects', { action: 'setup', project: p.id, path: p.path })}>Set up</Button>}
                  <Button key={`remove:${p.id}`} dimColor onPress={() => write($, opts, '/api/projects', { action: 'remove', project: p.id, path: p.path })}>Remove from list</Button>
                </Box>
              )}
            </Box>
          ))}
          {v.writable && <Input key="add-project" label="Add a project (full folder path)" placeholder="C:\work\app" onSubmit={path => write($, opts, '/api/projects', { action: 'add', path })} />}
        </Box>
      )
    }

    const groups = [...new Set(v.rows.map(r => r.group))]
    const inGroup = v.rows.filter(r => r.group === v.group)
    const pages = Math.max(1, Math.ceil(inGroup.length / PAGE_ROWS))
    const page = Math.min(v.page, pages - 1)
    return (
      <Box flexDirection="column">
        {header}
        {!global && (
          <Box>
            <Button key="scope:project" variant={v.scope === 'project' ? 'primary' : undefined} onPress={go({ scope: 'project' })}>Shared</Button>
            <Button key="scope:local" variant={v.scope === 'local' ? 'primary' : undefined} onPress={go({ scope: 'local' })}>Only me</Button>
          </Box>
        )}
        <Select key="group" label="Group" value={v.group} options={groups.map(g => ({ value: g }))} onSelect={g => update($, view, s => ({ ...s, group: g, page: 0 }))} />
        {inGroup.slice(page * PAGE_ROWS, (page + 1) * PAGE_ROWS).map((r: SettingRow) => {
          const next = r.type === 'boolean' ? !r.value : undefined
          const blocked = next !== undefined && (r.blocked ?? []).includes(next)
          return (
            <Box flexDirection="column">
              <Text bold>{r.key} <Text dimColor>{r.source}</Text></Text>
              <Text dimColor>{clip(r.description, 100)}</Text>
              {r.note && <Text color="yellow">{r.note}</Text>}
              {!v.writable || r.type === 'list' ? <Text>{show(r.value)}</Text> : r.type === 'boolean' ? (
                blocked ? <Text dimColor>{r.value ? '[x] on' : '[ ] off'} (the shared file can only tighten this)</Text> : <Button key={`set:${r.key}`} onPress={() => set(r.key, next)}>{r.value ? '[x] on' : '[ ] off'}</Button>
              ) : r.type === 'enum' ? (
                <Select key={`set:${r.key}`} value={String(r.value)} options={(r.options ?? []).map(o => ({ value: o }))} onSelect={o => set(r.key, o)} />
              ) : (
                <Input key={`set:${r.key}`} value={String(r.value)} onSubmit={t => set(r.key, r.type === 'number' ? Number(t) : t)} />
              )}
              {v.writable && r.layer !== undefined && <Button key={`unset:${r.key}`} dimColor onPress={() => write($, opts, '/api/settings', { scope: v.scope, key: r.key, unset: true })}>Reset</Button>}
            </Box>
          )
        })}
        {pages > 1 && (
          <Box>
            <Button key="prev" dimColor onPress={() => update($, view, s => ({ ...s, page: Math.max(0, page - 1) }))}>Prev</Button>
            <Text dimColor> {page + 1}/{pages} </Text>
            <Button key="next" dimColor onPress={() => update($, view, s => ({ ...s, page: Math.min(pages - 1, page + 1) }))}>Next</Button>
          </Box>
        )}
      </Box>
    )
  })
}
