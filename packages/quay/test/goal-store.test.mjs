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
import { createGoalStore, VALID_GOAL_STATUSES, isGoalId, isCriterionId } from "../src/goal-store.ts";
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

// ── AC10: I1′ hard cap (SPEC §4.1) ──────────────────────────────────────────────────────────────
test("AC10 — under the default cap (3), a second and third active GOAL are allowed; a fourth is rejected", () => {
  const s = createGoalStore(tmpDir("ac10a"));
  s.write("GOAL-001", { title: "p1", status: "active", origin: "o" });
  s.write("GOAL-002", { title: "p2", status: "active", origin: "o" });
  s.write("GOAL-003", { title: "p3", status: "active", origin: "o" });
  assert.throws(
    () => s.write("GOAL-004", { title: "p4", status: "active", origin: "o" }),
    /exceed cap 3/
  );
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

// ── AC11: I2 derived (never stored) + checkWithinCap checker ─────────────────────────────────────
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

test("AC11 — a goal with zero ACs is not achieved; checkWithinCap splits withinCap from hasDirection", () => {
  const s = createGoalStore(tmpDir("ac11b"));
  s.write("GOAL-010", { title: "p10", status: "active", origin: "o" });
  assert.equal(s.isGoalAchieved("GOAL-010"), false, "no ACs → not achieved");
  let chk = s.checkWithinCap();
  assert.equal(chk.withinCap, true);
  assert.equal(chk.hasDirection, true);
  assert.equal(chk.activeCount, 1);
  assert.equal(chk.cap, 3);
  assert.deepEqual(chk.active, ["GOAL-010"]);
  s.write("GOAL-011", { title: "p11", status: "active", origin: "o", disposeOld: { id: "GOAL-010", to: "achieved" } });
  chk = s.checkWithinCap();
  assert.equal(chk.withinCap, true);
  assert.equal(chk.activeCount, 1);
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
  s.write("GOAL-001", { title: "p1", status: "active", origin: "o" });
  s.write("GOAL-002", { title: "p2", status: "active", origin: "o" });
  let caught = null;
  try {
    s.write("GOAL-003", { title: "p3", status: "active", origin: "o" });
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
  s.write("GOAL-001", { title: "bare", status: "active", origin: "o" });
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
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o"]);

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
  s.write("GOAL-010", { title: "p10", status: "active", origin: "o" });
  s.write("AC-010", { title: "a1", status: "achieved", goal: "GOAL-010", criterion: "true", origin: "o" });
  s.write("AC-011", { title: "a2", status: "achieved", goal: "GOAL-010", criterion: "true", origin: "o" });
  assert.equal(s.isGoalAchieved("GOAL-010"), true, "all ACs achieved → derived achieved");
  const r = s.checkStaleness(Date.now());
  assert.deepEqual(r.divergent, ["GOAL-010"], "active yet achieved ⇒ divergent (I4)");
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

// ── gap-goal-gate-timestamp-commit-flood：纯时间戳写入不得产生提交 ──────────────────────────────
// 为什么必须真 git 仓库：commitGoalFileAfterWrite 在 repo-less 根下是 no-op，非 git fixture 会让
// 「提交与否」观测不到差别（硬规则 4）。判据都是【实跑 gate 再数提交】，⛔ 不是 grep 源码。

/** 从 temp git repo 里取 <id> 的记录文件名（fileNameForId 落点），并返回该文件的提交数。 */
function acFileCommitCount(root, run, id) {
  const file = fs.readdirSync(path.join(root, "goals")).find((f) => f.startsWith(`${id}-`));
  if (!file) throw new Error(`no goal file for ${id}`);
  return run("log", "--oneline", "--", `goals/${file}`).trim().split("\n").filter(Boolean).length;
}

test("AC1 — 纯时间戳写入不产生提交：两次 gate（verdict 不变）后提交数不增加", () => {
  const { root, run } = gitRepo("ac1");
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, "--root", root, ...cmd], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o"]);
  n(["write", "AC-028", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o"]);
  // First gate: evidence first written (verdict=pass) ⇒ substantive ⇒ commit.
  const g1 = n(["gate", "AC-028"]);
  assert.equal(g1.status, 0, g1.stderr);
  const before = acFileCommitCount(root, run, "AC-028");
  assert.ok(before >= 1, "first gate must commit (evidence first written)");
  // Second gate: verdict unchanged ⇒ only evidence.at refreshes ⇒ NO commit.
  const g2 = n(["gate", "AC-028"]);
  assert.equal(g2.status, 0, g2.stderr);
  const after = acFileCommitCount(root, run, "AC-028");
  assert.equal(after, before, `timestamp-only gate must not commit (before=${before}, after=${after})`);
  // The timestamp refresh must also not leave the shared checkout dirty (else ff-only sync breaks).
  assert.equal(run("status", "--porcelain", "--", "goals").trim(), "", "no dirty goals/*.md left behind");
});

test("AC2 — verdict 真变化仍然提交：fail→pass 后该文件恰好多 1 个提交（负控制）", () => {
  const { root, run } = gitRepo("ac2");
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, "--root", root, ...cmd], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o"]);
  // Criterion reads a flag file: absent → fail; present → pass. Deterministic flip.
  n(["write", "AC-029", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "test -f passflag", "--origin", "o"]);
  const g1 = n(["gate", "AC-029"]);
  assert.equal(g1.status, 1, "flag absent must fail");
  const before = acFileCommitCount(root, run, "AC-029");
  // Flip verdict fail→pass (create the flag).
  fs.writeFileSync(path.join(root, "passflag"), "x", "utf8");
  const g2 = n(["gate", "AC-029"]);
  assert.equal(g2.status, 0, "flag present must pass:\n" + g2.stderr);
  const after = acFileCommitCount(root, run, "AC-029");
  assert.equal(after, before + 1, `verdict flip must commit exactly once (before=${before}, after=${after})`);
});

test("AC3 — 状态翻转仍然提交：active→achieved 的 flip 后必有提交", () => {
  const { root, run } = gitRepo("ac3");
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, "--root", root, ...cmd], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o"]);
  n(["write", "AC-030", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "true", "--origin", "o"]);
  const before = acFileCommitCount(root, run, "AC-030");
  const w = n(["write", "AC-030", "--status", "achieved", "--origin", "o"]);
  assert.equal(w.status, 0, w.stderr);
  const after = acFileCommitCount(root, run, "AC-030");
  assert.equal(after, before + 1, `status flip must commit (before=${before}, after=${after})`);
});

test("AC4 — 提交速率回落到真实变化量：N 次无变化 gate + 1 次 flip ⇒ 恰 1 个提交", () => {
  const { root, run } = gitRepo("ac4");
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const n = (cmd) => spawnSync("node", ["--experimental-strip-types", cli, "--root", root, ...cmd], { encoding: "utf8" });
  n(["write", "GOAL-001", "--title", "p", "--status", "active", "--origin", "o"]);
  n(["write", "AC-031", "--title", "a", "--status", "active", "--goal", "GOAL-001", "--criterion", "test -f passflag", "--origin", "o"]);
  // Simulate the 42s cadence burst: one first fail gate (substantive evidence) + 3 no-change fail gates.
  const g1 = n(["gate", "AC-031"]);
  assert.equal(g1.status, 1, "flag absent must fail");
  const baseline = acFileCommitCount(root, run, "AC-031");
  for (let i = 0; i < 3; i++) {
    const g = n(["gate", "AC-031"]);
    assert.equal(g.status, 1, "flag still absent → fail");
  }
  assert.equal(acFileCommitCount(root, run, "AC-031"), baseline, "3 no-change gates must add 0 commits");
  // One real change (verdict flip) ⇒ exactly one commit, not 4 (the no-change gates contributed 0).
  fs.writeFileSync(path.join(root, "passflag"), "x", "utf8");
  const g2 = n(["gate", "AC-031"]);
  assert.equal(g2.status, 0, "flag present must pass:\n" + g2.stderr);
  assert.equal(acFileCommitCount(root, run, "AC-031"), baseline + 1, "the single verdict flip must add exactly 1 commit");
});
