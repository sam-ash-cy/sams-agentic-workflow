import { expect, test } from 'claude-code/testing'

// Fixtures are AWS's documented example key and tokens built at run time, so no
// scanner mistakes this file for a leak.
const AWS = 'AKIAIOSFODNN7EXAMPLE'
const GH = 'ghp_' + 'a1B2c3D4e5'.repeat(4)
const ANT = 'sk-ant-' + 'Zx9Qw8Er7Ty6'.repeat(3)

const out = (stdout: string) => () => ({ result: { stdout, stderr: '', interrupted: false } })
const prompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const stdoutOf =(r: { result?: unknown }) => String((r.result as { stdout?: string } | undefined)?.stdout)

test('the same value gets the same placeholder across calls', async ($, on) => {
  on('tool.call', out(`key ${AWS} from bob@corp.io at 10.1.2.3`))
  const a = stdoutOf(await $.tool.call({ tool: 'Bash', command: 'cat a' }))
  const b = stdoutOf(await $.tool.call({ tool: 'Bash', command: 'cat b' }))
  expect(a).toBe('key «SECRET_1» from «EMAIL_1» at «IP_1»')
  expect(b).toBe(a)
  expect(a).not.toContain(AWS)
})

test('placeholders in tool input are restored before the tool runs', async ($, on) => {
  let seen = ''
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash') seen = e.command
    return { result: { stdout: seen.startsWith('echo') ? '' : `token ${GH}`, stderr: '', interrupted: false } }
  })
  const r = stdoutOf(await $.tool.call({ tool: 'Bash', command: 'cat cfg' }))
  expect(r).toBe('token «SECRET_1»')
  await $.tool.call({ tool: 'Bash', command: 'echo «SECRET_1» | gh auth login --with-token' })
  expect(seen).toBe(`echo ${GH} | gh auth login --with-token`)
})

test('a Write that hardcodes a secret is denied; a .env file is not', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  const r = await $.tool.call({ tool: 'Write', file_path: 'src/client.ts', content: `const key = "${ANT}"\n` })
  expect(String(r.deny)).toContain('environment variable')
  const env = await $.tool.call({ tool: 'Write', file_path: '.env', content: `ANTHROPIC_API_KEY=${ANT}\n` })
  expect(env.deny).toBeUndefined()
})

test('stop mode holds tool calls and prompts until !secrets-ok', { options: { onSecret: 'stop' } }, async ($, on) => {
  on('tool.call', out(`AWS_ACCESS_KEY_ID=${AWS}`))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const first = await $.tool.call({ tool: 'Bash', command: 'env' })
  expect(stdoutOf(first)).toBe('AWS_ACCESS_KEY_ID=«SECRET_1»')
  const blocked = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(String(blocked.deny)).toContain('stopped')
  const held = await $.prompt.submit(prompt('keep going'))
  expect(String(held.drop)).toContain('!secrets-ok')
  const resumed = await $.prompt.submit(prompt('!secrets-ok rotated it'))
  expect(resumed.text).toBe('rotated it')
  const after = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(after.deny).toBeUndefined()
})

test('git SHAs, UUIDs, versions and base64 fixtures are left alone', async ($, on) => {
  const text = [
    'commit 137e7d6a1f0c2b9e8d7c6b5a4f3e2d1c0b9a8f7e',
    'id: 3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    'sha_token: 9b82f5a3e3b5c1d2',
    'fixture: "dGVzdCBmaXh0dXJlIGRhdGE="',
    'token: "dGVzdCBmaXh0dXJlIGRhdGE="',
    'version 1.2.3 and 127.0.0.1, Version 4.0.0.0',
  ].join('\n')
  on('tool.call', out(text))
  const r = stdoutOf(await $.tool.call({ tool: 'Bash', command: 'git log' }))
  expect(r).toBe(text)
})

test('warn mode flags but does not hide', { options: { onSecret: 'warn' } }, async ($, on) => {
  on('tool.call', out(`token ${GH}`))
  const r = await $.tool.call({ tool: 'Bash', command: 'cat' })
  expect(stdoutOf(r)).toBe(`token ${GH}`)
  expect(String((r as { context?: readonly string[] }).context)).toContain('1 secret')
})

const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/' + 'bPxRfiCYEXAMPLEKEY'

test('a KEY= secret containing slashes is redacted', async ($, on) => {
  on('tool.call', out(`aws_secret_access_key = ${AWS_SECRET}`))
  const r = stdoutOf(await $.tool.call({ tool: 'Bash', command: 'cat creds' }))
  expect(r).toBe('aws_secret_access_key = «SECRET_1»')
})

test('an errored result is redacted too', async ($, on) => {
  on('tool.call', () => ({ isError: true as const, result: undefined, text: `boom GITHUB_TOKEN=${GH}` }))
  const r = await $.tool.call({ tool: 'Bash', command: 'env; exit 1' })
  expect(String(r.deny)).toContain('«SECRET_1»')
  expect(String(r.deny)).not.toContain(GH)
})

test('stop mode does not halt again for an acknowledged secret', { options: { onSecret: 'stop' } }, async ($, on) => {
  on('tool.call', out(`token ${GH}`))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.tool.call({ tool: 'Bash', command: 'cat' })
  await $.prompt.submit(prompt('!secrets-ok'))
  await $.tool.call({ tool: 'Bash', command: 'cat' })
  const after = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(after.deny).toBeUndefined()
})

test('rewriting a file that already held the secret is allowed', async ($, on) => {
  on('fs.read', () => ({ value: `const key = "${ANT}"\n` }))
  on('tool.call', () => ({ result: {} }))
  const r = await $.tool.call({ tool: 'Write', file_path: 'src/old.ts', content: `// tidy\nconst key = "${ANT}"\n` })
  expect(r.deny).toBeUndefined()
})

test('an allowlist pattern with {m,n} is kept whole', { options: { allowlist: '^10[.]0[.][0-9]{1,3}[.][0-9]{1,3}$' } }, async ($, on) => {
  on('tool.call', out('hosts 10.0.4.5 and 10.9.4.5'))
  const r = stdoutOf(await $.tool.call({ tool: 'Bash', command: 'hosts' }))
  expect(r).toBe('hosts 10.0.4.5 and «IP_1»')
})
