// loop-params.test.mjs — RED→GREEN tests for readLoopParams (DIR-045 AC2)
//
// Contract: readLoopParams(workspaceRoot) → params | throws Error("FAIL-CLOSED: ...")
//   FAIL-CLOSED cases (throw):
//     - missing .quay/loop.yml
//     - malformed YAML
//     - missing required field `board`
//     - missing required field `gates`
//     - invalid `stop` value
//   GREEN cases (returns valid params):
//     - minimal valid params (board + gates)
//     - full valid params (all fields)
//     - exp5 params shape
//     - archguard params shape
//
// Run: node --test packages/quay/test/loop-params.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { readLoopParams } from "../src/loop-params.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tmpWs(tag) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `quay-loop-params-${tag}-`));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  return ws;
}

function writeLoopYml(ws, content) {
  fs.writeFileSync(path.join(ws, ".quay", "loop.yml"), content);
}

// ---------------------------------------------------------------------------
// RED cases — must throw Error with "FAIL-CLOSED" in message
// ---------------------------------------------------------------------------

test("RED: missing .quay/loop.yml throws FAIL-CLOSED", () => {
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

test("GREEN: minimal valid params (board + gates as array)", () => {
  const ws = tmpWs("minimal");
  writeLoopYml(ws, "board: native\ngates: [vitest]");
  const params = readLoopParams(ws);
  assert.equal(params.board, "native");
  assert.deepEqual(params.gates, ["vitest"]);
  // defaults
  assert.equal(params.stop, "once");
  assert.equal(params.policy, "ready-first");
  assert.equal(params.coexist, null);
  // DIR-048 new defaults
  assert.equal(params.execution, "dispatched");
  assert.equal(params.audit, "adversarial");
  // DIR-049 default: concurrency 1 (serial)
  assert.equal(params.concurrency, 1);
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

test("GREEN: full valid params", () => {
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
  assert.equal(params.coexist, "pause(backlog/.loop-stop)");
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

test("GREEN: exp5 params shape", () => {
  const ws = tmpWs("exp5");
  writeLoopYml(ws, [
    "board: native",
    "gates: [it0-set]",
    "stop: \"until(.halt)\"",
    "policy: value-typed-ledger",
    "coexist: null",
  ].join("\n"));
  const params = readLoopParams(ws);
  assert.equal(params.board, "native");
  assert.deepEqual(params.gates, ["it0-set"]);
  assert.equal(params.stop, "until(.halt)");
  assert.equal(params.policy, "value-typed-ledger");
});

test("GREEN: archguard params shape", () => {
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
  assert.equal(params.coexist, "pause(backlog/.loop-stop)");
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
  const { parseTrigger } = await import("../../../experiments/quay-perpetual-stream/scripts/routine-scheduler.mjs");
  const cases = ["every(5)", "every(1)", "every( 3 )", "on(checkpoint)", "on(idle)", "on(a-b)",
                 "every(0)", "every(-1)", "every()", "every(00)", "every(2.5)", "daily", "on()", "on(a b)", "EVERY(5)", "every(5)x"];
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
