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
// AC5 (cap semantics, RETIRED as dynamic — gap-fixed-cap-5-dynamic-cap-retired): the cap was an INPUT
// (--cap, the effective_cap from cap-from-gate.sh at the dispatch decision point). The dynamic cap is
// retired (human ruling 2026-08-09): the DEFAULT cap is now the fixed constant FIXED_DISPATCH_CAP (5),
// so slot-refill and its derived floor (5 × 4 = 20) are stable regardless of load/suite state. An
// explicit --cap still overrides (for manual runs/tests), but the production default is fixed 5.
//
// AC8-PREEMPT (tasks/gap-supervisor-preemption — .halt mechanical mount point): `.halt` used to be
// checked ONLY at the tick boundary (fast-mode-loop-tick.md step 0), and the continuous flow
// bypassed step 0 (incident 7: after `.halt`, inner still dispatched 5 subagents). THIS helper is a
// CODE mount point for the preemptive `.halt`: when <root>/.halt is present, should_refill is forced
// false with no_refill_reason naming the halt — so EVERY dispatch-recommendation path that consumes
// this helper (the event-driven refill AND the tick-heartbeat refill) is mechanically blocked
// mid-flow, not just at a tick boundary. The sentinel read mirrors checkHalt() (select-preflight.ts):
// ENOENT ⇒ not halted; any other read failure ⇒ FAIL-CLOSED halted (never fail open). The process-
// level stop of already-in-flight agents is supervisor-preempt.sh preempt/preempt-all — this helper
// stops NEW dispatch, that primitive stops RUNNING agents; together they are the preemption family
// (SPEC-isolation-and-resource-governance §2: 限额/抢占都是「不可被绕过」族).
//
// Run:
//   node --experimental-strip-types plugin/scripts/slot-refill.ts [--root <repo>]
//       [--cap <n>] [--in-flight <id1,id2>] [--floor-mult <n>] [--integration-backlog <n>]
//       [--red-backlog-threshold <n>] [--red-backlog-cap <n>] [--json]
//   --integration-backlog <n>   override the git-read integration backlog (test/Contract seam; the
//                               production default reads `git rev-list --count develop..integration`).
//   --red-backlog-threshold <n> backlog above which a red suite narrows the cap (default 50).
//   --red-backlog-cap <n>       the narrowed cap under red suite + backlog > threshold (default 2).
//
// The pure functions are exported and unit-tested; main() is a thin CLI over them.

import fs from "node:fs";
import path from "node:path";
import { parseTask } from "./task-schema.ts";
import {
  analyzeTasks,
  POOL_FLOOR_MULT_DEFAULT,
  readGitRevCount,
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

/** FIXED dispatch cap (gap-fixed-cap-5-dynamic-cap-retired, human ruling 2026-08-09): the dynamic
 *  adaptive cap is retired. `--cap` defaults to this constant — 5 — so slot-refill and its derived
 *  floor (5 × floor_mult = 20) are stable regardless of load/suite state. (The caller may still pass
 *  an explicit `--cap`; the DEFAULT is fixed at 5.) */
export const FIXED_DISPATCH_CAP = 5;

/** B3 ①/④ ARBITRATION (gap-b3-arbitration-inflight-vs-backlog): B3's five inequalities were written
 *  as five INDEPENDENT mandates, but ④ (integration ahead + suite green ⇒ batch-merge) is a DOWNSTREAM
 *  constraint on ① (in_flight<cap ⇒ dispatch): when the delivery gate is blocked by a red suite, the
 *  commits pile up on integration (measured 01:05 162 → 01:15 169, develop 9.6h frozen) and a full-cap
 *  dispatch adds WIP, not throughput — a newly-finished task joins the 169 and becomes 174. The
 *  arbitration narrows the effective dispatch cap to "just enough to fix red" (RED_BACKLOG_CAP) when
 *  the suite is RED and the integration backlog (integration-ahead-of-develop commits) exceeds
 *  RED_BACKLOG_THRESHOLD; the cap restores to full when the suite is green, and an empty backlog has no
 *  effect. It is a cap ARBITRATION, not a gate — slot-refill still only recommends, but every
 *  dispatch-recommendation path that consumes this helper (event-driven + tick-heartbeat) automatically
 *  reads the arbitrated cap. */
export const RED_BACKLOG_CAP_DEFAULT = 2;
export const RED_BACKLOG_THRESHOLD_DEFAULT = 50;

/** Free dispatch slots = max(0, cap − in_flight). The one definition; never hardcoded. */
export function computeSlotsFree(cap, inFlightCount) {
  return Math.max(0, cap - inFlightCount);
}

/** Read <root>/.quay/full-suite-state.json's `state` — the CURRENT suite red-block (A11 semantics:
 *  `red` is the ONLY blocking state; green/running/absent all proceed). Absent/unparseable ⇒ false
 *  (proceed). This is the "④ 被红阻塞（suite 非绿）" reading the arbitration keys on. */
export function readSuiteRed(root) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(root, ".quay", "full-suite-state.json"), "utf8"));
    return st && st.state === "red";
  } catch {
    return false;
  }
}

/** The ①/④ arbitration, pure: narrow the dispatch cap to `redBacklogCap` when the suite is red AND the
 *  integration backlog exceeds `redBacklogThreshold`; otherwise the base cap is unchanged. */
export function computeArbitratedCap({ baseCap, suiteRed, integrationBacklog, redBacklogThreshold = RED_BACKLOG_THRESHOLD_DEFAULT, redBacklogCap = RED_BACKLOG_CAP_DEFAULT }) {
  if (suiteRed && integrationBacklog > redBacklogThreshold) return redBacklogCap;
  return baseCap;
}

/**
 * Read the `.halt` sentinel at workspace root — the preemptive-halt mount point.
 * Mirrors checkHalt() in select-preflight.ts exactly (gap-halt-sentinel-path-mismatch:
 * a fail-open shape on an unreadable sentinel caused a real safety miss):
 *   ENOENT (no file)              → { halted: false }         — the common, expected state
 *   file exists                   → { halted: true, reason }  — empty file still halts
 *   any OTHER read failure        → { halted: true, reason }  — FAIL-CLOSED, never fail open
 */
export function checkHaltSentinel(root) {
  const haltPath = path.join(root, ".halt");
  try {
    const content = fs.readFileSync(haltPath, "utf8").trim();
    return { halted: true, reason: content || ".halt sentinel present (empty)" };
  } catch (e) {
    if (e && e.code === "ENOENT") return { halted: false, reason: "" };
    // Fail closed: any read failure other than a clean absence is a halted state.
    return { halted: true, reason: `FAIL-CLOSED: could not read .halt at ${haltPath}: ${e?.message || String(e)}` };
  }
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
 *  REVERSE-DIRECTION DIMENSION (gap-closed-bracket-leaves-live-agent-consuming-slots): a slot is
 *  released only when the executor PROCESS is gone, not when the telemetry bracket closes. A task
 *  whose bracket closed (`--task-end` written) but whose agent is STILL observably present (open
 *  worktree / live process) is passed as `closedButLive` — it occupies a slot even though it is not
 *  in the running `inFlight` set. `slots_free = max(0, cap − (inFlight.length + closedButLive.length))`
 *  so a new dispatch is never recommended into a slot an actually-busy process still holds (AC3).
 *  It also ranks in the ready-pool disjointness + the step-4 concurrency-eligibility check, so a new
 *  dispatch cannot collide with a closed-but-live agent's touches.
 *
 *  @param {object} o
 *  @param {string} o.tasksDir   the store's tasks dir (<root>/tasks)
 *  @param {string} o.root       repo root (touches-resolution + git signals)
 *  @param {number} [o.cap]      concurrency cap; default FIXED_DISPATCH_CAP (5) — the dynamic cap is
 *      retired (gap-fixed-cap-5-dynamic-cap-retired). floor = cap × floor_mult = 5 × 4 = 20. The cap
 *      is ARBITRATED (gap-b3-arbitration-inflight-vs-backlog): under a red suite + high integration
 *      backlog it narrows to `redBacklogCap` (2) so dispatch adds red-fixing work, not WIP.
 *  @param {number} [o.floorMult] pool floor multiplier; default 4
 *  @param {Array<{id:string, body:string}>} [o.inFlight] currently-RUNNING subagent tasks
 *  @param {Array<{id:string, body:string}>} [o.closedButLive] tasks whose bracket CLOSED but whose
 *      executor is still observably present (from fast-mode-telemetry --slots closedButLive) — their
 *      slots are NOT free.
 *  @param {number} [o.integrationBacklog] integration-ahead-of-develop commit count; when omitted it
 *      is read from git (`git rev-list --count develop..integration`), fail-safe 0 on a non-git root /
 *      missing ref. Injectable for tests (a temp dir is not a git repo).
 *  @param {number} [o.redBacklogThreshold] backlog above which the red-suite cap narrowing applies
 *      (default RED_BACKLOG_THRESHOLD_DEFAULT = 50).
 *  @param {number} [o.redBacklogCap] the narrowed dispatch cap under red suite + backlog > threshold
 *      (default RED_BACKLOG_CAP_DEFAULT = 2).
 *  @returns {object} { cap, base_cap, effective_cap, arbitration, in_flight_count,
 *      closed_but_live_count, occupied_slots, slots_free, pool, floor, dispatchable_disjoint,
 *      criterion_met, should_refill, no_refill_reason, recommended, scanned }
 */
export function analyzeSlotRefill({ tasksDir, root, cap = FIXED_DISPATCH_CAP, floorMult = POOL_FLOOR_MULT_DEFAULT, inFlight = [], closedButLive = [], integrationBacklog, redBacklogThreshold = RED_BACKLOG_THRESHOLD_DEFAULT, redBacklogCap = RED_BACKLOG_CAP_DEFAULT }) {
  // PREEMPTIVE HALT (gap-supervisor-preemption AC2): the `.halt` sentinel is a CODE mount point,
  // not a tick-step-0 prose rule. When halted, dispatch is blocked no matter how many slots/candidates
  // exist — the human's stop takes effect at ANY dispatch-recommendation point, mid-flow.
  const halt = checkHaltSentinel(root);
  // B3 ①/④ ARBITRATION (gap-b3-arbitration-inflight-vs-backlog): ① (in_flight<cap ⇒ dispatch) conflicts
  // with ④ (integration ahead + suite green ⇒ batch-merge) — ④ is a DOWNSTREAM constraint on ①. When the
  // delivery gate is blocked by a red suite AND the integration backlog exceeds the threshold, the
  // effective dispatch cap narrows to "just enough to fix red" so dispatch adds red-fixing work, not WIP.
  const suiteRed = readSuiteRed(root);
  const backlog = integrationBacklog ?? readGitRevCount(root, "develop..integration") ?? 0;
  const baseCap = cap;
  const effectiveCap = computeArbitratedCap({ baseCap, suiteRed, integrationBacklog: backlog, redBacklogThreshold, redBacklogCap });
  const capNarrowed = effectiveCap !== baseCap;
  const pool = analyzeTasks({ tasksDir, root, cap: effectiveCap, floorMult, inFlight, closedButLive });
  // A slot is free only when neither a running subagent NOR a closed-bracket-but-live agent holds it.
  const occupied = inFlight.length + closedButLive.length;
  const slotsFree = computeSlotsFree(effectiveCap, occupied);

  // recommended — the production disjoint batch over the ready pool, filtered by the SAME step-4
  // dispatch checks (touches-resolve + deps-ready + disjoint-from-in-flight), capped at slots_free.
  // While halted, no candidate is recommended at all — the human's stop supersedes the pool.
  // (Pool stats are still reported for visibility; the dispatch recommendation is empty.)
  let recommended = [];
  if (!halt.halted) {
    const sharedFiles = walkFiles(root);
    const expand = (globs) => expandDeclaredTouches(globs, root, sharedFiles);
    const statusById = buildStatusById(tasksDir);
    // Concurrency eligibility must also respect closed-bracket-but-live agents' touches — a closed
    // bracket does NOT free the touches a still-live agent is working on.
    const inFlightParsed = [...(inFlight || []), ...(closedButLive || [])].map((t) => ({ id: t.id, touches: parseTouches(t.body) }));
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
    // SUITE-BLOCKING RANK (gap-ready-relevance-blind-to-suite-blocking-signal AC3): a task the
    // consecutive-red-window signal implicates (pool.suite_blocking.tasks — ready-pool-check's
    // blocking_suite axis) ranks FIRST so the refill picks the suite-blocker before any other work.
    // Ties stay id-deterministic. The signal only re-ranks; the step-4 dispatch checks above still
    // gate admission (a suite-blocker that fails touches-resolve/deps/disjoint is never forced in).
    const suiteBlockingIds = new Set((pool.suite_blocking && pool.suite_blocking.tasks) || []);
    candidates.sort((a, b) => {
      const ab = suiteBlockingIds.has(a.id) ? 0 : 1;
      const bb = suiteBlockingIds.has(b.id) ? 0 : 1;
      if (ab !== bb) return ab - bb;
      return a.id.localeCompare(b.id);
    });
    const { batch } = assembleBatch(candidates, { expand });
    recommended = batch.slice(0, slotsFree);
  }

  // should_refill — the event-driven go/no-go. Based on the RECOMMENDED set (candidates that pass
  // the step-4 checks AND are disjoint from in-flight), not the raw pool capacity: a pool whose
  // only member fails touches-resolve must not trigger a refill.
  let shouldRefill = slotsFree > 0 && recommended.length >= 1;
  let noRefillReason = null;
  if (halt.halted) {
    // Preemptive halt takes precedence over every other reason — the human's stop is the
    // highest-priority gate (gap-supervisor-preemption: `.halt` is 任意点生效, not tick-boundary).
    shouldRefill = false;
    noRefillReason = `halted (preemption: .halt present — ${halt.reason}; check with supervisor-preempt.sh halt-check)`;
  } else if (slotsFree <= 0) {
    noRefillReason = `no free slots (in-flight ${inFlight.length} + closed-but-live ${closedButLive.length} >= cap ${effectiveCap})`;
  } else if (recommended.length === 0) {
    noRefillReason = "no dispatchable candidate passes step-4 checks (touches-resolve / deps-ready / disjoint-from-in-flight)";
  }

  return {
    cap: effectiveCap,
    base_cap: baseCap,
    effective_cap: effectiveCap,
    // B3 ①/④ ARBITRATION (gap-b3-arbitration-inflight-vs-backlog): the arbitration reading — whether
    // the effective cap was narrowed (red suite + integration backlog > threshold) and why. `cap`
    // above is the EFFECTIVE (arbitrated) cap every dispatch-recommendation path consumes.
    arbitration: {
      suite_red: suiteRed,
      red_window_active: pool.suite_blocking ? pool.suite_blocking.window_active : false,
      integration_backlog: backlog,
      backlog_threshold: redBacklogThreshold,
      red_backlog_cap: redBacklogCap,
      cap_narrowed: capNarrowed,
      reason: capNarrowed
        ? `red suite (state=red) + integration backlog ${backlog} > threshold ${redBacklogThreshold} ⇒ dispatch cap narrowed ${baseCap}→${effectiveCap}`
        : null,
    },
    floor_mult: floorMult,
    in_flight_count: inFlight.length,
    closed_but_live_count: closedButLive.length,
    occupied_slots: occupied,
    slots_free: slotsFree,
    pool: pool.pool,
    floor: pool.floor,
    dispatchable_disjoint: pool.dispatchable_disjoint,
    criterion_met: pool.criterion_met,
    // LANDING-BLOCKED (gap-landing-blocked-invisible-to-dispatch-criteria): surfaced so the event-
    // driven/tick refill path sees the landing visibility axis too. SIGNAL, NOT a gate — should_refill
    // stays criterion/slot-driven (AC4: normal landing never false-reports, and a blocked landing is
    // reported without interrupting dispatch).
    landing_blocked: pool.landing_blocked,
    landing_blocked_reason: pool.landing_blocked_reason,
    // SUITE-BLOCKING (gap-ready-relevance-blind-to-suite-blocking-signal AC3): surfaced so the
    // event-driven/tick refill path can see which tasks the consecutive-red window implicates and
    // that they were ranked FIRST into `recommended`. SIGNAL, not a gate — should_refill stays
    // criterion/slot-driven (AC4: no red window ⇒ suite_blocking.window_active=false, ordering
    // unchanged).
    suite_blocking: pool.suite_blocking,
    halted: halt.halted,
    halt_reason: halt.halted ? halt.reason : null,
    should_refill: shouldRefill,
    no_refill_reason: noRefillReason,
    recommended,
    scanned: pool.scanned,
  };
}

function main(argv) {
  let root = null;
  let cap = FIXED_DISPATCH_CAP;
  let floorMult = POOL_FLOOR_MULT_DEFAULT;
  let inFlightIds = [];
  let closedButLiveIds = [];
  let integrationBacklog = undefined;
  let redBacklogThreshold = RED_BACKLOG_THRESHOLD_DEFAULT;
  let redBacklogCap = RED_BACKLOG_CAP_DEFAULT;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--json") { /* output is always JSON — accepted for Contract parity */ }
    else if (args[i] === "--cap") cap = Number(args[++i]);
    else if (args[i] === "--floor-mult") floorMult = Number(args[++i]);
    else if (args[i] === "--in-flight") {
      inFlightIds = String(args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === "--closed-but-live") {
      closedButLiveIds = String(args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === "--integration-backlog") {
      integrationBacklog = Number(args[++i]);
    } else if (args[i] === "--red-backlog-threshold") {
      redBacklogThreshold = Number(args[++i]);
    } else if (args[i] === "--red-backlog-cap") {
      redBacklogCap = Number(args[++i]);
    }
  }
  const rootDir = root ? path.resolve(root) : findRepoRoot(process.cwd());
  const readTasks = (ids) => {
    const out = [];
    for (const id of ids) {
      const file = path.join(rootDir, "tasks", `${id}.md`);
      if (!fs.existsSync(file)) continue; // advisory — a vanished id is not a failure
      out.push({ id, body: fs.readFileSync(file, "utf8") });
    }
    return out;
  };
  const inFlight = readTasks(inFlightIds);
  const closedButLive = readTasks(closedButLiveIds);
  const result = analyzeSlotRefill({ tasksDir: path.join(rootDir, "tasks"), root: rootDir, cap, floorMult, inFlight, closedButLive, integrationBacklog, redBacklogThreshold, redBacklogCap });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
