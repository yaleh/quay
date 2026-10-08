// @test-group engine
// loop-shipping.test.mjs — gap-loop-mechanism-lives-outside-the-package-and-cannot-ship.
// Pins the physical facts the task's AC1/AC2/AC7 rest on, so a future move back out of the
// package (or a second physical copy) fails loudly instead of silently re-introducing the
// "half the mechanism lives outside the plugin" gap:
//
//   AC1 — the 5 formerly-plugin-external mechanism files now live INSIDE plugin/, and their
//         old paths are symlink re-exports (the fast-mode-telemetry precedent), so the quay
//         repo's own references keep working without a second physical copy.
//   AC2 — fast-mode-telemetry.ts has ONE physical copy (plugin/scripts/ is authoritative; the
//         experiments/ path is a symlink re-export, not a duplicate).
//   AC7 — the shipped plugin subtree contains none of the per-project state files that must
//         NOT ship (tick-log.md / escalations.md / batch2-queue-state.md / exp6-* / ADR-021-*),
//         and `npm pack --dry-run` (the Contract's `packed` measure) excludes them too.
//
// Run:
//   scripts/test.sh plugin/test/loop-shipping.test.mjs
//   node --test plugin/test/loop-shipping.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { oldPaths, oldPathPatterns, exclusionEntries, worktreeContainerPaths, stagingDirPrefix } from '../scripts/loop-shipping-exclusion-data.mjs';
// The repo's ONE temp-dir helper (mkdtemp under a resolved writable root + file-level after()
// cleanup). The controls below build their probe trees in it rather than in the shared checkout —
// a test must not create or delete entries under a checked-in path
// (plugin/scripts/checked-in-write-check.ts), and a probe written into the tree is exactly the
// transient other tests' whole-repo walks race against.
import { makeTmpDir } from './helpers/tmp-workspace.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');

// ── Shared corpus walk + worktree-container exclusion ──────────────────────────────────────────────
// walk() is an fs traversal and does NOT respect gitignore: a git worktree under the repo (e.g.
// .claude/worktrees/agent-*/ or milestones/M*/worktrees/iteration-0) is a COMPLETE content copy whose
// stale-path strings and file copies would be scanned as if they were the main repo → AC1b/AC2
// false-red (gap-loop-shipping-scan-does-not-exclude-worktrees). worktreeContainerPaths (single source
// in loop-shipping-exclusion-data.mjs) supplies every container path; walkCorpus skips them exactly
// like node_modules/.git/dist. It ALSO skips any `plugin-staging-*` dir by NAME (stagingDirPrefix,
// single source in the same module): a KILLED stagePackagedPlugin() run leaves packages/quay/
// plugin-staging-<pid>-{0,1}/ orphans that carry a full plugin/ copy — their tick-doc old-path strings
// + scripts/*.ts false-red AC1b/AC2 (gap-orphan-staging-dirs-pollute-walkcorpus).
//
// `tmp/` joins that skip set for the same reason adr016-screen-use-check.ts's SKIP_DIRS carries it
// (gap-goal-merge-suite-concurrent-npm-pack-staging-race-blocks-fan-in): it is the gitignored
// repo-root RUNTIME scratch, and the sibling selftests (run-identity.ts / stage-receipt.ts /
// workflow-journal.ts) mkdtemp a fixture under `<cwd>/tmp/` and rm -rf it mid-suite. This walk is an
// fs traversal over the LIVE shared checkout, so it is not just a "fixture copy double-counts a real
// script" problem — the fixture DIRECTORY can vanish between its parent's readdir and its own,
// which is what the ENOENT guard below absorbs. The sibling checker landed the tmp/ prune first
// (2026-10-06); this walk is the same defect one file over (硬规则 5b).
function walkCorpus(dir, { excluded = [], includeWorktrees = false, containerRoot = repoRoot } = {}) {
  // gap-loop-shipping-nested-worktree-container-false-exclude: worktreeContainerPaths(repoRoot)
  // includes EVERY worktree `git worktree list` reports, including ones that are ANCESTORS of
  // `dir` (e.g. the main checkout, when this suite runs from a nested `.claude/worktrees/<name>/`
  // worktree — the harness's EnterWorktree layout). A container `c` that is an ancestor of `dir`
  // makes `p.startsWith(c + path.sep)` true for EVERY `p` under `dir` (since `dir` itself is under
  // `c`), so isContainer() matched everything and the walk starved to just `dir`'s own top-level
  // files ("only 8 files scanned"). A container can only ever be REACHED by walking `dir`'s own
  // subtree, so containers outside that subtree are never relevant — filter to descendants of (or
  // equal to) `dir` before checking.
  // `containerRoot` is where `git worktree list` is asked (default: the real repo — every production
  // call site walks repoRoot). A control that builds its probe tree in a private temp dir passes its
  // OWN root here so the derived container set is the one that actually bounds the walk it judges;
  // passing `repoRoot` while walking a temp tree is also legitimate (see the real-worktree control:
  // the registration is real, the walked tree is private).
  const rawContainers = includeWorktrees ? new Set() : worktreeContainerPaths(containerRoot);
  const containers = [...rawContainers].filter((c) => c === dir || c.startsWith(dir + path.sep));
  const isContainer = (p) => containers.some((c) => p === c || p.startsWith(c + path.sep));
  const scanned = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      // gap-goal-merge-suite-concurrent-npm-pack-staging-race-blocks-fan-in: a directory listed by
      // its parent and then removed before this read (a parallel test's mkdtemp fixture under
      // `<cwd>/tmp/`, torn down mid-suite) made this raw readdirSync throw ENOENT and red whichever
      // test happened to be walking — reproduced 11/40 runs under fixture churn, reporting
      // `ENOENT ... scandir '<root>/tmp/<fixture>/N'`. Same principle as `readCorpusText` below,
      // one level up: a subtree that vanished mid-walk is a transient artifact, not corpus content.
      // ⛔ ONLY ENOENT — EACCES/EIO still throw (硬规则 3b: "cannot read" must not masquerade as
      // "read fine, nothing there").
      if (e.code === 'ENOENT') return;
      throw e;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'tmp' || e.name.startsWith(stagingDirPrefix)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (isContainer(p) || excluded.some((x) => p === x || p.startsWith(x + path.sep))) continue;
        walk(p); continue;
      }
      if (!/\.(md|sh|mjs|ts|json|yml|js)$/.test(e.name)) continue;
      if (excluded.some((x) => p === x || p.startsWith(x + path.sep))) continue;
      scanned.push(p);
    }
  };
  walk(dir);
  return scanned;
}

// ENOENT-tolerant read for the AC1b corpus scan (gap-loop-shipping-ac1b-walk-enoent-race): walkCorpus
// enumerates a path into `scanned`, then a PARALLEL test can delete it before readFileSync reaches it
// (the run-identity-selftest-* tests mkdir/rm their tmp/ worktrees mid-suite). A file that vanished
// between walk and read is a transient artifact, NOT a live old-path reference — skip it. ONLY ENOENT
// is tolerated; any other read error still throws (硬规则 3b: a "can't read" must not masquerade as
// "passed"). Returns null — a distinguishable "not read" value, never conflated with empty-string
// content (硬规则 6: 缺值 = 未查, not 「为假」).
function readCorpusText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// The AC2 corpus filter: of the walked paths, which are PHYSICAL `fast-mode-telemetry.ts` copies?
// lstatSync (not stat) so the experiments/ symlink re-export is not counted as a copy.
//
// ENOENT-tolerant for the SAME reason `walkCorpus`/`readCorpusText` are: this is the second half of a
// two-step (walk → lstat) over the LIVE shared checkout, so a path a parallel test removed in between
// is a transient artifact, not a finding. ⛔ Only ENOENT — a real permission/IO error still throws
// (硬规则 3b). The property it feeds ("exactly ONE physical copy") is NOT loosened: the set is still
// asserted exactly — only the read is.
const TELEMETRY_BASENAME = 'fast-mode-telemetry.ts';
function physicalTelemetryCopies(paths) {
  const copies = [];
  for (const p of paths) {
    if (path.basename(p) !== TELEMETRY_BASENAME) continue;
    try {
      if (!fs.lstatSync(p).isSymbolicLink()) copies.push(p);
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
  }
  return copies;
}

// The AC1b exclusion targets (files/dirs that MAY legitimately mention the old paths).
const exclusionTargets = () => exclusionEntries(repoRoot, pluginDir).map((e) => e.target);

// ── AC1: the 5 files are inside plugin/; old paths are gone (no shims left behind) ─────────────────
test('AC1 — the 5 formerly-external mechanism files live in plugin/; the old paths are gone (no compat shells)', () => {
  // (canonical, reason) — every entry ships with the plugin; the reason is the role it plays in
  // the two-layer loop, not "just in case".
  const canonicalInside = [
    ['plugin/loop/orchestrator-loop-tick.md', 'outer-layer driver doc'],
    ['plugin/loop/fast-mode-loop-tick.md', 'inner-layer driver doc'],
    ['plugin/scripts/inner-forensics.mjs', 'inner-layer forensics (outer verification)'],
    ['plugin/scripts/resource-gate.sh', 'shared resource gate for heavy ops'],
    // NOTE: plugin/scripts/heavy-op-token.sh was RETIRED entirely 2026-08-06 (human ruling:
    // gap-session-liveness-remove-shared-events-and-lock — the "one heavy test at a time"
    // constraint is gone with no replacement; resource-gate.sh remains the load gate).
    // plugin/scripts/inner-state.sh was removed when it was retired
    // (gap-retire-inner-state-one-observer-targets-by-parameter) — observation has one tool,
    // session-liveness.sh, which ships via the separate session-liveness section of quay-init.sh.
  ];
  // oldPaths + oldPathPatterns + the exclusion table are the SINGLE SOURCE in
  // plugin/scripts/loop-shipping-exclusion-data.mjs (gap-exclusion-lists-have-no-necessity-check)
  // so the AC1b scan and the inert-exclusion necessity check can never disagree.
  for (const [rel, reason] of canonicalInside) {
    const p = path.join(pluginDir, rel.replace(/^plugin\//, ''));
    assert.ok(fs.existsSync(p), `${rel} must ship inside the plugin (role: ${reason})`);
    assert.ok(fs.statSync(p).isFile(), `${rel} must be a regular file (not a symlink leaving the package)`);
  }
  // The two tick-doc old paths legitimately hold the DEPLOYED copies (quay as a target project lays
  // them down at orchestration/ + docs/analysis/ per the template-params note; outer deployed them
  // 2026-08-05 for cold-start/launch-config). A real file there is the target-layout deployment,
  // NOT a compat shell — only a SYMLINK shim is forbidden. The other four old paths must be gone.
  const deployedOldPaths = new Set([
    'orchestration/orchestrator-loop-tick.md',
    'docs/analysis/fast-mode-loop-tick.md',
  ]);
  for (const rel of oldPaths) {
    const p = path.join(repoRoot, rel);
    if (deployedOldPaths.has(rel)) {
      assert.ok(!(fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()),
        `old path must NOT be a compat symlink shim: ${rel}`);
    } else {
      assert.ok(!fs.existsSync(p),
        `old path must NOT remain (no compat shell / symlink shim): ${rel}`);
    }
  }
});

// ── AC (coordinator): no LIVE reference to the 5 old paths anywhere in the repo ─────────────────────
test('AC1b — after the move, no live reference to the 5 old paths remains (comments/history excluded)', () => {
  // oldPathPatterns + the exclusion table live in plugin/scripts/loop-shipping-exclusion-data.mjs
  // (single source — the necessity check reads the SAME data). The patterns are derived from
  // oldPaths there: the `scripts/*.sh` old paths are SUBSTRINGS of the new `plugin/scripts/*.sh`
  // paths, so those two carry a negative lookbehind to match only the bare old form (never the
  // `plugin/`-prefixed new path); the `orchestration/` + `docs/analysis/` old paths are NOT
  // substrings of their new `plugin/loop/` locations, so plain substring is exact there.
  // Files that MAY legitimately mention the old paths (historical record / target-layout), and
  // are therefore excluded from the "no live reference" scan:
  const hits = [];
  // Corpus non-emptiness guard (gap-checks-that-verify-an-empty-set family): assert.deepEqual(hits, [])
  // alone would pass silently if walk() returned early, the extension filter changed, or the excluded
  // list grew to swallow the tree. Assert a floor on scanned-file count AND that a known-live file is
  // in the corpus, so the scan keeps resolving power.
  let scanned = 0;
  let sawTestSh = false;
  // walkCorpus skips node_modules/.git/dist AND every git worktree container (a worktree is a
  // complete repo copy whose stale-path strings are not main-repo references).
  for (const p of walkCorpus(repoRoot, { excluded: exclusionTargets() })) {
    scanned += 1;
    if (p === path.join(repoRoot, 'scripts', 'test.sh')) sawTestSh = true;
    const src = readCorpusText(p);
    if (src === null) continue; // deleted mid-walk by a parallel test → transient file, not a live reference
    for (const re of oldPathPatterns) {
      if (re.test(src)) hits.push(`${path.relative(repoRoot, p)}: contains "${re}"`);
    }
  }
  assert.deepEqual(hits, [], 'no live reference to the moved files\' old paths may remain (update callers to plugin/loop/ + plugin/scripts/)');
  assert.ok(scanned >= 200, `scan corpus must not be empty/starved: only ${scanned} files scanned`);
  assert.ok(sawTestSh, 'scripts/test.sh (a known live caller) must be in the scan corpus');
});

test('AC1 — readCorpusText tolerates ENOENT (a parallel test deleted the file between walk and read)', () => {
  // The exact AC1b race: the file is enumerated into the corpus, then deleted before readFileSync.
  // It must be skipped (null), not crash the scan with an ENOENT throw. The probe lives in a private
  // temp dir — the race is between a walk and a read, and where the file sits cannot matter to it.
  const probe = path.join(makeTmpDir('loop-shipping-enoent-'), 'probe.md');
  fs.writeFileSync(probe, 'a file that will vanish before it is read\n');
  fs.rmSync(probe, { force: true });
  assert.equal(readCorpusText(probe), null, 'a file deleted between walk and read must be skipped, not throw ENOENT');
});

test('AC2 — a real old-path reference is still caught (ENOENT tolerance must not mask live refs)', () => {
  const probe = path.join(makeTmpDir('loop-shipping-live-'), 'probe.md');
  fs.writeFileSync(probe, 'the moved file used to live at orchestration/orchestrator-loop-tick.md\n');
  const src = readCorpusText(probe);
  assert.ok(src !== null && oldPathPatterns.some((re) => re.test(src)),
    'a live old-path reference must still be read and matched (ENOENT tolerance must not leak into live-ref capture)');
});

test('AC1b negative control — bare scripts/resource-gate.sh still matches; the plugin/-prefixed new path does not', () => {
  // gap-plugin-root-resolution-remaining-callsites moved the observation.ts + plugin-root.test.mjs
  // references OFF the literal `scripts/resource-gate.sh` (to path.join) so they no longer collide
  // with the OLD repo-root form this pattern forbids. That fix leaves oldPathPatterns untouched —
  // this pins the lookbehind that makes the distinction REAL, so the relaxation cannot drift into
  // blinding AC1b: a genuine stale bare reference must STILL match (RED), while the canonical new
  // plugin/scripts/ form must NOT.
  const re = oldPathPatterns.find((r) => r.source.includes('resource-gate'));
  assert.ok(re, 'oldPathPatterns must derive a scripts/resource-gate.sh pattern from oldPaths');
  assert.ok(re.test('run scripts/resource-gate.sh --json'),
    'a bare scripts/resource-gate.sh literal must still match (a real stale old-path reference stays RED)');
  assert.ok(!re.test('run plugin/scripts/resource-gate.sh --json'),
    'the plugin/-prefixed canonical new path must NOT match');
});

test('AC3 — a non-ENOENT read error still throws (not swallowed)', () => {
  // A directory is a real non-ENOENT readFileSync failure (EISDIR): it must propagate, proving the
  // tolerance is ENOENT-only, not a catch-all that hides "can't read" as "passed" (硬规则 3b).
  assert.throws(
    () => readCorpusText(path.join(pluginDir, 'scripts')),
    (e) => e && e.code === 'EISDIR',
    'non-ENOENT read errors must still throw'
  );
});

test('AC1c — the tick-doc templates\' own /loop prompts and reciprocal cross-refs reference the CONSUMER landing (orchestration/ + docs/analysis/), not the non-landed plugin/loop/ bundle source', () => {
  // gap-quay-init-loop-tick-doc-paths-reference-unlanded-plugin-loop (AC37, ad-arm1): the LAID tick
  // docs are the consumer deliverable — quay-init --loop lays plugin/loop/*.md VERBATIM to
  // orchestration/ + docs/analysis/, and does NOT lay plugin/loop/. A doc cross-ref to
  // plugin/loop/... is therefore a dead path for the target project (the consumer tick doc referenced
  // 5 plugin/loop/ paths that never landed, and the inner reported "the tick references an execution
  // core that isn't at the expected path"). The actionable instructions must reference the
  // consumer-resolvable paths (orchestration/ + docs/analysis/), which exist in BOTH the quay repo
  // (deployed copies) and a consumer — that is what makes the SAME byte-identical doc work in both
  // contexts. The template-params NOTE spells the same target layout.
  for (const name of ['orchestrator-loop-tick.md', 'fast-mode-loop-tick.md']) {
    const src = fs.readFileSync(path.join(pluginDir, 'loop', name), 'utf8');
    // DRIVE COMMANDS execute against the LAID-DOWN copy in a running workspace — they already use
    // the `$REPO_ROOT/docs/analysis/fast-mode-loop-tick.md` target-layout form (cold-start/SKILL.md
    // drives the same), so they are the execution-time interpolation, not the doc cross-ref this
    // assertion governs.
    const driveCmdRe = /\$REPO_ROOT\/docs\/analysis\/fast-mode-loop-tick\.md/;
    const liveLines = src.split('\n').filter((l) => !l.trim().startsWith('>') && !driveCmdRe.test(l));
    // No LIVE instruction may reference the non-landed plugin/loop/ bundle-source path.
    assert.ok(
      !liveLines.some((l) => l.includes('plugin/loop/')),
      `${name} has a LIVE instruction referencing the non-landed plugin/loop/ path (should be orchestration/ + docs/analysis/ — the consumer landing)`
    );
    // The docs MUST reference the consumer landing of the sibling tick docs.
    assert.match(src, /orchestration\/orchestrator-loop-tick\.md/, `${name} must reference the consumer landing of the outer tick doc`);
    assert.match(src, /docs\/analysis\/fast-mode-loop-tick\.md/, `${name} must reference the consumer landing of the inner tick doc`);
  }
});

test('AC1 — test.sh stays at scripts/ (scope ruling: not a portable mechanism, not moved)', () => {
  const p = path.join(repoRoot, 'scripts', 'test.sh');
  assert.ok(fs.existsSync(p));
  assert.ok(fs.statSync(p).isFile(), 'scripts/test.sh must remain a real file (not moved into plugin/)');
  assert.ok(!fs.lstatSync(p).isSymbolicLink(), 'scripts/test.sh must not be a symlink (it is the quay repo test entry, not a mechanism file)');
});

// ── AC2: fast-mode-telemetry.ts has one physical copy ──────────────────────────────────────────────
test('AC2 — fast-mode-telemetry.ts has ONE physical copy; plugin/scripts/ is authoritative, experiments/ is a symlink re-export', () => {
  const canonical = path.join(pluginDir, 'scripts', 'fast-mode-telemetry.ts');
  const reExport = path.join(repoRoot, 'experiments', 'quay-perpetual-stream', 'scripts', 'fast-mode-telemetry.ts');
  assert.ok(fs.existsSync(canonical), 'plugin/scripts/fast-mode-telemetry.ts is the authoritative copy');
  assert.ok(fs.statSync(canonical).isFile(), 'authority must be a regular file');
  assert.ok(fs.lstatSync(reExport).isSymbolicLink(), 'experiments path must be a symlink re-export, not a second copy');
  assert.ok(
    fs.readlinkSync(reExport).includes('plugin/scripts/fast-mode-telemetry.ts'),
    'experiments symlink must point at the plugin authority'
  );
  // No OTHER physical copy anywhere under the repo. Use lstatSync so symlinks (the re-export at
  // experiments/) are not counted as physical copies. walkCorpus skips node_modules/.git/dist, the
  // gitignored pack-time snapshot packages/quay/plugin/, AND every git worktree container (a worktree
  // is a complete repo copy — its fast-mode-telemetry.ts is not a second authority).
  const copies = physicalTelemetryCopies(
    walkCorpus(repoRoot, { excluded: [path.join(repoRoot, 'packages', 'quay', 'plugin')] })
  );
  assert.deepEqual(copies, [canonical], `exactly one physical fast-mode-telemetry.ts expected, got ${JSON.stringify(copies)}`);
});

// ── AC2/AC3 worktree-container controls (gap-loop-shipping-scan-does-not-exclude-worktrees) ────────
test('AC2 — walk() skips a REAL git worktree (`git worktree list` source): stale refs + a telemetry copy inside it are not scanned', () => {
  // The REGISTRATION is real (`git worktree add`); the walked tree is a private temp dir, so this
  // control creates no entries under the checked-in tree (checked-in-write-check). `containerRoot`
  // is the real repo because that is where the registration is visible — the container set is
  // still DERIVED by the code under test, never hand-built here.
  const root = makeTmpDir('loop-shipping-realworktree-');
  const wt = path.join(root, `ls-control-${process.pid}`);
  try {
    execFileSync('git', ['worktree', 'add', '--detach', wt, 'HEAD'], { cwd: repoRoot, stdio: 'pipe' });
    // The fresh container set must report the registered worktree, and never the main repo root.
    const containers = worktreeContainerPaths(repoRoot);
    assert.ok(containers.has(wt), 'a registered git worktree must be reported by worktreeContainerPaths');
    assert.ok(!containers.has(path.resolve(repoRoot)), 'repoRoot must never be a worktree container');
    // Stale-path reference + a fast-mode-telemetry.ts copy inside the worktree.
    fs.writeFileSync(path.join(wt, 'stale-probe.md'), 'old tick-doc path orchestration/orchestrator-loop-tick.md and docs/analysis/fast-mode-loop-tick.md\n');
    fs.writeFileSync(path.join(wt, 'fast-mode-telemetry.ts'), 'export const worktreeCopy = true;\n');
    fs.writeFileSync(path.join(root, 'anchor.md'), 'an ordinary sibling of the worktree container\n');
    const scanned = walkCorpus(root, { excluded: exclusionTargets(), containerRoot: repoRoot });
    // Non-vacuousness: the walk DID reach the temp root — the skip below is specific, not "nothing scanned".
    assert.ok(scanned.includes(path.join(root, 'anchor.md')), 'the walk must reach the temp root (the skip below is a skip of the worktree, not of the whole walk)');
    assert.ok(!scanned.some((p) => p.startsWith(wt + path.sep)), 'walk() must not scan inside a real git worktree');
    // Negative control: with the container skip REMOVED, the same walk collects the worktree copies —
    // i.e. the skip is load-bearing (and the telemetry copy under it would have been counted).
    const unfiltered = walkCorpus(root, { excluded: exclusionTargets(), containerRoot: repoRoot, includeWorktrees: true });
    assert.ok(unfiltered.some((p) => p.startsWith(wt + path.sep)), 'without the container skip the worktree content IS scanned (the skip is load-bearing)');
    const copies = physicalTelemetryCopies(scanned);
    assert.deepEqual(copies, [], 'a git worktree copy of fast-mode-telemetry.ts must not be counted (AC2)');
  } finally {
    try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoRoot, stdio: 'pipe' }); } catch { /* already gone */ }
  }
});

test('AC2 — walk() skips the .claude/worktrees/ container even for UNREGISTERED residue (the 2026-08-10 agent-* shape)', () => {
  // Private temp root: the shape under test is "a `.claude/worktrees/` container inside the walked
  // tree", which `worktreeContainerPaths(<root>)` supplies for ANY root (it is the one container it
  // derives without git). Nothing is created under the checked-in tree.
  const root = makeTmpDir('loop-shipping-residue-');
  const worktreesDir = path.join(root, '.claude', 'worktrees');
  const residue = path.join(worktreesDir, `residue-${process.pid}`);
  fs.mkdirSync(residue, { recursive: true });
  fs.writeFileSync(path.join(root, 'anchor.md'), 'an ordinary sibling of the container\n');
  // NOT a registered git worktree (no `.git`): a stale leftover `agent-*`-shaped dir whose content
  // is a full repo copy — exactly the 2026-08-10 false-red source (agent-a8fd.../README.md). Only
  // the explicit .claude/worktrees/ container skip catches this (git worktree list does not).
  fs.writeFileSync(path.join(residue, 'README.md'), 'references orchestration/orchestrator-loop-tick.md\n');
  fs.writeFileSync(path.join(residue, 'fast-mode-telemetry.ts'), 'export const residueCopy = true;\n');
  // containerRoot: this tree's OWN root — `.claude/worktrees/` is the one container
  // worktreeContainerPaths derives for any root, and that is the face being exercised here.
  const scanned = walkCorpus(root, { excluded: exclusionTargets(), containerRoot: root });
  assert.ok(scanned.includes(path.join(root, 'anchor.md')), 'the walk must reach the temp root (the skip below is a skip of the container, not of the whole walk)');
  assert.ok(!scanned.some((p) => p.startsWith(residue + path.sep)), 'walk() must not scan unregistered residue under .claude/worktrees/');
  // Negative control: drop the container face and the residue IS collected — the skip is load-bearing.
  const unfiltered = walkCorpus(root, { excluded: exclusionTargets(), includeWorktrees: true });
  assert.ok(unfiltered.some((p) => p.startsWith(residue + path.sep)), 'without the container skip the residue IS scanned (the skip is load-bearing)');
  const copies = physicalTelemetryCopies(scanned);
  assert.deepEqual(copies, [], 'residue fast-mode-telemetry.ts copy must not be counted (AC2)');
});

// ── plugin-staging-* orphan skip (gap-orphan-staging-dirs-pollute-walkcorpus) ───────────────────────
test('AC1 — walkCorpus skips a plugin-staging-* orphan dir (its old-path tick-doc copy + telemetry copy are not scanned)', () => {
  // An orphan is a KILLED stagePackagedPlugin() copy left at packages/quay/plugin-staging-<pid>-{0,1}/:
  // it carries the full plugin/ tree (the tick docs' old-path strings) + scripts/*.ts — swept into the
  // corpus it false-reds AC1b/AC2 (2026-08-25: plugin-staging-3477285-{0,1} red, worker hand-deleted).
  // Private temp root reproducing the real layout (`<root>/packages/quay/plugin-staging-<pid>-0`):
  // the skip is by BASENAME at every depth, so the predicate under test is exercised faithfully
  // without creating entries under the checked-in tree.
  const root = makeTmpDir('loop-shipping-orphan-');
  const orphan = path.join(root, 'packages', 'quay', `${stagingDirPrefix}${process.pid}-0`);
  fs.mkdirSync(orphan, { recursive: true });
  const tick = path.join(orphan, 'loop', 'orchestrator-loop-tick.md');
  fs.mkdirSync(path.dirname(tick), { recursive: true });
  fs.writeFileSync(tick, 'deployed copy lives at orchestration/orchestrator-loop-tick.md\n');
  fs.mkdirSync(path.join(orphan, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(orphan, 'scripts', 'fast-mode-telemetry.ts'), 'export const orphanCopy = true;\n');
  fs.writeFileSync(path.join(root, 'anchor.md'), 'an ordinary sibling of the orphan\n');
  const scanned = walkCorpus(root, { excluded: exclusionTargets() });
  assert.ok(scanned.includes(path.join(root, 'anchor.md')), 'the walk must reach the temp root (the skip below is a skip of the orphan, not of the whole walk)');
  assert.ok(!scanned.some((p) => p.startsWith(orphan + path.sep)), 'walkCorpus must not scan inside a plugin-staging-* orphan dir');
  const copies = physicalTelemetryCopies(scanned);
  assert.deepEqual(copies, [], 'an orphan staging fast-mode-telemetry.ts copy must not be counted (AC2)');
});

test('AC2 — negative control: renaming off the staging prefix makes walkCorpus COLLECT the orphan (the skip is load-bearing)', () => {
  // The negative control proves the skip suppresses a REAL hit, not a vacuous exclusion: the orphan
  // content IS a live old-path reference (it trips an AC1b pattern), and walkCorpus collects it the
  // moment the dir stops matching the staging prefix — the exact red the skip prevents.
  const root = makeTmpDir('loop-shipping-orphan-nc-');
  const container = path.join(root, 'packages', 'quay');
  const orphan = path.join(container, `${stagingDirPrefix}${process.pid}-nc`);
  const renamed = path.join(container, `orphan-probe-${process.pid}-nc`);
  fs.mkdirSync(orphan, { recursive: true });
  const probe = path.join(orphan, 'stale-probe.md');
  fs.writeFileSync(probe, 'the moved file used to live at orchestration/orchestrator-loop-tick.md\n');
  const src = fs.readFileSync(probe, 'utf8');
  assert.ok(oldPathPatterns.some((re) => re.test(src)), 'the orphan staging content must trip an AC1b pattern (a live reference)');
  // With the staging skip active, the orphan is not part of the corpus.
  assert.ok(!walkCorpus(root, { excluded: exclusionTargets() }).includes(probe), 'with the staging skip, the orphan probe is not in the corpus');
  // Remove the skip (rename off the prefix): walkCorpus now COLLECTS the probe — would red AC1b.
  fs.renameSync(orphan, renamed);
  const renamedProbe = path.join(renamed, 'stale-probe.md');
  assert.ok(walkCorpus(root, { excluded: exclusionTargets() }).includes(renamedProbe), 'without the staging skip, the orphan probe IS collected (would red AC1b)');
});

// ── repo-root tmp/ skip + mid-walk ENOENT tolerance (gap-goal-merge-suite-concurrent-npm-pack-…) ───
test('AC1 — walkCorpus skips the gitignored repo-root tmp/ runtime scratch (a fixture COPY there is not corpus content)', () => {
  // The sibling selftests (run-identity.ts / stage-receipt.ts / workflow-journal.ts) mkdtemp a fixture
  // under `<cwd>/tmp/` — i.e. under repoRoot — and seed it with copies of real plugin/ material. That
  // is not repo source, and it is torn down mid-suite. Same rationale, same skip, as
  // adr016-screen-use-check.ts's SKIP_DIRS (`tmp`), which landed first (硬规则 5b).
  // Private temp root reproducing `<root>/tmp/<fixture>/…`: the skip is by BASENAME at every depth,
  // so this exercises the predicate the real tree relies on without writing under the checked-in tree.
  const root = makeTmpDir('loop-shipping-tmpskip-');
  const tmpDir = path.join(root, 'tmp', `ls-tmp-probe-${process.pid}`);
  fs.mkdirSync(path.join(tmpDir, 'plugin', 'scripts'), { recursive: true });
  const probe = path.join(tmpDir, 'stale-probe.md');
  fs.writeFileSync(probe, 'the moved file used to live at orchestration/orchestrator-loop-tick.md\n');
  assert.ok(oldPathPatterns.some((re) => re.test(fs.readFileSync(probe, 'utf8'))), 'the tmp/ probe content must trip an AC1b pattern (a live-looking reference)');
  assert.ok(!walkCorpus(root, { excluded: exclusionTargets() }).includes(probe), 'tmp/ is runtime residue — it must not be scanned');
  // Load-bearing negative control: move it OFF tmp/ and the very same file IS collected.
  const outside = path.join(root, `ls-tmp-outside-probe-${process.pid}.md`);
  fs.renameSync(probe, outside);
  assert.ok(walkCorpus(root, { excluded: exclusionTargets() }).includes(outside), 'without the tmp/ skip the same probe IS collected (the skip is load-bearing, not vacuous)');
});

test('AC1 — walkCorpus tolerates a directory that vanishes mid-walk (ENOENT), and ONLY ENOENT', (t) => {
  // gap-goal-merge-suite-concurrent-npm-pack-staging-race-blocks-fan-in: walkCorpus descends the LIVE
  // shared checkout while parallel test processes mkdtemp + rm -rf their fixtures under repoRoot.
  // A directory listed by its parent and removed before its own readdir made the raw `fs.readdirSync`
  // throw ENOENT and red whichever test was walking (reproduced 11/40 runs under fixture churn).
  // Deterministic here: the mock makes one synthetic subtree vanish, so the tolerance is pinned
  // without depending on a timing window.
  const root = makeTmpDir('loop-shipping-enoent-');
  fs.mkdirSync(path.join(root, 'gone'), { recursive: true });
  fs.writeFileSync(path.join(root, 'kept.md'), 'x\n');
  fs.writeFileSync(path.join(root, 'gone', 'vanished.md'), 'x\n');
  const vanished = path.join(root, 'gone');
  const real = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (p, ...rest) => {
    if (String(p) === vanished) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${p}'`), { code: 'ENOENT' });
    }
    return real(p, ...rest);
  });
  // A subtree that vanished between the walk and its read is skipped — never a crash.
  const scanned = walkCorpus(root);
  assert.deepEqual(scanned, [path.join(root, 'kept.md')], 'the sibling that did NOT vanish is still collected (the guard skips a subtree, it does not abort the walk)');
});

test('AC1 — negative control: only ENOENT is tolerated — a non-ENOENT readdir error still throws', (t) => {
  const root = makeTmpDir('loop-shipping-eacces-');
  fs.mkdirSync(path.join(root, 'denied'), { recursive: true });
  const denied = path.join(root, 'denied');
  const real = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (p, ...rest) => {
    if (String(p) === denied) {
      throw Object.assign(new Error('EACCES: permission denied, scandir'), { code: 'EACCES' });
    }
    return real(p, ...rest);
  });
  // 硬规则 3b: a "cannot read" must not masquerade as "read fine, nothing there".
  assert.throws(() => walkCorpus(root), { code: 'EACCES' });
});

test('AC3 — negative control: the MAIN repo is not over-excluded (normal capture retained)', () => {
  // Was: a probe written into the main repo and asserted to be collected. The WRITE was itself the
  // defect class checked-in-write-check judges (a test creating/deleting entries under a checked-in
  // path), and the probe's two properties are already carried elsewhere — the AC1b scan above pins
  // that the main repo IS the corpus (`scanned >= 200` + `sawTestSh`), and the AC1b negative control
  // below pins that a real old-path reference still trips a pattern. What is unique here — and needs
  // no write — is that a REAL main-repo file is collected rather than swallowed by the container /
  // exclusion skips: the main repo root is never a container, and an unexcluded file under it stays.
  const realMainRepoFile = path.join(repoRoot, 'scripts', 'test.sh');
  const scanned = walkCorpus(repoRoot, { excluded: exclusionTargets() });
  assert.ok(
    scanned.includes(realMainRepoFile),
    'a real main-repo file must be part of the scan corpus (the main repo is never over-excluded by the worktree/container skips)',
  );
});

// ── AC7: the shipped plugin subtree excludes per-project state files ───────────────────────────────
const FORBIDDEN_SUBSTRINGS = ['tick-log.md', 'escalations.md', 'batch2-queue-state.md', 'exp6-', 'ADR-021-'];

test('AC7 — the shipped plugin/ subtree contains none of the forbidden per-project state files', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(pluginDir, p);
      if (e.isDirectory()) walk(p);
      else if (FORBIDDEN_SUBSTRINGS.some((f) => rel.includes(f))) hits.push(rel);
    }
  };
  walk(pluginDir);
  assert.deepEqual(hits, [], `plugin/ subtree must not ship: tick-log.md / escalations.md / batch2-queue-state.md / exp6-* / ADR-021-*`);
});

test('AC7 — npm pack --dry-run (the Contract `packed` measure) excludes the forbidden names', () => {
  // The npm package (`packages/quay`) is the other shipped surface. Its `files` field restricts
  // the pack, but the negative control pins it: none of the forbidden names may appear.
  let result = '';
  try {
    result = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: path.join(repoRoot, 'packages', 'quay'),
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120000,
    });
  } catch (e) {
    // npm pack can still list files with a warning; prefer the parsed stdout.
    result = e.stdout || e.stderr || '';
  }
  let files = [];
  try {
    const parsed = JSON.parse(result);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    files = (entry?.files || []).map((f) => f.path);
  } catch {
    // If npm pack output is not parseable, fall back to the package.json `files` allowlist +
    // the plugin-subtree scan already done above; don't fail the whole suite on npm quirks.
    files = [];
  }
  const hits = files.filter((f) => FORBIDDEN_SUBSTRINGS.some((x) => f.includes(x)));
  assert.deepEqual(hits, [], `npm pack must not ship forbidden names (files list: ${files.join(', ')})`);
});

// ── gap-cold-start-e2e-installs-from-a-copy-and-nothing-runs-it ─────────────────────────────────────
// Pins the cold-start e2e's deliverability path so a future regression back to "cp of the working
// tree", or a lost executor, fails loudly instead of silently re-introducing the two gaps:
//
//   AC2 — the --from-build path extracts the built plugin via `git archive` (never cp of the
//         working tree); the FROM_BUILD branch must contain no `cp -r`.
//   AC3 — the install-source completeness assertion covers the three build-required files,
//         fail-named.
//   AC8 — the exit path cleans up the temp orphan branch publish-dist-branch.sh creates.
//   AC9 — a real executor is registered in ci.yml (a cold-start-e2e job) — prose alone would
//         re-create "a rule nobody runs".
//   AC10 — neither the e2e source nor ci.yml ever passes --push to publish-dist-branch.sh.
const COLD_START_E2E = path.join(repoRoot, 'test', 'cold-start-e2e.sh');
const CI_YML = path.join(repoRoot, '.github', 'workflows', 'ci.yml');

test('AC2 — cold-start-e2e.sh --from-build extracts via git archive, never a cp of the working tree', () => {
  const src = fs.readFileSync(COLD_START_E2E, 'utf8');
  assert.match(src, /git archive/,
    'cold-start-e2e.sh must extract the built plugin via `git archive` (AC2 deliverability path)');
  const lines = src.split('\n');
  const fbIdx = lines.findIndex((l) => l.includes('FROM_BUILD') && l.trim().startsWith('if ['));
  assert.ok(fbIdx >= 0, 'cold-start-e2e.sh must branch on FROM_BUILD');
  const body = [];
  for (let i = fbIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === 'else' || t === 'fi') break;
    body.push(lines[i]);
  }
  assert.ok(body.length > 0, 'the FROM_BUILD branch must not be empty');
  assert.ok(body.some((l) => /git archive/.test(l)),
    'the --from-build branch must contain the `git archive` extraction');
  assert.ok(!body.some((l) => /\bcp -r\b/.test(l)),
    'the --from-build branch must NOT cp -r the working tree to the install source (use git archive)');
});

test('AC3 — cold-start-e2e.sh asserts the build-required files, fail-named (inner-state.sh retired, not required)', () => {
  const src = fs.readFileSync(COLD_START_E2E, 'utf8');
  for (const f of ['scripts/quay-init.sh', 'loop/orchestrator-loop-tick.md']) {
    assert.ok(src.includes(f), `cold-start-e2e.sh must assert the presence of ${f} (AC3)`);
  }
  // inner-state.sh is RETIRED — cold-start-e2e.sh must treat it as not-required, not list it as a
  // required presence file. It legitimately REFERENCES the name in its absence-check ("must NOT be
  // laid down", gap-retire-inner-state-one-observer-targets-by-parameter AC3), so the assertion is
  // the positive retirement marker, not a substring absence (a substring grep would false-positive
  // on the `plugin/scripts/inner-state.sh` path in that check).
  assert.match(src, /inner-state\.sh is retired/i,
    'cold-start-e2e.sh must document inner-state.sh as retired (not required)');
  assert.ok(!src.includes('assert_file "$PROJECT/plugin/scripts/inner-state.sh"'),
    'cold-start-e2e.sh must NOT require inner-state.sh\'s presence (retired, gap-retire-inner-state-one-observer-targets-by-parameter AC3)');
  // The completeness assertion must fail naming the missing file (not a bare "something failed").
  assert.match(src, /fail "missing file: \$1"/,
    'the AC3 completeness assertion must fail naming the file');
});

test('AC8 — cold-start-e2e.sh cleans up the temp orphan branch on exit (no residue accumulation)', () => {
  const src = fs.readFileSync(COLD_START_E2E, 'utf8');
  assert.match(src, /E2E_BRANCH=/, 'the script must track the temp orphan branch name (AC8)');
  assert.match(src, /branch -D/, 'the exit path must delete the temp orphan branch (AC8)');
  assert.match(src, /trap cleanup EXIT/, 'the cleanup must be wired to the EXIT trap');
});

test('AC9 — the cold-start e2e has a real executor registered in ci.yml, not prose', () => {
  const ci = fs.readFileSync(CI_YML, 'utf8');
  assert.match(ci, /cold-start-e2e/, 'ci.yml must register a cold-start-e2e executor job (AC9/DoD)');
  assert.match(ci, /test\/cold-start-e2e\.sh/, 'the executor job must actually run the e2e script');
  // milestone-cadence, not per-push: the job must be gated to workflow_dispatch, so it does not
  // add a multi-minute build + a >=90s sleep to every push/PR.
  assert.match(ci, /workflow_dispatch/, 'ci.yml must allow workflow_dispatch (milestone-cadence trigger)');
  assert.match(ci, /github\.event_name == 'workflow_dispatch'/, 'the cold-start-e2e job must be gated to workflow_dispatch');
});

test('AC10 — no publish-dist-branch.sh --push call in the e2e source or ci.yml', () => {
  // Only flag ACTUAL invocations (`bash .../publish-dist-branch.sh ...`) — documentation text like
  // "(NO --push)" describes the prohibition and must not trip the negative control.
  const e2eLines = fs.readFileSync(COLD_START_E2E, 'utf8').split('\n');
  const e2eInvocations = e2eLines.filter((l) => /\bbash\b[^\n]*publish-dist-branch\.sh/.test(l));
  assert.ok(e2eInvocations.length >= 1, 'the --from-build path must invoke publish-dist-branch.sh');
  for (const l of e2eInvocations) {
    assert.ok(!/\s--push\b/.test(l),
      `cold-start-e2e.sh must never invoke publish-dist-branch.sh with --push: ${l.trim()}`);
  }
  const ciLines = fs.readFileSync(CI_YML, 'utf8').split('\n');
  for (const l of ciLines) {
    if (/\bbash\b[^\n]*publish-dist-branch\.sh/.test(l)) {
      assert.ok(!/\s--push\b/.test(l),
        `ci.yml must never invoke publish-dist-branch.sh with --push: ${l.trim()}`);
    }
  }
});
