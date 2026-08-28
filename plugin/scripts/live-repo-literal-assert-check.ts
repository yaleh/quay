#!/usr/bin/env node
// live-repo-literal-assert-check.ts — gap-tests-assert-live-repo-state-break-idempotency:
// the mechanized criterion "a test that runs git against the LIVE repo root AND asserts a LITERAL
// number against the git output violates idempotency" (cwd=REPO_ROOT + git + 字面断言 ⇒ 违规).
//
// The idempotency class: a test that reads MUTABLE live-repo state (the shared checkout's own git
// history) and hard-codes the observed value as an assertion literal DRIFTS as the repo grows —
// the same test run twice against a mutating live repo gives different results. The task's
// measured specimen was mechanism-vitality-check.test.mjs:108 `callCountAll === 47` (a literal
// that LOOKED like a live-repo count and would drift if it were one).
//
// What is NOT a violation (the hermetic / tolerant patterns the repo already uses, 22+ tests):
//   - a git-init TEMP repo (mkdtemp/os.tmpdir) — hermetic, no live-repo read;
//   - a RELATIVE assertion on live repo output (before/after diff, shape match /^\d+$/, exit code);
//   - a literal NUMBER that is a SYNTHETIC FIXTURE injected as input (mechanism-vitality-check:108
//     after the AC1 fix) — the assertion is relative to the fixture variable, not to live output.
// The BAD shape is specifically: spawn git bound to the repo root, read its stdout, and assert a
// bare numeric literal against that read (or against a variable derived from it).
//
// RULE (per glob-covered test file): VIOLATION iff the file
//   (A) spawns `git` with its working directory bound to the LIVE repo root — `cwd: REPO_ROOT`
//       (or `repoRoot`/`repo_root`) in the spawn options, or `["-C", REPO_ROOT]` / `-C REPO_ROOT`
//       in the args — AND
//   (B) asserts a bare numeric literal against that git output — `assert.equal(<stdout-read>, 47)`
//       (either order), `assert.strictEqual`, `assert.deepEqual`, where the other argument is
//       (i) a `.stdout` member read belonging to a live-repo git call, or
//       (ii) a variable assigned from such a read.
//
// Detection is CODE-POSITION based (checker-lib buildNonCodeMask) — a comment/string/regex literal
// that merely mentions the pattern never reports (CLAUDE.md hard rule 2, 按位置不按关键词).
//
// Usage:
//   node live-repo-literal-assert-check.ts [<workspace-root>] [--json] [--selftest] [--files <rel> ...]
// Exit codes: 0 = PASS (no violation); 1 = >=1 violation; 2 = usage/environment error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNonCodeMask } from "./checker-lib.ts";
import { readFileSafe } from "./gate-script-base.ts";
import { canonicalTestFiles } from "./test-framework-policy-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Identifier spellings the repo uses for the LIVE repo root (the task's named `REPO_ROOT` and its
 *  case variants). A bare `root`/`repo`/`dir` is deliberately NOT included — those are overwhelmingly
 *  temp-dir variables in hermetic fixtures, and including them would false-positive.
 *  Deliberately anchor-free (used as an EMBEDDED alternation inside larger regexes, e.g.
 *  `cwd\s*:\s*(?:REPO_ROOT|repoRoot|repo_root)` — `^…$` anchors would wrongly pin the match to the
 *  whole string). */
const ROOT_CONST_SRC = "(?:REPO_ROOT|repoRoot|repo_root)";

/** Git-invocation entry points we recognize. */
const GIT_CALL_PREFIXES = ["spawnSync(", "execFileSync(", "spawn(", "execSync("];

interface GitCall {
  /** Absolute index of the invocation start (`spawnSync(` …). */
  start: number;
  /** Absolute index one past the matching close paren of the invocation. */
  end: number;
  /** True iff the invocation result is read as `.stdout` directly at the call site (`.stdout…` chain). */
  stdoutRead: boolean;
  /** The variable the whole call result is assigned to (`const r = spawnSync("git", …)` → "r"),
   *  so a later `r.stdout` read is recognized as live-repo git output. null if not assigned. */
  resultVar: string | null;
  /** The full expression text of the invocation (for reporting). */
  expr: string;
}

interface Violation {
  rel: string;
  line: number;
  snippet: string;
}

/** Is `i` a CODE position (not inside a comment/string/regex literal)? */
function atCode(mask: Uint8Array, i: number): boolean {
  return i >= 0 && i < mask.length && mask[i] === 0;
}

/**
 * From the absolute index of an invocation's opening paren, return the index one past its
 * MATCHING close paren, respecting nested parens/brackets/braces AND string/template/comment
 * literals (so a `)` inside a string or a nested call cannot prematurely close it).
 * Returns -1 if unbalanced to EOF.
 */
export function findMatchingClose(src: string, openIdx: number): number {
  const mask = buildNonCodeMask(src);
  let depth = 0;
  let i = openIdx;
  const n = src.length;
  while (i < n) {
    if (mask[i] === 1) { i++; continue; }
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

/**
 * Scan a test file's source for git invocations whose working directory is bound to the LIVE repo
 * root. Returns the matched calls with their stdout-read flag.
 */
export function findLiveRepoGitCalls(src: string): GitCall[] {
  const mask = buildNonCodeMask(src);
  const out: GitCall[] = [];
  for (let i = 0; i < src.length; i++) {
    if (mask[i] !== 0) continue;
    const prefix = GIT_CALL_PREFIXES.find((p) => src.startsWith(p, i));
    if (!prefix) continue;
    // First argument must be the git command: "git" (argv form) or "git ..." (string form).
    const after = src.slice(i + prefix.length).replace(/^\s*/, "");
    const isGit = /^["']git["']\s*[,)]/.test(after) || /^["']git[\s'"]/.test(after);
    if (!isGit) continue;
    const openParen = i + prefix.length - 1; // index of '('
    const close = findMatchingClose(src, openParen);
    if (close === -1) continue;
    const callText = src.slice(i, close);
    // Live-repo binding: cwd: REPO_ROOT in options, or -C REPO_ROOT in args.
    const boundToRepoRoot =
      new RegExp(`cwd\\s*:\\s*${ROOT_CONST_SRC}`).test(callText) ||
      new RegExp(`["'-]C["']?\\s*,?\\s*${ROOT_CONST_SRC}`).test(callText);
    if (!boundToRepoRoot) continue;
    // stdout read: `.stdout` appears at a code position immediately after the call (or after a
    // member chain of the call). We check the code positions right after the close paren for a
    // `.stdout` member access (possibly followed by more members like `.trim()`).
    let stdoutRead = false;
    let j = close;
    while (j < src.length && /\s/.test(src[j])) j++;
    // The chain starts with `.` (e.g. `.stdout`, `.stdout.trim()`).
    if (j < src.length && src[j] === ".") {
      const chainEnd = findChainEnd(src, j, mask);
      const chain = src.slice(j, chainEnd);
      stdoutRead = /\.stdout\b/.test(chain);
    }
    // Result variable: `const r = <gitcall>` (or let/var) — the whole call result is bound to a
    // name, so a later `r.stdout` is a live-repo git stdout read.
    const resultVar = assignedVarBefore(src, i);
    out.push({ start: i, end: close, stdoutRead, resultVar, expr: callText.slice(0, 90) });
    i = close - 1;
  }
  return out;
}

/** Find the end of a member chain starting at a `.` at index `dot`, returning the index one past
 *  the last member (respecting call parens after a member). */
function findChainEnd(src: string, dot: number, mask: Uint8Array): number {
  let i = dot;
  const n = src.length;
  while (i < n) {
    if (mask[i] === 1) { i++; continue; }
    const c = src[i];
    if (c === "." || /[A-Za-z0-9_$]/.test(c)) { i++; continue; }
    if (c === "(") {
      const close = findMatchingClose(src, i);
      if (close === -1) break;
      i = close;
      continue;
    }
    break;
  }
  return i;
}

/** The variable name a statement-end right before `callStart` assigns the call result to
 *  (`const r = spawnSync(…)` → "r"), or null when the call is not directly assigned. */
export function assignedVarBefore(src: string, callStart: number): string | null {
  const before = src.slice(0, callStart);
  const m = before.match(/(?:^|[;\n])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
  return m ? m[1] : null;
}

/**
 * Collect the variable names a live-repo git call binds:
 *   - `resultVars`: the whole call result (`const r = spawnSync("git", …)` → `r`), so a later
 *     `r.stdout` is a live-repo git stdout read;
 *   - `stdoutVars`: an already-extracted stdout read (`const out = <gitcall>.stdout…` → `out`),
 *     so a later bare `out` is the read itself.
 */
export function gitVars(calls: GitCall[]): { resultVars: Set<string>; stdoutVars: Set<string> } {
  const resultVars = new Set<string>();
  const stdoutVars = new Set<string>();
  for (const c of calls) {
    if (c.resultVar) {
      if (c.stdoutRead) stdoutVars.add(c.resultVar);
      else resultVars.add(c.resultVar);
    }
  }
  return { resultVars, stdoutVars };
}

/** Test whether the assertion other-argument `X` (the non-numeric side) reads live-repo git output. */
function argReadsLiveGitOutput(
  src: string,
  argText: string,
  argAbsStart: number,
  calls: GitCall[],
  resultVars: Set<string>,
  stdoutVars: Set<string>
): boolean {
  // (ii) references a variable assigned from a live-repo git stdout read.
  const identRe = /[A-Za-z_$][\w$]*/g;
  let mm: RegExpExecArray | null;
  while ((mm = identRe.exec(argText)) !== null) {
    if (stdoutVars.has(mm[0])) return true;
    // `r.stdout…` where `r` is the result of a live-repo git call — the member read is the git output.
    if (resultVars.has(mm[0]) && /\.stdout\b/.test(argText)) return true;
  }
  // (i) a `.stdout` member read whose owning call is a live-repo git call (the inline shape
  //     `assert.equal(spawnSync("git", [...], {cwd: REPO_ROOT}).stdout.trim(), 47)`).
  const stdoutDot = argText.indexOf(".stdout");
  if (stdoutDot !== -1) {
    // If the argument span contains a live-repo git call directly, the `.stdout` belongs to it.
    const argAbsEnd = argAbsStart + argText.length;
    for (const c of calls) {
      if (c.start >= argAbsStart && c.end <= argAbsEnd) return true;
    }
  }
  return false;
}

/** Run the rule over ONE test file's source. Returns violations (empty = PASS). */
export function scanFile(rel: string, src: string): Violation[] {
  const mask = buildNonCodeMask(src);
  const calls = findLiveRepoGitCalls(src);
  if (calls.length === 0) return [];
  const { resultVars, stdoutVars } = gitVars(calls);
  const out: Violation[] = [];

  // Find equality-style assertions with a bare numeric literal on one side.
  const assertRe = /assert\.(?:equal|strictEqual|deepEqual|notEqual)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = assertRe.exec(src)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    if (!atCode(mask, openIdx)) continue;
    const close = findMatchingClose(src, openIdx);
    if (close === -1) continue;
    const argsText = src.slice(openIdx + 1, close - 1);
    const parts = splitTopLevelArgs(argsText);
    if (parts.length < 2) continue;
    // One side is a bare numeric literal, the other is the live-repo output read.
    let numIdx = -1;
    let otherIdx = -1;
    for (let k = 0; k < 2; k++) {
      const t = parts[k].trim();
      if (/^\d+$/.test(t)) numIdx = k;
      else otherIdx = k;
    }
    if (numIdx === -1 || otherIdx === -1) continue;
    const otherText = parts[otherIdx].trim();
    const otherAbsStart = openIdx + 1 + parts.slice(0, otherIdx).reduce((acc, p) => acc + p.length + 1, 0);
    if (argReadsLiveGitOutput(src, otherText, otherAbsStart, calls, resultVars, stdoutVars)) {
      out.push({
        rel,
        line: lineOf(src, m.index),
        snippet: `assert.equal(... ${numIdx === 0 ? "<num>," : ""} <git-stdout> ${numIdx === 1 ? ")" : ""} — literal ${parts[numIdx].trim()} asserted against live repo git output (cwd=REPO_ROOT)`,
      });
    }
  }
  return out;
}

/** Split an argument list on top-level commas (not inside nested parens/brackets/braces/strings). */
export function splitTopLevelArgs(text: string): string[] {
  const mask = buildNonCodeMask(text);
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    if (mask[i] === 1) { cur += text[i]; continue; }
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim().length > 0 || out.length > 0) out.push(cur);
  return out;
}

function lineOf(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/** Scan the canonical glob (or an explicit --files list). Returns violations sorted by file/line. */
export function scanRoot(root: string, explicitFiles: string[] | null): Violation[] {
  const relFiles = explicitFiles && explicitFiles.length > 0 ? explicitFiles : canonicalTestFiles(root);
  const all: Violation[] = [];
  for (const rel of relFiles) {
    if (!rel.endsWith(".test.mjs") && !rel.endsWith(".test.js")) continue;
    const src = readFileSafe(path.join(root, rel));
    for (const v of scanFile(rel, src)) all.push(v);
  }
  return all.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
}

function usage(): never {
  console.error(
    "usage: node live-repo-literal-assert-check.ts [<workspace-root>] [--json] [--selftest] [--files <rel> ...]\n" +
      "Exit: 0 = PASS (no test asserts a literal against live-repo git output); 1 = violations; 2 = usage/env error."
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--selftest")) return runSelftest() ? 0 : 1;
  const asJson = args.includes("--json");
  const filesIdx = args.indexOf("--files");
  const explicitFiles = filesIdx !== -1 ? args.slice(filesIdx + 1) : null;
  const positional = args.filter((a) => !a.startsWith("--"));
  const root = path.resolve(positional[0] ?? process.cwd());
  if (!fs.existsSync(path.join(root, "scripts", "test.sh"))) {
    console.error(`ERROR: ${path.join(root, "scripts", "test.sh")} not found — is <workspace-root> correct?`);
    return 2;
  }
  const violations = scanRoot(root, explicitFiles);
  if (asJson) {
    console.log(JSON.stringify({ ok: violations.length === 0, count: violations.length, violations }, null, 2));
  } else {
    if (violations.length === 0) {
      console.log("live-repo-literal-assert-check: PASS — no test asserts a literal against live-repo git output");
    } else {
      console.log(`live-repo-literal-assert-check: FAIL — ${violations.length} violation(s):`);
      for (const v of violations) {
        console.log(`  - ${v.rel}:${v.line} — ${v.snippet}`);
      }
    }
  }
  return violations.length === 0 ? 0 : 1;
}

// ── selftest (ADR-018 selfcheck-fixture pattern: demonstrate BOTH the RED and GREEN state) ───────────

export function runSelftest(): boolean {
  let pass = 0;
  let fail = 0;
  const check = (name: string, cond: boolean, detail = "") => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
  };

  // POSITIVE controls — the violation shapes must be DETECTED (负控: 对活仓库状态的字面断言被检出).
  const inlineVio =
    'const r = spawnSync("git", ["log", "--all", "--oneline"], { encoding: "utf8", cwd: REPO_ROOT });\n' +
    'assert.equal(r.stdout.trim().split("\\n").length, 47, "commit count");\n';
  let v = scanFile("inline.test.mjs", inlineVio);
  check("RED: inline git stdout + literal count detected", v.length === 1, JSON.stringify(v));

  const varVio =
    'const out = execFileSync("git", ["log", "--all", "--oneline"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();\n' +
    'assert.equal(out.split("\\n").length, 47);\n';
  v = scanFile("var.test.mjs", varVio);
  check("RED: var assigned from git stdout + literal count detected", v.length === 1, JSON.stringify(v));

  const dashC =
    'const r = spawnSync("git", ["-C", REPO_ROOT, "rev-list", "--count", "HEAD"], { encoding: "utf8" });\n' +
    'assert.strictEqual(Number(r.stdout.trim()), 1234);\n';
  v = scanFile("dashc.test.mjs", dashC);
  check("RED: git -C REPO_ROOT + literal detected", v.length === 1, JSON.stringify(v));

  const reversed =
    'const out = spawnSync("git", ["log", "--all"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout;\n' +
    'assert.deepEqual(47, out.trim().split("\\n").length);\n';
  v = scanFile("reversed.test.mjs", reversed);
  check("RED: literal-first ordering detected", v.length === 1, JSON.stringify(v));

  // NEGATIVE controls — the tolerated patterns must NOT be flagged (hermetic / relative / fixture).
  const hermetic =
    'const tmp = mkdtempSync(path.join(os.tmpdir(), "x-"));\n' +
    'const out = execFileSync("git", ["log", "--all"], { cwd: tmp, encoding: "utf8" }).stdout;\n' +
    'assert.equal(out.trim().split("\\n").length, 47);\n';
  v = scanFile("hermetic.test.mjs", hermetic);
  check("GREEN: hermetic git-init temp repo literal is fine", v.length === 0, JSON.stringify(v));

  const relativeDiff =
    'const before = spawnSync("git", ["-C", REPO_ROOT, "status", "--short"], { encoding: "utf8" }).stdout;\n' +
    'const after = spawnSync("git", ["-C", REPO_ROOT, "status", "--short"], { encoding: "utf8" }).stdout;\n' +
    'assert.equal(after, before, "checker must not write");\n';
  v = scanFile("relative.test.mjs", relativeDiff);
  check("GREEN: relative before/after comparison is fine", v.length === 0, JSON.stringify(v));

  const shapeMatch =
    'const out = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.trim();\n' +
    'assert.match(out, /^[0-9a-f]{40}$/);\n';
  v = scanFile("shape.test.mjs", shapeMatch);
  check("GREEN: shape/format assertion (no literal count) is fine", v.length === 0, JSON.stringify(v));

  const fixture =
    'const injected = 47;\n' +
    'const pending = pendingDeclarationList([mk({ callCountAll: injected })], NOW);\n' +
    'assert.equal(pending[0].callCountAll, injected);\n';
  v = scanFile("fixture.test.mjs", fixture);
  check("GREEN: synthetic fixture (relative to fixture var, no live git) is fine", v.length === 0, JSON.stringify(v));

  const exitCode =
    'const r = spawnSync("git", ["log", "--all"], { cwd: REPO_ROOT, encoding: "utf8" });\n' +
    'assert.equal(r.status, 0);\n';
  v = scanFile("exit.test.mjs", exitCode);
  check("GREEN: exit-status assertion (no stdout literal) is fine", v.length === 0, JSON.stringify(v));

  // Comment/string mention must NOT report (按位置不按关键词).
  const commentMention =
    '// assert.equal(r.stdout, 47) — a comment spelling the pattern must not report\n' +
    'const s = "cwd: REPO_ROOT git 47";\n' +
    'const out = spawnSync("git", ["log"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout;\n' +
    'console.log(out);\n';
  v = scanFile("comment.test.mjs", commentMention);
  check("GREEN: comment/string mention of the pattern is not a violation", v.length === 0, JSON.stringify(v));

  console.log(`\nlive-repo-literal-assert-check --selftest: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  process.exit(main(process.argv));
}
