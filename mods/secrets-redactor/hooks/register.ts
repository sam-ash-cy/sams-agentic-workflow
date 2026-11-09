import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import type { Vault } from '../types'
import { type Categories, type Hit, detect, mapStrings, parseAllowlist } from './detect'

type Mode = 'redact' | 'warn' | 'stop'
type Cfg = { cats: Categories; allow: RegExp[]; mode: Mode; blockHardcoded: boolean }

const TOKEN = /«(?:SECRET|EMAIL|IP)_\d+»/g
const RESERVED = new Set(['tool', 'tool_use_id', 'consent', 'agentId', 'requestMeta'])
const EDITORS = new Set(['Write', 'Edit', 'MultiEdit'])
const SECRET_FILE = /(^|[\\/])\.env(\.(?!example$|sample$|template$|dist$)[^\\/]*)?$/i
const OK = '!secrets-ok'

function emptyVault(): Vault {
  return { byValue: {}, byToken: {}, count: {} }
}

async function readVault($: EngineInterface): Promise<{ vault: Vault; version: number }> {
  const { value, version } = await $.state.get({ plugin: 'secrets-redactor', key: 'vault' })
  return { vault: value ?? emptyVault(), version }
}

/** Gives every hit a stable placeholder, saving new ones with a version check so parallel calls agree. */
async function assign($: EngineInterface, hits: readonly Hit[]): Promise<{ vault: Vault; fresh: Hit[] }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { vault, version } = await readVault($)
    const fresh = hits.filter(h => vault.byValue[h.value] === undefined)
    if (fresh.length === 0) return { vault, fresh }
    const next: Vault = { byValue: { ...vault.byValue }, byToken: { ...vault.byToken }, count: { ...vault.count } }
    for (const h of fresh) {
      if (next.byValue[h.value] !== undefined) continue
      const n = (next.count[h.kind] ?? 0) + 1
      next.count[h.kind] = n
      const token = `«${h.kind}_${n}»`
      next.byValue[h.value] = token
      next.byToken[token] = h.value
    }
    const { isSet } = await $.state.set({ plugin: 'secrets-redactor', key: 'vault' }, next, { ifVersion: version })
    if (isSet) return { vault: next, fresh }
  }
  throw new Error('secrets-redactor: could not save placeholders')
}

async function halted($: EngineInterface): Promise<string> {
  const { value } = await $.state.get({ plugin: 'secrets-redactor', key: 'halt' })
  return value ?? ''
}

async function setHalt($: EngineInterface, reason: string): Promise<void> {
  await $.state.set({ plugin: 'secrets-redactor', key: 'halt' }, reason)
}

/** Placeholders in the tool's input go back to their real values. */
async function restoreInput($: EngineInterface, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  let hasToken = false
  for (const [k, v] of Object.entries(input)) {
    if (!RESERVED.has(k)) mapStrings(v, s => ((hasToken ||= s.includes('«')), s))
  }
  if (!hasToken) return input
  const { vault } = await readVault($)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    out[k] = RESERVED.has(k) ? v : mapStrings(v, s => s.replace(TOKEN, t => vault.byToken[t] ?? t))
  }
  return out
}

async function newContent($: EngineInterface, input: Record<string, unknown>): Promise<{ added: string; removed: string }> {
  if (input.tool === 'Write') {
    // A rewrite keeps what the file already held: only secrets it lacked are new.
    let before = ''
    try {
      before = await $.fs.read(String(input.file_path ?? ''))
    } catch {
      // a new file
    }
    return { added: String(input.content ?? ''), removed: before }
  }
  if (input.tool === 'Edit') return { added: String(input.new_string ?? ''), removed: String(input.old_string ?? '') }
  const edits = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : []
  return {
    added: edits.map(x => String(x.new_string ?? '')).join('\n'),
    removed: edits.map(x => String(x.old_string ?? '')).join('\n'),
  }
}

/** The reason to refuse an edit that writes a secret into source, or undefined. */
async function hardcoded($: EngineInterface, input: Record<string, unknown>, cfg: Cfg): Promise<string | undefined> {
  if (!cfg.blockHardcoded || !EDITORS.has(String(input.tool))) return undefined
  const path = String(input.file_path ?? '')
  if (SECRET_FILE.test(path)) return undefined
  const { added, removed } = await newContent($, input)
  const cats = { secrets: true, emails: false, ips: false }
  const before = new Set(detect(removed, cats, cfg.allow).map(h => h.value))
  const found = detect(added, cats, cfg.allow).filter(h => !before.has(h.value))
  if (found.length === 0) return undefined
  return (
    `secrets-redactor: this ${String(input.tool)} would hardcode ${found.length} secret(s) into ${path || 'a file'}. ` +
    'Read it from an environment variable instead (process.env.NAME / env("NAME")), and put a placeholder such as NAME=your-key-here in .env.example.'
  )
}

/** Hides what `detect` finds in every string of the result; reports what it hid. */
async function redactResult($: EngineInterface, result: unknown, cfg: Cfg): Promise<{ result: unknown; hits: Hit[]; fresh: Hit[] }> {
  const hits: Hit[] = []
  const perString = new Map<string, Hit[]>()
  mapStrings(result, s => {
    if (perString.has(s)) return s
    const found = detect(s, cfg.cats, cfg.allow)
    perString.set(s, found)
    hits.push(...found)
    return s
  })
  if (hits.length === 0) return { result, hits, fresh: [] }
  if (cfg.mode === 'warn') return { result, hits, fresh: hits }
  const { vault, fresh } = await assign($, hits)
  const redacted = mapStrings(result, s => {
    const found = perString.get(s) ?? []
    if (found.length === 0) return s
    let out = ''
    let at = 0
    for (const h of found) {
      out += s.slice(at, h.start) + (vault.byValue[h.value] ?? h.value)
      at = h.end
    }
    return out + s.slice(at)
  })
  return { result: redacted, hits, fresh }
}

function summary(hits: readonly Hit[]): string {
  const by = new Map<string, number>()
  for (const h of hits) by.set(h.kind, (by.get(h.kind) ?? 0) + 1)
  return [...by].map(([k, n]) => `${n} ${k.toLowerCase()}${n === 1 ? '' : 's'}`).join(', ')
}

/** In stop mode, only a secret not seen before this session halts: one already acknowledged does not. */
async function haltOnFresh($: EngineInterface, fresh: readonly Hit[], tool: unknown, cfg: Cfg): Promise<void> {
  const secrets = fresh.filter(h => h.kind === 'SECRET').length
  if (cfg.mode === 'stop' && secrets > 0) await setHalt($, `${secrets} new secret(s) appeared in ${String(tool)} output.`)
}

async function onToolCall(
  $: EngineInterface,
  e: Record<string, unknown>,
  next: (e: Record<string, unknown>) => Promise<ToolCallResult>,
  cfg: Cfg,
): Promise<ToolCallResult> {
  const halt = await halted($)
  if (halt !== '') return { deny: `secrets-redactor stopped tool calls: ${halt} Ask the person to reply "${OK}" once it is resolved.` }

  const input = await restoreInput($, e)
  const refuse = await hardcoded($, input, cfg)
  if (refuse !== undefined) {
    $.ui.toast('secrets-redactor: blocked a hardcoded secret')
    return { deny: refuse }
  }

  const ran = await next(input)
  if (ran.deny !== undefined) return ran

  if (ran.isError === true) {
    // An error's text reaches the model too: redact it and answer it as a refusal.
    const text = String(ran.text ?? '')
    const err = await redactResult($, text, cfg)
    if (err.hits.length === 0 || cfg.mode === 'warn') return ran
    await haltOnFresh($, err.fresh, e.tool, cfg)
    return { deny: `${String(e.tool)} failed: ${String(err.result)}` }
  }

  const { result, hits, fresh } = await redactResult($, ran.result, cfg)
  if (hits.length === 0) return ran

  const what = summary(hits)
  $.ui.toast(`secrets-redactor: ${String(e.tool)} output held ${what}${cfg.mode === 'warn' ? ' (not hidden)' : ''}`)
  const note =
    cfg.mode === 'warn'
      ? `secrets-redactor: this output contains ${what}. Do not repeat, log or commit them.`
      : `secrets-redactor: ${what} in this output were replaced with placeholders like «SECRET_1». Use the placeholders as-is in later tool calls; they are swapped back for the real values before the tool runs. Never write a secret into source: use an environment variable.`
  await haltOnFresh($, fresh, e.tool, cfg)
  if (cfg.mode === 'warn') return { result: ran.result, context: [...(ran.context ?? []), note] } as ToolCallResult
  return { result, context: [...(ran.context ?? []), note] } as ToolCallResult
}

function readCfg(options: Readonly<Record<string, unknown>>): Cfg {
  const mode = options.onSecret === 'warn' || options.onSecret === 'stop' ? options.onSecret : 'redact'
  return {
    cats: { secrets: options.secrets !== false, emails: options.emails !== false, ips: options.ips !== false },
    allow: parseAllowlist(typeof options.allowlist === 'string' ? options.allowlist : ''),
    mode,
    blockHardcoded: options.blockHardcoded !== false,
  }
}

export const register: Register = (on, options) => {
  const cfg = readCfg(options)

  on('tool.call', ($, e, next) =>
    onToolCall(
      $,
      e as unknown as Record<string, unknown>,
      x => next(x as unknown as typeof e) as Promise<ToolCallResult>,
      cfg,
    ),
  ).catch(($, e, next) =>
    next.called
      ? { deny: 'secrets-redactor: its redaction failed, so the output is withheld.' }
      : { deny: 'secrets-redactor: its check failed, so the call was not run.' },
  )

  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) return next(e)
    const halt = await halted($)
    if (halt === '') return next(e)
    if (e.text.trim().startsWith(OK)) {
      await setHalt($, '')
      $.ui.toast('secrets-redactor: resumed')
      const rest = e.text.trim().slice(OK.length).trim()
      return next({ ...e, text: rest === '' ? 'The secret is resolved; carry on.' : rest })
    }
    return { drop: `secrets-redactor is holding prompts: ${halt} Rotate or remove it, then send "${OK}" (optionally followed by your prompt).` }
  }).catch(($, e, next) => (next.called ? next(e) : { drop: 'secrets-redactor: its check failed, so the prompt was held. Try again.' }))
}
