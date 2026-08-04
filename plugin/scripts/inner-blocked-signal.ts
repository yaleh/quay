// inner-blocked-signal.ts — gap-no-explicit-blocked-signal-from-inner-layer: the inner layer's
// explicit "I am stopped and waiting" signal.
//
// PROBLEM (task body): the inner layer stopping to wait for a ruling is DESIGNED (it is the reason
// the outer exists), but the inner has no way to SAY it is stopped — the outer can only infer it
// from an absence (TUI md5 compare, or an empty telemetry inProgress, both of which lie: 2026-08-02
// two silent stalls at 22:05/22:24, and an M243 rescue run that showed IDLE while busy). Dead time
// was unmeasurable and uncompressed; the 20-min tick never fires while the outer is talking.
//
// FIX: the inner WRITES a structured block record at the moment it stops, and DELETES it the moment
// it resumes. File exists == inner is waiting. This is an existence signal, not an absence
// inference. The outer Monitor watches the path with inotifywait (latency seconds, not 20 min) and
// the wait duration (since → deletion) becomes telemetry — a number that previously did not exist.
//
// HARD CONSTRAINT (task body / AC4): the inner layer calls THIS CLI, it never hand-writes the JSON.
// The CLI is the only writer of `.quay/inner-blocked.json` (format drift is the exact failure this
// task exists to prevent). Same single-writer principle for the blocked-wait telemetry: `--clear`
// is the ONLY place a blocked-wait duration is emitted (reusing the A1a stage-event schema — see
// below — never a second event format).
//
// REASON VOCABULARY (AC2): `reason` legal values ARE the inner layer's EXISTING stop-and-wait
// conditions from plugin/loop/fast-mode-loop-tick.md ("判断边界" table + step-3 stop conditions).
// No new semantics introduced — this module only gives those conditions a voice. Mapping:
//   merge-conflict       ← 合并冲突 (abort, needs-human, stop dispatch)
//   suite-red            ← 全量 suite 非绿 (stop, no more merges)
//   review-refuted       ← 对抗审查 2 轮后仍 REFUTED (needs-human, stop the task)
//   task-over-90m        ← 任务超 90 分钟 (abort subagent, needs-human, no inner retry)
//   needs-human-backlog  ← needs-human 积压 ≥ 3 (stop dispatching)
//   ruling-required      ← 队列文件与 git 状态矛盾且无法判定 / any question the outer must rule on
//   queue-empty          ← 就绪队列为空 (step-3 stop condition)
//
// SHARED-ROOT RESOLUTION (why this matters): the inner layer runs in a per-task git worktree
// (/tmp/quay-wt-<slug>), but the OUTER Monitor watches the MAIN checkout's `.quay/`. A block
// written to the worktree's local `.quay/` would be invisible to the outer and would evaporate
// when the worktree is removed. So the CLI resolves the SHARED (main) checkout root: when the
// detected root is a linked git worktree (its `.git` is a FILE), the CLI follows `git rev-parse
// --git-common-dir` to the main checkout and writes there. The block signal must outlive the
// worktree that produced it.
//
// TELEMETRY SHAPE (AC7, no second schema): `--clear` emits a schema-valid A1a StageEvent
// (workflow-event-schema.mjs) with stage "Fast" (the additive fast-mode stage), eventKind "blocked"
// (an extra field — A1a allows unknown extras), timing.startedAtMs = since / timing.endedAtMs =
// clear time, and extra blockedReason/blockedQuestion fields. fast-mode-telemetry.ts's aggregate()
// special-cases eventKind === "blocked" BEFORE task pairing, so a blocked event is never mistaken
// for a start/end pair (no orphaned pollution). SCHEMA_VERSION stays "1".
//
// Run:
//   node --experimental-strip-types inner-blocked-signal.ts --detect-stop [--root <dir>]   (MECHANICAL trigger — see below)
//   node --experimental-strip-types inner-blocked-signal.ts --assert-blocked --taskId <id> --reason <r> --question <q> [--options '<json>'] [--evidence '<json>'] [--root <dir>]
//   node --experimental-strip-types inner-blocked-signal.ts --clear [--root <dir>]
//   node --experimental-strip-types inner-blocked-signal.ts --read [--root <dir>]     (prints the record, exit 1 if absent)
//   node --experimental-strip-types inner-blocked-signal.ts --status [--root <dir>]  ("blocked <reason>" | "clear")
//   node --experimental-strip-types inner-blocked-signal.ts --schema                  (schema + valid reasons)
//
// --detect-stop is the "fire as a consequence of a stop condition" trigger (AC1): it evaluates the
// mechanically-detectable stop-and-wait conditions (merge-conflict from git state, task-over-90m
// from telemetry) and WRITES the block record automatically when any holds — the write is a side
// effect of the stop-condition check the tick already runs, not a separately-remembered command.
// It clears a prior "auto" block when no condition holds, and never touches a "manual" block
// (judgment asserts like ruling-required need an explicit --clear).
//
// Storage: `.quay/inner-blocked.json` (gitignored, same family as gate-events.jsonl).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import { SCHEMA_VERSION, validateEvent, emitEvent } from "./workflow-event-schema.mjs";
import {
  FAST_MODE_STAGE,
  FAST_MODE_AGENT_LABEL,
  findRepoRoot,
  getBaseCommit,
  readAllEvents,
  aggregate,
} from "./fast-mode-telemetry.ts";

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────

/** File name of the block record, under `<root>/.quay/`. */
export const BLOCKED_FILE_NAME = "inner-blocked.json";

/**
 * Legal `reason` values = the inner layer's EXISTING stop-and-wait conditions (AC2). This list is
 * the single source of truth; the tick file and the task body document the same seven conditions.
 * A new stop condition added to the tick file MUST be added here too — the CLI rejects any other
 * reason (format drift prevention).
 */
export const VALID_BLOCKED_REASONS = Object.freeze([
  "merge-conflict",
  "suite-red",
  "review-refuted",
  "task-over-90m",
  "needs-human-backlog",
  "ruling-required",
  "queue-empty",
]);

/** Human-readable `reason` → tick-file condition mapping (for --schema / error messages). */
export const REASON_DESCRIPTIONS = Object.freeze({
  "merge-conflict": "合并冲突 — abort, needs-human, stop dispatch",
  "suite-red": "全量 suite 非绿 — stop, no more merges",
  "review-refuted": "对抗审查 2 轮后仍 REFUTED — needs-human, stop the task",
  "task-over-90m": "任务超 90 分钟 — abort subagent, needs-human, no inner retry",
  "needs-human-backlog": "needs-human 积压 ≥ 3 — stop dispatching",
  "ruling-required": "a question the outer must rule on (e.g. queue/git contradiction)",
  "queue-empty": "就绪队列为空 — step-3 stop condition",
});

/**
 * The `.quay/inner-blocked.json` schema (AC1). Fields:
 *   since    (number, ms epoch) — when blocking started; REQUIRED
 *   taskId   (string)           — the stalled task id; REQUIRED
 *   reason   (string)           — one of VALID_BLOCKED_REASONS; REQUIRED
 *   question (string)           — what the outer must rule on; REQUIRED
 *   options  (string[])         — proposed choices (optional)
 *   evidence (string[])         — supporting observations (optional)
 *   source   ("manual"|"auto")  — who asserted this block (optional). "manual" = an explicit
 *             --assert-blocked (a judgment condition such as ruling-required — never auto-cleared);
 *             "auto" = written by --detect-stop as a mechanical consequence of a detected stop
 *             condition (auto-cleared when the condition clears). Absent == "manual" (legacy
 *             records were always manually asserted).
 */
export const BLOCKED_RECORD_SCHEMA = Object.freeze({
  required: ["since", "taskId", "reason", "question"],
  optional: ["options", "evidence", "source"],
  reasonValues: VALID_BLOCKED_REASONS,
});

/** runId for a blocked-wait telemetry event is used verbatim as a path component — must be safe. */
const RUN_ID_SAFE_RE = /^[A-Za-z0-9._-]+$/;

// ── Shared-root resolution ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the SHARED (main) checkout root, not the caller's local worktree root.
 *
 * The inner layer works in a linked worktree (`/tmp/quay-wt-<slug>`), where `.git` is a FILE whose
 * content points at the main repo's `.git/worktrees/<name>`. The outer Monitor watches the MAIN
 * checkout's `.quay/`, and the block record must outlive the worktree that produced it — so a
 * block asserted from inside a worktree MUST land in the main checkout. Follow `git rev-parse
 * --git-common-dir` (the main `.git` dir) and take its parent as the main checkout root, verifying
 * it is actually a workspace before trusting it.
 *
 * FAIL-CLOSED (REFUTE round-1 MINOR 6): when the caller IS in a linked worktree (`.git` is a FILE)
 * but the shared root cannot be resolved (git-common-dir fails, or its parent is not a workspace),
 * this THROWS instead of silently falling back to the worktree root. A block written to the wrong
 * root is precisely the failure class this task exists to prevent — the outer would never see it.
 * An explicit `--root` on the CLI bypasses this entirely.
 *
 * @param {string} [startDir]
 * @returns {string}
 */
export function findSharedRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  const local = findRepoRoot(startDir);
  const gitEntry = path.join(local, ".git");
  // A linked worktree's `.git` is a regular FILE ("gitdir: <main>/.git/worktrees/<name>").
  if (fs.existsSync(gitEntry) && fs.statSync(gitEntry).isFile()) {
    let commonDir;
    try {
      commonDir = execFileSync(
        "git",
        ["-C", local, "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch (e) {
      throw new Error(
        `cannot resolve shared root: ${local} is a linked worktree but git-common-dir resolution failed (${e.message}); pass an explicit --root`,
      );
    }
    const mainRoot = path.dirname(commonDir);
    if (!fs.existsSync(path.join(mainRoot, ".quay", "config.yml"))) {
      throw new Error(
        `cannot resolve shared root: common-dir parent ${mainRoot} is not a workspace (no .quay/config.yml); pass an explicit --root`,
      );
    }
    return mainRoot;
  }
  return local;
}

// ── Path helpers ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Absolute path to the block record for a root.
 * @param {string} root
 * @returns {string}
 */
export function blockedFilePath(root) {
  return path.join(root, ".quay", BLOCKED_FILE_NAME);
}

// ── Record build / validate ───────────────────────────────────────────────────────────────────────────

/**
 * Validate a parsed block record against BLOCKED_RECORD_SCHEMA. Fail-closed.
 * @param {any} rec
 * @returns {{ok: true, record: object} | {ok: false, error: string}}
 */
export function validateBlockedRecord(rec) {
  if (rec == null || typeof rec !== "object" || Array.isArray(rec)) {
    return { ok: false, error: "record must be a non-null object" };
  }
  for (const f of BLOCKED_RECORD_SCHEMA.required) {
    if (!(f in rec)) return { ok: false, error: `missing required field "${f}"` };
  }
  if (typeof rec.since !== "number" || !Number.isFinite(rec.since)) {
    return { ok: false, error: `since must be a finite number (ms epoch), got ${JSON.stringify(rec.since)}` };
  }
  if (typeof rec.taskId !== "string" || rec.taskId.length === 0) {
    return { ok: false, error: "taskId must be a non-empty string" };
  }
  if (typeof rec.reason !== "string" || !VALID_BLOCKED_REASONS.includes(rec.reason)) {
    return {
      ok: false,
      error: `reason "${String(rec.reason)}" is not a legal inner-layer stop condition; must be one of: ${VALID_BLOCKED_REASONS.join(", ")}`,
    };
  }
  if (typeof rec.question !== "string" || rec.question.length === 0) {
    return { ok: false, error: "question must be a non-empty string" };
  }
  if (rec.source !== undefined && rec.source !== "manual" && rec.source !== "auto") {
    return { ok: false, error: `source must be "manual" or "auto", got ${JSON.stringify(rec.source)}` };
  }
  for (const opt of ["options", "evidence"]) {
    if (rec[opt] === undefined) continue;
    if (!Array.isArray(rec[opt]) || rec[opt].some((x) => typeof x !== "string")) {
      return { ok: false, error: `${opt} must be an array of strings` };
    }
  }
  return { ok: true, record: rec };
}

/**
 * Build a block record (validates input, throws on invalid). `options`/`evidence` are optional
 * string arrays; `sinceMs` defaults to now.
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.reason — one of VALID_BLOCKED_REASONS
 * @param {string} opts.question
 * @param {string[]} [opts.options]
 * @param {string[]} [opts.evidence]
 * @param {number} [opts.sinceMs]
 * @param {"manual"|"auto"} [opts.source] — "manual" (default) for --assert-blocked, "auto" for
 *   --detect-stop. "auto" records may be cleared by a later --detect-stop when the condition
 *   clears; "manual" records require an explicit --clear (AC3 negative control).
 * @returns {object}
 */
export function buildBlockedRecord({ taskId, reason, question, options, evidence, sinceMs = Date.now(), source = "manual" }) {
  const rec = {
    since: sinceMs,
    taskId: String(taskId),
    reason,
    question: String(question),
    source,
  };
  if (options !== undefined) rec.options = options;
  if (evidence !== undefined) rec.evidence = evidence;
  const v = validateBlockedRecord(rec);
  if (!v.ok) throw new Error(v.error);
  return rec;
}

// ── Read / write / clear ──────────────────────────────────────────────────────────────────────────────

/**
 * Read and validate the block record, or null when absent. Throws on a malformed file (a corrupted
 * signal must surface, not be silently ignored).
 * @param {string} root
 * @returns {object | null}
 */
export function readBlockedRecord(root) {
  const f = blockedFilePath(root);
  if (!fs.existsSync(f)) return null;
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    throw new Error(`cannot parse ${f}: ${e.message}`);
  }
  const v = validateBlockedRecord(rec);
  if (!v.ok) throw new Error(`invalid ${BLOCKED_FILE_NAME}: ${v.error}`);
  return rec;
}

/**
 * Write the block record — the ONLY writer of `.quay/inner-blocked.json` (AC4: the inner layer
 * never hand-writes it). Refuses to overwrite an existing block (file exists == inner is waiting;
 * a second assert while already blocked is a state bug — --clear first). Fail-closed on validation.
 * @param {string} root
 * @param {object} rec — validated by buildBlockedRecord / validateBlockedRecord
 * @returns {string} — the file path written
 */
export function writeBlockedRecord(root, rec) {
  const v = validateBlockedRecord(rec);
  if (!v.ok) throw new Error(`refusing to write ${BLOCKED_FILE_NAME}: ${v.error}`);
  const f = blockedFilePath(root);
  if (fs.existsSync(f)) {
    throw new Error(`${f} already exists — a block is already asserted; --clear it first`);
  }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(rec, null, 2) + "\n", "utf8");
  return f;
}

// ── Blocked-wait telemetry (AC7) ───────────────────────────────────────────────────────────────────────

/**
 * Build the schema-valid A1a StageEvent that records ONE blocked-wait period. Stage is the additive
 * fast-mode "Fast" stage; `eventKind: "blocked"` (an A1a-allowed extra field) is what aggregate()
 * in fast-mode-telemetry.ts keys on to pull it out of task pairing. `timing.startedAtMs` = since,
 * `timing.endedAtMs` = clear time → duration = endedAtMs − startedAtMs.
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.reason
 * @param {string} opts.question
 * @param {number} opts.sinceMs
 * @param {number} opts.clearedAtMs
 * @param {string|null} [opts.baseCommit]
 * @param {string} opts.root
 * @returns {object}
 */
export function buildBlockedEvent({ taskId, reason, question, sinceMs, clearedAtMs, baseCommit = null, root }) {
  const safe = String(taskId).replace(/[^A-Za-z0-9._-]/g, "-");
  const runId = `blk-${safe}-${sinceMs}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    candidateId: String(taskId),
    taskId: String(taskId),
    stage: FAST_MODE_STAGE,
    attempt: 0,
    timing: { queuedAtMs: null, startedAtMs: sinceMs, endedAtMs: clearedAtMs },
    agentLabel: FAST_MODE_AGENT_LABEL,
    commandIdentity: "inner-blocked-signal:clear",
    executionCwd: root,
    worktreePath: null,
    baseCommit,
    candidateCommit: null,
    outcome: null,
    waitReason: null,
    resourceClaim: null,
    observedWrites: [`.quay/${BLOCKED_FILE_NAME}`],
    isolationMode: null,
    dispatchMode: "serial",
    recordedAtMs: clearedAtMs,
    eventKind: "blocked",
    blockedReason: reason,
    blockedQuestion: question,
  };
}

/**
 * Emit one blocked-wait event into `<root>/.workflow-events/` (same A1a store the fast-mode
 * telemetry reads). Fail-closed on validation or an unsafe runId.
 * @param {string} root
 * @param {object} event — from buildBlockedEvent
 * @returns {string} — the log path written
 */
export function emitBlockedTelemetry(root, event) {
  const v = validateEvent(event);
  if (!v.ok) throw new Error(`blocked event failed A1a validation: ${v.error}`);
  const runId = v.event.runId;
  if (typeof runId !== "string" || !RUN_ID_SAFE_RE.test(runId)) {
    throw new Error(`refusing to write blocked event: runId "${runId}" is not filename-safe`);
  }
  const eventsDir = path.join(root, ".workflow-events");
  fs.mkdirSync(eventsDir, { recursive: true });
  const logPath = path.join(eventsDir, `${runId}.jsonl`);
  fs.appendFileSync(logPath, emitEvent(v.event) + "\n", "utf8");
  return logPath;
}

/**
 * Clear the block record: compute the wait duration (since → now), emit the blocked-wait telemetry
 * event, THEN delete the file. Idempotent — clearing a non-existent block is a no-op success.
 *
 * Fail-closed on telemetry loss: if the blocked-wait event cannot be written, the block file is NOT
 * deleted — the dead-time measurement is the whole point of this task ("this number does not exist
 * today"), so losing it silently is worse than keeping the block visible for investigation.
 *
 * @param {string} root
 * @returns {{cleared: boolean, record: object|null, durationMs?: number, telemetryPath?: string}}
 */
export function clearBlockedRecord(root) {
  const f = blockedFilePath(root);
  if (!fs.existsSync(f)) return { cleared: false, record: null };
  const rec = readBlockedRecord(root);
  const clearedAtMs = Date.now();
  const durationMs = Math.max(0, clearedAtMs - rec.since);
  let telemetryPath;
  try {
    telemetryPath = emitBlockedTelemetry(root, buildBlockedEvent({
      taskId: rec.taskId,
      reason: rec.reason,
      question: rec.question,
      sinceMs: rec.since,
      clearedAtMs,
      baseCommit: getBaseCommit(root),
      root,
    }));
  } catch (e) {
    throw new Error(`failed to record blocked-wait telemetry (block NOT cleared): ${e.message}`);
  }
  fs.rmSync(f, { force: true });
  return { cleared: true, record: rec, durationMs, telemetryPath };
}

// ── Mechanical stop-condition detection (gap-the-blocked-channel-has-a-writer-nobody-calls, AC1) ───────

/**
 * Task budget in ms — 90 minutes, matching the tick file's 判断边界 table ("任务超 90 分钟").
 * A task in-progress longer than this is a mechanically-detectable stop-and-wait condition: the
 * tick MUST abort the subagent and wait for a ruling (no inner retry).
 */
export const TASK_OVER_90M_MS = 90 * 60 * 1000;

/**
 * Detect a merge conflict with unresolved paths (reason "merge-conflict").
 *
 * Mechanical: `git ls-files -u` lists unmerged index paths — the canonical "conflict unresolved"
 * signal. Only UNRESOLVED paths count as blocked: a merge mid-flight with all paths staged
 * (MERGE_HEAD present but no unmerged entries) is the tick's normal fan-in, not a stop-and-wait —
 * the tick commits it and moves on. The outer must rule only when paths are still unmerged.
 * A non-git root (or a git command failure) is "no conflict", never a throw: `--detect-stop` is a
 * detector, not a gate, and a root without git state must not crash the tick.
 *
 * @param {string} root
 * @returns {{taskId: string, reason: "merge-conflict", question: string, evidence: string[]} | null}
 */
export function detectMergeConflict(root) {
  let unmerged = "";
  try {
    unmerged = execFileSync("git", ["-C", root, "ls-files", "-u"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_) { /* not a git repo, or git unavailable → no conflict to detect */ }
  if (!unmerged) return null;
  const paths = [...new Set(unmerged.split("\n").map((l) => l.split("\t").pop()).filter(Boolean))];
  const question = `merge conflict in progress (unresolved: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? `, +${paths.length - 3} more` : ""}) — rule on how to resolve (abort + needs-human, or pick a side), then run --clear`;
  return { taskId: "fast-mode-loop", reason: "merge-conflict", question, evidence: paths.slice(0, 5) };
}

/**
 * Detect a task in-progress over the 90-minute budget (reason "task-over-90m").
 *
 * Mechanical: reads the SAME `.workflow-events/` store the tick's own `--task-start`/`--task-end`
 * writes, and asks the telemetry aggregate for inProgress tasks older than TASK_OVER_90M_MS. This
 * is the inner-state.sh OVER90 signal (a task the outer already flags) made into a block: the
 * tick MUST abort the subagent and wait (no inner retry).
 *
 * @param {string} root
 * @returns {Promise<{taskId: string, reason: "task-over-90m", question: string, evidence: string[]} | null>}
 */
export async function detectTaskOver90m(root) {
  const events = [];
  for await (const e of readAllEvents(root)) events.push(e);
  const nowMs = Date.now();
  const rep = aggregate(events, { nowMs });
  const over = rep.inProgress.filter((p) => nowMs - p.startedAtMs > TASK_OVER_90M_MS);
  if (over.length === 0) return null;
  const p = over[0];
  const mins = ((nowMs - p.startedAtMs) / 60_000).toFixed(1);
  return {
    taskId: p.taskId,
    reason: "task-over-90m",
    question: `task ${p.taskId} has been in-progress ${mins}m (>90m) — rule on abort vs continue (no inner retry), then run --clear`,
    evidence: [`${p.taskId} started ${new Date(p.startedAtMs).toISOString()}`, `in-progress ${over.length} task(s) over budget`],
  };
}

/**
 * Evaluate every mechanically-detectable stop-and-wait condition, in a deterministic order.
 * @param {string} root
 * @returns {Promise<Array<{reason: string, question: string, evidence?: string[]}>>}
 */
export async function detectStopConditions(root) {
  const found = [];
  const conflict = detectMergeConflict(root);
  if (conflict) found.push(conflict);
  const over = await detectTaskOver90m(root);
  if (over) found.push(over);
  return found;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────

const usage = `inner-blocked-signal.ts — explicit "inner is stopped and waiting" signal (gap-no-explicit-blocked-signal-from-inner-layer)

Usage:
  node --experimental-strip-types inner-blocked-signal.ts --detect-stop [--root <dir>]
  node --experimental-strip-types inner-blocked-signal.ts --assert-blocked --taskId <id> --reason <r> --question <q> [--options '<json>'] [--evidence '<json>'] [--root <dir>]
  node --experimental-strip-types inner-blocked-signal.ts --clear [--root <dir>]
  node --experimental-strip-types inner-blocked-signal.ts --read [--root <dir>]
  node --experimental-strip-types inner-blocked-signal.ts --status [--root <dir>]
  node --experimental-strip-types inner-blocked-signal.ts --schema

--detect-stop is the MECHANICAL trigger (AC1): it evaluates the mechanically-detectable stop
conditions (merge-conflict, task-over-90m) and writes the block automatically when any holds, as a
consequence of the stop-condition check the tick already runs. It clears a prior "auto" block when
no condition holds; a "manual" block (judgment assert) is never auto-cleared.
--assert-blocked writes .quay/inner-blocked.json manually (for judgment conditions like
ruling-required that cannot be detected from repo state). The CLI is the ONLY writer — never
hand-write the JSON.
--clear records the wait duration into telemetry, then deletes the file. --root defaults to the
SHARED checkout root (a worktree invocation resolves to the main checkout so the outer can see it).`;

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function parseStringArrayArg(args, name) {
  const raw = getArgValue(args, `--${name}`);
  if (raw === undefined) return undefined;
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch (e) {
    throw new Error(`--${name} must be a JSON array of strings, got invalid JSON: ${e.message}`);
  }
  if (!Array.isArray(arr) || arr.some((x) => typeof x !== "string")) {
    throw new Error(`--${name} must be a JSON array of strings`);
  }
  return arr;
}

/**
 * CLI main. @param {string[]} argv — process.argv @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const args = argv.slice(2);

  // --schema — pure informational (AC1: the schema is defined here, not in a second doc).
  if (args.includes("--schema")) {
    console.log(JSON.stringify({
      file: `.quay/${BLOCKED_FILE_NAME}`,
      schema: BLOCKED_RECORD_SCHEMA,
      reasons: VALID_BLOCKED_REASONS.map((r) => ({ [r]: REASON_DESCRIPTIONS[r] })),
      example: {
        since: 1785700000000,
        taskId: "gap-…",
        reason: "ruling-required",
        question: "M243 冲突按 A 还是 B",
        options: ["A: …", "B: …"],
        evidence: ["20 tests / 6 pass / 14 fail", "tampered 负控制也失败"],
      },
    }, null, 2));
    return 0;
  }

  const rootArg = getArgValue(args, "--root");
  const root = rootArg ? path.resolve(rootArg) : findSharedRoot();

  // --assert-blocked
  if (args.includes("--assert-blocked")) {
    const taskId = getArgValue(args, "--taskId");
    const reason = getArgValue(args, "--reason");
    const question = getArgValue(args, "--question");
    if (!taskId || !reason || !question) {
      console.error("inner-blocked-signal: --assert-blocked requires --taskId <id> --reason <r> --question <q>");
      return 1;
    }
    let options;
    let evidence;
    try {
      options = parseStringArrayArg(args, "options");
      evidence = parseStringArrayArg(args, "evidence");
      const rec = buildBlockedRecord({ taskId, reason, question, options, evidence });
      const f = writeBlockedRecord(root, rec);
      console.log(`inner-blocked-signal: blocked asserted (${reason}) — ${f}`);
      return 0;
    } catch (e) {
      console.error(`inner-blocked-signal: ${e.message}`);
      return 1;
    }
  }

  // --detect-stop — THE MECHANICAL TRIGGER (AC1). Evaluates the mechanically-detectable stop
  // conditions (merge-conflict, task-over-90m). Any condition holds ⇒ WRITE `.quay/inner-blocked.json`
  // as a consequence (auto reason/question/evidence, source "auto"). None holds ⇒ clear a prior
  // "auto" block. A "manual" block (judgment assert like ruling-required) is NEVER auto-cleared —
  // only an explicit --clear does that (AC3 negative control). The tick file's step-3 stop-condition
  // check IS this command, so the write happens on an action the inner already takes every tick —
  // not because someone remembered to call --assert-blocked.
  if (args.includes("--detect-stop")) {
    try {
      const found = await detectStopConditions(root);
      const reasons = found.map((c) => c.reason);
      const existing = readBlockedRecord(root);
      if (existing) {
        if (existing.source === "manual") {
          console.log(
            `detect-stop: already blocked (manual ${existing.reason}) — ${existing.question}\n` +
              `detect-stop: auto conditions now: ${reasons.length ? reasons.join(", ") : "none"} (manual block left in place; --clear when the ruling lands)`,
          );
          return 0;
        }
        if (reasons.length) {
          console.log(`detect-stop: still blocked (auto ${existing.reason}) — conditions persist: ${reasons.join(", ")}`);
          return 0;
        }
        const res = clearBlockedRecord(root);
        console.log(
          `detect-stop: stop condition cleared — removed block (${res.record.taskId}, ${res.record.reason}), wait ${(res.durationMs / 1000).toFixed(1)}s`,
        );
        return 0;
      }
      if (reasons.length) {
        const cond = found[0];
        const rec = buildBlockedRecord({
          taskId: cond.taskId ?? "fast-mode-loop",
          reason: cond.reason,
          question: cond.question,
          options: cond.options,
          evidence: cond.evidence,
          source: "auto",
        });
        const f = writeBlockedRecord(root, rec);
        console.log(`detect-stop: STOP CONDITION — ${cond.reason} (auto-block written) — ${f}`);
        for (const extra of found.slice(1)) {
          console.log(`detect-stop: also: ${extra.reason} — ${extra.question}`);
        }
        return 0;
      }
      console.log("detect-stop: no stop condition; no block");
      return 0;
    } catch (e) {
      console.error(`inner-blocked-signal: ${e.message}`);
      return 1;
    }
  }

  // --clear
  if (args.includes("--clear")) {
    try {
      const res = clearBlockedRecord(root);
      if (!res.cleared) {
        console.log("inner-blocked-signal: no block to clear");
        return 0;
      }
      console.log(
        `inner-blocked-signal: cleared block (${res.record.taskId}, ${res.record.reason}) — wait ${(res.durationMs / 1000).toFixed(1)}s; telemetry ${res.telemetryPath}`,
      );
      return 0;
    } catch (e) {
      console.error(`inner-blocked-signal: ${e.message}`);
      return 1;
    }
  }

  // --read — print the record JSON (or exit 1 when absent). Used by the readiness check and monitor.
  if (args.includes("--read")) {
    try {
      const rec = readBlockedRecord(root);
      if (!rec) {
        console.error("inner-blocked-signal: no block");
        return 1;
      }
      console.log(JSON.stringify(rec, null, 2));
      return 0;
    } catch (e) {
      console.error(`inner-blocked-signal: ${e.message}`);
      return 1;
    }
  }

  // --status — one line: "blocked <reason> <question>" or "clear". Exit 0 either way.
  if (args.includes("--status")) {
    try {
      const rec = readBlockedRecord(root);
      if (rec) {
        console.log(`blocked ${rec.reason} ${rec.question}`);
      } else {
        console.log("clear");
      }
      return 0;
    } catch (e) {
      console.error(`inner-blocked-signal: ${e.message}`);
      return 1;
    }
  }

  console.log(usage);
  return 0;
}

// ── Direct-entry check ───────────────────────────────────────────────────────────────────────────────

if (isDirectEntry(import.meta)) {
  main(process.argv).then((code) => process.exit(code));
}
