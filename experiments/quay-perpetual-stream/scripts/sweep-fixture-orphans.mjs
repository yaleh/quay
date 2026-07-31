// sweep-fixture-orphans.mjs — gap-prepare-milestone-convergence-test-fixture-pollutes-tracked-tree
//
// PROBLEM this closes: plugin/test/prepare-milestone-convergence.test.mjs (and
// prepare-milestone-preparation-e2e.test.mjs) drive the REAL, unmodified prepare-milestone.js
// workflow source to get genuine workflow-integration coverage. Because the Plan-file/receipt
// paths they exercise are the SAME production path formula under test
// (`docs/plans/${milestoneId}-${slug}.md`, `milestones/${milestoneId}/`), the tests cannot
// redirect those writes into an isolated scratch tree without compromising what's under test —
// see the task's own Finding for why relocating the write path is an explicit non-goal. Each
// test wraps its own scratch state in `try { ... } finally { cleanup(...) }`, but a `finally`
// block never runs if the whole Node process is killed mid-test (which happened repeatedly
// during 2026-07-31 prepare-milestone debugging — 262 orphaned docs/plans/M9xxxxx-*.md files +
// 60 orphaned milestones/M9xxxxx/ dirs found and cleared by hand, commit 9f35c85).
//
// The two known orphan shapes (mirrors .gitignore's own two blocks, same commit):
//   - `docs/plans/M9[0-9]{5}-*.md` / `milestones/M9[0-9]{5}/` — prepare-milestone-convergence.
//     test.mjs's per-test RANDOM milestoneId (`M${Math.floor(900000 + Math.random() * 90000)}`).
//   - `docs/plans/M997-*.md` / `milestones/M997/` — prepare-milestone-preparation-e2e.test.mjs's
//     own FIXED milestoneId.
// Real milestone IDs never reach 6 digits, so neither shape can collide with a genuine milestone.
//
// This module is imported by prepare-milestone-convergence.test.mjs's own suite-level `after()`
// hook (narrowed to the `convergenceRandom` shape only — orphans from THIS file's prior
// interrupted run, not from other test files) AND runnable standalone for periodic
// manual/loop-driven local-disk hygiene (sweeps BOTH shapes by default — these are gitignored,
// so `git status --porcelain` never surfaces them; a periodic sweep is the only thing that bounds
// local-disk/inode accumulation across many interrupted debugging runs).
//
// Usage (standalone):
//   node experiments/quay-perpetual-stream/scripts/sweep-fixture-orphans.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Keep in sync with .gitignore's own two "gap-prepare-milestone-convergence-test-fixture-
// pollutes-production-tree" blocks — this module and .gitignore are two independent
// enforcement mechanisms over the SAME two named orphan shapes, not two sources of truth for
// what the shapes ARE (the shapes themselves are named once, here, and cross-referenced there).
export const ORPHAN_SHAPES = {
  convergenceRandom: {
    planFile: /^M9[0-9]{5}-.*\.md$/,
    milestoneDir: /^M9[0-9]{5}$/,
  },
  preparationE2eFixed: {
    planFile: /^M997-.*\.md$/,
    milestoneDir: /^M997$/,
  },
};

const ALL_SHAPE_NAMES = Object.keys(ORPHAN_SHAPES);

/**
 * Scan `docs/plans/` and `milestones/` under `repoRoot` for orphans matching the given shapes.
 * Pure filesystem glob — deliberately NOT `git status`, since these paths are gitignored and
 * therefore invisible to `git status --porcelain`'s default `??` output.
 */
export function findOrphans({ repoRoot = REPO_ROOT, shapes = ALL_SHAPE_NAMES } = {}) {
  const orphans = [];
  const planFileRes = shapes.map((s) => ORPHAN_SHAPES[s].planFile);
  const milestoneDirRes = shapes.map((s) => ORPHAN_SHAPES[s].milestoneDir);

  const plansDir = path.join(repoRoot, 'docs', 'plans');
  if (fs.existsSync(plansDir)) {
    for (const name of fs.readdirSync(plansDir)) {
      if (planFileRes.some((re) => re.test(name))) orphans.push(path.join(plansDir, name));
    }
  }

  const milestonesDir = path.join(repoRoot, 'milestones');
  if (fs.existsSync(milestonesDir)) {
    for (const name of fs.readdirSync(milestonesDir)) {
      if (!milestoneDirRes.some((re) => re.test(name))) continue;
      const p = path.join(milestonesDir, name);
      if (fs.statSync(p).isDirectory()) orphans.push(p);
    }
  }

  return orphans;
}

/**
 * Remove any orphans found (see findOrphans). Returns the list of paths removed (or, under
 * dryRun, the list that WOULD be removed — nothing is deleted).
 */
export function sweepOrphans({ repoRoot = REPO_ROOT, shapes = ALL_SHAPE_NAMES, dryRun = false } = {}) {
  const found = findOrphans({ repoRoot, shapes });
  if (!dryRun) {
    for (const p of found) fs.rmSync(p, { recursive: true, force: true });
  }
  return found;
}

// CLI mode — only when invoked directly (`node sweep-fixture-orphans.mjs`), never on import.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  const found = sweepOrphans({ dryRun });
  if (found.length === 0) {
    console.log('sweep-fixture-orphans: clean — no M9xxxxx/M997 fixture orphans found on local disk.');
  } else {
    console.log(`sweep-fixture-orphans: ${dryRun ? 'would remove' : 'removed'} ${found.length} orphan(s):`);
    for (const p of found) console.log(`  ${path.relative(REPO_ROOT, p)}`);
  }
}
