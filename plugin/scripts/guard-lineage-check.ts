#!/usr/bin/env node
// guard-lineage-check.ts — P4 守卫谱系检测器 (docs/proposals/archguard-generation-era-primitives.md §3 P4).
// 每个检测器机器可读地声明四元组 ⟨guards, wired-into, last-run, last-fired⟩; 本工具核验/记录其中
// 本任务承担的两半 (tasks/gap-archguard-p4-guard-lineage-declaration-and-registry):
//   ① 守卫头部声明块 — 复用 capability-catalog 的登记位, GUARD_OBJECT 表声明该守卫
//     "守的是什么对象/不变式" (guards)。对象两种形态: `file:<relpath>` (可核验存在性) /
//     `invariant:<描述>` (约定, 无文件可指 — 文档 §3 P4 原文: "多数守卫守的是一条约定…没有可指对象")。
//   ② verdict 记录流 — 读 checker-cost.jsonl 的 verdict 字段 (gap-checker-cost-jsonl-add-verdict-field
//     落地的三态 pass/fail/not-evaluated), 算每个守卫的 last-run / last-fired 与「窗口内曾变红比例」。
//
// 报告 (AC 对应):
//   AC1 已声明守卫对象的比例 — 现场枚举全部守卫 (口径 = 文档 §2.3/附录 A: plugin/scripts +
//       experiments/quay-perpetual-stream/scripts + plugin/gate-scripts 按目录去重, 排除 worktree 与
//       gitignored 镜像 — 后者本就不在这三目录内), declared / total。文档记 165 / 0%, 现场以跑出的为准。
//   AC2 窗口内曾变红的比例 — distinct 有 verdict:"fail" 的守卫名 / total。verdict 字段缺失 (历史行无
//       verdict, 或 cost file 不存在) 时标 NOT-EVALUATED, 不伪造非零值 (硬规则 3b)。
//   AC3 逐个回答"该守卫的对象是否仍存在" — file 对象查 fs.existsSync(root/<relpath>); invariant 对象
//       如实报 "not mechanically checkable" (不把「无法评估」伪装成「存在」)。
//   AC4 反向判据 — 不得把 checker-mutation-check 这类【预防性】守卫因「从未变红」报为可疑: 判定同时
//       采信 last-fired 与 mutation-verified 两项证据。mutation-verified = 有 mutation case
//       (plugin/scripts/checker-mutation-cases/<stem>.sh — checker-mutation-check 的 L_S 变异验证)。
//       disposition: fired / preventive (never-fired ∧ mutation-verified) / suspicious (never-fired ∧
//       ¬mutation-verified)。suspicious/preventive 只在【已声明】守卫上判 — 未声明守卫无对象可指,
//       正是 AC1 的 0% 发现 (「守卫对象还存在吗」结构上无法回答)。
//
// 每个计数内建「打印命中样本」纪律 (docs 附录 A): 报 declared/fired 清单时列出前若干条实际内容。
//
// Usage:
//   node --experimental-strip-types guard-lineage-check.ts [--root <dir>] [--catalog <file>] [--cost-file <file>] [--json]
//   --root <dir>       repo 根: 守卫枚举 + 对象存在性 + mutation case + 默认 catalog/cost-file 都相对它
//                      (默认 repo-root.ts 推导)。生产/现场读运行时态 (gitignored tick log / checker-cost)
//                      时应指向主检出 — verify worktree 无这些运行时态 (同 instrument-decay-check 的
//                      --root main_root 约定)。
//   --catalog <file>   capability-catalog declarations 文件 (读 GUARD_OBJECT 表; 默认 <root>/plugin/scripts/capability-catalog-declarations.json)
//                      ⛔ 不再是 capability-catalog.sh：声明表已搬出 bash 成为数据 (gap-arch-catalog-declarations-leave-bash)
//   --cost-file <file> checker-cost.jsonl 路径 (读 verdict 流; 默认 <root>/.quay/checker-cost.jsonl)
//   --json             机器可读 JSON
//   --help             用法, exit 0
// Exit: 0 = report produced (observer, 非 pass/fail gate — 同 identity-replication-check/deletion-closure-check);
//       2 = usage/environment error (root 无 plugin/scripts)。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./repo-root.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ── 守卫枚举 (口径 = 文档 §2.3 附录 A: 三目录按目录去重, -check|-guard|-audit 后缀) ─────────────
export const GUARD_DIRS = [
  "plugin/scripts",
  "experiments/quay-perpetual-stream/scripts",
  "plugin/gate-scripts",
];
export const GUARD_RE = /-(check|guard|audit)\.(ts|sh|mjs)$/;

export interface GuardRef {
  basename: string;
  dir: string;      // 三目录之一
  relPath: string;  // dir/basename
  stem: string;     // basename 去扩展名 (mutation case 名)
}

export function enumerateGuards(root: string): GuardRef[] {
  const out: GuardRef[] = [];
  for (const dir of GUARD_DIRS) {
    const abs = path.join(root, dir);
    let names: string[] = [];
    try {
      names = fs.readdirSync(abs);
    } catch {
      continue; // 目录缺 (bare fixture) — 不炸, 缺目录 ≠ 有守卫
    }
    for (const name of names.sort()) {
      if (!GUARD_RE.test(name)) continue;
      out.push({ basename: name, dir, relPath: `${dir}/${name}`, stem: name.replace(/\.(ts|sh|mjs)$/, "") });
    }
  }
  return out;
}

// ── 声明块解析 (从 capability-catalog 的声明数据读 GUARD_OBJECT 表) ────────────────────────────
export interface GuardDeclaration {
  object: string;          // 原始声明值 (file:<path> / invariant:<desc> / 无前缀按 invariant)
  kind: "file" | "invariant";
  filePath?: string;       // kind=file 时的 repo 相对路径
}

export function classifyDeclaration(value: string): GuardDeclaration {
  if (value.startsWith("file:")) {
    return { object: value, kind: "file", filePath: value.slice("file:".length) };
  }
  return { object: value, kind: "invariant" };
}

/**
 * 解析 capability-catalog 声明数据 (plugin/scripts/capability-catalog-declarations.json) 的
 * `GUARD_OBJECT` 表: `{ "<basename>": "<声明值>" }`。
 *
 * ⛔ 这份文件以前是 capability-catalog.sh 里的 `declare -A GUARD_OBJECT=( … )` bash 块，逐行按
 * `[name]="value"` 解析 (gap-arch-catalog-declarations-leave-bash 把它搬成了数据)。解析失败 ⇒
 * 空表 (= 「无守卫声明」)，绝不当成「查过且合格」—— 一份读不懂的声明文件不会静默：capability-catalog
 * 自己的入口闸对同一份文件 exit 3 (CAUSE=declarations-unparsable / -missing)，而 declaredRatio=0
 * 在报告里本来就是一个响亮的异常值。
 */
export function parseGuardObjects(declarationsText: string): Map<string, GuardDeclaration> {
  const out = new Map<string, GuardDeclaration>();
  let doc: unknown;
  try {
    doc = JSON.parse(declarationsText);
  } catch {
    return out;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return out;
  const table = (doc as Record<string, unknown>)["GUARD_OBJECT"];
  if (table === null || typeof table !== "object" || Array.isArray(table)) return out;
  for (const [name, value] of Object.entries(table as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    out.set(name, classifyDeclaration(value));
  }
  return out;
}

// ── 对象存在性 (AC3: 逐个回答"该守卫的对象是否仍存在") ────────────────────────────────────────
export interface ObjectPresence {
  declared: boolean;
  kind: "file" | "invariant" | null;
  object: string | null;
  present: boolean | null; // file: existsSync 结果; invariant/undeclared: null (不可机械核验)
  note: string;
}

export function checkObjectPresent(root: string, dec: GuardDeclaration | undefined): ObjectPresence {
  if (!dec) {
    return { declared: false, kind: null, object: null, present: null, note: "not declared" };
  }
  if (dec.kind === "file") {
    const exists = fs.existsSync(path.join(root, dec.filePath!));
    return {
      declared: true, kind: "file", object: dec.object, present: exists,
      note: exists ? "object present" : "object MISSING",
    };
  }
  return {
    declared: true, kind: "invariant", object: dec.object, present: null,
    note: "invariant (not a file — existence not mechanically checkable)",
  };
}

// ── verdict 流 (AC2: 窗口内曾变红比例) ─────────────────────────────────────────────────────────
export interface NameVerdict {
  lastRun: string | null;   // max at (任何 verdict)
  lastFired: string | null; // max at where verdict == "fail"
  fired: boolean;
  failCount: number;
  passCount: number;
  neCount: number;          // not-evaluated
}

export interface VerdictStats {
  totalRows: number;
  withVerdict: number;
  withoutVerdict: number;
  window: { minAt: string | null; maxAt: string | null }; // verdict-bearing 行的窗口
  byName: Map<string, NameVerdict>;
  firedNames: string[];      // distinct 有 fail 的守卫名 (排序)
  evaluable: boolean;        // 是否存在带 verdict 的行
}

export function readVerdicts(costFile: string): VerdictStats {
  const empty: VerdictStats = {
    totalRows: 0, withVerdict: 0, withoutVerdict: 0,
    window: { minAt: null, maxAt: null }, byName: new Map(), firedNames: [], evaluable: false,
  };
  if (!fs.existsSync(costFile)) return empty;
  const byName = new Map<string, NameVerdict>();
  const fired = new Set<string>();
  let totalRows = 0;
  let withVerdict = 0;
  let withoutVerdict = 0;
  let minAt: string | null = null;
  let maxAt: string | null = null;
  for (const line of fs.readFileSync(costFile, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(t);
    } catch {
      continue; // 追加式账本里一条坏行不得杀掉检测器
    }
    if (!rec || typeof rec.name !== "string") continue;
    totalRows++;
    const verdict = rec.verdict;
    if (verdict === undefined || verdict === null) {
      withoutVerdict++;
      continue;
    }
    withVerdict++;
    const at = typeof rec.at === "string" ? rec.at : null;
    if (at) {
      if (minAt === null || at < minAt) minAt = at;
      if (maxAt === null || at > maxAt) maxAt = at;
    }
    const entry: NameVerdict = byName.get(rec.name) ?? {
      lastRun: null, lastFired: null, fired: false, failCount: 0, passCount: 0, neCount: 0,
    };
    if (at && (entry.lastRun === null || at > entry.lastRun)) entry.lastRun = at;
    if (verdict === "fail") {
      entry.failCount++;
      entry.fired = true;
      fired.add(rec.name);
      if (at && (entry.lastFired === null || at > entry.lastFired)) entry.lastFired = at;
    } else if (verdict === "pass") {
      entry.passCount++;
    } else if (verdict === "not-evaluated") {
      entry.neCount++;
    }
    byName.set(rec.name, entry);
  }
  return {
    totalRows, withVerdict, withoutVerdict,
    window: { minAt, maxAt }, byName, firedNames: [...fired].sort(), evaluable: withVerdict > 0,
  };
}

// ── mutation-verified (AC4: 有 mutation case = checker-mutation-check 的 L_S 变异验证已覆盖) ────
export function isMutationVerified(root: string, stem: string): boolean {
  return fs.existsSync(path.join(root, "plugin", "scripts", "checker-mutation-cases", `${stem}.sh`));
}

// ── 汇总 report ────────────────────────────────────────────────────────────────────────────────
export interface DeclaredEntry {
  basename: string;
  dir: string;
  kind: "file" | "invariant";
  object: string;
  present: boolean | null;
  note: string;
}

export interface DispositionEntry {
  basename: string;
  dir: string;
  reason: string;
}

export interface LineageReport {
  root: string;
  totalGuards: number;
  declaredCount: number;
  declaredRatio: number;       // AC1
  declared: DeclaredEntry[];   // AC3
  verdict: {                   // AC2
    evaluable: boolean;
    reason: string | null;
    costFile: string;
    rowsWithVerdict: number;
    rowsWithoutVerdict: number;
    window: { minAt: string | null; maxAt: string | null };
    firedCount: number;
    firedRatio: number;
    firedNames: string[];
  };
  suspicious: DispositionEntry[]; // AC4 反向: never-fired ∧ ¬mutation-verified (只判已声明)
  preventive: DispositionEntry[]; // AC4 反向: never-fired ∧ mutation-verified (预防性, 非可疑)
}

export function analyze(
  root: string,
  opts: { catalogFile: string; costFile: string },
): LineageReport {
  const guards = enumerateGuards(root);
  const totalGuards = guards.length;
  const catalogText = fs.existsSync(opts.catalogFile)
    ? fs.readFileSync(opts.catalogFile, "utf8")
    : "";
  const decls = parseGuardObjects(catalogText);
  const verdicts = readVerdicts(opts.costFile);

  const guardBasenames = new Set(guards.map((g) => g.basename));
  const declaredCount = guards.filter((g) => decls.has(g.basename)).length;
  const declaredRatio = totalGuards > 0 ? declaredCount / totalGuards : 0;

  const declared: DeclaredEntry[] = guards
    .filter((g) => decls.has(g.basename))
    .map((g) => {
      const dec = decls.get(g.basename)!;
      const p = checkObjectPresent(root, dec);
      return { basename: g.basename, dir: g.dir, kind: dec.kind, object: dec.object, present: p.present, note: p.note };
    });

  const firedCount = verdicts.firedNames.filter((n) => guardBasenames.has(n)).length;
  // firedRatio 分母 = 全部守卫 (与 declaredRatio 同口径, 文档 §3 P4: "对本仓库 165 个守卫…比例")。
  const firedRatio = totalGuards > 0 ? firedCount / totalGuards : 0;

  const suspicious: DispositionEntry[] = [];
  const preventive: DispositionEntry[] = [];
  for (const g of guards) {
    if (!decls.has(g.basename)) continue; // 未声明守卫无对象可指, 不判 disposition (AC1 的 0% 发现)
    const fired = verdicts.firedNames.includes(g.basename);
    if (fired) continue; // fired = 活, 非可疑
    if (isMutationVerified(root, g.stem)) {
      preventive.push({
        basename: g.basename, dir: g.dir,
        reason: "never-fired but mutation-verified (proven able to fire) — preventive, not suspicious",
      });
    } else {
      suspicious.push({
        basename: g.basename, dir: g.dir,
        reason: "never-fired and not mutation-verified — indistinguishable from a broken guard (P4 定义)",
      });
    }
  }

  return {
    root,
    totalGuards,
    declaredCount,
    declaredRatio,
    declared,
    verdict: {
      evaluable: verdicts.evaluable,
      reason: verdicts.evaluable ? null : "no verdict field present (checker-cost.jsonl rows lack verdict, or cost file missing) — NOT-EVALUATED",
      costFile: opts.costFile,
      rowsWithVerdict: verdicts.withVerdict,
      rowsWithoutVerdict: verdicts.withoutVerdict,
      window: verdicts.window,
      firedCount,
      firedRatio,
      firedNames: verdicts.firedNames,
    },
    suspicious,
    preventive,
  };
}

// ── 输出 ────────────────────────────────────────────────────────────────────────────────────────
function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function printHuman(report: LineageReport): void {
  console.log("guard-lineage-check — P4 守卫谱系检测器 (docs/proposals/archguard-generation-era-primitives.md §3)");
  console.log("root:", report.root);

  console.log(`\n== AC1 已声明守卫对象 — ${report.declaredCount}/${report.totalGuards} = ${pct(report.declaredRatio)} ==`);
  console.log(`  total guards enumerated (三目录去重): ${report.totalGuards}`);
  if (report.declared.length === 0) {
    console.log("  (none declared — 文档 §3 P4 记 165 个 0%, 现场以跑出为准)");
  }

  console.log(`\n== AC2 窗口内曾变红 — ${report.verdict.firedCount}/${report.totalGuards} = ${pct(report.verdict.firedRatio)} ==`);
  if (!report.verdict.evaluable) {
    console.log(`  NOT-EVALUATED — ${report.verdict.reason}`);
  } else {
    const w = report.verdict.window;
    console.log(`  window: ${w.minAt ?? "?"} → ${w.maxAt ?? "?"} (${report.verdict.rowsWithVerdict} verdict-bearing rows; ${report.verdict.rowsWithoutVerdict} pre-verdict rows ignored)`);
    if (report.verdict.firedNames.length === 0) {
      console.log("  fired (verdict:\"fail\"): none — 0 guards went red in the verdict-bearing window");
    } else {
      console.log(`  fired names: ${report.verdict.firedNames.join(", ")}`);
    }
  }

  console.log(`\n== AC3 已声明守卫的对象存在性 — ${report.declared.length} declared ==`);
  for (const d of report.declared) {
    const mark = d.present === null ? "—" : d.present ? "PRESENT" : "MISSING";
    console.log(`  ${d.basename}  [${d.kind}]  ${mark}  ${d.object}`);
  }

  console.log(`\n== AC4 反向判据 — disposition (只判已声明守卫) ==`);
  console.log(`  preventive (never-fired ∧ mutation-verified): ${report.preventive.length}`);
  for (const p of report.preventive) console.log(`    ${p.basename}  — ${p.reason}`);
  console.log(`  suspicious (never-fired ∧ ¬mutation-verified): ${report.suspicious.length}`);
  for (const s of report.suspicious) console.log(`    ${s.basename}  — ${s.reason}`);
}

function printJson(report: LineageReport): void {
  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(argv: string[]): {
  root?: string; catalog?: string; costFile?: string; json: boolean; help: boolean;
} {
  const out = { root: undefined as string | undefined, catalog: undefined as string | undefined, costFile: undefined as string | undefined, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") { out.json = true; continue; }
    if (a === "--help" || a === "-h") { out.help = true; return out; }
    if (a === "--root") { out.root = argv[++i]; continue; }
    if (a === "--catalog") { out.catalog = argv[++i]; continue; }
    if (a === "--cost-file") { out.costFile = argv[++i]; continue; }
    throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

export function main(argv: string[]): number {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`guard-lineage-check: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  if (opts.help) {
    console.log(
      "guard-lineage-check.ts [--root <dir>] [--catalog <file>] [--cost-file <file>] [--json] — " +
      "P4 guard-lineage detector (declared guard-object ratio + verdict-fired ratio + object presence + preventive/suspicious disposition). " +
      "0 = report (observer); 2 = usage/env error.",
    );
    return 0;
  }
  const root = opts.root ? path.resolve(opts.root) : repoRoot(SCRIPT_DIR);
  if (!fs.existsSync(path.join(root, "plugin", "scripts"))) {
    console.error(`guard-lineage-check: plugin/scripts not found under ${root} — is --root correct?`);
    return 2;
  }
  const catalogFile = opts.catalog ? path.resolve(opts.catalog) : path.join(root, "plugin", "scripts", "capability-catalog-declarations.json");  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
  const costFile = opts.costFile ? path.resolve(opts.costFile) : path.join(root, ".quay", "checker-cost.jsonl");
  const report = analyze(root, { catalogFile, costFile });
  if (opts.json) printJson(report);
  else printHuman(report);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
