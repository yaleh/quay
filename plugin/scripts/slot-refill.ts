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
//   1. slots_free = max(0, effective_cap - in_flight_count). THE MEASURED OBJECT (AC76, 人
//      2026-08-14 07:3xZ 逐字「cap=5 就是为了保护 subagent——inner 不能并发无限多 subagent」):
//      cap 的被计量对象 = 并发 subagent。The caller passes the CURRENTLY-RUNNING subagent set
//      EXPLICITLY (--in-flight) — the INNER tick's own maintained set, which is authoritative for
//      its dispatch decision. ⛔ 禁 worktree 代理 — `git worktree list | grep -c` is a FORBIDDEN
//      proxy (a worktree can have no active subagent turn, and an active subagent can have no
//      worktree; 双向实测 2026-08-14: 07:2xZ worktree 4 · 活跃 subagent 2 ⇒ 高估 2; 07:4xZ worktree 1 ·
//      活跃 subagent 2 ⇒ 低估 1 — tasks/gap-ac76-cap-counts-subagents-not-worktrees). The helper
//      deliberately does NOT read RAW telemetry brackets for the count (AC6: brackets ≠ subagents —
//      gap-telemetry-brackets-vs-subagents-no-slot-visibility; a completed-but-not-fanned-in task
//      keeps its telemetry bracket open yet its slot IS free). Completion frees the slot at the
//      <task-notification>, not at fan-in.
//   RETIRED (AC76 C24-2, 人 2026-08-14 09:1xZ「在飞不应当靠任务记录,而应当查 inner 任务 subagent」;
//            gap-inflight-states-missing-impl-complete-event 2026-08-19 进一步解耦):
//      the MEASURED IN-FLIGHT DEFAULT below — when --in-flight/--closed-but-live are NOT passed (the
//      OUTER tick A18 / a manual bare `--json` reading), the in-flight view was MEASURED from the
//      reconcile-aware telemetry `--slot-status` view (real-in-flight KEPT records / closed-but-live
//      agents / non-task subagents). That derivation is RETIRED — its worktree/telemetry/process probes
//      are proxy inferences for the missing state. The Build dispatch count now reads the event
//      stream's IMPLEMENTING segment (start without impl-complete — 真正在实现; the third
//      `impl-complete` event splits the start→end span). a bare invocation still surfaces
//      measurement_source ("explicit-input" | "event-stream-implementing" | "degraded-no-telemetry")
//      + measurement_error so a 0 is never silent again.
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
//       [--red-backlog-cap <n>] [--json]
//   --integration-backlog <n>   override the git-read integration backlog (test/Contract seam; the
//                               production default reads `git rev-list --count develop..integration`).
//                               Reported as a diagnostic; NO LONGER the cap-narrowing trigger.
//   --red-backlog-cap <n>       the narrowed cap when the consecutive-red WINDOW is active (default 2;
//                               rationale in tasks/gap-red-window-cap-trigger-backlog-not-suite-red.md).
//
// The pure functions are exported and unit-tested; main() is a thin CLI over them.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseTask, extractSection } from "./task-schema.ts";
import {
  analyzeTasks,
  POOL_FLOOR_MULT_DEFAULT,
  readGitRevCount,
  // SUPERSEDED GUARD (gap-ac46-superseded-keyword-vs-marker): the pool/step-4 superseded filter must
  // match the **SUPERSEDED** MARKER, not the bare word — a task merely DISCUSSING the superseded
  // category (e.g. naming the `superseded-capability` checker) is NOT a superseded task and must stay
  // dispatchable. Reused from ready-pool-check's marker regex (single source, no parallel copy).
  SUPERSEDED_MARKER_RE,
  // RETREATED / 搁置 MARKER (tasks/gap-retreated-state-not-mechanized): a task the outer retreated
  // (load-induced red rollback) carries a line-start bold `**RETREATED` marker and must NOT be
  // re-recommended until the fix-scope gate lands and the marker is removed (解除搁置). Reused from
  // ready-pool-check's marker regex (single source, no parallel copy) — the SAME recognition/exclusion
  // split as SUPERSEDED_MARKER_RE.
  RETREATED_MARKER_RE,
  // MERGE-WORKTREE SURFACE (tasks/gap-dispatch-gate-blind-to-inflight-merge-worktree): the
  // merge-in-flight detector + its touches-overlap judge. The dispatch gate's touches-overlap
  // judgment must include in-flight MERGE worktrees' conflict surfaces (the vhs-merge accident:
  // outer deferred merge-colliding tasks, inner dispatched them because the gate only saw in-flight
  // TASK worktrees). computeMergeWorktreeSurfaces finds the merge worktrees (MERGE_HEAD / UU), and
  // mergeSurfaceBlock distinguishes a merge-worktree overlap from a peer-task overlap (AC2).
  computeMergeWorktreeSurfaces,
  mergeSurfaceBlock,
  // LANDED-IMPLEMENTATION (gap-slot-refill-recommends-landed-code-complete-tasks): the SHAPE-AWARE
  // completion counter + the （待外部） annotation judge — reused, never a parallel copy. The new
  // landed-implementation gate needs the same "which completion boxes are open and are they declared
  // external" read the pool's notYetFlipped applies (single source), so an AC-incomplete landed task
  // (stuck-work) stays dispatchable.
  countCompletionCheckboxes,
  isExternalVerificationItem,
} from "./ready-pool-check.ts";
// NOT-YET-FLIPPED SKIP (gap-slot-refill-repeats-done-eligible-recommendations): the AC-completeness
// gate (countAcCheckboxes — the SAME gate ready-pool-check's notYetFlipped applies, so an AC-incomplete
// fan-in that is genuinely stuck-work stays dispatchable) + the durable fan-in signal (hasFanInMerge —
// reads --all MERGE history, so it survives the two-line branch model's integration fan-in that the
// master-only git-history signal misses).
import { countAcCheckboxes } from "./task-status-drift-check.ts";
import {
  checkTaskTouchesResolve,
  checkTouchesPair,
  parseTouches,
  findRepoRoot,
  walkFiles,
  selfTouchCheck,
  normalizePath,
  matchGlob,
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
 *  an explicit `--cap`; the DEFAULT is fixed at 5.)
 *  concurrency-default-fallback: human-ruled fixed cap (declared per
 *  gap-concurrency-literal-only-at-definition-points; the single source is QUAY_MAX_TASK_SUBAGENTS
 *  once gap-single-flight-lock-2-slot-concurrent-suites lands). */
export const FIXED_DISPATCH_CAP = 5;

/** B3 ①/④ ARBITRATION (gap-red-window-cap-trigger-backlog-not-suite-red): B3's five inequalities were
 *  written as five INDEPENDENT mandates, but ④ (integration ahead + suite green ⇒ batch-merge) is a
 *  DOWNSTREAM constraint on ① (in_flight<cap ⇒ dispatch): when the delivery gate is blocked by a red
 *  suite, the commits pile up on integration and a full-cap dispatch adds WIP, not throughput. The
 *  arbitration narrows the effective dispatch cap to "just enough to fix red" (RED_BACKLOG_CAP). The
 *  TRIGGER is now the CONSECUTIVE-RED WINDOW ALONE (red_window_active ⇒ cap → red_backlog_cap), per
 *  human ruling 2026-08-13 — the old `suite_red && backlog > RED_BACKLOG_THRESHOLD` double condition
 *  required the integration backlog to exceed 50, which left the cap at 5 during a red round when the
 *  backlog was 10 (measured). The backlog threshold is RETIRED from the trigger (a condition
 *  relaxation, not a new mechanism); `integration_backlog` is still reported as a diagnostic. This is
 *  a cap ARBITRATION (a THROTTLE), NOT a dispatch stop — slot-refill still recommends up to the
 *  narrowed cap, so a red window reduces concurrency without deadlocking (降 cap ≠ 停派; combined with
 *  "不在主会话修" a stop would be a deadlock). */
export const RED_BACKLOG_CAP_DEFAULT = 2; // concurrency-default-fallback: red-window throttle (narrows the dispatch cap, not a slot count — declared per gap-concurrency-literal-only-at-definition-points)

/** Free dispatch slots = max(0, cap − in_flight). The one definition; never hardcoded.
 *  RETIRED-BY-AC76 (C24-2, 人 2026-08-14 09:1xZ「在飞不应当靠任务记录,而应当查 inner 任务 subagent」):
 *  the in_flight INPUT to slots_free is retired as an in-flight READ when telemetry/bracket-measured
 *  (the telemetry fallback — see the header RETIRED block). 在飞的唯一读法 = 查 inner 任务 subagent
 *  (cap-counts-subagents-check 判据2: `<session>/subagents/agent-*.jsonl` 近 N 分钟写入数);
 *  the caller-supplied `--in-flight` set (subagent-sourced) remains the live path. */
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

/** The ①/④ arbitration, pure: narrow the dispatch cap to `redBacklogCap` when the consecutive-red
 *  window is ACTIVE (red_window_active — the red window ALONE triggers the narrowing, per human ruling
 *  2026-08-13). The old `suite_red && backlog > threshold` double condition required backlog > 50,
 *  which left the cap at 5 during a red round when the integration backlog was 10. Backlog is NOT part
 *  of the trigger; an inactive window leaves the base cap unchanged. Throttle, not a stop: the caller
 *  still recommends up to the narrowed cap. */
export function computeArbitratedCap({ baseCap, redWindowActive, redBacklogCap = RED_BACKLOG_CAP_DEFAULT }) {
  if (redWindowActive) return redBacklogCap;
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
 *  the parent file is missing (cannot confirm done). COMPOUND AGGREGATION (gap-compound-depsreadyfor-
 *  structural-deadlock AC2): a `role: compound` parent is an AGGREGATE — the parent is only `done`
 *  once ALL its children are done, so a child waiting on its compound parent is the 双向互等 deadlock
 *  (child waits on parent, parent waits on children). The compound-parent edge is therefore skipped;
 *  a child of a compound dispatches on its own depends_on edges alone. */
function depsReadyFor(task, metaById) {
  const parent = task.parent;
  if (!parent || parent === "null" || parent === "~") return true;
  const meta = metaById.get(parent);
  if (meta === undefined) return false; // parent file missing → fail closed
  if (meta.role === "compound") return true; // aggregation, not a predecessor
  return meta.status === "done";
}

/** Per-task dispatch metadata (id → { status, role }), for the deps-ready filter and the compound
 *  aggregation exemption. ONE pass over the store (no parallel scan). */
function buildTaskMetaById(tasksDir) {
  const metaById = new Map();
  if (!fs.existsSync(tasksDir)) return metaById;
  for (const f of fs.readdirSync(tasksDir)) {
    if (!f.endsWith(".md")) continue;
    const id = f.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const task = parseTask(raw);
    metaById.set(id, {
      status: readFrontField(task.frontmatterRaw, "status") || "",
      role: readFrontField(task.frontmatterRaw, "role") || "",
    });
  }
  return metaById;
}

/** DURABLE FAN-IN SIGNAL (gap-slot-refill-repeats-done-eligible-recommendations): whether the task's
 *  branch was merged — a MERGE commit anywhere in `--all` history whose message references the task id.
 *  This is the broadened sibling of inner-blocked-signal.hasMergeRecord (which greps only the canonical
 *  `task/<id>` fan-in branch convention): matching the BARE task id also catches the adhoc `merge:
 *  <id> — …` format (observed real fan-in, e.g. gap-runner-grouping-ac7-nested-spawn-load-flake), and
 *  it still fires on every `task/<id>` merge. Same durable fan-in evidence — survives `git branch -d`
 *  after fan-in, reads `--all` so the two-line model's INTEGRATION fan-in is visible where the
 *  master-only git-history signal sees nothing. Any git failure → false (never a positive from an
 *  unavailable source). */
export function hasFanInMerge(root, taskId) {
  try {
    const out = execFileSync("git", ["-C", root, "log", "--all", "--format=%H", "--merges", "--grep", taskId], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/** NOT-YET-FLIPPED SKIP (gap-slot-refill-repeats-done-eligible-recommendations) — the 4th step-4
 *  check. A task is "已 fan-in 待翻 done" (work already landed, waiting only for the green round to
 *  flip done) and must NOT be re-dispatched — a re-dispatch only wastes a subagent re-verifying
 *  already-landed work — when EITHER:
 *   (a) ready-pool-check's analyzeTasks already excluded the id as not-yet-flipped (pool.excluded
 *       reason "not-yet-flipped" — the master-landed / all-ACs-checked case; slot-refill iterates
 *       pool.ready which is disjoint from excluded, so this arm is defense-in-depth that wires the
 *       existing signal into the candidate path per AC2), or
 *   (b) its branch was MERGED (hasFanInMerge — reads `--all` merge history, so it survives the
 *       two-line branch model's INTEGRATION fan-in that the master-only git-history signal misses)
 *       AND its ACs are substantially complete (>50% or all checked — the SAME AC-completeness gate
 *       ready-pool-check's notYetFlipped applies, so an AC-incomplete fan-in that is genuinely
 *       stuck-work stays dispatchable, gap-ready-pool-worklanded-traps-stuck-work).
 *  Pure + read-only; reuses the existing signals, never a parallel copy. */
export function isNotYetFlippedSkip({ id, body, root, excludedNyfIds }) {
  if (excludedNyfIds.has(id)) return true;
  if (!hasFanInMerge(root, id)) return false;
  const ac = extractSection(body, "Acceptance Criteria");
  const { total, checked, sectionFound } = countAcCheckboxes(ac);
  // AC47 (gap-ac47-completion-predicate-consumer-fail-closed, AC1/AC2): an ABSENT/UNREADABLE AC
  // section (extractSection → null, e.g. a suffixed/unregistered heading) is fail-CLOSED — do NOT
  // treat it as "total=0 → not a skip". With the countAcCheckboxes fail-closed shape this guard is
  // redundant (total is NaN ⇒ the arithmetic below already returns false), but it makes the
  // fail-closed intent explicit at this consumer.
  if (!sectionFound) return false;
  if (total === 0) return false;
  const allAcsChecked = checked === total;
  const acRatio = checked / total;
  return allAcsChecked || acRatio > 0.5;
}

/** IMPLEMENTATION-CLASS FILE PREFIXES (gap-slot-refill-landed-detection-implementation-file-classes):
 *  the whitelist of file prefixes that count as "implementation evidence" for the landed-implementation
 *  signal. A develop commit naming the task id is NOT landed evidence by itself — the non-tasks/ file
 *  it changed must be an implementation landing point (packages/ · plugin/scripts/ · plugin/test/ ·
 *  scripts/ · src/). Doc / decision / telemetry sidecars (docs/, milestones/, .quay/, adr/,
 *  orchestration/, goals/, measurements/) are NOT implementation — a task-creation or analysis commit
 *  that incidentally touched a sidecar must not judge the task "landed". Real phantom-killer false
 *  positives killed by this whitelist: gap-streaming-red-cascade-amplifies-failures-array (commit
 *  51699289 incidentally touched milestones/fast-mode-telemetry/2026-08-13.json ⇒ now false) and
 *  gap-worktree-node-modules-inconsistent-self-verify (commit 1f99e276 incidentally touched
 *  docs/analysis/batch2-queue-state.md ⇒ now false); a real landed task still judges true (e.g.
 *  gap-slot-refill-recommends-landed-code-complete-tasks — merge c6fc14a7 changed plugin/scripts/
 *  slot-refill.ts). */
const IMPLEMENTATION_CLASS_PREFIXES = [
  "packages/",
  "plugin/scripts/",
  "plugin/test/",
  "scripts/",
  "src/",
];

/** A file path is "implementation-class" when it starts with one of the implementation landing-point
 *  prefixes (see IMPLEMENTATION_CLASS_PREFIXES). Sidecar / doc / telemetry paths (docs/, milestones/,
 *  .quay/, adr/, orchestration/) are NOT implementation-class — they can be touched incidentally by a
 *  task-creation or analysis commit and must never count as landed-implementation evidence. Pure +
 *  exported for unit tests. */
export function isImplementationClassFile(p) {
  return IMPLEMENTATION_CLASS_PREFIXES.some((pre) => p.startsWith(pre));
}

/** LANDED-IMPLEMENTATION signal (tasks/gap-slot-refill-recommends-landed-code-complete-tasks): whether
 *  a ready task's IMPLEMENTATION is already in the tree — the "landed-but-not-flipped" shape the
 *  recommended list kept recommending (a dispatch would only re-verify already-landed work; observed
 *  4-6 times in one day: ac53-end-invariant / src-n-anchor / precommit-guard / npm-pack / catalog /
 *  runner-grouping — all "代码已合进 develop、ACs 全勾、只差绿轮验证后的 closure").
 *
 *  Mechanical predicate (manager 2026-08-13, validated on 6 real samples + negative control; narrowed
 *  2026-08-13 by gap-slot-refill-landed-detection-implementation-file-classes):
 *    实现已在树(id) := ∃ develop 提交，其 message 含 <task-id>
 *                    且 git show --name-only -m --first-parent 的文件里有【实现类】(packages/ ·
 *                    plugin/scripts/ · plugin/test/ · scripts/ · src/) 文件
 *  Three pitfalls (all handled):
 *    1. message-only grep ⇒ FALSE POSITIVE (task-creation/body commits also name the id) — the
 *       predicate requires a file OUTSIDE tasks/ (the implementation file) before it fires.
 *    2. missing `-m --first-parent` ⇒ FALSE NEGATIVE — the landing commit is usually a MERGE, and
 *       `git show --name-only` prints ZERO files for a merge by default (measured 7418c615: 0 files
 *       without -m, 4-5 with). `-m` diffs against each parent, `--first-parent` keeps the merge's own
 *       first-parent diff — the merge's changes vs develop.
 *    3. ANY non-tasks/ file counting as implementation ⇒ FALSE POSITIVE (phantom-killer: streaming-red
 *       51699289 touched milestones/fast-mode-telemetry/*.json; worktree-node-modules 1f99e276 touched
 *       docs/analysis/*.md — both judged "landed" with AC 0/10, no fan-in). The evidence file must be
 *       an IMPLEMENTATION-CLASS file (isImplementationClassFile) — docs/milestones/.quay/telemetry
 *       sidecars never count.
 *  ONE git call: `git log --name-only -m --first-parent --grep <id> develop` returns each matching
 *  commit (marker line `@@COMMIT@@<hash>`) followed by its first-parent file list; a non-marker line
 *  outside `tasks/` that is implementation-class is the landed-implementation evidence. Fail-safe: any
 *  git failure / non-git root / no develop ref ⇒ false (never a positive from an unavailable source). */
export function hasLandedImplementation(root, taskId) {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "log", "develop", "--format=@@COMMIT@@%H", "--grep", taskId, "--name-only", "-m", "--first-parent"],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
    let inCommit = false;
    for (const line of out.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("@@COMMIT@@")) { inCommit = true; continue; }
      // NARROWED 2026-08-13 (gap-slot-refill-landed-detection-implementation-file-classes): the evidence
      // file must be an IMPLEMENTATION-CLASS file, not ANY non-tasks/ file — docs/milestones/.quay/
      // telemetry sidecars touched incidentally by a task-creation/analysis commit are not
      // implementation (phantom-killer false positives 51699289 / 1f99e276).
      if (inCommit && isImplementationClassFile(t)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** OUTER-VERIFICATION item family (gap-phantom-killer-false-negative-id-not-in-commits): the pool's
 *  `（待外部）` (isExternalVerificationItem) is ONE declared annotation for "depends on an external
 *  event"; the outer full-suite verification item is a SECOND structurally-identical declared form
 *  used across the task store (`全量套件绿（…）——外层 verification-round 验证` / `**外层 verification-
 *  round 验证**` / `外层全量验证`). This recognizer is slot-refill's ONLY addition over the single
 *  source isExternalVerificationItem — ready-pool-check's fail-closed semantics (unannotated defaults
 *  待本任务) are UNCHANGED there; this family recognition is local to slot-refill's landed gate. */
const OUTER_VERIFICATION_RE = /(?:全量套件绿|外层(?:全量)?验证|外层\s*verification-round)/;
export function isOuterVerificationItem(text) {
  return isExternalVerificationItem(text) || OUTER_VERIFICATION_RE.test(text);
}

/** LANDED-IMPLEMENTATION completion gate (gap-slot-refill-recommends-landed-code-complete-tasks): the
 *  new step-4 check is a "已合待翻 done" exclusion — the task is a done-flip candidate (NOT fresh
 *  dispatchable work) ONLY when its self-declared completion checkboxes (AC + DoD, shape-aware: the
 *  literal `## Acceptance Criteria` extractSection is exactly why the all-checked phantom tasks under
 *  `## AC` were NOT caught) are all checked, OR it has none (the landing is its closeout), OR every
 *  remaining unchecked item is an EXTERNAL-VERIFICATION item — `（待外部）` via the pool's single-source
 *  isExternalVerificationItem, or the outer full-suite 「外层全量验证」 family via isOuterVerificationItem
 *  (awaiting suite/verification — the manager's "只差绿轮验证后的 closure" shape; the outer family
 *  added 2026-08-13 by gap-phantom-killer-false-negative-id-not-in-commits because the empirical
 *  false-negative task's outer item was written `——外层 verification-round 验证`, NOT `（待外部）`). An
 *  AC-incomplete landed task carries real remaining implementation — STUCK-WORK — and must stay
 *  dispatchable (gap-ready-pool-worklanded-traps-stuck-work parity: the pure-git signal alone would
 *  wrongly trap it). Reuses the pool's single-source countCompletionCheckboxes / isExternalVerificationItem
 *  (the outer family is the ONLY addition), never a parallel copy. */
export function isLandedCodeComplete(body) {
  const { total, checked, uncheckedItems, sectionFound } = countCompletionCheckboxes(body);
  // AC47 (gap-ac47-completion-predicate-consumer-fail-closed, AC1/AC2): an ABSENT/UNRECOGNIZED
  // AC/DoD section is fail-CLOSED — never "landed". This is the main fail-open consumer (the
  // LANDED-IMPLEMENTATION recommendation path): DIR-014's 5 unchecked boxes under a suffixed heading
  // previously read as {total:0} → total===0 → judged landed. Now sectionFound:false returns false
  // (and countCompletionCheckboxes total is NaN, so `total===0` is structurally unreachable).
  if (!sectionFound) return false;
  if (total === 0) return true;
  if (checked === total) return true;
  return uncheckedItems.length > 0 && uncheckedItems.every(isOuterVerificationItem);
}

/** TASK-BODY-SIDE LANDED signal (gap-phantom-killer-false-negative-id-not-in-commits): the OR-in
 *  alternative to the git-grep hasLandedImplementation. The FALSE-NEGATIVE direction:
 *  hasLandedImplementation reads `git log develop --grep <taskId>` — when the implementation commits
 *  NEVER carry the task id in their message (the empirical case:
 *  gap-superseded-modeled-as-task-lifecycle-terminal — impl deba6463/8a8fc8f6/f12863a8/8bf44f9f/
 *  2d3caab0/23c8fee3 all ancestor on develop but the messages say "VALID_STATUSES 加 superseded",
 *  ACs 8/9 with the ONLY unchecked item the outer full-suite verification) the grep misses and a
 *  LANDED task is still recommended. The body-side signal: a ready task whose body DECLARES itself
 *  code-complete-except-outer-verification (all completion boxes checked, OR every remaining unchecked
 *  item is outer-verification) is "已合待翻 done" even when no commit names its id. total > 0 is
 *  REQUIRED — a no-checkbox task (a fresh task with no completion boxes) must NOT be judged landed
 *  from body alone (that would be a phantom-killer FALSE POSITIVE: genuinely-new no-checkbox work
 *  swallowed). Reuses the single-source countCompletionCheckboxes + isOuterVerificationItem. */
export function isBodyLanded(body) {
  const { total, checked, uncheckedItems, sectionFound } = countCompletionCheckboxes(body);
  // AC47 (gap-ac47-completion-predicate-consumer-fail-closed, AC1/AC2): fail-closed on an
  // ABSENT/UNRECOGNIZED AC/DoD section — a body whose completion predicate cannot read its AC/DoD is
  // never judged body-side landed (matches isLandedCodeComplete's fail-closed).
  if (!sectionFound) return false;
  if (total === 0) return false;
  if (checked === total) return true;
  return uncheckedItems.length > 0 && uncheckedItems.every(isOuterVerificationItem);
}

/** IN-FLIGHT DISJOINTNESS with C8 SELF-FILE EXEMPTION
 *  (tasks/gap-directory-level-tasks-touch-global-lock AC1 option ② — 「目录级 vs self-touch」的相交
 *  给出不阻塞的语义): the dispatch-overlap judgment between a CANDIDATE and an IN-FLIGHT task. A
 *  directory-level `tasks/*.md` Touches declaration from the in-flight task expands to EVERY task file
 *  on disk, and C8 (self-touch, fast-mode-tick-core.md C8) forces every candidate to declare its OWN
 *  `tasks/<id>.md` — so the in-flight glob overlaps every candidate's MANDATORY self-file ⇒ a GLOBAL
 *  dispatch lock while the in-flight task runs (measured: doc-lint 3h40m, `git worktree list` shows a
 *  created worktree with 3h38m zero commits; occurrence rate 45).
 *
 *  THE EXEMPTION (option ②, chosen over ① enumerate-concrete at dispatch): a candidate's OWN self-file
 *  does NOT count as an overlap with an in-flight task WHEN the in-flight side's coverage of that file
 *  is GLOB-DRIVEN (a directory glob like `tasks/*.md`), NOT a concrete declaration of the candidate's
 *  file. Any overlap on OTHER files — the candidate's other touches, or a concrete in-flight entry
 *  naming the candidate's own file — still blocks. Genuine multi-task-file writers stay serialized:
 *  a candidate declaring `tasks/*.md` is never exempt (its own glob genuinely claims every task file),
 *  and two `tasks/*.md` declarers still overlap on many files. This makes the pre-dispatch heuristic
 *  reflect INTENT (a directory glob is an overbroad intent-declaration whose true conflict surface is
 *  the declarer's ACTUAL landed files, which anti-drift + the fan-in merge enforce at land) instead of
 *  the C8-forced self-touch.
 *
 *  SINGLE-SOURCE: delegates to checkTouchesPair for the base verdict (imported from
 *  touches-orthogonality-check.ts — no reimplemented disjointness); this function ONLY adds the
 *  self-file exemption on top. Fail-closed: conservative (no/empty ## Touches) / empty-expansion /
 *  ambiguous cases return the base verdict UNCHANGED (blocked) — the exemption requires the ACTUAL
 *  overlap to be EXACTLY one file, the candidate's own self-file, covered only by a wildcard glob.
 *
 *  WHY the ACTUAL overlap is recomputed: checkTouchesPair treats a directory glob like `tasks/*.md`
 *  as OVERBROAD (isOverbroadDeclaration — <2 concrete segments before the first wildcard) and
 *  short-circuits to `disjoint:false` with `overlaps:[]` WITHOUT computing the real intersection.
 *  That conservative short-circuit is correct for the batch (two NEW candidates where an overbroad
 *  glob could absorb a stray write) but it would hide the self-file-only overlap the exemption needs
 *  to see. So when the base verdict is NOT disjoint, this function recomputes the actual intersection
 *  with the SAME expander to distinguish "exactly the candidate's own self-file" from a genuine
 *  conflict — and only the former is relaxed. The genuine conflict arms (a concrete in-flight entry
 *  naming the candidate's file, any OTHER overlapping file, an overbroad/empty candidate side) all
 *  return the base blocked verdict unchanged.
 *
 *  @param {object} candidateParsed  parseTouches(candidate body) — side A (the candidate)
 *  @param {object} inFlightParsed   parseTouches(in-flight body) — side B (the in-flight task)
 *  @param {(globs: string[]) => Set<string>} expand  the injected declared-touches expander
 *      (expandDeclaredTouches — concrete paths resolve to themselves, wildcards expand against the tree)
 *  @param {string} selfFileRel      repo-relative candidate self-file, e.g. `tasks/<candidate-id>.md`
 *  @returns {object} same shape as checkTouchesPair: {disjoint, overlaps, reason}
 */
export function checkTouchesPairInFlight(candidateParsed, inFlightParsed, expand, selfFileRel) {
  const base = checkTouchesPair(candidateParsed, inFlightParsed, expand);
  if (base.disjoint) return base;
  if (!selfFileRel) return base;
  const selfNorm = normalizePath(selfFileRel);
  // The exemption needs the ACTUAL overlap — checkTouchesPair's overbroad branch (a directory glob
  // like `tasks/*.md`) returns overlaps:[] even though a real overlap exists. Compute the real
  // intersection with the SAME expander so the exemption can tell "only the candidate's own self-file"
  // apart from a genuine conflict. An empty actual overlap (conservative empty-expansion / typo) stays
  // blocked (fail-closed: nothing is relaxed).
  const setC = expand(candidateParsed.globs || []);
  const setI = expand(inFlightParsed.globs || []);
  const overlaps = [...setC].filter((f) => setI.has(f)).sort();
  // The exemption applies ONLY when the overlap is exactly the candidate's own self-file — an overlap
  // on ANY other file (or multiple files) is a genuine conflict and stays blocking.
  if (overlaps.length !== 1 || overlaps[0] !== selfNorm) return base;
  // The exemption is GLOB-DRIVEN only: if the in-flight side CONCRETELY declares the candidate's own
  // file, that is a genuine intent to write it — never exempt (a concrete entry cannot be an
  // overbroad intent-declaration).
  const inFlightGlobs = inFlightParsed.globs || [];
  const concreteInFlight = inFlightGlobs.filter((g) => !/[*?]/.test(g));
  if (expand(concreteInFlight).has(selfNorm)) return base;
  // The candidate side must itself declare the self-file CONCRETELY (C8 — a non-wildcard
  // `tasks/<id>.md` entry; the self-touch gate upstream already requires this) for the exemption to
  // apply — the overlap is the MANDATORY self-touch, not some other path the candidate shares.
  const candidateGlobs = candidateParsed.globs || [];
  if (!candidateGlobs.some((g) => !/[*?]/.test(g) && normalizePath(g) === selfNorm)) return base;
  // AND the candidate must NOT itself cover its self-file via a wildcard glob — a candidate declaring
  // `tasks/*.md` is itself a genuine multi-task-file writer (its overlap with an in-flight tasks/*.md
  // declarer is NOT "only its own self-file", it claims EVERY task file) and never benefits from the
  // exemption. A normal candidate whose wildcard globs are non-task (e.g. `plugin/scripts/*`) is
  // unaffected — only a glob that MATCHES the self-file disqualifies.
  if (candidateGlobs.some((g) => /[*?]/.test(g) && matchGlob(normalizePath(g), selfNorm))) return base;
  return {
    disjoint: true,
    overlaps: [],
    reason: `disjoint (C8 self-file ${selfNorm} excluded — in-flight covers it only via a directory glob, not a concrete entry)`,
  };
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
 *  @param {number} [o.subagentsInFlight] non-task subagent PROCESSES in flight (no bracket —
 *      investigation-type subagents, gap-telemetry-underreport-nontask-subagents-not-counted-in-slots).
 *      They occupy a concurrency slot (occupied_slots / slots_free arithmetic) but carry no task id, so
 *      they cannot participate in the touches-disjointness check. Default 0.
 *  @param {number|null} [o.runningSubagentCount] AC5 DUAL-CONSUMER SPLIT
 *      (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name, 人 2026-08-14 12:5xZ): the
 *      CURRENTLY-RUNNING task subagent count — the NARROW set Consumer B (occupied_slots / slots_free /
 *      should_refill) counts. Consumer A (touches-disjointness / dispatchable_disjoint) keeps the WIDE
 *      un-landed set (inFlight + closedButLive): an awaiting-retry task's worktree still occupies files
 *      a new task would collide with, but it has no subagent ⇒ does NOT occupy cap. The two denominators
 *      are ALLOWED to differ (真 slots_free = cap − 真并发 subagent). null (default) ⇒ Consumer B falls
 *      back to the wide set (backward compat for callers not yet passing --running / the outer A18 +
 *      manual bare paths).
 *  @param {string|null} [o.measurementSource] where the in-flight view came from — "explicit-input"
 *      (the caller passed --in-flight/--closed-but-live), "event-stream-implementing" (measured from
 *      the telemetry report's `implementing` segment — start without impl-complete, the Build dispatch
 *      count), or "degraded-no-telemetry" (the measurement failed and the in-flight view fell back to
 *      empty). Default null (direct library calls that pass inFlight/closedButLive arrays). This is
 *      the field that closes gap-slot-refill-inflight-disconnected-from-worktrees: a bare
 *      `slot-refill --json` must never again silently read 0 — the JSON now says whether 0 is measured
 *      or a degraded fallback.
 *  @param {string|null} [o.measurementError] when measurementSource === "degraded-no-telemetry", the
 *      telemetry failure message (never a silent 0). Default null.
 *  @param {number} [o.integrationBacklog] integration-ahead-of-develop commit count; when omitted it
 *      is read from git (`git rev-list --count develop..integration`), fail-safe 0 on a non-git root /
 *      missing ref. Injectable for tests (a temp dir is not a git repo). Reported as a diagnostic;
 *      NO LONGER part of the cap-narrowing trigger (gap-red-window-cap-trigger-backlog-not-suite-red).
 *  @param {number} [o.redBacklogCap] the narrowed dispatch cap when the consecutive-red window is
 *      active (default RED_BACKLOG_CAP_DEFAULT = 2). The `red_backlog_cap=2` literal's rationale is
 *      recorded in tasks/gap-red-window-cap-trigger-backlog-not-suite-red.md (AC3).
 *  @param {Function} [o.dispatchGate] OPTIONAL injected per-candidate dispatch gate
 *      `(candidate) => ({ ok: boolean, reason?: string })` (or a bare `false` to reject). Applied in
 *      the candidate loop AFTER the built-in step-4 checks. A rejected candidate is skipped and the
 *      loop continues to the next — BACKFILL (gap-slot-refill-c8-reject-no-backfill: a per-candidate
 *      gate rejection must pull a later-in-sort candidate, never recommend a rejected one with no
 *      replacement). Default: none (the built-in C8 self-touch gate is always on).
 *  @returns {object} { cap, base_cap, effective_cap, arbitration, in_flight_count,
 *      closed_but_live_count, occupied_slots, slots_free, pool, floor, deficit,
 *      dispatchable_disjoint, criterion_met, should_refill, no_refill_reason, recommended,
 *      deferred, ranking, scanned } —
 *      `recommended` is the backward-compatible string-id array; `deferred`
 *      (gap-over90-clock-measures-queue-time-not-work-time) is the array of {id, reason} step-4
 *      skips — the candidates whose open bracket must be closed on defer (--close-task --outcome
 *      deferred) so the queue segment never counts toward OVER90; `ranking` (gap-ac36-recommended-
 *      exposes-sort-key) is the parallel array of {id, deliveryCritical, suiteBlocking, rank} that
 *      exposes each recommended id's sort axes for AC36 判据②'s mechanical check.
 */
export function analyzeSlotRefill({ tasksDir, root, cap = FIXED_DISPATCH_CAP, floorMult = POOL_FLOOR_MULT_DEFAULT, inFlight = [], closedButLive = [], subagentsInFlight = 0, runningSubagentCount = null, measurementSource = null, measurementError = null, integrationBacklog, redBacklogCap = RED_BACKLOG_CAP_DEFAULT, dispatchGate = null }) {
  // PREEMPTIVE HALT (gap-supervisor-preemption AC2): the `.halt` sentinel is a CODE mount point,
  // not a tick-step-0 prose rule. When halted, dispatch is blocked no matter how many slots/candidates
  // exist — the human's stop takes effect at ANY dispatch-recommendation point, mid-flow.
  const halt = checkHaltSentinel(root);
  // B3 ①/④ ARBITRATION (gap-red-window-cap-trigger-backlog-not-suite-red): ① (in_flight<cap ⇒ dispatch)
  // conflicts with ④ (integration ahead + suite green ⇒ batch-merge) — ④ is a DOWNSTREAM constraint on
  // ①. The TRIGGER for the cap narrowing is now the CONSECUTIVE-RED WINDOW ALONE (red_window_active ⇒
  // cap → red_backlog_cap), per human ruling 2026-08-13 — the old `suite_red && backlog > threshold`
  // double condition required backlog > 50 and left the cap at 5 during a red round when the backlog
  // was 10 (measured). The window reading is cap-INDEPENDENT (computeSuiteBlocking reads
  // verification-round.jsonl + full-suite-state.json, never the cap), so a FIRST pass at the BASE cap
  // yields the authoritative `suite_blocking.window_active`; when the window narrows, a SECOND pass at
  // the arbitrated cap re-derives the cap-dependent pool stats (floor) exactly as the pre-existing
  // single-pass-at-effective-cap behavior did. Throttle, NOT a stop: should_refill below still
  // recommends up to the narrowed cap (AC2 — red window reduces concurrency without deadlocking).
  const suiteRed = readSuiteRed(root);
  const backlog = integrationBacklog ?? readGitRevCount(root, "develop..integration") ?? 0;
  const baseCap = cap;
  let pool = analyzeTasks({ tasksDir, root, cap: baseCap, floorMult, inFlight, closedButLive });
  const redWindowActive = pool.suite_blocking ? pool.suite_blocking.window_active : false;
  const effectiveCap = computeArbitratedCap({ baseCap, redWindowActive, redBacklogCap });
  const capNarrowed = effectiveCap !== baseCap;
  if (capNarrowed) {
    pool = analyzeTasks({ tasksDir, root, cap: effectiveCap, floorMult, inFlight, closedButLive });
  }
  // AC5 DUAL-CONSUMER SPLIT (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name, 人 2026-08-14
  // 12:5xZ): Consumer A (touches-disjointness / dispatchable_disjoint) counts the WIDE un-landed set
  // (inFlight + closedButLive — an awaiting-retry task's worktree still occupies files a new task
  // would collide with); Consumer B (slot counting / slots_free / should_refill) counts the NARROW
  // currently-RUNNING subagent set (cap=5 protects subagents — an awaiting-retry task has no subagent
  // ⇒ does NOT occupy cap). The two denominators are ALLOWED to differ (the 2026-08-14 empirical
  // split: 5 worktrees but 3 live subagents ⇒ true slots_free = 5 − 3 = 2, while the old
  // shared-denominator read 0 ⇒ "等重跑任务算进在飞⇒在飞多算⇒slots_free 虚低⇒不派"). `runningSubagentCount`
  // null (not passed) ⇒ Consumer B falls back to the wide set (backward compat). `subagentsInFlight`
  // (non-task investigation subagents) carries no task id — it always occupies a slot but never joins
  // the touches-disjointness check.
  const slotOccupants = runningSubagentCount !== null
    ? runningSubagentCount
    : (inFlight.length + closedButLive.length);
  const occupied = slotOccupants + (subagentsInFlight > 0 ? subagentsInFlight : 0);
  const slotsFree = computeSlotsFree(effectiveCap, occupied);

  // recommended — the production disjoint batch over the ready pool, filtered by the SAME step-4
  // dispatch checks (touches-resolve + deps-ready + disjoint-from-in-flight), capped at slots_free.
  // While halted, no candidate is recommended at all — the human's stop supersedes the pool.
  // (Pool stats are still reported for visibility; the dispatch recommendation is empty.)
  let recommended = [];
  // AC56 DE-ORDER ANNOTATION (gap-ac56-recommended-deordered): the explicit "order meaningless" mark
  // the output must carry when it recommends ≥2 ids (判据1 option 2). Assigned inside the candidate
  // block; while halted nothing is recommended so the value records the null state. Read by
  // ac56-recommended-deordered-check.ts from the OUTPUT ITSELF (判据3 — never a comment).
  let recommendedOrder = "none (nothing recommended — halted)";
  // RANKING EXPOSURE (gap-ac36-recommended-exposes-sort-key AC2): the `ranking` array carries each
  // recommended id's sort axes — `deliveryCritical` / `suiteBlocking` (the two axes candidates.sort
  // ranks on) and its `rank` (0-based position WITHIN `recommended`). Empty while halted (nothing is
  // recommended ⇒ nothing to rank). This is what makes AC36 判据② mechanical: an independent checker
  // (ac36-sortkey-criterion-check.ts) can assert "DC task strictly moved forward / same-family
  // non-DC unchanged / blocking_suite above DC" from two runs' `ranking` arrays instead of a human
  // eyeballing two JSON dumps. The `recommended` STRING array is unchanged (backward compat).
  let ranking = [];
  // DEFER ACCOUNTING (gap-over90-clock-measures-queue-time-not-work-time): the deferred candidates
  // (step-4-skips) accumulate at function scope — empty while halted (nothing is evaluated). Surfaced
  // in the result so the tick can close deferred candidates' open brackets (--close-task --outcome
  // deferred). slot-refill stays PURE; it only reports.
  let deferred = [];
  // PHANTOM-KILLER FALSE-NEGATIVE OBSERVATION POINT (gap-phantom-killer-false-negative-id-not-in-
  // commits AC1): count of ready tasks caught by the BODY-side landed signal (isBodyLanded) that the
  // git-grep hasLandedImplementation MISSED (bodyLanded && !gitLanded). Each is a phantom-killer false
  // negative — an already-landed task whose implementation commits never carried its id, so absent the
  // body-side signal it WOULD have been recommended for dispatch. Declared at function scope so the
  // result surfaces it even when halted (0 — nothing is evaluated while halted).
  let phantomKillerFalseNegativeCaught = 0;
  // AC2/AC3 (gap-delivery-critical-label-at-promote-not-after-dispatch): the delivery-critical tasks
  // EXCLUDED from this round's recommendation because they are IN-FLIGHT (deferred with a
  // `touches-overlap-in-flight` reason — the "被自己挤出 ranking" case: a task already dispatched is
  // self-excluded by its own in-flight touches). An in-flight DC task is legitimately absent from
  // `recommended`/`ranking` (the axis already acted at the PREVIOUS selection that dispatched it); a
  // label applied AFTER dispatch shows up HERE — in-flight, NOT ranked — which is the negative
  // control "派发后补标签不被误记为 AC36 已触发". Empty while halted (nothing is evaluated).
  let deliveryCriticalInFlight = [];
  if (!halt.halted) {
    const sharedFiles = walkFiles(root);
    const expand = (globs) => expandDeclaredTouches(globs, root, sharedFiles);
    // MERGE-WORKTREE SURFACE (tasks/gap-dispatch-gate-blind-to-inflight-merge-worktree): the conflict
    // surfaces of in-flight MERGE worktrees (the merge's uncommitted `git diff --name-only HEAD`).
    // Computed ONCE per evaluation — a merge in flight is a structural condition of the whole dispatch
    // decision, not a per-candidate read. Fail-soft: no merge in flight ⇒ [] (step-4 check 3 is
    // byte-unchanged — the peer arm alone applies, AC4 negative control).
    const mergeSurfaces = computeMergeWorktreeSurfaces(root);
    const metaById = buildTaskMetaById(tasksDir);
    // Concurrency eligibility must also respect closed-bracket-but-live agents' touches — a closed
    // bracket does NOT free the touches a still-live agent is working on.
    const inFlightParsed = [...(inFlight || []), ...(closedButLive || [])].map((t) => ({ id: t.id, touches: parseTouches(t.body) }));
    // NOT-YET-FLIPPED SKIP (gap-slot-refill-repeats-done-eligible-recommendations): ready-pool-check's
    // analyzeTasks already computes the not-yet-flipped exclusion into pool.excluded (reason
    // "not-yet-flipped"). Wire that signal into the candidate path (AC2) — it is disjoint from
    // pool.ready by construction, so this is the literal 4th step-4 check + defense-in-depth. The
    // hasMergeRecord arm inside isNotYetFlippedSkip additionally catches tasks whose work landed on
    // the two-line model's INTEGRATION line (fan-in merged) — invisible to the master-only git-history
    // signal, yet already "已 fan-in 待翻 done".
    const excludedNyfIds = new Set(
      (pool.excluded || []).filter((e) => e.reasons.includes("not-yet-flipped")).map((e) => e.id),
    );
    // DEFER ACCOUNTING (gap-over90-clock-measures-queue-time-not-work-time): every step-4 skip is a
    // DEFER — the candidate is NOT dispatched this round, so its telemetry bracket (if `--task-start`
    // was called before the defer) must be closed via `closure-lag-check.sh --close-task --outcome
    // deferred`, and re-`--task-start`ed when work actually begins. slot-refill stays PURE (never
    // writes) — it surfaces `deferred` so the caller (the tick) can mechanically close those brackets
    // instead of the queue segment silently accruing toward OVER90.
    const candidates = [];
    // MUTEX-CLIQUE LANDED-IGNORE (tasks/gap-slot-refill-clique-ignores-landed-touches): ids of
    // hasLandedImplementation=true candidates that PASS the recommendation exclusion (landed but NOT
    // code-complete — stuck-work with real remaining implementation, gap-ready-pool-worklanded-traps-
    // stuck-work). Their touches must NOT occupy the batch clique (see the assembleBatch call below).
    const landedCandidateIds = new Set();
    const defer = (id, reason) => deferred.push({ id, reason });
    // AC2/AC3 (gap-delivery-critical-label-at-promote-not-after-dispatch): a delivery-critical task
    // deferred by in-flight occupancy (touches-overlap-in-flight) is an IN-FLIGHT DC task — the label
    // arrived after (or at) dispatch, so the task is legitimately absent from this round's ranking.
    // It is surfaced in `delivery_critical_in_flight` (NOT in `recommended`/`ranking`), which is the
    // negative control "派发后补标签不被误记为 AC36 已触发".
    const dcLabels = (task) => Array.isArray(task.labels) && task.labels.includes("delivery-critical");
    const deferInFlightDc = (task, id, reason) => {
      defer(id, reason);
      if (dcLabels(task)) deliveryCriticalInFlight.push(id);
    };
    for (const id of pool.ready) {
      const file = path.join(tasksDir, `${id}.md`);
      if (!fs.existsSync(file)) { defer(id, "task-file-missing"); continue; }
      const text = fs.readFileSync(file, "utf8");
      // step-4 check 1: touches-resolve (majority-missing ⇒ not dispatchable).
      if (checkTaskTouchesResolve(text, root).majorityMissing) { defer(id, "touches-majority-missing"); continue; }
      // step-4 check 2: deps-ready (parent done).
      const task = parseTask(text);
      task.parent = readFrontField(task.frontmatterRaw, "parent");
      // COMPOUND NOT-LEAF (gap-compound-depsreadyfor-structural-deadlock AC2 + invariant
      // compound_parent_not_dispatchable): a `role: compound` parent is an AGGREGATE — it is DONE
      // when its children are done, so it is never leaf work and must NEVER be recommended for
      // dispatch (派发只认叶子). Deferring it here with an explicit reason ALSO stops it reaching the
      // self-touch check — its ## Touches delegate to children by convention, so the absence of a
      // self-file is NOT a self-touch false negative (invariant no_self_touch_false_negative).
      if (readFrontField(task.frontmatterRaw, "role") === "compound") { defer(id, "compound-not-dispatchable"); continue; }
      if (!depsReadyFor(task, metaById)) { defer(id, "deps-not-ready"); continue; }
      // step-4 check 3: concurrency eligibility — disjoint from every currently-running subagent AND
      // from every in-flight MERGE worktree's conflict surface (gap-dispatch-gate-blind-to-inflight-
      // merge-worktree: a merge worktree holding a conflict surface was structurally invisible — the
      // vhs-merge accident — so a task the OUTER deferred as merge-colliding was dispatched anyway by
      // the inner's refill). The merge-worktree arm is checked FIRST so a candidate that collides with
      // a merge surface is deferred with the EXPLICIT merge-worktree reason (AC2: 不再只报 peer), and
      // only merge-clear candidates fall through to the peer arm.
      const parsed = parseTouches(text);
      const mergeBlock = mergeSurfaceBlock(parsed, mergeSurfaces, expand);
      if (mergeBlock.blocked) { deferInFlightDc(task, id, `touches-overlap-in-flight (merge-worktree ${mergeBlock.name})`); continue; }
      let blocked = null;
      for (const inf of inFlightParsed) {
        // DIRECTORY-GLOB SELF-FILE EXEMPTION (tasks/gap-directory-level-tasks-touch-global-lock AC1):
        // the candidate's OWN C8 self-file is excluded from the in-flight overlap when the in-flight
        // side covers it only via a directory glob (e.g. `tasks/*.md`) — a directory-level declaration
        // must not lock the whole queue while its holder is in flight. Genuine overlaps (candidate's
        // other touches / concrete in-flight entries naming the candidate's file) still block
        // (checkTouchesPairInFlight is fail-closed: it delegates to checkTouchesPair and only relaxes
        // the exact self-file-only-glob-driven case).
        if (!checkTouchesPairInFlight(parsed, inf.touches, expand, `tasks/${id}.md`).disjoint) { blocked = inf.id; break; }
      }
      if (blocked) { deferInFlightDc(task, id, `touches-overlap-in-flight (peer ${blocked})`); continue; }
      // step-4 check 4: not-yet-flipped — work already landed (fan-in merged / master-landed), don't
      // re-dispatch a subagent to re-verify it (gap-slot-refill-repeats-done-eligible-recommendations).
      if (isNotYetFlippedSkip({ id, body: text, root, excludedNyfIds })) { defer(id, "not-yet-flipped"); continue; }
      // step-4 check 4b: LANDED-IMPLEMENTATION (gap-slot-refill-recommends-landed-code-complete-tasks)
      // — a ready task whose IMPLEMENTATION is already in the tree (a develop commit whose message
      // contains the id AND changed files outside tasks/) is "已合待翻 done": re-dispatching a subagent
      // would only re-verify already-landed work (the observed B9 force-dispatch chain pointing at
      // code-complete tasks). Stronger than isNotYetFlippedSkip: pure-git evidence that does not depend
      // on the literal `## Acceptance Criteria` heading (the all-checked phantom tasks under `## AC`
      // were invisible to extractSection) — AND gated by the shape-aware completion check so an
      // AC-incomplete landed task (stuck-work with real remaining implementation) stays dispatchable.
      // MUTEX-CLIQUE LANDED-IGNORE (tasks/gap-slot-refill-clique-ignores-landed-touches): the `landed`
      // signal is computed ONCE here and reused below — an AC-incomplete landed task stays a candidate
      // (stuck-work), but its id is recorded so its touches never enter the batch clique.
      // PHANTOM-KILLER FALSE-NEGATIVE BODY-SIDE OR-IN (gap-phantom-killer-false-negative-id-not-in-
      // commits AC2): hasLandedImplementation (the git-grep — commit messages naming <task-id>) misses
      // a landed task whose implementation commits NEVER carry the id (the empirical superseded-modeled
      // shape — deba6463 etc. on develop but messages say "VALID_STATUSES 加 superseded"). OR-in the
      // task-body-side signal (isBodyLanded — ACs 全勾 + 未勾项均为外层验证 ⇒ 视同 landed). The AC1 counter
      // records the false-negative direction (body caught it when the git-grep missed). isLandedCodeComplete
      // gates the union so an AC-incomplete landed task (stuck-work) stays dispatchable — isBodyLanded
      // implies isLandedCodeComplete (both require the same code-complete-except-outer-verification
      // disjunction; isBodyLanded additionally requires total > 0), so the body-side catch always defers.
      const gitLanded = hasLandedImplementation(root, id);
      const bodyLanded = isBodyLanded(text);
      if (bodyLanded && !gitLanded) phantomKillerFalseNegativeCaught++;
      const landed = gitLanded || bodyLanded;
      if (landed && isLandedCodeComplete(text)) { defer(id, "landed-implementation"); continue; }
      // step-4 check 5: C8 SELF-TOUCH (gap-slot-refill-c8-reject-no-backfill) — the dispatch gate
      // (fast-mode-tick-core.md C8) requires the candidate's OWN `tasks/<id>.md` in ## Touches
      // WITHOUT `(new)`. A candidate lacking it is NOT dispatchable — the inner's A15 gate ⑤ would
      // reject it at dispatch. Rejecting it HERE (continue) means it never enters `candidates`, so
      // the loop keeps iterating later-in-sort candidates — BACKFILL: a C8-rejected candidate is
      // replaced by the next dispatchable one instead of being recommended and then rejected by the
      // dispatch side with NO replacement (the "17 dispatchable yet none dispatched" deadlock:
      // pool 有货 + 本 tick 无可派 同时为真).
      if (!selfTouchCheck(text, id).ok) { defer(id, "self-touch-missing-c8"); continue; }
      // SUPERSEDED FILTER (2026-08-11, outer retreat of gap-send-keys-verified): a ready-pool task
      // whose body carries the SUPERSEDED marker (implementation premise deleted by a human ruling)
      // must never be recommended for dispatch — recommending it keeps `recommended` non-empty while
      // nothing is actually dispatchable (dispatchable_disjoint becomes a false reading). Same
      // principle as not-yet-flipped: the marker is the mechanism's signal. Position-based
      // (gap-ac46-superseded-keyword-vs-marker, 2026-08-13): only the bold **SUPERSEDED** MARKER
      // matches — a task merely DISCUSSING the superseded category (e.g. the AC5 sample
      // gap-slot-refill-clique-ignores-landed-touches, whose body names `superseded-capability`) stays
      // dispatchable.
      if (SUPERSEDED_MARKER_RE.test(text)) { defer(id, "superseded"); continue; }
      // RETREATED / 搁置 FILTER (tasks/gap-retreated-state-not-mechanized): a ready task the outer
      // retreated (load-induced red rollback, left `ready` so it stays in the pool) carries the
      // line-start bold `**RETREATED` marker and must never be recommended for dispatch — "等 fix-scope
      // gate land 前不重派" is now a MECHANICAL signal, not a manual skip (the AC53 heartbeat REFUSED
      // root cause: should_refill=true with the retreated tasks recommended, then skipped by hand).
      // Removing the marker (解除搁置) restores dispatchability. Same principle as superseded: the
      // marker is the mechanism's signal, position-based (hard-rule ② — only the bold line-start
      // MARKER matches, a prose mention of "retreated" stays dispatchable).
      if (RETREATED_MARKER_RE.test(text)) { defer(id, "retreated"); continue; }
      // INJECTED DISPATCH GATE (optional): any additional per-candidate check the caller wants to
      // enforce (default none). A rejected candidate (ok:false) is skipped and the loop continues →
      // BACKFILL from later-in-sort candidates, exactly like the built-in step-4 gates — a rejected
      // candidate is never recommended with no replacement.
      if (dispatchGate) {
        const g = dispatchGate({ id, text, task });
        if (g === false || (g && g.ok === false)) { defer(id, "dispatch-gate-reject"); continue; }
      }
      // MUTEX-CLIQUE LANDED-IGNORE (tasks/gap-slot-refill-clique-ignores-landed-touches): record the
      // landed-but-not-code-complete id so the batch clique below can exclude its touches.
      if (landed) landedCandidateIds.add(id);
      candidates.push(parseCandidate(id, text));
    }
    // SUITE-BLOCKING RANK (gap-ready-relevance-blind-to-suite-blocking-signal AC3): a task the
    // consecutive-red-window signal implicates (pool.suite_blocking.tasks — ready-pool-check's
    // blocking_suite axis) ranks FIRST so the refill picks the suite-blocker before any other work.
    // Ties stay id-deterministic. The signal only re-ranks; the step-4 dispatch checks above still
    // gate admission (a suite-blocker that fails touches-resolve/deps/disjoint is never forced in).
    const suiteBlockingIds = new Set((pool.suite_blocking && pool.suite_blocking.tasks) || []);
    // DELIVERY-CRITICAL SECOND AXIS (gap-ac36-delivery-critical-priority-axis): the sort key is now
    // (blocking_suite, delivery_critical, id). `deliveryCritical` comes from parseCandidate (which
    // reads the task's frontmatter `labels` via task-schema's parseTask — reuse, no new parser). A
    // task labeled `delivery-critical` ranks below a suite-blocker but ABOVE plain id order, so the
    // productization-delivery phase's AC tasks are picked by the refill before ordinary pool work.
    // The signal only re-ranks (SIGNAL, not a gate): the step-4 dispatch checks above still gate
    // admission, and a delivery-critical task that fails touches-resolve/deps/disjoint is never
    // forced in.
    candidates.sort((a, b) => {
      const ab = suiteBlockingIds.has(a.id) ? 0 : 1;
      const bb = suiteBlockingIds.has(b.id) ? 0 : 1;
      if (ab !== bb) return ab - bb;
      const ad = a.deliveryCritical ? 0 : 1;
      const bd = b.deliveryCritical ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.id.localeCompare(b.id);
    });
    // MUTEX-CLIQUE LANDED-IGNORE (tasks/gap-slot-refill-clique-ignores-landed-touches): a
    // landed-but-not-flipped task's implementation is ALREADY in the tree — it won't (and shouldn't) be
    // re-dispatched as NEW work, so its touches must NOT occupy the batch clique (they would block a
    // genuinely-dispatchable task that touches the same file — the measured phase-overlap → 2-slot
    // exclusion: P1 dropped from recommended AND deferred, in-clique crowding with no reading). The
    // RECOMMENDATION exclusion (landed && code-complete above) is UNCHANGED; here the landed candidate
    // is removed from the clique computation ONLY, then re-appended AFTER the batch so the stuck-work
    // landed task stays dispatchable (gap-ready-pool-worklanded-traps-stuck-work parity) but never
    // crowds out real work. AC4: two NON-landed tasks touching the same file remain mutually exclusive.
    const cliqueCandidates = landedCandidateIds.size === 0
      ? candidates
      : candidates.filter((c) => !landedCandidateIds.has(c.id));
    const { batch } = assembleBatch(cliqueCandidates, { expand });
    const landedRecommended = landedCandidateIds.size === 0
      ? []
      : candidates.filter((c) => landedCandidateIds.has(c.id)).map((c) => c.id);
    recommended = [...batch, ...landedRecommended].slice(0, slotsFree);
    // AC56 DE-ORDER (gap-ac56-recommended-deordered): the dispatch-consuming `recommended` array must
    // NOT carry a meaningful priority order — an inner that reads "the mechanism's first pick" gets
    // anchored even against its own semantic leanings (SPEC §5; 不去序则新划分只是名义上的). Re-sort
    // lexicographically by id: a deterministic, obviously-meaningless dictionary order (判据1 option 2).
    // The priority sort above (candidates.sort: blocking_suite → delivery_critical → id) still happens
    // and still drives WHICH candidates the greedy disjoint batch admits; it is merely no longer the
    // order of the OUTPUT array. The priority order remains machine-readable in the `ranking`
    // diagnostic below (AC36 判据②), which the inner tick does NOT consume for dispatch — de-ordering
    // `recommended` is the anchor removal; `ranking` stays a verification surface.
    recommended.sort((a, b) => a.localeCompare(b));
    recommendedOrder = "lexicographic-by-id (order meaningless — 字典序，不代表优先级)";
    // Build the ranking array from the PRIORITY-SORTED candidate order (blocking_suite →
    // delivery_critical → id — the same order candidates.sort produced above), filtered to the
    // recommended SET and capped at the same slots_free window. `rank` = position WITHIN the
    // priority-ordered recommendation, NOT the de-ordered `recommended` array's position — this keeps
    // AC36 判据② mechanically assertable (DC strict forward movement / blocking_suite above DC) while
    // the dispatch-facing `recommended` array itself stays de-ordered. deliveryCritical comes from the
    // SAME parseCandidate source the sort used — never a second parser (rule: reuse, no parallel
    // copy). suiteBlocking is derived from the same suiteBlockingIds set the sort's first axis used.
    const recommendedSet = new Set(recommended);
    ranking = candidates
      .filter((c) => recommendedSet.has(c.id))
      .map((c, rank) => ({
        id: c.id,
        deliveryCritical: c.deliveryCritical,
        suiteBlocking: suiteBlockingIds.has(c.id),
        rank,
      }));
  }

  // should_refill — the event-driven go/no-go. Based on the RECOMMENDED set (candidates that pass
  // the step-4 checks AND are disjoint from in-flight), not the raw pool capacity: a pool whose
  // only member fails touches-resolve must not trigger a refill.
  //
  // GAP-OUTER-TICK-CORE-B9-COVERAGE-BLIND-SPOT (2026-08-10): the outer tick-core's B9 force-dispatch
  // branch consumes `should_refill` + `recommended` as the TWO independently-readable preconditions of
  // "空槽强制派发" — should_refill=true AND `recommended` non-empty ⇒ the tick MUST dispatch 1-2 (it is
  // no longer enough that the dispatch QUEUE is empty; a non-empty queue with in_flight=0 and a
  // dispatchable recommendation is the exact blind-spot the tick now forces). `recommended` is emitted
  // as a separate array below precisely so the consumer can read "recommended 非空" without re-deriving
  // it from the boolean — the semantics are: should_refill = (slots_free > 0) ∧ (recommended ≠ ∅).
  // AC6 DEGRADED-MEASUREMENT NULL (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name, 判据5
  // 修法 (a), manager 13:2xZ): when the in-flight view FAILED to measure
  // (measurement_source='degraded-no-telemetry'), the slot-family fields MUST be null — a downstream
  // doing arithmetic on them must CRASH (null arithmetic → NaN) instead of silently computing
  // "5 empty slots" (same-shaped as qualified). The 3b 漏网形态: slot-refill gave an honest
  // measurement_source='degraded-no-telemetry' BUT also reported in_flight_count=0 (identical to
  // "genuinely nothing in flight"), and the gate (inner-wakeup-heartbeat.ts) does NOT read
  // measurement_source (零命中) — it only reads the numbers. Nulling the numbers forces the failure
  // to propagate to the consumer instead of being swallowed.
  const degraded = measurementSource === "degraded-no-telemetry";
  let shouldRefill = slotsFree > 0 && recommended.length >= 1;
  let noRefillReason = null;
  if (halt.halted) {
    // Preemptive halt takes precedence over every other reason — the human's stop is the
    // highest-priority gate (gap-supervisor-preemption: `.halt` is 任意点生效, not tick-boundary).
    shouldRefill = false;
    noRefillReason = `halted (preemption: .halt present — ${halt.reason}; check with supervisor-preempt.sh halt-check)`;
  } else if (degraded) {
    // AC6: a degraded measurement is NOT a valid "0 in-flight" — fail CLOSED (no refill) and say so.
    // slots_free is null here; a consumer reading it gets null, never a silently-computed "5".
    shouldRefill = false;
    noRefillReason = "measurement degraded — in-flight view NOT evaluated (measurement_source='degraded-no-telemetry'); slots_free is null, downstream must not read it";
  } else if (slotsFree <= 0) {
    // AC5 DUAL-CONSUMER SPLIT: the slots consumer's denominator is the NARROW running-subagent count
    // when the caller passed --running, else the wide in-flight fallback.
    noRefillReason = `no free slots (${runningSubagentCount !== null ? `running subagents ${runningSubagentCount}` : `in-flight ${inFlight.length} + closed-but-live ${closedButLive.length}`}${subagentsInFlight > 0 ? ` + subagents ${subagentsInFlight}` : ""} >= cap ${effectiveCap})`;
  } else if (recommended.length === 0) {
    noRefillReason = "no dispatchable candidate passes step-4 checks (touches-resolve / deps-ready / disjoint-from-in-flight / self-touch C8)";
  }

  return {
    cap: effectiveCap,
    base_cap: baseCap,
    effective_cap: effectiveCap,
    // B3 ①/④ ARBITRATION (gap-red-window-cap-trigger-backlog-not-suite-red): the arbitration reading —
    // whether the effective cap was narrowed by the consecutive-red WINDOW and why. `cap` above is the
    // EFFECTIVE (arbitrated) cap every dispatch-recommendation path consumes. `red_window_active` is
    // the TRIGGER (not `suite_red && backlog > threshold`, retired 2026-08-13); `suite_red` and
    // `integration_backlog` are reported as diagnostics.
    arbitration: {
      suite_red: suiteRed,
      red_window_active: redWindowActive,
      integration_backlog: backlog,
      red_backlog_cap: redBacklogCap,
      cap_narrowed: capNarrowed,
      reason: capNarrowed
        ? `red window active ⇒ dispatch cap narrowed ${baseCap}→${effectiveCap}`
        : null,
    },
    floor_mult: floorMult,
    // AC6 DEGRADED-MEASUREMENT NULL (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name, 判据5
    // 修法 (a)): when measurement_source='degraded-no-telemetry', the ENTIRE measured slot family is
    // null (in_flight_count / closed_but_live_count / running_subagent_count / subagents_in_flight /
    // occupied_slots / slots_free) — a downstream arithmetic consumer CRASHES on null instead of
    // silently computing "5 empty slots" (same-shaped as qualified). measurement_source +
    // measurement_error still name WHY (never a silent 0).
    in_flight_count: degraded ? null : inFlight.length,
    closed_but_live_count: degraded ? null : closedButLive.length,
    // AC5 DUAL-CONSUMER SPLIT (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name, 人 2026-08-14
    // 12:5xZ): the NARROW Consumer-B denominator — the currently-RUNNING task subagent count used for
    // occupied_slots / slots_free — plus its provenance. "running-subagents" = the caller passed
    // --running; "in-flight-fallback" = Consumer B reuses the wide in-flight set (backward compat).
    // Distinct from `in_flight_count` (the WIDE Consumer-A denominator, unchanged): the two are
    // ALLOWED to differ (dispatchable_disjoint 分母 ≠ slots_free 分母).
    running_subagent_count: degraded ? null : slotOccupants,
    slot_denominator_source: runningSubagentCount !== null ? "running-subagents" : "in-flight-fallback",
    // NON-TASK SUBAGENTS (gap-telemetry-underreport-nontask-subagents-not-counted-in-slots): the
    // investigation-subagent PROCESS count that occupies slots but carries no task id. Included in
    // occupied_slots/slots_free, never in the touches-disjointness check.
    subagents_in_flight: degraded ? null : subagentsInFlight,
    // MEASUREMENT PROVENANCE (gap-slot-refill-inflight-disconnected-from-worktrees): where the
    // in-flight view came from. "explicit-input" = the caller passed --in-flight/--closed-but-live
    // (the inner tick A12 path); "event-stream-implementing" = measured from the telemetry report's
    // `implementing` segment — start without impl-complete, the Build dispatch count
    // (gap-inflight-states-missing-impl-complete-event; the outer tick A18 / manual bare `--json`
    // path, which previously read a SILENT 0); "degraded-no-telemetry" = the measurement failed and
    // measurement_error names why (never a silent 0).
    measurement_source: measurementSource,
    measurement_error: measurementError,
    occupied_slots: degraded ? null : occupied,
    slots_free: degraded ? null : slotsFree,
    pool: pool.pool,
    floor: pool.floor,
    // AC99 — surface the ready-pool `deficit` (max(0, floor − pool)) so the Manager view's
    // pool/floor/deficit/cap fields all trace to ONE stable-JSON dispatch mechanism (slot-refill).
    deficit: pool.deficit,
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
    // AC56 DE-ORDER ANNOTATION (gap-ac56-recommended-deordered): the explicit "order meaningless"
    // marker on the recommended OUTPUT — a dictionary (lexicographic) order that inner must NOT read
    // as a priority recommendation. Consumed by ac56-recommended-deordered-check.ts (判据3 reads the
    // output itself, not a comment).
    recommended_order: recommendedOrder,
    // DEFER ACCOUNTING (gap-over90-clock-measures-queue-time-not-work-time): every candidate in
    // `pool.ready` that failed a step-4 check (touches-resolve / deps / touches-overlap-in-flight /
    // not-yet-flipped / C8 self-touch / dispatch-gate) is listed here with its reason. These are the
    // candidates whose open telemetry bracket must be closed on defer (--close-task --outcome
    // deferred) so the queue segment never counts toward OVER90. PURE signal — slot-refill never
    // writes brackets; the tick consumes this list to close them.
    deferred,
    // PHANTOM-KILLER FALSE-NEGATIVE (gap-phantom-killer-false-negative-id-not-in-commits AC1): the
    // incident-rate observation point — ready tasks the body-side landed signal caught that the
    // git-grep hasLandedImplementation MISSED (bodyLanded && !gitLanded). 0 here means no
    // false-negative direction observed this evaluation. The empirical 2026-08-13 reading was 1
    // (gap-superseded-modeled-as-task-lifecycle-terminal, of 17 landed-but-not-flipped).
    phantom_killer_false_negative_caught: phantomKillerFalseNegativeCaught,
    // RANKING EXPOSURE (gap-ac36-recommended-exposes-sort-key AC2): per-recommended-id sort axes
    // ({id, deliveryCritical, suiteBlocking, rank}) so AC36 判据②'s "strict forward movement +
    // negative control" is mechanically assertable from the JSON alone.
    ranking,
    // AC2/AC3 (gap-delivery-critical-label-at-promote-not-after-dispatch): the delivery-critical
    // tasks EXCLUDED from this round's recommendation because they are IN-FLIGHT (touches-overlap-
    // in-flight). Distinct from `ranking`/`recommended` (which hold only the dispatchable set): an
    // in-flight DC task is legitimately absent from the ranking, and a post-dispatch label is
    // surfaced HERE as "in-flight, NOT ranked" — the negative control, never a false AC36 trigger.
    delivery_critical_in_flight: deliveryCriticalInFlight,
    scanned: pool.scanned,
  };
}

// ── MEASURED IN-FLIGHT (gap-slot-refill-inflight-disconnected-from-worktrees →
//    gap-inflight-states-missing-impl-complete-event) ──────────────────────────────────────────────────
// A bare `slot-refill --json` (no --in-flight) used to read in_flight_count=0 even while worktrees +
// telemetry showed tasks in flight — a counter disconnected from its source, the same "报零而不是报错"
// family as gap-inbox-counter-disconnected-from-files. The first fix MEASURED the in-flight view from
// the reconcile-aware telemetry `--slot-status` view (real-in-flight kept records + closed-but-live
// agents + non-task subagents). That `--slot-status` derivation is now RETIRED (its worktree/process
// probes are proxy inferences for a missing state): the Build dispatch count reads the event stream's
// IMPLEMENTING segment (start without impl-complete — 真正在实现; the third `impl-complete` event splits
// the start→end span). The inner tick A12 still passes its own maintained --in-flight — that explicit
// path is byte-unchanged. On measurement failure the view degrades to empty BUT the JSON surfaces
// measurement_source="degraded-no-telemetry" + measurement_error — the "0" is never silent again.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TELEMETRY_CLI = path.join(__dirname, "fast-mode-telemetry.ts");

/** Parse `fast-mode-telemetry.ts --report --json` stdout into the IMPLEMENTING segment — the Build
 *  dispatch count (gap-inflight-states-missing-impl-complete-event AC2: 「有 start 无 impl-complete」
 *  = 真正在实现). The `--slot-status` reconcile-derived view is RETIRED (its worktree/telemetry/
 *  process probes are proxy inferences); the event stream's impl-complete boundary is the state record.
 *  PURE: injectable for tests — the subprocess spawn lives in measureImplementingFromTelemetry. */
export function parseImplementingReport(text) {
  const d = JSON.parse(text);
  const implementing = Array.isArray(d.implementing) ? d.implementing : [];
  return {
    implementingIds: implementing.map((r) => r.taskId).filter(Boolean),
    implementingCount: implementing.length,
  };
}

/** Spawn the telemetry `--report` CLI and parse the implementing segment (start without impl-complete).
 *  Any subprocess/parse failure → { ok:false, error } — the caller degrades to empty but MUST surface
 *  the error (never a silent 0). */
export function measureImplementingFromTelemetry({ root }) {
  try {
    const out = execFileSync(process.execPath, [
      "--no-warnings", "--experimental-strip-types", TELEMETRY_CLI,
      "--report", "--json", "--root", root,
    ], { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] });
    return { ok: true, ...parseImplementingReport(out) };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** RESOLVE-BY-TASK-ID (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name): normalize an
 *  in-flight identifier (worktree DIRECTORY name / BRANCH name / true task id) to the TRUE task id.
 *  The `--in-flight`/`--closed-but-live` sets are passed by the caller as the identifiers the inner
 *  tick A12 maintains — which are the WORKTREE SLUGS it created, not necessarily the true task ids.
 *  The `<slug>` convention (fast-mode-loop-tick.md:976/:1043 `git worktree add $WORKTREE_ROOT/<slug>
 *  -b task/<id>`) lets the dispatching agent freely abbreviate: 2026-08-14 实测 `git worktree list`
 *  had `gap-workflows-dual-copy-drift` (true id `…-unchecked` — BOTH dir AND branch truncated) and
 *  `gap-test-isolation-backlog-44` (true id `…-violations-unmeasured` — dir truncated, branch full).
 *  A truncated slug never matches `tasks/<slug>.md`, so the old readTasks SILENTLY dropped it →
 *  in_flight under-counted → slots_free inflated → the AC53 end-invariant gate (should_refill ∧
 *  slots_free>0 ⇒ 拒写) correctly refused a heartbeat write it should NOT have refused. This resolver
 *  matches BY TASK ID so a truncated slug still resolves to the true id — 判据1: the three forms must
 *  agree; 判据3: the AC53 gate is UNCHANGED, only the quantity fed to it is fixed.
 *
 *  Resolution order (deterministic, never guesses):
 *    1. strip a leading `task/` prefix (the branch form).
 *    2. exact: `tasks/<normalized>.md` exists → the identifier IS a true task id.
 *    3. truncated-prefix: EXACTLY ONE task id in the store has <normalized> as a strict prefix → that
 *       longer id is the true task id (the truncated slug resolves to the true id).
 *    4. ambiguous (2+ tasks extend the prefix) or none → return the input UNCHANGED (method
 *       "unresolved") — the caller keeps the advisory skip. Never guess wrong: a wrong id would poison
 *       the touches-disjointness set worse than a missing id (a missing id under-counts, a wrong id
 *       blocks/defers unrelated work).
 *
 *  PURE + read-only. tasksDir is read once per call (readdirSync is one syscall returning names, no
 *  per-file stat) — negligible at the 5-in-flight scale.
 */
export function resolveInFlightId(tasksDir, input) {
  const norm = String(input).replace(/^task\//, "");
  if (fs.existsSync(path.join(tasksDir, `${norm}.md`))) {
    return { id: norm, method: "exact" };
  }
  let match = null;
  let ambiguous = false;
  if (fs.existsSync(tasksDir)) {
    for (const f of fs.readdirSync(tasksDir)) {
      if (!f.endsWith(".md")) continue;
      const id = f.replace(/\.md$/, "");
      if (id.length > norm.length && id.startsWith(norm)) {
        if (match === null) match = id;
        else if (match !== id) { ambiguous = true; break; }
      }
    }
  }
  if (match !== null && !ambiguous) return { id: match, method: "truncated-prefix" };
  return { id: input, method: "unresolved" };
}

function main(argv) {
  let root = null;
  let cap = FIXED_DISPATCH_CAP;
  let floorMult = POOL_FLOOR_MULT_DEFAULT;
  let inFlightIds = [];
  let closedButLiveIds = [];
  let runningIds = [];
  let integrationBacklog = undefined;
  let redBacklogCap = RED_BACKLOG_CAP_DEFAULT;
  // AC5 DUAL-CONSUMER SPLIT (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name): whether the
  // caller passed the NARROW currently-RUNNING subagent set (--running). Consumer B (slots_free) uses
  // it when present; otherwise Consumer B falls back to the wide in-flight set (backward compat).
  let runningExplicit = false;
  // MEASUREMENT PROVENANCE (gap-slot-refill-inflight-disconnected-from-worktrees): whether the caller
  // EXPLICITLY supplied the in-flight view. When NEITHER --in-flight nor --closed-but-live is passed,
  // the in-flight view is MEASURED from the reconcile-aware telemetry --slot-status view — never
  // silently defaulted to 0 (the defect: a bare `slot-refill --json` read 0 while worktree + telemetry
  // showed 2 in-flight).
  let inFlightExplicit = false;
  let closedButLiveExplicit = false;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--json") { /* output is always JSON — accepted for Contract parity */ }
    else if (args[i] === "--cap") cap = Number(args[++i]);
    else if (args[i] === "--floor-mult") floorMult = Number(args[++i]);
    else if (args[i] === "--in-flight") {
      inFlightExplicit = true;
      inFlightIds = String(args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === "--closed-but-live") {
      closedButLiveExplicit = true;
      closedButLiveIds = String(args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === "--running") {
      // AC5 DUAL-CONSUMER SPLIT: the NARROW Consumer-B set — the currently-RUNNING task subagent ids.
      runningExplicit = true;
      runningIds = String(args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === "--integration-backlog") {
      integrationBacklog = Number(args[++i]);
    } else if (args[i] === "--red-backlog-cap") {
      redBacklogCap = Number(args[++i]);
    }
  }
  const rootDir = root ? path.resolve(root) : findRepoRoot(process.cwd());
  // RESOLVE-BY-TASK-ID (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name): each identifier is
  // resolved to the TRUE task id before the file read — a truncated worktree slug (the `<slug>`
  // convention lets the dispatching agent abbreviate) still resolves to the true id, so the in-flight
  // count no longer under-reports and the AC53 gate stops refusing heartbeats it shouldn't. The
  // resolved TRUE id is also what flows into the touches-disjointness set (line 578) — comparing the
  // truncated slug against peers would miss collisions. Unresolved entries stay advisory-skipped
  // (a vanished/unresolved id is not a failure), exactly as before.
  const tasksDir = path.join(rootDir, "tasks");
  const readTasks = (ids) => {
    const out = [];
    for (const id of ids) {
      const resolved = resolveInFlightId(tasksDir, id);
      const file = path.join(tasksDir, `${resolved.id}.md`);
      if (!fs.existsSync(file)) continue; // advisory — a vanished/unresolved id is not a failure
      out.push({ id: resolved.id, body: fs.readFileSync(file, "utf8") });
    }
    return out;
  };
  let inFlight = readTasks(inFlightIds);
  let closedButLive = readTasks(closedButLiveIds);
  let subagentsInFlight = 0;
  let measurementSource = "explicit-input";
  let measurementError = null;
  // MEASURED IN-FLIGHT (gap-slot-refill-inflight-disconnected-from-worktrees): a bare invocation (no
  // --in-flight / --closed-but-live) MEASURES the in-flight view from the authoritative reconcile-aware
  // telemetry `--slot-status` (real-in-flight kept records + closed-but-live agents + non-task
  // subagents). This makes the outer tick A18's bare `slot-refill.ts --cap 5 --json` reading consistent
  // with worktree + telemetry — previously it silently read 0 (and even re-recommended an already
  // in-flight task). The inner tick A12 still passes its own --in-flight (its maintained set is
  // authoritative for its dispatch decision), so the explicit path is unchanged. On measurement failure
  // the view degrades to empty BUT measurement_source="degraded-no-telemetry" + measurement_error are
  // surfaced — never a silent 0.
  if (!inFlightExplicit && !closedButLiveExplicit) {
    const measured = measureImplementingFromTelemetry({ root: rootDir });
    if (measured.ok) {
      inFlight = readTasks(measured.implementingIds);
      closedButLive = [];
      subagentsInFlight = 0;
      measurementSource = "event-stream-implementing";
    } else {
      measurementSource = "degraded-no-telemetry";
      measurementError = measured.error;
    }
  }
  // AC5 DUAL-CONSUMER SPLIT: the NARROW Consumer-B denominator. Each --running id is a LIVE subagent
  // and occupies a slot even if it does not resolve to a task file (a vanished id still runs); resolve
  // + dedupe keeps the reported ids truthful (a truncated slug resolves to the true id; duplicates
  // collapse). When --running is absent, runningSubagentCount stays null ⇒ Consumer B falls back to
  // the wide in-flight set (backward compat).
  const runningSubagentCount = runningExplicit
    ? new Set(runningIds.map((id) => resolveInFlightId(tasksDir, id).id)).size
    : null;
  const result = analyzeSlotRefill({ tasksDir, root: rootDir, cap, floorMult, inFlight, closedButLive, subagentsInFlight, runningSubagentCount, measurementSource, measurementError, integrationBacklog, redBacklogCap });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (isDirectEntry(import.meta, undefined, "slot-refill")) {
  process.exitCode = main(process.argv);
}
