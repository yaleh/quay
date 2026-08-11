#!/usr/bin/env node
// suite-execution-form-counter.ts — 套件执行形态的机械计数器
// (tasks/gap-suite-execution-rollback-to-main-session-not-restored-after-crash)。
//
// Defect family (C17: rules need PRODUCTS, not visibility): 人 2026-08-10 裁定「.halt 期间由主会话跑；
// workflow 等 .halt 解除才用」——.halt 解除后本由 execute-suite-fix workflow 治理套件（17:52/20:11/21:01/
// 22:45/00:57 五次调用）。01:07 整机 OOM（manager 会话也被杀重启）后 r265/266/268/269/270 五轮全部
// runner=outer 主会话直跑（2h50m 零 Workflow），meta-cc 查 00:57:41 之后零次 Workflow 调用。崩溃后没有
// 任何机件把执行形态切回 workflow：静默回落与有意改用主会话在记录上不可区分。
//
// Fix: 一个机械计数器。每 tick 外层跑本脚本；它读 `<root>/.quay/verification-round.jsonl`（每轮一行，
// `runner` 字段记录执行形态），数「.halt 解除后连续 K 轮 runner=outer」。`.halt` 存在 ⇒ 接管期豁免（不计）。
//
//   measure   execution_form_counter = 本脚本 --json 输出的 consecutive_outer_rounds 数字
//   band      consecutive_outer_rounds < K（默认 3）健康；>= K ⇒ 报「回落」信号（驱动切回 workflow）
//   invariant runner_field_tracked = 1（verification-round.jsonl 已记 runner 字段）
//   invariant halt_taken_into_account = 1（.halt 接管期不计数）
//   control   回落报信号；.halt 期豁免；主会话越界检测
//
// ⚠️ 已知局限（manager 04:0x 立案时 `runner` 字段的实测分布；实现时核实并写进本注释——诚实标注）:
//   verification-round.jsonl 的 `runner` 字段由 full-suite-runner.ts **硬编码为 "outer"**（`runner: "outer"
//   as const`，无 --runner 旗标），workflow 治理的轮次也记录 runner=outer。因此本计数器当前把**所有**轮次
//   都视为 runner=outer——它如实报出「自最近一次 workflow 治理轮以来连续 outer 轮数」，而这个数目前=全部历史。
//   这不影响它抓「OOM 后静默回落」（当前状态 r270 必报回落信号），但意味着 field 本身需要 workflow-aware
//   （full-suite-runner 支持 --runner workflow、execute-suite-fix 传入）才能让计数器在健康 workflow 治理期
//   不误报。判定归 outer：信号触发后应先用 meta-cc 核实「最近是否真有 workflow 治理」，再决定是否驱动切回。
//
// 轮次定义（实现时写死进注释，避免数法漂移）：一行 = verification-round.jsonl 一条 JSON 记录。**套件轮次**
// 才有 `runner`（或 `startedAt`）；closure-pass 记录（形如 `{round, at, suiteGreen, closed}`，无 runner 无
// startedAt）不是套件轮次，跳过。连续计数从**最新**记录向**旧**读：套件轮 `runner==="outer"` 计入，
// 出现非 outer 的套件轮（workflow/inner）即断（前一轮次之后的 outer 不算连续）；runner 缺失的套件轮
// （缺值=未查，不是为假）也断——不能把「未分类」算成 outer。
//
// Usage:
//   node --no-warnings --experimental-strip-types plugin/scripts/suite-execution-form-counter.ts \
//        [--root <dir>] [--k <n>] [--verification-round <path>] [--halt <path>] [--json] [--help]
//
// Exit: 0 = 健康 / .halt 接管期豁免（consecutive < K）· 1 = 回落信号（>= K）· 2 = 用法/环境错误。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

/** 默认 verification-round 相对路径（<root>/.quay/verification-round.jsonl）——外层每轮一行套件记录。 */
export const DEFAULT_VERIFICATION_ROUND_REL = path.join(".quay", "verification-round.jsonl");

/** 默认 .halt 相对路径（<root>/.halt）——人裁定「.halt 期间由主会话跑」的接管期豁免。 */
export const DEFAULT_HALT_REL = ".halt";

/** 默认 K 值（Contract band: `.halt 解除后连续 K 轮 runner=outer 即越界；建议 3`）。 */
export const DEFAULT_K = 3;

/** 一条套件轮次记录：有 `runner`（字符串）或 `startedAt`（时间戳）的 verification-round 行。 */
export function isSuiteRound(rec) {
  return (
    rec !== null &&
    typeof rec === "object" &&
    (typeof rec.runner === "string" || typeof rec.startedAt === "string")
  );
}

/**
 * 数自最近一条非-outer 套件轮（或文件开头）以来连续 `runner==="outer"` 的套件轮数。PURE。
 * 从最新向旧读；非套件轮（closure-pass 形状）跳过；套件轮 runner==="outer" 计入；
 * 套件轮 runner 为其它值（workflow/inner）⇒ 断；套件轮 runner 缺失 ⇒ 断（缺值=未查，不能算 outer）。
 * @param {Array<Record<string, any>>} records verification-round.jsonl 的已解析记录（保序，旧→新）
 * @returns {{ consecutive: number, runnerCounts: Record<string, number> }}
 */
export function countConsecutiveOuterRounds(records) {
  let consecutive = 0;
  const runnerCounts = {}; // 枚举式：各 runner 值出现次数（含 missing）
  for (const rec of records) {
    if (!isSuiteRound(rec)) continue;
    const r = typeof rec.runner === "string" ? rec.runner : "missing";
    runnerCounts[r] = (runnerCounts[r] ?? 0) + 1;
  }
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i];
    if (!isSuiteRound(rec)) continue; // 非套件轮（closure-pass）——跳过，不打断也不计入
    const r = typeof rec.runner === "string" ? rec.runner : null;
    if (r === "outer") {
      consecutive++;
    } else {
      break; // 非 outer 或 runner 缺失——连续 outer 段到此为止
    }
  }
  return { consecutive, runnerCounts };
}

/**
 * 分档判定。PURE。Contract band:
 *   consecutive >= k ⇒ 报「回落」信号（执行形态静默回落，驱动切回 workflow）
 *   consecutive < k  ⇒ 健康（静默）
 * @param {number} consecutive 连续 outer 轮数
 * @param {number} k 阈值（默认 3）
 */
export function judgeConsecutiveOuter(consecutive, k) {
  if (consecutive >= k) {
    return {
      band: "rollback",
      signal: true,
      action: "驱动切回 workflow",
      message: `执行形态回落: 连续 ${consecutive} 轮 runner=outer (>=K=${k}) ⇒ 主会话直跑越界，驱动切回 workflow`,
    };
  }
  return {
    band: "healthy",
    signal: false,
    action: null,
    message: `执行形态 ${consecutive} 轮 runner=outer (<K=${k}) 健康`,
  };
}

function usage() {
  console.error(`suite-execution-form-counter.ts — 套件执行形态的机械计数器（外层每 tick 跑）

Reads <root>/.quay/verification-round.jsonl's \`runner\` field, reports consecutive_outer_rounds
(the trailing run of suite rounds with runner=outer). .halt present ⇒ takeover-period exemption (0).
Band: consecutive >= K (default 3) ⇒ 「回落」signal (exit 1); < K ⇒ healthy (exit 0).

Usage:
  --root <dir>               workspace root (default: auto-derived from this script's location)
  --k <n>                    consecutive-outer threshold (default 3)
  --verification-round <path>  override the verification-round.jsonl path (test seam)
  --halt <path>              override the .halt path (test seam)
  --json                     JSON output (machine-readable; measure-only, never mutates)
  --help|-h                  this usage (exit 0)

Exit: 0 healthy / .halt takeover-exempt · 1 rollback signal (>= K) · 2 usage/environment error`);
}

export function main(argv) {
  const args = argv.slice(2);
  const flagVal = (name, def) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : def;
  };
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 0;
  }
  const jsonOut = args.includes("--json");
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const autoRoot = path.resolve(scriptDir, "..", "..");
  const root = flagVal("--root", autoRoot);
  const kArg = flagVal("--k", String(DEFAULT_K));
  const k = Number(kArg);
  if (!Number.isInteger(k) || k <= 0) {
    console.error(`suite-execution-form-counter: 无效 --k '${kArg}'（必须为正整数，建议 3）`);
    return 2;
  }

  const verificationRound =
    flagVal("--verification-round", "") || path.join(root, DEFAULT_VERIFICATION_ROUND_REL);
  const haltPath = flagVal("--halt", "") || path.join(root, DEFAULT_HALT_REL);

  // ── .halt 接管期豁免：存在即不计数（人裁定「.halt 期间由主会话跑」是合法形态）──────────────
  const haltPresent = fs.existsSync(haltPath);

  // ── verification-round 解析 ─────────────────────────────────────────────────────────────────────
  let records = [];
  if (fs.existsSync(verificationRound)) {
    const text = fs.readFileSync(verificationRound, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      try {
        records.push(JSON.parse(l));
      } catch {
        continue; // 非 JSON / 半写行——跳过，不因单行坏档炸整个计数
      }
    }
  }

  const { consecutive, runnerCounts } = countConsecutiveOuterRounds(records);
  const effective = haltPresent ? 0 : consecutive;
  const verdict = judgeConsecutiveOuter(effective, k);
  const suiteRounds = Object.values(runnerCounts).reduce((a, b) => a + b, 0);

  const out = {
    consecutive_outer_rounds: effective,
    k,
    signal: verdict.signal,
    band: haltPresent ? "halt-takeover" : verdict.band,
    action: verdict.action,
    message: haltPresent
      ? `.halt 接管期豁免（${path.basename(haltPath)} 存在）——主会话直跑是合法形态，不计数`
      : verdict.message,
    halt_present: haltPresent,
    halt_path: haltPath,
    verification_round: verificationRound,
    total_records: records.length,
    suite_rounds: suiteRounds,
    runner_counts: runnerCounts, // 枚举式：outer/workflow/inner/missing 各多少（揭示 field 是否 workflow-aware）
  };
  if (jsonOut) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(
      `suite-execution-form-counter: ${out.message} [runner_counts=${JSON.stringify(runnerCounts)}]`,
    );
  }
  return out.signal ? 1 : 0;
}

if (isDirectEntry(import.meta)) {
  const code = main(process.argv);
  process.exit(code);
}
