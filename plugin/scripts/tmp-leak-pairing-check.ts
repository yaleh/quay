#!/usr/bin/env node
// tmp-leak-pairing-check.ts — mechanical gate: every mkdtemp/mkdtempSync result in a test file
// MUST be paired with a cleanup. The 2026-08-12 /tmp audit measured 3389 leftover dirs / 1.1GB
// across five prefixes (quay-migrate-*, frontmatter-store-base-*, cli-entry-test-*,
// quay-backlog-fixture-*, rtv-*); the hygiene+correctness cost (slower /tmp ops, hidden real
// state, cross-test name collisions) is the driver — not the bytes.
//
// The pairing requirement is the "修完不复发" guarantee: once a leaking file is fixed, an unpaired
// mkdtemp can never be re-introduced without this gate going RED. It BLOCKS (exit 1) on any
// violation — unlike test-isolation-check's R6 rule, which reports the same class but is baselined
// (报出而不阻断). Two layers, one detector:
//   - R6 in test-isolation-check.ts  — reports, shrink-only ratchet baseline.
//   - THIS gate                      — blocks on anything unpaired (no baseline; the corpus is
//     expected to be at zero after the leak fix).
//
// PAIRING HEURISTIC (delegated to test-isolation-check.ts's detectMkdtempNoCleanup — the same
// tested code-position detector, never a hand-rolled copy): a variable-assigned mkdtemp result is
// covered when (a) the variable is rmSync'd/unlinkSync'd inside a cleanup region (rm call,
// after/afterEach hook, finally block), OR (b) the variable is pushed into a carrier array that is
// referenced inside a cleanup region (the doc-store/adr-store `_createdDirs` + after() pattern),
// OR (c) the variable is returned from a helper whose call sites capture-and-clean the return. An
// inline mkdtemp (no assigned variable) is lenient-skipped unless it is a bare
// `return fs.mkdtempSync(...)` with no caller cleaning. Files whose mkdtemp lives in a shared
// fixture/prefix-cleanup helper (plugin/test/helpers/tmp-workspace.mjs) carry no mkdtemp in their
// own source and are trivially clean.
//
// Usage:
//   node tmp-leak-pairing-check.ts [<workspace-root>] [--selftest] [--files <rel> ...]
//
// Exit codes: 0 = every mkdtemp is paired with a cleanup; 1 = >=1 unpaired mkdtemp; 2 = usage/env.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectMkdtempNoCleanup } from "./test-isolation-check.ts";
import { helpExit, readFileSafe, createSelftest } from "./gate-script-base.ts";
import { canonicalTestFiles } from "./test-framework-policy-check.ts";

/** Scan the given repo-relative test files for unpaired mkdtemp results. */
export function scanUnpairedMkdtemps(
  root: string,
  relFiles: string[]
): { rel: string; line: number; snippet: string }[] {
  const out: { rel: string; line: number; snippet: string }[] = [];
  for (const rel of relFiles) {
    const src = readFileSafe(path.join(root, rel));
    for (const vio of detectMkdtempNoCleanup(src, rel)) {
      out.push({ rel: vio.rel, line: vio.line, snippet: vio.snippet });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
}

function usage(): never {
  console.error(
    "usage: node tmp-leak-pairing-check.ts [<workspace-root>] [--selftest] [--files <rel> ...]\n" +
      "Exit: 0 = every mkdtemp is paired with cleanup; 1 = unpaired mkdtemp; 2 = usage/env error."
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node tmp-leak-pairing-check.ts [<workspace-root>] [--selftest] [--files <rel> ...]");
  if (args.includes("--selftest")) {
    process.exit(runSelftest() ? 0 : 1);
  }
  const positional = args.filter((a) => !a.startsWith("--"));
  const root = path.resolve(positional[0] ?? process.cwd());
  if (!fs.existsSync(path.join(root, "scripts", "test.sh"))) {
    console.error(`ERROR: ${path.join(root, "scripts", "test.sh")} not found — is <workspace-root> correct?`);
    return 2;
  }

  // --files <rel...>: scan only the named files (negative-control harness). Default: the whole
  // canonical test corpus (the same glob scripts/test.sh --list-files prints).
  const filesIdx = args.indexOf("--files");
  let relFiles: string[];
  if (filesIdx !== -1) {
    relFiles = args.slice(filesIdx + 1).filter((a) => !a.startsWith("--"));
    if (relFiles.length === 0) usage();
  } else {
    relFiles = canonicalTestFiles(root);
  }

  const violations = scanUnpairedMkdtemps(root, relFiles);
  for (const v of violations) {
    console.log(`  ${v.rel}:mkdtemp-no-cleanup  (line ${v.line}) ${v.snippet}`);
  }
  if (violations.length === 0) {
    console.log(`tmp-leak-pairing-check — ${relFiles.length} file(s), 0 unpaired mkdtemp result(s). PASS.`);
    return 0;
  }
  console.log(
    `tmp-leak-pairing-check — ${violations.length} unpaired mkdtemp result(s) across ${relFiles.length} file(s). ` +
      "FAIL — every mkdtemp result must be paired with a cleanup (rmSync / after() carrier / caller-cleans-return)."
  );
  return 1;
}

// ── selftest (ADR-018 selfcheck-fixture pattern: demonstrate BOTH the RED and GREEN state) ────────
export function runSelftest(): boolean {
  const st = createSelftest({ flavor: "counters", label: "tmp-leak-pairing-check" });
  const check = st.check;

  // RED — the negative control: an unpaired mkdtemp (created, never removed) MUST report.
  const leaky =
    'import { test } from "node:test";\n' +
    'import fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\n' +
    'test("x", () => {\n' +
    '  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leaky-"));\n' +
    '  fs.writeFileSync(path.join(dir, "a.md"), "x");\n' +
    "});\n";
  check("RED: unpaired mkdtemp reports", detectMkdtempNoCleanup(leaky, "leaky.test.mjs").length >= 1);

  // GREEN — rmSync in a finally block: the same mkdtemp paired with cleanup must NOT report.
  const finallyClean =
    'import { test } from "node:test";\n' +
    'import fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\n' +
    'test("x", () => {\n' +
    '  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ok-finally-"));\n' +
    "  try {\n" +
    '    fs.writeFileSync(path.join(dir, "a.md"), "x");\n' +
    "  } finally {\n" +
    '    fs.rmSync(dir, { recursive: true, force: true });\n' +
    "  }\n" +
    "});\n";
  check("GREEN: rmSync in finally does NOT report", detectMkdtempNoCleanup(finallyClean, "ok-finally.test.mjs").length === 0);

  // GREEN — the carrier-array + after() pattern (the fix applied to the 2026-08-12 leak files).
  const carrierClean =
    'import { test, after } from "node:test";\n' +
    'import fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\n' +
    "const _created = [];\n" +
    "after(() => {\n" +
    "  for (const d of _created) fs.rmSync(d, { recursive: true, force: true });\n" +
    "});\n" +
    "function tmpDir() {\n" +
    '  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carrier-"));\n' +
    "  _created.push(dir);\n" +
    "  return dir;\n" +
    "}\n" +
    'test("x", () => { const d = tmpDir(); fs.writeFileSync(path.join(d, "a"), "x"); });\n';
  check("GREEN: carrier-array + after() does NOT report", detectMkdtempNoCleanup(carrierClean, "carrier.test.mjs").length === 0);

  // GREEN — a helper RETURN whose call sites capture-and-clean the return does NOT report.
  const callerClean =
    'import { test } from "node:test";\n' +
    'import fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\n' +
    "function makeTmp(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), tag)); }\n" +
    'test("x", () => {\n' +
    '  const dir = makeTmp("caller-");\n' +
    "  try {\n" +
    '    fs.writeFileSync(path.join(dir, "a"), "x");\n' +
    "  } finally {\n" +
    '    fs.rmSync(dir, { recursive: true, force: true });\n' +
    "  }\n" +
    "});\n";
  check("GREEN: helper return captured-and-cleaned does NOT report", detectMkdtempNoCleanup(callerClean, "caller.test.mjs").length === 0);
  return st.report();
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  process.exit(main(process.argv));
}
