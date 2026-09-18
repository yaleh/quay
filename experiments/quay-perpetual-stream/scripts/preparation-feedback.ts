// preparation-feedback.ts — M188/DIR-119-A Stage 1.5: the invalidate → refact → regenerate →
// reselect loop. When preparation (charter authoring / touches confirmation / dependency resolution)
// discovers drift against the facts a portfolio was chosen from — touches changed, semantic resources
// changed, a dependency edge appeared, capacity/compatibility no longer holds — the provisional
// portfolio is invalidated and SELECT re-runs candidate synthesis + portfolio choice against updated
// facts. This is capped at 3 rounds (plan doc Stage 1.5 / Done-when #5): the loop NEVER runs
// unboundedly — round 4 (still invalid after 3 regenerations) always routes to human review instead
// of silently looping or silently forcing a stale portfolio through.

import type { MilestonePortfolio, TaskCandidate } from "./candidate-contracts.ts";
import { createSelftest } from "./gate-script-base.ts";

export const MAX_PREPARATION_ROUNDS = 3;

export interface PreparationCheckResult {
  valid: boolean;
  reason?: string;
  /** Updated facts to regenerate candidates from, when invalid. Absent/ignored when valid. */
  updatedFacts?: TaskCandidate[];
}

export interface PreparationLoopHooks {
  /** Regenerate candidates + choose a portfolio from a given fact set (round-aware for logging only). */
  regenerate: (facts: TaskCandidate[], round: number) => MilestonePortfolio;
  /** Check the CURRENT portfolio against live facts; report drift if any. Called once per round,
   * including round 0 against the initial portfolio. */
  check: (portfolio: MilestonePortfolio, round: number) => PreparationCheckResult;
}

export type PreparationLoopOutcome =
  | { status: "accepted"; portfolio: MilestonePortfolio; rounds: number; history: string[] }
  | { status: "human-review-required"; lastPortfolio: MilestonePortfolio; rounds: number; reason: string; history: string[] };

// ── runPreparationFeedbackLoop ────────────────────────────────────────────────────────────────────
// round 0 = the initial portfolio's own preparation check. If it fails, rounds 1..3 regenerate from
// updated facts and re-check. If round 3's regenerated portfolio STILL fails preparation, the loop
// stops (never a round 4 regeneration) and returns `human-review-required` — it never silently loops
// forever and never silently commits a portfolio that failed its own preparation check.
export function runPreparationFeedbackLoop(
  initialFacts: TaskCandidate[],
  initialPortfolio: MilestonePortfolio,
  hooks: PreparationLoopHooks,
  maxRounds: number = MAX_PREPARATION_ROUNDS,
): PreparationLoopOutcome {
  const history: string[] = [];
  let facts = initialFacts;
  let portfolio = initialPortfolio;

  for (let round = 0; round <= maxRounds; round++) {
    const result = hooks.check(portfolio, round);
    if (result.valid) {
      history.push(`round ${round}: preparation OK — accepted`);
      return { status: "accepted", portfolio, rounds: round, history };
    }
    history.push(`round ${round}: preparation INVALID — ${result.reason ?? "no reason given"}`);
    if (round === maxRounds) {
      // Do NOT regenerate a 4th time — stop here and route to human review.
      history.push(`round ${round}: reached max rounds (${maxRounds}) — routing to human review, no further regeneration`);
      return { status: "human-review-required", lastPortfolio: portfolio, rounds: round, reason: result.reason ?? "preparation kept invalidating the portfolio", history };
    }
    facts = result.updatedFacts ?? facts;
    portfolio = hooks.regenerate(facts, round + 1);
    history.push(`round ${round}: regenerated portfolio for round ${round + 1} from updated facts`);
  }

  // Unreachable (loop always returns inside), but keeps TypeScript's control-flow analysis happy and
  // fails LOUD rather than silently returning undefined if the loop shape ever changes.
  throw new Error("runPreparationFeedbackLoop: fell through the round loop without returning — this is a bug");
}

// ── selftest ──────────────────────────────────────────────────────────────────────────────────────
export function selftest(): boolean {
  const st = createSelftest({ flavor: "cases" });
  const check = st.check;

  const mkPortfolio = (round: number): MilestonePortfolio => ({
    version: 1,
    selected: [],
    rejected: [],
    generatedAt: "x",
    round,
  });

  // GREEN: preparation passes on the very first check (round 0) — no regeneration needed at all.
  {
    let regenerateCalls = 0;
    const outcome = runPreparationFeedbackLoop([], mkPortfolio(0), {
      check: () => ({ valid: true }),
      regenerate: () => {
        regenerateCalls++;
        return mkPortfolio(99);
      },
    });
    check("immediate-accept-no-regeneration", outcome.status === "accepted" && regenerateCalls === 0, JSON.stringify(outcome));
  }

  // GREEN: invalid once, valid on the regenerated round-1 portfolio.
  {
    const outcome = runPreparationFeedbackLoop([], mkPortfolio(0), {
      check: (p) => (p.round === 0 ? { valid: false, reason: "touches drift", updatedFacts: [] } : { valid: true }),
      regenerate: (_facts, round) => mkPortfolio(round),
    });
    check(
      "accepts-after-one-regeneration",
      outcome.status === "accepted" && outcome.rounds === 1,
      JSON.stringify(outcome),
    );
  }

  // RED-then-GREEN: stays invalid through rounds 0,1,2 then finally valid at round 3 (the LAST
  // allowed regeneration) — proves the cap is "at most 3 rounds", not "fewer than 3".
  {
    const outcome = runPreparationFeedbackLoop([], mkPortfolio(0), {
      check: (p) => (p.round < 3 ? { valid: false, reason: `still drifting at round ${p.round}`, updatedFacts: [] } : { valid: true }),
      regenerate: (_facts, round) => mkPortfolio(round),
    });
    check("accepts-exactly-at-round-3-boundary", outcome.status === "accepted" && outcome.rounds === 3, JSON.stringify(outcome));
  }

  // Perpetually-drifting scenario: NEVER routes to human review before round 3, and DOES route by
  // round 3 — never loops silently forever (bounded call count proves it, not just the final status).
  {
    let regenerateCalls = 0;
    const outcome = runPreparationFeedbackLoop([], mkPortfolio(0), {
      check: () => ({ valid: false, reason: "permanent drift", updatedFacts: [] }),
      regenerate: (_facts, round) => {
        regenerateCalls++;
        return mkPortfolio(round);
      },
    });
    check(
      "routes-to-human-review-after-max-rounds",
      outcome.status === "human-review-required" && outcome.rounds === MAX_PREPARATION_ROUNDS,
      JSON.stringify(outcome),
    );
    check(
      "never-regenerates-a-4th-time",
      regenerateCalls === MAX_PREPARATION_ROUNDS,
      `regenerateCalls=${regenerateCalls} (expected exactly ${MAX_PREPARATION_ROUNDS} — one regeneration per invalid round below the cap, none for the final round-3 check)`,
    );
    check(
      "human-review-reason-is-concrete",
      outcome.status === "human-review-required" && /permanent drift/.test(outcome.reason),
      JSON.stringify(outcome),
    );
    check(
      "history-is-a-non-empty-audit-trail",
      outcome.history.length >= 4 && /routing to human review/.test(outcome.history[outcome.history.length - 1]),
      JSON.stringify(outcome.history),
    );
  }
  return st.report();
}

if (process.argv[1] != null && process.argv[1].endsWith("preparation-feedback.ts") && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
