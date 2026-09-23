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
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import {
  parseFrontmatter,
  serializeFrontmatter,
  fileNameForId,
  withFileLock,
  slugify,
} from "./frontmatter-store-base.ts";
import {
  runAcceptance,
  resolveAcceptanceTimeout,
  timeoutKnobHint,
  verdictFromAcceptance,
} from "./gate/acceptance-runner.ts";
// gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout: EVERY criterion this file
// runs takes its kill deadline from here. ⛔ `resolveAcceptanceTimeoutMs`, NOT `resolveRunnerOptions`
// — the latter also resolves a cwd (preferring `QUAY_ACCEPTANCE_CWD`), and a goal criterion's cwd is
// the git root by design (see the call sites' own comments); taking the whole options object would
// silently relocate every criterion the moment that variable was set.
//
// ⛔ `resolveAcceptanceTimeout` (above) is the RECORD-aware sibling the `goal gate` verb uses: it is
// this same chain with the record's own `timeoutMs` in front of it, so a per-record deadline is
// honoured WITHOUT a second default literal (gap-goal-gate-verdict-single-mapping-not-evaluated AC4).
import { resolveAcceptanceTimeoutMs } from "./gate/config/utils.ts";
import { queryGateEvents } from "./gate/gate-event-store.ts";
import { commitStoreWrite, commitStoreBatch, resolveGitRoot, type CommitOutcome } from "./store-commit.ts";
import { criterionFidelityVerdict, type FidelityInvokeJudge } from "./criterion-fidelity.ts";
import { resolvePluginRoot } from "./plugin-root.ts";
import { GOAL_STATUSES } from "./abi.ts";

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

// ── AC-242 successor: the FROZEN population and its bounded rotation re-verification ──────────────
// gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass. An AC `status: achieved` whose GOAL
// is no longer `active` and which does NOT declare `long-term: true` leaves BOTH mechanisms at once:
//   · I5 (`checkAchievedFailing`) never runs it — `inAchievedReverifyScope` is false;
//   · the driver's per-round gate set (`standingReverifyAcs`) never runs it — same predicate.
// Its ledger tail therefore FREEZES at whatever the last verdict was. AC-242's original predicate
// ("tail verdict === fail") can only see a failure that was RECORDED — so an AC that goes false
// AFTER its last recording is tail-`pass` and is structurally invisible to every mechanism
// (hard rule 4: a reading that cannot turn false is not a measurement; measured 2026-09-12: 4 such
// ACs — AC-147/AC-149/AC-172/AC-228 — all tail=pass, all live-exit!=0).
//
// The fix is NOT a wider predicate (a predicate cannot know a criterion's current truth without
// running it — that IS the cost) and NOT an indiscriminate widening of the reverify scope (AC-216's
// cost boundary, stated in `inAchievedReverifyScope`'s comment). It is a BOUNDED ROTATION:
// re-run the least-recently-verified frozen ACs, a few per invocation, and RECORD the verdict in the
// same ledger the judgment already reads — so the tail stops being frozen and starts meaning
// "the last time we actually looked", with a bounded and therefore known freshness.
//
// Measured cost basis (2026-09-12, this repo, frozen population M = 81, single-threaded):
//   avg 1.31s/criterion over a 21-AC sample; two outliers at 7.4s and 10.6s.
//   ⇒ one full rotation ≈ M × ~1.3s ≈ 106s ≈ 1.8 min of CPU, amortized over the rotation period.
// With `DEFAULT_SWEEP_MIN_AGE_MS` = 1h the steady-state cost is therefore ≈ M × 1.3s / 1h ≈ 106s
// per hour (≈3% of one core), and the per-invocation bound is
//   ≤ min(DEFAULT_SWEEP_BUDGET × T, DEFAULT_SWEEP_WALL_MS + T)
// where T is the criterion deadline `resolveAcceptanceTimeoutMs()` returned for THIS invocation
// (pre-set `QUAY_ACCEPTANCE_TIMEOUT_MS` > the gate's own `timeoutMs` field > the sole default
// `DEFAULT_ACCEPTANCE_TIMEOUT_MS`) — NOT a constant of this file.
// ⚠️ Two honest corrections to the derivation this comment used to carry:
//   (a) it read `min(6 × 60s, 30s) = 30s`, silently treating `T` as the literal 60s. `T` is a
//       resolved value, so the default-value instance must be named as such: under the defaults
//       (T = 60s, wall = 30s, budget = 6) the bound is ≤ 60s.
//   (b) `min(budget × T, wallMs)` would be right only if the wall were enforced DURING a criterion.
//       It is not: the `Date.now() - startedAt > wallMs` guard sits at the TOP of the loop body,
//       i.e. BETWEEN criteria (read `sweepFrozen`) — so it bounds how many MORE criteria get
//       STARTED, never how long the one already running may take. Hence `wallMs + T`, not `wallMs`.
//   ⛔ Raising T therefore raises this bound linearly. That is the configured consequence of the
//   knob, not a silent one: the same setting that buys a longer single criterion names the cost here.
// An invocation that trips the wall budget stops early and the remaining ACs are picked up by the
// next invocation (the rotation is resumable from the ledger ALONE: eligibility is "oldest recorded
// verification first", so there is no cursor to drift).
export const SWEEP_ACTOR = "goal-sweep";
/** The AMENDMENT dry-run's actor — deliberately a DIFFERENT string from `SWEEP_ACTOR`
 *  (gap-ac242-derived-criterion-double-judged-and-amendment-unguarded, defect ②):
 *  「对一条已 achieved 的 AC 修订 criterion」时，本轮对**新**判据的空跑以本 actor 落账，读台账的人
 *  能区分「轮转按年龄轮到了它」与「判据文本变了，所以立刻重跑了一次」——两者是不同的**成因**，
 *  用同一个 actor 记就不可归因（硬规则 3：枚举态而非布尔态；这里的第二态就是「为什么这次跑了它」）。
 *  ⛔ 它与 `SWEEP_ACTOR` 一样是**轮转写者**：`gateTails` 把两者的尾部都读进 `lastSweep`（见下），
 *  否则这条空跑写下的 verdict 不会被判定面读到，机制就等于没接。 */
export const AMEND_ACTOR = "goal-amend";
/** ③ 的**输入面**：`check --stale-pass`（本文件 CLI 的旗标，全文唯一）。一条 AC 的 criterion 若读的是
 *  这个读数，它的真值就是【冻结population 此刻有没有为假的 AC】这一命题的派生量 —— 而那个命题的
 *  主体population 与唯一执行者都是 ③（`computeGoalGaps` 的第三个分支读到本函数的消费者）。
 *  见 `readsFrozenPopulation`。 */
export const FROZEN_POPULATION_FLAG = "--stale-pass";
/** 一条 criterion 是否**读的就是 ③ 的输入面**（`check --stale-pass`）。
 *
 *  为什么需要这个谓词（gap-ac242-derived-criterion-double-judged-and-amendment-unguarded 缺陷①）：
 *  同一句真相——「冻结population 中有一条 AC 此刻为假」——被**两个判官**判成两个主体：③ 正确地把它
 *  路由给那条**为假的 AC**（AC-203，已有 owner ⇒ in-progress），而 ② 常设不变式分支读到 AC-242
 *  自己的判据为红 ⇒ 为 **AC-242 立案**。AC-242 的复绿条件不在它自己的域内（它唯一的出口是把那条
 *  冻结 AC 变真），故 ② 为它立的每一条任务，其 DoD 都结构上只能由**另一条 AC 的 owner** 关闭 ——
 *  每轮一条永远关不掉的任务。⇒ 真值**派生自 ③ 主体population** 的常设判据，不得被 ② 独立立案。
 *
 *  判定**按位置**（硬规则 2）：输入不是散文，是【可执行的判据文本】本身 —— 旗标出现在判据里就是
 *  「这条判据会去读那个读数」，不是「某处提到过」。要求**成词**出现（前后是空白/引号/行界），
 *  故 `echo --stale-pass-notes` 这类子串不算。
 *
 *  ⛔ 误判的代价是**有界的**：它只会让 ② 把立案让给 ③ ——而 ③ 正是那个读数的拥有者；且 ② 只在
 *  ③ **本轮的读数为 `violated`**（即派生条件确实成立）时才让（见 goal-driver 的 `derived-routed`），
 *  读不到 / 未评估时**照旧立案**，因此闸不会恒不开。 */
export function readsFrozenPopulation(criterion: unknown): boolean {
  const s = typeof criterion === "string" ? criterion : "";
  return s.split(/[\s"'`;|&()]+/).includes(FROZEN_POPULATION_FLAG);
}
/** 一条 criterion 的**内容指纹**（规范化空白后 sha256 的前 16 个十六进制位）。
 *
 *  用途（同一任务缺陷②）：「对一条已 achieved 的 AC 修订 criterion」后，那条 AC 既有的轮转 verdict
 *  说的**不再是当前这条判据**。判定面因此不能把它计进 `verifiedFresh`（那是「查过且全好」，而这里
 *  「查过的不是这一版」），也不能计进 `failing`（那是对当前判据下断言）⇒ 独立取值
 *  `amendedUnverified`。落账端（`sweepFrozen`）把本指纹写进事件的 `payload.criterionHash`，
 *  判定端（`checkStalePass`）逐条比对。
 *
 *  ⛔ 规范化空白（把连续空白压成单个空格再 trim）：`goal-store write` 会重排整份 frontmatter，
 *  故纯排版变化不得被读成「判据被改过」——那会让每条 AC 每次写入都被判修订、空跑一轮（成本）。
 *  而**语义**变化（增删维度、换判据）必然改变非空白文本 ⇒ 仍被捕获。 */
export function criterionFingerprint(criterion: unknown): string {
  const s = typeof criterion === "string" ? criterion : "";
  return createHash("sha256").update(s.replace(/\s+/g, " ").trim(), "utf8").digest("hex").slice(0, 16);
}
/** Rotation cadence: an AC is eligible for re-verification once its last RECORDED verification is
 *  older than this. ⛔ Not a verdict threshold — eligibility, i.e. "when is looking again worth the
 *  cost" — and it is what bounds the steady-state cost (see the block comment above). */
export const DEFAULT_SWEEP_MIN_AGE_MS = 60 * 60 * 1000;
/** Criteria per invocation (the hard cap; the wall budget below can stop it earlier). */
export const DEFAULT_SWEEP_BUDGET = 6;
/** Budget on the wall clock an invocation may accumulate before it stops STARTING criteria — so the
 *  driver's round is not stalled by an unbounded number of slow criteria. ⚠️ It is checked BETWEEN
 *  criteria, never during one (see `sweepFrozen` and the header bound): the worst-case wall clock of
 *  an invocation is therefore `min(budget × T, wallMs + T)`, ⛔ NOT `min(budget × T, wallMs)`. */
export const DEFAULT_SWEEP_WALL_MS = 30_000;
/** An AC whose last RECORDED verdict is `fail` becomes eligible again at `minAgeMs / this` — i.e. a
 *  failure is re-checked sooner than a pass. Two reasons, both concrete:
 *   · the state you want to watch is the FAILING one (the mechanism exists to catch rot; a fail is
 *     the reading that can flip either way, a pass is the resting state), and
 *   · it BOUNDS a transient: when a criterion is re-scoped/fixed, the rotation re-runs it within one
 *     driver round instead of waiting out the full `minAgeMs`, so a fail recorded by the previous
 *     criterion version stops being the ledger tail — and stops holding AC-241 red — promptly.
 *  ⛔ This does NOT raise the cost bound: eligibility only ORDERS the candidates, and each invocation
 *  still runs at most `budget` criteria / `wallMs` (a persistently failing set can at most crowd out
 *  the same budget, never exceed it). */
export const DEFAULT_FAIL_RECHECK_DIVISOR = 6;
/** The JUDGMENT's freshness bound: a frozen AC whose last recorded verification is older than this
 *  has an UNKNOWN current truth and is reported in `staleUnverified` — ⛔ never silently counted as
 *  fine (hard rule 3b). Deliberately ≫ the rotation period: a tight bound would flap red/green as
 *  the rotation sweeps; 4× the period leaves room for a rotation that is merely behind, while still
 *  being finite. */
export const DEFAULT_STALE_PASS_MAX_AGE_MS = 4 * 60 * 60 * 1000;
// ⛔ `SWEEP_CRITERION_TIMEOUT_MS` USED TO LIVE HERE and is deliberately GONE
// (gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout). It was a 60_000 literal
// whose own comment claimed it was "the SAME value `runAcceptance` defaults to ... one literal, not
// two" — while the repo actually carried FIVE copies, and its presence here is exactly what made the
// goal path bypass the DIR-046 configuration surface (`QUAY_ACCEPTANCE_TIMEOUT_MS` / gates
// `timeoutMs` / `--timeout`): the sweep read its own private constant instead of the resolved one.
// Removing it is the fix, not a cleanup: the sweep now takes the deadline from
// `resolveAcceptanceTimeoutMs()`, the same call the other three goal entry points use.

/** One `gate:"goal"` ledger row, reduced to the fields a rotation judgment needs.
 *  `criterionHash` = the criterion fingerprint the writer verified (`payload.criterionHash`),
 *  empty string when the event predates the amendment gate or carries none — see
 *  `checkStalePass`, where "no fingerprint" is read as「不知道这条 verdict 针对哪一版判据」,
 *  ⛔ never as "it matches the current one" (hard rule 3b: 读不懂输入不得伪装成合格). */
type GateTail = { at: string; verdict: string; actor: string; reason: string; criterionHash: string };

/**
 * Per-record ledger TAILS in ONE pass: `last` = the most recent `gate:"goal"` event for the id;
 * `lastSweep` = the most recent one written by the ROTATION (`actor` ∈ {`SWEEP_ACTOR`, `AMEND_ACTOR`}).
 * Two maps because they answer two different questions — "what does the ledger say" vs "has the
 * rotation actually looked at this recently" — and collapsing them would make a rotation-written
 * verdict indistinguishable from a per-round-loop one (hard rule 4b: the tail is read as a proxy for
 * current truth, so who wrote it and when is part of the reading, not decoration).
 *
 * ⚠️ `AMEND_ACTOR` counts as a rotation writer ON PURPOSE: the amendment dry-run IS a re-verification
 * (it runs the criterion and records the verdict) — the only difference is WHY this one was picked.
 * Excluding it would make an amendment-triggered verdict invisible to the judgment it exists to feed.
 */
function gateTails(goalDir: string): { last: Map<string, GateTail>; lastSweep: Map<string, GateTail> } {
  const last = new Map<string, GateTail>();
  const lastSweep = new Map<string, GateTail>();
  const logPath = path.join(path.dirname(goalDir), ".quay", "gate-events.jsonl");
  let events;
  try {
    events = queryGateEvents(logPath, { gate: "goal" });
  } catch {
    return { last, lastSweep }; // unreadable/missing ledger ⇒ no tails (never crash a read)
  }
  for (const ev of events) {
    const id = String(ev.pipeline_id ?? ev.item_id ?? "");
    if (!id) continue;
    const payload = (ev.payload ?? {}) as Record<string, unknown>;
    const row: GateTail = {
      at: String(ev.timestamp ?? ""),
      verdict: String(ev.verdict ?? ""),
      actor: String(ev.actor ?? ""),
      reason: typeof payload.reason === "string" ? payload.reason : "",
      criterionHash: typeof payload.criterionHash === "string" ? payload.criterionHash : "",
    };
    last.set(id, row); // append order = on-disk order ⇒ the LAST matching event wins
    if (row.actor === SWEEP_ACTOR || row.actor === AMEND_ACTOR) lastSweep.set(id, row);
  }
  return { last, lastSweep };
}

/**
 * The judgment `check --stale-pass` returns. Enumerated, never booleanized (hard rule 3):
 * `failing` and `staleUnverified` are the two DIFFERENT answers to "is this AC still true" —
 * the first is "verified false", the second is "we have not looked recently enough to say".
 * Collapsing them would make "no longer true" and "unknown" share an output shape, which is exactly
 * the confusion this task exists to remove (hard rule 3b).
 */
export interface StalePassReading {
  /** Achieved ∧ criterion non-empty ∧ NOT in `inAchievedReverifyScope` — the population that
   *  no other mechanism re-runs. */
  frozenScope: number;
  evaluated: boolean;
  /** Verified CURRENT truth is false: either the rotation recorded a fail within `maxAgeMs`, or the
   *  last recorded verdict (by anyone) is a fail. ⛔ This is the bucket that must never be silent. */
  failing: string[];
  /** Last recorded verdict is a pass, but no ROTATION verdict within `maxAgeMs` — current truth
   *  UNKNOWN. Reported so the coverage gap is visible; ⛔ not a pass (hard rule 3b). */
  staleUnverified: string[];
  /** The last relevant verdict was NOT-EVALUATED — the criterion never got to state anything.
   *  Three causes, all recorded by the ONE mapping (`gate/acceptance-runner.ts`
   *  `verdictFromAcceptance`): the criterion itself declared it (exit 3 — this repo's convention,
   *  e.g. 「NOT-EVALUATED: carrier absent」), it was killed at its deadline, or its command could not
   *  be run at all (exit 126/127 / spawn failure). ⛔ NOT a failure: "I cannot evaluate this HERE"
   *  must not share an output shape with "this is false" — recording it as `fail` would be this
   *  file's own original sin (conflating what was recorded with what is true) in a new place.
   *  Reached from a ROTATION verdict (the sweep branch above) or from the last-recorded-verdict
   *  fallback when that tail is a `goal-cli`/MCP not-evaluated event.
   *  ⚠️ Consequence worth knowing: several frozen criteria read gitignored runtime carriers under
   *  `.quay/`, so they legitimately report NOT-EVALUATED in a transient worktree and PASS in the
   *  workspace that owns those carriers ⇒ the rotation is WORKSPACE-LOCAL and is driven from the
   *  workspace the goal ring drives (the production checkout), never from a worktree copy. */
  notEvaluated: string[];
  /** Rotation verified within `maxAgeMs` and it passed. */
  verifiedFresh: string[];
  /** The last ROTATION verdict for this AC cannot be tied to the criterion text on disk now
   *  (`payload.criterionHash` ≠ the current fingerprint, including the legacy case of an event
   *  carrying no fingerprint at all) ⇒ that verdict says nothing about the CURRENT criterion.
   *  A **third** answer, ⛔ sharing an output shape with neither `verifiedFresh` ("verified true") nor
   *  `failing` ("verified false") — both would be an assertion about a criterion nobody has run
   *  (hard rule 3b). Concretely this is the state
   *  gap-ac242-derived-criterion-double-judged-and-amendment-unguarded found AC-203 frozen in: its
   *  criterion was tightened while it was already `achieved`, its old `pass` kept counting as fresh,
   *  and the forbidden state therefore existed for ~1.5h BEFORE anything could detect it.
   *  ⛔ The tail fallback is deliberately SKIPPED for these (see `checkStalePass`): the recorded
   *  history — including a `fail` — is about the superseded text.
   *  ⚠️ Two causes, one bucket, and they resolve differently: a POSITIVE mismatch (the recorded
   *  fingerprint differs from the current one) makes `sweepFrozen` give the AC top eligibility
   *  (bypassing the age gate) and re-record it under `AMEND_ACTOR` in the same driver round; a legacy
   *  event with NO fingerprint rides the normal age rotation instead. */
  amendedUnverified: string[];
  /** No `gate:"goal"` event at all — never evaluated by anything. */
  neverGated: string[];
  rotation: {
    /** How many frozen ACs have EVER been touched by the rotation. 0 ⇒ the mechanism does not
     *  exist in this workspace, which is a NOT-EVALUATED state, ⛔ not "all fine". */
    sweptEver: number;
    lastSweepAt: string | null;
    minAgeMs: number;
    maxAgeMs: number;
  };
}

// Frontmatter keys the view-model owns explicitly; everything else in the frontmatter
// (any future field) is preserved verbatim — the same discipline as adr-store/document-store.
const OWNED_KEYS = new Set([
  "id", "title", "status", "kind", "goal", "criterion", "expect", "origin", "activatedAt", "statusLog",
  "labels", "posture", "supersedes", "superseded-by", "long-term", "fidelity", "timeoutMs",
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

// ── goal-staleness signal (gap-goal-status-stale-achieved-after-new-active-criterion-filed) ──────
// THE DEFECT. `write()` is PER-RECORD (this file's own structure, not an oversight): writing
// `AC-029 {goal: "GOAL-003", status: "active", …}` touches nothing on GOAL-003's record. So a GOAL
// whose `status` is `achieved` while a NEW undischarged criterion has since been filed under it
// reads EXACTLY like a genuinely closed GOAL — one `achieved` token for two different worlds
// (hard rule 3b). Measured 2026-09-14 in a third-party workspace (quay-fleet): GOAL-003 sat at
// `achieved` while AC-029/030/031/032 were filed `active` under it; only a human noticing the
// inconsistency corrected it. Nothing on any carrier distinguished the two states.
//
// ⛔ WHAT THIS IS NOT. It is NOT an auto-reopen. `plugin/scripts/goal-driver.ts:516`（and `:2243`）
// records 裁定 3 verbatim: 「不得反向翻转状态（achieved→active；激活归人）」 — activation is a human /
// authorized-actor decision, and a mechanism must never flip `achieved`→`active` on its own. A fix
// phrased as "detect a new AC and flip the GOAL back" would collide with that ruling head-on. So
// the GOAL record is NEVER written here — only a SIDE CARRIER (append-only, gitignored, the same
// shape as `goal-round.jsonl` / `*-sync.jsonl`): the reader can then SEE the divergence and a human
// can decide. Visibility, not automation.
//
// ⛔ AND IT IS NOT THE SUFFICIENCY VERDICT. Sufficiency (`covered` / `insufficient` /
// `not-evaluated`) answers 「do the ACs cover the goal's exit conditions」; this answers 「does the
// GOAL's `status` FIELD still reflect its children as they are now」. Different dimensions — folding
// them into one field would re-commit the very conflation (hard rule 3b) this task exists to remove.
//
// CARRIER SHAPE — one JSONL line per event, append-only, resolution is a SECOND line (the signal's
// audit trail is never deleted or rewritten, mirroring the `*-sync.jsonl` 「事件不删只追加状态」
// convention this repo already uses):
//   {"ts":"<iso>","event":"stale",   "goalId","staleSince","triggeringAcId","goalStatusAtTime"}
//   {"ts":"<iso>","event":"resolved","goalId","actor","reason"}
// A goal's state = the tail of its own event stream: `stale` with no later `resolved` ⇒ unresolved.
export const GOAL_STALENESS_SIGNAL_REL = ".quay/goal-staleness-signal.jsonl";

/** One unresolved signal's DISCRIMINATING fields — the four the task names, so a reader can see
 *  WHICH AC introduced the divergence (an enumeration, ⛔ never a bare boolean; hard rule 3). */
export interface GoalStalenessSignal {
  goalId: string;
  /** When the triggering write happened (this is the signal's own `ts`). */
  staleSince: string;
  /** The criterion whose write introduced the undischarged child. */
  triggeringAcId: string;
  /** The owning GOAL's status AS READ at that moment — recorded, not re-derived from today's file
   *  (a value re-derived later would answer a different question: hard rule 4 corollary 2). */
  goalStatusAtTime: string;
}

/**
 * The derived judgment for ONE goal. THREE-STATE, ⛔ never a boolean (hard rule 3b): a carrier that
 * exists but cannot be parsed must not read the same as "read it, there is nothing" — an
 * unreadable carrier is an INSTRUMENT failure, and reporting it as `clean` would be the exact
 * "读不懂 ⇒ 伪装成检查通过" shape this repo names as its most expensive failure mode.
 */
export interface GoalStaleness {
  state: "clean" | "stale" | "not-evaluated";
  /** The unresolved signals, in append order. Empty unless `state === "stale"`; enumerated so the
   *  output can name N and WHICH AC — not just "something is off". */
  signals: GoalStalenessSignal[];
  /** Present only for `not-evaluated`: why the carrier could not be read. */
  reason?: string;
}

/** `<workspaceRoot>/.quay/goal-staleness-signal.jsonl` — derived from goalDir the SAME way
 *  `ledgerEvidenceMap` derives the gate ledger (`dirname(goalDir)/.quay/…`), so both carriers
 *  follow one rule instead of two. */
function stalenessSignalPath(goalDir: string): string {
  return path.join(path.dirname(goalDir), GOAL_STALENESS_SIGNAL_REL);
}

/**
 * Append ONE signal line (never rewrites the carrier — the whole point of an append-only audit
 * trail). Returns the carrier path so a caller can report where the evidence landed.
 * ⛔ Best-effort: a failure to record visibility must never abort a record write that already
 * succeeded — but it IS reported on stderr, never swallowed (hard rule 3b).
 */
export function appendGoalStalenessSignal(goalDir: string, rec: GoalStalenessSignal): string {
  const file = stalenessSignalPath(goalDir);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: rec.staleSince, event: "stale", ...rec }) + "\n", "utf8");
  } catch (err) {
    console.error(
      `goal-store: could not append the goal-staleness signal for ${rec.goalId} (${rec.triggeringAcId}) — the record was written but the divergence is NOT recorded: ${(err as Error).message}`,
    );
  }
  return file;
}

/**
 * AC3 — the HUMAN CONFIRMATION PATH, and the ONLY writer of `resolved`. Deliberately NOT a new
 * verb: it is called by `write()` when a GOAL is written with `status: active` (the existing
 * 「确认重开」 path), so "activation is a human decision" (裁定 3) is preserved — the mechanism
 * records THAT a human decided, it never decides. Resolution APPENDS (never deletes/rewrites), so
 * the original signal stays auditable. Returns how many signals were resolved (enumerated).
 */
export function resolveGoalStaleness(
  goalDir: string,
  goalId: string,
  opts: { actor: string; reason?: string },
): number {
  const n = readGoalStalenessIndex(goalDir).byGoal.get(goalId)?.length ?? 0;
  if (n === 0) return 0;
  const file = stalenessSignalPath(goalDir);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(
      file,
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "resolved",
        goalId,
        actor: opts.actor,
        reason: opts.reason ?? "",
      }) + "\n",
      "utf8",
    );
  } catch (err) {
    console.error(
      `goal-store: could not append the goal-staleness RESOLUTION for ${goalId} — the reopen was written but the signal stays marked unresolved: ${(err as Error).message}`,
    );
    return 0;
  }
  return n;
}

/**
 * Read the carrier ONCE and fold each goal's event stream to its UNRESOLVED signals (append order
 * = on-disk order; a `resolved` line clears everything before it). `evaluated:false` means the
 * carrier exists but could not be parsed — the caller must surface that as `not-evaluated`, ⛔ not
 * as `clean`.
 */
function readGoalStalenessIndex(goalDir: string): {
  evaluated: boolean;
  reason?: string;
  byGoal: Map<string, GoalStalenessSignal[]>;
} {
  const byGoal = new Map<string, GoalStalenessSignal[]>();
  const file = stalenessSignalPath(goalDir);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    // ENOENT = the carrier does not exist ⇒ no signal has ever been recorded ⇒ a definite "clean".
    // Anything else (EACCES, EISDIR) means we could NOT read it — a different answer.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { evaluated: true, byGoal };
    return { evaluated: false, reason: `${file}: ${(err as Error).message}`, byGoal };
  }
  for (const [i, line] of raw.split("\n").entries()) {
    if (line.trim() === "") continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      return { evaluated: false, reason: `${file}:${i + 1}: unparseable JSON (${(err as Error).message})`, byGoal };
    }
    const goalId = typeof rec.goalId === "string" ? rec.goalId : "";
    if (goalId === "") {
      return { evaluated: false, reason: `${file}:${i + 1}: no goalId`, byGoal };
    }
    if (rec.event === "resolved") {
      byGoal.delete(goalId);
    } else if (rec.event === "stale") {
      const arr = byGoal.get(goalId) ?? [];
      arr.push({
        goalId,
        staleSince: String(rec.staleSince ?? rec.ts ?? ""),
        triggeringAcId: String(rec.triggeringAcId ?? ""),
        goalStatusAtTime: String(rec.goalStatusAtTime ?? ""),
      });
      byGoal.set(goalId, arr);
    } else {
      // An event kind this reader does not know ⇒ it cannot say what the stream means (hard rule
      // 3b). Fail the READ, ⛔ never silently skip the line and report `clean`.
      return { evaluated: false, reason: `${file}:${i + 1}: unknown event ${JSON.stringify(rec.event)}`, byGoal };
    }
  }
  return { evaluated: true, byGoal };
}

/** The derived staleness judgment for ONE goal id (the exported single-goal reader). */
export function readGoalStaleness(goalDir: string, goalId: string): GoalStaleness {
  const idx = readGoalStalenessIndex(goalDir);
  if (!idx.evaluated) return { state: "not-evaluated", signals: [], reason: idx.reason };
  const signals = idx.byGoal.get(goalId) ?? [];
  return { state: signals.length > 0 ? "stale" : "clean", signals };
}

/** The owning GOAL's status AS STORED, or null when the record is absent / unreadable / carries no
 *  status. Read-only: ⛔ this never writes the GOAL's record (see the section header — AC4). */
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
  /** 本判据自己的运行期限（毫秒）。`quay goal gate` / MCP `goal_gate` 优先读它，其次
   *  `QUAY_ACCEPTANCE_TIMEOUT_MS`，再次默认值（gap-goal-gate-verdict-single-mapping-not-evaluated）：
   *  在此之前 goal 路径把 60000 写死，而超时判词却叫读者去调 gates.yml —— 那条建议在这条路径上
   *  不起作用（goal 既不读 `extra.acceptance` 也不读 gates.yml）。⛔ 非「有限正数」的值被忽略而非
   *  强转（`spawnSync({timeout: NaN})` 等于「无期限」，一个笔误会把闸门关掉）。 */
  timeoutMs?: number;
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
  /** The record's own criterion deadline (ms), if it declares one — read by the two goal gate
   *  entry points via `resolveAcceptanceTimeout` (see GoalFrontmatter.timeoutMs). */
  timeoutMs: unknown;
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
  /** Derived (never stored, never mtime): whether this GOAL's own `status` field may no longer
   *  reflect its children — a criterion was filed under it WHILE it read `achieved`
   *  (gap-goal-status-stale-achieved-after-new-active-criterion-filed). Present on GOAL records
   *  only. ⛔ Deliberately NOT folded into `status`: the whole defect is that one `achieved` token
   *  covered both "genuinely closed" and "closed, then re-opened by a new child" (hard rule 3b). */
  staleness?: GoalStaleness;
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

// ── criterion failure attribution: THE single predicate ────────────────────────────────────────
//
// WHY THIS LIVES HERE (gap-criterion-attribution-write-gate-at-birth). "This failure exit writes no
// cause" is now asked at TWO surfaces: the shrink-only RATCHET over `goals/AC-*.md`
// (plugin/scripts/criterion-failure-attribution-check.ts) and the WRITE GATE below (which refuses to
// let a new criterion CARRY such an exit into active in the first place). Two implementations of one
// judgment drift — that is not a style preference, it is measured: AC-243 exists precisely to pin one
// constant (the runner's zero-output template) to its producer, and the ratchet's own history is three
// successive blind spots (the direct form, the trailing computed form, the implicit-exit class), each
// of which was fixed in ONE detector while the other surface kept the old reading.
//
// DIRECTION OF THE DEPENDENCY: product → plugin, never the reverse. `plugin/scripts/goal-driver.ts`
// and `plugin/scripts/meta-driver.ts` already import this module; nothing under `packages/quay/`
// imports `plugin/scripts/`. So the predicate lands HERE and the checker imports it — one impl.
//
// WHAT IT ENUMERATES (hard rule 2 — position, not keyword). For a criterion (a SHELL string whose
// heredocs are usually python), LINE BY LINE:
//   · a FAILURE-EXIT line = matches the direct forms (`sys.exit(1)` / `exit 1`, incl. the computed
//     `sys.exit(1 if bare else 0)`), OR is an exit CALL whose argument ends with `else <nonzero>`
//     (`sys.exit(0 if ok else 1)` — see hasTrailingComputedFailureExit for why that half is a depth
//     scan, not a regex), OR — when the criterion carries no explicit exit at all — a status-bearing
//     segment that inherits a silent non-zero (see the IMPLICIT-EXIT note on implicitFailureExitLines)
//   · an ATTRIBUTED line = also matches `stderr` / `>&2` / `console.error`
//   BARE = failure-exit ∧ ¬attributed.
//
// THREE-STATE OUTPUT (hard rule 3b — 读不懂输入 ≠ 合格). `evaluateCriterionAttribution` returns
// `evaluated:false` (with an `error`) when it cannot read its input at all — never conflated with
// `evaluated:true, bare: []`. The ratchet's own CLI keeps its 0/1/3 vocabulary on top of the same
// distinction.

/** A failure exit, DIRECT forms: python `sys.exit(1)` / `exit(1)` (incl. the computed form
 *  `sys.exit(1 if bare else 0)` — it fails with no cause on its red branch), or shell `exit 1` in any
 *  position (incl. `|| exit 1`). `(?![\d])` keeps `exit(10)` / `exit(123)` out; `\b` keeps shell
 *  `exit 10` out.
 *
 *  ⚠️ Deliberately does NOT carry the *trailing* computed form (`sys.exit(0 if ok else 1)`, AC-245's
 *  shape). The reason is mechanical, not stylistic: the argument of such an exit contains `)`
 *  characters of its own — AC-245's is `0 if log and str(log[-1].get("reason") or "").strip() else 1` —
 *  so telling "the `)` that closes `exit(`" from "a `)` inside its argument" requires COUNTING nesting,
 *  which a JS regex cannot do. A nesting-capped regex would re-open exactly that hole for any deeper
 *  argument: a criterion one paren deeper would again read as "I can't parse this" ⇒ "clean", the
 *  hard-rule-3b shape. That form is matched by `hasTrailingComputedFailureExit` below. */
export const FAILURE_EXIT_RE = /(?:sys\.)?exit\s*\(\s*1(?![\d])|\bexit\s+1\b/;

/** The opener of an exit CALL whose argument can be inspected — `sys.exit(` / `exit(`. */
const EXIT_CALL_SRC = "(?:sys\\.)?exit\\s*\\(";

/** The *trailing* computed non-zero: the exit call's ARGUMENT ends with `else <nonzero-int>`. `[1-9]\d*`
 *  keeps the always-zero control `sys.exit(0 if ok else 0)` out; the `$`-anchored tail keeps
 *  `sys.exit(0) if x else 1` (where `else 1` is NOT an argument of the exit) out, because in that line
 *  the `)` after `0` closes the call and the scanned argument is just `0`. */
const TRAILING_ELSE_NONZERO_RE = /\belse\s*[1-9]\d*\s*$/;

/** True iff `code` contains an exit CALL whose argument ends with `else <nonzero>` — the trailing
 *  computed failure exit. Depth-counting (not regex) for the reason given on `FAILURE_EXIT_RE`.
 *
 *  ⛔ EVERY failure exit is examined, not just the last: a line legitimately carries more than one.
 *  ⛔ An exit call whose parentheses never balance (`exit(` with no matching `)`) yields NO verdict —
 *  it cannot be read, and the direct-form regex above still judges it on its own terms; this scanner
 *  never *clears* a line, only adds matches. */
export function hasTrailingComputedFailureExit(code: string): boolean {
  // A FRESH regex per call: a module-level `/g` regex carries `lastIndex` across calls, so this
  // function's own state would leak into the next line's judgment (a proxy量 whose failure mode is
  // silent — hard rule 4b). The scan is per-line and the regex is cheap.
  const opener = new RegExp(EXIT_CALL_SRC, "g");
  let m: RegExpExecArray | null;
  while ((m = opener.exec(code)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    let quote: string | null = null;
    for (; i < code.length; i++) {
      const c = code[i];
      if (quote !== null) {
        if (c === "\\" && quote !== "'") { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"') { quote = c; continue; }
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue; // unreadable call — never conflated with "no trailing computed exit"
    if (TRAILING_ELSE_NONZERO_RE.test(code.slice(m.index + m[0].length, i))) return true;
  }
  return false;
}

/** A failure exit in EITHER form — the widened predicate. Direct forms via `FAILURE_EXIT_RE`, the
 *  trailing computed form via `hasTrailingComputedFailureExit`. */
export function hasFailureExit(code: string): boolean {
  return FAILURE_EXIT_RE.test(code) || hasTrailingComputedFailureExit(code);
}

// ── THE IMPLICIT-EXIT CLASS (2026-09-12, gap-criterion-attribution-blind-to-silent-terminal-command) ─
//
// THE THIRD BLIND SPOT, and the one the two revisions above could not see AT ALL. Both of them ask a
// question about an `exit` statement: `FAILURE_EXIT_RE` looks for the direct forms, and
// `hasTrailingComputedFailureExit` scans an exit CALL's argument. A criterion that contains **no exit
// statement whatsoever** therefore matched NOTHING on every line ⇒ it never entered the enumeration ⇒
// it was never baselined ⇒ the ratchet read 31 ≤ 32, status=pass, exit 0 while the very AC it guards
// (AC-241) was red in the production ledger. Same shape as the AC-245 revision: "I cannot read this
// form" and "this criterion is clean" shared one output (硬规则 3b).
//
// WHAT THE FORM IS. In a shell script with no `exit`, the exit status is the status of the last
// command EXECUTED. So the failure exit is not written down anywhere — it is INHERITED from a trailing
// command. Measured on develop 2026-09-12: 13 in-domain criteria have this shape, and every one of
// them exits 1 with **zero bytes** on both streams when false:
//   · `node … get GOAL-001 >/dev/null 2>&1`            (AC-170 — the whole command's output discarded)
//   · `test "$(…)" -ge 27`                             (AC-171/178/195/197/208 — `test`/`[` are silent)
//   · `node … | grep -q 'GOAL-001'`                    (AC-174/176 — the pipeline's status IS grep's)
//   · `grep -qE A f && grep -qE B f`                   (AC-156; also AC-173/175/177)
//   · `test -f X && node … --json`                     (AC-225 — the SILENT branch is left of `&&`)
//
// THE RULE (position-based, 硬规则 2). A criterion with NO explicit failure exit ANYWHERE is examined
// at its **status-bearing statement** — the final logical statement, backslash continuations joined,
// because that is the only statement whose status can become the script's. Inside it, a top-level
// segment counts as the failure exit iff BOTH hold:
//   (a) it is a command that writes nothing on its FAILURE path — `test` / `[` / `grep` (see
//       SILENT_PREDICATE_RE), or the whole command has BOTH streams sent to /dev/null; and
//   (b) its failure PROPAGATES — it is the statement's last segment, or is followed by `&&`.
//       A segment followed by `||` is remediated (`grep -q X || { echo cause >&2; exit 1; }` must NOT
//       be flagged — it is the write gate's / the test's negative control), and `;` / `|` are handled
//       by (b)'s "last" case.
//
// ⛔ MEASURED OVER-REPORT, stated rather than hidden (the same discipline as ATTRIBUTION_RE's note).
// Two directions, both kept. A mechanical enumeration of develop's goals/ on 2026-09-12 gives:
// inDomain=95, explicit-class bareAcs=31 (the committed ratchet's set), implicit-class=13:
//   AC-156 AC-170 AC-171 AC-173 AC-174 AC-175 AC-176 AC-177 AC-178 AC-195 AC-197 AC-208 AC-225
//   · (a) `&&`-LEFT silent branches — the segment is flagged although a sibling segment sits to its
//     right. MEASURED: **5 of the 13** (AC-156, AC-173, AC-175, AC-177, AC-225), not the 2 named when
//     the task was filed (that count was taken over a different 14-member list). The direction is
//     kept because it is REAL: if the left branch is false the chain short-circuits and the script
//     exits 1 with zero output — AC-225's own shape, where `node … --json` on the right DOES write on
//     failure. That attribution is precisely what hid the defect: AC-228's ledger fail looked
//     attributable, and the attribution came from the right branch, saying nothing about the left one.
//   · (b) `grep -c`, whose no-match path prints `0` to stdout — which the runner DOES capture, so such
//     a line is arguably attributable, and flagging it is an over-report. Loosening the predicate to
//     "grep except -c" was rejected for the same reason ATTRIBUTION_RE is not widened to `echo`: the
//     safe direction is over-reporting. MEASURED SIZE OF THIS SUB-CLASS: **0** — a scan of all 95
//     in-domain criteria finds no flagged segment whose command word is `grep -c`.
// ⛔ `ATTRIBUTION_RE` is deliberately NOT touched: widening it (to `print`/`echo`) would manufacture
// false negatives on lines like `if echo x | grep -q y; then exit 1; fi`.
//
// ⛔ NOT APPLIED when an explicit failure exit exists anywhere: in that case the failure exit IS that
// statement, and the inherited status is dead code or is remediated by the explicit branch. This is
// the scoping, and it keeps the class DISJOINT from the explicit-form enumeration above.

/** A command whose FAILURE path writes nothing to either captured stream. `[` and `test` are silent on
 *  both outcomes; `grep` prints matches (only on success) to stdout and nothing on the no-match path.
 *  Position-based: the command must be the SEGMENT'S command word, so `node x | grep -q y` matches on
 *  its `grep -q y` segment and `if echo x | grep -q y; …` does not match on `echo`. */
const SILENT_PREDICATE_RE = /^(?:command\s+|!\s*)*(?:\[|test|grep)(?:\s|$)/;

/** stdout → /dev/null (`>`, `1>`, `>>`, `1>>`). */
const DEVNULL_OUT_RE = /(?:^|\s)(?:1?>|1?>>)\s*\/dev\/null(?:\s|$)/;

/** BOTH streams → /dev/null in one token (`&>`, `>&`). */
const DEVNULL_BOTH_RE = /(?:^|\s)(?:&>|>&)\s*\/dev\/null(?:\s|$)/;

/** stderr → /dev/null explicitly (`2>`, `2>>`). */
const DEVNULL_ERR_RE = /(?:^|\s)(?:2>|2>>)\s*\/dev\/null(?:\s|$)/;

/** `2>&1` — stderr follows stdout, so it is discarded too iff stdout already is. This is the COMMON
 *  idiom `>/dev/null 2>&1`, and requiring `2>` to literally name /dev/null would have missed it (it
 *  did, on the first measurement: AC-170 stayed invisible while its command runs exactly that idiom). */
const STDERR_FOLLOWS_STDOUT_RE = /(?:^|\s)2>&1(?:\s|$)/;

/** One top-level command segment of a status-bearing statement: its text and the operator that
 *  FOLLOWS it (`&&`, `||`, `|`, `;`, or null at the end). `start`/`end` are offsets into the joined
 *  statement, so a caller can map the segment back to the source LINE for the report. */
export interface Segment {
  text: string;
  start: number;
  end: number;
  nextOp: string | null;
}

/** Split a statement at TOP-LEVEL `&&`/`||`/`|`/`;` only. Quote-aware, and opaque to `$( … )` /
 *  `` ` … ` `` / `( … )` nesting: a `|` inside a command substitution is not a pipe of the statement
 *  (`test "$(node … list | grep -c …)" -ge 27` is ONE segment whose command is `test`). That opacity is
 *  the difference between reporting the command that actually determines the status and reporting a
 *  sub-command whose status the substitution absorbs. */
export function splitTopLevelSegments(stmt: string): Segment[] {
  const segs: Segment[] = [];
  let start = 0;
  let quote: string | null = null;
  let depth = 0;
  const push = (end: number, nextOp: string | null) => {
    const text = stmt.slice(start, end);
    if (text.trim() !== "") segs.push({ text: text.trim(), start, end, nextOp });
  };
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i];
    if (quote !== null) {
      if (c === "\\" && quote !== "'") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") { i++; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "$" && stmt[i + 1] === "(") { depth++; i++; continue; }
    if (c === "(") { depth++; continue; }
    if (c === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0) continue;
    if (c === "&" && stmt[i + 1] === "&") { push(i, "&&"); i++; start = i + 1; continue; }
    if (c === "|" && stmt[i + 1] === "|") { push(i, "||"); i++; start = i + 1; continue; }
    if (c === "|") { push(i, "|"); start = i + 1; continue; }
    if (c === ";") { push(i, ";"); start = i + 1; continue; }
  }
  push(stmt.length, null);
  return segs;
}

/** True iff this segment's FAILURE writes nothing the acceptance-runner captures — either it is a
 *  silent predicate command, or the whole command has both streams discarded to /dev/null. */
export function isSilentOnFailureSegment(seg: string): boolean {
  const s = seg.trim();
  if (s === "") return false;
  if (DEVNULL_BOTH_RE.test(s)) return true;
  if (DEVNULL_OUT_RE.test(s) && (DEVNULL_ERR_RE.test(s) || STDERR_FOLLOWS_STDOUT_RE.test(s))) return true;
  return SILENT_PREDICATE_RE.test(s);
}

/** The criterion's STATUS-BEARING statement: the final logical statement, with backslash continuations
 *  joined. Returns the joined text plus a per-character map back to the 1-based source LINE, so the
 *  report points at the line a reader can open. Deliberately NOT the whole script: with no `exit`, only
 *  the last statement executed can become the script's status, so earlier statements are not failure
 *  exits however silent their commands are. */
export function statusBearingStatement(criterion: string): { text: string; lineOf: number[] } | null {
  const logical: Array<{ text: string; lineOf: number[] }> = [];
  let text = "";
  let lineOf: number[] = [];
  const flush = () => {
    if (text.trim() !== "") logical.push({ text, lineOf });
    text = "";
    lineOf = [];
  };
  const rawLines = criterion.split("\n");
  for (let i = 0; i < rawLines.length; i++) {
    const masked = maskValueStrings(maskHashComments(rawLines[i]));
    const trimmed = masked.trim();
    const cont = trimmed.endsWith("\\");
    const piece = cont ? trimmed.slice(0, -1).trimEnd() : trimmed;
    if (piece === "" && !cont) { flush(); continue; }
    if (text !== "") { text += " "; lineOf.push(i + 1); } // the joining space belongs to the new line
    const base = text.length;
    text += piece;
    for (let k = 0; k < piece.length; k++) lineOf[base + k] = i + 1;
    if (!cont) flush();
  }
  flush();
  return logical.length === 0 ? null : logical[logical.length - 1];
}

/** An attribution: something the acceptance-runner captures (stderr) or the shell redirects to it.
 *
 *  ⚠️ KNOWN, MEASURED OVER-APPROXIMATION (2026-09-11): acceptance-runner.ts folds stderr FIRST and
 *  falls back to STDOUT, so `echo "cause"; exit 1` IS attributable — but `echo`/`console.log` are not
 *  matched here, so such lines read as BARE. Measured with the real enumeration: 7 of the 33 baselined
 *  ACs (AC-189/190/191/196/198/199/200) are bare ONLY via this class — i.e. the ratchet guards 33 where
 *  26 carry a genuinely silent failure exit.
 *  ⛔ Deliberately NOT widened to `echo`: `echo` is not a stream marker but a command name, so a line
 *  like `if echo x | grep -q y; then exit 1; fi` would lose a REAL bare exit — a false NEGATIVE, the
 *  harder error (hard rule 4). Over-reporting accuses an attributable criterion; under-reporting
 *  certifies a silent one. The conservative direction is kept, and its size is stated here rather than
 *  hidden. */
const ATTRIBUTION_RE = /stderr|>&2|console\.error/;

/** One bare (unattributed) failure exit, with the 1-based source line so both surfaces can NAME it. */
export interface BareLine {
  /** 1-based line number inside the criterion text. */
  line: number;
  /** The trimmed line (or, for an implicit exit, the offending top-level segment). */
  text: string;
  /** true ⇔ this line is an IMPLICIT failure exit: the criterion writes no `exit`, and this segment's
   *  inherited status IS the criterion's non-zero exit. Absent for the explicit forms. Reported so a
   *  reader can tell "the exit is written here and writes no cause" from "the exit is not written at
   *  all and this command's status becomes it" — two different repairs. */
  implicit?: boolean;
  /** true ⇔ this line is an ERREXIT ABORT: under `set -e`, this assignment's command substitution fails
   *  and ends the shell on this line, so every guard below it (and the cause it writes) is dead code.
   *  A THIRD repair, distinct from both above: guard the assignment (`|| true`) or move it into a
   *  condition — ⛔ not "write a cause here", which the criterion already does and cannot reach. */
  errexitAbort?: boolean;
}

/** Blank an unquoted `#`-to-end-of-line comment. `#` is the comment starter in BOTH shells and python,
 *  and a criterion is a shell string whose embedded heredocs are usually python — so one masker covers
 *  both. Quote-aware: `#` inside '…' / "…" / `…` is data, not a comment. ⛔ Strings are deliberately NOT
 *  masked HERE: unlike a C-style `//` slice, a shell criterion's quoted `bash -c "exit 1"` really does
 *  exit 1, so masking strings wholesale would manufacture false NEGATIVES — the harder error to notice
 *  (hard rule 4). `maskValueStrings` below masks ONLY the narrower value-position subset, for exactly
 *  that reason. */
export function maskHashComments(line: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== null) {
      if (c === "\\" && quote !== "'") {
        out += c;
        if (i + 1 < line.length) out += line[++i];
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "#") break;
    out += c;
  }
  return out;
}

/** Blank a quoted literal in VALUE position (`command:"exit 1"`, `cmd='exit 1'`) — the text is DATA
 *  handed to an API, not a command the criterion itself executes.
 *
 *  WHY THIS IS NOT A CONTRADICTION OF THE RULE ABOVE (2026-09-11, surfaced by AC-243): the exemption
 *  for quoted strings exists because `bash -c "exit 1"` really does exit 1. That case is *preserved*
 *  here: the quote is preceded by `c`, not by `:`/`=`, so it is still scanned and still BARE. What this
 *  masks is the strictly narrower shape where the quote is the VALUE of a `key:`/`key=` pair.
 *
 *  THE DEFECT IT FIXES (AC-243, real, found by the ratchet on develop's own new criterion): AC-243
 *  proves the runner's zero-output template by *invoking* it — `m.runAcceptance({command:"exit 1", …})`.
 *  AC-243's own failure exits all write stderr, so it is fully attributable and can never leave an
 *  unattributable ledger fail — yet the bare scan matched the `exit 1` inside that ARGUMENT STRING and
 *  reported the achieved, faithful AC-243 as a REGRESSION, blocking an unrelated task from landing. A
 *  detector that accuses an attributable criterion is itself an attribution defect (hard rule 3b).
 *
 *  ⛔ TWO LIMITS, both deliberate, neither silent:
 *   · A value string containing command substitution (`x="$(exit 1)"`, `` x=`exit 1` ``) EXECUTES and is
 *     therefore NEVER masked — masking it would manufacture a false negative.
 *   · Indirection a masker cannot follow (`c='exit 1'; eval "$c"`) becomes a false negative. Contrived,
 *     and the safe direction is over-reporting, not under-reporting. */
export function maskValueStrings(line: string): string {
  return line.replace(
    /([:=])([ \t]*)((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^'\\]|\\.)*'))/g,
    (m: string, sep: string, gap: string, lit: string) => {
      if (lit.includes("$(") || lit.includes("`")) return m;
      return sep + gap + " ".repeat(lit.length);
    },
  );
}

/** The IMPLICIT failure exits of `criterion` — the lines a reader must open to see why a criterion with
 *  no exit statement can exit non-zero with no cause. Empty when the criterion carries ANY explicit
 *  failure exit (see the ⛔ note above: the two classes are disjoint by construction), and empty when
 *  its status-bearing statement is a bare `exit 0` (an explicit exit determines the status; nothing is
 *  inherited, so there is no implicit failure exit to report). */
export function implicitFailureExitLines(criterion: string): BareLine[] {
  if (criterion.split("\n").some((l) => hasFailureExit(maskValueStrings(maskHashComments(l))))) return [];
  const stmt = statusBearingStatement(criterion);
  if (stmt === null) return [];
  if (/^exit\s+0\s*$/.test(stmt.text.trim())) return [];
  const out: BareLine[] = [];
  const segs = splitTopLevelSegments(stmt.text);
  segs.forEach((s, idx) => {
    const isLast = idx === segs.length - 1;
    // (b) failure must PROPAGATE: last segment, or followed by `&&`. `||` remediates (the negative
    // control `grep -q X || { echo cause >&2; exit 1; }` must stay clean).
    if (!(isLast || s.nextOp === "&&")) return;
    if (!isSilentOnFailureSegment(s.text)) return;
    // Map the segment's start offset back to a source line. The offset may land on the joining space
    // between two continued lines (which has no line of its own), so walk BACK to the nearest mapped
    // character — that is the line the segment belongs to.
    let line = 0;
    for (let k = s.start; k >= 0; k--) {
      if (stmt.lineOf[k] !== undefined) { line = stmt.lineOf[k]; break; }
    }
    out.push({ line, text: s.text, implicit: true });
  });
  return out;
}

/** True iff this criterion LINE is a failure exit that writes no cause. Pure — the testable core.
 *  Judged BY POSITION (hard rule 2): a `#`-comment that merely mentions `exit 1` is not a failure exit,
 *  and a quoted value (`command:"exit 1"`) is data, not one either (see maskValueStrings). */
export function isBareFailureExitLine(line: string): boolean {
  const code = maskValueStrings(maskHashComments(line));
  return hasFailureExit(code) && !ATTRIBUTION_RE.test(code);
}

// ── THE ERREXIT-ABORT CLASS (2026-09-21, gap-ac241-errexit-abort-silent-failures-have-no-predicate) ─
//
// THE THIRD CLASS, and the first one that is NOT about an `exit` statement at all. Classes ① and ②
// both ask "where does the non-zero status come from?" — ① reads written exits, ② reads the inherited
// status of a criterion that writes none. This class asks a different question: **the criterion writes
// its cause correctly, and the shell never reaches the line that writes it.**
//
// WHAT THE FORM IS. Under `set -e`, an ASSIGNMENT whose value is a command substitution
// (`LINE="$(grep … | head -1)"`) takes the substitution's exit status, and a non-zero status ENDS THE
// SHELL on that line. Every guard below it — `if [ -z "$LINE" ]; then echo "CAUSE=…" >&2; exit 1; fi` —
// is dead code. The failure is silent not because the criterion forgot a cause but because errexit
// aborted before the branch that writes one could run. Measured 2026-09-20 in the production ledger:
// AC-286's criterion carries THREE attributed failure exits and still died with ZERO bytes on both
// streams, so the runner wrote its zero-output template and AC-241 went red for the 6th time. Minimal
// reproduction (this repo, 2026-09-21):
//   $ bash -c 'set -euo pipefail; x="$(grep NO-SUCH /dev/null | head -1)"; if [ -z "$x" ]; then echo "CAUSE=x" >&2; exit 1; fi'
//   EXIT=1   ← zero output: the guard and its CAUSE never ran
//
// WHY THE EARLIER CLASSES CANNOT SEE IT. ① judges LINES CONTAINING a failure exit — this line contains
// none, so it reads clean by construction. ② judges the status-bearing statement of a criterion with NO
// exit statement anywhere, and it sits behind `if (out.length === 0)` — the mutex documented as making
// the two classes "disjoint by construction". The abort lies in the SEAM: a criterion that is fully
// attributed AND still silent. That is why five successive repairs (bare exits → trailing computed →
// implicit terminal → birth gate → stock cleanup) each held and AC-241 still went red.
//
// THE RULE (position-based, 硬规则 2). Walk the lines in order, tracking whether errexit is currently ON
// and whether the line sits in an `if`/`elif`/`while`/`until` CONDITION — POSIX exempts conditions from
// errexit, which is exactly what makes `if ! LINE=$(…)` a correct repair and not a bug. A line is an
// errexit-abort silent exit iff ALL hold:
//   · errexit is ON at that line (`set -e…` / `set -o errexit` on, `set +e…` / `set +o errexit` off);
//   · the line is an ASSIGNMENT (`NAME=` / `export NAME=`) whose VALUE holds a command substitution —
//     the value is what the shell evaluates, so a substitution anywhere else on the line
//     (`echo "$(cmd)"`, whose status is `echo`'s) is NOT this class;
//   · the statement is UNGUARDED: no `||` on it. `LINE="$(grep … || true)"` and `LINE="$(…)" || true`
//     both prevent the abort (measured, both exit 0). `&&` is deliberately NOT remediation — same
//     choice class ② makes, same reason: a silent left branch of `&&` short-circuits and, as the
//     status-bearing statement, exits non-zero with zero output.
// ⛔ ATTRIBUTION ON THE SAME LINE DOES NOT CLEAR IT, and that is not an oversight: measured,
//   `X="$(false)"; echo "CAUSE=x" >&2; exit 1` still exits 1 with ZERO output — errexit aborts at the
//   assignment, so that `echo` is as dead as any guard below it. Clearing here on ATTRIBUTION_RE would
//   manufacture precisely the false negative this class exists to remove (硬规则 4).
//
// MEASURED OVER-REPORT, stated rather than hidden (the discipline ATTRIBUTION_RE and class ② follow).
// Two directions, both kept, both sized by a scan of develop's 155 in-domain criteria on 2026-09-21:
//   · a pipeline inside the substitution WITHOUT `pipefail` (`set -e; X="$(false | head -1)"`) does not
//     abort — measured, exit 0 — because a pipeline's status is its last command's. The predicate keys
//     on errexit alone and flags it. SIZE: 0 (every flagged AC sets `set -euo pipefail`).
//   · `X="$(false)" && echo ok` does not abort when a later statement succeeds (measured, exit 0), and
//     IS flagged. SIZE: 0 (no in-domain criterion carries that shape).

/** errexit turned ON by this line: `set -e`, `set -euo pipefail`, `set -ue -o pipefail`, `set -o errexit`. */
const ERREXIT_ON_RE = /^(?:command\s+)?set\s+(?:-\w*e\w*(?:\s|$)|-\w*o\s+errexit(?:\s|$))/;
/** errexit turned OFF by this line: `set +e`, `set +o errexit`. */
const ERREXIT_OFF_RE = /^(?:command\s+)?set\s+(?:\+\w*e\w*(?:\s|$)|\+\w*o\s+errexit(?:\s|$))/;

/** A line that OPENS a condition, whose commands POSIX exempts from errexit. `!` alone included: `! cmd`
 *  is a condition context. */
const CONDITION_OPENER_RE = /^(?:if|elif|while|until|!)(?:\s|$)/;
/** …and the token that CLOSES it. A condition may span lines (`if [ -f x ]` / `&& [ -f y ]; then`), so
 *  the region is tracked rather than judged per line. */
const CONDITION_END_RE = /(?:^|[;&|\s])(?:then|do)\s*$/;

/** A line whose statement is an ASSIGNMENT — `NAME=`, `export NAME=`, `readonly NAME=`. `(?!=)` keeps a
 *  comparison (`NAME==`) out. */
const ASSIGNMENT_PREFIX_RE = /^(?:export\s+|readonly\s+|declare\s+-\w+\s+)?[A-Za-z_][A-Za-z0-9_]*=(?!=)/;

/** A command substitution — `$( … )` or `` ` … ` `` — anywhere it can EXECUTE. */
const CMD_SUBST_RE = /\$\(|`/;

/** True iff `text` leaves a shell construct OPEN: an unterminated quote, an unbalanced `$( … )` or
 *  backtick, or a trailing `\` continuation. Used to join the physical lines of ONE logical statement,
 *  so a guard written on a LATER line of a multi-line assignment
 *  (`LINE="$(grep …` / `"$f" | head -1 || true)"`) is still seen — read per physical line, such a
 *  criterion reads BARE although it is guarded, i.e. the detector accuses a clean criterion (硬规则 3b,
 *  the harder error to notice). */
function statementLeavesOpen(text: string): boolean {
  let quote: string | null = null;
  let depth = 0;
  let ticks = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\" && quote !== "'") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") { i++; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === "`") { ticks++; continue; }
    if (c === "$" && text[i + 1] === "(") { depth++; i++; continue; }
    if (c === ")") depth = Math.max(0, depth - 1);
  }
  return quote !== null || depth !== 0 || ticks % 2 !== 0 || /\\\s*$/.test(text);
}

/** The errexit-abort silent exits of `criterion` (see the class documentation above). Pure; `[]` for a
 *  criterion that never enables errexit, or one whose every such assignment is guarded. */
export function errexitAbortSilentExits(criterion: string): BareLine[] {
  const out: BareLine[] = [];
  const lines = criterion.split("\n");
  let errexit = false;
  let condPending = false;
  for (let i = 0; i < lines.length; i++) {
    const code = maskHashComments(lines[i]).trim();
    if (condPending) {
      if (CONDITION_END_RE.test(code)) condPending = false;
      continue;
    }
    if (code === "") continue;
    if (CONDITION_OPENER_RE.test(code)) {
      // A single-line `if …; then` opens and closes on the same line; a multi-line one holds the region
      // open until its `then`/`do`.
      if (!CONDITION_END_RE.test(code)) condPending = true;
      continue;
    }
    if (ERREXIT_OFF_RE.test(code)) { errexit = false; continue; }
    if (ERREXIT_ON_RE.test(code)) { errexit = true; continue; }
    if (!errexit) continue;
    if (!ASSIGNMENT_PREFIX_RE.test(code)) continue;
    const startLine = i + 1;
    // Join the rest of THIS logical statement before judging its guards — the guard may be written on a
    // later physical line of a multi-line value.
    let stmt = code;
    while (statementLeavesOpen(stmt) && i + 1 < lines.length) {
      i += 1;
      stmt += "\n" + maskHashComments(lines[i]);
    }
    const eq = code.indexOf("=");
    if (!CMD_SUBST_RE.test(code.slice(eq + 1))) continue;
    if (stmt.includes("||")) continue;
    out.push({ line: startLine, text: code, errexitAbort: true });
  }
  return out;
}

/** Every bare failure exit of a whole criterion — the explicit forms line by line, the implicit-exit
 *  class when no explicit failure exit exists, and the errexit-abort class. Pure; `[]` for a clean
 *  criterion.
 *
 *  ⛔ THE ERREXIT CLASS IS NOT BEHIND `out.length === 0`. That mutex is exactly what made the implicit
 *  class miss AC-286 — a criterion can carry attributed explicit exits AND still die with zero output,
 *  so the third class must be ADDITIVE. The mutex is kept for class ② alone, where it is correct (a
 *  written exit determines the status; nothing is inherited). */
export function bareFailureExitsOfCriterion(criterion: string): BareLine[] {
  const out: BareLine[] = [];
  criterion.split("\n").forEach((line, i) => {
    if (isBareFailureExitLine(line)) out.push({ line: i + 1, text: line.trim() });
  });
  if (out.length === 0) out.push(...implicitFailureExitLines(criterion));
  // A line can be BOTH an explicit bare exit and an errexit abort; it is one site, so count it once.
  const already = new Set(out.map((b) => b.line));
  for (const b of errexitAbortSilentExits(criterion)) {
    if (!already.has(b.line)) out.push(b);
  }
  return out;
}

/** The three-state verdict of the ONE predicate (硬规则 3b). `evaluated:false` is a DISTINCT value —
 *  never conflated with `evaluated:true, bare:[]` ("I read it, it is clean"). */
export interface CriterionAttributionVerdict {
  /** false ⇒ NOT-EVALUATED: the input could not be read at all. */
  evaluated: boolean;
  /** why it could not be read (only when `evaluated` is false). */
  error?: string;
  /** the bare failure exits, in source order (only meaningful when `evaluated` is true). */
  bare: BareLine[];
}

/** Judge an arbitrary criterion value — the surface both consumers share. `unknown` (not `string`)
 *  because the write gate is handed whatever the frontmatter parse produced: a non-string or an
 *  empty/whitespace-only criterion is NOT-EVALUATED, and that must never render as "clean". */
export function evaluateCriterionAttribution(criterion: unknown): CriterionAttributionVerdict {
  if (typeof criterion !== "string") {
    return {
      evaluated: false,
      error: `criterion is not a string (got ${criterion === null ? "null" : typeof criterion}) — a criterion is the runnable command that verifies the record`,
      bare: [],
    };
  }
  if (criterion.trim() === "") {
    return {
      evaluated: false,
      error: "criterion is empty (or whitespace-only) — there is nothing to judge, which is not the same as judging it clean",
      bare: [],
    };
  }
  return { evaluated: true, bare: bareFailureExitsOfCriterion(criterion) };
}

/** Render the bare failure exits for a human-facing rejection: the LINE NUMBERS and the offending
 *  line text (hard rule 3 — an enumeration, not a boolean). */
export function formatBareFailureExits(bare: BareLine[]): string {
  return bare
    .map((b) => {
      const kind = b.errexitAbort
        ? " (errexit abort — under `set -e` this assignment's command substitution ends the shell here, so the cause written below never runs; guard it with `|| true` or move it into a condition)"
        : b.implicit
          ? " (implicit — this command's status becomes the criterion's)"
          : "";
      return `line ${b.line}${kind}: ${b.text}`;
    })
    .join("; ");
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
 * Attach the derived staleness judgment to every GOAL row in `all` (gap-goal-status-stale-achieved-
 * after-new-active-criterion-filed AC2). Reads the carrier ONCE for the whole list, ⛔ not per row —
 * the same "compute over the FULL pre-filter list" discipline `annotateGoalProgress` uses, so a
 * `?kind=criterion` filter can never change what a goal's staleness reads as.
 *
 * Set on GOAL records ONLY: staleness is a claim about a GOAL's own `status` field, and an AC
 * record carries no such field (attaching it there would be a value with no subject).
 */
function annotateGoalStaleness(all: GoalViewModel[], goalDir: string): void {
  if (!all.some((g) => isGoalId(String(g.id)))) return;
  const idx = readGoalStalenessIndex(goalDir);
  for (const g of all) {
    if (!isGoalId(String(g.id))) continue;
    if (!idx.evaluated) {
      // Unreadable carrier ⇒ EVERY goal reads `not-evaluated`, never `clean` (hard rule 3b).
      g.staleness = { state: "not-evaluated", signals: [], reason: idx.reason };
      continue;
    }
    const signals = idx.byGoal.get(String(g.id)) ?? [];
    g.staleness = signals.length > 0 ? { state: "stale", signals } : { state: "clean", signals: [] };
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
 * AC-216 reverify scope of an ACHIEVED AC: in scope ⟺ (it is under an ACTIVE goal) OR (it explicitly
 * declares `long-term: true`). A long-term AC is a STANDING guarantee — it stays under re-verification
 * after its GOAL is achieved/closed; an undeclared one leaves with its GOAL (cost boundary, ⛔ not an
 * indiscriminate widening).
 *
 * Defined HERE (Core) so that EVERY consumer reads ONE definition — I5's own enumeration, the goal
 * driver's per-round GATE set, and the goal driver's gap-FILING set. A second copy in any consumer
 * drifts and re-opens the hole this closes: the scope was declared here but wired only into I5, so the
 * gate loop (which walked `activeGoals` only) froze the ledger tail of every out-of-active-goal
 * long-term AC at its last pre-closure verdict, and `computeGoalGaps` (which counted active ACs only)
 * never produced a work signal for one (gap-meta-computegoalgaps; hard rule 5b — "fixed in one place"
 * is not "there is only one place").
 */
export function inAchievedReverifyScope(
  ac: { goal?: unknown; longTerm?: unknown },
  activeGoalIds: ReadonlySet<string>,
): boolean {
  return activeGoalIds.has(String(ac.goal ?? "")) || ac.longTerm === true;
}

/**
 * One ANNOTATED row of the reverify-scope reading (gap-closed-goal-acs-leave-reverify-scope-standing-
 * invariants-undeclared AC1/AC4). `goal`/`goalStatus`/`longTerm` are the DISCRIMINATING fields:
 * `inAchievedReverifyScope` has exactly TWO branches (under an ACTIVE goal, OR declared long-term),
 * and a bare id list cannot tell them apart — so a reader could see that an AC left the scope but not
 * WHY, and could not audit the leaving set against the ruling (hard rule 3: enumerate, don't boolean).
 */
export interface ReverifyScopeEntry {
  id: string;
  goal: string;
  /** The owning GOAL's CURRENT status; `absent` when no GOAL record carries that id. ⛔ Never "" —
   *  hard rule 6: a missing value must not be shaped like a present one. */
  goalStatus: string;
  longTerm: boolean;
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
      timeoutMs: frontmatter.timeoutMs,
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
    const vm = toViewModel(frontmatter as GoalFrontmatter, body, ledgerEvidenceMap(goalDir), updatedAt);
    // Same derived judgment `list()` attaches, for the single-record reader (goal_get / `goal show`
    // / write()'s own return) — ⛔ no second implementation, `annotateGoalStaleness` is the ONE.
    annotateGoalStaleness([vm], goalDir);
    return vm;
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
    // …and their staleness is derived from the side carrier, over the SAME full list (a filter must
    // never be able to change what a goal's staleness reads as — hard rule 3b).
    annotateGoalStaleness(all, goalDir);
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
      // The predicate itself lives in `inAchievedReverifyScope` (single definition, shared with the
      // goal driver's gate set and gap-filing set) — ⛔ not re-derived here.
      if (!inAchievedReverifyScope(ac, activeGoalIds)) continue;
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
        // Resolved deadline (env > gates timeoutMs > default) — ⛔ NOT a private literal, which is
        // what made this entry point immune to every configuration knob (see the constant's tombstone).
        const res = runAcceptance({ command: criterion, cwd: root, timeoutMs: resolveAcceptanceTimeoutMs() });
        if (!res.ok) achievedButFailing.push(String(ac.id));
      }
    } finally {
      if (prev === undefined) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
      else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prev;
    }
    return { achievedButFailing, evaluated: scopeSize > 0, scopeSize, inScope: inScopeIds };
  }

  // AC1/AC4 reading (gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared): the
  // ANNOTATED enumeration of the I5 reverify scope — WHO is in it, WHY (which branch of
  // `inAchievedReverifyScope`), and WHO LEFT it. ⛔ Not merged with `checkAchievedFailing`: that
  // returns a VERDICT (the achieved-but-failing ids); this returns the SUBSTRATE the adjudication is
  // audited against. Two different questions; collapsing them would make "in scope" unattributable.
  //
  // PURE-READ (⛔ runs no criterion — that is `checkAchievedFailing`'s job and its ~42s cost).
  // `inScope`/`scopeSize` use EXACTLY I5's predicate (achieved ∧ criterion non-empty ∧
  // inAchievedReverifyScope) so `scopeSize` here and I5's `scopeSize` are the same number — ⛔ two
  // readings of "the scope" that disagree would make AC4's delta check meaningless. ACs dropped for
  // an EMPTY criterion are returned in `skippedNoCriterion` rather than vanishing silently (hard rule
  // 3b: an object that left the enumeration must stay visible as such).
  function checkReverifyScope(): {
    scopeSize: number;
    evaluated: boolean;
    activeGoals: string[];
    inScope: ReverifyScopeEntry[];
    outOfScope: ReverifyScopeEntry[];
    skippedNoCriterion: string[];
  } {
    const activeGoalIds = new Set(activeGoals().map((g) => String(g.id)));
    const statusById = new Map<string, string>();
    for (const g of list()) if (isGoalId(String(g.id))) statusById.set(String(g.id), String(g.status));
    const inScope: ReverifyScopeEntry[] = [];
    const outOfScope: ReverifyScopeEntry[] = [];
    const skippedNoCriterion: string[] = [];
    for (const ac of list()) {
      if (!isCriterionId(String(ac.id))) continue;
      if (ac.status !== "achieved") continue;
      const goal = String(ac.goal ?? "");
      const entry: ReverifyScopeEntry = {
        id: String(ac.id),
        goal,
        goalStatus: statusById.get(goal) ?? "absent",
        longTerm: ac.longTerm === true,
      };
      if (inAchievedReverifyScope(ac, activeGoalIds)) {
        if (String(ac.criterion ?? "").trim() === "") skippedNoCriterion.push(entry.id);
        else inScope.push(entry);
      } else {
        outOfScope.push(entry);
      }
    }
    return {
      scopeSize: inScope.length,
      evaluated: inScope.length > 0,
      activeGoals: [...activeGoalIds].sort(),
      inScope,
      outOfScope,
      skippedNoCriterion,
    };
  }

  // ── AC-242 successor: the FROZEN population, its bounded rotation, and the reading ────────────
  // (gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass — rationale and measured cost
  //  basis are on `DEFAULT_SWEEP_MIN_AGE_MS`'s block comment at the top of this file.)

  /** The population no other mechanism re-runs: achieved ∧ criterion non-empty ∧ ⛔ NOT in
   *  `inAchievedReverifyScope`. Shares the ONE scope predicate with I5, the driver's gate set and
   *  the driver's gap-filing set (hard rule 5b: ⛔ never a second derivation of the same boundary). */
  function frozenAchievedAcs(): GoalViewModel[] {
    const activeGoalIds = new Set(activeGoals().map((g) => String(g.id)));
    return list().filter(
      (ac) =>
        isCriterionId(String(ac.id)) &&
        ac.status === "achieved" &&
        !inAchievedReverifyScope(ac, activeGoalIds) &&
        String(ac.criterion ?? "").trim() !== "",
    );
  }

  /** PURE-READ judgment (⛔ runs no criterion — this is what AC-242's criterion calls every round,
   *  so it must cost a ledger parse, not a criterion sweep). `evaluated`/`frozenScope` keep "empty
   *  population" distinguishable from "looked at N and all fine" (hard rule 3b). */
  function checkStalePass(nowMs: number = Date.now()): StalePassReading {
    const maxAgeMs = DEFAULT_STALE_PASS_MAX_AGE_MS;
    const frozen = frozenAchievedAcs();
    const { last, lastSweep } = gateTails(goalDir);
    const failing: string[] = [];
    const staleUnverified: string[] = [];
    const notEvaluated: string[] = [];
    const verifiedFresh: string[] = [];
    const amendedUnverified: string[] = [];
    const neverGated: string[] = [];
    let sweptEver = 0;
    let lastSweepAt: string | null = null;
    for (const ac of frozen) {
      const id = String(ac.id);
      const tail = last.get(id);
      const sw = lastSweep.get(id);
      if (sw) {
        sweptEver++;
        if (lastSweepAt === null || sw.at > lastSweepAt) lastSweepAt = sw.at;
      }
      if (!tail) {
        neverGated.push(id);
        continue;
      }
      // AMENDMENT GATE — BEFORE the freshness branches, because it changes what they MEAN. A rotation
      // verdict is a verdict about a PARTICULAR criterion text; when the text has changed since, the
      // verdict is about something that is no longer on disk. Neither reading is available:
      //   · not `verifiedFresh` — that asserts "verified true", about the OLD text;
      //   · not `failing`       — that asserts "verified false", about the OLD text too.
      // ⇒ its own bucket. The `tail` fallback below is skipped for the same reason: the tail may BE
      // this very event (the rotation's verdict is the tail whenever it is the last thing recorded),
      // so falling through would re-assert the superseded verdict through the back door — exactly the
      // 2026-09-13 AC-203 shape (`8bff44425` tightened the criterion at 03:22Z, the old `pass` kept
      // counting as fresh, and the forbidden state existed ~1.5h before anything could see it).
      // An event with NO fingerprint (legacy, pre-gate) lands here too: "we cannot tell which text it
      // verified" is unknown, ⛔ not "it must have been this one" (hard rule 3b). One-time migration:
      // such ACs converge with the normal age rotation, which re-records each WITH a fingerprint —
      // ⛔ they are not prioritized (see `sweepFrozen`), because re-running the whole population on
      // the round this lands is a spike the rotation was never sized for.
      if (sw && sw.criterionHash !== criterionFingerprint(ac.criterion)) {
        amendedUnverified.push(id);
        continue;
      }
      // Order matters: a rotation verdict WITHIN the freshness bound is the current truth (either
      // direction); outside it, fall back to the last recorded verdict by anyone — and when that is
      // a pass, the answer is "unknown", ⛔ not "fine".
      const swAgeMs = sw ? nowMs - Date.parse(sw.at) : Infinity;
      if (sw && Number.isFinite(swAgeMs) && swAgeMs <= maxAgeMs) {
        if (sw.verdict === "fail") failing.push(id);
        else if (sw.verdict === "pass") verifiedFresh.push(id);
        else notEvaluated.push(id); // "not-evaluated" — 判据自己声明【此地无法评估】，⛔ 不是假
      } else if (tail.verdict === "fail") {
        failing.push(id);
      } else if (tail.verdict === "not-evaluated") {
        // The tail fallback's third answer. ⛔ Without this branch a not-evaluated tail (a goal-cli
        // event whose criterion timed out, could not spawn, or exited 126/127) fell through to
        // `staleUnverified` — "last verdict was a pass, but we have not looked recently enough" —
        // which asserts something about a pass that never happened
        // (gap-goal-gate-verdict-single-mapping-not-evaluated). Same distinction the rotation branch
        // above already draws, applied to the write path that now produces it.
        notEvaluated.push(id);
      } else {
        staleUnverified.push(id);
      }
    }
    const sortIds = (a: string[]) => a.sort();
    return {
      frozenScope: frozen.length,
      evaluated: frozen.length > 0,
      failing: sortIds(failing),
      staleUnverified: sortIds(staleUnverified),
      notEvaluated: sortIds(notEvaluated),
      verifiedFresh: sortIds(verifiedFresh),
      amendedUnverified: sortIds(amendedUnverified),
      neverGated: sortIds(neverGated),
      rotation: { sweptEver, lastSweepAt, minAgeMs: DEFAULT_SWEEP_MIN_AGE_MS, maxAgeMs },
    };
  }

  /**
   * One bounded ROTATION step: re-run the eligible frozen ACs' criteria and RECORD each verdict as
   * a `gate:"goal"` event with `actor: SWEEP_ACTOR` (`AMEND_ACTOR` when the pick was driven by a
   * criterion amendment rather than by age) — the same carrier the judgment reads, so the
   * frozen tail stops being frozen (⛔ no second state file, and therefore no cursor to drift: the
   * next invocation's eligibility is derived from these very events).
   *
   * Eligibility = "last ROTATION verdict older than `minAgeMs`", ordered oldest-first (never-touched
   * first) ⇒ least-recently-verified-first, self-resuming, and bounded: at most `budget` criteria and
   * at most `wallMs` of wall clock per invocation, with a hard per-criterion deadline from
   * `resolveAcceptanceTimeoutMs()` (env > gates `timeoutMs` > default — the SAME resolved value the
   * other three goal entry points use; see the header bound for what a raised value costs).
   * ⛔ The rotation NEVER flips a record's status — the same ruling as
   * I5 ("⛔ 不反向翻转 achieved→active，激活归人"): it records what it observed and nothing else.
   */
  async function sweepFrozen(
    o: { budget?: number; minAgeMs?: number; wallMs?: number; nowMs?: number } = {},
  ): Promise<{
    evaluated: boolean;
    refused: boolean;
    eligible: number;
    ran: Array<{ id: string; verdict: "pass" | "fail" | "not-evaluated"; reason: string; ms: number }>;
    stoppedBy: "exhausted" | "budget" | "wall";
  }> {
    const budget = o.budget ?? DEFAULT_SWEEP_BUDGET;
    const minAgeMs = o.minAgeMs ?? DEFAULT_SWEEP_MIN_AGE_MS;
    const wallMs = o.wallMs ?? DEFAULT_SWEEP_WALL_MS;
    const nowMs = o.nowMs ?? Date.now();
    const frozen = frozenAchievedAcs();
    // Re-entrancy guard (same var as I5's): a criterion that itself calls back into a criterion
    // runner must not recurse. Refusing here is a REFUSAL, not an empty result (hard rule 3b).
    if (process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] === "1") {
      return { evaluated: false, refused: true, eligible: 0, ran: [], stoppedBy: "exhausted" };
    }
    const { lastSweep } = gateTails(goalDir);
    const ageOf = (id: string): number => {
      const sw = lastSweep.get(id);
      if (!sw) return Infinity;
      const t = Date.parse(sw.at);
      return Number.isFinite(t) ? nowMs - t : Infinity;
    };
    // AMENDMENT PRIORITY (gap-ac242-…-amendment-unguarded, defect ②): a rotation verdict that
    // POSITIVELY describes a different criterion text than the one on disk now (`criterionHash`
    // present AND different) has no usable verdict — the judgment puts it in `amendedUnverified` —
    // ⇒ it does not wait out `minAgeMs`. The age gate answers "how long before looking again is worth
    // the cost"; the question here is different — "the thing we looked at is not this thing" — so age
    // is not the right predicate at all. This is exactly the AC-203 shape: a criterion tightened at
    // 03:22Z and a `pass` recorded for the OLD text that kept counting as fresh.
    //
    // ⚠️ A LEGACY event carrying NO fingerprint is deliberately NOT prioritized, although the judgment
    // also reports it as `amendedUnverified` (see `checkStalePass`): it makes no claim at all about
    // which text it verified, so there is no evidence of an amendment — only an unrecorded provenance.
    // Prioritizing those would re-run the ENTIRE population (77 ACs here) on the round this code
    // lands — a one-shot spike far outside the bound the age rotation was sized for
    // (`DEFAULT_SWEEP_MIN_AGE_MS`'s cost comment). They converge with the normal age rotation, which
    // re-records each with a fingerprint. Two causes, one bucket, two different eligibilities —
    // and the distinction between them is exactly "is there a positive claim of a mismatch".
    // ⛔ Still inside the SAME bound: these are candidates in the one eligible list, and `budget`/
    // `wallMs` cap the invocation exactly as before (⛔ no second budget).
    const byId = new Map(frozen.map((ac) => [String(ac.id), ac]));
    const amendedIds = new Set(
      frozen
        .map((ac) => String(ac.id))
        .filter((id) => {
          const sw = lastSweep.get(id);
          if (!sw || sw.criterionHash === "") return false;
          return sw.criterionHash !== criterionFingerprint(byId.get(id)?.criterion);
        }),
    );
    // Eligibility threshold per AC: a recorded FAIL is re-checked sooner (see
    // DEFAULT_FAIL_RECHECK_DIVISOR) — ⛔ ordering only, the per-invocation bound is unchanged.
    const eligibleAt = (id: string): boolean => ageOf(id) > (lastSweep.get(id)?.verdict === "fail" ? minAgeMs / DEFAULT_FAIL_RECHECK_DIVISOR : minAgeMs);
    const eligible = frozen
      .map((ac) => String(ac.id))
      .filter((id) => amendedIds.has(id) || eligibleAt(id))
      .sort((a, b) => {
        // Amendments first (they are the ones with no usable verdict), then oldest-first.
        const aa = amendedIds.has(a);
        const ab = amendedIds.has(b);
        if (aa !== ab) return aa ? -1 : 1;
        const da = ageOf(a);
        const db = ageOf(b);
        if (da !== db) return db - da; // oldest (Infinity first) wins — least-recently-verified-first
        return a.localeCompare(b);
      });
    const picked = eligible.slice(0, budget);
    if (picked.length === 0) {
      return { evaluated: frozen.length > 0, refused: false, eligible: eligible.length, ran: [], stoppedBy: "exhausted" };
    }
    const { appendGateEvent } = await import("./gate/gate-event-store.ts");
    const logPath = path.join(path.dirname(goalDir), ".quay", "gate-events.jsonl");
    const root = resolveGitRoot(goalDir) ?? path.dirname(goalDir);
    const startedAt = Date.now();
    const ran: Array<{ id: string; verdict: "pass" | "fail" | "not-evaluated"; reason: string; ms: number }> = [];
    const prev = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
    process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = "1";
    let stoppedBy: "exhausted" | "budget" | "wall" = picked.length < eligible.length ? "budget" : "exhausted";
    try {
      for (const id of picked) {
        if (Date.now() - startedAt > wallMs) {
          stoppedBy = "wall";
          break;
        }
        const criterion = String(byId.get(id)?.criterion ?? "");
        const t0 = Date.now();
        // The DEADLINE is `resolveAcceptanceTimeoutMs()` — the shared config-surface chain, ⛔ not a
        // private literal (gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout).
        const res = runAcceptance({ command: criterion, cwd: root, timeoutMs: resolveAcceptanceTimeoutMs() });
        // ⛔ Through the ONE mapping (gap-goal-gate-verdict-single-mapping-not-evaluated). Before it,
        // this site recognised only exit 3 and recorded a timeout / spawn failure / exit 126-127 as
        // `fail` — i.e. asserted "this criterion is FALSE" about a criterion that never got to say
        // anything (hard rule 3b, and the very conflation this task is about). `res.reason`'s own
        // exit-3 convention is unchanged; the additional causes now travel with it.
        const v = verdictFromAcceptance(res);
        ran.push({ id, verdict: v.verdict, reason: v.reason.slice(0, 500), ms: Date.now() - t0 });
        appendGateEvent(logPath, {
          id: randomUUID(),
          item_id: id,
          pipeline_id: id,
          gate: "goal",
          // ⛔ The actor is the DRY-RUN's cause, and the two causes are distinguishable
          // (AMEND_ACTOR vs SWEEP_ACTOR) — so a reader can tell "the age rotation reached it" from
          // "its criterion text changed, so this round ran it immediately". Both count as rotation
          // writes (see `gateTails`), because both are re-verifications.
          actor: amendedIds.has(id) ? AMEND_ACTOR : SWEEP_ACTOR,
          verdict: v.verdict,
          timestamp: new Date().toISOString(),
          // The fingerprint pins WHICH criterion text this verdict is about — the whole point of the
          // amendment gate. ⛔ Recorded, not inferred later from mtime/clock (hard rule 4 corollary
          // 2: a value that depends on the host is not a measurement).
          // `cause` is present only when there IS one (⛔ not `cause: null` on the pass/fail events):
          // the shape of the 8000+ existing goal events is a contract several readers parse.
          payload: {
            reason: v.reason,
            ...(v.cause ? { cause: v.cause } : {}),
            criterionHash: criterionFingerprint(criterion),
          },
        });
      }
    } finally {
      if (prev === undefined) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
      else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prev;
    }
    return { evaluated: frozen.length > 0, refused: false, eligible: eligible.length, ran, stoppedBy };
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
    supersedes, supersededBy, body, disposeOld, longTerm,
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
      // The criterion AS STORED, captured BEFORE this write's `criterion` param overwrites it — the
      // basis for the write-side attribution gate's shrink-only comparison (see below).
      const priorCriterion = frontmatter.criterion;
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
      // `long-term` is a stored DECLARATION (AC-216), so unlike `evidence` it is written verbatim.
      if (longTerm !== undefined) frontmatter["long-term"] = longTerm;
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
      // THE RULE (⛔ the SAME predicate the ratchet uses — `evaluateCriterionAttribution` above; a
      // second copy of the regex here is exactly the drift that produced AC-243):
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
        const startedMs = Date.now();
        // Resolved deadline (env > gates timeoutMs > default). ⚠️ This matters more than at the other
        // three sites: the verdict here decides whether the write is ACCEPTED, so a criterion that
        // legitimately needs > 60s was being killed and then silently re-read as "ran and failed"
        // (a timeout IS a definitive fail ⇒ evaluable ⇒ allowed) — the write went through, but the
        // P10 cost line below reported a `fail` and a ~60s wall for a criterion that had never
        // actually been evaluated to a verdict.
        const gateRes = runAcceptance({ command: criterionCmd, cwd: gateRoot, timeoutMs: resolveAcceptanceTimeoutMs() });
        const wallMs = Date.now() - startedMs;
        // EVALUABILITY (a question about the criterion's existence, answered by the runner
        // reaching a process at all) — ⛔ a DIFFERENT question from the verdict vocabulary
        // (gate/acceptance-runner.ts verdictFromAcceptance, where a timeout is NOT "false"):
        // "ran and failed" (exit ≠0) and a timeout both prove the command is runnable ⇒ allowed.
        if (gateRes.code === null && !gateRes.timedOut) {
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
        "labels", "posture", "supersedes", "superseded-by", "long-term", "fidelity", "timeoutMs",
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

  return { list, get, write, writeBatch, activeGoals, listActiveCriteria, isGoalAchieved, checkWithinCap, checkStaleness, checkAchievedFailing, checkReverifyScope, frozenAchievedAcs, checkStalePass, sweepFrozen };
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
      const { appendGateEvent } = await import("./gate/gate-event-store.ts");
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
      if (typeof criterion !== "string" || criterion.trim() === "") {
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
          cwd: root,
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
        payload: { reason, ...(cause ? { cause } : {}) },
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
      const out = { id, verdict, cause, reason, timeoutMs, timestamp: event.timestamp, dryRun, event };
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
