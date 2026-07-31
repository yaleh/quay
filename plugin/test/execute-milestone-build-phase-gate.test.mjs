// execute-milestone-build-phase-gate.test.mjs — gap-build-phase-null-result-not-gated.
//
// PROBLEM this closes: the Build-phase result gate in execute-milestone.js used to reject only
// the literal string 'needs-human' (`buildResult?.outcome === 'needs-human'`). A terminally-errored
// `agent()` call resolves to `null` — `null?.outcome` is `undefined`, `undefined === 'needs-human'`
// is `false`, so the negative-only check fell through and Audit/Gate/Land dispatched as if Build
// had succeeded. Observed live in M192 (`wf_b57d3610-224`): the Build agent hit a real Anthropic
// API transient error, `agent()` resolved to `null`, and the workflow advanced to Audit with
// `Build outcome: null` interpolated verbatim into the Land agent's prompt. The fix (both mirrors)
// replaces the negative-only check with a positive-outcome gate: `buildResult?.outcome !== 'done'`.
//
// METHOD (mirrors execute-milestone-preparation-gate.test.mjs's documented scope discipline): load
// the REAL, unmodified `.claude/workflows/execute-milestone.js` / `plugin/workflows/execute-milestone.js`
// source, drive it with a mock `agent()` that passes Verify/Prepared genuinely (a real, valid
// preparation receipt reaches Build), then controls exactly what the Build-phase `agent()` call
// returns and asserts on the real, unmodified gate's decision — including that Audit/Gate/Land are
// NEVER dispatched on a Build failure (any agent() call past Build throws, proving it was reached).
//
// Run:
//   node --experimental-strip-types --test plugin/test/execute-milestone-build-phase-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReceipt } from '../../experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIRRORS = [
  ['.claude/workflows/execute-milestone.js', path.join(REPO_ROOT, '.claude', 'workflows', 'execute-milestone.js')],
  ['plugin/workflows/execute-milestone.js', path.join(REPO_ROOT, 'plugin', 'workflows', 'execute-milestone.js')],
];
const FIXTURES = path.join(REPO_ROOT, 'experiments', 'quay-perpetual-stream', 'fixtures', 'preparation');
const TASK = path.join(FIXTURES, 'fixture-task.md');
const PLAN = path.join(FIXTURES, 'fixture-plan.md');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function loadWorkflow(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/^export const meta/, 'const meta');
  return new AsyncFunction('args', 'phase', 'log', 'parallel', 'agent', src);
}

const VERIFY_LABELS = ['ceiling-check', 'gate-hash', 'line-budget', 'dogfood-evidence', 'domain-misfit', 'composite-preflight'];
function verifyStub(label) {
  if (label === 'domain-misfit') return { ok: true, step3conclusion: 'stub' };
  return { check: label, ok: true, detail: 'stub' };
}

function distinctProvenance() {
  return {
    proposalAuthors: [{ authorIdx: 1, sessionId: 'sess-a1' }, { authorIdx: 2, sessionId: 'sess-a2' }],
    adjudicator: { sessionId: 'sess-adj' },
    proposalReviewer: { sessionId: 'sess-rev' },
    planAuthor: { sessionId: 'sess-pa' },
    planCheckers: [{ round: 1, sessionId: 'sess-pc1' }],
  };
}

function freshScratchDir() {
  return fs.mkdtempSync(path.join(FIXTURES, 'build-gate-scratch-'));
}

function scratchArgs(scratchDir) {
  const scratchRel = path.relative(REPO_ROOT, scratchDir).split(path.sep).join('/');
  const taskId = `../${scratchRel}/task`;
  const charterFile = `${scratchRel}/M999-charter.md`;
  return {
    taskId,
    charterFile,
    absorbEntryFile: '/dev/null',
    preparationReceiptFile: path.join(scratchDir, 'preparation.json'),
    _taskFileOnDisk: path.join(scratchDir, 'task.md'),
    _charterFileOnDisk: path.join(scratchDir, 'M999-charter.md'),
  };
}

function writeScratchTaskCharter(scratchDir, args) {
  fs.writeFileSync(args._taskFileOnDisk, fs.readFileSync(TASK, 'utf8'));
  fs.writeFileSync(args._charterFileOnDisk, 'type: execution\n\nScratch charter for execute-milestone-build-phase-gate.test.mjs.\n');
}

function writeValidReceipt(args) {
  const receipt = buildReceipt({
    taskId: 'TEST-BUILD-GATE', milestoneId: 'M999',
    charterFile: args._charterFileOnDisk, taskFile: args._taskFileOnDisk, planFile: PLAN,
    review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 },
    provenance: distinctProvenance(),
  });
  fs.writeFileSync(args.preparationReceiptFile, JSON.stringify(receipt, null, 2));
}

// Returns {agentMock, dispatchedPastBuild} — dispatchedPastBuild flips true if any agent() call
// with phase !== 'Build' (and label !== a Verify label / 'preparation-check') happens, proving
// Audit/Gate/Land were reached even though this test only asserts the Build-phase return value.
function makeAgentMock(buildReturnValue) {
  const state = { dispatchedPastBuild: false };
  const agentMock = async function (prompt, opts = {}) {
    const label = opts.label;
    if (VERIFY_LABELS.includes(label)) return verifyStub(label);
    if (label === 'preparation-check') {
      // Real Prepared-phase check against the real, valid receipt we wrote to disk.
      const { execSync } = await import('node:child_process');
      const m = prompt.match(/Then run: (node[^\n]+)/) || prompt.match(/^Run: (node[^\n]+)/m);
      assert.ok(m, `could not find the Prepared-phase check command in the prompt:\n${prompt}`);
      let stdout, status;
      try { stdout = execSync(m[1], { cwd: REPO_ROOT, encoding: 'utf8' }); status = 0; }
      catch (e) { stdout = e.stdout ? e.stdout.toString() : ''; status = typeof e.status === 'number' ? e.status : 1; }
      const lastLine = stdout.trim().split('\n').pop() || '';
      const codeMatch = lastLine.match(/^(PASS|FAIL): ([\w-]+) — /);
      return { ok: status === 0, code: codeMatch ? codeMatch[2] : 'no-code-parsed', detail: lastLine };
    }
    if (opts.phase === 'Build') return buildReturnValue;
    // Anything else (Audit/Gate/Land/etc.) is exactly what AC1/AC4 forbid on a Build failure.
    state.dispatchedPastBuild = true;
    return { ok: true };
  };
  return { agentMock, state };
}

async function runExecuteMilestone(workflowFile, argsObj, buildReturnValue) {
  const fn = loadWorkflow(workflowFile);
  const { agentMock, state } = makeAgentMock(buildReturnValue);
  const result = await fn(
    argsObj,
    () => {}, // phase()
    () => {}, // log()
    (fns) => Promise.all(fns.map((f) => f())), // parallel()
    agentMock,
  );
  return { result, dispatchedPastBuild: state.dispatchedPastBuild };
}

async function withPreparedTask(fn) {
  const scratchDir = freshScratchDir();
  try {
    const args = scratchArgs(scratchDir);
    writeScratchTaskCharter(scratchDir, args);
    writeValidReceipt(args);
    await fn(args);
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

for (const [mirrorName, workflowFile] of MIRRORS) {
  // ── AC1/AC3: the real M192 scenario — agent() terminally errors, resolves to null ──────────────
  test(`[${mirrorName}] Build-phase agent() returning null (M192 scenario) halts before Audit/Gate/Land`, async () => {
    await withPreparedTask(async (args) => {
      const { result, dispatchedPastBuild } = await runExecuteMilestone(workflowFile, args, null);
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'build-agent-no-result');
      assert.equal(result.phase, 'Build');
      assert.equal(dispatchedPastBuild, false, 'Audit/Gate/Land must never be dispatched when Build returns null');
    });
  });

  // ── AC4: undefined ───────────────────────────────────────────────────────────────────────────
  test(`[${mirrorName}] Build-phase agent() returning undefined halts before Audit/Gate/Land`, async () => {
    await withPreparedTask(async (args) => {
      const { result, dispatchedPastBuild } = await runExecuteMilestone(workflowFile, args, undefined);
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'build-agent-no-result');
      assert.equal(result.phase, 'Build');
      assert.equal(dispatchedPastBuild, false);
    });
  });

  // ── AC4: unknown outcome string ──────────────────────────────────────────────────────────────
  test(`[${mirrorName}] Build-phase agent() returning an unknown outcome ('stale') halts before Audit/Gate/Land`, async () => {
    await withPreparedTask(async (args) => {
      const { result, dispatchedPastBuild } = await runExecuteMilestone(workflowFile, args, { outcome: 'stale' });
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'build-outcome-not-done');
      assert.equal(result.phase, 'Build');
      assert.equal(dispatchedPastBuild, false);
    });
  });

  // ── Preserved (needs-human with agent-supplied reason) — the pre-existing behavior ──────────────
  test(`[${mirrorName}] Build-phase agent() returning {outcome:'needs-human', reason} forwards the agent's own reason`, async () => {
    await withPreparedTask(async (args) => {
      const { result, dispatchedPastBuild } = await runExecuteMilestone(workflowFile, args, { outcome: 'needs-human', reason: 'test-suite-failure' });
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'test-suite-failure');
      assert.equal(result.phase, 'Build');
      assert.equal(dispatchedPastBuild, false);
    });
  });

  // ── AC4: outcome:'done' but schema-invalid (documents the current, deliberate scope boundary) ──
  test(`[${mirrorName}] Build-phase agent() returning {outcome:'done'} with no other fields passes the gate (full schema validation is a documented non-goal)`, async () => {
    await withPreparedTask(async (args) => {
      const { result, dispatchedPastBuild } = await runExecuteMilestone(workflowFile, args, { outcome: 'done' });
      // The gate only checks outcome === 'done' — it does not validate mergeCommit/iterationCount.
      // This passes through to Audit, proving the gate's scope boundary is exactly as documented.
      assert.equal(dispatchedPastBuild, true, 'a nominal outcome:"done" must reach Audit/Gate/Land');
      assert.notEqual(result?.phase, 'Build');
    });
  });
}
