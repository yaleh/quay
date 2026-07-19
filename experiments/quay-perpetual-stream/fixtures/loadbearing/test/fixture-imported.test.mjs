// FIXTURE (loadbearing gate) — the sibling test proving fixture-imported.mjs is COVERED. Its mere
// existence (name `fixture-imported.test.mjs` in a `test/` dir) is what the gate detects; it does not
// need to be exhaustive. Kept runnable so the fixture tree is not dead weight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { noop } from "../scripts/fixture-imported.mjs";
test("fixture-imported.noop returns 42", () => {
  assert.equal(noop(), 42);
});
