// quay Core: the goal store's FROZEN POPULATION — the population no other mechanism re-runs,
// the `check --stale-pass` JUDGMENT over it, and the fingerprint/eligibility vocabulary the
// rotation and the judgment must share.
//
// Extracted verbatim from `createGoalStore`'s closure (tasks/gap-routine-architecture-analysis-
// god-function-creatgoalstore): the frozen population is `achieved ∧ criterion non-empty ∧ ⛔ NOT
// in inAchievedReverifyScope`, so its judgment and its rotation read ONE definition of "frozen"
// and ONE ledger (see the block comments carried below).
//
// ⛔ PURE-READ: nothing in this module runs a criterion. The bounded rotation step that DOES is
// `./goal-store-sweep.ts` — split out precisely so a reader of the judgment cannot accidentally
// pull an execution surface into a criterion that calls the judgment back.

import { createHash } from "node:crypto";
import { inAchievedReverifyScope } from "./goal-store-checks.ts";
import { gateTails } from "./goal-store-ledger.ts";
import { isCriterionId, type GoalViewModel } from "./goal-store-types.ts";

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
   *  Three causes, all recorded by the ONE mapping (`core/acceptance-runner.ts`
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

export interface GoalRotationDeps {
  goalDir: string;
  list: () => GoalViewModel[];
  activeGoals: () => GoalViewModel[];
}

/** Compose the frozen-population JUDGMENT (pure-read). */
export function createGoalRotation(d: GoalRotationDeps) {
  const { goalDir, list, activeGoals } = d;
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

  return { frozenAchievedAcs, checkStalePass };
}
