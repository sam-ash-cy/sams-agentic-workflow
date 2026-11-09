// Pure detection: no `$`, no state. Finds secrets, emails and IPv4 addresses in text.

export type Kind = 'SECRET' | 'EMAIL' | 'IP'
export type Hit = { kind: Kind; start: number; end: number; value: string }
export type Categories = { secrets: boolean; emails: boolean; ips: boolean }

type Rule = { kind: Kind; re: RegExp; group?: number; check?: (v: string) => boolean }

const RULES: readonly Rule[] = [
  { kind: 'SECRET', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'SECRET', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'SECRET', re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { kind: 'SECRET', re: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g },
  { kind: 'SECRET', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'SECRET', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'SECRET', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'SECRET', re: /\bwhsec_[A-Za-z0-9]{20,}\b/g },
  { kind: 'SECRET', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'SECRET', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // scheme://user:PASSWORD@host: only the password is hidden.
  { kind: 'SECRET', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]{3,})@/gi, group: 1, check: v => !isPlaceholderish(v) },
  // NAME_KEY=value / token: "value": only the value, and only when it looks random.
  {
    kind: 'SECRET',
    re: /\b[A-Za-z0-9_.-]*(?:key|token|secret|passw(?:or)?d|pwd|credential|auth)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?([^\s"'`,;)}\]]{12,})/gi,
    group: 1,
    check: looksRandom,
  },
  { kind: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
  { kind: 'IP', re: /(?<![\w.])(?<!\b(?:[Vv]ersion|[Vv]er|v)[\s:=]*)(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g, check: isIp },
]

const PLACEHOLDER = /«(?:SECRET|EMAIL|IP)_\d+»/

function isPlaceholderish(v: string): boolean {
  return PLACEHOLDER.test(v) || /^(?:\$\{?|<|\{\{|%|process\.env|env\(|os\.environ|getenv)/i.test(v) || /^(?:x+|\*+|changeme|password|secret|your[-_].*|example.*|placeholder.*|dummy.*|test.*)$/i.test(v)
}

function entropy(s: string): number {
  const freq = new Map<string, number>()
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1)
  let h = 0
  for (const n of freq.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}

/** A KEY= value worth hiding: random-looking, not a hash, UUID, path or placeholder. */
function looksRandom(v: string): boolean {
  if (isPlaceholderish(v)) return false
  if (/^[0-9a-f]{7,64}$/i.test(v)) return false // git SHAs, hex digests
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return false // UUIDs
  if (/^(?:[.~]?\/|[A-Za-z]:\\|\\\\|[a-z][a-z0-9+.-]*:\/\/)/i.test(v) || /\.[a-z]{1,5}$/i.test(v)) return false // paths, URLs
  if (isEncodedText(v)) return false // base64 of plain text (test fixtures)
  if (/^[a-z]+(?:[._-][a-z]+)*$/i.test(v)) return false // words / identifiers
  const classes = [/[a-z]/, /[A-Z]/, /\d/].filter(r => r.test(v)).length
  return classes >= 2 && entropy(v) >= 3.5
}

/** Base64 that decodes to readable text, e.g. a fixture like "test fixture data". */
function isEncodedText(v: string): boolean {
  if (v.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return false
  try {
    const s = atob(v)
    return /^[\x20-\x7e\t\r\n]+$/.test(s) && /[ _-]/.test(s)
  } catch {
    return false
  }
}

function isIp(v: string): boolean {
  const parts = v.split('.').map(Number)
  if (parts.some(n => n > 255)) return false
  return v !== '0.0.0.0' && !v.startsWith('127.') && v !== '255.255.255.255'
}

export function parseAllowlist(raw: string): RegExp[] {
  const out: RegExp[] = []
  // A comma inside {m,n} belongs to the pattern, not the list.
  for (const p of raw.split(/,(?![^{]*\})/).map(s => s.trim()).filter(Boolean)) {
    try {
      out.push(new RegExp(p, 'i'))
    } catch {
      // an invalid pattern is skipped
    }
  }
  return out
}

/** Every non-overlapping hit in `text`, earliest and longest first. */
export function detect(text: string, cats: Categories, allow: readonly RegExp[]): Hit[] {
  const hits: Hit[] = []
  for (const rule of RULES) {
    if (rule.kind === 'SECRET' && !cats.secrets) continue
    if (rule.kind === 'EMAIL' && !cats.emails) continue
    if (rule.kind === 'IP' && !cats.ips) continue
    for (const m of text.matchAll(rule.re)) {
      const value = rule.group === undefined ? m[0] : m[rule.group]
      if (value === undefined || PLACEHOLDER.test(value)) continue
      if (rule.check && !rule.check(value)) continue
      if (allow.some(a => a.test(value))) continue
      const at = (m.index ?? 0) + (rule.group === undefined ? 0 : m[0].lastIndexOf(value))
      hits.push({ kind: rule.kind, start: at, end: at + value.length, value })
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: Hit[] = []
  for (const h of hits) {
    const last = kept[kept.length - 1]
    if (last === undefined || h.start >= last.end) kept.push(h)
  }
  return kept
}

/** Calls `fn` on every string inside a JSON-like value, rebuilding it. */
export function mapStrings(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === 'string') return fn(v)
  if (Array.isArray(v)) return v.map(x => mapStrings(x, fn))
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = mapStrings(x, fn)
    return out
  }
  return v
}
