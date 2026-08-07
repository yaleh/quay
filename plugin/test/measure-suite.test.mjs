// @test-group lowconc
// measure-suite.test.mjs — validate the per-file duration reporter (AC1b/AC8 of
// gap-suite-cost-model-is-wrong-optimizations-buy-nothing).
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (B-class real wall-clock wait — spawns node --test subprocesses and waits on their
// real durations) so it runs in the concurrency-1 serial phase, never competing with the
// concurrency-8 main body.
//
// The full-suite measurement (measure-suite.mjs) depends on the custom reporter
// (measure-suite-reporter.mjs) emitting a FILE-LEVEL duration for EVERY test file —
// both node:test files (which get a file-level test:complete with name === basename)
// and custom-harness scripts (which are a single test named by the file). This test
// pins that contract with two tiny fixtures, so a future reporter change cannot
// silently break per-file attribution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const reporterPath = path.join(repoRoot, "plugin", "scripts", "measure-suite-reporter.mjs");

function runWithReporter(files) {
  // node:test refuses to run `node --test` recursively from inside a test file
  // (it warns "node:test run() is being called recursively ... skipping running
  // files"). Clear NODE_TEST_CONTEXT so the child --test actually runs the files.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(
    "node",
    [
      "--test",
      "--test-concurrency=8",
      `--test-reporter=${reporterPath}`,
      "--test-reporter-destination=stderr",
      ...files,
    ],
    { encoding: "utf8", env }
  );
}

function parsePerFile(stderr) {
  const out = new Map();
  for (const line of stderr.split("\n")) {
    const m = line.match(/^__PERFILE__ (\S+) ([0-9.]+) (true|false)$/);
    if (m) out.set(m[1], { durationMs: parseFloat(m[2]), passed: m[3] === "true" });
  // key = full path from the reporter
  }
  return out;
}

test("reporter captures file-level duration for node:test AND custom-harness files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "measure-suite-test-"));
  try {
    const nodeTestFile = path.join(dir, "nodetest.test.mjs");
    writeFileSync(
      nodeTestFile,
      `import { test } from "node:test";\n` +
        `import { setTimeout as sleep } from "node:timers/promises";\n` +
        `test("n1", async () => { await sleep(120); });\n`
    );
    const customFile = path.join(dir, "custom-harness.mjs");
    writeFileSync(
      customFile,
      `let failures = 0;\n` +
        `for (let i = 0; i < 3; i++) failures += (true ? 0 : 1);\n` +
        `console.log(failures === 0 ? "custom pass" : "custom fail");\n` +
        `process.exitCode = failures === 0 ? 0 : 1;\n`
    );

    const res = runWithReporter([nodeTestFile, customFile]);
    assert.equal(res.status, 0, `suite should pass; stderr tail: ${res.stderr.slice(-300)}`);
    const perFile = parsePerFile(res.stderr);

    assert.ok(perFile.has(nodeTestFile), "node:test file must get a file-level duration");
    assert.ok(
      perFile.get(nodeTestFile).durationMs >= 100,
      `node:test file duration (${perFile.get(nodeTestFile).durationMs}ms) should cover its 120ms test`
    );
    assert.ok(perFile.has(customFile), "custom-harness file must get a file-level duration");
    assert.ok(perFile.get(customFile).durationMs > 0);
    assert.equal(perFile.get(customFile).passed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
