// quay Core: the BOUNDED ROTATION step over the frozen population — `sweepFrozen`.
//
// Extracted verbatim from `createGoalStore`'s closure (tasks/gap-routine-architecture-analysis-
// god-function-creatgoalstore). This is the INCIDENT's execution surface: it re-runs frozen
// criteria on a schedule with nobody watching, so it carries the capability gate with no bypass
// arm and records every verdict (including refusals) into the ledger the judgment reads.
//
// ⛔ Split from `./goal-store-rotation.ts` (the judgment) on purpose: judgment is pure-read, this
// is the only criterion-running half of the frozen-population mechanism.

import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  runAcceptance,
  verdictFromAcceptance,
  FAILURE_REASON_MAX_CHARS,
} from "./acceptance-runner.ts";
import { resolveAcceptanceTimeout, timeoutKnobHint } from "../kernel/gate-run-options.ts";
import { capabilityRefusalAt, capabilityRefusalReason } from "./criterion-capability.ts";
import { resolveGitRoot } from "./store-commit.ts";
import {
  buildCriterionRoots,
  criterionCwdFor,
  evaluationContext,
} from "./goal-store-criterion-address.ts";
import { AMEND_ACTOR, SWEEP_ACTOR, gateTails } from "./goal-store-ledger.ts";
import { GOAL_ACCEPTANCE_ACTIVE_ENV } from "./goal-store-checks.ts";
import {
  criterionFingerprint,
  DEFAULT_SWEEP_BUDGET,
  DEFAULT_SWEEP_MIN_AGE_MS,
  DEFAULT_SWEEP_WALL_MS,
  DEFAULT_FAIL_RECHECK_DIVISOR,
} from "./goal-store-rotation.ts";
import type { GoalViewModel } from "./goal-store-types.ts";

export interface GoalSweepDeps {
  goalDir: string;
  list: () => GoalViewModel[];
  /** The frozen population (shared with the judgment — ⛔ never a second derivation). */
  frozenAchievedAcs: () => GoalViewModel[];
}

/** Compose the bounded rotation step. */
export function createGoalSweep(d: GoalSweepDeps) {
  const { goalDir, list, frozenAchievedAcs } = d;
  const workspaceRootForCapability = path.dirname(goalDir);
  const capabilityRefusal = (criterion: string, criterionCwd: string) =>
    capabilityRefusalAt(criterion, criterionCwd, workspaceRootForCapability);

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
    /** WHICH of the round's picks were refused by the capability gate, with the stable code. They
     *  also appear in `ran` (as `not-evaluated` — the round did look at them and could not run
     *  them); this field names the MECHANISM, so a reader does not have to infer it from a reason
     *  string (hard rule 3: enumerate; ⛔ never parse the message to find the cause). */
    capabilityRefused: Array<{ id: string; code: string }>;
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
      return { evaluated: false, refused: true, eligible: 0, ran: [], capabilityRefused: [], stoppedBy: "exhausted" };
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
      return { evaluated: frozen.length > 0, refused: false, eligible: eligible.length, ran: [], capabilityRefused: [], stoppedBy: "exhausted" };
    }
    const { appendGateEvent } = await import("./gate-event-store.ts");
    const logPath = path.join(path.dirname(goalDir), ".quay", "gate-events.jsonl");
    const root = resolveGitRoot(goalDir) ?? path.dirname(goalDir);
    // §5 B1 — the rotation re-verifies a branch-mode goal's frozen AC on that goal's criterion
    // worktree, not on the main checkout (which does not carry the goal branch's code at all).
    const criterionRoots = buildCriterionRoots(root, list() as unknown as Array<Record<string, unknown>>);
    const startedAt = Date.now();
    const ran: Array<{ id: string; verdict: "pass" | "fail" | "not-evaluated"; reason: string; ms: number }> = [];
    const capabilityRefused: Array<{ id: string; code: string }> = [];
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
        // A branch-mode goal's frozen AC is re-verified on ITS criterion worktree (§5 B1) — the same
        // per-AC cwd choice the gate and I5 entry points make. ⛔ Resolved per PICKED id (≤budget),
        // never per frozen record.
        const cwd = criterionCwdFor(root, criterionRoots, byId.get(id) ?? {});
        // ⛔ THE gate this whole task exists for. This loop is the INCIDENT's execution surface:
        // `check --stale-pass --sweep` re-runs the frozen population on a schedule, forever, with
        // nobody watching — including `achieved` ACs (measured: the incident AC was evaluated in 112
        // goal rounds). No spawn, no bypass arm: a bypass flag cannot be "someone present" on a path
        // no person invoked. The verdict is still RECORDED (below) so the refusal is a reading the
        // judgment can see, not a silent skip (hard rule 3b).
        const refusal = capabilityRefusal(criterion, cwd);
        if (refusal !== null) {
          // The SAME prefix every other not-evaluated verdict carries (`verdictFromAcceptance`'s
          // `not-evaluated (${cause}): …`), so a reader greps ONE token for "we could not measure
          // this" regardless of which mechanism produced it — ⛔ not a second vocabulary.
          const reason = `not-evaluated (capability): ${capabilityRefusalReason(refusal)}`.slice(0, FAILURE_REASON_MAX_CHARS);
          ran.push({ id, verdict: "not-evaluated", reason, ms: 0 });
          capabilityRefused.push({ id, code: refusal.code ?? "criterion-capability-unevaluable" });
          appendGateEvent(logPath, {
            id: randomUUID(),
            item_id: id,
            pipeline_id: id,
            gate: "goal",
            // The rotation's own actor: this IS a rotation outcome (the round looked at this AC and
            // could not run it), so it must age like any other — otherwise the same AC would be
            // re-picked and re-refused every round, spending the budget the bound exists to protect.
            actor: amendedIds.has(id) ? AMEND_ACTOR : SWEEP_ACTOR,
            verdict: "not-evaluated",
            timestamp: new Date().toISOString(),
            payload: {
              reason,
              // The MECHANISM travels with the recorded reason: a reader of the ledger can tell a
              // capability refusal from a timeout / spawn failure / exit-126 — and can branch on the
              // code rather than parse the message.
              capabilityCode: refusal.code,
              capability: refusal.capability,
              refusalRules: refusal.reasons.map((r) => ({ rule: r.rule, detail: r.detail })),
              criterionHash: criterionFingerprint(criterion),
              ...evaluationContext(cwd),
            },
          });
          continue;
        }
        // The DEADLINE is record-aware `resolveAcceptanceTimeout` — the RECORD's own `timeoutMs`
        // FIRST, then the shared config-surface chain, ⛔ not a private literal
        // (gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout). The hint names the
        // knob THIS path actually reads (⛔ not gates.yml, which the goal path never consults).
        const t = resolveAcceptanceTimeout((byId.get(id) as unknown as { timeoutMs?: unknown } | undefined)?.timeoutMs);
        const res = runAcceptance({ command: criterion, cwd, timeoutMs: t.timeoutMs, timeoutKnob: timeoutKnobHint(t) });
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
            // WHICH tree this rotation re-verified on (SPEC §7 辛) — `cwd` here is the criterion cwd
            // passed to `runAcceptance` above, so the two name the same tree by construction.
            ...evaluationContext(cwd),
          },
        });
      }
    } finally {
      if (prev === undefined) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
      else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prev;
    }
    return { evaluated: frozen.length > 0, refused: false, eligible: eligible.length, ran, capabilityRefused, stoppedBy };
  }

  return { sweepFrozen };
}
