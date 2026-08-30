// outer-retirement-precondition-check.ts — 退役前置检查（tasks/gap-b0-retirement-precondition-checker-call-surface，
// SPEC-methodology-layer-architecture-2026-08-25 §2.3b B0）。
//
// 回答的问题（@instrument）：「退役 outer 前，outer 执行核（orchestrator-tick-core.md）直接引用的全部
//   checker（`plugin/scripts/*-check.{ts,sh}`）是否每一个都【有留存调用面】（static-gate 注册表，或
//   任何非 .md 可执行载体经代码位置引用），还是只被退役层引用——只被退役层引用的 checker 必须【显式
//   退役】（文件头带 RETIRED-WITH-RETIRING-LAYER 标记），否则退役后静默孤儿？」
//
// 为什么是【前置】而非事后清理（SPEC §2.3b）：outer 将随 inner 退役、cron/loop 换外部短会话 ⇒ 会抽走
// 一部分 checker 的调用面。没有这个前置，孤儿是静默产生的——「退役前枚举 + 逐个判定留存调用面」是
// 硬规则 5（来源完备性）在退役动作上的落地：只被退役层引用的 checker 若没有显式处置记录，与「一切
// 正常」同形。
//
// 判定（能取假，硬规则 3/4）：
//   ① 枚举：`plugin/scripts/*.{ts,sh,mjs}` 中 basename 出现在执行核文本里的脚本（直接引用）。
//   ② checker = 其中 `-check.{ts,sh}` 结尾者（机械信号——SPEC §2.3b 的「109 个 checker」中
//      outer 引用的 12 个全部是 `-check` 结尾）。
//   ③ 留存调用面（不动点）：脚本 S 留存 ⇔ S 在 static-gate 注册表（`run_checker` 引用其精确 basename）
//      ∨ 存在一个【外部载体】（不在 direct-referenced 集合里的可执行文件）以代码位置引用 S
//      ∨ 存在一个已判定留存的脚本引用 S（传递闭包——引用链最终触到外部载体即留存）。
//   ④ 只被退役层引用（orphan）的 checker，其文件必须带 `RETIRED-WITH-RETIRING-LAYER` 标记 = 显式退役；
//      无标记 ⇒ 缺留存调用面 ⇒ RED。
//
// 参考位置判定（硬规则 2）：引用检测按【代码位置】——只屏蔽注释（`//` / `/* */`），不屏蔽字符串
// （import 说明符 `from "./outer-anchor-check.ts"` 里的文件名是真实调用面，必须命中）；测试文件
// （`*.test.mjs` / `*.test.ts`）、catalog（capability-catalog.sh）、shipping 排除表
// （loop-shipping-exclusion-data.mjs）不算调用面（测试随 checker 退役、catalog/shipping 是元数据）。
// `.md` 文档提及一律排除（SPEC §2.3b「⛔ 已排除 .md 提及」）。
//
// 退出码（gap-not-evaluated-harness-third-state 统一约定，run_checker 识别）：
//   0 = PASS（无留存调用面的 checker 数 N=0）
//   1 = RED（存在 orphan checker 且无 RETIRED-WITH-RETIRING-LAYER 标记 —— fail-closed）
//   3 = NOT-EVALUATED（执行核缺失 / 执行核未引用任何 plugin/scripts 脚本 —— 独立取值，非通过，硬规则 3b）
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/outer-retirement-precondition-check.ts \
//       [--root <dir>] [--json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 默认受检面 = quay 仓库根（本脚本位于 <repo>/plugin/scripts/）。 */
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

/** outer 执行核（枚举来源）。 */
export const EXECUTION_CORE_REL = "orchestration/orchestrator-tick-core.md";
/** static-gate 注册表（`run_checker` 引用 checker 的精确 basename ⇒ 留存）。 */
export const REGISTRY_REL = "plugin/scripts/runner-static-gate.ts";
/** 脚本目录（枚举 plugin/scripts 顶层脚本）。 */
export const SCRIPTS_DIR_REL = "plugin/scripts";
/** checker 的机械信号：`-check.{ts,sh}` 结尾。 */
export const CHECKER_RE = /-check\.(ts|sh)$/;
/** 显式退役标记：orphan checker 文件头带此 token ⇒ 已处置（非静默孤儿）。 */
export const RETIRED_MARKER = "RETIRED-WITH-RETIRING-LAYER";
/** 引用扫描的可执行扩展名（.md 一律排除——SPEC §2.3b「⛔ 已排除 .md 提及」）。 */
const EXEC_EXTENSIONS = new Set([".ts", ".sh", ".mjs", ".js", ".cjs", ".bash"]);
/** 不算调用面的元数据/测试文件（测试随 checker 退役；catalog/shipping 是元数据）。
 *  checker-driver-result-ratchet-check.ts（gap-b4-checker-reuse-driver-result）的 REQUIRED_ADOPTERS
 *  是一个【钉住清单】（把已迁移 checker 的 basename 作为字符串数据列出），不是 `import from` 式调用面——
 *  与 capability-catalog.sh 的表格、loop-shipping-exclusion-data.mjs 的排除表同类。若不算元数据，
 *  它的 "outer-anchor-check.ts" 字符串会把这名孤儿伪造成「有外部调用面」而漏报（实测 suite 红）。 */
const NON_CALLER_BASENAMES = new Set([
  "capability-catalog.sh",
  "loop-shipping-exclusion-data.mjs",
  "checker-driver-result-ratchet-check.ts",
]);
const TEST_FILE_RE = /\.test\.(mjs|ts|cjs|js)$/;

export interface PreconditionResult {
  ok: boolean;
  evaluated: boolean;
  notEvaluatedReason?: string;
  executionCore: string;
  /** direct-referenced 脚本总数（含机制，不只 checker）。 */
  referencedCount: number;
  /** 其中 `-check.{ts,sh}` checker 数。 */
  checkerCount: number;
  /** 判定留存（在注册表或有外部/传递调用面）的脚本。 */
  surviving: string[];
  /** 只被退役层引用（orphan）的 checker，按文件名排序。 */
  orphanCheckers: string[];
  /** orphan checker 中带显式退役标记者（已处置）。 */
  retiredWithMarker: string[];
  /** orphan checker 中无标记者（缺留存调用面 ⇒ RED）。 */
  undischarged: string[];
  /** orphan 但非 checker（`-check` 之外）的脚本——B0 范围外，仅信息性列出，不影响 exit code。 */
  orphanNonCheckers: string[];
}

/** 屏蔽注释（TS 的行/块注释 + bash 的 `#` 行注释），但【不】屏蔽字符串/模板/正则字面量——
 *  import 说明符 `from "./name.ts"` 里的文件名是真实调用面，必须落在未屏蔽位置。
 *  `#` 行注释必须一并屏蔽：runner-static-gate.ts 等 .ts 扩展名的 bash 脚本用 `#` 注释，
 *  不屏蔽会把 `# （outer-anchor-check.ts 带标记）` 这类注释误判为代码引用。 */
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
      // 跳过字符串/模板字面量【不屏蔽】——import 说明符 `from "./name.ts"` 是真实调用面，
      // 且字符串内部的 `//` / `/*` / `#` 不是注释，必须不被误判为注释起点。
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
      // bash `#` 行注释（字符串内部的 `#` 已被上面的字符串跳过分支处理，不会到这里）。
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

/** 把被屏蔽（注释）的字符替换成空格（保留长度），得到「仅代码」文本供 includes 搜索。 */
export function codeOnlyText(src: string): string {
  const mask = maskComments(src);
  const chars: string[] = [];
  for (let i = 0; i < src.length; i++) {
    chars.push(mask[i] === 1 ? " " : src[i]);
  }
  return chars.join("");
}

/** 递归列出 `dir` 下的普通文件（绝对路径，排序），跳过 node_modules/.git/.quay 与符号链接。 */
export function listExecutableFiles(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === ".quay") continue;
      const full = path.join(current, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && EXEC_EXTENSIONS.has(path.extname(e.name))) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

/** 枚举 plugin/scripts 顶层脚本（.ts/.sh/.mjs，非递归——checker-mutation-cases 是子目录）。 */
export function listScriptBasenames(root: string): string[] {
  const dir = path.join(root, SCRIPTS_DIR_REL);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && EXEC_EXTENSIONS.has(path.extname(e.name)))
    .map((e) => e.name)
    .sort();
}

/** 执行核直接引用的脚本（basename 出现在执行核文本里）。 */
export function referencedScripts(root: string, tickCoreText: string, scriptBasenames: string[]): string[] {
  return scriptBasenames.filter((b) => tickCoreText.includes(b)).sort();
}

/** S 是否在 static-gate 注册表（`run_checker` 行引用其精确 basename）。
 *  按【代码位置】判定：mask 注释后再 includes——注册表的 `#` 注释里提到某个 checker 名不算注册
 *  （runner-static-gate.ts 是 `#` 注释的 bash 脚本，注释里会提「（outer-anchor-check.ts 带标记）」）。 */
export function inStaticGateRegistry(registryText: string, basename: string): boolean {
  return codeOnlyText(registryText).includes(basename);
}

/**
 * 主判定。纯文件系统读，无写。
 * - 执行核缺失 / 未引用任何 plugin/scripts 脚本 ⇒ NOT-EVALUATED（独立取值，非通过，硬规则 3b/4）。
 * - orphan checker 无显式退役标记 ⇒ RED（fail-closed）。
 */
export function checkPrecondition(root: string): PreconditionResult {
  const corePath = path.join(root, EXECUTION_CORE_REL);
  if (!fs.existsSync(corePath)) {
    return {
      ok: false,
      evaluated: false,
      notEvaluatedReason: `${EXECUTION_CORE_REL} 不存在（无法枚举 outer 执行核引用的 checker）`,
      executionCore: EXECUTION_CORE_REL,
      referencedCount: 0,
      checkerCount: 0,
      surviving: [],
      orphanCheckers: [],
      retiredWithMarker: [],
      undischarged: [],
      orphanNonCheckers: [],
    };
  }
  const tickCoreText = fs.readFileSync(corePath, "utf8");
  const scriptBasenames = listScriptBasenames(root);
  const referenced = referencedScripts(root, tickCoreText, scriptBasenames);
  if (referenced.length === 0) {
    return {
      ok: false,
      evaluated: false,
      notEvaluatedReason: `${EXECUTION_CORE_REL} 未引用任何 plugin/scripts 脚本（枚举无对象——与「无 orphan」同形，硬规则 4）`,
      executionCore: EXECUTION_CORE_REL,
      referencedCount: 0,
      checkerCount: 0,
      surviving: [],
      orphanCheckers: [],
      retiredWithMarker: [],
      undischarged: [],
      orphanNonCheckers: [],
    };
  }
  const checkers = referenced.filter((b) => CHECKER_RE.test(b));

  const registryPath = path.join(root, REGISTRY_REL);
  const registryText = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, "utf8") : "";

  // 反向引用表：对每个 direct-referenced 脚本，收集「以代码位置引用它」的可执行载体。
  // 载体排除：脚本自身、测试文件、catalog、shipping 排除表。`.md` 由扩展名过滤天然排除。
  const referrers = new Map<string, Set<string>>();
  for (const b of referenced) referrers.set(b, new Set());
  for (const file of listExecutableFiles(root)) {
    const base = path.basename(file);
    if (NON_CALLER_BASENAMES.has(base)) continue;
    if (TEST_FILE_RE.test(base)) continue;
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // 脚本之间可互相引用（如 outer-cron-registry.ts import outer-anchor-check.ts）——
    // 这种引用要计入 referrers，供不动点做传递判定；「自己引用自己」在下面逐 b 跳过。
    const codeText = codeOnlyText(text);
    for (const b of referenced) {
      const scriptAbs = path.join(root, SCRIPTS_DIR_REL, b);
      if (file === scriptAbs) continue; // 自身引用不计
      if (codeText.includes(b)) referrers.get(b)!.add(file);
    }
  }

  // 不动点：留存 ⇔ 在注册表 ∨ 外部载体引用 ∨ 留存的脚本引用。
  const surviving = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of referenced) {
      if (surviving.has(b)) continue;
      if (inStaticGateRegistry(registryText, b)) {
        surviving.add(b);
        changed = true;
        continue;
      }
      const refs = referrers.get(b)!;
      let survives = false;
      for (const f of refs) {
        const fBase = path.basename(f);
        const fIsReferenced = referenced.includes(fBase);
        if (!fIsReferenced || surviving.has(fBase)) {
          survives = true;
          break;
        }
      }
      if (survives) {
        surviving.add(b);
        changed = true;
      }
    }
  }

  const orphan = referenced.filter((b) => !surviving.has(b)).sort();
  const orphanCheckers = orphan.filter((b) => CHECKER_RE.test(b));
  const orphanNonCheckers = orphan.filter((b) => !CHECKER_RE.test(b));

  const retiredWithMarker: string[] = [];
  const undischarged: string[] = [];
  for (const b of orphanCheckers) {
    const p = path.join(root, SCRIPTS_DIR_REL, b);
    let has = false;
    try {
      has = fs.readFileSync(p, "utf8").includes(RETIRED_MARKER);
    } catch {
      has = false;
    }
    (has ? retiredWithMarker : undischarged).push(b);
  }

  return {
    ok: undischarged.length === 0,
    evaluated: true,
    executionCore: EXECUTION_CORE_REL,
    referencedCount: referenced.length,
    checkerCount: checkers.length,
    surviving: [...surviving].sort(),
    orphanCheckers,
    retiredWithMarker,
    undischarged,
    orphanNonCheckers,
  };
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      `outer-retirement-precondition-check.ts — 退役前置检查：枚举 outer 执行核直接引用的 checker，判定每个是否有留存调用面（只被退役层引用的 orphan 须带 ${RETIRED_MARKER} 标记）。
usage: node --experimental-strip-types plugin/scripts/outer-retirement-precondition-check.ts [--root <dir>] [--json]\n`,
    );
    return 0;
  }
  const root = path.resolve(parseArg(argv, "--root") ?? DEFAULT_ROOT);
  const json = argv.includes("--json");

  const res = checkPrecondition(root);

  if (!res.evaluated) {
    if (json) {
      process.stdout.write(`${JSON.stringify(res)}\n`);
    } else {
      process.stderr.write(`NOT-EVALUATED: ${res.notEvaluatedReason}\n`);
    }
    return 3;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(res)}\n`);
  } else if (res.ok) {
    process.stdout.write(
      `PASS: ${res.checkerCount} checker(s) referenced by ${res.executionCore} — ` +
        `orphan-without-call-surface N=0` +
        (res.retiredWithMarker.length > 0
          ? ` (${res.retiredWithMarker.length} explicitly retired: ${res.retiredWithMarker.join(", ")})`
          : "") +
        `\n`,
    );
  } else {
    process.stderr.write(
      `RED: ${res.undischarged.length} orphan checker(s) without a surviving call surface or RETIRED marker\n`,
    );
    for (const b of res.undischarged) {
      process.stderr.write(`  - ${b}\n`);
    }
  }

  if (res.orphanNonCheckers.length > 0 && !json) {
    process.stderr.write(
      `  (info) ${res.orphanNonCheckers.length} non-checker script(s) also bound to the retiring layer ` +
        `(out of B0 scope): ${res.orphanNonCheckers.join(", ")}\n`,
    );
  }

  return res.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
