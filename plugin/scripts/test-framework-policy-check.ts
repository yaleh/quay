#!/usr/bin/env node
// test-framework-policy-check.ts — gap-no-test-framework-policy-for-new-tests: mechanical
// enforcement of "new test files use node:test", with a SHRINK-ONLY exemption list (the ratchet).
//
// The repo carries two test styles — `node:test` (126 files / 6,114 assertions) and a hand-rolled
// harness (`makeAssert()` + a `failures` counter + `process.exitCode`, 34 files / 1,235
// assertions / 12,204 lines). The hand-rolled assertions are invisible to the runner's reported
// test count, cannot be parallelized in-file, and attribute cost only to the file (measured in
// orchestration/test-shape-analysis.md, 2026-08-02). This task does NOT migrate the 34 — it stops
// the 35th from appearing, and turns each existing file's eventual conversion into the ratchet.
//
// CHECKS (mapped to ACs):
//   C0 (AC4)  COMMIT-SURVIVING RATCHET CEILING — the list can never exceed the `# baseline-count`
//             ceiling (34) parsed from the data file header. Unlike the git strict-subset below,
//             this fires at ANY state, including a clean commit or fresh clone where a smuggled
//             hand-rolled test AND its exemption line landed together in one commit (REFUTE
//             round-1 MAJOR). The ceiling is permanent — it stays 34 as entries are removed.
//   C1 (AC3)  every file in scripts/test.sh's canonical glob must `import` node:test OR be on
//             the legacy exemption list (plugin/test-framework-policy-exemptions.txt). Detection
//             walks CODE positions only (mask skips comments and strings) so a comment or string
//             that merely mentions the import can never satisfy AC3 (REFUTE round-1 MAJOR).
//   C2 (AC4)  the exemption list can only get SHORTER:
//     C2a     an entry present in the working-tree list but NOT in the baseline (the list's
//             committed form at git HEAD) was ADDED → fail. Catches same-count swaps and header
//             edits before they land; the ceiling (C0) is the backstop after they land.
//     C2b     an entry whose file no longer exists on disk is stale → fail (remove it).
//     C2c     an entry whose file now imports node:test is stale — the file was converted but the
//             list was not shortened → fail (remove it). This is the "converts when touched"
//             nudge: relation-sync's harness is the first intended application.
//     C2d     an entry that names a file OUTSIDE the canonical glob is meaningless → fail.
//   C3 (AC5)  a NEW file (in the glob, not on the exemption list, and not present in the baseline
//             file set at git HEAD) MUST carry a `// @test-group <product|engine|governance|serial|lowconc>`
//             declaration. Existing files (in the list, or already at HEAD) may omit it and
//             default to `engine` (存量缺省 engine — a missed declaration on a legacy/existing
//             file never silently vanishes from the default run). Scope note: "new" is classified
//             against git HEAD, so C3 is enforced at the point of introduction (the loop's
//             Audit-before-commit window), not retroactively on master — consistent with
//             存量缺省 engine (REFUTE round-1).
//
// The exemption list is a DATA FILE (AC2) — there is no per-file condition in code. The ratchet
// baseline is the list's own committed form at git HEAD; the check compares the working tree
// against that, PLUS the permanent count ceiling (C0). On bootstrap (the list does not exist at
// HEAD yet — e.g. the first commit of this task), the current list becomes the baseline and the
// git strict-subset is not yet enforceable; the ceiling still is, once the token exists. A broken
// git baseline FAILS CLOSED (exit 2) rather than silently degrading (REFUTE round-1 MINOR).
//
// SINGLE-SOURCE (ADR-004): the canonical glob patterns are PARSED from scripts/test.sh's own
// `glob=(...)` line, never re-typed here — if that glob changes, this check's notion of
// "canonical" follows automatically (same discipline as scripts/test-coverage-check.ts).
//
// Usage:
//   node test-framework-policy-check.ts [<workspace-root>] [--json] [--selftest]
//   node test-framework-policy-check.ts [--data-file <path>] [--baseline-file <path>] [--baseline-files <path>]
//
// Exit codes: 0 = all checks PASS; 1 = >=1 violation; 2 = usage/environment error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// gap-crystallization-five-directions ④: 位置判定原语抽到 checker-lib。
import { buildNonCodeMask, enumerativeExistence } from "./checker-lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The exemption list's repo-root-relative location (AC2 — a data file, not scattered code).
export const DATA_FILE_REL = "plugin/test-framework-policy-exemptions.txt";

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────

export function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/** True iff the nearest preceding CODE character (skipping comments/strings, which the mask marks
 * non-code) is a statement start — start of file, whitespace, or `;(){}[]`. Excludes `.`, so
 * `loader.import("node:test")` and `loader.require("node:test")` (method calls) are NOT read as
 * module imports (REFUTE round-2 MINOR). */
function atStatementStart(source: string, mask: Uint8Array, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && mask[j] === 1) j--;
  if (j < 0) return true;
  return /[\s;(){}\[\],]/.test(source[j]);
}

/** True iff `source` contains a REAL node:test import. Walks CODE positions only (skipping
 * comments, strings and regex literals via the mask) and checks each `import`/`require` keyword
 * in turn — so a comment that merely mentions the import (REFUTE round-1 MAJOR), a string literal
 * that spells it out, or a REGEX literal `/import { test } from "node:test"/` (REFUTE round-2
 * MINOR) is never an import, and a comment match can never SWALLOW a real import that follows it. */
export function hasNodeTestImport(source: string): boolean {
  const mask = buildNonCodeMask(source);
  const n = source.length;
  const isIdent = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_$]/.test(c);
  let i = 0;
  while (i < n) {
    if (mask[i] === 1) { i++; continue; }
    const c = source[i];
    // `import` keyword at a code position, word-bounded AND at a statement start (a method call
    // like `loader.import(...)` must not count).
    if (c === "i" && source.startsWith("import", i) && !isIdent(source[i - 1]) && !isIdent(source[i + 6]) && atStatementStart(source, mask, i)) {
      const rest = source.slice(i);
      // bare: import "node:test"; dynamic: import("node:test")
      if (/^import\s*["']node:test["']/.test(rest)) return true;
      if (/^import\(\s*["']node:test["']\s*\)/.test(rest)) return true;
      // named/default: import ... from "node:test" — scan CODE positions forward for `from`
      // at brace depth 0 (a comment between the clauses is skipped because it is masked).
      let j = i + 6;
      let depth = 0;
      while (j < n) {
        if (mask[j] === 0) {
          const cc = source[j];
          if (cc === ";" && depth === 0) break; // end of the import statement
          if (cc === "{") depth++;
          if (cc === "}") depth--;
          if (depth === 0 && cc === "f" && source.startsWith("from", j) && !isIdent(source[j - 1]) && !isIdent(source[j + 4])) {
            const spec = source.slice(j + 4).match(/^\s*["']([^"']+)["']/);
            if (spec && spec[1] === "node:test") return true;
            break; // this import's module specifier is not node:test
          }
        }
        j++;
      }
    }
    // `require` call at a code position, word-bounded, NOT a `.require` method call.
    if (c === "r" && source.startsWith("require", i) && !isIdent(source[i - 1]) && !isIdent(source[i + 7]) && atStatementStart(source, mask, i)) {
      if (/^require\(\s*["']node:test["']\s*\)/.test(source.slice(i))) return true;
    }
    i++;
  }
  return false;
}

/** Regex that matches a valid `// @test-group <product|engine|governance|serial|lowconc>` declaration.
 * `serial` is the KNOWN-LOAD-SENSITIVE family's group
 * (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests); `lowconc` is the
 * hermetic-but-load-sensitive family's group (gap-lowconc-group-concurrency-3-for-hermetic-load-
 * sensitive) — a NEW file may declare either. */
export function groupDeclRE(): RegExp {
  return /@test-group\s+(product|engine|governance|serial|lowconc)/;
}

/** Parse the exemption data file: one repo-relative path per line, '#' comments and blanks
 * ignored. Returns the raw entry list (unsorted, as authored). */
export function parseExemptionList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** Parse the RATCHET CEILING from the data file header: a `# baseline-count: <n>` line.
 * This is the commit-surviving AC4 backstop — the list can never exceed this many entries, even
 * at a clean commit where the git-HEAD baseline already moved past a smuggled addition (REFUTE
 * round-1 MAJOR). Returns null when the token is absent (no ceiling enforced). */
export function parseBaselineCount(text: string): number | null {
  const m = text.match(/^#\s*baseline-count:\s*(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

// ── glob parsing (single-source: read scripts/test.sh's own glob line) ─────────────────────────────

/** Parse the space-separated glob patterns out of `scripts/test.sh`'s `glob=(...)` line. */
export function parseCanonicalGlobs(repoRoot: string): string[] {
  const src = readFileSafe(path.join(repoRoot, "scripts", "test.sh"));
  const m = src.match(/glob=\(([^)]*)\)/);
  if (!m) return [];
  return m[1]
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function globSegmentToRegex(seg: string): RegExp {
  const escaped = seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

/** Expand one glob pattern (each `/`-segment MAY contain `*`) against `root`, returning absolute
 * paths. Supports exactly the whole-segment-wildcard shape scripts/test.sh uses. */
export function expandGlob(pattern: string, root: string): string[] {
  const segments = pattern.split("/");
  let current = [root];
  for (const seg of segments) {
    if (!seg.includes("*")) {
      current = current.map((dir) => path.join(dir, seg)).filter((p) => fs.existsSync(p));
      continue;
    }
    const re = globSegmentToRegex(seg);
    const next: string[] = [];
    for (const dir of current) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        entries = [];
      }
      for (const e of entries) {
        if (re.test(e)) next.push(path.join(dir, e));
      }
    }
    current = next;
  }
  return current.filter((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

/** The deduped, repo-root-relative set of files scripts/test.sh's canonical glob covers (same
 * realpath-deduplication scripts/test.sh uses via build_deduped_files). */
export function canonicalTestFiles(repoRoot: string): string[] {
  const patterns = parseCanonicalGlobs(repoRoot);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pattern of patterns) {
    for (const abs of expandGlob(pattern, repoRoot)) {
      const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
      let rp = abs;
      try {
        rp = fs.realpathSync(abs);
      } catch {
        rp = abs;
      }
      if (seen.has(rp)) continue;
      seen.add(rp);
      out.push(rel);
    }
  }
  return out.sort();
}

// ── the pure policy check ──────────────────────────────────────────────────────────────────────────

export interface TestFileInfo {
  rel: string;
  source: string;
}

export interface PolicyCheckInput {
  /** Glob-covered test files (deduped, repo-relative), with their source for detection. */
  files: TestFileInfo[];
  /** Parsed CURRENT exemption list (working tree). */
  exemptionList: string[];
  /** Parsed BASELINE exemption list (the list's committed form at git HEAD). [] = bootstrap. */
  baselineExemptionList: string[];
  /** Test-file paths (repo-relative) present in the baseline file set (git HEAD). Empty on
   * bootstrap → every existing file is treated as "existing", none as "new". */
  baselineTestFiles: Set<string>;
  /** RATCHET CEILING: the maximum number of exemption entries ever allowed (parsed from the
   * data file's own `# baseline-count: <n>` header). Commit-surviving backstop — it fires even
   * at a clean commit where the git-HEAD baseline already moved past a smuggled addition.
   * null = no ceiling enforced (token absent). */
  baselineCount: number | null;
  /** The ceiling value parsed from the BASELINE (git HEAD / --baseline-file) copy of the data
   * file. When both this and baselineCount are set and baselineCount > baselineCountHead, the
   * ceiling was RAISED in the working tree — a shrink-only ratchet on the ceiling itself
   * (REFUTE round-2 MINOR). null on bootstrap. */
  baselineCountHead: number | null;
  /** Predicate: does a repo-relative path exist on disk right now? */
  fileExists: (rel: string) => boolean;
}

/** Run all policy checks. Returns an array of human-readable violation strings; [] = PASS.
 * Pure: no fs/git — the caller supplies files, lists, and the existence predicate. */
export function runPolicyChecks(i: PolicyCheckInput): string[] {
  const failures: string[] = [];
  const exemptionSet = new Set(i.exemptionList);
  const baselineExemptionSet = new Set(i.baselineExemptionList);
  const bootstrap = i.baselineExemptionList.length === 0;
  const globSet = new Set(i.files.map((f) => f.rel));

  // C0a (AC4, commit-surviving ceiling): the list can never exceed the ratchet ceiling. Unlike
  // C2a (git-HEAD strict-subset, which only sees UNCOMMITTED additions), this fires at ANY
  // state — including a clean commit or a fresh clone where a smuggled hand-rolled test and its
  // exemption line landed together (REFUTE round-1 MAJOR). The ceiling is the task's 34,
  // parsed from the data file header.
  if (i.baselineCount !== null && i.exemptionList.length > i.baselineCount) {
    failures.push(
      `AC4: the exemption list has ${i.exemptionList.length} entries, over the ratchet ceiling of ${i.baselineCount} (${DATA_FILE_REL} header "# baseline-count"). The list can only get SHORTER — a new hand-rolled test can never be exempted.`
    );
  }

  // C0b (AC4, shrink-only ceiling): the ceiling itself can only get LOWER. Raising
  // `# baseline-count` in the working tree (34 → 40) to smuggle entries is caught here before it
  // can land; once committed, the git strict-subset can no longer see it, which is why the data
  // file header is the control surface and raising it in a commit is a code-review-grade edit.
  if (!bootstrap && i.baselineCountHead !== null && i.baselineCount !== null && i.baselineCount > i.baselineCountHead) {
    failures.push(
      `AC4: the ratchet ceiling was RAISED from ${i.baselineCountHead} to ${i.baselineCount} in ${DATA_FILE_REL} — the ceiling is shrink-only (it can only get LOWER). Do not raise it to admit more legacy files.`
    );
  }

  // C1 (AC3): every glob file must import node:test OR be on the exemption list.
  // 枚举式存在性 (checker-lib): 把 glob 文件分成「合规」与「违规」两个清单 — 缺席是清单里的事实,
  // 不是被布尔化压缩成「检查失败」的存在性。
  const { absent: nonCompliantFiles } = enumerativeExistence(i.files, (f) =>
    hasNodeTestImport(f.source) || exemptionSet.has(f.rel),
  );
  for (const f of nonCompliantFiles) {
    failures.push(
      `AC3: ${f.rel} uses the hand-rolled harness (no "node:test" import) and is NOT on the legacy exemption list (${DATA_FILE_REL}). New test files MUST import node:test.`
    );
  }

  if (!bootstrap) {
    // C2a (AC4 ratchet, working-tree): the list can only get SHORTER — an entry not in the
    // committed baseline was ADDED in the working tree (catches same-count swaps and header
    // edits before they land).
    for (const rel of i.exemptionList) {
      if (!baselineExemptionSet.has(rel)) {
        failures.push(
          `AC4: ${rel} was ADDED to the exemption list — the list can only get SHORTER. Convert the file to node:test instead; there is no way to exempt a new hand-rolled test.`
        );
      }
    }
  }

  // C2b / C2c / C2d — every exemption entry must be a real, still-hand-rolled, glob-covered file.
  for (const rel of i.exemptionList) {
    if (!i.fileExists(rel)) {
      failures.push(
        `AC4: exemption entry ${rel} no longer exists on disk — remove it from ${DATA_FILE_REL} (the list only shrinks).`
      );
      continue;
    }
    if (!globSet.has(rel)) {
      failures.push(
        `AC4: exemption entry ${rel} names a file OUTSIDE the canonical test glob — the list may only name glob-covered test files; remove it.`
      );
      continue;
    }
    const f = i.files.find((x) => x.rel === rel);
    if (f && hasNodeTestImport(f.source)) {
      failures.push(
        `AC4: exemption entry ${rel} now imports node:test — the file was converted but the list was not shortened. Remove it from ${DATA_FILE_REL} (the list only shrinks).`
      );
    }
  }

  // C3 (AC5): a NEW file (not legacy-exempt, not already present in the baseline) must declare a
  // valid @test-group. Existing files (in the list, or already at HEAD) default to `engine` and
  // need no declaration (存量缺省 engine — group_of() in scripts/test.sh already does this).
  for (const f of i.files) {
    if (exemptionSet.has(f.rel)) continue; // legacy: default engine
    if (i.baselineTestFiles.has(f.rel)) continue; // existing: default engine
    if (!groupDeclRE().test(f.source)) {
      failures.push(
        `AC5: ${f.rel} is a NEW test file (not on the exemption list, not in the committed tree) and has no VALID "// @test-group <product|engine|governance|serial|lowconc>" declaration (missing, or not product|engine|governance|serial|lowconc) — add one.`
      );
    }
  }

  return failures;
}

// ── git baseline resolution ─────────────────────────────────────────────────────────────────────────

/** True iff `git -C <root>` resolves a HEAD commit (usable git worktree). */
function gitHeadExists(root: string): boolean {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
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

function gitTestFilesAtRef(root: string, ref: string): Set<string> {
  const out = new Set<string>();
  let listing = "";
  try {
    listing = execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return out;
  }
  for (const line of listing.split(/\r?\n/)) {
    const rel = line.trim();
    if (!rel) continue;
    if (rel.endsWith(".test.mjs") && rel.split("/").includes("test")) out.add(rel);
  }
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function usage(): never {
  console.error(
    "usage: node test-framework-policy-check.ts [<workspace-root>] [--json] [--selftest]\n" +
      "       node test-framework-policy-check.ts [--data-file <path>] [--baseline-file <path>] [--baseline-files <path>]\n" +
      "Exit: 0 = PASS; 1 = violations; 2 = usage/environment error."
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--selftest")) {
    const ok = runSelftest();
    process.exit(ok ? 0 : 1);
  }
  const asJson = args.includes("--json");

  const positional = args.filter((a) => !a.startsWith("--"));
  const root = path.resolve(positional[0] ?? process.cwd());

  const dataFileRel =
    getArgValue(args, "--data-file") ??
    DATA_FILE_REL;
  const dataFileAbs = path.isAbsolute(dataFileRel)
    ? dataFileRel
    : path.join(root, dataFileRel);

  if (!fs.existsSync(path.join(root, "scripts", "test.sh"))) {
    console.error(`ERROR: ${path.join(root, "scripts", "test.sh")} not found — is <workspace-root> correct?`);
    process.exit(2);
  }

  const files = canonicalTestFiles(root).map((rel) => ({ rel, source: readFileSafe(path.join(root, rel)) }));
  const currentList = parseExemptionList(readFileSafe(dataFileAbs));

  // RATCHET CEILING (commit-surviving AC4): parsed from the data file's own header. If the token
  // is absent there is no ceiling — but the committed data file always carries it.
  const baselineCount = parseBaselineCount(readFileSafe(dataFileAbs));

  // Baseline: explicit --baseline-file / --baseline-files win; otherwise git HEAD. A broken git
  // baseline FAILS CLOSED (exit 2) — silently degrading to bootstrap would disable AC4/AC5 with a
  // green exit (REFUTE round-1 MINOR). The only legitimate "no baseline" is a TRUE bootstrap: the
  // data file genuinely does not exist at HEAD (the mechanism's own first commit).
  let baselineList = currentList;
  let baselineFiles = new Set(files.map((f) => f.rel)); // bootstrap default: nothing is "new"
  let baselineCountHead: number | null = null; // ceiling parsed from the HEAD/baseline copy
  const baselineFileArg = getArgValue(args, "--baseline-file");
  const baselineFilesArg = getArgValue(args, "--baseline-files");
  if (baselineFileArg) {
    const baselineText = readFileSafe(path.resolve(root, baselineFileArg));
    baselineList = parseExemptionList(baselineText);
    baselineCountHead = parseBaselineCount(baselineText);
  } else if (baselineFilesArg) {
    // baseline-files override alone: keep baselineList = currentList (no list ratchet), but pin
    // the file set so AC5's "new" classification has a baseline.
  } else {
    // No overrides — the git baseline is REQUIRED. Fail closed unless it is a true bootstrap.
    const gitOk = gitHeadExists(root);
    if (!gitOk) {
      console.error(
        "ERROR: test-framework-policy-check needs a git baseline (git HEAD) to enforce the AC4 ratchet and AC5 @test-group rule, but this is not a usable git worktree. " +
          "Pass --baseline-file/--baseline-files for a non-git fixture, or run in the real checkout."
      );
      process.exit(2);
    }
    const committed = gitShowFile(root, "HEAD", dataFileRel);
    if (committed === null) {
      // TRUE bootstrap: the data file is not yet committed (the mechanism's first commit). The
      // current list becomes the baseline; the ratchet starts being enforceable after this commit.
      baselineList = currentList;
      baselineFiles = new Set(files.map((f) => f.rel));
    } else {
      baselineList = parseExemptionList(committed);
      baselineCountHead = parseBaselineCount(committed);
      const atHead = gitTestFilesAtRef(root, "HEAD");
      if (atHead.size > 0) baselineFiles = atHead;
    }
  }
  if (baselineFilesArg) {
    baselineFiles = new Set(readFileSafe(path.resolve(root, baselineFilesArg)).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  }

  const failures = runPolicyChecks({
    files,
    exemptionList: currentList,
    baselineExemptionList: baselineList,
    baselineTestFiles: baselineFiles,
    baselineCountHead,
    baselineCount,
    fileExists: (rel) => fs.existsSync(path.join(root, rel)),
  });

  if (asJson) {
    console.log(JSON.stringify({ ok: failures.length === 0, files: files.length, exemptionCount: currentList.length, failures }, null, 2));
  } else {
    console.log(`test-framework-policy-check — ${files.length} glob file(s), ${currentList.length} exemption(s)`);
    if (failures.length === 0) {
      console.log("PASS: every test file uses node:test or is a listed legacy exemption; exemption list is at/below the ratchet ceiling and did not grow; new files declare @test-group.");
    } else {
      console.log(`FAIL: ${failures.length} violation(s):`);
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

// ── selftest (ADR-018 selfcheck-fixture pattern: demonstrate BOTH the RED and GREEN state) ───────────

export function runSelftest(): boolean {
  let pass = 0;
  let fail = 0;
  function check(name: string, cond: boolean, detail = "") {
    if (cond) {
      pass++;
    } else {
      fail++;
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    }
  }

  const nodeTestSource = '// @test-group engine\nimport { test } from "node:test";\ntest("x", () => {});\n';
  const legacySource = '// @test-group product\nfunction makeAssert() {}\nmakeAssert();\n';
  const legacyConverted = '// @test-group product\nimport { test } from "node:test";\n';
  const newNoGroup = '// plain\nimport { test } from "node:test";\n';
  const newBadGroup = '// @test-group nope\nimport { test } from "node:test";\n';

  // Helper: pure check with NO ratchet ceiling (the ceiling is exercised by dedicated cases).
  const pc = (o: Partial<PolicyCheckInput> & Pick<PolicyCheckInput, "files" | "exemptionList" | "baselineExemptionList" | "baselineTestFiles">) =>
    runPolicyChecks({ baselineCount: null, baselineCountHead: null, fileExists: () => true, ...o });

  // Glob-covered files: modern (at HEAD) + legacy (in the list AND at HEAD). NOT included:
  // the "new" files, which each RED case adds explicitly (they are not in `baselineFiles`,
  // so they are classified as NEW by C3 — the whole point of the AC5 cases).
  const files: TestFileInfo[] = [
    { rel: "packages/quay/test/modern.test.mjs", source: nodeTestSource },
    { rel: "packages/quay/test/legacy-handrolled.test.mjs", source: legacySource },
  ];
  const exemptionList = ["packages/quay/test/legacy-handrolled.test.mjs"];
  const baselineExemption = ["packages/quay/test/legacy-handrolled.test.mjs"];
  const baselineFiles = new Set(["packages/quay/test/modern.test.mjs", "packages/quay/test/legacy-handrolled.test.mjs"]);

  // GREEN baseline: legacy in list, modern at HEAD, both existing. Everything passes.
  let failures = pc({ files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("GREEN: compliant set passes", failures.length === 0, JSON.stringify(failures));

  // C1 (AC3) RED: a hand-rolled file NOT on the list (and not at baseline) — the "35th file".
  const c1Files = [...files, { rel: "packages/quay/test/other-handrolled.test.mjs", source: legacySource }];
  failures = pc({ files: c1Files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C1 RED: unlisted hand-rolled file fails", failures.some((f) => f.includes("other-handrolled") && f.includes("AC3")), JSON.stringify(failures));

  // C2a (AC4) RED: an entry ADDED to the list (not in baseline).
  const grownList = [...exemptionList, "packages/quay/test/other-handrolled.test.mjs"];
  failures = pc({ files: c1Files, exemptionList: grownList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C2a RED: added list entry fails", failures.some((f) => f.includes("ADDED to the exemption list")), JSON.stringify(failures));
  // ... and C1 is quiet for that same file once listed (exempt), so only the ratchet fires.
  check("C2a RED: listed file is exempt from C1", !failures.some((f) => f.includes("other-handrolled") && f.includes("AC3")), JSON.stringify(failures));

  // C2c RED: a listed entry whose file now imports node:test (converted but not removed).
  const c2cFiles = files.map((f) => (f.rel === "packages/quay/test/legacy-handrolled.test.mjs" ? { ...f, source: legacyConverted } : f));
  failures = pc({ files: c2cFiles, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C2c RED: converted-but-not-removed entry fails", failures.some((f) => f.includes("now imports node:test")), JSON.stringify(failures));

  // C2b RED: a listed entry whose file no longer exists.
  failures = pc({ files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles, fileExists: (rel) => rel !== "packages/quay/test/legacy-handrolled.test.mjs" });
  check("C2b RED: missing-file entry fails", failures.some((f) => f.includes("no longer exists")), JSON.stringify(failures));

  // C2d RED: a listed entry outside the glob (exists on disk but is NOT a glob-covered file).
  failures = pc({ files, exemptionList: [...exemptionList, "plugin/scripts/not-a-test.mjs"], baselineExemptionList: [...baselineExemption, "plugin/scripts/not-a-test.mjs"], baselineTestFiles: baselineFiles });
  check("C2d RED: non-glob entry fails", failures.some((f) => f.includes("OUTSIDE the canonical test glob")), JSON.stringify(failures));

  // C3 (AC5) RED: a NEW file (not at baseline) with no @test-group declaration.
  const c3Files = [...files, { rel: "packages/quay/test/brand-new.test.mjs", source: newNoGroup }];
  failures = pc({ files: c3Files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C3 RED: new file without @test-group fails", failures.some((f) => f.includes("brand-new") && f.includes("AC5")), JSON.stringify(failures));

  // C3 RED: new file with an INVALID group also fails (must be product|engine|governance).
  const c3bFiles = [...files, { rel: "packages/quay/test/brand-new-bad.test.mjs", source: newBadGroup }];
  failures = pc({ files: c3bFiles, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C3 RED: new file with invalid @test-group fails", failures.some((f) => f.includes("brand-new-bad") && f.includes("AC5")), JSON.stringify(failures));

  // C3 GREEN: the same new file WITH a valid declaration passes (and legacy + modern still pass).
  const c3gFiles = [...files, { rel: "packages/quay/test/brand-new-ok.test.mjs", source: nodeTestSource }];
  failures = pc({ files: c3gFiles, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C3 GREEN: new file with valid @test-group passes", failures.length === 0, JSON.stringify(failures));

  // bootstrap: empty baseline exemption → ratchet not enforceable (C2a silent), nothing is "new".
  failures = pc({ files: c1Files, exemptionList: grownList, baselineExemptionList: [], baselineTestFiles: new Set(c1Files.map((f) => f.rel)) });
  check("bootstrap: empty baseline passes (no C2a, no new-file requirement)", failures.length === 0, JSON.stringify(failures));

  // ── REFUTE round-1 regressions ──────────────────────────────────────────────────────────────────
  // Comment bypass (MAJOR): a comment mentioning a node:test import must NOT satisfy AC3, and
  // must NOT trigger C2c on a listed legacy file.
  const commentSneak = '// @test-group engine\n// TODO: migrate this to import { test } from "node:test"\nfunction makeAssert(){}\nmakeAssert();\n';
  check("comment-bypass: hand-rolled file with a node:test-comment is NOT node:test (AC3 fires)",
    hasNodeTestImport(commentSneak) === false, "comment must not count as an import");
  failures = pc({ files: [...files, { rel: "packages/quay/test/sneak.test.mjs", source: commentSneak }], exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("comment-bypass: sneaky hand-rolled file FAILS AC3", failures.some((f) => f.includes("sneak") && f.includes("AC3")), JSON.stringify(failures));
  // The same comment on a LISTED legacy file must NOT fire C2c (it did not convert).
  failures = pc({ files: files.map((f) => (f.rel === "packages/quay/test/legacy-handrolled.test.mjs" ? { ...f, source: commentSneak } : f)), exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("comment-bypass: listed legacy file with a node:test-comment is NOT reported converted", !failures.some((f) => f.includes("now imports node:test")), JSON.stringify(failures));

  // String-literal bypass: `require("node:test")` inside a string is not an import.
  const stringSneak = '// @test-group engine\nconst s = "require(\\\"node:test\\\")";\nfunction makeAssert(){}\nmakeAssert();\n';
  check("string-literal-bypass: require() inside a string is NOT an import", hasNodeTestImport(stringSneak) === false);

  // Count ceiling (MAJOR, commit-surviving AC4): a list over the ceiling fails even with a
  // baseline that already contains the extra entry (a clean commit / fresh clone).
  failures = runPolicyChecks({
    files: c1Files,
    exemptionList: grownList,
    baselineExemptionList: grownList, // HEAD already moved past the addition — the git subset is blind
    baselineTestFiles: new Set(c1Files.map((f) => f.rel)),
    baselineCount: 1, // ceiling of 1, list has 2
    baselineCountHead: 1,
    fileExists: () => true,
  });
  check("count-ceiling RED: list over the ceiling fails at a clean commit", failures.some((f) => f.includes("over the ratchet ceiling")), JSON.stringify(failures));

  // Count ceiling GREEN: list at/below the ceiling passes.
  failures = runPolicyChecks({
    files: c1Files,
    exemptionList: grownList,
    baselineExemptionList: grownList,
    baselineTestFiles: new Set(c1Files.map((f) => f.rel)),
    baselineCount: 2,
    baselineCountHead: 2,
    fileExists: () => true,
  });
  check("count-ceiling GREEN: list at the ceiling passes", failures.length === 0, JSON.stringify(failures));

  // Shrink-only ceiling (REFUTE round-2 MINOR): RAISING the ceiling in the working tree fails.
  failures = runPolicyChecks({
    files: c1Files,
    exemptionList: grownList, // 2 entries, ceiling raised to 2
    baselineExemptionList: grownList,
    baselineTestFiles: new Set(c1Files.map((f) => f.rel)),
    baselineCount: 2, // raised from 1
    baselineCountHead: 1,
    fileExists: () => true,
  });
  check("ceiling-bump RED: raising the ratchet ceiling fails", failures.some((f) => f.includes("ceiling was RAISED")), JSON.stringify(failures));

  // REFUTE round-2: a REGEX literal `/import { test } from "node:test"/` is NOT an import.
  const regexSneak = '// @test-group engine\nconst re = /import { test } from "node:test"/;\nfunction makeAssert(){}\nmakeAssert();\n';
  check("regex-literal: a regex spelling the import is NOT an import", hasNodeTestImport(regexSneak) === false, "regex literal must be masked");
  failures = pc({ files: [...files, { rel: "packages/quay/test/regex-sneak.test.mjs", source: regexSneak }], exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("regex-literal: regex-spelling file FAILS AC3", failures.some((f) => f.includes("regex-sneak") && f.includes("AC3")), JSON.stringify(failures));

  // REFUTE round-2: `loader.import("node:test")` (a method call) is NOT a dynamic import.
  const methodCall = '// @test-group engine\nloader.import("node:test");\nimport { test } from "node:test";\n';
  check("method-call: loader.import(...) is not a dynamic import", hasNodeTestImport(methodCall) === true, "the REAL import still counts");

  // REFUTE round-2: a `//` division with ++ / -- must NOT be read as a regex that hides imports.
  const divisionOk = 'const x = 5;\nlet a = 10;\nconst r = a / 2; // division\nx++ / 2;\nimport { test } from "node:test";\ntest("x", () => {});\n';
  check("division: x++ / 2 and a / 2 must not hide the real import", hasNodeTestImport(divisionOk) === true, "import after divisions must still be detected");

  console.log(`\ntest-framework-policy-check --selftest: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  process.exit(main(process.argv));
}
