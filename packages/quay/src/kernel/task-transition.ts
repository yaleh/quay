// task-transition.ts — the KERNEL single source of the task-status TRANSITION model:
//   · `LIFECYCLE_EDGES` (+ its types) — the declared 5×5 lifecycle edge table;
//   · `decideTransition` — the three-state transition decision over that table;
//   · `patchStatusField` — the byte-preserving `status:` field patch;
//   · `appendTaskStatusEvent` — the structured status-transition event writer.
//
// ── WHY THE KERNEL (the reachability argument, both layers) ─────────────────────────────────────
// These pieces used to live in TWO layers that cannot share code:
//   · `LIFECYCLE_EDGES` in `packages/quay/src/gate/lifecycle.ts` (the product / CLI judge);
//   · `patchStatusField` in `plugin/scripts/task-ops.ts` (the methodology / driver layer).
// The promotion path is exactly where the two meet: the driver layer DECIDES a flip and writes it,
// the product layer DECLARES which flips are legal. A second judgement written in the kernel would
// be a THIRD implementation (the task's own WHY — GOAL-030's "single owner for status writes").
//
// `kernel/` is the ONE placement both layers reach without a `packages/**` → `plugin/**` reverse
// edge (`plugin/scripts/import-graph-check.ts` ratchets that count at 0) — the same argument that
// moved `regex-escape.ts` and `shape-sections.ts` here. Each existing home keeps a THIN re-export
// (`gate/lifecycle.ts`, `plugin/scripts/task-ops.ts`) so every existing import specifier still
// resolves and NO caller changes.
//
// A kernel file may import nothing outside `kernel/` except bare specifiers (`node:*`, npm). This
// one imports `node:fs` / `node:path` / `node:url` and nothing else. Enforced by
// `plugin/scripts/import-graph-check.ts` (`kernelViolations` must stay empty).
//
// ⛔ DECLARATION + PURE PRIMITIVES ONLY — this module changes NO writer's behaviour. The existing
// callers of `patchStatusField` are untouched (and may only be wired to consult `decideTransition`
// by the FOLLOW-UP task gap-goal030-promotion-writes-via-kernel-transition, not this one).
//
// ── THE DECLARED LIFECYCLE EDGE TABLE
//    (gap-transitions-table-lacks-needs-human-and-superseded-edges) ──────────────────────────────
// WHY THE TABLE EXISTS: the two CLI verbs (promote/retreat) walk only a two-edge-per-status
// ADJACENCY (`TRANSITIONS` in `gate/lifecycle.ts`). It is not a declaration of the whole lifecycle:
// production also reaches statuses through writers that never consult it (the promotion driver's
// todo→ready, the worker fan-in's ready→done and its done→ready "done 未落地" reset,
// `markNeedsHuman`'s todo|ready→needs-human, the out-of-band needs-human→done completion, and every
// `task_write`-driven supersede). Replaying 10k+ commits of `tasks/*.md` status flips against
// `TRANSITIONS` (readings archived in tasks/gap-status-flip-history-and-parser-diff-readings.md) put
// 17.7% of flips off that table, and EVERY off-table flip at/after 2026-09-20 involves `needs-human`
// or `superseded` — the table was missing those statuses' edges, not being violated. The table below
// is that missing declaration: ALL 5×5 status pairs, each one either a declared EDGE or (in
// `gate/lifecycle.ts`, which owns the illegal half) an explicitly declared ILLEGAL pair. There is no
// third "silently undeclared" state (hard rule 3b) — the coverage test in
// `lifecycle-edge-table.test.mjs` enumerates TASK_STATUSES×TASK_STATUSES and fails on any pair that
// is neither.
//
// `status` — the CURRENT-MODEL judgement (documented rule, not a timestamp):
//   "current"  the edge belongs to the lifecycle model in force today: wired into `TRANSITIONS`,
//              OR produced by a live DEDICATED writer in-tree (driver promotion / fan-in /
//              markNeedsHuman / retreat / out-of-band complete), OR observed in production
//              at/after 2026-09-20 (the reading's recent window).
//   "legacy"   no live dedicated writer today; observed only historically (the retired todo→done
//              skip, one-off manual ABI writes, the old status vocabulary).
//   An edge is `current` iff (wired ∨ live-dedicated-writer ∨ observed ≥ 2026-09-20).
//
// `actors` — the VERIFIED writer classes, read out of the tree, never guessed. A dedicated writer
// is named by role; an edge whose only writer is the generic Provider-ABI write says
// `["task_write"]`; an edge whose historical writer could not be established says
// `["unaudited"]` (缺值 = 未查, hard rule 6 — never a guess dressed as an audit).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── the status vocabulary ───────────────────────────────────────────────────────────────────────
//
// Declared HERE, as string literals, because the kernel leaf may not import `abi.ts` (a kernel file
// imports kernel files + bare specifiers only). `task-transition.test.mjs` asserts this set is EQUAL
// to `abi.ts`'s `TASK_STATUSES`, so the two declarations can never drift apart silently (hard rule
// 5b: a second copy of a vocabulary is a defect even when it happens to agree today).

/** The five task-status lifecycle words. Structurally identical to `abi.ts`'s `TaskStatus`. */
export type TaskStatus = "todo" | "ready" | "done" | "needs-human" | "superseded";

/** All valid task-status values, in canonical order (todo → ready → done → terminal). */
export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "ready", "done", "needs-human", "superseded"];

const TASK_STATUS_SET: ReadonlySet<string> = new Set<string>(TASK_STATUSES);

/** A transition's semantic role. */
export type LifecycleEdgeKind = "promote" | "retreat" | "escalate" | "resolve" | "supersede";

/** The verified writer vocabulary `LifecycleEdge.actors` draws from. */
export type LifecycleActor =
  | "driver-promotion" // promotion-driver / setTaskStatus (todo→ready)
  | "fan-in" // worker-fan-in flip done + its done→ready "done 未落地" reset
  | "retreat" // lifecycle runRetreat + ready-pool-check retreatReadyToTodo
  | "needs-human-writer" // driver-filters markNeedsHuman (todo|ready→needs-human)
  | "out-of-band-complete" // lifecycle runCompleteOutOfBand (any→done, no gate verdict)
  | "task_write" // the generic Provider-ABI status write (CLI/MCP/agent)
  | "unaudited"; // historical edge, writer not established from the tree

export interface LifecycleEdge {
  from: TaskStatus;
  to: TaskStatus;
  /** The transition's semantic role — `escalate` is "→needs-human", `resolve` is
   *  "needs-human→other", `supersede` is "→superseded". */
  kind: LifecycleEdgeKind;
  actors: readonly LifecycleActor[];
  status: "current" | "legacy";
}

/** Every status pair the lifecycle has ever declared as a REAL edge (17 of the 25). */
export const LIFECYCLE_EDGES: readonly LifecycleEdge[] = [
  { from: "todo", to: "ready", kind: "promote", actors: ["driver-promotion"], status: "current" },
  { from: "todo", to: "done", kind: "promote", actors: ["unaudited"], status: "legacy" },
  { from: "todo", to: "needs-human", kind: "escalate", actors: ["needs-human-writer"], status: "current" },
  { from: "todo", to: "superseded", kind: "supersede", actors: ["task_write"], status: "legacy" },
  { from: "ready", to: "todo", kind: "retreat", actors: ["retreat"], status: "current" },
  { from: "ready", to: "done", kind: "promote", actors: ["fan-in"], status: "current" },
  { from: "ready", to: "needs-human", kind: "escalate", actors: ["needs-human-writer"], status: "current" },
  { from: "ready", to: "superseded", kind: "supersede", actors: ["task_write"], status: "current" },
  { from: "done", to: "todo", kind: "retreat", actors: ["unaudited"], status: "legacy" },
  { from: "done", to: "ready", kind: "retreat", actors: ["fan-in", "retreat"], status: "current" },
  { from: "done", to: "needs-human", kind: "escalate", actors: ["unaudited"], status: "legacy" },
  { from: "done", to: "superseded", kind: "supersede", actors: ["task_write"], status: "legacy" },
  { from: "needs-human", to: "todo", kind: "retreat", actors: ["retreat"], status: "current" },
  { from: "needs-human", to: "ready", kind: "resolve", actors: ["task_write"], status: "current" },
  { from: "needs-human", to: "done", kind: "resolve", actors: ["out-of-band-complete"], status: "current" },
  { from: "needs-human", to: "superseded", kind: "supersede", actors: ["task_write"], status: "legacy" },
  { from: "superseded", to: "ready", kind: "resolve", actors: ["unaudited"], status: "legacy" },
];

// ── the transition DECISION ─────────────────────────────────────────────────────────────────────

/** The decision when the pair IS a declared `current` edge we may walk. */
export interface AllowedTransition {
  verdict: "allow";
  edge: LifecycleEdge;
}

/** The decision when a KNOWN pair is not walkable (no edge, or a `legacy` edge) — and when the pair
 *  names an UNKNOWN status. The two are DIFFERENT verdicts on purpose: `refuse` is a judgement
 *  about a known pair, `not-evaluated` is "this input is not a status, I cannot judge it". Merging
 *  them (e.g. a boolean return) is hard rule 3b's failure mode — an unreadable input looking like a
 *  checked-and-refused one. */
export interface UnwalkableTransition {
  verdict: "refuse" | "not-evaluated";
  reason: string;
}

export type TransitionDecision = AllowedTransition | UnwalkableTransition;

export interface DecideTransitionOptions {
  /** Accept a declared `status: "legacy"` edge as allowed (default: false). The promote/retreat
   *  verbs deliberately REFUSE legacy edges (no live writer today), and so does this decision by
   *  default; a caller that must replay a historical shape opts in explicitly rather than by
   *  silence. */
  allowLegacy?: boolean;
}

/**
 * Decide whether the `from → to` status transition may be walked. THREE answers, never two:
 *   allow          the pair is a declared `current` edge in `LIFECYCLE_EDGES`;
 *   refuse         the pair is a known-status pair with no walkable edge (absent, or `legacy`);
 *   not-evaluated  `from` or `to` is not one of the five known statuses (缺值 = 未查, hard rule 6).
 */
export function decideTransition(from: string, to: string, opts: DecideTransitionOptions = {}): TransitionDecision {
  const unknown = [from, to].filter((s) => !TASK_STATUS_SET.has(s));
  if (unknown.length > 0) {
    return {
      verdict: "not-evaluated",
      reason: `not a known task status: ${unknown.map((s) => JSON.stringify(s)).join(", ")}`,
    };
  }
  const edge = LIFECYCLE_EDGES.find((e) => e.from === from && e.to === to);
  if (!edge) {
    return { verdict: "refuse", reason: `${from}→${to} is not a declared lifecycle edge` };
  }
  if (edge.status === "legacy" && !opts.allowLegacy) {
    return { verdict: "refuse", reason: `${from}→${to} is a legacy edge (no live writer today)` };
  }
  return { verdict: "allow", edge };
}

// ── patch-one-field (byte-preserving text edit — never a YAML round-trip) ────────────────────────
//
// Moved VERBATIM from `plugin/scripts/task-ops.ts` (where it is now re-exported), so the four
// existing callers — driver-filters.ts (2), worker-fan-in.ts (4), ready-pool-check.ts (2) — keep
// importing the same symbol and change by zero lines.

/** Replace the `status:` scalar value in a frontmatter, preserving every other byte. `fromStatus`, when
 *  set, makes the patch apply ONLY when the current status line equals that value (whitespace-tolerant) —
 *  otherwise the frontmatter is returned UNCHANGED with `replaced:false` (a no-op, NOT an error: callers
 *  that already judged "is it <fromStatus>" via the develop ref use this to avoid clobbering a
 *  concurrently-flipped disk, see setTaskStatus). No `status:` line ⇒ fail-closed (ok:false). */
export function patchStatusField(
  frontmatterRaw: string,
  toStatus: string,
  fromStatus?: string,
): { ok: true; fm: string; from: string; replaced: boolean; to: string } | { ok: false; reason: string } {
  const statusLineRe = /^status:[ \t]*[^\r\n]*$/m;
  const line = frontmatterRaw.match(statusLineRe);
  if (!line) return { ok: false, reason: "no-status-line" };
  const from = line[0].replace(/^status:[ \t]*/, "").trim();
  if (fromStatus !== undefined && from !== fromStatus) {
    return { ok: true, fm: frontmatterRaw, from, replaced: false, to: toStatus };
  }
  return { ok: true, fm: frontmatterRaw.replace(statusLineRe, `status: ${toStatus}`), from, replaced: true, to: toStatus };
}

// ── the structured status-transition EVENT ───────────────────────────────────────────────────────
//
// WHY: a status flip driven through this module must be auditable as a DIRECT reading of "which code
// ran" — not a heartbeat the writer maintains for itself (hard rule 4b: a quantity the measured
// object produces cannot tell you whether the measured object is alive). `writerModule` (the realpath
// of THIS file) and `entry` (the realpath of the process entry) are exactly that direct reading:
// GOAL-030's AC-337 uses them to prove that a driver launched from a GOAL branch actually loaded the
// BRANCH's code rather than the main checkout's — a main-checkout driver would write events whose
// `writerModule` is outside the branch tree.

/** The caller-supplied part of a transition event. The kernel fills the provenance fields
 *  (`writerModule` / `entry` / `pid`) and the timestamp. */
export interface TaskStatusEventInput {
  taskId: string;
  from: string;
  to: string;
  /** The transition's semantic role (see `LifecycleEdgeKind`). */
  kind: string;
  actor: string;
  /** Optional: why the flip happened. Omitted ⇒ the key is absent from the record (缺值 = 未查 —
   *  "no reason recorded" stays distinguishable from "reason: empty"). */
  reason?: string;
  /** Override the record timestamp (ISO-8601). Defaults to `new Date().toISOString()`. */
  ts?: string;
}

/** The full record appended to `<root>/.quay/task-status-events.jsonl`. */
export interface TaskStatusEventRecord {
  ts: string;
  taskId: string;
  from: string;
  to: string;
  kind: string;
  actor: string;
  reason?: string;
  /** The realpath of the module file that executed this write — a DIRECT reading of which code ran. */
  writerModule: string;
  /** The realpath of the process entry (`process.argv[1]`), or null when there is none (e.g. `node -e`). */
  entry: string | null;
  pid: number;
}

export type AppendStatusEventResult =
  | { ok: true; path: string; record: TaskStatusEventRecord }
  | { ok: false; reason: string };

/** The realpath of THIS module file (`import.meta.url`) — the "which code executed this write"
 *  direct reading. Falls back to the unresolved path if realpath fails (still a useful reading). */
function thisModulePath(): string {
  const self = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(self);
  } catch {
    return self;
  }
}

/** The realpath of the process entry, or null when `process.argv[1]` is absent. */
function processEntryPath(): string | null {
  const entry = process.argv[1];
  if (!entry) return null;
  try {
    return fs.realpathSync(entry);
  } catch {
    return entry;
  }
}

/**
 * Append ONE JSON line describing a task-status transition to
 * `<root>/.quay/task-status-events.jsonl`, creating the `.quay` directory if needed.
 *
 * Fail-OPEN-but-VISIBLE: a write failure returns `{ok: false, reason}` — it never throws (the caller
 * is a status writer mid-flip and must decide whether to proceed) and never silently swallows (the
 * caller can inspect `reason` and record the failure; hard rule 3: an unreadable/writable state must
 * not look like a successful write).
 */
export function appendTaskStatusEvent(root: string, event: TaskStatusEventInput): AppendStatusEventResult {
  try {
    const dir = path.join(root, ".quay");
    fs.mkdirSync(dir, { recursive: true });
    const record: TaskStatusEventRecord = {
      ts: event.ts ?? new Date().toISOString(),
      taskId: event.taskId,
      from: event.from,
      to: event.to,
      kind: event.kind,
      actor: event.actor,
      ...(event.reason !== undefined ? { reason: event.reason } : {}),
      writerModule: thisModulePath(),
      entry: processEntryPath(),
      pid: process.pid,
    };
    const file = path.join(dir, "task-status-events.jsonl");
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    return { ok: true, path: file, record };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
