#!/usr/bin/env node
// mirror-measure-history.ts — mirror-write the per-file duration history for the fan-in detached suite.
// gap-measure-history-detached-suite-mirror-write AC1/AC3: fan-in-execute.js's detached-suite path
// (`setsid bash scripts/test.sh`) never goes through full-suite-runner.ts (the ONLY measure-history.jsonl
// writer) ⇒ `<shared-checkout>/.quay/measure-history.jsonl` went stale (last record 2026-08-17T04:29:08Z;
// every detached-suite round after that carried no per-file durations — two days of silence, the sibling
// victim of gap-full-suite-state-stale-no-writer's root cause). This thin writer appends a round parsed
// from the fan-in's REAL suite log (the __PERFILE__ lines measure-suite-reporter.mjs already emitted into
// the suite's stdout, redirected to /tmp/fan-in-suite-<task>.log by the suite-launch block), reusing
// measure-trend-check.ts's landMeasureHistory — the SAME function full-suite-runner.ts:3933 calls — so the
// data format is IDENTICAL to the runner's direct writes (AC3: the measure-trend-check.ts consumer reads
// the same {round,runAt,file,durationMs,passed,laneCount,logDigest} shape). Writes
// `<shared-checkout>/.quay/measure-history.jsonl` via resolveSharedCheckout (the shared main checkout —
// same resolution as pre-verified-round-record.ts / mirror-full-suite-state.ts, so a worktree-invoked
// write lands in the MAIN repo's history file the consumers read).
//
// Append-only, never an overwrite: measure-history.jsonl is append-only JSONL (one line per test file per
// round); landMeasureHistory computes the next round from the file's current last round and dedups by log
// digest (a re-run over the SAME log is a no-op). No in-flight guard needed (unlike mirror-full-suite-state):
// an append cannot clobber a concurrent round — the runner's and the fan-in's writes both land.
//
// Fail-closed (硬规则 3b): a missing --log / --lane-count / unresolvable shared checkout / nonexistent
// log file exits 2 and writes NOTHING. A log with no __PERFILE__ lines (a suite that ran no node --test
// tests — e.g. a static-only run) is a LEGITIMATE no-op (landed=false, reason=no-perfile-lines) — exit 0
// with the reason reported, never a fabricated round. duplicate-log (idempotent re-run) is likewise a
// benign no-op.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/mirror-measure-history.ts
//       --log <suite-log> --lane-count <n> [--run-at <iso>] [--task-id <id>] [--run-id <id>]
//       [--root <dir>] [--history <path>] [--json] [--help]
//
// Exit codes:
//   0  round landed, or benign no-op (no-perfile-lines / duplicate-log)
//   2  usage / environment error (missing/invalid field, unresolvable shared checkout) — nothing written

import fs from "node:fs";
import path from "node:path";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the ~73 byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { resolveSharedCheckout } from "./per-task-suite-record.ts";
import { landMeasureHistory } from "./measure-trend-check.ts";

/** landMeasureHistory's benign no-op reasons — a no-op is a LEGITIMATE outcome (the suite produced no
 *  __PERFILE__ lines, or this exact log was already landed), NOT a failure (exit 0, never blocks the
 *  fan-in). Everything else (missing field, unresolvable checkout, fs error) is fail-closed (exit 2). */
const BENIGN_REASONS = new Set(["no-log", "no-perfile-lines", "duplicate-log"]);

const usage = `mirror-measure-history.ts — gap-measure-history-detached-suite-mirror-write AC1/AC3 writer:
  mirror-write the per-file duration history (.quay/measure-history.jsonl) reflecting a fan-in
  detached-suite round — parses the suite's REAL log's __PERFILE__ lines and APPENDS a round to the
  shared checkout's history (reusing landMeasureHistory, the same function full-suite-runner.ts calls).

Usage:
  node --experimental-strip-types plugin/scripts/mirror-measure-history.ts
      --log <suite-log> --lane-count <n> [--run-at <iso>] [--task-id <id>] [--run-id <id>]
      [--root <dir>] [--history <path>] [--json] [--help]

Exit codes:
  0  round landed, or benign no-op (no-perfile-lines / duplicate-log)
  2  usage / environment error — nothing written`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(flagValue(args, "--root") ?? process.cwd());
  const historyOverride = flagValue(args, "--history");
  const asJson = args.includes("--json");
  const logFile = flagValue(args, "--log");
  const laneCountRaw = flagValue(args, "--lane-count");
  const runAt = flagValue(args, "--run-at");
  const taskId = flagValue(args, "--task-id");
  const runId = flagValue(args, "--run-id");

  const fail = (msg) => {
    if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`mirror-measure-history: ${msg}`);
    return 2;
  };

  // Fail-closed on missing/invalid required fields (硬规则 3b): a partial/fabricated write is never
  // attempted. laneCount is required (a real round always carries its lane count).
  if (!logFile || !String(logFile).trim()) return fail("--log is required (the suite log path carrying __PERFILE__ lines)");
  const laneCount = Number(laneCountRaw);
  if (!Number.isFinite(laneCount) || laneCount < 0) {
    return fail(`--lane-count must be a non-negative number (got ${JSON.stringify(laneCountRaw)})`);
  }
  if (runAt != null && String(runAt).trim() !== "" && Number.isNaN(Date.parse(String(runAt)))) {
    return fail(`--run-at must be an ISO timestamp (got ${JSON.stringify(runAt)})`);
  }
  if (!fs.existsSync(logFile)) {
    return fail(`suite log does not exist: ${logFile}`);
  }

  // Resolve the shared main checkout (git common-dir — the same resolution the verification-round and
  // full-suite-state mirror writers use, so a worktree-invoked write lands in the MAIN repo's history).
  let historyFile;
  if (historyOverride) {
    historyFile = path.resolve(historyOverride);
  } else {
    const shared = resolveSharedCheckout(root);
    if (!shared) return fail(`cannot resolve the shared checkout from ${root} (git common-dir failed)`);
    historyFile = path.join(shared, ".quay", "measure-history.jsonl");
  }

  let landed;
  try {
    landed = landMeasureHistory({
      historyFile,
      logFile,
      laneCount,
      ...(runAt && String(runAt).trim() ? { runAt } : {}),
      repoRoot: root,
    });
  } catch (e) {
    return fail(`landMeasureHistory threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // A benign no-op is exit 0 (never blocks the fan-in) but is DISTINGUISHED from a real write (硬规则 3b
  // — "无法评估" gets its own value, not the "合格" shape): the message names the reason, and --json
  // carries landed:false + reason.
  if (!landed.landed && BENIGN_REASONS.has(landed.reason ?? "")) {
    if (asJson) {
      console.log(JSON.stringify({ ok: true, landed: false, reason: landed.reason, file: historyFile }));
    } else {
      console.log(`mirror-measure-history: no-op (${landed.reason}) — no round written → ${historyFile}`);
    }
    return 0;
  }
  if (!landed.landed) {
    return fail(`unexpected landMeasureHistory result (landed=false, reason=${landed.reason ?? "?"})`);
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: true, landed: true, round: landed.round, files: landed.files, file: historyFile }));
  } else {
    console.log(
      `mirror-measure-history: appended round ${landed.round} (${landed.files} files${taskId ? `, task ${taskId}` : ""}${runId ? ` run ${runId}` : ""}) → ${historyFile}`
    );
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "mirror-measure-history")) {
  process.exitCode = main(process.argv);
}
