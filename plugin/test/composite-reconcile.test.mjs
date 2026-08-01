// composite-reconcile.test.mjs — sibling test for composite-reconcile.ts (ADR-001 Decision
// clause 2: load-bearing method-infra MUST carry a `<name>.test.mjs` sibling —
// loadbearing-test-gate.sh enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/composite-reconcile.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconcile, selftest } from "../scripts/composite-reconcile.ts";

test("composite-reconcile.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

const passingBundle = (taskIds) => ({
  candidateId: "c-1",
  generationId: "gen-1",
  bundleVerdict: "PASS",
  shardResults: [{ shardId: "s0", shardVerdict: "PASS", verdicts: taskIds.map((t) => ({ taskId: t, acIndex: 0, verdict: "PASS", detail: "" })) }],
});

const goodInput = (taskIds) => ({
  bundleAudit: passingBundle(taskIds),
  requiredGenerationId: "gen-1",
  taskGates: taskIds.map((t) => ({ taskId: t, gate: "dod-check", ok: true })),
  milestoneGates: [{ gate: "milestone-dod", ok: true }],
  taskIds,
});

test("happy path at widths 1, 3, 5, 10: mutations cover EVERY member task", () => {
  for (const n of [1, 3, 5, 10]) {
    const taskIds = Array.from({ length: n }, (_, i) => `T-${i}`);
    const result = reconcile(goodInput(taskIds));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.mutations.length, n);
  }
});

test("a REFUTED bundle verdict blocks ALL mutations", () => {
  const input = goodInput(["T-0", "T-1"]);
  input.bundleAudit = { ...input.bundleAudit, bundleVerdict: "REFUTED" };
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.mutations.length, 0);
});

test("one REFUTED task among three blocks the ENTIRE bundle atomically — no partial mutation for the other two", () => {
  const taskIds = ["T-0", "T-1", "T-2"];
  const input = goodInput(taskIds);
  input.bundleAudit = {
    ...input.bundleAudit,
    bundleVerdict: "REFUTED",
    shardResults: [
      {
        shardId: "s0",
        shardVerdict: "REFUTED",
        verdicts: [
          { taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" },
          { taskId: "T-1", acIndex: 0, verdict: "REFUTED", detail: "gap found" },
          { taskId: "T-2", acIndex: 0, verdict: "PASS", detail: "" },
        ],
      },
    ],
  };
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.mutations.length, 0);
});

test("a missing verdict for one member task fails closed by name", () => {
  const input = goodInput(["T-0", "T-1"]);
  input.bundleAudit = passingBundle(["T-0"]);
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-verdict-for-task: T-1");
});

test("a failed task-scoped gate blocks the whole bundle atomically", () => {
  const input = goodInput(["T-0", "T-1"]);
  input.taskGates = [
    { taskId: "T-0", gate: "dod-check", ok: true },
    { taskId: "T-1", gate: "dod-check", ok: false, detail: "line budget exceeded" },
  ];
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.mutations.length, 0);
});

test("a missing task-scoped gate for a member task fails closed", () => {
  const input = goodInput(["T-0", "T-1"]);
  input.taskGates = input.taskGates.filter((g) => g.taskId !== "T-1");
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-gate-for-task: T-1");
});

test("zero milestone-scoped gates fails closed", () => {
  const input = goodInput(["T-0"]);
  input.milestoneGates = [];
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-milestone-gates-run");
});

test("a failed milestone-scoped gate fails closed even when every task-level check passed", () => {
  const input = goodInput(["T-0", "T-1", "T-2"]);
  input.milestoneGates = [{ gate: "milestone-dod", ok: false, detail: "counter mismatch" }];
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.ok(result.reason.startsWith("milestone-gate-failed"));
});

test("stale generation identity fails closed before any verdict/gate is even consulted", () => {
  const input = goodInput(["T-0"]);
  input.bundleAudit = { ...input.bundleAudit, generationId: "gen-STALE" };
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.ok(result.reason.startsWith("generation-identity-mismatch"));
});

test("milestone-scoped gates run exactly ONCE for the whole bundle — not per task", () => {
  const taskIds = ["T-0", "T-1", "T-2", "T-3", "T-4"];
  const input = goodInput(taskIds);
  // Only ONE milestone gate entry regardless of width — reconcile must not require N entries.
  assert.equal(input.milestoneGates.length, 1);
  const result = reconcile(input);
  assert.equal(result.ok, true);
});

// ── DIR-119-D4 (M212): typed Gate-failure attribution ─────────────────────────────────
// These tests resolve `attributeGateFailures` via the module NAMESPACE (dynamic import) so that
// during the RED phase (before the export exists) ONLY these assertions fail at runtime while the
// pre-existing statically-imported `reconcile()`/`selftest()` tests stay green — a static named
// import of a not-yet-existing export would fail ESM module LINKING and take the whole file down
// (the plan's pinned RED strategy). After Stage 2 lands the export, the same dynamic reference goes
// GREEN with no further edit.

test("RED/GREEN — attributeGateFailures: a NON-primary member's failing gate is attributed to THAT member (never taskIds[0] by default)", async () => {
  const mod = await import("../scripts/composite-reconcile.ts");
  assert.equal(typeof mod.attributeGateFailures, "function", "attributeGateFailures must be exported");
  const gates = [
    { scope: "milestone", gate: "vmeta-lag", ok: true },
    { scope: "milestone", gate: "dash-budget", ok: true },
    { scope: "task", taskId: "T-0", gate: "split-or-commit", ok: true },
    { scope: "task", taskId: "T-1", gate: "split-or-commit", ok: false, detail: "child left open" },
    { scope: "task", taskId: "T-2", gate: "split-or-commit", ok: true },
  ];
  const attr = mod.attributeGateFailures(gates, ["T-0", "T-1", "T-2"]);
  assert.deepEqual(attr.failedTaskIds, ["T-1"], `failing NON-primary member must be named, got ${JSON.stringify(attr.failedTaskIds)}`);
  assert.deepEqual(attr.passingTaskIds, ["T-0", "T-2"]);
  assert.deepEqual(attr.milestoneFailures, []);
});

test("RED/GREEN — attributeGateFailures: control — an all-passing composite yields empty failedTaskIds", async () => {
  const mod = await import("../scripts/composite-reconcile.ts");
  const gates = [
    { scope: "milestone", gate: "vmeta-lag", ok: true },
    { scope: "task", taskId: "T-0", gate: "split-or-commit", ok: true },
    { scope: "task", taskId: "T-1", gate: "split-or-commit", ok: true },
  ];
  const attr = mod.attributeGateFailures(gates, ["T-0", "T-1"]);
  assert.deepEqual(attr.failedTaskIds, []);
  assert.deepEqual(attr.passingTaskIds, ["T-0", "T-1"]);
  assert.deepEqual(attr.milestoneFailures, []);
});

test("RED/GREEN — attributeGateFailures: the primary is marked ONLY if itself among failedTaskIds; milestone-scoped failures reported separately", async () => {
  const mod = await import("../scripts/composite-reconcile.ts");
  const gates = [
    { scope: "milestone", gate: "vmeta-lag", ok: false, detail: "alarm" },
    { scope: "task", taskId: "T-0", gate: "split-or-commit", ok: false, detail: "primary failed too" },
    { scope: "task", taskId: "T-1", gate: "split-or-commit", ok: true },
  ];
  const attr = mod.attributeGateFailures(gates, ["T-0", "T-1"]);
  assert.deepEqual(attr.failedTaskIds, ["T-0"]);
  assert.deepEqual(attr.passingTaskIds, ["T-1"]);
  assert.deepEqual(attr.milestoneFailures, [{ gate: "vmeta-lag", ok: false, detail: "alarm" }]);
});

test("RED/GREEN — attributeGateFailures: identity is the structural taskId field, never the split-or-commit-${tid} label", async () => {
  const mod = await import("../scripts/composite-reconcile.ts");
  // Member labels differ from ids — attribution MUST parse the structural `taskId`, never the label.
  const gates = [
    { scope: "task", taskId: "T-0", gate: "split-or-commit-T-0", ok: true },
    { scope: "task", taskId: "T-1", gate: "split-or-commit-T-1", ok: false, detail: "failed" },
  ];
  const attr = mod.attributeGateFailures(gates, ["T-0", "T-1"]);
  assert.deepEqual(attr.failedTaskIds, ["T-1"]);
  assert.deepEqual(attr.passingTaskIds, ["T-0"]);
});

test("RED/GREEN — attributeGateFailures: membership order is deterministic and unknown ids are excluded", async () => {
  const mod = await import("../scripts/composite-reconcile.ts");
  const gates = [
    { scope: "task", taskId: "T-1", gate: "split-or-commit", ok: false },
    { scope: "task", taskId: "T-0", gate: "split-or-commit", ok: true },
    { scope: "task", taskId: "STRANGER", gate: "split-or-commit", ok: true }, // not in membership
  ];
  const attr = mod.attributeGateFailures(gates, ["T-0", "T-1"]);
  assert.deepEqual(attr.failedTaskIds, ["T-1"]);
  assert.deepEqual(attr.passingTaskIds, ["T-0"]);
});

// ── CLI modes (non-selftest production modes, DIR-119-D4 / M212) ──────────────────────
// AC #1's "real production callsite" requirement is met by execute-milestone.js invoking these
// modes; these tests pin the CLI contract: input JSON via `--in <file>` (or inline JSON arg),
// result JSON on stdout, exit 0 on pass / nonzero fail-closed on contract violation.

const CLI_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "composite-reconcile.ts");

function runCli(args, inlineJson) {
  const dir = mkdtempSync(path.join(tmpdir(), "cr-cli-"));
  const inPath = path.join(dir, "in.json");
  writeFileSync(inPath, inlineJson);
  const r = spawnSync("node", ["--experimental-strip-types", CLI_SCRIPT, ...args, "--in", inPath], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}

test("RED/GREEN — --attribute-gates-json: prints {failedTaskIds, passingTaskIds, milestoneFailures} and names the failing NON-primary member", () => {
  const gates = [
    { scope: "milestone", gate: "vmeta-lag", ok: true },
    { scope: "task", taskId: "T-0", gate: "split-or-commit", ok: true },
    { scope: "task", taskId: "T-1", gate: "split-or-commit", ok: false, detail: "child left open" },
  ];
  const r = runCli(["--attribute-gates-json"], JSON.stringify(gates));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.failedTaskIds, ["T-1"]);
  assert.deepEqual(out.passingTaskIds, ["T-0"]);
  assert.deepEqual(out.milestoneFailures, []);
});

test("RED/GREEN — --attribute-gates-json: malformed input fails closed (nonzero exit)", () => {
  const r = runCli(["--attribute-gates-json"], "not-json{");
  assert.notEqual(r.status, 0);
});

test("RED/GREEN — --reconcile-json: prints the full ReconcileResult JSON and exits 0 on a passing mutation plan", () => {
  const input = {
    bundleAudit: {
      candidateId: "c-1",
      generationId: "gen-1",
      bundleVerdict: "PASS",
      shardResults: [{ shardId: "s0", shardVerdict: "PASS", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }, { taskId: "T-1", acIndex: 0, verdict: "PASS", detail: "" }] }],
    },
    requiredGenerationId: "gen-1",
    taskGates: [
      { scope: "task", taskId: "T-0", gate: "split-or-commit", ok: true },
      { scope: "task", taskId: "T-1", gate: "split-or-commit", ok: true },
    ],
    milestoneGates: [{ scope: "milestone", gate: "milestone-dod", ok: true }],
    taskIds: ["T-0", "T-1"],
  };
  const r = runCli(["--reconcile-json"], JSON.stringify(input));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.mutations.length, 2);
  assert.deepEqual(out.mutations.map((m) => m.taskId), ["T-0", "T-1"]);
});

test("RED/GREEN — --reconcile-json: stale-generation contract violation fails closed (nonzero exit) with the deterministic recovery record on stdout", () => {
  const input = {
    bundleAudit: {
      candidateId: "c-1",
      generationId: "gen-STALE",
      bundleVerdict: "PASS",
      shardResults: [{ shardId: "s0", shardVerdict: "PASS", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }] }],
    },
    requiredGenerationId: "gen-1",
    taskGates: [{ scope: "task", taskId: "T-0", gate: "split-or-commit", ok: true }],
    milestoneGates: [{ scope: "milestone", gate: "milestone-dod", ok: true }],
    taskIds: ["T-0"],
  };
  const r = runCli(["--reconcile-json"], JSON.stringify(input));
  assert.notEqual(r.status, 0, "contract violation must fail closed with a nonzero exit");
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.reason, /generation-identity-mismatch/);
  assert.equal(out.mutations.length, 0);
});

test("RED/GREEN — --reconcile-json: a failed member gate yields zero mutations and a named reason", () => {
  const input = {
    bundleAudit: {
      candidateId: "c-1",
      generationId: "gen-1",
      bundleVerdict: "PASS",
      shardResults: [{ shardId: "s0", shardVerdict: "PASS", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }, { taskId: "T-1", acIndex: 0, verdict: "PASS", detail: "" }] }],
    },
    requiredGenerationId: "gen-1",
    taskGates: [
      { scope: "task", taskId: "T-0", gate: "split-or-commit", ok: true },
      { scope: "task", taskId: "T-1", gate: "split-or-commit", ok: false, detail: "child left open" },
    ],
    milestoneGates: [{ scope: "milestone", gate: "milestone-dod", ok: true }],
    taskIds: ["T-0", "T-1"],
  };
  const r = runCli(["--reconcile-json"], JSON.stringify(input));
  assert.notEqual(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.reason, /task-gate-failed: T-1/);
  assert.equal(out.mutations.length, 0);
});
