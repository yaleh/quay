// quay Core: goal store — GOAL + AC records, the THIRD sibling kind
// (tasks/gap-spec-goal-store-third-sibling-kind, orchestration/SPEC-goal-store-2026-08-09.md,
//  revised by orchestration/SPEC-goal-mechanism-2026-09-06.md §2 — PHASE-NNN → GOAL-NNN).
//
// A goal record is a SEPARATE object kind from tasks (a Provider's own store), ADRs
// (adr-store.js), and documents (document-store.js): a stage goal / acceptance-criterion
// that ACHIEVES (or is superseded), not a decision (proposed→accepted) and not a method
// artifact (draft→active→retired). It reuses the SAME generic frontmatter/lock/filename-
// resolution mechanics as its two siblings via frontmatter-store-base.js — mechanics are
// shared, schemas are not (the base header's "shared MECHANICS, independent SCHEMAS"
// rule; this is the third application).
//
// The kind's four load-bearing fields (why it cannot collapse into any prior kind):
//   1. `criterion` — a RUNNABLE shell command (reuses the task acceptance-runner shape;
//      NOT document `contracts`, which are in-process grep/not-grep over the doc's own body).
//      Empty/missing criterion ⇒ the goal gate FAILS CLOSED (never a silent PASS).
//   2. `status` includes `achieved` — decisions don't achieve, ACs do.
//   3. `goal` — the ACTIVE SET is DERIVED from the goal's status, never hand-listed.
//   4. `origin` — the empirical basis for the AC; REQUIRED (empty origin writes nothing).
//
// Invariants (SPEC-goal-mechanism-2026-09-06.md §4 — I1 superseded by I1′):
//   I1′ — at most `cap` `status: active` GOALs at a time (default 3, configurable via
//         .quay/config.yml `goals:`). Goal switch stays a SINGLE ATOMIC write, fail-closed:
//         activating a goal that would exceed cap is REJECTED unless the same call disposes
//         an active goal (`disposeOld` → achieved, or `supersedes: [oldId]` → superseded).
//         The rejection message ENUMERATES the current active set (hard rule 3: enumerate,
//         don't boolean — "which goals hold the slots" is the actionable info).
//   I2 — a GOAL is achieved ⟺ ALL its ACs are achieved. DERIVED at read time
//        (`isGoalAchieved`), never stored.
//   I3 — staleness is THREE-STATE (fresh / stale / notEvaluated), never a fresh/stale binary
//        (a binary would judge a never-evaluated goal as healthy — hard rule 3b). The clock is
//        `lastProgressAt` = its ACs' latest goal-gate-event timestamp in `.quay/gate-events.jsonl`
//        (DERIVED never stored — `evidence` itself is ledger-derived, see ledgerEvidenceMap) —
//        NEVER the goal's own `updatedAt` (hard rule 4b: a quantity the measured object produces
//        is not a measurement). Zero ACs (or no ledger event) ⇒ notEvaluated.
//   I4 — divergence: `status: active` while `isGoalAchieved()` is true ⇒ "achieved but nobody
//        closed it", reported by `check --staleness` as the `divergent` bucket (GOAL ids).
//   I5 — achieved-but-failing: an AC `status: achieved` whose `criterion` now exits non-zero ⇒
//        "achieved but no longer verifiable", reported by `check --achieved-failing` as the
//        `achievedButFailing` bucket (AC ids). SEPARATE from I4 (⛔ never merged): I4 is
//        "active yet achieved" (should be closed), I5 is "achieved yet failing" (the opposite
//        direction, at the AC layer, produced only by RUNNING the criterion — never a stored field).
//        ⛔ I5 RUNS criteria, so it is a SEPARATE subcommand from `check --staleness`, which is
//        PURE-READ — otherwise an achieved criterion that itself calls `check --staleness` (AC-175)
//        recurses unboundedly (2026-09-07 production incident, host load 41.89).
//
// cap / stale are HUMAN-GIVEN initial policy values with NO cost-structure backing (hard rule 4:
// no numeric threshold before the cost is measured). Re-estimate from .quay/goal-round.jsonl's
// real distribution after the goal-driver runs 30 calendar days (SPEC §4.2).
//
// Naming: `GOAL-NNN` / `AC-NNN` — pure sequence ids, meaning lives in `title` (the SPEC's
// four-name decision: id never moves even when goal prose drifts). GOAL records have NO
// `criterion` field (their criterion is the conjunction of their ACs).
//
// Goal view-model: { id, title, status, kind, goal, criterion, expect, origin, evidence,
// supersedes, supersededBy, body, updatedAt }. `evidence` is NOT stored — it is DERIVED at
// read time from the gitignored ledger (gap-goal-evidence-cache-should-not-enter-git).

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import {
  parseFrontmatter,
  serializeFrontmatter,
  fileNameForId,
  withFileLock,
  slugify,
} from "./frontmatter-store-base.ts";
import { runAcceptance } from "./gate/acceptance-runner.ts";
import { queryGateEvents } from "./gate/gate-event-store.ts";
import { commitStoreWrite, commitStoreBatch, resolveGitRoot, type CommitOutcome } from "./store-commit.ts";
import { criterionFidelityVerdict, type FidelityInvokeJudge } from "./criterion-fidelity.ts";
import { resolvePluginRoot } from "./plugin-root.ts";

export const VALID_GOAL_STATUSES = ["draft", "active", "achieved", "superseded", "retired", "needs-human"];

// gap-goal-record-completeness-undefined — "what counts as a COMPLETE goal record" was never
// defined: `origin` was required while `body` was optional, inverting the incentive (8 goals, 5
// with empty body — the prose all crammed into `origin`). A GOAL's substance (background / scope
// & non-goals / exit conditions) lives in its `body`; `origin` is only a provenance citation.
// Mirrors the task side's MIN_SECTION_CHARS = 40 (ready-pool-check.ts). Exported so the falsifiability
// test asserts the SAME threshold the store enforces (never a second, divergent literal).
export const MIN_GOAL_BODY_CHARS = 40;

const GOAL_ID_RE = /^GOAL-\d{3,}$/;
const AC_ID_RE = /^AC-\d{3,}$/;

// RE-ENTRANCY GUARD env var (乙, gap-goal-achieved-but-failing-no-handler). While `checkAchievedFailing`
// is running a criterion, it sets this in process.env; runAcceptance's spawnSync (no `env` override)
// inherits it into the criterion's child shell. A criterion whose own command calls back into
// `check --achieved-failing` (or `gate`) therefore spawns a grandchild that sees the var and REFUSES
// to run criteria — bounding the recursion (the 2026-09-07 production incident was an unbounded
// `check --staleness` → criterion → `check --staleness` chain). Exported so the falsifiability test
// can `env -u` it to prove the observation measures real behavior.
export const GOAL_ACCEPTANCE_ACTIVE_ENV = "QUAY_GOAL_ACCEPTANCE_ACTIVE";

// Frontmatter keys the view-model owns explicitly; everything else in the frontmatter
// (any future field) is preserved verbatim — the same discipline as adr-store/document-store.
const OWNED_KEYS = new Set([
  "id", "title", "status", "kind", "goal", "criterion", "expect", "origin", "activatedAt", "statusLog",
  "labels", "posture", "supersedes", "superseded-by", "long-term", "fidelity",
]);

// ── evidence is ledger-DERIVED (gap-goal-evidence-cache-should-not-enter-git) ───────────────────
// `evidence` is NOT a stored field: it is the gitignored `.quay/gate-events.jsonl`'s LAST
// `gate:"goal"` event for a record, read back into the view-model at read time. The ledger path is
// DERIVED from goalDir (`<workspaceRoot>/.quay/gate-events.jsonl`, where goalDir is
// `<workspaceRoot>/goals`) — the same `dirname(goalDir)` derivation `readGoalConfig` already uses.
// A fresh checkout with no ledger ⇒ no evidence ⇒ notEvaluated / "—" (hard rule 6: missing =
// not-checked, not false). This is the SINGLE point both consumers share: `checkStaleness` reads
// `ac.evidence.at` from `list()`'s view-models, and the native provider's `goal_list`/`goal_get`
// verbs surface the same view-models to serve-goal.
type LedgerEvidence = { at?: string; verdict?: string; reading?: string; firstAt?: string };

function ledgerEvidenceMap(goalDir: string): Map<string, LedgerEvidence> {
  const map = new Map<string, LedgerEvidence>();
  const logPath = path.join(path.dirname(goalDir), ".quay", "gate-events.jsonl");
  let events;
  try {
    events = queryGateEvents(logPath, { gate: "goal" });
  } catch {
    return map; // unreadable/missing ledger ⇒ no evidence for any record (never crash a read)
  }
  for (const ev of events) {
    const id = String(ev.pipeline_id ?? ev.item_id ?? "");
    if (!id) continue;
    const reading = ev.payload && typeof ev.payload === "object"
      && typeof (ev.payload as Record<string, unknown>).reason === "string"
      ? (ev.payload as Record<string, unknown>).reason as string
      : undefined;
    // Append order = on-disk order, so the LAST matching event wins (the most recent). `firstAt`
    // keeps the FIRST matching event (the earliest evidence) — the SAME single pass supplies both
    // extremes with zero extra I/O (firstEvidenceAt's min is the first-seen timestamp).
    const prev = map.get(id);
    map.set(id, { at: ev.timestamp, verdict: ev.verdict, reading, firstAt: prev?.firstAt ?? ev.timestamp });
  }
  return map;
}

// ── cap / stale policy values ────────────────────────────────────────────────────────────────
// Both are HUMAN-GIVEN initial strategy values with NO cost-structure backing (hard rule 4:
// no numeric threshold before the cost is measured). Configurable via `.quay/config.yml`'s
// `goals:` section (read by the CLI at invocation, passed into createGoalStore). Re-estimate
// from `.quay/goal-round.jsonl`'s real distribution after the goal-driver runs 30 calendar
// days (SPEC-goal-mechanism-2026-09-06.md §4.2) — any "too tight/loose" claim before then is dataless.
const DEFAULT_GOAL_CAP = 3;
const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Parse a `stale` duration into milliseconds. Accepted forms: "7d" / "12h" / "90m" (suffixed)
// or a bare number = days. Returns null when unparseable (caller falls back to the default).
function parseStaleMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value * 86400_000;
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*(d|h|m)$/i);
    if (m) {
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      const mult = unit === "d" ? 86400_000 : unit === "h" ? 3600_000 : 60_000;
      return n * mult;
    }
  }
  return null;
}

// Read `.quay/config.yml`'s `goals:` section from the workspace root. cap/stale are OPTIONAL
// overrides of the defaults above; an absent/unparseable config or `goals:` section yields the
// defaults (never a crash — the store must work in a bare checkout with no config.yml).
export function readGoalConfig(workspaceRoot: string): { cap: number; staleMs: number } {
  let cap = DEFAULT_GOAL_CAP;
  let staleMs = DEFAULT_STALE_MS;
  const cfgPath = path.join(workspaceRoot, ".quay", "config.yml");
  if (fs.existsSync(cfgPath)) {
    try {
      const parsed = YAML.parse(fs.readFileSync(cfgPath, "utf8"));
      const goals = parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).goals
        : undefined;
      if (goals && typeof goals === "object") {
        const g = goals as Record<string, unknown>;
        if (typeof g.cap === "number" && Number.isFinite(g.cap) && g.cap >= 1) cap = g.cap;
        const sd = parseStaleMs(g.stale);
        if (sd !== null) staleMs = sd;
      }
    } catch { /* unparseable config.yml → defaults (never crash the store) */ }
  }
  return { cap, staleMs };
}

interface GoalFrontmatter {
  [key: string]: unknown;
  id?: string;
  title?: string;
  status?: string;
  kind?: string;
  goal?: string;
  criterion?: string;
  expect?: string;
  origin?: string;
  activatedAt?: string;
  statusLog?: Array<{ at: string; from: string; to: string; actor: string; reason: string }>;
  labels?: string[];
  /** GOAL 层 posture 声明（如 `measure-only`——先测量后承诺，名下 draft AC 不得判 activate，AC-215）。 */
  posture?: string;
  evidence?: { at?: string; verdict?: string; reading?: string };
  supersedes?: string[];
  "superseded-by"?: string[];
  /** AC-216：显式「长期保证」声明——`true` 的 achieved AC 其 GOAL 已 achieved/关闭也仍在 I5 复验域。 */
  "long-term"?: boolean;
  /** 保真性闸（GOAL-013）——激活（任何进入 active 的转换）时保真性判定的结果与理由，落在记录自身（⛔ 不只 stderr）。 */
  fidelity?: { verdict: string; reason: string; at: string };
}

interface GoalFilter {
  status?: string;
  kind?: string;
  goal?: string;
}

interface GoalViewModel {
  id: unknown;
  title: unknown;
  status: unknown;
  kind: unknown;
  goal: unknown;
  criterion: unknown;
  expect: unknown;
  origin: unknown;
  /** GOAL 层 posture 声明（AC-215：`measure-only` ⇒ 名下 draft AC 分诊不得判 activate）。 */
  posture: unknown;
  evidence: unknown;
  activatedAt?: string;
  statusLog?: Array<{ at: string; from: string; to: string; actor: string; reason: string }>;
  supersedes: unknown[];
  supersededBy: unknown[];
  /** AC-216：`long-term: true` 的 achieved AC 跨 GOAL 关闭仍在 I5 复验域（frontmatter `long-term` 投影）。 */
  longTerm: unknown;
  /** 保真性闸（GOAL-013）——激活期保真性判定的结果与理由（frontmatter `fidelity` 投影）。 */
  fidelity: unknown;
  body: string;
  updatedAt?: number;
  /** Ledger-derived (never stored, never mtime): the record's most recent goal-gate-event time. */
  lastProgressAt?: string;
  /** Ledger-derived (never stored, never mtime): the record's earliest goal-gate-event time. */
  firstEvidenceAt?: string;
}

export interface DisposeOld {
  /** the old active goal's id */
  id: string;
  /** what happens to it: "achieved" or "superseded" */
  to: "achieved" | "superseded";
}

export function isGoalId(id: string): boolean {
  return typeof id === "string" && GOAL_ID_RE.test(id);
}

export function isCriterionId(id: string): boolean {
  return typeof id === "string" && AC_ID_RE.test(id);
}

/**
 * gap-goal-store-write-no-create-vs-update-intent-guard — the intent-conflict error class.
 *
 * `write` previously fused CREATE and UPDATE into one verb with patch semantics, so a caller
 * whose (stale) existence check said "absent" would silently overwrite a record that another
 * session created in between (the 2026-09-10 GOAL-013 incident). `write` now accepts a declared
 * intent — `expect: "absent"` (I intend to create; refuse if it exists) or `expect: "existing"`
 * (I intend to update; refuse if it's absent) — and this class is the distinguishable failure it
 * throws on mismatch, mirroring quay-native `store.ts`'s `ConflictError` for `task_write`'s
 * `expectedStatus` CAS (⛔ a separate class, never a generic `Error` with a parseable message:
 * callers `catch (err) { if (err instanceof GoalIntentConflictError) … }` to detect the race
 * specifically). Thrown INSIDE `withFileLock`, before any mutation, so the write is aborted with
 * nothing written to disk.
 */
export class GoalIntentConflictError extends Error {
  id: string;
  expect: "absent" | "existing";
  actual: "present" | "absent";
  constructor(id: string, expect: "absent" | "existing", actual: "present" | "absent") {
    super(
      `goal-store intent conflict on ${id}: declared ${
        expect === "absent" ? "--expect-absent (create intent)" : "--expect-existing (update intent)"
      } but ${
        actual === "present" ? "the record already exists" : "the record does not exist"
      } — refusing to ${
        expect === "absent" ? "overwrite" : "create"
      } (write() aborted, nothing written to disk)`
    );
    this.name = "GoalIntentConflictError";
    this.id = id;
    this.expect = expect;
    this.actual = actual;
  }
}

// ── lastProgressAt / firstEvidenceAt for GOAL rows (M1 time columns) ──────────────────────────
// A GOAL's time is DERIVED from its ACs' ledger-derived evidence — NEVER its own `updatedAt`
// (mtime) and never a stored field (hard rule 4b: a quantity the measured object produces is not
// a measurement). lastProgressAt = max over ACs of `evidence.at` (its most recent progress);
// firstEvidenceAt = min over ACs of `evidence.firstAt` (its earliest evidence). Criterion records
// already carry their own last/first from toViewModel (their own gate events); this pass overrides
// the (undefined) GOAL values. Runs over the FULL pre-filter list so a `?kind=goal`/`?goal=` filter
// can never empty a goal's AC set (hard rule 3b — the rollup and time must not collapse under filter).
function annotateGoalProgress(all: GoalViewModel[]): void {
  const byGoal = new Map<string, GoalViewModel[]>();
  for (const g of all) {
    if (typeof g.goal !== "string") continue;
    const arr = byGoal.get(g.goal) ?? [];
    arr.push(g);
    byGoal.set(g.goal, arr);
  }
  for (const g of all) {
    if (!isGoalId(String(g.id))) continue;
    const acs = byGoal.get(String(g.id)) ?? [];
    let lastMs: number | undefined;
    let firstMs: number | undefined;
    let lastStr: string | undefined;
    let firstStr: string | undefined;
    for (const ac of acs) {
      const ev = ac.evidence as { at?: unknown; firstAt?: unknown } | undefined;
      if (ev && typeof ev.at === "string") {
        const t = Date.parse(ev.at);
        if (!Number.isNaN(t) && (lastMs === undefined || t > lastMs)) { lastMs = t; lastStr = ev.at; }
      }
      if (ev && typeof ev.firstAt === "string") {
        const t = Date.parse(ev.firstAt);
        if (!Number.isNaN(t) && (firstMs === undefined || t < firstMs)) { firstMs = t; firstStr = ev.firstAt; }
      }
    }
    g.lastProgressAt = lastStr;
    g.firstEvidenceAt = firstStr;
  }
}

/**
 * STRIP-EVIDENCE-TIMESTAMP — the SINGLE shared judgment for "is a goal-file change substantive?"
 * (gap-goal-gate-timestamp-commit-flood). Defined HERE (Core) so BOTH goal-store's commit decision
 * and meta-driver's settleEvidenceWrites (plugin/scripts/meta-driver.ts, which imports this) apply
 * the SAME definition — ⛔ never a second, divergent copy in each consumer. `at:` is the evidence
 * timestamp the goal-driver rewrites every ~42s; it carries no information, so a change that is
 * ONLY `at:` is not substantive. Everything else (verdict/reading/status/title/…) is.
 */
export function stripEvidenceTimestamp(text: string): string {
  return text.replace(/^\s*at:\s*\S+\s*$/gm, "");
}

/**
 * COMMIT-AFTER-WRITE (gap-meta-commitgoalfile; now unified by SPEC-store-commit-unification §4):
 * commit a goal file to git immediately after writeFileSync, via the shared primitive
 * `commitStoreWrite` — ⛔ no git plumbing here (the five store files' `git commit` has exactly one
 * home: store-commit.ts). The goal store is the SOURCE of goal writes — the CLI `write`,
 * meta-driver's write paths, all funnel through `write()`/`flipGoal()` — so the commit lives HERE,
 * not in each caller. This wrapper declares the goal kind's default (SPEC §4 declaration table):
 * `propagate: "none"` — a goal write rides the branch it lands on (the goal driver runs from the
 * main checkout; a worktree write is carried into develop by that task's fan-in ff). A NEW goal
 * that must be pool-visible now passes propagate "develop" per SPEC §2.2.
 */
function commitGoalFile(goalDir: string, fileName: string, id: string, action: string): CommitOutcome {
  const root = resolveGitRoot(goalDir);
  return commitStoreWrite({
    relPath: root ? path.relative(root, path.join(goalDir, fileName)) : `goals/${fileName}`,
    kind: "goals",
    id,
    action,
    root,
    propagate: "none",
  }).outcome;
}

/**
 * @param {string} goalDir absolute path to the goal directory (e.g. `<workspaceRoot>/goals`)
 * @param {{cap?: number, staleMs?: number, fidelityJudge?: FidelityInvokeJudge}} opts I1′/I3 policy
 *   values (default cap=3, stale=7d — readGoalConfig supplies the .quay/config.yml values at the CLI
 *   entry) + the GOAL-013 fidelity-judge seam. `fidelityJudge` is OPTIONAL: when absent, the
 *   activation (any transition INTO active) still proceeds (the pre-GOAL-013 path is verbatim unchanged — fails-open),
 *   BUT the record now carries a distinguishable `fidelity: {verdict:"not-evaluated", reason:"no judge
 *   configured"}` value so "the gate never ran" is no longer carrier-identical to "the gate ran and
 *   passed" (gap-fidelity-judge-unwired-in-production-and-verdict-stubbed-in-tests; hard rule 3b).
 *   When present, the P6 gate asks the second question ("can it be false on the claimed object") and
 *   rejects vacuous/not-evaluated criteria.
 */
export function createGoalStore(
  goalDir: string,
  opts: { cap?: number; staleMs?: number; fidelityJudge?: FidelityInvokeJudge } = {},
) {
  fs.mkdirSync(goalDir, { recursive: true });
  const cap = opts.cap ?? DEFAULT_GOAL_CAP;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const storeFidelityJudge = opts.fidelityJudge;

  function assertSafeId(id: string) {
    if (typeof id !== "string" || !(GOAL_ID_RE.test(id) || AC_ID_RE.test(id))) {
      throw new Error(
        `invalid goal id ${JSON.stringify(id)}: must match GOAL-NNN or AC-NNN (>=3 digits)`
      );
    }
    return id;
  }

  function assertSafeStatus(status: string | undefined) {
    if (status !== undefined && !VALID_GOAL_STATUSES.includes(status)) {
      throw new Error(
        `invalid goal status "${status}" — must be one of ${VALID_GOAL_STATUSES.join(", ")}`
      );
    }
  }

  function toViewModel(
    frontmatter: GoalFrontmatter,
    body: string,
    evidenceMap: Map<string, LedgerEvidence>,
    updatedAt?: number,
  ): GoalViewModel {
    const evidence = evidenceMap.get(String(frontmatter.id ?? ""));
    const vm: GoalViewModel = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      kind: frontmatter.kind,
      goal: frontmatter.goal,
      criterion: frontmatter.criterion,
      expect: frontmatter.expect,
      origin: frontmatter.origin,
      posture: frontmatter.posture,
      longTerm: frontmatter["long-term"] === true,
      fidelity: frontmatter.fidelity,
      evidence,
      // Own-record time (a criterion): lastProgressAt = its LAST gate=goal event, firstEvidenceAt =
      // its FIRST. A GOAL's own fields are undefined here (GOALs carry no criterion and are never
      // gated themselves) — list() derives a GOAL's time from its ACs via annotateGoalProgress.
      lastProgressAt: typeof evidence?.at === "string" ? evidence.at : undefined,
      firstEvidenceAt: typeof evidence?.firstAt === "string" ? evidence.firstAt : undefined,
      activatedAt: frontmatter.activatedAt,
      statusLog: frontmatter.statusLog,
      supersedes: frontmatter.supersedes ?? [],
      supersededBy: frontmatter["superseded-by"] ?? [],
      body,
    };
    if (updatedAt !== undefined) vm.updatedAt = updatedAt;
    return vm;
  }

  function get(id: string): GoalViewModel | null {
    assertSafeId(id);
    const file = fileNameForId(goalDir, id);
    if (!file) return null;
    const p = path.join(goalDir, file);
    const { frontmatter, body } = parseFrontmatter(fs.readFileSync(p, "utf8"));
    let updatedAt: number | undefined;
    try {
      updatedAt = fs.statSync(p).mtimeMs;
    } catch { /* omit */ }
    return toViewModel(frontmatter as GoalFrontmatter, body, ledgerEvidenceMap(goalDir), updatedAt);
  }

  function list(filter: GoalFilter = {}): GoalViewModel[] {
    const evidenceMap = ledgerEvidenceMap(goalDir);
    const all = fs
      .readdirSync(goalDir)
      .filter((f) => f.endsWith(".md") && (f.startsWith("GOAL-") || f.startsWith("AC-")))
      .map((f) => {
        const { frontmatter, body } = parseFrontmatter(fs.readFileSync(path.join(goalDir, f), "utf8"));
        return toViewModel(frontmatter as GoalFrontmatter, body, evidenceMap, fs.statSync(path.join(goalDir, f)).mtimeMs);
      });
    // GOAL rows' time is derived from their ACs — computed over the FULL list before any filter.
    annotateGoalProgress(all);
    return all
      .filter((g) => (filter.status ? g.status === filter.status : true))
      .filter((g) => (filter.kind ? g.kind === filter.kind : true))
      .filter((g) => (filter.goal ? g.goal === filter.goal : true))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  // I1: the (at most one) currently-active GOAL. Derived from stored status, never hand-listed.
  function activeGoals(): GoalViewModel[] {
    return list().filter((g) => isGoalId(String(g.id)) && g.status === "active");
  }

  // AC4: the ACTIVE SET is DERIVED from goal status, never a hand-maintained checklist.
  // A criterion record is "active" ⟺ its goal's stored status is `active`.
  function listActiveCriteria(): GoalViewModel[] {
    const activeGoalIds = new Set(activeGoals().map((p) => String(p.id)));
    return list().filter((g) => !isGoalId(String(g.id)) && activeGoalIds.has(String(g.goal)));
  }

  // I2: a GOAL is achieved ⟺ ALL its ACs are achieved. Evaluated at read time, never stored.
  function isGoalAchieved(goalId: string): boolean {
    assertSafeId(goalId);
    if (!isGoalId(goalId)) {
      throw new Error(`isGoalAchieved requires a GOAL-NNN id, got ${JSON.stringify(goalId)}`);
    }
    const acs = list().filter((g) => String(g.goal) === goalId);
    if (acs.length === 0) return false; // a goal with no ACs is not achieved
    return acs.every((g) => g.status === "achieved");
  }

  // I1′ checker — the invariant is "active count ≤ cap", NOT "exactly one". Splitting
  // withinCap (invariant holds) from hasDirection (≥1 active) keeps "over cap" and "none
  // active" from collapsing into one boolean (hard rule 3b: distinct states, distinct values).
  function checkWithinCap(): {
    withinCap: boolean;
    hasDirection: boolean;
    activeCount: number;
    cap: number;
    active: string[];
  } {
    const ap = activeGoals();
    const activeCount = ap.length;
    return {
      withinCap: activeCount <= cap,
      hasDirection: activeCount >= 1,
      activeCount,
      cap,
      active: ap.map((p) => String(p.id)),
    };
  }

  // I3 + I4 checker (check --staleness). THREE named buckets, structurally always present
  // (possibly empty arrays) — never a binary fresh/stale that would judge an unevaluated goal
  // as healthy (hard rule 3b). `lastProgressAt` is DERIVED from the ACs' ledger-derived
  // `evidence.at` max (never stored, never the goal's own `updatedAt` — hard rule 4b).
  // `divergent` is the I4 signal: status active while `isGoalAchieved()` is true
  // ("achieved but nobody closed it").
  // ⛔ PURE-READ — it must NOT run criteria: an achieved criterion that itself calls
  // `check --staleness` (AC-175) would recurse unboundedly (2026-09-07 production incident).
  // The criterion-running I5 check lives in `checkAchievedFailing` (a SEPARATE subcommand).
  function checkStaleness(nowMs: number = Date.now()): {
    fresh: string[];
    stale: string[];
    notEvaluated: string[];
    divergent: string[];
    scopeSize: number;
    evaluated: boolean;
    cap: number;
    staleMs: number;
  } {
    const all = list();
    const fresh: string[] = [];
    const stale: string[] = [];
    const notEvaluated: string[] = [];
    const divergent: string[] = [];
    const active = activeGoals();
    for (const g of active) {
      const gid = String(g.id);
      if (isGoalAchieved(gid)) divergent.push(gid); // I4 — active yet all ACs achieved
      let lastProgressAt: number | undefined;
      for (const ac of all.filter((r) => String(r.goal) === gid)) {
        const ev = ac.evidence as { at?: unknown } | undefined;
        if (ev && typeof ev.at === "string") {
          const t = Date.parse(ev.at);
          if (!Number.isNaN(t) && (lastProgressAt === undefined || t > lastProgressAt)) {
            lastProgressAt = t;
          }
        }
      }
      if (lastProgressAt === undefined) {
        notEvaluated.push(gid); // no ACs, or no evidence.at anywhere → never evaluated
      } else if (nowMs - lastProgressAt > staleMs) {
        stale.push(gid);
      } else {
        fresh.push(gid);
      }
    }
    // Empty scope (0 active goals) must NOT share its output shape with "all evaluated and healthy"
    // (hard rule 3b): with 0 active goals every bucket is empty — the SAME shape a booleanized
    // "nothing stale / nothing divergent" reader sees for "N goals none divergent". `scopeSize` =
    // the enumerated active-goal count, `evaluated` = whether any goal was actually judged
    // (scopeSize > 0) — two fields that make "no objects to check" distinguishable from "checked".
    const scopeSize = active.length;
    return { fresh, stale, notEvaluated, divergent, scopeSize, evaluated: scopeSize > 0, cap, staleMs };
  }

  // I5 checker (check --achieved-failing). An AC `status: achieved` whose `criterion` now exits
  // non-zero ⇒ "achieved but no longer verifiable". SEPARATE from I4 (⛔ never merged): I4 is
  // "active yet achieved" (GOAL ids, direction "not closed"), I5 is "achieved yet failing" (AC ids,
  // direction "no longer verifiable"). Produced ONLY by RUNNING the criterion — never a stored field.
  // Scope: achieved ACs under ACTIVE goals ∪ achieved ACs with `long-term: true` (AC-216 — a
  // long-term AC stays in the reverify scope after its GOAL is achieved/closed). Empty/missing
  // criterion is SKIPPED: that is the separate `no-criterion` kind meta-driver reports, not "a
  // criterion that now fails" (a criterion that never existed cannot have started failing).
  // `inScope` enumerates the in-scope AC ids (hard rule 3: enumerate, don't boolean).
  //
  // ⛔ RE-ENTRANCY GUARD (乙): a criterion whose own shell command calls back into this checker
  // (or `gate`) must NOT run criteria again — otherwise it recurses unboundedly. The guard is the
  // GOAL_ACCEPTANCE_ACTIVE_ENV env var, inherited by the criterion's child shell (runAcceptance's
  // spawnSync passes no `env`, so it inherits process.env): while running criteria we set it; a
  // nested invocation that sees it REFUSES and reports `evaluated: false` (⛔ not an empty array
  // masquerading as "no achieved-but-failing AC" — hard rule 3b). 甲 (structural isolation:
  // `check --staleness` is pure-read) means the 8 real achieved criteria that call
  // `check --staleness`/`list`/`get` never even reach this path; 乙 is defense-in-depth for a
  // future criterion that calls the criterion-runner itself.
  function checkAchievedFailing(): { achievedButFailing: string[]; evaluated: boolean; scopeSize: number; inScope: string[] } {
    // Enumerate the in-scope set FIRST (pure-read — no criterion runs): achieved ACs under ACTIVE
    // goals with a non-empty criterion. `scopeSize` is that count, and it is what makes "empty
    // scope" (0 active goals / 0 achieved ACs under them) field-distinguishable from "ran N criteria
    // and all passed" (hard rule 3b — ⛔ not an empty array masquerading as "no achieved-but-failing
    // AC"). The enumeration is done before the guard check so the guard path's `scopeSize` is truthful
    // too (it refuses to RUN, but it still knows the scope).
    const activeGoalIds = new Set(activeGoals().map((g) => String(g.id)));
    const inScope: GoalViewModel[] = [];
    for (const ac of list()) {
      if (!isCriterionId(String(ac.id))) continue;
      if (ac.status !== "achieved") continue;
      // AC-216 — in scope ⟺ (under an ACTIVE goal) OR (explicit `long-term: true`): a long-term
      // achieved AC stays in the reverify scope even after its GOAL is achieved/closed; an
      // undeclared one leaves with its GOAL (cost boundary — ⛔ not an indiscriminate widening).
      if (!activeGoalIds.has(String(ac.goal)) && ac.longTerm !== true) continue;
      const criterion = typeof ac.criterion === "string" ? ac.criterion : "";
      if (criterion.trim() === "") continue;
      inScope.push(ac);
    }
    const scopeSize = inScope.length;
    const inScopeIds = inScope.map((ac) => String(ac.id));
    if (process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] === "1") {
      return { achievedButFailing: [], evaluated: false, scopeSize, inScope: inScopeIds };
    }
    const achievedButFailing: string[] = [];
    // Criterion cwd = the git root (robust rev-parse, ⛔ not path.dirname — hard rule 4 corollary 2),
    // falling back to goalDir's parent only when not inside a git work tree.
    const root = resolveGitRoot(goalDir) ?? path.dirname(goalDir);
    const prev = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
    process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = "1";
    try {
      for (const ac of inScope) {
        const criterion = typeof ac.criterion === "string" ? ac.criterion : "";
        const res = runAcceptance({ command: criterion, cwd: root, timeoutMs: 60000 });
        if (!res.ok) achievedButFailing.push(String(ac.id));
      }
    } finally {
      if (prev === undefined) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
      else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prev;
    }
    return { achievedButFailing, evaluated: scopeSize > 0, scopeSize, inScope: inScopeIds };
  }

  /** Direct read-modify-write of the old goal's file (inside the NEW goal's write lock). */
  function flipGoal(oldId: string, patch: { status: string; supersededBy?: string[] }) {
    const file = fileNameForId(goalDir, oldId);
    if (!file) return;
    const p = path.join(goalDir, file);
    const { frontmatter, body } = parseFrontmatter(fs.readFileSync(p, "utf8"));
    const fm = frontmatter as GoalFrontmatter;
    const prevStatus = String(fm.status ?? "");
    fm.status = patch.status;
    if (patch.supersededBy !== undefined) fm["superseded-by"] = patch.supersededBy;
    fs.writeFileSync(p, serializeFrontmatter(fm, body), "utf8");
    const outcome = commitGoalFile(goalDir, file, oldId, `status ${prevStatus}→${patch.status}`);
    if (outcome === "failed") {
      // The disk write succeeded but the git commit genuinely FAILED — never throw (the write IS on
      // disk), but surface on stderr so the failure is observable, not silent (硬规则 3b).
      // "unchanged"/"not-in-git" are expected no-ops and deliberately do NOT log.
      console.error(`goal-store: commit of "${oldId}" failed — the file was written to disk but is not on any branch's history`);
    }
  }

  function write(id: string, {
    title, status, goal, criterion, expect, origin,
    supersedes, supersededBy, body, disposeOld,
    force = false,
    actor,
    reason,
    dryRun = false,
    commit = true,
    intent,
    fidelityJudge,
  }: {
    title?: string;
    status?: string;
    goal?: string;
    criterion?: string;
    expect?: string;
    origin?: string;
    supersedes?: string[];
    supersededBy?: string[];
    body?: string;
    disposeOld?: DisposeOld;
    /** P6b: a per-call fidelity judge overriding the store-level seam (the CLI's
     *  `--fidelity-judge-argv` path). `undefined` ⇒ fall back to the store-level `fidelityJudge`. */
    fidelityJudge?: FidelityInvokeJudge;
    /** P6: skip the activation gate (a deliberate "I know it's not evaluable" override). */
    force?: boolean;
    /** P3: the actor recorded in a statusLog entry (default "goal-cli"). */
    actor?: string;
    /** P3: the reason recorded in a statusLog entry. */
    reason?: string;
    /** P9: validate everything (including the activation gate) but persist NOTHING. */
    dryRun?: boolean;
    /** batch (gap-store-commit-action-and-actor AC3): write the file but defer the git commit to a
     *  `writeBatch` flush (⛔ not used by the per-write CLI path). */
    commit?: boolean;
    /** gap-goal-store-write-no-create-vs-update-intent-guard — the declared write intent, the goal
     *  store's counterpart to task_write's `expectedStatus` CAS: `"absent"` = "I intend to CREATE,
     *  refuse if it already exists", `"existing"` = "I intend to UPDATE, refuse if it is absent".
     *  Mismatch throws GoalIntentConflictError inside the lock, before any mutation (nothing written).
     *  ⛔ Omitted (undefined) keeps patch semantics — the no-intent path is unchanged for the existing
     *  callers (goal-driver status flips, meta-driver writes); its create-vs-update outcome is still
     *  distinguishable in the commit subject (`create` vs `field:…`). */
    intent?: "absent" | "existing";
  }): GoalViewModel {
    assertSafeId(id);
    assertSafeStatus(status);
    const isGoalRecord = isGoalId(id);
    // SPEC §2b: GOAL records carry NO criterion field — their criterion is the conjunction
    // of their ACs. Refusing beats silently dropping the field.
    if (isGoalRecord && criterion !== undefined) {
      throw new Error(
        `${id} is a GOAL record and cannot carry a \`criterion\` field — a goal is judged by the conjunction of its ACs`
      );
    }
    return withFileLock(goalDir, id, () => {
      const existingFile = fileNameForId(goalDir, id);
      let frontmatter: GoalFrontmatter = {};
      let existingBody = "";
      if (existingFile) {
        const parsed = parseFrontmatter(fs.readFileSync(path.join(goalDir, existingFile), "utf8"));
        frontmatter = { ...(parsed.frontmatter as GoalFrontmatter) };
        existingBody = parsed.body;
      }
      // gap-goal-store-write-no-create-vs-update-intent-guard — the declared-intent guard (an
      // existence CAS, the goal store's counterpart to task_write's `expectedStatus`). A caller
      // who DECLARED create (`intent: "absent"`) must never silently overwrite a record that
      // another session created in between (the 2026-09-10 GOAL-013 incident); a caller who
      // DECLARED update (`intent: "existing"`) must never silently create. Thrown INSIDE the lock,
      // before any mutation, so the refused write leaves nothing on disk — and as a distinct class
      // (never a generic `Error` with a parseable message) it is catchable via
      // `instanceof GoalIntentConflictError`.
      if (intent !== undefined) {
        if (intent === "absent" && existingFile) {
          throw new GoalIntentConflictError(id, "absent", "present");
        }
        if (intent === "existing" && !existingFile) {
          throw new GoalIntentConflictError(id, "existing", "absent");
        }
      }
      // The body that will land: an explicit `body` param, else the stored body (patch
      // semantics — omitting `body` on an update keeps it, the same as `origin`).
      const finalBody = body !== undefined ? body : existingBody;
      // The PRIOR status (undefined for a new record) — the basis for status-change detection
      // (statusLog, P3) and the draft→active activation gate (P6).
      const prevStatus = typeof frontmatter.status === "string" ? frontmatter.status : undefined;
      // Apply owned fields (preserving any unknown frontmatter keys verbatim).
      frontmatter.id = id;
      if (title !== undefined) frontmatter.title = title;
      const nextStatus = status ?? frontmatter.status ?? "draft";
      frontmatter.status = nextStatus;
      // `kind` is derived from the id prefix — never caller-supplied.
      frontmatter.kind = isGoalRecord ? "goal" : "criterion";
      if (goal !== undefined) frontmatter.goal = goal;
      if (criterion !== undefined) frontmatter.criterion = criterion;
      if (expect !== undefined) frontmatter.expect = expect;
      if (origin !== undefined) frontmatter.origin = origin;
      if (supersedes !== undefined) frontmatter.supersedes = supersedes;
      if (supersededBy !== undefined) frontmatter["superseded-by"] = supersededBy;
      const statusChanged = prevStatus !== undefined && nextStatus !== prevStatus;
      // ⛔ "activation" here is ANY transition INTO active (SPEC §6 裁定 3: activation is manual; the
      // goal-driver never flips INTO active). Reopen paths — achieved→active, needs-human→active,
      // superseded→active, retired→active — are activations too (gap-activation-gates-bypassed-on-
      // reopen-path-non-draft-to-active: they were ~19% of all activations and walked past all three
      // gates, so a criterion rewritten mid-reopen entered active unchecked). create-as-active is NOT
      // gated — a new record's criterion is validated by the create completeness contract, and the P6
      // round-trip concern ("does the criterion still run after YAML round-trip?") only exists once a
      // record has been stored once and later activated. active→active (no status change) is not an
      // activation. ⛔ The most-frequent reopen shape is needs-human→active (3/5) — the human re-arms
      // a record after a ruling, precisely when criterion/expect were most likely just rewritten.
      const activating = nextStatus === "active" && prevStatus !== undefined && prevStatus !== "active";

      // A criterion record MUST point at a goal (its activeness derives from that goal).
      if (!isGoalRecord && (typeof frontmatter.goal !== "string" || frontmatter.goal.trim() === "")) {
        throw new Error(`AC record ${id} must declare a \`goal: GOAL-NNN\` — activeness derives from the goal`);
      }

      // AC6 / SPEC §2.4 — `origin` REQUIRED: an AC without a basis is cargo cult. Empty
      // (or missing) origin writes nothing, on create AND on any update that would blank it.
      if (typeof frontmatter.origin !== "string" || frontmatter.origin.trim() === "") {
        throw new Error(
          `origin is required for ${id} — an AC/goal without an empirical basis is cargo cult; empty origin writes nothing`
        );
      }

      // gap-goal-record-completeness-undefined — "what counts as a COMPLETE record" is
      // kind-split (⛔ never one rule for both — a blanket body-required rule would misfire
      // on the 57 criteria whose content legitimately lives in criterion+expect):
      //   criterion ⇒ `criterion` + `expect` + `goal` REQUIRED, `body` optional.
      //   goal      ⇒ `body` REQUIRED (≥ MIN_GOAL_BODY_CHARS non-whitespace), `origin` is
      //               provenance only.
      // Each rejection names its kind and the missing field, distinguishable from every other
      // failure (hard rule 3b — "which field is missing" is the actionable info).
      //
      // FIELD-TOUCHED successor (gap-goal-store-write-surface-semantics P4/P5): the old
      // CREATE-ONLY guard (⛔ `if (!existingFile)`) left the UPDATE path entirely unvalidated —
      // blanking a criterion on an existing record was silently written as an empty string.
      // The split is now by WHICH CONTENT FIELDS this write touches, not create vs update:
      //   • CREATE: the presence contract above still governs authoring a new record.
      //   • UPDATE: a touched `criterion`/`expect` must not be blanked (P4/P5) — this is what
      //     blocks `write <id> --criterion ""` on an existing record (was exit 0).
      //   • status-only (the mechanical I2 flip, which touches no content field) is still
      //     let through — that was the create-only guard's entire reason for existing.
      // ⛔ No ≥ MIN_SECTION_CHARS floor on criterion/expect: production carries legitimate short
      // values ("exit 0", 19-char runnable criteria) and the store's own re-write negative-control
      // (gap-goal-record-completeness-undefined AC5) would reject them — a numeric threshold over
      // an unmeasured cost structure (hard rule 4). The non-empty guard is the enforceable half.
      const touchesCriterion = criterion !== undefined;
      const touchesExpect = expect !== undefined;
      if (!existingFile) {
        if (!isGoalRecord) {
          if (typeof frontmatter.criterion !== "string" || frontmatter.criterion.trim() === "") {
            throw new Error(
              `${id} is a criterion record and requires a non-empty \`criterion\` — the runnable command that verifies it (a criterion's content lives in criterion+expect, not the body; empty criterion writes nothing)`
            );
          }
          if (typeof frontmatter.expect !== "string" || frontmatter.expect.trim() === "") {
            throw new Error(
              `${id} is a criterion record and requires a non-empty \`expect\` — the expected outcome the criterion proves (a criterion's content lives in criterion+expect, not the body; empty expect writes nothing)`
            );
          }
        } else {
          if (finalBody.trim().length < MIN_GOAL_BODY_CHARS) {
            throw new Error(
              `${id} is a GOAL record and requires a \`body\` of ≥${MIN_GOAL_BODY_CHARS} non-whitespace chars (background / scope & non-goals / exit conditions) — \`origin\` is only a provenance citation, not the body; empty body writes nothing`
            );
          }
        }
      } else if (!isGoalRecord) {
        if (touchesCriterion && (typeof frontmatter.criterion !== "string" || frontmatter.criterion.trim() === "")) {
          throw new Error(
            `${id} cannot be updated to an empty \`criterion\` — the runnable command that verifies it (empty criterion writes nothing)`
          );
        }
        if (touchesExpect && (typeof frontmatter.expect !== "string" || frontmatter.expect.trim() === "")) {
          throw new Error(
            `${id} cannot be updated to an empty \`expect\` — the expected outcome the criterion proves (empty expect writes nothing)`
          );
        }
      }

      // P6 — activation gate (gap-goal-store-write-surface-semantics): a CRITERION record
      // transitioning INTO active (draft / achieved / needs-human / superseded / retired → active)
      // must carry an EVALUABLE criterion — run it ONCE and require a
      // definitive verdict (pass OR fail both prove "it can run"; a hard-true criterion is
      // evaluable and passes). "not-evaluated" (empty criterion, or the command fails to spawn)
      // ⇒ REJECT with the reason surfaced on stderr. `--force` overrides for a deliberate
      // "I know it's not evaluable". Running the criterion is also the ONLY honest proof that it
      // survived the YAML round-trip — proven by running, not by remembering to check.
      if (activating && !isGoalRecord && !force) {
        const criterionCmd = typeof frontmatter.criterion === "string" ? frontmatter.criterion : "";
        if (criterionCmd.trim() === "") {
          throw new Error(`cannot activate ${id}: criterion not-evaluated (no criterion defined) — pass --force to override`);
        }
        const gateRoot = resolveGitRoot(goalDir) ?? path.dirname(goalDir);
        const startedMs = Date.now();
        const gateRes = runAcceptance({ command: criterionCmd, cwd: gateRoot, timeoutMs: 60000 });
        const wallMs = Date.now() - startedMs;
        // not-evaluated = the command never ran to a verdict (spawn error); "ran and failed"
        // (exit ≠0) and timeouts are both a definitive "fail" verdict ⇒ evaluable ⇒ allowed.
        if (gateRes.code === null && !gateRes.timedOut) {
          throw new Error(`cannot activate ${id}: criterion not-evaluated (${gateRes.reason}) — pass --force to override`);
        }
        // P10 — make the activation cost visible: the criterion now joins the per-round hot loop.
        console.error(`goal-store: activated ${id} — criterion ran in ${wallMs}ms (${gateRes.ok ? "pass" : "fail"})`);
      }

      // P6b — fidelity question (GOAL-013, gap-criterion-fidelity-gate-activation-blind-to-vacuous-
      // criteria): the evaluability gate above proves the criterion can RUN; this proves it can be
      // FALSE on the object its `expect` claims (hard rule 4 — a quantity structurally incapable of
      // being false is not a measurement). Only judges when a judge is wired (`fidelityJudge` seam
      // or the per-call `--fidelity-judge-argv` override); absent ⇒ the pre-GOAL-013 activation path
      // is verbatim unchanged (fails-open) BUT the record still carries a distinguishable
      // `not-evaluated / "no judge configured"` value (visibility — 字段缺失不再与「判过且放行」同形).
      // ⛔ NOT in the ~42s hot loop — this is the activation hook only (goal-driver's per-round gate
      // path never calls it).
      if (activating && !isGoalRecord && !force) {
        const judge = fidelityJudge ?? storeFidelityJudge;
        if (typeof judge === "function") {
          const fidelityCmd = typeof frontmatter.criterion === "string" ? frontmatter.criterion : "";
          const expectText = typeof frontmatter.expect === "string" ? frontmatter.expect : "";
          const fidelityRoot = resolveGitRoot(goalDir) ?? path.dirname(goalDir);
          const fRes = criterionFidelityVerdict(fidelityCmd, expectText, judge, { root: fidelityRoot });
          if (fRes.verdict === "vacuous" || fRes.verdict === "not-evaluated") {
            throw new Error(`cannot activate ${id}: criterion ${fRes.verdict} (${fRes.reason}) — pass --force to override`);
          }
          // 判定结果 + 理由落在记录自身 (GOAL-013 退出条件③) — ⛔ 不只打印 stderr，否则「判过且保真」
          // 与「没判成」在载体上同形。
          frontmatter.fidelity = { verdict: fRes.verdict, reason: fRes.reason, at: new Date().toISOString() };
        } else {
          // Visibility (gap-fidelity-judge-unwired-in-production-and-verdict-stubbed-in-tests):
          // judge NOT configured ⇒ activation still proceeds (fails-open), but the record carries a
          // distinguishable value so "the gate never ran" ≠ "the gate ran and passed" on the carrier.
          frontmatter.fidelity = { verdict: "not-evaluated", reason: "no judge configured", at: new Date().toISOString() };
        }
      }

      // P6c — force escape trace (GOAL-013 风险 4): `--force` skips BOTH activation gates. The
      // override must leave a trace on the record itself, ⛔ never a silent overreach.
      if (activating && !isGoalRecord && force) {
        frontmatter.fidelity = {
          verdict: "forced",
          reason: "--force override (skipped evaluability + fidelity gates)",
          at: new Date().toISOString(),
        };
      }

      // P3 — status-change provenance (gap-goal-store-write-surface-semantics): `activatedAt`
      // (first-activation timestamp) + `statusLog` (append-only status-change history).
      //
      // BOUNDARY vs `evidence` (why this IS stored, never derived — the next person must NOT delete
      // it following gap-goal-evidence-cache-should-not-enter-git's precedent): `evidence` is
      // re-DERIVED every ~42s from the gitignored gate ledger ⇒ derived ⇒ never stored (落盘 would
      // re-couple the ~42s cadence to a tracked file). `statusLog` is LOW-FREQUENCY (a status flip
      // is a deliberate lifecycle move, not a ~42s re-read), MONOTONICALLY APPENDED, and NOWHERE
      // DERIVABLE — the gate ledger records only verdicts, never status flips, so a status change
      // has no other carrier; losing it is unrecoverable. (hard rule 4: a DERIVED quantity must not
      // be 落盘; an UNDERIVABLE one must.)
      if (nextStatus === "active" && prevStatus !== "active" && typeof frontmatter.activatedAt !== "string") {
        frontmatter.activatedAt = new Date().toISOString();
      }
      if (statusChanged) {
        const prior = Array.isArray(frontmatter.statusLog) ? frontmatter.statusLog : [];
        frontmatter.statusLog = [...prior, {
          at: new Date().toISOString(),
          from: prevStatus as string,
          to: nextStatus,
          actor: actor ?? "goal-cli",
          reason: reason ?? "",
        }];
      }

      // I1′ — hard cap, write-time fail-closed (SPEC-goal-mechanism-2026-09-06.md §4.1).
      // Activating `id` must not push the active-GOAL count past `cap`. A call may free a slot
      // first by disposing an active goal in the SAME atomic write (`disposeOld` → achieved, or
      // `supersedes: [oldId]` → superseded). The rejection message ENUMERATES the active set
      // (hard rule 3: enumerate, don't boolean) — "which goals hold the slots" is the actionable info.
      if (isGoalRecord && nextStatus === "active") {
        // Dispositions that free a slot. In dry-run they must NOT be applied (no side effects) but
        // they must still count against `remainingActive` so the cap judgment matches a real write.
        const disposedIds = new Set<string>();
        if (disposeOld) disposedIds.add(String(disposeOld.id));
        if (Array.isArray(supersedes)) for (const oldId of supersedes) disposedIds.add(String(oldId));
        if (!dryRun) {
          if (disposeOld) {
            flipGoal(String(disposeOld.id), {
              status: disposeOld.to === "achieved" ? "achieved" : "superseded",
              supersededBy: disposeOld.to === "achieved" ? undefined : [id],
            });
          }
          if (Array.isArray(supersedes)) {
            for (const oldId of supersedes) flipGoal(String(oldId), { status: "superseded", supersededBy: [id] });
          }
        }
        const remainingActive = activeGoals().filter((p) => String(p.id) !== id && !disposedIds.has(String(p.id)));
        if (remainingActive.length >= cap) {
          throw new Error(
            `cannot activate ${id}: active GOAL count would exceed cap ${cap} — currently active: ${remainingActive
              .map((p) => String(p.id))
              .join(", ")} (dispose one via disposeOld {id, to} or supersedes:[id])`
          );
        }
      }

      // evidence is ledger-DERIVED, never stored (gap-goal-evidence-cache-should-not-enter-git):
      // strip any stale `evidence:` loaded from an existing file so a real write migrates it away.
      delete frontmatter.evidence;
      const ordered: GoalFrontmatter = {};
      for (const k of [
        "id", "title", "status", "kind", "goal", "criterion", "expect", "origin", "activatedAt", "statusLog",
        "labels", "posture", "supersedes", "superseded-by", "long-term", "fidelity",
      ]) {
        if (frontmatter[k] !== undefined) ordered[k] = frontmatter[k];
      }
      for (const k of Object.keys(frontmatter)) {
        if (!OWNED_KEYS.has(k)) ordered[k] = frontmatter[k];
      }
      // P9 dry-run: validate everything (incl. the activation gate) but persist NOTHING.
      if (dryRun) {
        return toViewModel(ordered, finalBody, ledgerEvidenceMap(goalDir));
      }
      const fileName = existingFile ?? `${id}-${slugify(title, "goal")}.md`;
      fs.writeFileSync(path.join(goalDir, fileName), serializeFrontmatter(ordered, finalBody), "utf8");
      if (commit) {
        // Action semantics (gap-store-commit-action-and-actor AC1): create / status flip / field
        // update are DISTINGUISHABLE in the commit subject — never the old fixed prose that made
        // create, criterion-edit, status-flip and the driver's mechanical flip all read identical.
        let action: string;
        if (!existingFile) {
          action = "create";
        } else if (statusChanged) {
          action = `status ${prevStatus}→${nextStatus}`;
        } else {
          const touched: string[] = [];
          if (title !== undefined) touched.push("title");
          if (goal !== undefined) touched.push("goal");
          if (criterion !== undefined) touched.push("criterion");
          if (expect !== undefined) touched.push("expect");
          if (origin !== undefined) touched.push("origin");
          if (supersedes !== undefined) touched.push("supersedes");
          if (supersededBy !== undefined) touched.push("superseded-by");
          if (body !== undefined) touched.push("body");
          action = touched.length > 0 ? `field:${touched.join(",")}` : "update";
        }
        const outcome = commitGoalFile(goalDir, fileName, id, action);
        if (outcome === "failed") {
          // The disk write succeeded but the git commit genuinely FAILED — surface on stderr so the
          // failure is observable, not silent (硬规则 3b). "unchanged"/"not-in-git" are expected no-ops.
          console.error(`goal-store: commit of "${id}" failed — the file was written to disk but is not on any branch's history`);
        }
      }
      return get(id) as GoalViewModel;
    });
  }

  /** BATCH (gap-store-commit-action-and-actor AC3): write N records and commit them in ONE git
   *  commit — one logical action must not produce N commits (the 16-commits-per-logical-action
   *  defect). Each record goes through the SAME `write()` validation/locking (commit deferred), then
   *  a single `commitStoreBatch` stages+commits all written files. ⛔ Not for records with
   *  `disposeOld` (a dispose flips a SECOND record's file and is committed by `flipGoal` itself). */
  function writeBatch(records: Array<{
    id: string;
    title?: string;
    status?: string;
    goal?: string;
    criterion?: string;
    expect?: string;
    origin?: string;
    supersedes?: string[];
    supersededBy?: string[];
    body?: string;
    force?: boolean;
    actor?: string;
    reason?: string;
  }>): GoalViewModel[] {
    const root = resolveGitRoot(goalDir);
    const results: GoalViewModel[] = [];
    const relPaths: string[] = [];
    for (const r of records) {
      const vm = write(r.id, {
        title: r.title, status: r.status, goal: r.goal, criterion: r.criterion,
        expect: r.expect, origin: r.origin, supersedes: r.supersedes,
        supersededBy: r.supersededBy, body: r.body, force: r.force,
        actor: r.actor, reason: r.reason, commit: false,
      });
      results.push(vm);
      const f = fileNameForId(goalDir, r.id);
      if (f) relPaths.push(root ? path.relative(root, path.join(goalDir, f)) : `goals/${f}`);
    }
    const outcome = commitStoreBatch({
      relPaths,
      kind: "goals",
      id: records.map((r) => r.id).join(" "),
      action: "batch",
      root,
    });
    if (outcome === "failed") {
      console.error(`goal-store: batch commit of ${records.length} record(s) failed — files written to disk but not on any branch's history`);
    }
    return results;
  }

  return { list, get, write, writeBatch, activeGoals, listActiveCriteria, isGoalAchieved, checkWithinCap, checkStaleness, checkAchievedFailing };
}

// ── Direct-invocation entry (Contract invoke: `node packages/quay/src/goal-store.ts`) ──────────────
// Subcommands (workspace root auto-derived from the script location, or --root <dir>):
//   list                      — list all goal records (GOAL + AC) as JSON
//   get <id>                  — one record as JSON
//   write <id> [--title ...] [--status ...] [--goal ...] [--criterion ...] [--expect ...]
//              [--origin ...] [--body ...] [--actor ...] [--reason ...] [--force] [--dry-run]
//              [--expect-absent] [--expect-existing] [--fidelity-judge-argv '<json argv array>']
//              (--expect-absent = create intent, refuse if it exists; --expect-existing =
//              update intent, refuse if absent — the goal store's expectedStatus-CAS counterpart)
//   batch --json '<array>'  — write N records in ONE commit (each: id + the write fields)
//              (`--origin` is REQUIRED on create, OPTIONAL on update — patch semantics keep the
//              stored value; `--dry-run` validates without persisting; `--force` skips the
//              activation gate)
//   gate <id> [--dry-run]     — run the record's `criterion` via the acceptance runner and append
//                               one GateEvent (verdict+timestamp) to <root>/.quay/gate-events.jsonl
//                               (--dry-run runs the criterion but appends nothing);
//                               empty criterion fails CLOSED (red) and still records the event.
//   check                     — I1′ checker: withinCap + hasDirection (exit 1 when over cap)
//   check --staleness         — I3 three-bucket staleness (fresh/stale/notEvaluated) + I4
//                               divergence (exit 1 when a divergent goal exists). PURE-READ.
//                               Carries scopeSize + evaluated (0 active goal ⇒ evaluated:false).
//   check --achieved-failing  — I5 achieved-but-failing (exit 1 when an achieved-but-failing AC
//                               exists OR the scope is empty — evaluated:false; runs each achieved
//                               AC's criterion under a re-entrancy guard). Carries scopeSize.
import { fileURLToPath } from "node:url";

/** 保真性判定器 spawnSync 的 wall-clock 上限（毫秒）。单次一锤 LLM 判定（criterion + expect 已内嵌，
 *  ⛔ 无需工具调用）——成本结构与 goal-driver 的 SUFFICIENCY_TIMEOUT_MS（180_000）同族，故取同值。
 *  超时 ⇒ spawnSync 返回 status=null ⇒ exitCode=null ⇒ parseFidelityVerdict ⇒ not-evaluated ⇒
 *  拒绝激活（fail-closed，⛔ 不回落 faithful）。 */
const FIDELITY_JUDGE_TIMEOUT_MS = 180_000;

/** 从 argv 前缀构造同步判定器 seam（prompt 作末参数追加——同 goal-driver `sufficiencyCmd` 的约定）。
 *  ⛔ Core 无进程责任：这里只是「把 argv 跑起来」，argv 本身由调用方（env var / `--fidelity-judge-argv`
 *  旗标）供给，Core 永不 import plugin/* 去构造真 LLM argv。 */
function judgeFromArgv(judgeArgv: string[]): FidelityInvokeJudge {
  return (prompt: string) => {
    const r = spawnSync(judgeArgv[0], [...judgeArgv.slice(1), prompt], {
      encoding: "utf8",
      timeout: FIDELITY_JUDGE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout: typeof r.stdout === "string" ? r.stdout : null, exitCode: r.status ?? null };
  };
}

// ── 缺省 wiring：从【配置】读判定器 argv 前缀（gap-fidelity-gate-not-wired-on-the-dominant-cli-activation-path）──
// 实测：20/21 次 AC 激活走人/CLI 路径，而保真性闸此前【只】接在 goal-driver ⑧（1/21）那条路径上
// （goal-driver.ts:211 只在 ⑧ 激活时传 --fidelity-judge-argv）。CLI 缺省（无 QUAY_GOAL_FIDELITY_JUDGE env、
// 无 --fidelity-judge-argv）⇒ fidelityJudge undefined ⇒ fails-open 记 "no judge configured"。⇒ 闸在承载
// 95% 激活的路径上完全不跑。修法：CLI 缺省从【配置】读判定器 argv 前缀——⛔ 不 import plugin/*
// （launchArgv 住在 plugin/scripts/driver-runtime.ts，Core 依赖 kernel 正是 GOAL-012 要除的），只读两份
// 配置：
//   .quay/profiles.yml              — fix-worker role → launcher/model/bare/name + env/unset
//   .claude/launch.settings.json    — settings env（dev-tree 优先，plugin 出厂 fallback）
// 产物与 launchArgv("fix-worker", "", root).slice(0, -1) 同构（真 LLM argv 前缀，prompt 作末参数追加）。
// 配置缺失/非法/role 缺 ⇒ null ⇒ 调用方落回 "no judge configured" 可见性分支（fail-open + 诚实留痕，
// ⛔ 不回落 faithful）。判据 cost：只构造 argv、不 spawn（本函数不调 LLM；LLM 只在 write() 激活钩子被
// spawnSync 触发，⛔ 不在 goal-driver 每轮 ~42s 的 gate 路径）。

/** env 合并（复刻 profile-policy mergeEnv：override 中 "" = 删键，其余含 "0" 保留）。 */
function mergeProfileEnv(base: Record<string, string>, override: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === "") delete out[k];
    else out[k] = v;
  }
  return out;
}

/** 读 .quay/profiles.yml → 顶层对象；缺失/非法 ⇒ null（fail-closed，⛔ 不静默冒充空配置）。 */
function readProfilesYaml(root: string): Record<string, unknown> | null {
  const file = path.join(root, ".quay", "profiles.yml");
  if (!fs.existsSync(file)) return null;
  try {
    const doc = YAML.parse(fs.readFileSync(file, "utf8"));
    return doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 拼 --settings 参数（复刻 driver-runtime launchSettingsArg）：无 unset 且无 env ⇒ settings 文件路径；
 *  否则合并成 JSON。dev-tree `<root>/.claude/launch.settings.json` 优先，plugin 出厂 fallback。读不到 ⇒ null。 */
function fidelitySettingsArg(root: string, resolvedEnv: Record<string, string>, unset: string[]): string | null {
  const devTree = path.join(root, ".claude", "launch.settings.json");
  let settingsFile: string | null = null;
  if (fs.existsSync(devTree)) {
    settingsFile = devTree;
  } else {
    const pluginRoot = resolvePluginRoot();
    if (pluginRoot) {
      const shipped = path.join(pluginRoot, ".claude", "launch.settings.json");
      if (fs.existsSync(shipped)) settingsFile = shipped;
    }
  }
  if (!settingsFile) return null;
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  } catch {
    return null;
  }
  const baseEnv = (settings.env && typeof settings.env === "object" ? settings.env : {}) as Record<string, string>;
  const env = { ...baseEnv };
  for (const k of unset) delete env[k];
  Object.assign(env, resolvedEnv);
  const needsJson = unset.length > 0 || Object.keys(resolvedEnv).length > 0;
  return needsJson ? JSON.stringify({ ...settings, env }) : settingsFile;
}

/**
 * 缺省配置下的保真性判定器 argv 前缀（CLI 激活路径的缺省 wiring）。与
 * launchArgv("fix-worker", "", root).slice(0, -1) 同构。⛔ 只读配置、不 import plugin/*。
 * 返回 null ⇒ 配置缺失/非法/role 缺 ⇒ 调用方落回 "no judge configured"（既有可见性分支）。
 */
export function resolveFidelityJudgeArgvFromConfig(root: string): string[] | null {
  const profiles = readProfilesYaml(root);
  if (!profiles) return null;
  const roles = (profiles.roles ?? {}) as Record<string, Record<string, unknown>>;
  const profileMap = (profiles.profiles ?? {}) as Record<string, Record<string, unknown>>;
  const role = roles["fix-worker"];
  if (!role || typeof role !== "object") return null;
  const profileName = typeof role.profile === "string" ? role.profile : "worker-default";
  const profile = profileMap[profileName];
  if (!profile || typeof profile !== "object") return null;

  const launcher = profile.launcher ?? role.launcher;
  if (typeof launcher !== "string" || launcher === "") return null;
  const model = role.model !== undefined ? role.model : profile.model;
  const bare = role.bare !== undefined ? role.bare === true : profile.bare === true;
  const name = typeof role.name === "string" && role.name !== "" ? role.name : "quay-fix-worker";

  const baseEnv = (profile.env && typeof profile.env === "object" ? profile.env : {}) as Record<string, string>;
  const roleEnv = (role.env && typeof role.env === "object" ? role.env : {}) as Record<string, string>;
  const env = mergeProfileEnv(baseEnv, roleEnv);
  const unset = [
    ...(Array.isArray(profile.unset) ? profile.unset.map(String) : []),
    ...(Array.isArray(role.unset) ? role.unset.map(String) : []),
  ];
  for (const k of unset) delete env[k];

  const settingsArg = fidelitySettingsArg(root, env, unset);
  if (settingsArg === null) return null;

  const argv = [launcher, "--settings", settingsArg];
  if (profiles.excludeDynamicSystemPromptSections === true) argv.push("--exclude-dynamic-system-prompt-sections");
  if (profiles.promptSuggestions === false) argv.push("--prompt-suggestions", "false");
  if (typeof model === "string" && model !== "") argv.push("--model", model);
  if (bare === true) argv.push("--bare");
  argv.push("-n", name, "-p");
  return argv;
}

async function main(argv: string[]) {
  const args = argv.slice(2);
  const rootFlagIdx = args.indexOf("--root");
  let root: string | null = null;
  if (rootFlagIdx >= 0) {
    root = args[rootFlagIdx + 1] ?? null;
    args.splice(rootFlagIdx, 2);
  }
  // Find the workspace root: walk up from this module until a .git is found; fall back to cwd.
  if (!root) {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
      if (fs.existsSync(path.join(dir, ".git"))) { root = dir; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  root = root ?? process.cwd();
  const goalDir = path.join(root, "goals");
  const logPath = path.join(root, ".quay", "gate-events.jsonl");
  const goalCfg = readGoalConfig(root);
  // GOAL-013 fidelity-judge seam (`QUAY_GOAL_FIDELITY_JUDGE`): the CLI does NOT spawn an LLM itself
  // (Core carries no process responsibility — criterion-fidelity.ts is pure). When this env var
  // names a judge command PREFIX, the CLI builds a synchronous spawnSync seam (the prompt is appended
  // as the LAST argv element — the same convention as goal-driver's `sufficiencyCmd` array). Unset ⇒
  // fidelityJudge undefined ⇒ the pre-GOAL-013 activation path proceeds but the record carries a
  // distinguishable `not-evaluated / "no judge configured"` value (visibility, hard rule 3b).
  // ⛔ The value is a whitespace-split argv prefix (⛔ no shell metacharacters / quotes), matching
  // driver-runtime.splitArgs semantics — a real LLM prefix ends in `-p` so the prompt lands as its
  // one argv element; a test prefix is e.g. `node -e <js-without-spaces>`.
  // The per-write `--fidelity-judge-argv <json-array>` flag is the ROBUST form (a full argv array as
  // JSON — carries `--settings <json>` with spaces, which the whitespace-split env form cannot) and
  // is what goal-driver's production activation path uses (⛔ Core never imports plugin/* to build it).
  let fidelityJudge: FidelityInvokeJudge | undefined;
  const judgeCmd = process.env.QUAY_GOAL_FIDELITY_JUDGE;
  if (judgeCmd && judgeCmd.trim() !== "") {
    fidelityJudge = judgeFromArgv(judgeCmd.trim().split(/\s+/));
  } else {
    // 缺省 wiring（gap-fidelity-gate-not-wired-on-the-dominant-cli-activation-path）：无 env seam 时从配置
    // 读判定器 argv 前缀——人/CLI 激活路径（承载 20/21 激活）不再惰性。配置缺失/非法 ⇒ null ⇒ 落回
    // "no judge configured" 可见性分支（fail-open + 诚实留痕，⛔ 不回落 faithful）。
    const cfgArgv = resolveFidelityJudgeArgvFromConfig(root);
    if (cfgArgv) fidelityJudge = judgeFromArgv(cfgArgv);
  }
  const store = createGoalStore(goalDir, { cap: goalCfg.cap, staleMs: goalCfg.staleMs, fidelityJudge });

  const [sub, ...rest] = args;
  switch (sub) {
    case "list": {
      const filter: GoalFilter = {};
      const fi = rest.indexOf("--status");
      if (fi >= 0) filter.status = rest[fi + 1];
      process.stdout.write(JSON.stringify(store.list(filter), null, 2) + "\n");
      return 0;
    }
    case "get": {
      if (rest.length === 0) { console.error("goal-store: get requires <id>"); return 2; }
      const rec = store.get(rest[0]);
      if (!rec) { console.error(`goal-store: no such goal: ${rest[0]}`); return 1; }
      process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
      return 0;
    }
    case "write": {
      const id = rest[0];
      if (!id) { console.error("goal-store: write requires <id>"); return 2; }
      const opts: Record<string, unknown> = {};
      let force = false;
      let dryRun = false;
      let intent: "absent" | "existing" | undefined;
      let fidelityJudgeArgv: string[] | undefined;
      for (let i = 1; i < rest.length; i++) {
        const k = rest[i];
        if (!k.startsWith("--")) continue;
        const key = k.slice(2);
        if (key === "force") { force = true; continue; }
        if (key === "dry-run") { dryRun = true; continue; }
        if (key === "expect-absent") { intent = "absent"; continue; }
        if (key === "expect-existing") { intent = "existing"; continue; }
        if (key === "fidelity-judge-argv") {
          // Robust per-write judge seam (JSON argv array): carries `--settings <json>` (with spaces),
          // which the whitespace-split env var cannot. The prompt is appended as the LAST argv element.
          const raw = rest[i + 1];
          if (raw === undefined) { console.error("goal-store: --fidelity-judge-argv requires a JSON argv array"); return 2; }
          let parsed: unknown;
          try { parsed = JSON.parse(raw); } catch {
            console.error("goal-store: --fidelity-judge-argv is not valid JSON"); return 2;
          }
          if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((x) => typeof x !== "string")) {
            console.error("goal-store: --fidelity-judge-argv must be a non-empty JSON array of strings"); return 2;
          }
          fidelityJudgeArgv = parsed as string[];
          i++;
          continue;
        }
        const v = rest[i + 1];
        if (key === "title" || key === "status" || key === "goal" || key === "criterion" ||
            key === "expect" || key === "origin" || key === "body" || key === "superseded-by" ||
            key === "dispose-old" || key === "dispose-to" || key === "actor" || key === "reason") {
          opts[key] = v;
          i++;
        } else {
          console.error(`goal-store: unknown write flag: ${k}`); return 2;
        }
      }
      let disposeOld: DisposeOld | undefined;
      if (opts["dispose-old"] !== undefined) {
        const to = opts["dispose-to"] === "achieved" ? "achieved" as const
          : opts["dispose-to"] === "superseded" ? "superseded" as const : null;
        if (!to) {
          console.error("goal-store: --dispose-old requires --dispose-to achieved|superseded");
          return 2;
        }
        disposeOld = { id: String(opts["dispose-old"]), to };
      }
      try {
        const rec = store.write(id, {
          title: opts.title as string | undefined,
          status: opts.status as string | undefined,
          goal: opts.goal as string | undefined,
          criterion: opts.criterion as string | undefined,
          expect: opts.expect as string | undefined,
          // P1: `origin` is optional on update (patch semantics — omitting it keeps the stored
          // value). Create still requires it — enforced by write()'s origin check, not here.
          origin: opts.origin as string | undefined,
          body: opts.body as string | undefined,
          supersededBy: Array.isArray(opts["superseded-by"])
            ? opts["superseded-by"] as string[]
            : (typeof opts["superseded-by"] === "string" ? [opts["superseded-by"] as string] : undefined),
          disposeOld,
          force,
          actor: opts.actor as string | undefined,
          reason: opts.reason as string | undefined,
          dryRun,
          intent,
          // Per-write judge seam (the `--fidelity-judge-argv` flag). undefined ⇒ fall back to the
          // store-level judge (from QUAY_GOAL_FIDELITY_JUDGE), or to the "no judge configured"
          // visibility branch when neither is present.
          fidelityJudge: fidelityJudgeArgv ? judgeFromArgv(fidelityJudgeArgv) : undefined,
        });
        process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
        return 0;
      } catch (err) {
        console.error(`goal-store: write failed: ${(err as Error).message}`);
        return 2;
      }
    }
    case "batch": {
      // `node goal-store.ts batch --json '[{...}, {...}]'` — write N records in ONE commit
      // (gap-store-commit-action-and-actor AC3). Records share the `write` shape: `id` + the write
      // fields (title/status/goal/criterion/expect/origin/body/actor/reason/force).
      const ji = rest.indexOf("--json");
      if (ji < 0) { console.error("goal-store: batch requires --json <array-of-records>"); return 2; }
      const raw = rest[ji + 1];
      if (raw === undefined) { console.error("goal-store: batch --json missing value"); return 2; }
      let records: unknown;
      try { records = JSON.parse(raw); } catch {
        console.error("goal-store: batch --json is not valid JSON"); return 2;
      }
      if (!Array.isArray(records)) { console.error("goal-store: batch --json must be a JSON array"); return 2; }
      try {
        const results = store.writeBatch(records.map((r) => {
          const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
          return {
            id: String(o.id ?? ""),
            title: o.title as string | undefined,
            status: o.status as string | undefined,
            goal: o.goal as string | undefined,
            criterion: o.criterion as string | undefined,
            expect: o.expect as string | undefined,
            origin: o.origin as string | undefined,
            body: o.body as string | undefined,
            force: o.force === true,
            actor: o.actor as string | undefined,
            reason: o.reason as string | undefined,
          };
        }));
        process.stdout.write(JSON.stringify(results, null, 2) + "\n");
        return 0;
      } catch (err) {
        console.error(`goal-store: batch failed: ${(err as Error).message}`);
        return 2;
      }
    }
    case "gate": {
      const id = rest[0];
      if (!id) { console.error("goal-store: gate requires <id>"); return 2; }
      const dryRun = rest.includes("--dry-run");
      // Criterion execution REUSES the task acceptance-runner shape (SPEC §3) and the gate
      // ledger REUSES the existing GateEvent format (.quay/gate-events.jsonl).
      // (`runAcceptance` is a static import at the top — also used by checkAchievedFailing's I5 bucket.)
      const { appendGateEvent } = await import("./gate/gate-event-store.ts");
      const rec = store.get(id);
      if (!rec) { console.error(`goal-store: no such goal: ${id}`); return 2; }
      const criterion = rec.criterion;
      let verdict: string;
      let reason: string;
      if (typeof criterion !== "string" || criterion.trim() === "") {
        // AC2 — empty criterion FAILS CLOSED (red), never a silent PASS.
        verdict = "fail";
        reason = `${id} has no criterion defined (fail-closed — an unenforceable AC must never silently pass)`;
      } else {
        const result = runAcceptance({ command: criterion, cwd: root, timeoutMs: 60000 });
        verdict = result.ok ? "pass" : "fail";
        reason = result.reason;
      }
      const event = {
        id: randomUUID(),
        item_id: id,
        pipeline_id: id,
        gate: "goal",
        actor: "goal-cli",
        verdict,
        timestamp: new Date().toISOString(),
        payload: { reason },
      };
      // P9 dry-run: run the criterion but do NOT append the gate event (persist nothing).
      if (!dryRun) appendGateEvent(logPath, event);
      // ⛔ NO evidence write-back: `evidence` is ledger-DERIVED, never stored
      // (gap-goal-evidence-cache-should-not-enter-git). The ledger event just appended IS the
      // evidence — writing it into goals/*.md would re-couple the ~42s gate cadence to the tracked
      // file and let a stale reading travel via git (the exact defect this task removes).
      const out = { id, verdict, reason, timestamp: event.timestamp, dryRun, event };
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      return verdict === "pass" ? 0 : 1;
    }
    case "check": {
      if (rest.includes("--achieved-failing")) {
        const r = store.checkAchievedFailing();
        process.stdout.write(JSON.stringify(r, null, 2) + "\n");
        return r.achievedButFailing.length === 0 && r.evaluated ? 0 : 1;
      }
      if (rest.includes("--staleness")) {
        const r = store.checkStaleness();
        process.stdout.write(JSON.stringify(r, null, 2) + "\n");
        return r.divergent.length === 0 ? 0 : 1;
      }
      const r = store.checkWithinCap();
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
      return r.withinCap ? 0 : 1;
    }
    default: {
      console.error(
        `goal-store: unknown subcommand ${JSON.stringify(sub)} — expected list|get|write|batch|gate|check`
      );
      return 2;
    }
  }
}

// Direct-invocation guard: this module is BOTH a library (imported by serve-handlers / the gate
// registry — which BUNDLE it into dist/quay.js) and the Contract's CLI entry (`node
// packages/quay/src/goal-store.ts`). The guard must survive the bundle: full-path equality with
// import.meta.url fails there (in a bundle every module shares the bundle's URL, so a bundled
// library module would self-identify as main and run its CLI on every `quay` invocation). The
// `.endsWith("goal-store.ts")` form matches the source path when invoked directly and is false for
// the bundle — the same pattern every plugin/scripts dual library+CLI module uses.
const isMain =
  process.argv[1] != null && process.argv[1].endsWith("goal-store.ts");
if (isMain) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
