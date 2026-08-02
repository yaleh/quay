// @test-group engine
// execute-milestone-worktree.test.mjs — DIR-123: per-milestone git-worktree isolation for
// execute-milestone.js. Drives the REAL, unmodified workflow source (both mirrors) with a mock agent()
// that — for the worktree CLI commands the prompts emit — EXECUTES THE REAL OPERATIONS against a
// throwaway git repo (it runs the actual milestone-worktree.ts CLI as a subprocess pointed at the temp
// repo, and does real `git` edits/commits for the Build step). Assertions are on REAL resulting git
// state (`git worktree list`, `git diff`, file contents, branch existence), never on prompt text alone
// — the wiring audit this task demands (trace real git operations, not "would do X" prose).
//
// Covers:
//  - GOLDEN REPLAY: legacy (no isolationMode) is byte-for-behavior identical to the pre-DIR-123 baseline
//    (fixtures/worktree/golden-legacy-prompts.json, captured from HEAD before the edit) — phases, agent
//    call sequence, every prompt, and the return value; the ONLY delta is Land's step-1 prompt text,
//    which is Requested-action #4's intentional stale-text fix (asserted explicitly, behavior-preserving).
//  - WORKTREE LIFECYCLE: isolationMode:'worktree' creates a real worktree before Build, threads its path
//    through Build/Audit/Gate, leaves zero shared/branch-relevant tracked diffs in the primary checkout
//    until Land (the only real pre-Land primary diff is the dispatch's own task file — see the
//    "primary checkout untouched" test's C3 note), then Land
//    does a real merge + worktree remove + branch delete + Land-lock acquire/release.
//  - AUDIT READS THE WORKTREE: a sentinel file that deliberately DIFFERS between the worktree and the
//    primary checkout — Audit's prompt-directed read must reflect the WORKTREE version.
//  - FAIL-CLOSED: isolationMode:'worktree' with a non-numeric milestone, or an unknown non-empty mode,
//    halts at Verify (never silently falls back to the shared checkout).
//
// Run:
//   node --experimental-strip-types --test plugin/test/execute-milestone-worktree.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { worktreeRelPath, worktreeBranch, parseMilestoneNum } from '../../experiments/quay-perpetual-stream/scripts/milestone-worktree.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WT_SCRIPT = path.join(REPO_ROOT, 'experiments', 'quay-perpetual-stream', 'scripts', 'milestone-worktree.ts');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'experiments', 'quay-perpetual-stream', 'fixtures', 'worktree', 'golden-legacy-prompts.json'), 'utf8'));
const MIRRORS = [
  ['.claude/workflows/execute-milestone.js', path.join(REPO_ROOT, '.claude', 'workflows', 'execute-milestone.js')],
  ['plugin/workflows/execute-milestone.js', path.join(REPO_ROOT, 'plugin', 'workflows', 'execute-milestone.js')],
];

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function loadWorkflow(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/^export const meta/, 'const meta');
  return new AsyncFunction('args', 'phase', 'log', 'parallel', 'agent', src);
}
const VERIFY_LABELS = ['ceiling-check', 'gate-hash', 'line-budget', 'dogfood-evidence', 'domain-misfit', 'composite-preflight'];
const GATE_LABELS = ['vmeta-lag', 'dash-budget', 'tree', 'worktree', 'split-or-commit'];
function verifyStub(label) { return label === 'domain-misfit' ? { ok: true, step3conclusion: 'stub' } : { check: label, ok: true, detail: 'stub' }; }

// ── temp git repo fixture ────────────────────────────────────────────────────────────────────────
function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dir123-wt-'));
  const g = (a, cwd = dir) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
  g(['init', '-q', '-b', 'master', '.']);
  g(['config', 'user.email', 'dir123@test']); g(['config', 'user.name', 'dir123']);
  // A committed sentinel that exists in BOTH primary and (at creation) the worktree, so the Build can
  // make the worktree's copy DIFFER from the primary's — the Audit-reads-worktree probe.
  fs.writeFileSync(path.join(dir, 'sentinel.txt'), 'PRIMARY-VERSION\n');
  fs.mkdirSync(path.join(dir, 'milestones'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'milestones', '.keep'), '');
  g(['add', '-A']); g(['commit', '-qm', 'base']);
  return { dir, g };
}

// Run the milestone-worktree.ts CLI with explicit args, returning the parsed JSON verdict regardless of
// exit code (a conflict / failure verdict exits non-zero BY DESIGN — the JSON on stdout is the signal).
function runCliJson(args, cwd) {
  try {
    const out = execFileSync('node', ['--experimental-strip-types', WT_SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'dir123-test-owner' } });
    return JSON.parse(out.trim().split('\n').pop());
  } catch (e) {
    const stdout = (e.stdout || '').toString().trim();
    if (stdout) return JSON.parse(stdout.split('\n').pop());
    throw e;
  }
}

// Run the REAL milestone-worktree.ts CLI command found in `prompt` as a subprocess against `cwd`
// (the temp repo). Proves the command the workflow emits is well-formed AND performs the real git
// operation — not a mock that pretends. Returns the parsed JSON verdict.
function runWorktreeCli(prompt, cwd) {
  const results = [];
  const re = /node --experimental-strip-types \S*milestone-worktree\.ts ([^\n`]+)/g;
  let m;
  while ((m = re.exec(prompt)) !== null) {
    results.push(runCliJson(m[1].trim().split(/\s+/), cwd));
  }
  return results;
}

// Build a mock agent for WORKTREE-MODE end-to-end runs. It executes the real worktree CLI commands the
// prompts emit, does a real edit+commit inside the worktree for the Build step, and reads the sentinel
// from the prompt-directed worktree path for Audit (recording what it saw for the assertion).
function makeWorktreeMock(repo, milestone, recorder) {
  const wtRel = worktreeRelPath(parseMilestoneNum(milestone));
  const agent = async function (prompt, opts = {}) {
    const label = opts.label;
    // DIR-124-A1b: fire-and-forget stage-event emissions are observational no-ops.
    if (label && label.startsWith('emit-event-')) return { raw: null };
    if (VERIFY_LABELS.includes(label)) return verifyStub(label);
    if (label === 'preparation-check') return { ok: true, code: 'PASS: prepared', detail: 'stub' };
    if (label === 'post-land-split-or-commit') return { ok: true, detail: 'stub' };
    if (GATE_LABELS.includes(label) || (label && label.startsWith('split-or-commit'))) {
      recorder.gatePrompts.push(prompt);
      return { ok: true, detail: 'stub' };
    }
    if (label === 'worktree-create') {
      recorder.createPrompt = prompt;
      // Execute the prompt's documented algorithm for real: --add; on a stranded-path/branch collision
      // run --clean-stale (Obstacle 3 crash recovery); if it cleaned a 0-ahead worktree, retry --add;
      // if it found real commits, surface has-commits (→ the workflow fails closed to needs-human).
      const m = String((prompt.match(/--milestone (\S+)/) || [])[1] || parseMilestoneNum(milestone));
      let v = runCliJson(['--add', '--workspace', '.', '--milestone', m], repo);
      if (v.outcome === 'error' && (v.code === 'worktree-path-exists' || v.code === 'branch-exists')) {
        const c = runCliJson(['--clean-stale', '--workspace', '.', '--milestone', m], repo);
        recorder.cleanVerdict = c;
        if (c.outcome === 'cleaned') v = runCliJson(['--add', '--workspace', '.', '--milestone', m], repo);
        else v = c; // has-commits / nothing-to-clean / error → not-added (fails closed)
      }
      recorder.createVerdicts = [v];
      // Snapshot existence NOW (Land will remove it later — this proves Build-phase creation really happened).
      recorder.worktreeExistedAfterCreate = fs.existsSync(path.join(repo, wtRel));
      return { ok: v.outcome === 'added', worktreeAbs: v.worktreeAbs, branch: v.branch, detail: JSON.stringify(v) };
    }
    if (opts.phase === 'Build') {
      recorder.buildPrompt = prompt;
      // REAL build: edit + commit INSIDE the worktree (not the primary checkout).
      const wtAbs = path.join(repo, wtRel);
      fs.writeFileSync(path.join(wtAbs, 'feature.txt'), 'built-in-worktree\n');
      fs.writeFileSync(path.join(wtAbs, 'sentinel.txt'), 'WORKTREE-BUILT-VERSION\n'); // diverge from primary
      execFileSync('git', ['-C', wtAbs, 'add', '-A']);
      execFileSync('git', ['-C', wtAbs, 'commit', '-qm', 'build in isolated worktree']);
      return { outcome: 'done', mergeCommit: 'wt-build', iterationCount: 1 };
    }
    if (opts.phase === 'Audit') {
      recorder.auditPrompt = prompt;
      // Audit reads the sentinel FROM THE WORKTREE PATH the prompt directs it to (proving it does not
      // read the primary checkout). The prompt names the worktreeRel explicitly.
      const sawWorktree = prompt.includes(wtRel);
      const sentinelViaWorktree = fs.readFileSync(path.join(repo, wtRel, 'sentinel.txt'), 'utf8').trim();
      const sentinelViaPrimary = fs.readFileSync(path.join(repo, 'sentinel.txt'), 'utf8').trim();
      recorder.auditSaw = { sawWorktreePathInPrompt: sawWorktree, sentinelViaWorktree, sentinelViaPrimary };
      // DIR-123 review C1: the real Audit COMMITS its evidence to the worktree branch (per the Audit
      // isolation note's COMMIT-THE-AUDIT-EVIDENCE step), so Land's merge carries it to the primary.
      // Simulate that here: write + stage + COMMIT an audit artifact in the worktree. (The pre-C1 mock
      // only READ — which is exactly what hid the bug where staged-but-uncommitted audit evidence was
      // silently discarded by Land's `git worktree remove --force`.)
      const wtAbs = path.join(repo, wtRel);
      fs.mkdirSync(path.join(wtAbs, 'audits'), { recursive: true });
      fs.writeFileSync(path.join(wtAbs, 'audits', 'iteration-0-acceptance-audit.md'),
        '# acceptance audit\nverdict: NO REFUTATION FOUND\nAC write-backs applied\n');
      execFileSync('git', ['-C', wtAbs, 'add', '-A']);
      execFileSync('git', ['-C', wtAbs, 'commit', '-qm', 'audit evidence (C1)']);
      return { verdict: 'NO REFUTATION FOUND', detail: 'stub', auditSessionId: 'sess-wt-audit' };
    }
    if (opts.phase === 'Land') {
      recorder.landPrompt = prompt;
      const ran = runWorktreeCli(prompt, repo);          // REAL lock-acquire + merge + remove + lock-release
      recorder.landVerdicts = ran;
      return { outcome: 'done', mergeCommit: 'wt-land', milestoneCounter: 1 };
    }
    return { ok: true, detail: 'stub' };
  };
  return agent;
}

async function runWorkflow(file, argsObj, agentMock) {
  const phases = [];
  const result = await loadWorkflow(file)(
    argsObj,
    (p) => phases.push(p),
    () => {},
    (fns) => Promise.all(fns.map((f) => f())),
    agentMock,
  );
  return { result, phases };
}

// Deterministic LEGACY capture mock (for the golden replay) — identical to the one that generated the
// golden fixture, so the comparison is apples-to-apples.
function makeLegacyCaptureMock() {
  const calls = [];
  const agent = async function (prompt, opts = {}) {
    calls.push({ label: opts.label ?? null, phase: opts.phase ?? null, prompt });
    const label = opts.label;
    if (label && label.startsWith('emit-event-')) return { raw: null };
    if (VERIFY_LABELS.includes(label)) return verifyStub(label);
    if (label === 'preparation-check') return { ok: true, code: 'PASS: prepared', detail: 'stub' };
    if (label === 'post-land-split-or-commit') return { ok: true, detail: 'stub' };
    if (opts.phase === 'Build') return { outcome: 'done', mergeCommit: 'deadbeef', iterationCount: 1 };
    if (opts.phase === 'Audit') return { verdict: 'NO REFUTATION FOUND', detail: 'ok', auditSessionId: 'sess-golden' };
    if (opts.phase === 'Land') return { outcome: 'done', mergeCommit: 'deadbeef', milestoneCounter: 1 };
    return { ok: true, detail: 'stub' };
  };
  return { agent, calls };
}
const LEGACY_ARGS = { taskId: 'GOLDEN-TASK', charterFile: 'milestones/M999/M999-charter.md', absorbEntryFile: '/dev/null', preparationReceiptFile: '/tmp/golden-receipt.json' };

for (const [mirrorName, workflowFile] of MIRRORS) {
  // ── GOLDEN REPLAY: legacy path is byte-for-behavior identical to pre-DIR-123 ────────────────────
  test(`[${mirrorName}] GOLDEN REPLAY — legacy (no isolationMode) matches pre-DIR-123 baseline except Land's intentional step-1 text fix`, async () => {
    const phases = [];
    const { agent, calls } = makeLegacyCaptureMock();
    const result = await loadWorkflow(workflowFile)(
      LEGACY_ARGS, (p) => phases.push(p), () => {}, (fns) => Promise.all(fns.map((f) => f())), agent,
    );
    // (1) identical phase sequence
    assert.deepEqual(phases, GOLDEN.phases, 'phase sequence must be unchanged in legacy mode');
    // (2) identical agent-call sequence (count + per-call label/phase)
    assert.equal(calls.length, GOLDEN.calls.length, 'agent-call count must be unchanged in legacy mode');
    const diffIdx = [];
    for (let i = 0; i < calls.length; i++) {
      assert.equal(calls[i].label, GOLDEN.calls[i].label, `call[${i}] label changed`);
      assert.equal(calls[i].phase, GOLDEN.calls[i].phase, `call[${i}] phase changed`);
      // DIR-124-A1b: stage-event emission prompts embed Date.now() timestamps
      // (recordedAtMs / timing.startedAtMs) — intentionally non-deterministic, so their exact
      // text is excluded from the prompt-delta check (their label/phase/count above still pin them).
      const isEmitEvent = String(calls[i].label).startsWith('emit-event-');
      if (!isEmitEvent && calls[i].prompt !== GOLDEN.calls[i].prompt) diffIdx.push(i);
    }
    // (3) EXACTLY ONE non-emit prompt may differ — the Land main agent (no label, phase Land):
    // #4's stale-text fix. The golden fixture was REGENERATED for the M264/M265 mechanism
    // (per-phase evidence consumption): the width-1 Build-Evidence collector invocation now
    // pushes --iteration-report <MILESTONE_ROOT>/iterations/iteration-0.md, and the fixture's
    // call 13 carries that new line (asserted below). This is a DELIBERATE Build-Evidence
    // mechanism change for gap-build-evidence-manifest-missing, NOT a DIR-123 regression.
    assert.equal(diffIdx.length, 1, `expected exactly 1 non-emit legacy prompt delta (Land step-1 fix), got ${diffIdx.length} at [${diffIdx}]`);
    assert.match(GOLDEN.calls[13].prompt, /--iteration-report \$\(source experiments\/quay-perpetual-stream\/scripts\/gate-script-lib\.sh && gate_resolve_milestone_root 999\)\/iterations\/iteration-0\.md/, 'golden fixture call 13 must carry the --iteration-report push for the width-1 path');
    const li = diffIdx[0];
    assert.equal(GOLDEN.calls[li].phase, 'Land');
    assert.equal(GOLDEN.calls[li].label, null);
    // baseline carried the stale "MERGE the iteration worktree into master"; edited carries the no-op text.
    assert.match(GOLDEN.calls[li].prompt, /MERGE the iteration worktree into master/, 'baseline golden should contain the stale text');
    assert.doesNotMatch(calls[li].prompt, /MERGE the iteration worktree into master/i, 'edited legacy prompt must not contain the stale text');
    assert.match(calls[li].prompt, /NO WORKTREE MERGE \(no-isolation mode/, 'edited legacy prompt must describe the no-op accurately');
    // (4) identical return value
    assert.deepEqual(result, GOLDEN.result, 'legacy return value must be unchanged');
  });

  // ── WORKTREE LIFECYCLE: real git operations end-to-end through the workflow ─────────────────────
  test(`[${mirrorName}] WORKTREE MODE — real worktree create → Build/Audit/Gate read it → Land real-merges + removes; primary untouched until Land`, async () => {
    const { dir, g } = makeTempRepo();
    try {
      const milestone = 'M191';
      const recorder = { gatePrompts: [], landVerdicts: [], createVerdicts: [] };
      const args = { taskId: 'DIR-123-WT', charterFile: 'milestones/M191/M191-charter.md', absorbEntryFile: '/dev/null', preparationReceiptFile: '/tmp/wt-receipt.json', isolationMode: 'worktree' };
      const { result, phases } = await runWorkflow(workflowFile, args, makeWorktreeMock(dir, milestone, recorder));

      assert.equal(result.outcome, 'done', JSON.stringify(result));
      // Build-Evidence (54c6c301, M238) runs between Build and Audit — the hash-bound evidence
      // manifest is produced post-Build for Audit's independent consumption.
      assert.deepEqual(phases, ['Verify', 'Prepared', 'Build', 'Build-Evidence', 'Audit', 'Gate', 'Land']);

      // (a) worktree-create emitted the REAL --add command and it really created the worktree.
      // (_milestone is the bare number "191" — the workflow strips the "M" prefix; the CLI accepts both.)
      assert.match(recorder.createPrompt, /milestone-worktree\.ts --add --workspace \. --milestone (?:M)?191/);
      assert.equal(recorder.createVerdicts[0].outcome, 'added');
      assert.equal(recorder.worktreeExistedAfterCreate, true, 'worktree dir must exist right after Build-phase create (before Land removes it)');

      // (b) Build, Audit, and EVERY Gate prompt thread the worktree path.
      const wtRel = worktreeRelPath(191);
      assert.ok(recorder.buildPrompt.includes(wtRel), 'Build prompt must thread the worktree path');
      assert.ok(recorder.auditPrompt.includes(wtRel), 'Audit prompt must thread the worktree path');
      assert.ok(recorder.gatePrompts.length >= 5, 'all 5 gates dispatched');
      for (const gp of recorder.gatePrompts) assert.ok(gp.includes(wtRel), 'each Gate prompt must thread the worktree path');

      // (c) Audit read the WORKTREE sentinel, not the primary's (they deliberately differ post-Build).
      assert.equal(recorder.auditSaw.sawWorktreePathInPrompt, true, 'Audit prompt must name the worktree path');
      assert.equal(recorder.auditSaw.sentinelViaWorktree, 'WORKTREE-BUILT-VERSION');
      assert.equal(recorder.auditSaw.sentinelViaPrimary, 'PRIMARY-VERSION');
      assert.notEqual(recorder.auditSaw.sentinelViaWorktree, recorder.auditSaw.sentinelViaPrimary, 'fixture must make worktree vs primary differ');

      // (d) Land ran the REAL lock-acquire → merge → remove → lock-release sequence, in order.
      const outcomes = recorder.landVerdicts.map((v) => v.outcome);
      assert.deepEqual(outcomes, ['acquired', 'merged', 'removed', 'released'], `Land must acquire-lock, merge, remove, release; got ${JSON.stringify(recorder.landVerdicts)}`);

      // (e) POST-LAND real git state: merged into primary, worktree gone, branch deleted, lock released.
      assert.equal(fs.readFileSync(path.join(dir, 'sentinel.txt'), 'utf8').trim(), 'WORKTREE-BUILT-VERSION', 'primary must carry the merged worktree content after Land');
      assert.ok(fs.existsSync(path.join(dir, 'feature.txt')), 'merged feature file must be in the primary checkout');
      const wtList = g(['worktree', 'list']);
      assert.equal(wtList.split('\n').length, 1, `only the primary worktree should remain: ${wtList}`);
      assert.doesNotMatch(g(['branch', '--list', worktreeBranch(191)]), new RegExp(worktreeBranch(191).replace('/', '\\/')), 'merged branch must be deleted');
      assert.ok(!fs.existsSync(path.join(dir, '.quay', 'land-locks', 'shared-checkout.lock')), 'Land lock must be released after Land');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── PRIMARY CHECKOUT UNTOUCHED UNTIL LAND (real git status snapshots at phase boundaries) ───────
  // DIR-123 review C3 precision: this asserts zero SHARED / BRANCH-RELEVANT tracked diffs before Land.
  // In a REAL dispatch the ONLY pre-Land primary diff is the dispatch's OWN task file — Build's
  // `task_write` of extra.acceptance dirties tasks/<id>.md on the primary — which is concurrency-safe
  // because the worktree branch NEVER touches that file (concurrent dispatches dirty disjoint task
  // files; their merges cannot collide on it). This mock does not perform that `task_write`, so it
  // observes a literally empty pre-Land diff — the conservative case, not an overstrong absolute claim.
  test(`[${mirrorName}] WORKTREE MODE — primary checkout has zero shared/branch-relevant tracked diffs after Build/Audit/Gate, before Land`, async () => {
    const { dir, g } = makeTempRepo();
    try {
      const milestone = 'M192';
      const wtRel = worktreeRelPath(192);
      // A mock identical to the worktree mock, but that snapshots `git diff HEAD --name-only` on the
      // PRIMARY checkout immediately before the Land agent runs its merge.
      const recorder = { gatePrompts: [], landVerdicts: [], createVerdicts: [] };
      let primaryDiffBeforeLand = null;
      const base = makeWorktreeMock(dir, milestone, recorder);
      const spyingAgent = async function (prompt, opts = {}) {
        if (opts.phase === 'Land' && opts.label == null) {
          primaryDiffBeforeLand = g(['diff', 'HEAD', '--name-only']); // tracked modifications on primary
        }
        return base(prompt, opts);
      };
      const args = { taskId: 'DIR-123-WT2', charterFile: 'milestones/M192/M192-charter.md', absorbEntryFile: '/dev/null', preparationReceiptFile: '/tmp/wt-receipt.json', isolationMode: 'worktree' };
      const { result } = await runWorkflow(workflowFile, args, spyingAgent);
      assert.equal(result.outcome, 'done');
      assert.equal(primaryDiffBeforeLand, '', `primary checkout must have no tracked diffs before Land's merge; got:\n${primaryDiffBeforeLand}`);
      // …and the build's file genuinely existed in the WORKTREE (not the primary) at that point.
      assert.ok(recorder.buildPrompt.includes(wtRel));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── SAME-FILE CONFLICT reaching Land → real merge conflict is auto-aborted, surfaces as conflict ─
  test(`[${mirrorName}] WORKTREE MODE — a real merge conflict at Land is auto-aborted (defined handling, never blanket --ours/--theirs)`, async () => {
    const { dir, g } = makeTempRepo();
    try {
      const milestone = 'M193';
      const wtRel = worktreeRelPath(193);
      // Create the worktree, then make BOTH the worktree branch and master modify sentinel.txt
      // differently, so Land's real `git merge` conflicts.
      const addV = runCliJson(['--add', '--workspace', '.', '--milestone', milestone], dir);
      assert.equal(addV.outcome, 'added');
      const wtAbs = path.join(dir, wtRel);
      fs.writeFileSync(path.join(wtAbs, 'sentinel.txt'), 'WORKTREE-EDIT\n');
      execFileSync('git', ['-C', wtAbs, 'add', '-A']); execFileSync('git', ['-C', wtAbs, 'commit', '-qm', 'wt edit']);
      fs.writeFileSync(path.join(dir, 'sentinel.txt'), 'MASTER-EDIT\n');
      g(['add', '-A']); g(['commit', '-qm', 'master edit']);
      // The real merge must conflict and AUTO-ABORT, leaving the primary clean (master's version intact).
      const mergeV = runCliJson(['--merge', '--workspace', '.', '--milestone', milestone], dir);
      assert.equal(mergeV.outcome, 'conflict');
      assert.ok(mergeV.files.includes('sentinel.txt'), `conflict files should list sentinel.txt: ${JSON.stringify(mergeV.files)}`);
      assert.equal(g(['diff', 'HEAD', '--name-only']), '', 'merge --abort must leave the primary checkout clean');
      assert.equal(fs.readFileSync(path.join(dir, 'sentinel.txt'), 'utf8').trim(), 'MASTER-EDIT', 'primary keeps its own version after auto-abort');
      // Land prompt describes this exact defined handling (mark needs-human, never blanket resolution).
      const src = fs.readFileSync(workflowFile, 'utf8');
      assert.match(src, /same-file-conflict path/);
      assert.match(src, /outcome:"conflict"[\s\S]*?mark needs-human/, 'conflict handling must mark needs-human');
      assert.match(src, /DO NOT blanket --ours\/--theirs/, 'conflict handling must forbid blanket --ours/--theirs');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── FAIL-CLOSED: worktree requested but no numeric milestone ────────────────────────────────────
  test(`[${mirrorName}] FAIL-CLOSED — isolationMode:'worktree' with a non-numeric milestone halts at Verify, never Build`, async () => {
    let built = false;
    const agent = async (prompt, opts = {}) => {
      if (opts.phase === 'Build' || opts.label === 'worktree-create') { built = true; }
      if (VERIFY_LABELS.includes(opts.label)) return verifyStub(opts.label);
      return { ok: true };
    };
    const { result } = await runWorkflow(workflowFile, { taskId: 'X', charterFile: 'charters/no-number-charter.md', absorbEntryFile: '/dev/null', preparationReceiptFile: '/tmp/r.json', isolationMode: 'worktree' }, agent);
    assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
    assert.equal(result.reason, 'worktree-needs-numeric-milestone');
    assert.equal(result.phase, 'Verify');
    assert.equal(built, false, 'Build/worktree-create must never be dispatched when isolation is unusable');
  });

  // ── FAIL-CLOSED: unknown non-empty isolationMode does not silently fall back to the shared tree ─
  test(`[${mirrorName}] FAIL-CLOSED — unknown isolationMode ('bogus') halts at Verify (no silent fallback)`, async () => {
    let built = false;
    const agent = async (prompt, opts = {}) => {
      if (opts.phase === 'Build' || opts.label === 'worktree-create') { built = true; }
      if (VERIFY_LABELS.includes(opts.label)) return verifyStub(opts.label);
      return { ok: true };
    };
    const { result } = await runWorkflow(workflowFile, { taskId: 'X', charterFile: 'milestones/M999/M999-charter.md', absorbEntryFile: '/dev/null', preparationReceiptFile: '/tmp/r.json', isolationMode: 'bogus' }, agent);
    assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
    assert.equal(result.reason, 'unknown-isolation-mode: bogus');
    assert.equal(result.phase, 'Verify');
    assert.equal(built, false);
  });

  // ── OBSTACLE 1: the serial worktree Land holds the Land lock for the ENTIRE Land phase ──────────
  // (not just the merge) — the lock's scoped region equals the full set of shared-checkout mutations:
  // merge/remove AND CAPTURE commits AND dashboard.md ## Log AND milestone_counter AND backlog regen.
  test(`[${mirrorName}] OBSTACLE 1 — serial worktree Land holds the Land lock across ALL shared-checkout mutations (acquire first, release last)`, async () => {
    const { dir } = makeTempRepo();
    try {
      const recorder = { gatePrompts: [], landVerdicts: [], createVerdicts: [] };
      const args = { taskId: 'DIR-123-O1', charterFile: 'milestones/M194/M194-charter.md', absorbEntryFile: '/dev/null', preparationReceiptFile: '/tmp/r.json', isolationMode: 'worktree' };
      const { result } = await runWorkflow(workflowFile, args, makeWorktreeMock(dir, 'M194', recorder));
      assert.equal(result.outcome, 'done', JSON.stringify(result));
      const p = recorder.landPrompt;
      const idx = {
        acquire: p.indexOf('--land-lock-acquire'),
        merge: p.indexOf('--merge'),
        remove: p.indexOf('--remove'),
        release: p.indexOf('--land-lock-release'),
        // Step HEADINGS / unique command forms only — step 1a's prose also names these mutations, so a
        // bare "CAPTURE"/"milestone_counter" would match step 1a before the lock is even acquired.
        capture: p.indexOf('2. CAPTURE'),
        dashLog: p.indexOf("dashboard.md's ## Log"),
        counter: p.indexOf('milestone_counter++'),
        backlog: p.indexOf('5. REGENERATE'),
      };
      for (const [name, i] of Object.entries(idx)) assert.ok(i >= 0, `serial Land prompt must contain ${name}`);
      // Acquire is FIRST, release is LAST — every shared-checkout mutation sits strictly between them.
      assert.ok(idx.acquire < idx.merge && idx.merge < idx.remove, 'acquire → merge → remove');
      assert.ok(idx.acquire < idx.capture && idx.capture < idx.release, 'CAPTURE commits happen under the held lock');
      assert.ok(idx.acquire < idx.dashLog && idx.dashLog < idx.release, 'dashboard.md ## Log append happens under the held lock');
      assert.ok(idx.acquire < idx.counter && idx.counter < idx.release, 'milestone_counter++ happens under the held lock');
      assert.ok(idx.acquire < idx.backlog && idx.backlog < idx.release, 'backlog/dashboard regen happens under the held lock');
      // And the real run actually executed acquire → merge → remove → release, in that order.
      assert.deepEqual(recorder.landVerdicts.map((v) => v.outcome), ['acquired', 'merged', 'removed', 'released']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── OBSTACLE 2: concurrent+worktree Land merges NOTHING — the fan-in is the SOLE merge owner ────
  test(`[${mirrorName}] OBSTACLE 2 — concurrent+worktree Land merges nothing, returns buildBranch, leaves primary untouched + worktree for the fan-in`, async () => {
    const { dir, g } = makeTempRepo();
    try {
      const milestone = 'M195';
      const wtRel = worktreeRelPath(195);
      const branch = worktreeBranch(195);
      const recorder = { gatePrompts: [], landVerdicts: [], createVerdicts: [] };
      const base = makeWorktreeMock(dir, milestone, recorder);
      const spy = async (prompt, opts = {}) => {
        if (opts.phase === 'Land' && opts.label == null) {
          recorder.concurrentLandPrompt = prompt;
          // The read-only step-4 touchedFiles + dashboard entry; NO shared-checkout mutation.
          return { outcome: 'done', buildBranch: branch, worktreeRel: wtRel, touchedFiles: ['feature.txt', 'sentinel.txt'], dashboardEntry: 'm195 entry' };
        }
        return base(prompt, opts);
      };
      const args = { taskId: 'DIR-123-O2', charterFile: 'milestones/M195/M195-charter.md', absorbEntryFile: '/dev/null', preparationReceiptFile: '/tmp/r.json', isolationMode: 'worktree', mode: 'concurrent' };
      const { result } = await runWorkflow(workflowFile, args, spy);
      assert.equal(result.outcome, 'done', JSON.stringify(result));
      // (a) The workflow takes NO lock and does NO merge/remove on the shared checkout (fan-in's job).
      const cp = recorder.concurrentLandPrompt;
      assert.ok(!cp.includes('--land-lock-acquire'), 'concurrent+worktree Land must NOT take the Land lock');
      assert.ok(!cp.includes('--merge --workspace'), 'concurrent+worktree Land must NOT merge');
      assert.ok(!cp.includes('--remove --workspace'), 'concurrent+worktree Land must NOT remove the worktree');
      assert.match(cp, /SOLE merge owner/);
      assert.match(cp, /DO NOT/);
      // (b) It hands the fan-in the branch + worktree to merge.
      assert.equal(result.buildBranch, branch);
      assert.equal(result.worktreeRel, wtRel);
      // (c) The primary checkout is UNTOUCHED (Build's edits are only in the worktree; nothing merged).
      assert.equal(fs.readFileSync(path.join(dir, 'sentinel.txt'), 'utf8').trim(), 'PRIMARY-VERSION');
      assert.equal(fs.existsSync(path.join(dir, 'feature.txt')), false, 'feature must NOT be in the primary (no merge ran)');
      // (d) The worktree + branch are LEFT IN PLACE for the fan-in to merge under the lock.
      assert.match(g(['worktree', 'list']), /iteration-0/, 'worktree must remain for the fan-in');
      assert.match(g(['branch', '--list', branch]), new RegExp(branch.replace('/', '\\/')), 'branch must remain for the fan-in');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── OBSTACLE 3: a stranded worktree from a crashed prior dispatch is recovered at worktree-create ─
  test(`[${mirrorName}] OBSTACLE 3 — a stranded 0-ahead worktree (crashed prior dispatch) is auto-cleaned and the retry succeeds`, async () => {
    const { dir, g } = makeTempRepo();
    try {
      const milestone = 'M196';
      // Pre-strand a worktree+branch with ZERO commits ahead (a crash before any build commit).
      assert.equal(runCliJson(['--add', '--workspace', '.', '--milestone', milestone], dir).outcome, 'added');
      assert.match(g(['worktree', 'list']), /iteration-0/);
      const recorder = { gatePrompts: [], landVerdicts: [], createVerdicts: [] };
      const args = { taskId: 'DIR-123-O3', charterFile: 'milestones/M196/M196-charter.md', absorbEntryFile: '/dev/null', preparationReceiptFile: '/tmp/r.json', isolationMode: 'worktree' };
      const { result } = await runWorkflow(workflowFile, args, makeWorktreeMock(dir, milestone, recorder));
      assert.equal(result.outcome, 'done', JSON.stringify(result));
      assert.equal(recorder.cleanVerdict?.outcome, 'cleaned', 'worktree-create must clean the stranded 0-ahead worktree');
      assert.equal(recorder.createVerdicts[0].outcome, 'added', 'the retried --add must succeed after cleaning');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`[${mirrorName}] OBSTACLE 3 — a stranded worktree WITH real commits fails closed to needs-human (real work never discarded)`, async () => {
    const { dir, g } = makeTempRepo();
    try {
      const milestone = 'M197';
      const wtRel = worktreeRelPath(197);
      // Pre-strand a worktree WITH a real commit ahead of master (a crash AFTER some build work).
      assert.equal(runCliJson(['--add', '--workspace', '.', '--milestone', milestone], dir).outcome, 'added');
      const wt = path.join(dir, wtRel);
      fs.writeFileSync(path.join(wt, 'wip.txt'), 'in-progress work\n');
      execFileSync('git', ['-C', wt, 'add', '-A']); execFileSync('git', ['-C', wt, 'commit', '-qm', 'wip']);
      const recorder = { gatePrompts: [], landVerdicts: [], createVerdicts: [] };
      const args = { taskId: 'DIR-123-O3b', charterFile: 'milestones/M197/M197-charter.md', absorbEntryFile: '/dev/null', preparationReceiptFile: '/tmp/r.json', isolationMode: 'worktree' };
      const { result } = await runWorkflow(workflowFile, args, makeWorktreeMock(dir, milestone, recorder));
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'worktree-create-failed');
      assert.equal(recorder.cleanVerdict?.outcome, 'has-commits', 'clean-stale must refuse to discard real work');
      // The real in-progress work is preserved (branch + worktree + file all still present).
      assert.match(g(['branch', '--list', worktreeBranch(197)]), /iteration-0/);
      assert.ok(fs.existsSync(path.join(wt, 'wip.txt')), 'real in-progress work must NOT be discarded');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── C1 (real bug): a worktree-isolated Land PRESERVES the audit artifact ────────────────────────
  // The mock Audit writes + stages + COMMITS an audit artifact in the worktree (as the real Audit now
  // does per the COMMIT-THE-AUDIT-EVIDENCE note). The test asserts that artifact survives the merge to
  // the primary post-Land — the exact gap the pre-C1 mock-only-read Audit hid (staged-but-uncommitted
  // evidence was discarded by `git worktree remove --force`, never reaching the primary).
  test(`[${mirrorName}] C1 — worktree-isolated Land preserves the audit artifact (Audit commits it to the branch; not discarded by worktree remove --force)`, async () => {
    const { dir, g } = makeTempRepo();
    try {
      const milestone = 'M198';
      const recorder = { gatePrompts: [], landVerdicts: [], createVerdicts: [] };
      const args = { taskId: 'DIR-123-C1', charterFile: 'milestones/M198/M198-charter.md', absorbEntryFile: '/dev/null', preparationReceiptFile: '/tmp/r.json', isolationMode: 'worktree' };
      const { result } = await runWorkflow(workflowFile, args, makeWorktreeMock(dir, milestone, recorder));
      assert.equal(result.outcome, 'done', JSON.stringify(result));
      // (a) The Audit prompt instructs committing the audit evidence to the branch (the C1 fix).
      assert.match(recorder.auditPrompt, /COMMIT-THE-AUDIT-EVIDENCE/, 'Audit isolation note must instruct committing the audit evidence');
      assert.match(recorder.auditPrompt, /git add -A && git commit/, 'Audit must git add + commit the evidence');
      // (b) The artifact the mock Audit committed in the worktree SURVIVES to the primary post-Land.
      const artifactRel = path.join('audits', 'iteration-0-acceptance-audit.md');
      assert.ok(fs.existsSync(path.join(dir, artifactRel)), `audit artifact must survive to the primary post-Land: ${artifactRel}`);
      assert.match(fs.readFileSync(path.join(dir, artifactRel), 'utf8'), /acceptance audit/);
      // (c) It is genuinely in master's history (merged on the branch), not a stray untracked file.
      assert.notEqual(g(['log', '--oneline', '--', artifactRel]).trim(), '', 'audit artifact must be in the merged history');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}


// ── DIR-124-A1b: stage-event emission — every emit-event agent prompt embeds schema-valid StageEvent
// JSON (validatable against A1a's validateEvent), and the boundaries' start+end pairs are present.
// Fire-and-forget is already proven by the golden replay (workflow result identical with emit calls).
import { validateEvent } from '../../experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs';

for (const [mirrorName, workflowFile] of MIRRORS) {
  test(`[${mirrorName}] DIR-124-A1b — every emit-event prompt embeds schema-valid JSON; start+end pairs per boundary`, async () => {
    const { agent, calls } = makeLegacyCaptureMock();
    const phases = [];
    const result = await loadWorkflow(workflowFile)(
      LEGACY_ARGS, (p) => phases.push(p), () => {}, (fns) => Promise.all(fns.map((f) => f())), agent,
    );
    const emitCalls = calls.filter((c) => String(c.label).startsWith('emit-event-'));
    assert.ok(emitCalls.length >= 14, `expected >=14 emit-event calls, got ${emitCalls.length}`);

    const byStage = {};
    for (const c of emitCalls) {
      const jsonMatch = c.prompt.match(/--emit-event '([\s\S]*?)'\n/);
      assert.ok(jsonMatch, `emit-event prompt must embed a --emit-event '<json>' command:\n${c.prompt.slice(0, 200)}`);
      const event = JSON.parse(jsonMatch[1].replace(/'\\''/g, "'"));
      const v = validateEvent(event);
      assert.ok(v.ok, `emit-event ${c.label} must be schema-valid: ${v.error}`);
      assert.equal(event.schemaVersion, '1');
      assert.equal(String(c.label), `emit-event-${event.stage}-${event.eventKind}`);
      if (event.eventKind === 'start') { assert.equal(event.outcome, null); assert.equal(event.timing.endedAtMs, null); }
      else { assert.ok(['done', 'skipped', 'needs-human'].includes(event.outcome), `end outcome=${event.outcome}`); }
      (byStage[event.stage] = byStage[event.stage] || []).push(event.eventKind);
    }
    for (const stage of ['Verify', 'Prepared', 'Build', 'Audit', 'Gate', 'Reconcile', 'Land']) {
      assert.ok(byStage[stage], `stage ${stage} must emit events`);
      assert.equal(byStage[stage].filter((k) => k === 'start').length, 1, `${stage} exactly one start`);
      assert.equal(byStage[stage].filter((k) => k === 'end').length, 1, `${stage} exactly one end`);
    }
    assert.ok(result.outcome === 'done' || result.outcome === 'needs-human', `result outcome ${result.outcome}`);
  });
}
