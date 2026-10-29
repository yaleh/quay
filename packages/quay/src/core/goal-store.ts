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
  makeAssertSafeStatus,
  makeAssertSafeId,
  installLockReleaseOnSignal,
} from "./frontmatter-store-base.ts";
import {
  runAcceptance,
  verdictFromAcceptance,
  FAILURE_REASON_MAX_CHARS,
} from "./acceptance-runner.ts";
// The record-aware deadline resolver family lives in the kernel leaf, beside `resolveAcceptanceTimeoutMs`
// — the single home of the whole "acceptance timeout resolution" family (gap-ac353-goal-store-deadline-
// resolver-not-kernel; it was briefly split into the acceptance runner (now `core/acceptance-runner.ts`), which broke the structural
// guard that this file consumes the kernel). ⛔ Not re-exported through the runner.
import { resolveAcceptanceTimeout, timeoutKnobHint } from "../kernel/gate-run-options.ts";
// gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout: EVERY criterion this file
// runs takes its kill deadline from the SAME resolved chain — ⛔ not a private literal, and ⛔ not
// `resolveRunnerOptions` (the latter also resolves a cwd, preferring `QUAY_ACCEPTANCE_CWD`; a goal
// criterion's cwd is the git root by design, so taking the whole options object would silently
// relocate every criterion the moment that variable was set).
//
// ⛔ `resolveAcceptanceTimeout` (imported above from `./kernel/gate-run-options.ts`, its single home)
// is the RECORD-aware resolver EVERY goal criterion path now uses (goal gate, the P6 activation gate,
// the I5 sweep, the frozen rotation): `resolveAcceptanceTimeoutMs`'s
// env/default chain with the record's own `timeoutMs` in front of it, honoured WITHOUT a second
// default literal (gap-goal-gate-verdict-single-mapping-not-evaluated AC4;
// gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks made the
// two former `resolveAcceptanceTimeoutMs()` sites — activation + rotation — record-aware too, so the
// driver path and the CLI path share ONE precedence ladder).
import { commitKindFile, commitStoreBatch, resolveGitRoot } from "./store-commit.ts";
import { criterionFidelityVerdict, type FidelityInvokeJudge } from "./criterion-fidelity.ts";
// The criterion CAPABILITY judge (gap-criterion-side-effect-unguarded-at-write-and-execution-surface):
// the THIRD activation/execution question, after evaluability (P6) and fidelity. "Can this criterion
// RUN?" and "can it be FALSE?" do not ask "is it a READING or an ACTION?" — and on the unattended
// re-run paths (I5, the frozen rotation) an ACTION is an open-ended writer, not a check.
import { capabilityRefusalAt, capabilityRefusalReason } from "./criterion-capability.ts";
import { resolvePluginRoot } from "./plugin-root.ts";
import { GOAL_STATUSES } from "./types.ts";
import { mergeEnv } from "../kernel/env-merge.ts";
// Goal-branch lifecycle (SPEC-goal-branch-2026-10-03.md §4.1/§4.2). The store is the ONE caller of
// each primitive: a goal's status flip is the only event that creates (§4.2: lazy, on `active`) or
// discards (§4.2: `retired`/`superseded`) `goal/<id>`.
import { ensureGoalBranch, discardGoalBranch, goalBranchName, goalBranchRefExists, goalBranchTip } from "./branch-model.ts";
// The TWO concerns extracted from this module (tasks/gap-routine-architecture-analysis-god-module-goal-store):
// the goal-staleness carrier (leaf: one JSONL file) and the criterion failure-attribution predicate
// (leaf: a pure function over a criterion string). This file keeps the store + CLI surface; its own
// call sites are `write()` (record the signal / refuse an unattributable criterion) and the CLI's
// staleness reporting. The public surface is re-exported at the sections the code used to live in,
// so every historical importer is unchanged.
import { appendGoalStalenessSignal, resolveGoalStaleness } from "./goal-staleness.ts";
import { evaluateCriterionAttribution, formatBareFailureExits } from "./criterion-attribution.ts";
// Symbols the store's OWN remaining code still names (the CLI's verb bodies + write()'s dry-run
// projection). ⛔ Re-exported separately below — an `export … from` creates no local binding, so
// these are the ones this file actually USES.
import { GOAL_ID_RE, AC_ID_RE } from "./goal-store-types.ts";
import { SWEEP_ACTOR, ledgerEvidenceMap } from "./goal-store-ledger.ts";
import {
  buildCriterionRoots,
  criterionCwdFor,
  evaluationContext,
} from "./goal-store-criterion-address.ts";
import {
  DEFAULT_SWEEP_BUDGET,
  DEFAULT_SWEEP_MIN_AGE_MS,
  DEFAULT_SWEEP_WALL_MS,
} from "./goal-store-rotation.ts";

import { createGoalReads } from "./goal-store-reads.ts";
import { createGoalChecks } from "./goal-store-checks.ts";
import { createGoalRotation } from "./goal-store-rotation.ts";
import { createGoalSweep } from "./goal-store-sweep.ts";
// The record shapes + id vocabulary, shared with every composed module. ⛔ Not re-declared here:
// one shape per record, or the projections drift apart (hard rule 5b).
import {
  VALID_CRITERION_PHASES,
  isGoalId,
  isCriterionId,
  type GoalFilter,
  type GoalFrontmatter,
  type GoalViewModel,
} from "./goal-store-types.ts";


// ADR-036 (枚举事实的单一真源): the goal-status vocabulary is DEFINED ONCE, in the ABI declaration
// (`abi.ts:GOAL_STATUSES`), and this store derives from it — ⛔ not a second hand-copied literal.
// Kept as an independent exported array (not a re-export alias) because it is the store's public
// validation surface consumed across packages (quay-native imports it); `string[]` (not readonly)
// preserves the previous type for those consumers.
export const VALID_GOAL_STATUSES: string[] = [...GOAL_STATUSES];

// gap-goal-record-completeness-undefined — "what counts as a COMPLETE goal record" was never
// defined: `origin` was required while `body` was optional, inverting the incentive (8 goals, 5
// with empty body — the prose all crammed into `origin`). A GOAL's substance (background / scope
// & non-goals / exit conditions) lives in its `body`; `origin` is only a provenance citation.
// Mirrors the task side's MIN_SECTION_CHARS = 40 (ready-pool-check.ts). Exported so the falsifiability
// test asserts the SAME threshold the store enforces (never a second, divergent literal).
export const MIN_GOAL_BODY_CHARS = 40;

// ── the OUTER bound a driver must impose on a goal-store CHILD ───────────────────────────────────
// (tasks/gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks)
//
// The goal/meta drivers spawn `quay goal gate|write` as child processes and put a wall-clock
// SIGKILL on each. That outer bound MUST exceed the deadline the CHILD itself will honour, or the
// driver pre-empts the very record `timeoutMs` the store resolves — measured on four host projects
// (104 SIGKILLs) where every declared `timeoutMs` ≥ 120000 was killed at the driver's hard-coded
// 120 s literal and recorded as the opaque `gate spawn error: spawn timeout after 120000ms`.
//
// The inner deadline is the SAME chain `goal gate` uses (`resolveAcceptanceTimeout`: record
// `timeoutMs` > QUAY_ACCEPTANCE_TIMEOUT_MS > DEFAULT_ACCEPTANCE_TIMEOUT_MS). The outer bound is
// `inner + [fidelity judge] + grace` — never a literal that can sit below `inner`.

/** Milliseconds of GRACE a driver adds on top of a goal-store child's own inner deadline. Strictly
 *  positive ⇒ the driver's bound is strictly greater than the inner one BY CONSTRUCTION (hard rule 4:
 *  a bound that could silently sit below the thing it wraps is not a bound). It is SLACK FOR A
 *  CEILING, not a performance threshold: after the child's own deadline fires it must still write its
 *  verdict to the ledger, release its lock and exit; the driver's watchdog is the last resort and
 *  being late here costs nothing but the true-hang case. */
export const GOAL_DRIVER_SPAWN_GRACE_MS = 15_000;

/** Milliseconds a driver waits after SIGTERM (sent to a goal-store child at the OUTER deadline) before
 *  escalating to SIGKILL. Long enough for a child that is NOT blocked in a synchronous spawn to run its
 *  `installLockReleaseOnSignal` handler and exit; short enough that the mandatory SIGKILL is not
 *  meaningfully delayed. ⛔ A child blocked in the criterion's `spawnSync` defers the handler, so this
 *  grace does not save its lock — the DRIVER's pid-matched removal does (goal-driver.ts). */
export const GOAL_STORE_SIGTERM_GRACE_MS = 2_000;

/**
 * The wall-clock bound a DRIVER must impose on a goal-store CHILD process, derived from the child's
 * OWN inner deadline — never a literal that can sit below it.
 *
 * `kind`:
 *   "gate"       — `goal gate <id>`: the child runs only the criterion. Bound = inner + grace.
 *   "activation" — `goal write <id> --status active`: the child runs the criterion AND (P6b) the
 *                  fidelity judge, whose own bound is `FIDELITY_JUDGE_TIMEOUT_MS`. Bound =
 *                  inner + judge + grace. A timeout in the criterion does NOT skip the judge, so the
 *                  two add (see write()'s P6/P6b).
 *
 * `env` defaults to `process.env` — the driver and its child share an environment, so the chain
 * resolves to the same inner value on both sides.
 */
export function goalDriverChildTimeoutMs(
  recordTimeoutMs: unknown,
  kind: "gate" | "activation",
  env: NodeJS.ProcessEnv = process.env,
): number {
  const inner = resolveAcceptanceTimeout(recordTimeoutMs, env);
  const judgeBound = kind === "activation" ? FIDELITY_JUDGE_TIMEOUT_MS : 0;
  return inner.timeoutMs + judgeBound + GOAL_DRIVER_SPAWN_GRACE_MS;
}


// ── COMPOSITION SURFACE (tasks/gap-routine-architecture-analysis-god-function-creategoalstore) ────
// `createGoalStore` was ONE 1,647-line closure factory nesting 20 declarations (archguard
// `god-function` finding, routine `architecture-analysis`, runId
// `architecture-analysis-1793251760204`). Its sub-surfaces now live in composed modules over the
// SAME `goalDir` — so there is still exactly ONE derivation of every judgment (the closures moved;
// they did not multiply):
//   · ./goal-store-reads.ts             — projection: get / list / listWithMalformed / activeGoals /
//                                         listActiveCriteria / isGoalAchieved
//   · ./goal-store-checks.ts            — I3/I4 staleness, I5 achieved-but-failing, reverify scope
//   · ./goal-store-rotation.ts          — the frozen population + the `--stale-pass` JUDGMENT
//   · ./goal-store-sweep.ts             — the bounded rotation STEP (the only criterion-running half)
//   · ./goal-store-ledger.ts            — the bounded gate-ledger scan the two above both read
//   · ./goal-store-criterion-address.ts — WHICH TREE a criterion runs on
//   · ./goal-store-types.ts             — the record shapes + id vocabulary they all share
// ⛔ Every public symbol is RE-EXPORTED below, so no historical importer (tests, quay-native,
// plugin/scripts) changes its import path.

export {
  SWEEP_ACTOR,
  AMEND_ACTOR,
} from "./goal-store-ledger.ts";
export {
  FROZEN_POPULATION_FLAG,
  readsFrozenPopulation,
  criterionFingerprint,
  DEFAULT_SWEEP_MIN_AGE_MS,
  DEFAULT_SWEEP_BUDGET,
  DEFAULT_SWEEP_WALL_MS,
  DEFAULT_FAIL_RECHECK_DIVISOR,
  DEFAULT_STALE_PASS_MAX_AGE_MS,
  type StalePassReading,
} from "./goal-store-rotation.ts";
export {
  GOAL_ACCEPTANCE_ACTIVE_ENV,
  inAchievedReverifyScope,
} from "./goal-store-checks.ts";
export {
  GOAL_CRITERION_WORKTREE_PREFIX,
  goalCriterionWorktreeDir,
  gitTreeSha,
  evaluationContext,
  realpathOrSelf,
  resolveCriterionRoot,
  buildCriterionRoots,
  criterionCwdFor,
  type CriterionRootSource,
  type CriterionRoot,
} from "./goal-store-criterion-address.ts";
export {
  VALID_CRITERION_PHASES,
  isGoalId,
  isCriterionId,
  type CriterionPhase,
  type ReverifyScopeEntry,
} from "./goal-store-types.ts";
// Frontmatter keys the view-model owns explicitly; everything else in the frontmatter
// (any future field) is preserved verbatim — the same discipline as adr-store/document-store.
const OWNED_KEYS = new Set([
  "id", "title", "status", "kind", "goal", "criterion", "expect", "origin", "activatedAt", "statusLog",
  "labels", "posture", "supersedes", "superseded-by", "long-term", "fidelity", "timeoutMs",
  // SPEC-goal-branch §4.1 — the opt-in isolation gate. The branch NAME is derived (`goal/<id>`),
  // ⛔ never a stored field: storing it would make "which branch does this goal land on" a
  // human-writable arbitrary string, which is exactly what §4.8's identity rule forbids.
  "branch",
  // SPEC-goal-branch §4.7 (裁定⑭⑮) — an AC's evaluation phase. Declared, never inferred from the
  // criterion's text (hard rule 2); projected as `pre-merge` when absent.
  "phase",
]);
// ── goal-staleness signal (gap-goal-status-stale-achieved-after-new-active-criterion-filed) ──────
// MOVED to `./goal-staleness.ts` (tasks/gap-routine-architecture-analysis-god-module-goal-store):
// the append-only carrier and its three-state reader are a self-contained leaf over one JSONL file.
// This store keeps the ONE call site (`write()` records the signal inside the SAME file lock as the
// record write) and forwards the public surface below, so external importers — including
// `packages/quay/test/*` and the CLI — keep their historical import path (⛔ a re-export, not a copy:
// hard rule 5b, one implementation).
export {
  GOAL_STALENESS_SIGNAL_REL,
  appendGoalStalenessSignal,
  resolveGoalStaleness,
  readGoalStaleness,
  type GoalStaleness,
  type GoalStalenessSignal,
} from "./goal-staleness.ts";

/** The owning GOAL's status AS STORED, or null when the record is absent / unreadable / carries no
 *  status. Read-only: ⛔ this never writes the GOAL's record (see `./goal-staleness.ts`'s section
 *  header — AC4). It STAYS here (⛔ did not move with the carrier): it reads THIS store's record
 *  files, and the carrier module stays a leaf with no record-store dependency. */
function goalStatusOf(goalDir: string, goalId: string): string | null {
  const file = fileNameForId(goalDir, goalId);
  if (!file) return null;
  try {
    const { frontmatter } = parseFrontmatter(fs.readFileSync(path.join(goalDir, file), "utf8"));
    return typeof frontmatter.status === "string" ? frontmatter.status : null;
  } catch {
    return null;
  }
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
export interface DisposeOld {
  /** the old active goal's id */
  id: string;
  /** what happens to it: "achieved" or "superseded" */
  to: "achieved" | "superseded";
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

// ── criterion failure attribution: a FORWARDING re-export of `./criterion-attribution.ts` ─────────
// The parsers and the ONE three-state predicate moved to `core/criterion-attribution.ts`
// (tasks/gap-routine-architecture-analysis-god-module-goal-store — they are a pure function over a
// string, used by the ratchet as well as by this store's write gate). ⛔ The identity is preserved:
// `plugin/scripts/criterion-failure-attribution-check.ts` re-exports the SAME bindings, so
// `checker.FAILURE_EXIT_RE === goalStore.FAILURE_EXIT_RE` still holds (hard rule 5b — one impl).
export {
  FAILURE_EXIT_RE,
  hasTrailingComputedFailureExit,
  hasFailureExit,
  splitTopLevelSegments,
  isSilentOnFailureSegment,
  statusBearingStatement,
  implicitFailureExitLines,
  errexitAbortSilentExits,
  maskHashComments,
  maskValueStrings,
  isBareFailureExitLine,
  bareFailureExitsOfCriterion,
  evaluateCriterionAttribution,
  formatBareFailureExits,
  type Segment,
  type BareLine,
  type CriterionAttributionVerdict,
} from "./criterion-attribution.ts";

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
 * Parse the ADJUDICATION TABLE (AC2) — the per-AC ruling 「一次性验收 / 常设不变式」, recorded as a
 * markdown table in the task body. ⛔ This is a DECLARATION and it is deliberately NOT derivable from
 * the store: the store can only report what the `long-term` FIELD currently is, while only the ruling
 * says what it OUGHT to be. That gap is the whole point of AC1/AC4 — a ruling that never landed as a
 * field is invisible on every carrier, and a rule whose observance cannot be distinguished from its
 * breach is not a rule (hard rule 9).
 *
 * Rows are `| AC-NNN | <ruling> | <reason> |`. Recognized rulings: `常设不变式` → standing,
 * `一次性验收` → one-time. Anything else is returned in `unrecognized`, ⛔ never silently dropped:
 * "could not evaluate" must not share an output shape with "evaluated and fine" (hard rule 3b).
 */
export function parseAdjudicationTable(text: string): {
  standing: string[];
  oneTime: string[];
  unrecognized: Array<{ id: string; ruling: string }>;
} {
  const standing: string[] = [];
  const oneTime: string[] = [];
  const unrecognized: Array<{ id: string; ruling: string }> = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim().replace(/`/g, ""));
    if (cells.length < 2) continue;
    // Header (`| AC | 裁定 | 理由 |`) and separator (`|---|---|---|`) rows are excluded BY SHAPE —
    // ⛔ not by skipping a line number, which would silently drop a row if the table moved.
    if (!/^AC-\d+$/.test(cells[0])) continue;
    if (cells[1] === "常设不变式") standing.push(cells[0]);
    else if (cells[1] === "一次性验收") oneTime.push(cells[0]);
    else unrecognized.push({ id: cells[0], ruling: cells[1] });
  }
  return { standing, oneTime, unrecognized };
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

  const assertSafeId = makeAssertSafeId(
    "goal",
    [GOAL_ID_RE, AC_ID_RE],
    "GOAL-NNN or AC-NNN (>=3 digits)"
  );

  const assertSafeStatus = makeAssertSafeStatus("goal", VALID_GOAL_STATUSES);

  // ── the execution-surface CAPABILITY gate (gap-criterion-side-effect-unguarded-at-write-and-execution-surface) ─
  // EVERY `runAcceptance` call in the goal store's composition goes through here first (there are
  // four across `goal-store.ts`, `goal-store-checks.ts` and `goal-store-sweep.ts`; the two UNATTENDED
  // ones — I5 `checkAchievedFailing` and the frozen rotation `sweepFrozen` — are the ones that turn a
  // side-effecting criterion into a permanent, unwatched writer). The gate is what makes
  // 「criterion 必须是读数」 a MECHANISM rather than a convention: a caller who has never heard of this
  // rule still cannot get a writing criterion executed, because the refusal happens BEFORE the spawn.
  //
  // ⛔ Failure is fail-closed and ORDERED (declared > uncertifiable): a criterion that is both is
  // reported as the declared capability, which is the stronger and more actionable statement. Both
  // refusals carry a stable `code`; callers branch on the code, never on the message.
  //
  // The DECLARATION is the workspace's (`<root>/.quay/criterion-capabilities.json`) — read from the
  // goal store's own parent, ⛔ never from the criterion's cwd, because a branch-mode criterion runs
  // on a worktree that need not carry the declaration. The ARTIFACTS, by contrast, resolve against
  // the criterion's cwd, which is the tree the command will actually run in.
  const workspaceRootForCapability = path.dirname(goalDir);

  // ── composed sub-surfaces (gap-routine-architecture-analysis-god-function-creategoalstore) ──────
  // ONE `goalDir`, ONE set of judgments — the factory composes, it no longer NESTS. `assertSafeId`
  // is the store's own id gate, so every reader validates ids exactly as `write` does.
  const { toViewModel, get, listWithMalformed, list, activeGoals, listActiveCriteria, isGoalAchieved } =
    createGoalReads(goalDir, assertSafeId);

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


  // ── composed sub-surfaces (gap-routine-architecture-analysis-god-function-creategoalstore) ──────
  // The three check surfaces take the SAME `goalDir`/`cap`/`staleMs` the factory resolved, and the
  // SAME read closures — so a judgment's scope can never be re-derived from a second listing.
  const { checkStaleness, checkAchievedFailing, checkReverifyScope } = createGoalChecks({
    goalDir, cap, staleMs, list, activeGoals, isGoalAchieved,
  });
  const { frozenAchievedAcs, checkStalePass } = createGoalRotation({ goalDir, list, activeGoals });
  // ⛔ The sweep takes the judgment's OWN `frozenAchievedAcs` — "what is frozen" has ONE definition
  // (hard rule 5b: a second derivation of the population is exactly the drift this split must not
  // introduce between the judgment and the thing that refreshes its tail).
  const { sweepFrozen } = createGoalSweep({ goalDir, list, frozenAchievedAcs });

  /** The ONE call site of `discardGoalBranch` (SPEC-goal-branch §4.2): delete a discarded goal's
   *  branch and surface a failed delete (硬规则 3b — a statusLog that claims a rescued tip must not
   *  coexist with a branch that is still there). `tipSha === null` (non-branch goal / already gone)
   *  is a normal no-op and deliberately does not log. */
  function discardGoalBranchNow(root: string, id: string): void {
    const del = discardGoalBranch(root, id);
    if (!del.removed && del.tipSha !== null) {
      console.error(`goal-store: ${id} was discarded but its branch was NOT deleted — ${del.detail}`);
    }
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
    // SPEC-goal-branch §4.2 — the supersedes/disposeOld path reaches `superseded` WITHOUT going
    // through write(), so it must record + discard here too, or a branch-mode goal disposed by a
    // successor would leave an orphan branch and an empty statusLog (the AC-326 defect shape).
    // Reads the tip BEFORE the deletion, exactly like write(); only fires when the goal is
    // branch-mode (⛔ no new statusLog entries for ordinary goals — this path never wrote one).
    const root = fm.branch === true ? resolveGitRoot(goalDir) : null;
    let discardTipSha: string | null = null;
    if (root !== null && (patch.status === "superseded" || patch.status === "retired")) {
      discardTipSha = goalBranchTip(root, oldId);
      if (discardTipSha !== null) {
        const prior = Array.isArray(fm.statusLog) ? fm.statusLog : [];
        fm.statusLog = [...prior, {
          at: new Date().toISOString(),
          from: prevStatus,
          to: patch.status,
          actor: "goal-store",
          reason: `discarded branch ${goalBranchName(oldId)} tip ${discardTipSha}`,
        }];
      }
    }
    fs.writeFileSync(p, serializeFrontmatter(fm, body), "utf8");
    // COMMIT-AFTER-WRITE (gap-meta-commitgoalfile; now via the shared wrapper `commitKindFile`):
    // the goal store is the SOURCE of goal writes, so the commit lives HERE. `propagate` defaults
    // "none" — a goal write rides the branch it lands on (a worktree write is carried into develop by
    // that task's fan-in ff). A NEW goal that must be pool-visible passes propagate "develop" (SPEC §2.2).
    const outcome = commitKindFile(goalDir, file, oldId, `status ${prevStatus}→${patch.status}`, "goals");
    if (outcome === "failed") {
      // The disk write succeeded but the git commit genuinely FAILED — never throw (the write IS on
      // disk), but surface on stderr so the failure is observable, not silent (硬规则 3b).
      // "unchanged"/"not-in-git" are expected no-ops and deliberately do NOT log.
      console.error(`goal-store: commit of "${oldId}" failed — the file was written to disk but is not on any branch's history`);
    }
    if (root !== null && discardTipSha !== null) discardGoalBranchNow(root, oldId);
  }

  function write(id: string, {
    title, status, goal, criterion, expect, origin,
    supersedes, supersededBy, body, disposeOld, longTerm, branch, phase,
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
    /** AC-216 declarative `long-term: true` — a machine write path for the field that until now could
     *  only be added by hand-editing `goals/*.md` frontmatter (AC-188/189/190, commit a1cae4de0).
     *  An achieved AC carrying it stays in the I5 reverify scope after its GOAL is achieved/closed.
     *  ⛔ It is a DECLARATION, not a verdict: it never changes what the criterion returns, only
     *  whether the AC leaves the reverify scope with its GOAL. `undefined` ⇒ patch semantics
     *  (keep the stored value); `false` ⇒ explicitly clear it. */
    longTerm?: boolean;
    /** SPEC-goal-branch §4.1 — the opt-in isolation gate (GOAL records only). `undefined` ⇒ patch
     *  semantics (keep the stored value); `true`/`false` requests a change — REFUSED once the goal's
     *  `goal/<id>` branch exists, because moving the merge target under an in-flight task is the
     *  damage class this lock exists to stop (§4.11). The branch NAME is derived, ⛔ never given here. */
    branch?: boolean;
    /** SPEC-goal-branch §4.7 (裁定⑭⑮) — a CRITERION record's evaluation phase. `undefined` ⇒ patch
     *  semantics (keep the stored value; absent projects as `pre-merge`). Any other string is
     *  REFUSED — the phase is a declared fact, ⛔ not inferred from the criterion's text. */
    phase?: string;
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
    // SPEC-goal-branch §4.7: `phase` lives on a CRITERION record. The store validates the VALUE
    // (fail-closed — an unknown token is refused rather than projected as the default, hard rule 3b)
    // and refuses the field on a GOAL record (same "refusing beats silently dropping" discipline as
    // `criterion` above). ⛔ Not inferred from the criterion's text (hard rule 2).
    if (phase !== undefined && !VALID_CRITERION_PHASES.includes(phase)) {
      throw new Error(
        `${id}: phase must be one of ${VALID_CRITERION_PHASES.join(" | ")} (got ${JSON.stringify(phase)}) — the phase is DECLARED by the author, never inferred from the criterion text`
      );
    }
    if (isGoalRecord && phase !== undefined) {
      throw new Error(
        `${id} is a GOAL record and cannot carry a \`phase\` field — phase is an AC property (a goal is judged by the conjunction of its ACs, each with its own phase)`
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
      // The criterion AS STORED, captured BEFORE this write's `criterion` param overwrites it — the
      // basis for the write-side attribution gate's shrink-only comparison (see below).
      const priorCriterion = frontmatter.criterion;
      // ── goal-branch lifecycle pre-computation (SPEC-goal-branch §4.1/§4.2) ──────────────────────
      // All of it is read-only and happens before any mutation, so a refused write leaves nothing.
      // `root` is the git root of the goals dir (⛔ not `path.dirname` — hard rule 4 corollary 2);
      // null outside a work tree, in which case the lifecycle is honestly SKIPPED (never faked).
      const branchGitRoot = isGoalRecord ? resolveGitRoot(goalDir) : null;
      const priorBranch = frontmatter.branch === true;
      // Does the DERIVED ref already exist? This is the LOCK (§4.1: the field is mutable only while
      // the branch does not exist) — read from git, ⛔ never from a stored flag, so it stays true
      // across the store process boundary and after an external `git branch -D`.
      const branchRefExists = branchGitRoot !== null && goalBranchRefExists(branchGitRoot, id);
      if (isGoalRecord && branch !== undefined && branchRefExists && branch !== priorBranch) {
        throw new Error(
          `refusing to change ${id}'s \`branch\` field: the derived branch '${goalBranchName(id)}' already ` +
            `exists — the field is locked once the branch is created (SPEC-goal-branch §4.1/§4.11); ` +
            `it cannot be flipped under an in-flight task's merge target`,
        );
      }
      // Apply owned fields (preserving any unknown frontmatter keys verbatim).
      frontmatter.id = id;
      if (title !== undefined) frontmatter.title = title;
      const nextStatus = status ?? frontmatter.status ?? "draft";
      frontmatter.status = nextStatus;
      // The discarded tip sha, read BEFORE any mutation so it can be written into the statusLog entry
      // (§4.2: the statusLog reason is the ONLY rescue handle — the branch is deleted right after the
      // record lands). Read-only and null for a non-branch goal / already-discarded ref.
      const discarding =
        isGoalRecord && (nextStatus === "superseded" || nextStatus === "retired") &&
        prevStatus !== nextStatus && priorBranch && branchGitRoot !== null;
      const discardTipSha = discarding ? goalBranchTip(branchGitRoot as string, id) : null;
      // `kind` is derived from the id prefix — never caller-supplied.
      frontmatter.kind = isGoalRecord ? "goal" : "criterion";
      if (goal !== undefined) frontmatter.goal = goal;
      if (criterion !== undefined) frontmatter.criterion = criterion;
      if (expect !== undefined) frontmatter.expect = expect;
      if (origin !== undefined) frontmatter.origin = origin;
      if (supersedes !== undefined) frontmatter.supersedes = supersedes;
      if (supersededBy !== undefined) frontmatter["superseded-by"] = supersededBy;
      // `long-term` is a stored DECLARATION (AC-216), so unlike `evidence` it is written verbatim.
      if (longTerm !== undefined) frontmatter["long-term"] = longTerm;
      // `branch` (SPEC-goal-branch §4.1): patch semantics like `long-term` — omitted keeps the stored
      // value. The lock above already refused any CHANGE once the ref exists; a repeated `true` on a
      // branch-mode goal is a no-op, and `false` on a never-branched goal clears an unset field.
      if (branch !== undefined) frontmatter.branch = branch;
      // `phase` (SPEC-goal-branch §4.7): patch semantics like `long-term`/`branch` — omitted keeps the
      // stored value (which projects as `pre-merge` when absent). Validated above, before the lock.
      if (phase !== undefined) frontmatter.phase = phase;
      const statusChanged = prevStatus !== undefined && nextStatus !== prevStatus;
      // ⛔ "activation" here is ANY transition INTO active (SPEC §6 裁定 3: activation is manual; the
      // goal-driver never flips INTO active). Reopen paths — achieved→active, needs-human→active,
      // superseded→active, retired→active — are activations too (gap-activation-gates-bypassed-on-
      // reopen-path-non-draft-to-active: they were ~19% of all activations and walked past all three
      // gates, so a criterion rewritten mid-reopen entered active unchecked). create-as-active is NOT
      // gated BY THIS PREDICATE — a new record's criterion is validated by the create completeness
      // contract, and the P6 round-trip concern ("does the criterion still run after YAML round-trip?")
      // only exists once a record has been stored once and later activated. (P6-goal, whose quantity is
      // a different one, has its own wider predicate below — that is the one place the create path IS
      // gated; read the two together.) active→active (no status change) is not an activation. ⛔ The
      // most-frequent reopen shape is needs-human→active (3/5) — the human re-arms a record after a
      // ruling, precisely when criterion/expect were most likely just rewritten.
      // ⛔ The `prevStatus !== undefined` half is justified ONLY for those two CRITERION gates; it is
      // NOT a statement that the create path is gate-free (gap-goal-create-as-active-skips-zero-ac-gate).
      const activating = nextStatus === "active" && prevStatus !== undefined && prevStatus !== "active";
      // P6-goal's OWN predicate — deliberately wider than `activating` by exactly the create half
      // (`prevStatus === undefined`), because P6-goal asks a DIFFERENT quantity (see the gate body):
      // how many AC records name this GOAL. The create completeness contract does not answer that
      // (it checks title/origin/body, and nothing requires an AC to name the new record); and on the
      // ordinary birth path the count is knowable and zero — an AC points at an ALREADY-EXISTING
      // goal (`goal: GOAL-NNN`), so nothing can name a record that does not exist yet.
      // gap-goal-create-as-active-skips-zero-ac-gate: GOAL-018 was written straight as `active` on
      // 2026-09-14T04:01:57Z (commit 1a83bfe7a, no `statusLog` ⇒ never transitioned), circulated for
      // a 60s window carrying ZERO exit conditions — violating AC-217 the whole time — and the one
      // signal that did fire (AC-217 判红 ⇒ standing-violated) spawned a gap-filing worker with
      // nothing to fix. The window's distance to an irreversible false `achieved` was one guard
      // (`goal-driver.ts:466`, GOAL has no reverse flip).
      // This is the SAME shape the cap gate two blocks below already uses (`nextStatus === "active"`,
      // birth included) — one invariant, one predicate, ⛔ not a second gate. A create-as-active that
      // genuinely has an AC already naming it (an AC may be filed before its GOAL) still passes — the
      // count is measured, not assumed.
      //
      // ⚠️ 2026-09-17 (gap-goal-born-draft-zero-ac-escapes-standing-invariant) — THE PREDICATE IS NOW
      // THE INVARIANT'S OWN SCOPE, not half of it. It used to read `nextStatus === "active"`, i.e. the
      // ACTIVE half only, while AC-217's declared scope is `status ∈ {draft, active}`. The other half
      // was open: GOAL-022 was born `draft` with ZERO ACs (2026-09-17T00:41:26Z, no `statusLog` ⇒ never
      // transitioned) and stayed that way for ≥101s — the invariant false the whole time — and the one
      // signal it should have raised spawned a gap-filing worker with nothing to fix. Worse, the two
      // mechanisms CONTRADICTED each other: the rejection message on the active half literally
      // prescribed the open door (`create ⋯ as draft first ('--status draft')`, and
      // `serve-dashboard.ts` recorded that sentence as the store's birth path verbatim). This is the
      // 5b shape — the previous fix (gap-goal-create-as-active-skips-zero-ac-gate) closed the half its
      // predicate named and left its sibling open in the same expression.
      //
      // ⛔ NO `prevStatus !== …` exemption (the active half used to carry one). The quantity judged is
      // the STATE THE WRITE LEAVES BEHIND, not "did a status change happen": after any GOAL write
      // returns, a record in {draft, active} carries ≥1 AC. Dropping the exemption costs nothing real
      // (an active GOAL already carries ACs — it could not have got there otherwise) and closes the
      // case the exemption would otherwise leave open: a rewrite of an ALREADY-draft zero-AC GOAL
      // (legacy carrier, or one hand-written into `goals/`) would otherwise be re-admitted silently.
      const goalInAcScope = nextStatus === "draft" || nextStatus === "active";

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

      // ── write-side attribution gate (gap-criterion-attribution-write-gate-at-birth) ──────────────
      // THE DEFECT THIS CLOSES. Everything above judges whether a criterion EXISTS; nothing judged
      // whether its FAILURE exits are ATTRIBUTABLE. So a criterion could be born carrying
      // `sys.exit(1)` with no cause on the line, go active, join the ~42s hot loop, and write an
      // unattributable `verdict:fail` into `.quay/gate-events.jsonl` on every round — a record that
      // is PERMANENT (the ledger is append-only) and that no later fix can clear. AC-241 judges that
      // ledger, so it goes red and STAYS red however fast the ratchet notices. Measured: AC-239 →
      // AC-245 → AC-247/248/249, three recurrences in two days, the last three created in one session
      // on 2026-09-12 — and the ratchet never once ran on any of them, because creating an AC is a
      // `goals/`-only delta (DOC_SURFACES) ⇒ `code_delta` is empty ⇒ the `@static-tier change` checker
      // is skipped that round (runner-static-gate.ts:650 says so verbatim). Detection is 事后 by
      // construction; the WRITE is the only boundary that can actually be closed.
      //
      // THE RULE (⛔ the SAME predicate the ratchet uses — `evaluateCriterionAttribution`, imported
      // from `./criterion-attribution.ts` and re-exported below; a second copy of the regex here is
      // exactly the drift that produced AC-243):
      //   · CREATE — a new criterion may carry ZERO bare failure exits. Fail-closed.
      //   · UPDATE — shrink-only: the new text's bare-failure-exit COUNT must not EXCEED the stored
      //     text's. ⛔ Deliberately NOT a zero target for the 32 existing baselined ACs (hard rule 12:
      //     do not block an achievable goal on an unmeasured residual); the ratchet's own committed
      //     disposition is shrink-only, and so is this. A write that FIXES a criterion (N → 0) is
      //     always legal.
      //   · UNTOUCHED criterion (status-only flips, the mechanical I2 path) — never judged. That is
      //     what keeps the goal-driver's per-round `status` flips out of this gate's way.
      //
      // THREE-STATE OUTPUT (硬规则 3b). The write face's rejection vocabulary has three pairwise-
      // distinct shapes, so "I read it and it is bad" can never be confused with "I could not read it"
      // and neither with a pass:
      //   pass            → no throw
      //   bare            → names each offending LINE NUMBER and line text (an enumeration, not a bool)
      //   NOT-EVALUATED   → "could not be read at all", distinct text, exit ≠ 0
      // The third state is owned in two places, deliberately: for the criterion BEING WRITTEN it is
      // the non-empty contract ABOVE (absent / empty / non-string ⇒ its own message), and this gate
      // does not restate that rejection — it judges only what it can read. For the STORED criterion it
      // has no other owner, so the gate raises it itself (legacy records whose criterion is absent /
      // empty / non-string make "≤ the stored count" uncomputable). That branch is fail-closed but the
      // REPAIR stays open: such a write is accepted iff the new text is strictly clean (0 bare exits),
      // so a reader can always write a good criterion over a broken one.
      if (!isGoalRecord && (criterion !== undefined || !existingFile)) {
        const nextAttr = evaluateCriterionAttribution(frontmatter.criterion);
        if (nextAttr.evaluated) {
          const bare = nextAttr.bare;
          if (!existingFile) {
            if (bare.length > 0) {
              throw new Error(
                // ⛔ TWO accepted repairs, and the entry's own class label (in formatBareFailureExits)
                // says which one applies. Telling every author "write a cause on this line" would be
                // actively wrong for an `errexit abort`: the cause IS written, on a line errexit never
                // reaches — the assignment must be guarded instead. A rejection that names the wrong
                // repair is a rejection that does not open (硬规则 3b).
                `${id}: criterion carries ${bare.length} failure exit(s) that write no cause — refused at the write surface. Offending: ${formatBareFailureExits(bare)}. Accepted forms: (a) a WRITTEN failure exit whose line also writes to stderr/stdout (e.g. \`sys.stderr.write("...\\n")\`, \`>&2\`, \`console.error\`); (b) for a line marked "errexit abort", GUARD the assignment — \`VAR="$(cmd || true)"\`, \`VAR="$(cmd)" || true\`, or \`if ! VAR=$(cmd); then …\` — because a cause written below it can never run.`
              );
            }
          } else {
            const priorAttr = evaluateCriterionAttribution(priorCriterion);
            if (!priorAttr.evaluated) {
              if (bare.length > 0) {
                throw new Error(
                  `${id}: the STORED criterion is NOT-EVALUATED (${priorAttr.error}), so the shrink-only comparison cannot be computed — this update is therefore accepted only if the new criterion is strictly clean, and it carries ${bare.length} bare failure exit(s): ${formatBareFailureExits(bare)}`
                );
              }
            } else if (bare.length > priorAttr.bare.length) {
              throw new Error(
                `${id}: criterion attribution would REGRESS — the new text carries ${bare.length} failure exit(s) with no cause, the stored text carried ${priorAttr.bare.length} (shrink-only: a criterion edit may not ADD unattributable failure exits). Offending: ${formatBareFailureExits(bare)}`
              );
            }
          }
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
        // ⛔ CAPABILITY, BEFORE evaluability, and ⛔ not overridable by `--force`: `--force` means "I
        // accept that this criterion cannot be evaluated"; it does NOT mean "I accept that activating
        // it will perform a real write right now". Without this arm, merely ACTIVATING the incident's
        // AC executes the writer once — the exact mechanism that re-armed the storm 13 minutes after
        // the first "fix". The two questions stay separate questions (hard rule 5b: fixing one site
        // is not fixing the principle).
        const capabilityHit = capabilityRefusalAt(criterionCmd, gateRoot, workspaceRootForCapability);
        if (capabilityHit !== null) {
          throw new Error(`cannot activate ${id}: ${capabilityRefusalReason(capabilityHit)}`);
        }
        const startedMs = Date.now();
        // Resolved deadline: the RECORD's own `timeoutMs` FIRST, then the shared env/default chain
        // (`resolveAcceptanceTimeout` — the EXACT resolver `goal gate` uses), so the two paths share
        // one precedence. ⚠️ This matters more than at the other three sites: the verdict here
        // decides whether the write is ACCEPTED, so a criterion that legitimately needs > 60s was
        // being killed and then silently re-read as "ran and failed" (a timeout IS a definitive fail
        // ⇒ evaluable ⇒ allowed) — the write went through, but the P10 cost line below reported a
        // `fail` and a ~60s wall for a criterion that had never actually been evaluated to a verdict.
        // (tasks/gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks:
        // before this, activation read the record-IGNORING `resolveAcceptanceTimeoutMs()` while
        // `goal gate` read the record-aware sibling — a second, divergent precedence ladder.)
        const t = resolveAcceptanceTimeout(frontmatter.timeoutMs);
        const gateRes = runAcceptance({ command: criterionCmd, cwd: gateRoot, timeoutMs: t.timeoutMs, timeoutKnob: timeoutKnobHint(t) });
        const wallMs = Date.now() - startedMs;
        // EVALUABILITY — did the criterion reach a DEFINITIVE verdict at the deadline IN FORCE?
        // "ran and failed" (exit ≠0) proves it is runnable ⇒ allowed. Two outcomes do NOT:
        //   · a spawn failure (no process at all) — never allowed, unchanged; and
        //   · a TIMEOUT — the criterion was STOPPED at the deadline (now the record's own
        //     `timeoutMs` when declared) before it could say anything. ⛔ Before the record-aware
        //     deadline this was allowed on the reasoning "a timeout is a definitive fail ⇒ evaluable"
        //     — but a timeout is NOT a fail any more (`verdictFromAcceptance` maps it to
        //     `not-evaluated`), and letting it through ACTIVATES a criterion that will then be
        //     re-run and time out every round forever. The deadline is now a declaration the author
        //     can raise (the record's `timeoutMs`, named in the reason), so refusing is the honest
        //     answer: "I cannot evaluate this AT THIS DEADLINE". `--force` overrides deliberately.
        // (tasks/gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks AC3)
        if (gateRes.code === null || gateRes.timedOut) {
          throw new Error(`cannot activate ${id}: criterion not-evaluated (${gateRes.reason}) — pass --force to override`);
        }
        // P10 — make the activation cost visible: the criterion now joins the per-round hot loop.
        // The token printed is the shared 3-valued one (⛔ not a hand-rolled binary ternary) so a
        // reader of this line and a reader of the ledger see the same vocabulary.
        console.error(`goal-store: activated ${id} — criterion ran in ${wallMs}ms (${verdictFromAcceptance(gateRes).verdict})`);
      }

      // P6-goal — the GOAL half of the SAME activation gate (gap-meta-goal-store-activation-gate):
      // the two gates above are verbatim `!isGoalRecord` (they ask about a CRITERION: can it run, can
      // it be false), so a GOAL transitioning INTO active was checked only for body length (create)
      // and the active cap. Nothing required it to have an AC — and on 2026-09-12T00:33:10Z GOAL-014
      // went draft→active with ZERO AC records naming it (readings.criteria empty, goals.GOAL-014
      // status active), violating the declared invariant 「每个活跃 GOAL 至少有一条 AC」 (AC-217:
      // 「活跃目标无退出条件不可判定达成」) while producing no signal at all — the divergence layer
      // only iterates over ACs that EXIST, so a goal with none is structurally invisible to it.
      //
      // The predicate is deliberately the SAME one the reading uses (meta-driver collectReadings):
      // any `AC-*` record whose `goal:` names this GOAL, REGARDLESS of that AC's own status (a draft
      // AC is a written-down exit condition — it is what makes the goal decidable; it is the
      // not-yet-activated ACs that need the goal live, not the other way round). One invariant, one
      // predicate — ⛔ not a second, looser copy of the rule.
      //
      // fail-CLOSED ⛔ never fail-open: zero ACs is a definite verdict, not an "unable to evaluate".
      // The rejection ENUMERATES the count and the naming ids (hard rule 3: "0 ACs name this goal" is
      // the actionable fact; a bare boolean would hide which goal was bare).
      // ⛔ `--force` is deliberately NOT honored here (unlike the two criterion gates above): P6c's
      // `--force` means "I know this CRITERION is not evaluable" — an override over a judgment about
      // a criterion I hold. The AC count is not a judgment, it is a mechanical count of this store's
      // own carrier files; there is nothing in it to override, and an override here would land
      // exactly the silent zero-AC active goal this gate exists to make impossible.
      //
      // ⚠️ `goalInAcScope`, NOT `activating` — this gate covers the CREATE path too
      // (gap-goal-create-as-active-skips-zero-ac-gate), and since 2026-09-17 it covers the whole scope
      // the invariant declares (draft AND active), not just the active half. The invariant is therefore
      // a WRITE-SURFACE constraint over the pair: 「GOAL 不得以 draft/active 出生而名下零 AC」.
      // ⛔ NOT a new mechanism layered beside this one — one gate, widened to its own declared scope.
      // It does not conflict with the reopen behavior ruled on 2026-09-10 (achieved / needs-human /
      // superseded / retired → active stays ALLOWED, unchanged: the reopen path already had ACs, that
      // is precisely why it is separable). The narrowing that `activating` still carries is a statement
      // about the two CRITERION gates only.
      if (goalInAcScope && isGoalRecord) {
        const namingAcs = list().filter((r) => String(r.id ?? "").startsWith("AC-") && String(r.goal ?? "") === id);
        if (namingAcs.length === 0) {
          // The rejection must teach the ORDER THAT WORKS, because the order that used to be taught
          // here (create as draft → file the ACs → flip to active) is now refused at its first step and
          // was itself an instance of the forbidden state. AC-first is legal — the completeness
          // contract one block below requires only that `goal:` be a NON-EMPTY STRING, never that the
          // named GOAL exist — so the natural authoring order is still a single-records-at-a-time order
          // (⛔ no batch/transaction mechanism was added for this; hard rule 12).
          const acFirst =
            `Write the AC first — an AC may name a GOAL that does not exist yet (this store requires only ` +
            `that \`goal:\` be a non-empty string, ⛔ not that the named GOAL exist), so this order is legal ` +
            `at every instant: goal-store write AC-NNN --goal ${id} --status draft ` +
            `--criterion '<runnable command>' --expect '<expected outcome>' --origin '<empirical basis>', ` +
            `then run THIS write again. AC-first is what makes the invariant unobservable-as-false for any ` +
            `length of time (⛔ not a shorter window — an unreachable state).`;
          throw new Error(
            `cannot write ${id} as ${nextStatus}: 0 AC records name it — a GOAL in {draft, active} must ` +
            `carry at least one AC (a goal is judged by the conjunction of its ACs, so a goal with none ` +
            `has no exit condition and its achievement is undecidable; ACs naming ${id}: ${namingAcs.length}). ` +
            acFirst
          );
        }
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
        // SPEC-goal-branch §4.2 — when a branch-mode goal is discarded (retired/superseded), the
        // branch tip SHA is appended to THIS entry's reason. It is the ONLY rescue handle: the branch
        // is deleted moments later, and `git branch <name> <sha>` is how a human gets it back.
        // ⛔ The reason is written BEFORE the deletion (the deletion happens after this file lands).
        const discardNote = discardTipSha !== null ? `discarded branch ${goalBranchName(id)} tip ${discardTipSha}` : "";
        const entryReason = discardNote === ""
          ? (reason ?? "")
          : (reason === undefined || reason.trim() === "" ? discardNote : `${reason}（${discardNote}）`);
        frontmatter.statusLog = [...prior, {
          at: new Date().toISOString(),
          from: prevStatus as string,
          to: nextStatus,
          actor: actor ?? "goal-cli",
          reason: entryReason,
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
        "labels", "posture", "supersedes", "superseded-by", "long-term", "fidelity", "timeoutMs", "branch", "phase",
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
      // ── goal-staleness signal (gap-goal-status-stale-achieved-after-new-active-criterion-filed) ──
      // ⛔ NOTHING below touches the record just written, and NOTHING here touches the OWNING GOAL's
      // record: the AC write and the GOAL write stay as decoupled as they were (AC4 is the direct
      // mechanical check of that). The only effect is a SIDE-CARRIER append + a derived read.
      if (!isGoalRecord) {
        // A criterion was persisted that is NOT discharged (`achieved`) under a GOAL whose stored
        // status still reads `achieved` ⇒ that GOAL's status field may now be false, and NOTHING
        // else on any carrier says so. Record the divergence; do NOT flip the GOAL (裁定 3).
        const owningGoal = typeof frontmatter.goal === "string" ? frontmatter.goal.trim() : "";
        if (owningGoal !== "" && nextStatus !== "achieved") {
          const ownerStatus = goalStatusOf(goalDir, owningGoal);
          if (ownerStatus === "achieved") {
            appendGoalStalenessSignal(goalDir, {
              goalId: owningGoal,
              staleSince: new Date().toISOString(),
              triggeringAcId: id,
              goalStatusAtTime: ownerStatus,
            });
            console.error(
              `goal-store: ${id} was filed ${nextStatus} under ${owningGoal} which reads achieved — recorded a goal-staleness signal (the GOAL record itself is NOT modified; reopening is a human decision)`,
            );
          }
        }
      } else if (nextStatus === "active") {
        // AC3 — the HUMAN CONFIRMATION PATH is this EXISTING write, ⛔ not a new verb: when a GOAL is
        // written `status: active` (the 「确认重开」 decision, which only a human / authorized actor
        // makes — 裁定 3), any signals standing against it are marked resolved (appended, ⛔ never
        // deleted — the audit trail keeps the original divergence AND the decision that closed it).
        const resolved = resolveGoalStaleness(goalDir, id, { actor: actor ?? "goal-cli", reason });
        if (resolved > 0) {
          console.error(
            `goal-store: ${id} → active resolved ${resolved} goal-staleness signal(s) (actor=${actor ?? "goal-cli"})`,
          );
        }
      }
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
          if (longTerm !== undefined) touched.push("long-term");
          if (body !== undefined) touched.push("body");
          action = touched.length > 0 ? `field:${touched.join(",")}` : "update";
        }
        const outcome = commitKindFile(goalDir, fileName, id, action, "goals");
        if (outcome === "failed") {
          // The disk write succeeded but the git commit genuinely FAILED — surface on stderr so the
          // failure is observable, not silent (硬规则 3b). "unchanged"/"not-in-git" are expected no-ops.
          console.error(`goal-store: commit of "${id}" failed — the file was written to disk but is not on any branch's history`);
        }
      }
      // ── goal-branch lifecycle effects (SPEC-goal-branch §4.2) ───────────────────────────────────
      // AFTER the record lands on disk (the statusLog reason already carries the discarded tip), and
      // ONLY here — this is the one create call site and the one discard call site. `dryRun` returned
      // above, so nothing is persisted-adjacent; `branchGitRoot === null` (not a work tree) skips the
      // whole thing honestly rather than inventing a branch somewhere else.
      if (branchGitRoot !== null) {
        const enteringActive = nextStatus === "active" && prevStatus !== "active";
        const branchJustSet = branch === true && !priorBranch;
        if (isGoalRecord && nextStatus === "active" && frontmatter.branch === true && !branchRefExists &&
            (enteringActive || branchJustSet)) {
          const rep = ensureGoalBranch(branchGitRoot, id);
          if (rep.action === "blocked" || rep.action === "unreadable") {
            console.error(`goal-store: ${id} is branch-mode but '${rep.name}' was NOT created — ${rep.detail}`);
          }
        }
        if (discarding && discardTipSha !== null) discardGoalBranchNow(branchGitRoot, id);
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
    /** SPEC-goal-branch §4.7 (裁定⑭⑮) — an AC's declared evaluation phase (validated by `write`). */
    phase?: string;
    force?: boolean;
    actor?: string;
    reason?: string;
  }>, { dryRun = false }: {
    /** P9 dry-run for the batch path (gap-goal-batch-dry-run-noop): validate every record through
     *  the SAME `write()` (incl. the activation gate) and return the would-be view models, but
     *  persist NOTHING — no file write AND no `commitStoreBatch`. ⛔ This is the batch counterpart
     *  of `write`'s own `dryRun`; before this existed the flag was silently ignored here. */
    dryRun?: boolean;
  } = {}): GoalViewModel[] {
    const root = resolveGitRoot(goalDir);
    const results: GoalViewModel[] = [];
    const relPaths: string[] = [];
    for (const r of records) {
      const vm = write(r.id, {
        title: r.title, status: r.status, goal: r.goal, criterion: r.criterion,
        expect: r.expect, origin: r.origin, supersedes: r.supersedes,
        supersededBy: r.supersededBy, body: r.body, force: r.force,
        phase: r.phase,
        actor: r.actor, reason: r.reason, commit: false, dryRun,
      });
      results.push(vm);
      const f = fileNameForId(goalDir, r.id);
      if (f) relPaths.push(root ? path.relative(root, path.join(goalDir, f)) : `goals/${f}`);
    }
    if (!dryRun) {
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
    }
    return results;
  }

  return { list, listWithMalformed, get, write, writeBatch, activeGoals, listActiveCriteria, isGoalAchieved, checkWithinCap, checkStaleness, checkAchievedFailing, checkReverifyScope, frozenAchievedAcs, checkStalePass, sweepFrozen };
}

// ── Direct-invocation entry (Contract invoke: `node packages/quay/src/goal-store.ts`) ──────────────
// Subcommands (workspace root auto-derived from the script location, or --root <dir>):
//   list                      — list all goal records (GOAL + AC) as JSON
//   get <id>                  — one record as JSON
//   write <id> [--title ...] [--status ...] [--goal ...] [--criterion ...] [--expect ...]
//              [--origin ...] [--body ...] [--actor ...] [--reason ...] [--force] [--dry-run]
//              [--expect-absent] [--expect-existing] [--fidelity-judge-argv '<json argv array>']
//              [--branch true|false]  (GOAL opt-in isolation gate — locked once `goal/<id>` exists;
//              the branch NAME is derived, ⛔ never a flag)
//              [--phase pre-merge|post-merge]  (AC evaluation phase, SPEC-goal-branch §4.7; declared
//              by the author, ⛔ never inferred from the criterion's text)
//              (--expect-absent = create intent, refuse if it exists; --expect-existing =
//              update intent, refuse if absent — the goal store's expectedStatus-CAS counterpart)
//   batch --json '<array>' [--dry-run]
//              — write N records in ONE commit (each: id + the write fields)
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
//   check --reverify-scope [--adjudication <md>] — PURE-READ annotated enumeration of the I5 scope
//                               (inScope/outOfScope, each with goal/status/longTerm). With
//                               --adjudication <task.md> it cross-checks the AC2 ruling table: exit 1
//                               names every 「常设不变式」 ruling that did NOT land as a `long-term`
//                               field, plus the reverse error and unrecognized rulings.
//   check --stale-pass [--sweep] [--budget N] [--min-age-ms N] [--wall-ms N] — the AC-242 successor
//                               (gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass). The
//                               FROZEN population (achieved ∧ criterion non-empty ∧ NOT in the
//                               reverify scope) is re-verified by a BOUNDED ROTATION; plain form is
//                               PURE-READ (exit 1 = an AC is verified CURRENTLY false, named on
//                               stderr; exit 3 = frozen population exists but the rotation has never
//                               run ⇒ NOT-EVALUATED; exit 0 otherwise). --sweep performs one bounded
//                               rotation step first (≤budget criteria, ≤wall-ms, verdicts recorded
//                               as actor=goal-sweep ledger events).
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

// env 合并（override 中 `""` = 删键，其余含 `"0"` 保留）的实现 = kernel 叶
// `./kernel/env-merge.ts` 的单一一份 —— ⛔ 不在这里留第二份（routine `semantic-dedup-scan`
// finding `mergeenv-cross-layer-byte-identical-under-renamed-symbol` 的处置：本函数原名
// `mergeProfileEnv`，与 plugin/scripts/profile-policy.ts 的 `mergeEnv` 逐字节相同）。

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
  const env = mergeEnv(baseEnv, roleEnv);
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

/** The goal store's CLI dispatch, **exported** so a second surface can run the SAME dialect instead
 *  of restating it (gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache).
 *
 *  WHY IT IS EXPORTED (⛔ not a cosmetic re-export): the goal mechanism is driven by SUBPROCESS argv —
 *  `goal-driver`/`meta-driver` spawn one command per record read / criterion run / status flip and
 *  read its EXIT CODE as a verdict (0/1/2 for `gate`, 0/1/3 for `check --stale-pass`). Those codes,
 *  the flag grammar and the stdout JSON shape are therefore a CONTRACT between the store and its
 *  callers. The drivers used to spawn `<codeRoot>/packages/quay/src/goal-store.ts` directly; that
 *  file does not exist in an installed layout (plugin marketplace cache / npm-pack / third-party
 *  vendored copy — the store is there only as a LIBRARY inlined into the driver bundle, so this
 *  module's `isMain` guard is false there and its CLI is unreachable). The drivers now spawn the
 *  quay CLI's `goal` verbs (`quay goal gate|check|batch|write`), which land in cli/goal.ts and call
 *  THIS function. ⛔ Restating the dialect in cli/goal.ts would create a second implementation of the
 *  exit codes the driver reads as verdicts — i.e. exactly the drift class this repo keeps removing.
 *
 *  Behaviour is unchanged for the module's own entry: the `isMain` guard at the bottom of this file
 *  still calls it with `process.argv` when the file is invoked directly. */
export async function runGoalStoreCli(argv: string[]): Promise<number> {
  // A goal-store CLI invocation is a SHORT-LIVED CHILD a driver may SIGTERM (goal-driver /
  // meta-driver wrap every spawn in a wall-clock bound). Install the lock-release-on-signal handler
  // HERE (an entry point), ⛔ never in the shared base's module scope: the same base is used by the
  // long-lived MCP server / web UI, whose own SIGTERM shutdown must not be replaced by an immediate
  // release+exit. This is the half of the pair that fires when the child is NOT blocked in a
  // synchronous spawn; the driver removes the lock by pid when it IS blocked (see frontmatter-store-base).
  installLockReleaseOnSignal("SIGTERM");
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
        if (key === "long-term") {
          // AC-216 declaration, machine-writable. Strict `true|false` — ⛔ no truthy coercion: a typo
          // like `--long-term yes` must not silently write `long-term: yes` (which `longTerm`
          // projects as false and which AC-242's criterion does not recognise either).
          if (v !== "true" && v !== "false") {
            console.error("goal-store: --long-term must be exactly true or false");
            return 2;
          }
          opts["long-term"] = v === "true";
          i++;
          continue;
        }
        if (key === "branch") {
          // SPEC-goal-branch §4.1 — the opt-in isolation gate, machine-writable. Strict `true|false`
          // (⛔ no truthy coercion: `--branch yes` must not silently write `branch: yes`, which the
          // view-model projects as false — the long-term flag's exact failure class).
          if (v !== "true" && v !== "false") {
            console.error("goal-store: --branch must be exactly true or false");
            return 2;
          }
          opts["branch"] = v === "true";
          i++;
          continue;
        }
        if (key === "phase") {
          // SPEC-goal-branch §4.7 — the AC evaluation phase, machine-writable. Strict enum, ⛔ no
          // coercion/aliasing: an unknown token must not reach the file to be silently projected as
          // the `pre-merge` default (the write path refuses it too — this names the flag earlier).
          if (!VALID_CRITERION_PHASES.includes(String(v))) {
            console.error(`goal-store: --phase must be exactly ${VALID_CRITERION_PHASES.join(" or ")}`);
            return 2;
          }
          opts["phase"] = v;
          i++;
          continue;
        }
        if (key === "title" || key === "status" || key === "goal" || key === "criterion" ||
            key === "expect" || key === "origin" || key === "body" || key === "superseded-by" ||
            key === "supersedes" ||
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
          // `--supersedes <id>` — the DECLARATION half of the same field `write()` already owns
          // (goal-store.ts:1913 `supersedes?: string[]`, applied at :2002). It was reachable through
          // the JS API but had no CLI surface, so every CLI writer (meta-driver's draft proposals)
          // was structurally unable to carry it. Single id per flag ⇒ wrapped, the same shape
          // `--superseded-by` uses just above.
          //
          // ⛔ BOUNDARY — this flag carries no disposal power over a CRITERION, and that is
          // structural, not a convention to be maintained: `write()`'s disposal branch is gated on
          // `isGoalRecord && nextStatus === "active"` (:2322), so for an `AC-*` record the flip is
          // unreachable on EVERY status, including activation. A proposal that declares
          // `supersedes: [AC-old]` therefore leaves `AC-old`'s `status` byte-identical — flipping it
          // stays a human action. (For a GOAL record the disposal semantics are the pre-existing I1′
          // mechanism, already reachable via `--dispose-old`; this flag adds no new semantic there,
          // it only stops the field from being un-writable.)
          supersedes: typeof opts.supersedes === "string" ? [opts.supersedes] : undefined,
          disposeOld,
          // `--long-term true|false` (AC-216 declaration, machine-writable). `false` is MEANINGFUL
          // (explicitly clear the declaration) — hence the `!== undefined` guard, not a truthiness
          // test: passing the boolean straight through preserves the patch semantics in `write`.
          longTerm: opts["long-term"] as boolean | undefined,
          // `--branch true|false` (SPEC-goal-branch §4.1). `false` is MEANINGFUL (explicitly decline)
          // — the `!== undefined` guard preserves the patch semantics in `write`, exactly like longTerm.
          branch: opts["branch"] as boolean | undefined,
          // `--phase pre-merge|post-merge` (SPEC-goal-branch §4.7). `undefined` (omitted) preserves
          // patch semantics; the value was validated against the enum above, before the call.
          phase: opts["phase"] as string | undefined,
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
      // P9 dry-run (gap-goal-batch-dry-run-noop): the flag is siblings-consistent with `write`
      // (--dry-run) and `gate` (--dry-run). ⛔ Before this line existed, `batch --dry-run` parsed
      // no error and then wrote + committed anyway — the failure mode was SILENT (a successful,
      // plausible-looking run), which is why hard rule 3b applies: the unhandled flag must not be
      // indistinguishable from the honoured one.
      const dryRun = rest.includes("--dry-run");
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
            // SPEC-goal-branch §4.1 — batch records carry the opt-in gate the same way `write` does
            // (patch semantics on a boolean, ⛔ not a truthy coercion).
            branch: typeof o.branch === "boolean" ? o.branch : undefined,
            // SPEC-goal-branch §4.7 — batch records carry the AC phase the same way `write` does;
            // `write` validates the enum, so a bad token is refused rather than stored.
            phase: typeof o.phase === "string" ? o.phase : undefined,
            force: o.force === true,
            actor: o.actor as string | undefined,
            reason: o.reason as string | undefined,
          };
        }), { dryRun });
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
      // `--timeout <ms>` (gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout): the
      // per-invocation override, resolved with the SAME "explicit override wins" idiom the task
      // gates already use (`cli/shared.ts#pinAcceptanceEnv`): the flag PINS the env var, so
      // `resolveAcceptanceTimeoutMs`'s own precedence (env > gates `timeoutMs` > default) then
      // yields `--timeout` first without a second, divergent precedence ladder living here.
      // ⛔ `--timeout` is not in `rest` positionally; it must be consumed (below) so it cannot be
      // mistaken for the record id.
      const timeoutIdx = rest.indexOf("--timeout");
      if (timeoutIdx >= 0) {
        const raw = rest[timeoutIdx + 1];
        const ms = Number(raw);
        if (raw === undefined || !Number.isFinite(ms) || ms <= 0) {
          console.error(`goal-store: --timeout requires a positive number of milliseconds (got ${JSON.stringify(raw)})`);
          return 2;
        }
        process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = String(ms);
      }
      // Criterion execution REUSES the task acceptance-runner shape (SPEC §3) and the gate
      // ledger REUSES the existing GateEvent format (.quay/gate-events.jsonl).
      // (`runAcceptance` is a static import at the top — also used by checkAchievedFailing's I5 bucket.)
      const { appendGateEvent } = await import("./gate-event-store.ts");
      const rec = store.get(id);
      if (!rec) { console.error(`goal-store: no such goal: ${id}`); return 2; }
      const criterion = rec.criterion;
      let verdict: string;
      let reason: string;
      let cause: string | null = null;
      // The deadline THIS invocation actually used — surfaced in the JSON below so a caller can tell
      // "the criterion timed out" from "the criterion timed out at a deadline I did not intend".
      // ⛔ Read BEFORE running: the resolver is pure, and resolving it after a 60s+ wait would report a
      // value the run did not necessarily use if the env changed mid-flight.
      // ⛔ RECORD-aware: a goal record's own `timeoutMs` is the deadline in force for its criterion;
      // the shared env/default chain is only the fallback beneath it (AC4 of this task — the record
      // is the only place a goal's own deadline can be declared, and the goal path reads no gates.yml).
      const t = resolveAcceptanceTimeout((rec as unknown as { timeoutMs?: unknown }).timeoutMs);
      const timeoutMs = t.timeoutMs;
      // §5 B1 — an AC under a BRANCH-MODE goal is evaluated on that goal's criterion worktree (its
      // code lives only on `goal/<id>` until the merge); every other AC keeps the main checkout root.
      // ⛔ The gate EVENT still lands on the MAIN root's ledger below: `logPath` was derived from
      // `root`, not from this cwd — only the criterion's working tree moves, never the record's.
      const gateCwd = criterionCwdFor(
        root,
        buildCriterionRoots(root, store.list() as unknown as Array<Record<string, unknown>>),
        rec,
      );
      // ── the capability gate + THE human-present BYPASS ─────────────────────────────────────────
      // `--allow-side-effects` is the ONLY bypass in this file, and it exists exactly where a bypass
      // can be honest: this subcommand is an EXPLICIT, single-record invocation by whoever is at the
      // keyboard right now (that is how a real one-shot E2E proof gets re-run — Fleet's `realchecks/`
      // is the same shape). Two properties make it a bypass rather than a hole:
      //   · it is BOUNDED — it is a flag on THIS invocation, and ⛔ neither unattended path (I5, the
      //     frozen rotation) reads it, so it can never be set once and forgotten into an eternal loop;
      //   · it is AUDITABLE — every use is stamped into the ledger event below (`capabilityBypass`),
      //     so a bypassed run is never shaped like an ordinary one.
      // ⛔ An empty criterion is answered by the branch below, which is also fail-closed.
      const allowSideEffects = rest.includes("--allow-side-effects");
      let capabilityBypass: { code: string; rules: string[] } | null = null;
      const capabilityHit = typeof criterion === "string" && criterion.trim() !== "" ? capabilityRefusalAt(criterion, gateCwd, root) : null;
      if (capabilityHit !== null && allowSideEffects) {
        // The refusal still travels with the run — a bypass is a DECISION, and the ledger keeps it.
        capabilityBypass = { code: capabilityHit.code ?? "criterion-capability-unevaluable", rules: capabilityHit.reasons.map((r) => r.rule) };
        console.error(`goal-store: ${id} — BYPASSING the criterion capability gate (--allow-side-effects): ${capabilityRefusalReason(capabilityHit)}`);
      }
      if (capabilityHit !== null && !allowSideEffects) {
        // ⛔ NO spawn. The verdict is `not-evaluated` with the stable code carried in the JSON below —
        // ⛔ never `fail`, which would assert "this criterion is false" about a command that never ran
        // (hard rule 3b, and the very conflation this task exists to remove).
        verdict = "not-evaluated";
        // ⛔ `cause` is non-null exactly when the verdict is `not-evaluated` (the invariant the JSON
        // below documents) — a refusal is a not-evaluated WITH a nameable cause, not a bare one.
        cause = "capability";
        reason = capabilityRefusalReason(capabilityHit);
      } else if (typeof criterion !== "string" || criterion.trim() === "") {
        // AC2 — empty criterion FAILS CLOSED (red), never a silent PASS.
        verdict = "fail";
        reason = `${id} has no criterion defined (fail-closed — an unenforceable AC must never silently pass)`;
      } else {
        // The deadline is `t` resolved above — the RECORD's `timeoutMs` when it declares one, else the
        // shared env/default chain. ⛔ NOT gates.yml's: the goal path reads neither the task's
        // `extra.acceptance` nor a gates.yml key for its criterion, so a reason telling a goal reader
        // to raise those names a knob that does not exist here
        // (gap-goal-gate-verdict-single-mapping-not-evaluated; the hint below is the one that does).
        const result = runAcceptance({
          command: criterion,
          cwd: gateCwd,
          timeoutMs: t.timeoutMs,
          timeoutKnob: timeoutKnobHint(t),
        });
        // ⛔ The ONE mapping (gap-goal-gate-verdict-single-mapping-not-evaluated): a timeout, a
        // spawn failure and exit 126/127 record `not-evaluated`, ⛔ not `fail` — "we could not
        // measure this" must never wear the shape of "this is false" (hard rule 3b).
        const v = verdictFromAcceptance(result);
        verdict = v.verdict;
        reason = v.reason;
        cause = v.cause;
      }
      const event = {
        id: randomUUID(),
        item_id: id,
        pipeline_id: id,
        gate: "goal",
        actor: "goal-cli",
        verdict,
        timestamp: new Date().toISOString(),
        // `cause` only when there is one — see the sweep site's note on the payload shape.
        // `evaluationRoot`/`treeSha` name WHICH tree this verdict was obtained on (SPEC §7 辛):
        // `gateCwd` is the criterion cwd passed to `runAcceptance` above, so the two are the same tree
        // (the criterion worktree for a branch-mode goal, the main checkout otherwise).
        payload: {
          reason,
          ...(cause ? { cause } : {}),
          // ⛔ The bypass is RECORDED, so it is never isomorphic to an ordinary run: a reader can
          // tell "this criterion was run because a person said so, knowing it writes" from "this
          // criterion ran as a reading". Present only when the bypass was actually used.
          ...(capabilityBypass ? { capabilityBypass } : {}),
          ...(capabilityHit ? { capabilityCode: capabilityHit.code, capability: capabilityHit.capability } : {}),
          ...evaluationContext(gateCwd),
        },
      };
      // P9 dry-run: run the criterion but do NOT append the gate event (persist nothing).
      if (!dryRun) appendGateEvent(logPath, event);
      // ⛔ NO evidence write-back: `evidence` is ledger-DERIVED, never stored
      // (gap-goal-evidence-cache-should-not-enter-git). The ledger event just appended IS the
      // evidence — writing it into goals/*.md would re-couple the ~42s gate cadence to the tracked
      // file and let a stale reading travel via git (the exact defect this task removes).
      // `timeoutMs` is what governed this verdict — a reading of the RESOLVED deadline at the
      // production surface. ⛔ Without it, "the default is still 60000 when nothing overrides it" is
      // only observable by waiting 60 seconds for a kill, which is exactly the kind of
      // wait-for-the-failure check a test should never have to make.
      // `cause` travels beside it (non-null exactly when the verdict is `not-evaluated`), so a reader
      // can tell WHICH knob to turn without parsing the reason string.
      const out = {
        id,
        verdict,
        cause,
        reason,
        // The stable refusal code — a caller branches on THIS, never on the message text. `null`
        // when the capability gate did not fire (either it passed, or the bypass was used).
        capabilityCode: capabilityBypass === null ? capabilityHit?.code ?? null : null,
        capabilityBypass,
        timeoutMs,
        timestamp: event.timestamp,
        dryRun,
        event,
      };
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      // ⛔ `pass` is the ONLY exit 0: not-evaluated is not a pass (the driver reads this code as a
      // verdict), it is merely a different kind of non-pass, distinguishable in the ledger.
      return verdict === "pass" ? 0 : 1;
    }
    case "check": {
      // ⛔ FAIL-CLOSED on an unknown flag (hard rule 3b). `check` dispatches on flag presence, and
      // the fall-through is `checkWithinCap` — so before this guard, a NEW flag against an OLDER
      // goal-store (the activation window: a criterion lands in goals/ while the code it names is
      // still the pre-change one on the main checkout / before fan-in) silently ran a DIFFERENT
      // check and exited 0. That is "could not read the input" wearing the same output shape as
      // "evaluated and fine" — the exact class this task exists to close, so the guard is not
      // decoration. Every flag `check` understands must be listed here.
      const KNOWN_CHECK_FLAGS = new Set([
        "--reverify-scope", "--adjudication", "--achieved-failing", "--staleness",
        "--stale-pass", "--sweep", "--budget", "--min-age-ms", "--wall-ms",
      ]);
      const unknownFlags = rest.filter((a) => a.startsWith("--") && !KNOWN_CHECK_FLAGS.has(a));
      if (unknownFlags.length > 0) {
        console.error(`goal-store: unknown check flag(s): ${unknownFlags.join(", ")} — refusing to fall through to a different check (fail-closed)`);
        return 2;
      }
      // `check --reverify-scope [--adjudication <task.md>]` — AC1's reading command: the annotated
      // enumeration of the I5 reverify scope. With `--adjudication`, it additionally CROSS-CHECKS the
      // AC2 ruling table against the store: every AC ruled 「常设不变式」 must actually BE in scope
      // (i.e. its `long-term: true` landed as a FIELD, not merely as prose). That cross-check is the
      // falsifiable half — it is exit 1 exactly when a ruling has not landed.
      if (rest.includes("--reverify-scope")) {
        const r = store.checkReverifyScope();
        const out: Record<string, unknown> = { ...r };
        const violations: string[] = [];
        const ai = rest.indexOf("--adjudication");
        if (ai >= 0) {
          const adjPath = rest[ai + 1];
          if (adjPath === undefined || !fs.existsSync(adjPath)) {
            console.error(`goal-store: --adjudication ${JSON.stringify(adjPath)} is not readable`);
            return 2;
          }
          const adj = parseAdjudicationTable(fs.readFileSync(adjPath, "utf8"));
          const inIds = new Set(r.inScope.map((e) => e.id));
          // (b) the ruling landed as a field: every 「常设不变式」 AC is IN scope.
          const standingMissing = adj.standing.filter((id) => !inIds.has(id));
          // (a) ⛔ the reverse error: an AC ruled one-time that is nonetheless in scope ⇒ the field
          // contradicts the ruling (the marking was never removed).
          const oneTimeButInScope = adj.oneTime.filter((id) => inIds.has(id));
          // The AC1 literal assertion: ⛔ no in-scope AC may sit under an achieved GOAL without a
          // `long-term` declaration — that is the indiscriminate-widening shape the scope's own
          // comment forbids. It holds before and after this task's change (it is a GUARD, not the
          // differential); the differentials are `standingMissing` here and AC4's scopeSize delta.
          const undeclaredInScope = r.inScope.filter((e) => e.goalStatus === "achieved" && !e.longTerm).map((e) => e.id);
          out.adjudication = { ...adj, standingMissing, oneTimeButInScope, undeclaredInScope };
          for (const id of adj.unrecognized) violations.push(`unrecognized ruling for ${id.id}: ${JSON.stringify(id.ruling)}`);
          for (const id of standingMissing) violations.push(`ruled 常设不变式 but NOT in reverify scope (long-term not written): ${id}`);
          for (const id of oneTimeButInScope) violations.push(`ruled 一次性验收 but IS in reverify scope: ${id}`);
          for (const id of undeclaredInScope) violations.push(`in scope under an achieved GOAL without long-term: ${id}`);
        }
        out.violations = violations;
        process.stdout.write(JSON.stringify(out, null, 2) + "\n");
        if (violations.length > 0) {
          for (const v of violations) console.error(`goal-store: ${v}`);
          return 1;
        }
        // NOT-EVALUATED (⛔ never confounded with "in scope and all fine"): nothing to enumerate.
        return r.scopeSize > 0 ? 0 : 3;
      }
      if (rest.includes("--stale-pass")) {
        // `check --stale-pass [--sweep] [--budget N] [--min-age-ms N] [--wall-ms N]`
        // (gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass). TWO modes, one shape of
        // answer — the difference is only whether the bounded rotation runs first:
        //   · plain            — PURE-READ judgment (⛔ runs no criterion). This is what AC-242's
        //                        criterion invokes on every goal-driver round, so it must not cost a
        //                        criterion sweep; it reads what the rotation has already recorded.
        //   · --sweep          — one bounded rotation step (≤ --budget criteria, ≤ --wall-ms wall),
        //                        each verdict RECORDED as a ledger event, then the same judgment.
        const numArg = (flag: string, dflt: number): number => {
          const i = rest.indexOf(flag);
          if (i < 0) return dflt;
          const n = Number(rest[i + 1]);
          return Number.isFinite(n) && n >= 0 ? n : dflt;
        };
        let sweep: Awaited<ReturnType<typeof store.sweepFrozen>> | null = null;
        if (rest.includes("--sweep")) {
          sweep = await store.sweepFrozen({
            budget: numArg("--budget", DEFAULT_SWEEP_BUDGET),
            minAgeMs: numArg("--min-age-ms", DEFAULT_SWEEP_MIN_AGE_MS),
            wallMs: numArg("--wall-ms", DEFAULT_SWEEP_WALL_MS),
          });
        }
        const r = store.checkStalePass();
        process.stdout.write(JSON.stringify(sweep ? { ...r, sweep } : r, null, 2) + "\n");
        // ⛔ `amendedUnverified` deliberately does NOT drive the exit code (unlike `notEvaluated`, which
        // is exit 3). Two reasons, both required:
        //   · AC-242's expect is the contract this command's exit codes answer to, and it enumerates
        //     exactly three: 0 = no frozen AC is currently false (+ the rotation has run), 1 = one is,
        //     3 = not-evaluated.「有一条判据被改过、新版还没跑」is none of those — it is UNKNOWN, not
        //     false and not "the mechanism is absent"; widening the exit code would silently rewrite a
        //     criterion this task is explicitly forbidden to touch (⛔ 判据 AC-242 本身不动).
        //   · it is transient and self-resolving within ONE driver round: `sweepFrozen` gives these ACs
        //     top eligibility and re-records them with the current fingerprint, so the very next read
        //     has a usable verdict either way. A red here would be a one-round flap, not a state.
        // It is still a DISTINCT word in the JSON `r` above — the reading can tell "unknown because the
        // criterion changed" from every other bucket (hard rule 3b: 「不知道」不得与「查过且全好」同形;
        // ⛔ 也不同形于 failing, which would be an assertion about a criterion nobody has run).
        if (r.failing.length > 0) {
          // ⛔ stderr carries the ids and the fact that they are CURRENTLY false — attributable, so
          // AC-241's discipline holds for the event this criterion's own failure produces.
          console.error(`stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: ${r.failing.join(", ")}`);
          return 1;
        }
        // NOT-EVALUATED, ⛔ never confounded with "looked and all fine" (hard rule 3b): either a
        // frozen population exists but NOTHING has ever rotated through it (the mechanism that could
        // tell us is absent), or the rotation ran and some criteria declared「此地无法评估」.
        if (r.frozenScope > 0 && (r.rotation.sweptEver === 0 || r.notEvaluated.length > 0)) {
          const why = r.rotation.sweptEver === 0
            ? `the rotation has never run (no actor=${SWEEP_ACTOR} event in the ledger)`
            : `the rotation ran and ${r.notEvaluated.length} criterion(a) declared NOT-EVALUATED here: ${r.notEvaluated.join(", ")}`;
          console.error(`stale-pass: NOT-EVALUATED — ${r.frozenScope} frozen achieved AC(s) but ${why}`);
          return 3;
        }
        return 0;
      }
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
  runGoalStoreCli(process.argv).then((code) => { process.exitCode = code; });
}
