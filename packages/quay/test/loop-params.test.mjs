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
});
