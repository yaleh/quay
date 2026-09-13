// @test-group engine
// checker-count-drift-check.test.mjs — tasks/gap-checker-claim-vs-actual-cadence-and-count-drift.
//
// Coverage map (task ACs):
//   AC2 — the declared counts in the carriers are READABLE and, on the REAL repo, equal to the
//         measured run_checker entries (the real-carrier assertion — a fixture-only suite would
//         prove only that the checker can produce a number, not that the shipped headers agree;
//         硬规则 4 推论三).
//   AC3 — the judgment can take the value false: declared≠measured ⇒ exit 1 (both directions), and
//         an unreadable carrier/annotation ⇒ exit 3 NOT-EVALUATED, never exit 0 (硬规则 3b).
//
// Both halves are asserted: pure functions over synthetic bodies (positional counting, annotation
// attachment), and the SHIPPED checker spawned as a process over temp roots (the exit vocabulary the
// suite consumes — a checker whose exit codes differ from what run_checker reads is not wired).
//
// Run:
//   scripts/test.sh plugin/test/checker-count-drift-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  REGISTRIES,
  countRunCheckers,
  evaluateRegistry,
  findAnnotation,
  isEvaluated,
  runCheck,
} from "../scripts/checker-count-drift-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "checker-count-drift-check.ts");

/** Spawn the shipped checker over a root; returns its exit code. */
function checkerExit(root) {
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root],
    { encoding: "utf8" },
  );
  return r.status;
}

/** A temp root carrying the two carrier shapes the checker owns. declared* = what the annotations say. */
function makeRoot({ declaredStatic = 2, declaredOperational = 1, declaredDoc = 1, gate = true, testSh = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "count-drift-"));
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  if (gate) {
    fs.writeFileSync(
      path.join(root, "plugin", "scripts", "runner-static-gate.ts"),
      [
        "# fixture carrier",
        declaredStatic === null ? "# (no annotation)" : `# @checker-count ${declaredStatic}`,
        "run_static_checks() {",
        '  run_checker "checker-a" node "${repo_root}/plugin/scripts/a.ts"',
        '  run_checker "checker-b" node "${repo_root}/plugin/scripts/b.ts"',
        "}",
        "",
        `# @checker-count ${declaredOperational}`,
        "run_operational_checks() {",
        '  run_checker "op-a" node "${repo_root}/plugin/scripts/op-a.ts"',
        "}",
      ].join("\n"),
    );
  }
  if (testSh) {
    fs.writeFileSync(
      path.join(root, "scripts", "test.sh"),
      [
        "# fixture carrier",
        `# @checker-count ${declaredDoc}`,
        "run_doc_checks() {",
        '  run_checker "doc-a" node "${repo_root}/plugin/scripts/doc-a.ts"',
        "}",
      ].join("\n"),
    );
  }
  return root;
}

test("counting is POSITIONAL: a comment or a longer command name never counts (硬规则 2)", () => {
  const body = [
    '  run_checker "real-a" node x.ts',
    "  # run_checker \"commented-out\" node y.ts", // prose/comment — must not count
    "  # see run_checker usage above",              // mention without a label
    "  run_checker_parallel_wait",                  // different command (`_`, not whitespace)
    '  run_checker "real-b" node z.ts',
    '  if [ -n "$(run_checker_sub_probe)" ]; then :; fi',
  ];
  assert.equal(countRunCheckers(body), 2);
});

test("findAnnotation takes the NEAREST preceding contiguous comment line", () => {
  const lines = ["# @checker-count 7", "", "# another block", "# @checker-count 9", "run_doc_checks() {"];
  // The blank line between the two blocks means the nearest one (9) is attached, not 7.
  assert.deepEqual(findAnnotation(lines, 4), { value: 9, line: 4 });
  // The comment block ends at the function-definition boundary: an annotation separated by a
  // non-comment line is NOT attached (must not be silently inherited from far above).
  const detached = ["# @checker-count 7", 'echo "not a comment"', "run_doc_checks() {"];
  assert.equal(findAnnotation(detached, 2), null);
});

test("evaluateRegistry reports declared AND measured (never one without the other)", () => {
  const carrier = [
    "# @checker-count 2",
    "run_static_checks() {",
    '  run_checker "a" node a.ts',
    '  run_checker "b" node b.ts',
    "}",
  ];
  const ok = evaluateRegistry(carrier, { carrier: "x.ts", fn: "run_static_checks" });
  assert.ok(isEvaluated(ok));
  assert.equal(ok.declared, 2);
  assert.equal(ok.measured, 2);

  const drifted = evaluateRegistry(
    ["# @checker-count 35", ...carrier.slice(1)],
    { carrier: "x.ts", fn: "run_static_checks" },
  );
  assert.ok(isEvaluated(drifted));
  assert.equal(drifted.declared, 35);
  assert.equal(drifted.measured, 2);
});

test("runCheck on fixtures: green / mismatch / unreadable are three DISTINCT outcomes", () => {
  const dirs = [];
  try {
    const green = makeRoot();
    dirs.push(green);
    const g = runCheck(green);
    assert.equal(g.ok, true);
    assert.equal(g.mismatches.length, 0);
    assert.equal(g.unEvaluated.length, 0);
    assert.equal(g.entries.length, REGISTRIES.length);

    const drifted = makeRoot({ declaredStatic: 3 });
    dirs.push(drifted);
    const d = runCheck(drifted);
    assert.equal(d.ok, false);
    assert.deepEqual(d.mismatches.map((m) => [m.registry.fn, m.declared, m.measured]), [
      ["run_static_checks", 3, 2],
    ]);

    const unreadable = makeRoot({ testSh: false });
    dirs.push(unreadable);
    const u = runCheck(unreadable);
    assert.equal(u.ok, false);
    assert.equal(u.mismatches.length, 0); // nothing was wrong with what was readable…
    assert.equal(u.unEvaluated.length, 1); // …but the doc dimension was NOT evaluated (not "clean")
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("AC2 — the REAL repo's declared counts equal the measured run_checker entries", () => {
  const res = runCheck(REPO_ROOT);
  assert.deepEqual(res.unEvaluated, [], "every registry dimension must be readable on the real repo");
  assert.deepEqual(
    res.mismatches.map((m) => `${m.registry.carrier}:${m.registry.fn} declared ${m.declared} measured ${m.measured}`),
    [],
    "the shipped headers must declare the measured values",
  );
  assert.equal(res.entries.length, REGISTRIES.length);
  // The measured values are POSITIVE and were derived from the bodies — a 0 here would mean the
  // carrier was parsed into nothing (硬规则 4: a structurally-cannot-differ reading is no reading).
  for (const e of res.entries) assert.ok(e.measured > 0, `${e.registry.fn} measured ${e.measured}`);
});

test("AC3 — the shipped checker's EXIT VOCABULARY: 0 pass / 1 drift / 3 not-evaluated", () => {
  const dirs = [];
  try {
    const green = makeRoot();
    dirs.push(green);
    assert.equal(checkerExit(green), 0);

    // Drift in the registry the task's own header got wrong (the historical 35-vs-58 shape).
    const drifted = makeRoot({ declaredStatic: 35 });
    dirs.push(drifted);
    assert.equal(checkerExit(drifted), 1);

    // Drift in the OTHER direction.
    const under = makeRoot({ declaredStatic: 1 });
    dirs.push(under);
    assert.equal(checkerExit(under), 1);

    // A second, independent carrier drifting.
    const docDrift = makeRoot({ declaredDoc: 7 });
    dirs.push(docDrift);
    assert.equal(checkerExit(docDrift), 1);

    // Unreadable ⇒ NOT-EVALUATED (3), explicitly NOT 0 (硬规则 3b: 读不懂 ≠ 合格).
    const absent = makeRoot({ testSh: false });
    dirs.push(absent);
    assert.equal(checkerExit(absent), 3);

    const noAnnotation = makeRoot({ declaredStatic: null });
    dirs.push(noAnnotation);
    assert.equal(checkerExit(noAnnotation), 3);
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("AC3 — --json emits parseable JSON carrying all three lists", () => {
  const root = makeRoot({ declaredStatic: 9 });
  try {
    const r = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.mismatches.length, 1);
    assert.equal(parsed.mismatches[0].declared, 9);
    assert.equal(parsed.mismatches[0].measured, 2);
    assert.ok(Array.isArray(parsed.entries) && Array.isArray(parsed.notEvaluated));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
