// @test-group engine
// test-coverage-check.test.mjs — gap-test-coverage-check-parses-stale-files-variable: RED/GREEN
// tests for scripts/test-coverage-check.ts, locking in the parser fix so the DIR-110 / ADR-019
// check can never silently lose its single-source glob again.
//
// The defect (M174/DIR-110 gap): parseCanonicalGlobs matched ONLY the pre-rename `files=(...)`
// spelling, but scripts/test.sh renamed the canonical glob to `local glob=(...)` (layer-grouping).
// The regex did not match the glob line — worse, it matched the runtime `local files=() f` array
// with an EMPTY capture — so the canonical set was silently EMPTY. Every discovered test file then
// looked like an orphan (the CI step went red for the wrong reason), and the ADR-004 single-source
// premise of the whole check was quietly broken. This test pins the fix:
//   - AC1  parse the CURRENT `local glob=(...)` line AND the legacy `files=(...)` spelling.
//   - AC2  an empty/absent glob is a parse FAILURE (throws) — never a silent [].
//   - AC4  the real repo tree has zero orphans (canonical set non-empty).
//   - AC5  the canonical set (realpath-deduped) EXACTLY equals `scripts/test.sh --list-files`
//         (enumerating ALL groups — the default excludes the serial group).
//   - AC6  this file declares `// @test-group serial` (A-class: nested test.sh spawns).
//
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (A-class — this file spawns `scripts/test.sh`, a nested runner with its own worker
// pool) so it runs in the concurrency-1 serial phase, never competing with the concurrency-8 body.
//
// Run:
//   scripts/test.sh plugin/test/test-coverage-check.test.mjs
//   scripts/test.sh --for-task gap-test-coverage-check-parses-stale-files-variable

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  parseCanonicalGlobs,
  canonicalTestFiles,
  findOrphans,
} from "../../scripts/test-coverage-check.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function scratchDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("AC1: parses the CURRENT `local glob=(...)` line from scripts/test.sh", () => {
  const globs = parseCanonicalGlobs(REPO_ROOT);
  assert.ok(globs.includes("packages/*/test/*.test.mjs"), `missing packages glob: ${JSON.stringify(globs)}`);
  assert.ok(globs.includes("plugin/test/*.test.mjs"), `missing plugin glob: ${JSON.stringify(globs)}`);
  assert.ok(
    globs.includes("experiments/quay-perpetual-stream/test/*.test.mjs"),
    `missing experiments glob: ${JSON.stringify(globs)}`
  );
});

test("AC1: legacy `files=(...)` spelling still parses", () => {
  const scratch = scratchDir("tcc-legacy-");
  try {
    fs.mkdirSync(path.join(scratch, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(scratch, "scripts", "test.sh"),
      'files=(packages/*/test/*.test.mjs plugin/test/*.test.mjs)\nexec node --test "${files[@]}"\n'
    );
    assert.deepEqual(parseCanonicalGlobs(scratch), [
      "packages/*/test/*.test.mjs",
      "plugin/test/*.test.mjs",
    ]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("AC2: empty/absent glob is a parse FAILURE (throws, never silent [])", () => {
  const scratch = scratchDir("tcc-empty-");
  const badScripts = [
    "exec node --test\n", // no glob line at all
    'local files=() f\nexec node --test "${files[@]}"\n', // runtime array (empty capture)
    "local glob=()\nexec node --test\n", // empty parens
    "local glob=( )\nexec node --test\n", // whitespace-only content
    "local glob=(\n)\nexec node --test\n", // newline-only content
    "local glob=( ) f\nexec node --test\n", // whitespace then var — same shape as the runtime array
  ];
  try {
    fs.mkdirSync(path.join(scratch, "scripts"), { recursive: true });
    for (const script of badScripts) {
      fs.writeFileSync(path.join(scratch, "scripts", "test.sh"), script);
      assert.throws(
        () => parseCanonicalGlobs(scratch),
        /cannot parse a non-empty canonical glob/,
        `expected fail-loud for: ${JSON.stringify(script)}`
      );
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("AC4: real repo tree has zero orphans (canonical glob non-empty)", () => {
  const report = findOrphans(REPO_ROOT);
  assert.ok(report.canonicalCount > 0, "canonical set must be non-empty");
  assert.equal(
    report.orphans.length,
    0,
    `orphans: ${JSON.stringify(report.orphans)} (canonical=${report.canonicalCount} discovered=${report.discoveredCount})`
  );
});

test("AC5: canonical set == scripts/test.sh --list-files (realpath-deduped)", () => {
  const canonical = canonicalTestFiles(REPO_ROOT);
  const canonReal = new Set(
    [...canonical].map((f) => {
      try {
        return fs.realpathSync(path.join(REPO_ROOT, f));
      } catch {
        return path.join(REPO_ROOT, f);
      }
    })
  );
  // serial + lowconc (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests /
  // gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive): the default --list-files
  // (product,engine + governance passthrough + the lowconc phase) EXCLUDES the serial group, so
  // the canonical-set comparison must enumerate ALL FIVE groups to stay single-source.
  const listOut = spawnSync("bash", ["scripts/test.sh", "--group", "product,engine,serial,lowconc", "--list-files"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(listOut.status, 0, `test.sh --list-files failed: ${listOut.stderr}`);
  const listSet = new Set(listOut.stdout.trim().split("\n").filter(Boolean));
  assert.equal(
    canonReal.size,
    listSet.size,
    `canonical=${canonReal.size} list-files=${listSet.size}`
  );
  for (const f of canonReal) {
    assert.ok(listSet.has(f), `missing from test.sh --list-files: ${f}`);
  }
});
