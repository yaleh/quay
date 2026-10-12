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
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
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

/** The declared edge's `kind` for a `from → to` pair, or `null` when no edge is walkable under `opts`
 *  — the ONE lookup a status-event writer uses to fill an event's `kind` (⛔ never a guessed role).
 *  `allowLegacy: true` is the right option for a REPLAY (a status alignment or a git-inferred
 *  reconcile), where the pair is whatever history says, including edges with no live writer. */
export function edgeKindFor(from: string, to: string, opts: DecideTransitionOptions = {}): string | null {
  const d = decideTransition(from, to, opts);
  return d.verdict === "allow" ? d.edge.kind : null;
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

// ── the structured status-transition EVENT (contract v1) ─────────────────────────────────────────
//
// WHY: a status flip driven through this module must be auditable as a DIRECT reading of "which code
// ran" — not a heartbeat the writer maintains for itself (hard rule 4b: a quantity the measured
// object produces cannot tell you whether the measured object is alive). `writerModule` (the realpath
// of THIS file) and `entry` (the realpath of the process entry) are exactly that direct reading:
// GOAL-030's AC-337 uses them to prove that a driver launched from a GOAL branch actually loaded the
// BRANCH's code rather than the main checkout's — a main-checkout driver would write events whose
// `writerModule` is outside the branch tree.
//
// ── v0 → v1 (tasks/gap-task-status-events-contract-v1-all-driver-writers) ───────────────────────
// v0 was `{ts, taskId, from, to, kind, actor, reason?, writerModule, entry, pid}`. Two measured
// problems made it unusable as a transition SOURCE (the task body carries the git-vs-carrier
// readings): only ONE of the production status writers emitted anything at all (136 events against
// ~300 git-evidenced transitions, every one `ready-pool-check --apply`), and the record left out
// everything a consumer needs to (a) dedup a retried write, (b) resume from a cursor, (c) tie the
// flip to the COMMIT that carried it, (d) name the cause, (e) be written safely by several driver
// processes at once.
//
// v1 adds `schema` / `eventId` / `seq` / `carrierEpoch` / `at` / `recordedAt` / `cause` / `evidence`,
// moves the provenance triple under `producer`, and makes `actor` a `{kind, id}` pair (a bare string
// named an ENTRY POINT; a consumer routing on "who flipped it" needs the writer CLASS).
//
// ⛔ APPEND-ONLY ∧ BACKWARD COMPATIBLE: every v0 line already on disk stays byte-for-byte as written
// and is READ as v0 (`readTaskStatusEventCarrier` classifies per line, positionally, by the presence
// of the `schema` key). An old line is neither corrupt nor silently upgraded — 硬规则 3b.

/** The v1 schema tag on every v1 line. Its ABSENCE is how a v0 line is recognised (positional, not a
 *  guess from field shape: a v0 line happens to carry `taskId`/`from`/`to` too). */
export const TASK_STATUS_EVENT_SCHEMA = "task-status-event/v1";

/** The writer CLASS vocabulary `actor.kind` draws from.
 *  `unknown` is a real, declared answer — the class is NOT derivable inside a shared writer module
 *  that several drivers call (`markNeedsHuman` in driver-filters.ts serves both the promotion driver
 *  and the worker driver), and 硬规则 6/2 forbid inventing it from a caller's file path or from a
 *  commit subject (a message is a CLAIM, not a positional reading). */
export type TaskStatusEventActorKind =
  | "promotion-driver"
  | "worker-driver"
  | "fan-in"
  | "goal-driver"
  | "cli"
  | "mcp"
  | "human"
  | "unknown";

/** The SAME vocabulary as a runtime value, so a SURFACE that must print it (the CLI `--help`
 *  contract excerpt) DERIVES it instead of re-typing the eight words — the same single-source rule
 *  help.ts already follows for the driver VERBS/KINDS. Kept immediately beside the type above so the
 *  two are read together; a runtime check cannot enumerate a TS union, so adjacency + this comment is
 *  the honest guarantee available here (⛔ not a claim that the two can be mechanically diffed). */
export const TASK_STATUS_EVENT_ACTOR_KINDS: readonly TaskStatusEventActorKind[] = [
  "promotion-driver",
  "worker-driver",
  "fan-in",
  "goal-driver",
  "cli",
  "mcp",
  "human",
  "unknown",
];

/** Who wrote the event: the CLASS of writer plus the concrete entry point that ran. */
export interface TaskStatusEventActor {
  kind: TaskStatusEventActorKind;
  /** The entry point / module that performed the write — e.g. `ready-pool-check --apply`,
   *  `worker-fan-in flipTaskDone`, or (for a reconcile-inferred event) the evidencing commit sha. */
  id: string;
}

/** The correlation envelope. Every key is OPTIONAL and an ABSENT key means "the writer did not have
 *  this value" — never a guessed or empty one (缺值 = 未查, hard rule 6). */
export interface TaskStatusEventCause {
  runId?: string;
  dispatchId?: string;
  sessionId?: string;
  correlationId?: string;
}

/** What the record can be CHECKED against.
 *  `commit` is the sha carrying the status-line change — `null` when the writer could not commit
 *  (a repo-less workspace, a failed commit); the key being present-with-null is the honest "the
 *  writer tried and there is no commit", distinct from "the writer never had a commit to record".
 *  `statusBlobSha` is the git blob hash of the exact file content the writer wrote (pure
 *  `sha1("blob <len>\0" + content)`, so `git show <commit>:tasks/<id>.md` hashes to the same value). */
export interface TaskStatusEventEvidence {
  commit?: string | null;
  statusBlobSha?: string;
  /** Present iff `commit` is null: WHY there is no commit (the writer never commits / the commit did
   *  not land / `rev-parse` returned nothing). The Plan's "commit:null plus a reason" — a bare null
   *  would leave "no commit because this path never commits" indistinguishable from "the commit
   *  failed", which are different operational facts. */
  commitAbsentReason?: string;
}

/** The provenance triple, plus the two readings that say WHICH CODE ran (`writerModule` realpath,
 *  `codeRev` = the HEAD commit of the repo tree the writer module lives in). */
export interface TaskStatusEventProducer {
  writerModule: string;
  entry: string | null;
  pid: number;
  host: string;
  /** The commit sha at HEAD of the git repo containing `writerModule`, read out of `.git` by pure
   *  filesystem reads (no spawn — this runs inside status writers); `null` when it cannot be read
   *  (not a repo / unreadable HEAD / an unborn branch). ⛔ never guessed. */
  codeRev: string | null;
}

/** The caller-supplied part of a transition event. The kernel fills provenance (`producer`), the
 *  identity (`eventId`), the position (`seq`), the epoch and the two timestamps. */
export interface TaskStatusEventInput {
  taskId: string;
  from: string;
  to: string;
  /** The transition's semantic role (see `LifecycleEdgeKind`) — or `null` when the pair is not a
   *  declared edge (a reconcile-inferred flip). */
  kind: string | null;
  /** A `{kind, id}` pair, or a bare string for legacy callers (normalised to kind `unknown`, see
   *  `normalizeActor`). */
  actor: TaskStatusEventActor | string;
  /** Optional: why the flip happened. Omitted ⇒ the key is absent from the record (缺值 = 未查 —
   *  "no reason recorded" stays distinguishable from "reason: empty"). */
  reason?: string;
  /** Time the STATUS WRITE happened (ISO-8601). Defaults to `new Date().toISOString()` — the
   *  idempotency key for a retried append is `(taskId, from, to, commit ?? at, writer)`, so a caller
   *  that wants a retry to dedup must pass the SAME `at`. */
  at?: string;
  cause?: TaskStatusEventCause;
  evidence?: TaskStatusEventEvidence;
  /** reconcile-only: this event was INFERRED from git, not observed by a live writer. */
  source?: "git";
  inferred?: boolean;
  /** Override the append timestamp (ISO-8601). Defaults to now. Tests pin it. */
  recordedAt?: string;
}

/** The v1 record appended to `<root>/.quay/task-status-events.jsonl`. */
export interface TaskStatusEventRecord {
  schema: typeof TASK_STATUS_EVENT_SCHEMA;
  /** Deterministic: `sha256(taskId · from · to · (commit ?? at) · writer)`, so a retried append of
   *  the SAME transition computes the SAME id (the consumer's dedup key). */
  eventId: string;
  /** Monotonic per carrier, assigned under the carrier lock. */
  seq: number;
  /** The carrier's epoch — set when the carrier is created and never reused; a rotation changes it so
   *  a consumer can tell "the carrier I was reading was replaced" from "more lines were appended". */
  carrierEpoch: string;
  taskId: string;
  from: string;
  to: string;
  kind: string | null;
  /** Time the status write happened. */
  at: string;
  /** Time this event LINE was appended. */
  recordedAt: string;
  actor: TaskStatusEventActor;
  cause?: TaskStatusEventCause;
  evidence?: TaskStatusEventEvidence;
  reason?: string;
  source?: "git";
  inferred?: boolean;
  producer: TaskStatusEventProducer;
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

// ── carrier paths (single definition point) ──────────────────────────────────────────────────────
//
// `.quay/task-status-events.jsonl` is the declared carrier (docs/carrier-registry.json). The epoch
// sidecar and the lock are siblings; the sidecar is registered as its own carrier so the declarative
// registry can see it too (a `.lock` name is outside the registry's name predicate — the same
// convention as the native task store's `tasks/<id>.md.lock`).

export function taskStatusEventsPath(root: string): string {
  return path.join(root, ".quay", "task-status-events.jsonl");
}

export function taskStatusEventsEpochPath(root: string): string {
  return path.join(root, ".quay", "task-status-events-state.json");
}

export function taskStatusEventsLockPath(root: string): string {
  return path.join(root, ".quay", "task-status-events.lock");
}

// ── the exclusive-create lock (ported from packages/quay-native/src/store.ts) ─────────────────────
//
// `gate-event-store.ts`'s own M161 note names this exact pattern as the port to make when concurrent
// writers to a `.quay/*.jsonl` carrier become real. They are real here: the promotion driver, the
// worker fan-in and the worker driver's needs-human path all write this one carrier from separate
// PROCESSES. `fs.openSync(lockPath, "wx")` is the atomic primitive; a lock whose holder crashed is
// reclaimed after `staleMs` (its mtime stops advancing).

export interface FileLockOptions {
  /** A lock older than this (mtime) is treated as abandoned and reclaimed. */
  staleMs?: number;
  /** Busy-wait between attempts. */
  retryMs?: number;
  /** Give up after this long, returning/raising rather than waiting forever. */
  timeoutMs?: number;
}

/** Acquire the exclusive-create lock at `lockPath`; returns it so the caller can release it. THROWS
 *  on a non-EEXIST error or on timeout — the caller decides whether to fail the write (this module's
 *  status writers must NOT: see `appendTaskStatusEvent`). */
export function acquireFileLock(lockPath: string, opts: FileLockOptions = {}): string {
  const staleMs = opts.staleMs ?? 5000;
  const retryMs = opts.retryMs ?? 10;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return lockPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { force: true });
          continue; // reclaim and retry immediately
        }
      } catch {
        continue; // the lock disappeared between EEXIST and stat — retry
      }
      if (Date.now() > deadline) throw new Error(`timed out acquiring lock ${lockPath}`);
      const until = Date.now() + retryMs;
      while (Date.now() < until) {
        /* spin — v0 simplest correct mechanism, same as the native task store */
      }
    }
  }
}

export function releaseFileLock(lockPath: string): void {
  fs.rmSync(lockPath, { force: true });
}

/** Run `fn` holding the lock at `lockPath`. */
export function withFileLock<T>(lockPath: string, fn: () => T): T {
  const held = acquireFileLock(lockPath);
  try {
    return fn();
  } finally {
    releaseFileLock(held);
  }
}

// ── identity, cargo and code rev ─────────────────────────────────────────────────────────────────

/** The deterministic event id. A retried append of the same transition by the same writer computes
 *  the same value — the consumer's dedup key. Deliberately NOT salted with the pid or a random: those
 *  would make every retry a new event. */
export function taskStatusEventId(input: {
  taskId: string;
  from: string;
  to: string;
  commit: string | null;
  at: string;
  writer: string;
}): string {
  return createHash("sha256")
    .update([input.taskId, input.from, input.to, input.commit ?? input.at, input.writer].join("\n"))
    .digest("hex")
    .slice(0, 32);
}

/** The git blob hash of `content` — `sha1("blob <byteLength>\0" + content)`, the value
 *  `git hash-object <file>` (and `git show <commit>:<path>`) produces, computed WITHOUT spawning git
 *  (this runs inside status writers). */
export function gitBlobSha(content: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(content, "utf8")}\0`)
    .update(content, "utf8")
    .digest("hex");
}

/** The realpath of the `.git` directory that governs `startDir`, walking up — or null. A worktree has
 *  a `.git` FILE carrying `gitdir: <path>`; a normal checkout has a `.git` DIRECTORY. */
function findGitDir(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const dotGit = path.join(dir, ".git");
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(dotGit);
    } catch {
      st = null;
    }
    if (st !== null) {
      if (st.isDirectory()) return dotGit;
      try {
        const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
        if (!m) return null;
        return path.resolve(dir, m[1].trim());
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The sha HEAD resolves to inside `gitDir`: a detached HEAD is the literal; a symbolic ref is read
 *  from the loose ref file, falling back to `packed-refs`. Unreadable / unborn ⇒ null (⛔ never a
 *  guessed value). */
function headShaOfGitDir(gitDir: string): string | null {
  const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/i;
  let head: string;
  try {
    head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  } catch {
    return null;
  }
  if (SHA_RE.test(head)) return head;
  const m = /^ref:\s*(.+)$/.exec(head);
  if (!m) return null;
  const ref = m[1].trim();
  // A LINKED worktree's per-worktree gitdir holds HEAD but NOT the refs: its `commondir` file
  // points at the common gitdir that actually stores `refs/heads/*` and `packed-refs`.
  // (A main checkout has no `commondir` — the two dirs are the same.)
  const dirs = [gitDir];
  try {
    const common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim());
    if (common !== gitDir) dirs.push(common);
  } catch {
    /* no commondir ⇒ gitDir alone */
  }
  for (const dir of dirs) {
    try {
      const sha = fs.readFileSync(path.join(dir, ref), "utf8").trim();
      if (SHA_RE.test(sha)) return sha;
    } catch {
      /* try the next dir, then packed-refs */
    }
  }
  for (const dir of dirs) {
    try {
      for (const line of fs.readFileSync(path.join(dir, "packed-refs"), "utf8").split("\n")) {
        if (!line.trim() || line.startsWith("#") || line.startsWith("^")) continue;
        const [sha, name] = line.trim().split(/\s+/, 2);
        if (name === ref && SHA_RE.test(sha)) return sha;
      }
    } catch {
      /* no packed-refs here */
    }
  }
  return null;
}

const codeRevCache = new Map<string, string | null>();

/** `codeRev` for a module path, cached per process (it cannot change under a running process). */
function codeRevFor(modulePath: string): string | null {
  const dir = path.dirname(modulePath);
  const cached = codeRevCache.get(dir);
  if (cached !== undefined) return cached;
  const gitDir = findGitDir(dir);
  const rev = gitDir === null ? null : headShaOfGitDir(gitDir);
  codeRevCache.set(dir, rev);
  return rev;
}

/** Normalise the two accepted actor spellings. A bare string named an ENTRY POINT, not a writer
 *  CLASS; the class is not derivable from it, so it is recorded as `unknown` (⛔ never guessed —
 *  硬规则 6). */
export function normalizeActor(actor: TaskStatusEventActor | string): TaskStatusEventActor {
  if (typeof actor === "string") return { kind: "unknown", id: actor };
  return { kind: actor.kind, id: actor.id };
}

// ── reading the carrier (v0 ∧ v1, three-valued) ──────────────────────────────────────────────────

/** One carrier line's class. `corrupt` is its OWN value: an unparseable line is COUNTED and named,
 *  never silently dropped and never allowed to masquerade as a v0/v1 record (硬规则 3b). */
export type CarrierLineClass = "v1" | "v0" | "corrupt";

export interface CarrierLine {
  /** 0-based line index in the file. */
  index: number;
  klass: CarrierLineClass;
  raw: string;
  /** Present iff klass === "v1". */
  record?: TaskStatusEventRecord;
  /** Present iff klass === "v0" — the parsed legacy object, byte-preserved on disk. */
  legacy?: Record<string, unknown>;
  /** Present iff klass === "corrupt". */
  reason?: string;
}

export interface TaskStatusEventCarrier {
  path: string;
  /** false when the carrier file does not exist (⛔ an absent carrier is not an empty one that was
   *  read — 硬规则 3/6: the caller must be able to tell "read, and it is empty" from "not there"). */
  exists: boolean;
  lines: CarrierLine[];
}

/** Read + classify every line of the carrier. Never throws: an unreadable file yields
 *  `{exists:false, lines:[]}`. */
export function readTaskStatusEventCarrier(root: string): TaskStatusEventCarrier {
  const file = taskStatusEventsPath(root);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { path: file, exists: false, lines: [] };
  }
  const lines: CarrierLine[] = [];
  const raw = text.split("\n");
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      lines.push({ index: i, klass: "corrupt", raw: line, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      lines.push({ index: i, klass: "corrupt", raw: line, reason: "not a JSON object" });
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.schema === TASK_STATUS_EVENT_SCHEMA) {
      lines.push({ index: i, klass: "v1", raw: line, record: obj as unknown as TaskStatusEventRecord });
    } else {
      lines.push({ index: i, klass: "v0", raw: line, legacy: obj });
    }
  }
  return { path: file, exists: true, lines };
}

/** The highest `seq` already on the carrier (-1 when there is none) — the cursor `seq` continues
 *  from. Only v1 lines carry a `seq`; a corrupt line is skipped (⛔ it must not become a cursor). */
function highestSeq(lines: CarrierLine[]): number {
  let max = -1;
  for (const l of lines) {
    const s = l.klass === "v1" ? l.record?.seq : undefined;
    if (typeof s === "number" && s > max) max = s;
  }
  return max;
}

/** Read the carrier epoch, creating the sidecar under the caller's lock when it is absent. */
function readOrCreateCarrierEpoch(epochPath: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(epochPath, "utf8"));
    if (parsed && typeof parsed.epoch === "string" && parsed.epoch.length > 0) return parsed.epoch;
  } catch {
    /* absent or unreadable ⇒ (re)create below */
  }
  const epoch = createHash("sha256")
    .update(`${os.hostname()}\n${process.pid}\n${Date.now()}\n${Math.random()}`)
    .digest("hex")
    .slice(0, 32);
  fs.writeFileSync(epochPath, `${JSON.stringify({ schema: "task-status-event-carrier-state/v1", epoch, createdAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  return epoch;
}

// ── the failed-append counter (the Plan's "stderr plus a counter") ───────────────────────────────

let appendFailureCount = 0;

/** How many event appends failed IN THIS PROCESS. An append failure must never be silent (⛔ 硬规则
 *  3b) and must never fail the status write it was tracing — so it is counted here and written to
 *  stderr, and the writer keeps its `{ok: true}`. The COUNTER is in-process: a crash loses it, which
 *  is why the durable reading is the report `task-status-events-reconcile.ts --json` produces from
 *  git (the gap is closed by reconcile, never by the counter — see the task body's Plan §2). */
export function statusEventAppendFailureCount(): number {
  return appendFailureCount;
}

/** Test seam: reset the in-process counter. */
export function resetStatusEventAppendFailureCount(): void {
  appendFailureCount = 0;
}

/**
 * Append ONE v1 JSON line describing a task-status transition to
 * `<root>/.quay/task-status-events.jsonl`, creating the `.quay` directory if needed.
 *
 * SEMANTICS (the task body's Plan §2 — at-least-once, idempotent):
 *   · the caller invokes this AFTER the status write is on disk (硬规则 7) and, when it has one,
 *     passes the commit sha in `evidence.commit`;
 *   · the whole append (epoch read/create → `seq` assignment → line write) runs under an
 *     exclusive-create lock, so several driver PROCESSES cannot interleave or reuse a `seq`;
 *   · a crash between the status write and the append leaves a GAP — closed by
 *     `plugin/scripts/task-status-events-reconcile.ts` from git, never by inventing an event here.
 *
 * Fail-OPEN-but-VISIBLE: a write failure returns `{ok: false, reason}` (it never throws), increments
 * `statusEventAppendFailureCount()` and writes a line to stderr. It must NOT fail or revert the
 * status write it was tracing — the record must not become a new gate — and it must not be silent
 * either (硬规则 3: an unwritable state must not look like a successful write).
 */
export function appendTaskStatusEvent(root: string, event: TaskStatusEventInput): AppendStatusEventResult {
  const file = taskStatusEventsPath(root);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const actor = normalizeActor(event.actor);
    const writerModule = thisModulePath();
    const at = event.at ?? new Date().toISOString();
    const recordedAt = event.recordedAt ?? new Date().toISOString();
    const commit = event.evidence?.commit ?? null;
    const eventId = taskStatusEventId({ taskId: event.taskId, from: event.from, to: event.to, commit, at, writer: writerModule });
    const producer: TaskStatusEventProducer = {
      writerModule,
      entry: processEntryPath(),
      pid: process.pid,
      host: os.hostname(),
      codeRev: codeRevFor(writerModule),
    };
    const cause = event.cause && Object.keys(event.cause).length > 0 ? event.cause : undefined;
    const evidence =
      event.evidence !== undefined &&
      (event.evidence.commit !== undefined || event.evidence.statusBlobSha !== undefined || event.evidence.commitAbsentReason !== undefined)
        ? event.evidence
        : undefined;
    const record = withFileLock(taskStatusEventsLockPath(root), (): TaskStatusEventRecord => {
      const carrierEpoch = readOrCreateCarrierEpoch(taskStatusEventsEpochPath(root));
      const seq = highestSeq(readTaskStatusEventCarrier(root).lines) + 1;
      const rec: TaskStatusEventRecord = {
        schema: TASK_STATUS_EVENT_SCHEMA,
        eventId,
        seq,
        carrierEpoch,
        taskId: event.taskId,
        from: event.from,
        to: event.to,
        kind: event.kind,
        at,
        recordedAt,
        actor,
        ...(cause !== undefined ? { cause } : {}),
        ...(evidence !== undefined ? { evidence } : {}),
        ...(event.reason !== undefined ? { reason: event.reason } : {}),
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.inferred !== undefined ? { inferred: event.inferred } : {}),
        producer,
      };
      fs.appendFileSync(file, `${JSON.stringify(rec)}\n`, "utf8");
      return rec;
    });
    return { ok: true, path: file, record };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    appendFailureCount++;
    process.stderr.write(
      `task-status-event: append failed for ${event.taskId} ${event.from}→${event.to} (${reason}) — ` +
        `the status write is NOT affected; the gap is closed by task-status-events-reconcile.ts\n`,
    );
    return { ok: false, reason };
  }
}

// ── the WRITER-CLASS REGISTRY (the coverage enumeration — task_trace P1) ─────────────────────────
//
// WHY A DECLARED LIST (hard rule 4b): "which writer classes exist" is a fact about the SOURCE TREE,
// not about the carrier. A class that has written nothing looks byte-identical to a class that was
// never wired — the carrier cannot read itself, so a coverage number derived from it alone would be
// a quantity the measured object produces. The list is therefore DECLARED here, and kept honest by
// `packages/quay/test/task-log.test.mjs`, which enumerates the real `appendTaskStatusEvent` call
// sites in the tree and requires every one of them to be owned by a declared class (and every
// `wired: true` class to name an existing call site). Adding a fifth writer without a registry entry
// turns that test RED — the declaration cannot silently drift from the tree.
//
// `wired: false` is a REAL, enumerated answer, never an omission (hard rule 3/3b). A class that
// flips statuses through the Provider ABI without appending an event makes every page that omits it
// INCOMPLETE — which is exactly what `complete: false` must mean. The negative control for this
// reading is the injectable registry seam on the reader (`readTaskLog({ writerClasses })`): a
// fixture that supplies an all-wired registry can reach `complete: true`, so the meter is
// falsifiable in BOTH directions rather than structurally stuck at `false`.

export interface TaskStatusEventWriterClass {
  /** Stable class name (⛔ never reused for a different class — 硬规则 8). */
  id: string;
  /** true iff this class appends carrier events today. */
  wired: boolean;
  /** true iff the class writes statuses FOR THIS workspace's task store — i.e. an unwired one makes
   *  a `task log` page incomplete. An out-of-scope class (the GitHub provider, a hand edit) is
   *  enumerated for honesty but does not by itself make a local page incomplete. */
  inScope: boolean;
  /** Repo-relative files whose `appendTaskStatusEvent` call sites this class owns. Empty iff
   *  `wired: false`. */
  callSites: readonly string[];
  /** REQUIRED when `wired: false`: WHY. A bare `wired: false` would leave "nobody wired it yet"
   *  indistinguishable from "it is structurally impossible" (缺值 = 未查, hard rule 6). */
  reason?: string;
}

/** The five-in-scope/three-out-of-scope writer-class declaration — see the block comment above for
 *  why this is declared rather than measured, and `packages/quay/test/task-log.test.mjs` for the
 *  check that keeps it in sync with the actual call sites. */
export const TASK_STATUS_EVENT_WRITER_CLASSES: readonly TaskStatusEventWriterClass[] = [
  { id: "promotion-driver", wired: true, inScope: true, callSites: ["plugin/scripts/ready-pool-check.ts"] },
  { id: "driver-filters", wired: true, inScope: true, callSites: ["plugin/scripts/driver-filters.ts"] },
  { id: "fan-in", wired: true, inScope: true, callSites: ["plugin/scripts/worker-fan-in.ts"] },
  { id: "reconcile", wired: true, inScope: true, callSites: ["plugin/scripts/task-status-events-reconcile.ts"] },
  {
    id: "cli",
    wired: false,
    inScope: true,
    callSites: [],
    reason:
      "the Core CLI's status writes (Provider ABI task_write / `task edit --status`) flip tasks/*.md without appending a carrier event",
  },
  {
    id: "mcp",
    wired: false,
    inScope: true,
    callSites: [],
    reason: "the Core MCP server's task_write path does not append a carrier event",
  },
  {
    id: "github-provider",
    wired: false,
    inScope: false,
    callSites: [],
    reason:
      "the GitHub provider stores tasks as issues — a remote status flip has no local status line for a writer to observe, so it is out of scope for a local-carrier page",
  },
  {
    id: "human-hand-edit",
    wired: false,
    inScope: false,
    callSites: [],
    reason:
      "a hand edit of tasks/*.md is observed only through git, i.e. by the `reconcile` class (source: git, inferred: true) — it has no writer process of its own",
  },
];

// ── the read-side view of the carrier (the surface `quay task log` / `quay task trace` publish) ──

/** One carrier record as the read surface publishes it. The order key is the CARRIER POSITION (the
 *  0-based line index), which on an append-only carrier equals a v1 record's `seq` — so "ordered by
 *  seq" and "ordered by the carrier" are the same statement for every v1 record, and a v0 record
 *  (which has no `seq` at all) still has exactly one well-defined position. */
export interface TaskStatusTransitionView {
  /** The carrier position (0-based line index) — the ORDER KEY. */
  order: number;
  schema: "v1" | "v0";
  /** v1 only (null for a v0 line — ⛔ never a fabricated one, hard rule 6). */
  seq: number | null;
  /** v1 only. The consumer's dedup key (at-least-once delivery). */
  eventId: string | null;
  carrierEpoch: string | null;
  taskId: string;
  from: string | null;
  to: string | null;
  kind: string | null;
  /** Time the status write happened (v1 `at`; v0 `ts`). */
  at: string | null;
  recordedAt: string | null;
  actor: TaskStatusEventActor | null;
  cause?: TaskStatusEventCause;
  evidence?: TaskStatusEventEvidence;
  reason?: string;
  /** `"task-status-events"` for an event a LIVE writer appended; `"git"` for a reconciled, inferred
   *  one. ⛔ A commit SUBJECT is never a source (a message is a claim, not a positional reading). */
  source: "task-status-events" | "git";
  inferred: boolean;
  /** `evidence.commit` when the record carries one, else null. */
  commit: string | null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Project ONE classified carrier line into the published view. Never throws and never invents a
 *  value: a field the record does not carry comes out null / absent (缺值 = 未查). */
export function taskStatusTransitionView(line: CarrierLine): TaskStatusTransitionView {
  const common = { order: line.index };
  if (line.klass === "v1") {
    const r = line.record as unknown as Record<string, unknown>;
    const inferred = r.inferred === true;
    const evidence = (r.evidence ?? undefined) as TaskStatusEventEvidence | undefined;
    return {
      ...common,
      schema: "v1",
      seq: typeof r.seq === "number" ? r.seq : null,
      eventId: asString(r.eventId),
      carrierEpoch: asString(r.carrierEpoch),
      taskId: asString(r.taskId) ?? "",
      from: asString(r.from),
      to: asString(r.to),
      kind: asString(r.kind),
      at: asString(r.at),
      recordedAt: asString(r.recordedAt),
      actor: (r.actor ?? null) as TaskStatusEventActor | null,
      ...(r.cause !== undefined ? { cause: r.cause as TaskStatusEventCause } : {}),
      ...(evidence !== undefined ? { evidence } : {}),
      ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
      source: inferred ? "git" : "task-status-events",
      inferred,
      commit: evidence !== undefined ? asString(evidence.commit) : null,
    };
  }
  // klass === "v0" — the legacy shape, read as it was written and never upgraded.
  const r = (line.legacy ?? {}) as Record<string, unknown>;
  const actor = asString(r.actor);
  return {
    ...common,
    schema: "v0",
    seq: null,
    eventId: null,
    carrierEpoch: null,
    taskId: asString(r.taskId) ?? "",
    from: asString(r.from),
    to: asString(r.to),
    kind: asString(r.kind),
    at: asString(r.ts),
    recordedAt: null,
    actor: actor === null ? null : { kind: "unknown", id: actor },
    ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
    source: "task-status-events",
    inferred: false,
    commit: null,
  };
}

/** Every carrier record as the published view, in CARRIER ORDER, with the corrupt-line count kept
 *  separate (a corrupt line is counted and named, never silently dropped — hard rule 3b). */
export function readTaskStatusTransitions(root: string): {
  carrier: TaskStatusEventCarrier;
  transitions: TaskStatusTransitionView[];
  corrupt: number;
} {
  const carrier = readTaskStatusEventCarrier(root);
  const transitions: TaskStatusTransitionView[] = [];
  let corrupt = 0;
  for (const line of carrier.lines) {
    if (line.klass === "corrupt") {
      corrupt++;
      continue;
    }
    transitions.push(taskStatusTransitionView(line));
  }
  return { carrier, transitions, corrupt };
}

/** The epoch literal for a carrier that has NO epoch sidecar and NO v1 record — a legacy (v0-only)
 *  carrier. It is a DECLARED value, not null, so a cursor taken on such a carrier round-trips; the
 *  first v1 append creates the sidecar and thereby rotates the effective epoch, which is exactly the
 *  rebase a consumer must be told about (⛔ never a silent skip). */
export const PRE_EPOCH = "pre-epoch";

/** The carrier's CURRENT effective epoch, READ-ONLY. ⛔ Never `readOrCreateCarrierEpoch`: a read
 *  verb must not create state (the sidecar is created by the first WRITE, under the write lock).
 *  Prefers the sidecar; falls back to the newest v1 record's own `carrierEpoch` (the sidecar may be
 *  unreachable while the records still carry it); `PRE_EPOCH` when neither exists. */
export function readCarrierEpoch(root: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(taskStatusEventsEpochPath(root), "utf8"));
    if (parsed !== null && typeof parsed === "object") {
      const epoch = (parsed as Record<string, unknown>).epoch;
      if (typeof epoch === "string" && epoch.length > 0) return epoch;
    }
  } catch {
    /* absent or unreadable ⇒ fall through to the records, then PRE_EPOCH */
  }
  const carrier = readTaskStatusEventCarrier(root);
  for (let i = carrier.lines.length - 1; i >= 0; i--) {
    const line = carrier.lines[i];
    if (line.klass !== "v1") continue;
    const epoch = line.record?.carrierEpoch;
    if (typeof epoch === "string" && epoch.length > 0) return epoch;
  }
  return PRE_EPOCH;
}
