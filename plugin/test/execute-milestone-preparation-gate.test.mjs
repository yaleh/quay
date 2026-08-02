// execute-milestone-preparation-gate.test.mjs — DIR-117 iteration-2 item 5.
//
// PROBLEM this closes: the M191 iteration-0 acceptance audit REFUTED DIR-117's AC "when a
// preparationReceiptFile IS supplied ... fails closed on [failed review / F_i>0 / stale hash /
// missing Plan / touch-set expansion] ... a matching valid receipt reaches Build" because "no test
// yet drives this through execute-milestone.js itself end-to-end (only the standalone checker is
// unit-tested)". milestone-preparation-check.test.mjs proves checkPreparation() itself is correct
// in isolation; it does NOT prove execute-milestone.js's own `Prepared` phase branching (the
// enforced-by-default control flow since DIR-117-B/M195: `phase('Prepared')` is unconditional; a
// MISSING `preparationReceiptFile` returns `{outcome:'revision-needed', reason:'preparation-receipt-
// missing', phase:'Prepared'}` before Build, and a supplied-but-broken receipt returns the same
// shape via the real checker) actually calls it and actually returns before Build on failure.
//
// METHOD (mirrors execute-milestone-disposition-conformance.test.mjs's documented scope
// discipline — a real LLM agent turn cannot be driven by a static test): load the REAL,
// unmodified `.claude/workflows/execute-milestone.js` / `plugin/workflows/execute-milestone.js`
// source (only the ES `export` keyword on `meta` stripped so it can run as a plain function body —
// the workflow runtime itself supplies `args`/`phase`/`log`/`parallel`/`agent` as globals, never
// `import`), wrap it in a real AsyncFunction, and execute it with a mock `agent()` that:
//   - PASSes the 6 Verify-phase mechanical checks generically (out of scope for this test — real
//     coverage already exists for those individually elsewhere), so real control flow reaches the
//     Prepared phase every time;
//   - for the `preparation-check` label ONLY, parses the ACTUAL prompt text the Prepared phase
//     built (the real `if/else` branch, real string interpolation) and ACTUALLY EXECUTES the real
//     `milestone-preparation-check.ts` CLI command it names, feeding the real exit code/stdout back
//     — a true integration exercise of the real wiring, not a re-implementation of it;
//   - for the Build phase, returns an immediately-recognizable short-circuit sentinel so this test
//     never needs to emulate Audit/Gate/Land.
//
// This proves: IF a real receipt is broken in one of the 5 documented ways, the REAL
// execute-milestone.js file — unmodified, both mirrors — actually returns 'revision-needed' with
// phase:'Prepared' BEFORE Build ever runs; and a real, fully-valid receipt actually reaches Build.
//
// Run:
//   node --experimental-strip-types --test plugin/test/execute-milestone-preparation-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildReceipt } from '../../experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLAUDE_WORKFLOW = path.join(REPO_ROOT, '.claude', 'workflows', 'execute-milestone.js');
const PLUGIN_WORKFLOW = path.join(REPO_ROOT, 'plugin', 'workflows', 'execute-milestone.js');
const MIRRORS = [['.claude/workflows/execute-milestone.js', CLAUDE_WORKFLOW], ['plugin/workflows/execute-milestone.js', PLUGIN_WORKFLOW]];

const FIXTURES = path.join(REPO_ROOT, 'experiments', 'quay-perpetual-stream', 'fixtures', 'preparation');
const TASK = path.join(FIXTURES, 'fixture-task.md');
const PLAN = path.join(FIXTURES, 'fixture-plan.md');

// ── Load the REAL, unmodified workflow source as a callable AsyncFunction ─────────────────────────
// Only the `export` keyword is stripped (an ES-module-only construct the workflow runtime never
// uses) — every other character of real production logic runs as-is.
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

// ── Parse + REALLY EXECUTE the Prepared phase's actual prompt text ────────────────────────────────
function parsePreparedPrompt(prompt) {
  const withSetup = prompt.match(/to (\S+):\n([\s\S]*?)\n\nThen run: (node[^\n]+)/);
  if (withSetup) return { setupPath: withSetup[1], setupLines: withSetup[2], cmd: withSetup[3] };
  const simple = prompt.match(/^Run: (node[^\n]+)/m);
  assert.ok(simple, `could not find a 'Run: node ...' command in the Prepared-phase prompt:\n${prompt}`);
  return { cmd: simple[1] };
}

function runRealPreparationCheck(prompt) {
  const parsed = parsePreparedPrompt(prompt);
  if (parsed.setupPath) fs.writeFileSync(parsed.setupPath, parsed.setupLines + '\n');
  let stdout, status;
  try {
    stdout = execSync(parsed.cmd, { cwd: REPO_ROOT, encoding: 'utf8' });
    status = 0;
  } catch (e) {
    stdout = e.stdout ? e.stdout.toString() : '';
    status = typeof e.status === 'number' ? e.status : 1;
  }
  const lines = stdout.trim().split('\n');
  const lastLine = lines[lines.length - 1] || '';
  const m = lastLine.match(/^(PASS|FAIL): ([\w-]+) — /);
  if (parsed.setupPath) fs.rmSync(parsed.setupPath, { force: true });
  return { ok: status === 0, code: m ? m[2] : 'no-code-parsed', detail: lastLine };
}

const BUILD_SHORT_CIRCUIT = { outcome: 'needs-human', reason: 'test-short-circuit-after-build', taskId: 'reached-build' };

function makeAgentMock() {
  return async function agentMock(prompt, opts = {}) {
    const label = opts.label;
    if (label && label.startsWith('emit-event-')) return { raw: null };
    if (VERIFY_LABELS.includes(label)) return verifyStub(label);
    if (label === 'preparation-check') return runRealPreparationCheck(prompt);
    if (opts.phase === 'Build') return BUILD_SHORT_CIRCUIT;
    throw new Error(`execute-milestone-preparation-gate.test.mjs: unexpected agent() call — label=${label} phase=${opts.phase}\nprompt: ${prompt.slice(0, 200)}`);
  };
}

async function runExecuteMilestone(workflowFile, argsObj) {
  const fn = loadWorkflow(workflowFile);
  const logs = [];
  return fn(
    argsObj,
    () => {}, // phase()
    (msg) => logs.push(msg), // log()
    (fns) => Promise.all(fns.map((f) => f())), // parallel()
    makeAgentMock(),
  );
}

// ── Fixture scratch area — DIR-117's taskId is used to build a literal `tasks/${taskId}.md` path
// in the real prompt; using `../<relative-path-under-fixtures>/task` lands it on a REAL scratch
// file under this test-fixtures zone instead of writing into the real tasks/ directory. ───────────
function freshScratchDir() {
  return fs.mkdtempSync(path.join(FIXTURES, 'exec-gate-scratch-'));
}

function scratchArgs(scratchDir, { receiptFile, declaredTouches }) {
  const scratchRel = path.relative(REPO_ROOT, scratchDir).split(path.sep).join('/');
  const taskId = `../${scratchRel}/task`; // "tasks/../<scratchRel>/task.md" == "<scratchRel>/task.md"
  const charterFile = `${scratchRel}/M999-charter.md`;
  return {
    taskId,
    charterFile,
    absorbEntryFile: '/dev/null',
    preparationReceiptFile: receiptFile,
    declaredTouches,
    _taskFileOnDisk: path.join(scratchDir, 'task.md'),
    _charterFileOnDisk: path.join(scratchDir, 'M999-charter.md'),
  };
}

function writeScratchTaskCharter(scratchDir, args, { mutateTask } = {}) {
  let taskText = fs.readFileSync(TASK, 'utf8');
  if (mutateTask) taskText = mutateTask(taskText);
  fs.writeFileSync(args._taskFileOnDisk, taskText);
  fs.writeFileSync(args._charterFileOnDisk, 'type: execution\n\nScratch charter for execute-milestone-preparation-gate.test.mjs.\n');
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

function buildValidReceipt(args) {
  return buildReceipt({
    taskId: 'TEST-PREPARED-GATE', milestoneId: 'M999',
    charterFile: args._charterFileOnDisk, taskFile: args._taskFileOnDisk, planFile: PLAN,
    review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 },
    provenance: distinctProvenance(),
  });
}

// ── The 5 with-receipt trigger conditions DIR-117's AC names, one per test, over BOTH real mirrors ──
for (const [mirrorName, workflowFile] of MIRRORS) {
  test(`[${mirrorName}] Prepared phase FAILs closed — a failed review (nonzero findings) returns before Build`, async () => {
    const scratchDir = freshScratchDir();
    try {
      const args = scratchArgs(scratchDir, { receiptFile: path.join(scratchDir, 'preparation.json') });
      writeScratchTaskCharter(scratchDir, args);
      const receipt = buildValidReceipt(args);
      receipt.review = { findings: 2 };
      fs.writeFileSync(args.preparationReceiptFile, JSON.stringify(receipt, null, 2));
      const result = await runExecuteMilestone(workflowFile, args);
      assert.equal(result.outcome, 'revision-needed');
      assert.equal(result.phase, 'Prepared');
      assert.equal(result.reason, 'review-nonzero-findings');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  test(`[${mirrorName}] Prepared phase FAILs closed — F_i > 0 (nonzero Plan-check findings) returns before Build`, async () => {
    const scratchDir = freshScratchDir();
    try {
      const args = scratchArgs(scratchDir, { receiptFile: path.join(scratchDir, 'preparation.json') });
      writeScratchTaskCharter(scratchDir, args);
      const receipt = buildValidReceipt(args);
      receipt.planCheck = { rounds: 3, findings: 1 };
      fs.writeFileSync(args.preparationReceiptFile, JSON.stringify(receipt, null, 2));
      const result = await runExecuteMilestone(workflowFile, args);
      assert.equal(result.outcome, 'revision-needed');
      assert.equal(result.phase, 'Prepared');
      assert.equal(result.reason, 'plancheck-nonzero-findings');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  test(`[${mirrorName}] Prepared phase FAILs closed — a stale hash (task Proposal changed post-preparation) returns before Build`, async () => {
    const scratchDir = freshScratchDir();
    try {
      const args = scratchArgs(scratchDir, { receiptFile: path.join(scratchDir, 'preparation.json') });
      writeScratchTaskCharter(scratchDir, args);
      const receipt = buildValidReceipt(args); // hashed against the CURRENT (pre-mutation) Proposal
      fs.writeFileSync(args.preparationReceiptFile, JSON.stringify(receipt, null, 2));
      // NOW mutate the Proposal AFTER the receipt was built — the exact staleness this closes.
      writeScratchTaskCharter(scratchDir, args, { mutateTask: (t) => t.replace('This is a substantive', 'MUTATED substantive') });
      const result = await runExecuteMilestone(workflowFile, args);
      assert.equal(result.outcome, 'revision-needed');
      assert.equal(result.phase, 'Prepared');
      assert.equal(result.reason, 'proposal-stale');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  test(`[${mirrorName}] Prepared phase FAILs closed — a missing Plan (task '## Plan' still N/A) returns before Build`, async () => {
    const scratchDir = freshScratchDir();
    try {
      const args = scratchArgs(scratchDir, { receiptFile: path.join(scratchDir, 'preparation.json') });
      writeScratchTaskCharter(scratchDir, args, { mutateTask: (t) => t.replace(/## Plan\n[\s\S]*?\n\n/, '## Plan\nN/A — directive resolved via a milestone\n\n') });
      const receipt = buildValidReceipt(args);
      fs.writeFileSync(args.preparationReceiptFile, JSON.stringify(receipt, null, 2));
      const result = await runExecuteMilestone(workflowFile, args);
      assert.equal(result.outcome, 'revision-needed');
      assert.equal(result.phase, 'Prepared');
      assert.equal(result.reason, 'plan-not-checked');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  test(`[${mirrorName}] Prepared phase FAILs closed — a Plan whose touch set exceeds the declaration (--declared-touches wired for real) returns before Build`, async () => {
    const scratchDir = freshScratchDir();
    try {
      const args = scratchArgs(scratchDir, {
        receiptFile: path.join(scratchDir, 'preparation.json'),
        declaredTouches: ['fixtures-fake/declared-a.ts'],
      });
      writeScratchTaskCharter(scratchDir, args);
      const receipt = buildValidReceipt(args);
      receipt.touches = ['fixtures-fake/declared-a.ts', 'fixtures-fake/undeclared-b.ts'];
      fs.writeFileSync(args.preparationReceiptFile, JSON.stringify(receipt, null, 2));
      const result = await runExecuteMilestone(workflowFile, args);
      assert.equal(result.outcome, 'revision-needed');
      assert.equal(result.phase, 'Prepared');
      assert.equal(result.reason, 'touches-expanded');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  test(`[${mirrorName}] Prepared phase PASSES on a real, fully-valid receipt and reaches Build (not just detected in isolation)`, async () => {
    const scratchDir = freshScratchDir();
    try {
      const args = scratchArgs(scratchDir, { receiptFile: path.join(scratchDir, 'preparation.json') });
      writeScratchTaskCharter(scratchDir, args);
      const receipt = buildValidReceipt(args);
      fs.writeFileSync(args.preparationReceiptFile, JSON.stringify(receipt, null, 2));
      const result = await runExecuteMilestone(workflowFile, args);
      // Reached Build (our mock's short-circuit sentinel) — Prepared did NOT block it.
      assert.equal(result.outcome, 'needs-human');
      assert.equal(result.reason, 'test-short-circuit-after-build');
      assert.notEqual(result.phase, 'Prepared');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  test(`[${mirrorName}] Prepared phase FAILS CLOSED (enforced default since DIR-117-B/M195) when preparationReceiptFile is omitted — revision-needed before Build, Build never dispatched`, async () => {
    // RED-then-GREEN honest flip of the former "SKIPPED (back-compat) — reaches Build" case: the
    // pre-DIR-117-B opt-in skip is retired. A MISSING receipt is now a caller-fixable shape error
    // that fails closed with a distinct `preparation-receipt-missing` reason BEFORE Build — so the
    // Build short-circuit sentinel must NOT appear (proving Build was never dispatched).
    const scratchDir = freshScratchDir();
    try {
      const args = scratchArgs(scratchDir, { receiptFile: undefined });
      writeScratchTaskCharter(scratchDir, args);
      const result = await runExecuteMilestone(workflowFile, args);
      assert.equal(result.outcome, 'revision-needed', JSON.stringify(result));
      assert.equal(result.reason, 'preparation-receipt-missing');
      assert.equal(result.phase, 'Prepared');
      assert.notEqual(result.reason, 'test-short-circuit-after-build', 'Build must NOT be reached when the receipt is omitted');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });
}
