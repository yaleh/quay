// quay Core: goal-ac-write-face — the ONE implementation of AC-190's write-face rule
// (goals/AC-190-task-ac.md): a NEW `delivery-critical` task must declare a non-empty top-level
// `goal_ac`, because the label asserts a LONG-TERM guarantee that only the goal layer can back.
//
// WHY THIS MODULE EXISTS (tasks/gap-ac190-write-face-rule-unreachable-under-no-verify, 2026-09-14 —
// the rule's SECOND recurrence): the first fix (gap-ac190-goal-ac-rule-not-enforced-at-filing,
// 2026-09-13) put the judgment on "the moment of the write" and chose the WRONG moment — clause ③ of
// `plugin/scripts/precommit-guard.ts`, which only runs from the git `pre-commit` hook. Production
// filings never reach a hook: `task_write` → `store.ts write()` → `commitStoreWrite()` →
// `git commit --no-verify` (store-commit.ts:13-15 declares `--no-verify` as the DESIGN). Measured:
// 370/400 of the last 400 `tasks/` commits are store-commit-shaped ⇒ `--no-verify` ⇒ the hook
// judgment is STRUCTURALLY UNREACHABLE on the writer's path (hard rule 3b's mirror, and hard rule 4
// corollary 3: the previous fix's own e2e walked the HAND path, not the WRITER path). So the rule is
// now implemented where the writer actually is — `store.ts write()` — and this module is its single
// source: the store, the per-round detector and the pre-commit hook all acquire the SAME functions
// from here (hard rule 1: use the mechanism, don't hand-roll; hard rule 5b: fixing one instance is
// not the same as there being one instance).
//
// THE ARROW (why the predicate lives in Core, not in plugin/scripts): `plugin/scripts/
// goal-driver.ts`, `meta-driver.ts` and `packages/quay-native/src/store.ts` all already import from
// `packages/quay/src/`; nothing under `packages/quay/` imports `plugin/scripts/` for a JUDGMENT. The
// same move was made for the criterion-attribution predicate (goal-store.ts +
// plugin/scripts/criterion-failure-attribution-check.ts's `export { … } from` block) — that file is
// the template this one follows, including keeping the plugin-side import surface unchanged.
//
// ⚠️ The plugin-side script entry paths do NOT move: `plugin/scripts/long-term-guarantee-goal-backed-
// check.ts` (the per-round detector, AC-190's criterion) re-exports every name below, so its own
// importers — including `plugin/test/long-term-guarantee-goal-backed-check.test.mjs` — are unchanged.

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatterCompletely } from "./task-parsing.ts";

// ── 生效线（显式 cutoff） ───────────────────────────────────────────────────────────────────────────
// 只对【生效线之后新立案】的任务 fail-closed。实测（2026-09-09）：带 delivery-critical 标签的任务
// 125 条、其中 120 条无 goal_ac；最新一条 first-add 时刻 2026-09-08T22:30:33Z。生效线取
// 2026-09-09T00:00:00Z ⇒ 存量全部 grandfathered（单独排期，⛔ 不在本任务清）。
export const ACTIVATION_LINE_ISO = "2026-09-09T00:00:00Z";

export const DELIVERY_CRITICAL_LABEL = "delivery-critical";

// 负控制注入的合成条目：一条「生效线之后、带 delivery-critical、无 goal_ac」的任务。
export const INJECTED_UNBACKED_ID = "gap-injected-unbacked-fixture";

/** 生效线时刻（ms epoch）。ISO 不可解析 ⇒ 0（一切任务都算之后 ⇒ fail-closed，宁可红不宁绿）。 */
export function activationLineMs(): number {
  const ms = Date.parse(ACTIVATION_LINE_ISO);
  return Number.isFinite(ms) ? ms : 0;
}

// ── 位置判定（纯函数，可被单测直接 import 不触发主流程） ──────────────────────────────────────────

export interface DeliveryCriticalTaskLike {
  id?: unknown;
  labels?: unknown;
  goal_ac?: unknown;
  /** first-add commit 时刻（ms epoch）；缺值/NaN = git 读不到 ⇒ 按新立案 fail-closed（缺值=未查≠旧）。 */
  filedAtMs?: unknown;
}

/** 带 delivery-critical 标签判定：读 labels 数组（frontmatter 位置），非手维护名单。 */
export function isDeliveryCritical(task: DeliveryCriticalTaskLike): boolean {
  return Array.isArray(task.labels) && task.labels.map(String).includes(DELIVERY_CRITICAL_LABEL);
}

/** goal_ac 非空判定：string 且 trim 后非空。缺值/空串/非 string ⇒ false（fail-closed）。 */
export function hasGoalAc(task: DeliveryCriticalTaskLike): boolean {
  const s = task?.goal_ac;
  return typeof s === "string" && s.trim() !== "";
}

/** 是否「生效线之后新立案」：filedAtMs ≥ cutoffMs。filedAtMs 缺值 ⇒ true（缺值=未查，fail-closed）。 */
export function filedAfterCutoff(task: DeliveryCriticalTaskLike, cutoffMs: number = activationLineMs()): boolean {
  const t = task?.filedAtMs;
  if (typeof t === "number" && Number.isFinite(t)) return t >= cutoffMs;
  return true;
}

/**
 * 枚举每条带 delivery-critical 标签的任务，判定其 goal_ac 是否非空。返回清单 + 总数（枚举，
 * 不布尔——硬规则③）：
 *   violating    — 生效线之后、带标签、goal_ac 空 ⇒ 报红
 *   compliant    — 生效线之后、带标签、goal_ac 非空
 *   grandfathered — 生效线之前、带标签（不分 goal_ac 有无，均不判红）
 *   grandfatheredNoGoalAc / grandfatheredWithGoalAc — 生效线之前的存量再按 goal_ac 有无拆开
 *     （DoD 要记的「存量条数 125/120」= 总数 / 无 goal_ac 那半边，单独排期）。
 */
export function evaluateDeliveryCritical(
  tasks: readonly DeliveryCriticalTaskLike[],
  cutoffMs: number = activationLineMs(),
): {
  violating: string[];
  compliant: string[];
  grandfathered: string[];
  grandfatheredNoGoalAc: string[];
  grandfatheredWithGoalAc: string[];
  total: number;
} {
  const violating: string[] = [];
  const compliant: string[] = [];
  const grandfathered: string[] = [];
  const grandfatheredNoGoalAc: string[] = [];
  const grandfatheredWithGoalAc: string[] = [];
  let total = 0;
  for (const t of tasks) {
    if (!isDeliveryCritical(t)) continue;
    total += 1;
    if (!filedAfterCutoff(t, cutoffMs)) {
      grandfathered.push(String(t.id));
      if (hasGoalAc(t)) grandfatheredWithGoalAc.push(String(t.id));
      else grandfatheredNoGoalAc.push(String(t.id));
    } else if (hasGoalAc(t)) {
      compliant.push(String(t.id));
    } else {
      violating.push(String(t.id));
    }
  }
  return { violating, compliant, grandfathered, grandfatheredNoGoalAc, grandfatheredWithGoalAc, total };
}

// ── 写入那一刻的判定（钩子与 store 的创建路径共用【这一个】） ──────────────────────────────────────

/** A task candidate AT the write face: the content that is (or is about to be) that path's bytes. */
export interface StagedTaskCandidate {
  /** repo-relative path (`tasks/<id>.md`) — printed on rejection as the remediation location. */
  rel: string;
  /** the content under judgment: the staged (index) blob for the hook, the just-serialized bytes for
   *  the store — either way, what the record WILL be, not a working-tree copy. */
  content: string;
  /** first-add ms epoch; null when the path has NO add commit (⇒ this write is filing it now). */
  filedAtMs: number | null;
}

/** The frontmatter block of a task file — ⛔ identical to the regex the callers already used, so the
 *  judgment reads the same bytes it always did. */
const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * The write-surface position judgment: return the offender descriptions (empty = allow). Pure — the
 * caller supplies the candidates, so every branch is directly testable and every input axis
 * (label / goal_ac / first-add time / non-task path) can be driven to BOTH values (硬规则 4).
 *
 * The judgment is the detector's own (`isDeliveryCritical` ∧ `filedAfterCutoff` ∧ ¬`hasGoalAc`), in
 * the detector's own order, with the detector's activation line — the write surface cannot drift
 * from the round-level report (硬规则 1: one judgment, two moments).
 */
export function judgeStagedDeliveryCritical(
  candidates: readonly StagedTaskCandidate[],
  cutoffMs: number = activationLineMs(),
): string[] {
  const offenders: string[] = [];
  for (const c of candidates) {
    const fmMatch = c.content.match(FRONTMATTER_BLOCK_RE);
    // No frontmatter ⇒ not a task file this judgment can speak about (a deleted staged path, or a
    // file whose shape is judged elsewhere: task-contract-check / the task-file-violation-ledger).
    // ⛔ Not reported as a violation: this detector's subject is `delivery-critical` WITHOUT
    // `goal_ac`, and an unreadable frontmatter cannot carry the label (硬规则 3b's mirror: it must
    // not be reported as PASS either — it is simply not in this judgment's population).
    if (!fmMatch) continue;
    const fm = parseFrontmatterCompletely(fmMatch[1]) as Record<string, unknown>;
    // ⛔ `path.basename(c.rel, ".md")` — the EXACT expression the hook used before the move, so the
    // offender string stays byte-identical (AC8's before/after reading).
    const id = path.basename(c.rel, ".md");
    const task = {
      id,
      // ⛔ RAW `fm.labels` / `fm.goal_ac`, not a pre-projected copy: `isDeliveryCritical` /
      // `hasGoalAc` ARE the projections (array-normalize / non-empty-string), so feeding them the raw
      // field is byte-for-byte the same verdict while keeping this module free of a second reader.
      labels: fm.labels,
      goal_ac: fm.goal_ac,
      // A path with no add commit IS being filed by the write under judgment ⇒ "filed now". The
      // floor is the activation line so a host clock BEHIND the cutoff cannot silently grandfather a
      // brand-new file (fail-closed — the direction the detector's own 缺值⇒true takes).
      filedAtMs: c.filedAtMs ?? Math.max(Date.now(), cutoffMs),
    };
    if (!isDeliveryCritical(task)) continue;
    if (!filedAfterCutoff(task, cutoffMs)) continue; // pre-cutoff stock: same judgment ⇒ grandfathered
    if (hasGoalAc(task)) continue;
    offenders.push(`${c.rel} (id=${id})`);
  }
  return offenders;
}

// ── 启用条件：没有 goal 层的工作区不得被挡（硬规则 12 的镜像——不设未测量的限制） ──────────────────
// `store.ts` 是 VENDORED 交付物：第三方工作区可以完全没有 goal 层，`goal_ac` 在那里无处可指
// ⇒ 规则的前提不成立，判定必须显式关掉。条件必须【可判定】且【对第三方为假】：
//   `goals/` 是 quay-init 无条件 mkdir 的空目录 ⇒ 「目录存在」不构成区分（恒真）。
//   「载体里有 ≥1 条 goal 层记录」才构成区分——空 goals/ 与无 goals/ 都判为「无 goal 层」。
// 记录的形态谓词（`GOAL-*` / `AC-*` + `.md`）逐字取自 goal-store 的 list() 枚举（那份枚举没有导出，
// 这里复核过一次；若它改形，本条要跟着改）。
export const GOAL_CARRIER_DIR_NAME = "goals";

/** True when `goalDir` holds at least one goal-layer record — the goal layer is actually in use.
 *  读不到 / 目录不存在 / 目录为空 ⇒ false（⇒ 判定关闭 ⇒ 放行，第三方不被挡）。 */
export function goalCarrierHasRecords(goalDir: string | null | undefined): boolean {
  if (!goalDir) return false;
  try {
    return fs
      .readdirSync(goalDir)
      .some((f) => f.endsWith(".md") && (f.startsWith("GOAL-") || f.startsWith("AC-")));
  } catch {
    return false;
  }
}

/**
 * The WRITER's entry point (`store.ts write()`, creation path only): combine the enable condition
 * with the ONE judgment above and produce an attributable refusal. `null` = allow.
 *
 * SCOPE = CREATION (`existingRaw === null`), and that IS the grandfather semantics at the write face:
 * flipping the status of an existing pre-cutoff delivery-critical task must never be blocked, so the
 * caller only asks this question when it is creating. The activation line itself therefore stays
 * inert here — a creation IS "filed now" by construction (the candidate passes `filedAtMs: null`,
 * and the composite floors it to `max(now, cutoff)`), which is also why no literal date needed to
 * travel into this function's contract.
 */
export function writeFaceRejectionOnCreate(args: {
  id: string;
  rel: string;
  content: string;
  /** the workspace's goal-layer carrier dir (a sibling of tasks/); null = not resolvable. */
  goalDir: string | null;
}): string | null {
  if (!goalCarrierHasRecords(args.goalDir)) return null;
  const offenders = judgeStagedDeliveryCritical([{ rel: args.rel, content: args.content, filedAtMs: null }]);
  if (offenders.length === 0) return null;
  return (
    `refusing to create task "${args.id}": it carries the \`${DELIVERY_CRITICAL_LABEL}\` label ` +
    `but declares no top-level \`goal_ac\` (${offenders[0]}). A delivery-critical task asserts a ` +
    `LONG-TERM guarantee that must be backed by a goal-layer AC (AC-190), so it cannot be filed ` +
    `without one. Fix: add a top-level \`goal_ac: AC-<n>\` pointing at the owning AC (via ` +
    `\`task_write\`'s goal_ac field or \`task edit --goal-ac\`), then file again — or drop the ` +
    `\`${DELIVERY_CRITICAL_LABEL}\` label if this task carries no long-term guarantee.`
  );
}
