// quay Core: goal-analysis — the PURE "what is this goal's next step, and whose is it" projection
// over the goal-driver's gap readings (tasks/gap-goal-next-projection, AC-935).
//
// THE DEFECT THIS CLOSES. The goal-driver computes a large gap reading every round (2026-11-06
// production carrier: 199/237 non-quiet entries in one round), but no reading answered the two
// questions a consumer actually has: **what should happen next for this goal**, and **who owns it**.
// A consumer had to read the round facts and re-derive the answer itself — a second implementation
// of the same judgement, which is exactly the drift class this repo keeps removing (hard rule 5b).
// So the projection is a PURE function here, and BOTH the driver (which writes it into the round
// fact `goal-next`) and the Core CLI (`quay goal next`) consume this one definition.
//
// ⛔ PURE: this module reads no file system, no clock, no git. Its three inputs are the round's own
// snapshots (`records` = the GOAL/AC records, `gaps` = `computeGoalGaps`'s output, `taskFacts` =
// `readTaskFacts`'s output), so the same inputs always produce the same rows and the function is
// unit-testable without a repository.
//
// ⛔ ONE ROW PER ACTIVE GOAL, AND THE ROW IS A READING — NOT A DECISION. This module never writes a
// task status, never files anything, never flips a goal (DIR-131: the driver reads, it does not act
// on the task board). It answers "who would have to act" so that a human/manager can see it.
//
// ⛔ THREE-VALUED WHERE THE INPUT IS MISSING (hard rule 3b). A goal the gap reading produced NO row
// for is reported as `not-evaluated` — ⛔ never as "nothing to do": "no reading" and "nothing left"
// are different worlds and must not share an output shape.

// ── the gap vocabulary (MOVED here from plugin/scripts/goal-driver.ts) ────────────────────────────
//
// WHY IT LIVES IN `core/` NOW: the projection must be shared by the driver and the Core CLI, and a
// type re-declared on both sides is a second source that drifts the moment a state is added. The
// driver re-exports these names from its own module (so every historical importer keeps working)
// and `driver-runtime.ts` is the single Core-import surface it uses (AC-262: the driver never spells
// a Core source-tree literal).

/** One AC's gap state (eleven values coexist; `not-evaluated` is kept distinct — "could not read the
 *  tasks input" is not the same shape as "gap" / "no traction"; hard rule 3b).
 *  in-progress       a task is advancing it (todo/ready/needs-human traction)
 *  gap               a true gap: ZERO associated tasks (`goal_ac`-linked) ⇒ file a task
 *  workable          associated tasks exist but ALL are non-traction (done/superseded) while the
 *                    criterion still fails, AND the criterion's truth is a repository work product
 *                    (code/file/test — `classifyCriterionKind` says it does NOT read a production
 *                    carrier) ⇒ some worker could still change it ⇒ file a task. ⛔ Different shape
 *                    from `gap`: there are associated tasks here (taskCount ≥ 1), there are none there.
 *  world-gated       associated tasks exist but all non-traction, criterion still fails, AND the
 *                    criterion reads a production carrier (`.quay/<file>`): its truth is a FUTURE
 *                    production event (a CI run, a release tag) that no worker can produce ⇒ ⛔ do not
 *                    spend a spawn; it is re-read by the next round's gate instead.
 *  unclassified      the classifier could not read/parse the criterion text (missing/empty) ⇒ an
 *                    independent value: ⛔ neither `workable` nor `world-gated`, and it consumes no
 *                    spawn slot (hard rule 3b: an unreadable input must not wear a substantive state).
 *  stalled           ⚠️ LEGACY / INPUT-ONLY since 2026-11-07 (gap-goal-driver-blocked-taxonomy): the
 *                    old single value for "tasks exist but none can advance on its own". It stays in
 *                    the union for compatibility (round carriers written before the split, fixtures,
 *                    every historical importer), ⛔ but `computeGoalGaps` NEVER emits it again — the
 *                    three causes below replace it, because they have three different owners
 *                    (ask a human / fix the four artifacts / fix dispatch), and folding them into one
 *                    value made the driver report "stalled" for all of them.
 *  blocked-needs-human  every in-traction task linked to this criterion is parked `needs-human` ⇒ a
 *                    HUMAN must move it (owner `human`, action `ask-human`). Cause needs no ready-pool
 *                    structural reading: a needs-human task has already left todo/ready.
 *  blocked-promotion every in-traction task is `todo` and the author→ready promotion gate does NOT
 *                    accept it (not in `eligibleTodoIds`) ⇒ the four artifacts are what is missing
 *                    (owner `worker`, action `fix-artifacts`).
 *  blocked-dispatch  every in-traction task is `ready` and the pool EXCLUDES it (in
 *                    `excludedReadyIds`) ⇒ the task cannot be dispatched; look at its dependencies and
 *                    worktree (owner `worker`, action `fix-dispatch`).
 *  not-evaluated     the tasks input is unreadable (taskFacts == null), or the I5 reading for the
 *                    AC-216 re-verify domain is unreadable (standings == null)
 *  standing-ok       AC-216 re-verify domain only: the standing invariant (achieved ∧ long-term ∧
 *                    GOAL not active) HOLDS right now ⇒ no work to file, ⛔ no spawn
 *  standing-violated AC-216 re-verify domain only: the standing invariant is VIOLATED right now and
 *                    no in-flight task is handling it ⇒ file a task. ⛔ Unlike `workable`, a task that
 *                    is merely `done` does NOT cover a regression.
 *  frozen-violated   frozen population only: the AC is `achieved` but has LEFT the re-verify domain
 *                    (GOAL not active, `long-term` not declared) while the ledger tail says it is
 *                    false right now, and no in-flight task handles it ⇒ file a task. ⛔ A different
 *                    population from `standing-violated` (inside/outside the domain) — merging them
 *                    would hide "nobody looks after it once it leaves the domain", the very defect
 *                    this state exists to surface (hard rule 3b).
 *  derived-routed    AC-216 re-verify domain only, for criteria whose truth is DERIVED from the
 *                    frozen population: it is violated now, but its criterion reads `check
 *                    --stale-pass` (the frozen population's input face), so its truth is the
 *                    proposition "some frozen AC is false right now" — and ③ is that proposition's
 *                    only judge, already routing the offending AC this round. ⇒ ② must ⛔ NOT file a
 *                    second task for it. ⛔ Not standing-ok (it IS false right now — claiming it holds
 *                    would be a false green) and ⛔ not not-evaluated (the reading exists; another
 *                    judge owns the cause).
 */
export type GapState =
  | "in-progress"
  | "gap"
  | "workable"
  | "world-gated"
  | "unclassified"
  | "stalled"
  | "blocked-needs-human"
  | "blocked-promotion"
  | "blocked-dispatch"
  | "not-evaluated"
  | "standing-ok"
  | "standing-violated"
  | "frozen-violated"
  | "derived-routed";

/** Every legal `GapState` value, in the order they appear in the union. Exported so a consumer (the
 *  CLI's row validation, the tests) can ENUMERATE the vocabulary instead of hardcoding a set. */
export const GAP_STATES: readonly GapState[] = [
  "in-progress",
  "gap",
  "workable",
  "world-gated",
  "unclassified",
  "stalled",
  "blocked-needs-human",
  "blocked-promotion",
  "blocked-dispatch",
  "not-evaluated",
  "standing-ok",
  "standing-violated",
  "frozen-violated",
  "derived-routed",
];

/** The three `blocked-*` causes, in PRIORITY order (a task set whose members are blocked by
 *  different causes is reported under the first one that occurs — "a human must move it" outranks
 *  "fix the artifacts", which outranks "fix dispatch": a human decision unblocks every other cause).
 *
 *  ⛔ ONE list: the driver's cause classifier (`taskBlockCause`), the group reading
 *  (`blockedReadingOf`), the projection's rank table and the CLI's row validation all branch on THIS
 *  array — a second copy anywhere is the drift this module exists to prevent (hard rule 5b). */
export type BlockedGapState = "blocked-needs-human" | "blocked-promotion" | "blocked-dispatch";

export const BLOCKED_GAP_STATES: readonly BlockedGapState[] = [
  "blocked-needs-human",
  "blocked-promotion",
  "blocked-dispatch",
];

/** One linked task and the cause IT carries (⚠️ per-task, ⛔ not the group's winner — a set can hold
 *  two different causes, and collapsing them would hide the second one; hard rule 3). */
export interface GoalBlockerTask {
  id: string;
  cause: BlockedGapState;
}

/** WHY a criterion's in-traction tasks cannot advance (present iff `state` is one of `blocked-*`).
 *
 *  ⛔ `cause` is the GROUP's reading — the highest-priority cause among `tasks` (`BLOCKED_GAP_STATES`
 *  order) — while `tasks` ENUMERATES every stuck task with its own cause, so "which task blocks it"
 *  is readable without re-deriving the judgement the driver already made. */
export interface GoalBlocker {
  cause: BlockedGapState;
  tasks: GoalBlockerTask[];
}

/** One AC's gap reading. `taskCount` is `null` only for `not-evaluated` (⛔ a different shape from
 *  `0`: when the reading could not be taken, "how many tasks are its" has no answer).
 *
 *  `blocker` is present IFF `state` is one of `blocked-*` (⚠️ optional rather than required-null so a
 *  round carrier written BEFORE the split still parses: its `stalled` rows have no blocker and are
 *  not lied about — absence there means "this reading predates the split", which is exactly what a
 *  legacy `stalled` row is). */
export interface GoalGap {
  goal: string;
  ac: string;
  state: GapState;
  taskCount: number | null;
  blocker?: GoalBlocker;
}

/** The task snapshot the projection reads (`readTaskFacts` in the goal-driver). Structurally typed
 *  (only these three fields are read) so a caller does not have to construct the driver's fuller
 *  fact type just to ask for a projection. */
export interface GoalTaskFact {
  id: string;
  status: string | null;
  goalAc: string | null;
}

// ── the projection ────────────────────────────────────────────────────────────────────────────────

/** Who would have to act next. ENUMERATED (hard rule 3): a consumer branches on a value, never on a
 *  boolean, and a new "kind of owner" is a new value rather than a re-labelled old one. */
export type GoalNextOwner = "driver" | "worker" | "human" | "world";

export const GOAL_NEXT_OWNERS: readonly GoalNextOwner[] = ["driver", "worker", "human", "world"];

/** What that owner would do next. ENUMERATED for the same reason. ⛔ `wait` is a REAL action here —
 *  "the truth is a future production event / nobody has anything to do" — not a missing value. */
export type GoalNextActionKind =
  | "file-task"
  | "resume-task"
  | "fix-artifacts"
  | "fix-dispatch"
  | "ask-human"
  | "wait";

export const GOAL_NEXT_ACTION_KINDS: readonly GoalNextActionKind[] = [
  "file-task",
  "resume-task",
  "fix-artifacts",
  "fix-dispatch",
  "ask-human",
  "wait",
];

/** The ranking key. The first six are the task's declared order
 *  (`needs-human → stalled → workable → gap → world-gated → not-evaluated`); the rest extend that
 *  total order so EVERY gap state has a defined position — a state omitted from the order would
 *  make the choice between two gaps of a goal depend on input order (a silent, unstable reading).
 *
 *  `needs-human` is NOT a `GapState`: it is a DERIVED rank — a gap whose AC has a task explicitly
 *  parked `needs-human` outranks the same gap state's other causes, because the next step is a human
 *  decision, not a mechanism action. `computeGoalGaps` folds that cause into `stalled`; this
 *  projection reads the task statuses to tell the two apart again (the successor task
 *  gap-goal-driver-blocked-taxonomy splits the STATE itself, this rank is the same distinction one
 *  level up, available today without changing computeGoalGaps). */
export type GoalNextRank =
  | "needs-human"
  | "blocked-needs-human"
  | "blocked-promotion"
  | "blocked-dispatch"
  | "stalled"
  | "workable"
  | "gap"
  | "world-gated"
  | "not-evaluated"
  | "standing-violated"
  | "frozen-violated"
  | "unclassified"
  | "in-progress"
  | "derived-routed"
  | "standing-ok";

/** The ranking, highest priority first (see `GoalNextRank`).
 *
 *  ⚠️ `stalled` stays in this order for INPUT compatibility only (fixtures and rows in round
 *  carriers written before the split). The three `blocked-*` ranks sit immediately above it
 *  and below `needs-human`, i.e. the position `stalled` always occupied. */
export const GOAL_NEXT_PRIORITY: readonly GoalNextRank[] = [
  "needs-human",
  "blocked-needs-human",
  "blocked-promotion",
  "blocked-dispatch",
  "stalled",
  "workable",
  "gap",
  "world-gated",
  "not-evaluated",
  "standing-violated",
  "frozen-violated",
  "unclassified",
  "in-progress",
  "derived-routed",
  "standing-ok",
];

const RANK_INDEX = new Map<GoalNextRank, number>(GOAL_NEXT_PRIORITY.map((r, i) => [r, i]));

/** One projected next step. `ac` is the criterion the step is about; `gapState` is the HONEST reading
 *  it came from (⛔ so an escalated legacy `stalled`-with-a-needs-human-task still says `stalled` here
 *  — the escalation is visible in `rank`/`owner`/`action`, not by rewriting the reading).
 *  `evidenceRefs` are stable tokens pointing at what the row was derived from (`gap:<ac>`,
 *  `task:<id>:<status>`), so a reader can trace the row back to the same round's carriers.
 *
 *  `blocker` is copied VERBATIM from the gap reading (`GoalGap.blocker`) whenever the state is one of
 *  `blocked-*`, and is `null` otherwise. ⛔ It is NOT re-derived here: the cause was decided where the
 *  ready-pool judgement was available (`computeGoalGaps`), and re-deciding it from task statuses in
 *  the projection would be a second judge of the same question (hard rule 5b). */
export interface GoalNextRow {
  goal: string;
  ac: string;
  gapState: GapState;
  rank: GoalNextRank;
  owner: GoalNextOwner;
  action: { kind: GoalNextActionKind; reason: string };
  evidenceRefs: string[];
  blocker: GoalBlocker | null;
}

/** The owner/action each state implies. ⛔ ONE table: a second copy anywhere is the drift this
 *  whole module exists to prevent (hard rule 5b). `needs-human` is handled separately — it is a
 *  rank derived from task statuses, not a gap state. */
const STATE_PLAN: Record<GapState, { owner: GoalNextOwner; kind: GoalNextActionKind; reason: string }> = {
  // A criterion whose truth is a future production event: nobody in the repo can produce it, so the
  // next step is to WAIT for the world and let the next round's gate re-read it.
  "world-gated": { owner: "world", kind: "wait", reason: "criterion reads a production carrier; the truth is a future production event" },
  // Zero associated tasks ⇒ the only missing thing is the task itself.
  gap: { owner: "driver", kind: "file-task", reason: "no task is linked to this criterion; file one" },
  // Tasks exist but all finished while the criterion still fails ⇒ the work is not done; file again.
  workable: { owner: "driver", kind: "file-task", reason: "linked tasks are no longer in traction but the criterion still fails; file a task" },
  // ⚠️ LEGACY row (never emitted by `computeGoalGaps` since the split): kept so a row read back from
  // an older carrier still projects to the owner/action it had. New readings use the three below.
  stalled: { owner: "worker", kind: "fix-artifacts", reason: "linked tasks cannot advance on their own; fix what blocks them" },
  // Every in-traction task is parked needs-human ⇒ a HUMAN decision is the next step, not a worker's.
  "blocked-needs-human": { owner: "human", kind: "ask-human", reason: "every task linked to this criterion is parked needs-human; a human must move it" },
  // Every in-traction task is a todo the author→ready gate rejects ⇒ the four artifacts are missing.
  "blocked-promotion": { owner: "worker", kind: "fix-artifacts", reason: "linked todo tasks do not pass the author→ready promotion gate; fix their artifacts" },
  // Every in-traction task is a ready the pool excludes ⇒ it can never be dispatched as it stands.
  "blocked-dispatch": { owner: "worker", kind: "fix-dispatch", reason: "linked ready tasks are excluded from the dispatch pool; check their dependencies and worktree" },
  // The reading itself could not be taken — an instrument failure, not "nothing to do".
  "not-evaluated": { owner: "driver", kind: "fix-artifacts", reason: "the gap reading could not be taken; restore the reading" },
  // A red standing invariant with no in-flight owner ⇒ file.
  "standing-violated": { owner: "driver", kind: "file-task", reason: "standing invariant is violated and no task is in flight; file a task" },
  // A red frozen-population AC with no in-flight owner ⇒ file.
  "frozen-violated": { owner: "driver", kind: "file-task", reason: "frozen criterion is false right now and no task is in flight; file a task" },
  // The classifier could not parse the criterion text ⇒ the criterion artifact needs fixing.
  unclassified: { owner: "driver", kind: "fix-artifacts", reason: "the criterion text could not be classified; fix the criterion" },
  // Somebody already holds it ⇒ the next step for that owner is to carry on with the existing task.
  "in-progress": { owner: "worker", kind: "resume-task", reason: "a task is already advancing this criterion; continue it" },
  // The red is another AC's owner's job (its truth is derived from that AC's population) — no action
  // of this criterion's own to take; wait for the owning AC to move.
  "derived-routed": { owner: "driver", kind: "wait", reason: "this red is routed to the AC that owns the derived population" },
  // The standing invariant holds right now ⇒ no work to file.
  "standing-ok": { owner: "driver", kind: "wait", reason: "standing invariant holds; nothing to file" },
};

/** Numeric-aware, locale-independent id comparison: `AC-9` sorts before `AC-10` (a plain string
 *  compare would put `AC-10` first and make the tie-break subtly wrong for a reader). */
function compareIds(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

/** The rank of one gap reading, after the needs-human escalation.
 *
 *  ⚠️ The escalation now survives for the LEGACY `stalled` input only: since the split, a reading
 *  whose tasks are all parked needs-human says so ITSELF (`blocked-needs-human`), so no escalation is
 *  needed to see it. A legacy `stalled` row read back from an older carrier still escalates exactly as
 *  before — dropping that would silently demote every historical needs-human goal in `quay goal next`. */
function rankOf(gap: GoalGap, taskFacts: GoalTaskFact[] | null): GoalNextRank {
  if (gap.state === "stalled" && hasNeedsHumanTask(gap.ac, taskFacts)) return "needs-human";
  // Every remaining state is its own rank (see GOAL_NEXT_PRIORITY) — the three blocked-* states
  // ARE ranks, so the cause travels into the rank instead of being flattened back into `stalled`.
  return gap.state;
}

/** Does any task linked to this AC sit at `needs-human`? That status means a HUMAN must move it —
 *  the state `computeGoalGaps` reports as `stalled` but whose owner is not a worker. */
function hasNeedsHumanTask(ac: string, taskFacts: GoalTaskFact[] | null): boolean {
  if (taskFacts === null) return false; // no snapshot ⇒ no escalation claim (⛔ never guessed)
  return taskFacts.some((t) => t.goalAc === ac && t.status === "needs-human");
}

/** The evidence tokens for one AC: the gap reading itself plus every task linked to it (sorted, so
 *  the same input yields a byte-identical array — the round fact is diffed by humans). */
function evidenceRefsFor(ac: string, taskFacts: GoalTaskFact[] | null): string[] {
  const refs = [`gap:${ac}`];
  if (taskFacts === null) return refs;
  const linked = taskFacts
    .filter((t) => t.goalAc === ac)
    .map((t) => `task:${t.id}:${t.status ?? "unknown"}`)
    .sort(compareIds);
  return [...refs, ...linked];
}

/** The row for one gap reading. */
function rowFor(gap: GoalGap, taskFacts: GoalTaskFact[] | null): GoalNextRow {
  const rank = rankOf(gap, taskFacts);
  // `blocker` travels verbatim from the reading (⛔ never re-derived here); `null` = not a blocked
  // state, which the row's `gapState` already says — the two are not conflated because `gapState` is
  // always present.
  const blocker = gap.blocker ?? null;
  // The ONLY way rank ≠ state is the legacy needs-human escalations (see `rankOf`).
  if (rank !== gap.state) {
    return {
      goal: gap.goal,
      ac: gap.ac,
      gapState: gap.state,
      rank,
      owner: "human",
      action: { kind: "ask-human", reason: "a task linked to this criterion is parked needs-human; a human must move it" },
      evidenceRefs: evidenceRefsFor(gap.ac, taskFacts),
      blocker,
    };
  }
  const plan = STATE_PLAN[gap.state];
  return {
    goal: gap.goal,
    ac: gap.ac,
    gapState: gap.state,
    rank,
    owner: plan.owner,
    action: { kind: plan.kind, reason: plan.reason },
    evidenceRefs: evidenceRefsFor(gap.ac, taskFacts),
    blocker,
  };
}

/** The fallback row for an active GOAL the gap reading produced NO entry for.
 *
 *  ⛔ `not-evaluated`, NOT an empty/omitted row: `gaps` is the population "every active AC, every
 *  re-verify AC, every false frozen AC" — a goal absent from it means the reading did not reach it
 *  (e.g. all of its ACs were already achieved and outside every re-verify population this round).
 *  Reporting "nothing to do" there would be the false green hard rule 3b forbids; reporting
 *  "not-evaluated" with the instrument's owner is the honest shape.
 *
 *  `ac` names a real criterion of that goal (the first one, numeric order) so the row is actionable
 *  and its `ac` is never empty — a GOAL cannot be active without at least one AC record (the store's
 *  activation gate enforces AC-first), and if that invariant were ever broken the row still carries
 *  the goal id, with `ac: ""` as the visible symptom. */
function fallbackRow(goalId: string, acsOfGoal: string[]): GoalNextRow {
  const ac = acsOfGoal.length > 0 ? [...acsOfGoal].sort(compareIds)[0] : "";
  return {
    goal: goalId,
    ac,
    gapState: "not-evaluated",
    rank: "not-evaluated",
    owner: "driver",
    action: {
      kind: "fix-artifacts",
      reason: "the gap reading produced no entry for this active goal; restore the reading",
    },
    evidenceRefs: [`gap:${goalId}:absent`],
    // ⛔ `null`, not an empty blocker: this row is not a blocked reading at all (its `gapState` says
    // `not-evaluated`). An empty `{cause, tasks: []}` would wear the shape of a measured blocker.
    blocker: null,
  };
}

/**
 * `goalNextProjection(records, gaps, taskFacts)` — for EVERY active GOAL, exactly one row saying what
 * the next step is and who owns it.
 *
 * The chosen row is the goal's HIGHEST-PRIORITY gap (`GOAL_NEXT_PRIORITY`), ties broken by AC id.
 * The result array is sorted by the same key, so reading it top-down shows the most human-blocking
 * goals first.
 *
 * `taskFacts === null` (the tasks snapshot was unreadable) is NOT an error: the gap states the driver
 * computed from that same snapshot already read `not-evaluated`, and the only thing lost here is the
 * needs-human escalation — which must never be guessed from a missing snapshot (hard rule 6:
 * missing = not checked, ⛔ not "no").
 */
export function goalNextProjection(
  records: Array<Record<string, unknown>>,
  gaps: Array<GoalGap>,
  taskFacts: GoalTaskFact[] | null,
): GoalNextRow[] {
  // The active-GOAL set — the same predicate the driver's `activeGoalIdsOf` uses (id prefix + status),
  // derived here from `records` so the projection has no second source for "which goals are active".
  const activeGoalIds = records
    .filter((r) => String(r.id ?? "").startsWith("GOAL-") && String(r.status ?? "") === "active")
    .map((r) => String(r.id ?? ""))
    .sort(compareIds);

  const rows: GoalNextRow[] = [];
  for (const goalId of activeGoalIds) {
    const candidates = gaps.filter((g) => g.goal === goalId);
    if (candidates.length === 0) {
      const acsOfGoal = records
        .filter((r) => String(r.id ?? "").startsWith("AC-") && String(r.goal ?? "") === goalId)
        .map((r) => String(r.id ?? ""));
      rows.push(fallbackRow(goalId, acsOfGoal));
      continue;
    }
    // Pick the best candidate: rank first (the declared priority), then AC id (stable, numeric-aware).
    // ⛔ The tie-break is not cosmetic: without it the chosen row would depend on `gaps`' iteration
    // order, i.e. on the record file order — the same state would project differently across rounds.
    let best: GoalNextRow | null = null;
    for (const gap of candidates) {
      const row = rowFor(gap, taskFacts);
      if (best === null) { best = row; continue; }
      const dRank = (RANK_INDEX.get(row.rank) ?? Number.MAX_SAFE_INTEGER) - (RANK_INDEX.get(best.rank) ?? Number.MAX_SAFE_INTEGER);
      if (dRank < 0 || (dRank === 0 && compareIds(row.ac, best.ac) < 0)) best = row;
    }
    if (best !== null) rows.push(best);
  }

  // Global order: rank, then AC id, then goal id (the last key only breaks ties that cannot occur —
  // AC ids are unique — but keeps the comparator total, so the output can never depend on input order).
  rows.sort((a, b) => {
    const dRank = (RANK_INDEX.get(a.rank) ?? Number.MAX_SAFE_INTEGER) - (RANK_INDEX.get(b.rank) ?? Number.MAX_SAFE_INTEGER);
    if (dRank !== 0) return dRank;
    const dAc = compareIds(a.ac, b.ac);
    if (dAc !== 0) return dAc;
    return compareIds(a.goal, b.goal);
  });
  return rows;
}
