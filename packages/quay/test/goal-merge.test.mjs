// @test-group product
// goal-merge.test.mjs — `quay goal merge`'s request recording (SPEC-goal-branch-2026-10-03 §4.7).
//
// THE DEFECT CLASS THIS COVERS (硬规则 9): the human merge trigger is the ONE place a human assertion
// ("this goal is mature enough") must leave a durable product. If the verb merged silently in the
// human's terminal, or refused for a reason it did not name, "守规" and "不守" would be
// indistinguishable in the record. So the assertions below are about the EVENT WRITTEN (and, for every
// refusal, the event NOT written) — not about a return code alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { recordGoalMergeRequest, readGoalMergeRequests, pendingGoalMerges } from "../src/goal-merge.ts";

const _dirs = [];
test.after(() => {
  for (const d of _dirs) fs.rmSync(d, { recursive: true, force: true });
});

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function ledgerPath(root) {
  return path.join(root, ".quay", "gate-events.jsonl");
}

function requestEvents(root) {
  const p = ledgerPath(root);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => JSON.parse(l)).filter((e) => e.gate === "goal-merge-request");
}

function appendGoalEvent(root, acId, verdict) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.appendFileSync(ledgerPath(root), JSON.stringify({
    id: `ev-${acId}-${verdict}`, item_id: acId, pipeline_id: acId, gate: "goal",
    actor: "test", verdict, timestamp: new Date().toISOString(), payload: { reason: "fixture" },
  }) + "\n");
}

/** Append a `goal-merge-result` event as the worker-driver's fan-in writes it (the shape
 *  `readGoalMergeResults` reads back). Lets a test stage an infrastructure-red ledger without running
 *  the whole merge. */
function appendGoalMergeResult(root, { goalId = "GOAL-900", tipSha, requestEventId, timestamp, step = "suite" }) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.appendFileSync(ledgerPath(root), JSON.stringify({
    id: `res-${requestEventId}`, item_id: goalId, pipeline_id: goalId, gate: "goal-merge-result",
    actor: "quay-driver", verdict: "fail", timestamp,
    payload: { outcome: "red", step, reason: "boom", tipSha, requestEventId, landedSha: null },
  }) + "\n");
}

/** A git repo with a GOAL record, a develop branch, and (unless `branchRef:false`) a `goal/GOAL-900`
 *  branch carrying one commit. `merged:true` first merges that branch into develop (⇒ already-merged). */
function makeRepo({ tag, goalStatus = "active", branch = true, branchRef = true, merged = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `goal-merge-${tag ?? "t"}-`));
  _dirs.push(root);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "T"]);
  git(root, ["branch", "-M", "develop"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".quay/\n");
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  fs.writeFileSync(path.join(root, "goals", "GOAL-900-a-goal.md"),
    `---\nid: GOAL-900\ntitle: a goal\nstatus: ${goalStatus}\nkind: directive\nbranch: ${branch}\n---\n\nbody long enough to be a body \\u2014 this is filler text for the fixture\n`);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  if (branchRef) {
    git(root, ["checkout", "-q", "-b", "goal/GOAL-900"]);
    fs.writeFileSync(path.join(root, "work.txt"), "goal work\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "goal work"]);
    if (merged) {
      git(root, ["checkout", "-q", "develop"]);
      git(root, ["merge", "-q", "--no-ff", "goal/GOAL-900", "-m", "merge goal"]);
    }
    git(root, ["checkout", "-q", "develop"]);
  }
  return root;
}

function seedAc(root, acId, phase = null) {
  fs.writeFileSync(path.join(root, "goals", `${acId}-an-ac.md`),
    `---\nid: ${acId}\ntitle: an ac\nstatus: active\nkind: criterion\ngoal: GOAL-900\n${phase ? `phase: ${phase}\n` : ""}---\n\nbody text long enough to parse as a record\n`);
}

// ── four MANDATORY refusals (each: rejected AND no event written) ─────────────────────────────────

test("goal merge refuses a non-active goal (and writes nothing)", () => {
  const root = makeRepo({ tag: "nonactive", goalStatus: "draft" });
  const r = recordGoalMergeRequest({ root, goalId: "GOAL-900", reason: "mature enough now" });
  assert.equal(r.ok, false);
  assert.equal(r.refusal.code, "goal-not-active");
  assert.equal(requestEvents(root).length, 0, "a refusal must not write a goal-merge-request event");
});

test("goal merge refuses a non-branch-mode goal (and writes nothing)", () => {
  const root = makeRepo({ tag: "notbranch", branch: false });
  const r = recordGoalMergeRequest({ root, goalId: "GOAL-900", reason: "mature enough now" });
  assert.equal(r.ok, false);
  assert.equal(r.refusal.code, "not-branch-mode");
  assert.equal(requestEvents(root).length, 0);
});

test("goal merge refuses when the goal branch does not exist (and writes nothing)", () => {
  const root = makeRepo({ tag: "nobranch", branchRef: false });
  const r = recordGoalMergeRequest({ root, goalId: "GOAL-900", reason: "mature enough now" });
  assert.equal(r.ok, false);
  assert.equal(r.refusal.code, "branch-missing");
  assert.equal(requestEvents(root).length, 0);
});

test("goal merge refuses an already-merged goal (and writes nothing)", () => {
  const root = makeRepo({ tag: "merged", merged: true });
  const r = recordGoalMergeRequest({ root, goalId: "GOAL-900", reason: "mature enough now" });
  assert.equal(r.ok, false);
  assert.equal(r.refusal.code, "already-merged");
  assert.equal(requestEvents(root).length, 0);
});

// ── pre-merge AC gate: refuse without --override, record the override with the unmet list with it ─

test("goal merge refuses when a pre-merge AC is not achieved; --override records the reason + the unmet AC list", () => {
  const root = makeRepo({ tag: "acgate" });
  seedAc(root, "AC-901"); // no gate event ⇒ not achieved
  const refused = recordGoalMergeRequest({ root, goalId: "GOAL-900", reason: "mature enough now" });
  assert.equal(refused.ok, false);
  assert.equal(refused.refusal.code, "pre-merge-ac-unmet");
  assert.match(refused.refusal.message, /AC-901/);
  assert.equal(requestEvents(root).length, 0, "no override ⇒ no event");

  const overridden = recordGoalMergeRequest({
    root, goalId: "GOAL-900", reason: "mature enough now", override: "AC-901 is cosmetic, tracked separately",
  });
  assert.equal(overridden.ok, true);
  const events = requestEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.override, "AC-901 is cosmetic, tracked separately");
  assert.deepEqual(events[0].payload.unmetAcs, ["AC-901"]);
  assert.ok(events[0].payload.tipSha, "the request records the goal/<id> tip sha");
});

test("a post-merge AC does not block the merge request (only pre-merge ACs are the precondition)", () => {
  const root = makeRepo({ tag: "postmerge" });
  seedAc(root, "AC-901", "post-merge"); // not achieved, but post-merge ⇒ not a precondition
  const r = recordGoalMergeRequest({ root, goalId: "GOAL-900", reason: "mature enough now" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.unmetAcs, []);
});

// ── success: event carries the tip sha ────────────────────────────────────────────────────────────

test("a successful request records exactly one goal-merge-request event carrying the goal/<id> tip sha", () => {
  const root = makeRepo({ tag: "success" });
  seedAc(root, "AC-901");
  appendGoalEvent(root, "AC-901", "pass"); // achieved
  const tip = git(root, ["rev-parse", "goal/GOAL-900"]).trim();
  const r = recordGoalMergeRequest({ root, goalId: "GOAL-900", reason: "tried it in the preview, mature enough" });
  assert.equal(r.ok, true);
  assert.equal(r.request.tipSha, tip);
  const events = requestEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.tipSha, tip);
  assert.equal(events[0].pipeline_id, "GOAL-900");
  assert.equal(events[0].payload.unmetAcs.length, 0);
});

// ── derived pending reading (the worker-driver's execution input) ────────────────────────────────

test("pendingGoalMerges derives the request, and stops reporting it once merged / once the branch is gone", () => {
  const root = makeRepo({ tag: "pending" });
  recordGoalMergeRequest({ root, goalId: "GOAL-900", reason: "mature enough now" });
  const before = pendingGoalMerges(root);
  assert.equal(before.length, 1);
  assert.equal(before[0].goalId, "GOAL-900");

  // simulate a landed merge: merge the branch into develop (ancestor) ⇒ no longer pending.
  git(root, ["merge", "-q", "--no-ff", "goal/GOAL-900", "-m", "merge goal"]);
  assert.equal(pendingGoalMerges(root).length, 0, "an ancestor goal branch is not pending");
});

test("pendingGoalMerges: a red result at a frozen tip does NOT retry, but a request NEWER than that result does (explicit human retry)", () => {
  const root = makeRepo({ tag: "explicit-retry" });
  const tip = git(root, ["rev-parse", "goal/GOAL-900"]).trim();

  // T0: a request, then a RED result at the SAME tip — an infrastructure red leaves the tip frozen, so
  // the tip will never "advance to fix it" (the GOAL-904 shape this task is about).
  recordGoalMergeRequest({ root, goalId: "GOAL-900", reason: "first request", now: () => new Date("2026-01-01T00:00:00.000Z") });
  const firstReq = requestEvents(root)[0];
  assert.ok(firstReq?.payload?.eventId, "the first request carries an eventId");
  appendGoalMergeResult(root, {
    tipSha: tip, requestEventId: firstReq.payload.eventId, timestamp: "2026-01-01T00:05:00.000Z",
  });

  // No new request ∧ tip unchanged ⇒ NOT pending (ruling ⑳: re-running the same tree is a flake roll).
  assert.equal(pendingGoalMerges(root).length, 0, "tip unchanged + no new request ⇒ not retried");

  // A strictly-LATER request event (same tip) IS the human's explicit retry ⇒ pending.
  recordGoalMergeRequest({ root, goalId: "GOAL-900", reason: "retry after the infra red", now: () => new Date("2026-01-01T00:10:00.000Z") });
  const pendingAfterRerequest = pendingGoalMerges(root);
  assert.equal(pendingAfterRerequest.length, 1, "a request newer than the last red result is an explicit retry");
  assert.equal(pendingAfterRerequest[0].goalId, "GOAL-900");

  // The re-request is consumed once a NEWER result records that it ran (same tip, so nothing pends).
  const latestReq = requestEvents(root).at(-1);
  appendGoalMergeResult(root, {
    tipSha: tip, requestEventId: latestReq.payload.eventId, timestamp: "2026-01-01T00:15:00.000Z",
  });
  assert.equal(pendingGoalMerges(root).length, 0, "the re-request was consumed by a newer result at the same tip");

  // Ruling ⑳'s other half is UNCHANGED: advancing the tip retries even with no new request.
  git(root, ["checkout", "-q", "goal/GOAL-900"]);
  fs.writeFileSync(path.join(root, "fix.txt"), "fix\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fix the suite"]);
  git(root, ["checkout", "-q", "develop"]);
  assert.equal(pendingGoalMerges(root).length, 1, "tip advanced ⇒ retried (existing rule unchanged)");
});

test("readGoalMergeRequests reads back the recorded request", () => {
  const root = makeRepo({ tag: "readback" });
  recordGoalMergeRequest({ root, goalId: "GOAL-900", reason: "mature enough now", actor: "alice" });
  const reqs = readGoalMergeRequests(root);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].actor, "alice");
  assert.equal(reqs[0].reason, "mature enough now");
});
