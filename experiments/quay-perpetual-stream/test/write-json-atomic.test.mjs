// @test-group engine
// write-json-atomic.test.mjs — unit tests for experiments/.../scripts/write-json-atomic.ts
// (tasks/gap-writestate-atomicity-split).
//
// Sibling test required by ADR-001's loadbearing-test-gate: write-json-atomic.ts is load-bearing
// (imported by proposal-convergence.ts — 4 call sites) and therefore must carry a `<name>.test.mjs`
// sibling. The negative-control concurrent-read test lives in
// plugin/test/writestate-atomicity-split.test.mjs (AC2); this file is the SOURCE copy's unit floor:
// it pins the two behaviors every caller relies on — (1) the target is written as pretty-printed
// JSON + trailing newline and its parent directories are created, and (2) an overwrite leaves no
// `.tmp-` residue (the rename lands the new content and the temp name is gone).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "../scripts/write-json-atomic.ts";

test("writeJsonAtomic writes pretty-printed JSON with a trailing newline, creating parent dirs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wja-exp-"));
  const p = path.join(dir, "nested", "deep", "state.json");
  writeJsonAtomic(p, { a: 1, b: [2, 3], c: "x" });

  const raw = fs.readFileSync(p, "utf8");
  assert.equal(raw, JSON.stringify({ a: 1, b: [2, 3], c: "x" }, null, 2) + "\n");
  assert.deepEqual(JSON.parse(raw), { a: 1, b: [2, 3], c: "x" });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("writeJsonAtomic overwrites an existing file and leaves no .tmp- residue", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wja-exp-"));
  const p = path.join(dir, "state.json");
  writeJsonAtomic(p, { v: 1 });
  writeJsonAtomic(p, { v: 2 });

  assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf8")), { v: 2 });
  const residue = fs.readdirSync(dir).filter((f) => f.includes(".tmp-"));
  assert.deepEqual(residue, [], "an atomic overwrite must not leave a temp file behind");
  fs.rmSync(dir, { recursive: true, force: true });
});
