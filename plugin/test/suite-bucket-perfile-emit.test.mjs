// @test-group engine
// suite-bucket-perfile-emit.test.mjs — RED/GREEN tests for the --buckets path's per-file attribution
// (gap-fix-scope-perfile-buckets-parser).
//
// Defect: `scripts/test.sh --buckets <task-id>` ran the bucket subset's `node --test` WITHOUT the
// measure-suite reporter flags, so a RED bucket round emitted NO `__PERFILE__ duration_ms=<d> <path>
// passed=<bool>` lines. full-suite-runner.ts's fix-scope parser attributes each failures[] entry to a
// file ONLY from those lines (the file path rides ON the `__PERFILE__` line), so a bucket red hit 0
// attributable lines and was deferred un-attributed (no-file / checker-misreport fallback). The fix:
// the --buckets branch now loads the SAME `suite_reporter_flags` the full-suite path already uses.
//
// Covered here:
//   - AC1 (structural pin): both `node --test` invocations in the --buckets branch carry
//     $(suite_reporter_flags) — the exact anti-regression shape measure-suite-reporter.test.mjs pins
//     for the full-suite path, now extended to the bucket path.
//   - AC2 (take-false): a red test run under those reporter flags EMITS a `__PERFILE__ ... passed=false`
//     line naming the file, and full-suite-runner.ts's parser (isFailureLine + extractFailureFile)
//     attributes that line to the specific file.
//
// Run:
//   scripts/test.sh plugin/test/suite-bucket-perfile-emit.test.mjs
//   scripts/test.sh --for-task gap-fix-scope-perfile-buckets-parser

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isFailureLine, extractFailureFile } from "../scripts/full-suite-runner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Slice the `--buckets` elif branch out of scripts/test.sh (bounded by the next `elif`). */
function bucketsBranchSrc(testSh) {
  const lines = testSh.split("\n");
  const start = lines.findIndex((l) => l.includes('= "--buckets" ]'));
  assert.ok(start !== -1, "scripts/test.sh must contain the --buckets branch");
  const end = lines.findIndex((l, i) => i > start && /^elif\b/.test(l));
  const slice = lines.slice(start, end === -1 ? lines.length : end);
  return slice.join("\n");
}

test("AC1 — both --buckets node --test invocations carry $(suite_reporter_flags) (per-file attribution wiring)", () => {
  const testSh = fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
  const branch = bucketsBranchSrc(testSh);
  const nodeTestLines = branch.split("\n").filter((l) => /^\s*node --test\b/.test(l));
  // The --buckets branch has exactly two direct node --test sites (explicit-concurrency + derived-default).
  assert.ok(nodeTestLines.length >= 2, `expected >=2 node --test lines in the --buckets branch, got ${nodeTestLines.length}`);
  for (const l of nodeTestLines) {
    assert.match(
      l,
      /\$\(suite_reporter_flags\)/,
      `--buckets node --test line must carry $(suite_reporter_flags) so a red bucket round emits __PERFILE__: ${l.trim()}`
    );
  }
});

test("AC2 take-false — a red test under the reporter flags emits __PERFILE__ ... passed=false and the parser attributes the file", () => {
  // Scratch MUST live OUTSIDE packages/plugin/experiments — collectTestFiles (suite-cutoff-verdict.mjs)
  // walks those three roots and counts every .test.mjs it sees. A transient .test.mjs under
  // plugin/test/ races with suite-cutoff-verdict.test.mjs's concurrent scanHeavyFiles walk (suite
  // concurrency=16): the walk sees 427 files, and its immediate re-walk (after this finally's rmSync)
  // sees 426 ⇒ scan.total !== collectTestFiles().length ⇒ RED (427 !== 426, a real regression from
  // this task's own new test). os.tmpdir() (NOT REPO_ROOT) satisfies both constraints at once: it is
  // OUTSIDE the three scanned roots (collectTestFiles never sees it) AND it is not a shared-root
  // mkdtemp (test-isolation-check R8 — a mkdtemp rooted at REPO_ROOT dirties the shared checkout).
  // Consequence: extractFailureFile does NOT attribute a path outside the repo (normalizeFailureFile
  // drops `..`-prefixed relatives), so attribution is pinned below with a repo-relative line instead
  // of the /tmp scratch path (the real bucket-red test file lives under packages/plugin/experiments).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bucket-red-"));
  const tmp = path.join(tmpDir, "__tmp_bucket_red__.test.mjs");
  fs.writeFileSync(
    tmp,
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("red", () => assert.equal(1, 2, "intentional"));\n'
  );
  try {
    const reporter = path.join(REPO_ROOT, "plugin", "scripts", "measure-suite-reporter.mjs");
    // Clear the outer test-runner's NODE_TEST_CONTEXT so the child `node --test` is NOT treated as a
    // recursive run (node:test skips files when it detects nesting — the child would emit nothing).
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const r = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-reporter=spec",
        `--test-reporter=${reporter}`,
        "--test-reporter-destination=stdout",
        "--test-reporter-destination=stderr",
        tmp,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: childEnv }
    );
    const merged = `${r.stdout}\n${r.stderr}`;
    const m = merged.match(/^__PERFILE__\s+duration_ms=\S+\s+(\S+)\s+passed=false\b/m);
    assert.ok(m, `expected a __PERFILE__ ... passed=false line in:\n${merged}`);
    const absFile = m[1];
    // The emitted line must name the red scratch file (the reporter carries the full path).
    assert.ok(
      absFile.endsWith("__tmp_bucket_red__.test.mjs"),
      `__PERFILE__ line must name the scratch test file, got: ${absFile}`
    );
    // The fix-scope parser must recognize the line as a failure.
    assert.ok(isFailureLine(m[0]), "isFailureLine must recognize the __PERFILE__ passed=false line");
    // Attribution: the scratch lives in os.tmpdir() (outside the repo, R8), so the real reporter line
    // is NOT repo-attributable — but a real bucket-red test file lives under packages/plugin/
    // experiments, and extractFailureFile must attribute a repo-relative __PERFILE__ line to it
    // (the parser shape the fix-scope gate relies on to attribute failures[] to a file).
    assert.equal(
      extractFailureFile("__PERFILE__ duration_ms=1 packages/quay/test/foo.test.mjs passed=false", REPO_ROOT),
      "packages/quay/test/foo.test.mjs",
      "extractFailureFile must attribute a repo-relative __PERFILE__ line to its file"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
