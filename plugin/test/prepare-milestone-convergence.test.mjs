// prepare-milestone-convergence.test.mjs — DIR-125: real workflow-integration coverage for
// prepare-milestone.js's BOUNDED ProposalReview convergence loop (both `.claude`/`plugin` mirrors).
//
// PROBLEM this closes: DIR-120/M192 exposed prepare-milestone.js's ProposalReview phase as an
// UNBOUNDED loop — a nonzero review immediately returned `revision-needed`, the CALLER restarted
// the whole workflow, and two new Proposal authors + a new adjudicator rewrote the complete
// Proposal before every single review (10 consecutive full-regeneration rounds, ~3h15m active
// workflow time, ~1.13M output tokens, never reaching PlanAuthor). This file drives the REAL,
// unmodified workflow source (same technique as prepare-milestone-preparation-e2e.test.mjs: load
// it as a real AsyncFunction, drive it with a mock `agent()` that performs the SAME concrete
// actions a real LLM agent would) through every DIR-125 acceptance scenario, asserting on REAL
// dispatch counts — never prompt text alone.
//
// Run:
//   node --experimental-strip-types --test plugin/test/prepare-milestone-convergence.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPreparation } from '../../experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts';
import { sweepOrphans } from '../../experiments/quay-perpetual-stream/scripts/sweep-fixture-orphans.mjs';
import { checkpointPath, epochPath } from '../../experiments/quay-perpetual-stream/scripts/proposal-convergence.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIRRORS = [
  ['.claude/workflows/prepare-milestone.js', path.join(REPO_ROOT, '.claude', 'workflows', 'prepare-milestone.js')],
  ['plugin/workflows/prepare-milestone.js', path.join(REPO_ROOT, 'plugin', 'workflows', 'prepare-milestone.js')],
];
const FIXTURES = path.join(REPO_ROOT, 'experiments', 'quay-perpetual-stream', 'fixtures', 'preparation');
const REPLAY_FINDINGS = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'dir120-replay-findings.json'), 'utf8')).findings;

// gap-prepare-milestone-convergence-test-fixture-pollutes-tracked-tree: defense-in-depth against
// a PRIOR run of THIS test file being killed before its own per-test `finally { cleanup(...) }`
// ran (see cleanup() below) — sweeps only the `convergenceRandom` orphan shape (this file's own
// per-test milestoneId, `M${Math.floor(900000 + Math.random() * 90000)}`), never the
// `preparationE2eFixed` (M997) shape that belongs to a DIFFERENT test file's own cleanup
// responsibility. Runs once after every test in this file completes (top-level `after()`, since
// this file's `test(...)` calls are all at module top level, not nested in a `describe`). Cannot
// help if THIS run itself gets killed — only narrows the window before the NEXT run.
after(() => {
  sweepOrphans({ repoRoot: REPO_ROOT, shapes: ['convergenceRandom'] });
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function loadWorkflow(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/^export const meta/, 'const meta');
  return new AsyncFunction('args', 'phase', 'log', 'parallel', 'agent', src);
}

const THIN_TASK_TEMPLATE = `---
id: TEST-CONVERGENCE
title: fixture task for prepare-milestone.js convergence-loop test
status: todo
labels:
  - directive
extra:
  schema: v1
---
## Proposal

TBD.

## Plan

N/A — directive resolved via a milestone.

## Acceptance Criteria

- [ ] fixture AC item one

## Definition of Done

Standard experiments/quay-perpetual-stream/inherited-core.md DoD clauses apply.

- [ ] fixture DoD item
`;

const RECONCILED_PROPOSAL = `## Problem framing

A real, grounded problem this synthesized reconciled Proposal frames explicitly.

## Approach / chosen mechanism

A concrete, reviewable mechanism.

## Alternatives considered and rejected

- Alternative A: rejected.
`;

function splice(body, heading, replacement) {
  const re = new RegExp(`(^##\\s*${heading}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s|$)`, 'm');
  return body.replace(re, `$1\n${replacement}\n`);
}

// M197: extracts one '## <heading>' section's own content (trimmed) — used to assert the resumed
// path leaves '## Proposal' byte-identical while '## Plan' legitimately still changes (PlanAuthor
// always runs; only ProposalAuthors/Adjudicate are skipped under resume).
function extractSection(body, heading) {
  const re = new RegExp(`^##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'm');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

function planFileFromPrompt(prompt) {
  const m = prompt.match(/at (docs\/plans\/\S+\.md)\./);
  assert.ok(m, `could not find the Plan file path in the PlanAuthor prompt:\n${prompt}`);
  return m[1];
}

function ledgerFromPrompt(prompt) {
  const pathMatch = prompt.match(/Write the file (\S+) with EXACTLY this content/);
  assert.ok(pathMatch, `could not find the ledger file path in the Receipt prompt:\n${prompt}`);
  const jsonMatch = prompt.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(jsonMatch, `could not find the fenced ledger JSON in the Receipt prompt:\n${prompt}`);
  return { ledgerFile: pathMatch[1], ledgerJson: jsonMatch[1] };
}

// gap-decide-resume-generation-path-unsanitized-taskid (2026-07-31): the workflow's real command
// strings now carry `--no-warnings` before `--experimental-strip-types` (added this session to
// suppress Node's MODULE_TYPELESS_PACKAGE_JSON noise from poisoning agent-reported stdout) — match
// any run of `--flag` tokens between `node` and `--experimental-strip-types`, not a literal
// two-token prefix, so this stays correct if more flags are added later.
function extractNodeCommands(prompt) {
  return [...prompt.matchAll(/node(?: --\S+)* --experimental-strip-types [^\n]+/g)].map((m) => m[0]);
}

function runShell(cmd) {
  try {
    return { stdout: execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }), status: 0 };
  } catch (e) {
    return { stdout: e.stdout ? e.stdout.toString() : '', status: typeof e.status === 'number' ? e.status : 1 };
  }
}

// Extracts {subsystem: findingId} from a revise/delta-review prompt's "- [id] (subsystem) summary"
// list — lets a scripted mock decide which OPEN finding to resolve without needing to reimplement
// the workflow's own internal fingerprint hash.
function findingIdBySubsystem(prompt) {
  const map = {};
  for (const m of prompt.matchAll(/-\s*\[([0-9a-f]+)\]\s*\(([^)]+)\)/g)) map[m[2]] = m[1];
  return map;
}

function freshScratchDir() {
  return fs.mkdtempSync(path.join(FIXTURES, 'convergence-scratch-'));
}

// makeMock — the shared "outer phase" mock (authors/adjudicate/plan-author/plan-check/receipt),
// parameterized by `reviewHandlers` for the ProposalReview phase under test.
function makeMock(taskFileOnDisk, reviewHandlers) {
  const calls = { authors: [], adjudicator: 0, reviews: [], revises: [], wiringChecks: 0, planAuthor: 0, planCheckers: [], admissionAcquires: 0, admissionRenews: 0, admissionReleases: 0, preflightContent: 0, preflightPlan: 0, resumeDecisions: 0, releasePrompts: [], writeTelemetryPrompts: [], recordAttemptPrompts: [] };
  let planFile = null;
  let ledger = null;

  const agentMock = async (prompt, opts = {}) => {
    const label = opts.label || '';

    // M200/DIR-126-A: the new Admission phase's agent()-dispatched CLI calls. Mocked directly
    // (never touching real .quay/prepare-leases/ state) — this file's job is proving the
    // ProposalReview convergence loop's OWN wiring, not re-testing prepare-admission-check.ts
    // (that has its own dedicated experiments/quay-perpetual-stream/test/
    // prepare-admission-check.test.mjs). Every generation in this file always wins admission
    // unless a test stubs the verdict via reviewHandlers.onAcquire (M207: e.g. a nowMs-bearing
    // verdict to exercise _lastBoundaryMs seeding, or a prepare-already-running contention
    // verdict to exercise a pre-lease --record-attempt site).
    if (label === 'admission-acquire') {
      calls.admissionAcquires += 1;
      if (typeof reviewHandlers.onAcquire === 'function') return reviewHandlers.onAcquire(prompt);
      return { raw: JSON.stringify({ outcome: 'acquired', lease: { fencingToken: 0 }, reclaimed: false }) };
    }

    // gap-prepare-milestone-task-epoch-budget-reset: the epoch-status read (dispatched exactly
    // once, right after Admission succeeds and before resume-decision) and the epoch-dispatch write
    // (dispatched from EVERY terminal, via _releaseLeaseAndRecord/_writeGenerationTelemetry).
    // Mocked with a default fresh/non-breaching response so every EXISTING scenario in this file
    // (none of which cares about the epoch budget) passes unchanged — stubbable via
    // reviewHandlers.onEpochStatus/onEpochDispatch for the dedicated epoch-budget test block below.
    if (label === 'epoch-status') {
      calls.epochStatuses = (calls.epochStatuses || 0) + 1;
      if (typeof reviewHandlers.onEpochStatus === 'function') return reviewHandlers.onEpochStatus(prompt);
      return { raw: JSON.stringify({
        ok: true, code: 'no-epoch-record', exists: false,
        counters: { attempts: 0, fullReviews: 0, deltaRounds: 0, contentAgentDispatches: 0, observableAgentMs: 0, terminalFingerprints: {}, tokensObserved: null },
        policy: { ordinaryCapMinutes: 90, highRiskCapMinutes: 150, maxFullReviewsPerEpoch: 1, maxRepeatedFingerprint: 2 },
        overrides: [], resets: [], capCheck: { breached: false },
      }) };
    }
    if (/^epoch-dispatch-/.test(label)) {
      calls.epochDispatches = (calls.epochDispatches || 0) + 1;
      calls.epochDispatchPrompts = calls.epochDispatchPrompts || [];
      calls.epochDispatchPrompts.push(prompt);
      if (typeof reviewHandlers.onEpochDispatch === 'function') return reviewHandlers.onEpochDispatch(prompt, label);
      return { raw: JSON.stringify({ ok: true, epochId: 'mock-epoch', counters: {}, policy: {}, capCheck: { breached: false } }) };
    }
    if (/^admission-renew-/.test(label)) {
      calls.admissionRenews += 1;
      // M207: a test may stub the renewal verdict via reviewHandlers.onRenew(prompt, label) — e.g.
      // a nowMs-bearing {ok:true} verdict to exercise _recordPhaseBoundary span accumulation. The
      // DEFAULT {ok:true} response carries NO nowMs, so _recordPhaseBoundary's fail-soft rule
      // pushes nothing — every pre-M207 scenario in this file behaves exactly as before.
      if (typeof reviewHandlers.onRenew === 'function') return reviewHandlers.onRenew(prompt, label);
      return { raw: JSON.stringify({ ok: true }) };
    }
    if (/^admission-release-/.test(label)) {
      // M202/DIR-126-C: `_releaseLeaseAndRecord` dispatches proposal-convergence.ts
      // --record-generation under the SAME `admission-release-${stageLabel}` label
      // `_releaseLease` used (label continuity, Plan-level refinement) — this pre-existing branch
      // already covers every one of the 15 real terminal-return sites' new record-generation
      // dispatch, unchanged. The mock's {ok:true} response keeps being ignored (fire-and-forget,
      // exactly as today). M207: the dispatch prompt (now carrying --phaseTimings/--findingCodes)
      // is captured so fixtures can decode and assert the threaded flag payloads.
      calls.admissionReleases += 1;
      calls.releasePrompts.push(prompt);
      return { raw: JSON.stringify({ ok: true }) };
    }

    // M202/DIR-126-C: the new resume-decision dispatch (proposal-convergence.ts --decide-resume),
    // fired whenever $a.resumeFromAdjudicatedProposal is omitted (unconditionally — see
    // gap-prepare-milestone-workflow-dynamic-import/M203, which removed an unreachable local
    // existsSync-based pre-check). A test may stub the verdict via reviewHandlers.onResumeDecision;
    // the DEFAULT returns a cold/missing-prior-record verdict so any test that doesn't care about
    // this phase still behaves like today's cold path.
    if (label === 'resume-decision') {
      calls.resumeDecisions += 1;
      if (typeof reviewHandlers.onResumeDecision === 'function') return reviewHandlers.onResumeDecision(prompt);
      return { raw: JSON.stringify({ decision: 'cold', reason: 'missing-prior-record' }) };
    }

    // M206/M4: the new split-decision dispatch (proposal-convergence.ts --decide-split),
    // fired UNCONDITIONALLY after the resume-decision block closes. Defaults to no-decision-on-file
    // so every existing scenario that doesn't care about this phase still passes unchanged.
    if (label === 'split-decision') {
      calls.splitDecisions = (calls.splitDecisions || 0) + 1;
      if (typeof reviewHandlers.onSplitDecision === 'function') return reviewHandlers.onSplitDecision(prompt);
      return { raw: JSON.stringify({ ok: true, verdict: 'no-decision-on-file' }) };
    }

    // gap-prepare-milestone-cross-generation-review-state-reset: --resolve-checkpoint is dispatched
    // ONLY when resumeFromAdjudicatedProposal ends up true (a test exercising cross-generation delta
    // continuation stubs the verdict via reviewHandlers.onResolveCheckpoint); the DEFAULT reports no
    // usable checkpoint so every existing cold-path scenario in this file is unaffected. EVERY
    // ProposalReview terminal (including success) also dispatches --write-checkpoint via the
    // `write-review-checkpoint-*` label family — captured for assertions, mocked as a no-op success
    // by default (stubbable via reviewHandlers.onWriteCheckpoint).
    if (label === 'resolve-checkpoint') {
      calls.resolveCheckpoints = (calls.resolveCheckpoints || 0) + 1;
      if (typeof reviewHandlers.onResolveCheckpoint === 'function') return reviewHandlers.onResolveCheckpoint(prompt);
      return { raw: JSON.stringify({ usable: false, code: 'checkpoint-missing' }) };
    }
    if (/^write-review-checkpoint-/.test(label)) {
      calls.writeReviewCheckpoints = (calls.writeReviewCheckpoints || 0) + 1;
      calls.writeReviewCheckpointLabels = calls.writeReviewCheckpointLabels || [];
      calls.writeReviewCheckpointLabels.push(label);
      calls.writeReviewCheckpointPrompts = calls.writeReviewCheckpointPrompts || [];
      calls.writeReviewCheckpointPrompts.push(prompt);
      if (typeof reviewHandlers.onWriteCheckpoint === 'function') return reviewHandlers.onWriteCheckpoint(prompt, label);
      return { raw: JSON.stringify({ ok: true, checkpointFile: '.quay/prepare-checkpoints/mock.json', counters: { fullReviews: 1, deltaRounds: 0 } }) };
    }

    // M201/DIR-126-B: the new Preflight phase's agent()-dispatched CLI calls (content, then
    // plan-shape). Mocked with a default non-blocking verdict so every existing scenario in this
    // file that doesn't care about Preflight still passes unchanged — mirroring exactly how the
    // Admission mocks above are handled. Preflight's OWN detector logic has its own dedicated
    // experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs coverage.
    if (label === 'preflight-content') {
      calls.preflightContent = (calls.preflightContent || 0) + 1;
      if (typeof reviewHandlers.onPreflightContent === 'function') return reviewHandlers.onPreflightContent(prompt);
      return { raw: JSON.stringify({ ok: true, policyVersion: 'preflight-v1', findings: [] }) };
    }
    if (label === 'preflight-plan') {
      calls.preflightPlan = (calls.preflightPlan || 0) + 1;
      return { raw: JSON.stringify({ ok: true, policyVersion: 'preflight-v1', findings: [] }) };
    }

    if (/^proposal-author-\d+$/.test(label)) {
      const idx = Number(label.match(/\d+$/)[0]);
      calls.authors.push(idx);
      return { authorIdx: idx, proposalText: RECONCILED_PROPOSAL, sessionId: `sess-author-${idx}` };
    }
    if (label === 'adjudicate') {
      calls.adjudicator += 1;
      const body = fs.readFileSync(taskFileOnDisk, 'utf8');
      fs.writeFileSync(taskFileOnDisk, splice(body, 'Proposal', RECONCILED_PROPOSAL));
      return { proposalText: RECONCILED_PROPOSAL, ok: true, sessionId: 'sess-adjudicator' };
    }
    if (label === 'proposal-review') {
      calls.reviews.push('full');
      return reviewHandlers.onFullReview(prompt);
    }
    // gap-prepare-milestone-cross-generation-review-state-reset: the cross-generation delta
    // continuation's ONE-agent "verification only" round (first round of a generation whose
    // checkpoint classified the diff as wording-only/known-finding-repair) — distinct from the
    // ordinary per-round revise+delta-review PAIR below.
    if (label === 'proposal-crossgen-delta-review') {
      calls.reviews.push('crossgen-delta');
      calls.crossGenDeltaReviews = (calls.crossGenDeltaReviews || 0) + 1;
      return reviewHandlers.onCrossGenDeltaReview(prompt);
    }
    if (label === 'wiring-coverage-check') {
      // DIR-117-B/M195 (AC #4): the ProposalReview phase now calls the REAL checkWiringCoverage()
      // via its CLI. A test may stub the verdict via reviewHandlers.onWiringCheck; the DEFAULT runs
      // the real CLI on the actual task file under review (the generic convergence fixture's
      // RECONCILED_PROPOSAL has no wiring-verb+>=2-backtick claims, so this yields 0 findings and
      // leaves every pre-DIR-117-B assertion unchanged). The workflow script — not this mock —
      // merges the returned findings into the ledger via its own _upsertFindings path.
      calls.wiringChecks += 1;
      if (typeof reviewHandlers.onWiringCheck === 'function') return reviewHandlers.onWiringCheck(prompt);
      const res = runShell(`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts --task ${JSON.stringify(taskFileOnDisk)}`);
      if (res.status !== 0) return { ok: false, code: 'wiring-cli-failed', findings: [] };
      const verdict = JSON.parse(res.stdout);
      return { ok: verdict.ok, code: verdict.code, findings: verdict.findings };
    }
    const reviseMatch = label.match(/^proposal-revise-round-(\d+)$/);
    if (reviseMatch) {
      const round = Number(reviseMatch[1]);
      calls.revises.push(round);
      return reviewHandlers.onRevise(round, prompt);
    }
    const deltaMatch = label.match(/^proposal-delta-review-round-(\d+)$/);
    if (deltaMatch) {
      const round = Number(deltaMatch[1]);
      calls.reviews.push(`delta-${round}`);
      return reviewHandlers.onDeltaReview(round, prompt);
    }
    if (label === 'plan-author') {
      calls.planAuthor += 1;
      planFile = planFileFromPrompt(prompt);
      fs.mkdirSync(path.dirname(planFile), { recursive: true });
      fs.writeFileSync(planFile, `# Convergence fixture Plan\n\n### Stage 1: cover fixture AC item one\n- AC: 1\n- Files: ${path.relative(REPO_ROOT, taskFileOnDisk)}\n- Command: \`true\`\n`);
      const body = fs.readFileSync(taskFileOnDisk, 'utf8');
      fs.writeFileSync(taskFileOnDisk, splice(body, 'Plan', `Checked — see ${planFile}.`));
      return { planFile, ok: true, sessionId: 'sess-plan-author' };
    }
    if (/^plan-check-round-\d+$/.test(label)) {
      const round = Number(label.match(/\d+$/)[0]);
      calls.planCheckers.push(round);
      return { findings: 0, sessionId: `sess-plan-checker-${round}` };
    }
    // M203/DIR-126-D Claim A.4 — the Receipt phase's new write-first dispatch (--record-generation
    // --no-release), fired before the 'receipt' agent below. Writes a REAL file on disk (never a
    // pure in-memory fake) so the subsequent real `--build --telemetry <file>` shell dispatch below
    // can genuinely hash it — mirrors the ledger mock's own real-file-write pattern. Filed under
    // milestones/<milestoneId>/ (not the production milestones/prepare-telemetry/<taskId>/ path) so
    // this file's own existing per-test `cleanup(scratchDir, planFile, milestoneId)` convention
    // removes it automatically — the exact production path convention is proven separately by
    // proposal-convergence.test.mjs's real CLI-dispatch fixtures, this mock only needs a real,
    // hashable file at SOME path.
    if (label === 'write-telemetry-Receipt') {
      calls.writeTelemetry = (calls.writeTelemetry || 0) + 1;
      calls.writeTelemetryPrompts.push(prompt); // M207: capture for --phaseTimings/--findingCodes flag assertions
      const milestoneIdMatch = prompt.match(/--milestoneId (\S+)/);
      const milestoneId = milestoneIdMatch ? milestoneIdMatch[1] : 'UNKNOWN-MILESTONE';
      const telemetryFile = path.join('milestones', milestoneId, 'prepare-telemetry-mock.json');
      const abs = path.join(REPO_ROOT, telemetryFile);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, JSON.stringify({ schemaVersion: 2, recordId: 'mock', mock: true }, null, 2));
      return { raw: JSON.stringify({ ok: true, telemetryWriteOk: true, telemetryFile }) };
    }
    // M203/DIR-126-D Claim A.3 — the 3 pre-lease sites' new fire-and-forget dispatch. Never
    // exercised by THIS shared mock's own scenarios (admission-acquire above always succeeds), but
    // handled here defensively so any future scenario reusing makeMock() that DOES reach one of
    // these sites doesn't spuriously fail with "unexpected agent() call".
    if (/^record-attempt-/.test(label)) {
      calls.recordAttempts = (calls.recordAttempts || 0) + 1;
      calls.recordAttemptPrompts.push(prompt); // M207: capture for --phaseTimings/--findingCodes flag assertions
      return { raw: JSON.stringify({ ok: true, telemetryWriteOk: true, attemptId: 'mock-attempt' }) };
    }
    if (label === 'receipt') {
      const { ledgerFile, ledgerJson } = ledgerFromPrompt(prompt);
      fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
      fs.writeFileSync(ledgerFile, ledgerJson);
      ledger = JSON.parse(ledgerJson);
      // M206/X1: also write the mechanism-inventory file from the prompt content.
      const invMatch = prompt.match(/Write the file (\S+mechanism-inventory\.json) with EXACTLY this content[\s\S]*?```json\s*\n([\s\S]*?)\n```/);
      if (invMatch) {
        const invFile = invMatch[1];
        fs.mkdirSync(path.dirname(invFile), { recursive: true });
        fs.writeFileSync(invFile, invMatch[2]);
      }
      const cmds = extractNodeCommands(prompt);
      assert.equal(cmds.length, 2, `expected exactly 2 node commands in the Receipt prompt, got ${cmds.length}:\n${prompt}`);
      assert.match(cmds[0], /--telemetry \S+/, 'the --build dispatch must hash-bind the telemetry file written just above (Claim A.4/A.5)');
      assert.match(cmds[0], /--mechanism-inventory \S+/, 'the --build dispatch must hash-bind the mechanism-inventory file (M206/X1)');
      const build = runShell(cmds[0]);
      assert.equal(build.status, 0, `--build command failed:\n${build.stdout}`);
      const check = runShell(cmds[1]);
      const lastLine = check.stdout.trim().split('\n').pop() || '';
      return { ok: check.status === 0, receiptFile: cmds[1].match(/--receipt (\S+)/)?.[1], detail: lastLine };
    }
    throw new Error(`prepare-milestone-convergence.test.mjs: unexpected agent() call — label=${label}\nprompt: ${prompt.slice(0, 300)}`);
  };

  return { agentMock, calls, getPlanFile: () => planFile, getLedger: () => ledger };
}

async function runPrepareMilestone(workflowFile, argsObj, taskFileOnDisk, reviewHandlers) {
  const fn = loadWorkflow(workflowFile);
  const { agentMock, calls, getPlanFile, getLedger } = makeMock(taskFileOnDisk, reviewHandlers);
  const result = await fn(
    argsObj,
    () => {}, // phase()
    () => {}, // log()
    (fns) => Promise.all(fns.map((f) => f())), // parallel()
    agentMock,
  );
  return { result, calls, planFile: getPlanFile(), ledger: getLedger() };
}

function makeScratch() {
  const scratchDir = freshScratchDir();
  const scratchRel = path.relative(REPO_ROOT, scratchDir).split(path.sep).join('/');
  const taskFileOnDisk = path.join(scratchDir, 'task.md');
  const charterFileOnDisk = path.join(scratchDir, 'charter.md');
  fs.writeFileSync(taskFileOnDisk, THIN_TASK_TEMPLATE);
  fs.writeFileSync(charterFileOnDisk, 'type: execution\n\nScratch charter for prepare-milestone-convergence.test.mjs.\n');
  return { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk };
}

function baseArgs(scratchRel, extra = {}) {
  return {
    taskId: `../${scratchRel}/task`,
    milestoneId: `M${Math.floor(900000 + Math.random() * 90000)}`, // unique per test — avoid milestones/ collisions
    charterFile: `${scratchRel}/charter.md`,
    class: 'development',
    ...extra,
  };
}

// M202/DIR-126-C: `.quay/prepare-leases/${_taskId}.generation.json` is where a real
// `--decide-resume`/`--record-generation` dispatch reads/writes the generation record.
// gap-prepare-milestone-workflow-dynamic-import (M203/DIR-126-D): the workflow itself no longer
// gates the --decide-resume dispatch on this file's existence (that pre-check used an unreachable
// `import('node:fs')`, removed) — these helpers now only seed/clean up realistic on-disk state for
// tests, they do not control whether prepare-milestone.js dispatches --decide-resume (it always
// does, when the flag is omitted); the mocked `onResumeDecision` handler's returned verdict is
// what actually drives each test's scenario.
function generationRecordPathFor(taskId) {
  return path.join(REPO_ROOT, '.quay', 'prepare-leases', `${taskId}.generation.json`);
}
function writeGenerationRecord(taskId, record) {
  const p = generationRecordPathFor(taskId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(record));
  return p;
}
function removeGenerationRecord(taskId) {
  fs.rmSync(generationRecordPathFor(taskId), { force: true });
}

function cleanup(scratchDir, planFile, milestoneId) {
  fs.rmSync(scratchDir, { recursive: true, force: true });
  if (planFile) fs.rmSync(planFile, { force: true });
  if (milestoneId) fs.rmSync(path.join(REPO_ROOT, 'milestones', milestoneId), { recursive: true, force: true });
}

for (const [mirrorName, workflowFile] of MIRRORS) {
  // ── AC1: review sequence 2 blocking -> 1 blocking -> 0 reaches PlanAuthor; exactly 2 authors, 1
  // adjudicator, 2 focused revisions, 3 reviews — never a second full synthesis. ─────────────────
  test(`[${mirrorName}] bounded convergence: 2 blocking -> 1 blocking -> 0 reaches PlanAuthor with exactly 2 authors/1 adjudicator/2 revisions/3 reviews`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    let planFile = null;
    try {
      const { result, calls, planFile: pf, ledger } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({
          findings: [
            { subsystem: 's1', claimRef: 'AC#1', summary: 'blocker one', severity: 'blocker', blocking: true },
            { subsystem: 's2', claimRef: 'AC#2', summary: 'blocker two', severity: 'blocker', blocking: true },
          ],
          mechanismCount: 1, proposalHash: 'h0', sessionId: 'sess-reviewer-0',
        }),
        onRevise: (round) => ({ ok: true, proposalHash: `h-revise-${round}`, sessionId: `sess-revise-${round}` }),
        onDeltaReview: (round, prompt) => {
          const ids = findingIdBySubsystem(prompt);
          if (round === 1) return { resolvedIds: [ids.s1], findings: [{ subsystem: 's2', claimRef: 'AC#2', summary: 'blocker two', severity: 'blocker', blocking: true }], sessionId: 'sess-delta-1' };
          return { resolvedIds: [ids.s2], findings: [], sessionId: 'sess-delta-2' };
        },
      });
      planFile = pf;

      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.authors.length, 2, 'exactly 2 Proposal authors — never a second full synthesis');
      assert.equal(calls.adjudicator, 1, 'exactly 1 adjudicator dispatch');
      assert.equal(calls.revises.length, 2, 'exactly 2 focused revisions');
      assert.equal(calls.reviews.length, 3, 'exactly 3 reviews (1 full + 2 delta)');
      assert.equal(result.fullSynthesisCount, 1);
      assert.equal(result.deltaRounds, 2);

      // Ledger: both findings resolved, dispositions no longer "unresolved".
      assert.equal(ledger.length, 2);
      for (const f of ledger) {
        assert.equal(f.status, 'resolved');
        assert.equal(f.blocking, false);
        assert.notEqual(f.disposition, 'unresolved');
      }

      // Independent re-verification of the real receipt (not trusting the mock's self-report).
      const independentCheck = checkPreparation({ taskFile: taskFileOnDisk, charterFile: charterFileOnDisk, receiptFile: result.receiptFile });
      assert.equal(independentCheck.ok, true, independentCheck.message);
    } finally {
      cleanup(scratchDir, planFile, args.milestoneId);
    }
  });

  // ── AC2: persistent-blocker fixture stops after the ordinary cap (1 full + 2 delta), needs-human,
  // no fourth review/author/adjudicator dispatch. ──────────────────────────────────────────────
  test(`[${mirrorName}] bounded convergence: persistent blocker stops at the ordinary cap (1 full + 2 delta) — needs-human, no 4th dispatch`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({ findings: [{ subsystem: 's1', claimRef: 'AC#9', summary: 'persistent blocker', severity: 'blocker', blocking: true }], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
        onRevise: (round) => ({ ok: true, sessionId: `sess-revise-${round}` }),
        onDeltaReview: (round) => ({ resolvedIds: [], findings: [{ subsystem: 's1', claimRef: 'AC#9', summary: 'persistent blocker', severity: 'blocker', blocking: true }], sessionId: `sess-delta-${round}` }),
      });

      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'delta-cap-exhausted');
      assert.equal(calls.authors.length, 2, 'still only 2 authors — no second full synthesis');
      assert.equal(calls.adjudicator, 1);
      assert.equal(calls.revises.length, 2, 'ordinary cap: exactly 2 focused revisions, no 3rd');
      assert.equal(calls.reviews.length, 3, 'exactly 3 reviews (1 full + 2 delta) — no 4th review dispatched');
      assert.equal(calls.planAuthor, 0, 'PlanAuthor must never be reached');
      assert.ok(Array.isArray(result.ledger) && result.ledger.some((f) => f.blocking), 'unresolved ledger returned with the needs-human result');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // ── AC3: explicit highRisk permits exactly ONE additional delta round (3 total) and still has a
  // hard finite cap — a caller cannot request an unbounded/above-policy value. ─────────────────
  test(`[${mirrorName}] bounded convergence: highRisk permits exactly 1 extra delta round (3 total), reaching prepared`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { highRisk: true });
    let planFile = null;
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({ findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'blocker', severity: 'blocker', blocking: true }], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
        onRevise: (round) => ({ ok: true, sessionId: `sess-revise-${round}` }),
        onDeltaReview: (round, prompt) => {
          const ids = findingIdBySubsystem(prompt);
          if (round < 3) return { resolvedIds: [], findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'blocker', severity: 'blocker', blocking: true }], sessionId: `sess-delta-${round}` };
          return { resolvedIds: [ids.s1], findings: [], sessionId: `sess-delta-${round}` };
        },
      });
      planFile = result.planFile;

      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.revises.length, 3, 'highRisk permits exactly 3 delta rounds (1 more than ordinary)');
      assert.equal(calls.reviews.length, 4, '1 full + 3 delta reviews');
      assert.equal(result.deltaRounds, 3);
    } finally {
      cleanup(scratchDir, planFile, args.milestoneId);
    }
  });

  test(`[${mirrorName}] bounded convergence: a caller-requested maxDeltaRounds ABOVE the highRisk policy ceiling (3) is clamped, never honored`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { highRisk: true, maxDeltaRounds: 10 });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({ findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'persistent', severity: 'blocker', blocking: true }], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
        onRevise: (round) => ({ ok: true, sessionId: `sess-revise-${round}` }),
        onDeltaReview: (round) => ({ resolvedIds: [], findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'persistent', severity: 'blocker', blocking: true }], sessionId: `sess-delta-${round}` }),
      });
      assert.equal(result.outcome, 'needs-human');
      assert.equal(calls.revises.length, 3, 'a requested cap ABOVE the policy ceiling is clamped down to the ceiling (3), never honored as 10');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  test(`[${mirrorName}] bounded convergence: a caller-requested maxDeltaRounds BELOW the ordinary default (1) is honored (callers may LOWER, not raise)`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { maxDeltaRounds: 1 });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({ findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'persistent', severity: 'blocker', blocking: true }], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
        onRevise: (round) => ({ ok: true, sessionId: `sess-revise-${round}` }),
        onDeltaReview: (round) => ({ resolvedIds: [], findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'persistent', severity: 'blocker', blocking: true }], sessionId: `sess-delta-${round}` }),
      });
      assert.equal(result.outcome, 'needs-human');
      assert.equal(calls.revises.length, 1, 'a caller-lowered cap (1) is honored, not silently ignored');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // ── AC4: mixed fixture — 1 blocker + plan/backlog/accepted-risk findings — blocks only until the
  // blocker is resolved, then reaches PlanAuthor retaining every non-blocking disposition. ──────
  test(`[${mirrorName}] bounded convergence: mixed blocker + plan/backlog/accepted-risk findings blocks only on the blocker, retains all dispositions`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    let planFile = null;
    try {
      const { result, calls, ledger } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({
          findings: [
            { subsystem: 's1', claimRef: 'AC#1', summary: 'the blocker', severity: 'blocker', blocking: true },
            { subsystem: 's2', claimRef: 'AC#2', summary: 'plan item', severity: 'minor', blocking: false, disposition: 'plan' },
            { subsystem: 's3', claimRef: 'AC#3', summary: 'backlog item', severity: 'nit', blocking: false, disposition: 'backlog' },
            { subsystem: 's4', claimRef: 'AC#4', summary: 'accepted risk item', severity: 'minor', blocking: false, disposition: 'accepted-risk' },
          ],
          mechanismCount: 1, sessionId: 'sess-reviewer-0',
        }),
        onRevise: (round) => ({ ok: true, sessionId: `sess-revise-${round}` }),
        onDeltaReview: (round, prompt) => {
          const ids = findingIdBySubsystem(prompt);
          return { resolvedIds: [ids.s1], findings: [], sessionId: `sess-delta-${round}` };
        },
      });
      planFile = result.planFile;

      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.revises.length, 1, 'blocks only until the ONE blocker is resolved');
      assert.equal(ledger.length, 4, 'all 4 findings retained in the ledger');
      const bySubsystem = Object.fromEntries(ledger.map((f) => [f.subsystem, f]));
      assert.equal(bySubsystem.s1.status, 'resolved');
      assert.equal(bySubsystem.s2.disposition, 'plan');
      assert.equal(bySubsystem.s3.disposition, 'backlog');
      assert.equal(bySubsystem.s4.disposition, 'accepted-risk');
    } finally {
      cleanup(scratchDir, planFile, args.milestoneId);
    }
  });

  // ── AC5: split-cluster fixture (>=3 independent blocking findings in one subsystem) returns an
  // explicit split recommendation/needs-human BEFORE PlanAuthor, no automatic revision dispatch. ──
  test(`[${mirrorName}] bounded convergence: 3 independent blocking findings in one subsystem trigger an explicit split recommendation, no revise dispatched`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({
          findings: [
            { subsystem: 'gate-engine', claimRef: 'AC#1', summary: 'a', severity: 'blocker', blocking: true },
            { subsystem: 'gate-engine', claimRef: 'AC#2', summary: 'b', severity: 'blocker', blocking: true },
            { subsystem: 'gate-engine', claimRef: 'AC#3', summary: 'c', severity: 'blocker', blocking: true },
          ],
          mechanismCount: 1, sessionId: 'sess-reviewer-0',
        }),
        onRevise: () => { throw new Error('MUST NOT be dispatched: split must short-circuit before any focused revision'); },
        onDeltaReview: () => { throw new Error('MUST NOT be dispatched: split must short-circuit before any delta review'); },
      });

      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'split-recommended');
      assert.equal(result.splitRecommendation.code, 'split-subsystem-blocking-cluster');
      assert.equal(calls.revises.length, 0, 'no focused revision was ever dispatched');
      assert.equal(calls.reviews.length, 1, 'only the single full review was dispatched');
      assert.equal(calls.planAuthor, 0, 'no task/Plan mutation beyond the pre-existing Adjudicate write-back');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // ── AC6: soft-budget with a deterministic injected clock — budget expiry prevents admission of
  // the next phase (no revise ever dispatched), never kills an in-flight one, records elapsed time. ─
  test(`[${mirrorName}] bounded convergence: soft budget (deterministic injected clock) prevents admitting the next round, records elapsed time`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    let clockCalls = 0;
    const clock = () => {
      clockCalls += 1;
      return clockCalls === 1 ? 0 : 50 * 60 * 1000; // 50 minutes elapsed — over the 45m ordinary budget
    };
    const args = baseArgs(scratchRel, { now: clock });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({ findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'blocker', severity: 'blocker', blocking: true }], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
        onRevise: () => { throw new Error('MUST NOT be dispatched: the budget check happens BEFORE admitting the next phase'); },
        onDeltaReview: () => { throw new Error('MUST NOT be dispatched: the budget check happens BEFORE admitting the next phase'); },
      });

      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'soft-budget-exceeded');
      assert.equal(calls.revises.length, 0, 'no in-flight phase was ever started, let alone killed — the budget gates ADMISSION only');
      assert.equal(result.elapsedMs, 50 * 60 * 1000, 'elapsed time is recorded on the terminal result');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // ── AC9: a replay fixture derived from the real DIR-120 rounds — scope split, production
  // behavior/AC gap, stale acceptance wiring, touch/test gap, operator pointer, accepted
  // non-exercise — receives typed dispositions via ONE full synthesis + ONE delta round, never ten. ─
  test(`[${mirrorName}] DIR-120-shaped replay: 6 high-value finding classes get typed dispositions via 1 full synthesis + 1 delta round (not 10)`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    let planFile = null;
    try {
      const { result, calls, ledger } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({ findings: REPLAY_FINDINGS, mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
        onRevise: (round) => ({ ok: true, sessionId: `sess-revise-${round}` }),
        onDeltaReview: (round, prompt) => {
          const ids = findingIdBySubsystem(prompt);
          return { resolvedIds: [ids['production-behavior'], ids['acceptance-wiring']], findings: [], sessionId: `sess-delta-${round}` };
        },
      });
      planFile = result.planFile;

      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.authors.length, 2, 'exactly ONE generation of authors — never 10');
      assert.equal(calls.revises.length, 1, 'exactly ONE delta round resolves both real blockers');
      assert.equal(ledger.length, 6, 'all 6 real finding classes retained in the ledger');
      const bySubsystem = Object.fromEntries(ledger.map((f) => [f.subsystem, f]));
      assert.equal(bySubsystem.scope.disposition, 'split');
      assert.equal(bySubsystem['production-behavior'].status, 'resolved');
      assert.equal(bySubsystem['acceptance-wiring'].status, 'resolved');
      assert.equal(bySubsystem['test-coverage'].disposition, 'plan');
      assert.equal(bySubsystem.docs.disposition, 'backlog');
      assert.equal(bySubsystem.risk.disposition, 'accepted-risk');
    } finally {
      cleanup(scratchDir, planFile, args.milestoneId);
    }
  });

  // ── AC#4 (DIR-117-B/M195): the ProposalReview phase calls wiring-coverage-check.ts's REAL
  // checkWiringCoverage() and the phase's own open-blocking finding count increments by the
  // function's real return value — NOT an LLM's independent judgment. The full LLM review reports
  // ZERO findings here, so every blocking finding in the returned ledger can only have come from the
  // mechanical wiring-coverage-check dispatch (the real CLI run on a fixture Proposal carrying 2
  // uncovered mechanism claims). With maxDeltaRounds:0 the phase returns needs-human
  // (delta-cap-exhausted) with a ledger whose wiring-finding count EQUALS the function's return. ────
  test(`[${mirrorName}] DIR-117-B/M195 AC#4: ProposalReview finding count increments from checkWiringCoverage()'s real return value (not LLM judgment)`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { maxDeltaRounds: 0 });
    const wiringFixture = path.join(FIXTURES, 'wiring-uncovered-claim-task.md');
    const runWiringCli = () => {
      const res = runShell(`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts --task ${JSON.stringify(wiringFixture)}`);
      assert.equal(res.status, 0, `wiring CLI failed:\n${res.stdout}`);
      return JSON.parse(res.stdout);
    };
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        // LLM full review reports ZERO findings — any blocking finding below is the function's.
        onFullReview: () => ({ findings: [], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
        // Run the REAL checkWiringCoverage() CLI on the wiring fixture (uncovered claims).
        onWiringCheck: () => {
          const verdict = runWiringCli();
          return { ok: verdict.ok, code: verdict.code, findings: verdict.findings };
        },
      });

      assert.equal(calls.wiringChecks, 1, 'exactly one wiring-coverage-check dispatch in ProposalReview');
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'delta-cap-exhausted');

      // The function's real return value is the source of truth for the expected increment.
      const expectedN = runWiringCli().findings.length;
      assert.ok(expectedN >= 1, 'fixture must yield >=1 blocking wiring finding from the real function');

      // The phase's ledger open-blocking count incremented by EXACTLY the function's return value,
      // and the LLM review added nothing — every finding is the function's, BLOCKING/blocker.
      const wiringFindings = result.ledger.filter((f) => f.subsystem === 'wiring-coverage');
      assert.equal(wiringFindings.length, expectedN, 'ledger wiring-finding count === checkWiringCoverage() return value');
      assert.equal(result.ledger.length, expectedN, 'LLM review added nothing — all findings are the function\'s');
      for (const f of wiringFindings) {
        assert.equal(f.blocking, true);
        assert.equal(f.severity, 'blocker');
        assert.equal(f.disposition, 'unresolved');
        assert.equal(f.status, 'open');
      }
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // ── M197 (gap-prepare-milestone-cross-generation-no-incremental-reuse) ──────────────────────
  // RED/GREEN fixture for the resumeFromAdjudicatedProposal cross-generation resume path.
  //
  // RED (documents today's/prior behavior, unchanged by this milestone): a cold dispatch — the
  // flag omitted — against a task whose Proposal already has zero wiring-coverage findings STILL
  // re-derives the Proposal from scratch via ProposalAuthors + Adjudicate. Wasteful, but not wrong;
  // this is the exact behavior the task's Finding section describes as the root cause of the
  // DIR-119-D/M196 recurrence (a manually-fixed Proposal being silently discarded and re-derived).
  test(`[${mirrorName}] M197 RED: cold dispatch (resumeFromAdjudicatedProposal omitted) always re-derives — full N-author + adjudicator dispatch, fullSynthesisCount=1`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel); // no resumeFromAdjudicatedProposal — cold path
    let planFile = null;
    const proposalBefore = fs.readFileSync(taskFileOnDisk, 'utf8');
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({ findings: [], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
      });
      planFile = result.planFile;

      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.authors.length, 2, 'RED: cold dispatch still runs the full N-author synthesis');
      assert.equal(calls.adjudicator, 1, 'RED: cold dispatch still runs Adjudicate');
      assert.equal(result.fullSynthesisCount, 1, 'cold dispatch records fullSynthesisCount=1');
      assert.equal(result.resumed, false);
      // The Adjudicate mock DOES overwrite the Proposal on the cold path — confirming this IS the
      // re-derivation the resume path exists to avoid.
      const proposalAfter = fs.readFileSync(taskFileOnDisk, 'utf8');
      assert.notEqual(proposalAfter, proposalBefore, 'RED: cold dispatch overwrites the on-disk Proposal (the defect this milestone adds an opt-out for)');
    } finally {
      cleanup(scratchDir, planFile, args.milestoneId);
    }
  });

  // GREEN (new behavior): the SAME task, dispatched with resumeFromAdjudicatedProposal:true, skips
  // ProposalAuthors/Adjudicate entirely (zero dispatches of either), reaches ProposalReview using
  // the task's CURRENT on-disk Proposal untouched, and records fullSynthesisCount=0.
  test(`[${mirrorName}] M197 GREEN: resumeFromAdjudicatedProposal:true skips ProposalAuthors/Adjudicate, reaches prepared with fullSynthesisCount=0, Proposal left byte-identical`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { resumeFromAdjudicatedProposal: true });
    let planFile = null;
    const proposalBefore = fs.readFileSync(taskFileOnDisk, 'utf8');
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        // Zero-finding review — models a Proposal already adjudicated/manually-fixed in a prior
        // generation (e.g. DIR-119-D/M196's manually repaired wiring-coverage-complete Proposal).
        onFullReview: () => ({ findings: [], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
      });
      planFile = result.planFile;

      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.authors.length, 0, 'GREEN: zero ProposalAuthors dispatches under resume');
      assert.equal(calls.adjudicator, 0, 'GREEN: zero Adjudicate dispatches under resume');
      assert.equal(calls.reviews.filter((r) => r === 'full').length, 1, 'ProposalReview itself still runs exactly once');
      assert.equal(result.fullSynthesisCount, 0, 'resumed dispatch records fullSynthesisCount=0');
      assert.equal(result.resumed, true);

      // The task's on-disk '## Proposal' section was never touched by this dispatch (no Adjudicate
      // task_write occurred) — byte-identical to what was on disk before the run. (The '## Plan'
      // section DOES legitimately change — PlanAuthor still runs under resume; only ProposalAuthors/
      // Adjudicate are skipped, so we compare the Proposal section specifically, not the whole body.)
      const proposalAfter = fs.readFileSync(taskFileOnDisk, 'utf8');
      assert.equal(extractSection(proposalAfter, 'Proposal'), extractSection(proposalBefore, 'Proposal'), 'GREEN: resumed dispatch never re-derives/overwrites the pre-existing Proposal');

      // Independent re-verification of the real receipt, including the mechanical
      // fullSynthesisCount<=1 re-check (validateConvergenceCounters) — 0 passes just like 1 does.
      const independentCheck = checkPreparation({ taskFile: taskFileOnDisk, charterFile: charterFileOnDisk, receiptFile: result.receiptFile });
      assert.equal(independentCheck.ok, true, independentCheck.message);
    } finally {
      cleanup(scratchDir, planFile, args.milestoneId);
    }
  });

  // M200/DIR-126-A audit finding (renewal-at-every-phase-boundary AC item): the admissionRenews
  // counter was already collected by this file's own mock but never asserted against an expected
  // count anywhere — a static-wiring-only claim, not a proven one. For a resumed (0 findings, 0
  // delta rounds) generation, WIRING-CLAIM 3's real call sites are ProposalReview-entry (line 190)
  // + PlanAuthor-entry (line 421) + PlanCheck-round-1 (line 467) + Receipt-entry (line 503) = 4 —
  // Adjudicate-entry's renewal (line 155) is correctly skipped under resume, since Adjudicate
  // itself is skipped.
  test(`[${mirrorName}] M200/DIR-126-A: renewal fires at every real phase boundary taken, not a static-only claim (resumed, 0 delta rounds -> 4 renewals)`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { resumeFromAdjudicatedProposal: true });
    let planFile = null;
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({ findings: [], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
      });
      planFile = result.planFile;
      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.admissionAcquires, 1, 'admission acquired exactly once');
      assert.equal(
        calls.admissionRenews,
        4,
        'ProposalReview-entry + PlanAuthor-entry + PlanCheck-round-1 + Receipt-entry (Adjudicate-entry correctly skipped under resume)'
      );
      assert.equal(calls.admissionReleases, 1, 'released exactly once on the successful terminal return');
    } finally {
      cleanup(scratchDir, planFile, args.milestoneId);
    }
  });

  // M200/DIR-126-A audit finding (AC2, admission-error fail-closed): the branch exists in the real
  // source (confirmed via source read), but no test previously drove prepare-milestone.js itself
  // into it. Malformed/unparseable admission-acquire output must fail closed to
  // {outcome:'needs-human', reason:'admission-check-failed'} BEFORE any ProposalAuthors dispatch —
  // never silently falling through as if admission had succeeded.
  test(`[${mirrorName}] M200/DIR-126-A: Admission-phase error (malformed CLI output) fails closed to admission-check-failed, zero ProposalAuthors dispatches`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    const fn = loadWorkflow(workflowFile);
    const calls = { authors: [], recordAttempts: 0 };
    const agentMock = async (prompt, opts = {}) => {
      const label = opts.label || '';
      if (label === 'admission-acquire') return { raw: 'not valid json {{{' };
      // M203/DIR-126-D Claim A.3 — the new fire-and-forget --record-attempt dispatch this exact
      // site (admission-check-failed) now makes, additive and never inspected/branched on by the
      // caller.
      if (label === 'record-attempt-admission-check-failed') {
        calls.recordAttempts += 1;
        return { raw: JSON.stringify({ ok: true, telemetryWriteOk: true, attemptId: 'mock-attempt' }) };
      }
      if (/^proposal-author-\d+$/.test(label)) {
        calls.authors.push(label);
        return { authorIdx: 1, proposalText: 'unreachable', sessionId: 'sess' };
      }
      throw new Error(`unexpected agent() call with label ${JSON.stringify(label)} after a failed Admission phase`);
    };
    try {
      const result = await fn(args, () => {}, () => {}, (fns) => Promise.all(fns.map((f) => f())), agentMock);
      assert.equal(result.outcome, 'needs-human');
      assert.equal(result.reason, 'admission-check-failed');
      assert.equal(result.phase, 'Admission');
      assert.equal(calls.authors.length, 0, 'zero ProposalAuthors dispatches after a failed Admission phase');
      assert.equal(calls.recordAttempts, 1, 'AC17: exactly one --record-attempt dispatch at this pre-lease site');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  // M202/DIR-126-C real-world finding: the FIRST genuine Workflow-dispatched exercise of the
  // Preflight phase (not a mocked-agent test) hit a real bug — an agent() dispatch instructed to
  // "report stdout verbatim" nonetheless included a Node MODULE_TYPELESS_PACKAGE_JSON stderr
  // warning line prepended before the real JSON, and the pre-fix bare `JSON.parse(result.raw)`
  // threw, wrongly failing the phase closed even though the underlying CLI call had succeeded.
  // Fixed with `_parseAgentJson()`, which extracts the first top-level JSON span rather than
  // assuming the whole string is JSON. Confirmed here for BOTH the Admission and Preflight
  // call sites sharing this exposure.
  test(`[${mirrorName}] M202/DIR-126-C: a noisy agent raw (stderr warning prepended to real JSON) still parses correctly at Admission and Preflight, never fails closed on a call that actually succeeded`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    const fn = loadWorkflow(workflowFile);
    const noisyPrefix = '(node:12345) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///fake/path.ts is not specified and it doesn\'t parse as CommonJS.\nReparsing as ES module because module syntax was detected.\n';
    const calls = { authors: [], preflightContent: 0 };
    const agentMock = async (prompt, opts = {}) => {
      const label = opts.label || '';
      if (label === 'admission-acquire') {
        return { raw: noisyPrefix + JSON.stringify({ outcome: 'acquired', lease: { fencingToken: 0 }, reclaimed: false }) };
      }
      if (label === 'resume-decision') {
        // M203/DIR-126-D: --decide-resume is now dispatched unconditionally when the flag is
        // omitted (no more unreachable existsSync pre-check) — a cold verdict here keeps this
        // test's own scope (Admission/Preflight noisy-JSON parsing) unaffected.
        return { raw: noisyPrefix + JSON.stringify({ decision: 'cold', reason: 'missing-prior-record' }) };
      }
      if (label === 'split-decision') {
        return { raw: JSON.stringify({ ok: true, verdict: 'no-decision-on-file' }) };
      }
      // gap-prepare-milestone-task-epoch-budget-reset: the epoch-status read happens right after
      // Admission succeeds, BEFORE resume-decision — also exercises the same noisy-stderr-prefix
      // tolerance this test is named for.
      if (label === 'epoch-status') {
        return { raw: noisyPrefix + JSON.stringify({
          ok: true, code: 'no-epoch-record', exists: false,
          counters: { attempts: 0, fullReviews: 0, deltaRounds: 0, contentAgentDispatches: 0, observableAgentMs: 0, terminalFingerprints: {}, tokensObserved: null },
          policy: { ordinaryCapMinutes: 90, highRiskCapMinutes: 150, maxFullReviewsPerEpoch: 1, maxRepeatedFingerprint: 2 },
          overrides: [], resets: [], capCheck: { breached: false },
        }) };
      }
      if (label === 'preflight-content') {
        calls.preflightContent += 1;
        return { raw: noisyPrefix + JSON.stringify({ ok: true, policyVersion: 'preflight-v1', findings: [] }) };
      }
      if (/^proposal-author-\d+$/.test(label)) {
        const idx = Number(label.match(/\d+$/)[0]);
        calls.authors.push(idx);
        return { authorIdx: idx, proposalText: 'unreachable — this test stops right after this point', sessionId: `sess-author-${idx}` };
      }
      // Reaching here (e.g. 'adjudicate') already PROVES Admission and Preflight both parsed
      // successfully and ProposalAuthors ran — this test's own scope stops at that checkpoint,
      // deliberately not mocking the full pipeline.
      throw new Error(`__TEST_CHECKPOINT_REACHED__ label=${JSON.stringify(label)}`);
    };
    try {
      let result;
      try {
        result = await fn(args, () => {}, () => {}, (fns) => Promise.all(fns.map((f) => f())), agentMock);
      } catch (err) {
        if (!/__TEST_CHECKPOINT_REACHED__/.test(err.message)) throw err;
        result = null;
      }
      if (result) {
        assert.notEqual(result.reason, 'admission-check-failed');
        assert.notEqual(result.reason, 'preflight-check-failed');
      }
      assert.equal(calls.preflightContent, 1, 'preflight-content was actually dispatched and parsed, not short-circuited by a parse failure');
      assert.ok(calls.authors.length > 0, 'ProposalAuthors ran — Admission/Preflight were correctly parsed as successful, not fail-closed');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  // A resumed dispatch that STILL has open blocking findings behaves exactly like the cold path's
  // ProposalReview loop (delta rounds, split, budget) — resume only ever affects the ProposalAuthors/
  // Adjudicate phases, never weakens or bypasses DIR-125's own bounded-convergence loop.
  test(`[${mirrorName}] M197: resumeFromAdjudicatedProposal:true with open blocking findings still runs the ordinary bounded delta-review loop (no bypass)`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { resumeFromAdjudicatedProposal: true });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({ findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'persistent blocker', severity: 'blocker', blocking: true }], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
        onRevise: (round) => ({ ok: true, sessionId: `sess-revise-${round}` }),
        onDeltaReview: (round) => ({ resolvedIds: [], findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'persistent blocker', severity: 'blocker', blocking: true }], sessionId: `sess-delta-${round}` }),
      });

      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'delta-cap-exhausted');
      assert.equal(calls.authors.length, 0, 'resume still skips ProposalAuthors even when the loop later needs-humans');
      assert.equal(calls.adjudicator, 0, 'resume still skips Adjudicate even when the loop later needs-humans');
      assert.equal(calls.revises.length, 2, 'the ordinary delta-round cap (2) is unaffected by resume');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ── gap-prepare-milestone-cross-generation-review-state-reset: cross-generation ProposalReview
  // checkpoint. DIR-125 bounds convergence WITHIN one generation; DIR-126-C's resume above only
  // skips ProposalAuthors/Adjudicate — ProposalReview itself always restarted from an empty ledger.
  // This closes that gap: a validated checkpoint (proposal-convergence.ts's --resolve-checkpoint/
  // --write-checkpoint) lets ProposalReview skip its full-review agent and dispatch exactly ONE
  // delta reviewer instead, for wording-only/known-finding-repair diffs only. ──────────────────
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  test(`[${mirrorName}] cross-gen checkpoint AC#3: a focused edit resolving one known finding carries the prior ledger forward and dispatches exactly ONE delta reviewer — zero full reviewers, zero authors/adjudicators`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { resumeFromAdjudicatedProposal: true });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onResolveCheckpoint: () => ({
          raw: JSON.stringify({
            usable: true, code: 'checkpoint-valid', classification: 'known-finding-repair', classificationCode: 'diff-scoped-to-known-finding',
            noveltyScan: { hasNovelClaim: false, novelClaims: [] },
            ledger: [{ id: 'f-known-1', subsystem: 's1', summary: 'known finding to repair', severity: 'blocker', blocking: true, everBlocking: true, disposition: 'unresolved', evidence: '', claimRef: 'AC#1', rootCauseKey: null, repairable: true, status: 'open', firstSeenRound: 0, lastSeenRound: 0 }],
            counters: { fullReviews: 1, deltaRounds: 0 },
            mechanismInventoryHash: 'mi-carried', mechanismInventoryCount: 1,
            lastFullReviewSession: { sessionId: 'sess-original-full-review', timestamp: 1000 },
          }),
        }),
        onCrossGenDeltaReview: () => ({ resolvedIds: ['f-known-1'], findings: [], proposalHash: 'h-crossgen-1', nowMs: 2000, sessionId: 'sess-crossgen-delta-1' }),
      });

      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.authors.length, 0, 'zero Proposal authors — resume already skips them');
      assert.equal(calls.adjudicator, 0, 'zero adjudicator dispatches');
      assert.equal(calls.reviews.filter((r) => r === 'full').length, 0, 'zero full ProposalReview reviewers dispatched');
      assert.equal(calls.crossGenDeltaReviews, 1, 'exactly ONE cross-generation delta reviewer dispatched');
      assert.equal(calls.revises.length, 0, 'zero reviser dispatches — the cross-gen round is verification-only, the Proposal was already edited outside this loop');
      assert.equal(calls.resolveCheckpoints, 1, 'checkpoint resolution attempted exactly once');
      assert.ok(calls.writeReviewCheckpoints >= 1, 'checkpoint written at the terminal');
      assert.equal(result.ledger.find((f) => f.id === 'f-known-1').status, 'resolved', 'the carried finding is resolved, not silently dropped');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // Round 2 (post-REFUTATION): an independent review found a real exploit — classifyProposalDiff's
  // claim identity is keyed only on the sorted set of backtick identifiers, so a Proposal edit that
  // WEAKENS or fully REMOVES an existing safety-relevant claim (same identifiers, changed/deleted
  // semantics) can still classify wording-only/known-finding-repair. When the carried ledger was
  // already clean, the OLD behavior reached 'prepared' with ZERO review agents ever reading the
  // diff. Fixed structurally: cross-gen delta continuation now ALWAYS dispatches exactly one real
  // delta reviewer, even with a clean carried ledger — this test asserts the NEW correct behavior
  // (was previously asserting the now-refuted "zero review agents" behavior; do not revert).
  test(`[${mirrorName}] cross-gen checkpoint AC#4 (post-REFUTATION fix): a wording-only edit whose carried ledger is already clean STILL dispatches exactly ONE real delta reviewer — never zero`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { resumeFromAdjudicatedProposal: true });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onResolveCheckpoint: () => ({
          raw: JSON.stringify({
            usable: true, code: 'checkpoint-valid', classification: 'wording-only', classificationCode: 'no-new-claims-paths-or-mechanism-removal-detected',
            noveltyScan: { hasNovelClaim: false, novelClaims: [] },
            ledger: [{ id: 'f-stable-1', subsystem: 's1', summary: 'already resolved', severity: 'blocker', blocking: false, everBlocking: true, disposition: 'backlog', evidence: '', claimRef: 'AC#1', rootCauseKey: null, repairable: true, status: 'resolved', firstSeenRound: 0, lastSeenRound: 1 }],
            counters: { fullReviews: 1, deltaRounds: 1 },
            mechanismInventoryHash: 'mi-carried', mechanismInventoryCount: 1,
            lastFullReviewSession: { sessionId: 'sess-original-full-review', timestamp: 1000 },
            reviewedProposalText: 'The gate engine enforces fail-closed behavior.',
          }),
        }),
        onCrossGenDeltaReview: () => ({ resolvedIds: [], findings: [], proposalHash: 'h-crossgen-ac4', nowMs: 2000, sessionId: 'sess-crossgen-ac4' }),
      });

      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.crossGenDeltaReviews, 1, 'exactly ONE real cross-gen delta reviewer dispatched, even though the carried ledger was already clean — the mechanical classification alone must never be trusted to skip review entirely');
      assert.equal(calls.revises.length, 0, 'zero reviser dispatches — the cross-gen round is verification-only');
      assert.equal(calls.reviews.filter((r) => r === 'full').length, 0, 'zero full ProposalReview reviewers dispatched — still cheaper than a full review');
      assert.equal(result.ledger.length, 1, 'the stable finding id/disposition survive untouched');
      assert.equal(result.ledger[0].id, 'f-stable-1', 'stable finding id preserved across the wording-only revision');
      assert.equal(result.ledger[0].disposition, 'backlog', 'disposition preserved — a wording-only edit never reopens a completed decision');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  test(`[${mirrorName}] cross-gen checkpoint REFUTATION regression: the delta reviewer prompt carries the checkpoint's OLD reviewed-proposal text so a weakened/removed claim (same identifiers, changed semantics) can be caught even when the mechanical classifier says wording-only and the carried ledger is clean`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { resumeFromAdjudicatedProposal: true });
    const OLD_TEXT = 'The gate engine enforces `fail-closed` behavior in `gate.js`: any check error rejects the transition.';
    try {
      let capturedPrompt = null;
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onResolveCheckpoint: () => ({
          raw: JSON.stringify({
            usable: true, code: 'checkpoint-valid', classification: 'wording-only', classificationCode: 'no-new-claims-paths-or-mechanism-removal-detected',
            noveltyScan: { hasNovelClaim: false, novelClaims: [] },
            ledger: [],
            counters: { fullReviews: 1, deltaRounds: 0 },
            mechanismInventoryHash: null, mechanismInventoryCount: null,
            lastFullReviewSession: { sessionId: 'sess-original-full-review', timestamp: 1000 },
            reviewedProposalText: OLD_TEXT,
          }),
        }),
        onCrossGenDeltaReview: (prompt) => {
          capturedPrompt = prompt;
          // A real reviewer given the OLD text plus this task's CURRENT (unchanged, generic
          // fixture) Proposal would see no weakening — report clean, this test's point is only
          // that the OLD text was actually made available to the reviewer to check against.
          return { resolvedIds: [], findings: [], nowMs: 2000, sessionId: 'sess-crossgen-refutation-check' };
        },
      });

      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.crossGenDeltaReviews, 1, 'exactly one delta reviewer dispatched');
      assert.ok(capturedPrompt, 'the delta reviewer prompt was captured');
      assert.ok(capturedPrompt.includes(OLD_TEXT), 'the prompt embeds the checkpoint\'s OLD reviewed-proposal text so the reviewer can independently compare before/after, not just trust the mechanical classification');
      assert.match(capturedPrompt, /ADVISORY/i, 'the prompt explicitly tells the reviewer the mechanical classification is advisory, not authoritative');
      assert.match(capturedPrompt, /weaken|contradict/i, 'the prompt explicitly instructs the reviewer to check for a weakened/contradicted existing claim');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  test(`[${mirrorName}] cross-gen checkpoint AC#5: checkpoint classifies the diff as 'mechanism-change' -> falls back to the ordinary full-review path (authors/adjudicate still skipped by resume, but ProposalReview itself is NOT a cross-gen delta)`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { resumeFromAdjudicatedProposal: true });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onResolveCheckpoint: () => ({
          raw: JSON.stringify({ usable: true, code: 'checkpoint-valid', classification: 'mechanism-change', classificationCode: 'mechanism-claim-removed-unexplained', ledger: [], counters: { fullReviews: 1, deltaRounds: 0 } }),
        }),
        onFullReview: () => ({ findings: [], mechanismCount: 1, sessionId: 'sess-full-2' }),
        onCrossGenDeltaReview: () => { throw new Error('MUST NOT be dispatched: mechanism-change is not an admitted cross-gen classification'); },
      });

      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.authors.length, 0, 'resume still skips ProposalAuthors regardless of the checkpoint classification');
      assert.equal(calls.adjudicator, 0, 'resume still skips Adjudicate regardless of the checkpoint classification');
      assert.equal(calls.reviews.filter((r) => r === 'full').length, 1, 'a full review WAS dispatched — the checkpoint was resolved but never used as a delta base');
      assert.equal(calls.crossGenDeltaReviews, undefined, 'zero cross-gen delta reviewers dispatched');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // Round-2 review coverage gap (2026-07-31, flagged non-blocking by an independent reviewer of the
  // REFUTATION fix): the mandatory-first-cross-gen-round guarantee (`_crossGenFirstRoundPending`)
  // suppresses ONLY the loop's `zero-finding` early-exit — it does NOT and must NOT suppress the
  // split-check, soft-budget, or delta-cap-exhausted terminals, which can still preempt the mandatory
  // round on its very first iteration. This is CORRECT fail-closed behavior (every one of those
  // terminals is `outcome: 'needs-human'`, never `'prepared'` — the invariant that matters, "no
  // regression reaches prepared unreviewed", holds even when the mandatory round itself never runs),
  // but was previously untested. This test exercises the split-check preemption case specifically: a
  // cross-gen checkpoint carrying `mechanismInventoryCount > 2` (the split-multi-mechanism threshold)
  // with an already-clean ledger must reach `needs-human`/`split-recommended` WITHOUT ever dispatching
  // the mandatory cross-gen delta reviewer — never a silent `prepared`.
  test(`[${mirrorName}] cross-gen checkpoint: a carried mechanismInventoryCount > 2 (split-multi-mechanism) preempts the mandatory first cross-gen round — needs-human/split-recommended, never a silent 'prepared'`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { resumeFromAdjudicatedProposal: true });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onResolveCheckpoint: () => ({
          raw: JSON.stringify({
            usable: true, code: 'checkpoint-valid', classification: 'wording-only', classificationCode: 'no-new-claims-paths-or-mechanism-removal-detected',
            noveltyScan: { hasNovelClaim: false, novelClaims: [] },
            ledger: [],
            counters: { fullReviews: 1, deltaRounds: 0 },
            mechanismInventoryHash: 'mi-split-carried', mechanismInventoryCount: 3,
            lastFullReviewSession: { sessionId: 'sess-original-full-review', timestamp: 1000 },
            reviewedProposalText: 'placeholder',
          }),
        }),
        onCrossGenDeltaReview: () => { throw new Error('MUST NOT be dispatched: the carried mechanism-inventory split check must preempt the mandatory round before any reviewer is dispatched'); },
      });

      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'split-recommended', 'a carried mechanismInventoryCount > 2 correctly triggers split-multi-mechanism on the very first loop iteration');
      assert.equal(calls.crossGenDeltaReviews, undefined, 'the mandatory cross-gen round never got to dispatch — preempted by split-check, exactly as intended (fail-closed to needs-human, never a silent prepared)');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  test(`[${mirrorName}] cross-gen checkpoint AC#2: corrupt/cross-task/stale-policy/wrong-charter --resolve-checkpoint verdicts all fall back to full review — never silently treated as a valid delta base`, async () => {
    const cases = [
      { code: 'checkpoint-corrupt' },
      { code: 'checkpoint-wrong-task' },
      { code: 'checkpoint-stale-policy' },
      { code: 'checkpoint-charter-mismatch' },
      { code: 'checkpoint-scope-mismatch' },
      { code: 'checkpoint-missing' },
    ];
    for (const { code } of cases) {
      const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
      const args = baseArgs(scratchRel, { resumeFromAdjudicatedProposal: true });
      try {
        const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
          onResolveCheckpoint: () => ({ raw: JSON.stringify({ usable: false, code }) }),
          onFullReview: () => ({ findings: [], mechanismCount: 1, sessionId: 'sess-full-fallback' }),
          onCrossGenDeltaReview: () => { throw new Error(`MUST NOT be dispatched for a ${code} verdict — never a valid delta base`); },
        });
        assert.equal(result.outcome, 'prepared', `${code}: ${JSON.stringify(result)}`);
        assert.equal(calls.reviews.filter((r) => r === 'full').length, 1, `${code}: a full review must run when the checkpoint is unusable`);
        assert.equal(calls.crossGenDeltaReviews, undefined, `${code}: zero cross-gen delta reviewers dispatched`);
      } finally {
        cleanup(scratchDir, null, args.milestoneId);
      }
    }
  });

  test(`[${mirrorName}] cross-gen checkpoint AC#6 (novelty scan): a mechanically-detected novel claim surfaced to the cross-gen delta reviewer is confirmed and routed to review as a NEW blocking finding, not silently waved through`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { resumeFromAdjudicatedProposal: true, maxDeltaRounds: 2 });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onResolveCheckpoint: () => ({
          raw: JSON.stringify({
            usable: true, code: 'checkpoint-valid', classification: 'known-finding-repair', classificationCode: 'diff-scoped-to-known-finding',
            noveltyScan: { hasNovelClaim: true, novelClaims: [{ sentence: 'It also invokes `newmodule.ts` to route Z.', identifiers: ['newmodule.ts'] }] },
            ledger: [],
            counters: { fullReviews: 1, deltaRounds: 0 },
            mechanismInventoryHash: null, mechanismInventoryCount: null,
            lastFullReviewSession: { sessionId: 'sess-original-full-review', timestamp: 1000 },
          }),
        }),
        // The cross-gen reviewer VERIFIES the mechanically-flagged novel claim and reports it as a
        // genuine new blocking finding — this is the reviewer's own judgment call, but the CANDIDATE
        // claim it is judging came from the mechanical scan, never from LLM self-report alone.
        onCrossGenDeltaReview: () => ({
          resolvedIds: [], findings: [{ subsystem: 'wiring', claimRef: 'newmodule.ts', summary: 'new claim escaped the focused repair', severity: 'blocker', blocking: true, evidence: 'novelty scan flagged `newmodule.ts`' }],
          nowMs: 2000, sessionId: 'sess-crossgen-1',
        }),
        onRevise: (round) => ({ ok: true, sessionId: `sess-revise-${round}` }),
        onDeltaReview: (round) => ({ resolvedIds: ['find-it-yourself'], findings: [], sessionId: `sess-delta-${round}` }),
      });

      // The loop must NOT terminate zero-finding after round 1 — the novel claim is a real open
      // blocking finding, so round 2 (the ordinary revise+delta-review pair) is dispatched to
      // resolve it, proving it was routed to review rather than silently preserved as "clean".
      assert.equal(calls.crossGenDeltaReviews, 1, 'exactly one cross-gen delta reviewer dispatched (round 1)');
      assert.ok(calls.revises.length >= 1, 'a further round was needed — the novel claim was NOT silently waved through as if the old pass still covered it');
      const found = result.ledger.find((f) => f.claimRef === 'newmodule.ts');
      assert.ok(found, 'the novel claim is present in the final ledger as a real finding');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  test(`[${mirrorName}] cross-gen checkpoint: every ProposalReview terminal writes/updates the checkpoint, including a non-success terminal (delta-cap-exhausted)`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel, { maxDeltaRounds: 1 });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({ findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'persistent', severity: 'blocker', blocking: true }], mechanismCount: 1, sessionId: 'sess-full' }),
        onRevise: (round) => ({ ok: true, sessionId: `sess-revise-${round}` }),
        onDeltaReview: (round) => ({ resolvedIds: [], findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'persistent', severity: 'blocker', blocking: true }], sessionId: `sess-delta-${round}` }),
      });
      assert.equal(result.outcome, 'needs-human');
      assert.equal(result.reason, 'delta-cap-exhausted');
      assert.equal(calls.writeReviewCheckpoints, 1, 'checkpoint written exactly once, at the delta-cap-exhausted terminal');
      assert.equal(calls.writeReviewCheckpointLabels[0], 'write-review-checkpoint-delta-cap-exhausted');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // ── DIR-126-D synthetic replay: the repo owner explicitly approved reconstructing a SYNTHETIC
  // fixture matching that incident's SHAPE (one full review, then several small wording/known-
  // finding-repair generations) rather than replaying real historical data. This test drives the
  // REAL proposal-convergence.ts --resolve-checkpoint/--write-checkpoint CLI (never a mocked
  // in-memory stand-in) across FOUR sequential real workflow dispatches against the SAME on-disk
  // checkpoint, scaled down from the real incident's ~9-11 generations for test runtime (the
  // mechanism under test — epoch-wide full-review admission — is identical regardless of how many
  // delta-only generations follow the one full review). ─────────────────────────────────────────
  // Round 2 (post-REFUTATION): reduced from 4 to 3 generations, and now runs highRisk:true
  // throughout. The structural fix (cross-gen delta continuation ALWAYS dispatches one real delta
  // reviewer, never zero — see the ProposalReview loop's own header comment) means every
  // cross-generation continuation now genuinely consumes epoch-cumulative delta-round budget, not
  // just full-review budget. With the ordinary cap (2) that budget is exhausted by 1 (gen1's own
  // capped round) + 1 (gen2) before gen3 could ever run; highRisk's cap (3) fits exactly
  // 1(gen1)+1(gen2)+1(gen3), which is enough generations to prove the real claim (checkpoint
  // continuation across MULTIPLE generations, not just one repair) without needing a 4th. This is
  // an intentional, understood tradeoff of the safety fix, not a workaround — see gap-prepare-
  // milestone-task-epoch-budget-reset (not yet built) for where a smarter, purpose-aware budget
  // (distinguishing a real fix-attempt round from a mandatory-verification-only round) belongs.
  test(`[${mirrorName}] DIR-126-D synthetic replay: at most ONE full semantic review across a 3-generation epoch, later edits carried through real checkpoint continuation, final ledger preserved`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
    const taskId = `../${scratchRel}/task`;
    const charterRel = `${scratchRel}/charter.md`;
    const milestoneId = `M${Math.floor(900000 + Math.random() * 90000)}`;
    const CONVERGENCE_SCRIPT = 'experiments/quay-perpetual-stream/scripts/proposal-convergence.ts';

    function realCheckpointHandlers() {
      return {
        onResolveCheckpoint: () => {
          const res = runShell(`node --experimental-strip-types ${CONVERGENCE_SCRIPT} --resolve-checkpoint --taskId ${JSON.stringify(taskId)} --workspace . --charterFile ${JSON.stringify(charterRel)}`);
          return { raw: res.stdout.trim() };
        },
        onWriteCheckpoint: (prompt) => {
          const pathMatch = prompt.match(/Write the file (\S+) with EXACTLY this content/);
          const jsonMatch = prompt.match(/```json\n([\s\S]*?)\n```/);
          const abs = path.join(REPO_ROOT, pathMatch[1]);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, jsonMatch[1]);
          const cmds = extractNodeCommands(prompt);
          const res = runShell(cmds[0]);
          return { raw: res.stdout.trim() };
        },
      };
    }

    let planFile = null;
    const totalFullReviews = { count: 0 };
    const totalCrossGenDeltaReviews = { count: 0 };
    try {
      // ── Generation 1 (COLD): one full review finds one blocking finding. maxDeltaRounds:1 forces
      // this generation to STOP at delta-cap-exhausted with the finding still OPEN (mirroring the
      // real incident's shape — round 0 already had findings that outlived that generation) — the
      // checkpoint written at THIS non-success terminal is what generation 2 must resume from.
      const gen1 = await runPrepareMilestone(workflowFile, baseArgs(scratchRel, { milestoneId, maxDeltaRounds: 1, highRisk: true }), taskFileOnDisk, {
        ...realCheckpointHandlers(),
        onFullReview: () => { totalFullReviews.count += 1; return { findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'blocker one', severity: 'blocker', blocking: true, repairable: true }], mechanismCount: 1, sessionId: 'sess-full-gen1' }; },
        onRevise: (round) => ({ ok: true, sessionId: `sess-revise-gen1-${round}` }),
        onDeltaReview: (round) => ({ resolvedIds: [], findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'blocker one', severity: 'blocker', blocking: true, repairable: true }], sessionId: `sess-delta-gen1-${round}` }),
      });
      assert.equal(gen1.result.outcome, 'needs-human', JSON.stringify(gen1.result));
      assert.equal(gen1.result.reason, 'delta-cap-exhausted');
      assert.equal(gen1.calls.reviews.filter((r) => r === 'full').length, 1, 'generation 1: exactly one full review');

      // ── Generation 2: a human repairs the finding (edits the on-disk Proposal) and re-dispatches
      // with resumeFromAdjudicatedProposal:true (mirroring a real human-repaired-attempt dispatch —
      // ProposalAuthors/Adjudicate skipped) — the REAL --resolve-checkpoint CLI reads generation 1's
      // checkpoint (its open finding still there) and admits cross-generation delta continuation;
      // the ONE cross-gen delta reviewer confirms the repair resolved it.
      {
        const body = fs.readFileSync(taskFileOnDisk, 'utf8');
        fs.writeFileSync(taskFileOnDisk, body.replace(/## Proposal\n/, '## Proposal\n\n<!-- generation 2: human repair of blocker one -->\n'));
      }
      const gen2 = await runPrepareMilestone(workflowFile, baseArgs(scratchRel, { milestoneId, resumeFromAdjudicatedProposal: true, highRisk: true }), taskFileOnDisk, {
        ...realCheckpointHandlers(),
        onFullReview: () => { totalFullReviews.count += 1; return { findings: [], mechanismCount: 1, sessionId: 'sess-full-gen2' }; },
        onCrossGenDeltaReview: (prompt) => {
          totalCrossGenDeltaReviews.count += 1;
          const ids = findingIdBySubsystem(prompt);
          return { resolvedIds: [ids.s1], findings: [], nowMs: 2000, sessionId: 'sess-crossgen-gen2' };
        },
      });
      assert.equal(gen2.result.outcome, 'prepared', JSON.stringify(gen2.result));
      planFile = gen2.result.planFile;

      // ── Generation 3: a pure wording tidy-up AFTER the substance is already fixed. Round-2 fix
      // (post-REFUTATION): even though the carried checkpoint ledger is already clean, cross-gen
      // delta continuation ALWAYS dispatches exactly ONE real independent delta reviewer for this
      // generation too — never zero — specifically so a diff that LOOKS clean by the mechanical
      // classifier's own identifier-set-only heuristic still gets a real look. Still far cheaper
      // than a full review (1 delta reviewer vs. a full author+reviewer round), just never zero.
      const genResultsAfterFirst = [gen2];
      {
        const body = fs.readFileSync(taskFileOnDisk, 'utf8');
        fs.writeFileSync(taskFileOnDisk, body.replace(/## Proposal\n/, '## Proposal\n\n<!-- generation 3 wording tidy-up -->\n'));
        const gen3 = await runPrepareMilestone(workflowFile, baseArgs(scratchRel, { milestoneId, resumeFromAdjudicatedProposal: true, highRisk: true }), taskFileOnDisk, {
          ...realCheckpointHandlers(),
          onFullReview: () => { totalFullReviews.count += 1; return { findings: [], mechanismCount: 1, sessionId: 'sess-full-gen3' }; },
          onCrossGenDeltaReview: () => { totalCrossGenDeltaReviews.count += 1; return { resolvedIds: [], findings: [], nowMs: 3000, sessionId: 'sess-crossgen-gen3' }; },
        });
        genResultsAfterFirst.push(gen3);
        assert.equal(gen3.result.outcome, 'prepared', `generation 3: ${JSON.stringify(gen3.result)}`);
        assert.equal(gen3.calls.crossGenDeltaReviews, 1, 'generation 3: exactly ONE cross-gen delta reviewer dispatched even though the carried ledger was already clean — never zero (post-REFUTATION structural fix)');
      }

      // ── The core DIR-126-D-shaped claim: across the WHOLE 3-generation epoch, at most ONE full
      // semantic review ran — generations 2-3 never re-derived from scratch, and both cross-
      // generation delta-continuation generations (2, 3) went through exactly one real cross-
      // generation delta reviewer each, never a second full reviewer and never zero reviewers.
      assert.equal(totalFullReviews.count, 1, 'at most one full semantic review across the whole epoch — generations 2-3 never re-dispatched a full reviewer');
      assert.equal(totalCrossGenDeltaReviews.count, 2, 'every cross-gen delta-continuation generation (2, 3) dispatched exactly one real cross-generation delta reviewer — never zero');
      for (const gen of genResultsAfterFirst) {
        assert.equal(gen.calls.authors.length, 0, 'zero Proposal authors on every generation after the first');
        assert.equal(gen.calls.adjudicator, 0, 'zero adjudicators on every generation after the first');
      }

      // ── Final ledger from generation 3's checkpoint still carries the original finding, resolved.
      const finalCheckpointFile = checkpointPath(REPO_ROOT, taskId);
      const finalCheckpoint = JSON.parse(fs.readFileSync(finalCheckpointFile, 'utf8'));
      assert.equal(finalCheckpoint.ledger.length, 1, 'the original finding survives across all 3 generations — never discarded');
      assert.equal(finalCheckpoint.ledger[0].status, 'resolved');
      assert.equal(finalCheckpoint.counters.fullReviews, 1, 'epoch-cumulative fullReviews counter stayed at 1 across all 3 generations');
    } finally {
      // Real CLI dispatches wrote a real checkpoint file (and a scratch --checkpointInputFile
      // handoff, same input path reused/overwritten every generation) directly under this repo's
      // OWN .quay/prepare-checkpoints/ (gitignored, but not test-scoped like scratchDir) — clean
      // both up explicitly rather than relying on the generic scratchDir/milestoneId cleanup, which
      // never looks there.
      fs.rmSync(checkpointPath(REPO_ROOT, taskId), { force: true });
      fs.rmSync(path.join(REPO_ROOT, '.quay', 'prepare-checkpoints', `_input-${taskId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`), { force: true });
      cleanup(scratchDir, planFile, milestoneId);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ── M202/DIR-126-C: generation-aware resume — third child of DIR-126's split. Stage 4/7
  // scenarios: the resume-decision dispatch and its three decision outcomes (resume/reuse-terminal/
  // cold-via-unparseable-failure), plus AC11/R2's explicit-flag zero-dispatch guarantee.
  //
  // gap-prepare-milestone-workflow-dynamic-import (M203/DIR-126-D): a prior draft's local
  // "Stage-4 pre-check" (skip the --decide-resume dispatch entirely when no prior generation
  // record file exists on disk, via `existsSync`) was never actually reachable — the workflow DSL
  // has zero fs/import capability, and a real Workflow dispatch confirmed this live ("import() is
  // not available in workflow scripts"). Fixed by dropping the pre-check: --decide-resume is now
  // dispatched unconditionally whenever the flag is omitted, relying on decideResumeGeneration's
  // own evaluation step 4 to correctly resolve a missing prior record to `cold`. ─────────────────
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  test(`[${mirrorName}] M202/DIR-126-C AC1: omitted flag + NO prior generation record still dispatches --decide-resume exactly once, which itself correctly resolves to cold — unchanged cold behavior downstream`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel); // no resumeFromAdjudicatedProposal, no prior record
    let planFile = null;
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onFullReview: () => ({ findings: [], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
      });
      planFile = result.planFile;
      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.resumeDecisions, 1, 'no prior record for this taskId — --decide-resume is still dispatched (no local pre-check), and its own default mock verdict correctly resolves to cold/missing-prior-record');
      assert.equal(calls.authors.length, 2, 'still the full cold N-author synthesis');
    } finally {
      cleanup(scratchDir, planFile, args.milestoneId);
    }
  });

  test(`[${mirrorName}] M202/DIR-126-C AC2/AC5: omitted flag + prior record resolving 'resume' skips ProposalAuthors/Adjudicate, ProposalReview round-0 STILL dispatches, fullSynthesisCount=0`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    writeGenerationRecord(args.taskId, { schemaVersion: 1, taskId: args.taskId, terminalPhase: 'PlanAuthor', outcome: 'revision-needed', reason: 'plan-author-failed', cacheable: false });
    let planFile = null;
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onResumeDecision: () => ({ raw: JSON.stringify({ decision: 'resume', reason: 'repaired-proposal-detected', priorGenerationId: 'gen-resume-1', hashes: {}, generationId: 'gen-resume-2' }) }),
        onFullReview: () => ({ findings: [], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
      });
      planFile = result.planFile;
      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(calls.resumeDecisions, 1, 'exactly one resume-decision dispatch');
      assert.equal(calls.authors.length, 0, 'ProposalAuthors skipped under automatic resume, same as explicit true');
      assert.equal(calls.adjudicator, 0, 'Adjudicate skipped under automatic resume');
      assert.equal(calls.reviews.filter((r) => r === 'full').length, 1, 'AC5: ProposalReview round-0 review STILL dispatches under automatic resume');
      assert.equal(result.fullSynthesisCount, 0);
      assert.equal(result.resumed, true);
    } finally {
      removeGenerationRecord(args.taskId);
      cleanup(scratchDir, planFile, args.milestoneId);
    }
  });

  test(`[${mirrorName}] M202/DIR-126-C AC3/AC4/AC8: omitted flag + prior record resolving 'reuse-terminal' returns unchanged-generation-terminal BEFORE content Preflight — zero Preflight/author/adjudicate/review/plan dispatches, exactly one admission-related CLI dispatch beyond --acquire`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    writeGenerationRecord(args.taskId, { schemaVersion: 1, taskId: args.taskId, terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'split-recommended', cacheable: true });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onResumeDecision: () => ({ raw: JSON.stringify({
          decision: 'reuse-terminal', reason: 'unchanged-generation-terminal',
          priorReason: 'split-recommended', priorGenerationId: 'gen-reuse-1', priorOutcome: 'needs-human',
          releaseResult: { ok: true, releaseMethod: 'normal' },
        }) }),
      });
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'unchanged-generation-terminal');
      assert.equal(result.decision, 'reuse-terminal');
      assert.equal(result.priorGenerationId, 'gen-reuse-1');
      assert.equal(result.priorReason, 'split-recommended');
      assert.equal(calls.resumeDecisions, 1);
      assert.equal(calls.preflightContent, 0, 'AC3 sharpened (WIRING-CLAIM R4): reuse-terminal returns strictly BEFORE content Preflight — the mechanical content check is itself skipped');
      assert.equal(calls.authors.length, 0);
      assert.equal(calls.adjudicator, 0);
      assert.equal(calls.reviews.length, 0, 'zero content/review agent dispatches on a reuse-terminal cache hit');
      assert.equal(calls.planAuthor, 0, 'AC5: reuse-terminal cannot advance to PlanAuthor');
      assert.equal(calls.admissionReleases, 0, 'AC8/R3: the lease release happened INSIDE the resume-decision dispatch itself — no separate admission-release-* dispatch');
      assert.equal(calls.admissionAcquires, 1, 'exactly one admission-related dispatch beyond --acquire (the resume-decision call itself)');
    } finally {
      removeGenerationRecord(args.taskId);
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  test(`[${mirrorName}] M202/DIR-126-C: omitted flag + unparseable resume-decision verdict fails closed to needs-human/resume-decision-failed, never silently cold or resume`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    writeGenerationRecord(args.taskId, { schemaVersion: 1, taskId: args.taskId, terminalPhase: 'PlanAuthor', outcome: 'revision-needed', reason: 'plan-author-failed', cacheable: false });
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onResumeDecision: () => ({ raw: 'not valid json {{{' }),
      });
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'resume-decision-failed');
      assert.equal(result.phase, 'Preflight');
      assert.equal(calls.authors.length, 0, 'zero ProposalAuthors dispatches after a failed resume-decision');
      assert.equal(calls.preflightContent, 0);
    } finally {
      removeGenerationRecord(args.taskId);
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  test(`[${mirrorName}] M202/DIR-126-C AC4: reuse-terminal selected but the embedded lease release FAILED -> needs-human/reuse-terminal-release-failed, never a clean cache hit with a stranded owner`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    writeGenerationRecord(args.taskId, { schemaVersion: 1, taskId: args.taskId, terminalPhase: 'PreflightContent', outcome: 'revision-needed', reason: 'preflight-rejected', cacheable: true });
    try {
      const { result } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onResumeDecision: () => ({ raw: JSON.stringify({
          decision: 'reuse-terminal', reason: 'unchanged-generation-terminal', priorReason: 'preflight-rejected',
          releaseResult: { ok: false, error: 'lease-missing' },
        }) }),
      });
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'reuse-terminal-release-failed');
      assert.equal(result.phase, 'Preflight');
    } finally {
      removeGenerationRecord(args.taskId);
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  test(`[${mirrorName}] M202/DIR-126-C AC6/AC11/R2: explicit resumeFromAdjudicatedProposal:true/false makes ZERO resume-decision dispatches even when a prior generation record exists — the CALL ITSELF is skipped, not just the decision forced`, async () => {
    for (const explicitValue of [true, false]) {
      const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
      const args = baseArgs(scratchRel, { resumeFromAdjudicatedProposal: explicitValue });
      writeGenerationRecord(args.taskId, { schemaVersion: 1, taskId: args.taskId, terminalPhase: 'ProposalReview', outcome: 'needs-human', reason: 'split-recommended', cacheable: true });
      let planFile = null;
      try {
        const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
          onResumeDecision: () => { throw new Error('MUST NOT be dispatched: an explicit resumeFromAdjudicatedProposal value skips the resume-decision call entirely'); },
          onFullReview: () => ({ findings: [], mechanismCount: 1, sessionId: 'sess-reviewer-0' }),
        });
        planFile = result.planFile;
        assert.equal(calls.resumeDecisions, 0, `explicit ${explicitValue}: zero resume-decision dispatches`);
        assert.equal(result.resumed, explicitValue);
      } finally {
        removeGenerationRecord(args.taskId);
        cleanup(scratchDir, planFile, args.milestoneId);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ── gap-prepare-milestone-task-epoch-budget-reset: epoch-cumulative circuit breaker ───────────
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  test(`[${mirrorName}] epoch budget: a cumulative time-cap breach ALREADY on file at Admission stops BEFORE any content-agent dispatch — needs-human/epoch-time-cap-exceeded, allowedActions COMMIT/SPLIT/NEW-EPOCH/OVERRIDE`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onEpochStatus: () => ({ raw: JSON.stringify({
          ok: true, code: 'epoch-status-ok', exists: true, epochId: 'prior-epoch',
          counters: { attempts: 5, fullReviews: 1, deltaRounds: 3, contentAgentDispatches: 20, observableAgentMs: 91 * 60 * 1000, terminalFingerprints: {}, tokensObserved: null },
          policy: { ordinaryCapMinutes: 90, highRiskCapMinutes: 150, maxFullReviewsPerEpoch: 1, maxRepeatedFingerprint: 2 },
          overrides: [], resets: [],
        }) }),
      });
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'epoch-time-cap-exceeded');
      assert.equal(result.phase, 'Admission');
      assert.deepEqual(result.allowedActions, ['COMMIT', 'SPLIT', 'NEW-EPOCH', 'OVERRIDE']);
      assert.equal(calls.authors.length, 0, 'zero ProposalAuthors dispatches');
      assert.equal(calls.adjudicator, 0, 'zero Adjudicate dispatches');
      assert.equal(calls.reviews.length, 0, 'zero ProposalReview dispatches');
      assert.equal(calls.planAuthor, 0, 'zero PlanAuthor dispatches');
      assert.equal(calls.preflightContent, 0, 'the breach fires before even the mechanical Preflight check — the earliest possible point after Admission');
      assert.ok(calls.epochDispatches >= 1, 'the breach path still persists final counters via _recordEpochDispatch');
      assert.ok(calls.admissionReleases >= 1, 'the held Admission lease is released on breach');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  test(`[${mirrorName}] epoch budget: an epoch identity mismatch (real charter/review-policy drift) stops at Admission with allowedActions:['NEW-EPOCH'] only`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onEpochStatus: () => ({ raw: JSON.stringify({ ok: true, code: 'epoch-identity-mismatch', exists: true, epochId: 'prior-epoch', priorCharterHash: 'old', priorReviewPolicyHash: 'old', hashes: { charterHash: 'new', reviewPolicyHash: 'old' } }) }),
      });
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'epoch-identity-mismatch');
      assert.equal(result.phase, 'Admission');
      assert.deepEqual(result.allowedActions, ['NEW-EPOCH']);
      assert.equal(calls.authors.length, 0);
      assert.equal(calls.preflightContent, 0);
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  test(`[${mirrorName}] epoch budget: the full-review cap gates ONLY the full-review dispatch itself — ProposalAuthors/Adjudicate still run this generation, then the full review is blocked before it is ever dispatched`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onEpochStatus: () => ({ raw: JSON.stringify({
          ok: true, code: 'epoch-status-ok', exists: true, epochId: 'prior-epoch',
          counters: { attempts: 1, fullReviews: 1, deltaRounds: 0, contentAgentDispatches: 4, observableAgentMs: 1000, terminalFingerprints: {}, tokensObserved: null },
          policy: { ordinaryCapMinutes: 90, highRiskCapMinutes: 150, maxFullReviewsPerEpoch: 1, maxRepeatedFingerprint: 2 },
          overrides: [], resets: [],
        }) }),
      });
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'epoch-full-review-cap-exceeded');
      assert.equal(result.phase, 'ProposalReview');
      assert.deepEqual(result.allowedActions, ['COMMIT', 'SPLIT', 'NEW-EPOCH', 'OVERRIDE']);
      assert.equal(calls.authors.length, 2, 'ProposalAuthors DID run this generation — the epoch cap only gates the full-review dispatch itself, not every content agent unconditionally');
      assert.equal(calls.adjudicator, 1, 'Adjudicate DID run this generation too');
      assert.equal(calls.reviews.filter((r) => r === 'full').length, 0, 'the full review agent itself was never dispatched');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening (item 3, explicit decision): "no
  // further resets/overrides, ever, once a hard ceiling is hit — converge to COMMIT/SPLIT" IS the
  // intended terminal design (recorded in the task's own Proposal-adjacent prose). What these two
  // tests verify is narrower and purely mechanical: `_epochBreachExit`'s `allowedActions` must
  // stop implying an escalation path (`NEW-EPOCH`/`OVERRIDE`) that is ALREADY a mechanically-
  // guaranteed dead end at breach time — `_newEpochCli`/`_overrideBudgetCli` fail-closed on their
  // own `maxNewEpochResetCount`/`maxOverrideCount` ceiling regardless (see
  // proposal-convergence.test.mjs's `new-epoch-reset-count-cap-exceeded`/`override-count-cap-
  // exceeded` coverage), so listing them once already exhausted would be inaccurate, not merely
  // unhelpful.
  test(`[${mirrorName}] gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening (item 3): allowedActions omits OVERRIDE once maxOverrideCount is ALREADY exhausted, but still lists NEW-EPOCH while its own ceiling has headroom`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    try {
      const { result } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onEpochStatus: () => ({ raw: JSON.stringify({
          ok: true, code: 'epoch-status-ok', exists: true, epochId: 'prior-epoch',
          // observableAgentMs deliberately exceeds ordinaryCapMinutes(90) + the ONE recorded
          // override's own 30 additional minutes (effectiveCapMs = 120m) — the prior override
          // genuinely extends the time cap, so a value only just past 90m alone would NOT breach
          // here; 200m safely clears the extended cap too.
          counters: { attempts: 5, fullReviews: 1, deltaRounds: 3, contentAgentDispatches: 20, observableAgentMs: 200 * 60 * 1000, terminalFingerprints: {}, tokensObserved: null },
          policy: { ordinaryCapMinutes: 90, highRiskCapMinutes: 150, maxFullReviewsPerEpoch: 1, maxRepeatedFingerprint: 2, maxOverrideCount: 1, maxNewEpochResetCount: 3 },
          overrides: [{ owner: 'alice', reason: 'prior override', additionalBudget: 30, grantedAt: 1 }],
          resets: [],
        }) }),
      });
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'epoch-time-cap-exceeded');
      assert.deepEqual(result.allowedActions, ['COMMIT', 'SPLIT', 'NEW-EPOCH'], 'OVERRIDE is a mechanically-guaranteed dead end here (maxOverrideCount:1 already met by the one prior override on file) and must not be listed; NEW-EPOCH still has real headroom (0 of 3 resets used) so it stays listed');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  test(`[${mirrorName}] gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening (item 3): allowedActions is COMMIT/SPLIT ONLY once BOTH maxOverrideCount and maxNewEpochResetCount are ALREADY exhausted — no escape valve past the hard ceilings, by design`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    try {
      const { result } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onEpochStatus: () => ({ raw: JSON.stringify({
          ok: true, code: 'epoch-status-ok', exists: true, epochId: 'prior-epoch',
          // Same rationale as the test above: past the extended (90+30=120m) effective cap.
          counters: { attempts: 5, fullReviews: 1, deltaRounds: 3, contentAgentDispatches: 20, observableAgentMs: 200 * 60 * 1000, terminalFingerprints: {}, tokensObserved: null },
          policy: { ordinaryCapMinutes: 90, highRiskCapMinutes: 150, maxFullReviewsPerEpoch: 1, maxRepeatedFingerprint: 2, maxOverrideCount: 1, maxNewEpochResetCount: 1 },
          overrides: [{ owner: 'alice', reason: 'prior override', additionalBudget: 30, grantedAt: 1 }],
          resets: [{ fromEpochId: 'prior-epoch-0', owner: 'bob', reason: 'prior reset', oldHash: {}, newHash: {}, timestamp: 1 }],
        }) }),
      });
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.deepEqual(result.allowedActions, ['COMMIT', 'SPLIT'], 'once BOTH hard ceilings are already exhausted, NEW-EPOCH/OVERRIDE are mechanically-guaranteed dead ends and must not be listed — COMMIT/SPLIT remain the only genuine paths forward, matching the intended terminal design');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // gap-prepare-milestone-task-epoch-budget-reset (round 2, post-REFUTATION): an independent review
  // found the wiring-coverage-check dispatch site was the ONE real content-agent call in this file
  // with no epoch cap check immediately before it — every other dispatch site (ProposalAuthors,
  // Adjudicate, full/delta ProposalReview, PlanAuthor, PlanCheck) is guarded, this one wasn't.
  // Mechanical WIRING-CLAIM-style test (same idiom as the `_releaseLeaseAndRecord` call-site count
  // test below) rather than trying to simulate the exact millisecond-precision timing needed to
  // trigger this specific gate via a mocked replay — verifies the structural property directly:
  // the source has a `_checkEpochCapsInline(` call immediately preceding the wiring-coverage-check
  // dispatch, and the total call-site count reflects the fix.
  test(`[${mirrorName}] WIRING-CLAIM: the wiring-coverage-check content-agent dispatch is immediately preceded by an epoch cap check — was the one previously-ungated real dispatch site, closed after round-2 REFUTATION review`, () => {
    const text = fs.readFileSync(workflowFile, 'utf8');
    // Anchor on the real call pattern (`_epochCap = _checkEpochCapsInline(`) — a bare
    // `_checkEpochCapsInline(` also matches the function's OWN definition line
    // (`function _checkEpochCapsInline(checkFullReviewCap) {`), over-counting by one.
    const callSites = [...text.matchAll(/_epochCap = _checkEpochCapsInline\(/g)];
    assert.equal(callSites.length, 8, `expected exactly 8 real _checkEpochCapsInline( call sites, found ${callSites.length}`);

    const wiringDispatchIdx = text.indexOf("_wiringVerdict = await agent(");
    assert.ok(wiringDispatchIdx > 0, 'the wiring-coverage-check dispatch site exists');
    // The nearest _checkEpochCapsInline( call BEFORE the dispatch site must be close by (same
    // guarded block, not some unrelated earlier call site coincidentally appearing first in the
    // file) — and its own breach-exit must cite 'epoch-cap-wiring-coverage' as the reason code.
    const capCallIdx = text.lastIndexOf('_epochCap = _checkEpochCapsInline(', wiringDispatchIdx);
    assert.ok(capCallIdx > 0, 'a _checkEpochCapsInline( call exists before the wiring-coverage-check dispatch');
    const gapText = text.slice(capCallIdx, wiringDispatchIdx);
    assert.ok(gapText.length < 400, `the cap check sits immediately adjacent to the dispatch (gap: ${gapText.length} chars) — not some unrelated distant call site`);
    assert.ok(gapText.includes("'epoch-cap-wiring-coverage'"), "the immediately-preceding cap check's own breach-exit cites 'epoch-cap-wiring-coverage' as its reason code, confirming it genuinely guards THIS dispatch site");
  });

  test(`[${mirrorName}] epoch budget: a repeated-terminal-fingerprint (2 prior occurrences of the SAME terminal) stops the NEXT generation before any content-agent dispatch`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const args = baseArgs(scratchRel);
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {
        onEpochStatus: () => ({ raw: JSON.stringify({
          ok: true, code: 'epoch-status-ok', exists: true, epochId: 'prior-epoch',
          counters: { attempts: 2, fullReviews: 0, deltaRounds: 2, contentAgentDispatches: 6, observableAgentMs: 1000, terminalFingerprints: { deadbeef1234: 2 }, tokensObserved: null },
          policy: { ordinaryCapMinutes: 90, highRiskCapMinutes: 150, maxFullReviewsPerEpoch: 1, maxRepeatedFingerprint: 2 },
          overrides: [], resets: [],
        }) }),
      });
      assert.equal(result.outcome, 'needs-human', JSON.stringify(result));
      assert.equal(result.reason, 'epoch-fingerprint-cap-exceeded');
      assert.equal(calls.authors.length, 0, 'zero content-agent dispatches — caught at the earliest Admission-time check');
    } finally {
      cleanup(scratchDir, null, args.milestoneId);
    }
  });

  // ── DIR-126-D synthetic replay (epoch mechanism) — the repo owner explicitly approved
  // reconstructing a SYNTHETIC fixture matching that incident's SHAPE (many small sequential
  // generations, each individually within its own local DIR-125 policy, but collectively exceeding
  // a sane cumulative bound) over literal historical replay — the SAME precedent the sibling
  // checkpoint-continuation test above already used. Drives the REAL, unmodified workflow via a
  // REAL --epoch-status/--record-epoch-dispatch CLI round trip (never a mocked in-memory
  // stand-in) across TWO sequential real workflow dispatches: generation 1 (cold — a real full
  // review + delta round that ends needs-human, persisting fullReviews=1 to the real on-disk epoch
  // record), generation 2 (ALSO cold — mirroring the real incident's exact failure mode: "a caller
  // can edit the task and start a fresh generation with brand-new counters" — DIR-125's own
  // per-generation caps are satisfied fine by generation 2 in isolation, but the EPOCH stops it
  // before it can dispatch a second full review). This is the real defect DIR-126-D exposed:
  // eleven individually-compliant attempts accumulated ~5h/9.5M tokens because NOTHING bounded the
  // number of generations. This replay shows the breaker firing at generation 2 — nowhere near 11.
  test(`[${mirrorName}] DIR-126-D synthetic replay (epoch budget): the full-review cap stops a second cold generation at attempt 2 — nowhere near the real incident's 9-11 attempts, with clear evidence of which cap fired`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
    const taskId = `../${scratchRel}/task`;
    const charterRel = `${scratchRel}/charter.md`;
    const milestoneId = `M${Math.floor(900000 + Math.random() * 90000)}`;
    const CONVERGENCE_SCRIPT = 'experiments/quay-perpetual-stream/scripts/proposal-convergence.ts';

    function realEpochHandlers() {
      return {
        onEpochStatus: () => {
          const res = runShell(`node --experimental-strip-types ${CONVERGENCE_SCRIPT} --epoch-status --taskId ${JSON.stringify(taskId)} --workspace . --charterFile ${JSON.stringify(charterRel)} --highRisk false`);
          return { raw: res.stdout.trim() };
        },
        onEpochDispatch: (prompt) => {
          const cmds = extractNodeCommands(prompt);
          const res = runShell(cmds[0]);
          return { raw: res.stdout.trim() };
        },
      };
    }

    let planFile = null;
    try {
      // ── Generation 1 (COLD): one full review finds one persistent blocking finding; the ordinary
      // maxDeltaRounds:1 forces this generation to stop at delta-cap-exhausted with the epoch's own
      // real --record-epoch-dispatch persisting fullReviews=1 (one real full review actually ran).
      const gen1 = await runPrepareMilestone(workflowFile, baseArgs(scratchRel, { milestoneId, maxDeltaRounds: 1 }), taskFileOnDisk, {
        ...realEpochHandlers(),
        onFullReview: () => ({ findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'blocker one', severity: 'blocker', blocking: true }], mechanismCount: 1, sessionId: 'sess-full-gen1' }),
        onRevise: (round) => ({ ok: true, sessionId: `sess-revise-gen1-${round}` }),
        onDeltaReview: (round) => ({ resolvedIds: [], findings: [{ subsystem: 's1', claimRef: 'AC#1', summary: 'blocker one', severity: 'blocker', blocking: true }], sessionId: `sess-delta-gen1-${round}` }),
      });
      assert.equal(gen1.result.outcome, 'needs-human', JSON.stringify(gen1.result));
      assert.equal(gen1.result.reason, 'delta-cap-exhausted');
      assert.equal(gen1.calls.reviews.filter((r) => r === 'full').length, 1, 'generation 1: exactly one full review, individually well within DIR-125 policy');

      // ── Generation 2: mirrors the REAL DIR-126-D failure mode verbatim — a human edits the task
      // (a small repair, exactly like every real DIR-126-D round) and starts a FRESH cold
      // generation (no resumeFromAdjudicatedProposal) — DIR-125's own per-generation caps are
      // satisfied fine by this generation in total isolation (it is, after all, just gen1's own
      // shape again). The epoch-cumulative full-review cap is what actually stops it.
      {
        const body = fs.readFileSync(taskFileOnDisk, 'utf8');
        fs.writeFileSync(taskFileOnDisk, body.replace(/## Proposal\n/, '## Proposal\n\n<!-- generation 2: human repair, cold redispatch (the exact DIR-126-D pattern) -->\n'));
      }
      const gen2 = await runPrepareMilestone(workflowFile, baseArgs(scratchRel, { milestoneId }), taskFileOnDisk, {
        ...realEpochHandlers(),
        onFullReview: () => { throw new Error('MUST NOT be dispatched: the epoch full-review cap must stop generation 2 BEFORE the full-review agent is ever called'); },
      });
      assert.equal(gen2.result.outcome, 'needs-human', JSON.stringify(gen2.result));
      assert.equal(gen2.result.reason, 'epoch-full-review-cap-exceeded', 'clear evidence of exactly which cap fired');
      assert.equal(gen2.result.phase, 'ProposalReview');
      assert.deepEqual(gen2.result.allowedActions, ['COMMIT', 'SPLIT', 'NEW-EPOCH', 'OVERRIDE']);
      // DIR-126-D's own real 2 authors + 1 adjudicator STILL ran this generation (the epoch cap
      // gates ONLY the specific over-cap dispatch, not the whole generation retroactively) — but
      // the circuit breaker fired at generation 2, stopping the cycle well before 9-11 attempts.
      assert.equal(gen2.calls.authors.length, 2);
      assert.equal(gen2.calls.adjudicator, 1);
      assert.equal(gen2.calls.reviews.length, 0, 'zero review agents this generation — the breach fired before the full-review dispatch');

      // ── Final on-disk epoch record: fullReviews stayed at exactly 1, the SAME real cumulative
      // counter that caused generation 2's breach — never silently reset by the intervening edit.
      const finalEpoch = JSON.parse(fs.readFileSync(epochPath(REPO_ROOT, taskId), 'utf8'));
      assert.equal(finalEpoch.counters.fullReviews, 1);
      assert.equal(finalEpoch.counters.attempts, 2, 'exactly 2 real attempts recorded — the replay stopped at attempt 2, nowhere near the real incident\'s 9-11');
    } finally {
      fs.rmSync(epochPath(REPO_ROOT, taskId), { force: true });
      cleanup(scratchDir, planFile, milestoneId);
    }
  });

  // ── DoD: "A real repeated-terminal preparation sequence reaches human-decision-required and a
  // further generic redispatch is mechanically rejected with zero new content-agent work." Drives
  // THREE real, sequential, un-mocked-epoch generations against the REAL --epoch-status/
  // --record-epoch-dispatch CLI (never seeded/mocked counters), each independently and
  // deterministically terminating at the IDENTICAL real terminal (PreflightContent/
  // preflight-rejected) — the cheapest real terminal to reproduce deterministically. Generation 3
  // is the "further generic redispatch": a plain cold dispatch with no special flags, mechanically
  // rejected by the real on-disk fingerprint count BEFORE Preflight itself ever runs.
  test(`[${mirrorName}] DoD: a REAL repeated-terminal sequence (3 real generations, same terminal, real CLI-persisted fingerprint) reaches human-decision-required and a further generic redispatch is mechanically rejected with ZERO new content-agent work`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk, charterFileOnDisk } = makeScratch();
    const taskId = `../${scratchRel}/task`;
    const charterRel = `${scratchRel}/charter.md`;
    const milestoneId = `M${Math.floor(900000 + Math.random() * 90000)}`;
    const CONVERGENCE_SCRIPT = 'experiments/quay-perpetual-stream/scripts/proposal-convergence.ts';
    let planFile = null; // never populated — every generation here rejects at Preflight, well before PlanAuthor

    function realEpochHandlers() {
      return {
        onEpochStatus: () => {
          const res = runShell(`node --experimental-strip-types ${CONVERGENCE_SCRIPT} --epoch-status --taskId ${JSON.stringify(taskId)} --workspace . --charterFile ${JSON.stringify(charterRel)} --highRisk false`);
          return { raw: res.stdout.trim() };
        },
        onEpochDispatch: (prompt) => {
          const cmds = extractNodeCommands(prompt);
          const res = runShell(cmds[0]);
          return { raw: res.stdout.trim() };
        },
      };
    }
    // Every real generation deterministically rejects at content-Preflight with the SAME blocking
    // finding — never reaching ProposalAuthors, so each real dispatch is fast and cheap while still
    // exercising the REAL --record-generation -> _recordEpochDispatch -> real on-disk fingerprint
    // write path (the SAME `_releaseLeaseAndRecord` choke point every other terminal uses).
    const REJECTING_PREFLIGHT = { raw: JSON.stringify({ ok: true, policyVersion: 'preflight-v1', findings: [{ code: 'merged-markdown-claim', message: 'fixture blocking finding', blocking: true, disposition: 'unresolved' }] }) };

    try {
      // resumeFromAdjudicatedProposal:false on every dispatch — explicit, so ZERO --decide-resume
      // calls happen (WIRING-CLAIM R2 precedent) and every generation independently reaches a real,
      // fresh Preflight dispatch rather than risking a reuse-terminal cache hit on an unchanged
      // Proposal (preflight-rejected IS one of the two CACHEABLE_TERMINALS-allowlisted pairs).
      const gen1 = await runPrepareMilestone(workflowFile, baseArgs(scratchRel, { milestoneId, resumeFromAdjudicatedProposal: false }), taskFileOnDisk, {
        ...realEpochHandlers(),
        onPreflightContent: () => REJECTING_PREFLIGHT,
      });
      assert.equal(gen1.result.outcome, 'revision-needed', JSON.stringify(gen1.result));
      assert.equal(gen1.result.reason, 'preflight-rejected');
      assert.equal(gen1.calls.preflightContent, 1);

      const gen2 = await runPrepareMilestone(workflowFile, baseArgs(scratchRel, { milestoneId, resumeFromAdjudicatedProposal: false }), taskFileOnDisk, {
        ...realEpochHandlers(),
        onPreflightContent: () => REJECTING_PREFLIGHT,
      });
      assert.equal(gen2.result.outcome, 'revision-needed', JSON.stringify(gen2.result));
      assert.equal(gen2.result.reason, 'preflight-rejected');
      assert.equal(gen2.calls.preflightContent, 1, 'generation 2 also reached a REAL fresh Preflight dispatch — no reuse-terminal short-circuit');

      const midEpoch = JSON.parse(fs.readFileSync(epochPath(REPO_ROOT, taskId), 'utf8'));
      const fpCounts = Object.values(midEpoch.counters.terminalFingerprints);
      assert.ok(fpCounts.includes(2), `expected a real fingerprint count of 2 after 2 identical real terminals, got ${JSON.stringify(midEpoch.counters.terminalFingerprints)}`);

      // ── Generation 3: "a further generic redispatch" — a PLAIN cold dispatch, no special flags
      // beyond the SAME resumeFromAdjudicatedProposal:false every generation here already uses.
      // Mechanically rejected by the REAL on-disk fingerprint count BEFORE Preflight ever runs.
      const gen3 = await runPrepareMilestone(workflowFile, baseArgs(scratchRel, { milestoneId, resumeFromAdjudicatedProposal: false }), taskFileOnDisk, {
        ...realEpochHandlers(),
        onPreflightContent: () => { throw new Error('MUST NOT be dispatched: the repeated-fingerprint cap must stop generation 3 BEFORE Preflight is ever called'); },
      });
      assert.equal(gen3.result.outcome, 'needs-human', JSON.stringify(gen3.result));
      assert.equal(gen3.result.reason, 'epoch-fingerprint-cap-exceeded');
      assert.equal(gen3.result.phase, 'Admission');
      assert.deepEqual(gen3.result.allowedActions, ['COMMIT', 'SPLIT', 'NEW-EPOCH', 'OVERRIDE']);
      assert.equal(gen3.calls.preflightContent, 0, 'ZERO new content-agent work — mechanically rejected before Preflight, let alone ProposalAuthors');
      assert.equal(gen3.calls.authors.length, 0);
      assert.equal(gen3.calls.adjudicator, 0);
    } finally {
      fs.rmSync(epochPath(REPO_ROOT, taskId), { force: true });
      cleanup(scratchDir, planFile, milestoneId);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── M202/DIR-126-C Stage 5 — production-callsite coverage fixtures (source grep, no dispatch):
// WIRING-CLAIM R5 (all 15 real terminal-return sites re-derived live, the literal --terminalPhase
// argument values at the two preflight record-write sites) and WIRING-CLAIM R7 (the two
// _releaseLeaseAndRecord('preflight-rejected', ...) sites carry DISTINCT terminalPhase literals —
// the live manifestation of the identical-`reason`-string collision the Proposal frames). ────────
// ═══════════════════════════════════════════════════════════════════════════════════════════════
for (const [mirrorName, workflowFile] of MIRRORS) {
  const src = () => fs.readFileSync(workflowFile, 'utf8');

  test(`[${mirrorName}] WIRING-CLAIM R5: exactly 15 real _releaseLeaseAndRecord( call sites (M203/DIR-126-D: Receipt's own 2 moved to the new _releaseLease split; gap-prepare-milestone-task-epoch-budget-reset: +2 epoch-breach sites)`, () => {
    const text = src();
    // The baseline live count this Plan re-derives from git history (480cb58): 15 real
    // post-Admission _releaseLease( terminal-return call sites, not an assumed 11 or 12. Anchor on
    // `await _releaseLease(` — a bare `grep -c "_releaseLease("` also matches the helper's OWN
    // `async function _releaseLease(stageLabel) {` definition line, over-counting by one.
    const baseline = execSync(`git show 480cb58:${mirrorName} | grep -c "await _releaseLease("`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    assert.equal(baseline, '15', 'the historical baseline this child replaces is 15 real call sites');

    // M203/DIR-126-D Claim A.4 (this child): Receipt's own 2 sites
    // (receipt-selfcheck-failed/prepared) moved OFF the combined _releaseLeaseAndRecord helper onto
    // the new write-first/build/release-only split (_writeGenerationTelemetry + _releaseLease) — the
    // pre-Receipt terminals (including reuse-terminal, which never called this helper at all) are
    // UNCHANGED, still dispatching _releaseLeaseAndRecord exactly once each.
    // M206: +2 new sites for mechanism-inventory-invalid / mechanism-inventory-missing fail-closed terminals.
    // gap-prepare-milestone-task-epoch-budget-reset: +2 MORE textual sites — the Admission-time
    // epoch-identity-mismatch handler's own direct call, and the shared `_epochBreachExit` helper's
    // ONE call (reused by every one of the 7 cap-check call sites, so it contributes exactly 1
    // textual occurrence regardless of how many places call `_epochBreachExit` itself).
    // 15 (M203 baseline) + 2 (M206) = 17, but M203's own comment already nets those two together as
    // "15" post-Receipt-split — so the running total re-derived here is 15 + 2 (epoch) = 17.
    const callSites = [...text.matchAll(/await _releaseLeaseAndRecord\(/g)];
    assert.equal(callSites.length, 17, `expected exactly 17 await _releaseLeaseAndRecord( call sites (15 pre-epoch baseline + 2 new epoch-breach sites), found ${callSites.length}`);

    // The NEW _releaseLease(stageLabel, {reason}) helper (M203/DIR-126-D — a DIFFERENT function
    // from the pre-M202 helper this same name historically referred to, which WAS fully removed at
    // 480cb58) has exactly 3 real call sites, all scoped to the Receipt phase (Claim A.4's
    // write/build/release-only restructuring): the telemetry-write-failure early exit, the
    // receipt-selfcheck-failed terminal, and the final 'prepared' success release.
    const newReleaseLeaseCallSites = [...text.matchAll(/await _releaseLease\('Receipt',/g)];
    assert.equal(newReleaseLeaseCallSites.length, 3, `expected exactly 3 await _releaseLease('Receipt', ...) call sites, found ${newReleaseLeaseCallSites.length}`);
  });

  test(`[${mirrorName}] WIRING-CLAIM R5/R7 production-callsite half: the two content-preflight sites record terminalPhase:'PreflightContent', the two plan-shape sites record terminalPhase:'PreflightPlan' — NOT a coarse shared 'Preflight' value`, () => {
    const text = src();
    const preflightRecordSites = [...text.matchAll(/_releaseLeaseAndRecord\('(preflight-check-failed|preflight-rejected)',\s*\{\s*terminalPhase:\s*'([^']+)'/g)];
    assert.equal(preflightRecordSites.length, 4, 'exactly 4 preflight-labeled _releaseLeaseAndRecord call sites (2 content + 2 plan-shape)');
    const contentSites = preflightRecordSites.filter((m) => m[2] === 'PreflightContent');
    const planSites = preflightRecordSites.filter((m) => m[2] === 'PreflightPlan');
    assert.equal(contentSites.length, 2, 'both content-preflight sites (preflight-check-failed, preflight-rejected) record terminalPhase:PreflightContent');
    assert.equal(planSites.length, 2, 'both plan-shape-preflight sites (preflight-check-failed, preflight-rejected) record terminalPhase:PreflightPlan');
    assert.ok(preflightRecordSites.every((m) => m[2] === 'PreflightContent' || m[2] === 'PreflightPlan'), 'no site uses a coarse shared \'Preflight\' terminalPhase value');
  });

  test(`[${mirrorName}] WIRING-CLAIM R7 grounding: the two 'preflight-rejected' _releaseLeaseAndRecord sites carry DISTINCT terminalPhase literals and DISTINCT cacheable values (the SAME reason string, two genuinely different real costs)`, () => {
    const text = src();
    const rejectedSites = [...text.matchAll(/_releaseLeaseAndRecord\('preflight-rejected',\s*\{\s*terminalPhase:\s*'([^']+)',\s*outcome:\s*'[^']+',\s*reason:\s*'preflight-rejected',\s*cacheable:\s*(true|false)\s*\}\)/g)];
    assert.equal(rejectedSites.length, 2, 'exactly 2 preflight-rejected _releaseLeaseAndRecord sites');
    const byPhase = Object.fromEntries(rejectedSites.map((m) => [m[1], m[2]]));
    assert.equal(byPhase.PreflightContent, 'true', 'the content-preflight preflight-rejected site is the ONLY allowlisted preflight-rejected pair — cacheable:true');
    assert.equal(byPhase.PreflightPlan, 'false', 'the plan-shape preflight-rejected site is deliberately NOT cacheable, despite the identical reason string');
  });

  test(`[${mirrorName}] WIRING-CLAIM R9: git diff --stat against prepare-admission-check.ts and .gitignore is empty for DIR-126-C's own commits (closed historical range 480cb58..68eb5eb^)`, () => {
    // M207: CLOSED historical range, not `..HEAD`. The claim under test is DIR-126-C's own — its
    // commits (from base 480cb58) never touched prepare-admission-check.ts/.gitignore. That held
    // until DIR-126-D's 68eb5eb (the preflightTouchesMismatch backtick-asymmetry fix) and M205's
    // c82efac deliberately DID touch the file, and M207 itself re-extends it with the additive
    // nowMs self-report — an open-ended `..HEAD` pin can never be green again once any later
    // milestone legitimately edits the file. The closed range keeps the original historical claim
    // mechanically verifiable forever (empty diff, verified at M207 authoring time).
    const out = execSync(
      `git diff --stat 480cb58..68eb5eb^ -- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts plugin/scripts/prepare-admission-check.ts .gitignore`,
      { cwd: REPO_ROOT, encoding: 'utf8' }
    ).trim();
    assert.equal(out, '', `expected an empty diff against prepare-admission-check.ts/.gitignore over DIR-126-C's own commit range, got:\n${out}`);
  });

  // M203/DIR-126-D Stage 9 — AC19: zero new Date.now()/new Date()/import()/await import( regression
  // guard, run over the FINISHED diff (this child's own new call sites already landed by the time
  // this runs). Comment-stripping is load-bearing: this exact file already carries all four literal
  // patterns inside `//` comments (the very ones commits f6db2a8/7357a91 added to document the
  // production-crash class), so a naive whole-file regex would falsely fail RED against a clean file.
  test(`[${mirrorName}] AC19: zero LIVE (non-comment) Date.now()/new Date(/await import(/bare import( call sites — the exact sandbox production-crash regression class (f6db2a8/7357a91)`, () => {
    const text = src();
    const stripped = text.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
    const patterns = [
      { name: 'Date.now()', re: /\bDate\.now\(\)/ },
      { name: 'new Date(', re: /\bnew Date\(/ },
      { name: 'await import(', re: /\bawait\s+import\(/ },
      { name: 'bare import(', re: /\bimport\(/ },
    ];
    for (const { name, re } of patterns) {
      const m = stripped.match(re);
      assert.equal(m, null, `found a live (non-comment) '${name}' call site in ${mirrorName}: ${m ? JSON.stringify(m[0]) : ''}`);
    }
  });

  // gap-decide-resume-generation-path-unsanitized-taskid regression guard: M202/DIR-126-C's Build
  // (2319e8e) briefly computed `_generationRecordPath` via raw, unsanitized `${_taskId}`
  // interpolation (`.quay/prepare-leases/${_taskId}.generation.json`) — for a slash-containing
  // taskId this could resolve to a DIFFERENT file than proposal-convergence.ts's own
  // `_safeTaskIdSegment()`-sanitized `_generationPath()`/`_leasePath()` (`/[\\/]/g -> "_"`).
  // gap-prepare-milestone-workflow-dynamic-import (7357a91, M203/DIR-126-D) already deleted that
  // ENTIRE local computation, for an unrelated reason (`await import('node:fs')` unreachable in the
  // workflow sandbox) — the workflow now defers path resolution to the real `--decide-resume`/
  // `--record-generation` CLI dispatches exclusively, which is exactly this gap's own Requested-
  // action alternative ("avoid the workflow-side path derivation entirely ... let the CLI itself be
  // the single source of truth for path resolution, since it already sanitizes correctly"). A
  // slash/".."-bearing taskId cannot diverge because there is no second, workflow-side computation
  // left to diverge FROM — every test in this file's `baseArgs()` already dispatches with exactly
  // such a taskId (`../${scratchRel}/task`). Assert the deleted computation never reappears.
  test(`[${mirrorName}] gap-decide-resume-generation-path-unsanitized-taskid: zero LIVE workflow-side 'prepare-leases'/'.generation.json' path construction — the real --decide-resume/--record-generation CLI dispatch (already _safeTaskIdSegment()-sanitized) is the sole path-resolution authority`, () => {
    const text = src();
    const stripped = text.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
    const m = stripped.match(/prepare-leases|\.generation\.json/);
    assert.equal(m, null, `found a live (non-comment) local generation/lease-path construction in ${mirrorName}: ${m ? JSON.stringify(m[0]) : ''} — a raw \${_taskId} interpolation here would diverge from proposal-convergence.ts's sanitized path for a slash-containing taskId; the workflow must keep deferring entirely to the CLI dispatch`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── M207 — per-phase-boundary timing accumulation + findingCodes construction (both mirrors) ─────
// SENDER-side fixtures: the workflow reads `nowMs` out of ALREADY-PARSED subprocess verdicts
// (never computes a clock read itself), accumulates {phase, round, startedAtMs, endedAtMs} spans,
// and threads --phaseTimings/--findingCodes onto the record-writing dispatches that already exist.
// RECEIVER-side semantics (trailing-span close with recordedAtMs, recurrence scan, REQUIRED_TOP
// widening, malformed-flag fail-soft) are covered by experiments/quay-perpetual-stream/test/
// proposal-convergence.test.mjs's own CLI fixtures — this block proves what the sandbox SENDS.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// Decodes a double-JSON.stringify'd flag value (the existing --detail idiom) out of a captured
// dispatch prompt: on the command line the value is a shell-quoted JSON string whose parse yields
// the inner JSON string, whose parse yields the real value. Balanced-quote scan — escaped quotes
// inside the payload must NOT terminate the token — never a naive split.
function extractDoubleJsonFlag(prompt, flagName) {
  const marker = `--${flagName} `;
  const idx = prompt.indexOf(marker);
  assert.ok(idx >= 0, `expected a --${flagName} flag in the dispatch prompt:\n${prompt.slice(0, 400)}`);
  let i = idx + marker.length;
  assert.equal(prompt[i], '"', `--${flagName} must be double-JSON.stringify'd (a shell-quoted JSON string)`);
  let token = '"';
  let escaped = false;
  for (i = i + 1; i < prompt.length; i++) {
    const ch = prompt[i];
    token += ch;
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') break;
  }
  return JSON.parse(JSON.parse(token));
}

for (const [mirrorName, workflowFile] of MIRRORS) {
  const runFullGeneration = async (reviewHandlers = {}, extraArgs = {}) => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    const milestoneId = `M${Math.floor(900000 + Math.random() * 90000)}`;
    const handlers = {
      onFullReview: () => ({ findings: [], mechanismCount: 1, proposalHash: 'h0', sessionId: 'sess-review' }),
      onRevise: () => ({ ok: true, proposalHash: 'h1', sessionId: 'sess-revise' }),
      onDeltaReview: () => ({ resolvedIds: [], findings: [], sessionId: 'sess-delta' }),
      ...reviewHandlers,
    };
    try {
      const out = await runPrepareMilestone(workflowFile, baseArgs(scratchRel, { milestoneId, ...extraArgs }), taskFileOnDisk, handlers);
      // A prepared run's mock writes real receipt/ledger/telemetry-mock files under
      // milestones/<milestoneId>/ and a real Plan file (mock plan-author) — remove them the same
      // way the pre-existing scenarios' cleanup convention does, never leaving repo artifacts.
      if (out.planFile) fs.rmSync(path.join(REPO_ROOT, out.planFile), { force: true });
      fs.rmSync(path.join(REPO_ROOT, 'milestones', milestoneId), { recursive: true, force: true });
      return out;
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  };

  test(`[${mirrorName}] M207/AC2/AC7 (CLAIM C2/C3/C4): a real multi-round generation (a ProposalReview delta round AND a PlanCheck round) accumulates one span per successful renewal plus the receiver-bound trailing entry — round threaded from caller-owned variables, never regex-parsed from the label`, async () => {
    let renewNowMs = 1000;
    const { result, calls } = await runFullGeneration({
      onAcquire: () => ({ raw: JSON.stringify({ outcome: 'acquired', lease: { fencingToken: 0 }, reclaimed: false, nowMs: 500 }) }),
      onRenew: () => ({ raw: JSON.stringify({ ok: true, nowMs: (renewNowMs += 1000) }) }),
      // ONE blocking finding on the full review, resolved on delta round 1 -> exactly one
      // ProposalReview-delta-round-1 renewal; the mock plan-checker returns findings:0 -> exactly
      // one PlanCheck-round-1 renewal.
      onFullReview: () => ({ findings: [{ subsystem: 'fixture', summary: 'one blocking finding', severity: 'blocker', blocking: true }], mechanismCount: 1, proposalHash: 'h0', nowMs: 111, sessionId: 'sess-review' }),
      onDeltaReview: (round, prompt) => ({ resolvedIds: Object.values(findingIdBySubsystem(prompt)), findings: [], nowMs: 222, sessionId: 'sess-delta' }),
    });
    assert.equal(result.outcome, 'prepared', JSON.stringify(result));
    assert.equal(calls.admissionRenews, 6, 'Adjudicate, ProposalReview, delta-round-1, PlanAuthor, PlanCheck-round-1, Receipt');
    assert.equal(calls.writeTelemetryPrompts.length, 1, 'the Receipt success path threads the flags on its existing --record-generation --no-release dispatch');
    const spans = extractDoubleJsonFlag(calls.writeTelemetryPrompts[0], 'phaseTimings');
    // RENEWAL-BOUNDED EQUALITY (AC2): the admission-touching dispatch count on the renewal metric
    // (each successful renewal CLOSES one span; the terminal close appends the trailing entry)
    // equals the phaseTimings entry count — NOT the raw phase() call count (11 live/16 raw).
    assert.equal(spans.length, calls.admissionRenews + 1, `expected ${calls.admissionRenews} closed spans + 1 trailing entry, got ${spans.length}`);
    // Seeded EXCLUSIVELY from the parsed --acquire verdict's nowMs (CLAIM C4) — never a workflow clock.
    assert.equal(spans[0].startedAtMs, 500);
    // Contiguous spans: each entry's end is the next entry's start.
    for (let i = 0; i < spans.length - 1; i++) {
      assert.equal(spans[i + 1].startedAtMs, spans[i].endedAtMs, `span ${i + 1} must start where span ${i} ended`);
    }
    assert.deepEqual(spans.map((s) => s.phase), [
      'Adjudicate', 'ProposalReview', 'ProposalReview-delta-round-1', 'PlanAuthor', 'PlanCheck-round-1', 'Receipt',
      'Receipt', // the trailing open entry the RECEIVER closes with its own recordedAtMs (CLAIM C5)
    ]);
    const byPhase = Object.fromEntries(spans.slice(0, 6).map((s) => [s.phase, s]));
    assert.equal(byPhase['ProposalReview-delta-round-1'].round, 1, 'the delta span carries _deltaRound (caller-owned)');
    assert.equal(byPhase['PlanCheck-round-1'].round, 1, 'the PlanCheck span carries _planCheckRound (caller-owned)');
    assert.equal(byPhase['Adjudicate'].round, 0);
    // The trailing entry: dispatched OPEN — the receiver fills endedAtMs, never the sandbox.
    const trailing = spans[spans.length - 1];
    assert.equal(trailing.round, 0);
    assert.equal(trailing.endedAtMs, null, 'endedAtMs: null on dispatch — closed receiver-side (CLAIM C5)');
    assert.equal(trailing.startedAtMs, spans[5].endedAtMs);
    // findingCodes on the Receipt success path: terminal reason + the ledger's own finding ids
    // (_ledgerLive is true by Receipt — the ledger's blocking finding id joins).
    const codes = extractDoubleJsonFlag(calls.writeTelemetryPrompts[0], 'findingCodes');
    assert.equal(codes[0], 'prepared');
    assert.ok(codes.length >= 2, `the ledger's finding id must join the codes post-ledger, got ${JSON.stringify(codes)}`);
  });

  test(`[${mirrorName}] M207/AC8 (CLAIM C3 fail-soft): renewals without a finite nowMs push NOTHING and leave _lastBoundaryMs unchanged — only the acquire seed + trailing entry survive`, async () => {
    const { result, calls } = await runFullGeneration({
      onAcquire: () => ({ raw: JSON.stringify({ outcome: 'acquired', lease: { fencingToken: 0 }, reclaimed: false, nowMs: 700 }) }),
      onRenew: () => ({ raw: JSON.stringify({ ok: true }) }), // success, but NO nowMs (older-subprocess interop)
    });
    assert.equal(result.outcome, 'prepared', JSON.stringify(result));
    assert.equal(calls.admissionRenews, 5, 'zero-finding generation: Adjudicate, ProposalReview, PlanAuthor, PlanCheck-round-1, Receipt');
    const spans = extractDoubleJsonFlag(calls.writeTelemetryPrompts[0], 'phaseTimings');
    assert.equal(spans.length, 1, 'no boundary pushed for nowMs-less renewals — only the trailing entry remains');
    assert.equal(spans[0].startedAtMs, 700, '_lastBoundaryMs stayed at the acquire seed — unchanged');
    assert.equal(spans[0].endedAtMs, null);
  });

  test(`[${mirrorName}] M207/AC8 (CLAIM C3 push-rule precision): an ok:false renewal that EVEN CARRIES a nowMs pushes nothing — the rule is ok===true AND finite nowMs`, async () => {
    let n = 0;
    const { result, calls } = await runFullGeneration({
      onAcquire: () => ({ raw: JSON.stringify({ outcome: 'acquired', lease: { fencingToken: 0 }, reclaimed: false, nowMs: 100 }) }),
      onRenew: () => (++n === 1
        ? { raw: JSON.stringify({ ok: false, error: 'lease-missing', nowMs: 150 }) }
        : { raw: JSON.stringify({ ok: true, nowMs: 100 + n * 100 }) }),
    });
    assert.equal(result.outcome, 'prepared', JSON.stringify(result));
    const spans = extractDoubleJsonFlag(calls.writeTelemetryPrompts[0], 'phaseTimings');
    assert.equal(spans.length, calls.admissionRenews, 'one failed renewal -> one fewer closed span, plus the trailing entry');
    assert.ok(!spans.some((s) => s.endedAtMs === 150), "the ok:false renewal's nowMs must NOT become a boundary");
  });

  test(`[${mirrorName}] M207/AC9/AC10 (CLAIM C6 TDZ): a pre-ledger terminal exit produces findingCodes from the reason alone with NO ReferenceError — the _ledgerLive short-circuit, never _ledger?.map(...)`, async () => {
    const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
    try {
      const { result, calls } = await runPrepareMilestone(workflowFile, baseArgs(scratchRel), taskFileOnDisk, {
        // Unparseable preflight verdict -> the preflight-check-failed terminal, which fires
        // BEFORE `let _ledger = []` has executed — the TDZ hazard site. Any reference to the
        // uninitialized _ledger (even optional-chained) would throw ReferenceError and crash the
        // failure-path telemetry itself.
        onPreflightContent: () => ({ raw: 'NOT-JSON noise [unbalanced' }),
        onAcquire: () => ({ raw: JSON.stringify({ outcome: 'acquired', lease: { fencingToken: 0 }, reclaimed: false, nowMs: 42 }) }),
      });
      assert.equal(result.reason, 'preflight-check-failed', JSON.stringify(result));
      assert.equal(calls.releasePrompts.length, 1);
      const codes = extractDoubleJsonFlag(calls.releasePrompts[0], 'findingCodes');
      assert.deepEqual(codes, ['preflight-check-failed'], 'pre-ledger exit: exactly [reason] — no ledger entries fabricated');
      const spans = extractDoubleJsonFlag(calls.releasePrompts[0], 'phaseTimings');
      assert.equal(spans.length, 1, 'no renewal ran — only the trailing open entry');
      assert.equal(spans[0].phase, 'preflight-check-failed');
      assert.equal(spans[0].startedAtMs, 42, 'seeded from the parsed acquire verdict');
      assert.equal(spans[0].endedAtMs, null);
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  test(`[${mirrorName}] M207/AC10 (CLAIM C6): all 3 pre-lease --record-attempt exits independently produce a non-empty findingCodes array seeded from the site name alone, with phaseTimings [] by construction`, async () => {
    // Site 1: missing-required-args — taskId absent entirely (runs before ANY other state).
    {
      const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
      try {
        const args = baseArgs(scratchRel);
        delete args.taskId;
        const { result, calls } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk, {});
        assert.match(result.reason, /missing-required-args/);
        assert.equal(calls.recordAttemptPrompts.length, 1);
        assert.deepEqual(extractDoubleJsonFlag(calls.recordAttemptPrompts[0], 'findingCodes'), ['missing-required-args']);
        assert.deepEqual(extractDoubleJsonFlag(calls.recordAttemptPrompts[0], 'phaseTimings'), []);
      } finally {
        fs.rmSync(scratchDir, { recursive: true, force: true });
      }
    }
    // Site 2: prepare-already-running — a contention verdict at --acquire.
    {
      const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
      try {
        const { result, calls } = await runPrepareMilestone(workflowFile, baseArgs(scratchRel), taskFileOnDisk, {
          onAcquire: () => ({ raw: JSON.stringify({ outcome: 'prepare-already-running', owner: { ownerExecutionId: 'other-session', stage: 'ProposalReview', leaseUntil: 999 }, nowMs: 77 }) }),
        });
        assert.equal(result.reason, 'prepare-already-running');
        assert.equal(calls.recordAttemptPrompts.length, 1);
        assert.deepEqual(extractDoubleJsonFlag(calls.recordAttemptPrompts[0], 'findingCodes'), ['prepare-already-running']);
        assert.deepEqual(extractDoubleJsonFlag(calls.recordAttemptPrompts[0], 'phaseTimings'), [], 'pre-lease: zero completed spans, no trailing entry');
      } finally {
        fs.rmSync(scratchDir, { recursive: true, force: true });
      }
    }
    // Site 3: admission-check-failed — an unparseable --acquire verdict.
    {
      const { scratchDir, scratchRel, taskFileOnDisk } = makeScratch();
      try {
        const { result, calls } = await runPrepareMilestone(workflowFile, baseArgs(scratchRel), taskFileOnDisk, {
          onAcquire: () => ({ raw: null }),
        });
        assert.equal(result.reason, 'admission-check-failed');
        assert.equal(calls.recordAttemptPrompts.length, 1);
        assert.deepEqual(extractDoubleJsonFlag(calls.recordAttemptPrompts[0], 'findingCodes'), ['admission-check-failed']);
        assert.deepEqual(extractDoubleJsonFlag(calls.recordAttemptPrompts[0], 'phaseTimings'), []);
      } finally {
        fs.rmSync(scratchDir, { recursive: true, force: true });
      }
    }
  });

  test(`[${mirrorName}] M207/AC1/AC7 (CLAIM C2): all 6 _renewLease call sites pass round explicitly (caller-owned values only); responses parse via _parseAgentJson under the exact push rule; zero regex-parsing of stageLabel`, () => {
    const text = fs.readFileSync(workflowFile, 'utf8');
    const stripped = text.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
    // (a) exactly 6 _renewLease(label, round) call sites (the DEFINITION's bare-identifier params
    // never match the quoted/template-literal first-argument shape).
    const renewCalls = [...stripped.matchAll(/_renewLease\((`[^`]+`|'[^']+'),\s*([A-Za-z0-9_]+)\)/g)];
    assert.equal(renewCalls.length, 6, `expected exactly 6 _renewLease(label, round) call sites, found ${renewCalls.length}`);
    const boundaryRefs = [...stripped.matchAll(/_recordPhaseBoundary\(/g)];
    assert.equal(boundaryRefs.length, 7, 'one _recordPhaseBoundary definition + 6 call sites');
    // (b) round values are ONLY caller-owned identifiers/literals — never derived from the label.
    for (const m of renewCalls) {
      assert.match(m[2], /^(0|_deltaRound|_planCheckRound)$/, `round at a _renewLease site must be caller-owned (0/_deltaRound/_planCheckRound), got '${m[2]}'`);
    }
    // (c) NEGATIVE: no regex-parse of the formatted stageLabel recovers round anywhere.
    assert.ok(!/stageLabel\.(match|split|replace|indexOf)\(/.test(stripped), 'stageLabel must never be parsed — it is presentation, not structured data');
    assert.ok(!/RegExp\([^)]*round/.test(stripped), 'no RegExp over a round pattern');
    // (d) renewal responses parse via the existing balanced-brace scanner under the exact rule.
    const boundaryBody = stripped.slice(stripped.indexOf('function _recordPhaseBoundary'));
    assert.match(boundaryBody, /_parseAgentJson\(/, 'parsed via _parseAgentJson, never naive JSON.parse');
    assert.match(boundaryBody, /v\.ok === true && Number\.isFinite\(v\.nowMs\)/, 'push rule = ok===true AND finite nowMs, exactly');
  });

  test(`[${mirrorName}] M207/AC1 (CLAIM C5 sender half): the trailing open span is dispatched endedAtMs:null (receiver-side close); BOTH record-writing helpers thread the flags while --release-only gains nothing`, () => {
    const text = fs.readFileSync(workflowFile, 'utf8');
    const stripped = text.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
    assert.match(stripped, /function _phaseTimingsForTerminal\(stageLabel\)\s*\{\s*return \[\.\.\._phaseTimings, \{ phase: stageLabel, round: 0, startedAtMs: _lastBoundaryMs, endedAtMs: null \}\]/, 'the trailing entry is dispatched OPEN (endedAtMs: null) for receiver-side close');
    const releaseAndRecord = stripped.slice(stripped.indexOf('async function _releaseLeaseAndRecord'), stripped.indexOf('async function _writeGenerationTelemetry'));
    assert.match(releaseAndRecord, /--phaseTimings /);
    assert.match(releaseAndRecord, /--findingCodes /);
    const writeTel = stripped.slice(stripped.indexOf('async function _writeGenerationTelemetry'), stripped.indexOf('async function _releaseLease(stageLabel'));
    assert.match(writeTel, /--phaseTimings /);
    assert.match(writeTel, /--findingCodes /);
    const releaseOnly = stripped.slice(stripped.indexOf('async function _releaseLease(stageLabel'), stripped.indexOf('async function _preflightAgentCall'));
    assert.ok(!releaseOnly.includes('--phaseTimings'), '--release-only writes no telemetry — gains nothing');
    assert.ok(!releaseOnly.includes('--findingCodes'), '--release-only writes no telemetry — gains nothing');
  });
}
