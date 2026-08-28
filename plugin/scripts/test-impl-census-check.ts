#!/usr/bin/env node
// test-impl-census-check.ts — gap-experiment-legacy-reclaim-and-touches-heuristic AC5: mechanize the
// criterion "被测实现不存在的测试文件应随实现删除" (a test file whose tested implementation does not
// exist should be removed WITH the implementation, so it stops running every full suite carrying
// zero info about the current system).
//
// The rule is deliberately the LITERAL one from the task's 判据建议: a test file is FLAGGED when it
// imports a `scripts/<name>` module that does not exist anywhere it could live
// (`experiments/quay-perpetual-stream/scripts/`, `plugin/scripts/`, or the packages source the test
// sits under). When a script is deleted/reclaimed WITHOUT deleting its test, this checker goes RED —
// the delete must be accompanied by the test delete (or the test must be re-pointed), so impl-deleted
// tests can never silently re-accumulate (the census measured 46 test files / 15 impl-deleted).
//
// CONSERVATIVE on purpose (false positives are worse than misses for a ratchet that must not nag):
//   - Only `…/scripts/<name>` import targets count as "the tested implementation". A test that
//     imports a test-LOCAL helper (`./helper.mjs`, `./x.ts` created at test-time) or a helper under
//     `test/helpers/` is not an impl-deleted test — those are test infrastructure, not the impl.
//   - A test file with NO `scripts/` import at all (e.g. a mechanism contract test like
//     symlink-mirror-invocation.test.mjs) is NOT flagged — it tests a cross-cutting mechanism, not a
//     single deleted script.
//   - Resolution checks the scripts dir adjacent to the test AND `plugin/scripts/` AND the
//     experiments scripts dir (a test under `experiments/*/test/` may import a plugin-reclaimed
//     script through the mirror symlink, which resolves to a real plugin/scripts file).
//
// Single-source (ADR-004): the canonical glob is PARSED from scripts/test.sh's own `glob=(...)`
// line (same helper shape as test-framework-policy-check.ts) — never re-typed here.
//
// Usage:
//   node test-impl-census-check.ts [<workspace-root>] [--json] [--selftest]
// Exit codes: 0 = PASS (no impl-deleted test file); 1 = >=1 flagged; 2 = usage/environment error.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helpExit, readFileSafe } from "./gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── glob parsing (single-source: read scripts/test.sh's own glob line) ─────────────────────────────
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

function expandGlob(pattern: string, root: string): string[] {
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

/** The deduped, repo-root-relative set of files scripts/test.sh's canonical glob covers. */
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

// ── the census ────────────────────────────────────────────────────────────────────────────────────
const SCRIPTS_DIRS = [
  (root: string) => path.join(root, "plugin", "scripts"),
  (root: string) => path.join(root, "experiments", "quay-perpetual-stream", "scripts"),
];

/** Which scripts dir(s) a given test file's `scripts/` import target may live in. */
function candidateScriptDirsFor(testRel: string, repoRoot: string): string[] {
  // A test under `packages/*/test/` imports `../scripts/…` = `<pkg>/scripts/…`; a test under
  // `plugin/test/` or `experiments/*/test/` imports `../scripts/…` = the plugin/experiments
  // scripts dir (via symlink mirror). Also cover the repo-root `scripts/` dir (test-coverage-check
  // and its siblings live there) plus the shared plugin/experiments script roots.
  const dirs: string[] = [];
  const parts = testRel.split("/");
  if (parts[0] === "packages" && parts.length >= 3) {
    dirs.push(path.join(repoRoot, "packages", parts[1], "scripts"));
  }
  dirs.push(path.join(repoRoot, "scripts"));
  for (const f of SCRIPTS_DIRS) {
    const d = f(repoRoot);
    if (!dirs.includes(d)) dirs.push(d);
  }
  return dirs;
}

/** Extract `…/scripts/<name>` import specifiers from a test file's source (comment-stripped). */
export function scriptImportTargets(source: string): string[] {
  const noComments = String(source).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  const seen = new Set<string>();
  // Matches `import … from "…/scripts/<name>"` and `… from '…/scripts/<name>'`.
  const re = /from\s+["']([^"']*\/scripts\/[^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push(m[1]);
  }
  return out;
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p) || fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Resolve a `…/scripts/<name>` import specifier from a test file. Returns the absolute path. */
function resolveFromTest(testAbs: string, spec: string): string {
  return path.resolve(path.dirname(testAbs), spec);
}

function findInScriptDirs(basename: string, dirs: string[]): boolean {
  return dirs.some((d) => fileExists(path.join(d, basename)));
}

export interface ImplCensusResult {
  flagged: { test: string; missingTargets: string[] }[];
  checked: number;
  clean: number;
}

/** The census: flag glob test files whose `scripts/` import targets resolve nowhere. A specifier is
 * a miss only if BOTH the literal resolved path AND the basename in every known scripts dir fail —
 * so a `../../scripts/test-coverage-check.ts` (repo-root scripts/ script) resolves cleanly. */
export function runCensus(repoRoot: string): ImplCensusResult {
  const files = canonicalTestFiles(repoRoot);
  const flagged: { test: string; missingTargets: string[] }[] = [];
  for (const rel of files) {
    const abs = path.join(repoRoot, rel);
    const source = readFileSafe(abs);
    const specs = scriptImportTargets(source);
    if (specs.length === 0) continue; // no scripts/ import → not an impl-deleted test
    const dirs = candidateScriptDirsFor(rel, repoRoot);
    const missing: string[] = [];
    for (const spec of specs) {
      if (fileExists(resolveFromTest(abs, spec))) continue; // literal relative path resolves
      const basename = path.posix.basename(spec);
      if (findInScriptDirs(basename, dirs)) continue; // exists in a known scripts dir
      missing.push(spec);
    }
    if (missing.length > 0) {
      flagged.push({ test: rel, missingTargets: missing });
    }
  }
  return { flagged, checked: files.length, clean: files.length - flagged.length };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node test-impl-census-check.ts [--root <dir>] [--json] [--selftest]");
  let root = process.cwd();
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") files.push(args[i]);
    else if (args[i] === "--selftest") files.push(args[i]);
    else if (args[i] === "--root" && i + 1 < args.length) root = path.resolve(args[++i]);
    else files.push(args[i]);
  }
  const asJson = files.includes("--json");
  const selfTest = files.includes("--selftest");
  if (selfTest) {
    return selfTestMain();
  }
  if (!fs.existsSync(path.join(root, "scripts", "test.sh"))) {
    console.error("ERROR: not a quay workspace root (no scripts/test.sh) — pass --root <repo-root>");
    return 2;
  }
  const result = runCensus(root);
  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    for (const f of result.flagged) {
      console.log(`FLAGGED: ${f.test} — tested impl deleted, missing: ${f.missingTargets.join(", ")}`);
    }
    console.log(
      `test-impl-census: checked ${result.checked} test files · clean ${result.clean} · impl-deleted ${result.flagged.length}`
    );
  }
  return result.flagged.length > 0 ? 1 : 0;
}

// ── selftest (mutation-case surface) ──────────────────────────────────────────────────────────────
function selfTestMain(): number {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-impl-census-selftest-"));
  let failures = 0;
  try {
    // A minimal fake repo root with scripts/test.sh carrying the canonical glob line.
    const root = path.join(tmp, "repo");
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, "plugin", "test"), { recursive: true });
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, "experiments", "quay-perpetual-stream", "test"), { recursive: true });
    fs.mkdirSync(path.join(root, "experiments", "quay-perpetual-stream", "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "scripts", "test.sh"),
      `glob=(plugin/test/*.test.mjs experiments/quay-perpetual-stream/test/*.test.mjs)\n`
    );
    // Live impl + its test → GREEN.
    fs.writeFileSync(path.join(root, "plugin", "scripts", "live-thing.ts"), "export const x = 1;\n");
    fs.writeFileSync(
      path.join(root, "plugin", "test", "live-thing.test.mjs"),
      `import { x } from "../scripts/live-thing.ts";\n`
    );
    // Deleted impl + still-present test → must FLAG (RED).
    fs.writeFileSync(
      path.join(root, "experiments", "quay-perpetual-stream", "test", "dead-thing.test.mjs"),
      `import { y } from "../scripts/dead-thing.ts";\n`
    );
    // Impl EXISTS in the mirror scripts dir (symlink to plugin) → GREEN.
    fs.symlinkSync(
      path.join(root, "plugin", "scripts", "live-thing.ts"),
      path.join(root, "experiments", "quay-perpetual-stream", "scripts", "live-thing.ts")
    );
    fs.writeFileSync(
      path.join(root, "experiments", "quay-perpetual-stream", "test", "mirror-thing.test.mjs"),
      `import { x } from "../scripts/live-thing.ts";\n`
    );
    // No scripts/ import at all (mechanism test) → NOT flagged (GREEN).
    fs.writeFileSync(
      path.join(root, "plugin", "test", "no-impl.test.mjs"),
      `import { test } from "node:test"; test("x", () => {});\n`
    );

    const result = runCensus(root);
    const flaggedTests = result.flagged.map((f) => f.test);
    if (!flaggedTests.includes("experiments/quay-perpetual-stream/test/dead-thing.test.mjs")) {
      console.error("SELFTEST RED-LEAK: impl-deleted test was not flagged");
      failures++;
    }
    if (flaggedTests.includes("plugin/test/live-thing.test.mjs")) {
      console.error("SELFTEST FALSE-POSITIVE: live test flagged");
      failures++;
    }
    if (flaggedTests.includes("experiments/quay-perpetual-stream/test/mirror-thing.test.mjs")) {
      console.error("SELFTEST FALSE-POSITIVE: mirror-symlink test flagged");
      failures++;
    }
    if (flaggedTests.includes("plugin/test/no-impl.test.mjs")) {
      console.error("SELFTEST FALSE-POSITIVE: mechanism test (no scripts/ import) flagged");
      failures++;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failures === 0) {
    console.log("SELFTEST PASS: impl-deleted test flagged; live/mirror/no-impl tests clean.");
    return 0;
  }
  console.error(`SELFTEST FAIL: ${failures} assertion(s)`);
  return 2;
}

if (process.argv[1] && path.basename(process.argv[1]) === "test-impl-census-check.ts") {
  process.exit(main(process.argv));
}
