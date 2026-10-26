// @test-group product
//
// gap-suite-read-verb-current-and-recent-rounds — `quay suite --json`: the bounded, read-only JSON
// exit over the workspace's suite carriers (`.quay/full-suite-state.json` +
// `.quay/verification-round.jsonl`).
//
// WHAT IS PINNED HERE, and why each is a check rather than a prose claim:
//   • AC1  — the published shape is FIXED (`{current, rounds, carrier, evaluated}`), each published
//            round carries exactly `{round,startedAt,durationMs,pass,fail,state}`.
//   • AC1b — the UNIT TRAP: the live state carrier writes `startedAt` as an ISO string but
//            `finishedAt` as an epoch SECONDS integer. Both must be published in ONE unit (ISO 8601
//            UTC) — the test feeds the real measured pair and asserts the normalized output.
//   • AC2  — `--limit` (default 20) / `--since` / both combined, against a fixture ledger with
//            known round instants.
//   • AC3  — the ledger is NOT read whole: a ~16 MB synthetic carrier reports a `bytesRead` that is
//            a small fraction of its size, AND a negative control (the carrier's FRONT half replaced
//            with unparseable noise) yields byte-identical rounds — proof the front was never read.
//            ⛔ This is a bounded-read test, not a performance benchmark; the ≥100 MB wall-clock/RSS
//            measurement and the "did not整读" reading on the real carrier live in the task's
//            `## Evidence` section (a fixture cannot be that measurement — hard rule 4 推论三).
//   • AC4  — FOUR distinguishable carrier states: the state file absent / unparseable / readable, and
//            the rounds ledger absent / present-but-zero-valid-rows / readable.
//
// ⛔ NO in-tree writes: every fixture lives under os.tmpdir().
// ⛔ NO serve process: the verb reads files under the resolved root and nothing else.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { run } from "../bin/quay.ts";
import { readRecentSuiteRounds, SUITE_ROUNDS_DEFAULT_LIMIT } from "../src/observation.ts";

const _tmp = new Set();
after(() => {
  for (const dir of _tmp) fs.rmSync(dir, { recursive: true, force: true });
});

/** A throwaway workspace: `.quay/config.yml` is all `resolveRoot` needs. */
function mkWorkspace(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `quay-suite-${tag}-`));
  _tmp.add(root);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "provider: native\n");
  return root;
}

const STATE_REL = path.join(".quay", "full-suite-state.json");
const ROUNDS_REL = path.join(".quay", "verification-round.jsonl");

/** One ledger row. Extra padding keeps synthetic rows at a realistic (~tens of KB) size so the
 *  bounded-read test exercises the WINDOW growth, not a one-window trivial case. */
function roundLine(round, startedAt, { padBytes = 0 } = {}) {
  const rec = {
    round,
    startedAt,
    durationMs: 1000 + round,
    pass: 100 + round,
    fail: round % 3,
    state: round % 2 === 0 ? "green" : "red",
    reason: round % 2 === 0 ? null : "failed",
    commit: `c${String(round).padStart(38, "0")}`,
  };
  if (padBytes > 0) rec.perFile = [{ file: "x".repeat(padBytes), durationMs: 1, passed: true }];
  return JSON.stringify(rec) + "\n";
}

/** Write a ledger of `count` rounds, oldest→newest, one minute apart from `baseIso`. */
function writeRounds(root, count, { baseIso = "2026-10-01T00:00:00.000Z", padBytes = 0 } = {}) {
  const baseMs = Date.parse(baseIso);
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(roundLine(i + 1, new Date(baseMs + i * 60_000).toISOString(), { padBytes }));
  }
  fs.writeFileSync(path.join(root, ROUNDS_REL), lines.join(""));
  return { baseMs, count };
}

/** The real carrier's measured pair (task gap-suite-read-verb-current-and-recent-rounds AC1b):
 *  startedAt ISO string, finishedAt epoch SECONDS integer. */
const FINISHED_AT_EPOCH_SECONDS = 1792967664;
const REAL_STATE = {
  state: "green",
  runner: "inner",
  scope: "worktree",
  startedAt: "2026-10-25T22:14:20.100Z",
  finishedAt: FINISHED_AT_EPOCH_SECONDS,
  durationMs: 1204025,
  laneCount: 123,
  commit: "bc11214a52b86008077c6e9ed1aed2b67408f177",
  taskId: "gap-routine-architecture-analysis-god-package-serve-fanout-556",
  runId: "mfi-gap-routine-architecture-analysis-god-package-serve-fanout-556-1792966438217-bc0929",
};

function writeState(root, value) {
  fs.writeFileSync(path.join(root, STATE_REL), typeof value === "string" ? value : JSON.stringify(value));
}

async function runCli(args) {
  try {
    const r = await run(args, { capture: true });
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
  } finally {
    process.exitCode = 0; // run() mutates the shared global; keep the test runner's exit clean
  }
}

async function readSuite(root, extra = []) {
  const r = await runCli(["suite", "--json", ...extra, "--root", root]);
  const doc = r.stdout ? JSON.parse(r.stdout) : null;
  return { ...r, doc };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ── AC1 — verb + fixed shape ───────────────────────────────────────────────────────────────────────

test("AC1: `quay suite --json` publishes exactly {current, rounds, carrier, evaluated}", async () => {
  const root = mkWorkspace("ac1");
  writeState(root, REAL_STATE);
  writeRounds(root, 3);
  try {
    const { code, doc, stderr } = await readSuite(root);
    assert.equal(code, 0, `exit 0 (stderr: ${stderr})`);
    assert.deepEqual(Object.keys(doc).sort(), ["carrier", "current", "evaluated", "rounds"]);

    for (const k of [
      "state", "reason", "runner", "scope", "startedAt", "finishedAt",
      "durationMs", "laneCount", "commit", "taskId", "runId",
    ]) {
      assert.ok(k in doc.current, `current carries '${k}'`);
    }
    assert.equal(doc.current.state, "green");
    assert.equal(doc.current.runner, "inner");
    assert.equal(doc.current.scope, "worktree");
    assert.equal(doc.current.durationMs, 1204025);
    assert.equal(doc.current.laneCount, 123);
    assert.equal(doc.current.commit, REAL_STATE.commit);
    assert.equal(doc.current.taskId, REAL_STATE.taskId);
    assert.equal(doc.current.runId, REAL_STATE.runId);

    assert.equal(doc.rounds.length, 3);
    assert.deepEqual(
      Object.keys(doc.rounds[0]).sort(),
      ["durationMs", "fail", "pass", "round", "startedAt", "state"],
    );
    // Newest-first, same presentation order as the /tests page.
    assert.deepEqual(doc.rounds.map((r) => r.round), [3, 2, 1]);

    assert.ok("state" in doc.carrier && "reason" in doc.carrier, "carrier carries state+reason");
    assert.equal(doc.evaluated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC1b — the ONE-unit guarantee (finishedAt epoch seconds → ISO) ─────────────────────────────────

test("AC1b: the mixed-unit carrier is normalized — finishedAt epoch SECONDS and startedAt ISO both publish as ISO 8601 UTC", async () => {
  const root = mkWorkspace("ac1b");
  writeState(root, REAL_STATE);
  writeRounds(root, 1);
  try {
    const { doc } = await readSuite(root);
    // startedAt: ISO in, ISO out (unchanged instant).
    assert.equal(doc.current.startedAt, REAL_STATE.startedAt);
    // finishedAt: epoch SECONDS integer in, ISO 8601 UTC out — ⛔ never the raw number.
    assert.notEqual(typeof doc.current.finishedAt, "number");
    assert.match(doc.current.finishedAt, ISO_RE);
    assert.equal(Date.parse(doc.current.finishedAt), FINISHED_AT_EPOCH_SECONDS * 1000);
    // Both timestamps are in the SAME unit/vocabulary.
    assert.match(doc.current.startedAt, ISO_RE);
    assert.ok(
      Date.parse(doc.current.finishedAt) > Date.parse(doc.current.startedAt),
      "the normalized pair still orders correctly (finished after started)",
    );
    // A millisecond-epoch carrier (the other container of the same trap) normalizes identically.
    writeState(root, { ...REAL_STATE, finishedAt: FINISHED_AT_EPOCH_SECONDS * 1000 });
    const { doc: doc2 } = await readSuite(root);
    assert.equal(doc2.current.finishedAt, doc.current.finishedAt);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC2 — --limit / --since (combinable) ───────────────────────────────────────────────────────────

test("AC2: default limit is 20; --limit N returns the N most recent; --since filters by startedAt; both combine", async () => {
  const root = mkWorkspace("ac2");
  writeState(root, REAL_STATE);
  const { baseMs } = writeRounds(root, 25); // rounds 1..25, one minute apart from 2026-10-01T00:00Z
  try {
    // default
    const dflt = await readSuite(root);
    assert.equal(SUITE_ROUNDS_DEFAULT_LIMIT, 20);
    assert.equal(dflt.doc.rounds.length, 20);
    assert.deepEqual(dflt.doc.rounds.map((r) => r.round), Array.from({ length: 20 }, (_, i) => 25 - i));

    // --limit 3 (and as the FIRST token after the verb: verb-less flag parsing must not swallow it)
    const three = await readSuite(root, ["--limit", "3"]);
    assert.equal(three.code, 0, `--limit 3 exits 0 (stderr: ${three.stderr})`);
    assert.deepEqual(three.doc.rounds.map((r) => r.round), [25, 24, 23]);

    // --since: rounds 21..25 start at/after base + 20 minutes.
    const sinceMs = baseMs + 20 * 60_000;
    const since = await readSuite(root, ["--since", new Date(sinceMs).toISOString()]);
    assert.deepEqual(since.doc.rounds.map((r) => r.round), [25, 24, 23, 22, 21]);

    // combined: --since base+20m AND --limit 2 ⇒ the two newest inside the window.
    const both = await readSuite(root, ["--since", new Date(sinceMs).toISOString(), "--limit", "2"]);
    assert.deepEqual(both.doc.rounds.map((r) => r.round), [25, 24]);

    // An empty --since window is an EVALUATED empty reading (exit 0), not a failure.
    const future = await readSuite(root, ["--since", "2027-01-01T00:00:00Z"]);
    assert.equal(future.code, 0, "a --since window with no rounds still exits 0");
    assert.deepEqual(future.doc.rounds, []);
    assert.equal(future.doc.carrier.rounds.state, "ok", "the CARRIER is still ok — the window is what is empty");

    // Invalid values are usage errors (exit 1, no document) — never a silently-unbounded read.
    const badLimit = await runCli(["suite", "--json", "--limit", "0", "--root", root]);
    assert.equal(badLimit.code, 1, "--limit 0 exits 1");
    assert.equal(badLimit.stdout, "", "--limit 0 prints no document");
    const badSince = await runCli(["suite", "--json", "--since", "not-a-date", "--root", root]);
    assert.equal(badSince.code, 1, "--since not-a-date exits 1");
    assert.match(badSince.stderr, /ISO 8601/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC3 — bounded read of the ledger ──────────────────────────────────────────────────────────────

test("AC3: a ~16MB ledger is read only at its TAIL — bytesRead is a small fraction of the file, and the front half is never touched", async () => {
  const root = mkWorkspace("ac3");
  writeState(root, REAL_STATE);
  const PAD = 40_000; // ~40 KB rows, the live ledger's order of magnitude
  const { baseMs } = writeRounds(root, 400, { padBytes: PAD });
  const filePath = path.join(root, ROUNDS_REL);
  const size = fs.statSync(filePath).size;
  assert.ok(size > 8 * 1024 * 1024, `fixture is large enough to be meaningful (${size} bytes)`);

  try {
    const reading = readRecentSuiteRounds(root, { limit: 20 });
    assert.equal(reading.rounds.length, 20);
    assert.equal(reading.exhausted, false, "the scan stopped at its window; it did not reach byte 0");
    assert.ok(reading.bytesRead < size / 4, `bytesRead (${reading.bytesRead}) is a small fraction of ${size}`);
    // The same numbers must be visible to a CONSUMER (not only to an in-process caller).
    const cli = await readSuite(root, ["--limit", "20"]);
    assert.equal(cli.doc.carrier.rounds.bytesRead, reading.bytesRead);
    assert.equal(cli.doc.carrier.rounds.exhausted, false);

    // NEGATIVE CONTROL: replace the FRONT 60% of the ledger with unparseable noise. If the reader
    // scanned from the head (or read the whole file), these bytes would change the answer. Identical
    // output ⇒ the front was never read.
    const keepBytes = Math.floor(size * 0.4);
    const tail = fs.readFileSync(filePath).subarray(size - keepBytes);
    const noise = Buffer.from("!!! NOT JSON !!!\n".repeat(Math.ceil((size - keepBytes) / 17)));
    fs.writeFileSync(filePath, Buffer.concat([noise.subarray(0, size - keepBytes), tail]));
    const noisy = readRecentSuiteRounds(root, { limit: 20 });
    assert.deepEqual(noisy.rounds, reading.rounds, "the answers are byte-identical with the front replaced by noise");
    assert.equal(noisy.exhausted, false);

    // ⛔ Counter-check that the noise is REALLY unparseable (otherwise the control is vacuous).
    let parsedNoiseRows = 0;
    for (const line of noise.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      try { JSON.parse(line); parsedNoiseRows++; } catch { /* expected */ }
    }
    assert.equal(parsedNoiseRows, 0, "the injected front half contains no JSON rows at all");

    // `--since` also stays bounded: a cutoff inside the last few rounds grows the window a little,
    // not to the whole file.
    const sinceMs = baseMs + 380 * 60_000; // rounds 381..400
    const since = readRecentSuiteRounds(root, { sinceMs });
    assert.deepEqual(since.rounds.map((r) => r.round), Array.from({ length: 20 }, (_, i) => 400 - i));
    assert.ok(since.bytesRead < fs.statSync(filePath).size, "--since did not read the whole (noisy) carrier");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC4 — enumerated carrier states (never one boolean) ───────────────────────────────────────────

test("AC4: state-file absent / unparseable / readable and ledger absent / zero-valid / readable are four+ distinguishable states", async () => {
  // ① nothing at all
  const empty = mkWorkspace("ac4-empty");
  // ② state file exists but is not JSON
  const broken = mkWorkspace("ac4-broken");
  writeState(broken, "{ this is not json");
  // ③ state readable, ledger exists but carries ZERO valid rows
  const zeroRows = mkWorkspace("ac4-zero");
  writeState(zeroRows, REAL_STATE);
  fs.writeFileSync(path.join(zeroRows, ROUNDS_REL), "!!! not json !!!\n{ also, no }\n");
  // ④ both readable
  const ok = mkWorkspace("ac4-ok");
  writeState(ok, REAL_STATE);
  writeRounds(ok, 2);
  try {
    const absent = await readSuite(empty);
    assert.equal(absent.code, 0, "an absent carrier is a real reading, not a failure");
    assert.equal(absent.doc.current, null);
    assert.equal(absent.doc.carrier.state, "absent");
    assert.equal(absent.doc.carrier.suiteState.state, "absent");
    assert.equal(absent.doc.carrier.rounds.state, "absent");
    assert.equal(absent.doc.evaluated, true);

    const unreadable = await readSuite(broken);
    assert.equal(unreadable.code, 1, "an EXISTING but unparseable carrier exits 1 (3b)");
    assert.equal(unreadable.doc.current, null);
    assert.equal(unreadable.doc.carrier.state, "unreadable");
    assert.equal(unreadable.doc.carrier.suiteState.state, "unreadable");
    assert.ok(unreadable.doc.carrier.suiteState.reason, "unreadable carries a reason");
    assert.equal(unreadable.doc.evaluated, false);
    assert.match(unreadable.stderr, /quay suite:/);

    const zero = await readSuite(zeroRows);
    assert.equal(zero.code, 0);
    assert.notEqual(zero.doc.current, null, "the state carrier itself IS readable");
    assert.equal(zero.doc.carrier.suiteState.state, "ok");
    assert.equal(zero.doc.carrier.rounds.state, "empty-writer-zero-records");
    assert.equal(zero.doc.carrier.state, "empty-writer-zero-records");
    assert.deepEqual(zero.doc.rounds, []);
    assert.equal(zero.doc.evaluated, true);

    const readable = await readSuite(ok);
    assert.equal(readable.doc.carrier.state, "ok");
    assert.equal(readable.doc.carrier.rounds.state, "ok");
    assert.equal(readable.doc.rounds.length, 2);
    assert.equal(readable.doc.evaluated, true);

    // The four readings are pairwise distinct in the values the task named.
    const states = [absent, unreadable, zero, readable].map((r) => `${String(r.doc.current)}|${r.doc.carrier.state}`);
    assert.equal(new Set(states).size, states.length, `the carrier readings are distinguishable: ${states.join(" / ")}`);
  } finally {
    for (const dir of [empty, broken, zeroRows, ok]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC6 — capability probe + help registration ───────────────────────────────────────────────────

test("AC6: the verb is registered on the help surface with its first-shipped version, and needs no --json flag to emit JSON", async () => {
  const root = mkWorkspace("ac6");
  writeState(root, REAL_STATE);
  writeRounds(root, 2);
  try {
    const noFlag = await runCli(["suite", "--root", root]);
    assert.equal(noFlag.code, 0, "a bare `quay suite` still emits JSON");
    assert.ok("current" in JSON.parse(noFlag.stdout) && "rounds" in JSON.parse(noFlag.stdout));

    const help = await runCli(["--help"]);
    assert.match(help.stdout, /quay suite \[--json\] \[--limit <n>\] \[--since <ISO8601>\]/);
    const detail = await runCli(["suite", "--help"]);
    assert.equal(detail.code, 0);
    assert.match(detail.stdout, /first shipped in 0\.23\.0-dev/);
    assert.match(detail.stdout, /finishedAt/);
    assert.match(detail.stdout, /ISO 8601/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
