// plugin/scripts/ready-pool-check.ts — the "ready-pool maintenance" mechanism
// (tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism).
//
// PROBLEM IT FIXES: todo→ready promotion cadence/priority used to live in an outer's VOLUNTARY
// AC-queue (`orchestration/outer-phase-goal.md`) — role volition that vanishes when the session or
// model changes. A cold-start session had nothing to inherit: `fast-mode-loop-tick.md` had ZERO
// `author|promote|晋级` hits. This script is the PRODUCT mechanism any future cold-start session
// inherits (the tick doc's "就绪池维护" step invokes it mechanically, not by memory).
//
// WHAT IT DOES (a DETECTOR/RECOMMENDER, not a gate — always exits 0, never writes tasks/**):
//   1. Compute the REAL ready pool = `status: ready` tasks MINUS the three non-dispatchable classes:
//        (a) not-yet-flipped — the declared work has LANDED but status is still `ready` (this batch's
//            work is done, waiting fan-in to flip to `done`); mechanically: taskWorkLanded(body) OR a
//            COMMIT-TRACE record (`inner: <id>` / `fan-in: task/<id>` / `fan-in <id>` commit subjects,
//            read from `git log --all` — PERSISTENT across branch deletion and visible on the two-line
//            model's integration where a stale `master` sees nothing; gap-nyf-branch-existence-vs-
//            commit-trace) — does NOT depend on AC checkbox state (the fan-in merges without ticking
//            ACs)
//        (b) fixture         — `labels: fixture` (gate demo fixtures, never real work)
//        (c) PARKED          — a body `**PARKED` marker (task-level suspension; plain-text mentions
//            of the WORD "PARKED" in AC prose are NOT markers)
//   2. Report `dispatchable_disjoint` — the size of the largest subset of the pool whose members are
//      pairwise touches-disjoint (checkTouchesPair disjoint, using the SAME declared-path expander
//      the dispatch gate uses — concrete paths resolve whether or not they exist, wildcards expand
//      against the tree). THIS is the criterion, not the raw pool count: `dispatchable_disjoint >=
//      cap` is satisfied when 5 all-disjoint candidates are ready, and gets flagged when 30 all-
//      colliding ones are. floor is the MEANS; dispatchable capacity is the RESULT.
//   3. When pool < floor (floor = cap × 4, default 12), recommend todo→ready promotions in a DEFINED
//      order: touch-disjointness FIRST (vs the pool + in-flight candidates, checkTouchesPair), then
//      `gap-*` defects before `DIR-*` capabilities (other kinds last), then touches-resolvable before
//      not. Only candidates with deps ready + four artifacts complete + touches resolve + not fixture
//      + not PARKED are eligible (合格). The touchesResolve guard is KEPT (AC5 — ADR-022 lesson: a big
//      pool only promotes cleanly, never pollutes).
//   4. RETIRED-MECHANISM INTERCEPT (gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check,
//      AC1/AC2/AC4): a candidate that references an ADR-022-deleted classic-pipeline script
//      (prepare-milestone.js / execute-milestone.js / milestone-worktree.ts) without annotation is a
//      premise-void todo (promoting it wastes an agent round). Before ANY promotion (bulk pool<floor
//      OR --targeted) the candidate is judged by the SAME pool-candidate stale check the
//      strategic-doc-staleness-check CLI exposes (--pool-candidate <id>, review-cadence AC8) — flagged
//      ⇒ never eligible, and the intercept is MECHANICALLY recorded in the `intercepted` output
//      (reason + refs) so a no-promotion is a traceable decision, not a silent skip.
//
// COST ASYMMETRY (AC6 — why the floor biases toward OVER-promotion): over-promotion (promoting a
// candidate the current tick doesn't dispatch) is FRONT-LOADED, not wasted — the pool is deeper and
// the next tick dispatches it. Under-promotion (pool below floor while work waits) leaves EMPTY
// dispatch slots that are pure waste — nobody can fill them in the same tick. Bias toward over.
//
// The output is JSON so the tick-doc step can read the `pool` / `dispatchable_disjoint` / `floor`
// fields mechanically (Contract measure keys read stdout's fields). Mirrors
// task-status-drift-check.ts's detector shape (read-only, exit 0 always).
//
// RELEVANCE SIGNAL (gap-value-prioritization-has-no-mechanism — the manager layer's prioritization
// function): each candidate additionally carries a `relevance` object computed from three MECHANICAL
// sources — strategicTrace (body grep for `FINDING-*`/`RESEARCH-*`/`GOAL-*`/`REVIEW-cadence`),
// unblocks (how many non-done tasks have this candidate as their `parent`), costTouches (declared
// `## Touches` parsed scale). `--top <N>` emits `top_relevance` — the N highest-value CURRENT todos
// with a reason each (NOT the pool<floor promotion list; that keeps its existing gap>DIR order, AC4).
// Priority query:   node --experimental-strip-types plugin/scripts/ready-pool-check.ts --top 5
//
// SUITE-BLOCKING AXIS (tasks/gap-ready-relevance-blind-to-suite-blocking-signal): computeRelevance's
// `blocking` axis used to read ONLY static parent/children dependency — a defect consecutively
// red-ing the FULL SUITE ranked value 0.25 / position 7 with blocking:false, so slot-refill never
// picked it. The relevance signal now ALSO reads the consecutive-red window
// (<root>/.quay/verification-round.jsonl ≥ `--red-window-min` consecutive `state:red` rounds, default
// 3) and, when the latest failure detail (full-suite-state.json failures[], or per-round `failures`)
// hits a task's declared `## Touches`, flips that task's `blocking` true + `blocking_suite` true + a
// value bonus (SUITE_BLOCKING_WEIGHT=2) so it jumps the dispatch queue. A SIGNAL, not a gate: it only
// re-ranks ready_relevance / slot-refill recommended; dispatch decisions stay criterion-driven. The
// negative control is structural (AC4): no red window / no failure hit ⇒ suite_blocking.tasks empty ⇒
// the pre-signal ranking is byte-identical.
//
// TARGETED PROMOTION (gap-targeted-promotion-operation-does-not-exist): the pool<floor refill above
// is the BULK path (inner's mechanical product mechanism, AC3 — keep byte-unchanged). A stage-goal
// task the bulk path leaves in todo (pool<floor gate blocks it, e.g. pool=24>floor=20) needs a SECOND,
// floor-INDEPENDENT operation: TARGETED promotion — the OUTER picks a specific task per stage goal
// (selection = outer; dispatch = inner), and this checker MECHANICALLY validates it + emits the
// promote command:
//   node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root <repo> --targeted <id>
// reads stdout `targeted_promotion`: eligible=true ⇒ run `quay promote <id>` (never gated on
// `pool < floor`). The target's identity is the outer's stage-goal choice; this checker contributes
// ONLY the mechanical eligibility checks (four artifacts / deps / touches-resolve / not fixture /
// not PARKED) — it does not itself decide "which task" (AC3 — no stage-goal input in the checker).
//
// LANDING-BLOCKED AXIS (gap-landing-blocked-invisible-to-dispatch-criteria): beyond criterion_met the
// output carries `landing_blocked` / `landing_blocked_reason` (and the report string appends a
// lowercase `landing-blocked` literal) — develop behind master ≥ threshold AND the merge target frozen
// (AC17 catch-up incomplete) is reported EXPLICITLY, never "has candidates = healthy". Fail-safe: a
// missing ref / non-git root is NOT blocked. A SIGNAL, not a gate (AC4: normal landing never
// false-reports; the dispatch decision stays criterion-driven).
//
// Run:
//   node --experimental-strip-types plugin/scripts/ready-pool-check.ts [--root <repo>]
//       [--cap <n>] [--floor-mult <n>] [--in-flight <id1,id2>] [--top <n>]
//       [--targeted <id>] [--develop <ref>] [--integration <ref>] [--master <ref>]
//       [--landing-staleness-ms <n>] [--landing-behind-threshold <n>] [--apply] [--json]
//   --apply              HEARTBEAT MODE (gap-ready-pool-promotion-same-class-as-slot-refill): the
//                        tick heartbeat (fast-mode-loop-tick.md step 3.6) runs ready-pool-check
//                        unconditionally each tick. The detector/recommender above answers "which
//                        todo→ready promotions would reach the floor" but the ACTUAL status write
//                        used to depend on the inner's volition (manually running `quay promote`
//                        per candidate) — a forced doc step with no mechanical guarantee, the SAME
//                        root cause as gap-slot-refill-only-triggered-on-completion-not-tick-
//                        heartbeat (slot-refill only answered, nobody asked). `--apply` closes the
//                        loop: pool < floor AND promotions non-empty ⇒ the recommended promotions
//                        LAND ON DISK (frontmatter `status: todo → ready` in tasks/<id>.md),
//                        no volition (AC1); pool ≥ floor OR promotions empty ⇒ ZERO writes
//                        (AC3 negative control — no busy-work). Output is the analyzeTasks JSON
//                        plus `should_apply` and `applied_promotions`. Default (no `--apply`) is
//                        UNCHANGED: a pure detector/recommender that never writes tasks/**.
//   --cap / --floor-mult   override the derived floor (default cap=3, floor-mult=4 ⇒ floor 12)
//   --in-flight            task ids of currently in-flight subagents (ranked against for disjointness)
//   --top <n>              VALUE-PRIORITIZATION QUERY (gap-value-prioritization-has-no-mechanism):
//                          emit `top_relevance` = the highest-value n TODO tasks + reasons (the AC2
//                          "which of the N todos matters most" mechanical answer). `ready_relevance`
//                          (ready pool ranked by the same signal — the AC6 "who to dispatch next"
//                          answer) is always emitted. Sources are mechanical: strategic traceability
//                          (body references FINDING-*/SYNTHESIS-*/SPEC-*/REVIEW-cadence), blocking
//                          (parent/children fields), cost (touches scale). No human scoring.
//   --targeted <id>        TARGETED-PROMOTION QUERY (gap-targeted-promotion-operation-does-not-exist):
//                          emit `targeted_promotion` for ONE task id — the OUTER's stage-goal
//                          selection mechanically validated (four artifacts / deps / touches-resolve /
//                          not fixture / not PARKED) + the `quay promote <id>` command. NOT gated on
//                          `pool < floor` (AC2 — decoupled from the bulk refill). Bulk `promotions`
//                          output is unchanged (AC3).
//   --json                 accepted for Contract parity; output is always JSON
//
// ADAPTIVE CAP (gap-adaptive-concurrency-cap-tied-to-resource-gate): at dispatch time the tick calls
// cap-from-gate.sh to get `effective_cap` and passes it as `--cap` — so the floor (cap × 4) follows
// the resource-adaptive cap (GO=5 ⇒ floor 20; WAIT=2 ⇒ floor 8; EXTREME=1 ⇒ floor 4). The bare
// CONCURRENCY_CAP_DEFAULT=3 below is the CONSERVATIVE FALLBACK when no --cap is passed (manual runs),
// not a fixed production cap.
//
// The pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseTask, extractSection, readDependsOn } from "./task-schema.ts";
// criterion-cost self-record (gap-no-criterion-records-its-own-cost-checker-cost-jsonl): this
// criterion KNOWS its input size n (the ready pool count) — the ONLY field that splits "the
// criterion got slower" into "n got bigger" vs "the machine got busier" (the 35.8→91.2→157.0
// attribution case). Every CLI run appends ONE {name, ms, n: pool, load, at} row to
// .quay/checker-cost.jsonl — pure append, zero judgment. CHECKER_COST_SKIP=1 disables it (a
// hermetic test seam; the real loop always records).
import { recordCheckerCost, getLoad1 } from "./checker-cost.ts";
import {
  checkTaskTouchesResolve,
  findRepoRoot,
  parseTouches,
  checkTouchesPair,
  walkFiles,
} from "./touches-orthogonality-check.ts";
// The dispatch gate's OWN declared-path expander (single-source — ready-pool-check must not carry a
// parallel copy of "which files does a Touches declaration intend to touch?").
import { expandDeclaredTouches } from "./concurrent-batch-scheduler.ts";
import { isDirectEntry } from "./gate-script-base.ts";
// Reused "work has landed on master" signal (AC6: reuse, never a parallel copy) — the same
// symbol-resolution / touch-file evidence task-status-drift-check.ts uses to judge landing.
// buildGitHistoryIndex is the BATCHED git-history source (gap-ready-pool-check-times-out-after-
// git-history-signal): ONE `git log` over all of the landing ref (integration/develop/master per
// landingRef — gap-git-history-landed-master-stale-under-two-line-model), matched in memory per task,
// instead of ~30-50 per-task `git log -- <paths>` calls (each O(history) — the >150s pool-check timeout).
import { taskWorkLanded, buildGitHistoryIndex, countAcCheckboxes, landingRef, wordMatch } from "./task-status-drift-check.ts";
// RETIRED-MECHANISM INTERCEPT (gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check):
// promotion must NOT advance a candidate that references an ADR-022-deleted classic-pipeline script
// (prepare-milestone.js / execute-milestone.js / milestone-worktree.ts) without annotation — a todo
// pointing at a RETIRED pipeline mechanism is premise-void (dispatching it wastes a whole agent round).
// Reuse the SAME pool-candidate judge the strategic-doc-staleness-check CLI exposes (--pool-candidate
// <id>, review-cadence AC8) — single source, no parallel copy.
import { judgePoolCandidate } from "./strategic-doc-staleness-check.ts";
// gap-suite-blocking-experiment-rounds-count-toward-consecutive-red AC2: the DEFAULT lane count is
// nproc-derived (single source — full-suite-runner's defaultLaneCount, NOT a parallel copy of the
// nproc formula). An experiment round (--lane-count 8 vs the 4-lane default on this box) carries a
// laneCount ≠ this default and is excluded from the consecutive-red count; its red is an experiment
// finding, not a regression.
import { defaultLaneCount } from "./full-suite-runner.ts";
// MERGE-WORKTREE SURFACE (tasks/gap-dispatch-gate-blind-to-inflight-merge-worktree): the open-worktree
// enumerator (`git worktree list --porcelain`) — single source (fast-mode-telemetry's listWorktrees,
// not a parallel porcelain parser). The merge-worktree detector below reuses it to find worktrees
// where a MERGE is in flight.
import { listWorktrees } from "./fast-mode-telemetry.ts";

/** Default concurrency cap (max in-flight subagents) — CONSERVATIVE FALLBACK for manual runs with
 *  no --cap. The tick's dispatch decision point passes the ADAPTIVE cap from cap-from-gate.sh
 *  (gap-adaptive-concurrency-cap-tied-to-resource-gate); the floor is DERIVED from the cap passed. */
export const CONCURRENCY_CAP_DEFAULT = 3;

/** Default floor multiplier: floor = cap × this. 4× leaves one notch of headroom, far below the old
 *  10× (historical 08-02→08-04 stable pool of 11 = 9 real/3 cap = 3.0× proven; 4× is not the floor
 *  but leaves margin). */
export const POOL_FLOOR_MULT_DEFAULT = 4;

/** The healthy ready-pool floor: pool must be ≥ this before promotion pressure releases.
 *  floor = cap × 4 (cap=3 ⇒ 12). SINGLE SOURCE — no hardcoded 3 anywhere. */
export const POOL_FLOOR = CONCURRENCY_CAP_DEFAULT * POOL_FLOOR_MULT_DEFAULT;

/** floor = cap × floorMult (default 4×). The one definition of the floor; analyzeTasks calls this.
 * gap-ready-pool-floor-tied-to-volatile-cap: the floor must NOT ride the VOLATILE current cap — a
 * cap that drops under load (cap 4 → 3) would lower the floor (16 → 12) and let the SAME pool go
 * from ②true to ②false without any work — the "obligation disappears when the machine is busy"
 * channel. Fix: floor uses the WINDOW-MAX cap, never the current one. `floorCap` is the caller's
 * view of the max cap in the window (>= current cap); when omitted, the conservative floor cap
 * DEFAULT is used so the floor can never drop below cap × floorMult for the default cap. */
export function computePoolFloor(cap = CONCURRENCY_CAP_DEFAULT, floorMult = POOL_FLOOR_MULT_DEFAULT, floorCap?: number) {
  // floorCap undefined ⇒ pure `cap × floorMult` (the existing math — small explicit caps in
  // tests/experiments stay exact). floorCap passed ⇒ floor uses max(cap, floorCap) so a volatile
  // cap drop (cap 4→3 under load) never lowers the floor (gap-ready-pool-floor-tied-to-volatile-cap:
  // the "obligation disappears when the machine is busy" channel is closed).
  const effectiveFloorCap = floorCap === undefined ? cap : Math.max(cap, floorCap);
  return effectiveFloorCap * floorMult;
}

/** Minimum non-whitespace content for a section to count as a real artifact (mirrors
 *  quay-native store.ts MIN_SECTION_CHARS — a heading followed by one word is not an artifact). */
export const MIN_SECTION_CHARS = 40;

/** Task-level PARKED marker: a bold `**PARKED` in the body. Plain-text "PARKED" in AC prose
 *  (e.g. this very task's exclusion-rule description) is NOT a marker — matched only when bolded. */
export const PARKED_MARKER_RE = /\*\*PARKED\b/i;

// ── LANDING-BLOCKED signal (tasks/gap-landing-blocked-invisible-to-dispatch-criteria) ───────────────
// The dispatch criterion (`dispatchable_disjoint >= cap`) answers ONLY "are there ≥cap mutually-
// disjoint candidates" (the touches-conflict graph, grep-verified: it reads NO merge/landing state).
// slot-refill measures slot release. So criterion_met=True stays True when landing is STRUCTURALLY
// blocked (AC17 catch-up: develop/integration frozen ~2h at a stale commit while master has un-migrated
// commits) — "dispatchable visible, landable invisible" (the heartbeat-vs-consciousness instance:
// the criterion has no basis yet still answers). This axis adds landing VISIBILITY next to
// criterion_met: when develop is behind master by ≥ behindThreshold AND the merge target (integration)
// has been frozen (no commit for > stalenessMs), it reports landing_blocked:true with a reason — the
// ready pool then says "dispatchable candidates exist, BUT landing is blocked", never "has candidates
// = healthy". It is a SIGNAL, not a gate: landing_blocked does NOT stop dispatch (AC4 negative control
// = normal landing never false-reports); the dispatch decision stays criterion-driven.

/** Landing-blocked staleness window: the merge target (integration) is "frozen" when it has received
 *  no commit within this window. Matches the AC17 catch-up scenario (develop/integration frozen ~2h
 *  at a stale commit). The 20-25 min tick cadence leaves ample headroom — normal operation (tasks
 *  landing on integration) never reaches it. */
export const LANDING_STALENESS_MS_DEFAULT = 2 * 60 * 60 * 1000; // 2h

/** How far develop must be behind master before a landing-block is flagged. master's release role is
 *  EMPTY in quay (no release flow) — ANY commit on master that develop lacks is an un-migrated
 *  anomaly, so the default is 1. Exposed for single-line downstreams where master may legitimately
 *  diverge (pass a higher threshold / master==develop to disable). */
export const LANDING_BEHIND_THRESHOLD_DEFAULT = 1;

/** Pure landing-blocked decision — unit-tested, no git. All inputs mechanical:
 *  @param {object} i
 *  @param {number} i.developBehindMaster   commits reachable from master but not develop
 *                                         (`git rev-list --count develop..master`); 0 when unknown
 *  @param {number|null} i.integrationStalenessMs ms since the last commit on integration; null when
 *                                         the ref does not exist (single-line downstream ⇒ never frozen)
 *  @param {number} i.now                   epoch ms (injected for testability)
 *  @param {number} [i.stalenessMs]         freeze window (default LANDING_STALENESS_MS_DEFAULT)
 *  @param {number} [i.behindThreshold]     min behind-master commits (default 1)
 *  @returns {{ landing_blocked: boolean, reason: string|null }}
 */
export function computeLandingBlocked({ developBehindMaster, integrationStalenessMs, now, stalenessMs = LANDING_STALENESS_MS_DEFAULT, behindThreshold = LANDING_BEHIND_THRESHOLD_DEFAULT }) {
  const behind = developBehindMaster >= behindThreshold;
  const frozen = integrationStalenessMs !== null && integrationStalenessMs > stalenessMs;
  if (behind && frozen) {
    return {
      landing_blocked: true,
      reason:
        `landing-blocked: develop is ${developBehindMaster} commit(s) behind master and integration ` +
        `has had no commit for ${Math.round(integrationStalenessMs / 1000)}s (frozen) — AC17 catch-up incomplete`,
    };
  }
  return { landing_blocked: false, reason: null };
}

/** FAIL-SAFE git read: `git rev-list --count <range>` → count, or null when the refs don't exist /
 *  root isn't a git repo (a missing ref / non-git test workspace is NOT landing-blocked). */
export function readGitRevCount(root, range) {
  try {
    const out = execFileSync("git", ["-C", root, "rev-list", "--count", range], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"],
    });
    const n = Number.parseInt(out.trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** FAIL-SAFE git read: epoch-ms of the last commit on `ref` (`git log -1 --format=%ct`), or null when
 *  the ref doesn't exist / root isn't a git repo. null ⇒ staleness unknown ⇒ NOT frozen (fail-safe: a
 *  single-line downstream without an integration ref never reports landing-blocked). */
export function readLastCommitMs(root, ref) {
  try {
    const out = execFileSync("git", ["-C", root, "log", "-1", "--format=%ct", ref], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"],
    });
    const sec = Number.parseInt(out.trim(), 10);
    return Number.isFinite(sec) ? sec * 1000 : null;
  } catch {
    return null;
  }
}

/** Detect landing-blocked from the two-line branch model's git state (fail-safe: any missing ref /
 *  non-git root ⇒ not blocked). `develop` / `integration` / `master` are the CONFIGURED ref names —
 *  a single-line downstream passes master/master/master and this never fires (develop..master is
 *  empty). */
export function detectLandingBlocked(root, { develop = "develop", integration = "integration", master = "master", stalenessMs = LANDING_STALENESS_MS_DEFAULT, behindThreshold = LANDING_BEHIND_THRESHOLD_DEFAULT, now = Date.now() } = {}) {
  const developBehindMaster = readGitRevCount(root, `${develop}..${master}`);
  const lastIntegrationCommitMs = readLastCommitMs(root, integration);
  return computeLandingBlocked({
    developBehindMaster: developBehindMaster ?? 0,
    integrationStalenessMs: lastIntegrationCommitMs === null ? null : now - lastIntegrationCommitMs,
    now,
    stalenessMs,
    behindThreshold,
  });
}

// ── MERGE-WORKTREE SURFACE (tasks/gap-dispatch-gate-blind-to-inflight-merge-worktree) ─────────────
// The dispatch gate's touches-overlap judgment used to cover only in-flight TASK worktrees (the peer
// set slot-refill/ready-pool-check rank against) — a worktree where a MERGE is in flight holds a
// conflict surface (`git -C <wt> diff --name-only HEAD`, the merge's uncommitted surface) that was
// STRUCTURALLY invisible: outer deferred tasks that collide with the merge surface got dispatched
// anyway by the inner's slot-refill (the vhs-merge coordination accident: `deferred` showed only
// `peer <task>` reasons, none naming the merge worktree). These helpers surface merge-in-flight
// worktrees + their conflict surfaces so the touches-overlap judgment — slot-refill's step-4 check
// AND ready-pool-check's dispatchable_disjoint criterion — can include them. Fail-soft throughout:
// a non-git root / unreadable worktree list ⇒ [] (never a fabricated block from an unavailable
// source — hard rule 5: absent evidence is not a verdict).

/** True when `wtPath`'s index has unmerged entries — the `UU` state git leaves during a CONFLICTED
 *  merge (a real merge with conflicts writes stages 1/2/3 into the index; `git ls-files -u` lists
 *  them). This is the AC3 negative-control shape. Fail-soft: any git failure ⇒ false. */
export function hasUnmergedEntries(wtPath) {
  try {
    const out = execFileSync("git", ["-C", wtPath, "ls-files", "-u"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/** True when a git MERGE is in progress in `wtPath` — the MERGE_HEAD file exists (`git merge` writes
 *  it from the start of the merge, before any conflict resolution). A worktree mid-merge is exactly
 *  the "merge 中的 worktree" whose uncommitted surface is a conflict surface for new dispatches. */
export function mergeHeadPresent(wtPath) {
  try {
    const p = execFileSync("git", ["-C", wtPath, "rev-parse", "--git-path", "MERGE_HEAD"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return p.length > 0 && fs.existsSync(p);
  } catch {
    return false;
  }
}

/** True when a git MERGE is in flight in `wtPath` — MERGE_HEAD present OR unmerged (`UU`) entries.
 *  The union is deliberate: MERGE_HEAD catches an in-progress merge before conflicts are detected;
 *  unmerged entries catch a conflicted merge even if MERGE_HEAD has been removed (the negative-control
 *  shape). A task worktree without a merge in progress carries neither ⇒ never flagged. */
export function isMergeWorktree(wtPath) {
  return mergeHeadPresent(wtPath) || hasUnmergedEntries(wtPath);
}

/** The merge's uncommitted surface: `git -C <wt> diff --name-only HEAD` — every file the in-flight
 *  merge has changed relative to HEAD (conflicts AND cleanly-merged changes; verified: a conflicted
 *  merge lists both the `UU` conflict path and the staged clean-merge additions). Repo-relative
 *  paths. Fail-soft: git failure ⇒ [] (never a fabricated surface). */
export function diffNameOnlyHead(wtPath) {
  try {
    const out = execFileSync("git", ["-C", wtPath, "diff", "--name-only", "HEAD"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Enumerate the conflict surfaces of all in-flight MERGE worktrees under `root`. The MAIN checkout
 *  itself is excluded — the outer's own hot-file edits in the main tree are the SEPARATE
 *  `--outer-inflight` occupancy axis (fast-mode-loop-tick.md step 3b), not a merge surface. Returns
 *  `[{ name, path, files }]`: `name` is the worktree basename (the identifier the deferred reason
 *  names), `path` its absolute path, `files` the `git diff --name-only HEAD` surface (non-empty).
 *  Fail-soft: non-git root / unreadable worktree list / empty surface ⇒ [] — never a fabricated
 *  block. */
export function computeMergeWorktreeSurfaces(root) {
  const worktrees = listWorktrees(root);
  const out = [];
  for (const wt of worktrees) {
    if (!wt.path || path.resolve(wt.path) === path.resolve(root)) continue; // main checkout, not a merge worktree
    if (!isMergeWorktree(wt.path)) continue;
    const files = diffNameOnlyHead(wt.path);
    if (files.length === 0) continue; // a merge with no changed surface blocks nothing
    out.push({ name: path.basename(wt.path), path: wt.path, files });
  }
  return out;
}

/** The merge-worktree arm of the touches-overlap judgment — the DEFERRED-REASON DISTINCTION (AC2):
 *  a candidate's parsed touches vs every in-flight merge worktree's conflict surface. Returns
 *  `{ blocked, name }`: `name` is the merge worktree basename when the candidate's touches overlap
 *  its surface (the caller builds the reason `touches-overlap-in-flight (merge-worktree <name>)`),
 *  `null` when no merge surface blocks it (the PEER arm then applies — peer reasons stay distinct,
 *  never silently conflated). Uses the SAME checkTouchesPair the peer arm uses, with the merge
 *  surface as a synthetic parsed-touches side (`hasSection: true, globs: files` — concrete paths
 *  always participate whether or not they exist on disk, the declared-path rule). */
export function mergeSurfaceBlock(parsed, surfaces, expand) {
  for (const s of surfaces || []) {
    if (!Array.isArray(s.files) || s.files.length === 0) continue;
    const surfaceParsed = { hasSection: true, globs: s.files };
    if (!checkTouchesPair(parsed, surfaceParsed, expand).disjoint) {
      return { blocked: true, name: s.name };
    }
  }
  return { blocked: false, name: null };
}

// ── Value-prioritization relevance signal (tasks/gap-value-prioritization-has-no-mechanism) ─────────
// The "which of the N todos matters most" question gets a MECHANICAL answer (no human scoring, AC3).
// Three signal sources, all mechanical:
//   strategic — body references a written strategic question: the orchestration/ strategic-doc
//               naming convention FINDING-* / SYNTHESIS-* / SPEC-* / REVIEW-cadence (grep).
//   blocking  — parent/children frontmatter: the task is a parent (children non-empty) OR is named
//               as `parent:` by another task — landing it unblocks that dependent.
//   cost      — declared Touches scale (parseTouches glob count; a MISSING Touches section is
//               unknown scope, treated as high cost — the same conservative stance the dispatch gate
//               takes: no usable Touches collides with everything).
// value = strategic*STRATEGIC_WEIGHT + blocking*BLOCKING_WEIGHT + costBenefit(1/cost capped at 1).
// The weights make the dominance chain STRICT: strategic (min 4) > non-strategic max (blocking 2 +
// costBenefit max 1 = 3), and blocking (min 2) > costBenefit max (1). So a traceable task always
// ranks before an untraceable one, a blocking task before a non-blocking one, and small-cost /
// high-benefit breaks ties within a class. Sort is value desc (stable by id asc). Output to JSON as
// `top_relevance` (the --top N todo query) + `ready_relevance` (the ready pool, "who to dispatch
// next" — AC6). The existing gap-* > DIR-* / disjointness promotion ORDER is untouched (AC4).
export const STRATEGIC_REF_RE = /FINDING-|SYNTHESIS-|SPEC-|REVIEW-cadence/;
export const STRATEGIC_WEIGHT = 4;
export const BLOCKING_WEIGHT = 2;

// ── SUITE-BLOCKING signal (tasks/gap-ready-relevance-blind-to-suite-blocking-signal) ────────────────
// computeRelevance's `blocking` axis used to read ONLY static parent/children dependency — a defect
// that was consecutively red-ing the FULL SUITE (verification-round.jsonl `state: red` rows) ranked
// value 0.25 / position 7 with blocking:false, so the inner's slot-refill never picked it. This
// signal adds the "currently blocking the suite" axis: a task whose `## Touches` hits the failure
// file(s) of a ≥N-consecutive-red window gets `blocking` flipped true + a value bonus so it jumps
// the dispatch queue. Sources are the two .quay ledgers the outer already writes:
//   <root>/.quay/verification-round.jsonl — one line per full-suite run (state/reason/round…)
//   <root>/.quay/full-suite-state.json    — the LATEST run, carries failures[] (file/line)
// The signal is a RECOMMENDER axis (never a gate): it only re-ranks ready_relevance / slot-refill
// recommended — dispatch decisions stay criterion-driven.
export const SUITE_BLOCKING_WEIGHT = 2;

/** Minimum consecutive red rounds before a suite-blocking signal fires (the Contract band:
 *  连续 ≥3 轮红同一 Touches 命中 ⇒ blocking true). */
export const RED_WINDOW_MIN_DEFAULT = 3;

// Shape-aware registered sections (mirrors quay-native store.ts SHAPE_REGISTRY, single-source shape
// dispatch: contract → finding → plan; unknown fails closed). The four artifacts are the shape's own
// registered sections — a `finding`-shape task has no plan dimension, a `contract`-shape task uses
// `## Contract` as its plan artifact.
//
// GAP-TODO-SHAPE-MISMATCH (2026-08-09, tasks/gap-todo-shape-mismatch-author-gate): the finding shape
// additionally recognizes the draft-heading variants `## AC（draft）` / `## DoD（draft）` (and their
// half-width-paren form `## AC (draft)`) that 9 real finding-shape gap-* tasks in this store use for
// their AC/DoD sections. They ARE the AC/DoD artifacts — the `（draft）` suffix is a heading-label
// convention, not an absent section — so the four-artifacts gate must count them, or those todo tasks
// are wrongly ineligible for author→ready promotion (the 38-todo shape-vs-gate mismatch).
const SHAPE_SECTIONS = {
  contract: {
    // `## 人的裁定` is the directive-variant proposal-slot (type: directive tasks
    // carry the human ruling as proposal, implementation in ## Contract —
    // DIR-123-aarch64, gap-cli-quay-init-collides). Same alias principle as
    // finding's `## Finding` mapping into the proposal-slot.
    proposal: ["Proposal", "人的裁定"],
    plan: ["Contract"],
    ac: ["AC", "Acceptance Criteria"],
    dod: ["DoD", "Definition of Done"],
  },
  finding: {
    proposal: ["Finding"],
    ac: ["AC", "Acceptance Criteria", "AC（draft）", "AC (draft)"],
    dod: ["DoD", "Definition of Done", "DoD（draft）", "DoD (draft)"],
  },
  plan: {
    proposal: ["Proposal"],
    plan: ["Plan"],
    ac: ["AC", "Acceptance Criteria"],
    dod: ["DoD", "Definition of Done"],
  },
  // proposal shape (2026-08-11, mirrors store.ts SHAPE_REGISTRY): a task whose own
  // complete contract is Proposal / AC / DoD with NO plan dimension — symmetric
  // with `finding` but the proposal-slot is the literal `## Proposal`. Recording-type
  // directives (DIR-028: "只记录方向,不要求立刻做") and execution tasks carrying their
  // approach inside `## Proposal` (no separate `## Plan`) are complete on this
  // dimension. Adding a fabricated `## Contract` would be a shape change, not a fix.
  proposal: {
    proposal: ["Proposal"],
    ac: ["AC", "Acceptance Criteria"],
    dod: ["DoD", "Definition of Done"],
  },
};

/** Detect a task body's shape by exact heading presence (contract → finding → plan → proposal → unknown). */
export function detectShape(body) {
  if (/^##\s+Contract\s*$/im.test(body)) return "contract";
  if (/^##\s+Finding\s*$/im.test(body)) return "finding";
  if (/^##\s+Plan\s*$/im.test(body)) return "plan";
  // proposal shape: a literal `## Proposal` section with no contract/finding/plan
  // heading. Checked AFTER contract/finding/plan so a task carrying `## Proposal`
  // alongside its shape's own proposal-slot heading still resolves to its true shape.
  if (/^##\s+Proposal\s*$/im.test(body)) return "proposal";
  return "unknown";
}

/** Escape regex-special characters so a heading is matched LITERALLY. `extractSection` builds its
 *  heading regex from the caller's string — without escaping, a heading like `AC (draft)` would be
 *  interpreted as a capture group and never match the literal `## AC (draft)` line. All registered
 *  headings are plain section names; escaping is a no-op for them. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionNonWsLength(body, heading) {
  const sec = extractSection(body, escapeRegExp(heading));
  return sec === null ? 0 : sec.replace(/\s/g, "").length;
}

/** Shape-aware four-artifacts completeness. Returns { shape, complete, artifacts, missing }. */
export function artifactsComplete(body) {
  const shape = detectShape(body);
  const spec = SHAPE_SECTIONS[shape];
  if (!spec) {
    return { shape, complete: false, artifacts: {}, missing: ["unknown-shape"] };
  }
  const artifacts = {};
  const missing = [];
  for (const [name, headings] of Object.entries(spec)) {
    const ok = headings.some((h) => sectionNonWsLength(body, h) >= MIN_SECTION_CHARS);
    artifacts[name] = ok;
    if (!ok) missing.push(name);
  }
  return { shape, complete: Object.values(artifacts).every(Boolean), artifacts, missing };
}

function readFrontField(frontmatterRaw, key) {
  const m = frontmatterRaw.match(new RegExp(`^${key}:\\s*(\\S+)`, "m"));
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
}

/** Kind classification by task-id prefix: `gap-*` defects > `DIR-*` capabilities > other. */
export function classifyKind(id) {
  if (/^gap[-_]/i.test(id)) return "gap";
  if (/^DIR[-_]/i.test(id)) return "dir";
  return "other";
}

export function kindOrder(kind) {
  return kind === "gap" ? 0 : kind === "dir" ? 1 : 2;
}

// ── COMMIT-TRACE work-landed signal (tasks/gap-nyf-branch-existence-vs-commit-trace) ──────────────
// The not-yet-flipped criterion's existing workLanded signals depend on TRANSIENT or narrow artifacts:
// the task/<id> branch existing+unmerged (a branch merged+DELETED makes that signal vanish), and the
// git-history signal hardcoded to `master` (STALE under the two-line branch model — master..integration
// = 2224 on 2026-08-11, so integration-landed commits are invisible to it). Both hide "work already
// landed, still ready" tasks — the 16 phantom ready tasks (2026-08-11), each verified via
// `git log --all | grep -E "inner: <id>|fan-in: task/<id>"`. The COMMIT-TRACE signal is PERSISTENT:
// commit SUBJECTS survive branch deletion, and reading `--all` covers the two-line model's integration
// fan-in that a stale `master` misses. A commit whose subject names the task in one of the live commit
// conventions —
//   `inner: <id> …`                 (the inner executor's implementation commit)
//   `fan-in: task/<id> …` / `merge: fan-in task/<id> …` / `merge: fan-in <id> …`
//                                  (the outer's fan-in merge of the task branch)
// — is a durable record that the task was DISPATCHED and its work committed ⇒ it is "work landed, not
// yet flipped" (waiting fan-in or already merged), NEVER fresh dispatchable work.

/** ONE `git log --all` pass for commit SUBJECTS (the commit-trace signal needs no path data — subjects
 *  alone carry the inner:/fan-in: convention). `--all` covers integration + develop + master + any live
 *  task branch, so a task whose work landed on integration (invisible to a stale `master`) is still
 *  caught. Fail-closed: any git failure / non-git root ⇒ empty array (never a positive from an
 *  unavailable source). Called ONCE per analyzeTasks (the pool scan), never per task. */
export function buildCommitTraceIndex(repoRoot) {
  try {
    const out = execFileSync("git", ["log", "--all", "--format=%s"], {
      cwd: repoRoot, encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** True when a commit subject records the task's work in one of the live commit conventions.
 *  Position-based (CLAUDE.md hard rule 2): the task id must appear as a DELIMITED word after the
 *  `inner: ` / `fan-in: task/` / `fan-in ` prefix — a subject that merely mentions the id elsewhere
 *  (e.g. an `outer:` closure commit listing many ids) is NOT a trace. The four forms cover the
 *  observed real formats: `inner: <id>`, `fan-in: task/<id>`, `merge: fan-in task/<id>`, and the bare
 *  `merge: fan-in <id>` (no `task/` prefix, e.g. gap-manager-tick-core-exclusion-now-inert-after-c9-fix). */
export function commitSubjectTracesTask(subject, taskId) {
  return wordMatch(subject, `inner: ${taskId}`)
    || wordMatch(subject, `fan-in: task/${taskId}`)
    || wordMatch(subject, `fan-in task/${taskId}`)
    || wordMatch(subject, `fan-in ${taskId}`);
}

/** Batched commit-trace check: true when ANY subject in the analyzeTasks-built index traces the task. */
export function commitTraceLanded(taskId, subjects) {
  return subjects.some((s) => commitSubjectTracesTask(s, taskId));
}

// gap-ready-pool-completion-checkboxes-shape-aware — the not-yet-flipped criterion's "AC 无未勾项"
// conjunct (gap-ready-pool-commit-trace-subject-not-proof-of-done) and the A9 population split
// (gap-ready-pool-nyf-split-backlog-vs-contradiction) must SEE the task's ACTUAL completion checkboxes.
// The old `extractSection(body, "Acceptance Criteria")` misses the `## AC` / `## AC（draft）` / `## AC
// (draft)` / `## DoD（draft）` headings that real finding-shape gap-* tasks use (same draft-heading
// family the author→ready gate's SHAPE_SECTIONS already recognizes) — a task judged "landed" with open
// checkboxes under those headings got total=0 (the no-AC fallback) and was silently swallowed. Reuse
// the shape-aware heading registry so "AC 无未勾项" means what the task body actually declares.
function extractSectionByShape(body, kind) {
  const literal = kind === "ac" ? "Acceptance Criteria" : "Definition of Done";
  const shape = detectShape(body);
  const spec = SHAPE_SECTIONS[shape];
  const headings = spec ? spec[kind] : [];
  // Try the shape's registered headings (covers `## AC` / `## AC（draft）` / `## AC (draft)` for the
  // finding shape), then the literal full heading as a fallback (a task with NO shape-defining heading
  // — unknown shape — still has its `## Acceptance Criteria` section read; the no-AC fallback must not
  // fire on a task that HAS checkboxes under a shape-less heading).
  for (const h of [...headings, literal]) {
    const sec = extractSection(body, escapeRegExp(h));
    if (sec !== null) return sec;
  }
  return null;
}

/** Extract the text of each UNCHECKED checkbox line in a section (`- [ ]` / `- [~]`; `[x]`/`[X]` are
 *  checked, `[~]` counts as unchecked matching the gate semantics). */
function uncheckedItems(section) {
  if (!section) return [];
  return (section.match(/^\s*-\s+\[[^xX]\]\s+(.+)$/gm) ?? [])
    .map((line) => line.replace(/^\s*-\s+\[[^xX]\]\s+/, "").trim())
    .filter(Boolean);
}

/** Count the task's SELF-DECLARED completion checkboxes (AC + DoD sections, shape-aware heading
 *  recognition). `checked === total` ⟺ "AC 无未勾项" (every completion box the task body declares is
 *  ticked). A task judged "landed" with unchecked boxes here is a CONTRADICTION (乙), not backlog (甲)
 *  — UNLESS every unchecked box is annotated `（待外部）` (see isExternalVerificationItem), the
 *  awaiting-verification shape. `uncheckedItems` carries the unchecked item TEXTS so the workLanded arm
 *  can judge their DECLARED nature (all external ⇒ awaiting-verification; any implementation ⇒ NOT
 *  landed, stays dispatchable). */
function countCompletionCheckboxes(body) {
  const acSection = extractSectionByShape(body, "ac");
  const dodSection = extractSectionByShape(body, "dod");
  const ac = countAcCheckboxes(acSection);
  const dod = countAcCheckboxes(dodSection);
  return {
    total: ac.total + dod.total,
    checked: ac.checked + dod.checked,
    unchecked: ac.unchecked + dod.unchecked,
    uncheckedItems: [...uncheckedItems(acSection), ...uncheckedItems(dodSection)],
  };
}

// gap-ready-pool-remaining-external-vs-implementation (HUMAN mechanism ruling, 2026-08-12): the
// workLanded arm's "verification-window done-flip" leniency used to be a RATIO (acRatio > 0.5), which
// could not distinguish "the remaining unchecked boxes depend only on EXTERNAL events (full suite
// green / outer verification-round)" from "the remaining unchecked boxes include this task's OWN
// implementation/evidence" — the gap-cli-import-refactor misfire (AC 5/5 + DoD 4/4 = 5/9 = 55.6% >
// 50%: the DoD still carried the run()/shell golden-replay EVIDENCE — real remaining implementation —
// yet it was excluded as "landed"). The human ruling REPLACES the ratio (and ANY wording heuristic —
// 判据只读注解、不猜) with a DECLARED annotation: the task AUTHOR writes the remaining-item nature at
// the END of each unchecked item; the criterion only READS the annotation, never guesses.
//
// Judgment contract (the ruling):
//  1. POSITION: the annotation lives at the END of the item text (position-based judgment, hard rule 2).
//  2. CLOSED ENUM (enumerate, never boolean — hard rule 3): `（待外部）` / `（待本任务）`.
//       （待外部）   depends only on an EXTERNAL event (suite green / outer verification / someone's merge)
//       （待本任务）  this task's OWN implementation/evidence to produce
//  3. FAIL-CLOSED: an UNANNOTATED unchecked item defaults to 待本任务 — if the default were 待外部, a
//     missing annotation = wrongly landed = today's 5-swallowed-tasks defect recurs.
//  4. awaiting-verification ⟺ EVERY remaining unchecked item is annotated `（待外部）`; ANY （待本任务）
//     or unannotated item ⇒ stays ready (dispatchable).
//  5. The >50% ratio branch is DELETED — its function is taken over by the annotation (a declared
//     signal, never a guessed ratio).
export function isExternalVerificationItem(text) {
  return /（待外部）\s*$/.test(text);
}

/** True when the unchecked item is NOT declared `（待外部）` — i.e. it is `（待本任务）` OR unannotated
 *  (the fail-closed default is 待本任务). */
export function isPendingImplementationItem(text) {
  return !isExternalVerificationItem(text);
}

/** True when the task is in the "this batch done, not yet flipped to done" state — the declared
 *  work has landed on the mainline (task-status-drift-check's symbol-resolution / touch-file /
 *  git-history evidence — the last over integration/develop/master per landingRef, not hardcoded
 *  master, gap-git-history-landed-master-stale-under-two-line-model — OR the COMMIT-TRACE record
 *  below) but `status` is still `ready` (fan-in has not flipped it). The signal is a UNION of three
 *  INDEPENDENT closure indicators:
 *   (1) taskWorkLanded — work-landed evidence (symbol-resolution / touch-file / git-history) that
 *       catches the "merged-but-AC-incomplete" half (the inner's fan-in merges WITHOUT ticking AC
 *       boxes; gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool). By itself it means
 *       "SOME work landed", NOT "the task is done" — so it excludes ONLY when the completion
 *       checkboxes are all checked, OR every remaining unchecked box is annotated `（待外部）`
 *       (the awaiting-verification done-flip shape — the remaining work depends only on suite green /
 *       outer verification / someone else's merge; e.g. gap-mcp-server 9/11 with two `全量套件绿` DoD
 *       boxes),
 *       OR the task has no completion checkboxes at all (total===0 — structurally unable to tick
 *       boxes, its landing is its closeout; gap-git-history-landed-master-stale-under-two-line-model
 *       AC4). A workLanded task with ANY remaining box that is this task's OWN implementation/evidence
 *       (e.g. gap-cli-import-refactor's run()/shell golden-replay EVIDENCE) has REAL remaining
 *       implementation — STUCK-WORK — and must stay dispatchable (gap-ready-pool-worklanded-traps-
 *       stuck-work AC2), not be trapped out of both dispatch AND done-flip.
 *   (2) COMMIT-TRACE (tasks/gap-nyf-branch-existence-vs-commit-trace) — a commit whose SUBJECT names
 *       the task in the `inner: <id>` / `fan-in: task/<id>` / `fan-in <id>` conventions. PERSISTENT:
 *       commit subjects survive branch deletion (the old branch-existence signal vanished when the
 *       merged branch was deleted), and it reads `--all` (the two-line model's INTEGRATION fan-in
 *       invisible to the stale-master git-history signal). Joins workLanded under the SAME
 *       completion-completeness gate — the manager's "别改它" on
 *       gap-ready-pool-worklanded-traps-stuck-work: a traced task whose completion boxes are not all
 *       checked is STUCK-WORK with real remaining implementation and stays dispatchable.
 *   (3) Completion-complete — `all_checked && status == ready` (countCompletionCheckboxes, total > 0):
 *       the COMPLETION state as written by the checkboxes, independent of AC writing style
 *       (gap-closure-detection-reads-symbols-not-checkboxes). A prose-AC completed task whose work
 *       landed but shows no resolvable symbols / `(new)` touches / git-history reference is invisible
 *       to (1) yet IS a closure candidate — this second signal surfaces it. Complements, never
 *       replaces, taskWorkLanded (the union, not an either/or).
 *  A task is excluded from the dispatchable pool when ANY of the three fires (a legal done-flip
 *  candidate). `taskId` is passed through so the git-history signal
 *  (gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks) can anchor on the task's own
 *  id without depending on the self-touch Touches entry. `opts` is either the analyzeTasks-built
 *  commit-subject index (ONE `git log --all` per pool scan; null/empty ⇒ the commit-trace signal is
 *  off — the legacy caller form) or an options bag `{ ref, commitTraceSubjects }` (the current
 *  analyzeTasks caller): `ref` names the landing ref (default: landingRef's integration→develop→master
 *  resolution). */
export function notYetFlipped(task, repoRoot, gitIndex, opts = null) {
  if (task.status !== "ready") return false;
  // opts is EITHER the legacy commit-subject array OR an options bag { ref, commitTraceSubjects }.
  const commitTraceSubjects = Array.isArray(opts) ? opts : (opts ? opts.commitTraceSubjects : null);
  const o = { taskId: task.id };
  if (gitIndex) o.gitIndex = gitIndex; // batched git-history index (see buildGitHistoryIndex)
  if (opts && !Array.isArray(opts) && opts.ref) o.ref = opts.ref; // landing ref (two-line model)
  const workLanded = taskWorkLanded(task.body, repoRoot, o);
  // COMMIT-TRACE (gap-nyf-branch-existence-vs-commit-trace): a commit whose subject names the task in
  // the inner:/fan-in: conventions is a PERSISTENT work-landed record — it survives branch deletion AND
  // reads `--all` (the two-line model's integration fan-in invisible to the stale-master git-history
  // signal). It joins workLanded under the SAME AC-completeness gate below (the manager's "别改它" on
  // gap-ready-pool-worklanded-traps-stuck-work): a traced task whose ACs are far from complete is
  // STUCK-WORK with real remaining implementation and stays dispatchable.
  const traced = commitTraceSubjects ? commitTraceLanded(task.id, commitTraceSubjects) : false;
  // gap-ready-pool-completion-checkboxes-shape-aware — count the task's SELF-DECLARED completion
  // checkboxes (AC + DoD, shape-aware: `## AC` / `## AC（draft）` / `## AC (draft)` / `## DoD（draft）`
  // included). The old `extractSection(body, "Acceptance Criteria")` returned null (→ total=0 → the
  // no-AC fallback) for the 9 finding-shape tasks, so a "landed" task with OPEN boxes was swallowed.
  const { total, checked, uncheckedItems: remainingItems } = countCompletionCheckboxes(task.body);
  const allChecked = total > 0 && checked === total;
  // gap-ready-pool-remaining-external-vs-implementation (HUMAN mechanism ruling, 2026-08-12): the
  // workLanded arm's "verification-window" leniency is no longer a >50% RATIO (which could not tell
  // "the remaining unchecked boxes are only external verification" from "the remaining unchecked boxes
  // include this task's OWN implementation"). The remaining-item nature is DECLARED by the task author
  // at the END of each unchecked item (`（待外部）` / `（待本任务）`, closed enum; UNANNOTATED = 待本任务,
  // fail-closed). A workLanded task is a done-flip ONLY when EVERY remaining unchecked completion item
  // is annotated `（待外部）`; ANY `（待本任务）` or unannotated item ⇒ NOT landed ⇒ stays dispatchable.
  const remainingAllExternal = remainingItems.length > 0 && remainingItems.every(isExternalVerificationItem);
  // NO-AC fallback (gap-git-history-landed-master-stale-under-two-line-model AC4): a task with NO
  // completion checkboxes — AC nor DoD — anywhere (total=0) is STRUCTURALLY unable to tick boxes:
  // allChecked is always false, so it can never be a done-flip through the checkbox signals and would
  // sit in the ready pool forever (measured 2026-08-11: last-pane / suite-red). When its work HAS
  // landed (workLanded OR commit-trace), the landing itself is its closeout signal: total===0 joins
  // the all-checked / remaining-all-external gate. A no-checkbox task whose work has NOT landed stays
  // dispatchable (workLanded false keeps doneFlipReady false).
  // gap-ready-pool-commit-trace-subject-not-proof-of-done (manager 2026-08-12, higher-priority than the
  // reason-axis fix — a false "landed" makes a task disappear from the pool FOREVER): a commit SUBJECT
  // naming the task is a WEAKER work-landed signal than taskWorkLanded (which reads symbol-resolution /
  // touch-file / git-history evidence of the MERGED CODE). A subject hit only proves "someone committed
  // with the task id in the subject" — an INNER's intermediate-step commit can name the id without
  // completing the work (measured: gap-cli-import-refactor-run-shell-architecture inner committed
  // "导出 7 函数", subject hit ⇒ judged landed ⇒ excluded, but AC 5/9 unchecked, bin/quay.ts did not
  // shrink, cli.test.mjs's 7 derivation points never dropped — 5 ready tasks swallowed by the trace
  // alone). So the COMMIT-TRACE arm requires the task's SELF-DECLARED completion condition: ALL
  // checkboxes checked (or total===0, the no-AC fallback — a no-AC task is structurally unable to
  // tick boxes, its landing is its closeout). ANY unchecked checkbox ⇒ NOT landed regardless of the
  // trace — the trace alone is never enough.
  const commitTraceReady = traced && (allChecked || total === 0);
  const workLandedReady = workLanded && (allChecked || remainingAllExternal || total === 0);
  const doneFlipReady = workLandedReady || commitTraceReady;
  return doneFlipReady || allChecked;
}

export function isFixture(task) {
  return (task.labels || []).includes("fixture");
}

export function isParked(task) {
  return PARKED_MARKER_RE.test(task.body);
}

// AC-record exclusion (SPEC-three-layer-unified-architecture §5 AC-tracking, manager AC20-AC35
// migration): an `ac`-labelled task is a tracked acceptance-criterion record, NOT a dispatchable
// work item — it lives in the task store for gate/ledger purposes but must not enter the ready pool
// or pollute dispatchable_disjoint. Distinct from `fixture` (gate demo, never real work) and
// `parked` (temporarily shelved) — an AC record is permanently non-dispatchable by kind.
export function isAcRecord(task) {
  return (task.labels || []).includes("ac");
}

/** Parse the `children:` frontmatter field — flow `[a, b]` or block `- a` list. Mirrors the labels
 *  parser in task-schema.ts (lenient; no YAML dep). Returns the child task-id array. */
export function readChildren(frontmatterRaw) {
  const flow = frontmatterRaw.match(/^children:\s*\[([^\]]*)\]\s*$/m);
  if (flow) {
    return flow[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  const lines = frontmatterRaw.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^children:\s*$/.test(l));
  if (idx < 0) return [];
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s+-\s+(.+?)\s*$/);
    if (m) out.push(m[1].replace(/^["']|["']$/g, "").trim());
    else if (/^\S/.test(lines[i])) break; // next top-level key ends the list
  }
  return out;
}

// ── PROSE-PREREQUISITE GAP (tasks/gap-prerequisite-gates-prose-invisible-to-mechanisms) ────────────
// The mechanism paths that judge dispatch-readiness — the A15② dependency check
// (it0-split-or-commit-check.ts's PARENT-DONE-IFF-CHILDREN), the ready-pool author→ready gate, and
// the pre-dispatch readiness scan — read RELATION EDGES (parent/children/depends_on). A prerequisite
// written ONLY as prose (a `[[task-id]]` wikilink inside a "Do not dispatch until … lands / 前置 /
// depends on" declaration) is invisible to all three: the task stays ready/dispatchable and only a
// subagent reading the body discovers it. This detector makes prose-declared prerequisites
// FAIL-CLOSED: a task whose body declares a prerequisite that is NOT expressed as a relation edge is
// excluded from the ready pool and ineligible for author→ready promotion (it stays dispatchable ONLY
// when the prose prereq is ALSO a relation edge — a normal dependency, handled by depsReadyFor).
//
// Precision constraints (verified against the real store, 2026-08-11):
//   - WIKILINKS INSIDE CODE SPANS ARE SKIPPED: a paragraph QUOTING another task's prereq prose inside
//     backticks (`` `[[gap-…]]` `` — e.g. this very task's Proposal describing the empirical task) is
//     an illustrative mention, not a prereq declaration. stripCode removes fenced blocks + inline
//     backtick spans before wikilink matching.
//   - A prereq keyword ALONE is not enough — the paragraph must ALSO carry a wikilink to an EXISTING
//     task file (a broken link is a different defect, not a prereq claim).
//   - "依赖" alone is deliberately NOT in the keyword set (a "无代码依赖 / no code dependency" mention
//     would false-fire); only gating constructions qualify.
const PREREQ_KEYWORD_RE =
  /前置|depends?\s+on|depends_on|do\s+not\s+dispatch|勿派|不得派发|不得派|禁止派发|先决|前序|声明依赖|依赖前序|先落地|先完成|先跑/i;
const WIKILINK_RE = /\[\[([A-Za-z0-9][A-Za-z0-9-]*)(?:[#|][^\]]*)?\]\]/g;

/** Strip fenced code blocks (```…``` / ~~~…~~~) and inline backtick spans (`…`) so a QUOTED wikilink
 *  inside code is not read as a prereq declaration. Fences are removed before inline spans (an inline
 *  backtick can appear inside a fence). */
export function stripCodeSpans(text) {
  const noFence = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ");
  return noFence.replace(/`[^`\n]*`/g, " ");
}

/** The task's declared relation-edge set — parent + children + depends_on (the fields every
 *  dependency mechanism reads). A prereq written into ANY of these is mechanism-visible. */
export function relationEdges(frontmatterRaw) {
  const edges = new Set();
  const parent = readFrontField(frontmatterRaw, "parent");
  if (parent && parent !== "null" && parent !== "~") edges.add(parent);
  for (const c of readChildren(frontmatterRaw)) edges.add(c);
  for (const d of readDependsOn(frontmatterRaw)) edges.add(d);
  return edges;
}

/** Task ids referenced as wikilinks inside prereq-declaration paragraphs of the body (code spans
 *  stripped; only ids that resolve to an existing task file). */
export function prosePrereqRefs(body, tasksDir) {
  const refs = new Set();
  const clean = stripCodeSpans(body);
  for (const para of clean.split(/\r?\n\s*\r?\n/)) {
    if (!PREREQ_KEYWORD_RE.test(para)) continue;
    for (const m of para.matchAll(WIKILINK_RE)) {
      const id = m[1];
      if (fs.existsSync(path.join(tasksDir, `${id}.md`))) refs.add(id);
    }
  }
  return [...refs];
}

/** Prose-declared prerequisites that are NOT expressed as a relation edge. Empty array = no gap (all
 *  prose-declared prereqs are also edges, or there are none). A non-empty result is the fail-closed
 *  signal: this task declares a prerequisite the mechanisms cannot see. */
export function prosePrereqGap(body, frontmatterRaw, tasksDir) {
  const refs = prosePrereqRefs(body, tasksDir);
  if (refs.length === 0) return [];
  const edges = relationEdges(frontmatterRaw);
  return refs.filter((r) => !edges.has(r));
}

/** Mechanical strategic-traceability grep: does the body reference a written strategic question
 *  (the orchestration/ strategic-doc naming convention — FINDING-, SYNTHESIS-, SPEC-, or
 *  REVIEW-cadence)? */
export function strategicTraceable(body) {
  return STRATEGIC_REF_RE.test(body);
}

/** Declared Touches scale — { hasSection, count }. No Touches section = unknown scope (high cost). */
export function touchesScale(body) {
  const { hasSection, globs } = parseTouches(body);
  return { hasSection, count: globs.length };
}

/** The composite relevance signal for one task. All inputs mechanical (grep / frontmatter fields /
 *  touches count) — no human scoring. `childrenByTask` / `parentRefCount` are precomputed once per
 *  analyzeTasks call (blocking needs to know if ANY other task names this id as its parent).
 *  `suiteBlockingIds` (a Set of task ids, optional) is the consecutive-red-window signal
 *  (gap-ready-relevance-blind-to-suite-blocking-signal AC2): a task implicated in the current
 *  suite-blocking window gets `blocking` flipped true, `blocking_suite` true, and a value bonus
 *  (SUITE_BLOCKING_WEIGHT) so it jumps the dispatch queue. */
export function computeRelevance(id, task, childrenByTask = new Map(), parentRefCount = new Map(), suiteBlockingIds = null) {
  const strategic = strategicTraceable(task.body);
  const children = childrenByTask.get(id) || [];
  const suiteBlocking = suiteBlockingIds ? suiteBlockingIds.has(id) : false;
  const blocking = children.length > 0 || (parentRefCount.get(id) || 0) > 0 || suiteBlocking;
  const { hasSection, count } = touchesScale(task.body);
  const cost = hasSection ? count : 0;
  const costBenefit = hasSection && count > 0 ? Math.min(1, 1 / count) : 0;
  const value = (strategic ? STRATEGIC_WEIGHT : 0) + (blocking ? BLOCKING_WEIGHT : 0) + (suiteBlocking ? SUITE_BLOCKING_WEIGHT : 0) + costBenefit;
  const v = Number(value.toFixed(3));
  return {
    id,
    strategic,
    blocking,
    blocking_suite: suiteBlocking,
    cost,
    value: v,
    reason:
      `value ${v} · strategic ${strategic ? "Y" : "N"} · ` +
      `blocking ${blocking ? `Y(${children.length} ${children.length === 1 ? "child" : "children"})` : "N"} · ` +
      `suite-blocking ${suiteBlocking ? "Y" : "N"} · ` +
      `cost ${cost} touch${cost === 1 ? "" : "es"}`,
  };
}

// ── Consecutive-red-window reader (gap-ready-relevance-blind-to-suite-blocking-signal AC2/AC4) ──────
// Best-effort JSONL parse of the .quay ledgers the outer's full-suite runner already writes. Absent
// file / corrupt line ⇒ skip (an absent ledger = no suite history = no suite-blocking signal), the
// same fail-open family as trend-check.ts's readJsonLines.

/** Parse a JSONL file into objects, skipping blank lines and unparseable rows (best-effort). */
export function readJsonLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // skip a corrupt line — never let one bad row hide the rest of the history
    }
  }
  return rows;
}

/** Read <root>/.quay/verification-round.jsonl — one row per full-suite run. Absent ⇒ []. */
export function readVerificationRounds(root) {
  return readJsonLines(path.join(root, ".quay", "verification-round.jsonl"));
}

/** Read <root>/.quay/full-suite-state.json's failures[] — the LATEST run's failure detail
 *  ({file,line}[]). Absent/unparseable/no failures ⇒ []. */
export function readStateFailures(root) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(root, ".quay", "full-suite-state.json"), "utf8"));
    return Array.isArray(st && st.failures) ? st.failures : [];
  } catch {
    return [];
  }
}

/** Classify one verification-round row as RED (suite not green). Canonical rows carry `state`
 *  ("red"|"green"); legacy rows (the appendSuiteDurationRecord shape) carry only pass/fail. An
 *  aborted round (state:red, reason:aborted) is STILL red — the suite is not green — so it does NOT
 *  break the consecutive window (the manager's own reading counts round-192/193/195/196 as
 *  consecutive red with round-194 aborted in between); it just contributes no failure attribution. */
export function isRedRound(r) {
  if (!r) return false;
  if (r.state === "red") return true;
  if ((r.state === undefined || r.state === null) && Number(r.fail) > 0) return true;
  return false;
}

/** Count consecutive RED rounds at the END of the round history (last row backwards). A green round
 *  breaks the window; an aborted round is still red (does not break it). */
export function consecutiveRedRounds(rounds) {
  let n = 0;
  for (let i = rounds.length - 1; i >= 0; i--) {
    if (isRedRound(rounds[i])) n++;
    else break;
  }
  return n;
}

/** gap-suite-blocking-experiment-rounds-count-toward-consecutive-red AC2 — is a verification-round a
 *  one-off CONTROLLED-EXPERIMENT round (excluded from the consecutive-red count)? Mechanically
 *  identifiable by a NON-DEFAULT laneCount: the default lane is nproc-derived (full-suite-runner's
 *  defaultLaneCount — a lane-8 comparison vs the 4-lane default on this box is a probe, not a
 *  regression). A round with NO laneCount field (legacy rows) is NOT an experiment round — only an
 *  EXPLICIT non-default laneCount marks one, so existing/legacy rounds keep counting normally. */
export function isExperimentRound(r, defaultLane) {
  if (!r) return false;
  if (r.laneCount === undefined || r.laneCount === null) return false;
  const lane = Number(r.laneCount);
  const def = Number(defaultLane);
  return Number.isFinite(lane) && Number.isFinite(def) && lane !== def;
}

/** Collect the failure-file set implicated by a set of red rounds + the state file's failures.
 *  A round may carry its own `failures` array (fixture / the round-record writer — gap-suite-round-
 *  record-missing-failures-field AC2 now writes failures[] into red round records); the state file's
 *  failures[] is the production source for the LATEST red run. Files are repo-relative paths. */
export function collectFailureFiles(rounds, stateFailures) {
  const out = new Set();
  for (const r of rounds) {
    if (Array.isArray(r && r.failures)) {
      for (const f of r.failures) if (f && f.file) out.add(String(f.file));
    }
  }
  for (const f of stateFailures || []) if (f && f.file) out.add(String(f.file));
  return [...out];
}

/** gap-suite-blocking-directory-glob-overbroad AC2 — is `glob` a DIRECTORY glob (a bare directory
 *  such as `plugin/test/` — with or without the trailing slash — or an explicit `dir/**`)? A
 *  directory glob expands to EVERY file under the directory, so matching it against a failure FILE
 *  over-attributes: a task whose `## Touches` merely names a directory (e.g. `plugin/test/`) becomes
 *  a suite-blocker for ANY failure inside it. Only FILE-SCOPED globs — a concrete path like
 *  `plugin/test/checker-cost.test.mjs`, or a wildcard that targets files like
 *  `plugin/test/*.test.mjs` — are attributable.
 *
 *  A glob is directory-shaped when, after stripping a trailing `/**` (the DIR-106 directory form that
 *  parseTouches appends to trailing-slash entries) or a trailing `/`, the remainder carries no
 *  wildcard and its basename has no file extension. (A bare extensionless FILE such as `Makefile` is
 *  mis-classified directory-shaped too, but failure files are test files with extensions — an
 *  extensionless path never appears in the failure list, so that false positive is harmless.)
 */
export function isDirectoryGlob(glob) {
  const g = String(glob);
  if (/^[*?]+$/.test(g)) return true; // all-wildcard glob matches every file — directory-like
  const m = g.match(/^(.*?)\/\*\*\/?$/);
  const prefix = (m ? m[1] : g).replace(/\/+$/, "");
  if (/[*?]/.test(prefix)) return false;
  const base = prefix.split("/").pop() || "";
  return !base.includes(".");
}

/**
 * gap-suite-round-record-missing-failures-field AC3 — does a failure FILE match a task's expanded
 * declared-Touches path set? The failure-file shape is INCONSISTENT across rounds (round-210 bare
 * basename `send-keys-verified.sh` vs round-212 repo-relative `plugin/scripts/send-keys-verified.sh`),
 * so the attribution reverse-lookup must normalize BOTH forms when matching against Touches:
 *   - an EXACT repo-relative match always counts (the canonical round-212 form);
 *   - a BARE BASENAME (no `/`) also matches any declared touch whose basename equals it (the
 *     round-210 form — a bare basename carries no directory, so only the basename is comparable);
 *   - a declared touch that is itself a bare basename likewise matches a full-path failure file;
 *   - two FULL repo-relative paths that share only a basename (a/foo.ts vs b/foo.ts) do NOT match —
 *     a full path already carries the directory, so the exact comparison is the fair one (no
 *     over-attribution across directories).
 */
function failureFileMatches(declared, file) {
  if (declared.has(file)) return true;
  const fileStr = String(file);
  const fileBase = fileStr.split("/").pop();
  const fileBare = !fileStr.includes("/");
  if (!fileBase) return false;
  for (const d of declared) {
    if (d === file) return true;
    const dStr = String(d);
    // SHAPE CONSTRAINT (gap-suite-blocking-directory-glob-overbroad AC2): a DIRECTORY-SHAPED
    // declared entry (a bare directory token — e.g. `plugin/test` — whose basename carries no file
    // extension) is not a FILE, so it must never attribute a failure FILE through the basename
    // reverse-lookup. Without this guard, a failure file whose basename happens to equal a directory
    // name (e.g. a bare `test`) would pull in every task that touches a directory of that name.
    // Concrete file paths (extension-bearing) and file-scoped wildcards are unaffected.
    if (isDirectoryGlob(dStr)) continue;
    if (fileBare || !dStr.includes("/")) {
      if (dStr.split("/").pop() === fileBase) return true;
    }
  }
  return false;
}

// gap-suite-blocking-self-lock-blocks-fix-family — suite-fix task exemption (AC2). A task whose
// PURPOSE is the suite is exactly the task that must dispatch when the suite is red — blocking it is
// the self-lock (.halt 裁定同型: 停派发好让 outer 修红是死锁，修红要靠派发). The marker set is deliberately
// conservative so the exemption cannot reverse-release an unrelated task (AC3):
//   - fix        whole word only — "fixture" (the label every fixture carries) is NOT a fix-intent;
//   - red        whole word only — reduce/redesign/redundant are not "the suite is red";
//   - 修 / 红     the Chinese fix/red intent chars;
//   - install    prefix boundary — installation/installer/reinstall are all install-family;
//   - suite      prefix boundary — suites/suite-blocking/full-suite are all suite-family.
// The family the self-lock actually hit — gap-install-family / gap-serial-phase-install /
// gap-suite-* — all carry these markers in their task id.
const SUITE_FIX_MARKER_RE = /(\bfix(?:e[ds]|ing)?\b|\binstall|\bsuite|修|红|\bred\b)/i;
// Proposal arm is NARROWER than the id/title arm (AC3 reverse control): a bare marker in a Proposal
// is not intent — a Proposal that merely MENTIONS the suite ("nothing to do with the suite", "the
// suite is red, diagnose separately") must NOT exempt an unrelated task. The Proposal exempts only
// on FIX-INTENT CO-OCCURRENCE: a fix marker (fix/修/red/红) and a suite reference (install/suite)
// both present — the "I am here to fix the suite" phrasing, in either order.
const SUITE_FIX_PROPOSAL_RE = /(?:\bfix(?:e[ds]|ing)?\b|修|\bred\b|红)[\s\S]*?(?:\binstall|\bsuite)|(?:\binstall|\bsuite)[\s\S]*?(?:\bfix(?:e[ds]|ing)?\b|修|\bred\b|红)/i;

/** True when a task self-identifies as a suite-fix task. TWO arms:
 *   (1) id/frontmatter-title carries a suite-fix marker (install/suite/fix/red/修/红) — a strong
 *       intent signal (the self-lock family gap-install-family / gap-serial-phase-install /
 *       gap-suite-* all carry install/suite in the id);
 *   (2) the ## Proposal carries FIX-INTENT CO-OCCURRENCE (fix/修/red/红 AND install/suite together) —
 *       "fix the install-family suite flake" exempts, but "nothing to do with the suite" does NOT.
 * Such a task IS the one that must dispatch when the suite is red, so it is exempt from
 * suite_blocking attribution (the self-lock break, AC2). A task failing BOTH arms is an unrelated
 * task touching a failing file — it stays suite-blocked (AC3 reverse control). */
export function isSuiteFixTask(task, id) {
  const idStr = String(id || (task && task.id) || "");
  const fm = (task && task.frontmatterRaw) || "";
  if (SUITE_FIX_MARKER_RE.test(`${idStr} ${fm}`)) return true;
  const proposal = extractSection((task && task.body) || "", "Proposal") || "";
  return SUITE_FIX_PROPOSAL_RE.test(proposal);
}

/** gap-suite-blocking-self-lock-blocks-fix-family AC3 (反向控制) — the exemption is a TWO-condition
 *  AND: a task is exempt from suite_blocking ONLY when it is a suite-fix task (isSuiteFixTask) AND
 *  its declared Touches really hit a failing file (failureHit). Neither half alone exempts — a
 *  non-suite-fix task touching a failing file stays blocked, and a suite-fix task whose Touches do
 *  NOT intersect THIS red window is not the one fixing it and stays blocked too. Encoded as one
 *  exported predicate so the reverse control is mechanically testable (a marker alone can never
 *  release an unrelated task). */
export function exemptFromSuiteBlocking(task, id, failureHit) {
  return Boolean(failureHit) && isSuiteFixTask(task, id);
}

/** Compute the suite-blocking signal for the whole task store.
 *  @param {object} i
 *  @param {Array<object>} i.rounds         verification-round.jsonl rows
 *  @param {Array<object>} i.stateFailures  full-suite-state.json failures[]
 *  @param {Map<string,object>} i.tasks     id → task ({body})
 *  @param {number} [i.minRedWindow]        consecutive red rounds required (default RED_WINDOW_MIN_DEFAULT)
 *  @param {(globs:string[])=>Set<string>} i.expand  declared-Touches expander (fs-backed in prod)
 *  @param {number} [i.defaultLane]         the nproc-derived DEFAULT laneCount (default: full-suite-
 *                                          runner's defaultLaneCount()); rounds with a laneCount ≠ this
 *                                          are CONTROLLED-EXPERIMENT rounds, excluded from the
 *                                          consecutive-red count (AC2 — gap-suite-blocking-experiment-
 *                                          rounds-count-toward-consecutive-red). Injectable for hermetic
 *                                          tests.
 *  @returns {{ ids:Set<string>, consecutiveRed:number, windowActive:boolean, failureFiles:string[] }}
 *  A task is suite-blocking when the window is active AND one of its declared ## Touches expands to
 *  one of the window's failure files. Only dispatchable-status tasks (ready/todo) are candidates — a
 *  done task's work has already landed, so it is never re-prioritized. Negative control (AC4): no
 *  window OR no failure hit ⇒ ids empty. AC2 exemption (gap-suite-blocking-self-lock-blocks-fix-
 *  family): a SUITE-FIX task (isSuiteFixTask — id/title/Proposal carries install/suite/fix/red/修/红)
 *  whose Touches hit a failing file is exactly the one dispatched to fix the red, so it is NOT added
 *  (blocking it is the self-lock). Reverse control (AC3): a non-suite-fix task touching a failing
 *  file carries no marker and stays in ids. */
export function computeSuiteBlocking({ rounds, stateFailures, tasks, minRedWindow = RED_WINDOW_MIN_DEFAULT, expand, defaultLane = defaultLaneCount() }) {
  // gap-suite-blocking-experiment-rounds-count-toward-consecutive-red AC2: a one-off CONTROLLED-
  // EXPERIMENT round (laneCount ≠ nproc-derived default) is an experiment finding, not a regression —
  // it must not push the consecutive-red window. Skip such rounds ENTIRELY (count AND failure
  // attribution): their red stays recorded in the round record itself (state/reason preserved), it
  // just does not drive suite-blocking. `defaultLane` is injectable so tests are hermetic (they pass
  // an explicit default rather than depending on the host nproc).
  const realRounds = rounds.filter((r) => !isExperimentRound(r, defaultLane));
  const consecutiveRed = consecutiveRedRounds(realRounds);
  if (consecutiveRed < minRedWindow) {
    return { ids: new Set(), consecutiveRed, windowActive: false, failureFiles: [] };
  }
  const failureFiles = collectFailureFiles(realRounds, stateFailures);
  if (failureFiles.length === 0) {
    return { ids: new Set(), consecutiveRed, windowActive: true, failureFiles: [] };
  }
  const ids = new Set();
  for (const [id, task] of tasks) {
    if (task.status !== "ready" && task.status !== "todo") continue;
    const parsed = parseTouches(task.body);
    if (!parsed.hasSection || parsed.globs.length === 0) continue;
    // gap-suite-blocking-directory-glob-overbroad AC2 — a DIRECTORY glob (a bare directory like
    // `plugin/test/`, which parseTouches turns into `plugin/test/**`) expands to every file under
    // the directory, so it would attribute the task as the suite-blocker for ANY failure in that
    // directory. Directory globs do NOT attribute: only FILE-SCOPED globs (concrete paths or
    // wildcards that target files) are expanded and matched against failure files.
    const fileGlobs = parsed.globs.filter((g) => !isDirectoryGlob(g));
    if (fileGlobs.length === 0) continue;
    const declared = expand(fileGlobs);
    // AC3 — match with the shape-normalizing comparator (bare basename AND repo-relative failure
    // files both resolve against declared Touches; see failureFileMatches).
    let failureHit = false;
    for (const f of failureFiles) {
      if (failureFileMatches(declared, f)) { failureHit = true; break; }
    }
    if (!failureHit) continue;
    // AC2/AC3 (gap-suite-blocking-self-lock-blocks-fix-family): a suite-fix task is the very one that
    // must dispatch when the suite is red — exempt it; an unrelated task (no marker) stays blocked.
    if (exemptFromSuiteBlocking(task, id, failureHit)) continue;
    ids.add(id);
  }
  return { ids, consecutiveRed, windowActive: true, failureFiles };
}

/** COMPOUND AGGREGATION (gap-compound-depsreadyfor-structural-deadlock AC2): true when the task's
 *  frontmatter declares `role: compound`. A compound parent is an AGGREGATE — the parent IS the sum
 *  of its children (children are the parent's implementation, not its successors) — so the
 *  parent→child relation is a DECOMPOSITION edge, never a prerequisite a child waits on. Exported so
 *  the slot-refill compound gate shares the SAME judgment (rule: reuse, no parallel copy). A missing
 *  task / absent `role` ⇒ not compound (fail closed toward the conservative parent-edge behavior). */
export function isCompoundTask(task) {
  if (!task || !task.frontmatterRaw) return false;
  return readFrontField(task.frontmatterRaw, "role") === "compound";
}

function depsReadyFor(task, allTasks) {
  // ALL prerequisites — parent AND every depends_on entry (gap-prerequisite-gates-prose-invisible-
  // to-mechanisms AC2: prereqs live in relation edges and the author→ready gate reads the SAME field
  // the dispatch check reads). Each must be done; a missing file fails closed.
  const deps = [];
  const parent = task.parent;
  if (parent && parent !== "null" && parent !== "~") {
    // COMPOUND AGGREGATION (gap-compound-depsreadyfor-structural-deadlock AC2): a `role: compound`
    // parent is an AGGREGATE — the parent is only `done` once ALL its children are done
    // (parent-done-iff-children, DIR-026), so a child waiting on its compound parent is the
    // 双向互等 structural deadlock (child waits on parent, parent waits on children). The
    // compound-parent edge is EXCLUDED from a child's deps — children dispatch on their own
    // `depends_on` (true predecessor) edges alone. A missing or non-compound parent still pushes the
    // edge and fails closed below (parent cannot be confirmed done).
    if (!isCompoundTask(allTasks.get(parent))) deps.push(parent);
  }
  for (const d of readDependsOn(task.frontmatterRaw)) deps.push(d);
  if (deps.length === 0) return true;
  for (const depId of deps) {
    const p = allTasks.get(depId);
    // Parent/dep file missing → cannot confirm done → fail closed (conservative, not dispatchable).
    if (!p) return false;
    if (p.status !== "done") return false;
  }
  return true;
}

/** Largest subset of `parsed` (an array of parseTouches results) whose members are pairwise
 *  touches-disjoint (checkTouchesPair disjoint, via the injected `expand`). Exact maximum
 *  independent set on the conflict graph — a pair conflicts when checkTouchesPair returns
 *  disjoint:false, INCLUDING the conservative no/empty/overbroad-Touches and empty-expansion cases
 *  (a task that declares no usable Touches collides with everything, which is correct: it is not
 *  safely batchable with anyone). Pools are small (≤ ~30); include-first branch-and-bound with the
 *  `size + (n - idx)` bound is exact and fast. */
export function maxMutuallyDisjointSubset(parsed, expand) {
  const n = parsed.length;
  if (n === 0) return 0;
  const conflict = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = checkTouchesPair(parsed[i], parsed[j], expand);
      const c = !r.disjoint;
      conflict[i][j] = c;
      conflict[j][i] = c;
    }
  }
  const inSet = new Array(n).fill(false);
  let best = 0;
  const rec = (idx, size) => {
    // Even adding every remaining vertex can't beat the incumbent → prune.
    if (size + (n - idx) <= best) return;
    if (idx === n) { best = size; return; }
    // Include idx when none of its (already-decided) neighbors is in the set.
    let ok = true;
    for (let j = 0; j < idx; j++) if (inSet[j] && conflict[idx][j]) { ok = false; break; }
    if (ok) {
      inSet[idx] = true;
      rec(idx + 1, size + 1);
      inSet[idx] = false;
    }
    rec(idx + 1, size);
  };
  rec(0, 0);
  return best;
}

function buildCandidate(id, task, root, allTasks, poolParsed, inFlightParsed, expand, childrenByTask = new Map(), parentRefCount = new Map()) {
  const kind = classifyKind(id);
  const touches = checkTaskTouchesResolve(task.body, root);
  const touchesResolve = !touches.majorityMissing;
  const depsReady = depsReadyFor(task, allTasks);
  const four = artifactsComplete(task.body);
  const parsed = parseTouches(task.body);
  // RETIRED-MECHANISM INTERCEPT (AC1/AC2 — gap-ready-pool-promotion-ignores-retired-mechanism-
  // candidate-check): before a todo candidate is promotion-eligible, judge it with the same
  // pool-candidate stale check the strategic-doc-staleness-check CLI exposes (--pool-candidate <id>,
  // review-cadence AC8). An unannotated reference to an ADR-022-deleted classic-pipeline script
  // (prepare-milestone.js / execute-milestone.js / milestone-worktree.ts) ⇒ the candidate targets a
  // RETIRED mechanism ⇒ never eligible (AC2: gap-prepare-milestone-no-size-aware-routing must be
  // intercepted, not promoted).
  const staleRefs = judgePoolCandidate(root, id); // null when tasks/<id>.md is missing — not a live candidate
  const retiredMechanism = staleRefs !== null && staleRefs.length > 0;
  // SUPERSEDED GUARD (2026-08-11, outer retreat of gap-send-keys-verified): a task whose body carries
  // the `**SUPERSEDED**` marker (implementation premise deleted by a human ruling) must never be
  // promoted to ready — the outer retreats such a task to todo, and a promotion mechanism that does
  // not read the marker silently re-promotes it (dispatchable_disjoint stays a false reading).
  // Same principle as retiredMechanism: the marker is the mechanism's signal, not a verdict to waive.
  const superseded = /SUPERSEDED/i.test(task.body);
  // AC1 (gap-delivery-critical-label-at-promote-not-after-dispatch): the candidate's delivery-critical
  // status, read from its OWN frontmatter labels (parseTask — the SAME single source the dispatch
  // sort reads via parseCandidate in concurrent-batch-scheduler.ts). The promote gate determines it
  // AT PROMOTE so the label can be written together with ready ("标签与 ready 同现") — see
  // setTaskStatus/applyPromotions. A candidate with no frontmatter / no such label ⇒ false
  // (conservative default, matching the dispatch side).
  const deliveryCritical = (task.labels || []).includes("delivery-critical");
  // PROSE-PREREQUISITE GAP (gap-prerequisite-gates-prose-invisible-to-mechanisms AC3): a candidate
  // whose body declares a prerequisite in prose WITHOUT a corresponding relation edge must NOT be
  // promoted to ready — it would enter the ready pool with a dependency no mechanism can see.
  const prosePrereqGapIds = prosePrereqGap(task.body, task.frontmatterRaw, path.join(root, "tasks"));
  // Touch-disjointness score: how many of the already-pooled ready tasks + in-flight tasks this
  // candidate is pairwise touches-DISJOINT from (checkTouchesPair, the real dispatch judge). Higher
  // = promotes into a pool that stays dispatchable-disjoint (AC4 — disjointness ranks FIRST).
  let disjointScore = 0;
  for (const p of poolParsed) if (checkTouchesPair(parsed, p.touches, expand).disjoint) disjointScore++;
  for (const p of inFlightParsed) if (checkTouchesPair(parsed, p.touches, expand).disjoint) disjointScore++;
  return {
    id,
    kind,
    kindOrder: kindOrder(kind),
    touchesResolve,
    depsReady,
    fourArtifacts: four.complete,
    missingArtifacts: four.missing,
    disjointScore,
    // AC1 (gap-delivery-critical-label-at-promote-not-after-dispatch): the delivery-critical
    // determination — consumed by applyPromotions so the label is written AT PROMOTE (标签与 ready
    // 同现). Same frontmatter-labels source the dispatch sort reads.
    deliveryCritical,
    // AC1 (gap-value-prioritization-has-no-mechanism): every candidate carries the relevance signal —
    // strategic traceability (grep) + blocking (parent/children fields) + cost (touches parsed scale).
    relevance: computeRelevance(id, task, childrenByTask, parentRefCount),
    // AC1/AC2: the retired-mechanism guard — a candidate that references an ADR-022-deleted script
    // is never eligible (the intercept reason is mechanically carried for the `intercepted` output).
    retiredMechanism,
    retiredRefs: staleRefs !== null ? staleRefs : [],
    // SUPERSEDED guard — a task whose body carries the SUPERSEDED marker is never
    // promotion-eligible (outer retreat + mechanism would re-promote it otherwise).
    superseded,
    // PROSE-PREREQUISITE GAP (AC3): prose-declared prereqs with no relation edge — never eligible.
    prosePrereqGap: prosePrereqGapIds,
    // AC5: the touchesResolve guard is KEPT — majority-missing candidates are never eligible.
    // AC1: the retired-mechanism guard is ADDED — a candidate targeting a retired pipeline mechanism
    // is never eligible either.
    // AC3: the prose-prereq-no-edge guard is ADDED — a candidate whose prose prereqs have no relation
    // edge is never eligible (promotion would put an invisible dependency into the ready pool).
    // SUPERSEDED guard (2026-08-11): a candidate carrying the SUPERSEDED marker is never eligible —
    // its implementation premise is deleted by a human ruling (gap-send-keys-verified retreat).
    eligible: depsReady && four.complete && touchesResolve && !retiredMechanism && !superseded && prosePrereqGapIds.length === 0,
  };
}

/** TARGETED PROMOTION (gap-targeted-promotion-operation-does-not-exist): the OUTER picks a task per
 *  stage goal; this function MECHANICALLY validates it and emits the promote command. It is the
 *  floor-INDEPENDENT second operation — NEVER gated on `pool < floor` (AC2). The identity of the
 *  target is the outer's selection (the checker carries no stage-goal input, AC3); the checker only
 *  answers "is this task mechanically promotable, and what command promotes it". `task` is
 *  `undefined` when the id is not in the store → found:false. */
export function buildTargetedPromotion(id, task, root, allTasks) {
  if (!task) {
    return { id, found: false, eligible: false, floor_independent: true, reason: "task-not-found" };
  }
  if (task.status !== "todo") {
    return {
      id,
      found: true,
      status: task.status,
      eligible: false,
      floor_independent: true,
      reason: `status-${task.status}`, // already at/above ready — nothing to promote
    };
  }
  if (isFixture(task)) {
    return { id, found: true, status: task.status, eligible: false, floor_independent: true, reason: "fixture" };
  }
  if (isParked(task)) {
    return { id, found: true, status: task.status, eligible: false, floor_independent: true, reason: "parked" };
  }
  // SUPERSEDED GUARD (gap-judgepoolcandidate-keyword-vs-position, 2026-08-12): the TARGETED path
  // previously never read the **SUPERSEDED** marker — buildCandidate's comment warns "a promotion
  // mechanism that does not read the marker silently re-promotes it", and targeted was exactly that
  // (bulk reads it at buildCandidate). A task whose implementation premise is deleted by a human
  // ruling must not be promoted by an outer stage-goal selection either — a task like
  // gap-split-decision-finality-not-enforced (superseded 2026-08-12) would otherwise become
  // targeted-promotable once its backticked retired-script mentions are correctly read as quotes.
  if (/SUPERSEDED/i.test(task.body)) {
    return {
      id,
      found: true,
      status: task.status,
      eligible: false,
      floor_independent: true,
      reason: `superseded: ${id} carries the SUPERSEDED marker (premise deleted by a human ruling) — not promotable`,
      checks: { superseded: true },
    };
  }
  // RETIRED-MECHANISM INTERCEPT (gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check):
  // the same pool-candidate stale check gates TARGETED promotion too — an outer stage-goal selection
  // must not promote a candidate that references an ADR-022-deleted classic-pipeline script.
  const staleRefs = judgePoolCandidate(root, id);
  if (staleRefs !== null && staleRefs.length > 0) {
    const hits = staleRefs.map((r) => r.hit).join(", ");
    return {
      id,
      found: true,
      status: task.status,
      eligible: false,
      floor_independent: true,
      reason: `retired-mechanism: ${id} references ADR-022-deleted script(s) ${hits} — not promotable`,
      checks: { retiredMechanism: true, retiredRefs: staleRefs },
    };
  }
  const four = artifactsComplete(task.body);
  const depsReady = depsReadyFor(task, allTasks);
  const touches = checkTaskTouchesResolve(task.body, root);
  const touchesResolve = !touches.majorityMissing;
  // PROSE-PREREQUISITE GAP (AC3): targeted promotion must NOT advance a task whose prose-declared
  // prereqs have no relation edge — same fail-closed as the bulk path.
  const prosePrereqGapIds = prosePrereqGap(task.body, task.frontmatterRaw, path.join(root, "tasks"));
  const eligible = four.complete && depsReady && touchesResolve && prosePrereqGapIds.length === 0;
  const checks = {
    fourArtifacts: four.complete,
    missingArtifacts: four.missing,
    depsReady,
    touchesResolve,
    prosePrereqGap: prosePrereqGapIds,
    notFixture: true,
    notParked: true,
    superseded: false,
    retiredMechanism: false,
  };
  return {
    id,
    found: true,
    status: task.status,
    eligible,
    floor_independent: true, // targeted promotion never walks the pool<floor gate (AC2)
    checks,
    promote_cmd: `quay promote ${id}`,
    reason: eligible
      ? `${id}: targeted promotion (outer stage-goal selection) — mechanically eligible; run \`quay promote ${id}\``
      : `${id}: not eligible · four-artifacts ${four.complete ? "complete" : `missing ${four.missing.join(",")}`} · ` +
        `deps ${depsReady ? "ready" : "NOT-ready"} · touches ${touchesResolve ? "resolve" : "MISSING"} · ` +
        `prose-prereq ${prosePrereqGapIds.length === 0 ? "ok" : `GAP(${prosePrereqGapIds.join(",")})`}`,
  };
}

function buildReport({ pool, floor, cap, floorMult, dispatchableDisjoint, criterionMet, poolBigAllColliding, deficit, landingBlocked, landingReason }) {
  let s = `pool ${pool}/${floor} (floor = cap(${cap}) × ${floorMult}) · dispatchable_disjoint ${dispatchableDisjoint}/${cap}`;
  s += criterionMet
    ? " — criterion met (≥cap mutually-disjoint candidates)"
    : " — criterion NOT met (<cap mutually-disjoint candidates)";
  if (poolBigAllColliding) s += " · POOL BIG BUT ALL COLLIDING (pool ≥ floor yet dispatchable_disjoint < cap)";
  // LANDING-BLOCKED (gap-landing-blocked-invisible-to-dispatch-criteria): the landing visibility axis
  // beyond criterion_met — a blocked landing is reported explicitly, never "has candidates = healthy".
  // The lowercase `landing-blocked` literal is the Contract measure's grep surface.
  if (landingBlocked) s += ` · landing-blocked (${landingReason})`;
  if (deficit > 0) s += ` · deficit ${deficit}`;
  return s;
}

/** Analyze a task store. Returns { pool, floor, cap, floorMult, deficit, dispatchable_disjoint,
 *  criterion_met, pool_big_all_colliding, report, ready, excluded, candidates, promotions,
 *  scanned, top_relevance, ready_relevance, closed_but_live, targeted_promotion }. `root` is the repo
 *  root used to resolve `## Touches` existence claims; `tasksDir` defaults to `<root>/tasks`;
 *  `cap`/`floorMult` derive the floor (default 3×4 ⇒ 12); `inFlight` is an optional array of
 *  `{ id, body }` for currently in-flight tasks (ranked against); `closedButLive` is an optional
 *  array of `{ id, body }` for tasks whose telemetry bracket CLOSED but whose executor is still
 *  observably present (gap-closed-bracket-leaves-live-agent-consuming-slots) — they rank in the
 *  in-flight disjointness set and are excluded from ready_relevance; `topN` is the
 *  value-prioritization query size — when > 0 the `top_relevance` array (the highest-value N todo
 *  tasks + reasons, the AC2 "which matters most" answer) is produced; `targetedId` is the
 *  TARGETED-PROMOTION query (gap-targeted-promotion-operation-does-not-exist) — when set, a
 *  `targeted_promotion` result for that one id is produced (floor-INDEPENDENT, AC2), supplemental
 *  to and never altering the bulk `promotions` path (AC3). */
export function analyzeTasks({ tasksDir, root, cap = CONCURRENCY_CAP_DEFAULT, floorMult = POOL_FLOOR_MULT_DEFAULT, floorCap, inFlight = [], closedButLive = [], topN = 0, targetedId = null, develop = "develop", integration = "integration", master = "master", landingStalenessMs = LANDING_STALENESS_MS_DEFAULT, landingBehindThreshold = LANDING_BEHIND_THRESHOLD_DEFAULT, redWindowMin = RED_WINDOW_MIN_DEFAULT, now = Date.now() }) {
  const allTasks = new Map();
  const fileNames = fs.existsSync(tasksDir)
    ? fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"))
    : [];
  for (const f of fileNames) {
    const id = f.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const task = parseTask(raw);
    task.id = id;
    task.status = readFrontField(task.frontmatterRaw, "status") || "";
    task.parent = readFrontField(task.frontmatterRaw, "parent");
    allTasks.set(id, task);
  }

  // Value-prioritization index (built once — blocking needs to know if ANY other task names this id
  // as its parent, so the maps are precomputed here rather than re-scanned per task).
  const childrenByTask = new Map();
  const parentRefCount = new Map();
  for (const [id, t] of allTasks) {
    childrenByTask.set(id, readChildren(t.frontmatterRaw));
    if (t.parent && t.parent !== "null" && t.parent !== "~") {
      parentRefCount.set(t.parent, (parentRefCount.get(t.parent) || 0) + 1);
    }
  }

  // Real ready pool: `status: ready` minus the three non-dispatchable classes.
  // BATCHED git-history (gap-ready-pool-check-times-out-after-git-history-signal): build the
  // master-history path→commit index ONCE for the whole pool scan — ONE `git log` pass instead of
  // ~30-50 per-task `git log -- <paths>` calls (each O(history) — the >150s pool-check timeout).
  const readyCount = [...allTasks.values()].filter((t) => t.status === "ready").length;
  // Landing ref for the git-history signal (gap-git-history-landed-master-stale-under-two-line-model):
  // follow the two-line model's working line — the CONFIGURED integration/develop/master refs
  // (--integration/--develop/--master) resolved to the first that exists, so a stale master no longer
  // misjudges everything landed after it as unlanded. "Config source" = these CLI flags, which the
  // outer loop drives from .quay/config.yml's branch model (gap-quay-init-never-writes-branch-model-config).
  const landRef = landingRef(root, { candidates: [integration, develop, master] });
  const gitIndex = readyCount > 0 ? buildGitHistoryIndex(root, { ref: landRef }) : null;
  // COMMIT-TRACE (gap-nyf-branch-existence-vs-commit-trace): ONE `git log --all` subject pass for the
  // whole pool scan (like buildGitHistoryIndex's batched index — never per-task git calls). Reads
  // `--all` so the two-line model's INTEGRATION fan-in is visible where the stale-master git-history
  // index sees nothing (master..integration=2224 on 2026-08-11).
  const commitTraceSubjects = readyCount > 0 ? buildCommitTraceIndex(root) : [];
  const ready = [];
  const excluded = [];
  let nyfBacklogCount = 0; // 甲 — not-yet-flipped AND every completion checkbox checked (work done, only the status flip missing)
  let nyfContradictionCount = 0; // 乙 — not-yet-flipped AND an open box that is this task's OWN implementation/evidence (judged landed but NOT done — criterion misfire)
  let awaitingVerificationCount = 0; // awaiting-verification — not-yet-flipped AND every open box is annotated （待外部） (work done, legitimately waiting for suite green / outer verification)
  for (const [id, t] of allTasks) {
    if (t.status !== "ready") continue;
    const reasons = [];
    if (isFixture(t)) reasons.push("fixture");
    if (isParked(t)) reasons.push("parked");
    if (isAcRecord(t)) reasons.push("ac-record");
    let acOpen = -1; // sentinel: not a not-yet-flipped exclusion (no ac_open field on the entry)
    let pendingVerification = false;
    const nyf = notYetFlipped(t, root, gitIndex, { ref: landRef, commitTraceSubjects });
    if (nyf) {
      reasons.push("not-yet-flipped");
      // gap-ready-pool-nyf-split-backlog-vs-contradiction (A9 population split): a not-yet-flipped
      // task is 甲/backlog when EVERY completion checkbox the body declares (AC + DoD, shape-aware) is
      // checked (ac_open=0 — work really done, only the fan-in status flip is missing) and
      // 乙/contradiction when an open box is this task's OWN implementation/evidence (ac_open>0 —
      // judged "landed" but the task body says NOT done; ONE such task is a criterion misfire, A9
      // threshold = 1). gap-ready-pool-remaining-external-vs-implementation (human ruling 2026-08-12)
      // adds the THIRD class — awaiting-verification (ac_open>0 but EVERY open box is annotated
      // （待外部） — legitimately waiting for suite green / outer verification, NOT a misfire; this is
      // the task's entry into the awaiting-verification state). The `ac_open` marker rides on the
      // excluded entry so A9 triggers without re-deriving it; the three counters give the report a
      // ready-made split. gap-ready-pool-commit-trace-subject-not-proof-of-done makes the COMMIT-TRACE
      // arm already require all-checked — 乙 through this path is the WORK-LANDED arm's
      // remaining-all-external leniency (real merged-code evidence, gap-ready-pool-worklanded-traps-
      // stuck-work preserved: any open IMPLEMENTATION box keeps the task dispatchable).
      const cb = countCompletionCheckboxes(t.body);
      acOpen = cb.unchecked;
      pendingVerification = cb.uncheckedItems.length > 0 && cb.uncheckedItems.every(isExternalVerificationItem);
      if (acOpen > 0 && !pendingVerification) nyfContradictionCount++;
      else if (acOpen === 0) nyfBacklogCount++;
      else awaitingVerificationCount++;
    }
    // PROSE-PREREQUISITE GAP (gap-prerequisite-gates-prose-invisible-to-mechanisms AC3): a ready task
    // whose body declares a prerequisite in prose WITHOUT a relation edge is NOT dispatchable — it
    // would be dispatched with an invisible dependency and only a subagent reading the body would
    // discover it. Fail-closed at the pool: excluded (never dispatchable until the edge is added).
    // The reason carries the 前置 literal (the Contract measure's grep surface).
    const proseGap = prosePrereqGap(t.body, t.frontmatterRaw, tasksDir);
    if (proseGap.length > 0) reasons.push(`prose-prereq-no-edge (前置无边: ${proseGap.join(",")})`);
    if (reasons.length > 0) excluded.push({ id, reasons, ...(acOpen >= 0 ? { ac_open: acOpen, ...(pendingVerification ? { awaiting_verification: true } : {}) } : {}) });
    else ready.push(id);
  }
  ready.sort();
  excluded.sort((a, b) => a.id.localeCompare(b.id));

  // ── SUITE-BLOCKING signal (gap-ready-relevance-blind-to-suite-blocking-signal AC2/AC3/AC4).
  // Read the consecutive-red window from verification-round.jsonl (+ the latest full-suite-state.json
  // failures[]) and map it onto task ids via declared ## Touches expansion. The ONE tree walk is
  // shared with the dispatchable-disjoint scan below (walk-once, gap-select-preflight-json-real-store-
  // too-slow pattern). Negative control (AC4): no red window / no failure hit ⇒ empty id set ⇒ the
  // relevance ranking below is byte-identical to the pre-signal ordering.
  const sharedFiles = walkFiles(root);
  const expand = (globs) => expandDeclaredTouches(globs, root, sharedFiles);
  const suiteBlocking = computeSuiteBlocking({
    rounds: readVerificationRounds(root),
    stateFailures: readStateFailures(root),
    tasks: allTasks,
    minRedWindow: redWindowMin,
    expand,
  });

  // ── Value-prioritization relevance (AC1/AC2/AC6 — tasks/gap-value-prioritization-has-no-mechanism).
  // todo_relevance: every non-done, non-fixture, non-parked todo ranked by the mechanical value
  // signal — the "which of the N todos matters most" answer. top_relevance = the top-N query slice.
  // ready_relevance: the READY pool ranked by the same signal — the "who to dispatch next" answer
  // (AC6), which the gap-* > DIR-* mechanical tiebreak alone cannot give. Both carry per-entry
  // { strategic, blocking, blocking_suite, cost, value, reason }. Existing promotion order is
  // untouched (AC4).
  const relevanceOf = (id) => computeRelevance(id, allTasks.get(id), childrenByTask, parentRefCount, suiteBlocking.ids);
  const todoRelevance = [...allTasks.values()]
    .filter((t) => t.status === "todo" && !isFixture(t) && !isParked(t))
    .map((t) => relevanceOf(t.id))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  // ready_relevance ranks the ready pool by value — the "who to dispatch next" answer. In-flight ids
  // (the --in-flight param) AND closed-bracket-but-live ids (gap-closed-bracket-leaves-live-agent-
  // consuming-slots — a closed bracket whose executor is still present is NOT dispatchable room) are
  // excluded so the ranking reflects the actually-dispatchable set.
  const inFlightIds = new Set([...(inFlight || []), ...(closedButLive || [])].map((t) => t.id));
  const readyRelevance = ready
    .filter((id) => !inFlightIds.has(id))
    .map(relevanceOf)
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const topRelevance = topN > 0 ? todoRelevance.slice(0, topN) : [];

  const floor = computePoolFloor(cap, floorMult, floorCap);
  const pool = ready.length;
  const deficit = Math.max(0, floor - pool);

  // dispatchable_disjoint — the criterion. The same expander the dispatch gate uses for its
  // pairwise checkTouchesPair: concrete declared paths resolve whether or not they exist, only
  // wildcards hit the filesystem (expandDeclaredTouches, single-source from the batch scheduler).
  // WALK-ONCE (gap-select-preflight-json-real-store-too-slow pattern): the O(n²) pairwise scan
  // would re-walk the whole tree per glob side (190ms × ~146 glob pairs = ~28s on the real store);
  // one shared walkFiles(root) makes the whole scan one walk — shared with the suite-blocking
  // computation above (same `sharedFiles`/`expand`).
  const poolParsed = ready.map((id) => ({ id, touches: parseTouches(allTasks.get(id).body) }));
  // In-flight ranking includes closed-bracket-but-live agents (gap-closed-bracket-leaves-live-agent-
  // consuming-slots): a new dispatch must be pairwise-disjoint from a still-present executor's touches
  // even if its telemetry bracket already closed — bracket-close ≠ agent-exit.
  const inFlightParsed = [...(inFlight || []), ...(closedButLive || [])].map((t) => ({ id: t.id, touches: parseTouches(t.body) }));
  // MERGE-WORKTREE SURFACE (tasks/gap-dispatch-gate-blind-to-inflight-merge-worktree): the
  // dispatchable_disjoint criterion must not count a candidate that collides with an in-flight MERGE
  // worktree's conflict surface — such a candidate is NOT actually dispatchable (its fan-in would
  // collide with the merge), so counting it inflates the dispatchable capacity. A candidate whose
  // touches overlap a merge surface is excluded from the subset count (it stays in pool.ready —
  // slot-refill's per-candidate step-4 check defers it with the explicit merge-worktree reason).
  // Fail-soft: no merge worktree in flight ⇒ the filter is a no-op (dispatchable_disjoint unchanged).
  const mergeSurfaces = computeMergeWorktreeSurfaces(root);
  const dispatchablePoolParsed = poolParsed.filter((p) => !mergeSurfaceBlock(p.touches, mergeSurfaces, expand).blocked);
  const dispatchableDisjoint = maxMutuallyDisjointSubset(dispatchablePoolParsed.map((p) => p.touches), expand);

  const criterionMet = dispatchableDisjoint >= cap;
  // AC3 self-report: pool big (≥ floor) but all colliding (< cap mutually-disjoint) ⇒ the mechanism
  // says so. The inverse (pool < floor but criterion already met) must NOT be reported.
  const poolBigAllColliding = pool >= floor && dispatchableDisjoint < cap;

  // LANDING-BLOCKED (gap-landing-blocked-invisible-to-dispatch-criteria): the landing VISIBILITY axis
  // next to criterion_met. criterion_met answers "≥cap mutually-disjoint candidates" (dispatchable);
  // detectLandingBlocked answers "can that work actually land?" — develop behind master AND the merge
  // target frozen (AC17 catch-up incomplete). Reported, never gating (AC4: normal landing ⇒ false).
  const landing = detectLandingBlocked(root, {
    develop,
    integration,
    master,
    stalenessMs: landingStalenessMs,
    behindThreshold: landingBehindThreshold,
    now,
  });

  // Candidates are only meaningful when promotion pressure exists (pool < floor) — the script's
  // whole job is "recommend promotions to reach the floor". When the pool is already at/above floor
  // the candidate scan is skipped entirely (keeps the real-store output small).
  const candidates = [];
  const promotions = [];
  const intercepted = [];
  if (deficit > 0) {
    for (const [id, t] of allTasks) {
      if (t.status !== "todo") continue;
      if (isFixture(t) || isParked(t)) continue; // never promotion candidates
      candidates.push(buildCandidate(id, t, root, allTasks, poolParsed, inFlightParsed, expand, childrenByTask, parentRefCount));
    }
    // AC4: disjointness FIRST (how many pool/in-flight tasks the candidate is pairwise-disjoint
    // from), then `gap-*` > `DIR-*`, then touches-resolvable before not.
    candidates.sort(
      (a, b) =>
        b.disjointScore - a.disjointScore ||
        a.kindOrder - b.kindOrder ||
        (a.touchesResolve === b.touchesResolve ? 0 : a.touchesResolve ? -1 : 1),
    );
    // AC4 (gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check): the FULL
    // retired-mechanism intercept set is mechanically recorded — every candidate that references an
    // ADR-022-deleted script is listed with reason + refs (not only the ones that happen to sort
    // inside the promotion window). A no-promotion is a traceable decision, never a silent skip.
    for (const c of candidates) {
      if (c.retiredMechanism) {
        intercepted.push({ id: c.id, reason: "retired-mechanism", refs: c.retiredRefs });
      }
    }
    for (const c of candidates) {
      if (promotions.length >= deficit) break;
      if (!c.eligible) continue;
      promotions.push({
        id: c.id,
        disjointScore: c.disjointScore,
        reason:
          `${c.kind}-* candidate · disjoint ${c.disjointScore}/${poolParsed.length + inFlightParsed.length} · ` +
          `deps ${c.depsReady ? "ready" : "NOT-ready"} · ` +
          `touches ${c.touchesResolve ? "resolve" : "MISSING"} · ` +
          `four-artifacts ${c.fourArtifacts ? "complete" : `INCOMPLETE (${c.missingArtifacts.join(",")})`}`,
      });
    }
  }

  // AC2 (gap-value-prioritization-has-no-mechanism): the priority query — "当前 todo 里价值最高的
  // N 条 + 理由", a SEPARATE output from the pool-maintenance `promotions` (which keeps its existing
  // disjointness-first / gap>DIR order — AC4). Scans ALL todo candidates (not gated on deficit>0),
  // ranks by the mechanical relevance signal (strategicTrace > unblocks > cost, score below), then
  // gap>DIR as the final tiebreak (AC4 retained), then id for determinism. Only emitted when the
  // `--top N` flag is passed (default output byte-unchanged for existing consumers).
  const top_relevance = [];
  if (topN > 0) {
    const ranked = [];
    for (const [id, t] of allTasks) {
      if (t.status !== "todo") continue;
      if (isFixture(t) || isParked(t)) continue;
      const c = buildCandidate(id, t, root, allTasks, poolParsed, inFlightParsed, expand, childrenByTask, parentRefCount);
      ranked.push({ id, kind: c.kind, kindOrder: c.kindOrder, relevance: c.relevance, eligible: c.eligible, reason: c.relevance.reason });
    }
    ranked.sort(
      (a, b) =>
        b.relevance.relevanceScore - a.relevance.relevanceScore ||
        a.kindOrder - b.kindOrder ||
        a.id.localeCompare(b.id),
    );
    top_relevance.push(...ranked.slice(0, topN));
  }

  // TARGETED PROMOTION (gap-targeted-promotion-operation-does-not-exist): the outer's stage-goal
  // selection, mechanically validated. NOT gated on `deficit > 0` / `pool < floor` (AC2) — the
  // targeted op is a SEPARATE operation from the bulk refill. Supplemental only: bulk `promotions`
  // and the rest of the output are computed exactly as before (AC3).
  const targeted_promotion = targetedId
    ? { ...buildTargetedPromotion(targetedId, allTasks.get(targetedId), root, allTasks), pool, floor, cap }
    : null;

  return {
    pool,
    floor,
    cap,
    floorMult,
    deficit,
    dispatchable_disjoint: dispatchableDisjoint,
    criterion_met: criterionMet,
    pool_big_all_colliding: poolBigAllColliding,
    landing_blocked: landing.landing_blocked,
    landing_blocked_reason: landing.reason,
    // SUITE-BLOCKING (gap-ready-relevance-blind-to-suite-blocking-signal AC2/AC3): the consecutive-
    // red-window signal — which tasks are currently blocking the full suite (blocking_suite=true in
    // ready_relevance / top_relevance), the window count, and the failure files that implicate them.
    // slot-refill consumes `tasks` to rank the suite-blocker first. A SIGNAL, not a gate.
    suite_blocking: {
      consecutive_red: suiteBlocking.consecutiveRed,
      min_red_window: redWindowMin,
      window_active: suiteBlocking.windowActive,
      failure_files: [...suiteBlocking.failureFiles].sort(),
      tasks: [...suiteBlocking.ids].sort(),
    },
    report: buildReport({ pool, floor, cap, floorMult, dispatchableDisjoint, criterionMet, poolBigAllColliding, deficit, landingBlocked: landing.landing_blocked, landingReason: landing.reason }),
    ready,
    excluded,
    // gap-ready-pool-nyf-split-backlog-vs-contradiction (A9 population split): 甲 = nyf + ac_open 0
    // (work done, only the status flip missing — quantity, threshold ≥floor/2); 乙 = nyf + ac_open>0
    // with an open IMPLEMENTATION box (judged landed but NOT done — criterion misfire, ONE is enough,
    // threshold 1); awaiting_verification = ac_open>0 but EVERY open box is annotated （待外部）
    // (legitimately waiting — the task's entry into the awaiting-verification state, neither 甲 nor
    // 乙). A9 reads these counters + each excluded entry's `ac_open` without re-deriving the count.
    nyf_backlog: nyfBacklogCount,
    nyf_contradiction: nyfContradictionCount,
    awaiting_verification: awaitingVerificationCount,
    candidates,
    promotions,
    intercepted,
    top_relevance,
    scanned: allTasks.size,
    top_relevance: topRelevance,
    ready_relevance: readyRelevance,
    closed_but_live: (closedButLive || []).map((t) => t.id),
    targeted_promotion,
  };
}

// ── HEARTBEAT MODE (gap-ready-pool-promotion-same-class-as-slot-refill) ────────────────────────────
// The tick doc's step 3.6 ("就绪池 < floor ⇒ 本 tick 补晋") was a FORCED prose step whose actual
// execution depended on the inner's volition — the same root cause as slot-refill-only-triggered-on-
// completion-not-tick-heartbeat (a detector that answers, with nothing mechanical guaranteed to ask
// it). `--apply` closes the loop: when pool < floor AND promotions non-empty, the recommended
// promotions land on disk (status todo → ready) as a side effect of the unconditional tick-heartbeat
// invocation — no volition (AC1). The negative control (AC3) is structural: `promotions` is only
// computed when deficit > 0, so pool ≥ floor OR an empty promotions array ⇒ zero writes.

/** Ensure the frontmatter carries the `delivery-critical` label. Mirrors parseTask's label reading
 *  (task-schema.ts — block list OR flow list OR absent), then ADDS the label when missing. This is
 *  the "标签与 ready 同现" write: the promote gate determines delivery-critical at promote time, and
 *  this helper makes the label physically present in the frontmatter AT ready-entry — so the
 *  dispatch-time sort key (slot-refill's deliveryCritical axis, which reads the same labels via
 *  parseTask/parseCandidate) can act on it in the NEXT selection.
 *  @param {string} fm  the frontmatter text between the `---` fences
 *  @returns {{ fm: string, added: boolean, deliveryCritical: boolean }}  `deliveryCritical` is true
 *      when the label is present after the operation (already there, or newly added). */
export function ensureDeliveryCriticalLabel(fm) {
  // flow list: `labels: [a, b]`
  const flow = /^(labels:\s*\[)([^\]]*)(\]\s*)$/m.exec(fm);
  if (flow) {
    const list = flow[2];
    const items = list.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    if (items.includes("delivery-critical")) return { fm, added: false, deliveryCritical: true };
    const sep = list.trim() ? ", " : "";
    return {
      fm: fm.replace(/^(labels:\s*\[)([^\]]*)(\]\s*)$/m, `$1${list}${sep}delivery-critical$3`),
      added: true,
      deliveryCritical: true,
    };
  }
  // block list: `labels:\n  - a\n  - b`
  if (/^labels:\s*$/m.test(fm)) {
    const lines = fm.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^labels:\s*$/.test(l));
    const hasDc = lines.slice(idx + 1).some((l) => /^\s+-\s+["']?delivery-critical["']?\s*$/.test(l));
    if (hasDc) return { fm, added: false, deliveryCritical: true };
    // Insert a new `  - delivery-critical` item at the end of the labels block (before the next
    // top-level key, or at the frontmatter end when labels is the last field).
    let insertAt = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) { insertAt = i; break; }
    }
    lines.splice(insertAt, 0, "  - delivery-critical");
    return { fm: lines.join("\n"), added: true, deliveryCritical: true };
  }
  // No labels field at all — append a block list at the end of the frontmatter (before the closing
  // fence, which the caller owns).
  return { fm: `${fm.replace(/\n*$/, "")}\nlabels:\n  - delivery-critical\n`, added: true, deliveryCritical: true };
}

/** Patch ONE task file's frontmatter `status` line. Only rewrites when the current status is `todo`
 *  (a concurrently-flipped task is left alone — no clobbering a `ready`/`done` written by another
 *  writer). Returns { id, ok, from, to, reason, deliveryCritical }.
 *  @param {string} root  repo root (tasks/<id>.md lives here)
 *  @param {string} id    task id
 *  @param {string} newStatus  target status (ready)
 *  @param {object} [opts]  { ensureDeliveryCritical: boolean } — AC1 (gap-delivery-critical-label-at-
 *      promote-not-after-dispatch): when the promote gate has DETERMINED this candidate is
 *      delivery-critical, the label is written into the frontmatter AT PROMOTE TIME (标签与 ready
 *      同现) so the dispatch sort key can act on it in the NEXT selection.
 */
export function setTaskStatus(root, id, newStatus, opts = {}) {
  const file = path.join(root, "tasks", `${id}.md`);
  if (!fs.existsSync(file)) return { id, ok: false, reason: "missing" };
  const raw = fs.readFileSync(file, "utf8");
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(raw);
  if (!m) return { id, ok: false, reason: "no-frontmatter" };
  const [, open, fm, close] = m;
  const statusLine = /^status:\s*todo\s*$/m.exec(fm);
  if (!statusLine) return { id, ok: false, reason: "not-todo" };
  let newFm = fm.replace(/^status:\s*todo\s*$/m, `status: ${newStatus}`);
  let deliveryCritical = opts.ensureDeliveryCritical === true;
  if (deliveryCritical) {
    const ensured = ensureDeliveryCriticalLabel(newFm);
    newFm = ensured.fm;
    deliveryCritical = ensured.deliveryCritical;
  }
  fs.writeFileSync(file, `${open}${newFm}${close}${raw.slice(m[0].length)}`);
  return { id, ok: true, from: "todo", to: newStatus, deliveryCritical };
}

/** HEARTBEAT MODE entry: run the same analysis as `analyzeTasks` (all options pass through) and —
 *  when pool < floor AND promotions non-empty — land the recommended promotions on disk. Returns the
 *  full analyzeTasks result plus `should_apply` (the AC1 condition) and `applied_promotions` (the
 *  per-candidate setTaskStatus outcome). Purely additive: the default (non-`--apply`) output is
 *  byte-unchanged for existing consumers.
 *
 *  AC1 (gap-delivery-critical-label-at-promote-not-after-dispatch): the delivery-critical label is
 *  DETERMINED AT PROMOTE — each promoted candidate's deliveryCritical status comes from its own
 *  frontmatter labels (the SAME single source the dispatch sort reads via parseCandidate), and the
 *  label is written together with the ready status ("标签与 ready 同现"). Each applied record carries
 *  the determination (`deliveryCritical: true`) so "a delivery-critical task entered the ready pool
 *  with its label in place" is mechanically checkable — the dispatch-time axis is guaranteed in place
 *  for the NEXT selection, instead of being applied (too late) after dispatch. */
export function applyPromotions(opts) {
  const result = analyzeTasks(opts);
  const shouldApply = result.deficit > 0 && result.promotions.length > 0;
  const applied = [];
  if (shouldApply) {
    const candidateById = new Map(result.candidates.map((c) => [c.id, c]));
    for (const p of result.promotions) {
      const cand = candidateById.get(p.id);
      const deliveryCritical = !!(cand && cand.deliveryCritical);
      const out = setTaskStatus(opts.root, p.id, "ready", { ensureDeliveryCritical: deliveryCritical });
      applied.push({ ...out, deliveryCritical });
    }
  }
  return { ...result, should_apply: shouldApply, applied_promotions: applied };
}

function main(argv) {
  let root = null;
  let apply = false;
  let cap = CONCURRENCY_CAP_DEFAULT;
  let floorMult = POOL_FLOOR_MULT_DEFAULT;
  let floorCap = undefined; // gap-ready-pool-floor-tied-to-volatile-cap: when set, floor = max(cap, floorCap)×mult (never drops under load)
  let inFlightIds = [];
  let closedButLiveIds = [];
  let topN = 0;
  let targetedId = null;
  let develop = "develop";
  let integration = "integration";
  let master = "master";
  let landingStalenessMs = LANDING_STALENESS_MS_DEFAULT;
  let landingBehindThreshold = LANDING_BEHIND_THRESHOLD_DEFAULT;
  let redWindowMin = RED_WINDOW_MIN_DEFAULT;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--json") { /* output is always JSON — accepted for Contract parity */ }
    else if (args[i] === "--apply") { apply = true; } // heartbeat mode: land the promotions on disk
    else if (args[i] === "--cap") cap = Number(args[++i]);
    else if (args[i] === "--floor-mult") floorMult = Number(args[++i]);
    else if (args[i] === "--floor-cap") floorCap = Number(args[++i]); // gap-ready-pool-floor-tied-to-volatile-cap: window-max cap for the floor
    else if (args[i] === "--top") topN = Number(args[++i]); // value-prioritization query: top-N todos by relevance
    else if (args[i] === "--targeted") targetedId = String(args[++i] || "").trim() || null; // targeted-promotion query
    else if (args[i] === "--develop") develop = String(args[++i] || "develop");
    else if (args[i] === "--integration") integration = String(args[++i] || "integration");
    else if (args[i] === "--master") master = String(args[++i] || "master");
    else if (args[i] === "--landing-staleness-ms") landingStalenessMs = Number(args[++i]);
    else if (args[i] === "--landing-behind-threshold") landingBehindThreshold = Number(args[++i]);
    else if (args[i] === "--red-window-min") redWindowMin = Number(args[++i]); // suite-blocking consecutive-red threshold (default 3)
    else if (args[i] === "--in-flight") {
      inFlightIds = String(args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === "--closed-but-live") {
      closedButLiveIds = String(args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === "--promote") {
      // gap-ready-pool-unknown-flag-fail-open AC3: `--promote` is NOT a flag here — promote is
      // executed by `quay promote <id>` (the caller reads stdout `targeted_promotion`/`promotions`
      // and runs it). Accepting it as a silent no-op would be the exact fail-open this task kills.
      // Fail closed with the pointer so a typo'd `--promote` never "looks done but isn't".
      console.error("ready-pool-check: --promote is not a flag. Use `quay promote <id>` (or `--targeted <id>` to query, then run quay promote).");
      process.exit(2);
    } else {
      // gap-ready-pool-unknown-flag-fail-open AC2: unknown flag ⇒ fail closed. Before this fix an
      // invented/misspelled flag (e.g. `--this-flag-does-not-exist-xyz`) was silently ignored with a
      // normal JSON + exit 0 — "looks done but isn't" (same family as no-action-zero-cost, 1/4-as-label).
      console.error(`ready-pool-check: unknown flag: ${args[i]} (run with --help for the full flag list)`);
      process.exit(2);
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
  const t0 = Date.now();
  const base = { tasksDir: path.join(rootDir, "tasks"), root: rootDir, cap, floorMult, floorCap, inFlight, closedButLive, topN, targetedId, develop, integration, master, landingStalenessMs, landingBehindThreshold, redWindowMin };
  // HEARTBEAT MODE (gap-ready-pool-promotion-same-class-as-slot-refill): with `--apply`, pool < floor
  // && promotions non-empty ⇒ the recommended promotions are written to disk (status todo → ready) as
  // a side effect of the unconditional tick-heartbeat run. Without it, this stays a pure detector.
  const result = apply ? applyPromotions(base) : analyzeTasks(base);
  if (process.env.CHECKER_COST_SKIP !== "1") {
    recordCheckerCost({ root: rootDir, name: "ready-pool-check", ms: Date.now() - t0, n: result.pool, load: getLoad1() });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (isDirectEntry(import.meta, undefined, "ready-pool-check")) {
  process.exitCode = main(process.argv);
}
