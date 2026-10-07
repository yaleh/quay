#!/usr/bin/env node
// concurrency-literal-check.ts — 并发数值字面量只允许在唯一定义点
// (tasks/gap-concurrency-literal-only-at-definition-points)
//
// THE DEFECT THIS CLOSES: 「读宿主不写字面量」原则每次都对、每次都被绕过,因为没有任何东西会报出来
// (CLAUDE.md 硬规则 4 推论二 — no machine-spec-dependent literals scattered). 历史实证:
//   DEFAULT_SERIAL_CONCURRENCY=6 (fixed 1e7bfbe6), cpuQuota:"400%" (fixed), CONCURRENCY_CAP_DEFAULT=3
//   (declared exception). 人 2026-08-13 目标形态: 并发值只从唯一定义点 (QUAY_MAX_TASK_SUBAGENTS /
//   QUAY_MAX_CONCURRENT_SUITES / QUAY_MAX_OVERSUBSCRIPTION — 宿主级环境变量, per-host $QUAY_GLOBAL_DIR)
//   派生; 其余处出现的并发数值字面量即违规。
//
// WHAT IT DETECTS (by POSITION, never by keyword — CLAUDE.md 硬规则 2): a 并发数值字面量 is a
// numeric literal appearing in one of FIVE CONCURRENCY-VALUE POSITIONS, matched at CODE positions
// only (buildNonCodeMask — a comment/string/regex that merely spells the pattern never reports):
//   P1  concurrency-constant definition: (export) const NAME = <num> where NAME carries a
//       concurrency keyword (cap|slot|lane|concurr|subagent|parallel|quota|oversub|dispatch).
//   P2  CLI concurrency flag literal: --cap|--lane-count|--slots|--concurrency|--max-concurrent …
//       followed by <num>.
//   P3  CPU quota literal: CPUQuota=<num>% | cpuQuota: "<num>%".
//   P4  object-literal concurrency key: (cap|slots|laneCount|concurrency): <num>.
//   P5  CPU-quota literal inside a systemd-run-limit override STRING — the historical leak shape
//       (gap-concurrency-literal-check-workflows-coverage): `systemdRunLimits = "MemoryMax=4G
//       CPUQuota=400% TasksMax=200"` — a REAL runtime value (passed to systemd-run via the
//       QUAY_TEST_SYSTEMD_RUN_LIMITS seam) that sits inside a double-quoted string, which the
//       non-code mask blanks (P3 cannot see it). The positional signal that distinguishes a
//       runtime override from a doc mention: the same string ALSO carries a sibling systemd-run
//       key (MemoryMax= / TasksMax=).
//
// SEAM ENUMERATION (AC3, gap-concurrency-literal-check-workflows-coverage): 源头默认值正确不够——
// 任何能绕过源头默认值的 seam 必须被覆盖, 否则「源头正确」不构成保证。已枚举并覆盖的 seam:
//   QUAY_TEST_SYSTEMD_RUN_LIMITS — full-suite-runner.ts 的测试 seam, 经 workflow 载体
//     (`systemdRunLimits = "…"` 默认 + launchEnv 注入) 把 systemd-run 限制塞进 suite 启动。
//     历史: CPUQuota=400% 经此 seam 活 4 天 (拖慢每轮 + 制造假红), 源头默认值 (不传 -p CPUQuota=)
//     正确但 seam 把字面量塞回。覆盖 = 扫描面含 plugin/workflows/ (P5 检测
//     override 字符串内的 CPUQuota=<num>%)。
//     (2026-10-07: 曾承载该默认值的 standalone suite-fix workflow 已删除 —— 扫描面仍含
//      plugin/workflows/，seam 由存活 workflow 承载。)
//
// EVERY hit is classified:
//   definition-point   — the value derives from a QUAY_MAX_* definition point (the line, or the
//                        immediately-preceding declaration block, names QUAY_MAX_TASK_SUBAGENTS /
//                        QUAY_MAX_CONCURRENT_SUITES / QUAY_MAX_OVERSUBSCRIPTION). ALLOWED.
//   declared-exception — the hit line or its attached comment block carries the marker
//                        `concurrency-default-fallback` (a justified default explicitly declared —
//                        the task's必要例外条款: 禁「悄悄写死」,不禁「有理由的默认值」). ALLOWED.
//   violation          — neither. FAILS the gate.
//
// A host-read (os.availableParallelism / nproc / hostParallelism) is NOT a literal and never hits;
// a config-table default (DEFAULT_BANDS = { go: 5, wait: 2, … }) is NOT a concurrency-value
// position (no cap/slot/… key) and never hits.
//
// MODES:
//   --scan [--root]    measure mode — print every hit with its classification (定义点/已声明例外/违规)
//                      + a 0-violation summary. Exit 0 (measure, never a gate).
//   --gate [--root]    static-tier gate (wired into scripts/test.sh run_static_checks). Exit 1 iff
//                      any hit is a violation (an undeclared concurrency literal).
//   --json             machine-readable output (the ## Contract measure reads `violations`).
//
// Exit: 0 = PASS / measure; 1 = gate FAIL (>=1 violation); 2 = usage/env error.

// ── path→content 判定形状 (tasks/gap-b5-input-shape-path-to-content) ─────────────────────────────
// 判定逻辑 = 对【字符串/内容】的纯函数（scanText(rel, src)——逐条命中分类 定义点/已声明例外/违规,
// stringLiteralSpans / scanSystemdRunLimitCpuQuota）, I/O（scanSurface/scanFiles 走树读文件）
// 留在薄 main() CLI 壳。纯函数测试零 spawn 零 mkdtemp 直调
// （plugin/test/concurrency-literal-check.test.mjs）。

import fs from "node:fs";
import path from "node:path";
import { buildNonCodeMask, isRegexStart } from "./checker-lib.ts";
// flagVal (below) is now a one-line arity adapter over the shared `flagValue`; its algorithm was one
// of the ~73 hand-written copies of the indexOf+next-arg idiom in plugin/scripts
// (.quay/routine-findings.jsonl finding `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { helpExit, isDirectEntry, flagValue, resolveRoot } from "./gate-script-base.ts";
import { scanRoots } from "./fs-walk.ts";

/** Concurrency keywords carried by a value's identifier (P1) or key (P4) — the structural signal
 *  that a numeric literal is a CONCURRENCY value (并发数/槽数/lane 数), as opposed to a timeout,
 *  a section-chars floor, a multiplier, or a failure-count limit. `cap` is included because every
 *  concurrency cap in this codebase is a `*_CAP*` name (FIXED_DISPATCH_CAP / FIXED_EFFECTIVE_CAP /
 *  CONCURRENCY_CAP_DEFAULT / SLOT_STATUS_CAP_DEFAULT); the declared-exception mechanism absorbs the
 *  one non-concurrency `*_CAP*` (RED_BACKLOG_CAP_DEFAULT — a recommendation cap, not a concurrency
 *  value, but a `cap` name must still be declared to stay honest). */
export const CONCURRENCY_KEYWORD_RE =
  /(?:^|_)(cap|slot|lane|concurr|subagent|parallel|quota|oversub|dispatch)(?:s|es|ing|ency|ies)?(?:$|_)/i;

/** P1 — a module-level concurrency-constant definition `(export) const NAME = <num>`. */
export const CONST_DEF_RE =
  /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(\d+(?:\.\d+)?)/g;

/** P2 — a CLI concurrency-flag literal (`--cap 5`, `--lane-count 8`, `--max-concurrent 4`). */
export const CLI_FLAG_RE =
  /--(cap|lane-count|slots?|concurrency|serial-concurrency|test-concurrency|suite-concurrency|max-concurrent|max-task-subagents|max-concurrent-suites)(?:[= ])(\d+(?:\.\d+)?)/g;

/** P3 — a CPU-quota literal (`CPUQuota=400%`, `cpuQuota: "400%"`, `limits.cpuQuota = "400%"`). */
export const CPU_QUOTA_RE =
  /(?:CPUQuota\s*=|cpuQuota\s*[:=]\s*["']?)(\d+(?:\.\d+)?)\s*%?["']?/g;

/** P4 — an object-literal concurrency key (`cap: 5`, `laneCount: 4`, `concurrency: 2`). */
export const OBJECT_KEY_RE =
  /(cap|slots?|laneCount|lane|concurrency)\s*:\s*(\d+(?:\.\d+)?)/g;

/** P5 — the systemd-run-limit override-string signature: a sibling resource key (MemoryMax= / TasksMax=)
 *  present in the same string literal that carries `CPUQuota=<num>%`. This is the positional signal
 *  that the string is a RUNTIME value passed to systemd-run (the QUAY_TEST_SYSTEMD_RUN_LIMITS seam),
 *  not a doc mention — a doc string that merely spells `CPUQuota=400%` does not carry `MemoryMax=`/
 *  `TasksMax=`. */
export const SYSTEMD_RUN_LIMIT_KEY_RE = /(?:MemoryMax|TasksMax)\s*=/;
export const SYSTEMD_CPU_QUOTA_IN_STRING_RE = /CPUQuota\s*=\s*(\d+(?:\.\d+)?)\s*%/g;

/** 复用 checker-lib buildNonCodeMask 的线性状态机 (同样的注释/正则消歧), 但额外记录【真实字符串字面量】
 *  的跨度。buildNonCodeMask 把字符串和注释都标成非代码, 无法单独挑出字符串 —— 而 P5 需要区分
 *  「代码里的字符串字面量」(值是运行期真值) 与「注释里的拼写」(应忽略)。isShell=true 时额外跳过
 *  `#` 行注释 (与 buildMask 相同的字首 `#` 判据, 防 shell 注释里的引号开启伪字符串跨度)。 */
export function stringLiteralSpans(src: string, isShell: boolean): Array<{ start: number; end: number; body: string }> {
  const spans: Array<{ start: number; end: number; body: string }> = [];
  let i = 0;
  const n = src.length;
  let prevCode = ""; // last CODE character emitted (for regex-literal disambiguation)
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      if (i < n) i += 2;
      continue;
    }
    if (isShell && c === "#") {
      const prev = i === 0 ? "\n" : src[i - 1];
      if (/\s/.test(prev)) { while (i < n && src[i] !== "\n") i++; continue; }
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      const start = i;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      spans.push({ start, end: i, body: src.slice(start + 1, i - 1) });
      prevCode = q; // the closing quote is what a following `/` sees (division)
      continue;
    }
    if (c === "/" && isRegexStart(prevCode, src, i)) {
      i++;
      let inClass = false;
      while (i < n) {
        const cc = src[i];
        if (cc === "\\") { i += 2; continue; }
        if (cc === "[") inClass = true;
        else if (cc === "]") inClass = false;
        else if (cc === "/" && !inClass) { i++; break; }
        else if (cc === "\n") { i++; break; } // unterminated regex — bail out of the literal
        i++;
      }
      continue;
    }
    prevCode = c;
    i++;
  }
  return spans;
}

/** P5 检测: 在 systemd-run-limit override 字符串内找 `CPUQuota=<num>%` 字面量。返回命中在源码里的
 *  绝对 index 与原文 (供 scanText 逐条分类为 定义点/已声明例外/违规)。 */
export function scanSystemdRunLimitCpuQuota(src: string, isShell: boolean): Array<{ index: number; raw: string }> {
  const out: Array<{ index: number; raw: string }> = [];
  for (const sp of stringLiteralSpans(src, isShell)) {
    if (!SYSTEMD_RUN_LIMIT_KEY_RE.test(sp.body)) continue; // 非 systemd-run override 串 → 忽略
    SYSTEMD_CPU_QUOTA_IN_STRING_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SYSTEMD_CPU_QUOTA_IN_STRING_RE.exec(sp.body)) !== null) {
      out.push({ index: sp.start + 1 + m.index, raw: m[0] });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The single-source definition points (the QUAY_MAX_* env vars — 人 2026-08-13 框架的旋钮 ①②③).
 *  A hit is a definition point iff its line (or attached declaration block) READS one of these env
 *  vars (the value derives from the definition point — not merely names it). */
export const DEFINITION_POINT_NAMES = [
  "QUAY_MAX_TASK_SUBAGENTS",
  "QUAY_MAX_CONCURRENT_SUITES",
  "QUAY_MAX_OVERSUBSCRIPTION",
];

/** The env-read expression for a definition point (builds the alternation from the names above). */
export function definitionPointReadRe(): RegExp {
  const alt = DEFINITION_POINT_NAMES.join("|");
  return new RegExp(`(?:process\\.env|os\\.environ|Deno\\.env|env\\.)\\.?\\s*(?:${alt})`);
}

/** The explicit declared-exception marker token (task body: `/* concurrency-default-fallback: … *​/`). */
export const FALLBACK_MARKER = "concurrency-default-fallback";

export type HitKind = "definition-point" | "declared-exception" | "violation";

export interface ConcurrencyHit {
  file: string;
  line: number;
  text: string;
  kind: HitKind;
  pattern: "P1" | "P2" | "P3" | "P4" | "P5";
}

/** A code/non-code mask for ONE file. checker-lib's buildNonCodeMask covers JS/TS (line comments,
 *  block comments, strings, template literals, regex literals); SHELL files additionally use `#`
 *  line comments. We pre-blank `#` comment content (from a word-start `#` — start-of-line or
 *  preceded by whitespace, so `${#var}`/`#!`/mid-word `#` are left alone — to end of line) BEFORE
 *  buildNonCodeMask runs, so backticks/quotes inside a shell comment can never open a bogus
 *  JS-style template span that leaks across comment lines (the process-budget.sh false-positive
 *  family). The `#` mask is then re-applied to the original positions. */
export function buildMask(src: string, isShell: boolean): Uint8Array {
  const mask = buildNonCodeMask(src);
  if (!isShell) return mask;
  const spaced = src.split("");
  for (let i = 0; i < spaced.length; i++) {
    if (spaced[i] !== "#") continue;
    const prev = i === 0 ? "\n" : spaced[i - 1];
    if (!/\s/.test(prev)) continue; // ${#var}, #!, mid-word — not a comment start
    for (let j = i; j < spaced.length && spaced[j] !== "\n"; j++) spaced[j] = " ";
  }
  const masked = buildNonCodeMask(spaced.join(""));
  for (let i = 0; i < masked.length; i++) mask[i] = masked[i];
  // Re-apply the `#` comment mask (the blanked comment content was CODE to buildNonCodeMask).
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "#") continue;
    const prev = i === 0 ? "\n" : src[i - 1];
    if (!/\s/.test(prev)) continue;
    let j = i;
    while (j < src.length && src[j] !== "\n") { mask[j] = 1; j++; }
    if (j < src.length) mask[j] = 1;
  }
  return mask;
}

/** Is the whole text between `i` and `j` inside non-code (comment/string/regex)? Used to reject a
 *  match that merely SPELLS a concurrency literal (e.g. a doc string `"--cap 5"` or a shell `#` line). */
function isMasked(mask: Uint8Array, i: number, j: number): boolean {
  for (let k = i; k < j && k < mask.length; k++) if (mask[k] === 0) return false;
  return true;
}

/** The scan surface — the executable layer where concurrency values are DEFINED and PASSED.
 *  Explicitly enumerated per root (可 grep 的枚举清单, 非一个 glob 糊过去 — AC1):
 *    plugin/scripts/*.{ts,sh}   — 循环执行核 (ready-pool-check / slot-refill / resource-gate …)
 *    scripts/*.{ts,sh}          — 测试入口 (test.sh) + 编排
 *    plugin/workflows/*.js      — workflow 脚本唯一份 (fan-in-execute.js 等 — QUAY_TEST_SYSTEMD_RUN_LIMITS
 *                                 seam; .claude/workflows/ 双副本已 archive, 见 gap-ac166-second-copy-retirement)
 *  Docs (orchestration/*.md) are excluded — they quote old commands as historical evidence (masking
 *  non-code does not apply to markdown prose); test dirs are excluded — tests legitimately inject
 *  numeric fixtures. */
const SCAN_ROOTS: Array<{ dir: string; rel: string; ext: RegExp }> = [
  { dir: "plugin/scripts", rel: "plugin/scripts", ext: /\.(ts|sh)$/ },
  { dir: "scripts", rel: "scripts", ext: /\.(ts|sh)$/ },
  { dir: "plugin/workflows", rel: "plugin/workflows", ext: /\.js$/ },
];

/** Directories pruned while walking a scan root (traversal lives in fs-walk.ts#scanRoots). */
const SURFACE_SKIP_DIRS = new Set(["node_modules", ".git", "test", "checker-mutation-cases"]);

export function scanSurface(root: string): string[] {
  return scanRoots(root, SCAN_ROOTS, SURFACE_SKIP_DIRS);
}

/** The marker token appears in the hit line or in the attached declaration comment block (the
 *  lines immediately above the hit, all comment/blank — a marker glued to a DIFFERENT declaration
 *  several lines up must not authorize this hit). */
export function carriesFallbackMarker(lineTexts: string[]): boolean {
  return lineTexts.some((l) => l.includes(FALLBACK_MARKER));
}

/** Collect the line texts to search for the marker: the hit line plus the contiguous comment block
 *  above it (skipping blank lines; a CODE line above the block ends the block). */
export function declarationBlockLines(srcLines: string[], hitLineIdx: number): string[] {
  const block: string[] = [];
  block.push(srcLines[hitLineIdx]);
  for (let i = hitLineIdx - 1; i >= 0; i--) {
    const t = srcLines[i].trim();
    if (t === "") continue; // blank — keep looking up (a blank separates block comments)
    if (/^(\/\/|\*|#)/.test(t)) { block.push(srcLines[i]); continue; }
    break; // a code line — the attached comment block ended
  }
  return block;
}

/** A hit is a definition point iff its line or attached block actually READS the QUAY_MAX_* env var
 *  (the `process.env.QUAY_MAX_…` READ expression — a mere name mention in a comment that DECLARES the
 *  future single source is NOT a definition; it is a declared exception). */
export function isDefinitionPoint(block: string[]): boolean {
  return block.some((l) => definitionPointReadRe().test(l));
}

/** Run every pattern over one file's source at CODE positions only. Returns hits (classification
 *  resolved per-hit against the source lines). */
export function scanText(rel: string, src: string): ConcurrencyHit[] {
  const mask = buildMask(src, rel.endsWith(".sh"));
  const lines = src.split("\n");
  const hits: ConcurrencyHit[] = [];
  /** 逐条命中分类: 定义点 (line/attached block READS a QUAY_MAX_* env) / 已声明例外 (marker) / 违规。 */
  const classify = (lineIdx: number): HitKind => {
    const block = declarationBlockLines(lines, lineIdx);
    if (isDefinitionPoint(block)) return "definition-point";
    if (carriesFallbackMarker(block)) return "declared-exception";
    return "violation";
  };
  const patterns: Array<{ id: "P1" | "P2" | "P3" | "P4"; re: RegExp; domainCheck?: (m: RegExpExecArray) => boolean }> = [
    { id: "P1", re: CONST_DEF_RE, domainCheck: (m) => CONCURRENCY_KEYWORD_RE.test(m[1]) },
    { id: "P2", re: CLI_FLAG_RE },
    { id: "P3", re: CPU_QUOTA_RE },
    { id: "P4", re: OBJECT_KEY_RE },
  ];
  for (const p of patterns) {
    const re = new RegExp(p.re.source, p.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (isMasked(mask, m.index, m.index + m[0].length)) { if (m[0].length === 0) re.lastIndex++; continue; }
      if (p.domainCheck && !p.domainCheck(m)) { if (m[0].length === 0) re.lastIndex++; continue; }
      const lineIdx = src.slice(0, m.index).split("\n").length - 1;
      hits.push({ file: rel, line: lineIdx + 1, text: (lines[lineIdx] ?? "").trim().slice(0, 120), kind: classify(lineIdx), pattern: p.id });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  // P5 — systemd-run-limit override 字符串内的 CPU-quota 字面量 (历史漏检形, 见头注释 SEAM ENUMERATION)。
  for (const m of scanSystemdRunLimitCpuQuota(src, rel.endsWith(".sh"))) {
    const lineIdx = src.slice(0, m.index).split("\n").length - 1;
    hits.push({ file: rel, line: lineIdx + 1, text: (lines[lineIdx] ?? "").trim().slice(0, 120), kind: classify(lineIdx), pattern: "P5" });
  }
  return hits.sort((a, b) => a.line - b.line);
}

/** Scan a set of files on disk (repo-relative). */
export function scanFiles(files: string[], root: string): ConcurrencyHit[] {
  const all: ConcurrencyHit[] = [];
  for (const rel of files) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    all.push(...scanText(rel, fs.readFileSync(abs, "utf8")));
  }
  return all.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────

const usage = `concurrency-literal-check.ts — 并发数值字面量只允许在唯一定义点
(gap-concurrency-literal-only-at-definition-points)

Usage:
  node --experimental-strip-types concurrency-literal-check.ts --scan [--root <dir>] [--json]
      measure mode — print every hit with its classification (definition-point / declared-exception /
      violation). Exit 0 always (measure).
  node --experimental-strip-types concurrency-literal-check.ts --gate [--root <dir>] [--json]
      gate mode — scan the executable surface (plugin/scripts + scripts + plugin/workflows); exit 1
      iff any concurrency numeric literal is NOT at a QUAY_MAX_* definition
      point AND NOT marked 'concurrency-default-fallback' (an undeclared literal = violation).

Exit codes: 0 PASS/measure · 1 gate FAIL (>=1 violation) · 2 usage/env error.`;

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const asJson = args.includes("--json");
  const root = resolveRoot(flagValue(args, "--root"));
  const surface = scanSurface(root);
  const hits = scanFiles(surface, root);

  if (args.includes("--scan")) {
    if (asJson) {
      console.log(JSON.stringify({
        mode: "scan",
        surface,
        hits: hits.map((h) => ({ file: h.file, line: h.line, pattern: h.pattern, kind: h.kind, text: h.text })),
        violations: hits.filter((h) => h.kind === "violation").length,
      }, null, 2));
    } else {
      console.log(`concurrency-literal-check --scan — ${surface.length} file(s) scanned`);
      for (const h of hits) {
        const tag = h.kind === "violation" ? "违规" : h.kind === "definition-point" ? "定义点" : "已声明例外";
        console.log(`  [${tag}] ${h.file}:${h.line} (${h.pattern}) ${h.text}`);
      }
      const violations = hits.filter((h) => h.kind === "violation");
      console.log(`hits: ${hits.length}  violations: ${violations.length}`);
    }
    return 0;
  }

  if (args.includes("--gate")) {
    const violations = hits.filter((h) => h.kind === "violation");
    if (asJson) {
      console.log(JSON.stringify({
        mode: "gate",
        ok: violations.length === 0,
        surface,
        hits: hits.map((h) => ({ file: h.file, line: h.line, pattern: h.pattern, kind: h.kind, text: h.text })),
        violations: violations.map((h) => ({ file: h.file, line: h.line, pattern: h.pattern, text: h.text })),
      }, null, 2));
    } else {
      console.log(`concurrency-literal-check --gate — ${surface.length} file(s) scanned, ${hits.length} concurrency literal(s)`);
      for (const h of hits) {
        const tag = h.kind === "violation" ? "违规" : h.kind === "definition-point" ? "定义点" : "已声明例外";
        console.log(`  [${tag}] ${h.file}:${h.line} (${h.pattern}) ${h.text}`);
      }
      if (violations.length === 0) {
        console.log("PASS — every concurrency literal is at a QUAY_MAX_* definition point or a declared fallback (0 violations)");
      } else {
        console.log(`FAIL — ${violations.length} undeclared concurrency literal(s) (not at a QUAY_MAX_* definition point, no 'concurrency-default-fallback' marker):`);
        for (const v of violations) console.log(`  - ${v.file}:${v.line} (${v.pattern}) ${v.text}`);
      }
    }
    return violations.length === 0 ? 0 : 1;
  }

  console.error(usage);
  return 2;
}

if (isDirectEntry(import.meta, undefined, "concurrency-literal-check")) {
  process.exit(main(process.argv));
}
