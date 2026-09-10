#!/usr/bin/env node
// checker-driver-result-ratchet-check.ts — gap-b4-checker-reuse-driver-result (B4): the adoption
// ratchet for checker-side reuse of driver-result.ts's DriverResult<T>.
//
// WHY（SPEC-methodology-layer-architecture §5.1「棘轮（ratchet），不用形容词」+ §5.3 B4）：
//   「checker 采纳 driver-result 的 DriverResult<T> 词表」这条契约，采纳数必须【只增不减】——
//   0 → k 是示范，k 只许涨。用可数的量 + 只增不减的闸（同 test-framework-policy-check 对
//   34 个历史文件的 exemption list 手法）：REQUIRED_ADOPTERS 是已迁移 checkers 的钉住清单，
//   本检查器逐个验它们仍 position-import checker-io.ts / driver-result.ts，缺一个即 RED。
//   未来任务多迁移一个 checker ⇒ 把它加进 REQUIRED_ADOPTERS（清单只增），采纳数随之上涨。
//
// 判据（按位置不按关键词，复用 checker-lib.matchAtCommandPosition maskNonCode:true）：
//   一个 .ts 文件「采纳」= 源码里有一条【代码位置】的 `from "./checker-io.ts"` 或
//   `from "./driver-result.ts"`（注释/字符串/正则字面量里的提及不算）。
//   adoptedCheckers = 采纳者中 basename 以 `-check.ts` 结尾者（即 checker 采纳数）。
//
// 三态（DriverResult 词表，硬规则 3b）：
//   verified      = REQUIRED_ADOPTERS 全部采纳 ∧ adoptedCheckers ≥ MIN_ADOPTED_CHECKERS
//   failed        = 任一 REQUIRED_ADOPTERS 不再采纳（回退），或采纳数跌破地板
//   not-evaluated = plugin/scripts 不可读（读不到输入 ≠ 合格）
//
// Usage:
//   node --no-warnings --experimental-strip-types plugin/scripts/checker-driver-result-ratchet-check.ts \
//       [--root <dir>] [--json] [--selftest]
//
// Exit codes (经 checker-io.driverResultToExit): 0=verified · 1=failed · 2=not-evaluated。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { matchAtCommandPosition } from "./checker-lib.ts";
import { verified, failed, notEvaluated, driverResultToExit } from "./checker-io.ts";
import type { DriverResult } from "./checker-io.ts";

/** 已迁移到 DriverResult<T> 的 checker 钉住清单（棘轮，只增不减）。 */
export const REQUIRED_ADOPTERS: readonly string[] = [
  "outer-anchor-check.ts",
  "load-sensitive-release-check.ts",
  "dead-code-after-return-check.ts",
  "adr016-screen-use-check.ts",
];

/** 采纳地板 = 钉住清单长度（未来迁移更多 checker 时同步上调，只增不减）。 */
export const MIN_ADOPTED_CHECKERS = REQUIRED_ADOPTERS.length;

/** checker-io.ts（桥，re-export DriverResult）或 driver-result.ts（正本）的 import 签名。 */
const IMPORT_RE = /from\s+["']\.\/(?:checker-io|driver-result)\.ts["']/;

export interface RatchetReport {
  /** 全部采纳者（plugin/scripts/*.ts 中 position-import 上述两模块者，含 driver 与桥本身）。 */
  adopters: string[];
  /** 采纳者中的 checker（basename 以 -check.ts 结尾）——AC1 的「checker 采纳数」。 */
  adoptedCheckers: string[];
  /** 钉住清单（REQUIRED_ADOPTERS 的副本）。 */
  required: string[];
  /** 钉住清单中不再采纳者（应为空；非空 = 回退 = RED）。 */
  missing: string[];
  /** 采纳地板。 */
  minAdoptedCheckers: number;
}

/** 一条源码是否在【代码位置】import checker-io / driver-result（按位置不按关键词）。 */
export function importsDriverResult(source: string): boolean {
  return matchAtCommandPosition(source, IMPORT_RE, { maskNonCode: true }).length > 0;
}

/** 枚举 plugin/scripts/*.ts 中采纳 driver-result 词表者。plugin/scripts 不可读 ⇒ null（not-evaluated）。 */
export function enumerateAdopters(root: string): string[] | null {
  const dir = path.join(root, "plugin", "scripts");
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const adopters: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".ts")) continue;
    let source: string;
    try {
      source = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      continue; // 单文件不可读 ⇒ 跳过；若是钉住者会以「缺失」形态 RED。
    }
    if (importsDriverResult(source)) adopters.push(name);
  }
  return adopters.sort();
}

/** 采纳棘轮主判定。返回 DriverResult<RatchetReport>（词表单源到 driver-result.ts）。 */
export function checkRatchet(root: string): DriverResult<RatchetReport> {
  const adopters = enumerateAdopters(root);
  if (adopters === null) {
    return notEvaluated("plugin/scripts 不可读，无法枚举采纳面（读不到输入 ≠ 合格，硬规则 3b）");
  }
  const adoptedCheckers = adopters.filter((f) => f.endsWith("-check.ts"));
  const missing = REQUIRED_ADOPTERS.filter((f) => !adopters.includes(f));
  const report: RatchetReport = {
    adopters,
    adoptedCheckers,
    required: [...REQUIRED_ADOPTERS],
    missing,
    minAdoptedCheckers: MIN_ADOPTED_CHECKERS,
  };
  if (missing.length > 0) {
    return failed(`采纳回退：${missing.join(", ")} 不再 import checker-io/driver-result（棘轮只增不减）`);
  }
  if (adoptedCheckers.length < MIN_ADOPTED_CHECKERS) {
    return failed(`采纳 checker 数 ${adoptedCheckers.length} < 地板 ${MIN_ADOPTED_CHECKERS}（只增不减）`);
  }
  return verified(
    report,
    `REQUIRED_ADOPTERS 全部采纳 + adoptedCheckers=${adoptedCheckers.length} ≥ ${MIN_ADOPTED_CHECKERS}`,
  );
}

/** Pure RED/GREEN selftest（ADR-018 selfcheck-fixture pattern）。 */
export function selftest(): boolean {
  let pass = 0;
  let fail = 0;
  const check = (name: string, cond: boolean, detail = "") => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };

  // GREEN: a real import (code position) is adoption.
  check("green-real-import", importsDriverResult('import { verified } from "./checker-io.ts";\n') === true);
  check("green-driver-result-import", importsDriverResult('import { verifyIndependently } from "./driver-result.ts";\n') === true);
  // GREEN: a comment / string mention is NOT adoption (按位置不按关键词).
  check("green-comment-mention", importsDriverResult('// adopt: import { x } from "./checker-io.ts";\n') === false);
  check("green-string-mention", importsDriverResult('const s = "from \\"./checker-io.ts\\"";\n') === false);

  console.log(`\nchecker-driver-result-ratchet-check --selftest: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

function usage(): never {
  console.error(
    "usage: node checker-driver-result-ratchet-check.ts [--root <dir>] [--json] [--selftest]\n" +
      "Exit: 0 = verified (all REQUIRED_ADOPTERS adopt + count ≥ floor); 1 = failed (regression); 2 = not-evaluated.",
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--selftest")) {
    return selftest() ? 0 : 1;
  }
  const asJson = args.includes("--json");
  const rootArg = args.indexOf("--root");
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());

  const result = checkRatchet(root);

  if (asJson) {
    const payload =
      result.state === "verified"
        ? {
            state: result.state,
            ok: true,
            adoptedCheckers: result.value.adoptedCheckers.length,
            required: result.value.required,
            missing: result.value.missing,
            adopters: result.value.adopters,
          }
        : { state: result.state, ok: false, reason: result.reason };
    console.log(JSON.stringify(payload, null, 2));
  } else if (result.state === "verified") {
    const r = result.value;
    console.log(
      `checker-driver-result-ratchet-check — ${r.adoptedCheckers.length} checker(s) adopt DriverResult (floor ${r.minAdoptedCheckers}): ${r.adoptedCheckers.join(", ")}`,
    );
    console.log("PASS: 采纳棘轮满足（REQUIRED_ADOPTERS 全部采纳，只增不减）");
  } else if (result.state === "failed") {
    console.log(`FAIL: ${result.reason}`);
  } else {
    console.log(`NOT-EVALUATED: ${result.reason}`);
  }
  return driverResultToExit(result);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  process.exit(main(process.argv));
}
