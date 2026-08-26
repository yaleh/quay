// @test-group product
// lifecycle-a1-legal.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A1 — legalForward / legalBack return the edge or null
// (incl. unknown status). The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { legalForward, legalBack } from "../src/gate/lifecycle.ts";

test("A1: legalForward / legalBack return the edge or null (incl. unknown status)", () => {
  assert.equal(legalForward("todo"), "ready");
  assert.equal(legalForward("done"), null);
  assert.equal(legalBack("ready"), "todo");
  assert.equal(legalBack("todo"), null);
  assert.equal(legalBack("needs-human"), "todo");
  assert.equal(legalForward("superseded"), null, "superseded has no forward edge");
  assert.equal(legalBack("superseded"), null, "superseded has no back edge (hard terminal)");
  assert.equal(legalForward("bogus"), null);
  assert.equal(legalBack("bogus"), null);
});
