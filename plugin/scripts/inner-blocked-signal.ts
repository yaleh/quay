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
//   node --experimental-strip-types inner-blocked-signal.ts --detect-stop [--root <dir>] [--target <name>] [--samples <N>] [--action <a>] [--action-command <cmd>] [--pane <pane.txt>] [--tmux-target <target>]   (MECHANICAL trigger — see below)
//   node --experimental-strip-types inner-blocked-signal.ts --assert-blocked --taskId <id> --reason <r> --question <q> [--options '<json>'] [--evidence '<json>'] [--root <dir>] [--target <name>]
//   node --experimental-strip-types inner-blocked-signal.ts --clear [--root <dir>] [--target <name>]
//   node --experimental-strip-types inner-blocked-signal.ts --timeout [--max-age-ms N] [--root <dir>] [--target <name>]   (CONSUMPTION TIMEOUT / auto-upgrade — alias of --escalate-stale; a consumed-by-nobody block older than N minutes is auto-archived (升级/归档), so inner never freezes on a stale signal)
//   node --experimental-strip-types inner-blocked-signal.ts --escalate-stale [--max-age-ms N] [--root <dir>] [--target <name>]   (AC9/back-compat alias of --timeout)
//   node --experimental-strip-types inner-blocked-signal.ts --read [--root <dir>] [--target <name>]     (prints the record, exit 1 if absent)
//   node --experimental-strip-types inner-blocked-signal.ts --status [--root <dir>] [--target <name>]  ("blocked <reason>" | "clear")
//   node --experimental-strip-types inner-blocked-signal.ts --schema                  (schema + valid reasons)
//
// PARAMETERIZED OBSERVATION PRIMITIVE (gap-ruling-required-only-covers-outer-to-inner-not-manager-to-
// outer, 2026-08-05): the "who-is-waiting" mechanism used to be ONE-DIRECTIONAL + HARDCODED — the
// outer watched ONLY the inner pane, writing ONLY `.quay/inner-blocked.json` (BLOCKED_FILE_NAME),
// with ONLY one reaction (write the file), and the samples threshold lived only in an env override.
// Two real incidents (2026-08-05) fell in the blind spot: nobody watched the outer/manager layer.
// This module is now a parameterized observation primitive — WHO is watched, HOW MANY consecutive
// samples, and WHAT happens on detection are all caller-configured, not re-implemented per direction:
//   --target <name>   who is being observed. `inner` (default) keeps the legacy path
//                     `.quay/inner-blocked.json` (backward compatible); any other filename-safe name
//                     (`outer`, `manager`, …) writes `.quay/blocked-signals/<target>.json`. The three
//                     canonical targets are inner/outer/manager — each observable with one call.
//   --samples <N>     consecutive needs-input samples before a ruling-required condition (default 3,
//                     overridable; env INNER_BLOCKED_RULING_SAMPLES remains a test/ops override).
//   --action <a>      the ACTION PLUGIN POINT: what happens AFTER a stop condition is detected.
//                     "write-file" (default) writes the block record (existing behavior);
//                     "notify" prints `detect-stop: BLOCKED <reason>: <question>` and writes nothing;
//                     "command" runs --action-command <cmd> with the condition JSON + signal path in
//                     the environment (BLOCKED_CONDITION_JSON / BLOCKED_SIGNAL_PATH / BLOCKED_TARGET).
//                     The reaction is caller-configured, not the only reaction.
// For non-inner targets ONLY the SCREEN observer runs (the observation primitive) — the inner-specific
// mechanical conditions (merge-conflict / transcript composite / task-over-90m) are inner-layer state
// and do not apply to watching the outer/manager pane.
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
// gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick (2026-08-04): the composite
// above was DEAD CODE in production — no tick ever passed `--transcript`, and its ≥30-minute
// staleness threshold (a) violated the ≤5-minute p100 ruling budget (裁定 C) and (b) is a SHAPE
// PROXY that cannot see permission dialogs — the exact class 裁定 D names most important. The
// PRIMARY ruling-required trigger is now the SCREEN OBSERVER (`--detect-stop --pane <path>`):
// the outer polls the inner pane every 60s, classifies its BOTTOM REGION with `classifyPaneState`
// (pure SHAPE classification, ADR-016 Amendment — never a whole-screen hash), and after N
// CONSECUTIVE waiting-input / permission-prompt samples (default 3 ⇒ ~3min structural latency ≤
// 5min p100 budget, AC2) writes a ruling-required block with an actionable question + the bottom
// region as evidence. `--transcript` is preserved as side evidence for "session actually dead" but
// is no longer the primary criterion (AC3); `--clear` also resets the observer's rolling counter.
//
// gap-last-pane-txt-has-no-writer (2026-08-09, candidate B): `.quay/last-pane.txt` is a dead file with
// NO writer — A7 was reading a 4h-stale snapshot forever (`pane_decision=busy branch=reset
// consecutive=0/3`), so the inner could sit on a permission dialog and the outer never saw it. The
// SCREEN OBSERVER now treats a STALE (mtime > PANE_STALENESS_MS / 300s) or ABSENT --pane snapshot as
// UNTRUSTED and reads a LIVE `tmux capture-pane -p -t <tmux-target>` instead (the same read-only
// primitive session-liveness.sh uses), eliminating the dead-snapshot class. Live capture is EXPLICIT
// config (--tmux-target > env INNER_BLOCKED_TMUX_TARGET / SESSION_TMUX_TARGET > SESSION_TMUX_SESSION
// env or <root>/orchestration/session-liveness.env resolved as `<session>:<target>`), never a guess;
// when neither a fresh file nor a live source is available the observation is "unreadable" (counter
// resets — no false positive on stale data). The pane_decision line now carries `source=file|live`.
//
// Storage: `.quay/inner-blocked.json` for `--target inner` (gitignored, same family as
// gate-events.jsonl); `.quay/blocked-signals/<target>.json` for any other target.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry, readFrontmatter } from "./gate-script-base.ts";
import { SCHEMA_VERSION, validateEvent, emitEvent } from "./workflow-event-schema.mjs";
import {
  FAST_MODE_STAGE,
  FAST_MODE_AGENT_LABEL,
  findRepoRoot,
  getBaseCommit,
  readAllEvents,
  aggregate,
  isBranchMerged,
  reconcileInFlight,
} from "./fast-mode-telemetry.ts";
import { classifyPaneState } from "./pane-state-classify.ts";

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────

/** File name of the block record, under `<root>/.quay/`. */
export const BLOCKED_FILE_NAME = "inner-blocked.json";

/**
 * The canonical observation targets (AC1: inner/outer/manager each observable). Any filename-safe
 * name is accepted — these three are the ones the two-layer fast mode actually has layers for.
 */
export const CANONICAL_TARGETS = Object.freeze(["inner", "outer", "manager"]);

/** Default `--target` — keeps the legacy `.quay/inner-blocked.json` path (backward compatible). */
export const DEFAULT_TARGET = "inner";

/** A `--target` is used as a path component — must be filename-safe (no traversal, no slashes). */
const TARGET_SAFE_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Validate + normalize a `--target` name. Fail-closed on anything not filename-safe. The default
 * (undefined) resolves to `inner`.
 * @param {string} [name]
 * @returns {string}
 */
export function resolveTarget(name) {
  const t = name === undefined || name === null || name === "" ? DEFAULT_TARGET : String(name);
  if (!TARGET_SAFE_RE.test(t)) {
    throw new Error(`invalid --target "${t}": must be filename-safe (${TARGET_SAFE_RE})`);
  }
  return t;
}

/**
 * The action plugin point (AC3): what happens AFTER a stop condition is detected. The reaction is
 * caller-configured — not hardcoded to "write the signal file". `write-file` is the default (the
 * existing behavior); `notify` prints and writes nothing; `command` runs a caller-supplied command.
 */
export const BLOCK_ACTIONS = Object.freeze(["write-file", "notify", "command"]);
export const DEFAULT_BLOCK_ACTION = "write-file";

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

// ── Blocked-signal timeout escalation — task gap-blocked-signal-timeout-auto-escalation
//    (independent mechanism; carried from gap-telemetry-brackets-vs-subagents-no-slot-visibility
//    AC9, AC3 cross-annotation) ────────────────────────────────────────────────────────────────
// A blocked signal nobody consumes must not let inner wait forever (the 92-minute false-block class
// tonight: fake OVER90 / red-window leftover brackets wrote a block the outer never consumed).
// `--timeout` (alias `--escalate-stale`) bounds each blocking episode: a block older than the
// threshold (default 30m) is auto-archived — 升级/归档 — the wait duration is recorded into
// telemetry and an escalation line appended to `.quay/blocked-escalations.jsonl` — so the block
// file cannot persist indefinitely. The underlying stop condition is untouched: if it genuinely
// persists, the next `--detect-stop` writes a FRESH block with a fresh `since`, re-validating the
// wait rather than freezing on a stale one. The false-signal SOURCE is removed separately by the
// reconcile-aware over-90m gate + task-status gate (detectTaskOver90m, gap-telemetry-brackets AC8 /
// gap-over-90m-false-signal-source-reads-telemetry-not-task-status) — this mechanism is the
// consumption-timeout safety net ON TOP of that source removal.

/** Default block-age threshold beyond which a block is auto-escalated (30 minutes). */
export const DEFAULT_BLOCKED_ESCALATION_MS = 30 * 60 * 1000;

/** Filename of the append-only escalation log under `<root>/.quay/`. */
export const ESCALATION_LOG_FILENAME = "blocked-escalations.jsonl";

/**
 * Path to the escalation log for a root (always the shared/main checkout, like the block file).
 * @param {string} root
 * @returns {string}
 */
export function escalationLogPath(root) {
  return path.join(root, ".quay", ESCALATION_LOG_FILENAME);
}

/**
 * Whether a block record is stale (older than the escalation threshold). PURE.
 * @param {object|null} rec
 * @param {number} [nowMs]
 * @param {number} [thresholdMs]
 * @returns {boolean}
 */
export function isBlockStale(rec, nowMs = Date.now(), thresholdMs = DEFAULT_BLOCKED_ESCALATION_MS) {
  return rec != null && typeof rec.since === "number" && nowMs - rec.since >= thresholdMs;
}

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
 * Absolute path to the block record for a root + target. `--target inner` (default) keeps the legacy
 * `.quay/inner-blocked.json`; any other target namespaces under `.quay/blocked-signals/<target>.json`
 * (AC1 — output is namespaced by target, not hardcoded).
 * @param {string} root
 * @param {string} [target]
 * @returns {string}
 */
export function blockedFilePath(root, target = DEFAULT_TARGET) {
  const t = resolveTarget(target);
  if (t === "inner") return path.join(root, ".quay", BLOCKED_FILE_NAME);
  return path.join(root, ".quay", "blocked-signals", `${t}.json`);
}

/**
 * Repo-root-relative path of the block record for a target — used in stdout (so a watcher can grep
 * the namespace without knowing the root) and in telemetry `observedWrites`.
 * @param {string} [target]
 * @returns {string}
 */
export function blockedFileRelPath(target = DEFAULT_TARGET) {
  const t = resolveTarget(target);
  if (t === "inner") return `.quay/${BLOCKED_FILE_NAME}`;
  return `.quay/blocked-signals/${t}.json`;
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
 * Read and validate the block record for a target, or null when absent. Throws on a malformed file
 * (a corrupted signal must surface, not be silently ignored).
 * @param {string} root
 * @param {string} [target]
 * @returns {object | null}
 */
export function readBlockedRecord(root, target = DEFAULT_TARGET) {
  const f = blockedFilePath(root, target);
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
 * Write the block record — the ONLY writer of the block JSON (AC4: the layer never hand-writes it).
 * Refuses to overwrite an existing block for the SAME target (file exists == that target is waiting;
 * a second assert while already blocked is a state bug — --clear first). Fail-closed on validation.
 * @param {string} root
 * @param {object} rec — validated by buildBlockedRecord / validateBlockedRecord
 * @param {string} [target] — which observation target's signal file to write
 * @returns {string} — the file path written
 */
export function writeBlockedRecord(root, rec, target = DEFAULT_TARGET) {
  const v = validateBlockedRecord(rec);
  if (!v.ok) throw new Error(`refusing to write ${blockedFileRelPath(target)}: ${v.error}`);
  const f = blockedFilePath(root, target);
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
 * @param {string} [opts.target] — observation target (drives observedWrites' namespaced path)
 * @returns {object}
 */
export function buildBlockedEvent({ taskId, reason, question, sinceMs, clearedAtMs, baseCommit = null, root, target = DEFAULT_TARGET }) {
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
    observedWrites: [blockedFileRelPath(target)],
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
 * @param {string} [target]
 * @returns {{cleared: boolean, record: object|null, durationMs?: number, telemetryPath?: string}}
 */
export function clearBlockedRecord(root, target = DEFAULT_TARGET) {
  const f = blockedFilePath(root, target);
  if (!fs.existsSync(f)) return { cleared: false, record: null };
  const rec = readBlockedRecord(root, target);
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
      target,
    }));
  } catch (e) {
    throw new Error(`failed to record blocked-wait telemetry (block NOT cleared): ${e.message}`);
  }
  fs.rmSync(f, { force: true });
  return { cleared: true, record: rec, durationMs, telemetryPath };
}

/**
 * Auto-escalate a blocked signal nobody consumed (gap-telemetry-brackets-vs-subagents-no-slot-
 * visibility, AC9). When a block record is older than the escalation threshold, record the wait
 * duration into telemetry, append an escalation line to `.quay/blocked-escalations.jsonl`, and
 * remove the block file — bounding the episode so inner cannot wait forever on a stale signal.
 *
 * NOT stale / no block ⇒ no-op (the block file is untouched). Fail-closed on telemetry loss: if the
 * wait duration cannot be recorded, the block is NOT removed (same rule as clearBlockedRecord).
 *
 * @param {string} root
 * @param {string} [target]
 * @param {{thresholdMs?: number, nowMs?: number}} [opts]
 * @returns {{escalated: boolean, reason: string, record?: object|null, ageMs?: number, thresholdMs?: number, durationMs?: number, telemetryPath?: string, escalationPath?: string}}
 */
export function escalateStaleBlock(root, target = DEFAULT_TARGET, { thresholdMs = DEFAULT_BLOCKED_ESCALATION_MS, nowMs = Date.now() } = {}) {
  const rec = readBlockedRecord(root, target);
  if (!rec) return { escalated: false, reason: "no-block", record: null };
  const ageMs = nowMs - rec.since;
  if (ageMs < thresholdMs) return { escalated: false, reason: "not-stale", record: rec, ageMs, thresholdMs };
  const clearedAtMs = nowMs;
  const durationMs = Math.max(0, clearedAtMs - rec.since);
  const telemetryPath = emitBlockedTelemetry(root, buildBlockedEvent({
    taskId: rec.taskId,
    reason: rec.reason,
    question: rec.question,
    sinceMs: rec.since,
    clearedAtMs,
    baseCommit: getBaseCommit(root),
    root,
    target,
  }));
  const esc = {
    taskId: rec.taskId,
    reason: rec.reason,
    question: rec.question,
    sinceMs: rec.since,
    escalatedAtMs: clearedAtMs,
    durationMs,
    target,
  };
  const f = escalationLogPath(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, JSON.stringify(esc) + "\n", "utf8");
  fs.rmSync(blockedFilePath(root, target), { force: true });
  return { escalated: true, record: rec, ageMs, thresholdMs, durationMs, telemetryPath, escalationPath: f };
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
 * File name of the pane observer's rolling counter, under `<root>/.quay/`. It records how many
 * CONSECUTIVE needs-input observations the screen observer has seen, so a single glance can never
 * produce a ruling-required block — only N consistent samples (AC2's structural latency bound).
 * Lives in `.quay/` (gitignored) alongside `inner-blocked.json`.
 */
export const RULING_OBSERVER_STATE_FILE = ".ruling-observer-state.json";

/**
 * Number of consecutive needs-input samples required before the pane observer produces a
 * ruling-required stop condition (AC2). Structural latency = samples × poll period. Production
 * polls every 60s ⇒ 3 × 60s ≈ 3 min, within the ≤5-min p100 budget (40% margin). Test-overridable
 * via env INNER_BLOCKED_RULING_SAMPLES.
 */
export const RULING_REQUIRED_PANE_SAMPLES = 3;

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
 * Whether the task's work has a durable merge record in git history — a merge commit whose message
 * names `task/<taskId>` (e.g. `Merge branch 'task/<taskId>'`). This survives `git branch -d` after
 * fan-in, which `isBranchMerged` alone does NOT (that helper requires the branch ref to still exist).
 * Any git failure → false (never a positive "landed" signal from an unavailable source).
 * @param {string} root
 * @param {string} taskId
 * @returns {boolean}
 */
export function hasMergeRecord(root, taskId) {
  const branch = `task/${taskId}`;
  try {
    const out = execFileSync("git", ["-C", root, "log", "--all", "--format=%H", "--merges", "--grep", branch], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * The over-90m executor probe (gap-telemetry-brackets-vs-subagents-no-slot-visibility, AC8).
 * CONSERVATIVE, fail-closed toward KEEP (fire over-90m): a bracket is closed as "work landed" ONLY
 * on positive evidence of a merge — either the live branch ref merged into HEAD (`isBranchMerged`)
 * or a durable merge record names the branch (`hasMergeRecord`, survives fan-in branch deletion).
 * This is deliberately NARROWER than --reconcile's `makeDefaultExecutorGone`: a crash leftover whose
 * worktree is gone but whose branch was never merged is still a legitimate over-90m candidate
 * (abort + needs-human), and `--reconcile` closes it separately. The false-positive class this
 * removes is the one the manager measured — a task whose work ALREADY landed (fan-in merged) but
 * whose `--task-end` was never written, so the stale bracket sat in inProgress and fired a fake
 * over-90m that froze inner for 44+48 minutes.
 * @param {string} root
 * @returns {(rec: {taskId: string}) => {gone: boolean, reason: string}}
 */
export function makeOver90ExecutorGone(root) {
  return (rec) => {
    if (isBranchMerged(root, rec.taskId)) return { gone: true, reason: "branch-merged" };
    if (hasMergeRecord(root, rec.taskId)) return { gone: true, reason: "merge-record" };
    return { gone: false, reason: "no-positive-done-evidence" };
  };
}

/**
 * Read the task file's `status` frontmatter field for a task id, under `<root>/tasks/<id>.md`.
 * A task file is `---` YAML frontmatter + markdown body; `status` is a scalar line
 * (e.g. `status: in-progress`). Returns null when the task file is absent or has no status.
 * @param {string} root
 * @param {string} taskId
 * @returns {string | null}
 */
export function readTaskStatus(root, taskId) {
  try {
    const fm = readFrontmatter(path.join(root, "tasks", `${taskId}.md`));
    return fm?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * The task-status gate for over-90m (gap-over-90m-false-signal-source-reads-telemetry-not-task-status).
 *
 * `detectTaskOver90m` reads TELEMETRY brackets (a `--task-start` without `--task-end`), never the
 * task's OWN status. A crash leaves the bracket permanently open, so a task whose executor is long
 * gone keeps showing in-progress and fires a FALSE over-90m — the manager measured three in one night
 * (48m/27m/this one, all phantom in-flight: dead process, 0-commit worktree, status=ready). The
 * bracket says WHEN it started; only the task's real status says WHETHER it is running.
 *
 * This gate lets over-90m fire ONLY when the task file's status is genuinely `in-progress`. A task
 * whose file says `ready` / `done` / `needs-human` (or any non-in-progress value) is NOT mid-flight
 * and must not trigger — that is tonight's false-signal class (os-anchor: status=ready + stale
 * timeout bracket). A MISSING task file returns TRUE (fire): the bracket is then the only signal, and
 * over-90m is the designed safety net for a genuinely orphaned in-progress task (fail-closed toward
 * KEEP/fire — AC2, "任务文件缺失时按 bracket 继续").
 *
 * @param {string} root
 * @param {string} taskId
 * @returns {boolean} true ⇒ over-90m may fire; false ⇒ the task's own status says it is not in-progress.
 */
export function taskStatusAllowsOver90m(root, taskId) {
  const status = readTaskStatus(root, taskId);
  if (status === null) return true; // no task file ⇒ bracket is the only signal (fail-closed toward fire)
  return status === "in-progress";
}

/**
 * Detect a task in-progress over the 90-minute budget (reason "task-over-90m").
 *
 * Mechanical: reads the SAME `.workflow-events/` store the tick's own `--task-start`/`--task-end`
 * writes, and asks the telemetry aggregate for inProgress tasks older than TASK_OVER_90M_MS. This
 * is inner-blocked-signal.ts's OWN over-90m detector (reason `task-over-90m`; a task the outer
 * already flags) made into a block — the over-90m signal is produced HERE, from this telemetry
 * store, not by any external observer. The tick MUST abort the subagent and wait (no inner retry).
 *
 * AC8 (gap-telemetry-brackets-vs-subagents-no-slot-visibility): the inProgress source is filtered
 * through a RECONCILE-AWARE verdict so a bracket whose work has LANDED (the task's branch was merged
 * into HEAD — fan-in done) does not fire a false over-90m even before `--reconcile` runs. This is
 * the exact false-positive class the manager measured (cold-start-key4: fan-in 05:52 landed, then a
 * fake over-90m block froze inner 44 min). The probe is deliberately conservative (only positive
 * merge evidence closes) so a genuinely slow task with a live executor still fires.
 *
 * TASK-STATUS GATE (gap-over-90m-false-signal-source-reads-telemetry-not-task-status, the 3rd false
 * OVER90 on 2026-08-05): telemetry brackets are written by the executor's `--task-start`/`--task-end`;
 * a crash never writes `--task-end`, leaving the bracket open forever. A bracket being open does NOT
 * mean the task is running — the task's own status does. After the reconcile filter, every over-budget
 * candidate is further gated by `taskStatusAllowsOver90m`: only a task file whose status is genuinely
 * `in-progress` (or a task with no file at all) fires. A `status: ready`/`done`/`needs-human` task with
 * a stale timeout bracket is a FALSE signal and is skipped (AC1 negative control; reproduces the
 * os-anchor shape).
 *
 * WORK-CLOCK GATE (gap-over90-clock-measures-queue-time-not-work-time): the budget is measured against
 * the WORK clock (`workStartedAtMs` — the `--work-start` marker, or the bracket's startedAtMs when no
 * defer/queue segment existed), NOT the QUEUE clock (`startedAtMs` — bracket open). A touches-overlap
 * defer opens the bracket before real work begins; counting that queue segment against the 90-minute
 * budget is exactly the false-OVER90 class this task fixes. A task that queues 80min then works 20min
 * (100min bracket, 20min work) reports a 20-minute work clock and does NOT fire.
 *
 * @param {string} root
 * @param {{executorGone?: (rec: {taskId: string}) => {gone: boolean, reason: string}}} [opts]
 * @returns {Promise<{taskId: string, reason: "task-over-90m", question: string, evidence: string[]} | null>}
 */
export async function detectTaskOver90m(root, opts = {}) {
  const events = [];
  for await (const e of readAllEvents(root)) events.push(e);
  const nowMs = Date.now();
  const rep = aggregate(events, { nowMs });
  if (rep.inProgress.length === 0) return null;
  const executorGone = opts.executorGone ?? makeOver90ExecutorGone(root);
  const { kept } = reconcileInFlight(rep.inProgress, { executorGone });
  // WORK CLOCK ONLY: `workStartedAtMs` (the --work-start marker) is the age baseline; a never-
  // deferred record falls back to the bracket's startedAtMs (aggregate/reconcile guarantee this).
  const over = kept.filter(
    (p) => nowMs - (p.workStartedAtMs ?? p.startedAtMs) > TASK_OVER_90M_MS && taskStatusAllowsOver90m(root, p.taskId),
  );
  if (over.length === 0) return null;
  const p = over[0];
  const workMs = p.workStartedAtMs ?? p.startedAtMs;
  const mins = ((nowMs - workMs) / 60_000).toFixed(1);
  const queued = p.workStartedAtMs != null && p.workStartedAtMs > p.startedAtMs
    ? ` (bracket opened ${((nowMs - p.startedAtMs) / 60_000).toFixed(1)}m ago incl. queue; work clock ${mins}m)`
    : "";
  return {
    taskId: p.taskId,
    reason: "task-over-90m",
    question: `task ${p.taskId} has been in-progress ${mins}m of work (>90m work) — rule on abort vs continue (no inner retry), then run --clear`,
    evidence: [
      `${p.taskId} work clock started ${new Date(workMs).toISOString()}${queued}`,
      `real in-flight ${over.length} task(s) over budget (reconcile-aware + task-status gate + work-clock)`,
    ],
  };
}

// ── Pane-observer rolling state (gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick) ────

/**
 * Absolute path to the pane observer's rolling counter file for a root + target. Per-target state
 * (a counter must never be shared across observation directions — inner and outer polls must not
 * reset each other). `inner` keeps the legacy `.quay/.ruling-observer-state.json`; other targets
 * namespace under `.quay/blocked-signals/`.
 * @param {string} root
 * @param {string} [target]
 * @returns {string}
 */
export function rulingObserverStatePath(root, target = DEFAULT_TARGET) {
  const t = resolveTarget(target);
  if (t === "inner") return path.join(root, ".quay", RULING_OBSERVER_STATE_FILE);
  return path.join(root, ".quay", "blocked-signals", `.${t}-observer-state.json`);
}

/**
 * Read the pane observer's rolling counter for a target. An absent or malformed file ⇒ zero
 * (fail-closed toward NOT flagging — a corrupted counter must never itself become a stop condition).
 * @param {string} root
 * @param {string} [target]
 * @returns {{consecutiveNeedsInput: number, updatedAtMs: number}}
 */
export function readRulingObserverState(root, target = DEFAULT_TARGET) {
  try {
    const raw = JSON.parse(fs.readFileSync(rulingObserverStatePath(root, target), "utf8"));
    const n = Math.floor(Number(raw.consecutiveNeedsInput));
    const t = Number(raw.updatedAtMs);
    return {
      consecutiveNeedsInput: Number.isFinite(n) && n >= 0 ? n : 0,
      updatedAtMs: Number.isFinite(t) ? t : 0,
    };
  } catch {
    return { consecutiveNeedsInput: 0, updatedAtMs: 0 };
  }
}

/**
 * Persist the pane observer's rolling counter for a target (atomic — write a temp file then rename,
 * so a concurrent reader never sees a half-written record).
 * @param {string} root
 * @param {{consecutiveNeedsInput: number, updatedAtMs: number}} state
 * @param {string} [target]
 */
export function writeRulingObserverState(root, state, target = DEFAULT_TARGET) {
  const f = rulingObserverStatePath(root, target);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, f);
}

/**
 * Whether the pane's STATUS AREA (the last up-to-two non-blank lines of the bottom region — the same
 * discipline pane-state-classify.ts uses for its busy flag) shows an in-flight background agent:
 * a "← N agent" / "· N agent" indicator with N > 0, or a general-purpose / subagent status line.
 *
 * This is disambiguation criterion (a) for the ruling-required trigger (outer ruling 2026-08-04): a
 * waiting-input pane whose session is waiting on its OWN background subagent is BENIGN IDLE — not
 * "waiting for a human ruling". A real false positive was observed on the manager pane: waiting-input
 * with "← 1 agent" in the status area while its batch fan-in agent was running.
 *
 * @param {string} region — the classifier's bottom region
 * @returns {boolean}
 */
export function statusAreaShowsInFlightAgent(region) {
  const area = region.split("\n").filter((l) => l.trim() !== "").slice(-2).join("\n");
  const m = area.match(/(\d+)\s+agents?/i);
  if (m && Number(m[1]) > 0) return true;
  return /general-purpose|subagent/i.test(area);
}

/**
 * Disambiguation criterion (b) (outer ruling 2026-08-04): fast-mode telemetry `.workflow-events/`
 * reports an in-progress task bracket (opened via --task-start, not yet closed) — the same store
 * `detectTaskOver90m` already reads. A session with an open task bracket is mid-work, so a
 * waiting-input pane is plausibly "waiting for its delegated subagent", not "waiting for a human".
 *
 * Fail-closed toward SUPPRESSION (a false positive is the worse trade): if the store cannot be read
 * at all, treat it as in-flight so the pane observer does not fire on ambiguous evidence.
 *
 * @param {string} root
 * @returns {Promise<boolean>}
 */
export async function telemetryHasInProgressTask(root) {
  try {
    const events = [];
    for await (const e of readAllEvents(root)) events.push(e);
    const rep = aggregate(events, { nowMs: Date.now() });
    return rep.inProgress.length > 0;
  } catch {
    return true; // cannot read telemetry ⇒ do not flag on this sample
  }
}

/**
 * Pane-snapshot staleness threshold (ms) — gap-last-pane-txt-has-no-writer.
 * `.quay/last-pane.txt` is a dead file with NO writer: A7's `--detect-stop --pane` was reading a
 * 4h-stale snapshot forever (`pane_decision=busy branch=reset consecutive=0/3`), so the inner could
 * sit on a permission dialog and the outer would never see it. A snapshot file older than this is
 * UNTRUSTED — the observer reads a LIVE `tmux capture-pane` of the target pane instead of the stale
 * bytes (candidate B, eliminating the dead-snapshot class). Calibrated to the Contract band
 * `last_pane_staleness ≤ 300s`. Env override INNER_BLOCKED_PANE_STALE_MS is a test/ops override
 * (same style as INNER_BLOCKED_RULING_SAMPLES).
 */
export const PANE_STALENESS_MS = 300_000;

function envNonNegMs(name, fallback) {
  const raw = process.env[name];
  const n = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Resolve the tmux control socket — the SAME resolution session-liveness.sh uses (lines 296-305):
 * SESSION_TMUX_SOCKET explicit override → TMUX_TMPDIR/tmux-<uid>/default → ${TMPDIR:-/tmp}/tmux-<uid>/default.
 */
export function resolveTmuxSocket() {
  if (process.env.SESSION_TMUX_SOCKET) return process.env.SESSION_TMUX_SOCKET;
  const base = process.env.TMUX_TMPDIR || process.env.TMPDIR || "/tmp";
  const uid = typeof process.getuid === "function" ? process.getuid() : "";
  return path.join(base, `tmux-${uid}`, "default");
}

/**
 * Minimal KEY=VALUE parse of a session-liveness.env file (the shell file session-liveness.sh sources).
 * Values are unquoted or double-quoted (double-quoted may contain spaces). Comments/blank lines skipped.
 * @param {string} filePath
 * @returns {Record<string,string>}
 */
export function parseEnvFileVars(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|([^#\s][^\s]*))\s*$/);
    if (m) out[m[1]] = m[2] !== undefined ? m[2] : (m[3] ?? "");
  }
  return out;
}

/**
 * Resolve the tmux target (`<session>[:<window>]`) for a LIVE capture of the observed layer.
 * Precedence — EXPLICIT CONFIG, never a guess (same discipline as session-liveness.sh's
 * "NO guess" rule):
 *   1. INNER_BLOCKED_TMUX_TARGET env  (test/ops explicit override)
 *   2. SESSION_TMUX_TARGET env        (session-liveness explicit target override)
 *   3. SESSION_TMUX_SESSION env       → `<session>:<target>` role window
 *   4. <root>/orchestration/session-liveness.env SESSION_TMUX_SESSION → `<session>:<target>`
 * Returns null when nothing is configured ⇒ live capture unavailable; the observer fails toward
 * "unreadable" (counter reset), NEVER toward trusting a stale snapshot.
 * @param {string} root
 * @param {string} [target]
 * @returns {string|null}
 */
export function resolveTmuxTarget(root, target = DEFAULT_TARGET) {
  const t = resolveTarget(target);
  const explicit = (process.env.INNER_BLOCKED_TMUX_TARGET || process.env.SESSION_TMUX_TARGET || "").trim();
  if (explicit) return explicit;
  const session = (process.env.SESSION_TMUX_SESSION || "").trim()
    || parseEnvFileVars(path.join(root, "orchestration", "session-liveness.env")).SESSION_TMUX_SESSION || "";
  return session.trim() ? `${session.trim()}:${t}` : null;
}

/**
 * Live pane capture via `tmux -S <socket> capture-pane -p -t <target>` — the same READ-ONLY
 * primitive session-liveness.sh uses (line 1113). Returns the captured text, or null when tmux is
 * absent / the socket is unreachable / the target pane does not exist.
 * @param {string} tmuxTarget
 * @param {{socket?: string}} [opts]
 * @returns {string|null}
 */
export function capturePaneLive(tmuxTarget, { socket = resolveTmuxSocket() } = {}) {
  const r = spawnSync("tmux", ["-S", socket, "capture-pane", "-p", "-t", tmuxTarget], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (r.status !== 0) return null;
  return r.stdout || null;
}

/**
 * Ruling-required from the SCREEN observer — the PRIMARY trigger for reason "ruling-required"
 * (gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick).
 *
 * Reads the pane text (from a FRESH snapshot file, or a LIVE tmux capture when the snapshot is
 * stale/absent — gap-last-pane-txt-has-no-writer, candidate B), classifies its BOTTOM REGION with
 * `classifyPaneState` (a pure SHAPE classifier — ADR-016 Amendment: no whole-screen equality/hash
 * anywhere in the decision path), and requires N CONSECUTIVE needs-input samples before producing a
 * stop condition. The rolling counter lives in `<root>/.quay/.ruling-observer-state.json`.
 *
 * Disambiguation (outer ruling 2026-08-04): a WAITING-INPUT shape counts as a needs-input sample
 * ONLY when the session is not waiting on its own background subagent / in-flight task — "waiting for
 * my background agent" is benign idle, not "waiting for a human ruling". A PERMISSION-PROMPT is
 * always a needs-input sample: a dialog is the main session explicitly asking for a human decision,
 * never "waiting for my subagent". Busy / error-banner / unknown are never needs-input.
 *
 * Fail-closed (AC4 priority — a false positive is the worse trade):
 *   - no `panePath` AND no resolvable tmux target ⇒ no-op (never inferred);
 *   - missing/unreadable pane file AND live capture unavailable ⇒ reset the counter, no condition;
 *   - STALE pane file (mtime older than `paneStaleMs`/PANE_STALENESS_MS) is UNTRUSTED — never
 *     classified; the observer reads a LIVE capture-pane of the target pane instead (candidate B),
 *     and if that is also unavailable ⇒ reset the counter, no condition;
 *   - busy / error-banner / unknown shapes ⇒ reset the counter, no condition;
 *   - waiting-input (no in-flight agent/task) / permission-prompt ⇒ increment; only at `samples`
 *     consecutive does a ruling-required condition emerge.
 *
 * `panePath` is EXPLICIT CONFIG (the A7 snapshot file). `tmuxTarget` / the env / env-file resolution
 * is the EXPLICIT CONFIG for the LIVE fallback (never a guessed session name). `samples` is the
 * multi-sample consistency requirement (--samples overrides it; INNER_BLOCKED_RULING_SAMPLES remains
 * a test/ops override). `target` names WHO is being observed — it selects the per-target rolling
 * counter and the recorded taskId/question (the observation primitive is direction-parameterized,
 * AC1/AC5). The returned `source` field ("file" | "live") records which pane source produced the
 * observation — the verification anchor for the dead-snapshot fix.
 *
 * @param {string} root
 * @param {{panePath?: string, nowMs?: number, samples?: number, target?: string, tmuxTarget?: string, liveCaptureFn?: (target: string) => string|null, paneStaleMs?: number}} [opts]
 * @returns {Promise<{state: string, confidence: number, consecutive: number, needsInput: boolean, condition: object|null, source: string|null}>}
 */
export async function observePaneForRuling(root, {
  panePath,
  nowMs = Date.now(),
  samples = RULING_REQUIRED_PANE_SAMPLES,
  target = DEFAULT_TARGET,
  tmuxTarget,
  liveCaptureFn = capturePaneLive,
  paneStaleMs,
} = {}) {
  const t = resolveTarget(target);
  const staleMs = Number.isFinite(paneStaleMs) ? paneStaleMs : envNonNegMs("INNER_BLOCKED_PANE_STALE_MS", PANE_STALENESS_MS);

  // Decide the pane source. A FRESH snapshot file wins (the file is the explicit config). A stale or
  // ABSENT snapshot is UNTRUSTED — the observer reads a LIVE capture-pane of the target pane instead
  // (eliminating the dead-snapshot class: `.quay/last-pane.txt` had NO writer, so its 4h-old bytes
  // were classified busy / never-accumulate forever). Live capture is itself explicit config (a
  // resolvable tmux target) — never a guess; when neither a fresh file nor a live source is
  // available the observation is "unreadable" (counter resets, no false positive on stale data).
  let paneText = null;
  let paneSource = null;
  if (panePath) {
    let st = null;
    try {
      st = fs.statSync(panePath);
    } catch {
      st = null; // absent snapshot → live capture below
    }
    if (st && nowMs - st.mtimeMs <= staleMs) {
      try {
        paneText = fs.readFileSync(panePath, "utf8");
        paneSource = "file";
      } catch {
        paneText = null; // unreadable → live capture below
      }
    }
  }
  if (paneText == null) {
    const liveTarget = tmuxTarget ?? resolveTmuxTarget(root, t);
    if (liveTarget) {
      const live = liveCaptureFn(liveTarget);
      if (live && live.trim()) {
        paneText = live;
        paneSource = "live";
      }
    }
  }
  if (paneText == null) {
    if (panePath) {
      writeRulingObserverState(root, { consecutiveNeedsInput: 0, updatedAtMs: nowMs }, t);
    }
    return {
      state: panePath ? "unreadable" : "unobserved",
      confidence: 0,
      consecutive: 0,
      needsInput: false,
      condition: null,
      source: null,
    };
  }

  const cls = classifyPaneState(paneText);
  const needsInputShape = cls.state === "waiting-input" || cls.state === "permission-prompt";
  // waiting-input is suppressed while the session is waiting on its own background agent/task;
  // permission-prompt is never suppressed (a dialog is a human-wait by definition). The status-area
  // "← N agent" shape check is a PURE PANE check and applies to ANY target (the outer/manager pane
  // shows the same indicator when waiting on its own subagent); the telemetry in-progress bracket is
  // INNER-LAYER telemetry, consulted only when observing inner.
  const inFlightAgent = cls.state === "waiting-input"
    ? statusAreaShowsInFlightAgent(cls.region) || (t === "inner" && (await telemetryHasInProgressTask(root)))
    : false;
  const needsInput = needsInputShape && !inFlightAgent;
  const prev = readRulingObserverState(root, t);
  // Capped at `samples` so the counter stays bounded once the threshold is reached (a persistent
  // needs-input state keeps re-verifying "still needs-input", not inflating an unbounded number).
  const consecutive = needsInput ? Math.min(prev.consecutiveNeedsInput + 1, samples) : 0;
  writeRulingObserverState(root, { consecutiveNeedsInput: consecutive, updatedAtMs: nowMs }, t);

  if (consecutive < samples) {
    return { state: cls.state, confidence: cls.confidence, consecutive, needsInput, condition: null, source: paneSource };
  }

  const question = cls.state === "permission-prompt"
    ? `${t} pane shows a permission prompt — the ${t} is stopped on a dialog that needs a ruling (grant/deny), then run --clear`
    : `${t} pane has been waiting for input for ${consecutive} consecutive observations — the ${t} appears stopped without saying why; rule on what to do, then run --clear`;
  const condition = {
    taskId: t === "inner" ? "fast-mode-loop" : t,
    reason: "ruling-required",
    question,
    evidence: [
      `pane classified ${cls.state} (confidence ${cls.confidence})`,
      `${consecutive} consecutive needs-input samples (threshold ${samples})`,
      `pane source: ${paneSource}${paneSource === "live" ? " (snapshot stale/absent — live tmux capture)" : ""}`,
      `bottom region:\n${cls.region}`,
    ],
  };
  return { state: cls.state, confidence: cls.confidence, consecutive, needsInput, condition, source: paneSource };
}

/**
 * Evaluate every mechanically-detectable stop-and-wait condition, in a deterministic order.
 * `ruling-required` is checked BEFORE `task-over-90m` on purpose: it exists to catch the same class
 * of stall earlier (AC3), so when both would apply near the 90-minute boundary, the earlier-firing
 * reason is the one reported.
 *
 * Ruling-required precedence (gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick):
 * the SCREEN observer (`panePath` / a precomputed `paneObservation`) is the PRIMARY ruling-required
 * trigger; the transcript composite (`detectRulingRequiredStall`) is preserved as side evidence for
 * "session actually dead" (AC3 — keep `--transcript` fully working) but fires only when the pane
 * observer produced no ruling-required, so the two never both write the same reason from one
 * invocation.
 *
 * @param {string} root
 * @param {{transcriptPath?: string, panePath?: string, paneObservation?: object|null, nowMs?: number, stallMs?: number, samples?: number, target?: string}} [opts]
 * @returns {Promise<Array<{reason: string, question: string, evidence?: string[]}>>}
 */
export async function detectStopConditions(root, opts = {}) {
  const target = opts.target ?? DEFAULT_TARGET;
  const found = [];
  // The merge-conflict / transcript-composite / task-over-90m detectors are INNER-LAYER state
  // (telemetry, git conflict, the inner's transcript). Watching outer/manager is the SCREEN
  // OBSERVATION PRIMITIVE only — those inner-specific mechanical conditions do not apply to a
  // non-inner target and must not fire while observing the outer/manager pane (AC1/AC5).
  if (target === "inner") {
    const conflict = detectMergeConflict(root);
    if (conflict) found.push(conflict);
  }
  const pane = opts.paneObservation ?? (await observePaneForRuling(root, opts));
  if (pane.condition) found.push(pane.condition);
  if (target === "inner") {
    const stall = await detectRulingRequiredStall(root, opts);
    // Transcript composite is side evidence for "session actually dead" — but a BUSY pane proves the
    // inner is actively working, so the stale-transcript heuristic must not override live screen
    // evidence (AC4: busy never writes ruling-required, from ANY detector).
    if (stall && !pane.condition && pane.state !== "busy") found.push(stall);
    const over = await detectTaskOver90m(root);
    if (over) found.push(over);
  }
  return found;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────

const usage = `inner-blocked-signal.ts — explicit "who-is-waiting" observation signal, parameterized
(gap-no-explicit-blocked-signal-from-inner-layer + gap-ruling-required-only-covers-outer-to-inner-
not-manager-to-outer)

Usage:
  node --experimental-strip-types inner-blocked-signal.ts --detect-stop [--root <dir>] [--target <name>] [--samples <N>] [--action <a>] [--action-command <cmd>] [--transcript <path>] [--pane <path>] [--tmux-target <target>]
  node --experimental-strip-types inner-blocked-signal.ts --assert-blocked --taskId <id> --reason <r> --question <q> [--options '<json>'] [--evidence '<json>'] [--root <dir>] [--target <name>]
  node --experimental-strip-types inner-blocked-signal.ts --clear [--root <dir>] [--target <name>]
  node --experimental-strip-types inner-blocked-signal.ts --timeout [--max-age-ms N] [--root <dir>] [--target <name>]   (consumption-timeout auto-upgrade: archive a consumed-by-nobody stale block — 升级/归档)
  node --experimental-strip-types inner-blocked-signal.ts --escalate-stale [--max-age-ms N] [--root <dir>] [--target <name>]   (AC9/back-compat alias of --timeout)
  node --experimental-strip-types inner-blocked-signal.ts --read [--root <dir>] [--target <name>]
  node --experimental-strip-types inner-blocked-signal.ts --status [--root <dir>] [--target <name>]
  node --experimental-strip-types inner-blocked-signal.ts --schema

--target <name> — WHO is being observed (AC1): "inner" (default) writes the legacy
.quay/inner-blocked.json; any other filename-safe name ("outer", "manager", …) writes
.quay/blocked-signals/<target>.json. inner/outer/manager are each observable with one call.
--samples <N> — consecutive needs-input samples before a ruling-required condition (default 3,
overridable; env INNER_BLOCKED_RULING_SAMPLES remains a test/ops override).
--action <a> — the ACTION PLUGIN POINT (AC3): "write-file" (default) writes the block record;
"notify" prints "detect-stop: BLOCKED <reason>: <question>" and writes nothing; "command" runs
--action-command <cmd> with BLOCKED_CONDITION_JSON / BLOCKED_SIGNAL_PATH / BLOCKED_TARGET in the env.

--detect-stop is the MECHANICAL trigger (AC1): it evaluates the mechanically-detectable stop
conditions (for --target inner: merge-conflict, task-over-90m, ruling-required) and writes the block
automatically when any holds, as a consequence of the stop-condition check the tick already runs. It
clears a prior "auto" block when no condition holds; a "manual" block (judgment assert) is never
auto-cleared. For a NON-inner target only the SCREEN observer runs (the observation primitive).
--pane <path> enables the ruling-required SCREEN observer (gap-ruling-required-trigger-is-dead-code-
never-wired-into-any-tick) — the PRIMARY ruling-required trigger. The pane text is classified by
classifyPaneState (pure SHAPE classification of the bottom region, ADR-016 Amendment: no whole-screen
hash) and, after N CONSECUTIVE waiting-input / permission-prompt samples (60s poll ⇒ ~3min structural
latency ≤ 5min p100 budget, AC2), a ruling-required stop condition is produced. busy / error-banner /
unknown, a missing pane file, or an explicit --clear all reset the rolling counter (AC4). Explicit
config, never inferred.
--tmux-target <target> — the tmux target (<session>[:<window>]) for a LIVE pane capture
(gap-last-pane-txt-has-no-writer, candidate B). When the --pane snapshot is STALE (mtime older than
300s) or ABSENT — the dead-snapshot defect class (.quay/last-pane.txt has NO writer) — the observer
reads a live 'tmux capture-pane -p -t <target>' on the LIVE pane instead of the stale bytes,
eliminating the dead-snapshot class. Precedence (explicit config, never a guess): --tmux-target > env
INNER_BLOCKED_TMUX_TARGET / SESSION_TMUX_TARGET > SESSION_TMUX_SESSION (env or
<root>/orchestration/session-liveness.env) resolved as <session>:<target>. When neither a fresh
file nor a live source is available the observation is "unreadable" (counter resets — no false
positive on stale data).
--transcript <path> (or env INNER_BLOCKED_TRANSCRIPT) additionally enables the "ruling-required"
composite trace (gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger; INNER-LAYER
only — ignored for non-inner targets): transcript heartbeat stale ≥30m AND a task in-progress AND a
clean working tree. Explicit config, never inferred; omitted ⇒ no-op, the other two conditions are
unaffected. PRESERVED but no longer the primary ruling-required criterion (AC3) — it fires only when
the pane observer produced nothing, as side evidence for "session actually dead".
--assert-blocked writes the block record manually (for judgment conditions that cannot be detected
from repo state, or when no --transcript is configured). The CLI is the ONLY writer — never
hand-write the JSON.
--clear records the wait duration into telemetry, then deletes the file, and resets the pane
observer's rolling counter. --root defaults to the SHARED checkout root (a worktree invocation
resolves to the main checkout so the outer can see it).`;

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
      file: blockedFileRelPath(),
      targets: { default: DEFAULT_TARGET, canonical: CANONICAL_TARGETS, nonInnerPath: `.quay/blocked-signals/<target>.json` },
      samplesDefault: RULING_REQUIRED_PANE_SAMPLES,
      actions: BLOCK_ACTIONS,
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

  // --target <name> — WHO is being observed (AC1). Resolved once, fail-closed on a non-filename-safe
  // name; every branch below threads it (inner ⇒ legacy .quay/inner-blocked.json, any other name ⇒
  // .quay/blocked-signals/<target>.json).
  let target;
  try {
    target = resolveTarget(getArgValue(args, "--target"));
  } catch (e) {
    console.error(`inner-blocked-signal: ${e.message}`);
    return 1;
  }

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
      const f = writeBlockedRecord(root, rec, target);
      console.log(`inner-blocked-signal: blocked asserted (${reason}) — ${f}`);
      return 0;
    } catch (e) {
      console.error(`inner-blocked-signal: ${e.message}`);
      return 1;
    }
  }

  // --detect-stop — THE MECHANICAL TRIGGER (AC1). Evaluates the mechanically-detectable stop
  // conditions (for --target inner: merge-conflict, ruling-required from the pane observer,
  // task-over-90m; for a NON-inner target: the ruling-required screen observer ONLY — the observation
  // primitive, AC1/AC5). Any condition holds ⇒ the configured ACTION fires (AC3): default "write-file"
  // writes the target's block record as a consequence (auto reason/question/evidence, source "auto");
  // "notify" prints and writes nothing; "command" runs --action-command with the condition in the env.
  // For write-file, none holds ⇒ clear a prior "auto" block. A "manual" block (an --assert-blocked
  // with no matching mechanical condition) is NEVER auto-cleared — only an explicit --clear does that
  // (AC3 negative control). The tick file's step-3 stop-condition check IS this command, so the write
  // happens on an action the inner already takes every tick — not because someone remembered to call
  // --assert-blocked.
  //
  // --pane <path> is EXPLICIT config for the PRIMARY ruling-required trigger (the screen observer —
  // see observePaneForRuling). --target <name> selects the signal namespace. --samples <N> overrides
  // the consecutive-sample threshold (default 3). --action / --action-command select the post-detect
  // reaction. --transcript <path> (or env INNER_BLOCKED_TRANSCRIPT) is EXPLICIT config for the
  // preserved-but-secondary composite trace (never inferred; INNER-LAYER only). INNER_BLOCKED_RULING_STALL_MS
  // is a test-only override of the 30-minute threshold; INNER_BLOCKED_RULING_SAMPLES remains a
  // test/ops override of the pane observer's multi-sample consistency requirement.
  if (args.includes("--detect-stop")) {
    try {
      const actionArg = getArgValue(args, "--action") ?? DEFAULT_BLOCK_ACTION;
      const actionCommandArg = getArgValue(args, "--action-command");
      const action = actionCommandArg !== undefined ? "command" : actionArg;
      if (!BLOCK_ACTIONS.includes(action)) {
        console.error(`inner-blocked-signal: invalid --action "${action}"; must be one of: ${BLOCK_ACTIONS.join(", ")}`);
        return 1;
      }
      if (action === "command" && (!actionCommandArg || !actionCommandArg.trim())) {
        console.error("inner-blocked-signal: --action command requires --action-command <cmd>");
        return 1;
      }
      const transcriptArg = getArgValue(args, "--transcript");
      const transcriptPath = transcriptArg
        ? path.resolve(transcriptArg)
        : process.env.INNER_BLOCKED_TRANSCRIPT
          ? path.resolve(process.env.INNER_BLOCKED_TRANSCRIPT)
          : undefined;
      const stallMsOverride = process.env.INNER_BLOCKED_RULING_STALL_MS
        ? Number(process.env.INNER_BLOCKED_RULING_STALL_MS)
        : undefined;
      const paneArg = getArgValue(args, "--pane");
      const panePath = paneArg ? path.resolve(paneArg) : undefined;
      // gap-last-pane-txt-has-no-writer (candidate B): a stale/absent --pane snapshot falls back to
      // a LIVE tmux capture-pane of this target. Explicit config (flag > env > env-file), never a guess.
      const tmuxTargetArg = getArgValue(args, "--tmux-target") || process.env.INNER_BLOCKED_TMUX_TARGET || undefined;
      const samplesArg = getArgValue(args, "--samples");
      const envSamples = process.env.INNER_BLOCKED_RULING_SAMPLES;
      const samplesRaw = samplesArg !== undefined ? samplesArg : envSamples;
      const samplesOverride = samplesRaw !== undefined ? Number(samplesRaw) : undefined;
      const samples = Number.isFinite(samplesOverride) && samplesOverride >= 1
        ? Math.floor(samplesOverride)
        : RULING_REQUIRED_PANE_SAMPLES;
      const paneObservation = (panePath || tmuxTargetArg)
        ? await observePaneForRuling(root, { panePath, samples, target, tmuxTarget: tmuxTargetArg })
        : null;
      const found = await detectStopConditions(root, {
        transcriptPath,
        paneObservation,
        panePath,
        samples,
        target,
        ...(Number.isFinite(stallMsOverride) ? { stallMs: stallMsOverride } : {}),
      });
      // Stable target/signal line (Contract measure greps the namespace): printed for EVERY
      // --detect-stop run so a watcher can see which target's signal this invocation owns.
      console.log(`detect-stop: target=${target} signal=${blockedFileRelPath(target)}`);
      // Decision-branch field (Contract measure reads it): whenever the pane was evaluated, print a
      // stable, parseable line naming the shape, the branch (ruling-required | accumulating |
      // reset) and the consecutive-sample count.
      if (paneObservation) {
        const branch = paneObservation.condition
          ? "ruling-required"
          : paneObservation.needsInput
            ? "accumulating"
            : "reset";
        // `source=file|live` names which pane source produced the observation — the verification
        // anchor for the dead-snapshot fix (a stale .quay/last-pane.txt is no longer classified).
        const sourceSuffix = paneObservation.source ? ` source=${paneObservation.source}` : "";
        console.log(
          `detect-stop: pane_decision=${paneObservation.state} branch=${branch} consecutive=${paneObservation.consecutive}/${samples}${sourceSuffix}`,
        );
      }
      const reasons = found.map((c) => c.reason);

      // AC3 ACTION PLUGIN POINT — the post-detect reaction is caller-configured.
      if (action === "notify") {
        if (reasons.length) {
          const cond = found[0];
          console.log(`detect-stop: BLOCKED ${cond.reason}: ${cond.question}`);
          return 0;
        }
        console.log("detect-stop: no stop condition; no block");
        return 0;
      }
      if (action === "command") {
        if (!reasons.length) {
          console.log("detect-stop: no stop condition; no block");
          return 0;
        }
        const cond = found[0];
        const run = spawnSync("/bin/sh", ["-c", actionCommandArg], {
          encoding: "utf8",
          env: {
            ...process.env,
            BLOCKED_CONDITION_JSON: JSON.stringify(cond),
            BLOCKED_SIGNAL_PATH: blockedFilePath(root, target),
            BLOCKED_TARGET: target,
          },
        });
        if (run.status !== 0) {
          console.error(`inner-blocked-signal: action command failed (exit ${run.status}): ${run.stderr || run.stdout}`);
          return 1;
        }
        console.log(`detect-stop: action command executed — ${actionCommandArg}`);
        return 0;
      }

      // Default write-file action — the existing behavior, threaded with the target.
      const existing = readBlockedRecord(root, target);
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
        const res = clearBlockedRecord(root, target);
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
        const f = writeBlockedRecord(root, rec, target);
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

  // --timeout / --escalate-stale (independent mechanism — gap-blocked-signal-timeout-auto-
  // escalation, carried from gap-telemetry-brackets-vs-subagents-no-slot-visibility AC9): a blocked
  // signal nobody consumed must not let inner wait forever. If a block is older than the escalation
  // threshold, record the wait duration into telemetry, append an escalation line to
  // .quay/blocked-escalations.jsonl, and remove the block file (bounded episode — the underlying
  // condition, if it persists, writes a FRESH block on the next --detect-stop). The OUTER runs this
  // as a safety net in its async cleanup (orchestrator-loop-tick.md step 1b); the Contract measure
  // invokes it via `bash plugin/scripts/blocked-signal-check.sh --timeout`. --timeout is the primary
  // name (matches the contract invoke grep); --escalate-stale is kept as the AC9 back-compat alias
  // (existing docs/tests name it).
  if (args.includes("--escalate-stale") || args.includes("--timeout")) {
    const maxAgeArg = getArgValue(args, "--max-age-ms");
    let thresholdMs = DEFAULT_BLOCKED_ESCALATION_MS;
    if (maxAgeArg !== undefined) {
      const n = Number(maxAgeArg);
      if (!Number.isFinite(n) || n < 0) {
        console.error(`inner-blocked-signal: invalid --max-age-ms "${maxAgeArg}" (expected a non-negative number)`);
        return 1;
      }
      thresholdMs = n;
    }
    try {
      const res = escalateStaleBlock(root, target, { thresholdMs });
      if (res.escalated) {
        console.log(
          `inner-blocked-signal: ESCALATED (升级/归档) stale block (${res.record.taskId}, ${res.record.reason}) — waited ${(res.durationMs / 60_000).toFixed(1)}m >= ${(res.thresholdMs / 60_000).toFixed(0)}m; archived; telemetry ${res.telemetryPath}`,
        );
        return 0;
      }
      if (res.reason === "no-block") {
        console.log("inner-blocked-signal: no block to escalate");
        return 0;
      }
      console.log(
        `inner-blocked-signal: block not stale yet (age ${(res.ageMs / 60_000).toFixed(1)}m < ${(res.thresholdMs / 60_000).toFixed(0)}m)`,
      );
      return 0;
    } catch (e) {
      console.error(`inner-blocked-signal: ${e.message}`);
      return 1;
    }
  }

  // --clear
  if (args.includes("--clear")) {
    try {
      const res = clearBlockedRecord(root, target);
      // An explicit clear also resets the pane observer's rolling counter (the ruling landed / the
      // observation window ended — a stale needs-input streak must not linger and re-fire).
      writeRulingObserverState(root, { consecutiveNeedsInput: 0, updatedAtMs: Date.now() }, target);
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
      const rec = readBlockedRecord(root, target);
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
      const rec = readBlockedRecord(root, target);
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
