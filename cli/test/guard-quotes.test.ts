import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { guardCommand, guardEdit } from "../src/guard";

const tmp = (p: string): string => mkdtempSync(join(tmpdir(), p));

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = tmp("saw-gq-");
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config;
}

const FORCE = ["git", "push", "--force"].join(" ");

test("B5: a deny pattern inside quoted data doesn't deny", () => {
  const c = config();
  expect(guardCommand(c, `echo "${FORCE} is denied" > notes.txt`)).toBeUndefined();
  expect(guardCommand(c, `git commit -m "docs: never ${FORCE} or rm -rf"`)?.reason ?? "").not.toContain("deny list");
  expect(guardCommand(c, `printf '%s\\n' 'rm -rf /' | grep rm`)).toBeUndefined();
});

test("B5: quoted text that can run still denies", () => {
  const c = config();
  for (const cmd of [
    `bash -c "${FORCE} origin main"`,
    `sh -c '${FORCE}'`,
    `eval "${FORCE}"`,
    `echo "${FORCE}" | sh`,
    `awk 'BEGIN{system("${FORCE}")}'`,
    `git rebase --exec "${FORCE}" HEAD~1`,
    `ssh host "rm -rf /"`,
    `sudo "${FORCE}"`,
    `echo "$(${FORCE})"`,
    `echo x; ${FORCE}`,
    `"git" push --force`,
    `git -c core.editor="sh -c '${FORCE}'" commit`,
    `rg --pre "sh -c '${FORCE}'" x`,
    `GIT_EDITOR="sh -c '${FORCE}'" git commit`,
  ]) expect(guardCommand(c, cmd)?.decision, cmd).toBe("deny");
});

test("B5: a claude -p prompt is still a new session", () => {
  expect(guardCommand(config(), `claude -p "edit a.ts then ${FORCE}"`)?.reason).toContain("parallel_sessions");
});

test("B6: only this project's workflow.toml asks", () => {
  const c = config();
  const cwd = tmp("saw-gq-proj-");
  const other = tmp("saw-gq-other-");
  expect(guardCommand(c, "printf x >> workflow.toml", cwd)?.decision).toBe("ask");
  expect(guardCommand(c, `printf x >> "${join(cwd, "workflow.local.toml")}"`, cwd)?.decision).toBe("ask");
  expect(guardCommand(c, "printf x >> ../workflow.toml", cwd)?.decision).toBe("ask");
  expect(guardCommand(c, "printf x >> $HOME/x/workflow.toml", cwd)?.decision).toBe("ask");
  expect(guardCommand(c, `printf x >> ${join(other, "workflow.toml")}`, cwd)).toBeUndefined();
  expect(guardCommand(c, `printf x >> ${join(other, "workflow.toml")}; cp a workflow.toml`, cwd)?.decision).toBe("ask");
  expect(guardCommand(c, `cp ${join(other, "workflow.toml")} .`, cwd)?.decision).toBe("ask");
  expect(guardEdit(c, join(cwd, "workflow.toml"), tmp("saw-gq-home-"), cwd)?.decision).toBe("ask");
  expect(guardEdit(c, join(other, "workflow.toml"), tmp("saw-gq-home-"), cwd)).toBeUndefined();
});

test("B6: Git Bash drive paths resolve on Windows", () => {
  if (process.platform !== "win32") return;
  const cwd = tmp("saw-gq-proj-");
  const bash = cwd.replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`).replace(/\\/g, "/");
  expect(guardCommand(config(), `printf x >> ${bash}/workflow.toml`, cwd)?.decision).toBe("ask");
});
