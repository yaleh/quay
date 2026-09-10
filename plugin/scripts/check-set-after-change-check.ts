#!/usr/bin/env node
// check-set-after-change-check.ts — "which tests after a change?" mechanical selector
// (tasks/gap-check-set-after-change-diff-nameonly-intersect-judged-objects, A0b③ 判据指错检查对象).
//
// PROBLEM (manager 2026-08-12): after editing a file, "run the test that covers it" was left to
// the author's memory (A0b③ only said 覆盖它的那一个), and same-name is not enough — manager cp'd
// a new plugin/loop/manager-tick-core.md (bundle source doc) and ran tick-core-static-check, but
// that checker judges the orchestration/*-tick-core.md SOURCE, NOT the shipped plugin/loop COPY.
// The constraint that actually judges the copy is the TEST quay-init-loop-consumer-doc-refs
// (AC3: shipped docs have ZERO plugin/loop refs). Only a full-suite round (59, ~71 failures)
// surfaced the dimension. The author's "I ran the covering check" was a self-assertion.
//
// THIS CHECKER closes the loop mechanically: every test/checker SELF-DECLARES the objects it
// judges in its OWN file header (one or more `@judges <glob>…` lines — no central table; 判据放在
// 被约束者身上, so the mapping cannot drift from the test). A change's test set =
// git diff --name-only ∩ declared judged objects. Same-name tests are irrelevant — what matters
// is the intersection with the declared judged-object set.
//
// Declaration format (read ONLY from the leading comment block of a file):
//   test/script header:   // @judges <glob> <glob>…
//   shell header:         # @judges <glob> <glob>…
// Examples (AC1): plugin/test/quay-init-loop-consumer-doc-refs.test.mjs declares
//   // @judges plugin/loop/*
// because it constrains the shipped plugin/loop bundle docs; plugin/scripts/tick-core-static-check.ts
// declares
//   // @judges orchestration/*-tick-core.md
// because it judges the execution-core SOURCE.
//
// MODES:
//   default            — regression gate (the L_S-instrument for THIS mechanism). For the 12a6b18b
//                        cp case, the mechanically computed set for a change to
//                        plugin/loop/manager-tick-core.md MUST include the judging test
//                        (quay-init-loop-consumer-doc-refs) and MUST NOT include tick-core-static-
//                        check (which judges the orchestration source, not the shipped copy); a
//                        change to orchestration/manager-tick-core.md MUST include
//                        tick-core-static-check. Exit 0 iff all assertions hold. This is the
//                        "pre-commit" gate that would have blocked 12a6b18b without the full suite.
//   --changed <f>…     — compute and print the test/checker set for the given changed files
//                        (comma-separated and/or repeated --changed flags).
//   --diff <base>      — git diff --name-only <base> (working tree vs base) in --root, then
//                        compute over every changed file.
//   --json             — machine-readable output (all modes).
//   --root <dir>       — base directory (default: repo root via .quay/config.yml / git).
//
// Exit codes: 0 = PASS; 1 = FAIL (any regression assertion violated, or a missing scan surface);
// 2 = usage.

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import { matchGlob, normalizePath } from "./touches-orthogonality-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Scan surfaces (## Contract invariant — a missing target is an ERROR, never a silent green) ────
export const TEST_DIR_REL = path.join("plugin", "test");
export const SCRIPT_DIR_REL = path.join("plugin", "scripts");

/** The self-declaration marker this checker reads. Deliberately NOT `@static-object` (the OLD
 *  central registry in scripts/test.sh) — `@judges` is the new, unambiguous, file-header-only
 *  format introduced by A0b③, so a prose mention of `@static-object` (e.g. precommit-guard.ts:43)
 *  can never be mis-read as a declaration. */
const DECL_RE = /^\s*(?:\/\/|#)\s*@judges\s+(.+)$/;

// ── Regression cases (the 12a6b18b cp error chain, A0b③). The DoD's negative control. ────────────
export interface RegressionCase {
  name: string;
  changed: string;
  mustInclude: string[];
  mustExclude?: string[];
}
export const REGRESSION_CASES: RegressionCase[] = [
  {
    name: "plugin/loop copy change (12a6b18b cp error chain)",
    changed: path.join("plugin", "loop", "manager-tick-core.md"),
    mustInclude: [path.join("plugin", "scripts", "laydown-set-check.sh")],
    mustExclude: [path.join("plugin", "scripts", "tick-core-static-check.ts")],
  },
  {
    name: "orchestration source change",
    changed: path.join("orchestration", "manager-tick-core.md"),
    mustInclude: [path.join("plugin", "scripts", "tick-core-static-check.ts")],
  },
];

export interface Declaration {
  /** Repo-relative file path carrying the declaration. */
  file: string;
  /** test = plugin/test/*.mjs; checker = plugin/scripts/*.{ts,sh}. */
  kind: "test" | "checker";
  globs: string[];
}

export interface MatchResult {
  changedFile: string;
  matchedDeclarations: Declaration[];
  tests: string[];
  checkers: string[];
}

// ── Pure helpers ───────────────────────────────────────────────────────────────────────────────────

/** Return the leading comment block of a source file (blank lines and comment lines only). The
 *  declarations live in the header, never in code/fixture text — 按位置不按关键词 (CLAUDE.md 硬规则 2). */
export function leadingCommentBlock(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    if (
      t === "" ||
      t.startsWith("//") ||
      t.startsWith("#") ||
      t.startsWith("/*") ||
      t.startsWith("*") ||
      t.startsWith("*/")
    ) {
      out.push(raw);
    } else {
      break;
    }
  }
  return out;
}

/** Parse one header line for an `@judges` declaration. Returns the declared globs, or null if the
 *  line is not an `@judges` declaration. */
export function parseJudgesLine(line: string): string[] | null {
  const m = line.match(DECL_RE);
  if (!m) return null;
  const globs = m[1].trim().split(/\s+/).filter(Boolean);
  return globs.length > 0 ? globs : null;
}

/** Extract a Declaration from a file's leading comment block, or null if it declares no `@judges`. */
export function declarationFromFile(relPath: string, absPath: string): Declaration | null {
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return null; // a scan target that vanished — caller decides fail-closed vs skip
  }
  const kind: Declaration["kind"] = relPath.startsWith(TEST_DIR_REL + path.sep) ? "test" : "checker";
  const globs: string[] = [];
  for (const line of leadingCommentBlock(text)) {
    const found = parseJudgesLine(line);
    if (found) globs.push(...found);
  }
  if (globs.length === 0) return null;
  return { file: normalizePath(relPath), kind, globs: [...new Set(globs)] };
}

/** Scan the plugin/test + plugin/scripts surfaces under root for self-declared judged objects. */
export function scanDeclarations(root: string): Declaration[] {
  const declarations: Declaration[] = [];
  const testDir = path.join(root, TEST_DIR_REL);
  const scriptDir = path.join(root, SCRIPT_DIR_REL);
  if (fs.existsSync(testDir)) {
    for (const f of fs.readdirSync(testDir)) {
      if (!f.endsWith(".mjs")) continue;
      const rel = path.join(TEST_DIR_REL, f);
      const d = declarationFromFile(rel, path.join(testDir, f));
      if (d) declarations.push(d);
    }
  }
  if (fs.existsSync(scriptDir)) {
    for (const f of fs.readdirSync(scriptDir)) {
      if (!(f.endsWith(".ts") || f.endsWith(".sh"))) continue;
      const rel = path.join(SCRIPT_DIR_REL, f);
      const d = declarationFromFile(rel, path.join(scriptDir, f));
      if (d) declarations.push(d);
    }
  }
  return declarations;
}

/** Compute the matched test/checker set for ONE changed file. */
export function computeForChanged(changedFile: string, declarations: Declaration[]): MatchResult {
  const c = normalizePath(changedFile);
  const matched = declarations.filter((d) => d.globs.some((g) => matchGlob(g, c)));
  const tests = matched.filter((d) => d.kind === "test").map((d) => d.file).sort();
  const checkers = matched.filter((d) => d.kind === "checker").map((d) => d.file).sort();
  return { changedFile: c, matchedDeclarations: matched, tests, checkers };
}

export interface RegressionResult {
  ok: boolean;
  failures: string[];
  details: { name: string; changed: string; tests: string[]; checkers: string[] }[];
}

/** Run the regression gate over the declared judged-object set. */
export function runRegression(root: string): RegressionResult {
  const declarations = scanDeclarations(root);
  const failures: string[] = [];
  const details: RegressionResult["details"] = [];
  for (const c of REGRESSION_CASES) {
    const r = computeForChanged(c.changed, declarations);
    const all = [...r.tests, ...r.checkers];
    details.push({ name: c.name, changed: c.changed, tests: r.tests, checkers: r.checkers });
    for (const inc of c.mustInclude) {
      if (!all.includes(inc)) {
        failures.push(
          `${c.name}: change to ${c.changed} must select ${inc} (declared judge missing from the mechanically computed set)`,
        );
      }
    }
    for (const exc of c.mustExclude || []) {
      if (all.includes(exc)) {
        failures.push(
          `${c.name}: change to ${c.changed} must NOT select ${exc} (a checker that does not judge this object was wrongly included)`,
        );
      }
    }
  }
  return { ok: failures.length === 0, failures, details };
}


// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `Usage:
  check-set-after-change-check.ts [--root <dir>]                 # regression gate (default)
  check-set-after-change-check.ts --changed <file>[,<file>...] [--root <dir>] [--json]
  check-set-after-change-check.ts --diff <base> [--root <dir>] [--json]
Flags:
  --changed <f>…   changed file(s) to compute the judged-object set for (repeatable / comma-separated)
  --diff <base>    git diff --name-only <base> in --root, then compute over every changed file
  --root <dir>     base directory (default: repo root)
  --json           machine-readable JSON output
  --help           this help (exit 0)`;

function main(argv: string[]): { code: number; json?: unknown } {
  let root = "";
  const changed: string[] = [];
  let diffBase = "";
  let json = false;

  const args = argv.slice();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(`${USAGE}\n`);
      return { code: 0 };
    } else if (a === "--root") {
      root = args[++i] ?? "";
    } else if (a === "--json") {
      json = true;
    } else if (a === "--changed") {
      const v = args[++i] ?? "";
      for (const f of v.split(",")) {
        const t = f.trim();
        if (t) changed.push(t);
      }
    } else if (a === "--diff") {
      diffBase = args[++i] ?? "";
    } else if (a.startsWith("--")) {
      process.stderr.write(`check-set-after-change-check: unknown flag ${a}\n${USAGE}\n`);
      return { code: 2 };
    } else {
      // bare positional — treat as a changed file (convenience for `--changed` without the flag)
      changed.push(a);
    }
  }

  if (!root) root = repoRoot();
  if (!fs.existsSync(path.join(root, "plugin"))) {
    process.stderr.write(`check-set-after-change-check: scan surface plugin/ missing under --root ${root}\n`);
    return { code: 1 };
  }

  const declarations = scanDeclarations(root);

  // ── --changed / --diff: the actual "which tests after this change" mechanism ───────────────────
  if (diffBase) {
    let out: string;
    try {
      out = execFileSync("git", ["diff", "--name-only", diffBase], {
        cwd: root,
        encoding: "utf8",
        timeout: 15_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (e) {
      process.stderr.write(`check-set-after-change-check: git diff --name-only ${diffBase} failed: ${(e as Error).message}\n`);
      return { code: 1 };
    }
    for (const f of out.split("\n")) {
      const t = f.trim();
      if (t) changed.push(t);
    }
  }

  if (changed.length > 0) {
    const results = [...new Set(changed)].map((f) => computeForChanged(f, declarations));
    if (json) {
      process.stdout.write(`${JSON.stringify({ declarations, results }, null, 2)}\n`);
      return { code: 0 };
    }
    process.stdout.write(`check-set-after-change-check: ${declarations.length} declared judged-object sets scanned\n`);
    for (const r of results) {
      process.stdout.write(`  ${r.changedFile}\n`);
      process.stdout.write(`    matched tests:   ${r.tests.length ? r.tests.join(", ") : "(none)"}\n`);
      process.stdout.write(`    matched checkers: ${r.checkers.length ? r.checkers.join(", ") : "(none)"}\n`);
    }
    return { code: 0 };
  }

  // ── default: regression gate (the L_S instrument for this mechanism) ───────────────────────────
  const res = runRegression(root);
  const foundFiles = new Set<string>();
  for (const d of declarations) foundFiles.add(d.file);
  const missingSurface =
    !fs.existsSync(path.join(root, TEST_DIR_REL)) && !fs.existsSync(path.join(root, SCRIPT_DIR_REL))
      ? [`scan surface plugin/test + plugin/scripts missing under --root ${root}`]
      : [];
  const failures = [...missingSurface, ...res.failures];

  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, failures, cases: res.details, declarations }, null, 2)}\n`);
    return { code: failures.length === 0 ? 0 : 1 };
  }

  process.stdout.write(`check-set-after-change-check: ${declarations.length} declared judged-object sets scanned under ${root}\n`);
  for (const d of declarations) {
    process.stdout.write(`  ${d.file}  →  ${d.globs.join(" ")}\n`);
  }
  for (const d of res.details) {
    process.stdout.write(`\nCASE — ${d.name}\n`);
    process.stdout.write(`  changed: ${d.changed}\n`);
    process.stdout.write(`  matched tests:    ${d.tests.length ? d.tests.join(", ") : "(none)"}\n`);
    process.stdout.write(`  matched checkers: ${d.checkers.length ? d.checkers.join(", ") : "(none)"}\n`);
  }
  for (const f of failures) process.stdout.write(`  FAIL: ${f}\n`);
  if (failures.length === 0) {
    process.stdout.write(`\ncheck-set-after-change-check: PASS — the 12a6b18b cp error chain would be caught before commit (plugin/loop copy change selects the judging test, never tick-core-static-check).\n`);
    return { code: 0 };
  }
  process.stdout.write(`\ncheck-set-after-change-check: RED — the mechanically computed judged-object set is wrong for the regression case.\n`);
  return { code: 1 };
}

if (isDirectEntry(import.meta)) {
  const r = main(process.argv.slice(2));
  process.exitCode = r.code;
}
