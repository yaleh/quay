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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPreparation } from '../../experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIRRORS = [
  ['.claude/workflows/prepare-milestone.js', path.join(REPO_ROOT, '.claude', 'workflows', 'prepare-milestone.js')],
  ['plugin/workflows/prepare-milestone.js', path.join(REPO_ROOT, 'plugin', 'workflows', 'prepare-milestone.js')],
];
const FIXTURES = path.join(REPO_ROOT, 'experiments', 'quay-perpetual-stream', 'fixtures', 'preparation');
const REPLAY_FINDINGS = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'dir120-replay-findings.json'), 'utf8')).findings;

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

function extractNodeCommands(prompt) {
  return [...prompt.matchAll(/node --experimental-strip-types [^\n]+/g)].map((m) => m[0]);
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
  const calls = { authors: [], adjudicator: 0, reviews: [], revises: [], wiringChecks: 0, planAuthor: 0, planCheckers: [], admissionAcquires: 0, admissionRenews: 0, admissionReleases: 0, preflightContent: 0, preflightPlan: 0, resumeDecisions: 0 };
  let planFile = null;
  let ledger = null;

  const agentMock = async (prompt, opts = {}) => {
    const label = opts.label || '';

    // M200/DIR-126-A: the new Admission phase's agent()-dispatched CLI calls. Mocked directly
    // (never touching real .quay/prepare-leases/ state) — this file's job is proving the
    // ProposalReview convergence loop's OWN wiring, not re-testing prepare-admission-check.ts
    // (that has its own dedicated experiments/quay-perpetual-stream/test/
    // prepare-admission-check.test.mjs). Every generation in this file always wins admission.
    if (label === 'admission-acquire') {
      calls.admissionAcquires += 1;
      return { raw: JSON.stringify({ outcome: 'acquired', lease: { fencingToken: 0 }, reclaimed: false }) };
    }
    if (/^admission-renew-/.test(label)) {
      calls.admissionRenews += 1;
      return { raw: JSON.stringify({ ok: true }) };
    }
    if (/^admission-release-/.test(label)) {
      // M202/DIR-126-C: `_releaseLeaseAndRecord` dispatches proposal-convergence.ts
      // --record-generation under the SAME `admission-release-${stageLabel}` label
      // `_releaseLease` used (label continuity, Plan-level refinement) — this pre-existing branch
      // already covers every one of the 15 real terminal-return sites' new record-generation
      // dispatch, unchanged. The mock's {ok:true} response keeps being ignored (fire-and-forget,
      // exactly as today).
      calls.admissionReleases += 1;
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

    // M201/DIR-126-B: the new Preflight phase's agent()-dispatched CLI calls (content, then
    // plan-shape). Mocked with a default non-blocking verdict so every existing scenario in this
    // file that doesn't care about Preflight still passes unchanged — mirroring exactly how the
    // Admission mocks above are handled. Preflight's OWN detector logic has its own dedicated
    // experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs coverage.
    if (label === 'preflight-content') {
      calls.preflightContent = (calls.preflightContent || 0) + 1;
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
    if (label === 'receipt') {
      const { ledgerFile, ledgerJson } = ledgerFromPrompt(prompt);
      fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
      fs.writeFileSync(ledgerFile, ledgerJson);
      ledger = JSON.parse(ledgerJson);
      const cmds = extractNodeCommands(prompt);
      assert.equal(cmds.length, 2, `expected exactly 2 node commands in the Receipt prompt, got ${cmds.length}:\n${prompt}`);
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
    const calls = { authors: [] };
    const agentMock = async (prompt, opts = {}) => {
      const label = opts.label || '';
      if (label === 'admission-acquire') return { raw: 'not valid json {{{' };
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

  test(`[${mirrorName}] WIRING-CLAIM R5: exactly 15 real _releaseLeaseAndRecord( call sites, zero remaining bare _releaseLease( calls`, () => {
    const text = src();
    // The baseline live count this Plan re-derives from git history (480cb58): 15 real
    // post-Admission _releaseLease( terminal-return call sites, not an assumed 11 or 12. Anchor on
    // `await _releaseLease(` — a bare `grep -c "_releaseLease("` also matches the helper's OWN
    // `async function _releaseLease(stageLabel) {` definition line, over-counting by one.
    const baseline = execSync(`git show 480cb58:${mirrorName} | grep -c "await _releaseLease("`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    assert.equal(baseline, '15', 'the historical baseline this child replaces is 15 real call sites');

    // The landed file: zero bare `_releaseLease(` identifier occurrences (the helper itself was
    // removed, not just its call sites renamed) ...
    assert.doesNotMatch(text, /(?<!AndRecord)\b_releaseLease\(/, 'zero remaining bare _releaseLease( calls — the now-callerless helper was removed');
    // ... and exactly 15 real `await _releaseLeaseAndRecord(` call sites (the function's OWN
    // definition line also contains the substring `_releaseLeaseAndRecord(`, so anchor on the
    // `await` prefix every real call site — and only a call site — carries).
    const callSites = [...text.matchAll(/await _releaseLeaseAndRecord\(/g)];
    assert.equal(callSites.length, 15, `expected exactly 15 await _releaseLeaseAndRecord( call sites, found ${callSites.length}`);
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

  test(`[${mirrorName}] WIRING-CLAIM R9: git diff --stat against prepare-admission-check.ts and .gitignore is empty for this child's own commits (base 480cb58)`, () => {
    const out = execSync(
      `git diff --stat 480cb58..HEAD -- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts plugin/scripts/prepare-admission-check.ts .gitignore`,
      { cwd: REPO_ROOT, encoding: 'utf8' }
    ).trim();
    assert.equal(out, '', `expected an empty diff against prepare-admission-check.ts/.gitignore since base 480cb58, got:\n${out}`);
  });
}
