// @test-group product
//
// ac354-negative-control-falsifiable.test.mjs — the durability fixture for the RE-ANCHORED negative
// control of `goals/AC-354-*.md`'s criterion (gap-ac354-negctl-anchor-symbol-retired).
//
// WHAT THIS FILE IS FOR. AC-354 measures one thing: that the `root→gate/config` edge count went
// 1→0 and the `gate/factories→gate/config` line count went 5→0, and — the half that makes the first
// half a MEASUREMENT rather than a convenience boolean — that the counter which produced those
// numbers is FALSIFIABLE, i.e. it re-detects a real regression when one is planted.
//
// The planted regression used to be built by rewriting the import line of `goal-store.ts` that
// carried a particular symbol, via a line-anchored `String.replace`. `411bb34c7` ("derive the outer
// goal-store child bound from the record's own deadline") is an UNRELATED legal refactor that
// changed that resolver and removed the symbol from `goal-store.ts`, so the anchor stopped matching,
// the scratch copy became byte-identical to the original, the count stayed 0, and the criterion went
// PERMANENTLY RED — `CAUSE=negative-control-not-falsifiable` on every tree, forever, no matter what
// the tree said. A judge that is anchored on text somebody else may legitimately delete is not a
// judge (硬规则 4c: the quantity a criterion names must survive every intermediate layer).
//
// The re-anchor makes the planted regression SELF-CONTAINED: the scratch text is the retired import
// PREPENDED to whatever `goal-store.ts` happens to be, so it depends on no line and no symbol of
// that file. The assertion was also tightened from "≥ 1" to "exactly afterRoot + 1", which reds on
// BOTH a counter that misses the regression (0) and one that double-counts it (> 1).
//
// THE UNIT UNDER TEST IS THE SHIPPED CRITERION, NOT A COPY OF IT. The criterion text is extracted
// VERBATIM from the goal record's frontmatter and executed — the same text `quay goal gate AC-354`
// runs. A reimplementation here would be an echo of the criterion rather than a measurement of it
// (硬规则 4): it would stay green while the criterion rotted, which is the exact failure this task
// exists to repair.
//
// BOTH DIRECTIONS ARE COVERED, AND EACH MUTATION PROVES IT CHANGED THE TEXT. The positive arms run
// the shipped text on THIS tree (the production tree — a task worktree during dispatch, `develop`
// during fan-in). Two deliberate mutations of the shipped text are then each run and each must be
// RED with the named cause; each arm also asserts the mutated text differs from the shipped text,
// so a mutation that silently failed to apply cannot make the arm pass vacuously (硬规则 3b).
//
// ⛔ The mutation anchors are asserted to be present, and a missing anchor FAILS the test rather
// than skipping it: "could not evaluate" must not wear the same shape as "evaluated and fine".

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root of THIS checkout (a task worktree during dispatch, develop during fan-in). */
const REPO = path.resolve(HERE, "..", "..", "..");

/** A harness bound, so a hung script reports AS a bound instead of as an opaque `code === null`
 *  that every `assert.equal(r.code, 0)` would render as a confusing mismatch. */
const RUN_TIMEOUT_MS = 60_000;

/** The one goal file this fixture is pinned to. Resolved by id prefix, so a rename that keeps the id
 *  still resolves; a missing file fails loudly rather than skipping. */
function goalFilePath() {
  const dir = path.join(REPO, "goals");
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-354-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-354-*.md under ${dir}`);
  return path.join(dir, name);
}

/** The criterion text AS STORED (frontmatter block scalar parsed back to a string). */
function criterionText() {
  const raw = fs.readFileSync(goalFilePath(), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  assert.ok(fm, "goal file has no YAML frontmatter");
  const doc = YAML.parse(fm[1]);
  assert.equal(typeof doc.criterion, "string", "goal record has no criterion string");
  return doc.criterion;
}

/** The anchor the negative control REPLACES: only this line is edited by each mutation arm. */
const COUNT_LINE = "const negCount=countRootToGateConfig(scratchWithRegression);";

/**
 * Apply ONE directed mutation to the shipped criterion text.
 *
 * `what` names the arm; `replacement` is the mutated line. Fails closed (asserts) when the anchor is
 * absent or appears more than once — a mutation that did not apply must never be indistinguishable
 * from one that applied and was (wrongly) accepted.
 */
function mutate(text, replacement) {
  const hits = text.split(COUNT_LINE).length - 1;
  assert.equal(hits, 1, `the negative-control count line must appear exactly once in the shipped criterion, found ${hits}`);
  const mutated = text.replace(COUNT_LINE, replacement);
  assert.notEqual(mutated, text, "the mutation must actually change the criterion text");
  assert.notEqual(sha256(mutated), sha256(text), "the mutation must change the text's sha256 (a same-bytes 'mutation' is an echo, not a control)");
  return mutated;
}

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Run `script` in `cwd` under `shell`, with the script text on stdin (the same text-in, exit-code-
 * out contract the acceptance runner has — `spawnSync(command, {shell: true})` runs `/bin/sh -c`).
 * No temp file is written: nothing of this fixture's leaks into a shared path.
 */
function runScript(shell, script, cwd = REPO) {
  const r = spawnSync(shell, [], { cwd, input: script, encoding: "utf8", timeout: RUN_TIMEOUT_MS });
  const timedOut = r.error?.code === "ETIMEDOUT";
  assert.ok(!timedOut, `the criterion did not finish within ${RUN_TIMEOUT_MS}ms — a harness bound, not a verdict`);
  assert.equal(r.error ?? null, null, `spawning ${shell} failed: ${r.error?.message}`);
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ── the extraction is the real criterion, and the retired anchor is GONE ────────────────────────

test("the criterion is extracted verbatim and no longer anchors on any line of goal-store.ts", () => {
  const c = criterionText();

  // Non-vacuous: these are the parts the arms below depend on. An extraction that returned "" (or a
  // rewritten criterion) must fail HERE, not make every later arm pass on nothing.
  for (const needle of ["countRootToGateConfig", "NEGCTL_LINE", "scratchWithRegression", "CAUSE=negative-control-not-falsifiable"]) {
    assert.ok(c.includes(needle), `shipped criterion lost ${needle}`);
  }
  assert.ok(c.includes(COUNT_LINE), "the shipped criterion must still compute the scratch count through the counter");

  // The retired anchor: a line-matching `replace` over goal-store.ts, and the symbol-line it matched.
  // Described rather than quoted as a live pattern — this assertion is over the CRITERION text, so a
  // future restatement of the retired form anywhere in the criterion is what it must catch.
  assert.ok(!/scratchBefore/.test(c), "the criterion still builds its scratch copy the old line-anchored way");
  assert.ok(!/\.replace\(/.test(c), "the criterion still rewrites a line of goal-store.ts instead of prepending its own");
  assert.ok(!/resolveAcceptanceTimeoutMs\[/.test(c), "the criterion still matches the retired symbol as a line pattern");

  // The re-anchor itself: the planted regression is the import PREPENDED to goal-store.ts's own text.
  assert.ok(
    /NEGCTL_LINE\+rd\(path\.join\(src,"goal-store\.ts"\)\)/.test(c),
    "the planted regression must be the retired import prepended to goal-store.ts, not a rewrite of it",
  );

  // The strengthening: exactly one, not at-least-one.
  assert.ok(c.includes("negCount!==afterRoot+1"), "the negative control must assert EXACTLY afterRoot + 1 (a `>= 1` form is the relaxation this task forbids)");
});

// ── positive control: the shipped criterion is TRUE on this tree, under both shells ─────────────

test("the shipped criterion passes on this tree (bash)", () => {
  const r = runScript("bash", criterionText());
  assert.equal(r.code, 0, `the shipped criterion must pass on this tree: ${r.stderr}`);
  // The criterion's last stdout line is its PASS echo, so select the JSON reading by shape and fail
  // loudly if it is absent (rather than JSON.parse-ing whatever happened to be last).
  const jsonLine = r.stdout.split("\n").find((l) => l.startsWith("{"));
  assert.ok(jsonLine, `the criterion printed no JSON reading:\n${r.stdout}`);
  const out = JSON.parse(jsonLine);
  // The four keys the criterion promises, read as numbers rather than as prose.
  assert.equal(out.fork_point, "162f8c380ed1dd9267167cc791ef8727fd13269d");
  assert.equal(out.before.root_to_gate_config, 1, "the recorded BEFORE reading of root→gate/config");
  assert.equal(out.before.factories_to_config_lines, 5, "the recorded BEFORE reading of gate/factories→gate/config");
  assert.equal(out.after.root_to_gate_config, 0, "root→gate/config must have converged to 0");
  assert.equal(out.after.factories_to_config_lines, 0, "gate/factories→gate/config must have converged to 0");
  // …and the negative control re-detected the planted regression in the SAME run: exactly one more
  // than the measured after-count. This is the reading the re-anchor exists to keep truthful.
  assert.equal(out.negative_control_count_on_scratch_regression, out.after.root_to_gate_config + 1);
});

test("the same text passes under the production shell (/bin/sh via spawnSync shell:true)", () => {
  // `runAcceptance` spawns the criterion with `shell: true`, i.e. `/bin/sh -c <criterion>`. A
  // criterion that is only true under bash is a criterion production cannot run.
  const r = runScript("sh", criterionText());
  assert.equal(r.code, 0, `the criterion must also pass under sh (the production shell): ${r.stderr}`);
});

// ── negative controls: the counter's falsifiability is itself measured, in both directions ──────

test("arm A — a counter that misses the regression is REJECTED with the named cause", () => {
  const mutated = mutate(criterionText(), "const negCount=0;");
  const r = runScript("bash", mutated);
  assert.equal(r.code, 1, "a counter that reports 0 on a planted regression must be rejected");
  assert.match(r.stderr, /CAUSE=negative-control-not-falsifiable\b/);
  // The refusal must NAME what it measured, so the failure is diagnosable without re-running.
  assert.match(r.stderr, /\(after=0, scratch=0\)/);
});

test("arm B — a counter that double-counts is REJECTED (the `>= 1` relaxation would have accepted it)", () => {
  // Under the retired `negCount < 1` form this arm PASSED (2 >= 1), i.e. the old negative control
  // could not tell "detected once" from "detected twice". This arm pins the strengthening.
  const mutated = mutate(criterionText(), "const negCount=afterRoot+2;");
  const r = runScript("bash", mutated);
  assert.equal(r.code, 1, "a counter that over-counts the regression must be rejected under the `exactly one` form");
  assert.match(r.stderr, /CAUSE=negative-control-not-falsifiable\b/);
  assert.match(r.stderr, /\(after=0, scratch=2\)/);
});
