// @test-group product
// goal-analysis.test.mjs — the next-step projection (tasks/gap-goal-next-projection, AC-935).
//
// WHAT IS UNDER TEST:
//   · `goalNextProjection(records, gaps, taskFacts)` — the PURE Core function the goal-driver writes
//     into the round fact `goal-next` and the CLI `quay goal next` reads back. One row per ACTIVE
//     GOAL, ranked needs-human → stalled → workable → gap → world-gated → not-evaluated (ties by AC
//     id), with `owner` / `action.kind` drawn from enumerated vocabularies.
//   · the CLI read surface — exit 0 with the rows array when the fact covers every active goal,
//     exit 3 when NO round carries the fact, exit 1 when the fact exists but an active goal has no
//     row. The three outcomes must never collapse into "empty array + exit 0" (hard rule 3b).
//
// ⛔ NEGATIVE CONTROLS ARE THE POINT OF HALF THIS FILE: "no fact" and "one goal missing" both used to
// be expressible as an empty array. Each has its own assertion below, on the REAL CLI (subprocess),
// not just on the pure function.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import {
  goalNextProjection,
  GAP_STATES,
  GOAL_NEXT_OWNERS,
  GOAL_NEXT_ACTION_KINDS,
  GOAL_NEXT_PRIORITY,
} from "../src/core/goal-analysis.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NATIVE_PROVIDER_DIR = path.resolve(__dirname, "../../quay-native");

const _created = [];
function tmpDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goal-next-${tag}-`));
  _created.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of _created) fs.rmSync(dir, { recursive: true, force: true });
});

// ── fixture helpers ───────────────────────────────────────────────────────────────────────────────

const goalRec = (id, status = "active") => ({ id, status });
const acRec = (id, goal, status = "active") => ({ id, goal, status });
const gap = (goal, ac, state, taskCount = 0) => ({ goal, ac, state, taskCount });
const task = (id, status, goalAc) => ({ id, status, goalAc });

/** The rank sequence, so an ordering assertion reads as the priority list it is checking. */
const ranks = (rows) => rows.map((r) => r.rank);

// ── AC2 — one row per active GOAL, and the declared order ─────────────────────────────────────────

test("AC2: every ACTIVE goal gets EXACTLY one row; inactive goals get none", () => {
  const records = [
    goalRec("GOAL-001"),
    goalRec("GOAL-002"),
    goalRec("GOAL-003"),
    goalRec("GOAL-004", "achieved"), // not active ⇒ ⛔ must not project a next step
    goalRec("GOAL-005", "draft"),
    acRec("AC-001", "GOAL-001"),
    acRec("AC-002", "GOAL-002"),
    acRec("AC-003", "GOAL-003"),
    acRec("AC-004", "GOAL-004"),
  ];
  const gaps = [
    gap("GOAL-001", "AC-001", "gap", 0),
    gap("GOAL-002", "AC-002", "world-gated", 3),
    gap("GOAL-003", "AC-003", "in-progress", 1),
    gap("GOAL-004", "AC-004", "gap", 0), // achieved goal's reading is NOT projected
  ];
  const rows = goalNextProjection(records, gaps, []);

  assert.deepEqual(rows.map((r) => r.goal), ["GOAL-001", "GOAL-002", "GOAL-003"], "one row per active goal, in priority order");
  assert.equal(new Set(rows.map((r) => r.goal)).size, rows.length, "no goal appears twice");
  assert.ok(!rows.some((r) => r.goal === "GOAL-004" || r.goal === "GOAL-005"), "inactive goals are absent");
});

test("AC2: ordering is needs-human → stalled → workable → gap → world-gated → not-evaluated, ties by AC id", () => {
  const records = [goalRec("GOAL-001")];
  const gaps = [
    gap("GOAL-001", "AC-006", "not-evaluated", null),
    gap("GOAL-001", "AC-005", "world-gated", 2),
    gap("GOAL-001", "AC-004", "gap", 0),
    gap("GOAL-001", "AC-003", "workable", 1),
    gap("GOAL-001", "AC-002", "stalled", 1),
    gap("GOAL-001", "AC-001", "stalled", 1),
  ];
  // AC-001 has a task parked needs-human ⇒ it outranks the plain stalled AC-002 even though its AC id
  // sorts FIRST anyway; the assertion below also pins the AC-id tie-break for the two not-humans.
  const taskFacts = [task("gap-a", "needs-human", "AC-001"), task("gap-b", "todo", "AC-002")];
  const rows = goalNextProjection(records, gaps, taskFacts);

  assert.equal(rows.length, 1, "one goal ⇒ one row");
  const chosen = rows[0];
  assert.equal(chosen.goal, "GOAL-001");
  assert.equal(chosen.ac, "AC-001", "the needs-human AC wins the goal's single row");
  assert.equal(chosen.rank, "needs-human", "the rank is escalated above `stalled`");
  assert.equal(chosen.gapState, "stalled", "the underlying reading is NOT rewritten (⛔ the projection is not a second gap reading)");
  assert.equal(chosen.owner, "human");
  assert.equal(chosen.action.kind, "ask-human");

  // Same-state tie-break, on a goal whose gaps share one state: the LOWEST AC id wins.
  const tie = goalNextProjection(
    [goalRec("GOAL-001")],
    [gap("GOAL-001", "AC-010", "gap", 0), gap("GOAL-001", "AC-009", "gap", 0)],
    [],
  );
  assert.equal(tie[0].ac, "AC-009", "ties are broken by AC id (numeric-aware: AC-9 < AC-10)");

  // Global ordering: a fresh fixture with one goal per state, inserted in REVERSE priority order
  // (so a comparator that returned input order would fail this).
  const order = ["not-evaluated", "world-gated", "gap", "workable", "stalled"];
  const records2 = order.map((_, i) => goalRec(`GOAL-10${i}`));
  const gaps2 = order.map((state, i) => gap(`GOAL-10${i}`, `AC-10${i}`, state, state === "not-evaluated" ? null : 1));
  const rows2 = goalNextProjection(records2, gaps2, []);
  assert.deepEqual(ranks(rows2), ["stalled", "workable", "gap", "world-gated", "not-evaluated"], "declared priority order");
  // …and that order is the EXPORTED one, filtered to the ranks this fixture actually has (the
  // `needs-human` rank needs a task snapshot, so it is absent here by construction).
  assert.deepEqual(ranks(rows2), GOAL_NEXT_PRIORITY.filter((r) => r !== "needs-human").slice(0, 5), "the five ranks are the exported priority verbatim");
});

// ── AC3 — the vocabularies are enumerations, and a missing reading is its own value ──────────────

test("AC3: owner / action.kind / gapState are always values from the exported enums", () => {
  const records = [goalRec("GOAL-001")];
  const gaps = [
    gap("GOAL-001", "AC-001", "gap", 0),
    gap("GOAL-001", "AC-002", "workable", 1),
    gap("GOAL-001", "AC-003", "world-gated", 1),
    gap("GOAL-001", "AC-004", "stalled", 1),
    gap("GOAL-001", "AC-005", "not-evaluated", null),
    gap("GOAL-001", "AC-006", "in-progress", 1),
    gap("GOAL-001", "AC-007", "standing-ok", 0),
  ];
  // One projection per state ⇒ every mapping is exercised, not just the winner.
  for (const g of gaps) {
    const [row] = goalNextProjection(records, [g], []);
    assert.ok(GAP_STATES.includes(row.gapState), `gapState ${row.gapState} is a declared GapState`);
    assert.ok(GOAL_NEXT_OWNERS.includes(row.owner), `owner ${row.owner} is a declared owner`);
    assert.ok(GOAL_NEXT_ACTION_KINDS.includes(row.action.kind), `action.kind ${row.action.kind} is a declared kind`);
    assert.equal(typeof row.action.reason, "string");
    assert.ok(row.action.reason.length > 0, "an action always says WHY");
    assert.ok(row.ac.length > 0, "ac is never empty");
    assert.deepEqual(row.evidenceRefs, [`gap:${g.ac}`], "evidenceRefs point at the gap reading when no task is linked");
  }
  // The mapping itself (spot checks on the states whose owner is NOT the driver).
  const byAc = (ac) => goalNextProjection(records, gaps.filter((g) => g.ac === ac), [])[0];
  assert.equal(byAc("AC-003").owner, "world", "world-gated ⇒ world");
  assert.equal(byAc("AC-003").action.kind, "wait", "world-gated ⇒ wait");
  assert.equal(byAc("AC-004").owner, "worker", "stalled ⇒ worker");
  assert.equal(byAc("AC-004").action.kind, "fix-artifacts", "stalled ⇒ fix-artifacts");
  assert.equal(byAc("AC-001").action.kind, "file-task", "gap ⇒ file-task");
});

test("AC3 negative control: a goal with NO gap reading is `not-evaluated`, ⛔ never 'nothing to do'", () => {
  const records = [goalRec("GOAL-001"), acRec("AC-001", "GOAL-001")];
  const rows = goalNextProjection(records, [], null);
  assert.equal(rows.length, 1, "the active goal still gets its row");
  assert.equal(rows[0].gapState, "not-evaluated", "no reading ⇒ NOT-EVALUATED (its own value)");
  assert.equal(rows[0].rank, "not-evaluated");
  assert.equal(rows[0].ac, "AC-001", "the row names a real criterion of that goal, so `ac` is never empty");
  assert.deepEqual(rows[0].evidenceRefs, ["gap:GOAL-001:absent"], "the evidence says WHAT was absent");

  // Control on the other side: the SAME goal with a real reading is NOT not-evaluated.
  const withReading = goalNextProjection(records, [gap("GOAL-001", "AC-001", "gap", 0)], null);
  assert.equal(withReading[0].gapState, "gap", "control: a real reading projects its real state");
});

test("AC3: an unreadable task snapshot never INVENTS a needs-human escalation", () => {
  const records = [goalRec("GOAL-001")];
  const gaps = [gap("GOAL-001", "AC-001", "stalled", 1)];
  const rows = goalNextProjection(records, gaps, null);
  assert.equal(rows[0].rank, "stalled", "taskFacts === null ⇒ no escalation (missing = not checked, ⛔ not 'no')");
  assert.equal(rows[0].owner, "worker");
  // Control: with the snapshot readable the escalation DOES happen.
  const escalated = goalNextProjection(records, gaps, [task("t1", "needs-human", "AC-001")]);
  assert.equal(escalated[0].rank, "needs-human", "control: the same gap escalates when the snapshot says so");
  assert.equal(escalated[0].owner, "human");
});

// ── purity / no side effects ─────────────────────────────────────────────────────────────────────

test("the projection is PURE: same inputs ⇒ same output, and it mutates neither input array", () => {
  const records = [goalRec("GOAL-001"), goalRec("GOAL-002")];
  const gaps = [
    gap("GOAL-002", "AC-002", "gap", 0),
    gap("GOAL-001", "AC-001", "world-gated", 1),
  ];
  const taskFacts = [task("t1", "todo", "AC-001")];
  const recordsBefore = JSON.stringify(records);
  const gapsBefore = JSON.stringify(gaps);
  const factsBefore = JSON.stringify(taskFacts);

  const a = goalNextProjection(records, gaps, taskFacts);
  const b = goalNextProjection(records, gaps, taskFacts);
  assert.deepEqual(a, b, "deterministic");
  assert.deepEqual(a.map((r) => r.goal), ["GOAL-002", "GOAL-001"], "goal order follows the rank, not the input order");
  assert.equal(JSON.stringify(records), recordsBefore, "records untouched");
  assert.equal(JSON.stringify(gaps), gapsBefore, "gaps untouched");
  assert.equal(JSON.stringify(taskFacts), factsBefore, "taskFacts untouched");

  // Reversing the input order must NOT change the answer — the comparator, not the array order,
  // decides. (Without this, a round's row set would depend on file-read order.)
  assert.deepEqual(goalNextProjection(records, [...gaps].reverse(), taskFacts), a, "input order is irrelevant");
});

test("no active goals ⇒ an empty array (a real measurement, not an error)", () => {
  assert.deepEqual(goalNextProjection([], [], null), []);
  assert.deepEqual(goalNextProjection([goalRec("GOAL-001", "achieved")], [gap("GOAL-001", "AC-001", "gap", 0)], null), []);
});

// ── AC4 — the CLI read surface (real subprocess) ─────────────────────────────────────────────────

/** A REAL workspace: `.quay/config.yml` naming the native Provider, `tasks/`, `goals/`. */
function seedWorkspace(tag, { goals = [] } = {}) {
  const root = tmpDir(tag);
  const tasksDir = path.join(root, "tasks");
  const goalsDir = path.join(root, "goals");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: ${JSON.stringify(NATIVE_PROVIDER_DIR)}`,
      `    tasks_dir: ${JSON.stringify(tasksDir)}`,
      `    mcp_entry: ["node", ${JSON.stringify(QUAY_NATIVE_CLI)}, "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: ${JSON.stringify(tasksDir)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  for (const g of goals) {
    fs.writeFileSync(
      path.join(goalsDir, `${g.id}-fixture.md`),
      ["---", `id: ${g.id}`, `title: ${JSON.stringify(g.id)}`, `status: ${g.status}`, `kind: ${g.kind}`,
        ...(g.goal ? [`goal: ${g.goal}`] : []), "---", "", `${g.id} fixture body`, ""].join("\n"),
      "utf8",
    );
  }
  return { root };
}

/** One round record, exactly the envelope `computeRoundRecord` writes (facts[] + round/ts/run_id). */
function writeRoundFact(root, { round = 7, rows, evaluated = true, extraFacts = [] }) {
  const rec = {
    round,
    run_id: "test-run",
    pid: 1,
    ts: "2026-11-07T00:00:00.000Z",
    halted: false,
    facts: [
      { name: "goal-ring", value: { goalCount: rows.length }, state: "verified", reason: "fixture" },
      { name: "goal-next", value: { rows, evaluated, cause: evaluated ? null : "fixture-cause" }, state: evaluated ? "verified" : "not-evaluated", reason: evaluated ? "fixture" : "fixture-cause" },
      ...extraFacts,
    ],
    stopped_mid_round: false,
    skipped_routines: [],
  };
  fs.appendFileSync(path.join(root, ".quay", "goal-round.jsonl"), `${JSON.stringify(rec)}\n`, "utf8");
}

function runGoalNext(root, args = []) {
  const r = spawnSync("node", ["--experimental-strip-types", QUAY_CLI, "goal", "next", "--root", root, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const ACTIVE_GOALS = [
  { id: "GOAL-001", status: "active", kind: "goal" },
  { id: "AC-001", status: "active", kind: "criterion", goal: "GOAL-001" },
];

test("AC4: a complete fact exits 0 and prints exactly its rows array", () => {
  const { root } = seedWorkspace("ok", { goals: ACTIVE_GOALS });
  const rows = goalNextProjection(
    [goalRec("GOAL-001"), acRec("AC-001", "GOAL-001")],
    [gap("GOAL-001", "AC-001", "gap", 0)],
    [],
  );
  writeRoundFact(root, { rows });

  const r = runGoalNext(root, ["--json"]);
  assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr.slice(0, 400)})`);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed), "stdout is a JSON ARRAY (AC-935's criterion parses it as one)");
  assert.deepEqual(parsed, rows, "the CLI output is the fact's rows, byte for byte (no re-computation)");
  assert.match(r.stderr, /projection from round 7/, "provenance goes to stderr, never into the array");
});

test("AC4 negative control: NO fact in any round ⇒ exit 3 NOT-EVALUATED, ⛔ never an empty array with exit 0", () => {
  const { root } = seedWorkspace("no-fact", { goals: ACTIVE_GOALS });
  // A round that ran but produced NO goal-next fact (e.g. an older driver build).
  fs.writeFileSync(
    path.join(root, ".quay", "goal-round.jsonl"),
    `${JSON.stringify({ round: 3, run_id: "r", ts: "2026-11-07T00:00:00.000Z", facts: [{ name: "goal-ring", value: {}, state: "verified", reason: "" }] })}\n`,
    "utf8",
  );
  const r = runGoalNext(root, ["--json"]);
  assert.equal(r.status, 3, `exit 3 (stderr: ${r.stderr.slice(0, 400)})`);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.evaluated, false, "the JSON says NOT-EVALUATED");
  assert.ok(!Array.isArray(parsed), "⛔ the not-evaluated shape is NOT an array — the two must be distinguishable");
  assert.match(parsed.reason, /no goal-next fact/);

  // Control: NO round carrier at all is the SAME reading (exit 3), not a different, emptier one.
  const empty = seedWorkspace("no-carrier", { goals: ACTIVE_GOALS });
  const r2 = runGoalNext(empty.root, ["--json"]);
  assert.equal(r2.status, 3, "missing carrier ⇒ exit 3");
  assert.equal(JSON.parse(r2.stdout).evaluated, false);
});

test("AC4 negative control: a fact that misses an ACTIVE goal ⇒ exit 1, naming the goal", () => {
  const { root } = seedWorkspace("missing-row", {
    goals: [...ACTIVE_GOALS, { id: "GOAL-002", status: "active", kind: "goal" }, { id: "AC-002", status: "active", kind: "criterion", goal: "GOAL-002" }],
  });
  // A projection from BEFORE GOAL-002 was activated: covers only GOAL-001.
  writeRoundFact(root, { rows: goalNextProjection([goalRec("GOAL-001"), acRec("AC-001", "GOAL-001")], [gap("GOAL-001", "AC-001", "gap", 0)], []) });

  const r = runGoalNext(root, ["--json"]);
  assert.equal(r.status, 1, `exit 1 (stderr: ${r.stderr.slice(0, 400)})`);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.cause, "missing-row");
  assert.deepEqual(parsed.missing, ["GOAL-002"], "the missing goal is NAMED, not just counted");
});

test("AC4: zero active goals + a complete (empty) fact ⇒ exit 0 and an empty array", () => {
  const { root } = seedWorkspace("zero", {
    goals: [{ id: "GOAL-001", status: "achieved", kind: "goal" }, { id: "AC-001", status: "achieved", kind: "criterion", goal: "GOAL-001" }],
  });
  writeRoundFact(root, { rows: [] });
  const r = runGoalNext(root, ["--json"]);
  assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr.slice(0, 400)})`);
  assert.deepEqual(JSON.parse(r.stdout), [], "an empty array here means 'read it, no active goals'");
});

test("AC4: a malformed row makes the CARRIER unreadable (exit 3), ⛔ never a silently dropped row", () => {
  const { root } = seedWorkspace("malformed", { goals: ACTIVE_GOALS });
  writeRoundFact(root, {
    rows: [{ goal: "GOAL-001", ac: "AC-001", gapState: "not-a-state", rank: "gap", owner: "driver", action: { kind: "file-task", reason: "x" }, evidenceRefs: ["gap:AC-001"] }],
  });
  const r = runGoalNext(root, ["--json"]);
  assert.equal(r.status, 3, `exit 3 (stderr: ${r.stderr.slice(0, 400)})`);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.evaluated, false);
  assert.match(parsed.reason, /malformed goal-next row/);
});

test("AC4: --round-log overrides the carrier path (and a stopped-mid-round record is skipped, not fatal)", () => {
  const { root } = seedWorkspace("override", { goals: ACTIVE_GOALS });
  const alt = path.join(root, "alt-round.jsonl");
  const rows = goalNextProjection([goalRec("GOAL-001"), acRec("AC-001", "GOAL-001")], [gap("GOAL-001", "AC-001", "gap", 0)], []);
  fs.writeFileSync(alt, "", "utf8");
  fs.appendFileSync(alt, `${JSON.stringify({ round: 1, run_id: "r", ts: "t", facts: [] })}\n`);
  fs.appendFileSync(alt, `${JSON.stringify({ round: 2, run_id: "r", ts: "t", facts: [{ name: "goal-next", value: { rows, evaluated: true, cause: null }, state: "verified", reason: "" }] })}\n`);
  // A TRUNCATED round (stop request) is the newest line and legitimately carries no fact.
  fs.appendFileSync(alt, `${JSON.stringify({ round: 3, run_id: "r", ts: "t", facts: [{ name: "goal-ring", value: { stopped_mid_round: true }, state: "not-evaluated", reason: "stopped-mid-round" }], stopped_mid_round: true })}\n`);

  const r = runGoalNext(root, ["--json", "--round-log", alt]);
  assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr.slice(0, 400)})`);
  assert.deepEqual(JSON.parse(r.stdout), rows);
  assert.match(r.stderr, /projection from round 2/, "the provenance names the round that DID produce it");
});
