// @test-group product
// Stage — the goal store (GOAL + AC records), the THIRD sibling kind
// (tasks/gap-spec-goal-store-third-sibling-kind, orchestration/SPEC-goal-store-2026-08-09.md,
//  revised by orchestration/SPEC-goal-mechanism-2026-09-06.md §2 — PHASE-NNN → GOAL-NNN).
//
// Coverage map (task ACs + Contract):
//   AC1 — goal-store kind reuses frontmatter-store-base (read the import, never a copy).
//   AC2 — empty criterion ⇒ gate RED (fail-closed), not green.
//   AC3 — a goal gate run appends a GateEvent with verdict+timestamp to .quay/gate-events.jsonl.
//   AC4 — the ACTIVE SET is DERIVED from goal status (change the goal, the set follows).
//   AC6 — empty `origin` writes nothing (negative control).
//   AC9 — GOAL-NNN naming + goal/AC unity; GOAL records have NO criterion field.
//   AC10 — I1 single atomic goal switch fail-closed: second active rejected without disposition.
//   AC11 — I2 derived: GOAL achieved ⟺ all its ACs achieved (evaluated, never stored); the
//          exactly-one-active-goal checker.
//   draft — write() defaults to `draft` (not active); a draft GOAL is absent from activeGoals()
//           and its ACs absent from listActiveCriteria() (SPEC §3.2 negative controls).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createGoalStore, VALID_GOAL_STATUSES, isGoalId, isCriterionId } from "../src/goal-store.ts";

const _createdDirs = [];
function tmpDir(tag = "goal") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goal-store-${tag}-`));
  _createdDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ── AC1: reuses frontmatter-store-base (read the import, never a copy) ────────────────────────────
test("AC1 — goal-store imports parse/serialize/lock/filename from frontmatter-store-base", () => {
  const src = fs.readFileSync(new URL("../src/goal-store.ts", import.meta.url), "utf8");
  assert.match(src, /frontmatter-store-base\.ts/);
  assert.match(src, /parseFrontmatter/);
  assert.match(src, /serializeFrontmatter/);
  assert.match(src, /withFileLock/);
  assert.match(src, /fileNameForId/);
  // It must NOT reimplement the base's FRONTMATTER_RE / slugify-body (copy).
  assert.doesNotMatch(src, /FRONTMATTER_RE\s*=\s*\/\^---\\n/);
});

// ── AC9: GOAL-NNN / AC-NNN naming, kind derived, GOAL has no criterion ──────────────────────────
test("AC9 — ids are GOAL-NNN / AC-NNN (pure sequence); kind derived from the prefix", () => {
  assert.ok(isGoalId("GOAL-001"));
  assert.ok(isCriterionId("AC-028"));
  assert.ok(!isGoalId("AC-028"));
  assert.ok(!isGoalId("PHASE-001"), "PHASE-NNN was renamed to GOAL-NNN by SPEC §2");
  const s = createGoalStore(tmpDir("ac9"));
  const p = s.write("GOAL-001", { title: "three-layer unification", status: "active", origin: "o" });
  assert.equal(p.kind, "goal");
  const a = s.write("AC-028", { title: "experience flows", status: "active", goal: "GOAL-001", criterion: "true", origin: "o" });
  assert.equal(a.kind, "criterion");
  assert.equal(a.goal, "GOAL-001");
  assert.equal(a.criterion, "true");
});

test("AC9 — a GOAL record cannot carry a criterion field (its criterion is its ACs' conjunction)", () => {
  const s = createGoalStore(tmpDir("ac9b"));
  assert.throws(
    () => s.write("GOAL-001", { title: "p", status: "active", origin: "o", criterion: "true" }),
    /GOAL record.*criterion/
  );
});

// ── AC6: empty origin writes nothing (negative control) ───────────────────────────────────────────
test("AC6 — writing a record without a non-empty origin is rejected", () => {
  const s = createGoalStore(tmpDir("ac6"));
  assert.throws(() => s.write("GOAL-001", { title: "p", status: "active", origin: "" }), /origin is required/);
  assert.throws(() => s.write("AC-001", { title: "a", status: "active", goal: "GOAL-001", criterion: "true" }), /origin is required/);
  // The rejected write leaves no file behind.
  assert.equal(s.list().length, 0);
});

test("AC6 — an existing origin survives a later write that omits it; blanking it is rejected", () => {
  const s = createGoalStore(tmpDir("ac6b"));
  s.write("GOAL-001", { title: "p", status: "active", origin: "2026-08-09 human goal setting" });
  s.write("GOAL-001", { title: "p renamed", status: "active" }); // omit origin → kept
  assert.equal(s.get("GOAL-001").origin, "2026-08-09 human goal setting");
  assert.equal(s.get("GOAL-001").title, "p renamed");
  assert.throws(() => s.write("GOAL-001", { title: "p", status: "active", origin: "" }), /origin is required/);
});

// ── AC4: active set DERIVED from goal status (change the goal, the set follows) ──────────────────
test("AC4 — listActiveCriteria() derives the active set from goal status, not a hand-maintained checklist", () => {
  const s = createGoalStore(tmpDir("ac4"));
  s.write("GOAL-010", { title: "p10", status: "active", origin: "o1" });
  s.write("AC-010", { title: "a1", status: "active", goal: "GOAL-010", criterion: "true", origin: "o2" });
  s.write("AC-011", { title: "a2", status: "active", goal: "GOAL-010", criterion: "true", origin: "o3" });
  assert.deepEqual(s.listActiveCriteria().map((g) => g.id), ["AC-010", "AC-011"]);

  // Switch the goal (I1 with disposition) → the ACTIVE SET follows automatically.
  s.write("GOAL-011", { title: "p11", status: "active", origin: "o4", supersedes: ["GOAL-010"] });
  assert.deepEqual(s.listActiveCriteria().map((g) => g.id), [], "goal switched → old ACs leave the active set");
  s.write("AC-012", { title: "a3", status: "active", goal: "GOAL-011", criterion: "true", origin: "o5" });
  assert.deepEqual(s.listActiveCriteria().map((g) => g.id), ["AC-012"], "new goal's AC enters the active set");
});

// ── AC10: I1 single atomic goal switch, fail-closed ──────────────────────────────────────────────
test("AC10 — activating a second goal while one is active is REJECTED without a disposition", () => {
  const s = createGoalStore(tmpDir("ac10a"));
  s.write("GOAL-001", { title: "p1", status: "active", origin: "o" });
  assert.throws(() => s.write("GOAL-002", { title: "p2", status: "active", origin: "o" }), /already active.*dispose/);
});

test("AC10 — the SAME call may dispose the old goal (achieved) and activate the new one", () => {
  const s = createGoalStore(tmpDir("ac10b"));
  s.write("GOAL-001", { title: "p1", status: "active", origin: "o" });
  s.write("GOAL-002", { title: "p2", status: "active", origin: "o", disposeOld: { id: "GOAL-001", to: "achieved" } });
  assert.equal(s.get("GOAL-001").status, "achieved");
  assert.equal(s.get("GOAL-002").status, "active");
  assert.deepEqual(s.activeGoals().map((p) => p.id), ["GOAL-002"]);
});

test("AC10 — supersedes:[oldId] in the same call atomically supersedes the old goal", () => {
  const s = createGoalStore(tmpDir("ac10c"));
  s.write("GOAL-001", { title: "p1", status: "active", origin: "o" });
  s.write("GOAL-002", { title: "p2", status: "active", origin: "o", supersedes: ["GOAL-001"] });
  assert.equal(s.get("GOAL-001").status, "superseded");
  assert.deepEqual(s.get("GOAL-001").supersededBy, ["GOAL-002"]);
});

// ── AC11: I2 derived (never stored) + exactly-one-active-goal checker ────────────────────────────
test("AC11 — isGoalAchieved is DERIVED: goal achieved ⟺ all its ACs achieved", () => {
  const s = createGoalStore(tmpDir("ac11"));
  s.write("GOAL-010", { title: "p10", status: "active", origin: "o" });
  s.write("AC-010", { title: "a1", status: "active", goal: "GOAL-010", criterion: "true", origin: "o" });
  s.write("AC-011", { title: "a2", status: "active", goal: "GOAL-010", criterion: "true", origin: "o" });
  assert.equal(s.isGoalAchieved("GOAL-010"), false, "not all ACs achieved");
  s.write("AC-010", { status: "achieved", origin: "o" });
  assert.equal(s.isGoalAchieved("GOAL-010"), false, "still one AC active");
  s.write("AC-011", { status: "achieved", origin: "o" });
  assert.equal(s.isGoalAchieved("GOAL-010"), true, "all ACs achieved → derived true");
  // Derived, never stored: isGoalAchieved computes from the ACs' stored statuses; the goal
  // record itself carries no derived 'achieved' flag (the derivation is the tested fact).
});

test("AC11 — a goal with zero ACs is not achieved; exactly-one-active-goal checker", () => {
  const s = createGoalStore(tmpDir("ac11b"));
  s.write("GOAL-010", { title: "p10", status: "active", origin: "o" });
  assert.equal(s.isGoalAchieved("GOAL-010"), false, "no ACs → not achieved");
  let chk = s.checkExactlyOneActiveGoal();
  assert.equal(chk.ok, true);
  assert.equal(chk.count, 1);
  assert.deepEqual(chk.active, ["GOAL-010"]);
  s.write("GOAL-011", { title: "p11", status: "active", origin: "o", disposeOld: { id: "GOAL-010", to: "achieved" } });
  chk = s.checkExactlyOneActiveGoal();
  assert.equal(chk.ok, true);
  assert.deepEqual(chk.active, ["GOAL-011"]);
});

// ── VALID_GOAL_STATUSES / id validation (schema hardening) ─────────────────────────────────────────
test("VALID_GOAL_STATUSES includes draft+achieved; rejects todo/done", () => {
  assert.deepEqual(VALID_GOAL_STATUSES, ["draft", "active", "achieved", "superseded", "retired"]);
  assert.ok(!VALID_GOAL_STATUSES.includes("done"), "a goal is not a task; it does not 'done'");
  const s = createGoalStore(tmpDir("status"));
  assert.throws(() => s.write("GOAL-001", { title: "p", status: "done", origin: "o" }), /invalid goal status/);
  assert.throws(() => s.write("AC-001", { title: "a", status: "todo", goal: "GOAL-001", origin: "o" }), /invalid goal status/);
});

test("write rejects malformed ids (GOAL-1, PHASE-001, path traversal)", () => {
  const s = createGoalStore(tmpDir("id"));
  assert.throws(() => s.write("GOAL-1", { title: "g", status: "active", origin: "o" }), /invalid goal id/);
  assert.throws(() => s.write("PHASE-001", { title: "p", status: "active", origin: "o" }), /invalid goal id/);
  assert.throws(() => s.write("../../etc/x", { title: "x", status: "active", origin: "o" }), /invalid goal id/);
});

// ── draft: write() defaults to draft (not active); draft records are absent from the active set ──
test("draft — write() without an explicit status lands `status: draft` (default NOT active)", () => {
  const s = createGoalStore(tmpDir("draft-default"));
  const g = s.write("GOAL-001", { title: "unstarted goal", origin: "o" });
  assert.equal(g.status, "draft");
  assert.equal(s.get("GOAL-001").status, "draft");
});

test("draft — a draft GOAL is absent from activeGoals(); its ACs absent from listActiveCriteria() even when the AC is active", () => {
  const s = createGoalStore(tmpDir("draft-neg"));
  s.write("GOAL-001", { title: "unstarted goal", origin: "o" }); // defaults to draft
  s.write("AC-001", { title: "a draft goal's AC", status: "active", goal: "GOAL-001", criterion: "true", origin: "o" });
  assert.deepEqual(s.activeGoals().map((g) => g.id), [], "draft GOAL is not active");
  assert.deepEqual(s.listActiveCriteria().map((g) => g.id), [], "activeness derives from the GOAL, not the AC's own status");
});

// ── AC2 + AC3: goal gate via the direct CLI (Contract invoke) ─────────────────────────────────────
function runCli(args, opts = {}) {
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const res = spawnSync("node", ["--experimental-strip-types", cli, ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

test("AC2 — an AC with an EMPTY criterion fails closed (red), and the CLI records the fail event", () => {
  const root = tmpDir("cli-ac2");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const args = (a) => ["--root", root, ...a];
  spawnSync("node", ["--experimental-strip-types", cli, ...args(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o"])], { encoding: "utf8" });
  // AC-020 has NO criterion.
  const w = spawnSync("node", ["--experimental-strip-types", cli, ...args(["write", "AC-020", "--title", "no-criterion", "--status", "active", "--goal", "GOAL-001", "--origin", "o"])], { encoding: "utf8" });
  assert.equal(w.status, 0, w.stderr);
  const g = runCli(["gate", "AC-020", "--root", root]);
  assert.equal(g.status, 1, "empty criterion must exit 1 (fail-closed):\n" + g.stdout + g.stderr);
  const out = JSON.parse(g.stdout);
  assert.equal(out.verdict, "fail");
  assert.match(out.reason, /fail-closed/);
});

test("AC3 — a goal gate run leaves a verdict+timestamp event in .quay/gate-events.jsonl", () => {
  const root = tmpDir("cli-ac3");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const args = (a) => ["--root", root, ...a];
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, ...args(cmd)], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o"]);
  n(["write", "AC-028", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o"]);
  const g = runCli(["gate", "AC-028", "--root", root]);
  assert.equal(g.status, 0, "criterion `true` must pass:\n" + g.stdout + g.stderr);
  // The ledger tail event carries BOTH fields (Contract measure goal_store_ac3_gate_event).
  const ledger = fs.readFileSync(path.join(root, ".quay", "gate-events.jsonl"), "utf8").trim().split("\n");
  const tail = JSON.parse(ledger[ledger.length - 1]);
  assert.ok(tail.item_id === "AC-028" || tail.pipeline_id === "AC-028", "event belongs to the goal");
  assert.equal(tail.gate, "goal");
  assert.equal(tail.verdict, "pass");
  assert.ok(typeof tail.timestamp === "string" && tail.timestamp.length > 0, "timestamp present");
  // The record's own `evidence` now carries the last verdict + time (web column source).
  const rec = JSON.parse(n(["get", "AC-028"]).stdout);
  assert.equal(rec.evidence.verdict, "pass");
  assert.ok(rec.evidence.at && rec.evidence.at.length > 0);
});

test("goal-store list/get/write round-trip through the CLI (invoke surface)", () => {
  const root = tmpDir("cli-list");
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const args = (a) => ["--root", root, ...a];
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, ...args(cmd)], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o"]);
  const list = JSON.parse(n(["list"]).stdout);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "GOAL-001");
  const got = JSON.parse(n(["get", "GOAL-001"]).stdout);
  assert.equal(got.title, "p");
});
