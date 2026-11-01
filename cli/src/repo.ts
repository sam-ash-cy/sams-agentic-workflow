// `saw repo plan|apply`: GitHub settings as code. plan reads the
// live settings with gh and prints a diff; apply changes them only with
// --yes, then re-reads them to verify. It never changes visibility, deletes
// anything, or sets secret values, and uses the user's own gh auth.

import type { Table } from "./defaults";

export type Gh = (args: string[], input?: string) => { code: number; out: string };

export const gh: Gh = (args, input) => {
  const p = Bun.spawnSync(["gh", ...args], { stdin: input === undefined ? "ignore" : Buffer.from(input), stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode ?? 1, out: p.stdout.toString() + p.stderr.toString() };
};

interface RepoConfig {
  enabled: boolean;
  merge: Record<string, boolean>;
  protect: { branch: string; require_pr: boolean; required_approvals: number; required_checks: string[]; block_force_push: boolean };
  security: Record<string, boolean>;
  labels: string[];
}

export interface State {
  repo: Record<string, unknown>;
  labels: string[];
  protection?: Record<string, unknown>;
  dependabot_alerts?: boolean;
  dependabot_fixes?: boolean;
}

export interface Change {
  what: string;
  from: string;
  to: string;
  args: string[];
  input?: string;
}

const MERGE_FIELDS: Record<string, string> = {
  squash: "allow_squash_merge",
  merge_commit: "allow_merge_commit",
  rebase: "allow_rebase_merge",
  delete_branch_on_merge: "delete_branch_on_merge",
  auto_merge: "allow_auto_merge",
};

const json = (text: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

export function readState(run: Gh, name: string, branch: string): State {
  const repo = run(["api", `repos/${name}`]);
  if (repo.code !== 0) throw new Error(`gh api repos/${name} failed: ${repo.out.trim()}`);
  let labels: { name: string }[] = [];
  try {
    labels = JSON.parse(run(["api", `repos/${name}/labels?per_page=100`]).out) as { name: string }[];
  } catch {
    // No labels readable: every configured label shows as missing.
  }
  const protection = run(["api", `repos/${name}/branches/${encodeURIComponent(branch)}/protection`]);
  const fixes = run(["api", `repos/${name}/automated-security-fixes`]);
  return {
    repo: json(repo.out) ?? {},
    labels: Array.isArray(labels) ? labels.map((l) => l.name) : [],
    protection: protection.code === 0 ? json(protection.out) : undefined,
    // 204 when enabled, 404 when not.
    dependabot_alerts: run(["api", `repos/${name}/vulnerability-alerts`]).code === 0,
    dependabot_fixes: fixes.code === 0 ? Boolean(json(fixes.out)?.enabled) : undefined,
  };
}

export function repoPlan(config: Table, name: string, s: State): Change[] {
  const c = config.repo as unknown as RepoConfig;
  const changes: Change[] = [];
  for (const [key, field] of Object.entries(MERGE_FIELDS)) {
    const want = c.merge[key];
    if (want === undefined || s.repo[field] === want) continue;
    changes.push({ what: `merge.${key}`, from: String(s.repo[field]), to: String(want), args: ["api", "-X", "PATCH", `repos/${name}`, "-F", `${field}=${want}`] });
  }

  const sa = (s.repo.security_and_analysis ?? {}) as Record<string, { status?: string }>;
  for (const [key, field] of [["secret_scanning", "secret_scanning"], ["push_protection", "secret_scanning_push_protection"]] as const) {
    const want = c.security[key];
    const now = sa[field]?.status === "enabled";
    if (want === undefined || now === want) continue;
    const input = JSON.stringify({ security_and_analysis: { [field]: { status: want ? "enabled" : "disabled" } } });
    changes.push({ what: `security.${key}`, from: String(now), to: String(want), args: ["api", "-X", "PATCH", `repos/${name}`, "--input", "-"], input });
  }
  for (const [key, path] of [["dependabot_alerts", "vulnerability-alerts"], ["dependabot_fixes", "automated-security-fixes"]] as const) {
    const want = c.security[key];
    if (want === undefined || s[key] === want) continue;
    changes.push({ what: `security.${key}`, from: String(s[key]), to: String(want), args: ["api", "-X", want ? "PUT" : "DELETE", `repos/${name}/${path}`] });
  }

  for (const label of c.labels) {
    if (!s.labels.includes(label)) changes.push({ what: `label ${label}`, from: "absent", to: "present", args: ["api", "-X", "POST", `repos/${name}/labels`, "-f", `name=${label}`] });
  }

  if (c.protect.branch) {
    const p = s.protection ?? {};
    const reviews = p.required_pull_request_reviews as { required_approving_review_count?: number } | undefined;
    const checks = ((p.required_status_checks as { contexts?: string[] } | undefined)?.contexts ?? []).slice().sort();
    const now = {
      require_pr: Boolean(reviews),
      required_approvals: reviews?.required_approving_review_count ?? 0,
      required_checks: checks.join(","),
      block_force_push: !(p.allow_force_pushes as { enabled?: boolean } | undefined)?.enabled && s.protection !== undefined,
    };
    const want = {
      require_pr: c.protect.require_pr,
      required_approvals: c.protect.require_pr ? c.protect.required_approvals : 0,
      required_checks: [...c.protect.required_checks].sort().join(","),
      block_force_push: c.protect.block_force_push,
    };
    const diff = (Object.keys(want) as (keyof typeof want)[]).filter((k) => now[k] !== want[k]);
    if (diff.length) {
      const input = JSON.stringify({
        required_status_checks: c.protect.required_checks.length ? { strict: false, contexts: c.protect.required_checks } : null,
        enforce_admins: false,
        required_pull_request_reviews: c.protect.require_pr ? { required_approving_review_count: c.protect.required_approvals } : null,
        restrictions: null,
        allow_force_pushes: !c.protect.block_force_push,
        allow_deletions: false,
      });
      changes.push({
        what: `protect ${c.protect.branch} (${diff.join(", ")})`,
        from: diff.map((k) => `${k}=${now[k]}`).join(" "),
        to: diff.map((k) => `${k}=${want[k]}`).join(" "),
        args: ["api", "-X", "PUT", `repos/${name}/branches/${encodeURIComponent(c.protect.branch)}/protection`, "--input", "-"],
        input,
      });
    }
  }
  return changes;
}

export interface Applied {
  applied: string[];
  skipped: string[];
  failed: string[];
}

export function applyPlan(run: Gh, changes: Change[]): Applied {
  const r: Applied = { applied: [], skipped: [], failed: [] };
  for (const ch of changes) {
    const out = run(ch.args, ch.input);
    if (out.code === 0) r.applied.push(ch.what);
    // Plan-gated features (rulesets, secret scanning on private repos) answer 403/404.
    else if (/HTTP 40[34]/.test(out.out)) r.skipped.push(`${ch.what} (plan)`);
    else r.failed.push(`${ch.what}: ${out.out.trim().split("\n").pop()}`);
  }
  return r;
}

export function repoName(run: Gh, flag?: string): string {
  if (flag) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(flag)) throw new Error("--repo must be owner/name");
    return flag;
  }
  const v = run(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  if (v.code !== 0 || !v.out.trim()) throw new Error(`can't detect the repo (gh repo view): ${v.out.trim()}; pass --repo owner/name`);
  return v.out.trim().split("\n")[0]!;
}
