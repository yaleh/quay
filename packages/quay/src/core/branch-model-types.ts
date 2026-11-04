// branch-model-types.ts — the DATA/VOCABULARY half of branch-model.ts.
//
// Split out of branch-model.ts by gap-routine-architecture-analysis-god-package-core
// (architecture-analysis finding "god-package-core": "separate branch-model policy from data types").
// `branch-model.ts` keeps the POLICY (git reads, classification, provisioning, checkout handoff,
// invariant check, goal-branch lifecycle); this file holds the SHAPE — the role/state/action/report
// types and the protocol vocabulary (role names, the goal-branch token pattern). `branch-model.ts`
// re-exports everything here (`export *`), so its public surface is unchanged.

/**
 * The landing baseline's quay role name — the SAME literal the shipped mechanism reads.
 *
 * `develop` is a PROTOCOL-FIXED git ref (it is in `target-identity-literal-check.ts`'s
 * `LEGAL_IDENTITY_VALUES` alongside `integration`/`master`/`HEAD`), so naming it here is not a
 * per-project identity assumption. The DOC branch role is the opposite case — see
 * `resolveDocBranchRole` below.
 */
export const LANDING_BASELINE_ROLE = "develop";

/** Classification of ONE branch against the project's default branch. */
export type RefState = "absent" | "compatible" | "divergent" | "unreadable";

export interface RefClassification {
  /** The branch name that was classified (a quay ROLE name, e.g. `develop`). */
  name: string;
  state: RefState;
  /** Resolved sha of the branch, or null when absent/unreadable. */
  sha: string | null;
  /** Commits on the branch that the default branch does not contain (null when unknown). */
  aheadOfDefault: number | null;
  /** Commits on the default branch that the branch does not contain (null when unknown). */
  behindDefault: number | null;
  /** Always populated — the machine-readable cause (`absent`, `contains-default`, `foreign-fork`, …). */
  reason: string;
  /** Human-readable detail for the operator (never the sole carrier of `state`). */
  detail: string;
}

/** What `quay init` did (or would do) to one role branch. */
export type BranchAction = "created" | "reused" | "adopted" | "blocked" | "unreadable";

export interface BranchModelEntry {
  /** The quay role (`develop` | `author`) or `default` for the project's own default branch. */
  role: string;
  /** The concrete ref that fills the role. */
  ref: string;
  action: BranchAction;
  /** Sha the ref points at after the operation (null when it could not be resolved). */
  sha: string | null;
  /** Backup ref created by `adopt` (the preserved pre-quay tip), else null. */
  backupRef: string | null;
  detail: string;
}

export interface BranchModelReport {
  /** False iff any entry is `blocked` (a divergent branch without `adopt`) — init must not proceed. */
  ok: boolean;
  /** True when the repo could not be classified at all (no git / no commits) — provisioning skipped. */
  skipped: boolean;
  /**
   * WHY nothing could be classified — `null` when the model WAS judged.
   *
   * ⛔ First-class on purpose (hard rule 2: judge by position, never by matching a keyword in
   * `entries[0].detail`): the two skips are NOT the same answer to the caller. `not-a-git-worktree`
   * is permanent for this target, whereas `no-commits` is the UNBORN repository — a state a LATER
   * step of the SAME run can resolve, because `autoCommitClosedSet` creates the first commit. Only
   * the caller that knows what else this run will do can act on that difference, which is exactly
   * why the reason belongs on the report rather than being re-derived from a prose string
   * (gap-init-branch-model-runs-before-auto-commit-fresh-repo-needs-two-runs).
   */
  skipReason: "not-a-git-worktree" | "no-commits" | null;
  /** The project's default branch (`master` role), or null when unresolvable. */
  defaultBranch: string | null;
  entries: BranchModelEntry[];
  /** Operator-facing next step when `ok === false`. */
  remedy: string | null;
}

export interface EnsureBranchModelOptions {
  /** Copy the divergent branch aside and re-point it at the default tip (opt-in, never default). */
  adopt?: boolean;
  /** Plan only — classify and report, mutate nothing. */
  dryRun?: boolean;
}

/** The doc-branch role's state relative to the landing baseline. A CLASSIFICATION, never a boolean
 *  (hard rule 3): `blocked` and `unreadable` are both non-empty answers but only one of them is a
 *  refusal. */
export type DocBranchState =
  /** ①/②: the main checkout is NOT on the landing baseline — the invariant already holds. */
  | "independent"
  /** ①: the main checkout IS on the landing baseline and no branch carries the requested name. */
  | "absent"
  /** ①: the main checkout IS on the landing baseline and a RELATED branch carries the name. */
  | "reusable"
  /** ①: a RELATED branch carries the name but is BEHIND the landing baseline (a strict ancestor —
   *  no unique commits). The doc branch is fast-forwarded to the baseline before the checkout moves
   *  onto it, so the working copy lands on the CURRENT tree, never an older one
   *  (gap-quay-init-doc-branch-behind-baseline-reports-satisfied gave the reading;
   *  gap-quay-init-doc-branch-strict-ancestor-fast-forward made it lossless). */
  | "behind"
  /** ①: the name is taken by a branch with NO ancestry relation to the baseline — a real collision. */
  | "blocked"
  /** HEAD detached/unborn, not a work tree, or undecidable ancestry — verdict WITHHELD. */
  | "unreadable";

/** What the operation did (or would have done). Kept apart from `DocBranchState` so a mutation that
 *  FAILED is not silently reported as the classification it failed to act on, and so an `adopted`
 *  collision (`state: "blocked"`, `action: "adopted"`) does not print the refusal marker the shell
 *  relays on. */
export type DocBranchAction = "created" | "switched" | "fast-forwarded" | "noop" | "blocked" | "adopted" | "unreadable" | "failed";

export interface DocBranchReport {
  state: DocBranchState;
  action: DocBranchAction;
  /** False ONLY for a real refusal or a failed mutation — `unreadable` is NOT a failure. */
  ok: boolean;
  /** True iff the verdict was withheld (`state === "unreadable"`) — distinct from `ok === true`. */
  notEvaluated: boolean;
  /**
   * True when this report is a PLAN: `action` names what WOULD happen, and nothing was moved.
   *
   * ⛔ On the report rather than inferred by the renderer: `action: "created"` under `--dry-run` and
   * `action: "created"` on a real run are two different facts about the world, and a rendering that
   * prints the same sentence for both states a plan in the past tense (hard rule 3b — "would do" must
   * never be shaped like "did").
   */
  dryRun: boolean;
  /** The requested doc-branch name (echoed verbatim; never invented here). */
  name: string;
  checkedOut: string | null;
  baselineSha: string | null;
  /** Sha of the named branch BEFORE the operation (null when it did not exist). */
  preexistingSha: string | null;
  /** The doc branch's sha AFTER the operation (null when nothing was established). */
  sha: string | null;
  /**
   * Commits on the landing baseline that the doc branch does NOT contain — the explicit lag reading
   * `git rev-list --count <name>..develop`. `null` = NOT assessed (⛔ never 0 masquerading as "same
   * tip": 0 is only meaningful when the read succeeded and the branch is the baseline's ancestor or
   * the same tip). `0` = same tip / not behind.
   */
  behindBaseline: number | null;
  detail: string;
}

export interface EnsureDocBranchOptions {
  /**
   * The doc-branch name to establish — REQUIRED, and the caller owns its default. Empty/absent is
   * reported as `unreadable`, never silently defaulted (see this section's header).
   */
  name: string;
  /** Plan only — classify and report, mutate nothing (no branch created, HEAD not moved). */
  dryRun?: boolean;
  /**
   * The NAME-COLLISION decision, opt-in and never default. False ⇒ a branch carrying `name` that
   * shares no ancestry with the baseline is REFUSED (`state: "blocked"`, nothing moved). True ⇒ the
   * SAME adopt primitive `ensureBranchModel` uses for a divergent landing baseline: preserve the
   * colliding tip under `<name>-pre-quay-init-<sha>`, re-point `name` at the baseline, switch to it.
   * Nothing is destroyed either way; this flag only decides whether the operator's decision is
   * carried out or handed back to them. ⛔ Not to be confused with the landing-baseline role's
   * `adopt`: both are the SAME declared decision (`--adopt-branch-model`), applied to two roles.
   */
  adopt?: boolean;
}

/** The report-entry role this handoff keys on — the SAME token `ensureBranchModel` emits and
 *  `plugin/scripts/quay-init.sh` relays as a POSITION in the report, not a second judgment. */
export const LANDING_BASELINE_ENTRY_ROLE = "landing-baseline";

/** What the handoff did (or refused to do). A CLASSIFICATION, never a boolean (hard rule 3). */
export type BaselineCheckoutAction = "switched" | "already-on-baseline" | "not-evaluated" | "failed";

export interface BaselineCheckoutReport {
  action: BaselineCheckoutAction;
  /** False ONLY for a failed mutation — `not-evaluated` is a WITHHELD verdict, not a failure. */
  ok: boolean;
  /** True iff `action === "not-evaluated"` — distinct from `ok === true` (hard rule 3b). */
  notEvaluated: boolean;
  /** The branch the main checkout was on (null when HEAD is detached/unborn). */
  from: string | null;
  /** Always `LANDING_BASELINE_ROLE` — the ref the checkout was to be moved onto. */
  to: string;
  detail: string;
}

/** The standing invariant's classification — a CLASSIFICATION, never a boolean (hard rule 3). */
export type DocBranchInvariantState = "satisfied" | "violated" | "behind" | "pending" | "not-evaluated";

/** The machine-readable cause attached to the state (enumerated, never prose-matched downstream). */
export type DocBranchInvariantReason =
  | "not-on-baseline"
  | "on-baseline-no-doc-branch"
  | "on-baseline-doc-branch-elsewhere"
  | "on-baseline-doc-branch-collision"
  | "doc-branch-behind-baseline"
  | "no-commits-yet"
  | "detached-head"
  | "not-a-git-worktree"
  | "no-doc-branch-name"
  | "doc-branch-is-baseline"
  | "ancestry-undecidable";

export interface DocBranchInvariantReport {
  state: DocBranchInvariantState;
  /** False for `violated` and `behind` — `pending` and `not-evaluated` are not failures (hard rule 3b). */
  ok: boolean;
  /** True iff the verdict was WITHHELD (`state === "not-evaluated"`) — distinct from `ok === true`. */
  notEvaluated: boolean;
  /** The enumerated cause (`not-on-baseline`, `on-baseline-no-doc-branch`, `no-commits-yet`, …). */
  reason: DocBranchInvariantReason;
  /** The branch the main checkout is on, or null when HEAD is detached/unreadable. */
  checkedOut: string | null;
  /** Always `LANDING_BASELINE_ROLE` — the ref the invariant is about. */
  baseline: string;
  /** The requested doc-branch name (echoed verbatim; never invented here). */
  docBranch: string;
  /** The named doc branch's sha, or null when it does not exist. */
  docBranchSha: string | null;
  /**
   * Commits on the landing baseline that the doc branch does NOT contain (null when not assessed).
   * Carried on both the `behind` and `satisfied`/`violated` readings that measured it, so the lag is
   * never recomputed from a prose string downstream.
   */
  behindBaseline: number | null;
  detail: string;
  /** The single command that repairs a `violated` state; null otherwise. */
  remedy: string | null;
}

export interface DocBranchInvariantOptions {
  /** The doc-branch name to judge against — REQUIRED by the caller (see the section header). */
  name: string;
}

/** Goal-branch name pattern (quay-protocol-derived, ⛔ not a per-project name) — shared with
 *  `target-identity-literal-check.ts` so the identity rule and the lifecycle agree on what a
 *  goal-branch token IS. At least three digits, matching the store's own id vocabulary. */
export const GOAL_BRANCH_RE = /^goal\/GOAL-\d{3,}$/;

/** What `ensureGoalBranch` did (or refused to do). A CLASSIFICATION, never a bare boolean. */
export type GoalBranchAction = "created" | "reused" | "blocked" | "unreadable";

export interface GoalBranchReport {
  action: GoalBranchAction;
  /** ⛔ False ONLY for `blocked`; `unreadable` is a WITHHELD verdict (hard rule 3b), not a failure. */
  ok: boolean;
  /** True iff `action === "unreadable"` — distinct from `ok === true`. */
  notEvaluated: boolean;
  /** The derived branch name (`goal/<id>`). */
  name: string;
  /** The ref's sha after the call (the ref that was reused, or the newly created one's). */
  sha: string | null;
  /** The base sha the branch was created from (`develop` tip), null on reuse/unreadable. */
  base: string | null;
  detail: string;
}
