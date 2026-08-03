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
//   C1 (AC3)  every file in scripts/test.sh's canonical glob must `import` node:test OR be on
//             the legacy exemption list (plugin/test-framework-policy-exemptions.txt).
//   C2 (AC4)  the exemption list can only get SHORTER:
//     C2a     an entry present in the current list but NOT in the baseline (the list's committed
//             form at git HEAD) was ADDED → fail. This is the ratchet: no file may be added.
//     C2b     an entry whose file no longer exists on disk is stale → fail (remove it).
//     C2c     an entry whose file now imports node:test is stale — the file was converted but the
//             list was not shortened → fail (remove it). This is the "converts when touched"
//             nudge: relation-sync's harness is the first intended application.
//     C2d     an entry that names a file OUTSIDE the canonical glob is meaningless → fail.
//   C3 (AC5)  a NEW file (in the glob, not on the exemption list, and not present in the baseline
//             file set at git HEAD) MUST carry a `// @test-group <product|engine|governance>`
//             declaration. Existing files (in the list, or already at HEAD) may omit it and
//             default to `engine` (存量缺省 engine — a missed declaration on a legacy/existing
//             file never silently vanishes from the default run).
//
// The exemption list is a DATA FILE (AC2) — there is no per-file condition in code. The ratchet
// baseline is the list's own committed form at git HEAD; the check compares the working tree
// against that. On bootstrap (the list does not exist at HEAD yet — e.g. the first commit of this
// task), the current list becomes the baseline and the ratchet is not yet enforceable.
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

/** Regex that detects an actual `node:test` import (ESM `from "node:test"` / bare `import
 * "node:test"`, plus a CJS `require("node:test")` hedge). Not a bare `node:test` substring, so a
 * comment mentioning the policy cannot satisfy it. */
export function nodeTestImportRE(): RegExp {
  return /(?:from\s*["']node:test["']|import\s*["']node:test["']|require\(\s*["']node:test["']\s*\))/;
}

/** Regex that matches a valid `// @test-group <product|engine|governance>` declaration. */
export function groupDeclRE(): RegExp {
  return /@test-group\s+(product|engine|governance)/;
}

/** Parse the exemption data file: one repo-relative path per line, '#' comments and blanks
 * ignored. Returns the raw entry list (unsorted, as authored). */
export function parseExemptionList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
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

  // C1 (AC3): every glob file must import node:test OR be on the exemption list.
  for (const f of i.files) {
    if (nodeTestImportRE().test(f.source)) continue;
    if (exemptionSet.has(f.rel)) continue;
    failures.push(
      `AC3: ${f.rel} uses the hand-rolled harness (no "node:test" import) and is NOT on the legacy exemption list (${DATA_FILE_REL}). New test files MUST import node:test.`
    );
  }

  if (!bootstrap) {
    // C2a (AC4 ratchet): the list can only get SHORTER — an entry not in the baseline was ADDED.
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
    if (f && nodeTestImportRE().test(f.source)) {
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
        `AC5: ${f.rel} is a NEW test file (not on the exemption list, not in the committed tree) and has no VALID "// @test-group <product|engine|governance>" declaration (missing, or not product|engine|governance) — add one.`
      );
    }
  }

  return failures;
}

// ── git baseline resolution ─────────────────────────────────────────────────────────────────────────

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

  // Baseline: explicit --baseline-file / --baseline-files win; otherwise git HEAD.
  let baselineList = currentList;
  let baselineFiles = new Set(files.map((f) => f.rel)); // bootstrap default: nothing is "new"
  const baselineFileArg = getArgValue(args, "--baseline-file");
  if (baselineFileArg) {
    baselineList = parseExemptionList(readFileSafe(path.resolve(root, baselineFileArg)));
  } else {
    const committed = gitShowFile(root, "HEAD", dataFileRel);
    if (committed !== null) {
      baselineList = parseExemptionList(committed);
    } // null → bootstrap: baseline = current list (ratchet not yet enforceable)
  }
  const baselineFilesArg = getArgValue(args, "--baseline-files");
  if (baselineFilesArg) {
    baselineFiles = new Set(readFileSafe(path.resolve(root, baselineFilesArg)).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  } else {
    const atHead = gitTestFilesAtRef(root, "HEAD");
    if (atHead.size > 0) baselineFiles = atHead;
  }

  const failures = runPolicyChecks({
    files,
    exemptionList: currentList,
    baselineExemptionList: baselineList,
    baselineTestFiles: baselineFiles,
    fileExists: (rel) => fs.existsSync(path.join(root, rel)),
  });

  if (asJson) {
    console.log(JSON.stringify({ ok: failures.length === 0, files: files.length, exemptionCount: currentList.length, failures }, null, 2));
  } else {
    console.log(`test-framework-policy-check — ${files.length} glob file(s), ${currentList.length} exemption(s)`);
    if (failures.length === 0) {
      console.log("PASS: every test file uses node:test or is a listed legacy exemption; exemption list did not grow; new files declare @test-group.");
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
  let failures = runPolicyChecks({ files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles, fileExists: () => true });
  check("GREEN: compliant set passes", failures.length === 0, JSON.stringify(failures));

  // C1 (AC3) RED: a hand-rolled file NOT on the list (and not at baseline) — the "35th file".
  const c1Files = [...files, { rel: "packages/quay/test/other-handrolled.test.mjs", source: legacySource }];
  failures = runPolicyChecks({ files: c1Files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles, fileExists: () => true });
  check("C1 RED: unlisted hand-rolled file fails", failures.some((f) => f.includes("other-handrolled") && f.includes("AC3")), JSON.stringify(failures));

  // C2a (AC4) RED: an entry ADDED to the list (not in baseline).
  const grownList = [...exemptionList, "packages/quay/test/other-handrolled.test.mjs"];
  failures = runPolicyChecks({ files: c1Files, exemptionList: grownList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles, fileExists: () => true });
  check("C2a RED: added list entry fails", failures.some((f) => f.includes("ADDED to the exemption list")), JSON.stringify(failures));
  // ... and C1 is quiet for that same file once listed (exempt), so only the ratchet fires.
  check("C2a RED: listed file is exempt from C1", !failures.some((f) => f.includes("other-handrolled") && f.includes("AC3")), JSON.stringify(failures));

  // C2c RED: a listed entry whose file now imports node:test (converted but not removed).
  const c2cFiles = files.map((f) => (f.rel === "packages/quay/test/legacy-handrolled.test.mjs" ? { ...f, source: legacyConverted } : f));
  failures = runPolicyChecks({ files: c2cFiles, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles, fileExists: () => true });
  check("C2c RED: converted-but-not-removed entry fails", failures.some((f) => f.includes("now imports node:test")), JSON.stringify(failures));

  // C2b RED: a listed entry whose file no longer exists.
  failures = runPolicyChecks({ files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles, fileExists: (rel) => rel !== "packages/quay/test/legacy-handrolled.test.mjs" });
  check("C2b RED: missing-file entry fails", failures.some((f) => f.includes("no longer exists")), JSON.stringify(failures));

  // C2d RED: a listed entry outside the glob (exists on disk but is NOT a glob-covered file).
  failures = runPolicyChecks({ files, exemptionList: [...exemptionList, "plugin/scripts/not-a-test.mjs"], baselineExemptionList: [...baselineExemption, "plugin/scripts/not-a-test.mjs"], baselineTestFiles: baselineFiles, fileExists: () => true });
  check("C2d RED: non-glob entry fails", failures.some((f) => f.includes("OUTSIDE the canonical test glob")), JSON.stringify(failures));

  // C3 (AC5) RED: a NEW file (not at baseline) with no @test-group declaration.
  const c3Files = [...files, { rel: "packages/quay/test/brand-new.test.mjs", source: newNoGroup }];
  failures = runPolicyChecks({ files: c3Files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles, fileExists: () => true });
  check("C3 RED: new file without @test-group fails", failures.some((f) => f.includes("brand-new") && f.includes("AC5")), JSON.stringify(failures));

  // C3 RED: new file with an INVALID group also fails (must be product|engine|governance).
  const c3bFiles = [...files, { rel: "packages/quay/test/brand-new-bad.test.mjs", source: newBadGroup }];
  failures = runPolicyChecks({ files: c3bFiles, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles, fileExists: () => true });
  check("C3 RED: new file with invalid @test-group fails", failures.some((f) => f.includes("brand-new-bad") && f.includes("AC5")), JSON.stringify(failures));

  // C3 GREEN: the same new file WITH a valid declaration passes (and legacy + modern still pass).
  const c3gFiles = [...files, { rel: "packages/quay/test/brand-new-ok.test.mjs", source: nodeTestSource }];
  failures = runPolicyChecks({ files: c3gFiles, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles, fileExists: () => true });
  check("C3 GREEN: new file with valid @test-group passes", failures.length === 0, JSON.stringify(failures));

  // bootstrap: empty baseline exemption → ratchet not enforceable (C2a silent), nothing is "new".
  failures = runPolicyChecks({ files: c1Files, exemptionList: grownList, baselineExemptionList: [], baselineTestFiles: new Set(c1Files.map((f) => f.rel)), fileExists: () => true });
  check("bootstrap: empty baseline passes (no C2a, no new-file requirement)", failures.length === 0, JSON.stringify(failures));

  console.log(`\ntest-framework-policy-check --selftest: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  process.exit(main(process.argv));
}
