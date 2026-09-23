// Gate engine — run a named gate against a task, append one GateEvent, return
// the verdict (QENG-1). Port of epicd `src/engine/adjudicate-gate.ts`, adapted
// to quay's provider store (proposal §"Engine").
//
// The engine never inspects `payload` beyond assembling it; it matches only on
// the gate fn's `{ ok, reason }` — the ABI-uniform fields every Provider's
// `taskCheck` returns.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveGate } from "./registry.ts";
import { verdictFromGateCheck } from "./acceptance-runner.ts";
import type { GateVerdictKind } from "./types.ts";
import { appendGateEvent, type GateEvent } from "./gate-event-store.ts";
import type { Task } from "../abi.ts";

// ── criterion-cost recording (gap-no-criterion-records-its-own-cost-checker-cost-jsonl) ────────────
// Every gate execution appends ONE `{name, ms, n, load, at, verdict}` line to
// `<root>/.quay/checker-cost.jsonl` on exit — pure append, zero judgment (no threshold, no flag; the
// trend-criterion reads it). This is the gate-side writer for AC1's "gate 执行路径"; the bash
// static-check wrapper lives in plugin/scripts/checker-cost-lib.sh and the TS helper in
// plugin/scripts/checker-cost.ts — the SHAPE is pinned by plugin/test/checker-cost.test.mjs. `load` =
// /proc/loadavg 1-min (splits "the gate got slower" into "n got bigger" vs "the machine got busier").
// `verdict` is the gate's pass/fail outcome (gap-checker-cost-jsonl-add-verdict-field — the axis
// P4 guard-lineage needs). Inlined here (not imported from plugin/scripts) so the published Core
// package stays dependency-free.
function load1(): number {
  try {
    const v = Number(fs.readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/)[0]);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
// `verdict` is the gate's THREE-state outcome — the same vocabulary the ledger's own writer
// declares (`plugin/scripts/checker-cost.ts`'s `CheckerVerdict`), so a gate that could not
// evaluate its criterion is not recorded as a cost row claiming a `fail`
// (gap-goal-gate-verdict-single-mapping-not-evaluated).
function recordGateCost(opts: { root: string; name: string; ms: number; verdict: GateVerdictKind }): void {
  const file = path.join(opts.root, ".quay", "checker-cost.jsonl");
  const rec = { name: opts.name, ms: opts.ms, n: 1, load: load1(), at: new Date().toISOString(), verdict: opts.verdict };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`, "utf8");
  } catch {
    // fail-open — a cost-record write must never break the gate verdict
  }
}

export interface RunGateArgs {
  /** provider client (taskGet / taskCheck) */
  client: {
    taskGet: (id: string) => Promise<Task | null>;
    taskCheck: (id: string) => Promise<{ ok: boolean; reason: string }>;
  };
  /** task id */
  id: string;
  gate?: string;
  logPath: string;
  actor?: string;
  workspaceRoot?: string;
  /** DIR-103-B: when true, execute the gate's check (incl. the acceptance
   * command via the shared runAcceptance() runner) WITHOUT appending a
   * GateEvent and WITHOUT any lifecycle/status mutation. The skip-append
   * lives HERE — in the engine — as the single place any dry-run traverses. */
  dryRun?: boolean;
}

export interface RunGateResult {
  ok: boolean;
  reason: string;
  event: GateEvent;
}

/**
 * Run gate `gate` against task `id` via `client`, append one GateEvent to
 * `logPath`, and return the verdict + the appended event.
 *
 * With `dryRun: true`, the gate check (incl. the acceptance command via the
 * shared `runAcceptance()` runner) still executes and the verdict is returned,
 * but NO GateEvent is appended and NO lifecycle/status mutation occurs — the
 * event field is still returned describing what WOULD have been recorded.
 *
 * Unknown gate name and missing task both throw (fail loud — the CLI's
 * top-level catch reports them).
 *
 * DIR-035-B: gate resolution is now WORKSPACE-DATA-driven for anything beyond
 * the product's own built-ins (`registry.js#resolveGate`) — `workspaceRoot`
 * (when supplied, e.g. from `cfg.workspaceRoot` at the CLI layer) selects that
 * workspace's own `.quay/gates.yml`-declared gates; omitted, it falls back to
 * auto-discovery from `process.cwd()` (unchanged behavior for existing
 * in-process callers/tests that never threaded a workspaceRoot through).
 */
export async function runGate({ client, id, gate = "dod", logPath, actor = "quay-cli", workspaceRoot, dryRun }: RunGateArgs): Promise<RunGateResult> {
  const fn = resolveGate(gate, workspaceRoot);
  if (!fn) throw new Error(`unknown gate: ${gate}`);
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  // criterion-cost meter (gap-no-criterion-records-its-own-cost-checker-cost-jsonl): every gate
  // execution is timed, and the cost is recorded ONLY when the caller told us where the workspace
  // is (the CLI/MCP gate paths pass cfg.workspaceRoot). In-process callers that don't (the
  // lifecycle/driver unit paths, most tests) skip the write — no synthetic rows pollute the real
  // .quay/checker-cost.jsonl during the suite.
  const t0 = Date.now();
  const r = await fn(task, client);
  // ⛔ ONE mapping, never an inline `ok ? "pass" : "fail"` (gap-goal-gate-verdict-single-mapping-
  // not-evaluated): a check that resolved a 3-valued verdict (the acceptance gate does, via
  // verdictFromAcceptance) must not have its "not-evaluated" flattened into "fail" here. For a
  // boolean-only check (taskCheck-shaped) the fallback IS the complete mapping — reported so,
  // never silently assumed.
  const verdict = verdictFromGateCheck(r);
  const { ok, reason } = r;
  if (workspaceRoot) {
    recordGateCost({ root: workspaceRoot, name: `gate:${gate}:${id}`, ms: Date.now() - t0, verdict });
  }
  const event: GateEvent = {
    id: randomUUID(),
    item_id: id,
    pipeline_id: id,
    gate,
    actor,
    verdict,
    timestamp: new Date().toISOString(),
    payload: { reason },
  };
  // DIR-103-B: the dryRun skip-append lives in the ENGINE (this single site).
  // Any dry-run surface (MCP gate_run dryRun:true today, CLI --dry-run later)
  // traverses this exact guard — no second skip-append implementation.
  if (!dryRun) {
    appendGateEvent(logPath, event);
  }
  return { ok, reason, event };
}
