#!/usr/bin/env node
// precommit-guard.ts — 写入那一刻的守卫：① 文档类检查（AC51 断言面拆分）。
//
// ② 拒绝「轮 running 且触及断言面」的写入（覆盖全部写入者）已退役（AC64 2026-08-14，
// gap-ac64-precommit-guard-clause2-retire）：它保护的危险随 AC42 结构性消失——per-task suite
// 跑在各自 worktree、读 worktree 的文件副本，改共享检出的 develop 完全不影响正在跑的 worktree
// suite ⇒ 不是「参照系失效」，是「输入不存在」。退役条款 + 三条立条教训（merge 锁必须共享机制，
// 不得是「各层记得调的约定」）落点 → orchestration/archive/AC58-retired-clauses.md#R27。
// 断言面解析（resolveAssertionSurface）保留：full-suite-runner.ts 的 mid-round-edit 检测
// 仍复用它（同一 judged-object 注册表单源，CLAUDE.md 硬规则 1），但守卫本身不再读 state / 断言面。
//
// MERGE-PATH COVERAGE (gap-precommit-guard-merge-bypass, 2026-08-13): `git merge --no-ff` does NOT
// fire the pre-commit hook (git runs pre-commit only from git-commit(1)) — so assertion-surface files
// landed via a merge bypassed the guard. The pre-merge-commit hook (--install-hook writes BOTH
// pre-commit and pre-merge-commit) covers the --no-ff merge write path for ① (doc checks):
// git-merge(1) runs pre-merge-commit for a `--no-ff` merge and can abort it by exiting non-zero.
// Fast-forward merges create no merge commit, so pre-merge-commit does not fire for them.
// AC62+ (SPEC-fan-in-ff-merge-lock-2026-08-14): the fan-in convention is now **ff-only** —
// `git merge --ff-only` creates no merge commit, so on the fan-in path NEITHER pre-commit (commit-only)
// NOR pre-merge-commit (--no-ff-only) fires ⇒ the DOC check has NO hook trigger there. AC63: the A6
// 无锁段 step 3 EXPLICITLY runs `bash scripts/test.sh --static-checks-doc` BEFORE the ff (not
// hook-dependent — the subagent must run it by hand). The two doc-check runs are DELIBERATELY not
// deduplicated: the first (this guard's pre-commit) covers only the author's own changes; the second
// (step 3) covers content AFTER merging develop — dedup would miss doc conflicts introduced by the
// merge (human-confirmed 2026-08-14).
//
// AC51 断言面拆分（gap-ac51-assertion-surface-split, SPEC §13）：文档类检查（strategic-doc-
// staleness / drive-contract / threshold-scope / state-worded-clause / red-on-omission /
// tick-core-static / instrument-failure）从全量套件移出，落到本守卫（提交那一刻）跑——
// 见 runDocChecks()：shell 到 `bash scripts/test.sh --static-checks-doc`（run_doc_checks 单源）。
//
// 判定（AC64 起无 state 读取——② 退役后不再有轮窗口门，fail-loud 一并退役）：
//   A. 文档类检查：失败 ⇒ 拒提交（reason=doc-check-failed），输出含失败检查器的文件+行号
//      （= 补救位置，SPEC §13.4）。
//   state 文件 / 断言面 / --allow-dirty-round 覆盖全部随 ② 退役——见 archive#R27。
//
// 使用（本仓库路径）：
//   node --no-warnings --experimental-strip-types plugin/scripts/precommit-guard.ts [--root <dir>]
//       [--install-hook] [--uninstall-hook] [--json] [--merge] [--help]
//   --install-hook     把 <git-dir>/hooks/pre-commit 与 <git-dir>/hooks/pre-merge-commit 写成调用
//                      本守卫的 shim（幂等；pre-merge-commit 带 --merge）——commit 与 --no-ff merge
//                      两个写路径同覆盖 ①（文档类检查）
//   --uninstall-hook   移除上述两个钩子中的本守卫 shim（幂等）
//   --json             机器可读输出（{verdict, reason, message, docCheckOutput, merge}）
//   --merge            本轮判定在 merge 上下文（pre-merge-commit 钩子传此 flag；文档检查行为与
//                      commit 完全一致，仅输出标注 merge 上下文）
//
// 退出码：0 = 放行；1 = 拒（doc-check-failed）；2 = 用法/环境错。
//
// <!-- enforcement: plugin/scripts/precommit-guard.ts -->

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 常量 ─────────────────────────────────────────────────────────────────────────────────────────────

/** 断言面注册表（A0b③ 生成；full-suite-runner 的 mid-round-edit 检测经 resolveAssertionSurface 只读它）。 */
const REGISTRY_REL = path.join("plugin", "scripts", "judged-object-registry.json");
/** 钩子 shim 里的固定指纹（--uninstall-hook 据此识别、移除本守卫的 shim）。 */
const HOOK_FINGERPRINT = "precommit-guard.ts";

export interface Verdict {
  verdict: "allow" | "reject" | "error";
  reason: string;
  message: string;
  /** AC51: doc-class check failure output (present when reason === "doc-check-failed"). */
  docCheckOutput: string | null;
  /** pre-merge-commit 上下文（钩子传 --merge；文档检查行为与 commit 一致，仅标注）。 */
  merge: boolean;
}

// ── 小工具 ───────────────────────────────────────────────────────────────────────────────────────────

function repoRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

function gitDir(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error("not a git repository (git rev-parse --git-dir failed)");
  }
}

/** 全 tracked 文件列表（resolveAssertionSurface 的 fail-closed 回退面）。 */
export function allTrackedFiles(root: string): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!out) return [];
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function escapeRegExp(s: string): string {
  const SPECIAL = new Set([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);
  let out = "";
  for (const ch of String(s)) out += SPECIAL.has(ch) ? `\\${ch}` : ch;
  return out;
}

/**
 * glob/path 匹配——语义镜像 select-static-checks-for-touches.ts 的 matchesObject
 * （判定对象语义单源，本守卫不另造一套）：globstar（折叠为 `.*`）、单段通配、
 * 字面目录前缀（`docs/proposals/`）、字面文件精确匹配。含通配的 pattern 视作前缀 + 尾通配
 * （形如 `packages/…/test/` 的目录通配按 `^packages/…/test/.*$` 匹配），与 @static-object
 * 标注的语义一致。注意：块注释里不写 `*` 紧跟 `/` 的字面量（会提前闭合注释）。
 */
export function matchesGlob(pattern: string, rel: string): boolean {
  const p = String(pattern).replace(/\\/g, "/");
  const t = String(rel).replace(/\\/g, "/");
  if (!p || !t) return false;
  if (p === "**") return true;
  if (p.startsWith("**/")) {
    const rest = p.slice(3);
    if (rest.includes("*")) {
      return new RegExp(`${rest.split("*").map(escapeRegExp).join(".*")}$`).test(t);
    }
    return t === rest || t.endsWith(`/${rest}`);
  }
  if (p.includes("*")) {
    return new RegExp(`^${p.split("*").map(escapeRegExp).join(".*")}.*$`).test(t);
  }
  if (p.endsWith("/")) return t.startsWith(p);
  return t === p || t.startsWith(`${p}/`);
}

/**
 * scripts/test.sh 的 `@static-object` 标注聚合（判定对象由被约束者声明，机械派生、不手列）。
 * 无 scripts/test.sh（如临时测试仓）⇒ 返回 []，fallback 退回 tasks/** + plugin/loop/** 两组。
 */
export function staticObjectPatterns(root: string): string[] {
  const testSh = path.join(root, "scripts", "test.sh");
  if (!fs.existsSync(testSh)) return [];
  const src = fs.readFileSync(testSh, "utf8");
  const patterns = new Set<string>();
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*#\s*@static-object\s+(.+)$/);
    if (m) {
      for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) patterns.add(tok);
    }
  }
  return [...patterns];
}

// ── AC51 文档类（pre-commit 检查）───────────────────────────────────────────────────────────────────

/**
 * Doc-class object patterns — the union of `# @static-object` annotations in scripts/test.sh's
 * run_doc_checks() body (AC51 断言面拆分, SPEC §13.2 — the doc-consistency checkers moved to
 * pre-commit). A missing run_doc_checks() / missing test.sh ⇒ [] (nothing excluded — conservative).
 * Retained for resolveAssertionSurface (full-suite-runner's mid-round-edit detection reuses the
 * same doc-class exclusion the guard used to apply).
 */
export function docClassPatterns(root: string): string[] {
  const testSh = path.join(root, "scripts", "test.sh");
  if (!fs.existsSync(testSh)) return [];
  const src = fs.readFileSync(testSh, "utf8");
  const lines = src.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^run_doc_checks\(\)\s*\{/.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\}/.test(lines[i])) { end = i; break; }
  }
  const patterns = new Set<string>();
  for (const line of lines.slice(start + 1, end)) {
    const m = line.match(/^\s*#\s*@static-object\s+(.+)$/);
    if (m) for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) patterns.add(tok);
  }
  return [...patterns];
}

/**
 * The concrete DOC files excluded from the assertion surface: tracked files that are (a) markdown
 * documents (`.md`, incl. CLAUDE.md) AND (b) match a doc-class object pattern. Retained for
 * resolveAssertionSurface (the runner's mid-round-edit surface excludes doc files the same way).
 */
export function docClassFiles(root: string): Set<string> {
  const patterns = docClassPatterns(root);
  if (patterns.length === 0) return new Set();
  const tracked = allTrackedFiles(root);
  const docFiles = new Set<string>();
  for (const f of tracked) {
    if (!/\.md$/i.test(f)) continue;
    if (patterns.some((p) => matchesGlob(p, f))) docFiles.add(f);
  }
  return docFiles;
}

/** Run the doc-class static checks at the pre-commit moment (AC51). See the header comment. */
export interface DocCheckResult {
  ok: boolean;
  output: string;
}

export function runDocChecks(root: string): DocCheckResult {
  const testSh = path.join(root, "scripts", "test.sh");
  if (!fs.existsSync(testSh)) return { ok: true, output: "" };
  // AC51 portability: the doc-check gate is only ACTIVE where the split is actually implemented —
  // the workspace's scripts/test.sh must declare the doc-check surface (run_doc_checks + the
  // `--static-checks-doc` branch). A third-party workspace with a plain test.sh must NOT start
  // rejecting every commit (its test.sh would fall through to an unknown-arg error).
  const src = fs.readFileSync(testSh, "utf8");
  if (!/^run_doc_checks\(\)\s*\{/m.test(src) || !src.includes("--static-checks-doc")) {
    return { ok: true, output: "" };
  }
  try {
    const res = spawnSync("bash", [testSh, "--static-checks-doc"], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    if (res.status !== 0) return { ok: false, output };
    return { ok: true, output };
  } catch (e) {
    return { ok: false, output: String((e as Error).message) };
  }
}

// ── 断言面集合（full-suite-runner 复用；守卫本身不再读它——② 退役）─────────────────────────────────

export interface RegistryShape {
  version?: number;
  patterns?: string[];
  [k: string]: unknown;
}

/**
 * 断言面集合 = 实证闯祸类 ∪ @static-object 聚合 ∪ 注册表派生面（外层裁定 B 修正收窄 seed patterns）。
 * AC64 起本守卫不再消费它（② 退役）；full-suite-runner.ts 的 mid-round-edit 检测仍复用它——
 * 同一 judged-object 注册表单源，缺失/空回退「实证闯祸类 + 判定对象声明」。
 */
export const FALLBACK_TROUBLE_CLASSES = ["tasks/**", "plugin/loop/**"] as const;

export function resolveAssertionSurface(root: string): {
  mode: "registry" | "fallback-narrowed";
  patterns: string[];
  files: string[];
} {
  const tracked = allTrackedFiles(root);
  const regPath = path.join(root, REGISTRY_REL);
  let patterns: string[] = [];
  if (fs.existsSync(regPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(regPath, "utf8")) as RegistryShape;
      if (Array.isArray(raw.patterns) && raw.patterns.length > 0) {
        patterns = raw.patterns.map(String);
      }
    } catch {
      patterns = []; // 不可解析 ⇒ 回退（fail-closed）
    }
  }
  const docFiles = docClassFiles(root);
  const excludeDoc = (files: string[]): string[] => files.filter((f) => !docFiles.has(f));
  if (patterns.length === 0) {
    const fallback = [...FALLBACK_TROUBLE_CLASSES, ...staticObjectPatterns(root)];
    const files = excludeDoc(tracked.filter((f) => fallback.some((p) => matchesGlob(p, f))));
    return { mode: "fallback-narrowed", patterns: [], files };
  }
  const files = excludeDoc(tracked.filter((f) => patterns.some((p) => matchesGlob(p, f))));
  return { mode: "registry", patterns, files };
}

// ── 主判定 ───────────────────────────────────────────────────────────────────────────────────────────

export function judge(
  root: string,
  opts: { merge?: boolean } = {},
): Verdict {
  // ① 文档类检查（AC51 断言面拆分——文档检查在提交这一刻跑，不进全量套件）。失败 ⇒ 拒。
  //    失败输出含检查器打印的文件+行号 = 补救位置（SPEC §13.4）。
  const docResult = runDocChecks(root);
  if (!docResult.ok) {
    return {
      verdict: "reject",
      reason: "doc-check-failed",
      message:
        "pre-commit 守卫：文档类检查失败（AC51 断言面拆分——文档检查在提交这一刻跑，不再等一轮套件）。\n" +
        "失败检查器的输出含文件+行号（= 补救位置）；修复后重新提交。\n" +
        "─── 文档类检查输出 ───\n" +
        docResult.output,
      docCheckOutput: docResult.output,
      merge: opts.merge === true,
    };
  }

  return {
    verdict: "allow",
    reason: "doc-checks-pass",
    message: "pre-commit 守卫：文档类检查通过（①），放行。",
    docCheckOutput: null,
    merge: opts.merge === true,
  };
}

// ── 钩子安装/卸载 ────────────────────────────────────────────────────────────────────────────────────

function hookShim(root: string): string {
  return [
    "#!/usr/bin/env bash",
    `# ${HOOK_FINGERPRINT} — installed by plugin/scripts/precommit-guard.ts --install-hook`,
    "# pre-commit guard: ① runs the DOC-CLASS checks at commit time (AC51 断言面拆分 — doc checks",
    "# are no longer in the full suite, so editing docs no longer makes a running round red).",
    "# (② rejecting running-round assertion-surface commits was RETIRED under AC64 — see",
    "# orchestration/archive/AC58-retired-clauses.md#R27.)",
    'ROOT="$(git rev-parse --show-toplevel)"',
    `exec node --no-warnings --experimental-strip-types "$ROOT/plugin/scripts/${HOOK_FINGERPRINT}" --root "$ROOT"`,
    "",
  ].join("\n");
}

/**
 * The pre-merge-commit hook shim (merge-path coverage, gap-precommit-guard-merge-bypass). git runs
 * pre-merge-commit for `git merge --no-ff` after carrying out the merge and BEFORE creating the merge
 * commit (pre-commit is NOT fired for merges — git-merge does not go through git-commit's hook path).
 * At that moment the index holds the merged result; the hook runs the SAME doc-check gate (①).
 * AC62: fan-in is ff-only (no merge commit ⇒ pre-merge-commit does not fire there); the A6 无锁段
 * step 3 runs the doc check explicitly (AC63).
 */
export function preMergeCommitShim(root: string): string {
  return [
    "#!/usr/bin/env bash",
    `# ${HOOK_FINGERPRINT} — installed by plugin/scripts/precommit-guard.ts --install-hook`,
    "# pre-merge-commit guard: ① runs the DOC-CLASS checks at merge time (AC51 断言面拆分).",
    "# (② rejecting running-round merges was RETIRED under AC64 — see",
    "# orchestration/archive/AC58-retired-clauses.md#R27.)",
    'ROOT="$(git rev-parse --show-toplevel)"',
    `exec node --no-warnings --experimental-strip-types "$ROOT/plugin/scripts/${HOOK_FINGERPRINT}" --root "$ROOT" --merge`,
    "",
  ].join("\n");
}

export function installHook(root: string): string {
  const gd = gitDir(root);
  const hooksDir = path.join(gd, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  // pre-commit (commit write-path) — the original guard hook (idempotent; refuses unrelated hook).
  const hookPath = path.join(hooksDir, "pre-commit");
  const shim = hookShim(root);
  if (fs.existsSync(hookPath) && !fs.readFileSync(hookPath, "utf8").includes(HOOK_FINGERPRINT)) {
    throw new Error(
      `pre-existing pre-commit hook at ${hookPath} does not carry the ${HOOK_FINGERPRINT} fingerprint; ` +
        "refusing to overwrite. Merge manually.",
    );
  }
  fs.writeFileSync(hookPath, shim, { mode: 0o755 });
  // pre-merge-commit (merge write-path — gap-precommit-guard-merge-bypass): git merge --no-ff does
  // NOT fire pre-commit, so the merge path needs its own hook. Same doc-check gate, --merge context.
  const mergeHookPath = path.join(hooksDir, "pre-merge-commit");
  const mergeShim = preMergeCommitShim(root);
  if (fs.existsSync(mergeHookPath) && !fs.readFileSync(mergeHookPath, "utf8").includes(HOOK_FINGERPRINT)) {
    throw new Error(
      `pre-existing pre-merge-commit hook at ${mergeHookPath} does not carry the ${HOOK_FINGERPRINT} fingerprint; ` +
        "refusing to overwrite. Merge manually.",
    );
  }
  fs.writeFileSync(mergeHookPath, mergeShim, { mode: 0o755 });
  return hookPath;
}

export function uninstallHook(root: string): { removed: boolean; hookPath: string } {
  const gd = gitDir(root);
  const hooksDir = path.join(gd, "hooks");
  let removed = false;
  // Remove BOTH the pre-commit and pre-merge-commit guard shims (idempotent; a hook that does not
  // carry the fingerprint is left untouched — never clobber an unrelated hook).
  for (const name of ["pre-commit", "pre-merge-commit"]) {
    const hookPath = path.join(hooksDir, name);
    if (fs.existsSync(hookPath)) {
      const content = fs.readFileSync(hookPath, "utf8");
      if (content.includes(HOOK_FINGERPRINT)) {
        fs.rmSync(hookPath, { force: true });
        removed = true;
      }
    }
  }
  return { removed, hookPath: path.join(hooksDir, "pre-commit") };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `precommit-guard.ts — 写入那一刻的守卫：① 文档类检查（AC51 断言面拆分）。
② 拒绝「轮 running 且触及断言面」的写入已退役（AC64）→ orchestration/archive/AC58-retired-clauses.md#R27。

用法:
  node --experimental-strip-types plugin/scripts/precommit-guard.ts [--root <dir>]
       [--install-hook] [--uninstall-hook] [--json] [--merge] [--help]

参数:
  --install-hook      把 <git-dir>/hooks/pre-commit 与 <git-dir>/hooks/pre-merge-commit 写成调用
                      本守卫的 shim（幂等；pre-merge-commit 带 --merge）
  --uninstall-hook    移除上述两个钩子中的本守卫 shim（幂等）
  --merge             本轮判定在 merge 上下文（pre-merge-commit 钩子传此 flag；文档检查行为与
                      commit 一致，仅输出标注）
  --json              机器可读输出（{verdict, reason, message, docCheckOutput, merge}）
  --help              本帮助

退出码: 0=放行 1=拒（doc-check-failed） 2=用法/环境错`;

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  let root: string | null = null;
  let json = false;
  let install = false;
  let uninstall = false;
  let mergeContext = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") {
      root = args[++i] ?? null;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--install-hook") {
      install = true;
    } else if (a === "--uninstall-hook") {
      uninstall = true;
    } else if (a === "--merge") {
      mergeContext = true;
    } else {
      console.error(`unknown arg: ${a}\n\n${USAGE}`);
      return 2;
    }
  }
  if (!root) {
    try {
      root = repoRoot(process.cwd());
    } catch {
      root = process.cwd();
    }
  }
  root = path.resolve(root);

  try {
    if (install) {
      const hp = installHook(root);
      console.log(`precommit-guard: installed pre-commit hook at ${hp}`);
      return 0;
    }
    if (uninstall) {
      const { removed, hookPath } = uninstallHook(root);
      console.log(removed ? `precommit-guard: removed hook at ${hookPath}` : `precommit-guard: no guard hook at ${hookPath}`);
      return 0;
    }
  } catch (e) {
    console.error(`precommit-guard: ${(e as Error).message}`);
    return 2;
  }

  let verdict: Verdict;
  try {
    verdict = judge(root, { merge: mergeContext });
  } catch (e) {
    console.error(`precommit-guard: internal error: ${(e as Error).message}`);
    return 2;
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          verdict: verdict.verdict,
          reason: verdict.reason,
          message: verdict.message,
          docCheckOutput: verdict.docCheckOutput,
          merge: verdict.merge,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(verdict.message);
  }
  return verdict.verdict === "reject" ? 1 : 0;
}

/** 直跑判定（import 测试时不执行 main）：realpath(process.argv[1]) === 本文件自身。 */
function isDirectEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // Bundling-safe basename check: under esbuild import.meta.url is the BUNDLE path for every
    // inlined module, so a realpath comparison would fire this module's CLI when it is inlined
    // into another entry (verified: ready-pool-check.js ran precommit-guard's main). Compare the
    // invoked file's basename against THIS module's own basename instead.
    return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === "precommit-guard";
  } catch {
    return false;
  }
}

if (isDirectEntry()) {
  process.exit(main());
}

export { repoRoot, gitDir, hookShim };
