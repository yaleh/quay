#!/usr/bin/env node
// gate-staleness-check.ts — the gate ledger freshness probe (tasks/gap-spec-goal-store-third-
// sibling-kind, SPEC §7 risk 1). The gate engine's last real event was 2026-08-08T08:22Z — ~24h
// idle — and a mechanism that isn't running is indistinguishable from one that passes. AC status
// hung on a SILENT gate would show a collective false green. This probe is the "最近一次执行时刻
// vs 声称周期" check: read <root>/.quay/gate-events.jsonl, take the most recent event timestamp,
// and report when it is older than the claimed period (--timeout).
//
// Reuses the EXISTING GateEvent ledger — never a second copy of the gate-execution record. The
// event shape ({ verdict, timestamp }) is the SAME format the goal gate runner appends (SPEC §3:
// 账本复用 GateEvent → .quay/gate-events.jsonl). A missing ledger (gate never ran) IS a signal —
// the 8.5h/21.5h-silent defect class ("机制存在 ≠ 机制在跑").
//
// The signal is a REPORT, never a gate itself: normal state exits 0 silent; a firing condition
// prints a GATE-STALE-WARN line (or --json) and exits 1.
//
// Usage:
//   gate-staleness-check.ts [--root <dir>] [--timeout <secs>] [--json] [--help]
//     (no args)  measure-only: 0 = silent, 1 = stale signal, 2 = usage/environment error.
//     --root DIR workspace root (default: auto-derived from this script's location).
//     --timeout S claimed gate period; age > S fires the stale signal (default 86400 = 24h).
//     --json     measure-only, machine-readable JSON (never mutates).
//
// Exit codes:
//   0  normal (gate ledger fresh, or --json success with signal=false)
//   1  stale signal fired (ledger older than --timeout, or ledger missing/never ran) — also
//      --json with signal=true
//   2  usage / environment error

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import { parseArgs, type CliSpec } from "./gate-script-base.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT = 86400; // 24h — matches the SPEC §7 "已空闲 ~24 小时" risk

// The private `parseArgs` this file used to carry is RETIRED onto the shared spec-driven parser
// (semantic-dedup-scan finding `parseargs-local-copies`, routine `semantic-dedup-scan`, runId
// `semantic-dedup-scan-1790503843524`: 21 files under plugin/scripts declared one, only 3 imported
// the shared one). `strict: true` is what makes the move behaviour-preserving — the private copy
// REJECTED an unknown argument (it threw; main turned that into exit 2), while the base's DEFAULT
// silently accepts one. See the parseArgs block in gate-script-base.ts for the measurement.
//
// Two readings the shared parser makes explicit, and that this call site therefore spells out
// (the private copy got them from `argv[++i]` instead — see the finding's "missing-value shape" axis):
//   • a MISSING value (`--root` as the last token) reads `""`, NOT `undefined`. `"" ?? repoRoot(...)`
//     keeps `""`, so the absence is tested for here — the same `!== ""` idiom
//     enum-surface-parity-check.ts uses — instead of letting `path.join("", ".quay")` resolve
//     against the cwd by accident.
//   • `--timeout` arrives as a STRING. The non-negative-integer rule stays at this call site, so the
//     message keeps naming `--timeout` (the .sh wrapper duplicates that check in bash, and
//     gate-staleness-check.test.mjs pins /--timeout/ on stderr).
const SPEC: CliSpec = {
  minArgs: 0, // measure-only invocation (no positionals) is this probe's normal mode
  strict: true,
  usage: "[--root <dir>] [--timeout <secs>] [--json]",
  flags: { root: { type: "string" }, timeout: { type: "string" }, json: { type: "boolean" } },
};


export function readGateLedger(root: string): { lastTs: string | null; count: number; ageSeconds: number | null } {
  const ledger = path.join(root, ".quay", "gate-events.jsonl");
  let lastTs: string | null = null;
  let count = 0;
  if (fs.existsSync(ledger)) {
    const raw = fs.readFileSync(ledger, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev && typeof ev.timestamp === "string") {
          count++;
          if (lastTs === null || ev.timestamp > lastTs) lastTs = ev.timestamp;
        }
      } catch { /* skip a malformed line — the ledger is append-only; one bad line must not kill the probe */ }
    }
  }
  let ageSeconds: number | null = null;
  if (lastTs !== null) {
    const ms = Date.parse(lastTs);
    if (Number.isFinite(ms)) ageSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  }
  return { lastTs, count, ageSeconds };
}

export function main(argv: string[]): number {
  // Unknown arguments exit 2 inside the shared parser (`strict: true`); `--help` prints usage and
  // exits 0 there too, exactly as the private copy's `{help:true}` sentinel made this function do.
  const parsed = parseArgs(argv, SPEC);
  const json = parsed.flags.json === true;

  // `--timeout` validated HERE so an out-of-range value exits 2 before any filesystem read — the
  // same point in the sequence the private copy threw from.
  let timeout = DEFAULT_TIMEOUT;
  const rawTimeout = parsed.flags.timeout;
  if (typeof rawTimeout === "string" && rawTimeout !== "") {
    const v = Number(rawTimeout);
    if (!Number.isFinite(v) || v < 0) {
      console.error("gate-staleness-check: --timeout must be a non-negative integer (seconds)");
      return 2;
    }
    timeout = v;
  }

  // `""` = flag present with no value ⇒ absent, not the empty path (see the SPEC block above).
  const rootFlag = parsed.flags.root;
  const root = typeof rootFlag === "string" && rootFlag !== "" ? rootFlag : repoRoot(SCRIPT_DIR);
  if (!fs.existsSync(path.join(root, ".quay"))) {
    if (json) {
      console.log(JSON.stringify({ last_gate_event_at: null, gate_event_count: 0, age_seconds: null, timeout, gate_never_ran: true, gate_stale: true, signal: true }));
    } else {
      console.error(`gate-staleness-check: not a workspace (no .quay/ dir): ${root}`);
    }
    return json ? 1 : 2;
  }
  const { lastTs, count, ageSeconds } = readGateLedger(root);
  const gateNeverRan = lastTs === null;
  const gateStale = !gateNeverRan && ageSeconds !== null && ageSeconds > timeout;
  const signal = gateNeverRan || gateStale;

  if (json) {
    console.log(JSON.stringify({
      last_gate_event_at: lastTs,
      gate_event_count: count,
      age_seconds: ageSeconds,
      timeout,
      gate_never_ran: gateNeverRan,
      gate_stale: gateStale,
      signal,
    }));
    return signal ? 1 : 0;
  }

  if (signal) {
    if (gateNeverRan) {
      console.log("GATE-STALE-WARN: gate ledger is empty/missing — the gate engine has never run here (机制存在 ≠ 机制在跑)");
    } else {
      console.log(`GATE-STALE-WARN: last gate event ${lastTs} is ${ageSeconds}s old > claimed period ${timeout}s — AC status would show a silent collective green`);
    }
    return 1;
  }
  console.log(`gate-staleness-check: ok (last gate event ${lastTs}, age ${ageSeconds}s ≤ ${timeout}s)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
