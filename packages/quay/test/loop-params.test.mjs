// @test-group product
// loop-params.test.mjs — RED→GREEN tests for readLoopParams (DIR-045 AC2 / DIR-050 unified format)
//
// Contract: readLoopParams(workspaceRoot) → params | throws Error("FAIL-CLOSED: ...")
//   FAIL-CLOSED cases (throw):
//     - no loop config found (neither unified config.yml loop: section nor .quay/loop.yml)
//     - malformed YAML
//     - missing required field `board`
//     - missing required field `gates`
//     - invalid `stop` value
//   GREEN cases (returns valid params):
//     - unified format (.quay/config.yml with loop: section) — DIR-050
//     - legacy fallback (.quay/loop.yml only) — DIR-050 back-compat
//     - unified preferred when both exist — DIR-050
//     - minimal valid params (board + gates)
//     - full valid params (all fields)
//     - exp5 params shape
//     - archguard params shape
//
// Run: node --test packages/quay/test/loop-params.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { readLoopParams } from "../src/loop-params.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// gap-tests-never-clean-up-their-tmpdirs: every tmpWs() created a per-run-unique `quay-loop-params-*`
// workspace that was never removed — /tmp (tmpfs) accumulated 4,337 `quay-loop-params-trig-fuzz-*`
// dirs (the DIR-051 fuzz leg) plus the other tags. The node:test file-level after() hook removes every
// created workspace after the file's tests complete (runs even on failure; unlike a process.on('exit')
// hook which does not run on process.exit(1) in hand-rolled harnesses).
const _createdDirs = [];
function tmpWs(tag) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `quay-loop-params-${tag}-`));
  _createdDirs.push(ws);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  return ws;
}
after(() => {
  for (const ws of _createdDirs) fs.rmSync(ws, { recursive: true, force: true });
});

function writeLoopYml(ws, content) {
  fs.writeFileSync(path.join(ws, ".quay", "loop.yml"), content);
}

// ---------------------------------------------------------------------------
// RED cases — must throw Error with "FAIL-CLOSED" in message
// ---------------------------------------------------------------------------

test("RED: missing .quay/loop.yml (and no unified config) throws FAIL-CLOSED", () => {
  const ws = tmpWs("missing");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      return true;
    }
  );
});

test("RED: .quay/config.yml exists but has no loop: section, and no loop.yml → throws FAIL-CLOSED", () => {
  const ws = tmpWs("unified-no-loop");
  // write a config.yml without loop: section (providers only)
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), "providers:\n  native:\n    enabled: true\n");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      return true;
    }
  );
});

test("RED: malformed YAML throws FAIL-CLOSED", () => {
  const ws = tmpWs("malformed");
  writeLoopYml(ws, "board: native\ngates: [vitest\nbad: {unclosed");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      return true;
    }
  );
});

test("RED: missing required field `board` throws FAIL-CLOSED", () => {
  const ws = tmpWs("no-board");
  writeLoopYml(ws, "gates: [vitest]\nstop: once");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      assert(err.message.includes("board"), `missing 'board' not mentioned: ${err.message}`);
      return true;
    }
  );
});

test("RED: missing required field `gates` throws FAIL-CLOSED", () => {
  const ws = tmpWs("no-gates");
  writeLoopYml(ws, "board: native\nstop: once");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      assert(err.message.includes("gates"), `missing 'gates' not mentioned: ${err.message}`);
      return true;
    }
  );
});

test("RED: invalid stop value throws FAIL-CLOSED", () => {
  const ws = tmpWs("bad-stop");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nstop: invalid-value");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// GREEN cases — must return valid params object
// ---------------------------------------------------------------------------

test("GREEN: minimal valid params (board + gates as array) — legacy loop.yml", () => {
  const ws = tmpWs("minimal");
  writeLoopYml(ws, "board: native\ngates: [vitest]");
  const params = readLoopParams(ws);
  assert.equal(params.board, "native");
  assert.deepEqual(params.gates, ["vitest"]);
  // defaults
  assert.equal(params.stop, "once");
  assert.equal(params.policy, "ready-first");
  // DIR-050: coexist is retired — not in return value
  assert.equal(params.coexist, undefined);
  // DIR-048 new defaults
  assert.equal(params.execution, "dispatched");
  assert.equal(params.audit, "adversarial");
  // DIR-049 default: concurrency 1 (serial)
  assert.equal(params.concurrency, 1);
});

// ---------------------------------------------------------------------------
// DIR-050: unified format tests
// ---------------------------------------------------------------------------

test("DIR-050 GREEN: unified config.yml with loop: section is read (preferred over loop.yml)", () => {
  const ws = tmpWs("unified-preferred");
  // Write unified config.yml with loop: section
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    "loop:",
    "  board: native",
    "  gates: [vitest]",
    "  stop: once",
  ].join("\n"));
  // Also write a legacy loop.yml with DIFFERENT board — unified should win
  writeLoopYml(ws, "board: legacy-board\ngates: [legacy-gate]");
  const params = readLoopParams(ws);
  assert.equal(params.board, "native", "unified config.yml loop: section must win over loop.yml");
  assert.deepEqual(params.gates, ["vitest"]);
  assert.equal(params.stop, "once");
});

test("DIR-050 GREEN: unified config.yml loop: section — all fields parsed correctly", () => {
  const ws = tmpWs("unified-full");
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    "loop:",
    "  board: native",
    "  gates: [vitest, dod]",
    "  stop: \"until(.halt)\"",
    "  policy: value-typed-ledger",
    "  execution: inline",
    "  audit: none",
    "  concurrency: 4",
  ].join("\n"));
  const params = readLoopParams(ws);
  assert.equal(params.board, "native");
  assert.deepEqual(params.gates, ["vitest", "dod"]);
  assert.equal(params.stop, "until(.halt)");
  assert.equal(params.policy, "value-typed-ledger");
  assert.equal(params.execution, "inline");
  assert.equal(params.audit, "none");
  assert.equal(params.concurrency, 4);
});

test("DIR-120 Phase 2 RED: config.yml with no loop: section now FAIL-CLOSED even with sibling loop.yml present (branch-A terminal, no more fallthrough)", () => {
  const ws = tmpWs("legacy-fallback");
  // config.yml without loop: section
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), "providers:\n  native:\n    enabled: true\n");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nstop: once");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      return true;
    },
    "DIR-120 Phase 2: branch A is now terminal — a config.yml missing loop: must FAIL-CLOSED, never fall through to a sibling loop.yml"
  );
});

// ---------------------------------------------------------------------------
// DIR-120 Phase 3a: exp5 profile-fragment restriction (branch B only —
// no config.yml in the workspace).
// ---------------------------------------------------------------------------

test("DIR-120 Phase 3a RED: a `providers:` key in branch-B loop.yml (no config.yml) throws FAIL-CLOSED", () => {
  const ws = tmpWs("providers-key-rejected");
  writeLoopYml(ws, "board: native\ngates: [acceptance]\nproviders: {}\n");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      assert(err.message.includes("providers"), `field 'providers' not named in message: ${err.message}`);
      return true;
    }
  );
});

test("DIR-120 Phase 3a RED: a `providers: null` key in branch-B loop.yml still throws FAIL-CLOSED (any value, including null, counts as present)", () => {
  const ws = tmpWs("providers-null-rejected");
  writeLoopYml(ws, "board: native\ngates: [acceptance]\nproviders: null\n");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      assert(err.message.includes("providers"), `field 'providers' not named in message: ${err.message}`);
      return true;
    }
  );
});

test("DIR-120 Phase 3a GREEN: exp5's real, unmodified loop.yml shape (no providers:, array gates:) still validates", () => {
  const ws = tmpWs("exp5-real-shape-green");
  writeLoopYml(ws, [
    "board: native",
    "gates: [it0-set]",
    "stop: \"until(.halt)\"",
    "policy: value-typed-ledger",
    "concurrency: 2",
  ].join("\n"));
  const params = readLoopParams(ws);
  assert.equal(params.board, "native");
  assert.deepEqual(params.gates, ["it0-set"]);
});

test("DIR-120 Phase 3a RED: object-shaped `gates:` in branch-B loop.yml throws FAIL-CLOSED (pre-existing invariant, now explicitly named)", () => {
  const ws = tmpWs("gates-object-shape-rejected");
  writeLoopYml(ws, "board: native\ngates:\n  it0:\n    - name: foo\n");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      assert(err.message.includes("gates"), `field 'gates' not named in message: ${err.message}`);
      return true;
    },
    "an object-shaped gates: (the unified-config gates: shape) must never be silently accepted as a loop-only profile fragment field"
  );
});

// ---------------------------------------------------------------------------
// DIR-120 Phase 2: gate-side branch-A-only behavior lives in
// gate-config-loader.test.mjs (readGatesConfig is a distinct function from
// readLoopParams, tested in its own dedicated file per the task's own AC).
// ---------------------------------------------------------------------------

test("DIR-050 GREEN: legacy loop.yml fallback when no config.yml at all", () => {
  const ws = tmpWs("no-config-legacy");
  writeLoopYml(ws, "board: native\ngates: [vitest]");
  const params = readLoopParams(ws);
  assert.equal(params.board, "native");
  assert.deepEqual(params.gates, ["vitest"]);
});

test("DIR-050 GREEN: coexist in legacy loop.yml is silently ignored (backward-compat)", () => {
  const ws = tmpWs("coexist-ignored");
  writeLoopYml(ws, "board: native\ngates: [vitest]\ncoexist: pause(backlog/.loop-stop)");
  const params = readLoopParams(ws);
  assert.equal(params.board, "native");
  // coexist must NOT be in result (retired)
  assert.equal(params.coexist, undefined);
  // other fields still work
  assert.equal(params.execution, "dispatched");
});

test("DIR-050 GREEN: coexist: null in legacy loop.yml is silently ignored", () => {
  const ws = tmpWs("coexist-null-ignored");
  writeLoopYml(ws, "board: native\ngates: [it0-set]\nstop: \"until(.halt)\"\ncoexist: null");
  const params = readLoopParams(ws);
  assert.equal(params.coexist, undefined);
  assert.equal(params.board, "native");
});

test("GREEN: routines defaults to [] (no routine track); a valid routine parses (DIR-051)", () => {
  const ws0 = tmpWs("routines-default");
  writeLoopYml(ws0, "board: native\ngates: [vitest]");
  assert.deepEqual(readLoopParams(ws0).routines, []);
  const ws = tmpWs("routines-valid");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nroutines:\n  - name: self-validation\n    trigger: every(5)\n    dispatch: adversarial-explore");
  const r = readLoopParams(ws).routines;
  assert.equal(r.length, 1);
  assert.equal(r[0].name, "self-validation");
  assert.equal(r[0].trigger, "every(5)");
});

test("RED: a malformed routine throws FAIL-CLOSED (DIR-051)", () => {
  const ws1 = tmpWs("routine-bad-trigger");
  writeLoopYml(ws1, "board: native\ngates: [vitest]\nroutines:\n  - name: x\n    trigger: weekly\n    dispatch: y");
  assert.throws(() => readLoopParams(ws1), /FAIL-CLOSED.*trigger/);
  const ws2 = tmpWs("routine-no-name");
  writeLoopYml(ws2, "board: native\ngates: [vitest]\nroutines:\n  - trigger: every(5)\n    dispatch: y");
  assert.throws(() => readLoopParams(ws2), /FAIL-CLOSED.*name/);
  const ws3 = tmpWs("routine-not-array");
  writeLoopYml(ws3, "board: native\ngates: [vitest]\nroutines: nope");
  assert.throws(() => readLoopParams(ws3), /FAIL-CLOSED.*array/);
});

test("DIR-056 GREEN: routine with probe: (no dispatch) is valid", () => {
  const ws = tmpWs("probe-routine");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nroutines:\n  - name: self-validation\n    trigger: on(checkpoint)\n    probe: self-validation");
  const r = readLoopParams(ws).routines;
  assert.equal(r.length, 1);
  assert.equal(r[0].probe, "self-validation");
  assert.equal(r[0].dispatch, undefined);
});

test("DIR-056 GREEN: routine with both probe: and dispatch: is valid (probe takes priority at runtime)", () => {
  const ws = tmpWs("probe-and-dispatch");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nroutines:\n  - name: sv\n    trigger: on(checkpoint)\n    probe: self-validation\n    dispatch: legacy-action");
  const r = readLoopParams(ws).routines;
  assert.equal(r[0].probe, "self-validation");
  assert.equal(r[0].dispatch, "legacy-action");
});

test("DIR-056 RED: routine with neither probe nor dispatch throws FAIL-CLOSED", () => {
  const ws = tmpWs("no-action");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nroutines:\n  - name: broken\n    trigger: on(checkpoint)");
  assert.throws(() => readLoopParams(ws), /FAIL-CLOSED/);
});

test("DIR-056 back-compat: loop.yml with dispatch: adversarial-explore still parses cleanly", () => {
  const ws = tmpWs("backcompat-dispatch");
  writeLoopYml(ws, [
    "board: native",
    "gates: [it0-set]",
    "stop: \"until(.halt)\"",
    "routines:",
    "  - name: self-validation",
    "    trigger: on(checkpoint)",
    "    dispatch: adversarial-explore",
    "  - name: architecture-analysis",
    "    trigger: on(checkpoint)",
    "    dispatch: arch-analyze",
  ].join("\n"));
  const params = readLoopParams(ws);
  assert.equal(params.routines.length, 2);
  assert.equal(params.routines[0].dispatch, "adversarial-explore");
  assert.equal(params.routines[1].dispatch, "arch-analyze");
});

test("GREEN: concurrency N opts into cross-milestone batching (DIR-049)", () => {
  const ws = tmpWs("concurrency-n");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nconcurrency: 3");
  assert.equal(readLoopParams(ws).concurrency, 3);
});

test("RED: concurrency 0 throws FAIL-CLOSED (must be integer >= 1)", () => {
  const ws = tmpWs("concurrency-0");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nconcurrency: 0");
  assert.throws(() => readLoopParams(ws), /FAIL-CLOSED.*concurrency/);
});

test("RED: concurrency non-integer throws FAIL-CLOSED", () => {
  const ws = tmpWs("concurrency-frac");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nconcurrency: 2.5");
  assert.throws(() => readLoopParams(ws), /FAIL-CLOSED.*concurrency/);
});

test("GREEN: minimal valid params (board + gates as string)", () => {
  const ws = tmpWs("str-gates");
  writeLoopYml(ws, "board: native\ngates: vitest");
  const params = readLoopParams(ws);
  assert.deepEqual(params.gates, ["vitest"]);
});

test("GREEN: full valid params (coexist in YAML is silently ignored per DIR-050)", () => {
  const ws = tmpWs("full");
  writeLoopYml(ws, [
    "board: native",
    "gates: [vitest, dod]",
    "stop: once",
    "policy: ready-first",
    "coexist: pause(backlog/.loop-stop)",
  ].join("\n"));
  const params = readLoopParams(ws);
  assert.equal(params.board, "native");
  assert.deepEqual(params.gates, ["vitest", "dod"]);
  assert.equal(params.stop, "once");
  assert.equal(params.policy, "ready-first");
  // DIR-050: coexist retired — not in return value
  assert.equal(params.coexist, undefined);
});

test("GREEN: stop=until(.halt) is valid", () => {
  const ws = tmpWs("halt");
  writeLoopYml(ws, "board: native\ngates: [it0-set]\nstop: \"until(.halt)\"");
  const params = readLoopParams(ws);
  assert.equal(params.stop, "until(.halt)");
});

test("GREEN: stop=until(empty) is valid", () => {
  const ws = tmpWs("empty-stop");
  writeLoopYml(ws, "board: native\ngates: [it0-set]\nstop: \"until(empty)\"");
  const params = readLoopParams(ws);
  assert.equal(params.stop, "until(empty)");
});

test("GREEN: exp5 params shape (coexist removed per DIR-050)", () => {
  const ws = tmpWs("exp5");
  writeLoopYml(ws, [
    "board: native",
    "gates: [it0-set]",
    "stop: \"until(.halt)\"",
    "policy: value-typed-ledger",
  ].join("\n"));
  const params = readLoopParams(ws);
  assert.equal(params.board, "native");
  assert.deepEqual(params.gates, ["it0-set"]);
  assert.equal(params.stop, "until(.halt)");
  assert.equal(params.policy, "value-typed-ledger");
  assert.equal(params.coexist, undefined);
});

test("GREEN: archguard params shape (coexist silently ignored per DIR-050)", () => {
  const ws = tmpWs("archguard");
  writeLoopYml(ws, [
    "board: native",
    "gates: [vitest]",
    "stop: once",
    "policy: ready-first",
    "coexist: pause(backlog/.loop-stop)",
  ].join("\n"));
  const params = readLoopParams(ws);
  assert.equal(params.board, "native");
  assert.deepEqual(params.gates, ["vitest"]);
  assert.equal(params.stop, "once");
  assert.equal(params.policy, "ready-first");
  // DIR-050: coexist retired — silently ignored in legacy YAML
  assert.equal(params.coexist, undefined);
  // DIR-048: new defaults present even when not specified
  assert.equal(params.execution, "dispatched");
  assert.equal(params.audit, "adversarial");
});

// ---------------------------------------------------------------------------
// DIR-048: execution field tests
// ---------------------------------------------------------------------------

test("DIR-048 RED: illegal execution value throws FAIL-CLOSED", () => {
  const ws = tmpWs("bad-execution");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nexecution: sequential");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      assert(err.message.includes("execution"), `field 'execution' not mentioned: ${err.message}`);
      return true;
    }
  );
});

test("DIR-048 GREEN: absent execution defaults to dispatched (NOT inline)", () => {
  const ws = tmpWs("execution-absent");
  writeLoopYml(ws, "board: native\ngates: [vitest]");
  const params = readLoopParams(ws);
  assert.equal(params.execution, "dispatched", "default must be dispatched, not inline");
  assert.notEqual(params.execution, "inline");
});

test("DIR-048 GREEN: explicit execution: dispatched passes", () => {
  const ws = tmpWs("execution-dispatched");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nexecution: dispatched");
  const params = readLoopParams(ws);
  assert.equal(params.execution, "dispatched");
});

test("DIR-048 GREEN: explicit execution: inline passes", () => {
  const ws = tmpWs("execution-inline");
  writeLoopYml(ws, "board: native\ngates: [vitest]\nexecution: inline");
  const params = readLoopParams(ws);
  assert.equal(params.execution, "inline");
});

// ---------------------------------------------------------------------------
// DIR-048: audit field tests
// ---------------------------------------------------------------------------

test("DIR-048 RED: illegal audit value throws FAIL-CLOSED", () => {
  const ws = tmpWs("bad-audit");
  writeLoopYml(ws, "board: native\ngates: [vitest]\naudit: verify");
  assert.throws(
    () => readLoopParams(ws),
    (err) => {
      assert(err instanceof Error, "must be Error");
      assert(err.message.includes("FAIL-CLOSED"), `got: ${err.message}`);
      assert(err.message.includes("audit"), `field 'audit' not mentioned: ${err.message}`);
      return true;
    }
  );
});

test("DIR-048 GREEN: absent audit defaults to adversarial (NOT none)", () => {
  const ws = tmpWs("audit-absent");
  writeLoopYml(ws, "board: native\ngates: [vitest]");
  const params = readLoopParams(ws);
  assert.equal(params.audit, "adversarial", "default must be adversarial, not none");
  assert.notEqual(params.audit, "none");
});

test("DIR-048 GREEN: explicit audit: adversarial passes", () => {
  const ws = tmpWs("audit-adversarial");
  writeLoopYml(ws, "board: native\ngates: [vitest]\naudit: adversarial");
  const params = readLoopParams(ws);
  assert.equal(params.audit, "adversarial");
});

test("DIR-048 GREEN: explicit audit: none passes", () => {
  const ws = tmpWs("audit-none");
  writeLoopYml(ws, "board: native\ngates: [vitest]\naudit: none");
  const params = readLoopParams(ws);
  assert.equal(params.audit, "none");
});

// ---------------------------------------------------------------------------
// DIR-048: opt-out combo (backward-compatible escape hatch)
// ---------------------------------------------------------------------------

test("DIR-048 GREEN: opt-out combo inline+none returns inline/none", () => {
  const ws = tmpWs("opt-out-combo");
  writeLoopYml(ws, [
    "board: native",
    "gates: [vitest]",
    "execution: inline",
    "audit: none",
  ].join("\n"));
  const params = readLoopParams(ws);
  assert.equal(params.execution, "inline", "explicit inline must be respected");
  assert.equal(params.audit, "none", "explicit none must be respected");
  // other fields unchanged
  assert.equal(params.board, "native");
  assert.deepEqual(params.gates, ["vitest"]);
  assert.equal(params.stop, "once");
});

// DIR-051 dual-source guard: readLoopParams' trigger validation must agree with routine-scheduler's
// parseTrigger (the audit flagged the two regexes as a latent drift). Fuzz both, assert agreement.
test("DIR-051: loop-params trigger validation agrees with routine-scheduler parseTrigger (no drift)", async () => {
  const { parseTrigger } = await import("../../../experiments/quay-perpetual-stream/scripts/routine-scheduler.ts");
  const cases = ["every(5)", "every(1)", "every( 3 )", "on(checkpoint)", "on(idle)", "on(a-b)",
                 "every(0)", "every(-1)", "every()", "every(00)", "every(2.5)", "daily", "on()", "on(a b)", "EVERY(5)", "every(5)x",
                 "interval:60m", "interval: 60 m", "interval:5m", "interval:1m", "interval:1440m",
                 "interval:0m", "interval:-1m", "interval:m", "interval:", "interval:2.5m", "interval:60h", "interval:60M", "interval:60"];
  for (const t of cases) {
    let paramsAccepts = true;
    try { readLoopParams(writeAndWs(t)); } catch { paramsAccepts = false; }
    let schedAccepts = true;
    try { parseTrigger(t); } catch { schedAccepts = false; }
    assert.equal(paramsAccepts, schedAccepts, `drift on trigger "${t}": loop-params=${paramsAccepts} scheduler=${schedAccepts}`);
  }
});
function writeAndWs(trigger) {
  const ws = tmpWs("trig-fuzz");
  writeLoopYml(ws, `board: native\ngates: [vitest]\nroutines:\n  - name: r\n    trigger: ${JSON.stringify(trigger)}\n    dispatch: x`);
  return ws;
}
