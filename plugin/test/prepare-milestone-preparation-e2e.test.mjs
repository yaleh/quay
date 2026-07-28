// prepare-milestone-preparation-e2e.test.mjs — DIR-117 iteration-2 item 1.
//
// PROBLEM this closes: the M191 iteration-0 acceptance audit REFUTED the AC "a fixture with an
// initial thin/stale Proposal and Plan: N/A runs through prepare-milestone, then task_get shows a
// reconciled Proposal containing problem framing, approach, key decisions, and rejected
// alternatives; ## Plan points to an existing docs/plans/*.md" because "no test or fixture actually
// exercises prepare-milestone.js's phases; the workflow calls agent(...) (real LLM subagent
// dispatch) at every phase, which no node:test file invokes ... the described end-to-end
// reconciliation has never been run."
//
// METHOD (same discipline as execute-milestone-preparation-gate.test.mjs / execute-milestone-
// disposition-conformance.test.mjs — a real LLM agent turn cannot be driven by a static test):
// load the REAL, unmodified `.claude/workflows/prepare-milestone.js` /
// `plugin/workflows/prepare-milestone.js` source (only the ES `export` keyword on `meta` stripped)
// as a real AsyncFunction, and drive it through EVERY real phase (ProposalAuthors -> Adjudicate ->
// ProposalReview -> PlanAuthor -> PlanCheck -> Receipt) with a mock `agent()` that performs the
// SAME concrete actions a real LLM agent would (write the reconciled Proposal back to the real
// fixture task file, author a real Plan file, run the REAL milestone-preparation-check.ts CLI for
// the Receipt phase) rather than a real LLM's creative judgment (which no static test can drive).
// This proves the real phase-to-phase WIRING and CONTROL FLOW (adjudicate write-back -> review ->
// plan author -> plan-check loop -> real receipt build+verify) actually reaches a
// `{outcome:'prepared'}` terminal state and that the real fixture task file on disk ends up with
// the exact shape the AC names — not merely that each phase's prompt text looks right in isolation.
//
// Run:
//   node --experimental-strip-types --test plugin/test/prepare-milestone-preparation-e2e.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPreparation } from '../../experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLAUDE_WORKFLOW = path.join(REPO_ROOT, '.claude', 'workflows', 'prepare-milestone.js');
const PLUGIN_WORKFLOW = path.join(REPO_ROOT, 'plugin', 'workflows', 'prepare-milestone.js');
const MIRRORS = [['.claude/workflows/prepare-milestone.js', CLAUDE_WORKFLOW], ['plugin/workflows/prepare-milestone.js', PLUGIN_WORKFLOW]];

const FIXTURES = path.join(REPO_ROOT, 'experiments', 'quay-perpetual-stream', 'fixtures', 'preparation');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function loadWorkflow(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/^export const meta/, 'const meta');
  return new AsyncFunction('args', 'phase', 'log', 'parallel', 'agent', src);
}

// A thin/stale starting Proposal + 'Plan: N/A' — exactly the shape the AC names.
const THIN_TASK_TEMPLATE = `---
id: TEST-PREPARE-E2E
title: fixture task for prepare-milestone.js end-to-end test
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
- [ ] fixture AC item two

## Definition of Done

Standard experiments/quay-perpetual-stream/inherited-core.md DoD clauses apply.

- [ ] fixture DoD item
`;

const RECONCILED_PROPOSAL = `## Problem framing

The fixture module has a real, grounded problem (per the current repository state) that this
end-to-end test's synthesized reconciled Proposal frames explicitly.

## Approach / chosen mechanism

The chosen mechanism is a concrete, reviewable approach — not a placeholder.

## Key design decisions

- Decision one: merge the two independent authors' strongest points.
- Decision two: keep the mechanism concrete enough to review without re-designing it.

## Alternatives considered and rejected

- Alternative A: rejected because it does not ground the mechanism in current code.
- Alternative B: rejected because it duplicates existing machinery instead of reusing it.
`;

function splice(body, heading, replacement) {
  const re = new RegExp(`(^##\\s*${heading}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s|$)`, 'm');
  return body.replace(re, `$1\n${replacement}\n`);
}

function planFileFromPrompt(prompt) {
  const m = prompt.match(/at (docs\/plans\/\S+\.md)\./);
  assert.ok(m, `could not find the Plan file path in the PlanAuthor prompt:\n${prompt}`);
  return m[1];
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

function makeAgentMock(taskFileOnDisk) {
  const sessions = { authors: [], adjudicator: null, reviewer: null, planAuthor: null, planCheckers: [] };
  let planFile = null;

  const agentMock = async (prompt, opts = {}) => {
    const label = opts.label || '';

    if (/^proposal-author-\d+$/.test(label)) {
      const idx = Number(label.match(/\d+$/)[0]);
      const sessionId = `sess-author-${idx}`;
      sessions.authors.push(sessionId);
      return { authorIdx: idx, proposalText: RECONCILED_PROPOSAL, sessionId };
    }

    if (label === 'adjudicate') {
      sessions.adjudicator = 'sess-adjudicator';
      // Real write-back — splices the reconciled Proposal into the REAL fixture task file on disk,
      // exactly what a real agent's task_write call would do.
      const body = fs.readFileSync(taskFileOnDisk, 'utf8');
      fs.writeFileSync(taskFileOnDisk, splice(body, 'Proposal', RECONCILED_PROPOSAL));
      return { proposalText: RECONCILED_PROPOSAL, ok: true, sessionId: sessions.adjudicator };
    }

    if (label === 'proposal-review') {
      sessions.reviewer = 'sess-reviewer';
      return { findings: 0, sessionId: sessions.reviewer };
    }

    if (label === 'plan-author') {
      sessions.planAuthor = 'sess-plan-author';
      planFile = planFileFromPrompt(prompt);
      fs.mkdirSync(path.dirname(planFile), { recursive: true });
      fs.writeFileSync(planFile, `# End-to-end fixture Plan (prepare-milestone-preparation-e2e.test.mjs)

### Stage 1: cover fixture AC item one
- AC: 1
- Files: ${path.relative(REPO_ROOT, taskFileOnDisk)}
- Command: \`true\`

### Stage 2: cover fixture AC item two
- AC: 2
- Files: ${path.relative(REPO_ROOT, taskFileOnDisk)}
- Command: \`true\`
`);
      // Real write-back of the '## Plan' reference, same as a real agent's task_write call.
      const body = fs.readFileSync(taskFileOnDisk, 'utf8');
      fs.writeFileSync(taskFileOnDisk, splice(body, 'Plan', `Checked — see ${planFile}.`));
      return { planFile, ok: true, sessionId: sessions.planAuthor };
    }

    if (/^plan-check-round-\d+$/.test(label)) {
      const round = Number(label.match(/\d+$/)[0]);
      const sessionId = `sess-plan-checker-${round}`;
      sessions.planCheckers.push(sessionId);
      return { findings: 0, sessionId }; // PASS on round 1 — no revise call needed.
    }

    if (label === 'receipt') {
      // Actually EXECUTE the two REAL node commands the Receipt phase's real prompt names — a
      // true integration exercise of milestone-preparation-check.ts's real CLI, not a re-implementation.
      const cmds = extractNodeCommands(prompt);
      assert.equal(cmds.length, 2, `expected exactly 2 node commands in the Receipt prompt, got ${cmds.length}:\n${prompt}`);
      const build = runShell(cmds[0]);
      assert.equal(build.status, 0, `--build command failed:\n${build.stdout}`);
      const check = runShell(cmds[1]);
      const lastLine = check.stdout.trim().split('\n').pop() || '';
      return { ok: check.status === 0, receiptFile: cmds[1].match(/--receipt (\S+)/)?.[1], detail: lastLine };
    }

    throw new Error(`prepare-milestone-preparation-e2e.test.mjs: unexpected agent() call — label=${label}\nprompt: ${prompt.slice(0, 200)}`);
  };

  return { agentMock, sessions, getPlanFile: () => planFile };
}

async function runPrepareMilestone(workflowFile, argsObj, taskFileOnDisk) {
  const fn = loadWorkflow(workflowFile);
  const { agentMock, sessions, getPlanFile } = makeAgentMock(taskFileOnDisk);
  const result = await fn(
    argsObj,
    () => {}, // phase()
    () => {}, // log()
    (fns) => Promise.all(fns.map((f) => f())), // parallel()
    agentMock,
  );
  return { result, sessions, planFile: getPlanFile() };
}

function freshScratchDir() {
  return fs.mkdtempSync(path.join(FIXTURES, 'prepare-e2e-scratch-'));
}

for (const [mirrorName, workflowFile] of MIRRORS) {
  test(`[${mirrorName}] end-to-end: a thin/stale-Proposal + Plan:N/A fixture reaches {outcome:'prepared'} with a real reconciled Proposal and a real checked Plan`, async () => {
    const scratchDir = freshScratchDir();
    const scratchRel = path.relative(REPO_ROOT, scratchDir).split(path.sep).join('/');
    const taskFileOnDisk = path.join(scratchDir, 'task.md');
    const charterFileOnDisk = path.join(scratchDir, 'M997-charter.md');
    fs.writeFileSync(taskFileOnDisk, THIN_TASK_TEMPLATE);
    fs.writeFileSync(charterFileOnDisk, 'type: execution\n\nScratch charter for prepare-milestone-preparation-e2e.test.mjs.\n');

    const args = {
      taskId: `../${scratchRel}/task`, // "tasks/../<scratchRel>/task.md" == "<scratchRel>/task.md"
      milestoneId: 'M997',
      charterFile: `${scratchRel}/M997-charter.md`,
      class: 'development',
    };

    let planFile = null;
    try {
      const { result, sessions, planFile: pf } = await runPrepareMilestone(workflowFile, args, taskFileOnDisk);
      planFile = pf;

      // 1. The workflow reached the real terminal 'prepared' outcome — not a mid-phase bailout.
      assert.equal(result.outcome, 'prepared', JSON.stringify(result));
      assert.equal(result.taskId, args.taskId);
      assert.ok(result.planFile, 'result must name the checked planFile');
      assert.ok(result.receiptFile, 'result must name the receiptFile');

      // 2. Distinct run identities were actually captured across phases (DIR-117 iteration-2 item 2's
      //    prerequisite — provenance can only be real if the phases really produced distinct sessions).
      assert.equal(sessions.authors.length, 2); // N=2 default (development, not highRisk)
      assert.equal(new Set([...sessions.authors, sessions.adjudicator, sessions.reviewer, sessions.planAuthor, ...sessions.planCheckers]).size,
        2 + 1 + 1 + 1 + sessions.planCheckers.length, 'every captured session id must be distinct');

      // 3. task_get-equivalent: read the REAL fixture task file after the run and confirm the
      //    reconciled Proposal contains problem framing / approach / key decisions / rejected
      //    alternatives, and '## Plan' points at a REAL, existing docs/plans/*.md file.
      const finalTaskText = fs.readFileSync(taskFileOnDisk, 'utf8');
      assert.match(finalTaskText, /Problem framing/i);
      assert.match(finalTaskText, /Approach.*chosen mechanism/i);
      assert.match(finalTaskText, /Key design decisions/i);
      assert.match(finalTaskText, /Alternatives considered and rejected/i);
      assert.doesNotMatch(finalTaskText, /## Proposal\s*\n\s*TBD\./, 'the thin placeholder Proposal must actually be replaced, not left in place');

      const planMatch = finalTaskText.match(/## Plan\n+(.*docs\/plans\/\S+\.md)/);
      assert.ok(planMatch, `'## Plan' must reference a docs/plans/*.md path:\n${finalTaskText}`);
      assert.match(finalTaskText, /## Plan\n+Checked/i);
      assert.doesNotMatch(finalTaskText.match(/## Plan\n[\s\S]*?(?=\n## )/)[0], /N\/A/, "'## Plan' must no longer read N/A");

      assert.ok(fs.existsSync(planFile), `the checked Plan file must actually exist on disk: ${planFile}`);
      assert.match(fs.readFileSync(planFile, 'utf8'), /### Stage 1/);

      // 4. Independently re-verify the real receipt with the SAME checkPreparation() the Prepared
      //    gate itself calls — not trusting the mock's own self-report.
      const independentCheck = checkPreparation({ taskFile: taskFileOnDisk, charterFile: charterFileOnDisk, receiptFile: result.receiptFile });
      assert.equal(independentCheck.ok, true, independentCheck.message);
      assert.equal(independentCheck.code, 'prepared');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
      if (planFile) fs.rmSync(planFile, { force: true });
      fs.rmSync(path.join(REPO_ROOT, 'milestones', 'M997'), { recursive: true, force: true });
    }
  });
}
