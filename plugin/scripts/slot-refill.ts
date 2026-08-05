// plugin/scripts/slot-refill.ts — the event-driven dispatch ("slot-refill") decision helper.
// (tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release)
//
// PROBLEM IT FIXES: dispatch was evaluated ONLY at the inner loop's own tick boundary
// (fast-mode-loop-tick.md step 4, at the 1200–1800s /loop heartbeat). When a background subagent
// COMPLETED and freed a concurrency slot, nothing re-evaluated dispatch until the next tick — the
// measured 39/30/18/33/50-min zero-dispatch gaps (3 tight clusters of Agent-dispatch timestamps
// over 6h, intra-cluster 2–3s) with a healthy pool (pool=27 / dispatchable_disjoint=12). This script
// is the PRODUCT mechanism for the event-driven path: it computes "is a slot free + is there a
// dispatchable candidate" so the inner can refill the freed slot immediately on the completion
// notification (<task-notification>), not at the next tick.
//
// WHAT IT DOES (a DETECTOR/RECOMMENDER, not a gate — always exits 0, never writes tasks/**, never
// spawns agents, never advances a counter):
//   1. slots_free = max(0, effective_cap - in_flight_count). The caller passes the CURRENTLY-RUNNING
//      subagent set EXPLICITLY (--in-flight). The helper deliberately does NOT read telemetry
//      brackets for the count (AC6: brackets ≠ subagents — gap-telemetry-brackets-vs-subagents-no-
//      slot-visibility; a completed-but-not-fanned-in task keeps its telemetry bracket open yet its
//      slot IS free). Completion frees the slot at the <task-notification>, not at fan-in.
//   2. Pool stats from ready-pool-check.analyzeTasks (pool / dispatchable_disjoint / criterion_met).
//   3. should_refill = slots_free > 0 && dispatchable_disjoint >= 1 — the event-driven go/no-go.
//   4. recommended = up to slots_free candidate ids from the PRODUCTION disjoint batch
//      (concurrent-batch-scheduler.assembleBatch) over the ready pool, filtered by the SAME step-4
//      dispatch checks (touches-resolve + deps-ready + disjoint-from-in-flight).
//
// IDEMPOTENCE / NO DOUBLE-DISPATCH: the helper is a PURE state reader — same inputs ⇒ same output,
// no mutation, no dispatch action. Double-dispatch is structurally impossible because the dispatch
// action lives in the tick (a separate step that consumes should_refill/recommended and spawns the
// Agent); re-invoking the helper after a dispatch WITHOUT updating --in-flight returns the same free
// slots (the caller owns the in-flight set and MUST add a freshly-dispatched id before the next
// evaluation).
//
// AC5 (cap semantics unchanged): the cap is an INPUT (--cap, the effective_cap from cap-from-gate.sh
// at the dispatch decision point) — mechanism/strategy separation, the helper never hardcodes a cap.
//
// Run:
//   node --experimental-strip-types plugin/scripts/slot-refill.ts [--root <repo>]
//       [--cap <n>] [--in-flight <id1,id2>] [--floor-mult <n>] [--json]
//
// The pure functions are exported and unit-tested; main() is a thin CLI over them.

import fs from "node:fs";
import path from "node:path";
import { parseTask } from "./task-schema.ts";
import {
  analyzeTasks,
  CONCURRENCY_CAP_DEFAULT,
  POOL_FLOOR_MULT_DEFAULT,
} from "./ready-pool-check.ts";
import {
  checkTaskTouchesResolve,
  checkTouchesPair,
  parseTouches,
  findRepoRoot,
  walkFiles,
} from "./touches-orthogonality-check.ts";
import {
  assembleBatch,
  parseCandidate,
  expandDeclaredTouches,
} from "./concurrent-batch-scheduler.ts";
import { isDirectEntry } from "./gate-script-base.ts";

/** Free dispatch slots = max(0, cap − in_flight). The one definition; never hardcoded. */
export function computeSlotsFree(cap, inFlightCount) {
  return Math.max(0, cap - inFlightCount);
}

function readFrontField(frontmatterRaw, key) {
  const m = frontmatterRaw.match(new RegExp(`^${key}:\\s*(\\S+)`, "m"));
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
}

/** Parent done (or absent) ⇒ deps ready. Mirrors ready-pool-check's depsReadyFor; fail-closed when
 *  the parent file is missing (cannot confirm done). */
function depsReadyFor(task, statusById) {
  const parent = task.parent;
  if (!parent || parent === "null" || parent === "~") return true;
  const status = statusById.get(parent);
  if (status === undefined) return false;
  return status === "done";
}

/** Status map for all tasks in the store (id → frontmatter status), for the deps-ready filter. */
function buildStatusById(tasksDir) {
  const statusById = new Map();
  if (!fs.existsSync(tasksDir)) return statusById;
  for (const f of fs.readdirSync(tasksDir)) {
    if (!f.endsWith(".md")) continue;
    const id = f.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const task = parseTask(raw);
    statusById.set(id, readFrontField(task.frontmatterRaw, "status") || "");
  }
  return statusById;
}

/** The slot-refill decision. Pure: reads the store, never writes, never dispatches.
 *
 *  @param {object} o
 *  @param {string} o.tasksDir   the store's tasks dir (<root>/tasks)
 *  @param {string} o.root       repo root (touches-resolution + git signals)
 *  @param {number} [o.cap]      effective concurrency cap (from cap-from-gate.sh); default 3
 *  @param {number} [o.floorMult] pool floor multiplier; default 4
 *  @param {Array<{id:string, body:string}>} [o.inFlight] currently-RUNNING subagent tasks
 *  @returns {object} { cap, in_flight_count, slots_free, pool, floor, dispatchable_disjoint,
 *      criterion_met, should_refill, no_refill_reason, recommended, scanned }
 */
export function analyzeSlotRefill({ tasksDir, root, cap = CONCURRENCY_CAP_DEFAULT, floorMult = POOL_FLOOR_MULT_DEFAULT, inFlight = [] }) {
  const pool = analyzeTasks({ tasksDir, root, cap, floorMult, inFlight });
  const slotsFree = computeSlotsFree(cap, inFlight.length);

  // recommended — the production disjoint batch over the ready pool, filtered by the SAME step-4
  // dispatch checks (touches-resolve + deps-ready + disjoint-from-in-flight), capped at slots_free.
  const sharedFiles = walkFiles(root);
  const expand = (globs) => expandDeclaredTouches(globs, root, sharedFiles);
  const statusById = buildStatusById(tasksDir);
  const inFlightParsed = (inFlight || []).map((t) => ({ id: t.id, touches: parseTouches(t.body) }));
  const candidates = [];
  for (const id of pool.ready) {
    const file = path.join(tasksDir, `${id}.md`);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    // step-4 check 1: touches-resolve (majority-missing ⇒ not dispatchable).
    if (checkTaskTouchesResolve(text, root).majorityMissing) continue;
    // step-4 check 2: deps-ready (parent done).
    const task = parseTask(text);
    task.parent = readFrontField(task.frontmatterRaw, "parent");
    if (!depsReadyFor(task, statusById)) continue;
    // step-4 check 3: concurrency eligibility — disjoint from every currently-running subagent.
    const parsed = parseTouches(text);
    let blocked = false;
    for (const inf of inFlightParsed) {
      if (!checkTouchesPair(parsed, inf.touches, expand).disjoint) { blocked = true; break; }
    }
    if (blocked) continue;
    candidates.push(parseCandidate(id, text));
  }
  const { batch } = assembleBatch(candidates, { expand });
  const recommended = batch.slice(0, slotsFree);

  // should_refill — the event-driven go/no-go. Based on the RECOMMENDED set (candidates that pass
  // the step-4 checks AND are disjoint from in-flight), not the raw pool capacity: a pool whose
  // only member fails touches-resolve must not trigger a refill.
  const shouldRefill = slotsFree > 0 && recommended.length >= 1;
  let noRefillReason = null;
  if (slotsFree <= 0) {
    noRefillReason = "no free slots (in-flight >= cap)";
  } else if (recommended.length === 0) {
    noRefillReason = "no dispatchable candidate passes step-4 checks (touches-resolve / deps-ready / disjoint-from-in-flight)";
  }

  return {
    cap,
    floor_mult: floorMult,
    in_flight_count: inFlight.length,
    slots_free: slotsFree,
    pool: pool.pool,
    floor: pool.floor,
    dispatchable_disjoint: pool.dispatchable_disjoint,
    criterion_met: pool.criterion_met,
    should_refill: shouldRefill,
    no_refill_reason: noRefillReason,
    recommended,
    scanned: pool.scanned,
  };
}

function main(argv) {
  let root = null;
  let cap = CONCURRENCY_CAP_DEFAULT;
  let floorMult = POOL_FLOOR_MULT_DEFAULT;
  let inFlightIds = [];
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--json") { /* output is always JSON — accepted for Contract parity */ }
    else if (args[i] === "--cap") cap = Number(args[++i]);
    else if (args[i] === "--floor-mult") floorMult = Number(args[++i]);
    else if (args[i] === "--in-flight") {
      inFlightIds = String(args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  const rootDir = root ? path.resolve(root) : findRepoRoot(process.cwd());
  const inFlight = [];
  for (const id of inFlightIds) {
    const file = path.join(rootDir, "tasks", `${id}.md`);
    if (!fs.existsSync(file)) continue; // advisory — a vanished in-flight id is not a failure
    inFlight.push({ id, body: fs.readFileSync(file, "utf8") });
  }
  const result = analyzeSlotRefill({ tasksDir: path.join(rootDir, "tasks"), root: rootDir, cap, floorMult, inFlight });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
