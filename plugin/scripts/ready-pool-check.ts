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
//        (a) not-yet-flipped — the declared work has LANDED on master (task-status-drift-check's
//            symbol-resolution / touch-file evidence) but status is still `ready` (this batch's work
//            is done, waiting fan-in to flip to `done`); mechanically: taskWorkLanded(body) — does
//            NOT depend on AC checkbox state (the fan-in merges without ticking ACs)
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
// Run:
//   node --experimental-strip-types plugin/scripts/ready-pool-check.ts [--root <repo>]
//       [--cap <n>] [--floor-mult <n>] [--in-flight <id1,id2>] [--top <n>] [--json]
//   --cap / --floor-mult   override the derived floor (default cap=3, floor-mult=4 ⇒ floor 12)
//   --in-flight            task ids of currently in-flight subagents (ranked against for disjointness)
//   --top <n>              also emit `top_relevance` — the top-n todos by relevance signal (AC2)
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
import { parseTask, extractSection } from "./task-schema.ts";
import {
  checkTaskTouchesResolve,
  findRepoRoot,
  parseTouches,
  checkTouchesPair,
} from "./touches-orthogonality-check.ts";
// The dispatch gate's OWN declared-path expander (single-source — ready-pool-check must not carry a
// parallel copy of "which files does a Touches declaration intend to touch?").
import { expandDeclaredTouches } from "./concurrent-batch-scheduler.ts";
import { isDirectEntry } from "./gate-script-base.ts";
// Reused "work has landed on master" signal (AC6: reuse, never a parallel copy) — the same
// symbol-resolution / touch-file evidence task-status-drift-check.ts uses to judge landing.
import { taskWorkLanded } from "./task-status-drift-check.ts";

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

/** floor = cap × floorMult (default 4×). The one definition of the floor; analyzeTasks calls this. */
export function computePoolFloor(cap = CONCURRENCY_CAP_DEFAULT, floorMult = POOL_FLOOR_MULT_DEFAULT) {
  return cap * floorMult;
}

/** Minimum non-whitespace content for a section to count as a real artifact (mirrors
 *  quay-native store.ts MIN_SECTION_CHARS — a heading followed by one word is not an artifact). */
export const MIN_SECTION_CHARS = 40;

/** Task-level PARKED marker: a bold `**PARKED` in the body. Plain-text "PARKED" in AC prose
 *  (e.g. this very task's exclusion-rule description) is NOT a marker — matched only when bolded. */
export const PARKED_MARKER_RE = /\*\*PARKED\b/i;

/** Strategic-trace reference: a body mention of a written strategic artifact — a `FINDING-*`,
 *  `RESEARCH-*` or `GOAL-*` finding/strategy doc, or the `REVIEW-cadence` doc whose (b) checklist
 *  items ARE those docs (REVIEW-cadence 3b: gap-* traceability to written strategic questions).
 *  Mechanical grep — no human scoring (gap-value-prioritization-has-no-mechanism AC1/AC3). */
export const STRATEGIC_TRACE_RE = /\b(?:FINDING|RESEARCH|GOAL)-[A-Za-z0-9_.-]+|REVIEW-cadence\b/g;

/** Collect every strategic-doc reference in a task body (deduped, first-seen order, trailing `.md`
 *  normalized away so `FINDING-x` and `FINDING-x.md` are one reference). Pure + mechanical. The
 *  regex is intentionally CASE-SENSITIVE and excludes `/`: the store's strategic docs are uppercase
 *  `FINDING-*`/`RESEARCH-*`/`GOAL-*` filenames, and a lowercase hyphenated compound like
 *  `finding-ledger` (an adapter name) or a prose `FINDING-* /` (REVIEW-cadence's wildcard phrasing)
 *  must NOT count as a strategic-doc reference. */
export function collectStrategicRefs(body) {
  const seen = [];
  const re = new RegExp(STRATEGIC_TRACE_RE.source, STRATEGIC_TRACE_RE.flags);
  let m;
  while ((m = re.exec(body)) !== null) {
    const ref = m[0].replace(/\.md$/, "");
    if (!seen.includes(ref)) seen.push(ref);
  }
  return seen;
}

/** The relevance signal — the manager layer's prioritization function
 *  (gap-value-prioritization-has-no-mechanism AC1/AC3, cross-referenced with
 *  gap-productize-the-manager-layer AC5: 排序职能挂 manager 层). Three MECHANICAL components, no
 *  human scoring:
 *    strategicTrace — the body references a written strategic artifact (FINDING-*, RESEARCH-*,
 *                     GOAL-* or REVIEW-cadence), via grep;
 *    unblocks       — how many non-done tasks carry this candidate as their `parent` (field-based
 *                     blocking: completing the candidate unblocks those children);
 *    costTouches    — the candidate's `## Touches` parsed scale (declared glob count, the same
 *                     single-source parseTouches the dispatch gate uses); smaller is cheaper.
 *  relevanceScore is ONE integer encoding the lexicographic priority (strategicTrace DOMINATES
 *  unblocks, which DOMINATES cost): trace ±100, unblocks ±10 (capped 9 ⇒ 90), cost ±≤5. A non-trace
 *  candidate maxes at 9×10 + 5 = 95 < 100, so trace always wins; within a trace tier, unblocks always
 *  beats cost (10 > 5). The sort in analyzeTasks' top_relevance uses this score, then kindOrder
 *  (gap>DIR preserved as the final tiebreak), then id. */
export function computeRelevance(id, task, allTasks) {
  const body = task.body || "";
  const strategicRefs = collectStrategicRefs(body);
  const strategicTrace = strategicRefs.length > 0;

  let unblocks = 0;
  for (const [otherId, other] of allTasks) {
    if (otherId === id) continue;
    if (other.parent && other.parent === id && other.status !== "done") unblocks++;
  }

  const parsed = parseTouches(body);
  const costTouches = parsed.hasSection ? parsed.globs.length : 0;

  const relevanceScore =
    (strategicTrace ? 100 : 0) +
    Math.min(unblocks, 9) * 10 +
    Math.max(0, 5 - costTouches);

  return { strategicTrace, strategicRefs, unblocks, costTouches, relevanceScore };
}

/** A mechanical one-line reason for a ranked candidate (AC2's "理由"), built from the signal
 *  components + the dispatch-eligibility facts a manager needs to answer "下一条该派谁". */
export function relevanceReason(c) {
  const r = c.relevance;
  const parts = [];
  parts.push(r.strategicTrace ? `strategic-traceable (${r.strategicRefs.join(", ")})` : "no-strategic-trace");
  parts.push(r.unblocks > 0 ? `unblocks ${r.unblocks}` : "unblocks 0");
  parts.push(`cost ${r.costTouches} touches`);
  parts.push(`score ${r.relevanceScore}`);
  if (c.eligible) parts.push("eligible");
  else {
    if (!c.depsReady) parts.push("deps NOT-ready");
    if (!c.fourArtifacts) parts.push(`four-artifacts INCOMPLETE (${c.missingArtifacts.join(",")})`);
    if (!c.touchesResolve) parts.push("touches MISSING");
  }
  return parts.join(" · ");
}

// Shape-aware registered sections (mirrors quay-native store.ts SHAPE_REGISTRY, single-source shape
// dispatch: contract → finding → plan; unknown fails closed). The four artifacts are the shape's own
// registered sections — a `finding`-shape task has no plan dimension, a `contract`-shape task uses
// `## Contract` as its plan artifact.
const SHAPE_SECTIONS = {
  contract: {
    proposal: ["Proposal"],
    plan: ["Contract"],
    ac: ["AC", "Acceptance Criteria"],
    dod: ["DoD", "Definition of Done"],
  },
  finding: {
    proposal: ["Finding"],
    ac: ["AC", "Acceptance Criteria"],
    dod: ["DoD", "Definition of Done"],
  },
  plan: {
    proposal: ["Proposal"],
    plan: ["Plan"],
    ac: ["AC", "Acceptance Criteria"],
    dod: ["DoD", "Definition of Done"],
  },
};

/** Detect a task body's shape by exact heading presence (contract → finding → plan → unknown). */
export function detectShape(body) {
  if (/^##\s+Contract\s*$/im.test(body)) return "contract";
  if (/^##\s+Finding\s*$/im.test(body)) return "finding";
  if (/^##\s+Plan\s*$/im.test(body)) return "plan";
  return "unknown";
}

function sectionNonWsLength(body, heading) {
  const sec = extractSection(body, heading);
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

/** True when the task is in the "this batch done, not yet flipped to done" state — the declared
 *  work has landed on master (task-status-drift-check's symbol-resolution / touch-file / git-history
 *  evidence) but `status` is still `ready` (fan-in has not flipped it). Deliberately does NOT depend
 *  on AC checkbox state: the inner's fan-in merges WITHOUT ticking AC boxes, so all-checked is not
 *  the closeout signal (gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool). taskId is
 *  passed through so the git-history signal (gap-ready-pool-taskworklanded-underdetects-prose-ac-
 *  merged-tasks) can anchor on the task's own id without depending on the self-touch Touches entry. */
export function notYetFlipped(task, repoRoot) {
  if (task.status !== "ready") return false;
  return taskWorkLanded(task.body, repoRoot, { taskId: task.id });
}

export function isFixture(task) {
  return (task.labels || []).includes("fixture");
}

export function isParked(task) {
  return PARKED_MARKER_RE.test(task.body);
}

function depsReadyFor(task, allTasks) {
  const parent = task.parent;
  if (!parent || parent === "null" || parent === "~") return true;
  const p = allTasks.get(parent);
  // Parent file missing → cannot confirm done → fail closed (conservative, not dispatchable).
  if (!p) return false;
  return p.status === "done";
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

function buildCandidate(id, task, root, allTasks, poolParsed, inFlightParsed, expand) {
  const kind = classifyKind(id);
  const touches = checkTaskTouchesResolve(task.body, root);
  const touchesResolve = !touches.majorityMissing;
  const depsReady = depsReadyFor(task, allTasks);
  const four = artifactsComplete(task.body);
  const parsed = parseTouches(task.body);
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
    // AC1 (gap-value-prioritization-has-no-mechanism): every candidate carries the relevance signal —
    // strategic traceability (grep) + blocking (parent/children fields) + cost (touches parsed scale).
    relevance: computeRelevance(id, task, allTasks),
    // AC5: the touchesResolve guard is KEPT — majority-missing candidates are never eligible.
    eligible: depsReady && four.complete && touchesResolve,
  };
}

function buildReport({ pool, floor, cap, floorMult, dispatchableDisjoint, criterionMet, poolBigAllColliding, deficit }) {
  let s = `pool ${pool}/${floor} (floor = cap(${cap}) × ${floorMult}) · dispatchable_disjoint ${dispatchableDisjoint}/${cap}`;
  s += criterionMet
    ? " — criterion met (≥cap mutually-disjoint candidates)"
    : " — criterion NOT met (<cap mutually-disjoint candidates)";
  if (poolBigAllColliding) s += " · POOL BIG BUT ALL COLLIDING (pool ≥ floor yet dispatchable_disjoint < cap)";
  if (deficit > 0) s += ` · deficit ${deficit}`;
  return s;
}

/** Analyze a task store. Returns { pool, floor, cap, floorMult, deficit, dispatchable_disjoint,
 *  criterion_met, pool_big_all_colliding, report, ready, excluded, candidates, promotions,
 *  scanned }. `root` is the repo root used to resolve `## Touches` existence claims; `tasksDir`
 *  defaults to `<root>/tasks`; `cap`/`floorMult` derive the floor (default 3×4 ⇒ 12); `inFlight`
 *  is an optional array of `{ id, body }` for currently in-flight tasks (ranked against). */
export function analyzeTasks({ tasksDir, root, cap = CONCURRENCY_CAP_DEFAULT, floorMult = POOL_FLOOR_MULT_DEFAULT, inFlight = [], top = 0 }) {
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

  // Real ready pool: `status: ready` minus the three non-dispatchable classes.
  const ready = [];
  const excluded = [];
  for (const [id, t] of allTasks) {
    if (t.status !== "ready") continue;
    const reasons = [];
    if (isFixture(t)) reasons.push("fixture");
    if (isParked(t)) reasons.push("parked");
    if (notYetFlipped(t, root)) reasons.push("not-yet-flipped");
    if (reasons.length > 0) excluded.push({ id, reasons });
    else ready.push(id);
  }
  ready.sort();
  excluded.sort((a, b) => a.id.localeCompare(b.id));

  const floor = computePoolFloor(cap, floorMult);
  const pool = ready.length;
  const deficit = Math.max(0, floor - pool);

  // dispatchable_disjoint — the criterion. The same expander the dispatch gate uses for its
  // pairwise checkTouchesPair: concrete declared paths resolve whether or not they exist, only
  // wildcards hit the filesystem (expandDeclaredTouches, single-source from the batch scheduler).
  const expand = (globs) => expandDeclaredTouches(globs, root);
  const poolParsed = ready.map((id) => ({ id, touches: parseTouches(allTasks.get(id).body) }));
  const inFlightParsed = (inFlight || []).map((t) => ({ id: t.id, touches: parseTouches(t.body) }));
  const dispatchableDisjoint = maxMutuallyDisjointSubset(poolParsed.map((p) => p.touches), expand);

  const criterionMet = dispatchableDisjoint >= cap;
  // AC3 self-report: pool big (≥ floor) but all colliding (< cap mutually-disjoint) ⇒ the mechanism
  // says so. The inverse (pool < floor but criterion already met) must NOT be reported.
  const poolBigAllColliding = pool >= floor && dispatchableDisjoint < cap;

  // Candidates are only meaningful when promotion pressure exists (pool < floor) — the script's
  // whole job is "recommend promotions to reach the floor". When the pool is already at/above floor
  // the candidate scan is skipped entirely (keeps the real-store output small).
  const candidates = [];
  const promotions = [];
  if (deficit > 0) {
    for (const [id, t] of allTasks) {
      if (t.status !== "todo") continue;
      if (isFixture(t) || isParked(t)) continue; // never promotion candidates
      candidates.push(buildCandidate(id, t, root, allTasks, poolParsed, inFlightParsed, expand));
    }
    // AC4: disjointness FIRST (how many pool/in-flight tasks the candidate is pairwise-disjoint
    // from), then `gap-*` > `DIR-*`, then touches-resolvable before not.
    candidates.sort(
      (a, b) =>
        b.disjointScore - a.disjointScore ||
        a.kindOrder - b.kindOrder ||
        (a.touchesResolve === b.touchesResolve ? 0 : a.touchesResolve ? -1 : 1),
    );
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
  if (top > 0) {
    const ranked = [];
    for (const [id, t] of allTasks) {
      if (t.status !== "todo") continue;
      if (isFixture(t) || isParked(t)) continue;
      const c = buildCandidate(id, t, root, allTasks, poolParsed, inFlightParsed, expand);
      ranked.push({ id, kind: c.kind, kindOrder: c.kindOrder, relevance: c.relevance, eligible: c.eligible, reason: relevanceReason(c) });
    }
    ranked.sort(
      (a, b) =>
        b.relevance.relevanceScore - a.relevance.relevanceScore ||
        a.kindOrder - b.kindOrder ||
        a.id.localeCompare(b.id),
    );
    top_relevance.push(...ranked.slice(0, top));
  }

  return {
    pool,
    floor,
    cap,
    floorMult,
    deficit,
    dispatchable_disjoint: dispatchableDisjoint,
    criterion_met: criterionMet,
    pool_big_all_colliding: poolBigAllColliding,
    report: buildReport({ pool, floor, cap, floorMult, dispatchableDisjoint, criterionMet, poolBigAllColliding, deficit }),
    ready,
    excluded,
    candidates,
    promotions,
    top_relevance,
    scanned: allTasks.size,
  };
}

function main(argv) {
  let root = null;
  let cap = CONCURRENCY_CAP_DEFAULT;
  let floorMult = POOL_FLOOR_MULT_DEFAULT;
  let inFlightIds = [];
  let top = 0;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--json") { /* output is always JSON — accepted for Contract parity */ }
    else if (args[i] === "--cap") cap = Number(args[++i]);
    else if (args[i] === "--floor-mult") floorMult = Number(args[++i]);
    else if (args[i] === "--top") top = Number(args[++i]);
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
  const result = analyzeTasks({ tasksDir: path.join(rootDir, "tasks"), root: rootDir, cap, floorMult, inFlight, top });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
