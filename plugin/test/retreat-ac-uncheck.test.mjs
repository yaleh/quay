// @test-group engine
// plugin/test/retreat-ac-uncheck.test.mjs — gap-not-yet-flipped-blocks-retreated-ac83-class.
//
// AC83: `retreat` (done→ready) only flipped `status`, leaving the task's `## Acceptance Criteria`
// checkboxes checked — so a retreated task (e.g. gap-phase-boundary-differential-accounting:
// done→ready at 916e849e) still "claimed" completion (AC 89% = 8/9) even though its AC1-4 were
// satisfied by injected fixtures with 0 production data. slot-refill's not-yet-flipped guard
// (merged + AC>50% ⇒ landed ⇒ don't re-dispatch) read that stale claim and judged the task landed.
//
// This test pins the fix in `runRetreat` (packages/quay/src/gate/lifecycle.ts): the done→ready edge
// UNCHECKS the AC checkboxes (`- [x]` / `- [X]` → `- [ ]`) so a retreated task's AC completion
// reflects reality (falsifiable — AC2). A genuinely-landed done task is NOT affected (AC3), and the
// retreat still flips done→ready + records the GateEvent reason (deliverable).
//
// Run: node --test plugin/test/retreat-ac-uncheck.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runRetreat, RETREATED_MARKER_RE } from "../../packages/quay/src/gate/lifecycle.ts";
import { queryGateEvents } from "../../packages/quay/src/gate/gate-event-store.ts";
import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Phase A stub client (mirrors packages/quay/test/lifecycle.test.mjs) ───────────────
// Captures every taskWrite patch so tests can assert the AC unchecking actually reached
// the provider write (and that non-retreat paths write no body patch).
function stubClient(task) {
  const state = { ...task };
  const writes = [];
  return {
    async taskGet() {
      return { ...state };
    },
    async taskCheck() {
      return { ok: state.status === "ready" ? false : true, reason: "stub" };
    },
    async taskWrite({ id, status, expectedStatus, body }) {
      if (expectedStatus && state.status !== expectedStatus) throw new Error("ConflictError");
      writes.push({ status, body });
      if (body !== undefined) state.body = body;
      state.status = status;
      return { ...state };
    },
    _state: state,
    _writes: writes,
  };
}

function tmpLog(tag) {
  return path.join(makeTmpDir(`quay-ac83-${tag}-`), "gate-events.jsonl");
}

function resetExit() {
  process.exitCode = 0;
}

/** Count `- [x]`/`- [X]` boxes inside the `## Acceptance Criteria` section only
 *  (the shape-aware heading family — same forms `uncheckAcBoxes` recognizes). */
function checkedInAcSection(body) {
  let inAc = false;
  let count = 0;
  for (const line of body.split("\n")) {
    if (/^##\s/.test(line)) {
      inAc = /^##\s+(?:AC(?:（[^）]*）| \([^)]*\))?|Acceptance Criteria)\s*$/.test(line);
      continue;
    }
    if (inAc && /^\s*-\s+\[[xX]\]/.test(line)) count++;
  }
  return count;
}

/** The AC83 real-sample shape: 8/9 AC boxes checked — the fixture-satisfied claim
 *  that must NOT survive a retreat. AC5 is the production-truth criterion that stays
 *  unchecked; the `## DoD` box is deliberately checked to prove the uncheck is
 *  AC-section-scoped (DoD is left alone). */
function ac83Body() {
  return (
    "## Proposal\nproposal text\n" +
    "## Plan\nplan text\n" +
    "## Acceptance Criteria\n" +
    "- [x] AC1 satisfied by injected fixture\n" +
    "- [x] AC2 satisfied by injected fixture\n" +
    "- [x] AC3 satisfied by injected fixture\n" +
    "- [x] AC4 satisfied by injected fixture\n" +
    "- [ ] AC5 production data truth\n" +
    "- [x] AC6\n" +
    "- [x] AC7\n" +
    "- [x] AC8\n" +
    "- [x] AC9\n" +
    "## DoD\n- [x] definition of done\n"
  );
}

// ===========================================================================
// AC1 / AC2 (falsifiable): retreat done→ready unchecks the AC checkboxes
// ===========================================================================

test("AC1/AC2: retreat done→ready unchecks the AC boxes (89%→0% — completion reflects reality), still flips done→ready, records the reason", async () => {
  resetExit();
  const logPath = tmpLog("done-uncheck");
  const client = stubClient({ id: "T-AC83", status: "done", body: ac83Body(), extra: {} });
  assert.equal(checkedInAcSection(client._state.body), 8, "precondition: the real sample is 8/9 (89%) checked");

  const r = await runRetreat({
    client,
    id: "T-AC83",
    reason: "AC1-4 satisfied by injected fixtures, not production data",
    logPath,
  });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.equal(client._state.status, "ready", "retreat still flips done→ready");

  // The provider write must carry a body patch with every AC box unchecked.
  const bodyWrite = client._writes.find((w) => w.body !== undefined);
  assert.ok(bodyWrite, "retreat of a done task with checked ACs must write a body patch");
  assert.equal(checkedInAcSection(bodyWrite.body), 0, `AC completion must reflect reality; got ${checkedInAcSection(bodyWrite.body)} checked`);
  assert.match(bodyWrite.body, /- \[ \] AC1 satisfied by injected fixture/, "AC1 unchecked");
  assert.match(bodyWrite.body, /- \[ \] AC9/, "AC9 unchecked");
  assert.match(bodyWrite.body, /- \[ \] AC5 production data truth/, "AC5 stays unchecked");
  assert.match(bodyWrite.body, /## DoD\n- \[x\] definition of done/, "DoD is NOT touched — the uncheck is AC-section-scoped");

  // The retreat GateEvent (deliverable = the reason) is still recorded.
  const events = queryGateEvents(logPath, { pipeline_id: "T-AC83" });
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "retreat");
  assert.equal(events[0].verdict, "pass");
  assert.deepEqual(events[0].payload, {
    from: "done",
    to: "ready",
    reason: "AC1-4 satisfied by injected fixtures, not production data",
  });
  resetExit();
});

// ===========================================================================
// AC3: a genuinely-landed done task is NOT affected
// ===========================================================================

test("AC3: a genuinely-landed done task (never retreated) keeps its checked ACs — retreat is the only unchecker", async () => {
  resetExit();
  const client = stubClient({ id: "T-LANDED", status: "done", body: ac83Body(), extra: {} });
  assert.equal(checkedInAcSection(client._state.body), 8, "a genuine done task claims completion");

  // No lifecycle call at all: nothing rewrites the body — the completion claim is intact.
  assert.equal(client._writes.length, 0, "no write happens for a task that is not retreated");
  assert.equal(checkedInAcSection(client._state.body), 8, "a done task left alone keeps its checked ACs");

  // The FALSIFIABLE half: retreating a task on the ready→todo edge (not done→ready)
  // must NOT uncheck ACs — the uncheck is scoped to the done→ready rollback only.
  const logPath = tmpLog("ready-retreat");
  const readyClient = stubClient({ id: "T-READY", status: "ready", body: ac83Body(), extra: {} });
  const r = await runRetreat({ client: readyClient, id: "T-READY", reason: "re-triage", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "todo");
  assert.equal(readyClient._state.status, "todo");
  assert.equal(
    readyClient._writes.filter((w) => w.body !== undefined).length,
    0,
    "ready→todo retreat writes NO body patch — AC unchecking is done→ready-only"
  );
  assert.equal(checkedInAcSection(readyClient._state.body), 8, "ready→todo retreat leaves AC boxes untouched");
  resetExit();
});

// ===========================================================================
// Shape-aware heading family (per the author→ready gate's recognized forms)
// ===========================================================================

test("shape family: `## AC（draft）` / `## AC (draft)` AC boxes are also unchecked; an unrecognized AC heading fails open (body unchanged)", async () => {
  resetExit();

  const draftBody =
    "## Proposal\nproposal\n" +
    "## AC（draft）\n- [x] draft-ac-one\n- [x] draft-ac-two\n" +
    "## DoD\n- [x] dod\n";
  const logPath = tmpLog("draft-heading");
  const client = stubClient({ id: "T-DRAFT", status: "done", body: draftBody, extra: {} });
  const r = await runRetreat({ client, id: "T-DRAFT", reason: "re-verify", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.equal(checkedInAcSection(client._state.body), 0, "`## AC（draft）` boxes unchecked");
  assert.match(client._state.body, /## DoD\n- \[x\] dod/, "DoD untouched");
  resetExit();

  // Unrecognized AC heading → fails open: status flips, body passes through unchanged.
  // `## Acceptance Criteria (runnable — …)` is the hard-rule-3b form (task-status-drift-check
  // :126) — a parenthetical suffix the shape-aware gate itself does NOT read, so the helper
  // must not read it either (matching the gate's own recognized family, not widening it).
  const oddBody =
    "## Proposal\nproposal\n" +
    "## Acceptance Criteria (runnable — custom suffix)\n- [x] ac-one\n" +
    "## DoD\n- [x] dod\n";
  const logPath2 = tmpLog("unrecognized-heading");
  const client2 = stubClient({ id: "T-ODD", status: "done", body: oddBody, extra: {} });
  const r2 = await runRetreat({ client: client2, id: "T-ODD", reason: "rework", logPath: logPath2 });
  assert.equal(r2.ok, true);
  assert.equal(r2.to, "ready");
  // The unrecognized AC heading fails OPEN for the AC-uncheck (the checkbox stays checked), but the
  // done→ready `**RETREATED` marker IS still written (gap-wiring-C-retreat-write-side — a separate
  // write-side concern from AC unchecking; the marker is what shelves a retreated ready task).
  assert.match(client2._state.body, /- \[x\] ac-one/, "the checkbox under an unrecognized heading is left checked (AC-uncheck fails open)");
  assert.ok(RETREATED_MARKER_RE.test(client2._state.body), "the **RETREATED marker is written regardless of AC-heading recognition");
  resetExit();
});
