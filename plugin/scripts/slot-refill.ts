#!/usr/bin/env node
// plugin/scripts/slot-refill.ts — the SLOT-RELEASE REFILL evaluator (event-driven dispatch).
//
// PROBLEM IT FIXES (tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release):
// dispatch eligibility is evaluated ONLY at the inner tick boundary, so when an in-flight subagent
// completes (a slot frees) the inner waits until the next tick to re-evaluate and refill — the slot
// sits idle for up to the tick period (~20-25 min). Measured (manager meta-cc, 2026-08-05): 20 Agent
// dispatch timestamps over 6h = 3 tight clusters (intra-cluster 2-3s) with 15-55 min zero-dispatch
// gaps, while the ready pool stayed healthy (pool 27 / dispatchable_disjoint 12). The design intent
// "并发是打破外层变瓶颈" degrades because the inner's OWN tick interval replaces the outer's 20 min.
//
// WHAT IT DOES (a DETECTOR/EVALUATOR — detector shape like ready-pool-check.ts, NEVER a dispatcher):
// one command composes the SAME dispatch-decision reads the tick's steps 3.5/3.6/4 already make —
//   cap-from-gate.sh (effective_cap — single source, AC5: cap semantics unchanged)
//   fast-mode-telemetry.ts --slots --cap (reconcile-aware realInFlight / slots-remaining; brackets
//       ≠ subagents — AC6 cross-ref gap-telemetry-brackets-vs-subagents-no-slot-visibility)
//   ready-pool-check.ts --cap (pool / dispatchable_disjoint)
// and answers REFILL GO / REFILL NO-GO with a reason. The tick's "槽位释放回填" step invokes it when a
// completion notification arrives (and at the tick heartbeat); it dispatches NOTHING itself.
//
// NEGATIVE CONTROL (AC4): this script never schedules itself and never polls — it is invoked BY the
// completion-notification turn (event-driven) or the tick heartbeat (fallback). There is no new
// polling source and no dual drive: no completion event ⇒ no invocation ⇒ zero dispatch.
//
// Usage:
//   bash plugin/scripts/slot-refill.sh [--root <repo>] [--cap <n>] [--json]
//   # --cap overrides the adaptive cap (tests / manual); omitted ⇒ derived from cap-from-gate.sh.
//   # Exit 0 always (a detector/recommender — the dispatch decision consumes GO/NO-GO).
//
// Output (human): `REFILL GO: slots-remaining M, dispatchable_disjoint N` | `REFILL NO-GO: <reason>`.
// With --json: { refill, reason, halted, cap, realInFlight, slotsRemaining, dispatchable_disjoint }.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findRepoRoot } from "./touches-orthogonality-check.ts";
import { isDirectEntry } from "./gate-script-base.ts";

/** Human-readable reasons for REFILL NO-GO (exported for the unit test). */
export const SLOT_REFILL_REASONS = {
  HALT: "halt (.halt present)",
  CAP_UNKNOWN: "slots unknown (cap not derivable)",
  CAP_REACHED: "cap reached",
  NO_DISPATCHABLE: "no dispatchable work",
};

/** Pure GO/NO-GO decision — exported and unit-tested; `main()` is a thin CLI over it.
 *  All inputs are the mechanical reads the tick already makes; a null input fails CLOSED
 *  (never GO on unknown state — a silently-free slot that nobody fills is waste, but a
 *  dispatch on unknown cap could exceed concurrency, which is a correctness violation). */
export function decideRefill({
  halted,
  slotsRemaining,
  realInFlight,
  cap,
  dispatchableDisjoint,
}: {
  halted: boolean;
  slotsRemaining: number | null;
  realInFlight: number | null;
  cap: number | null;
  dispatchableDisjoint: number | null;
}): { go: boolean; reason: string } {
  if (halted) return { go: false, reason: SLOT_REFILL_REASONS.HALT };
  if (slotsRemaining == null || cap == null || realInFlight == null) {
    return { go: false, reason: SLOT_REFILL_REASONS.CAP_UNKNOWN };
  }
  if (slotsRemaining < 1) {
    return {
      go: false,
      reason: `${SLOT_REFILL_REASONS.CAP_REACHED} (realInFlight ${realInFlight} >= cap ${cap})`,
    };
  }
  if (dispatchableDisjoint == null || dispatchableDisjoint < 1) {
    return {
      go: false,
      reason: `${SLOT_REFILL_REASONS.NO_DISPATCHABLE} (dispatchable_disjoint ${dispatchableDisjoint})`,
    };
  }
  return {
    go: true,
    reason: `slots-remaining ${slotsRemaining}, dispatchable_disjoint ${dispatchableDisjoint}`,
  };
}

function getArgValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function spawnJson(cmd: string[]): unknown {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) {
    return null;
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const rootArg = getArgValue(args, "--root");
  const root = rootArg ? path.resolve(rootArg) : findRepoRoot(process.cwd());
  const capArg = getArgValue(args, "--cap");
  const json = args.includes("--json");

  // .halt is the loop's only stop switch — a halted loop must not refill.
  const halted = fs.existsSync(path.join(root, ".halt"));

  // Cap: explicit --cap wins (tests / manual); otherwise derive from the same source the tick's
  // step 3.6/4 uses (cap-from-gate.sh — adaptive, fail-closed to EXTREME when PSI unmeasurable).
  let cap: number | null = null;
  if (capArg !== undefined) {
    cap = Number(capArg);
    if (!Number.isFinite(cap) || cap < 0) cap = null;
  }
  if (cap == null) {
    const capSh = path.join(root, "plugin", "scripts", "cap-from-gate.sh");
    if (fs.existsSync(capSh)) {
      const r = spawnSync("bash", [capSh, "--root", root], { encoding: "utf8" });
      const m = (r.stdout || "").match(/effective_cap=(\d+)/);
      if (m) cap = Number(m[1]);
    }
  }

  // Slots: reconcile-aware realInFlight (brackets ≠ subagents). PURE READ.
  let realInFlight: number | null = null;
  let slotsRemaining: number | null = null;
  const telemetryTs = path.join(root, "plugin", "scripts", "fast-mode-telemetry.ts");
  if (fs.existsSync(telemetryTs)) {
    const slotsArgs = [
      "node",
      "--experimental-strip-types",
      telemetryTs,
      "--slots",
      "--json",
      ...(cap != null ? ["--cap", String(cap)] : []),
    ];
    const slots = spawnJson(slotsArgs) as {
      realInFlight?: number;
      slotsRemaining?: number | null;
    } | null;
    if (slots && typeof slots.realInFlight === "number") {
      realInFlight = slots.realInFlight;
      slotsRemaining = typeof slots.slotsRemaining === "number" ? slots.slotsRemaining : null;
    }
  }

  // Pool: dispatchable_disjoint is the criterion (pool number is the means). PURE READ.
  let dispatchableDisjoint: number | null = null;
  const poolTs = path.join(root, "plugin", "scripts", "ready-pool-check.ts");
  if (fs.existsSync(poolTs)) {
    const poolArgs = [
      "node",
      "--experimental-strip-types",
      poolTs,
      "--root",
      root,
      "--json",
      ...(cap != null ? ["--cap", String(cap)] : []),
    ];
    const pool = spawnJson(poolArgs) as { dispatchable_disjoint?: number } | null;
    if (pool && typeof pool.dispatchable_disjoint === "number") {
      dispatchableDisjoint = pool.dispatchable_disjoint;
    }
  }

  const decision = decideRefill({
    halted,
    slotsRemaining,
    realInFlight,
    cap,
    dispatchableDisjoint,
  });
  const out = {
    refill: decision.go ? "GO" : "NO-GO",
    reason: decision.reason,
    halted,
    cap,
    realInFlight,
    slotsRemaining,
    dispatchableDisjoint,
  };
  if (json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`REFILL ${out.refill}: ${out.reason}`);
  }
  return 0;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
