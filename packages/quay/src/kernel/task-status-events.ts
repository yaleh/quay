// task-status-events.ts — the KERNEL single source of the TASK-STATUS EVENT substrate:
//   · the contract-v1 record shape (`TaskStatusEventRecord` + its input/actor/cause/evidence types);
//   · the carrier (`.quay/task-status-events.jsonl`) — paths, epoch sidecar, append, read/classify;
//   · the writer-class registry (`TASK_STATUS_EVENT_WRITER_CLASSES`) and the read-side view
//     (`taskStatusTransitionView` / `readTaskStatusTransitions`) `quay task log` publishes;
//   · `gitBlobSha` / `taskStatusEventId` — the identity primitives the writers need.
//
// SEAM SPLIT (tasks/gap-routine-architecture-analysis-god-module-task-transition-mixed-concerns,
// 2026-10-29): all of the above used to live in `task-transition.ts`, in the same 1,015-line file as
// the LIFECYCLE EDGE TABLE and its `decideTransition` decision. They are two unrelated jobs: "which
// status flips are legal" (a 5×5 declaration + one three-state decision) versus "how a flip is
// recorded, appended and replayed" (a carrier with a lock, a schema, an epoch and a cursor). This
// module owns the second; `task-transition.ts` keeps the first and re-exports every symbol below, so
// every existing import specifier still resolves and NO caller changes.
//
// The generic exclusive-create lock this substrate appends under was extracted at the same time to
// `./file-lock.ts` — a lock is a filesystem primitive, not a status-event concept.
//
// `producer.writerModule` (the "which code executed this write" direct reading) now reports THIS
// file, not `task-transition.ts`: it is `import.meta.url` realpath'd, i.e. whatever module the
// append actually ran in. That is the honest reading and the two tests pinning it name this path.
//
// A kernel file may import nothing outside `kernel/` except bare specifiers (`node:*`, npm). This
// one imports `node:fs` / `node:os` / `node:path` / `node:crypto` / `node:url` plus `./file-lock.ts`.
// Enforced by `plugin/scripts/import-graph-check.ts` (`kernelViolations` must stay empty).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { withFileLock } from "./file-lock.ts";

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
  /** The status the task was in — or `null` for a CREATION, which has no `from`. `null` is a real
   *  value here, not a missing one: `from:null` is what distinguishes "this task did not exist" from
   *  "it existed in some status we could not read" (硬规则 3b — the two must not share a spelling). */
  from: string | null;
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
  /** `null` == this record is a CREATION (no prior status existed), see `TaskStatusEventInput.from`. */
  from: string | null;
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

/** The writer-class declaration — an unwired IN-SCOPE class gates `complete`, an out-of-scope one is
 *  enumerated for honesty. ⛔ No cardinality is stated here: a count in prose drifts the moment the
 *  list changes (it already did — this read "five-in-scope/three-out-of-scope" against six and two),
 *  and nothing checks it. See the block comment above for why this is declared rather than measured,
 *  and `packages/quay/test/task-log.test.mjs` for the check that keeps it in sync with the actual
 *  call sites. */
export const TASK_STATUS_EVENT_WRITER_CLASSES: readonly TaskStatusEventWriterClass[] = [
  { id: "promotion-driver", wired: true, inScope: true, callSites: ["plugin/scripts/ready-pool-check.ts"] },
  { id: "driver-filters", wired: true, inScope: true, callSites: ["plugin/scripts/driver-filters.ts"] },
  { id: "fan-in", wired: true, inScope: true, callSites: ["plugin/scripts/worker-fan-in.ts"] },
  { id: "reconcile", wired: true, inScope: true, callSites: ["plugin/scripts/task-status-events-reconcile.ts"] },
  // The Provider ABI's write path. BOTH front doors append through the SAME call site — the native
  // store's `write()` emits after its commit — so the two ids name one implementation; which door a
  // given write came through is carried per-event as `actor.kind` ("cli" / "mcp"), not as a separate
  // writer. They are kept as two entries because the doors can regress independently: an unwired door
  // makes every page that omits its writes incomplete, and pinning them separately keeps that reading
  // per-door. Wired by `gap-task-status-events-abi-writes-and-creation` (which landed AFTER this
  // registry was first written — until then these two were truthfully `wired: false`, "flip
  // tasks/*.md without appending a carrier event"). The GitHub provider remains out of scope: it
  // stores tasks as issues, so a remote flip has no local status line to observe (its own entry).
  { id: "cli", wired: true, inScope: true, callSites: ["packages/quay-native/src/store.ts"] },
  { id: "mcp", wired: true, inScope: true, callSites: ["packages/quay-native/src/store.ts"] },
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
