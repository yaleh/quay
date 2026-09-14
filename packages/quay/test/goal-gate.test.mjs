// @test-group product
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-12 real shell criteria executed via the acceptance-runner shape; moved product→serial 2026-08-12 (8-lane flakes, isolated 5/5 — gap-suite-tiering-kind-heavy-not-a-mechanism 补缺省 kind)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — runs real shell-command criteria (criterion: "true"/"false" spawn shells)
// The `goal-<id>` gate — criterion-as-contract enforcement (SPEC §3), the third gate shape
// alongside `adr-<id>` (makeAdrGate, shell-out enforcement) and `doc-<id>` (makeDocumentContractGate,
// in-process contracts). A goal record's `criterion` is a runnable shell command executed via the
// task acceptance-runner shape (runAcceptance). Fails CLOSED when the record is missing or has no
// criterion — an unenforceable AC must never silently PASS (SPEC §2.4/§3).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { gateRegistry, registerGoalGate, listGates } from "../src/gate/registry.ts";
import { makeGoalGate } from "../src/gate/factories/goal.ts";
import { createGoalStore } from "../src/goal-store.ts";

const _createdDirs = [];
function tmpGoalDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-goal-gate-${tag}-`));
  _createdDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// gap-goal-record-completeness-undefined: a GOAL's body is required (≥40 non-whitespace chars)
// and a criterion's content lives in criterion+expect — these keep every fixture write complete.
const GOAL_BODY = "goal body: background, scope, non-goals and exit conditions — long enough to satisfy the 40-char minimum";
const EXPECT = "the expected outcome this criterion proves";

// gap-goal-create-as-active-skips-zero-ac-gate: the P6-goal gate now covers the CREATE path, so a
// brand-new GOAL that no AC names can no longer be born `active`. Every fixture here needs a LIVE
// goal, so it files the exit condition first (draft goal → AC → activate), as production now must.
function seedAc(store, goalId) {
  const id = `AC-9${String(Number(String(goalId).replace(/\D/g, ""))).padStart(2, "0")}`;
  return store.write(id, { title: "seeded exit condition", status: "draft", goal: goalId, criterion: "true", expect: EXPECT, origin: "o" });
}

test("goal gate fails-closed when the goal record does not exist", async () => {
  const dir = tmpGoalDir("missing");
  const r = await makeGoalGate("AC-999", dir)({ id: "T" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no such goal/);
});

test("goal gate fails-closed when the criterion is empty/missing (AC2)", async () => {
  const dir = tmpGoalDir("nocriterion");
  const store = createGoalStore(dir);
  seedAc(store, "GOAL-001");
  store.write("GOAL-001", { title: "p", status: "active", origin: "o", body: GOAL_BODY });
  // A criterion-less record is now unrepresentable via write() (gap-goal-record-completeness-undefined
  // requires criterion+expect for criterion records), so hand-write a legacy file to keep the gate's
  // fail-closed-on-empty-criterion path tested on a pre-existing record.
  fs.writeFileSync(path.join(dir, "AC-020-legacy.md"),
    "---\nid: AC-020\ntitle: no-criterion\nstatus: active\nkind: criterion\ngoal: GOAL-001\norigin: o\n---\n## Rationale\nlegacy\n", "utf8");
  const r = await makeGoalGate("AC-020", dir)({ id: "T" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /fail-closed/);
});

test("goal gate PASSes a criterion that exits 0 and FAILs one that exits non-zero", async () => {
  const dir = tmpGoalDir("real");
  const store = createGoalStore(dir);
  seedAc(store, "GOAL-001");
  store.write("GOAL-001", { title: "p", status: "active", origin: "o", body: GOAL_BODY });
  store.write("AC-010", { title: "pass", status: "active", goal: "GOAL-001", criterion: "true", expect: EXPECT, origin: "o" });
  store.write("AC-011", { title: "fail", status: "active", goal: "GOAL-001", criterion: "false", expect: EXPECT, origin: "o" });

  const pass = await makeGoalGate("AC-010", dir)({ id: "T" });
  assert.equal(pass.ok, true, `expected pass; reason=${pass.reason}`);

  const fail = await makeGoalGate("AC-011", dir)({ id: "T" });
  assert.equal(fail.ok, false, `expected fail; reason=${fail.reason}`);
  assert.ok(fail.reason && fail.reason.length > 0);
});

test("a dynamically registered goal-<id> gate runs through the registry (same shape as doc/adr)", async () => {
  const dir = tmpGoalDir("registry");
  const store = createGoalStore(dir);
  seedAc(store, "GOAL-001");
  store.write("GOAL-001", { title: "p", status: "active", origin: "o", body: GOAL_BODY });
  store.write("AC-100", { title: "conforming", status: "active", goal: "GOAL-001", criterion: "true", expect: EXPECT, origin: "o" });
  registerGoalGate("goal-fixture-pass", dir, "AC-100");
  const r = await gateRegistry["goal-fixture-pass"]({ id: "T" });
  assert.equal(r.ok, true, `expected pass; reason=${r.reason}`);
});

test("listGates() includes a goal gate once one is registered", () => {
  const dir = tmpGoalDir("list");
  registerGoalGate("goal-list-check", dir, "AC-100");
  assert.ok(listGates().includes("goal-list-check"), `gates: ${listGates().join(", ")}`);
});

// gap-ac168-criterion-sh-incompatible — the goal gate executes criteria through
// runAcceptance's `spawnSync({shell:true})`, which runs `/bin/sh` (dash on this host),
// NOT bash. A criterion that uses bash-only process substitution `<(...)` is therefore
// a Syntax error under sh (exit 2) even though the same text passes under bash. The
// POSIX fix (temp files + `comm -23 "$f1" "$f2"`) runs identically under both shells.
test("goal gate executes via sh: bash process-substitution criterion fails (exit 2), POSIX temp-file comm passes", async () => {
  const dir = tmpGoalDir("sh-compat");
  const store = createGoalStore(dir);
  seedAc(store, "GOAL-001");
  store.write("GOAL-001", { title: "p", status: "active", origin: "o", body: GOAL_BODY });

  // `<(...)` is bash-only: under /bin/sh (dash) → "Syntax error: ( unexpected" → exit 2.
  store.write("AC-020", {
    title: "bash-process-substitution",
    status: "active",
    goal: "GOAL-001",
    // gap-criterion-attribution-write-gate-at-birth: the failure exit carries its cause on the SAME
    // line (`>&2`) — the write surface now refuses a criterion whose failing exit says nothing. The
    // subject above is untouched: `<(...)` is still bash-only, so this is still a sh Syntax error
    // (exit 2) and the `&&` branch is unreachable in exactly the case this test measures.
    criterion: `comm -23 <(echo a) <(echo a) | grep -q . && { echo "unexpected common lines" >&2; exit 1; }
exit 0`,
    expect: EXPECT,
    origin: "o",
  });
  const bashOnly = await makeGoalGate("AC-020", dir)({ id: "T" });
  assert.equal(bashOnly.ok, false, `expected fail; reason=${bashOnly.reason}`);
  assert.match(bashOnly.reason, /exit 2/);

  // POSIX temp-file + `comm -23 "$f1" "$f2"` runs identically under sh and bash → exit 0.
  store.write("AC-021", {
    title: "posix-temp-file-comm",
    status: "active",
    goal: "GOAL-001",
    criterion: `f1=$(mktemp)
f2=$(mktemp)
echo a > "$f1"
echo a > "$f2"
echo b >> "$f2"
comm -23 "$f1" "$f2" | grep -q . && { echo "unexpected common lines" >&2; rm -f "$f1" "$f2"; exit 1; }
rm -f "$f1" "$f2"
exit 0`,
    expect: EXPECT,
    origin: "o",
  });
  const posix = await makeGoalGate("AC-021", dir)({ id: "T" });
  assert.equal(posix.ok, true, `expected pass; reason=${posix.reason}`);
});
