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
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT = 86400; // 24h — matches the SPEC §7 "已空闲 ~24 小时" risk

function parseArgs(argv: string[]) {
  const out: { root?: string; timeout?: number; json: boolean } = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") { out.json = true; continue; }
    if (a === "--help" || a === "-h") { return { help: true, ...out }; }
    if (a === "--root") { out.root = argv[++i]; continue; }
    if (a === "--timeout") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) {
        throw new Error("--timeout must be a non-negative integer (seconds)");
      }
      out.timeout = v;
      continue;
    }
    throw new Error(`unknown argument: ${a}`);
  }
  return out;
}


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
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`gate-staleness-check: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  if (opts.help) {
    console.log(
      "gate-staleness-check.ts [--root <dir>] [--timeout <secs>] [--json] — gate ledger freshness probe. " +
      "0 = fresh, 1 = stale (or ledger missing), 2 = usage error."
    );
    return 0;
  }
  const root = opts.root ?? repoRoot(SCRIPT_DIR);
  if (!fs.existsSync(path.join(root, ".quay"))) {
    if (opts.json) {
      console.log(JSON.stringify({ last_gate_event_at: null, gate_event_count: 0, age_seconds: null, timeout: opts.timeout ?? DEFAULT_TIMEOUT, gate_never_ran: true, gate_stale: true, signal: true }));
    } else {
      console.error(`gate-staleness-check: not a workspace (no .quay/ dir): ${root}`);
    }
    return opts.json ? 1 : 2;
  }
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const { lastTs, count, ageSeconds } = readGateLedger(root);
  const gateNeverRan = lastTs === null;
  const gateStale = !gateNeverRan && ageSeconds !== null && ageSeconds > timeout;
  const signal = gateNeverRan || gateStale;

  if (opts.json) {
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
