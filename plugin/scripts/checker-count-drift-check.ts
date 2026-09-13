#!/usr/bin/env node
// checker-count-drift-check.ts — 注册表自述数量 vs 实测 run_checker 条数
// (tasks/gap-checker-claim-vs-actual-cadence-and-count-drift).
//
// THE DEFECT THIS CLOSES (发生率=3, 三处都在同一段头注释里, 三处都没有任何机械消费者):
//   runner-static-gate.ts 的文件头自称 "35 checkers" 而 run_static_checks() 函数体实测 58 条
//   run_checker; 同一句话里 "the 11 OPERATIONAL-class" 与 "the 7 DOC-class" 也是同一种自述
//   (scripts/test.sh 的 run_doc_checks() 实测 8). 数字可以往任一方向错, 而套件里没有任何东西
//   会发现, 因为【声明】与【函数体】从来没有被任何机器比对过 —— 一个没人能反驳的声明, 与一个
//   正确的声明在记录上同形 (CLAUDE.md 硬规则 2「按位置判定」/ 硬规则 9「可见性 ≠ 执行」).
//
// WHAT IT ASSERTS (by POSITION, never by keyword — 硬规则 2):
//   每个注册表函数上挂一条 `# @checker-count <N>` 注释 (取其紧邻其上的最近一条), N 必须等于该
//   函数体内 `run_checker "<label>"` 命令位置条目的数量. 注释/字符串里"提到" run_checker 不算:
//   判定用的是锚定在行首的**命令位置**模式, 不是关键词扫描 —— 位置本身就是排除法, 不需要掩码.
//
// WHY AN ANNOTATION AND NOT THE PROSE (single source of truth):
//   头注释的散文里再写一遍数字 = 同一事实的两份拷贝 ⇒ 又是一处会漂移的副本. 计数只声明一次
//   (函数上的注解), 散文指向它.
//
// THREE-STATE (硬规则 3b —— 读不懂不得与"合格"同形):
//   读不到载体文件 / 找不到注册表函数 / 找不到注解 ⇒ 该维度 exit 3 NOT-EVALUATED, **绝不 exit 0**.
//   消费方工作区 (plugin 随包发布, 而 scripts/test.sh 是仓库本地的) 必须能把"这里没评估"与
//   "这里评估过且合格"区分开.
//
// Exit codes: 0 = PASS (每个载体都评估成功, 每个声明数 == 实测数);
//             1 = RED   (至少一处 声明数 != 实测数);
//             2 = usage/environment error;
//             3 = NOT-EVALUATED (至少一个载体/函数/注解读不到; 无 RED 时).
//
// Usage:
//   node --experimental-strip-types checker-count-drift-check.ts [--root <dir>] [--json]
//   node --experimental-strip-types checker-count-drift-check.ts --help

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helpExit, isDirectEntry } from "./gate-script-base.ts";

// ── The registries this checker owns ────────────────────────────────────────────────────────────
// Each entry: the carrier file (repo-root relative) and the registry function inside it. Adding a
// fourth registry means adding a line here AND the `# @checker-count <N>` annotation on it — both
// halves are the point (a declaration with no carrier is exactly the drift class this closes).

export interface Registry {
  carrier: string;
  fn: string;
}

export const REGISTRIES: readonly Registry[] = [
  { carrier: "plugin/scripts/runner-static-gate.ts", fn: "run_static_checks" },
  { carrier: "plugin/scripts/runner-static-gate.ts", fn: "run_operational_checks" },
  // The DOC-class registry lives in the suite entry (run_doc_checks, AC51 断言面拆分) — same
  // contract, different carrier. Absent in a consumer workspace ⇒ NOT-EVALUATED (exit 3).
  { carrier: "scripts/test.sh", fn: "run_doc_checks" },
];

// ── Positional patterns (硬规则 2) ───────────────────────────────────────────────────────────────
/** A run_checker invocation at COMMAND position: leading blanks, the command, blanks, a quoted label.
 *  A line that merely mentions run_checker in prose/comment (leading `#`) never matches — the anchor
 *  is the position, not a keyword search followed by a mask. `run_checker_parallel_wait` has `_`
 *  where this requires whitespace, so it is structurally excluded (not by an enumeration). */
export const RUN_CHECKER_RE = /^[ \t]*run_checker[ \t]+"/;
/** The count declaration: the `# @checker-count <digits>` annotation attached to a registry. */
export const ANNOTATION_RE = /^#[ \t]*@checker-count[ \t]+(\d+)\b/;
/** A shell function definition at command position: `<name>() {`. */
export function fnDefRe(fn: string): RegExp {
  return new RegExp(`^${fn}\\(\\) \\{$`);
}

// ── Pure parsing helpers (exported for the unit test) ───────────────────────────────────────────

export interface Evaluated {
  registry: Registry;
  declared: number;
  measured: number;
  annotationLine: number;
  fnLine: number;
}

export interface UnEvaluated {
  registry: Registry;
  reason: string;
}

/** Count run_checker entries in a function body (the lines strictly between the `fn() {` line and
 *  the closing `}` at column 0). */
export function countRunCheckers(body: readonly string[]): number {
  let n = 0;
  for (const line of body) if (RUN_CHECKER_RE.test(line)) n++;
  return n;
}

/** The nearest preceding contiguous comment line carrying the annotation (walking up from the
 *  definition). Returns null when none is attached. */
export function findAnnotation(
  lines: readonly string[],
  defIdx: number,
): { value: number; line: number } | null {
  for (let i = defIdx - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith("#")) return null; // the comment block ended — no annotation attached
    const m = line.match(ANNOTATION_RE);
    if (m) return { value: Number(m[1]), line: i + 1 };
  }
  return null;
}

/** Evaluate one registry against its carrier's lines. Either an Evaluated or an UnEvaluated — never
 *  a third shape that reads like a pass. */
export function evaluateRegistry(lines: readonly string[], registry: Registry): Evaluated | UnEvaluated {
  const defRe = fnDefRe(registry.fn);
  const defIdx = lines.findIndex((l) => defRe.test(l));
  if (defIdx < 0) {
    return { registry, reason: `registry function \`${registry.fn}()\` not found in ${registry.carrier}` };
  }
  const ann = findAnnotation(lines, defIdx);
  if (!ann) {
    return {
      registry,
      reason: `no \`# @checker-count <N>\` annotation attached to \`${registry.fn}()\` (line ${defIdx + 1}) in ${registry.carrier}`,
    };
  }
  let endIdx = -1;
  for (let i = defIdx + 1; i < lines.length; i++) {
    if (lines[i].replace(/\s+$/, "") === "}") { endIdx = i; break; }
  }
  if (endIdx < 0) {
    return { registry, reason: `unterminated body for \`${registry.fn}()\` in ${registry.carrier} (no closing \`}\` at column 0)` };
  }
  return {
    registry,
    declared: ann.value,
    measured: countRunCheckers(lines.slice(defIdx + 1, endIdx)),
    annotationLine: ann.line,
    fnLine: defIdx + 1,
  };
}

export function isEvaluated(x: Evaluated | UnEvaluated): x is Evaluated {
  return (x as Evaluated).declared !== undefined;
}

// ── Driver ──────────────────────────────────────────────────────────────────────────────────────

function defaultRoot(): string {
  // <repo>/plugin/scripts/checker-count-drift-check.ts → <repo>
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export interface RunResult {
  ok: boolean;
  entries: Evaluated[];
  mismatches: Evaluated[];
  unEvaluated: UnEvaluated[];
}

export function runCheck(root: string): RunResult {
  const entries: Evaluated[] = [];
  const unEvaluated: UnEvaluated[] = [];
  for (const registry of REGISTRIES) {
    const abs = path.join(root, registry.carrier);
    if (!fs.existsSync(abs)) {
      unEvaluated.push({ registry, reason: `carrier not present: ${registry.carrier}` });
      continue;
    }
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    const r = evaluateRegistry(lines, registry);
    if (isEvaluated(r)) entries.push(r);
    else unEvaluated.push(r);
  }
  const mismatches = entries.filter((e) => e.declared !== e.measured);
  return { ok: mismatches.length === 0 && unEvaluated.length === 0, entries, mismatches, unEvaluated };
}

export const USAGE =
  "usage: node --experimental-strip-types checker-count-drift-check.ts [--root <dir>] [--json]\n" +
  "  Asserts each registry's `# @checker-count <N>` annotation equals its function body's run_checker count.\n" +
  "  exit 0 = PASS, 1 = RED (declared != measured), 2 = usage/env error, 3 = NOT-EVALUATED (carrier unreadable).";

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(USAGE);

  const flagVal = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const asJson = args.includes("--json");
  const root = path.resolve(flagVal("--root") || defaultRoot());

  const res = runCheck(root);

  if (asJson) {
    console.log(JSON.stringify({
      mode: "gate",
      root,
      ok: res.ok,
      entries: res.entries.map((e) => ({
        carrier: e.registry.carrier, fn: e.registry.fn,
        declared: e.declared, measured: e.measured,
        annotationLine: e.annotationLine, fnLine: e.fnLine,
        match: e.declared === e.measured,
      })),
      mismatches: res.mismatches.map((e) => ({
        carrier: e.registry.carrier, fn: e.registry.fn, declared: e.declared, measured: e.measured,
      })),
      notEvaluated: res.unEvaluated.map((u) => ({ carrier: u.registry.carrier, fn: u.registry.fn, reason: u.reason })),
    }, null, 2));
  } else {
    console.log(`checker-count-drift-check — declared vs measured run_checker entries (root: ${root})`);
    for (const e of res.entries) {
      const tag = e.declared === e.measured ? "ok" : "MISMATCH";
      console.log(`  [${tag}] ${e.registry.carrier}:${e.registry.fn} — declared ${e.declared}, measured ${e.measured} (annotation at line ${e.annotationLine})`);
    }
    for (const u of res.unEvaluated) {
      console.log(`  [not-evaluated] ${u.registry.carrier}:${u.registry.fn} — ${u.reason}`);
    }
    if (res.mismatches.length > 0) {
      console.log(`FAIL — ${res.mismatches.length} declared count(s) disagree with the function body:`);
      for (const m of res.mismatches) {
        console.log(`  - ${m.registry.carrier}:${m.registry.fn}: declared ${m.declared}, measured ${m.measured} — set the \`# @checker-count\` annotation on that function to ${m.measured}`);
      }
    } else if (res.unEvaluated.length > 0) {
      console.log(`NOT-EVALUATED — ${res.unEvaluated.length} registry dimension(s) could not be read (see above); no mismatch was found in the dimensions that WERE read.`);
    } else {
      console.log(`PASS — every declared registry count matches its function body (${res.entries.length}/${REGISTRIES.length} evaluated)`);
    }
  }

  if (res.mismatches.length > 0) return 1;
  if (res.unEvaluated.length > 0) return 3;
  return 0;
}

if (isDirectEntry(import.meta, undefined, "checker-count-drift-check")) {
  process.exit(main(process.argv));
}
