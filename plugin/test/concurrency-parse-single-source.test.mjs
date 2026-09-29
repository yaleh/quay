// @test-group engine
// concurrency-parse-single-source.test.mjs — the `--test-concurrency=N` parse has exactly ONE
// definition (measure-suite-reporter.mjs's `readConcurrency`), imported and re-exported by
// suite-lpt-runner.mjs's `readConcurrencyFromExecArgv`. That makes "the lane count the runner's
// run({concurrency}) executes" and "the lane count the reporter prints as __GROUP__ concurrency="
// the same number BY CONSTRUCTION.
//
// Regression guard for gap-routine-semantic-dedup-scan-concurrency-parse-divergence — the 5th
// recurrence (2026-09-13 / 09-25 / 09-27 / 09-28 / 09-29) of the same divergent-implementation
// finding: two hand-kept copies of the loop differed only in their validity predicate —
// `Number.isInteger` (runner) vs `Number.isFinite` (reporter) — so `--test-concurrency=1.5` gave the
// runner 1 lane while the reporter printed `concurrency=1.5`, directly falsifying the runner's own
// comment that the parse was shared.
//
// Why the predicate must be the integer one (measured, not assumed): node:test's run() REJECTS a
// non-integer concurrency with `ERR_OUT_OF_RANGE: The value of "options.concurrency" is out of range.
// It must be an integer. Received 1.5`. The runner feeds this value straight into run(), so a
// fractional flag MUST degrade to the serial default — reporting 1.5 would be a lane count that
// never existed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import perFileReporter, { readConcurrency } from "../scripts/measure-suite-reporter.mjs";
import { readConcurrencyFromExecArgv } from "../scripts/suite-lpt-runner.mjs";

/** Run sync `fn` with process.execArgv pinned (save/restore). */
function withExecArgv(argv, fn) {
  const saved = process.execArgv;
  process.execArgv = argv;
  try {
    return fn();
  } finally {
    process.execArgv = saved;
  }
}

/** Async twin of withExecArgv — the restore must wait for the promise, since the reporter reads
 *  process.execArgv on the generator's FIRST `.next()`, i.e. after the `await` below. */
async function withExecArgvAsync(argv, fn) {
  const saved = process.execArgv;
  process.execArgv = argv;
  try {
    return await fn();
  } finally {
    process.execArgv = saved;
  }
}

/** Drive the REAL reporter generator over `files` with console.error captured, returning the emitted
 *  lines. This is the reporter's actual observation surface (`__GROUP__` goes to stderr), so the
 *  assertions below read what the suite log would read. */
async function reporterLines(files) {
  const saved = console.error;
  const lines = [];
  console.error = (...args) => {
    lines.push(args.join(" "));
  };
  try {
    const source = (async function* () {
      for (const f of files) {
        // `d.name === d.file` is the reporter's file-level-vs-individual-test discriminator.
        yield { type: "test:complete", data: { file: f, name: f, details: { duration_ms: 12, passed: true } } };
      }
    })();
    for await (const _ of perFileReporter(source)) {
      /* drain — the reporter is a passthrough generator; we only want its stderr side effects */
    }
  } finally {
    console.error = saved;
  }
  return lines;
}

test("one definition: the runner's parse IS the reporter's (a second copy is how the predicates drifted)", () => {
  assert.equal(
    readConcurrencyFromExecArgv,
    readConcurrency,
    "suite-lpt-runner.mjs must RE-EXPORT measure-suite-reporter.mjs's readConcurrency, not carry its own copy",
  );
});

test("readConcurrency — a valid integer ≥ 1 wins; fractional / < 1 / non-numeric falls back to serial", () => {
  const c = (argv) => withExecArgv(argv, () => readConcurrency());

  assert.equal(c(["--test-concurrency=4"]), 4, "`=` spelling");
  assert.equal(c(["--test-concurrency", "3"]), 3, "space spelling");
  assert.equal(c(["-e", "--test-concurrency=8", "ignored.test.mjs"]), 8, "flag after other args");
  assert.equal(c(["--test-concurrency=1"]), 1, "explicit serial is a real value, not a fallback");
  assert.equal(c([]), 1, "no flag → serial default");

  // The divergence input, and its neighbours: none of these is a lane count node's run() accepts,
  // so each must fall back to 1 rather than be reported as a fractional / invalid concurrency.
  assert.equal(c(["--test-concurrency=1.5"]), 1, "fractional `=` value → serial default");
  assert.equal(c(["--test-concurrency", "2.5"]), 1, "fractional space value → serial default");
  assert.equal(c(["--test-concurrency=0"]), 1, "0 → serial default");
  assert.equal(c(["--test-concurrency=-2"]), 1, "negative → serial default");
  assert.equal(c(["--test-concurrency=abc"]), 1, "non-numeric → serial default");

  // First valid flag wins (order preserved) — the parse must not scan-for-last.
  assert.equal(c(["--test-concurrency=1.5", "--test-concurrency=6"]), 6, "invalid first, valid later → the valid one");
  assert.equal(c(["--test-concurrency=6", "--test-concurrency=2"]), 6, "valid first wins over a later valid one");
});

test("what the reporter PRINTS equals what the runner RUNS — 1.5 reports 1, never 1.5", async () => {
  const fixture = "/tmp/concurrency-single-source-fixture.test.mjs"; // need not exist — path identity only
  const CASES = [
    { argv: ["--test-concurrency=1.5"], expected: 1, why: "fractional → serial (the divergence input)" },
    { argv: ["--test-concurrency=4"], expected: 4, why: "valid integer `=` spelling" },
    { argv: ["--test-concurrency", "2"], expected: 2, why: "valid integer space spelling" },
  ];
  for (const { argv, expected, why } of CASES) {
    const lines = await withExecArgvAsync(argv, () => reporterLines([fixture]));
    const group = lines.find((l) => l.startsWith("__GROUP__ "));
    assert.ok(group, `the reporter must emit a __GROUP__ line (${why})`);
    const reported = Number(/concurrency=(\S+)/.exec(group)[1]);
    const executed = withExecArgv(argv, () => readConcurrencyFromExecArgv());
    assert.equal(reported, expected, `reported concurrency — ${why}`);
    assert.equal(
      reported,
      executed,
      `reporter printed concurrency=${reported} but the runner would run with ${executed} — ${why}`,
    );
  }
});

// ── The runtime arm: the assertions above are all satisfiable by IMPORTING the alias, which cannot
// see whether the runner's own module scope can call it. `export { x as y }` binds only the export
// table, so the runner shipped with a local `readConcurrencyFromExecArgv()` that was a ReferenceError
// — the module could not start at all, while every import-based assertion here stayed green (the
// real red surfaced only in the pre-existing gap-suite-lpt-runner-exitcode test). Reading the
// PRODUCTION carrier — an actually-spawned runner process — is the reading that can take the value
// false. ⛔ Do not replace this with another import-based check.
test("the runner PROCESS starts and reports the same lane count it runs (import-only checks miss a local ReferenceError)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "concurrency-single-source-"));
  try {
    const fixture = join(dir, "fixture.test.mjs");
    await writeFile(fixture, 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("trivially passes", () => { assert.equal(1, 1); });\n');
    const runner = fileURLToPath(new URL("../scripts/suite-lpt-runner.mjs", import.meta.url));

    // ⛔ NODE_TEST_CONTEXT must NOT reach the child: this test file itself runs under `node --test`,
    // so that var is inherited, and a child that sees it speaks the parent-runner protocol instead of
    // running the fixture — the run then reports `ℹ pass 0` / `files=0` and every assertion below would
    // be reading a run that never happened (an echo, not a measurement). Strip it.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;

    // `--test-concurrency=1.5` rides in the child's process.execArgv (a node flag before the script) —
    // the divergence input, so a runner that starts must run 1 lane AND report 1.
    const res = spawnSync(process.execPath, ["--test-concurrency=1.5", runner, fixture], {
      encoding: "utf8",
      timeout: 60_000,
      env,
    });

    assert.doesNotMatch(
      `${res.stderr}`,
      /ReferenceError|is not defined/,
      "the runner's local alias call must be a real binding — a bare `export { x as y }` is not",
    );
    assert.equal(res.status, 0, `the runner must run the file and exit 0 (stderr: ${res.stderr})`);
    // The fixture really executed — without this, `files=0`/`pass 0` would still satisfy the two
    // assertions below about an empty run.
    assert.match(`${res.stdout}`, /ℹ pass 1\b/, "the fixture must actually have run and passed");
    assert.match(`${res.stdout}`, /✔ trivially passes/, "the fixture's own test name must appear in the spec output");
    const group = `${res.stderr}`.split("\n").find((l) => l.startsWith("__GROUP__ "));
    assert.ok(group, "the reporter composed INSIDE the runner must emit __GROUP__");
    assert.match(group, /concurrency=1\b/, "the runner's reporter must print the 1 lane it actually runs");
    assert.match(group, /files=1\b/, "the reporter's own file tally must agree the fixture ran");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
