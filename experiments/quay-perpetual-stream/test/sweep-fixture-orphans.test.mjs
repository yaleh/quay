// Regression coverage for sweep-fixture-orphans.mjs's matching boundary — added 2026-07-31 per an
// independent review of gap-prepare-milestone-convergence-test-fixture-pollutes-tracked-tree, which
// flagged that the boundary between "real orphan" and "real tracked milestone/plan file" had only
// ever been checked manually (and the implementer reports accidentally `rm -rf`'ing a real tracked
// M209 during that manual testing, caught and restored via `git checkout --`). This file makes that
// boundary a permanent, automated assertion instead of tribal knowledge.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findOrphans, sweepOrphans, ORPHAN_SHAPES } from "../scripts/sweep-fixture-orphans.mjs";

function makeScratchRepoRoot() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-fixture-orphans-test-"));
  fs.mkdirSync(path.join(repoRoot, "docs", "plans"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "milestones"), { recursive: true });
  return repoRoot;
}

function touchPlanFile(repoRoot, name) {
  fs.writeFileSync(path.join(repoRoot, "docs", "plans", name), "# scratch\n");
}

function touchMilestoneDir(repoRoot, name) {
  const dir = path.join(repoRoot, "milestones", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "keep.md"), "real content\n");
  return dir;
}

describe("gap-prepare-milestone-convergence-test-fixture-pollutes-tracked-tree: sweep matching boundary", () => {
  test("ORPHAN_SHAPES regexes match exactly the two documented shapes, nothing looser", () => {
    assert.equal(ORPHAN_SHAPES.convergenceRandom.planFile.test("M912345-foo.md"), true);
    assert.equal(ORPHAN_SHAPES.convergenceRandom.milestoneDir.test("M912345"), true);
    assert.equal(ORPHAN_SHAPES.preparationE2eFixed.planFile.test("M997-foo.md"), true);
    assert.equal(ORPHAN_SHAPES.preparationE2eFixed.milestoneDir.test("M997"), true);
  });

  test("finds both real orphan shapes (random M9xxxxx + fixed M997) and nothing else, in a scratch repoRoot", () => {
    const repoRoot = makeScratchRepoRoot();
    try {
      touchPlanFile(repoRoot, "M912345-fake-orphan-task.md");
      touchMilestoneDir(repoRoot, "M912345");
      touchPlanFile(repoRoot, "M997-fake-orphan-task.md");
      touchMilestoneDir(repoRoot, "M997");

      const found = findOrphans({ repoRoot }).map((p) => path.relative(repoRoot, p)).sort();
      assert.deepEqual(found, [
        "docs/plans/M912345-fake-orphan-task.md",
        "docs/plans/M997-fake-orphan-task.md",
        "milestones/M912345",
        "milestones/M997",
      ]);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("never matches real-looking non-orphans: 3-digit milestone dirs, non-6-digit plan files, 5/7-digit near-misses", () => {
    const repoRoot = makeScratchRepoRoot();
    try {
      // Real tracked milestone shapes (the exact class the implementer accidentally rm -rf'd once).
      touchMilestoneDir(repoRoot, "M209");
      touchMilestoneDir(repoRoot, "M90");
      touchMilestoneDir(repoRoot, "M99");
      touchPlanFile(repoRoot, "M91-not-six-digits.md");
      // Near-miss digit counts that must NOT match the 6-digit-only convergenceRandom shape.
      touchMilestoneDir(repoRoot, "M99999"); // 5 digits
      touchPlanFile(repoRoot, "M99999-nolug.md");
      touchMilestoneDir(repoRoot, "M9123456"); // 7 digits
      touchPlanFile(repoRoot, "M9123456-slug.md");

      const found = findOrphans({ repoRoot });
      assert.deepEqual(found, [], `expected zero matches, got: ${JSON.stringify(found)}`);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("dryRun leaves every file on disk untouched and still reports what would be removed", () => {
    const repoRoot = makeScratchRepoRoot();
    try {
      touchPlanFile(repoRoot, "M912345-fake-orphan-task.md");
      const dir = touchMilestoneDir(repoRoot, "M912345");

      const found = sweepOrphans({ repoRoot, dryRun: true });
      assert.equal(found.length, 2);
      assert.equal(fs.existsSync(path.join(repoRoot, "docs", "plans", "M912345-fake-orphan-task.md")), true);
      assert.equal(fs.existsSync(dir), true);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("real sweep removes exactly the matched orphans and leaves real-looking non-orphans untouched", () => {
    const repoRoot = makeScratchRepoRoot();
    try {
      touchPlanFile(repoRoot, "M912345-fake-orphan-task.md");
      touchMilestoneDir(repoRoot, "M912345");
      const realMilestoneDir = touchMilestoneDir(repoRoot, "M209");
      const realPlanFile = path.join(repoRoot, "docs", "plans", "M91-not-six-digits.md");
      touchPlanFile(repoRoot, "M91-not-six-digits.md");

      const removed = sweepOrphans({ repoRoot });
      assert.equal(removed.length, 2);
      assert.equal(fs.existsSync(path.join(repoRoot, "milestones", "M912345")), false);
      assert.equal(fs.existsSync(path.join(repoRoot, "docs", "plans", "M912345-fake-orphan-task.md")), false);
      // Real-looking non-orphans survive the sweep untouched.
      assert.equal(fs.existsSync(realMilestoneDir), true);
      assert.equal(fs.existsSync(realPlanFile), true);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("shapes filter narrows to only the requested shape (mirrors the after() hook's convergenceRandom-only scope)", () => {
    const repoRoot = makeScratchRepoRoot();
    try {
      touchPlanFile(repoRoot, "M912345-fake-orphan-task.md");
      touchMilestoneDir(repoRoot, "M912345");
      touchPlanFile(repoRoot, "M997-fake-orphan-task.md");
      touchMilestoneDir(repoRoot, "M997");

      const found = findOrphans({ repoRoot, shapes: ["convergenceRandom"] })
        .map((p) => path.relative(repoRoot, p))
        .sort();
      assert.deepEqual(found, [
        "docs/plans/M912345-fake-orphan-task.md",
        "milestones/M912345",
      ]);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
