// concurrent-batch-scheduler.mjs — the two-level scheduler's ASSEMBLY core (DIR-044 increment 2; see
// charters/DIR-044-concurrent-scheduler-D3.md Step 2 increment 2). Given rank-ordered candidate
// charters, greedily assemble a maximal touches-DISJOINT, EXECUTION-type batch that touches NO shared
// exp5 state; defer everything else to a later (serial) round. The loop driver then dispatches ONE
// native `Agent(run_in_background=true)` build per batched candidate, each in its own worktree — this
// module computes WHICH candidates may batch (the deterministic, testable decision), it does NOT spawn
// agents and it NEVER touches manda (native-only, DIR-044 constraint).
//
// SINGLE-SOURCE (ADR-004): the disjointness verdict is IMPORTED from touches-orthogonality-check.mjs
// (checkTouchesPair) — never re-implemented here. This module adds only the batch-assembly policy:
// execution-type-only, no-shared-state, conservative-serialize.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseTouches,
  expandGlobs,
  normalizePath,
  matchGlob,
  checkTouchesPair,
} from "./touches-orthogonality-check.ts";
// gap-experiment-legacy-reclaim-and-touches-heuristic AC3: when a candidate charter lacks a
// `## Touches` section, derive a MECHANICAL hint from body prose (derive-touches-heuristic.ts,
// reclaimed from experiments into plugin/scripts) so the scheduler has concrete globs to reason
// about instead of a vacuous conservative "no/empty ## Touches → serialize" defer. The hint is
// labeled `derived` and is NEVER a substitute for anti-drift-touches-check.ts's PRE-MERGE hard gate
// (which verifies ACTUAL `git diff --numstat` files) — a wrong guess can only mis-batch (caught at
// fan-in), never let a bad write land.
import { deriveTouches } from "./derive-touches-heuristic.ts";
// AC36 (gap-ac36-delivery-critical-priority-axis): parseTask is the ONE lenient frontmatter parse
// (task-schema.ts) that reads `labels` — reused here so parseCandidate can expose a
// delivery-critical flag without a second labels parser (slot-refill.ts:250 already uses it).
import { parseTask } from "./task-schema.ts";
// IN-FLIGHT WORKTREE DIRECT QUANTITY (tasks/gap-scheduler-inflight-detection-misses-fan-in-worktree):
// the open-worktree enumerator (`git worktree list --porcelain`) + the `task/<id>`-branch → task-id
// resolver — single source (fast-mode-telemetry's listWorktrees/taskIdFromBranch, not a parallel
// porcelain parser). The in-flight worktree detection below reuses them to find fan-in workflow /
// just-dispatched worktrees the snapshot in-flight set misses.
import { listWorktrees, taskIdFromBranch } from "./fast-mode-telemetry.ts";
// IN-FLIGHT WORKTREE LIVENESS (tasks/gap-compute-inflight-worktree-touches-no-liveness-check):
// the "is any process anchored under this worktree" direct quantity is single-sourced from
// worktree-process-reaper.ts's /proc enumerator (enumerateProcs + cwdUnder), NOT a hand-rolled
// /proc scan — CLAUDE.md 硬规则 1 (用机件，不手搓) and the same /proc predicate the reaper uses.
// For LIVENESS we do NOT exclude real claude sessions (a live inner claude session IS the task
// being worked) and we DO exclude zombies (state "Z" is a dead, un-reaped process — not activity).
import { enumerateProcs, cwdUnder } from "./worktree-process-reaper.ts";
// DIR-117 iteration-2 item 4: the SAME touch-set-expansion arithmetic that
// milestone-preparation-check.ts's `Prepared` gate used to detect a checked Plan outgrowing its
// declared '## Touches'. milestone-preparation-check.ts is retired with the prepare/execute
// pipeline (ADR-022 / gap-retire-the-prepare-execute-pipeline-cluster); this function is the one
// piece the batch scheduler still needs, so it is single-sourced HERE (was: imported from
// ./milestone-preparation-check.ts).
function computeTouchesExpansion(receiptTouches, declaredTouches) {
  if (!Array.isArray(declaredTouches) || !Array.isArray(receiptTouches) || receiptTouches.length === 0) {
    return { expanded: [] };
  }
  const expanded = receiptTouches.filter((t) => !declaredTouches.includes(t));
  return { expanded };
}

// Shared exp5 state — concurrent writes here would conflict, so any candidate declaring it CANNOT be
// batched (its writes must be serialized at fan-in ABSORB). Repo-relative concrete paths.
export const SHARED_STATE_PATHS = [
  "experiments/quay-perpetual-stream/dashboard.md",
  "experiments/quay-perpetual-stream/backlog.md",
  "experiments/quay-perpetual-stream/v-meta-ledger.md",
  "experiments/quay-perpetual-stream/.quay/gate-events.jsonl",
];

// ── parseCandidate ───────────────────────────────────────────────────────────────────────────────
// A candidate = its id + declared `## Touches` + its milestone type (execution | learning | …) + its
// value-type (capability-growth | discovery | instrument-correction | risk-option |
// governance-integrity, per inherited-core.md's value-typed ledger).
// Type is read from a `**type:** <t>` or `type: <t>` line; defaults to "execution".
// Value-type is read from a `**Value type:** <vt>` line (also tolerates the older
// `Value type (per ...): **<vt>**` prose form and camelCase spellings like `instrumentCorrection`,
// DIR-116). Unstated → defaults to "capability-growth" — conservative-PERMISSIVE for backward compat
// with the many pre-DIR-116 charters/fixtures that never declared this field (mirrors the `type`
// field's own unstated-default policy above); the field is only ever used to DEFER, never to admit
// something the touches/type checks would otherwise reject.
export function parseCandidate(id, charterText, repoRoot) {
  const touches = parseTouches(charterText);
  // AC3: mechanical `## Touches` extraction when the charter lacks a `## Touches` section. Only
  // runs when a repoRoot is available (callers pass it; unit tests that pass 2 args skip it, so
  // the conservative no-declaration path is byte-unchanged for them). The derived globs are put in
  // `touches.globs` and marked `derived: true` so checkTouchesPair can reason about them — but a
  // candidate whose body yields ZERO path-shaped tokens stays conservative (hasSection stays false).
  if (!touches.hasSection && repoRoot) {
    const { globs } = deriveTouches(charterText, repoRoot);
    if (globs.length > 0) {
      touches.globs = globs;
      touches.hasSection = true;
      touches.derived = true;
    }
  }
  let type = "execution";
  // Tolerates `type: x`, `**type:** x` (colon inside bold), and `**type**: x`.
  const m = String(charterText).match(/^\s*\*{0,2}type\*{0,2}\s*:\s*\*{0,2}\s*`?([a-z][\w-]*)/im);
  if (m) type = m[1].toLowerCase();
  let valueType = "capability-growth";
  // "value type" / "value-type", not "value-typed" (word-boundary after "type" excludes that word);
  // no `^` anchor — real charters put this field mid-line (e.g. "**Class:** development ·
  // **Value type:** ...") and/or with parenthetical prose between the label and the colon.
  const vm = String(charterText).match(/value[\s-]?type\b[^:\n]*:\s*\*{0,2}\s*`?([a-zA-Z][\w-]*)/i);
  if (vm) valueType = vm[1].toLowerCase();
  // AC36 (gap-ac36-delivery-critical-priority-axis): expose the candidate's frontmatter `labels`
  // (via parseTask — same single-source parse slot-refill.ts uses) and a derived `deliveryCritical`
  // boolean. A candidate with no frontmatter / no such label ⇒ labels=[] / deliveryCritical=false
  // (conservative default). This is what lets slot-refill's candidates.sort rank delivery-critical
  // tasks as a SECOND axis — below blocking_suite, above plain id order.
  const parsed = parseTask(String(charterText));
  const labels = parsed.labels || [];
  const deliveryCritical = labels.includes("delivery-critical");
  return { id, touches, type, valueType, labels, deliveryCritical };
}

// ── isCapabilityGrowth ───────────────────────────────────────────────────────────────────────────
// Normalizes away hyphens/case so both spellings actually seen in the wild — "instrument-correction"
// (kebab, most charters) and "instrumentCorrection" (camelCase, e.g. DIR-109/M185's own charter) —
// compare equal.
function normalizeValueType(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
export function isCapabilityGrowth(valueType) {
  return normalizeValueType(valueType) === "capabilitygrowth";
}

// ── touchesSharedState ───────────────────────────────────────────────────────────────────────────
// True iff any declared glob matches (covers) a known shared-state path.
export function touchesSharedState(globs) {
  for (const g of globs) {
    for (const sp of SHARED_STATE_PATHS) {
      if (g === sp || matchGlob(g, sp)) return true;
    }
  }
  return false;
}

// ── expandDeclaredTouches ────────────────────────────────────────────────────────────────────────
// The pre-dispatch expander for assembleBatch's injected `expand`. It answers "which files do these
// tasks INTEND to touch?", NOT "which files exist right now?" — the dispatch-eligibility question is
// about declared intent, and a task's `## Touches` routinely lists files it will CREATE.
//
// gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet: the previous expander was
// expandGlobs against the live tree, so a task whose `## Touches` pointed ONLY at not-yet-created
// files expanded to an EMPTY set and checkTouchesPair's conservative "matched nothing (likely a
// typo)" branch fired — a false negative that silently serialized a perfectly disjoint pair, and —
// worse — could not NAME the overlapping file when two tasks genuinely collided on a new file it
// reported "your glob is probably a typo" (an instrument that says "matched nothing" while what
// actually happened was "overlap"). The inner loop had already been hand-rolling a workaround
// (normalize the declared path, never touch the filesystem); this function IS that workaround,
// single-sourced in the production entry so the bypass disappears (AC5/AC6).
//
//   - a declared CONCRETE path resolves to itself (normalized) whether or not it exists on disk;
//   - a declared WILDCARD (`*`/`?`) still needs the filesystem to find the concrete set it covers —
//     expandGlobs stays for exactly that; a wildcard that matches nothing is genuinely "likely a
//     typo" and the conservative branch below still fires (AC4 keeps wildcard support).
// expandGlobs itself is UNTOUCHED (it is correct for its own callers, e.g. test selection).
// `files` is an optional PRE-COMPUTED walkFiles(root) list (the walk-once pattern from
// gap-select-preflight-json-real-store-too-slow): ready-pool-check's O(n²) pairwise
// checkTouchesPair scan shares ONE tree walk instead of re-walking per pair. Omitted → walks per
// call (unchanged behavior).
export function expandDeclaredTouches(globs, root, files = null) {
  const set = new Set();
  for (const g of globs) {
    if (/[*?]/.test(g)) {
      for (const f of expandGlobs([g], root, files)) set.add(f);
    } else {
      set.add(normalizePath(g));
    }
  }
  return set;
}

// ── assembleBatch ────────────────────────────────────────────────────────────────────────────────
// Greedy maximal disjoint batch over rank-ordered candidates. A candidate JOINS iff:
//   - type is a batchable execution type (NOT learning — learning is always serial), AND
//   - value-type is capability-growth (DIR-116 — the one real residual gap from DIR-057 not covered
//     by DIR-066/106/107: a governance-integrity/instrument-correction/discovery/risk-option-typed
//     candidate is exactly the class of work DIR-057's safety argument meant to exclude, even when it
//     avoids the narrower learning-type/shared-state checks below), AND
//   - it does not touch shared state, AND
//   - its `## Touches` is well-declared (checkTouchesPair's conservative rules pass against the batch),
//     AND it is touches-disjoint from EVERY candidate already in the batch.
// The first eligible candidate anchors the batch; ineligible/overlapping ones are deferred with a
// reason. `expand(globs) → Set<path>` is injected (CLI passes an fs-backed expander).
export function assembleBatch(candidates, { expand }) {
  const batch = [];      // parsed candidates admitted
  const deferred = [];
  for (const c of candidates) {
    if (isLearning(c.type)) {
      deferred.push({ id: c.id, reason: `learning-type ("${c.type}") is never batched — always serial` });
      continue;
    }
    if (!isCapabilityGrowth(c.valueType)) {
      deferred.push({
        id: c.id,
        reason: `value-type ("${c.valueType}") is not capability-growth — non-capability-growth work must serialize (deferred to fan-in ABSORB)`,
      });
      continue;
    }
    if (c.touches.hasSection && touchesSharedState(c.touches.globs)) {
      deferred.push({ id: c.id, reason: "touches shared exp5 state — must serialize (deferred to fan-in ABSORB)" });
      continue;
    }
    // Disjoint from every already-admitted candidate? Reuse the single-source verdict.
    let blocked = null;
    for (const inBatch of batch) {
      const r = checkTouchesPair(c.touches, inBatch.touches, expand);
      if (!r.disjoint) { blocked = { peer: inBatch.id, reason: r.reason, overlaps: r.overlaps }; break; }
    }
    if (blocked) {
      // gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet AC2: NAME the overlapping
      // file(s). The old reason stopped at "overlapping file-sets"; with declared-path expansion an
      // overlap is often on a not-yet-created file (both tasks will create the same path) — a
      // verdict that only says "not disjoint" makes a reader hunt for a typo that isn't there.
      const overlapTail = blocked.overlaps?.length ? ` (overlap: ${blocked.overlaps.join(", ")})` : "";
      deferred.push({ id: c.id, reason: `not disjoint from ${blocked.peer}: ${blocked.reason}${overlapTail}` });
      continue;
    }
    // A lone anchor still must have a well-declared touches (else it is unsafe to reason about even
    // solo — conservative). Probe it against itself via the conservative gate.
    if (batch.length === 0) {
      const self = checkTouchesPair(c.touches, c.touches, expand);
      if (!self.disjoint && !isSelfOverlapOnly(self)) {
        deferred.push({ id: c.id, reason: `ill-declared touches: ${self.reason}` });
        continue;
      }
    }
    batch.push(c);
  }
  return { batch: batch.map((c) => c.id), deferred };
}

// ── worktreeDispatchEligibility ─────────────────────────────────────────────────────────────────
// DIR-123: the SINGLE pre-dispatch safety decision for which candidates may be dispatched CONCURRENTLY
// under execute-milestone.js's `isolationMode:'worktree'`. A thin, explicitly-named wrapper over
// assembleBatch — the disjointness verdict is STILL checkTouchesPair (imported from
// touches-orthogonality-check.ts), NEVER a second eligibility checker (DIR-123 Requested-action #7:
// this directive is about EXECUTION isolation, not re-deciding which tasks may batch).
//
// SAME-FILE-CONFLICT RESOLUTION (DIR-123 Requested-action #5, the explicit decision): two candidates
// whose `## Touches` expand to OVERLAPPING file-sets are REJECTED PRE-DISPATCH — the later one is
// deferred to a serial round (it lands in `mustSerialize` tagged `sameFileConflict:true`), NOT admitted
// to run concurrently and left to collide at Land. Land's own real-merge-conflict handling
// (milestone-worktree.ts mergeWorktree → outcome:"conflict" → auto-abort + needs-human, never a blanket
// --ours/--theirs) is the DEFINED backstop for an UNDECLARED touch that slips past this check — never the
// primary mechanism. Returns {eligible:[ids], mustSerialize:[{id, reason, sameFileConflict}]}.
export function worktreeDispatchEligibility(candidates, { expand }) {
  const r = assembleBatch(candidates, { expand });
  const mustSerialize = r.deferred.map((d) => ({
    id: d.id,
    reason: d.reason,
    // "overlapping file-sets" is checkTouchesPair's concrete-overlap verdict (assembleBatch wraps it as
    // "not disjoint from <peer>: overlapping file-sets"). Distinguish it from the OTHER serialize reasons
    // (learning-type / shared-state / non-capability-growth / conservative ill-declared touches) so the
    // DIR-123 same-file-conflict fixture asserts on the conflict case specifically, not a conservative one.
    sameFileConflict: /overlapping file-sets/i.test(d.reason),
  }));
  return { eligible: r.batch, mustSerialize };
}

// ── applyPreparationExpansion ────────────────────────────────────────────────────────────────────
// DIR-117 iteration-2 item 4: a candidate's declared '## Touches' can go stale once its checked
// Plan (a real milestone-preparation-check.ts receipt's `.touches`) covers MORE than what the
// charter/task originally declared. Detecting this in isolation (milestone-preparation-check.ts's
// own `touches-expanded` code, run against ONE candidate at a time) is necessary but not
// sufficient — a real batch candidate must be RE-EVALUATED against the WHOLE batch using the
// EXPANDED set, not silently admitted/blocked using the stale narrower declaration. `receiptsById`
// is an optional `{candidateId: receiptFile}` map; a candidate with no entry (or an unreadable/
// missing receipt) is returned UNCHANGED — this never invents an expansion the caller didn't ask
// to check for, matching the Prepared gate's own opt-in posture (DIR-117's back-compat rule).
export function loadReceiptTouches(receiptFile) {
  if (!receiptFile || !fs.existsSync(receiptFile)) return null;
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
    return Array.isArray(receipt.touches) ? receipt.touches : null;
  } catch {
    return null;
  }
}

export function applyPreparationExpansion(candidates, receiptsById) {
  if (!receiptsById) return { candidates, expansions: [] };
  const expansions = [];
  const expanded = candidates.map((c) => {
    const receiptFile = receiptsById[c.id];
    const receiptTouches = loadReceiptTouches(receiptFile);
    if (!receiptTouches) return c;
    const { expanded: newPaths } = computeTouchesExpansion(receiptTouches, c.touches.globs);
    if (newPaths.length === 0) return c;
    expansions.push({ id: c.id, addedGlobs: newPaths });
    return { ...c, touches: { ...c.touches, globs: [...c.touches.globs, ...newPaths] } };
  });
  return { candidates: expanded, expansions };
}

function isLearning(type) {
  // Conservative: any type MENTIONING "learning" (not only a leading token) is treated as learning
  // and never batched — hardening from the DIR-044 increment-4 audit (a "…-learning" type must not
  // sneak into a batch).
  return /learning/i.test(String(type));
}

// checkTouchesPair(x, x) returns disjoint:false with reason "overlapping file-sets" (a set overlaps
// itself). That self-overlap is expected and does NOT indicate an ill-declared candidate; a
// CONSERVATIVE reason (absent/overbroad/empty) DOES. Distinguish them.
function isSelfOverlapOnly(result) {
  return /overlapping file-sets/i.test(result.reason);
}

// ── IN-FLIGHT WORKTREE DETECTION (tasks/gap-scheduler-inflight-detection-misses-fan-in-worktree) ──
// The dispatch gate's in-flight set was a SNAPSHOT (telemetry brackets / a historical in-flight id
// list) that misses two live shapes: a fan-in workflow (its worktree exists but the subagent is a
// WORKFLOW, not a standalone Agent) and a just-`git worktree add`-ed worktree (subagent not yet
// started / already running). Both are DIRECT quantities only `git worktree list` sees — the same
// 硬规则 4b family as resource.node_count's comm regex and outer.ticklog's line-shape predicate: a
// snapshot stops updating exactly when the thing it tracks is mid-flight, so it reads "nothing in
// flight" precisely when there IS. These helpers enumerate open TASK worktrees and resolve each to
// its declared `## Touches` so the touches-overlap judgment (slot-refill step-4) can treat a fan-in /
// just-dispatched worktree as in-flight. Fail-soft throughout: no worktree / unreadable list / no task
// file / no declared Touches ⇒ [] (never a fabricated block — hard rule 5: absent evidence is not a
// verdict).

/** PURE core: resolve an open-worktree listing to in-flight task entries `[{id, touches}]`. The
 *  worktree list is INJECTED (listWorktrees output) so tests exercise the resolution without faking
 *  git; `computeInFlightWorktreeTouches` is the production wiring. A worktree is in-flight when it is
 *  NOT the main checkout AND checks out a `task/<id>` branch (the fast-mode convention — both the
 *  dispatched worktree and the fan-in workflow that later runs in it stay on `task/<id>`). Its
 *  conflict surface is the task's DECLARED `## Touches` (the same declared-path surface the peer arm
 *  uses), so the resolution only keeps worktrees whose task file exists AND declares a Touches section.
 *  @param {Array<{path:string, branch:string|null}>} worktrees from listWorktrees (inject in tests)
 *  @param {object} o
 *  @param {string} o.root main checkout root (the main worktree is excluded)
 *  @param {string} o.tasksDir the task store dir (`<root>/tasks`)
 *  @param {(wt:{path:string,branch:string|null}) => ({hasLiveProcess:boolean, lastCommitMs:number|null})|null|undefined} [o.liveness]
 *         injected per-worktree liveness facts; null (default) ⇒ every worktree is alive (pre-fix).
 *  @param {number} [o.nowMs] fixed "now" for hermetic staleness tests (default Date.now())
 *  @param {number} [o.staleMs] the staleness threshold (default INFLIGHT_WORKTREE_STALE_MS)
 *  @returns {Array<{id:string, touches:object}>} resolvable in-flight task worktrees
 */
/** Staleness threshold for in-flight worktree LIVENESS (gap-compute-inflight-worktree-touches-
 *  no-liveness-check): a worktree whose only "in-flight" evidence is its EXISTENCE — ZERO live
 *  processes AND no commit on its branch for longer than this — is DEAD and must not occupy its
 *  declared `## Touches` (a single dead worktree can otherwise lock out every overlapping
 *  candidate; the live-process signal dominates, so this threshold only governs the zero-process
 *  backstop — e.g. a just-`git worktree add`-ed worktree whose subagent has not spawned yet). */
export const INFLIGHT_WORKTREE_STALE_MS = 15 * 60 * 1000;

/** The dead predicate: ALIVE unless BOTH direct quantities prove otherwise — (a) zero live
 *  processes under the worktree, AND (b) a known commit time older than `staleMs`. Unknown
 *  liveness (`lv` null) or an unreadable commit time (null) is ALIVE (conservative — excluding
 *  without evidence could dispatch a colliding task; hard rule 6: 缺值 = 未查, not 为假). */
function isDeadInFlightWorktree(lv, nowMs, staleMs) {
  if (!lv) return false; // no liveness facts ⇒ alive (backward-compatible, conservative)
  if (lv.hasLiveProcess) return false; // a live process ⇒ alive regardless of commit age
  const last = lv.lastCommitMs;
  if (typeof last !== "number" || !Number.isFinite(last)) return false; // unknown commit ⇒ alive
  return nowMs - last > staleMs; // zero processes AND stale ⇒ dead
}

/** The worktree HEAD's committer time (ms), or null when unreadable. `git -C <worktree> log -1`
 *  reads the worktree's OWN checked-out HEAD — the direct "last commit in THIS worktree" quantity,
 *  independent of the main checkout's branch namespace (a deleted-but-still-listed branch still
 *  resolves via its worktree HEAD). */
function lastCommitMsOfWorktree(worktreePath) {
  try {
    const out = execFileSync("git", ["-C", worktreePath, "log", "-1", "--format=%ct"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    const line = out.trim();
    if (line && /^\d+$/.test(line)) return Number(line) * 1000;
  } catch (_) { /* unreadable worktree HEAD — conservative alive (null) */ }
  return null;
}

export function resolveInFlightWorktrees(worktrees, {
  root,
  tasksDir,
  liveness = null,
  nowMs = Date.now(),
  staleMs = INFLIGHT_WORKTREE_STALE_MS,
} = {}) {
  const mainRoot = root ? path.resolve(root) : null;
  const seen = new Set();
  const out = [];
  for (const wt of worktrees || []) {
    if (!wt || !wt.path) continue;
    if (mainRoot !== null && path.resolve(wt.path) === mainRoot) continue; // the main checkout is not in-flight
    const id = taskIdFromBranch(wt.branch);
    if (!id) continue; // a non-task branch (integration / feat / milestone / detached) is not a task worktree
    if (seen.has(id)) continue; // dedup: one task → one in-flight entry even if listed twice
    seen.add(id);
    const file = path.join(tasksDir, `${id}.md`);
    if (!fs.existsSync(file)) continue; // a task worktree whose task file is gone blocks nothing
    const touches = parseTouches(fs.readFileSync(file, "utf8"));
    if (!touches.hasSection) continue; // no declared Touches ⇒ no usable conflict surface
    // LIVENESS: a DEAD worktree (zero live processes + no commit within staleMs) does not occupy
    // its Touches — `liveness` is INJECTED (null ⇒ every worktree is alive, the pre-fix behavior)
    // so the pure core stays testable without faking /proc or git.
    const lv = liveness ? liveness(wt) : null;
    if (isDeadInFlightWorktree(lv, nowMs, staleMs)) continue;
    out.push({ id, touches });
  }
  return out;
}

/** Production wiring: enumerate open worktrees via `git worktree list --porcelain` (the DIRECT
 *  quantity) and resolve them to in-flight task entries, applying the liveness DIRECT quantity
 *  (live processes under each worktree + its HEAD commit time). Fail-soft: an unreadable worktree
 *  list / process table / HEAD ⇒ [] or conservative-alive, never a fabricated block. */
export function computeInFlightWorktreeTouches(root, tasksDir) {
  const worktrees = listWorktrees(root);
  // Enumerate live processes ONCE (shared across every worktree) — the /proc scan is the cost, and
  // it must not be re-done per worktree. A process whose cwd is under the worktree and is not a
  // zombie is live activity.
  const procs = enumerateProcs();
  return resolveInFlightWorktrees(worktrees, {
    root,
    tasksDir,
    liveness: (wt) => ({
      hasLiveProcess: procs.some((p) => p.state !== "Z" && cwdUnder(p.cwd, wt.path)),
      lastCommitMs: lastCommitMsOfWorktree(wt.path),
    }),
  });
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage() {
  process.stderr.write("Usage: concurrent-batch-scheduler.mjs [--root <dir>] <charter1.md> <charter2.md> [charterN.md ...]\n");
}

export async function main(argv) {
  const args = argv.slice(2);
  let root = null;
  // --json: emit { batch, deferred } as JSON instead of the human-readable lines. The batch /
  // deferred fields are what the task contract's measures read (gap-dispatch-eligibility-blind-to-
  // files-that-do-not-exist-yet: `node --experimental-strip-types plugin/scripts/concurrent-batch-
  // scheduler.ts --json`).
  let json = false;
  // DIR-117 iteration-2 item 4: `--receipts id1=file1.json,id2=file2.json` — optional, maps a
  // candidate id (charter basename, no .md) to a real milestone-preparation-check.ts receipt file.
  // Omitted entirely → byte-for-behavior unchanged (golden replay for every pre-existing call).
  let receiptsById = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") { root = args[++i]; continue; }
    if (args[i] === "--json") { json = true; continue; }
    if (args[i] === "--receipts") {
      receiptsById = {};
      for (const pair of args[++i].split(",")) {
        const eq = pair.indexOf("=");
        if (eq > 0) receiptsById[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      }
      continue;
    }
    files.push(args[i]);
  }
  if (files.length < 1) { usage(); return 2; }
  for (const f of files) {
    if (!fs.existsSync(f)) { process.stderr.write(`ERROR: charter not found: ${f}\n`); return 2; }
  }
  const expandRoot = root ? path.resolve(root) : repoRoot(path.resolve(path.dirname(files[0])));
  // gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet: eligibility compares DECLARED
  // paths, not the filesystem — a task creating only NEW files must not be judged "matched nothing
  // (likely a typo)". Concrete declared paths resolve to themselves (whether or not they exist yet);
  // only wildcards are expanded against the tree (expandDeclaredTouches).
  const expand = (globs) => expandDeclaredTouches(globs, expandRoot);
  const parsedCandidates = files.map((f) =>
    parseCandidate(path.basename(f, ".md"), fs.readFileSync(f, "utf8"), expandRoot)
  );
  const { candidates, expansions } = applyPreparationExpansion(parsedCandidates, receiptsById);
  for (const e of expansions) {
    process.stdout.write(`  re-evaluated (checked Plan expanded '## Touches'): ${e.id} — +${e.addedGlobs.length} path(s): ${e.addedGlobs.join(", ")}\n`);
  }
  const r = assembleBatch(candidates, { expand });
  if (json) {
    process.stdout.write(JSON.stringify({ batch: r.batch, deferred: r.deferred }, null, 2) + "\n");
  } else {
    process.stdout.write(`BATCH (${r.batch.length}-wide, concurrent): ${r.batch.join(", ") || "(none)"}\n`);
    for (const d of r.deferred) process.stdout.write(`  deferred: ${d.id} — ${d.reason}\n`);
  }
  // Exit 0 always (assembly succeeded); a caller inspects the batch. A 1-wide-or-empty batch is a
  // valid outcome (fully serial), not an error.
  return 0;
}

// gap-config-wiring-check-symlink-noop: same root cause as config-wiring-check.ts's fix (confirmed,
// not assumed — see that file's comment). Raw string equality between `process.argv[1]` (never
// resolved through a symlink) and `fileURLToPath(import.meta.url)` (always resolved through
// symlinks by Node's ESM loader) can never hold when this script is invoked via the
// `experiments/quay-perpetual-stream/scripts/` mirror symlink, so `main()` silently never runs.
// Resolving both sides through `fs.realpathSync` fixes the mirror path to behave identically to
// the real path instead of silently no-opping.
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    // Bundling-safe direct-invocation check. Under esbuild (package.sh
    // build-plugin-dist.mjs) `import.meta.url` is the BUNDLE path for every inlined
    // module, so the historical `realpath(argv[1]) === fileURLToPath(import.meta.url)`
    // comparison would report TRUE for every guarded module in the bundle — an imported
    // dependency would hijack the entry's CLI (verified: dist/ready-pool-check.js ran
    // this module's main instead of ready-pool-check's). Compare the invoked file's
    // basename against THIS module's own basename instead: in the source tree the
    // directly-run file is `concurrent-batch-scheduler.ts` (or the mirror symlink of the
    // same name); in a bundle it is `dist/concurrent-batch-scheduler.js`. Both reduce to
    // the same base name, and no other entry shares it. The basename survives the mirror
    // symlink, preserving the original realpathSync intent.
    const invoked = path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "");
    return invoked === "concurrent-batch-scheduler";
  } catch {
    return false;
  }
}

const isDirect = isDirectInvocation();
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
