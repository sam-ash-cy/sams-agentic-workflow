// `saw run <check>`: run a configured check with quiet output. Only the tail
// of a failure is printed; the full log goes to output.full_logs.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";
import { recordCheck } from "./task";

export interface RunResult {
  code: number;
  shown: string;
  log: string;
}

export function tail(text: string, maxLines: number): string {
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length <= maxLines) return lines.join("\n");
  return [`… ${lines.length - maxLines} lines hidden (full log below)`, ...lines.slice(-maxLines)].join("\n");
}

export function runCheck(cwd: string, config: Table, name: string): RunResult {
  const command = ((config.checks ?? {}) as Record<string, string>)[name];
  if (!command) throw new Error(`no command for check "${name}"; set it with: saw config set checks.${name} "<command>"`);
  const output = (config.output ?? {}) as { quiet?: boolean; max_lines?: number; full_logs?: string };

  const shell = process.platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command];
  const proc = Bun.spawnSync(shell, { cwd, stdout: "pipe", stderr: "pipe" });
  const text = proc.stdout.toString() + proc.stderr.toString();
  const code = proc.exitCode ?? 1;

  const logDir = join(cwd, output.full_logs ?? ".saw/logs");
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, `${name}.log`);
  writeFileSync(log, text);

  recordCheck(cwd, { name, status: code === 0 ? "pass" : "fail", how: "ran" });
  const quiet = output.quiet !== false;
  const shown = code === 0 && quiet ? "" : quiet ? tail(text, output.max_lines ?? 60) : text;
  return { code, shown, log };
}
