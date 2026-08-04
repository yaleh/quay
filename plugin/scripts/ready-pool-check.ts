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
//        (a) not-yet-flipped — all AC checkboxes checked but status still `ready` (this batch's work
//            is done, waiting fan-in to flip to `done`); mechanically: checked>0 && unchecked==0
//        (b) fixture         — `labels: fixture` (gate demo fixtures, never real work)
//        (c) PARKED          — a body `**PARKED` marker (task-level suspension; plain-text mentions
//            of the WORD "PARKED" in AC prose are NOT markers)
//   2. When pool < 3, recommend todo→ready promotions from the `todo` backlog in a DEFINED order
//      (order carried by the script, not prose): `gap-*` defects before `DIR-*` capabilities (other
//      kinds last); within a kind, touches-resolvable before not. Only candidates with deps ready +
//      four artifacts complete + touches resolve + not fixture + not PARKED are eligible (合格).
//
// The output is JSON so the tick-doc step can read the `pool` field mechanically (Contract measure
// key `ready_pool` reads stdout's `pool` field). Mirrors task-status-drift-check.ts's detector shape
// (read-only, exit 0 always).
//
// Run:
//   node --experimental-strip-types plugin/scripts/ready-pool-check.ts [--root <repo>]
//
// The pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import path from "node:path";
import { parseTask, extractSection, countBoxes } from "./task-schema.ts";
import { checkTaskTouchesResolve, findRepoRoot } from "./touches-orthogonality-check.ts";
import { isDirectEntry } from "./gate-script-base.ts";

/** The healthy ready-pool floor: pool must be ≥ this before promotion pressure releases. */
export const POOL_FLOOR = 3;

/** Minimum non-whitespace content for a section to count as a real artifact (mirrors
 *  quay-native store.ts MIN_SECTION_CHARS — a heading followed by one word is not an artifact). */
export const MIN_SECTION_CHARS = 40;

/** Task-level PARKED marker: a bold `**PARKED` in the body. Plain-text "PARKED" in AC prose
 *  (e.g. this very task's exclusion-rule description) is NOT a marker — matched only when bolded. */
export const PARKED_MARKER_RE = /\*\*PARKED\b/i;

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

/** True when the task is in the "this batch done, not yet flipped to done" state — all AC
 *  checkboxes checked but `status` still `ready` (fan-in has not flipped it). */
export function notYetFlipped(task) {
  const ac =
    extractSection(task.body, "Acceptance Criteria") ??
    extractSection(task.body, "AC") ??
    "";
  const { total, checked, unchecked } = countBoxes(ac);
  return total > 0 && checked > 0 && unchecked === 0;
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

function buildCandidate(id, task, root, allTasks) {
  const kind = classifyKind(id);
  const touches = checkTaskTouchesResolve(task.body, root);
  const touchesResolve = !touches.majorityMissing;
  const depsReady = depsReadyFor(task, allTasks);
  const four = artifactsComplete(task.body);
  return {
    id,
    kind,
    kindOrder: kindOrder(kind),
    touchesResolve,
    depsReady,
    fourArtifacts: four.complete,
    missingArtifacts: four.missing,
    eligible: depsReady && four.complete && touchesResolve,
  };
}

/** Analyze a task store. Returns { pool, floor, deficit, ready, excluded, candidates, promotions,
 *  scanned }. `root` is the repo root used to resolve `## Touches` existence claims; `tasksDir`
 *  defaults to `<root>/tasks`. */
export function analyzeTasks({ tasksDir, root }) {
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
    if (notYetFlipped(t)) reasons.push("not-yet-flipped");
    if (reasons.length > 0) excluded.push({ id, reasons });
    else ready.push(id);
  }
  ready.sort();
  excluded.sort((a, b) => a.id.localeCompare(b.id));

  const pool = ready.length;
  const deficit = Math.max(0, POOL_FLOOR - pool);

  // Candidates are only meaningful when promotion pressure exists (pool < 3) — the script's whole
  // job is "recommend promotions to reach the floor". When the pool is already healthy the candidate
  // scan is skipped entirely (keeps the real-store output small; matches AC4's "pool ≥ 3 ⇒ 不推荐").
  const candidates = [];
  const promotions = [];
  if (deficit > 0) {
    for (const [id, t] of allTasks) {
      if (t.status !== "todo") continue;
      if (isFixture(t) || isParked(t)) continue; // never promotion candidates
      candidates.push(buildCandidate(id, t, root, allTasks));
    }
    candidates.sort(
      (a, b) =>
        a.kindOrder - b.kindOrder ||
        (a.touchesResolve === b.touchesResolve ? 0 : a.touchesResolve ? -1 : 1),
    );
    for (const c of candidates) {
      if (promotions.length >= deficit) break;
      if (!c.eligible) continue;
      promotions.push({
        id: c.id,
        reason:
          `${c.kind}-* candidate · deps ${c.depsReady ? "ready" : "NOT-ready"} · ` +
          `touches ${c.touchesResolve ? "resolve" : "MISSING"} · ` +
          `four-artifacts ${c.fourArtifacts ? "complete" : `INCOMPLETE (${c.missingArtifacts.join(",")})`}`,
      });
    }
  }

  return {
    pool,
    floor: POOL_FLOOR,
    deficit,
    ready,
    excluded,
    candidates,
    promotions,
    scanned: allTasks.size,
  };
}

function main(argv) {
  let root = null;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
  }
  const rootDir = root ? path.resolve(root) : findRepoRoot(process.cwd());
  const result = analyzeTasks({ tasksDir: path.join(rootDir, "tasks"), root: rootDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
