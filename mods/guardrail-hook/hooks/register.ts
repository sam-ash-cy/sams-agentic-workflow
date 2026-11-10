import type { EngineInterface, Register } from 'claude-code'

// git commit / git push: the branch must be <type>/<kebab-description> and
// not one a tool picked; a commit message carries no AI attribution.

// git's global options (-C <dir>, -c <k=v>, --no-pager, …) may sit before the
// subcommand; a command can start a line, follow ; & | or open a subshell.
const GIT_OPTS = String.raw`git\s+(?:(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?)\s+)*`
const START = String.raw`(?:^|[;&|\n(]\s*)`
const GIT_COMMIT = new RegExp(`${START}${GIT_OPTS}commit\\b`)
const GIT_PUSH = new RegExp(`${START}${GIT_OPTS}push\\b`)
const GIT_DIR = /(?:^|[;&|\n(]\s*)git\s+(?:-c\s+\S+\s+|--[\w-]+\s+)*-C\s+("[^"]+"|'[^']+'|\S+)/
const GOOD_BRANCH = /^(feat|fix|docs|refactor|test|chore|ci|perf|build|style|revert|hotfix)\/[a-z0-9]+(-[a-z0-9]+)*$|^release\/v\d+\.\d+\.\d+$/
const AUTO_BRANCH = /^(claude\/|worktree-)/
const ATTRIBUTION = /co-authored-by:\s*claude|generated with \[?claude|🤖 generated/i

export function branchProblem(branch: string): string | null {
  if (!branch || branch === 'HEAD') return null
  if (AUTO_BRANCH.test(branch)) return `"${branch}" is an auto-generated branch name`
  if (['main', 'master'].includes(branch)) return null // the saw guard handles the default branch
  if (!GOOD_BRANCH.test(branch)) return `"${branch}" does not follow <type>/<kebab-description>`
  return null
}

export function hasAttribution(command: string): boolean {
  return ATTRIBUTION.test(command)
}

// The repo the command acts on: its `git -C <dir>` when given, else the session's.
export function targetDir(command: string, cwd: string): string {
  const m = GIT_DIR.exec(command)
  if (!m) return cwd
  const dir = (m[1] ?? '').replace(/^["']|["']$/g, '')
  return /^([A-Za-z]:)?[\\/]/.test(dir) ? dir : `${cwd}/${dir}`
}

async function currentBranch($: EngineInterface, command: string): Promise<string> {
  const cwd = targetDir(command, await $.session.cwd())
  const r = await $.process.run(['git', '-C', cwd, 'branch', '--show-current'], { cwd, timeoutMs: 5000 })
  return r.exitCode === 0 ? r.stdout.trim() : ''
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const isCommit = GIT_COMMIT.test(e.command)
    if (!isCommit && !GIT_PUSH.test(e.command)) return next(e)
    if (isCommit && hasAttribution(e.command)) {
      return { deny: 'guardrail-hook: remove the AI attribution (Co-Authored-By / "Generated with Claude") from the commit message.' }
    }
    const problem = branchProblem(await currentBranch($, e.command))
    if (problem) {
      return { deny: `guardrail-hook: ${problem}. Rename it first: git branch -m <type>/<short-kebab-description>.` }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'guardrail-hook: its check failed; check the branch name by hand.' }))
}
