#!/usr/bin/env node
// inner-idle-log.ts — append-only idle-reason log (outer correction 2026-08-03T02:45:03Z).
//
// The outer's instrumentation for the idle class ("round ended, no pending work, awaiting
// re-invocation" — 43.3% of the unattended window). This is deliberately NOT a block signal:
// a block (.quay/inner-blocked.json) means "inner is STOPPED, waiting for an outer RULING"
// — one signal, one meaning. An idle turn is waiting for its OWN loop, needs no outer action,
// and routing it through the block file would (a) wake the outer on every turn end
// (inner-state.sh emits BLOCKED for any reason, no filter) and (b) block un-halt
// (restart-readiness-check prints the block record). So idle gets its own silent log.
//
// Contract (outer): append ONE line per idle turn-end, no duration — the outer computes
// durations from transcript timestamp gaps and joins on `at`:
//   {"at": "<ISO 8601>", "reason": "<enum>", "note": "<one sentence>"}
// reason ∈ {awaiting-subagent, queue-empty, awaiting-ruling, rate-limited, no-reason}.
// `no-reason` is the "can't say why" fallback — its COUNT is the next round's target.
//
// Append-only by construction: the file is only ever opened in append mode, never rewritten,
// truncated, or cleaned. Zero state, zero --clear, zero misfire.
//
// Usage:
//   node --no-warnings --experimental-strip-types plugin/scripts/inner-idle-log.ts \
//     --append --reason awaiting-subagent --note "waiting for dispatch-gate subagent"
//   node --no-warnings --experimental-strip-types plugin/scripts/inner-idle-log.ts --counts
//   node --no-warnings --experimental-strip-types plugin/scripts/inner-idle-log.ts --read

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// `--root <path>` overrides the workspace root (test-hermetic; production default = repo root).
function resolveRoot(argv: string[]): string {
  const idx = argv.indexOf("--root");
  return idx !== -1 && argv[idx + 1] ? path.resolve(argv[idx + 1]) : REPO_ROOT;
}
const LOG_PATH = path.join(REPO_ROOT, "orchestration", "inner-idle-log.jsonl");

export const VALID_IDLE_REASONS = Object.freeze([
  "awaiting-subagent",
  "queue-empty",
  "awaiting-ruling",
  "rate-limited",
  "no-reason",
]);

export const IDLE_REASON_DESCRIPTIONS: Record<string, string> = {
  "awaiting-subagent": "等待自己派的 subagent 返回 — waiting for a subagent I dispatched",
  "queue-empty": "就绪队列为空，无可派任务 — no dispatchable task",
  "awaiting-ruling": "真正在等外层裁定 — genuinely awaiting an outer ruling",
  "rate-limited": "被限流 — rate limited",
  "no-reason": "说不出为什么——计数本身就是下一轮要修的东西 — can't say why; its count is next round's target",
};

export interface IdleEntry {
  at: string;
  reason: string;
  note: string;
}

function logPath(root: string): string {
  return path.join(root, "orchestration", "inner-idle-log.jsonl");
}

function appendLine(root: string, entry: IdleEntry): void {
  const p = logPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(entry) + "\n", "utf8");
}

function readLines(root: string): IdleEntry[] {
  const p = logPath(root);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

function printUsage(stream: NodeJS.WritableStream): void {
  stream.write(
    [
      "usage: inner-idle-log.ts <mode> [args]",
      "  --append --reason <enum> --note \"<one sentence>\"  append an idle entry (ISO `at`)",
      `  --counts                                     per-reason tally (no-reason count = next target)`,
      "  --read                                       print all entries (one JSON line each)",
      `  reason ∈ {${VALID_IDLE_REASONS.join(", ")}} (fail-closed; invalid reason appends nothing)`,
      "",
    ].join("\n")
  );
}

function main(argv: string[]): number {
  const root = resolveRoot(argv);
  if (argv.includes("--append")) {
    const reasonIdx = argv.indexOf("--reason");
    const noteIdx = argv.indexOf("--note");
    if (reasonIdx === -1 || noteIdx === -1 || !argv[reasonIdx + 1] || !argv[noteIdx + 1]) {
      process.stderr.write("--append requires --reason <enum> and --note \"<text>\"\n");
      printUsage(process.stderr);
      return 1;
    }
    const reason = argv[reasonIdx + 1];
    const note = argv[noteIdx + 1];
    if (!VALID_IDLE_REASONS.includes(reason)) {
      process.stderr.write(
        `invalid reason "${reason}" — must be one of: ${VALID_IDLE_REASONS.join(", ")}\n`
      );
      return 1;
    }
    appendLine(root, { at: new Date().toISOString(), reason, note });
    process.stdout.write(`appended {at: ${new Date().toISOString().slice(0, 10)}, reason: ${reason}}\n`);
    return 0;
  }

  if (argv.includes("--counts")) {
    const counts: Record<string, number> = {};
    for (const r of VALID_IDLE_REASONS) counts[r] = 0;
    for (const e of readLines(root)) {
      if (e && typeof e.reason === "string") counts[e.reason] = (counts[e.reason] ?? 0) + 1;
    }
    for (const r of VALID_IDLE_REASONS) {
      process.stdout.write(`${r}\t${counts[r]}\n`);
    }
    return 0;
  }

  if (argv.includes("--read")) {
    for (const e of readLines(root)) {
      process.stdout.write(JSON.stringify(e) + "\n");
    }
    return 0;
  }

  printUsage(process.stderr);
  return 1;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  process.exit(main(process.argv.slice(2)));
}
