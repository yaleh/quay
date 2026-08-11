// @test-group serial
// @load-sensitive nested-spawn
// @load-sensitive-entry 2026-08-08 A-class nested full-suite spawn (shells out to real scripts/test.sh --group governance)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this file shells
// out to the REAL scripts/test.sh including `--group governance` (the grown governance sub-suite,
// >830s isolated) — inherently heavy + fragile under full-suite concurrency (nested node --test
// spawns; the outer reruns this family isolated per the 判绿 rules).
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (A-class nested full-suite spawn) so it runs in the concurrency-1 serial phase,
// never competing with the concurrency-8 main body's worker pool.
// SPLIT NOTE (gap-suite-floor-two-longest-files-bound): this is one of FOUR files split from the
// original runner-grouping.test.mjs (204s serial floor) by test concern — this file holds the
// fixture-EXECUTION tests (the governance/product fixtures run through the REAL test.sh, the
// dominant per-call cost). The nested `@load-sensitive nested-spawn` annotation is preserved so
// the family membership + serial routing stay byte-identical.
// gap-test-suite-has-no-layer-grouping — the governance fixture RUN test: --group governance runs
// a governance fixture's real tests, --group product self-skips it (the in-file skip block). These
// shell out to the REAL scripts/test.sh (the single source of truth), not a copy of its logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const testSh = join(repoRoot, "scripts", "test.sh");
const fixture = join(__dirname, "runner-fixtures", "gov.test.mjs");

function runTestSh(...args) {
  // node --test sets NODE_TEST_CONTEXT=child-v8 on the running file; a child `node --test`
  // (spawned by test.sh for the fixture files) inherits it and suppresses its own output.
  // Strip all NODE_TEST_* vars so the child runs as a normal top-level test runner.
  const cleanEnv = { ...process.env };
  for (const k of Object.keys(cleanEnv)) {
    if (k.startsWith("NODE_TEST_")) delete cleanEnv[k];
  }
  const r = spawnSync("bash", [testSh, ...args], { cwd: repoRoot, encoding: "utf8", timeout: 120000, env: cleanEnv });
  assert.equal(r.status, 0, `scripts/test.sh ${args.join(" ")} exited ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r.stdout;
}

test("AC5/AC8: --group governance runs a governance fixture's real tests; --group product self-skips it", () => {
  // governance mode: real test runs
  const runOut = runTestSh("--group", "governance", fixture);
  assert.match(runOut, /REAL GOV TEST RAN/);
  // product mode: in-file skip fires (visible as skipped, real test absent)
  const skipOut = runTestSh("--group", "product", fixture);
  assert.match(skipOut, /governance group skipped/);
  assert.doesNotMatch(skipOut, /REAL GOV TEST RAN/);
});
