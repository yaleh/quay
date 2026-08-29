// @test-group engine
// canonical-test-files-symlink-order.test.mjs — gap-canonical-test-files-glob-vs-realpath-divergence:
// the negative control that proves the three checkers now share ONE canonicalTestFiles source with
// REALPATH dedup semantics (matching scripts/test.sh build_deduped_files), not the glob-path
// semantics two of the copies drifted into.
//
// The divergence only surfaces when a symlink is globbed BEFORE its target: the glob-matched path
// (the symlink) is pushed instead of its realpath (the target). In the real repo the glob order
// (plugin/test/ before experiments/…/test/) happened to hide this, so a test that reverses the
// order is the fixture that makes the two semantics give DIFFERENT answers — and asserts the
// realpath one (AC2: the three checkers stay consistent; AC3: the symlink's target is deduped).
//
// Run:
//   node --no-warnings --experimental-strip-types --test plugin/test/canonical-test-files-symlink-order.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { canonicalTestFiles as shared } from "../scripts/canonical-test-files.ts";
import { canonicalTestFiles as fromDowngrade } from "../scripts/test-group-downgrade-check.ts";
import { canonicalTestFiles as fromPolicy } from "../scripts/test-framework-policy-check.ts";
import { canonicalTestFiles as fromCensus } from "../scripts/test-impl-census-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** A minimal repo root whose canonical glob lists the symlink dir BEFORE its target dir — the
 * order under which glob-path semantics and realpath semantics disagree. */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-test-files-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "test"), { recursive: true });
  fs.mkdirSync(path.join(root, "experiments", "quay-perpetual-stream", "test"), { recursive: true });
  // symlink dir FIRST — the negative-control order.
  fs.writeFileSync(
    path.join(root, "scripts", "test.sh"),
    `glob=(experiments/quay-perpetual-stream/test/*.test.mjs plugin/test/*.test.mjs)\n`
  );
  // The real target under plugin/test/, and its symlink copy under experiments/…/test/.
  fs.writeFileSync(path.join(root, "plugin", "test", "shared.test.mjs"), "// target\n");
  fs.symlinkSync(
    path.join(root, "plugin", "test", "shared.test.mjs"),
    path.join(root, "experiments", "quay-perpetual-stream", "test", "shared.test.mjs")
  );
  return root;
}

test("symlink globbed before its target collapses to the realpath, once (AC2/AC3)", () => {
  const root = makeFixture();
  try {
    const expected = ["plugin/test/shared.test.mjs"];
    // The shared source reports the REALPATH (the target), not the glob path (the symlink).
    assert.deepEqual(shared(root), expected);
    // AC1/AC2: all three checkers re-export the SAME single source → identical output.
    assert.deepEqual(fromDowngrade(root), expected);
    assert.deepEqual(fromPolicy(root), expected);
    assert.deepEqual(fromCensus(root), expected);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("distinct real files are all returned — realpath dedup is not false-dedup", () => {
  const root = makeFixture();
  try {
    fs.writeFileSync(path.join(root, "plugin", "test", "other.test.mjs"), "// other\n");
    assert.deepEqual(shared(root), ["plugin/test/other.test.mjs", "plugin/test/shared.test.mjs"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
