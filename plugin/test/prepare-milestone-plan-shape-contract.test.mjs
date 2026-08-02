// @test-group engine
// gap-planauthor-shape-rules-not-injected (2026-08-02).
//
// The PlanAuthor prompt carries a `_planShapeContract` block stating the two constraints that
// `PreflightPlan` mechanically rejects on. Those constraints are a PROMPT-SIDE restatement of
// rules whose single source lives in prepare-admission-check.ts. This test links the two
// BEHAVIORALLY — every command prefix the contract advertises is run through the real
// `_RUNNABLE_COMMAND_RE`, so a change to the regex that the contract does not track fails here
// rather than silently reintroducing the authored-then-rejected loop.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _RUNNABLE_COMMAND_RE } from "../scripts/prepare-admission-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This file is a BYTE-IDENTICAL sibling at two depths — experiments/quay-perpetual-stream/test/
// (3 levels below the repo root) and plugin/test/ (2 levels). Walk up to the marker instead of
// hardcoding a depth, so one file works verbatim from both locations.
function _findRepoRoot(start) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".claude", "workflows")) && fs.existsSync(path.join(dir, "plugin", "workflows"))) return dir;
    if (path.dirname(dir) === dir) throw new Error(`repo root not found above ${start}`);
  }
}
const REPO_ROOT = _findRepoRoot(__dirname);
const MIRRORS = [
  path.join(REPO_ROOT, ".claude/workflows/prepare-milestone.js"),
  path.join(REPO_ROOT, "plugin/workflows/prepare-milestone.js"),
];

// The prefixes the contract advertises to the PlanAuthor. Kept as a literal list so a contract
// edit that adds/removes a prefix must also be reflected here — and then validated against the
// real regex below.
const ADVERTISED_PREFIXES = ["node", "npm", "npx", "bash", "sh", "git", "scripts/", "`"];

describe("PlanAuthor plan-shape contract", () => {
  test("AC1: _planShapeContract is defined in both workflow mirrors", () => {
    for (const p of MIRRORS) {
      const src = fs.readFileSync(p, "utf8");
      assert.match(src, /const _planShapeContract = `/, `${p} defines _planShapeContract`);
    }
  });

  test("AC2: the contract is interpolated into the PlanAuthor prompt", () => {
    for (const p of MIRRORS) {
      const src = fs.readFileSync(p, "utf8");
      // The interpolation site must be inside the PlanAuthor agent dispatch, after phase('PlanAuthor').
      const planAuthorIdx = src.indexOf("phase('PlanAuthor')");
      assert.ok(planAuthorIdx > 0, `${p} has a PlanAuthor phase`);
      const interpIdx = src.indexOf("${_planShapeContract}", planAuthorIdx);
      assert.ok(interpIdx > planAuthorIdx, `${p} interpolates the contract after phase('PlanAuthor')`);
      // And before the PlanCheck phase, i.e. genuinely in the author prompt.
      const planCheckIdx = src.indexOf("phase('PlanCheck')");
      assert.ok(interpIdx < planCheckIdx, `${p} interpolates the contract before PlanCheck`);
    }
  });

  test("AC3: the contract states the Files-must-already-be-in-Touches constraint", () => {
    const src = fs.readFileSync(MIRRORS[0], "utf8");
    const contract = src.match(/const _planShapeContract = `([\s\S]*?)`\n/)[1];
    assert.match(contract, /- Files:/);
    assert.match(contract, /## Touches/);
    assert.match(contract, /ALREADY/i);
  });

  test("AC4: the contract states the runnable-Command constraint and lists the prefixes", () => {
    const src = fs.readFileSync(MIRRORS[0], "utf8");
    const contract = src.match(/const _planShapeContract = `([\s\S]*?)`\n/)[1];
    assert.match(contract, /- Command:/);
    for (const prefix of ADVERTISED_PREFIXES) {
      assert.ok(
        contract.includes(prefix),
        `contract advertises the ${JSON.stringify(prefix)} command prefix`,
      );
    }
  });

  test("AC5: every prefix the contract advertises is ACCEPTED by the real _RUNNABLE_COMMAND_RE", () => {
    // Behavioral anti-drift: if the regex tightens and drops a prefix, this fails even though the
    // contract prose still reads fine.
    for (const prefix of ADVERTISED_PREFIXES) {
      const sample = prefix === "`" ? "`scripts/test.sh`" : `${prefix} something`;
      assert.ok(
        _RUNNABLE_COMMAND_RE.test(sample),
        `_RUNNABLE_COMMAND_RE accepts a command starting with ${JSON.stringify(prefix)}`,
      );
    }
  });

  test("AC6: the prose commands the contract warns against are REJECTED by the real regex", () => {
    // These are the exact strings the contract names as rejected — they must actually be rejected.
    for (const prose of ["Verify the output matches", "Run the test suite"]) {
      assert.equal(
        _RUNNABLE_COMMAND_RE.test(prose),
        false,
        `_RUNNABLE_COMMAND_RE rejects the prose command ${JSON.stringify(prose)}`,
      );
    }
    // And the contract's suggested replacement IS accepted.
    assert.ok(_RUNNABLE_COMMAND_RE.test("scripts/test.sh path/to/file.test.mjs"));
  });

  test("AC7: both workflow mirrors are byte-identical", () => {
    const [a, b] = MIRRORS.map((p) => fs.readFileSync(p));
    assert.ok(a.equals(b), "prepare-milestone.js mirrors are byte-identical");
  });
});
