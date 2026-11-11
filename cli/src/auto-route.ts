// routing.auto: classify a prompt into a tier and playbook with fixed rules, no
// model call and no network. The router skill (skills/router/SKILL.md) stays the
// judge; this only proposes `saw task start` (suggest) or opens a provisional task
// the agent must confirm (open). Tune the rules in RULES below.

export type AutoRoute = { tier: string; playbook: string; why: string[] } | "none";

interface Rule {
  name: string;
  re: RegExp;
  // The tier this signal implies; the highest wins (trivial only when nothing else fires).
  tier?: "trivial" | "standard" | "complex" | "critical";
  // The playbook this signal implies; the highest weight wins.
  playbook?: string;
  weight?: number;
}

// Tiers follow the router skill's table: trivial = typo, copy, one-line config, a
// rename; complex = new subsystem or integration, cross-cutting; critical = auth,
// permissions, secrets, payments, data migration, infra, production.
export const RULES: Rule[] = [
  { name: "auth or secrets", re: /\b(auth\w*|login|logout|oauth|sso|permissions?|rbac|secrets?|credentials?|passwords?|api keys?|tokens?)\b/, tier: "critical" },
  { name: "payments", re: /\b(payments?|billing|checkout|invoices?|stripe|refunds?)\b/, tier: "critical" },
  { name: "data migration", re: /\b(migrations?|migrate|schema change|drop (table|column)|backfill)\b|migrations\//, tier: "critical" },
  { name: "infra or production", re: /\b(infra\w*|terraform|kubernetes|k8s|helm|deploy\w*|production|prod)\b|\.tf\b|\.github\/workflows/, tier: "critical" },
  { name: "new subsystem", re: /\bnew (subsystem|service|module|package|engine|pipeline|api)\b|\b(architecture|re-?architect|redesign|rewrite|cross-cutting|across the (codebase|repo|app))\b/, tier: "complex" },
  { name: "integration", re: /\b(integrat\w+|webhooks?|third[- ]party|sdk|connector)\b/, tier: "complex", playbook: "integration", weight: 3 },
  { name: "small edit", re: /\b(typos?|spelling|wording|copy|comments?|readme|one[- ]line|bump (the )?version|rename)\b|\.md\b/, tier: "trivial" },
  { name: "bug", re: /\b(bugs?|broken|crash\w*|errors?|fail\w*|regression|exceptions?|stack ?trace|doesn'?t work|not working|loops?|hang\w*|freez\w*|leak\w*|wrong|incorrect)\b/, playbook: "debug", weight: 3 },
  { name: "ui", re: /\b(ui|ux|css|layout|styling|design|components?|pages?|screens?|responsive|dark mode|button)\b/, playbook: "design", weight: 2 },
  { name: "foundation", re: /\b(scaffold|bootstrap|set ?up the (project|repo)|new project|initial setup)\b/, playbook: "foundation", weight: 3, tier: "complex" },
  { name: "spike", re: /\b(spike|prototype|proof of concept|poc|experiment)\b/, playbook: "spike", weight: 4 },
  { name: "hardening", re: /\b(harden\w*|rate[- ]limit\w*|input validation|sanitiz\w+)\b/, playbook: "hardening", weight: 3 },
  { name: "audit", re: /\baudit\b/, playbook: "audit", weight: 4 },
  { name: "feature", re: /\b(add|implement|build|create|support|introduce|feature)\b/, playbook: "feature", weight: 1 },
];

// Words that make a prompt a change request. Without one it's a question or a chat: "none".
const CHANGE = /^do\b|\b(fix\w*|add|rotate|rewrite|implement|build|create|refactor|rename|change|update|remove|delete|migrate|write|make|move|replace|bump|upgrade|wire|port|support|introduce|set ?up|configure|edit|tweak|harden|scaffold|bootstrap|prototype|spike|integrate|audit|convert|extract|split|merge|clean ?up|optimi[sz]e|speed up|deploy)\b/;
// A question form ("a fix" alone isn't a bug signal: "fix the typo" stays trivial). "can you / could you / please" asks for work, so it's not a question.
// Yes/no questions ("is it…?", "does it…?") end in "?" and are caught by that.
const QUESTION = /^(what|why|how|where|when|which|who|whose|explain|describe|tell me|show me)\b/;
const REQUEST = /^(can|could|would|will) you\b|^please\b/;

const TIER_RANK = ["trivial", "standard", "complex", "critical"];

export function classify(prompt: string): AutoRoute {
  const text = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text || !CHANGE.test(text)) return "none";
  const request = REQUEST.test(text);
  if (!request && (QUESTION.test(text) || (text.endsWith("?") && !/^(fix|add|implement|make|change|update)\b/.test(text)))) return "none";
  const hits = RULES.filter((r) => r.re.test(text));
  const tiers = hits.flatMap((r) => (r.tier ? [r.tier] : []));
  const above = tiers.filter((t) => t !== "trivial");
  // trivial only when it's the only tier signal and nothing points at a bug or a feature.
  const tier = above.length
    ? above.reduce((a, b) => (TIER_RANK.indexOf(b) > TIER_RANK.indexOf(a) ? b : a))
    : tiers.includes("trivial") && !hits.some((r) => r.playbook === "debug" || r.playbook === "feature") ? "trivial" : "standard";
  const play = hits.filter((r) => r.playbook).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0];
  return { tier, playbook: play?.playbook ?? "feature", why: hits.map((r) => r.name) };
}
