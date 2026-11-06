// @test-group product
// goal-request.test.mjs — the GOAL REQUEST QUEUE (tasks/gap-goal-request-queue; GOAL-914 / AC-936).
//
// WHAT IS UNDER TEST. `quay goal request <goal> <ac> --reason …` is the entry point the layers ABOVE
// the goal-driver were missing: before it, asking "re-evaluate this AC" meant reading driver-internal
// state or hand-writing the goal store. The verb appends ONE `submitted` row to
// `<root>/.quay/goal-requests.jsonl`; the driver consumes it next round and appends ONE terminal row.
// This file judges the SUBMIT half — the core module plus the CLI verb it is wired into. The CONSUME
// half is judged where it lives (plugin/test/goal-driver.test.mjs, runGoalRequestPass).
//
// THE FOUR THINGS THIS FILE PINS
//   ① requestId is a PURE derivation of (goal, ac, reason): same triple ⇒ same id; any difference ⇒ a
//      different id. The whole idempotency story is this function being deterministic AND
//      discriminating, so both halves are asserted rather than assumed.
//   ② The refusal ladder (AC4's negative controls) names its cause and writes NOTHING. "Zero writes"
//      is asserted on the CARRIER BYTES, not on an exit code — an exit code cannot tell an append
//      that was rolled back from one that never happened.
//   ③ Idempotency both ways: an identical resubmission appends no second `submitted` row, and
//      `settleGoalRequests` refuses to append a second terminal row for a requestId it already sees
//      settled (the crash-window replay). AC-936 judges uniqueness across the whole carrier.
//   ④ Three states, never a boolean: a MISSING ledger reads `readable:true, rows:[]` (a measurement)
//      while an UNREADABLE one reads `readable:false` + a cause, and `not-evaluated` is a terminal
//      state of its own (⛔ not `refused`).
//
// ⛔ EVERY WRITE THIS FILE MAKES LANDS IN `os.tmpdir()` (mkdtemp), including the read-only-workspace
// negative control, whose permissions are restored before cleanup.
//
// Run: node --test packages/quay/test/goal-request.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  GOAL_REQUEST_MIN_REASON_CHARS,
  appendGoalRequestRow,
  goalRequestId,
  goalRequestLedgerPath,
  nonWhitespaceLength,
  openGoalRequests,
  readGoalRequestLedger,
  settleGoalRequests,
  settledRequestIds,
  submitGoalRequest,
  terminalStateOfVerdict,
} from "../src/core/goal-request.ts";
import { QUAY_CLI } from "./helpers/cli-entry.mjs";

const _created = [];
function tmpDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goal-request-${tag}-`));
  _created.push(dir);
  return dir;
}
after(() => {
  for (const dir of _created) {
    // The read-only negative control chmods its root; restore before rm or the cleanup itself fails.
    try { fs.chmodSync(dir, 0o755); } catch { /* best effort */ }
    try { fs.chmodSync(path.join(dir, ".quay"), 0o755); } catch { /* may not exist */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A GOAL/AC carrier as the store writes it (markdown + YAML frontmatter). */
function writeRecord(goalsDir, { id, kind, goal }) {
  const lines = ["---", `id: ${id}`, "title: t", "status: active", `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (kind === "criterion") lines.push("criterion: |", "  true");
  lines.push("origin: test fixture", "---", "", "## body", "x", "");
  fs.writeFileSync(path.join(goalsDir, `${id}-fixture.md`), lines.join("\n"), "utf8");
}

/** A workspace-shaped fixture: `goals/` with one GOAL + one AC filed under it. ⛔ No `.quay/config.yml`
 *  — the verb is store-level and must work in a bare checkout (same contract as `goal gate/check`). */
function seedRoot(tag, { withGoals = true } = {}) {
  const root = tmpDir(tag);
  const goalsDir = path.join(root, "goals");
  if (withGoals) {
    fs.mkdirSync(goalsDir, { recursive: true });
    writeRecord(goalsDir, { id: "GOAL-001", kind: "goal" });
    writeRecord(goalsDir, { id: "AC-001", kind: "criterion", goal: "GOAL-001" });
  }
  return { root, ledger: goalRequestLedgerPath(root) };
}

/** The carrier's exact bytes (or a sentinel when it does not exist yet). This is what "zero writes"
 *  is asserted on. */
function ledgerBytes(ledger) {
  try {
    return fs.readFileSync(ledger, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

/** The real probe the CLI installs — restated here so the module-level ladder tests exercise the
 *  SAME three-state shape (it is the caller's half of the contract, not the module's). */
function probeFor(root) {
  return (goalId, acId) => {
    let files;
    try {
      files = fs.readdirSync(path.join(root, "goals"));
    } catch (e) {
      return e.code === "ENOENT" ? "absent" : "unreadable";
    }
    const file = files.find((f) => f.startsWith(`${goalId}-`) && f.endsWith(".md"));
    if (file === undefined) return "absent";
    if (acId === undefined) return "exists";
    // Minimal read of the AC's own frontmatter `goal:` pointer (the CLI uses goal-merge's reader).
    let text;
    try {
      text = fs.readFileSync(path.join(root, "goals", file), "utf8");
    } catch {
      return "unreadable";
    }
    if (file.startsWith(`${acId}-`)) return /(^|\n)goal:\s*([^\n]*)/.exec(text)?.[2]?.trim() === goalId ? "exists" : "absent";
    for (const f of files) {
      if (!f.startsWith(`${acId}-`) || !f.endsWith(".md")) continue;
      let t;
      try {
        t = fs.readFileSync(path.join(root, "goals", f), "utf8");
      } catch {
        return "unreadable";
      }
      if (/(^|\n)goal:\s*([^\n]*)/.exec(t)?.[2]?.trim() === goalId) return "exists";
    }
    return "absent";
  };
}

function submit(root, goal, ac, reason, extra = {}) {
  return submitGoalRequest({ root, goal, ac, reason, probe: probeFor(root), ...extra });
}

const REASON = "re-evaluate after the landing test went green";

// ── ① requestId: deterministic AND discriminating ─────────────────────────────────────────────────
test("① requestId is derived purely from (goal, ac, reason)", () => {
  const a = goalRequestId("GOAL-001", "AC-001", REASON);
  assert.equal(goalRequestId("GOAL-001", "AC-001", REASON), a, "same triple ⇒ same id (a replay is recognised)");

  // Discrimination — one field at a time, so a bug in any single component is visible.
  assert.notEqual(goalRequestId("GOAL-002", "AC-001", REASON), a, "different goal ⇒ different id");
  assert.notEqual(goalRequestId("GOAL-001", "AC-002", REASON), a, "different AC ⇒ different id");
  assert.notEqual(goalRequestId("GOAL-001", "AC-001", `${REASON} (again)`), a, "different reason ⇒ different id");

  // The id is ONE parseable token even though `reason` is arbitrary prose (spaces / newlines / `|`).
  const prose = "line one\nline | two\tthree   four";
  const id = goalRequestId("GOAL-001", "AC-001", prose);
  assert.equal(id.split("|").length, 3, `reason is hashed, never embedded (got ${JSON.stringify(id)})`);

  // Both halves of the returned shape are the caller's: `<goal>|<ac>|<digest>`.
  assert.ok(id.startsWith("GOAL-001|AC-001|"), `id leads with goal|ac (got ${id})`);
});

test("① nonWhitespaceLength counts CONTENT, not characters", () => {
  assert.equal(nonWhitespaceLength("        "), 0, "eight spaces carry nothing");
  assert.equal(nonWhitespaceLength("  a b  c  "), 3, "whitespace is excluded, one-by-one");
  assert.equal(nonWhitespaceLength(undefined), 0, "a missing reason is zero content, ⛔ not a crash");
  assert.equal(GOAL_REQUEST_MIN_REASON_CHARS, 8, "the floor is 8 non-whitespace chars (spec'd by the task)");
});

// ── ② the submit ladder ──────────────────────────────────────────────────────────────────────────
test("② submit appends exactly one `submitted` row with the derived requestId", () => {
  const { root, ledger } = seedRoot("submit-ok");
  const r = submit(root, "GOAL-001", "AC-001", REASON);

  assert.equal(r.ok, true, `submit succeeds (refusal: ${JSON.stringify(r.refusal)})`);
  assert.equal(r.state, "submitted");
  assert.equal(r.requestId, goalRequestId("GOAL-001", "AC-001", REASON));

  const read = readGoalRequestLedger(ledger);
  assert.equal(read.readable, true);
  assert.equal(read.badLines, 0);
  assert.equal(read.rows.length, 1, "exactly one row");

  const row = read.rows[0];
  assert.equal(row.state, "submitted");
  assert.equal(row.requestId, r.requestId);
  assert.equal(row.goal, "GOAL-001");
  assert.equal(row.ac, "AC-001");
  assert.equal(row.reason, REASON, "the reason is carried VERBATIM (the queue exists to carry the why)");
  assert.ok(typeof row.at === "string" && !Number.isNaN(Date.parse(row.at)), `at is a real instant (got ${row.at})`);
  assert.ok(!("consumedAt" in row), "a submitted row is not consumed yet");
});

test("② an identical resubmission writes NOTHING (same requestId ⇒ same request)", () => {
  const { root, ledger } = seedRoot("submit-dup");
  const first = submit(root, "GOAL-001", "AC-001", REASON);
  const before = ledgerBytes(ledger);
  const second = submit(root, "GOAL-001", "AC-001", REASON);

  assert.equal(second.ok, true, "an idempotent replay is not an error");
  assert.equal(second.state, "already-queued");
  assert.equal(second.requestId, first.requestId);
  assert.equal(ledgerBytes(ledger), before, "the carrier is byte-identical — no second `submitted` row");
  assert.equal(readGoalRequestLedger(ledger).rows.length, 1);
});

test("② a DIFFERENT reason is a DIFFERENT request (the replay rule does not swallow a new question)", () => {
  const { root, ledger } = seedRoot("submit-new");
  const a = submit(root, "GOAL-001", "AC-001", REASON);
  const b = submit(root, "GOAL-001", "AC-001", `${REASON} — and now the carrier landed`);
  assert.notEqual(b.requestId, a.requestId);
  assert.equal(b.state, "submitted");
  assert.equal(readGoalRequestLedger(ledger).rows.length, 2, "two distinct questions, two rows");
});

test("② AC4 negative controls: every refusal is NAMED and writes NOTHING", () => {
  const cases = [
    { name: "missing goal", goal: undefined, ac: "AC-001", code: "missing-goal" },
    { name: "missing ac", goal: "GOAL-001", ac: undefined, code: "missing-ac" },
    { name: "empty reason", goal: "GOAL-001", ac: "AC-001", reason: "", code: "reason-too-short" },
    { name: "whitespace reason", goal: "GOAL-001", ac: "AC-001", reason: "     a  b    ", code: "reason-too-short" },
    { name: "unknown goal", goal: "GOAL-999", ac: "AC-001", code: "no-such-goal" },
    { name: "unknown ac", goal: "GOAL-001", ac: "AC-999", code: "no-such-ac" },
    // An AC that exists but is filed under a DIFFERENT goal is "unknown" for THIS goal — ⛔ not a match.
    { name: "ac under another goal", goal: "GOAL-002", ac: "AC-001", code: "no-such-goal" },
  ];
  for (const c of cases) {
    const { root, ledger } = seedRoot(`refuse-${c.code}`);
    const r = submit(root, c.goal, c.ac, c.reason ?? REASON);
    assert.equal(r.ok, false, `${c.name}: refused`);
    assert.equal(r.state, "refused");
    assert.equal(r.refusal?.code, c.code, `${c.name}: named cause (got ${r.refusal?.code})`);
    assert.ok((r.refusal?.message ?? "").length > 0, `${c.name}: the refusal says something`);
    assert.equal(ledgerBytes(ledger), null, `${c.name}: ZERO writes — the carrier does not even exist`);
  }
});

test("② AC4 negative control: a read-only workspace is refused by name, zero writes", () => {
  const { root, ledger } = seedRoot("refuse-readonly");
  // `goals/` is readable (so the ladder reaches the WRITE step) but the root cannot gain `.quay/`.
  fs.chmodSync(root, 0o555);
  try {
    const r = submit(root, "GOAL-001", "AC-001", REASON);
    assert.equal(r.ok, false);
    assert.equal(r.refusal?.code, "ledger-unwritable", `got ${r.refusal?.code}: ${r.refusal?.message}`);
    assert.equal(ledgerBytes(ledger), null, "ZERO writes");
  } finally {
    fs.chmodSync(root, 0o755);
  }
});

test("② a goal store that cannot be READ is not reported as 'no such AC' (硬规则 3b)", () => {
  const root = tmpDir("store-unreadable");
  // `goals` exists as a FILE ⇒ readdir fails with ENOTDIR: neither "absent" nor "exists" is knowable.
  fs.writeFileSync(path.join(root, "goals"), "not a directory", "utf8");
  const r = submit(root, "GOAL-001", "AC-001", REASON);
  assert.equal(r.ok, false);
  assert.equal(r.refusal?.code, "goal-store-unreadable", `got ${r.refusal?.code}`);
  assert.equal(ledgerBytes(goalRequestLedgerPath(root)), null, "ZERO writes");
});

// ── ④ three states, never a boolean ─────────────────────────────────────────────────────────────
test("④ a MISSING ledger is a measurement; an UNREADABLE one is an instrument failure", () => {
  const { root, ledger } = seedRoot("read-missing");
  const missing = readGoalRequestLedger(ledger);
  assert.deepEqual(missing, { readable: true, rows: [], badLines: 0, cause: null }, "no queue yet ⇒ readable, zero rows");

  // Unreadable: a DIRECTORY where the file should be (EISDIR on read).
  fs.mkdirSync(ledger, { recursive: true });
  const unreadable = readGoalRequestLedger(ledger);
  assert.equal(unreadable.readable, false, "⛔ not the same shape as 'zero rows'");
  assert.ok(typeof unreadable.cause === "string" && unreadable.cause.length > 0, "the cause is named");
  assert.ok(root.length > 0);
});

test("④ bad lines are SKIPPED and COUNTED — one corrupt line does not blind the queue", () => {
  const { root, ledger } = seedRoot("read-badlines");
  submit(root, "GOAL-001", "AC-001", REASON);
  fs.appendFileSync(ledger, "{not json}\n");
  fs.appendFileSync(ledger, JSON.stringify({ state: "bogus", requestId: "x" }) + "\n");
  fs.appendFileSync(ledger, JSON.stringify({ state: "submitted" }) + "\n"); // no requestId

  const read = readGoalRequestLedger(ledger);
  assert.equal(read.readable, true);
  assert.equal(read.badLines, 3, `three unusable lines counted (got ${read.badLines})`);
  assert.equal(read.rows.length, 1, "the one good row still reads");
});

test("④ terminalStateOfVerdict: not-evaluated is its OWN terminal state, ⛔ never `refused`", () => {
  assert.equal(terminalStateOfVerdict("pass"), "accepted");
  assert.equal(terminalStateOfVerdict("fail"), "refused");
  assert.equal(terminalStateOfVerdict("not-evaluated"), "not-evaluated");
  assert.equal(terminalStateOfVerdict(null), "not-evaluated", "the criterion never ran ⇒ we cannot say");
});

// ── ③ settle: one terminal row per requestId, ever ──────────────────────────────────────────────
test("③ settle appends ONE terminal row carrying consumedAt, and a replay appends nothing", () => {
  const { root, ledger } = seedRoot("settle");
  const sub = submit(root, "GOAL-001", "AC-001", REASON);
  const submitted = readGoalRequestLedger(ledger).rows[0];
  assert.equal(openGoalRequests(readGoalRequestLedger(ledger).rows).length, 1, "open before consumption");

  const at = Date.parse("2026-11-06T12:00:00.000Z");
  const reading = settleGoalRequests(ledger, [{
    requestId: sub.requestId,
    goal: "GOAL-001",
    ac: "AC-001",
    reason: REASON,
    submittedAt: submitted.at,
    state: "accepted",
    verdict: "pass",
    detail: "criterion exited 0",
  }], { now: () => new Date(at) });

  assert.equal(reading.appended, 1);
  assert.deepEqual(reading.errors, []);

  const rows = readGoalRequestLedger(ledger).rows;
  assert.equal(rows.length, 2, "submitted + one terminal");
  const terminal = rows[1];
  assert.equal(terminal.state, "accepted");
  assert.equal(terminal.requestId, sub.requestId);
  assert.equal(terminal.consumedAt, new Date(at).toISOString(), "consumedAt is the settle instant");
  assert.equal(terminal.at, submitted.at, "the submission instant travels with the terminal row");
  assert.equal(terminal.verdict, "pass", "the raw verdict is kept beside the state");
  assert.equal(openGoalRequests(rows).length, 0, "the request is no longer open");
  assert.deepEqual([...settledRequestIds(rows)], [sub.requestId]);

  // THE REPLAY (AC-936's uniqueness clause): the same settlement arriving again must not append.
  const replay = settleGoalRequests(ledger, [{
    requestId: sub.requestId,
    goal: "GOAL-001",
    ac: "AC-001",
    reason: REASON,
    submittedAt: submitted.at,
    state: "refused",
    verdict: "fail",
    detail: "a later replay must not overwrite the answer",
  }], { now: () => new Date(at + 60_000) });

  assert.equal(replay.appended, 0, "⛔ no second terminal row");
  assert.deepEqual(replay.alreadySettled, [sub.requestId]);
  const after = readGoalRequestLedger(ledger).rows;
  assert.equal(after.length, 2, "still submitted + ONE terminal");
  assert.equal(after[1].state, "accepted", "the FIRST answer stands");
});

test("③ an already-settled request re-submits as `already-settled` and writes nothing", () => {
  const { root, ledger } = seedRoot("settle-resubmit");
  const sub = submit(root, "GOAL-001", "AC-001", REASON);
  settleGoalRequests(ledger, [{
    requestId: sub.requestId, goal: "GOAL-001", ac: "AC-001", reason: REASON,
    submittedAt: new Date().toISOString(), state: "refused", verdict: "fail", detail: "criterion exited 1",
  }]);
  const before = ledgerBytes(ledger);
  const again = submit(root, "GOAL-001", "AC-001", REASON);
  assert.equal(again.ok, true);
  assert.equal(again.state, "already-settled");
  assert.equal(again.settledAs, "refused", "the caller is told WHAT it was settled as");
  assert.equal(ledgerBytes(ledger), before, "ZERO writes");
});

test("③ settle on an unreadable ledger reports the error and appends nothing", () => {
  const { root, ledger } = seedRoot("settle-unreadable");
  fs.mkdirSync(ledger, { recursive: true });
  const reading = settleGoalRequests(ledger, [{
    requestId: "GOAL-001|AC-001|deadbeefdeadbeef", goal: "GOAL-001", ac: "AC-001", reason: REASON,
    submittedAt: new Date().toISOString(), state: "accepted", verdict: "pass", detail: "x",
  }]);
  assert.equal(reading.appended, 0);
  assert.equal(reading.errors.length, 1, `one named error (got ${JSON.stringify(reading.errors)})`);
  assert.ok(reading.errors[0].includes("ledger-unreadable"), reading.errors[0]);
  assert.ok(root.length > 0);
});

// ── the CLI verb (the surface a caller actually types) ───────────────────────────────────────────
function runGoalRequest(root, args) {
  const r = spawnSync("node", [QUAY_CLI, "goal", "request", ...args, "--root", root], {
    cwd: root,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

test("CLI: `quay goal request` writes the row and exits 0", () => {
  const { root, ledger } = seedRoot("cli-ok");
  const r = runGoalRequest(root, ["GOAL-001", "AC-001", "--reason", REASON, "--json"]);
  assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr.slice(0, 800)})`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.state, "submitted");
  assert.equal(out.requestId, goalRequestId("GOAL-001", "AC-001", REASON));
  assert.equal(out.goal, "GOAL-001");
  assert.equal(out.ac, "AC-001");
  assert.equal(readGoalRequestLedger(ledger).rows.length, 1, "the real carrier holds one row");
});

test("CLI: `--reason` under 8 non-whitespace chars exits 1 and writes nothing (AC-936 negative control)", () => {
  const { root, ledger } = seedRoot("cli-short-reason");
  // `"  ab  cd  "` is 10 characters and 4 characters of CONTENT — the floor is on the content.
  const r = runGoalRequest(root, ["GOAL-001", "AC-001", "--reason", "  ab  cd  "]);
  assert.equal(r.status, 1, `exit 1 (stdout: ${r.stdout})`);
  assert.match(r.stderr, /reason-too-short/);
  assert.equal(ledgerBytes(ledger), null, "ZERO writes");

  // Control: an exactly-8-content reason clears the floor and DOES write ⇒ the assertion above is
  // about the floor, not about the verb being broken (a test that only ever sees exit 1 proves nothing).
  const ok = runGoalRequest(root, ["GOAL-001", "AC-001", "--reason", "  abcdefgh  "]);
  assert.equal(ok.status, 0, `8 content chars is enough (stderr: ${ok.stderr.slice(0, 400)})`);
  assert.equal(readGoalRequestLedger(ledger).rows.length, 1);
});

test("CLI: an unknown AC is refused by name, exit 1, zero writes (AC-936 negative control)", () => {
  const { root, ledger } = seedRoot("cli-unknown-ac");
  const r = runGoalRequest(root, ["GOAL-001", "AC-999", "--reason", REASON]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no-such-ac/);
  assert.equal(ledgerBytes(ledger), null, "ZERO writes");
});

test("CLI: an unknown goal is refused by name, exit 1, zero writes (AC-936 negative control)", () => {
  const { root, ledger } = seedRoot("cli-unknown-goal");
  const r = runGoalRequest(root, ["GOAL-999", "AC-001", "--reason", REASON]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no-such-goal/);
  assert.equal(ledgerBytes(ledger), null, "ZERO writes");
});

test("CLI: a resubmission says so and does not grow the carrier", () => {
  const { root, ledger } = seedRoot("cli-dup");
  assert.equal(runGoalRequest(root, ["GOAL-001", "AC-001", "--reason", REASON]).status, 0);
  const before = ledgerBytes(ledger);
  const again = runGoalRequest(root, ["GOAL-001", "AC-001", "--reason", REASON]);
  assert.equal(again.status, 0, "an idempotent replay is not an error");
  assert.match(again.stdout, /already queued/);
  assert.equal(ledgerBytes(ledger), before);
});
