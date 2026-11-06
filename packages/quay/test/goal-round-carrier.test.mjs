// @test-group product
// goal-round-carrier.test.mjs — the ONE reader of the goal driver's round log
// (tasks/gap-goal-next-unchanged-rounds-escalation, AC-943).
//
// WHAT IS UNDER TEST: `readGoalNextHistory` / `readRoundLogTail` in
// `packages/quay/src/core/goal-round-carrier.ts`. Two consumers read the same file — the goal-driver
// (which feeds the projection's `history`) and the Core CLI — so the properties below are the
// contract both depend on:
//   · a BOUNDED tail read that drops a half-line at the window edge (a truncated record must never be
//     parsed as a record);
//   · rounds with no readable `goal-next` fact are FILTERED OUT (a stop request legitimately leaves
//     the fact absent — that round says nothing about any row, so it neither counts nor breaks);
//   · `null` when the file cannot be read, ⛔ NEVER `[]` (an empty history means "read it, this is the
//     first round"; conflating the two reports a 50-round wait as brand new — hard rule 3b);
//   · `maxRounds` keeps the NEWEST N (oldest → newest), because a streak counts backwards from now.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readGoalNextHistory,
  readRoundLogTail,
} from "../src/core/goal-round-carrier.ts";

const _created = [];
function tmpDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goal-round-carrier-${tag}-`));
  _created.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of _created) fs.rmSync(dir, { recursive: true, force: true });
});

/** The row shape a round's `goal-next` fact carries (only `ac`/`gapState` matter to the reader — it
 *  does ⛔ not validate rows: a row it cannot fully understand is still that round's reading). */
const row = (ac = "AC-001") => ({ goal: "GOAL-001", ac, gapState: "world-gated", rank: "world-gated", owner: "world", action: { kind: "wait", reason: "x" } });

/** One round record, in the envelope `computeRoundRecord` writes. `rows === null` ⇒ the round ran but
 *  produced NO `goal-next` fact (e.g. it was truncated by a stop request). */
function roundRecord(round, rows, { evaluated = true } = {}) {
  const facts = rows === null
    ? [{ name: "goal-ring", value: { goalCount: 1 }, state: "verified", reason: "fixture" }]
    : [{
        name: "goal-next",
        value: { rows, evaluated, cause: evaluated ? null : "fixture-cause" },
        state: evaluated ? "verified" : "not-evaluated",
        reason: "fixture",
      }];
  return { round, run_id: "test-run", ts: "2026-11-07T00:00:00.000Z", facts };
}

function writeCarrier(dir, records) {
  const file = path.join(dir, "goal-round.jsonl");
  fs.writeFileSync(file, records.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf8");
  return file;
}

test("AC5: a carrier with 8 identical `goal-next` rows reads back as 8 rounds, oldest → newest", () => {
  const dir = tmpDir("eight");
  const file = writeCarrier(dir, Array.from({ length: 8 }, (_, i) => roundRecord(i + 1, [row()])));

  const history = readGoalNextHistory(file);
  assert.ok(Array.isArray(history), "the file exists and parses ⇒ an array, ⛔ not null");
  assert.equal(history.length, 8, "every round carried the fact ⇒ every round is in the history");
  assert.deepEqual(history.map((r) => r.round), [1, 2, 3, 4, 5, 6, 7, 8], "ordered OLDEST → NEWEST (the streak counts backwards from the newest)");
  for (const h of history) assert.deepEqual(h.rows, [row()], "the rows travel verbatim — the reader does not re-derive them");
});

test("AC5 negative control: a MISSING carrier is `null`, ⛔ NOT an empty array", () => {
  const dir = tmpDir("missing");
  const missing = path.join(dir, "nope.jsonl");
  const history = readGoalNextHistory(missing);
  assert.equal(history, null, "unreadable ⇒ null (its own value)");
  assert.notDeepEqual(history, [], "⛔ `[]` would say 'read it, this is the first round' — the opposite of what happened");
  // Control on the other side: an EMPTY (but present) carrier IS a readable history with zero rounds.
  const empty = writeCarrier(dir, []);
  assert.deepEqual(readGoalNextHistory(empty), [], "a present-but-empty carrier is a genuine empty reading");
});

test("AC5: `maxRounds` keeps the NEWEST N rounds", () => {
  const dir = tmpDir("cap");
  const file = writeCarrier(dir, Array.from({ length: 12 }, (_, i) => roundRecord(i + 1, [row()])));
  const history = readGoalNextHistory(file, { maxRounds: 5 });
  assert.equal(history.length, 5);
  assert.deepEqual(history.map((r) => r.round), [8, 9, 10, 11, 12], "the newest five, still oldest → newest (⛔ the oldest five)");
});

test("AC5: rounds with no readable fact are FILTERED OUT — they neither count nor break", () => {
  const dir = tmpDir("filtered");
  const file = writeCarrier(dir, [
    roundRecord(1, [row()]),
    roundRecord(2, null), // truncated by a stop request: no goal-next fact at all
    roundRecord(3, [row("AC-002")]),
    roundRecord(4, [row()], { evaluated: false }), // the fact exists but as NOT-EVALUATED
    roundRecord(5, [row()]),
  ]);
  const history = readGoalNextHistory(file);
  assert.deepEqual(history.map((r) => r.round), [1, 3, 5], "only the rounds that actually carry a reading");
  assert.deepEqual(history.map((r) => r.rows[0].ac), ["AC-001", "AC-002", "AC-001"], "and their rows are the ones that round emitted");
});

test("AC5/4c: the tail read drops a HALF LINE at the window edge (a truncated record is not a record)", () => {
  const dir = tmpDir("half-line");
  const file = writeCarrier(dir, [
    roundRecord(1, [row()]),
    roundRecord(2, [row()]),
    roundRecord(3, [row()]),
  ]);
  const full = fs.statSync(file).size;
  // A window that starts in the MIDDLE of line 2: its first bytes are a fragment of a real record.
  const windowBytes = Math.floor(full / 2);
  const tail = readRoundLogTail(file, windowBytes);
  assert.ok(tail.lines.length > 0);
  for (const line of tail.lines.filter((l) => l.trim() !== "")) {
    assert.doesNotThrow(() => JSON.parse(line), `every complete line still parses (got: ${line.slice(0, 60)}…)`);
  }
  // The fragment was dropped, so nothing "parses" into a record that was never written whole.
  const history = readGoalNextHistory(file, { maxBytes: windowBytes });
  assert.ok(Array.isArray(history));
  for (const h of history) assert.ok([1, 2, 3].includes(h.round), `every returned round is a whole one (got ${h.round})`);
});
