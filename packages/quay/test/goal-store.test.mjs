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
//   AC10 — I1′ hard cap: disposeOld/supersedes in the SAME call still work; over-cap activation
//          is REJECTED.
//   AC11 — I2 derived: GOAL achieved ⟺ all its ACs achieved (evaluated, never stored); the
//          checkWithinCap() checker (withinCap vs hasDirection).
//   draft — write() defaults to `draft` (not active); a draft GOAL is absent from activeGoals()
//           and its ACs absent from listActiveCriteria() (SPEC §3.2 negative controls).
//   gap-goal-store-hard-cap-staleness-three-state:
//     AC-3 — cap=2 negative control: a 3rd active is REJECTED and the error names both holders.
//     AC-4 — zero-AC GOAL is notEvaluated (never fresh, never stale).
//     AC-5 — cap/stale read from .quay/config.yml (change config → check follows).
//     AC-6 — I4: status=active + all ACs achieved ⇒ divergent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { createGoalStore, VALID_GOAL_STATUSES, isGoalId, isCriterionId, GoalIntentConflictError, parseAdjudicationTable } from "../src/goal-store.ts";
import { gateFactories, makeGoalGate } from "../src/gate/factories/index.ts";

const _createdDirs = [];
function tmpDir(tag = "goal") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goal-store-${tag}-`));
  _createdDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// A REAL git repo temp dir (⛔ not a non-git dir): commitGoalFileAfterWrite is a no-op in repo-less
// roots, so a non-git fixture would make「写后提交」与「写后没提交」观测不到差别 ⇒ 判据恒真 (hard rule 4).
function gitRepo(tag = "commit") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goal-store-git-${tag}-`));
  _createdDirs.push(dir);
  const run = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  run("init", "-q");
  run("config", "user.email", "t@t");
  run("config", "user.name", "t");
  fs.mkdirSync(path.join(dir, "goals"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  return { root: dir, run };
}

// gap-goal-record-completeness-undefined: a GOAL's body is required (≥40 non-whitespace chars)
// and a criterion's content lives in criterion+expect — these keep every fixture write complete.
const GOAL_BODY = "goal body: background, scope, non-goals and exit conditions — long enough to satisfy the 40-char minimum";
const EXPECT = "the expected outcome this criterion proves";

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
  const p = s.write("GOAL-001", { title: "three-layer unification", status: "active", origin: "o", body: GOAL_BODY });
  assert.equal(p.kind, "goal");
  const a = s.write("AC-028", { title: "experience flows", status: "active", goal: "GOAL-001", criterion: "true", origin: "o", expect: EXPECT });
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
  s.write("GOAL-001", { title: "p", status: "active", origin: "2026-08-09 human goal setting", body: GOAL_BODY });
  s.write("GOAL-001", { title: "p renamed", status: "active", body: GOAL_BODY }); // omit origin → kept
  assert.equal(s.get("GOAL-001").origin, "2026-08-09 human goal setting");
  assert.equal(s.get("GOAL-001").title, "p renamed");
  assert.throws(() => s.write("GOAL-001", { title: "p", status: "active", origin: "" }), /origin is required/);
});

// ── AC4: active set DERIVED from goal status (change the goal, the set follows) ──────────────────
test("AC4 — listActiveCriteria() derives the active set from goal status, not a hand-maintained checklist", () => {
  const s = createGoalStore(tmpDir("ac4"));
  s.write("GOAL-010", { title: "p10", status: "active", origin: "o1", body: GOAL_BODY });
  s.write("AC-010", { title: "a1", status: "active", goal: "GOAL-010", criterion: "true", origin: "o2", expect: EXPECT });
  s.write("AC-011", { title: "a2", status: "active", goal: "GOAL-010", criterion: "true", origin: "o3", expect: EXPECT });
  assert.deepEqual(s.listActiveCriteria().map((g) => g.id), ["AC-010", "AC-011"]);

  // Switch the goal (I1 with disposition) → the ACTIVE SET follows automatically.
  s.write("GOAL-011", { title: "p11", status: "active", origin: "o4", supersedes: ["GOAL-010"], body: GOAL_BODY });
  assert.deepEqual(s.listActiveCriteria().map((g) => g.id), [], "goal switched → old ACs leave the active set");
  s.write("AC-012", { title: "a3", status: "active", goal: "GOAL-011", criterion: "true", origin: "o5", expect: EXPECT });
  assert.deepEqual(s.listActiveCriteria().map((g) => g.id), ["AC-012"], "new goal's AC enters the active set");
});

// ── AC10: I1′ hard cap (SPEC §4.1) ──────────────────────────────────────────────────────────────
test("AC10 — under the default cap (3), a second and third active GOAL are allowed; a fourth is rejected", () => {
  const s = createGoalStore(tmpDir("ac10a"));
  s.write("GOAL-001", { title: "p1", status: "active", origin: "o", body: GOAL_BODY });
  s.write("GOAL-002", { title: "p2", status: "active", origin: "o", body: GOAL_BODY });
  s.write("GOAL-003", { title: "p3", status: "active", origin: "o", body: GOAL_BODY });
  assert.throws(
    () => s.write("GOAL-004", { title: "p4", status: "active", origin: "o", body: GOAL_BODY }),
    /exceed cap 3/
  );
});

test("AC10 — the SAME call may dispose the old goal (achieved) and activate the new one", () => {
  const s = createGoalStore(tmpDir("ac10b"));
  s.write("GOAL-001", { title: "p1", status: "active", origin: "o", body: GOAL_BODY });
  s.write("GOAL-002", { title: "p2", status: "active", origin: "o", disposeOld: { id: "GOAL-001", to: "achieved" }, body: GOAL_BODY });
  assert.equal(s.get("GOAL-001").status, "achieved");
  assert.equal(s.get("GOAL-002").status, "active");
  assert.deepEqual(s.activeGoals().map((p) => p.id), ["GOAL-002"]);
});

test("AC10 — supersedes:[oldId] in the same call atomically supersedes the old goal", () => {
  const s = createGoalStore(tmpDir("ac10c"));
  s.write("GOAL-001", { title: "p1", status: "active", origin: "o", body: GOAL_BODY });
  s.write("GOAL-002", { title: "p2", status: "active", origin: "o", supersedes: ["GOAL-001"], body: GOAL_BODY });
  assert.equal(s.get("GOAL-001").status, "superseded");
  assert.deepEqual(s.get("GOAL-001").supersededBy, ["GOAL-002"]);
});

// ── AC11: I2 derived (never stored) + checkWithinCap checker ─────────────────────────────────────
test("AC11 — isGoalAchieved is DERIVED: goal achieved ⟺ all its ACs achieved", () => {
  const s = createGoalStore(tmpDir("ac11"));
  s.write("GOAL-010", { title: "p10", status: "active", origin: "o", body: GOAL_BODY });
  s.write("AC-010", { title: "a1", status: "active", goal: "GOAL-010", criterion: "true", origin: "o", expect: EXPECT });
  s.write("AC-011", { title: "a2", status: "active", goal: "GOAL-010", criterion: "true", origin: "o", expect: EXPECT });
  assert.equal(s.isGoalAchieved("GOAL-010"), false, "not all ACs achieved");
  s.write("AC-010", { status: "achieved", origin: "o" });
  assert.equal(s.isGoalAchieved("GOAL-010"), false, "still one AC active");
  s.write("AC-011", { status: "achieved", origin: "o" });
  assert.equal(s.isGoalAchieved("GOAL-010"), true, "all ACs achieved → derived true");
  // Derived, never stored: isGoalAchieved computes from the ACs' stored statuses; the goal
  // record itself carries no derived 'achieved' flag (the derivation is the tested fact).
});

test("AC11 — a goal with zero ACs is not achieved; checkWithinCap splits withinCap from hasDirection", () => {
  const s = createGoalStore(tmpDir("ac11b"));
  s.write("GOAL-010", { title: "p10", status: "active", origin: "o", body: GOAL_BODY });
  assert.equal(s.isGoalAchieved("GOAL-010"), false, "no ACs → not achieved");
  let chk = s.checkWithinCap();
  assert.equal(chk.withinCap, true);
  assert.equal(chk.hasDirection, true);
  assert.equal(chk.activeCount, 1);
  assert.equal(chk.cap, 3);
  assert.deepEqual(chk.active, ["GOAL-010"]);
  s.write("GOAL-011", { title: "p11", status: "active", origin: "o", disposeOld: { id: "GOAL-010", to: "achieved" }, body: GOAL_BODY });
  chk = s.checkWithinCap();
  assert.equal(chk.withinCap, true);
  assert.equal(chk.activeCount, 1);
  assert.deepEqual(chk.active, ["GOAL-011"]);
});

// ── VALID_GOAL_STATUSES / id validation (schema hardening) ─────────────────────────────────────────
test("VALID_GOAL_STATUSES includes draft+achieved; rejects todo/done", () => {
  assert.deepEqual(VALID_GOAL_STATUSES, ["draft", "active", "achieved", "superseded", "retired", "needs-human"]);
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
  const g = s.write("GOAL-001", { title: "unstarted goal", origin: "o", body: GOAL_BODY });
  assert.equal(g.status, "draft");
  assert.equal(s.get("GOAL-001").status, "draft");
});

test("draft — a draft GOAL is absent from activeGoals(); its ACs absent from listActiveCriteria() even when the AC is active", () => {
  const s = createGoalStore(tmpDir("draft-neg"));
  s.write("GOAL-001", { title: "unstarted goal", origin: "o", body: GOAL_BODY }); // defaults to draft
  s.write("AC-001", { title: "a draft goal's AC", status: "active", goal: "GOAL-001", criterion: "true", origin: "o", expect: EXPECT });
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
  spawnSync("node", ["--experimental-strip-types", cli, ...args(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY])], { encoding: "utf8" });
  // AC-020 has NO criterion — now unrepresentable via write() (gap-goal-record-completeness-undefined
  // requires criterion+expect for criterion records), so hand-write a legacy file to keep the gate’s
  // fail-closed-on-empty-criterion path tested on a pre-existing record.
  fs.writeFileSync(path.join(root, "goals", "AC-020-legacy.md"),
    "---\nid: AC-020\ntitle: no-criterion\nstatus: active\nkind: criterion\ngoal: GOAL-001\norigin: o\n---\n## Rationale\nlegacy\n", "utf8");
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
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-028", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  const g = runCli(["gate", "AC-028", "--root", root]);
  assert.equal(g.status, 0, "criterion `true` must pass:\n" + g.stdout + g.stderr);
  // The ledger tail event carries BOTH fields (Contract measure goal_store_ac3_gate_event).
  const ledger = fs.readFileSync(path.join(root, ".quay", "gate-events.jsonl"), "utf8").trim().split("\n");
  const tail = JSON.parse(ledger[ledger.length - 1]);
  assert.ok(tail.item_id === "AC-028" || tail.pipeline_id === "AC-028", "event belongs to the goal");
  assert.equal(tail.gate, "goal");
  assert.equal(tail.verdict, "pass");
  assert.ok(typeof tail.timestamp === "string" && tail.timestamp.length > 0, "timestamp present");
  // The record's DERIVED `evidence` (ledger, never stored — gap-goal-evidence-cache-should-not-enter-git)
  // now carries the last verdict + time, and `at` is the SAME timestamp as the ledger tail.
  const rec = JSON.parse(n(["get", "AC-028"]).stdout);
  assert.equal(rec.evidence.verdict, "pass");
  assert.equal(rec.evidence.at, tail.timestamp, "evidence.at must equal the ledger tail timestamp (source = ledger, not the file)");
});

test("goal-store list/get/write round-trip through the CLI (invoke surface)", () => {
  const root = tmpDir("cli-list");
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const args = (a) => ["--root", root, ...a];
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, ...args(cmd)], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  const list = JSON.parse(n(["list"]).stdout);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "GOAL-001");
  const got = JSON.parse(n(["get", "GOAL-001"]).stdout);
  assert.equal(got.title, "p");
});

// ── migration completeness (gap-goal-store-migrate-prose-phase-acs-to-records AC4) ───────────────
// 保号无缺漏：AC143..AC155（当前阶段 GOAL-002）与 AC156..AC169（下一阶段 GOAL-003）共 27 个编号，
// 每个在 <repo>/goals 下【恰有一个】记录文件。生产 goals 目录由测试文件位置派生（绝不靠 cwd），
// 因此无论 suite 在哪个检出上跑，读到的都是该检出的 goals/。
test("migration completeness — AC143..AC155 and AC156..AC169 each have exactly one record", () => {
  const goalsDir = new URL("../../../goals", import.meta.url).pathname;
  const store = createGoalStore(goalsDir);
  const records = store.list();
  const required = [];
  for (let n = 143; n <= 155; n++) required.push(`AC-${n}`);
  for (let n = 156; n <= 169; n++) required.push(`AC-${n}`);
  assert.equal(required.length, 27, "the migrated range is 27 ids");
  for (const id of required) {
    const matches = records.filter((r) => String(r.id) === id);
    assert.equal(matches.length, 1, `${id} must have exactly one record, found ${matches.length}`);
  }
});

// ── gap-goal-store-hard-cap-staleness-three-state: I1′ / I3 / I4 ─────────────────────────────────
// AC-3 negative control: cap=2, two active, a third active is REJECTED and the error ENUMERATES
// the two current holders (hard rule 3: enumerate, don't boolean — "which goals hold the slots"
// is the actionable info a booleanized "over cap" would drop).
test("AC-3 — cap=2: a 3rd active GOAL is REJECTED and the error names both current holders", () => {
  const s = createGoalStore(tmpDir("ac3-cap"), { cap: 2 });
  s.write("GOAL-001", { title: "p1", status: "active", origin: "o", body: GOAL_BODY });
  s.write("GOAL-002", { title: "p2", status: "active", origin: "o", body: GOAL_BODY });
  let caught = null;
  try {
    s.write("GOAL-003", { title: "p3", status: "active", origin: "o", body: GOAL_BODY });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "a 3rd active GOAL with cap=2 must be rejected");
  assert.match(caught.message, /exceed cap 2/);
  assert.match(caught.message, /GOAL-001/, "the rejection must enumerate the first holder");
  assert.match(caught.message, /GOAL-002/, "the rejection must enumerate the second holder");
});

// AC-4 negative control: a zero-AC GOAL is notEvaluated — never "fresh" (judging an unevaluated
// object healthy, hard rule 3b) and never "stale" (a just-created goal is not yet overdue).
test("AC-4 — a zero-AC GOAL is notEvaluated (never fresh, never stale)", () => {
  const s = createGoalStore(tmpDir("ac4-stale"));
  s.write("GOAL-001", { title: "bare", status: "active", origin: "o", body: GOAL_BODY });
  const r = s.checkStaleness(Date.now());
  assert.deepEqual(r.fresh, [], "zero-AC must not be fresh");
  assert.deepEqual(r.stale, [], "zero-AC must not be stale");
  assert.deepEqual(r.notEvaluated, ["GOAL-001"], "zero-AC is notEvaluated");
  assert.deepEqual(r.divergent, [], "zero-AC is not achieved → not divergent");
});

// AC-5: cap/stale come from .quay/config.yml (change config → check follows). Proves the values
// are NOT hardcoded literals (hard rule 4: no numeric threshold before the cost is measured).
test("AC-5 — cap/stale read from .quay/config.yml (change config → check follows)", () => {
  const root = tmpDir("cli-config");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const args = (a) => ["--root", root, ...a];
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, ...args(cmd)], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);

  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "goals:\n  cap: 2\n  stale: 3d\n", "utf8");
  let chk = JSON.parse(n(["check"]).stdout);
  assert.equal(chk.cap, 2, "cap must come from config, not a hardcoded literal");
  let st = JSON.parse(n(["check", "--staleness"]).stdout);
  assert.equal(st.staleMs, 3 * 86400_000, "stale must come from config");

  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "goals:\n  cap: 5\n  stale: 1d\n", "utf8");
  chk = JSON.parse(n(["check"]).stdout);
  assert.equal(chk.cap, 5, "changing the config changes the reported cap");
});

// AC-6 / I4: status=active while isGoalAchieved() is true ⇒ "achieved but nobody closed it",
// reported as `divergent` by checkStaleness.
test("AC-6 — I4: status=active with all ACs achieved reports divergence", () => {
  const s = createGoalStore(tmpDir("ac6-divergence"));
  s.write("GOAL-010", { title: "p10", status: "active", origin: "o", body: GOAL_BODY });
  s.write("AC-010", { title: "a1", status: "achieved", goal: "GOAL-010", criterion: "true", origin: "o", expect: EXPECT });
  s.write("AC-011", { title: "a2", status: "achieved", goal: "GOAL-010", criterion: "true", origin: "o", expect: EXPECT });
  assert.equal(s.isGoalAchieved("GOAL-010"), true, "all ACs achieved → derived achieved");
  const r = s.checkStaleness(Date.now());
  assert.deepEqual(r.divergent, ["GOAL-010"], "active yet achieved ⇒ divergent (I4)");
});

// ── gap-goal-achieved-but-failing-no-handler: I5 achieved-but-failing bucket ──────────────────────
// The OPPOSITE direction from I4 (divergent = active yet achieved; achievedButFailing = achieved yet
// its criterion now exits non-zero). It must be a SEPARATE bucket of AC ids (⛔ never merged into
// divergent — merging would make the two opposite signals indistinguishable), produced by RUNNING the
// criterion (runAcceptance), never read from a stored field. I5 lives in `checkAchievedFailing`
// (a SEPARATE subcommand from the PURE-READ `checkStaleness`) — an achieved criterion that itself
// calls `check --staleness` (AC-175) must never recurse, so staleness is pure-read.

test("I5 — an achieved AC whose criterion now fails lands in checkAchievedFailing (separate from divergent)", () => {
  const s = createGoalStore(tmpDir("i5-achfail"));
  s.write("GOAL-010", { title: "p10", status: "active", origin: "o", body: GOAL_BODY });
  s.write("AC-010", { title: "a1", status: "achieved", goal: "GOAL-010", criterion: "true", origin: "o", expect: EXPECT });
  s.write("AC-011", { title: "a2", status: "achieved", goal: "GOAL-010", criterion: "false", origin: "o", expect: EXPECT });
  const af = s.checkAchievedFailing();
  assert.deepEqual(af.achievedButFailing, ["AC-011"], "AC-011 criterion `false` exits 1 ⇒ achieved-but-failing");
  assert.equal(af.evaluated, true, "not refused ⇒ evaluated: true");
  // The two buckets are SEPARATE on the same input: divergent (I4) holds GOAL ids, achievedButFailing
  // (I5) holds AC ids — never the other's contents.
  const st = s.checkStaleness(Date.now());
  assert.deepEqual(st.divergent, ["GOAL-010"], "all ACs achieved yet goal active ⇒ divergent (I4)");
  assert.ok(!st.divergent.includes("AC-011"), "divergent holds GOAL ids, not the AC id");
  assert.ok(!af.achievedButFailing.includes("GOAL-010"), "achievedButFailing holds AC ids, not the GOAL id");
});

test("I5 bidirectional — criterion fail→pass moves the AC out of checkAchievedFailing", () => {
  const s = createGoalStore(tmpDir("i5-bidir"));
  s.write("GOAL-010", { title: "p10", status: "active", origin: "o", body: GOAL_BODY });
  s.write("AC-020", { title: "a1", status: "achieved", goal: "GOAL-010", criterion: "false", origin: "o", expect: EXPECT });
  s.write("AC-021", { title: "a2", status: "active", goal: "GOAL-010", criterion: "true", origin: "o", expect: EXPECT });
  let af = s.checkAchievedFailing();
  assert.deepEqual(af.achievedButFailing, ["AC-020"], "criterion `false` ⇒ in bucket");
  assert.deepEqual(s.checkStaleness(Date.now()).divergent, [], "one AC still active ⇒ not divergent (the two signals are independent)");
  // Flip the criterion to pass ⇒ the AC leaves the bucket (BOTH directions asserted).
  s.write("AC-020", { status: "achieved", goal: "GOAL-010", criterion: "true", origin: "o", expect: EXPECT });
  af = s.checkAchievedFailing();
  assert.deepEqual(af.achievedButFailing, [], "criterion `true` ⇒ out of bucket");
});

test("I5 CLI — check --achieved-failing exits 1 on an achieved-but-failing AC, 0 when it passes (no false-green)", () => {
  const root = tmpDir("i5-cli");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const args = (a) => ["--root", root, ...a];
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, ...args(cmd)], { encoding: "utf8" });
  n(["write", "GOAL-010", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-020", "--title", "achieved-but-failing", "--status", "achieved", "--goal", "GOAL-010", "--criterion", "false", "--origin", "o", "--expect", EXPECT]);
  n(["write", "AC-021", "--title", "still-active", "--status", "active", "--goal", "GOAL-010", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);

  const chk = n(["check", "--achieved-failing"]);
  assert.equal(chk.status, 1, "an achieved-but-failing AC must make check --achieved-failing exit 1 (old code exited 0 = false-green):\n" + chk.stdout + chk.stderr);
  const out = JSON.parse(chk.stdout);
  assert.deepEqual(out.achievedButFailing, ["AC-020"], "the achieved+failing AC is enumerated by id");

  // Flip the failing criterion to pass ⇒ bucket empty ⇒ exit 0.
  n(["write", "AC-020", "--status", "achieved", "--goal", "GOAL-010", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  const chk2 = n(["check", "--achieved-failing"]);
  assert.equal(chk2.status, 0, "no achieved-but-failing ⇒ exit 0:\n" + chk2.stdout + chk2.stderr);
  assert.deepEqual(JSON.parse(chk2.stdout).achievedButFailing, []);
});

// ── gap-goal-store-abi-encapsulation-provider-backed: shim + gateFactories ────────────────────────
// AC-176 (grep 断言, mirror-drift guard): the goal-id regex has ONE definition — in Core's
// goal-store.ts. The native provider's goal-store.ts is a FORWARDING re-export shim (the same
// declared-direction pattern as quay/adr-store) that never copies it.
test("AC-176 — native goal-store.ts is a re-export shim (no second GOAL_ID_RE definition)", () => {
  const nativeSrc = fs.readFileSync(new URL("../../quay-native/src/goal-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(nativeSrc, /GOAL_ID_RE/, "the native re-export shim must not redefine the goal-id regex (it lives in Core)");
  assert.match(nativeSrc, /quay\/src\/goal-store\.ts/, "the native shim forwards to Core's goal-store");
  const coreSrc = fs.readFileSync(new URL("../src/goal-store.ts", import.meta.url), "utf8");
  assert.match(coreSrc, /GOAL_ID_RE/, "the single GOAL_ID_RE definition lives in Core");
});

// AC-176 (顺带补既有缺口): makeGoalGate was exported but missing from the gateFactories
// dispatch map — a goal gate could not be configured via gates.yml. Assert it is now
// reachable by name (`type: goal`).
test("AC-176 — makeGoalGate is registered in the gateFactories dispatch map", () => {
  assert.equal(typeof gateFactories["goal"], "function", "gateFactories has a `goal` entry");
  assert.equal(gateFactories["goal"], makeGoalGate, "gateFactories.goal is makeGoalGate (reachable by name)");
});

// ── gate 不写文件 ⇒ 不产生提交（gap-goal-gate-timestamp-commit-flood 的上游，被
//    gap-goal-evidence-cache-should-not-enter-git 取代为「evidence 彻底不进文件」）──────────────
// 为什么必须真 git 仓库：commitGoalFileAfterWrite 在 repo-less 根下是 no-op，非 git fixture 会让
// 「提交与否」观测不到差别（硬规则 4）。判据都是【实跑 gate 再数提交】，⛔ 不是 grep 源码。
// 上游只免了「纯时间戳写入」的提交；本条把 evidence 从文件里彻底移除 ⇒ gate 从不写文件 ⇒ 任何
// verdict（含 flip）都 0 提交。真正的「仍提交」负控制只剩 status flip（AC3 保留）。

/** 从 temp git repo 里取 <id> 的记录文件名（fileNameForId 落点），并返回该文件的提交数。 */
function acFileCommitCount(root, run, id) {
  const file = fs.readdirSync(path.join(root, "goals")).find((f) => f.startsWith(`${id}-`));
  if (!file) throw new Error(`no goal file for ${id}`);
  return run("log", "--oneline", "--", `goals/${file}`).trim().split("\n").filter(Boolean).length;
}

test("AC1 — gate 不写 evidence：两次 gate 后该文件提交数不变（且不脏）", () => {
  const { root, run } = gitRepo("ac1");
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, "--root", root, ...cmd], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-028", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  // The file's commits come from `write` (creation), NEVER from gate — evidence is no longer stored.
  const before = acFileCommitCount(root, run, "AC-028");
  assert.ok(before >= 1, "write must commit the new file (write 提交，⛔ 非 gate)");
  const g1 = n(["gate", "AC-028"]);
  assert.equal(g1.status, 0, g1.stderr);
  const g2 = n(["gate", "AC-028"]);
  assert.equal(g2.status, 0, g2.stderr);
  const after = acFileCommitCount(root, run, "AC-028");
  assert.equal(after, before, `gate must add 0 commits (no evidence write-back; before=${before}, after=${after})`);
  // The gate must not leave the shared checkout dirty (else ff-only sync breaks).
  assert.equal(run("status", "--porcelain", "--", "goals").trim(), "", "no dirty goals/*.md left behind");
});

test("AC2 — verdict 真变化也不提交：fail→pass 后该文件提交数不变（gate 从不写文件）", () => {
  const { root, run } = gitRepo("ac2");
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, "--root", root, ...cmd], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  // Criterion reads a flag file: absent → fail; present → pass. Deterministic flip.
  n(["write", "AC-029", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "test -f passflag", "--origin", "o", "--expect", EXPECT]);
  const before = acFileCommitCount(root, run, "AC-029");
  const g1 = n(["gate", "AC-029"]);
  assert.equal(g1.status, 1, "flag absent must fail");
  // Flip verdict fail→pass (create the flag).
  fs.writeFileSync(path.join(root, "passflag"), "x", "utf8");
  const g2 = n(["gate", "AC-029"]);
  assert.equal(g2.status, 0, "flag present must pass:\n" + g2.stderr);
  const after = acFileCommitCount(root, run, "AC-029");
  assert.equal(after, before, `verdict flip must NOT commit (gate writes no evidence; before=${before}, after=${after})`);
});

test("AC3 — 状态翻转仍然提交：active→achieved 的 flip 后必有提交", () => {
  const { root, run } = gitRepo("ac3");
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, "--root", root, ...cmd], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-030", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  const before = acFileCommitCount(root, run, "AC-030");
  const w = n(["write", "AC-030", "--status", "achieved", "--origin", "o"]);
  assert.equal(w.status, 0, w.stderr);
  const after = acFileCommitCount(root, run, "AC-030");
  assert.equal(after, before + 1, `status flip must commit (before=${before}, after=${after})`);
});

test("AC4 — N 次 gate（含 1 次 verdict flip）⇒ 恰 0 个提交：gate 彻底不写文件", () => {
  const { root, run } = gitRepo("ac4");
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, "--root", root, ...cmd], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-031", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "test -f passflag", "--origin", "o", "--expect", EXPECT]);
  // Simulate the 42s cadence burst: one first fail gate + 3 no-change fail gates, then a flip.
  const g1 = n(["gate", "AC-031"]);
  assert.equal(g1.status, 1, "flag absent must fail");
  const baseline = acFileCommitCount(root, run, "AC-031");
  for (let i = 0; i < 3; i++) {
    const g = n(["gate", "AC-031"]);
    assert.equal(g.status, 1, "flag still absent → fail");
  }
  assert.equal(acFileCommitCount(root, run, "AC-031"), baseline, "3 no-change gates must add 0 commits");
  // A verdict flip also changes nothing on disk (gate writes no evidence) ⇒ still 0 commits.
  fs.writeFileSync(path.join(root, "passflag"), "x", "utf8");
  const g2 = n(["gate", "AC-031"]);
  assert.equal(g2.status, 0, "flag present must pass:\n" + g2.stderr);
  assert.equal(acFileCommitCount(root, run, "AC-031"), baseline, "the verdict flip must add 0 commits too (no evidence write-back at all)");
});

// ── gap-goal-evidence-cache-should-not-enter-git：evidence 是账本派生的，绝不进文件 ──────────────
// 四条 AC 全部【实跑 goal-store gate / check --staleness / get】+ 比对 .quay/gate-events.jsonl，
// ⛔ 不是 grep 源码。AC3 的 UI「—」半边在 serve-goal-doc.test.mjs（负控制：无账本 ⇒ 不显示继承读数）。

test("AC1 (evidence-out-of-git) — gate 后文件逐字节不变", () => {
  const root = tmpDir("cli-ev-ac1");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const args = (a) => ["--root", root, ...a];
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, ...args(cmd)], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-028", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  const file = fs.readdirSync(path.join(root, "goals")).find((f) => f.startsWith("AC-028-"));
  const before = fs.readFileSync(path.join(root, "goals", file), "utf8");
  const g = runCli(["gate", "AC-028", "--root", root]);
  assert.equal(g.status, 0, g.stdout + g.stderr);
  const after = fs.readFileSync(path.join(root, "goals", file), "utf8");
  assert.equal(after, before, "gate must not write evidence ⇒ file byte-for-byte unchanged");
});

test("AC2 (evidence-out-of-git) — lastProgressAt 与 get evidence 都取自账本最后一条", () => {
  const root = tmpDir("cli-ev-ac2");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const args = (a) => ["--root", root, ...a];
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, ...args(cmd)], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-028", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  const g = runCli(["gate", "AC-028", "--root", root]);
  assert.equal(g.status, 0);
  const ledger = fs.readFileSync(path.join(root, ".quay", "gate-events.jsonl"), "utf8").trim().split("\n");
  const tail = JSON.parse(ledger[ledger.length - 1]);
  // 消费者①：goal-store check --staleness 的 lastProgressAt = 账本最后一条 timestamp ⇒ fresh。
  const st = JSON.parse(n(["check", "--staleness"]).stdout);
  assert.deepEqual(st.fresh, ["GOAL-001"], "lastProgressAt derived from ledger ts ⇒ fresh (not notEvaluated)");
  // 消费者②：get 的 evidence.at 与账本最后一条 timestamp 一致（verdict 亦一致）。
  const rec = JSON.parse(n(["get", "AC-028"]).stdout);
  assert.equal(rec.evidence.verdict, tail.verdict);
  assert.equal(rec.evidence.at, tail.timestamp, "evidence.at === ledger tail timestamp (source = ledger)");
});

test("AC3 (evidence-out-of-git) — 无账本 ⇒ notEvaluated，文件里的 stale evidence 不泄漏", () => {
  const root = tmpDir("cli-ev-ac3");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const args = (a) => ["--root", root, ...a];
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, ...args(cmd)], { encoding: "utf8" });
  // 模拟一个从 git 继承的旧文件：frontmatter 里还带着 evidence（历史提交曾写进去的）。
  fs.writeFileSync(path.join(root, "goals", "GOAL-001-p.md"),
    "---\nid: GOAL-001\ntitle: p\nstatus: active\nkind: goal\norigin: o\n---\n## Goal\np\n");
  fs.writeFileSync(path.join(root, "goals", "AC-028-legacy.md"),
    "---\nid: AC-028\ntitle: legacy\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: \"true\"\norigin: o\nevidence:\n  at: 2026-09-01T00:00:00Z\n  verdict: pass\n  reading: \"0\"\n---\n## Rationale\nlegacy\n");
  const st = JSON.parse(n(["check", "--staleness"]).stdout);
  assert.deepEqual(st.notEvaluated, ["GOAL-001"], "no ledger ⇒ notEvaluated, even though the file carries stale evidence");
  const rec = JSON.parse(n(["get", "AC-028"]).stdout);
  assert.equal(rec.evidence, undefined, "file evidence is IGNORED — evidence is ledger-derived only");
});

test("AC4 (evidence-out-of-git) — gate 后两个消费者立刻反映新 verdict（verdict flip）", () => {
  const root = tmpDir("cli-ev-ac4");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const args = (a) => ["--root", root, ...a];
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, ...args(cmd)], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-029", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "test -f passflag", "--origin", "o", "--expect", EXPECT]);
  // fail → get 立刻反映 fail。
  const g1 = runCli(["gate", "AC-029", "--root", root]);
  assert.equal(g1.status, 1, "flag absent must fail");
  let rec = JSON.parse(n(["get", "AC-029"]).stdout);
  assert.equal(rec.evidence.verdict, "fail", "consumer get reflects fail immediately");
  // flip → pass → 两个消费者立刻反映 pass（证明改读账本没有引入滞后）。
  fs.writeFileSync(path.join(root, "passflag"), "x", "utf8");
  const g2 = runCli(["gate", "AC-029", "--root", root]);
  assert.equal(g2.status, 0, "flag present must pass:\n" + g2.stderr);
  rec = JSON.parse(n(["get", "AC-029"]).stdout);
  assert.equal(rec.evidence.verdict, "pass", "consumer get reflects pass immediately");
  const st = JSON.parse(n(["check", "--staleness"]).stdout);
  assert.deepEqual(st.fresh, ["GOAL-001"], "consumer staleness reads the new ledger ts ⇒ fresh");
});

// ── gap-goal-store-empty-scope-reads-as-all-verified: I5/I3 空作用域 ──────────────────────────────
// 空作用域（0 active goal）不得与「全部复验通过」同形（硬规则 3b）。checkAchievedFailing 与
// checkStaleness 都新增 scopeSize + evaluated 两个独立取值：scopeSize = 枚举出的作用域规模，
// evaluated = scopeSize > 0（真跑了判据 / 真评了陈旧）。0 active goal ⇒ evaluated:false、scopeSize:0。

test("AC1 — 0 active goal: checkAchievedFailing 报 evaluated:false + scopeSize:0（⛔ 与全过同形）", () => {
  const s = createGoalStore(tmpDir("empty-af"));
  // 生产形态：criterion 挂在 achieved goal 下（active goal = 0 ⇒ 作用域空）。
  s.write("GOAL-010", { title: "g", status: "achieved", origin: "o", body: GOAL_BODY });
  s.write("AC-010", { title: "a", status: "achieved", goal: "GOAL-010", criterion: "false", origin: "o", expect: EXPECT });
  const af = s.checkAchievedFailing();
  assert.deepEqual(af.achievedButFailing, [], "非 active goal 下的 achieved AC 不在作用域 ⇒ 不进桶");
  assert.equal(af.evaluated, false, "0 active goal ⇒ 未评估（⛔ 与「查过且全过」同形）");
  assert.equal(af.scopeSize, 0, "作用域规模 = 0");
});

test("AC1 CLI — 0 active goal: check --achieved-failing exit 1 + evaluated:false（⛔ 假绿）", () => {
  const root = tmpDir("empty-af-cli");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const args = (a) => ["--root", root, ...a];
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, ...args(cmd)], { encoding: "utf8" });
  n(["write", "GOAL-010", "--title", "p", "--status", "achieved", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-010", "--title", "a", "--status", "achieved", "--goal", "GOAL-010", "--criterion", "false", "--origin", "o", "--expect", EXPECT]);
  const chk = n(["check", "--achieved-failing"]);
  assert.equal(chk.status, 1, "0 active goal ⇒ exit 1（未评估 ≠ 通过，⛔ 假绿）:\n" + chk.stdout + chk.stderr);
  const out = JSON.parse(chk.stdout);
  assert.equal(out.evaluated, false);
  assert.equal(out.scopeSize, 0);
});

test("AC2 — 0 active goal: checkStaleness 报 evaluated:false + scopeSize:0", () => {
  const s = createGoalStore(tmpDir("empty-stale"));
  s.write("GOAL-010", { title: "g", status: "achieved", origin: "o", body: GOAL_BODY });
  const r = s.checkStaleness(Date.now());
  assert.deepEqual(r.fresh, []);
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.notEvaluated, []);
  assert.deepEqual(r.divergent, []);
  assert.equal(r.evaluated, false, "0 active goal ⇒ 未评估");
  assert.equal(r.scopeSize, 0, "作用域规模 = 0");
});

test("AC4 — 负控制：1 active goal + achieved AC ⇒ checkAchievedFailing 报 evaluated:true + scopeSize>0", () => {
  const s = createGoalStore(tmpDir("nonempty-af"));
  s.write("GOAL-010", { title: "g", status: "active", origin: "o", body: GOAL_BODY });
  s.write("AC-010", { title: "a", status: "achieved", goal: "GOAL-010", criterion: "true", origin: "o", expect: EXPECT });
  const af = s.checkAchievedFailing();
  assert.deepEqual(af.achievedButFailing, [], "criterion true ⇒ 不进桶");
  assert.equal(af.evaluated, true, "1 active goal 且有 achieved AC ⇒ 真评估");
  assert.equal(af.scopeSize, 1, "作用域规模 = 1 > 0（⛔ 与空作用域 scopeSize:0 区分）");
});

test("AC4 — 负控制：1 active goal ⇒ checkStaleness 报 evaluated:true + scopeSize>0", () => {
  const s = createGoalStore(tmpDir("nonempty-stale"));
  s.write("GOAL-010", { title: "g", status: "active", origin: "o", body: GOAL_BODY });
  s.write("AC-010", { title: "a", status: "active", goal: "GOAL-010", criterion: "true", origin: "o", expect: EXPECT });
  const r = s.checkStaleness(Date.now());
  assert.equal(r.evaluated, true, "1 active goal ⇒ 真评估");
  assert.equal(r.scopeSize, 1, "作用域规模 = 1 > 0");
  assert.deepEqual(r.notEvaluated, ["GOAL-010"], "无 evidence ⇒ 该 goal 判 notEvaluated（作用域非空但该 goal 未评估——两个不同维度）");
});

// ── gap-goal-store-write-surface-semantics：写入面六缺陷（AC1/AC3/AC4/AC5/AC6）──────────────────
// 六缺陷的证据与七步修法见任务体。这里逐条在【真实 store/CLI】上跑（⛔ 不注入 fixture seam）：
// AC1 P1（--origin create 必传 / update 可省，patch 语义）、AC3 P4/P5（update 空 criterion 拒 /
// status-only 放行）、AC4 P6（激活前置闸：not-evaluated 拒 / 可跑放行）、AC5 P3（activatedAt +
// statusLog 追加，title-only 不追加）、AC6 P9（--dry-run 不落盘）。AC2 与 AC7 在
// plugin/test/goal-invariants-standing.test.mjs（grep 判定 + 常设不变式）。

test("AC1 (P1) — update 省略 --origin 保留原值；create 省略 --origin 仍被拒", () => {
  const root = tmpDir("cli-ac1-p1");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const n = (cmd) => runCli([...cmd, "--root", root]);
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "2026-09-09 human basis", "--body", GOAL_BODY]);
  // 正向：既有记录 update 不传 --origin ⇒ exit 0 且 origin 逐字保留。
  const up = n(["write", "GOAL-001", "--title", "p renamed"]);
  assert.equal(up.status, 0, up.stdout + up.stderr);
  const rec = JSON.parse(n(["get", "GOAL-001"]).stdout);
  assert.equal(rec.origin, "2026-09-09 human basis", "origin must be preserved verbatim");
  assert.equal(rec.title, "p renamed");
  // 反向：新建 id 不传 --origin ⇒ exit≠0（create 必传，契约不被削弱）。
  const create = n(["write", "GOAL-002", "--title", "q", "--status", "draft", "--body", GOAL_BODY]);
  assert.notEqual(create.status, 0, "create without --origin must fail");
  assert.match(create.stderr, /origin is required/);
});

test("AC3 (P4/P5) — update --criterion \"\" 被拒；status-only 放行（机械 flip 不被挡）", () => {
  const root = tmpDir("cli-ac3-p4");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const n = (cmd) => runCli([...cmd, "--root", root]);
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-001", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  // 正向：update 清空 criterion ⇒ exit≠0（旧代码 exit 0 静默写成空串）。
  const blank = n(["write", "AC-001", "--criterion", ""]);
  assert.notEqual(blank.status, 0, "blanking criterion on update must fail:\n" + blank.stdout + blank.stderr);
  assert.match(blank.stderr, /criterion/);
  // 反向：只碰 status ⇒ exit 0。
  const flip = n(["write", "AC-001", "--status", "achieved"]);
  assert.equal(flip.status, 0, flip.stdout + flip.stderr);
  assert.equal(JSON.parse(n(["get", "AC-001"]).stdout).status, "achieved");
});

test("AC4 (P6) — 激活不可评估 criterion 的 AC 被拒（stderr 含 not-evaluated）；可跑的放行", () => {
  const root = tmpDir("cli-ac4-p6");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const n = (cmd) => runCli([...cmd, "--root", root]);
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  // 一条 draft 且无 criterion 的遗留 AC（不可评估）。
  fs.writeFileSync(path.join(root, "goals", "AC-020-legacy.md"),
    "---\nid: AC-020\ntitle: no-criterion\nstatus: draft\nkind: criterion\ngoal: GOAL-001\norigin: o\n---\n## Rationale\nlegacy\n", "utf8");
  const act = n(["write", "AC-020", "--status", "active"]);
  assert.notEqual(act.status, 0, "activating an unevaluable criterion must fail:\n" + act.stdout + act.stderr);
  assert.match(act.stderr, /not-evaluated/);
  // 反向：可跑判据（fail 亦可）⇒ 放行。
  n(["write", "AC-021", "--title", "runnable", "--status", "draft", "--goal", "GOAL-001", "--criterion", "false", "--origin", "o", "--expect", EXPECT]);
  const ok = n(["write", "AC-021", "--status", "active"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(n(["get", "AC-021"]).stdout).status, "active");
});

// ── gap-activation-gates-bypassed-on-reopen-path-non-draft-to-active：重开路径（非 draft→active）
// 也必须过三道激活闸。改动前 `activating` 只认 draft→active ⇒ achieved/needs-human → active 一道闸都
// 不触发（实测占激活总数 ~19%）。这里逐条在【真实 CLI】上跑（⛔ 非纯 import 单测）。

test("AC1 (P6 reopen) — achieved→active 触发可评估性闸：不可评估拒且不写状态；可跑（含 exit≠0）放行", () => {
  const root = tmpDir("cli-ac1-reopen");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const n = (cmd) => runCli([...cmd, "--root", root]);
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  // 方向①放行：一条已 achieved、判据 exit≠0（`false`）的 AC——确定性判决 ⇒ 可评估 ⇒ 重开放行。
  n(["write", "AC-001", "--title", "a", "--status", "achieved", "--goal", "GOAL-001", "--criterion", "false", "--origin", "o", "--expect", EXPECT]);
  const ok = n(["write", "AC-001", "--status", "active"]);
  assert.equal(ok.status, 0, "achieved→active with a runnable (exit≠0) criterion must pass:\n" + ok.stdout + ok.stderr);
  assert.equal(JSON.parse(n(["get", "AC-001"]).stdout).status, "active");
  // 方向②拒绝（空 criterion）：遗留 achieved 记录无 criterion 字段 ⇒ 重开被拒且状态不写（仍 achieved）。
  fs.writeFileSync(path.join(root, "goals", "AC-003-legacy.md"),
    "---\nid: AC-003\ntitle: no-criterion\nstatus: achieved\nkind: criterion\ngoal: GOAL-001\norigin: o\n---\n## Rationale\nlegacy\n", "utf8");
  const bad = n(["write", "AC-003", "--status", "active"]);
  assert.notEqual(bad.status, 0, "achieved→active with an empty criterion must fail:\n" + bad.stdout + bad.stderr);
  assert.match(bad.stderr, /not-evaluated/);
  assert.equal(JSON.parse(n(["get", "AC-003"]).stdout).status, "achieved", "⛔ 拒绝激活 ⇒ 状态不被写（仍 achieved）");
});

test("AC4 (P6 create) — create-as-active 不过闸（无 'criterion ran' 痕迹、不写 fidelity）", () => {
  const root = tmpDir("cli-ac4-create-active");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const n = (cmd) => runCli([...cmd, "--root", root]);
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  // 新建即 active（prevStatus === undefined）⇒ 不过闸：闸的两种可见副作用（stderr 的 "criterion ran"
  // 痕迹 + 记录里的 fidelity 字段）都不出现。改动前 `activating` 的 create-as-active 豁免被保留。
  const create = n(["write", "AC-004", "--title", "c", "--status", "active", "--goal", "GOAL-001", "--criterion", "false", "--origin", "o", "--expect", EXPECT]);
  assert.equal(create.status, 0, "create-as-active must succeed:\n" + create.stdout + create.stderr);
  assert.ok(!/activated .*criterion ran/.test(create.stderr), "create-as-active 不过闸 ⇒ 无 'criterion ran' 痕迹:\n" + create.stderr);
  const rec = JSON.parse(n(["get", "AC-004"]).stdout);
  assert.equal(rec.status, "active");
  assert.equal(rec.fidelity, undefined, "create-as-active 不过闸 ⇒ fidelity 不写（闸从未跑）");
});

test("AC5 (P3) — draft→active 写 activatedAt + statusLog；title-only 不追加 statusLog", () => {
  const s = createGoalStore(tmpDir("ac5-p3"));
  s.write("GOAL-001", { title: "p", status: "active", origin: "o", body: GOAL_BODY });
  s.write("AC-001", { title: "a", status: "draft", goal: "GOAL-001", criterion: "true", origin: "o", expect: EXPECT });
  s.write("AC-001", { status: "active" }); // draft→active
  const rec = s.get("AC-001");
  assert.ok(typeof rec.activatedAt === "string" && rec.activatedAt.length > 0, "activatedAt set on first activation");
  assert.ok(Array.isArray(rec.statusLog) && rec.statusLog.length === 1, "statusLog appends exactly one entry");
  assert.equal(rec.statusLog[0].from, "draft");
  assert.equal(rec.statusLog[0].to, "active");
  assert.ok(typeof rec.statusLog[0].at === "string" && rec.statusLog[0].at.length > 0);
  // 反向：只改 title ⇒ 不追加 statusLog 条目。
  s.write("AC-001", { title: "a renamed" });
  const rec2 = s.get("AC-001");
  assert.equal(rec2.statusLog.length, 1, "title-only write must not append a statusLog entry");
});

test("AC6 (P9) — write --dry-run exit 0 ∧ goals/ 无新增变化 ∧ 记录内容未变", () => {
  const { root, run } = gitRepo("ac6-dryrun");
  const n = (cmd) => runCli([...cmd, "--root", root]);
  n(["write", "GOAL-001", "--title", "p", "--status", "draft", "--origin", "o", "--body", GOAL_BODY]);
  // gap-meta-goal-store-activation-gate: the activation gate now requires ≥1 AC naming the GOAL, so a
  // zero-AC fixture would be rejected for THAT reason and this test would stop measuring P9. Give the
  // goal its exit condition (a real AC record) so the dry-run below is a gate-PASSING activation —
  // the subject here stays dry-run semantics (exit 0, nothing persisted), not activation legality.
  n(["write", "AC-001", "--title", "a", "--status", "draft", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  const file = fs.readdirSync(path.join(root, "goals")).find((f) => f.startsWith("GOAL-001-"));
  const before = fs.readFileSync(path.join(root, "goals", file), "utf8");
  const dry = n(["write", "GOAL-001", "--status", "active", "--dry-run"]);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.equal(run("status", "--porcelain", "--", "goals").trim(), "", "dry-run must leave goals/ clean");
  const after = fs.readFileSync(path.join(root, "goals", file), "utf8");
  assert.equal(after, before, "dry-run must not change the record content");
  assert.equal(JSON.parse(n(["get", "GOAL-001"]).stdout).status, "draft", "record still draft — dry-run persisted nothing");
});

// ── gap-goal-store-write-no-create-vs-update-intent-guard：create/update 意图声明（CAS）────────────
// `write` 曾一个动词兼管新建与更新（patch 语义）⇒ 陈旧的「存在性检查」会静默覆盖另一会话刚创建的活跃
// 记录（2026-09-10 GOAL-013 事故：check 与 write 相隔 33 分钟，占用发生在其中 110 秒）。本任务补上
// task_write `expectedStatus` 的同族 CAS：`--expect-absent`（意在新建，已存在即拒）/ `--expect-existing`
// （意在更新，不存在即拒）。失配抛 `GoalIntentConflictError`（独立类，非「可解析文案的通用 Error」——
// 调用方可 `instanceof` 捕获该竞态），且【落锁内、落盘前】拒绝 ⇒ 目标文件不被改动。全部在真实
// goal-store/CLI 上跑，⛔ 非 mock、非 fixture 注入。

test("AC1 — 已存在的 active GOAL + `--expect-absent`（create 意图）⇒ 非零退出 + 文件未被改动（事故重放）", () => {
  const { root, run } = gitRepo("intent-ac1");
  const n = (cmd) => runCli([...cmd, "--root", root]);
  n(["write", "GOAL-013", "--title", "original title", "--status", "active", "--origin", "original origin", "--body", GOAL_BODY]);
  const file = fs.readdirSync(path.join(root, "goals")).find((f) => f.startsWith("GOAL-013-"));
  const before = run("hash-object", `goals/${file}`).trim();
  // 事故形态：目标已存在且 active，写入方意图新建（显式传 title/origin/body）⇒ 必须被拒。
  const w = n(["write", "GOAL-013", "--title", "overwritten", "--origin", "overwritten origin", "--body", GOAL_BODY, "--expect-absent"]);
  assert.notEqual(w.status, 0, "create intent on an existing record must exit non-zero:\n" + w.stdout + w.stderr);
  assert.match(w.stderr, /already exists/, "stderr must name the existing-record conflict:\n" + w.stderr);
  const after = run("hash-object", `goals/${file}`).trim();
  assert.equal(after, before, "the refused write must leave the target file byte-identical (git hash-object unchanged)");
  assert.equal(JSON.parse(n(["get", "GOAL-013"]).stdout).title, "original title", "record content untouched");
});

test("AC1 library — 已存在记录 + intent 'absent' 抛 GoalIntentConflictError（instanceof 可捕获）", () => {
  const s = createGoalStore(tmpDir("intent-ac1-lib"));
  s.write("GOAL-013", { title: "p", status: "active", origin: "o", body: GOAL_BODY });
  let caught = null;
  try {
    s.write("GOAL-013", { title: "overwritten", origin: "o2", body: GOAL_BODY, intent: "absent" });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof GoalIntentConflictError, "must throw the specific class, not a generic Error");
  assert.equal(caught.expect, "absent");
  assert.equal(caught.actual, "present");
  assert.equal(s.get("GOAL-013").title, "p", "the refused write must not overwrite");
});

test("AC2 — 不存在的 id + `--expect-existing`（update 意图）⇒ 非零退出 + 不创建文件", () => {
  const { root } = gitRepo("intent-ac2");
  const n = (cmd) => runCli([...cmd, "--root", root]);
  const w = n(["write", "GOAL-099", "--title", "p", "--origin", "o", "--body", GOAL_BODY, "--expect-existing"]);
  assert.notEqual(w.status, 0, "update intent on an absent id must exit non-zero:\n" + w.stdout + w.stderr);
  assert.match(w.stderr, /does not exist/, "stderr must name the absent-record conflict:\n" + w.stderr);
  assert.equal(fs.readdirSync(path.join(root, "goals")).length, 0, "the refused write must not create a file");
});

test("AC2 library — 不存在 id + intent 'existing' 抛 GoalIntentConflictError 且不落盘", () => {
  const s = createGoalStore(tmpDir("intent-ac2-lib"));
  let caught = null;
  try {
    s.write("GOAL-099", { title: "p", origin: "o", body: GOAL_BODY, intent: "existing" });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof GoalIntentConflictError);
  assert.equal(caught.expect, "existing");
  assert.equal(caught.actual, "absent");
  assert.equal(s.list().length, 0, "nothing written to disk");
});

test("AC3 — 未声明意图时 create/update 的落痕可区分（提交 subject `create` ≠ `field:…`）", () => {
  const { root, run } = gitRepo("intent-ac3");
  const n = (cmd) => runCli([...cmd, "--root", root]);
  // 方向①（反之）：调用方以为存在（update 式写）实则不存在 ⇒ store 创建 ⇒ 落痕 `create`。
  n(["write", "GOAL-001", "--title", "fresh", "--origin", "o", "--body", GOAL_BODY]);
  const createSubj = run("log", "--oneline", "-1", "--format=%s").trim();
  assert.match(createSubj, /create/, `a no-intent write to an absent id must trace as create, got: ${createSubj}`);
  // 方向②（正向）：调用方以为不存在（create 式写）实则存在 ⇒ store 更新 ⇒ 落痕 `field:…`。
  n(["write", "GOAL-001", "--title", "renamed"]);
  const updateSubj = run("log", "--oneline", "-1", "--format=%s").trim();
  assert.match(updateSubj, /field:title/, `a no-intent write to an existing id must trace as field:…, got: ${updateSubj}`);
  assert.notEqual(createSubj, updateSubj, "create and update must leave distinguishable traces (never byte-identical)");
});

test("AC4 — status-only flip 不传意图声明仍 exit 0（goal-driver 机械 flip 不回归）", () => {
  const { root } = gitRepo("intent-ac4");
  const n = (cmd) => runCli([...cmd, "--root", root]);
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-001", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  const flip = n(["write", "AC-001", "--status", "achieved"]); // no --origin, no intent
  assert.equal(flip.status, 0, "status-only flip without intent must still exit 0:\n" + flip.stdout + flip.stderr);
  assert.equal(JSON.parse(n(["get", "AC-001"]).stdout).status, "achieved");
  // 已存在的记录 + 不声明意图仍走 patch 语义（不误触 intent 闸）。
  const patch = n(["write", "GOAL-001", "--title", "p2"]);
  assert.equal(patch.status, 0, patch.stdout + patch.stderr);
});

// ── AC-216 `long-term` 的机器写路径（gap-goal-closure-freezes-failing-ac-outside-reverify-scope）────
// AC-216 建立了 `long-term: true` 的语义（list 投影 longTerm / I5 复验域），但 `write` 的 flag 表
// 没有它 —— 现有三条（AC-188/189/190）是直接改 frontmatter 加的（commit a1cae4de0）。本组测试锁住
// `--long-term true|false` 这条机器写路径：它是「存量消解」的合规入口，⛔ 不手改 goals/*.md frontmatter。

test("AC-longterm-1 — `--long-term true` 写入并经 get 回读 longTerm===true（机件回读，⛔ 不采信文件字面）", () => {
  const root = tmpDir("longterm-write");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const n = (cmd) => runCli(["--root", root, ...cmd]);
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-001", "--title", "a", "--status", "achieved", "--goal", "GOAL-001", "--criterion", "false", "--origin", "o", "--expect", EXPECT]);
  assert.equal(JSON.parse(n(["get", "AC-001"]).stdout).longTerm, false, "前置：未声明时 longTerm 为 false");
  const w = n(["write", "AC-001", "--long-term", "true"]);
  assert.equal(w.status, 0, `--long-term true 必须 exit 0:\n${w.stdout}${w.stderr}`);
  const rec = JSON.parse(n(["get", "AC-001"]).stdout);
  assert.equal(rec.longTerm, true, "get 回读 longTerm===true（view-model 投影，⛔ 不 grep 文件字面）");
  assert.equal(rec.status, "achieved", "patch 语义：其余字段（status）保持原值");
  assert.equal(rec.criterion, "false", "patch 语义：criterion 未被清空");
});

test("AC-longterm-2 — `--long-term false` 是【显式清除】而非 no-op（与省略该 flag 的 patch 语义可分）", () => {
  const root = tmpDir("longterm-false");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const n = (cmd) => runCli(["--root", root, ...cmd]);
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-001", "--title", "a", "--status", "achieved", "--goal", "GOAL-001", "--criterion", "false", "--origin", "o", "--expect", EXPECT, "--long-term", "true"]);
  assert.equal(JSON.parse(n(["get", "AC-001"]).stdout).longTerm, true, "前置：已声明");
  // 省略 flag 的 patch 写 ⇒ 保留声明（⛔ 不能被无关字段更新顺手清掉）。
  n(["write", "AC-001", "--title", "a2"]);
  assert.equal(JSON.parse(n(["get", "AC-001"]).stdout).longTerm, true, "省略 --long-term ⇒ patch 语义保留已声明的 true");
  // 显式 false ⇒ 清除。
  const w = n(["write", "AC-001", "--long-term", "false"]);
  assert.equal(w.status, 0, `--long-term false 必须 exit 0:\n${w.stdout}${w.stderr}`);
  assert.equal(JSON.parse(n(["get", "AC-001"]).stdout).longTerm, false, "显式 false ⇒ 清除声明（与省略可分）");
});

test("AC-longterm-3 — `--long-term yes` ⇒ exit 2 且不落任何变更（⛔ 不做真值强转）", () => {
  const root = tmpDir("longterm-strict");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const n = (cmd) => runCli(["--root", root, ...cmd]);
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-001", "--title", "a", "--status", "achieved", "--goal", "GOAL-001", "--criterion", "false", "--origin", "o", "--expect", EXPECT]);
  for (const bad of ["yes", "1", "TRUE", ""]) {
    const w = n(["write", "AC-001", "--long-term", bad]);
    assert.equal(w.status, 2, `--long-term ${JSON.stringify(bad)} 必须 exit 2（fail-closed）:\n${w.stdout}${w.stderr}`);
    assert.match(w.stderr, /--long-term must be exactly true or false/, "错误信息点名该 flag");
  }
  assert.equal(JSON.parse(n(["get", "AC-001"]).stdout).longTerm, false, "被拒的写不落任何变更（longTerm 仍 false）");
  // 缺值（末参数）同样 exit 2——⛔ 不得静默写成 undefined/false。
  const missing = runCli(["--root", root, "write", "AC-001", "--long-term"], { encoding: "utf8" });
  assert.equal(missing.status, 2, "缺值 ⇒ exit 2");
});

test("AC-longterm-4 — 创建时即可声明（create 路径）且 commit subject 点名 long-term（可归因）", () => {
  const { root, run } = gitRepo("longterm-create");
  const n = (cmd) => runCli(["--root", root, ...cmd]);
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-001", "--title", "a", "--status", "achieved", "--goal", "GOAL-001", "--criterion", "false", "--origin", "o", "--expect", EXPECT]);
  const flip = n(["write", "AC-001", "--long-term", "true"]);
  assert.equal(flip.status, 0, flip.stdout + flip.stderr);
  const subj = run("log", "--oneline", "-1", "--format=%s").trim();
  assert.match(subj, /long-term/, `字段更新必须在 commit subject 里可归因，got: ${subj}`);
  assert.equal(JSON.parse(n(["get", "AC-001"]).stdout).longTerm, true, "落盘后回读可见");
});

// ── gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared ───────────────────────
// The defect: GOAL-009 (17 ACs) + GOAL-015 (4 ACs) closed on 2026-09-11 and their achieved ACs left
// the I5 reverify scope wholesale. Which of them are STANDING guarantees (and must keep being
// re-verified) is a HUMAN ruling — and until this task that ruling had nowhere to land: the store can
// only report what the `long-term` FIELD is, never what it OUGHT to be. So the ruling lived as prose
// and a ruling that never became a field was invisible on EVERY carrier (hard rule 9). These tests
// cover the one command that closes that loop: it cross-checks the ruling table against the field.

test("AC-reverify-1 — checkReverifyScope annotates each in-scope AC with goal / goalStatus / longTerm", () => {
  const s = createGoalStore(tmpDir("reverify1"));
  // GOAL-001 stays ACTIVE ⇒ its achieved AC is in scope via the FIRST branch of the predicate.
  s.write("GOAL-001", { title: "active goal", status: "active", origin: "o", body: GOAL_BODY });
  s.write("AC-001", { title: "under an active goal", status: "achieved", goal: "GOAL-001", criterion: "true", origin: "o", expect: EXPECT });
  // GOAL-002 is CLOSED ⇒ its ACs leave the scope unless each carries `long-term: true`.
  s.write("GOAL-002", { title: "closed goal", status: "active", origin: "o", body: GOAL_BODY });
  s.write("AC-002", { title: "leaves with its GOAL", status: "achieved", goal: "GOAL-002", criterion: "true", origin: "o", expect: EXPECT });
  s.write("AC-003", { title: "standing guarantee", status: "achieved", goal: "GOAL-002", criterion: "true", origin: "o", expect: EXPECT });
  s.write("GOAL-002", { status: "achieved" });
  s.write("AC-003", { longTerm: true });

  const r = s.checkReverifyScope();
  // The ANNOTATION is the point: a bare id list cannot tell "under an active goal" from "declared
  // long-term", and without that dimension the leaving set cannot be audited against the ruling.
  assert.deepEqual(r.inScope, [
    { id: "AC-001", goal: "GOAL-001", goalStatus: "active", longTerm: false },
    { id: "AC-003", goal: "GOAL-002", goalStatus: "achieved", longTerm: true },
  ]);
  assert.deepEqual(r.outOfScope, [
    { id: "AC-002", goal: "GOAL-002", goalStatus: "achieved", longTerm: false },
  ]);
  assert.equal(r.scopeSize, 2, "scopeSize matches I5's own predicate");
  assert.equal(r.evaluated, true);
  // AC1's literal guard, kept as a TRIPWIRE ON THE PREDICATE (⛔ not as a measurement of the data):
  // given `inAchievedReverifyScope` it is structurally empty — a GOAL whose status is `achieved` is
  // not active, so membership required `longTerm: true`. It fires only if the predicate is WIDENED.
  assert.deepEqual(r.inScope.filter((e) => e.goalStatus === "achieved" && !e.longTerm).map((e) => e.id), []);
  assert.deepEqual(r.skippedNoCriterion, [], "an in-scope AC dropped for an empty criterion stays VISIBLE here");
});

test("AC-reverify-2 — a ruling that did not land as a field is reported; writing the field clears it", () => {
  const root = tmpDir("reverify2");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const n = (cmd) => runCli(["--root", root, ...cmd]);
  n(["write", "GOAL-001", "--title", "closed", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-001", "--title", "a", "--status", "achieved", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  n(["write", "GOAL-001", "--status", "achieved"]);

  const table = path.join(root, "adjudication.md");
  fs.writeFileSync(table, "| AC | 裁定 | 理由 |\n|---|---|---|\n| AC-001 | 常设不变式 | 会随时间自行失效 |\n");

  // BEFORE: the ruling says "standing invariant" but no field carries it ⇒ the scope does NOT cover
  // it. This is the falsifiable half — exit 1, and the AC is NAMED (enumerate, never boolean).
  const before = n(["check", "--reverify-scope", "--adjudication", table]);
  assert.equal(before.status, 1, `改前必须报红:\n${before.stdout}${before.stderr}`);
  const b = JSON.parse(before.stdout);
  assert.deepEqual(b.adjudication.standingMissing, ["AC-001"]);
  assert.deepEqual(b.inScope, []);
  assert.equal(b.scopeSize, 0);
  assert.deepEqual(b.adjudication.unrecognized, [], "the ruling text itself parsed fine — the gap is the FIELD");

  // AFTER: the same command, the only change being the field ⇒ green, and the AC is in scope.
  const w = n(["write", "AC-001", "--long-term", "true"]);
  assert.equal(w.status, 0, w.stdout + w.stderr);
  const after = n(["check", "--reverify-scope", "--adjudication", table]);
  assert.equal(after.status, 0, `改后必须绿:\n${after.stdout}${after.stderr}`);
  const a = JSON.parse(after.stdout);
  assert.deepEqual(a.adjudication.standingMissing, []);
  assert.deepEqual(a.inScope.map((e) => e.id), ["AC-001"]);
  assert.equal(a.scopeSize - b.scopeSize, 1, "AC4 — the scope grew by exactly the number marked");
});

test("AC-reverify-3 — the REVERSE error (ruled one-time yet still in scope) is reported, not ignored", () => {
  const root = tmpDir("reverify3");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const n = (cmd) => runCli(["--root", root, ...cmd]);
  n(["write", "GOAL-001", "--title", "active", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-001", "--title", "a", "--status", "achieved", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  const table = path.join(root, "adjudication.md");
  // GOAL-001 is ACTIVE ⇒ AC-001 is in scope regardless of long-term; a ruling of "one-time" therefore
  // contradicts the carrier. Without this arm the cross-check would only police one direction.
  fs.writeFileSync(table, "| AC | 裁定 | 理由 |\n|---|---|---|\n| AC-001 | 一次性验收 | 不该还在域里 |\n");
  const r = n(["check", "--reverify-scope", "--adjudication", table]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).adjudication.oneTimeButInScope, ["AC-001"]);
});

test("AC-reverify-4 — an unreadable ruling text is reported as `unrecognized`, never silently dropped", () => {
  // hard rule 3b: "could not evaluate" must not share an output shape with "evaluated and fine".
  const t = parseAdjudicationTable(
    "| AC | 裁定 | 理由 |\n|---|---|---|\n| AC-001 | 常设不变式 | keep |\n| AC-002 | 一次性验收 | once |\n| AC-003 | 也许吧 | ambiguous |\n"
  );
  assert.deepEqual(t.standing, ["AC-001"]);
  assert.deepEqual(t.oneTime, ["AC-002"]);
  assert.deepEqual(t.unrecognized, [{ id: "AC-003", ruling: "也许吧" }]);
  // Rows are excluded BY SHAPE (id cell must be AC-NNN), so a header/separator never parses as a row
  // and a moved table cannot silently lose one.
  assert.deepEqual(parseAdjudicationTable("| GOAL-001 | 常设不变式 | not an AC row |\n"), {
    standing: [], oneTime: [], unrecognized: [],
  });
});

test("AC-reverify-5 — the CLI reports NOT-EVALUATED (exit 3) when the scope is empty, ⛔ never exit 0", () => {
  const root = tmpDir("reverify5");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  const n = (cmd) => runCli(["--root", root, ...cmd]);
  n(["write", "GOAL-001", "--title", "active", "--status", "active", "--origin", "o", "--body", GOAL_BODY]);
  n(["write", "AC-001", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o", "--expect", EXPECT]);
  const r = n(["check", "--reverify-scope"]);
  // An unachieved AC is not in the I5 scope at all, so nothing was evaluated: "empty" must be
  // distinguishable from "read and all fine" (hard rule 3b).
  assert.equal(r.status, 3, `空域必须 exit 3（NOT-EVALUATED）而不是 0:\n${r.stdout}${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).scopeSize, 0);
  assert.equal(JSON.parse(r.stdout).evaluated, false);
});
