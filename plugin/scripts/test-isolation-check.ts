#!/usr/bin/env node
// test-isolation-check.ts — gap-test-isolation-contract-is-unwritten: mechanical, report-only
// scan of the TEST-ISOLATION CONTRACT over scripts/test.sh's canonical glob, with a SHRINK-ONLY
// known-violation data file (the ratchet).
//
// The class being policed: "the test touches something it does not exclusively own" — three
// isolation-green/suite-red failures in one night, same class (2026-08-02/03):
//   M136         another test rebuilt the SHARED dist/quay.js mid-suite (3 rounds)
//   relation-sync a fixed __dirname/.tmp-* path + a silent process.exit(1) harness (fixed)
//   AC11         a test spawned the WHOLE scripts/test.sh runner inside the suite (60s budget)
// The contract (docs/analysis/test-isolation-contract.md) generalizes them into FOUR rules:
//
//   R1 fixed-path-write           tests must write only to per-run-unique paths (mkdtemp /
//                                 os.tmpdir()), never a fixed path under the shared checkout.
//                                 Structural signal: a `path.join(__dirname, ... ".tmp…")`
//                                 dot-tmp dir that is NOT a mkdtemp prefix.
//   R2 shared-build-artifact-write  tests must not rebuild/overwrite the SHARED build artifacts
//                                 (packages/*/dist/, plugin/vendor/). Structural signal: invoking
//                                 sync-vendor.sh in sync mode, or a direct write to a literal
//                                 packages/*/dist/ or plugin/vendor/ path.
//   R3 spawns-test-sh             tests must not spawn the whole runner (scripts/test.sh) inside
//                                 the suite. Structural signal: a spawn/exec call whose argument
//                                 references scripts/test.sh (literal or via a declared variable).
//   R4 process-exit-1             a hand-rolled (non-node:test) harness's failure path must use
//                                 process.exitCode, never process.exit(1) (which can drop async
//                                 stderr writes under a POSIX pipe).
//
// Every check matches CODE POSITIONS only — comments, string/template literals and regex
// literals are masked (reusing buildNonCodeMask from test-framework-policy-check.ts), so a
// comment that merely mentions process.exit(1) or scripts/test.sh is never a violation (the
// relation-sync post-fix file still SPELLS process.exit(1) in its comments and must NOT report).
//
// REPORT-ONLY vs RATCHET (AC5/AC6): the scanner REPORTS every current violation but does NOT
// block on the known/baselined ones — the suite stays green (AC6, "报出而不阻断"). The data
// file (plugin/test-isolation-violations.txt) is the SHRINK-ONLY list of known violations; the
// check FAILS only on drift:
//   - a current violation with no data-file entry  (new violation introduced — fix the test)
//   - a data-file entry that GREW vs git HEAD      (the list can only get SHORTER)
//   - a stale data-file entry                     (the code was fixed — remove the entry)
//   - the entry count / # baseline-count ceiling  (commit-surviving backstop, same as the
//                                                  test-framework-policy ratchet)
// On bootstrap (the data file does not exist at git HEAD yet), the current violations become the
// baseline; the git strict-subset is not yet enforceable but the ceiling is, once the token exists.
//
// Usage:
//   node test-isolation-check.ts [<workspace-root>] [--json] [--list] [--selftest]
//   node test-isolation-check.ts [--data-file <path>] [--baseline-file <path>]
//
// Exit codes: 0 = report only / all violations baselined; 1 = ratchet violation; 2 = env error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildNonCodeMask,
  hasNodeTestImport,
  canonicalTestFiles,
  readFileSafe,
} from "./test-framework-policy-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo-root-relative location of the shrink-only known-violation data file (AC5). */
export const DATA_FILE_REL = "plugin/test-isolation-violations.txt";

/** The six contract rules (R1..R6) and their data-file keys. */
export const RULE_KEYS = [
  "fixed-path-write",
  "shared-build-artifact-write",
  "spawns-test-sh",
  "process-exit-1",
  "mkdtemp-no-cleanup",
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export interface Violation {
  rel: string;
  rule: RuleKey;
  line: number;
  snippet: string;
}

// ── code-position utilities ──────────────────────────────────────────────────────────────────────────

/** 1-based line number of a character index. */
function lineAt(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/** Trim one line of context around a match for the report. */
function snippetAt(src: string, idx: number, len = 80): string {
  const start = src.lastIndexOf("\n", idx) + 1;
  const end = src.indexOf("\n", idx);
  const line = src.slice(start, end === -1 ? src.length : end).trim();
  return line.length > len ? `${line.slice(0, len - 3)}...` : line;
}

/** Indices (absolute) of every CODE-position occurrence of `re` in `src` (mask skips non-code). */
export function codePositions(src: string, mask: Uint8Array, re: RegExp): number[] {
  const out: number[] = [];
  for (const m of src.matchAll(re)) {
    if (mask[m.index] === 0) out.push(m.index);
  }
  return out;
}

/**
 * Extract the balanced-paren argument region of a call whose opener is at `openIdx`
 * (the index of the `(`). Scans code positions so parens inside comments/strings are ignored.
 * Returns the source slice from `openIdx` (inclusive) to the matching close paren (inclusive).
 */
export function callRegion(src: string, mask: Uint8Array, openIdx: number): string {
  let depth = 0;
  let i = openIdx;
  for (; i < src.length; i++) {
    if (mask[i] !== 0) continue;
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return src.slice(openIdx);
}

/**
 * Contents of every STRING LITERAL at a CODE context within the region [from, to). The region is
 * a call's balanced-paren argument span; this walks the RAW text tracking line comments
 * (`//`) and slash-star block comments, so a comment that merely mentions a path (e.g. "// spawns
 * scripts/test.sh") is never a source of a string, while the path/flag ARGUMENTS (real code-token
 * string literals) are read directly. buildNonCodeMask marks string content non-code, so it cannot
 * be used to find the opening quote — this walker is the code-context discriminator instead.
 */
export function codeStrings(src: string, _mask: Uint8Array, from: number, to: number): string[] {
  const out: string[] = [];
  let inLine = false;
  let inBlock = false;
  let i = from;
  while (i < to) {
    const c = src[i];
    const d = src[i + 1];
    if (inLine) {
      if (c === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      if (c === "*" && d === "/") { inBlock = false; i += 2; continue; }
      i++;
      continue;
    }
    if (c === "/" && d === "/") { inLine = true; i += 2; continue; }
    if (c === "/" && d === "*") { inBlock = true; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let j = i + 1;
      let content = "";
      while (j < to) {
        const cc = src[j];
        if (cc === "\\") {
          if (j + 1 < to) { content += cc + src[j + 1]; j += 2; continue; }
          j++;
          continue;
        }
        if (cc === q) break;
        content += cc;
        j++;
      }
      out.push(content);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/** True iff `re` matches at a CODE position within a call region (mask-aware; for IDENTIFIER
 * patterns like a declared variable name — string-literal contents are read via codeStrings). */
function codeRegionHas(src: string, mask: Uint8Array, openIdx: number, region: string, re: RegExp): boolean {
  const regionMask = mask.subarray(openIdx, openIdx + region.length);
  const gre = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of region.matchAll(gre)) {
    if (regionMask[m.index] === 0) return true;
  }
  return false;
}

/** True iff `idx` lies inside the argument region of a preceding `mkdtemp`/`mkdtempSync(` call. */
function insideMkdtempCall(src: string, mask: Uint8Array, idx: number): boolean {
  const m = /mkdtemp(?:Sync)?\s*\(/g;
  for (const hit of src.matchAll(m)) {
    if (mask[hit.index] !== 0) continue;
    const region = callRegion(src, mask, hit.index + hit[0].length - 1);
    const regionStart = hit.index + hit[0].length - 1;
    if (idx >= regionStart && idx < regionStart + region.length) return true;
  }
  return false;
}

/** Collect variable names whose declaration initializer references `needle` (a path fragment). */
export function varsReferencing(src: string, mask: Uint8Array, needle: RegExp): Set<string> {
  const names = new Set<string>();
  const declRe = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
  for (const m of src.matchAll(declRe)) {
    if (mask[m.index] !== 0) continue;
    // scan the initializer to the statement-terminating `;` at ()/{} depth 0 (code positions)
    let depth = 0;
    let end = m.index + m[0].length;
    for (let i = end; i < src.length; i++) {
      if (mask[i] !== 0) continue;
      const c = src[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ";" && depth <= 0) { end = i; break; }
    }
    const initializer = src.slice(m.index, end);
    if (needle.test(initializer)) names.add(m[1]);
  }
  return names;
}

// ── rule detectors (all CODE-position, mask-aware) ───────────────────────────────────────────────────

/**
 * R1 fixed-path-write: a `path.join(__dirname, ... ".tmp…")` dot-tmp path under the shared
 * checkout that is NOT a mkdtemp prefix. relation-sync's pre-fix
 * `path.join(__dirname, ".tmp-relation-sync-test")` (8 concurrent copies: 7/8 crashed) is the
 * type specimen; the fix was `fs.mkdtempSync(path.join(os.tmpdir(), "relation-sync-test-"))`.
 */
export function detectFixedPathWrites(src: string, rel: string): Violation[] {
  const mask = buildNonCodeMask(src);
  const out: Violation[] = [];
  const joinRe = /\b(?:path\.join|join|resolve|path\.resolve)\s*\(/g;
  for (const m of src.matchAll(joinRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].length - 1;
    const region = callRegion(src, mask, openIdx);
    const end = openIdx + region.length;
    // CODE-position matching (AC2): the checkout-path identifier (`__dirname`/import.meta) is a
    // code token, and the `.tmp…` is a string-literal ARGUMENT — a comment mentioning either
    // inside the join args (e.g. `path.join(a, b /* __dirname .tmp- */)`) must not count.
    const isCheckoutPath = codeRegionHas(src, mask, openIdx, region, /__dirname|import\.meta|fileURLToPath/);
    const hasDotTmp = codeStrings(src, mask, openIdx, end).some((s) => /\.tmp(?:-|\b)/.test(s));
    if (!isCheckoutPath || !hasDotTmp) continue;
    if (insideMkdtempCall(src, mask, openIdx)) continue; // mkdtemp PREFIX is per-run-unique
    out.push({ rel, rule: "fixed-path-write", line: lineAt(src, m.index), snippet: snippetAt(src, m.index) });
  }
  return out;
}

/**
 * R2 shared-build-artifact-write: (a) invoking sync-vendor.sh WITHOUT --check (sync mode writes
 * the shared plugin/vendor/ mirror — plugin-packaging.test.mjs, the M136 instance); or (b) a
 * direct write op targeting a literal `packages/<pkg>/dist/` or `plugin/vendor/` path (a shared
 * artifact, not a mkdtemp copy — building to a temp tree is the SAFE pattern).
 */
export function detectSharedBuildArtifactWrites(src: string, rel: string): Violation[] {
  const mask = buildNonCodeMask(src);
  const out: Violation[] = [];
  const spawnRe = /\b(?:execSync|execFileSync|spawnSync|spawn|execFile|fork)\s*\(/g;
  for (const m of src.matchAll(spawnRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].length - 1;
    const region = callRegion(src, mask, openIdx);
    const end = openIdx + region.length;
    const args = codeStrings(src, mask, openIdx, end);
    const invokesSyncVendor = args.some((s) => s.includes("sync-vendor.sh"));
    const isCheckOnly = args.some((s) => s.includes("--check"));
    if (invokesSyncVendor && !isCheckOnly) {
      out.push({ rel, rule: "shared-build-artifact-write", line: lineAt(src, m.index), snippet: snippetAt(src, m.index) });
      continue;
    }
  }
  const writeRe = /\b(?:writeFileSync|writeFile|appendFileSync|mkdirSync|mkdir|rmSync|rm|unlinkSync|cpSync|copyFileSync|createWriteStream)\s*\(/g;
  for (const m of src.matchAll(writeRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].length - 1;
    const region = callRegion(src, mask, openIdx);
    const literalArg = region.match(/^\s*\(\s*["'`]([^"'`]+)["'`]/);
    if (!literalArg) continue;
    const p = literalArg[1];
    if (/(?:packages\/[^/]+\/dist\/|plugin\/vendor\/)/.test(p)) {
      out.push({ rel, rule: "shared-build-artifact-write", line: lineAt(src, m.index), snippet: snippetAt(src, m.index) });
    }
  }
  return out;
}

/**
 * R3 spawns-test-sh: a spawn/exec child-process call whose argument references scripts/test.sh —
 * either as a literal or via a declared variable initialized from a test.sh path. Both
 * select-tests-for-touches (AC11, the 60s-budget full-run spawner) and runner-grouping use the
 * variable form (`const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh")`); test-coverage-check
 * uses the literal form (`spawnSync("bash", ["scripts/test.sh", "--list-files"], ...)`).
 */
export function detectSpawnsTestSh(src: string, rel: string): Violation[] {
  const mask = buildNonCodeMask(src);
  const testShVars = varsReferencing(src, mask, /test\.sh/);
  const out: Violation[] = [];
  const spawnRe = /\b(?:execSync|execFileSync|spawnSync|spawn|execFile|fork)\s*\(/g;
  for (const m of src.matchAll(spawnRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].length - 1;
    const region = callRegion(src, mask, openIdx);
    const end = openIdx + region.length;
    const hitsLiteral = codeStrings(src, mask, openIdx, end).some((s) => s.includes("test.sh"));
    const hitsVar = [...testShVars].some((v) => codeRegionHas(src, mask, openIdx, region, new RegExp(`\\b${v}\\b`)));
    if (hitsLiteral || hitsVar) {
      out.push({ rel, rule: "spawns-test-sh", line: lineAt(src, m.index), snippet: snippetAt(src, m.index) });
    }
  }
  return out;
}

/**
 * R4 process-exit-1: `process.exit(1)` at a CODE position in a hand-rolled (non-node:test) file.
 * process.exit(1) terminates immediately and can drop still-buffered async stderr writes under a
 * POSIX pipe — the harness goes silent and the suite shows only a bare `✖ file (Nms)` line. The
 * safe pattern is process.exitCode (waits for the event loop to drain). Only non-node:test files
 * are checked: a node:test file's process.exit(1) (e.g. inside a template literal it writes as a
 * child script) is a different, in-band concern.
 */
export function detectProcessExit1(src: string, rel: string): Violation[] {
  if (hasNodeTestImport(src)) return [];
  const mask = buildNonCodeMask(src);
  const out: Violation[] = [];
  const re = /process\.exit\s*\(\s*1\s*\)/g;
  for (const m of src.matchAll(re)) {
    if (mask[m.index] !== 0) continue;
    out.push({ rel, rule: "process-exit-1", line: lineAt(src, m.index), snippet: snippetAt(src, m.index) });
    break; // one report per file per rule is enough for the ratchet
  }
  return out;
}

/**
 * R6 mkdtemp-no-cleanup: a file that mkdtemp()s at a CODE position leaks a tmpdir per run when the
 * created directory is not removed. gap-tmp-leak-is-live-r6-absolves-a-file-for-one-cleanup-call:
 * /tmp (tmpfs) accumulated 20k+ entries / 3.9 GB; the two biggest producers were a file judged
 * "clean" by the old file-level existence rule (gate-diagnostics, 7 mkdtemp / 2 unrelated cleanup
 * constructs) and the two baselined no-cleanup leakers (driver/gate).
 *
 * The old rule was FILE-LEVEL EXISTENCE: any cleanup construct anywhere in the file (rm/rmSync/
 * t.after/after/finally) cleared the WHOLE file — a 7-build/2-clean file was indistinguishable from
 * a 7-build/7-clean file. The rule now detects PARTIAL cleanup: every variable-assigned mkdtemp
 * result must be COVERED by a cleanup path:
 *   - its variable is referenced inside a cleanup construct (rm/rmSync/unlinkSync call region,
 *     after/afterEach hook region, finally block body), or
 *   - its variable is pushed into a carrier array that is referenced inside a cleanup construct
 *     (document-store/adr-store's `_createdDirs` + `after(() => for ... rmSync)` pattern), or
 *   - it is RETURNED from a helper function and at least one call site captures the return value
 *     into a variable that is cleaned (makeFakeGhBin → `const fakeBinDir = ...` → `rmSync(fakeBinDir)`
 *     is NOT a leak; makeWorkspace with no caller cleanup IS).
 * The FIRST uncovered mkdtemp result is the per-file report.
 *
 * Two leniencies keep the rule low-false-positive (the original design intent, not abandoned):
 *   - a file with NO cleanup construct at all still reports (the old "no-cleanup" shape — it0-gates,
 *     gate, driver), so the shrink-only ratchet's existing entries stay meaningful.
 *   - an INLINE mkdtemp (no assigned variable, e.g. `return fs.mkdtempSync(...)`) is only tracked
 *     when it is the direct value of a `return` and no call site captures+cleans it; a non-returned
 *     inline mkdtemp cannot be associated with a cleanup statically and is skipped (lenient).
 *
 * AC6 EXEMPTION: /tmp/claude-* (session data) and /tmp/quay-wt-* (in-use worktrees) prefixes are
 * NEVER matched — when EVERY mkdtemp prefix in the file is one of those, the file is exempt.
 * Per-file granularity (one report per file per rule, like R4).
 */
export function detectMkdtempNoCleanup(src: string, rel: string): Violation[] {
  const mask = buildNonCodeMask(src);
  const mkdtempRe = /\bmkdtemp(?:Sync)?\s*\(/g;
  const mkdtempCalls: { index: number; varName: string | null }[] = [];
  for (const m of src.matchAll(mkdtempRe)) {
    if (mask[m.index] !== 0) continue;
    mkdtempCalls.push({ index: m.index, varName: mkdtempResultVar(src, mask, m.index) });
  }
  if (mkdtempCalls.length === 0) return [];

  // AC6: collect the first string-literal prefix arg of every mkdtemp call.
  const prefixes = mkdtempCalls.map((c) => mkdtempPrefix(src, mask, c.index));
  // When EVERY mkdtemp prefix is a session-data / in-use-worktree prefix, exempt the whole file.
  const exemptPrefix = /^(?:claude|quay-wt)-/;
  if (prefixes.length > 0 && prefixes.every((p) => exemptPrefix.test(p))) return [];

  // Cleanup constructs: rm/rmSync/unlinkSync calls, after/afterEach hooks, finally blocks.
  const regions = cleanupRegions(src, mask);
  if (regions.length === 0) {
    // No cleanup construct at all — the original no-cleanup leak shape.
    return [{ rel, rule: "mkdtemp-no-cleanup", line: lineAt(src, mkdtempCalls[0].index), snippet: snippetAt(src, mkdtempCalls[0].index) }];
  }

  const defs = functionDefs(src, mask);
  const rets = returnsReferencingMkdtemp(src, mask, defs);

  for (const c of mkdtempCalls) {
    if (!c.varName) {
      // Inline mkdtemp (no assigned variable). Only tracked when it is the direct value of a
      // `return` and no call site captures+cleans the helper's return — otherwise lenient-skip.
      const fname = nearestFuncName(defs, c.index);
      if (fname && rets.inline.has(fname)) {
        if (callerCleansReturn(src, mask, fname, (v) => isCoveredVar(src, mask, v, regions))) continue;
        return [{ rel, rule: "mkdtemp-no-cleanup", line: lineAt(src, c.index), snippet: snippetAt(src, c.index) }];
      }
      continue;
    }
    if (isCoveredVar(src, mask, c.varName, regions)) continue;
    const rec = rets.byVar.get(c.varName);
    if (rec && rec.funcName && callerCleansReturn(src, mask, rec.funcName, (v) => isCoveredVar(src, mask, v, regions))) continue;
    return [{ rel, rule: "mkdtemp-no-cleanup", line: lineAt(src, c.index), snippet: snippetAt(src, c.index) }];
  }
  return [];
}

/** First string-literal argument of a mkdtemp/mkdtempSync call (the /tmp prefix). The call is
 * usually `fs.mkdtempSync(path.join(os.tmpdir(), "prefix-"))`, so the prefix is the first string
 * literal anywhere in the argument region. */
function mkdtempPrefix(src: string, mask: Uint8Array, callIdx: number): string {
  const openIdx = src.indexOf("(", callIdx);
  const region = callRegion(src, mask, openIdx);
  const args = codeStrings(src, mask, openIdx, openIdx + region.length);
  return args[0] ?? "";
}

/**
 * The variable a mkdtemp result is assigned to, or null for an inline call
 * (`return fs.mkdtempSync(...)`, `path.join(fs.mkdtempSync(...), "x")`).
 * Handles `const X = mkdtempSync(...)`, `X = mkdtempSync(...)`, and the module-level
 * `workspaceRoot = fs.mkdtempSync(...)` form (bare assignment in a `let` decl).
 */
function mkdtempResultVar(src: string, mask: Uint8Array, callIdx: number): string | null {
  const lineStart = src.lastIndexOf("\n", callIdx) + 1;
  const before = src.slice(lineStart, callIdx);
  let eq = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    if (mask[lineStart + i] !== 0) continue;
    if (before[i] === "=") { eq = i; break; }
  }
  if (eq === -1) return null;
  const lhs = before.slice(0, eq).trim();
  const m = lhs.match(/(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
  if (m) return m[1];
  const m2 = lhs.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
  return m2 ? m2[1] : null;
}

/** All cleanup-construct regions: rm/rmSync/unlinkSync calls, after/afterEach hooks, finally blocks. */
function cleanupRegions(src: string, mask: Uint8Array): { start: number; end: number }[] {
  const regions: { start: number; end: number }[] = [];
  const rmRe = /\b(?:rmSync|rm|unlinkSync)\s*\(/g;
  for (const m of src.matchAll(rmRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].indexOf("(");
    const region = callRegion(src, mask, openIdx);
    regions.push({ start: openIdx, end: openIdx + region.length });
  }
  const afterRe = /\b(?:t\.)?(?:after|afterEach)\s*\(/g;
  for (const m of src.matchAll(afterRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].indexOf("(");
    const region = callRegion(src, mask, openIdx);
    regions.push({ start: openIdx, end: openIdx + region.length });
  }
  const finRe = /\bfinally\s*\{/g;
  for (const m of src.matchAll(finRe)) {
    if (mask[m.index] !== 0) continue;
    let depth = 0;
    let i = m.index + m[0].length - 1; // the `{`
    for (; i < src.length; i++) {
      if (mask[i] !== 0) continue;
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) break; }
    }
    regions.push({ start: m.index, end: i + 1 });
  }
  return regions;
}

/** True when a variable appears at a CODE position inside one of the cleanup regions, or is pushed
 * into a carrier array that does. (the document-store `_createdDirs.push(dir)` + after-loop shape) */
function isCoveredVar(src: string, mask: Uint8Array, name: string, regions: { start: number; end: number }[]): boolean {
  for (const r of regions) if (varInRegion(src, mask, name, r)) return true;
  const arrs = arraysReceivingVar(src, mask, name);
  for (const a of arrs) for (const r of regions) if (varInRegion(src, mask, a, r)) return true;
  return false;
}

function varInRegion(src: string, mask: Uint8Array, name: string, region: { start: number; end: number }): boolean {
  const re = new RegExp(`\\b${name}\\b`, "g");
  for (const m of src.slice(region.start, region.end).matchAll(re)) {
    const abs = region.start + m.index;
    if (mask[abs] === 0) return true;
  }
  return false;
}

/** Array names whose `.push(<name>)` appears at a CODE position. */
function arraysReceivingVar(src: string, mask: Uint8Array, name: string): Set<string> {
  const arrs = new Set<string>();
  const pushRe = new RegExp(`([A-Za-z_$][A-Za-z0-9_$]*)\\.push\\s*\\(\\s*${name}\\s*\\)`, "g");
  for (const m of src.matchAll(pushRe)) {
    if (mask[m.index] !== 0) continue;
    arrs.add(m[1]);
  }
  return arrs;
}

/** Function-definition signatures: {name, index, matchLen} for `function NAME(`, `NAME = function`,
 * `NAME = (...) =>`, and bare `NAME = ... =>` assignments. Used only to associate a mkdtemp/return
 * with its nearest enclosing function name (backward scan), never to parse bodies. */
function functionDefs(src: string, mask: Uint8Array): { name: string; index: number; matchLen: number }[] {
  const defs: { name: string; index: number; matchLen: number }[] = [];
  const patterns = [
    /\b(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?function\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g,
    /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      if (mask[m.index] !== 0) continue;
      defs.push({ name: m[1], index: m.index, matchLen: m[0].length });
    }
  }
  return defs.sort((a, b) => a.index - b.index);
}

/** Nearest function definition whose signature starts before `idx`; null when none. */
function nearestFuncName(defs: { name: string; index: number }[], idx: number): string | null {
  let best: string | null = null;
  for (const d of defs) {
    if (d.index < idx) best = d.name;
    else break;
  }
  return best;
}

interface ReturnRecord { returned: boolean; funcName: string | null; }

/** Map mkdtemp result variables to whether they are returned (and from which function), plus the set
 * of function names that `return` an INLINE mkdtemp. */
function returnsReferencingMkdtemp(
  src: string, mask: Uint8Array, defs: { name: string; index: number }[]
): { byVar: Map<string, ReturnRecord>; inline: Set<string> } {
  const byVar = new Map<string, ReturnRecord>();
  const inline = new Set<string>();
  const retRe = /\breturn\s+([^\n;]+)/g;
  for (const m of src.matchAll(retRe)) {
    if (mask[m.index] !== 0) continue;
    const expr = m[1].trim();
    const fname = nearestFuncName(defs, m.index);
    if (/mkdtemp/.test(expr)) {
      if (fname) inline.add(fname);
      continue;
    }
    const varM = expr.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (varM) {
      if (!byVar.has(varM[1])) byVar.set(varM[1], { returned: false, funcName: null });
      const rec = byVar.get(varM[1])!;
      rec.returned = true;
      if (fname) rec.funcName = fname;
    }
  }
  return { byVar, inline };
}

/** True when at least one call site of `funcName` captures the return value into a variable that is
 * covered (cleaned). A helper whose returned mkdtemp is captured-and-cleaned by a caller (the
 * makeFakeGhBin → fakeBinDir → rmSync shape) is NOT a leak. */
function callerCleansReturn(
  src: string, mask: Uint8Array, funcName: string, isCovered: (v: string) => boolean
): boolean {
  const re = new RegExp(`\\b${funcName}\\s*\\(`, "g");
  const def = functionDefs(src, mask).find((d) => d.name === funcName);
  for (const m of src.matchAll(re)) {
    if (mask[m.index] !== 0) continue;
    if (def && m.index >= def.index && m.index < def.index + def.matchLen) continue; // the definition itself
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const before = src.slice(lineStart, m.index);
    // destructuring capture: `const { workspaceRoot, tasksDir } = makeWorkspace(`
    const destr = before.match(
      /(?:const|let|var)\s*\{\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\s*:\s*[A-Za-z_$][A-Za-z0-9_$]*)?(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\s*:\s*[A-Za-z_$][A-Za-z0-9_$]*)?)*)\s*\}\s*=\s*$/
    );
    if (destr) {
      const caps = destr[1].split(",").map((s) => s.trim().split(":")[0].trim());
      if (caps.some((v) => isCovered(v))) return true;
      continue;
    }
    // direct capture: `const fakeBinDir = makeFakeGhBin(`, `fakeBinDir = ...`, `fakeBinDir ??= ...`
    const stripped = before.replace(/\s*[A-Za-z_$][A-Za-z0-9_$]*\s*$/, "");
    const direct = stripped.match(/(?:const|let|var)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\?\?=|\|\|=|=)\s*$/);
    if (direct && !/\b(?:return|if|else|while|for|throw)\b/.test(before)) {
      if (isCovered(direct[1])) return true;
    }
  }
  return false;
}

/** Run all six detectors over one file. */
export function detectAll(src: string, rel: string): Violation[] {
  return [
    ...detectFixedPathWrites(src, rel),
    ...detectSharedBuildArtifactWrites(src, rel),
    ...detectSpawnsTestSh(src, rel),
    ...detectProcessExit1(src, rel),
    ...detectMkdtempNoCleanup(src, rel),
  ];
}

// ── data file parsing ────────────────────────────────────────────────────────────────────────────────

/** Parse the data file: one `<rel>:<rule>` entry per line, '#' comments and blanks ignored. */
export function parseViolationList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** Parse the commit-surviving ratchet ceiling from the header: `# baseline-count: <n>`. */
export function parseBaselineCount(text: string): number | null {
  const m = text.match(/^#\s*baseline-count:\s*(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

/** Map a `<rel>:<rule>` entry to `{rel, rule}`; null when malformed or the rule key is unknown. */
export function parseEntry(entry: string): { rel: string; rule: RuleKey } | null {
  const idx = entry.lastIndexOf(":");
  if (idx <= 0 || idx === entry.length - 1) return null;
  const rel = entry.slice(0, idx);
  const rule = entry.slice(idx + 1);
  if (!(RULE_KEYS as readonly string[]).includes(rule)) return null;
  return { rel, rule: rule as RuleKey };
}

// ── the pure ratchet check ────────────────────────────────────────────────────────────────────────────

export interface IsolationCheckInput {
  /** Current violations (deduped `rel:rule` entries, from the detectors). */
  current: string[];
  /** Parsed CURRENT data-file entries (working tree). */
  dataEntries: string[];
  /** Parsed BASELINE data-file entries (git HEAD). [] = bootstrap. */
  baselineEntries: string[];
  /** RATCHET CEILING parsed from the working-tree data-file header (commit-surviving backstop). */
  baselineCount: number | null;
  /** The ceiling parsed from the HEAD/baseline copy (null on bootstrap). */
  baselineCountHead: number | null;
  /** Does a glob-covered file with this repo-relative path exist on disk? */
  fileExists: (rel: string) => boolean;
}

/**
 * Run the ratchet checks. Returns human-readable failure strings; [] = ratchet intact.
 * Pure: no fs/git — the caller supplies the lists.
 */
export function runIsolationChecks(i: IsolationCheckInput): string[] {
  const failures: string[] = [];
  const currentSet = new Set(i.current);
  const dataSet = new Set(i.dataEntries);
  const baselineSet = new Set(i.baselineEntries);
  const bootstrap = i.baselineEntries.length === 0;

  // C0a (AC5, commit-surviving ceiling): the data file can never exceed its own header ceiling,
  // even at a clean commit where the git subset is blind.
  if (i.baselineCount !== null && i.dataEntries.length > i.baselineCount) {
    failures.push(
      `AC5: the violation list has ${i.dataEntries.length} entries, over the ratchet ceiling of ${i.baselineCount} (${DATA_FILE_REL} header "# baseline-count"). The list can only get SHORTER.`
    );
  }

  // C0b (AC5, shrink-only ceiling): the ceiling itself can only get LOWER.
  if (!bootstrap && i.baselineCountHead !== null && i.baselineCount !== null && i.baselineCount > i.baselineCountHead) {
    failures.push(
      `AC5: the ratchet ceiling was RAISED from ${i.baselineCountHead} to ${i.baselineCount} in ${DATA_FILE_REL} — the ceiling is shrink-only.`
    );
  }

  // C1 (AC5): every CURRENT violation must have a data-file entry. A current violation with no
  // entry is a NEW violation — the list can only shrink, so the fix is in the TEST, not the list.
  for (const v of i.current) {
    if (!dataSet.has(v)) {
      failures.push(
        `AC5: ${v} is a CURRENT violation with no entry in ${DATA_FILE_REL} — a new violation was introduced. The list can only get SHORTER; fix the test (mkdtemp / build to a temp tree / stop spawning scripts/test.sh / use process.exitCode). Do NOT add it to the list.`
      );
    }
  }

  if (!bootstrap) {
    // C2a (AC5 ratchet, working-tree): the data file can only get SHORTER — an entry not in the
    // committed baseline was ADDED.
    for (const e of i.dataEntries) {
      if (!baselineSet.has(e)) {
        failures.push(
          `AC5: ${e} was ADDED to the violation list — the list can only get SHORTER. Fix the test instead; there is no way to exempt a new violation.`
        );
      }
    }
  }

  // C2b/C2c/C2d — every data-file entry must be a real, still-violating, glob-covered file.
  for (const e of i.dataEntries) {
    const parsed = parseEntry(e);
    if (!parsed) {
      failures.push(`AC5: malformed entry "${e}" in ${DATA_FILE_REL} — expected "<repo-relative-test-file>:<one of ${RULE_KEYS.join("|")}>".`);
      continue;
    }
    if (!i.fileExists(parsed.rel)) {
      failures.push(`AC5: violation entry ${e} names a file that no longer exists — remove it (the list only shrinks).`);
      continue;
    }
    if (!currentSet.has(e)) {
      failures.push(`AC5: violation entry ${e} is STALE — the code no longer triggers this rule. Remove it (the list only shrinks; fixing a violation means shortening the list).`);
    }
  }

  return failures;
}

// ── git baseline resolution (mirrors test-framework-policy-check.ts) ──────────────────────────────────

function gitHeadExists(root: string): boolean {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function gitShowFile(root: string, ref: string, rel: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "show", `${ref}:${rel}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function usage(): never {
  console.error(
    "usage: node test-isolation-check.ts [<workspace-root>] [--json] [--list] [--selftest]\n" +
      "       node test-isolation-check.ts [--data-file <path>] [--baseline-file <path>]\n" +
      "Exit: 0 = report-only / all violations baselined; 1 = ratchet violation; 2 = usage/environment error."
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--selftest")) {
    process.exit(runSelftest() ? 0 : 1);
  }
  const asJson = args.includes("--json");
  const asList = args.includes("--list");

  const positional = args.filter((a) => !a.startsWith("--"));
  const root = path.resolve(positional[0] ?? process.cwd());

  const dataFileRel = getArgValue(args, "--data-file") ?? DATA_FILE_REL;
  const dataFileAbs = path.isAbsolute(dataFileRel) ? dataFileRel : path.join(root, dataFileRel);

  if (!fs.existsSync(path.join(root, "scripts", "test.sh"))) {
    console.error(`ERROR: ${path.join(root, "scripts", "test.sh")} not found — is <workspace-root> correct?`);
    return 2;
  }

  // The canonical glob (parsed from scripts/test.sh's own glob line, realpath-deduped — the same
  // set scripts/test.sh --list-files prints; test-coverage-check.test.mjs AC5 pins that equality).
  const files = canonicalTestFiles(root);
  const violations: Violation[] = [];
  for (const rel of files) {
    violations.push(...detectAll(readFileSafe(path.join(root, rel)), rel));
  }
  // The ratchet + data file track one entry per <rel>:<rule> — the report matches that unit, so
  // every reported line corresponds to exactly one data-file entry (a file can violate a rule
  // multiple times, e.g. two fixed .tmp dirs; the FIRST instance stands for the pair).
  const seen = new Set<string>();
  const deduped: Violation[] = [];
  for (const v of violations) {
    const key = `${v.rel}:${v.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(v);
  }
  deduped.sort((a, b) => `${a.rel}:${a.rule}`.localeCompare(`${b.rel}:${b.rule}`));
  const current = deduped.map((v) => `${v.rel}:${v.rule}`);

  if (asList) {
    // Metadata: print the current violation list (rel:rule) one per line — the AC3 report.
    for (const v of current) console.log(v);
    return 0;
  }

  const dataText = readFileSafe(dataFileAbs);
  const dataEntries = parseViolationList(dataText);
  const baselineCount = parseBaselineCount(dataText);

  // Baseline: explicit --baseline-file wins; otherwise git HEAD (fail closed unless bootstrap).
  let baselineEntries = dataEntries;
  let baselineCountHead: number | null = null;
  const baselineFileArg = getArgValue(args, "--baseline-file");
  if (baselineFileArg) {
    const baselineText = readFileSafe(path.resolve(root, baselineFileArg));
    baselineEntries = parseViolationList(baselineText);
    baselineCountHead = parseBaselineCount(baselineText);
  } else {
    const gitOk = gitHeadExists(root);
    if (!gitOk) {
      console.error(
        "ERROR: test-isolation-check needs a git baseline (git HEAD) to enforce the AC5 ratchet. Pass --baseline-file for a non-git fixture, or run in the real checkout."
      );
      return 2;
    }
    const committed = gitShowFile(root, "HEAD", dataFileRel);
    if (committed !== null) {
      baselineEntries = parseViolationList(committed);
      baselineCountHead = parseBaselineCount(committed);
    }
  }

  const failures = runIsolationChecks({
    current,
    dataEntries,
    baselineEntries,
    baselineCount,
    baselineCountHead,
    fileExists: (rel) => fs.existsSync(path.join(root, rel)),
  });

  // ── the report (AC6: 报出而不阻断 — the known violations are PRINTED but don't fail the run) ──
  const ruleCounts: Record<string, number> = {};
  for (const v of deduped) ruleCounts[v.rule] = (ruleCounts[v.rule] ?? 0) + 1;
  const breakdown = RULE_KEYS.map((k) => `${k}=${ruleCounts[k] ?? 0}`).join(" ");

  const summary = `test-isolation-check — ${files.length} glob file(s), ${deduped.length} current violation(s) [${breakdown}]`;
  if (asJson) {
    console.log(JSON.stringify({
      ok: failures.length === 0,
      files: files.length,
      violations: deduped.map((v) => ({ rel: v.rel, rule: v.rule, line: v.line, snippet: v.snippet })),
      ratchetFailures: failures,
    }, null, 2));
  } else {
    console.log(summary);
    for (const v of deduped) {
      console.log(`  ${v.rel}:${v.rule}  (line ${v.line}) ${v.snippet}`);
    }
    if (failures.length === 0) {
      console.log(`PASS: all ${deduped.length} violation(s) are baselined in ${dataFileRel}; the list can only get SHORTER (no additions, no growth, no stale entries).`);
    } else {
      console.log(`FAIL: ${failures.length} ratchet violation(s):`);
      for (const f of failures) console.log(`  - ${f}`);
    }
  }
  return failures.length === 0 ? 0 : 1;
}

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

// ── selftest (ADR-018 selfcheck-fixture pattern: demonstrate BOTH the RED and GREEN state) ────────────

export function runSelftest(): boolean {
  let pass = 0;
  let fail = 0;
  function check(name: string, cond: boolean, detail = "") {
    if (cond) pass++;
    else {
      fail++;
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    }
  }

  // R1: a fixed `.tmp-` under __dirname is reported; a mkdtemp prefix is NOT.
  const fixedTmp = 'const tasksDir = path.join(__dirname, ".tmp-lock-test");\n';
  check("R1 RED: fixed __dirname/.tmp- path reports", detectFixedPathWrites(fixedTmp, "x.test.mjs").some((v) => v.rule === "fixed-path-write"));
  const mkdtempOk = 'const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-sync-"));\n';
  check("R1 GREEN: mkdtemp/os.tmpdir prefix does NOT report", detectFixedPathWrites(mkdtempOk, "x.test.mjs").length === 0);
  const mkdtempDirname = 'const dir = fs.mkdtempSync(path.join(__dirname, "..", "fixtures", ".tmp-tree-"));\n';
  check("R1 GREEN: mkdtemp under __dirname is a PREFIX, not a fixed write", detectFixedPathWrites(mkdtempDirname, "x.test.mjs").length === 0);
  const commentOnly = '// path.join(__dirname, ".tmp-comment-only") mention\n';
  check("R1 GREEN: a comment mentioning .tmp does NOT report", detectFixedPathWrites(commentOnly, "x.test.mjs").length === 0);
  const joinInlineComment = 'path.join(a, b /* __dirname .tmp- */)\n';
  check("R1 GREEN: an INLINE comment inside the join args does NOT report", detectFixedPathWrites(joinInlineComment, "x.test.mjs").length === 0);

  // R2: sync-vendor.sh without --check reports; with --check does not; a temp build does not.
  const syncNoCheck = 'execFileSync("bash", [path.join(pluginDir, "scripts", "sync-vendor.sh")], { cwd: repoRoot });\n';
  check("R2 RED: sync-vendor.sh sync-mode (no --check) reports", detectSharedBuildArtifactWrites(syncNoCheck, "x.test.mjs").some((v) => v.rule === "shared-build-artifact-write"));
  const syncCheck = 'execFileSync("bash", [syncScript, "--check"], { cwd: repoRoot });\n';
  check("R2 GREEN: sync-vendor.sh --check (read-only) does NOT report", detectSharedBuildArtifactWrites(syncCheck, "x.test.mjs").length === 0);
  const tempBuild = 'fs.writeFileSync(path.join(root, "dist", "quay.js"), "x"); // root is a mkdtemp\n';
  check("R2 GREEN: writing dist under a temp root does NOT report", detectSharedBuildArtifactWrites(tempBuild, "x.test.mjs").length === 0);
  const sharedDist = 'fs.writeFileSync("packages/quay/dist/quay.js", "x");\n';
  check("R2 RED: direct write to a shared packages/*/dist path reports", detectSharedBuildArtifactWrites(sharedDist, "x.test.mjs").some((v) => v.rule === "shared-build-artifact-write"));

  // R3: a spawn of scripts/test.sh reports (literal AND variable forms); a comment does not.
  const spawnLiteral = 'const r = spawnSync("bash", ["scripts/test.sh", "--list-files"], { encoding: "utf8" });\n';
  check("R3 RED: spawnSync of scripts/test.sh literal reports", detectSpawnsTestSh(spawnLiteral, "x.test.mjs").some((v) => v.rule === "spawns-test-sh"));
  const spawnVar = 'const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");\nspawnSync("bash", [TEST_SH, "--for-task", "x"]);\n';
  check("R3 RED: spawn via a test.sh variable reports", detectSpawnsTestSh(spawnVar, "x.test.mjs").some((v) => v.rule === "spawns-test-sh"));
  const spawnOther = 'spawnSync("bash", ["plugin/scripts/other.sh"], {});\n';
  check("R3 GREEN: spawning an unrelated script does NOT report", detectSpawnsTestSh(spawnOther, "x.test.mjs").length === 0);
  const spawnComment = '// spawnSync("bash", ["scripts/test.sh"])\nconst x = 1;\n';
  check("R3 GREEN: a comment mentioning the spawn does NOT report", detectSpawnsTestSh(spawnComment, "x.test.mjs").length === 0);
  const spawnInlineComment = 'spawnSync("bash", [otherScript], { // spawns scripts/test.sh inside the suite\n  cwd: root,\n});\n';
  check("R3 GREEN: an INLINE comment inside a spawn region does NOT report", detectSpawnsTestSh(spawnInlineComment, "x.test.mjs").length === 0);
  const spawnVarComment = 'const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");\nconst r = spawnSync("bash", [other], { // TEST_SH\n});\n';
  check("R3 GREEN: a comment naming the test.sh var inside a spawn region does NOT report", detectSpawnsTestSh(spawnVarComment, "x.test.mjs").length === 0);

  // R4: process.exit(1) reports only in non-node:test files; process.exitCode never reports.
  const pe1Handrolled = '// @test-group product\nfunction fail() { process.exit(1); }\n';
  check("R4 RED: process.exit(1) in a hand-rolled file reports", detectProcessExit1(pe1Handrolled, "x.test.mjs").some((v) => v.rule === "process-exit-1"));
  const pe1NodeTest = '// @test-group engine\nimport { test } from "node:test";\nprocess.exit(1);\n';
  check("R4 GREEN: process.exit(1) in a node:test file does NOT report (out of rule scope)", detectProcessExit1(pe1NodeTest, "x.test.mjs").length === 0);
  const peCode = '// @test-group product\nprocess.exitCode = 1;\n';
  check("R4 GREEN: process.exitCode = 1 never reports", detectProcessExit1(peCode, "x.test.mjs").length === 0);
  const pe1Comment = '// @test-group product\n// uses process.exit(1) — dangerous\nfunction f() {}\n';
  check("R4 GREEN: a comment spelling process.exit(1) does NOT report", detectProcessExit1(pe1Comment, "x.test.mjs").length === 0);
  const pe1String = '// @test-group product\nconst s = "process.exit(1)";\n';
  check("R4 GREEN: process.exit(1) inside a string literal does NOT report", detectProcessExit1(pe1String, "x.test.mjs").length === 0);

  // R6: mkdtemp without cleanup reports; with cleanup does not; claude-*/quay-wt-* prefixes never.
  const leakBare = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\n';
  check("R6 RED: mkdtemp with no cleanup reports", detectMkdtempNoCleanup(leakBare, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"));
  const leakNoMkdtemp = '// @test-group product\nconst x = 1;\n';
  check("R6 GREEN: no mkdtemp never reports", detectMkdtempNoCleanup(leakNoMkdtemp, "x.test.mjs").length === 0);
  const cleanedAfter = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\nt.after(() => fs.rmSync(dir, { recursive: true, force: true }));\n';
  check("R6 GREEN: t.after cleanup does NOT report", detectMkdtempNoCleanup(cleanedAfter, "x.test.mjs").length === 0);
  const cleanedRm = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\nfs.rmSync(dir, { recursive: true, force: true });\n';
  check("R6 GREEN: rmSync cleanup does NOT report", detectMkdtempNoCleanup(cleanedRm, "x.test.mjs").length === 0);
  const cleanedFinally = '// @test-group product\ntry { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-")); } finally {}\n';
  check("R6 RED: an EMPTY finally (no rmSync of the mkdtemp dir) is a leak — reports", detectMkdtempNoCleanup(cleanedFinally, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"));
  const finallyRm = '// @test-group product\ntry { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-")); } finally { fs.rmSync(dir, { recursive: true, force: true }); }\n';
  check("R6 GREEN: try/finally that rmSyncs the mkdtemp dir does NOT report", detectMkdtempNoCleanup(finallyRm, "x.test.mjs").length === 0);
  // AC5 positive control: 3 mkdtemp, only 1 cleaned → PARTIAL cleanup reports.
  const partialClean = '// @test-group product\nconst a = fs.mkdtempSync(path.join(os.tmpdir(), "adr-a-"));\nconst b = fs.mkdtempSync(path.join(os.tmpdir(), "adr-b-"));\nconst c = fs.mkdtempSync(path.join(os.tmpdir(), "adr-c-"));\nt.after(() => fs.rmSync(a, { recursive: true, force: true }));\n';
  check("R6 RED: 3 mkdtemp / 1 cleaned reports (partial cleanup)", detectMkdtempNoCleanup(partialClean, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"));
  const allClean = '// @test-group product\nconst a = fs.mkdtempSync(path.join(os.tmpdir(), "adr-a-"));\nconst b = fs.mkdtempSync(path.join(os.tmpdir(), "adr-b-"));\nconst c = fs.mkdtempSync(path.join(os.tmpdir(), "adr-c-"));\nt.after(() => { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); fs.rmSync(c, { recursive: true, force: true }); });\n';
  check("R6 GREEN: 3 mkdtemp / 3 cleaned does NOT report", detectMkdtempNoCleanup(allClean, "x.test.mjs").length === 0);
  // carrier-array pattern (document-store): every mkdtemp pushed to _createdDirs, after() removes all.
  const carrierArray = '// @test-group product\nconst _createdDirs = [];\nconst a = fs.mkdtempSync(path.join(os.tmpdir(), "adr-a-")); _createdDirs.push(a);\nconst b = fs.mkdtempSync(path.join(os.tmpdir(), "adr-b-")); _createdDirs.push(b);\nafter(() => { for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true }); });\n';
  check("R6 GREEN: _createdDirs.push + after-loop removes all — does NOT report", detectMkdtempNoCleanup(carrierArray, "x.test.mjs").length === 0);
  // helper-return covered by caller cleanup: makeFakeGhBin → const fakeBinDir → rmSync(fakeBinDir)
  const callerCleaned = '// @test-group product\nfunction makeFakeGhBin() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-fake-")); return dir; }\nconst fakeBinDir = makeFakeGhBin();\nt.after(() => fs.rmSync(fakeBinDir, { recursive: true, force: true }));\n';
  check("R6 GREEN: helper-return captured into a cleaned var does NOT report", detectMkdtempNoCleanup(callerCleaned, "x.test.mjs").length === 0);
  // helper-return NOT cleaned by any caller → report (the gate-diagnostics shape).
  const callerLeaks = '// @test-group product\nfunction makeWs() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-leak-")); return dir; }\nconst ws = makeWs();\n';
  check("R6 RED: helper-return never cleaned reports", detectMkdtempNoCleanup(callerLeaks, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"));
  const claudePrefix = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-abc123"));\n';
  check("R6 GREEN: /tmp/claude-* prefix NEVER reports (AC6)", detectMkdtempNoCleanup(claudePrefix, "x.test.mjs").length === 0);
  const quayWtPrefix = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-wt-some-task"));\n';
  check("R6 GREEN: /tmp/quay-wt-* prefix NEVER reports (AC6)", detectMkdtempNoCleanup(quayWtPrefix, "x.test.mjs").length === 0);
  const mixedPrefix = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-wt-inuse"));\nconst leak = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-ok-leak"));\n';
  check("R6 RED: a non-exempt prefix alongside claude-*/quay-wt-* still reports (AC6)", detectMkdtempNoCleanup(mixedPrefix, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"));
  const mkdtempCommentOnly = '// @test-group product\n// fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-")) mention\nconst x = 1;\n';
  check("R6 GREEN: a comment mentioning mkdtemp does NOT report (code-position matching)", detectMkdtempNoCleanup(mkdtempCommentOnly, "x.test.mjs").length === 0);

  // ── the ratchet (runIsolationChecks) ────────────────────────────────────────────────────────────
  const entries = ["a.test.mjs:fixed-path-write", "b.test.mjs:process-exit-1"];
  const baseline = ["a.test.mjs:fixed-path-write", "b.test.mjs:process-exit-1"];

  // GREEN: current == data file == baseline.
  let failures = runIsolationChecks({ current: entries, dataEntries: entries, baselineEntries: baseline, baselineCount: 2, baselineCountHead: 2, fileExists: () => true });
  check("ratchet GREEN: current == data file passes", failures.length === 0, JSON.stringify(failures));

  // C1 RED: a current violation with no data-file entry.
  failures = runIsolationChecks({ current: [...entries, "c.test.mjs:spawns-test-sh"], dataEntries: entries, baselineEntries: baseline, baselineCount: 2, baselineCountHead: 2, fileExists: () => true });
  check("C1 RED: new current violation (no entry) fails", failures.some((f) => f.includes("c.test.mjs:spawns-test-sh") && f.includes("no entry")), JSON.stringify(failures));

  // C2a RED: a data-file entry ADDED vs the committed baseline.
  const grown = [...entries, "c.test.mjs:spawns-test-sh"];
  failures = runIsolationChecks({ current: grown, dataEntries: grown, baselineEntries: baseline, baselineCount: 2, baselineCountHead: 2, fileExists: () => true });
  check("C2a RED: data-file entry added vs HEAD fails", failures.some((f) => f.includes("c.test.mjs:spawns-test-sh") && f.includes("ADDED")), JSON.stringify(failures));

  // C2c RED: a stale data-file entry (violation fixed, entry kept).
  failures = runIsolationChecks({ current: entries.slice(0, 1), dataEntries: entries, baselineEntries: baseline, baselineCount: 2, baselineCountHead: 2, fileExists: () => true });
  check("C2c RED: stale entry (violation fixed, not removed) fails", failures.some((f) => f.includes("STALE")), JSON.stringify(failures));

  // C0a RED: the list over its own ceiling at a clean commit (git blind).
  failures = runIsolationChecks({ current: grown, dataEntries: grown, baselineEntries: grown, baselineCount: 2, baselineCountHead: 2, fileExists: () => true });
  check("C0a RED: list over the ratchet ceiling fails at a clean commit", failures.some((f) => f.includes("over the ratchet ceiling")), JSON.stringify(failures));

  // C0b RED: the ceiling itself raised in the working tree.
  failures = runIsolationChecks({ current: grown, dataEntries: grown, baselineEntries: grown, baselineCount: 3, baselineCountHead: 2, fileExists: () => true });
  check("C0b RED: raising the ratchet ceiling fails", failures.some((f) => f.includes("ceiling was RAISED")), JSON.stringify(failures));

  // C2d RED: a malformed entry.
  failures = runIsolationChecks({ current: [], dataEntries: ["not-a-valid-entry"], baselineEntries: [], baselineCount: null, baselineCountHead: null, fileExists: () => true });
  check("C2d RED: malformed entry fails", failures.some((f) => f.includes("malformed")), JSON.stringify(failures));

  console.log(`\ntest-isolation-check --selftest: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  process.exit(main(process.argv));
}
