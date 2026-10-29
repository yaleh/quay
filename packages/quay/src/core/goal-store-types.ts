// quay Core: the goal store's RECORD SHAPES + id vocabulary — the leaf the store's
// composed sub-modules share.
//
// Extracted from `./goal-store.ts` (tasks/gap-routine-architecture-analysis-god-function-
// creategoalstore): `createGoalStore` was a single 1,647-line closure factory, and every
// sub-surface pulled out of it needs the SAME frontmatter/view-model shapes and the same
// GOAL-NNN / AC-NNN predicate. Keeping them here means the reads / checks / rotation modules
// agree on ONE definition instead of each importing the factory's host file (which would be a
// value cycle) — hard rule 5b: one implementation, not one per consumer.
//
// ⛔ Nothing here reads or writes disk; it is types + pure predicates only.

import type { GoalStaleness } from "./goal-staleness.ts";

// SPEC-goal-branch-2026-10-03 §4.7 (裁定⑭⑮) — an AC's evaluation PHASE, declared by the person/agent
// who files it (⛔ never inferred from the criterion's text — hard rule 2). `pre-merge` is the default
// because the misclassification directions are asymmetric: a post-merge AC left unmarked is
// not-evaluable on the criterion worktree ⇒ the merge precondition can never be met ⇒ STUCK AND
// VISIBLE; a pre-merge AC marked post-merge silently skips the isolation check. The default picks the
// side that fails loudly. Only meaningful under a `branch: true` goal (a plain goal ignores it).
export const VALID_CRITERION_PHASES: string[] = ["pre-merge", "post-merge"];
export type CriterionPhase = "pre-merge" | "post-merge";

export const GOAL_ID_RE = /^GOAL-\d{3,}$/;
export const AC_ID_RE = /^AC-\d{3,}$/;

export function isGoalId(id: string): boolean {
  return typeof id === "string" && GOAL_ID_RE.test(id);
}

export function isCriterionId(id: string): boolean {
  return typeof id === "string" && AC_ID_RE.test(id);
}

export interface GoalFrontmatter {
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
  /** SPEC-goal-branch §4.1 — opt-in: the goal's tasks land on the DERIVED branch `goal/<id>`.
   *  Absent/false = today's behavior. Only the "open or not" bit is stored; the branch NAME is
   *  derived (⛔ never persisted, ⛔ never caller-supplied). */
  branch?: boolean;
  /** SPEC-goal-branch §4.7 (裁定⑭⑮) — CRITERION records only: the phase at which this AC is
   *  evaluated. Absent ⇒ projected as `pre-merge`. Stored verbatim when explicitly declared. */
  phase?: string;
}

export interface GoalFilter {
  status?: string;
  kind?: string;
  goal?: string;
  /** gap-goal-list-ledger-scan: `false` ⇒ SKIP the derived evidence (the `.quay/gate-events.jsonl`
   *  scan) and the two annotations that depend on it (`progress` / `staleness`). The ledger is
   *  append-only and grows without bound (measured 165MB / 587k rows in this repo), so its cost is
   *  ∝ ledger size and INDEPENDENT of the goal count — a consumer that only needs the goal
   *  frontmatter (ids / statuses / titles, e.g. a fleet overview) must be able to avoid it.
   *  ⛔ Absent ⇒ `true` (full evidence) — the pre-existing read shape is unchanged. */
  includeEvidence?: boolean;
}

export interface GoalViewModel {
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
  /** SPEC-goal-branch §4.1 — opt-in isolation gate, projected from the `branch` frontmatter field.
   *  ⛔ `false`, never `undefined`: "the field is absent" and "the goal declined a branch" are the
   *  same answer to the ABI consumer ("this goal lands on the landing baseline"). */
  branch: boolean;
  /** SPEC-goal-branch §4.7 (裁定⑭⑮) — the AC's evaluation phase (frontmatter `phase` projection).
   *  ⛔ Always one of `pre-merge` / `post-merge`, never `undefined`: "the field is absent" and "the
   *  author declared pre-merge" are the same answer to the driver. The store refuses to persist any
   *  other value (hard rule 3b — an unreadable value must not project as `pre-merge`). */
  phase: CriterionPhase;
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
