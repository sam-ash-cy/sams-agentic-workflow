// `saw task pr-body`: a PR description from the branch's commits and the open
// task's verification section (saw task report), for gh pr create --body-file -.

import type { Commit } from "./release";

// A branch name safe to hand git: never an option (a committed workflow.toml
// could set branch.base = "--upload-pack=<cmd>"), never a range.
export const SAFE_REF = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const SKIP = /^(Merge (branch|pull request|remote-tracking)|fixup! |squash! )/;

// commits as git log lists them, newest first.
export function prBody(commits: Commit[], report: string): string {
  const subjects = commits.filter((c) => !SKIP.test(c.subject)).map((c) => `- ${c.subject}`).reverse();
  return [
    "## Summary",
    "",
    ...(subjects.length ? subjects : ["No commits on this branch yet."]),
    "",
    "## Checks",
    "",
    report,
  ].join("\n");
}
