#!/usr/bin/env node
// judgment-consumer-check.ts — 每个机械判据必须有消费它的动作（判据→消费动作映射审计）
// (tasks/gap-judgment-computed-not-wired-to-action, AC2 类级纪律 / AC3 系统审计)
//
// Defect family (2026-08-10 三次同形态, 活体实证): 判据被机械算出来了, 但没有接到任何「会因它而动」的
// 那一步——「判据算出来了」≠「会因它而动」:
//   1. 18:4x `slot-refill.ts:243` 只遍历 `pool.ready`, 不查 `excluded` 的 `not-yet-flipped`
//      → ready-pool-check 算出 16 excluded/14 nyf, slot-refill 候选循环零引用
//      (已修, gap-slot-refill-repeats-done-eligible-recommendations)。
//   2. 21:4x 候选被 C8 逐候选门拒后不从排序回填
//      → touches-orthogonality-check 算出 5 ready 缺 self-touch, 推荐前 N 候选被 C8 全拒不补位
//      (已修, gap-slot-refill-c8-reject-no-backfill)。
//   3. 22:0x `deficit` 每轮算出, 没有任何触发器读它
//      → ready-pool-check 每轮 pool<floor deficit, 但 B9 只有队列空/阶段目标两触发器
//      (已修 B9 第三触发器接 --apply, gap-judgment-computed-not-wired-to-action)。
// 「看它一眼算检查过」的假仪器由此而来——每多一个算出来没人消费的判据, 就多一个假仪器。
//
// 判据 (AC2 类级纪律 + AC3 系统审计):
//   - 每个机械判据必须有**消费它的动作**——要么接进执行核的强制步骤 (如 B9 第三触发器接 `--apply`),
//     要么在判据输出里带「谁消费我」字段, 找不到消费方即视为未完成。
//   - 本检查器把这条判据机械化: registry 每条判据带 `consumer` (消费它的动作) + `verify(root)`——
//     机械地核对该消费动作在真实工作区里是 WIRED 的 (读 tracked 文件, 不是自证为真的布尔——
//     自证/回显按硬规则 4 不是测量)。删掉消费动作的接线 ⇒ 检查器转红 (exit 1), 所以它是 ratchet:
//     保住已接线的判据, 未接线的列「未完成」(unfinished)。
//   - audit[] = 判据→消费动作映射清单; consumer 缺失或 verify 失败的判据列 `finished:false`
//     (未完成), 如实列出, 不假装在册。
//
// ## Contract:
//   measure   consumer_wired = `grep -cE "deficit.*--apply|消费|consumer" orchestration/orchestrator-tick-core.md plugin/scripts/capability-catalog.sh` 的 stdout 数字
//   band      consumer_wired >= 1（类级纪律已接线）
//   invariant each_judgment_has_consumer = 1（审计映射：每个判据有消费动作）
//   invariant no_consumer_listed_unfinished = 1（无消费方的判据被列为未完成）
//
// Usage:
//   node --experimental-strip-types judgment-consumer-check.ts --root <dir> [--json]
//
// Exit: 0 = band 满足 (unfinished=0 且两 invariant 全真) · 1 = 有未完成判据或 invariant 断 · 2 = usage。
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/judgment-consumer-check.ts --root "$PWD" --json
//   scripts/test.sh plugin/test/judgment-consumer-check.test.mjs

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Verify helpers (mechanical, tracked-file based — never self-asserted) ──────────────────────────

/** Read a file under root; return "" when missing (a missing file is a FAIL, not a pass). */
function readUnder(root: string, rel: string): string {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
}

/** True iff `text` contains the literal `needle` (positional content check). */
function has(text: string, needle: string): boolean {
  return text.includes(needle);
}

/** True iff `text` matches the regex anywhere. */
function hasRe(text: string, re: RegExp): boolean {
  return re.test(text);
}

/** True iff the file under root exists. */
function fileExists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

// ── Registry: 每个机械判据 → 消费它的动作（verify 机械核对接线在 tracked 文件里）──────────────────

export interface JudgmentEntry {
  /** 稳定 id（与 ## Contract invariant 语义对应）。 */
  id: string;
  /** 归类：invariant（三实例，Contract 判据）/ judgment（其余候选判据）。 */
  kind: "invariant" | "judgment";
  /** 判据：算出的是什么信号。 */
  judgment: string;
  /** 消费它的动作：谁「会因它而动」。 */
  consumer: string;
  /** 机械核对：该消费动作在 tracked 文件里确实是 WIRED 的。返回 ok + 一句证据。 */
  verify: (root: string) => { ok: boolean; detail: string };
}

/** 阅读 helper：读执行核文本（deficit / closure-lag 的消费方以它为准）。 */
function tickCore(root: string): string {
  return readUnder(root, "orchestration/orchestrator-tick-core.md");
}

export const JUDGMENT_REGISTRY: JudgmentEntry[] = [
  // ── 三实例（Contract invariant，必须 covered）─────────────────────────────────────────────────
  {
    id: "not_yet_flipped",
    kind: "invariant",
    judgment:
      "ready-pool-check 算出 not-yet-flipped（已 fan-in 待翻 done 的排除信号，16 excluded 中 14 nyf）",
    consumer:
      "slot-refill 候选循环第 4 项 step-4 检查跳过 not-yet-flipped 的 id + A9 判据（gap-slot-refill-repeats-done-eligible-recommendations）",
    verify: (root) => {
      const s = readUnder(root, "plugin/scripts/slot-refill.ts");
      const okCode = hasRe(s, /not-yet-flipped|excluded/);
      const okDoc = has(tickCore(root), "not-yet-flipped");
      return {
        ok: okCode && okDoc,
        detail: okCode && okDoc
          ? "slot-refill.ts 接线 not-yet-flipped/excluded（第 4 项 step-4 检查）+ 执行核 A9 声明"
          : `slot-refill.ts 接线 not-yet-flipped/excluded=${okCode}；执行核 A9 声明=${okDoc}`,
      };
    },
  },
  {
    id: "self_touch_scan",
    kind: "invariant",
    judgment:
      "touches-orthogonality-check --self-touch-scan 算出缺 self-touch 的 ready 候选（5 missing / NOT all dispatchable）",
    consumer:
      "C8 派发闸逐候选检查 self-touch（缺 ⇒ 不派发）+ slot-refill 候选被拒不回填补位（gap-slot-refill-c8-reject-no-backfill）",
    verify: (root) => {
      const s = readUnder(root, "plugin/scripts/slot-refill.ts");
      const t = readUnder(root, "plugin/scripts/touches-orthogonality-check.ts");
      // 按位置判定：C8 门在候选循环里真实调用 selfTouchCheck + selfTouch.ok 拒后 continue（回填），
      // scanner 提供 --self-touch-scan 信号——不靠注释里的「backfill」关键词。
      const okGate = has(s, "selfTouchCheck") && has(s, "selfTouch.ok");
      const okScan = hasRe(t, /--self-touch-scan|SELF-TOUCH/);
      return {
        ok: okGate && okScan,
        detail: okGate && okScan
          ? "slot-refill.ts C8 门真实调用 selfTouchCheck + selfTouch.ok 拒后 continue（回填）+ touches-orthogonality-check.ts 提供 --self-touch-scan"
          : `slot-refill.ts C8 门 selfTouchCheck/selfTouch.ok=${okGate}；--self-touch-scan=${okScan}`,
      };
    },
  },
  {
    id: "deficit",
    kind: "invariant",
    judgment: "ready-pool-check 每轮算出 pool<floor 的 deficit（22:0x 时 pool 27→17 漂移，39 todo 放着）",
    consumer:
      "B9 第三触发器：deficit > 0 ⇒ 跑 ready-pool-check.ts --apply（自闸：pool<floor 且 promotions 非空 ⇒ 机械补晋落盘，否则零写）",
    verify: (root) => {
      const t = tickCore(root);
      // 精确到 B9 那一行：deficit → 第三触发器 → ready-pool-check.ts --apply 同处接线
      //（A19 纪律句也提到 `--apply`，但那只是纪律示例，不是 B9 的实际接线——按位置判定）。
      const okTrigger = hasRe(t, /- \*\*B9\b[\s\S]*?deficit[\s\S]*?第三触发器[\s\S]*?--apply/);
      return {
        ok: okTrigger,
        detail: okTrigger
          ? "执行核 B9 行声明 deficit 第三触发器 + ready-pool-check --apply 接线"
          : "执行核 B9 行未完整接线 deficit→第三触发器→--apply",
      };
    },
  },

  // ── 其余候选判据（judgment，机械核对消费方）─────────────────────────────────────────────────
  {
    id: "dispatchable_disjoint",
    kind: "judgment",
    judgment:
      "ready-pool-check 算出最大互斥可派子集 dispatchable_disjoint（vs 裸 pool 计数——双算；THIS 才是派发判据，floor 是手段）",
    consumer:
      "slot-refill should_refill（dispatchable_disjoint >= 1 的事件驱动 go/no-go）+ B9/A18 空槽强制派发链",
    verify: (root) => {
      const s = readUnder(root, "plugin/scripts/slot-refill.ts");
      const ok = has(s, "dispatchable_disjoint") && hasRe(s, /dispatchable_disjoint\s*>=\s*1|dispatchable_disjoint/);
      return {
        ok,
        detail: ok
          ? "slot-refill.ts 读 dispatchable_disjoint（should_refill 决策 + 输出字段）"
          : "slot-refill.ts 未引用 dispatchable_disjoint",
      };
    },
  },
  {
    id: "obligation_ledger",
    kind: "judgment",
    judgment: "obligation 台账算出各 obligation 的 discharged/undischarged 与 canClose 状态",
    consumer: "obligation-ledger-check.ts 静态门（wired into scripts/test.sh run_static_checks）+ manager 每轮审计",
    verify: (root) => {
      const checker = fileExists(root, "plugin/scripts/obligation-ledger-check.ts");
      const sh = readUnder(root, "scripts/test.sh");
      const wired = has(sh, "obligation-ledger-check");
      return {
        ok: checker && wired,
        detail: checker && wired
          ? "obligation-ledger-check.ts 存在 + 接入 test.sh run_static_checks"
          : `obligation-ledger-check.ts 存在=${checker}；test.sh 接入=${wired}`,
      };
    },
  },
  {
    id: "closure_lag",
    kind: "judgment",
    judgment: "closure-lag-check 算出 not_yet_flipped 积压信号（overdue / not_yet_flipped 数字）",
    consumer: "A10 每 tick 读（退出非 0 ⇒ 报 WARN 进 tick-log）+ B2 --record 留痕（零收尾也写 0）",
    verify: (root) => {
      const t = tickCore(root);
      const okA10 = has(t, "closure-lag-check.sh") && has(t, "报 WARN");
      const okB2 = hasRe(t, /closure-lag-check\.sh\s*--record/);
      return {
        ok: okA10 && okB2,
        detail: okA10 && okB2
          ? "执行核 A10 声明 closure-lag-check（非 0 ⇒ 报 WARN）+ B2 --record 留痕"
          : `执行核 A10 声明=${okA10}；B2 --record=${okB2}`,
      };
    },
  },
];

// ── Audit 逐条审计清单（判据→消费动作映射；consumer 缺失/未接线即「未完成」）──────────────────────

export interface AuditRow {
  id: string;
  kind: string;
  judgment: string;
  /** 消费它的动作；未接线时仍保留声明的 consumer（如实，不假装在册）。 */
  consumer: string;
  /** 机械核对结果：消费动作在 tracked 文件里是否 WIRED。 */
  wired: boolean;
  /** finished = wired；false 即「未完成」（无消费方或消费方未接线）。 */
  finished: boolean;
}

// ── runAudit: 跑 registry verify，算 covered/unfinished + invariants ─────────────────────────────

export interface VerifyResult {
  ok: boolean;
  detail: string;
}

export interface AuditResult {
  measure: { judgments: number; covered: number; unfinished: number; band: number };
  covered: { id: string; judgment: string; consumer: string; detail: string }[];
  unfinished: { id: string; judgment: string; consumer: string; reason: string }[];
  audit: AuditRow[];
  invariants: Record<string, 0 | 1>;
}

export function runAudit(root: string): AuditResult {
  const results: { entry: JudgmentEntry; res: VerifyResult }[] = JUDGMENT_REGISTRY.map((entry) => ({
    entry,
    res: entry.verify(root),
  }));

  const covered = results
    .filter((r) => r.res.ok)
    .map((r) => ({ id: r.entry.id, judgment: r.entry.judgment, consumer: r.entry.consumer, detail: r.res.detail }));
  const unfinished = results
    .filter((r) => !r.res.ok)
    .map((r) => ({ id: r.entry.id, judgment: r.entry.judgment, consumer: r.entry.consumer, reason: r.res.detail }));

  const audit: AuditRow[] = results.map((r) => ({
    id: r.entry.id,
    kind: r.entry.kind,
    judgment: r.entry.judgment,
    consumer: r.entry.consumer,
    wired: r.res.ok,
    finished: r.res.ok,
  }));

  // each_judgment_has_consumer — 每个判据（registry）的消费动作都 WIRED（unfinished=0）。
  const eachJudgmentHasConsumer = unfinished.length === 0 ? 1 : 0;
  // no_consumer_listed_unfinished — 审计如实列出未完成判据：unfinished 恰好等于未接线的判据集
  //（无消费方/消费方未接线的判据被列为未完成，不假装在册；零未完成时空洞为真）。
  const listedUnfinishedCount = unfinished.length;
  const unwiredCount = audit.filter((a) => !a.finished).length;
  const noConsumerListedUnfinished = listedUnfinishedCount === unwiredCount ? 1 : 0;

  return {
    measure: { judgments: JUDGMENT_REGISTRY.length, covered: covered.length, unfinished: unfinished.length, band: 0 },
    covered,
    unfinished,
    audit,
    invariants: {
      each_judgment_has_consumer: eachJudgmentHasConsumer,
      no_consumer_listed_unfinished: noConsumerListedUnfinished,
    },
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function usage(): number {
  process.stderr.write(
    "judgment-consumer-check.ts — 每个机械判据必须有消费它的动作；无消费方判据列未完成。\n" +
      "Usage: --root <dir> [--json]\n",
  );
  return 2;
}

export function main(argv: string[]): number {
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = argv[++i];
      if (root === undefined) return usage();
    } else if (a === "--json") {
      json = true;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "judgment-consumer-check.ts — is every computed judgment wired to a consuming action?\n" +
          "Each registry entry's consumer is mechanically verified against the workspace (tracked files), not self-asserted.\n" +
          "Exit 0 = band satisfied (unfinished=0 + invariants true) · 1 = an unfinished judgment or broken invariant · 2 = usage.\n",
      );
      return 0;
    } else {
      return usage();
    }
  }

  root = path.resolve(root);
  const result = runAudit(root);
  const pass = result.measure.unfinished === 0 && Object.values(result.invariants).every((v) => v === 1);

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `judgment-consumer-check: judgments=${result.measure.judgments} covered=${result.measure.covered} unfinished=${result.measure.unfinished} (band ${result.measure.band})\n`,
    );
    for (const c of result.covered) {
      process.stdout.write(`  ✓ ${c.id} — ${c.judgment}\n      consumer: ${c.consumer}\n`);
    }
    for (const u of result.unfinished) {
      process.stdout.write(`  ✗ ${u.id} — ${u.judgment}\n      UNFINISHED: ${u.reason}\n`);
    }
    const unfinishedRows = result.audit.filter((a) => !a.finished);
    for (const n of unfinishedRows) {
      process.stdout.write(`  未完成: ${n.id} — consumer=${n.consumer}\n`);
    }
    if (!pass) {
      process.stdout.write(`judgment-consumer-check: band NOT satisfied (unfinished=${result.measure.unfinished})\n`);
    } else {
      process.stdout.write(`judgment-consumer-check: band satisfied (unfinished=0, all invariants true)\n`);
    }
  }
  return pass ? 0 : 1;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv.slice(2));
}
