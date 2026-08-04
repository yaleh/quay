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
// ($WORKTREE_ROOT/<slug> — a disk path, see loop.worktree_root), but the OUTER Monitor watches
// the MAIN checkout's `.quay/`. A block
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
// gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger (2026-08-04): the third
// condition — `ruling-required`, "any question the outer must rule on", the exact reason behind the
// 68-minute incident this whole channel was built for — had NO mechanical trigger: only a manual
// `--assert-blocked`, and production evidence (`orchestration/tick-log.md` 18:26Z/19:5xZ,
// `docs/analysis/batch2-queue-state.md:1596`) shows that manual call was NEVER made across the
// mechanism's entire history, despite the tick doc instructing it in prose ("再加一条文档指令不会
// 有用"). AC1 finding (see the task body for the full write-up): the only OTHER candidate trace —
// the inner writing its question into its own tick narration — is free prose with no stable schema
// (same "remember to write it in a parseable way" failure, just generalized; confirmed via
// `inner-idle-log.ts`'s `awaiting-ruling` reason, which has the identical manual-append shape and
// the same non-adoption). The trace that DOES exist without requiring the inner to remember
// anything is a COMPOSITE of three already-mechanical signals: the session transcript has stopped
// advancing (`detectRulingRequiredStall` below), a task is still `inProgress` per telemetry, and the
// working tree is clean. This is a PROXY for the SHAPE of "stopped, waiting" — same caveat
// `task-over-90m` already carries as an age proxy, now explicit for this condition too: it does not
// read the actual question (no mechanical trace for the question's CONTENT exists), it recognizes
// the STOPPED shape. `--transcript <path>` is required, explicit, never inferred (same principle as
// `session-liveness.sh`'s `SESSION_TRANSCRIPTS` — a pid/session→file mapping is not safe to guess);
// omitting it leaves this detector a no-op, so the pre-existing two conditions are byte-for-behavior
// unchanged (AC5).
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
 * The inner layer works in a linked worktree (`$WORKTREE_ROOT/<slug>` — a disk path, see
 * loop.worktree_root), where `.git` is a FILE whose content points at the main repo's
 * `.git/worktrees/<name>`. The outer Monitor watches the MAIN
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
 * Ruling-required stall threshold (ms). Reuses `session-liveness.sh`'s OVERDUE_MIN=30 calibration
 * verbatim rather than inventing a new number: that file's own comment records the ONE empirically
 * measured real-work quiet spell during a genuinely long, non-blocked task as 20.5 minutes ("阶段一
 * 实测 transcript 长任务最大间隙 20.5min"), and picked 30 minutes to keep ~9.5min margin above it.
 * The same false-positive risk applies here (AC4: a normal long-running task must not be flagged),
 * so the same vetted threshold is reused rather than re-derived.
 */
export const RULING_REQUIRED_STALL_MS = 30 * 60 * 1000;

/**
 * mtime (ms epoch) of a transcript heartbeat source: the transcript file itself, OR — if fresher —
 * any file under its sibling `<id>/subagents/` directory. Same technique as `session-liveness.sh`'s
 * `heartbeat_mtime` / `inner-forensics.mjs`'s `transcriptSet`: the inner's own transcript goes quiet
 * while it has delegated work to a subagent, whose activity lands in that directory, not the main
 * transcript file — reading only the main file would misread "busy delegating" as "frozen".
 * @param {string} transcriptPath
 * @returns {number} 0 when the path does not exist.
 */
export function transcriptHeartbeatMtimeMs(transcriptPath) {
  let max = 0;
  try {
    max = fs.statSync(transcriptPath).mtimeMs;
  } catch (_) {
    return 0;
  }
  const subDir = transcriptPath.replace(/\.jsonl$/, "") + "/subagents";
  try {
    for (const f of fs.readdirSync(subDir)) {
      if (!f.endsWith(".jsonl")) continue;
      const m = fs.statSync(path.join(subDir, f)).mtimeMs;
      if (m > max) max = m;
    }
  } catch (_) { /* no subagents dir — fine, main file mtime stands */ }
  return max;
}

/**
 * Whether `root`'s git working tree has zero staged/unstaged changes (`git status --porcelain`
 * empty). Returns `null` when it cannot be determined (non-git root, git failure) — the caller MUST
 * treat `null` the same as "dirty" (do not fire): a false "can't tell" must not become a false
 * positive (AC4 priority — "把「抓不到」修成「总在报」是更坏的交易" applies here too).
 * @param {string} root
 * @returns {boolean | null}
 */
export function isWorkingTreeClean(root) {
  try {
    const out = execFileSync("git", ["-C", root, "status", "--porcelain"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length === 0;
  } catch (_) {
    return null;
  }
}

/**
 * Detect the composite "stopped waiting for a ruling" trace (reason "ruling-required", AC1/AC2):
 * transcript heartbeat stale ≥ stallMs, AND a task is in-progress per telemetry, AND the working
 * tree is clean. All three conjuncts must hold — this is deliberately narrower than any one signal
 * alone (a dirty tree or an absent in-progress task means "actively producing work", and a stale
 * transcript alone is exactly `SESSION-OVERDUE`'s job, not this one — see the file-header note for
 * why the earlier commit-age-only heuristic, `AC9c`, had a real false positive during legitimate
 * fan-in and needed a human to disambiguate by reading the pane).
 *
 * `transcriptPath` is EXPLICIT CONFIG (never inferred — see file header). No transcript path, or a
 * configured path that does not exist, ⇒ this detector is a no-op (`null`), so callers that never
 * pass `--transcript` see byte-for-behavior the same two conditions as before (AC5).
 *
 * @param {string} root
 * @param {{transcriptPath?: string, nowMs?: number, stallMs?: number}} [opts]
 * @returns {Promise<{taskId: string, reason: "ruling-required", question: string, evidence: string[]} | null>}
 */
export async function detectRulingRequiredStall(root, { transcriptPath, nowMs = Date.now(), stallMs = RULING_REQUIRED_STALL_MS } = {}) {
  if (!transcriptPath) return null;
  const hbMs = transcriptHeartbeatMtimeMs(transcriptPath);
  if (hbMs === 0) return null; // configured path does not exist ⇒ cannot detect
  const staleMs = nowMs - hbMs;
  if (staleMs < stallMs) return null;

  const events = [];
  for await (const e of readAllEvents(root)) events.push(e);
  const rep = aggregate(events, { nowMs });
  if (rep.inProgress.length === 0) return null; // nothing in-progress ⇒ nothing to be stuck on

  const clean = isWorkingTreeClean(root);
  if (clean !== true) return null; // dirty, or undeterminable ⇒ fail-closed toward NOT flagging

  const p = rep.inProgress[0];
  const staleMin = (staleMs / 60_000).toFixed(1);
  return {
    taskId: p.taskId,
    reason: "ruling-required",
    question: `transcript has not advanced in ${staleMin}m while task ${p.taskId} is in-progress and the working tree is clean — likely stopped waiting on a ruling; rule on it, then run --clear`,
    evidence: [
      `transcript heartbeat stale ${staleMin}m (threshold ${(stallMs / 60_000).toFixed(0)}m)`,
      `${p.taskId} in-progress since ${new Date(p.startedAtMs).toISOString()}`,
      "working tree clean (git status --porcelain empty)",
    ],
  };
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
 * `ruling-required` is checked BEFORE `task-over-90m` on purpose: it exists to catch the same class
 * of stall earlier (AC3), so when both would apply near the 90-minute boundary, the earlier-firing
 * reason is the one reported.
 * @param {string} root
 * @param {{transcriptPath?: string, nowMs?: number, stallMs?: number}} [opts]
 * @returns {Promise<Array<{reason: string, question: string, evidence?: string[]}>>}
 */
export async function detectStopConditions(root, opts = {}) {
  const found = [];
  const conflict = detectMergeConflict(root);
  if (conflict) found.push(conflict);
  const stall = await detectRulingRequiredStall(root, opts);
  if (stall) found.push(stall);
  const over = await detectTaskOver90m(root);
  if (over) found.push(over);
  return found;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────

const usage = `inner-blocked-signal.ts — explicit "inner is stopped and waiting" signal (gap-no-explicit-blocked-signal-from-inner-layer)

Usage:
  node --experimental-strip-types inner-blocked-signal.ts --detect-stop [--root <dir>] [--transcript <path>]
  node --experimental-strip-types inner-blocked-signal.ts --assert-blocked --taskId <id> --reason <r> --question <q> [--options '<json>'] [--evidence '<json>'] [--root <dir>]
  node --experimental-strip-types inner-blocked-signal.ts --clear [--root <dir>]
  node --experimental-strip-types inner-blocked-signal.ts --read [--root <dir>]
  node --experimental-strip-types inner-blocked-signal.ts --status [--root <dir>]
  node --experimental-strip-types inner-blocked-signal.ts --schema

--detect-stop is the MECHANICAL trigger (AC1): it evaluates the mechanically-detectable stop
conditions (merge-conflict, task-over-90m) and writes the block automatically when any holds, as a
consequence of the stop-condition check the tick already runs. It clears a prior "auto" block when
no condition holds; a "manual" block (judgment assert) is never auto-cleared.
--transcript <path> (or env INNER_BLOCKED_TRANSCRIPT) additionally enables the "ruling-required"
composite trace (gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger): transcript
heartbeat stale ≥30m AND a task in-progress AND a clean working tree. Explicit config, never
inferred; omitted ⇒ no-op, the other two conditions are unaffected.
--assert-blocked writes .quay/inner-blocked.json manually (for judgment conditions that cannot be
detected from repo state, or when no --transcript is configured). The CLI is the ONLY writer — never
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
  // conditions (merge-conflict, ruling-required stall, task-over-90m). Any condition holds ⇒ WRITE
  // `.quay/inner-blocked.json` as a consequence (auto reason/question/evidence, source "auto"). None
  // holds ⇒ clear a prior "auto" block. A "manual" block (an --assert-blocked with no matching
  // mechanical condition) is NEVER auto-cleared — only an explicit --clear does that (AC3 negative
  // control). The tick file's step-3 stop-condition check IS this command, so the write happens on
  // an action the inner already takes every tick — not because someone remembered to call
  // --assert-blocked.
  //
  // --transcript <path> (or env INNER_BLOCKED_TRANSCRIPT) is EXPLICIT config for the ruling-required
  // composite trace — never inferred. INNER_BLOCKED_RULING_STALL_MS is a test-only override of the
  // 30-minute threshold (RULING_REQUIRED_STALL_MS), so tests can prove the real temporal logic at a
  // compressed, real wall-clock scale instead of only backdating timestamps.
  if (args.includes("--detect-stop")) {
    try {
      const transcriptArg = getArgValue(args, "--transcript");
      const transcriptPath = transcriptArg
        ? path.resolve(transcriptArg)
        : process.env.INNER_BLOCKED_TRANSCRIPT
          ? path.resolve(process.env.INNER_BLOCKED_TRANSCRIPT)
          : undefined;
      const stallMsOverride = process.env.INNER_BLOCKED_RULING_STALL_MS
        ? Number(process.env.INNER_BLOCKED_RULING_STALL_MS)
        : undefined;
      const found = await detectStopConditions(root, {
        transcriptPath,
        ...(Number.isFinite(stallMsOverride) ? { stallMs: stallMsOverride } : {}),
      });
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
