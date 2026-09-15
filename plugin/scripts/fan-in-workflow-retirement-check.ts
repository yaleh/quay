// fan-in-workflow-retirement-check.ts — fan-in workflow 退役防回归 (gap-fan-in-workflow-retirement-guard,
// 人裁定迁移序 L3)。
//
// 回答的问题（@instrument）：「fan-in-execute.js workflow（双副本）退役后，是否彻底——双副本路径已删
//   净、引用面归零（归档白名单除外），且生产 fan-in 锁事件（.quay/fan-in-lock-events.jsonl）里没有
//   非 wk-prod- 前缀的 acquire（旧路径 / 非机械路径复活）？」
//
// 判定（能取假，硬规则 3/4）：
//   AC2（退役彻底）——两路径 `.claude/workflows/fan-in-execute.js` + `plugin/workflows/fan-in-execute.js`
//     双副本须【都不存在】。任一仍存在 ⇒ NOT-EVALUATED（SPEC P3 尚未删除双副本，退役彻底性「才可判」——
//     前置未发生，不是合格、也不是证伪，硬规则 3b）。双副本删除后，扫引用面：任何【可执行载体】在
//     【代码位置】（只屏蔽注释，不屏蔽字符串——import 说明符 / scriptPath 里的文件名是真实调用面）
//     引用 `fan-in-execute`（`(?![\w-])` 负前瞻排除 `fan-in-executor` / `fan-in-execute-paths` 等同名异义）
//     ⇒ RED（引用未清零 = 旧 workflow 复活路径仍在）。归档白名单除外（测试文件 / 本 checker 自身 /
//     capability-catalog.sh 元数据 / checker-mutation-cases 负控 / orchestration/archive / 旧 worktree）。
//   AC1 + AC3（防复活）——读 `.quay/fan-in-lock-events.jsonl`，`event=acquire` 且 runId 非【机械前缀】
//     （机械前缀 = `wk-prod-`（driver 轮次，锁 acquire 用）+ `mfi-`（per-suite 机械身份，newMechanicalSuiteRunId
//     worker-driver.ts:2162 生成）——两者同属机械 fan-in 一族，⛔ 不把 `mfi-` 误判为旧路径复活）
//     且 `epoch >= --since-epoch`（窗口「从 L1 落地起」，缺省由 git 现算 L1 token 闸落地 commit = 首次
//     ADD `packages/quay/src/fan-in/ff-merge.ts` 的 epoch——⛔ 不硬编码依赖宿主/时间的字面量，硬规则 4 推论二）
//     ⇒ 计数必须为 0；非 0 ⇒ RED（出现即假）。文件缺失 ⇒ NOT-EVALUATED（读不到输入 ≠ 无违规，硬规则 3b）。
//
// 退出码（checker-mechanical-spine-check.ts 词表 {0,1,2,3}）：
//   0 = PASS（两判据都 verified：双副本删除 + 引用归零，且 lock-events 无非 wk-prod- acquire）
//   1 = RED（任一判据证伪：引用未清零，或窗口内出现非 wk-prod- 前缀 acquire）
//   2 = usage/env error（缺 --root 外的非法参数）
//   3 = NOT-EVALUATED（无 RED 但至少一判据读不到输入：双副本仍在 / lock-events 缺失）
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/fan-in-workflow-retirement-check.ts \
//       [--root <dir>] [--lock-events <file>] [--since-epoch <epoch>] [--json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { listExecutableFiles } from "./fs-walk.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 默认受检面 = quay 仓库根（本脚本位于 <repo>/plugin/scripts/）。 */
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

/** 被退役的 fan-in-execute.js 双副本路径（repo-root-relative）。 */
export const WORKFLOW_PATHS = [
  ".claude/workflows/fan-in-execute.js",
  "plugin/workflows/fan-in-execute.js",
];

/** 生产 fan-in 锁事件载体（机械 fan-in `wk-prod-*` 与旧 workflow 混写的同一文件）。 */
export const LOCK_EVENTS_REL = ".quay/fan-in-lock-events.jsonl";

/** 机械 worker-driver 的轮次 runId 前缀（driver-runtime.ts:157 runPrefix "wk-prod"）。 */
export const WK_PROD_PREFIX = "wk-prod-";

/** 机械 per-suite runId 前缀（worker-driver.ts:2162 newMechanicalSuiteRunId ⇒ `mfi-<task>-…`）。
 *  与 `wk-prod-` 同属机械 fan-in 一族（driver 轮次 vs per-suite 身份），⛔ 不把 `mfi-` 当旧路径复活。 */
export const MECHANICAL_SUITE_PREFIX = "mfi-";

/** L1 token 闸落地载体：ff-merge.ts（token 闸在其内实现）——首次 ADD 该文件的 commit 即 L1 落地。 */
export const L1_TOKEN_GATE_CARRIER_REL = "packages/quay/src/fan-in/ff-merge.ts";

/** runId 是否机械前缀（`wk-prod-` driver 轮次 ∨ `mfi-` per-suite 机械身份）。 */
export function isMechanicalPrefix(runId: string): boolean {
  return runId.startsWith(WK_PROD_PREFIX) || runId.startsWith(MECHANICAL_SUITE_PREFIX);
}

/** 现算 L1 落地 epoch（秒）：首次 ADD ff-merge.ts（token 闸载体）的 commit 时间。⛔ 不硬编码——
 *  git 可读则返回该 commit 的 %ct；读不到（非 git 检出 / 无该路径）⇒ 0（全文件，最严）。 */
export function deriveL1Epoch(root: string): number {
  try {
    const r = spawnSync(
      "git",
      ["-C", root, "log", "--diff-filter=A", "--format=%ct", "-1", "develop", "--", L1_TOKEN_GATE_CARRIER_REL],
      { encoding: "utf8" },
    );
    if (!r.error && r.status === 0) {
      const v = parseInt((r.stdout ?? "").trim(), 10);
      if (Number.isFinite(v)) return v;
    }
  } catch {
    // 读不到 ⇒ 0（全文件，最严，硬规则 3b：读不懂 ≠ 合格）。
  }
  return 0;
}

/** 引用扫描的可执行扩展名（.md 一律排除——文档提及不算调用面，硬规则 2）。
 *  值随 listExecutableFiles 一起移入 fs-walk.ts#EXEC_EXTENSIONS（.quay/routine-findings.jsonl
 *  finding `shell-scan-surface-family`：与 outer-retirement-precondition-check.ts 的副本逐字相同）。 */

/** 测试文件不算调用面（测试随 checker 退役，且负控 fixture 必然引用 `fan-in-execute`）。 */
const TEST_FILE_RE = /\.test\.(mjs|ts|cjs|js)$/;

/** 元数据 / 自身不算调用面：catalog 是声明表；本 checker 自身的 WORKFLOW_PATHS 字符串是判定对象而非
 *  复活路径（若把自身算调用面，则「双副本删除后」本 checker 永远 RED——结构上不可能取真，硬规则 4）。 */
const NON_CALLER_BASENAMES = new Set([
  "capability-catalog.sh",
  "fan-in-workflow-retirement-check.ts",
]);

/** 归档白名单（repo-root-relative 目录前缀，命中即豁免引用扫描）——历史负控 / 归档文档 / 旧 worktree
 *  快照不算「存活引用面」。 */
const ARCHIVE_PREFIXES = [
  "orchestration/archive/",
  "plugin/scripts/checker-mutation-cases/",
  ".claude/worktrees/",
  ".workflow-events/",
];

/** 被退役 workflow 名的位置判定：`fan-in-execute` 后不跟 [\w-]（排除 `fan-in-executor` 同类异义）。 */
export const FAN_IN_EXECUTE_RE = /fan-in-execute(?![\w-])/;

export interface DualCopyResult {
  /** false = 双副本仍存在（P3 未删除）⇒ AC2 不可判（NOT-EVALUATED）。 */
  evaluated: boolean;
  /** 仍存在的双副本路径（evaluated=false 时非空）。 */
  existingPaths: string[];
  /** 存活引用（evaluated=true 时，引用面非零 ⇒ RED）。 */
  references: string[];
}

export interface LockEvent {
  runId: string;
  taskId: string | null;
  epoch: number;
  ts: string | null;
}

export interface LockEventsResult {
  /** false = 事件文件缺失 / 不可读 ⇒ AC1 不可判（NOT-EVALUATED）。 */
  evaluated: boolean;
  /** 窗口内非 wk-prod- 前缀的 acquire（非空 ⇒ RED）。 */
  nonWkProdAcquires: LockEvent[];
  /** 全部 acquire 数（含 wk-prod，供人类判「是空文件还是全机械」）。 */
  totalAcquires: number;
}

export interface RetirementCheckResult {
  ok: boolean;
  notEvaluated: boolean;
  dualCopies: DualCopyResult;
  lockEvents: LockEventsResult;
  issues: string[];
}

// ── 位置判定：屏蔽注释（//、/* */、bash #），但【不】屏蔽字符串/模板/正则字面量 ──
// import 说明符 `from "./x.ts"`、scriptPath 字符串 `"/path/fan-in-execute.js"` 里的文件名是真实调用面，
// 必须落在未屏蔽位置；注释里提到 `fan-in-execute`（说明文档 / 退役标注）不算复活路径。
export function maskComments(src: string): Uint8Array {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 2;
      while (i < n && src[i] !== "\n") {
        mask[i] = 1;
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        mask[i] = 1;
        i++;
      }
      if (i < n) {
        mask[i] = 1;
        mask[i + 1] = 1;
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "#") {
      mask[i] = 1;
      i++;
      while (i < n && src[i] !== "\n") {
        mask[i] = 1;
        i++;
      }
      continue;
    }
    i++;
  }
  return mask;
}

/** 把被屏蔽（注释）的字符替换成空格（保留长度），得到「仅代码」文本供 includes/regex 搜索。 */
export function codeOnlyText(src: string): string {
  const mask = maskComments(src);
  const chars: string[] = [];
  for (let i = 0; i < src.length; i++) {
    chars.push(mask[i] === 1 ? " " : src[i]);
  }
  return chars.join("");
}

/** 递归列出 `dir` 下的普通可执行文件（绝对路径，排序），跳过 node_modules/.git/.quay 与符号链接。
 *  实现移入 fs-walk.ts#listExecutableFiles（finding `shell-scan-surface-family`：与
 *  outer-retirement-precondition-check.ts 的副本逐字相同，⛔ 不是本 checker 的私有策略）；
 *  此处保留本名再导出，本 checker 的公开面不变。 */
export { listExecutableFiles };

/** 路径（已归一化为 / 分隔）是否落在归档白名单目录前缀下。 */
function isArchived(rel: string): boolean {
  const r = rel.replace(/\\/g, "/");
  return ARCHIVE_PREFIXES.some((p) => r.startsWith(p));
}

/** AC2：双副本是否删净 + 引用面是否归零。纯文件系统读，无写。 */
export function checkDualCopies(root: string): DualCopyResult {
  const existingPaths = WORKFLOW_PATHS.filter((p) => fs.existsSync(path.join(root, p)));
  if (existingPaths.length > 0) {
    return { evaluated: false, existingPaths, references: [] };
  }

  const references: string[] = [];
  for (const file of listExecutableFiles(root)) {
    const base = path.basename(file);
    if (TEST_FILE_RE.test(base)) continue;
    if (NON_CALLER_BASENAMES.has(base)) continue;
    const rel = path.relative(root, file);
    if (isArchived(rel)) continue;
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (FAN_IN_EXECUTE_RE.test(codeOnlyText(text))) {
      references.push(rel);
    }
  }
  return { evaluated: true, existingPaths: [], references };
}

/** AC1/AC3：生产 fan-in 锁事件里窗口内非机械前缀 acquire。纯文件系统读，无写。
 *  `sinceEpoch` 缺省时现算 L1 落地 epoch（deriveL1Epoch）——窗口「从 L1 落地起」。 */
export function checkLockEvents(
  root: string,
  sinceEpoch: number | null = null,
  lockEventsRel = LOCK_EVENTS_REL,
): LockEventsResult {
  const windowSince = sinceEpoch ?? deriveL1Epoch(root);
  const file = path.join(root, lockEventsRel);
  if (!fs.existsSync(file)) {
    return { evaluated: false, nonWkProdAcquires: [], totalAcquires: 0 };
  }
  const nonWkProdAcquires: LockEvent[] = [];
  let totalAcquires = 0;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { evaluated: false, nonWkProdAcquires: [], totalAcquires: 0 };
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let rec: { event?: unknown; runId?: unknown; taskId?: unknown; epoch?: unknown; ts?: unknown };
    try {
      rec = JSON.parse(t);
    } catch {
      continue;
    }
    if (rec.event !== "acquire") continue;
    if (typeof rec.epoch !== "number") continue;
    totalAcquires++;
    const runId = typeof rec.runId === "string" ? rec.runId : "";
    if (isMechanicalPrefix(runId)) continue;
    if (rec.epoch < windowSince) continue;
    nonWkProdAcquires.push({
      runId,
      taskId: typeof rec.taskId === "string" ? rec.taskId : null,
      epoch: rec.epoch,
      ts: typeof rec.ts === "string" ? rec.ts : null,
    });
  }
  return { evaluated: true, nonWkProdAcquires, totalAcquires };
}

/** 组合两判据。RED（1）> NOT-EVALUATED（3）> PASS（0）。 */
export function runCheck(root: string, opts: { sinceEpoch?: number | null; lockEventsRel?: string } = {}): RetirementCheckResult {
  const dual = checkDualCopies(root);
  const lock = checkLockEvents(root, opts.sinceEpoch ?? null, opts.lockEventsRel ?? LOCK_EVENTS_REL);

  const issues: string[] = [];
  if (dual.evaluated && dual.references.length > 0) {
    issues.push(
      `[AC2] fan-in-execute 引用未清零 (${dual.references.length}): ${dual.references.join(", ")}`,
    );
  } else if (!dual.evaluated) {
    issues.push(
      `[AC2] 双副本仍存在 (P3 未删除): ${dual.existingPaths.join(", ")} — 退役彻底性不可判`,
    );
  }
  if (lock.evaluated && lock.nonWkProdAcquires.length > 0) {
    issues.push(
      `[AC1] 非机械前缀 acquire ${lock.nonWkProdAcquires.length} 条: ` +
        lock.nonWkProdAcquires
          .slice(0, 5)
          .map((a) => `${a.runId}@${a.epoch}`)
          .join(", ") +
        (lock.nonWkProdAcquires.length > 5 ? ` …(+${lock.nonWkProdAcquires.length - 5})` : ""),
    );
  } else if (!lock.evaluated) {
    issues.push(`[AC1] lock-events 缺失 (${opts.lockEventsRel ?? LOCK_EVENTS_REL}) — 不可判`);
  }

  const red =
    (dual.evaluated && dual.references.length > 0) ||
    (lock.evaluated && lock.nonWkProdAcquires.length > 0);
  const notEvaluated = !red && (!dual.evaluated || !lock.evaluated);

  return { ok: !red, notEvaluated, dualCopies: dual, lockEvents: lock, issues };
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      `fan-in-workflow-retirement-check.ts — fan-in workflow 退役防回归（双副本删净 + 引用归零 + lock-events 非 wk-prod- 前缀红灯）。
usage: node --no-warnings --experimental-strip-types plugin/scripts/fan-in-workflow-retirement-check.ts [--root <dir>] [--lock-events <file>] [--since-epoch <epoch>] [--json]\n`,
    );
    return 0;
  }
  const root = path.resolve(parseArg(argv, "--root") ?? DEFAULT_ROOT);
  const sinceEpochRaw = parseArg(argv, "--since-epoch");
  const sinceEpoch = sinceEpochRaw === undefined ? null : Number(sinceEpochRaw);
  if (sinceEpoch !== null && !Number.isFinite(sinceEpoch)) {
    process.stderr.write("fan-in-workflow-retirement-check: --since-epoch must be a number\n");
    return 2;
  }
  const lockEventsRel = parseArg(argv, "--lock-events");
  const json = argv.includes("--json");

  const res = runCheck(root, { sinceEpoch, lockEventsRel });

  if (json) {
    process.stdout.write(`${JSON.stringify(res)}\n`);
  } else if (res.ok && !res.notEvaluated) {
    process.stdout.write(
      "fan-in-workflow-retirement-check: PASS — 双副本删净 + 引用归零，且 lock-events 无非机械前缀 acquire\n",
    );
  } else if (res.notEvaluated) {
    process.stderr.write(`fan-in-workflow-retirement-check: NOT-EVALUATED\n`);
    for (const i of res.issues) process.stderr.write(`  - ${i}\n`);
  } else {
    process.stderr.write(`fan-in-workflow-retirement-check: RED (${res.issues.length} issue(s))\n`);
    for (const i of res.issues) process.stderr.write(`  - ${i}\n`);
  }

  if (res.ok && res.notEvaluated) return 3;
  return res.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
