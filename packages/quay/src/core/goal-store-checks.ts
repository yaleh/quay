// quay Core: the goal store's CHECK surface — the I3/I4 staleness reading, the I5
// achieved-but-failing sweep, and the annotated reverify-scope enumeration.
//
// Extracted verbatim from `createGoalStore`'s closure (tasks/gap-routine-architecture-analysis-
// god-function-creategoalstore). Three judgments with three different costs and three different
// outputs — kept together because they share ONE scope predicate and ONE re-entrancy guard, which
// is exactly why they must not be re-derived per consumer (hard rule 5b).
//
// ⛔ The split inside this module is load-bearing and documented at each function:
//   · `checkStaleness` / `checkReverifyScope` — PURE-READ, never run a criterion.
//   · `checkAchievedFailing` — RUNS criteria; separate subcommand precisely so the pure reads can
//     never recurse into a criterion that calls them back (2026-09-07 production incident).

import path from "node:path";
import { runAcceptance, verdictFromAcceptance } from "./acceptance-runner.ts";
import { resolveAcceptanceTimeout, timeoutKnobHint } from "../kernel/gate-run-options.ts";
import {
  capabilityRefusalAt,
  capabilityRefusalReason,
} from "./criterion-capability.ts";
import { resolveGitRoot } from "./store-commit.ts";
import { buildCriterionRoots, criterionCwdFor } from "./goal-store-criterion-address.ts";
import { isCriterionId, isGoalId, type GoalViewModel, type ReverifyScopeEntry } from "./goal-store-types.ts";

// RE-ENTRANCY GUARD env var (乙, gap-goal-achieved-but-failing-no-handler). While `checkAchievedFailing`
// is running a criterion, it sets this in process.env; runAcceptance's spawnSync (no `env` override)
// inherits it into the criterion's child shell. A criterion whose own command calls back into
// `check --achieved-failing` (or `gate`) therefore spawns a grandchild that sees the var and REFUSES
// to run criteria — bounding the recursion (the 2026-09-07 production incident was an unbounded
// `check --staleness` → criterion → `check --staleness` chain). Exported so the falsifiability test
// can `env -u` it to prove the observation measures real behavior.
export const GOAL_ACCEPTANCE_ACTIVE_ENV = "QUAY_GOAL_ACCEPTANCE_ACTIVE";

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

export interface GoalCheckDeps {
  goalDir: string;
  /** The active-GOAL cap (`checkStaleness` reports it; the reading is about the ACTIVE set). */
  cap: number;
  /** The staleness bound, in ms (`readGoalConfig`'s resolved policy). */
  staleMs: number;
  list: () => GoalViewModel[];
  activeGoals: () => GoalViewModel[];
  isGoalAchieved: (goalId: string) => boolean;
}

/** Compose the check surface. The re-exported guard env var + scope predicate live above. */
export function createGoalChecks(d: GoalCheckDeps) {
  const { goalDir, cap, staleMs, list, activeGoals, isGoalAchieved } = d;
  // The execution-surface capability gate, bound to THIS store's workspace (the declaration lives
  // beside the goals dir, ⛔ never read from the criterion's cwd — a branch-mode criterion runs on a
  // worktree that need not carry it).
  const workspaceRootForCapability = path.dirname(goalDir);
  const capabilityRefusal = (criterion: string, criterionCwd: string) =>
    capabilityRefusalAt(criterion, criterionCwd, workspaceRootForCapability);

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
  function checkAchievedFailing(): { achievedButFailing: string[]; capabilityRefused: Array<{ id: string; code: string; reason: string }>; evaluated: boolean; scopeSize: number; inScope: string[] } {
    // Enumerate the in-scope set FIRST (pure-read — no criterion runs): achieved ACs under ACTIVE
    // goals with a non-empty criterion. `scopeSize` is that count, and it is what makes "empty
    // scope" (0 active goals / 0 achieved ACs under them) field-distinguishable from "ran N criteria
    // and all passed" (hard rule 3b — ⛔ not an empty array masquerading as "no achieved-but-failing
    // AC"). The enumeration is done before the guard check so the guard path's `scopeSize` is truthful
    // too (it refuses to RUN, but it still knows the scope).
    const all = list();
    const activeGoalIds = new Set(all.filter((g) => isGoalId(String(g.id)) && g.status === "active").map((g) => String(g.id)));
    const inScope: GoalViewModel[] = [];
    for (const ac of all) {
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
      // `evaluated: false` is the refusal — ⛔ and `capabilityRefused: []` here means "nothing was
      // judged", NOT "nothing was refused": the two readings are separated by `evaluated`, which is
      // exactly why the guard reports it rather than returning an empty-shaped result (hard rule 3b).
      return { achievedButFailing: [], capabilityRefused: [], evaluated: false, scopeSize, inScope: inScopeIds };
    }
    const achievedButFailing: string[] = [];
    // The criteria this guard REFUSED to spawn — enumerated, ⛔ never folded into
    // `achievedButFailing`: "we would not run it" is a different fact from "we ran it and it is
    // false", and collapsing them would assert something about a criterion nobody executed
    // (hard rule 3b).
    const capabilityRefused: Array<{ id: string; code: string; reason: string }> = [];
    // Criterion cwd = the git root (robust rev-parse, ⛔ not path.dirname — hard rule 4 corollary 2),
    // falling back to goalDir's parent only when not inside a git work tree. A BRANCH-MODE goal's ACs
    // run on that goal's criterion worktree instead (§5 B1) — without it every re-verification of a
    // goal-branch-backed AC reports achieved-but-failing and files phantom gaps.
    const root = resolveGitRoot(goalDir) ?? path.dirname(goalDir);
    const criterionRoots = buildCriterionRoots(root, all as unknown as Array<Record<string, unknown>>);
    const prev = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
    process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = "1";
    try {
      for (const ac of inScope) {
        const criterion = typeof ac.criterion === "string" ? ac.criterion : "";
        // Resolved deadline: the RECORD's own `timeoutMs` FIRST, then the shared env/default chain
        // (`resolveAcceptanceTimeout` — the same resolver `goal gate` uses) — ⛔ NOT a private
        // literal, which is what made this entry point immune to every configuration knob (see the
        // constant's tombstone). The hint names the knob THIS path actually reads.
        const t = resolveAcceptanceTimeout((ac as unknown as { timeoutMs?: unknown }).timeoutMs);
        const cwd = criterionCwdFor(root, criterionRoots, ac);
        // ⛔ BEFORE the spawn, and with no bypass arm: this path is UNATTENDED (the goal driver calls
        // it every round), so there is no "someone present" whose consent a bypass flag could carry.
        const refusal = capabilityRefusal(criterion, cwd);
        if (refusal !== null) {
          capabilityRefused.push({ id: String(ac.id), code: refusal.code ?? "criterion-capability-unevaluable", reason: capabilityRefusalReason(refusal) });
          continue;
        }
        const res = runAcceptance({ command: criterion, cwd, timeoutMs: t.timeoutMs, timeoutKnob: timeoutKnobHint(t) });
        if (!res.ok) achievedButFailing.push(String(ac.id));
      }
    } finally {
      if (prev === undefined) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
      else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prev;
    }
    return { achievedButFailing, capabilityRefused, evaluated: scopeSize > 0, scopeSize, inScope: inScopeIds };
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

  return { checkStaleness, checkAchievedFailing, checkReverifyScope };
}
