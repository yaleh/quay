// @test-group engine
// carrier-retention.test.mjs — RED/GREEN for plugin/scripts/carrier-retention.ts
// (tasks/gap-driver-round-carriers-unbounded-growth-retention-design AC2/AC3/AC5).
//
// WHAT THIS FILE IS FOR: the task's whole risk is that a retention rule SILENTLY FLIPS A READING
// (硬规则 4b/4c). So every arm here is an equality between a reading taken over the pre-archive
// carrier and the SAME reading taken over the post-archive carrier — driven through the REAL reader
// functions imported from their real modules, never a re-implementation of them (a re-implementation
// would prove the fixture agrees with itself). AC3 additionally asserts the OPPOSITE arm: reading
// the archived LIVE TAIL ALONE must differ, which is what makes the segment-iterating helper
// load-bearing rather than decorative.
//
// Every temp tree lives under os.tmpdir() and is removed in a finally block (test-isolation contract:
// a test must own what it touches).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ROUND_CARRIERS,
  archiveCarrier,
  archiveDirFor,
  carrierPath,
  listSegments,
  loadRetentionConfig,
  manifestPathFor,
  lineStartAtOrBefore,
  materializeAllRecords,
  planCarrier,
  readAllRecords,
} from "../scripts/carrier-retention.ts";

// The REAL readers, one per carrier in the census (AC3). Importing them (rather than copying their
// logic) is the point: the test cannot drift from what production actually does.
import { readRoundRows, latestRound } from "../scripts/suite-duration-exceed-check.ts";
import { loadDurationAverages } from "../scripts/suite-lpt-order.ts";
import { readCarrierPerFile } from "../scripts/perfile-failure-rate.ts";
import { readCurrentRound } from "../scripts/pool-quality-judge.ts";
import { parsePromotionRoundRecords } from "../../packages/quay/src/observation.ts";
import { readGoalSufficiency } from "../../packages/quay/src/goal-merge.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RETENTION_CLI = path.join(__dirname, "..", "scripts", "carrier-retention.ts");

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
// The carrier-array + `after()` pattern tmp-leak-pairing-check recognises: the mkdtemp result is
// pushed into `_roots`, and `_roots` is the thing the cleanup region names.
const _roots = [];
after(() => {
  for (const d of _roots) fs.rmSync(d, { recursive: true, force: true });
});

function mkroot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carrier-retention-"));
  _roots.push(dir);
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  return dir;
}

const POLICY = (over = {}) => ({ enabled: true, liveMaxBytes: null, liveMaxDays: null, gzip: false, ...over });

/** Deterministic JSONL fixture lines, each ending in `\n`. */
function makeLines(n, { carrier = "round", first = 1 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(JSON.stringify({
      round: first + i,
      ts: `2026-0${(i % 9) + 1}-1${i % 9}T0${i % 9}:00:00.000Z`,
      carrier,
      perFile: [{ file: `plugin/test/f${i % 3}.test.mjs`, durationMs: 100 + i }],
      state: i % 2 ? "green" : "red",
    }));
  }
  return out;
}

function writeCarrier(root, carrier, lines) {
  const p = carrierPath(root, carrier);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.map((l) => l + "\n").join(""));
  return p;
}

/** Every byte the carrier's history now consists of, in archived order: segments then live tail. */
function allBytesAfter(root, carrier, livePath) {
  const { segments } = listSegments(livePath);
  const parts = segments.map((s) => fs.readFileSync(path.join(archiveDirFor(livePath), s.file)));
  try { parts.push(fs.readFileSync(livePath)); } catch {}
  return Buffer.concat(parts);
}

function multisetOf(buf) {
  return buf.toString("utf8").split("\n").filter((l) => l.trim()).sort();
}

/** A SECOND root whose `<carrier>` is the full history re-concatenated into one file — the layout a
 *  pre-archive reader expects. Root-taking readers run against this for the "after" arm. */
async function replayRoot(srcRoot, carrier) {
  const dst = mkroot();
  await materializeAllRecords(carrierPath(srcRoot, carrier), path.join(dst, ".quay", carrier));
  return dst;
}

function snapshotTree(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      out.push(`${path.relative(root, abs)} ${fs.statSync(abs).size}`);
    }
  };
  walk(root);
  return out.sort();
}

// ── AC5: default DISABLED — the config decides, and its absence writes nothing ──────────────────
test("AC5: no `retention:` section ⇒ config is `absent`, disabled, and ZERO archive writes", async () => {
  const root = mkroot();
  const carrier = "meta-driver-round.jsonl";
  writeCarrier(root, carrier, makeLines(40));

  const cfg = loadRetentionConfig(root);
  assert.equal(cfg.source, "absent", "an absent section is its own state, not `malformed`");
  assert.equal(cfg.enabled, false);

  const before = snapshotTree(root);
  const r = await archiveCarrier({ root, carrier, policy: { enabled: false, liveMaxBytes: 100, liveMaxDays: null, gzip: false } });
  assert.equal(r.action, "disabled");
  assert.equal(r.headBytes, 0);
  assert.deepEqual(snapshotTree(root), before, "a disabled policy must not create so much as a directory");
  assert.equal(fs.existsSync(archiveDirFor(carrierPath(root, carrier))), false);
});

test("AC5: `retention: {enabled: false}` is distinguishable from absent, and still writes nothing", async () => {
  const root = mkroot();
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "retention:\n  enabled: false\n  live_max_bytes: 10\n");
  const carrier = "goal-round.jsonl";
  writeCarrier(root, carrier, makeLines(30));

  const cfg = loadRetentionConfig(root);
  assert.equal(cfg.source, "config");
  assert.equal(cfg.enabled, false);
  assert.notEqual(cfg.source, "absent", "`enabled: false` and `no section` are different states (硬规则 3b)");

  const before = snapshotTree(root);
  const r = await archiveCarrier({ root, carrier, policy: { enabled: false, liveMaxBytes: 10, liveMaxDays: null, gzip: false } });
  assert.equal(r.action, "disabled");
  assert.equal(r.headBytes, 0);
  assert.deepEqual(snapshotTree(root), before);
});

test("AC5: a MALFORMED `retention:` block fails closed (disabled) and says why — it is not `absent`", () => {
  const root = mkroot();
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "retention: [this, is, a, list]\n");
  const cfg = loadRetentionConfig(root);
  assert.equal(cfg.source, "malformed");
  assert.equal(cfg.enabled, false, "fail-closed direction for retention is DO NOTHING");
  assert.match(cfg.reason, /not a mapping/);
});

// ── AC2a: an archive is a MOVE — the concatenation is byte-identical ────────────────────────────
test("AC2a: segments (in manifest order) ++ live tail is byte-identical to the pre-archive carrier", async () => {
  const root = mkroot();
  const carrier = "verification-round.jsonl";
  const livePath = writeCarrier(root, carrier, makeLines(60));
  const original = fs.readFileSync(livePath);

  const r1 = await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 1500 }) });
  assert.equal(r1.action, "archived");
  assert.ok(r1.headBytes > 0 && r1.tailBytes > 0, "the cut must leave a non-empty tail (else the arm is vacuous)");

  // A SECOND rotation proves the manifest ordering, not just "one segment happens to be first".
  const r2 = await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 500 }) });
  assert.equal(r2.action, "archived");
  const { segments, source } = listSegments(livePath);
  assert.ok(segments.length >= 2, `expected ≥2 segments, got ${segments.length} (source=${source})`);

  assert.equal(Buffer.compare(allBytesAfter(root, carrier, livePath), original), 0,
    "segments ++ live must reproduce the original bytes exactly");
  assert.deepEqual(multisetOf(allBytesAfter(root, carrier, livePath)), multisetOf(original));
});

test("AC2a negative control: a DROPPED line makes the concatenation equality fail (the assertion can take false)", async () => {
  const root = mkroot();
  const carrier = "goal-round.jsonl";
  const livePath = writeCarrier(root, carrier, makeLines(30));
  const original = fs.readFileSync(livePath);
  await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 800 }) });

  const { segments } = listSegments(livePath);
  const segPath = path.join(archiveDirFor(livePath), segments[0].file);
  const segLines = fs.readFileSync(segPath, "utf8").split("\n").filter((l) => l.trim());
  fs.writeFileSync(segPath, segLines.slice(0, -1).map((l) => l + "\n").join("")); // drop one line

  assert.notEqual(Buffer.compare(allBytesAfter(root, carrier, livePath), original), 0,
    "if dropping a line still compared equal, AC2a's assertion would be vacuous");
});

// ── AC2c: a failure mid-archive leaves the LIVE carrier byte-identical ──────────────────────────
for (const fault of ["after-segment-write", "before-live-rename"]) {
  test(`AC2c: fault at \`${fault}\` leaves the live carrier byte-identical`, async () => {
    const root = mkroot();
    const carrier = "promotion-round.jsonl";
    const livePath = writeCarrier(root, carrier, makeLines(40));
    const before = fs.readFileSync(livePath);

    const r = await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 700 }), fault });
    assert.equal(r.action, "error");
    assert.match(r.error, new RegExp(fault));

    assert.equal(Buffer.compare(fs.readFileSync(livePath), before), 0, "live carrier must be untouched");
    assert.equal(fs.readdirSync(path.dirname(livePath)).some((n) => n.startsWith(".tmp-live-")), false,
      "no temp file may be left behind");
  });
}

// ── AC2d: the segment-iterating helper returns the pre-archive records ──────────────────────────
test("AC2d: readAllRecords / materializeAllRecords return the same records as the pre-archive file", async () => {
  const root = mkroot();
  const carrier = "worker-round.jsonl";
  const livePath = writeCarrier(root, carrier, makeLines(50));
  const originalLines = fs.readFileSync(livePath, "utf8").split("\n").filter((l) => l.trim());

  assert.deepEqual(readAllRecords(livePath).lines, originalLines, "pre-archive read-through must be transparent");

  await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 1200 }) });

  const after = readAllRecords(livePath);
  assert.deepEqual(after.lines, originalLines);
  assert.equal(after.source, "manifest");

  const dst = mkroot();
  const m = await materializeAllRecords(livePath, path.join(dst, ".quay", carrier));
  assert.equal(m.segments, after.segments.length);
  assert.deepEqual(
    fs.readFileSync(m.path, "utf8").split("\n").filter((l) => l.trim()),
    originalLines,
    "materializeAllRecords must be byte-equivalent to the pre-archive carrier",
  );
});

test("AC2d: with a LOST manifest, listSegments still reports the segments in archived order (source=disk)", async () => {
  const root = mkroot();
  const carrier = "outer-round.jsonl";
  const livePath = writeCarrier(root, carrier, makeLines(40));
  const original = fs.readFileSync(livePath);
  await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 700 }) });
  await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 300 }) });

  fs.rmSync(manifestPathFor(livePath));
  const { segments, source } = listSegments(livePath);
  assert.equal(source, "disk", "a missing manifest must be a distinguishable state, not `none`");
  assert.ok(segments.length >= 2);
  assert.equal(Buffer.compare(allBytesAfter(root, carrier, livePath), original), 0,
    "disk-order recovery must still reproduce the original byte sequence");
});

// ── AC2b: a concurrent appender loses and duplicates nothing ────────────────────────────────────
const APPENDER_SRC = `
const fs = require("node:fs");
const file = process.env.CR_FILE;
const n = Number(process.env.CR_N || "0");
const delay = Number(process.env.CR_DELAY_MS || "2");
let i = 0;
const tick = () => {
  fs.appendFileSync(file, JSON.stringify({ round: 9000 + i, ts: "2026-01-01T00:00:00.000Z", writer: "child" }) + "\\n");
  if (++i >= n) process.exit(0);
  setTimeout(tick, delay);
};
tick();
`;

test("AC2b: N concurrent appends during the cut — every line present exactly once", async () => {
  const root = mkroot();
  const carrier = "meta-driver-round.jsonl";
  const base = makeLines(40);
  const livePath = writeCarrier(root, carrier, base);
  const N = 60;
  const childLines = [];
  for (let i = 0; i < N; i++) {
    childLines.push(JSON.stringify({ round: 9000 + i, ts: "2026-01-01T00:00:00.000Z", writer: "child" }));
  }

  const child = spawn(process.execPath, ["-e", APPENDER_SRC], {
    env: { ...process.env, CR_FILE: livePath, CR_N: String(N), CR_DELAY_MS: "3" },
    stdio: "ignore",
  });
  const exited = new Promise((resolve) => child.on("exit", resolve));

  await new Promise((r) => setTimeout(r, 25)); // let the appender get going
  const r = await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 900 }), settleMs: 400 });
  assert.equal(r.action, "archived");
  await exited;

  const got = multisetOf(allBytesAfter(root, carrier, livePath));
  const want = [...base, ...childLines].sort();
  assert.deepEqual(got, want, `lost=${want.length - got.length} — the cut must lose and duplicate nothing`);

  const counts = new Map();
  for (const l of got) counts.set(l, (counts.get(l) ?? 0) + 1);
  assert.equal([...counts.values()].every((c) => c === 1), true, "no line may appear twice");
});

test("AC2b negative control: a rotation that does NOT drain the pinned inode loses that write", async () => {
  // The mechanism under test in one place: an appender that opened the path BEFORE the atomic
  // replace keeps writing into the ORPHANED inode. Without the straggler drain those bytes vanish,
  // so a multiset comparison against "everything ever written" takes FALSE — which is exactly what
  // AC2b asserts must never happen on the real path.
  const root = mkroot();
  const carrier = "goal-round.jsonl";
  const base = makeLines(10);
  const livePath = writeCarrier(root, carrier, base);

  // An appender holding an fd on the PRE-REPLACE inode — the shape every `*-round.jsonl` writer has
  // for the duration of one append.
  const heldFd = fs.openSync(livePath, "a");
  const tmp = path.join(path.dirname(livePath), ".ncdr-live");
  fs.writeFileSync(tmp, "");
  fs.renameSync(tmp, livePath); // atomic replace — `heldFd` now points at an orphaned inode
  const raced = JSON.stringify({ round: 777, ts: "2026-01-01T00:00:00.000Z", writer: "raced" });
  fs.writeSync(heldFd, raced + "\n");
  fs.closeSync(heldFd);

  const survived = multisetOf(fs.readFileSync(livePath));
  assert.equal(survived.some((l) => l.includes('"round":777')), false,
    "the raced write is NOT in the replaced file — this is the loss the drain exists to prevent");
  assert.notDeepEqual(survived, [...base, raced].sort(),
    "if the raced line HAD survived, AC2b's multiset equality could not take false");
});

// ── AC3: every history-dependent reader in the census reads the SAME after archiving ────────────
test("AC3: verification-round readers (suite-duration-exceed-check / suite-lpt-order / perfile-failure-rate / pool-quality-judge) are reading-preserving", async () => {
  const root = mkroot();
  const carrier = "verification-round.jsonl";
  const livePath = writeCarrier(root, carrier, makeLines(64));

  // BEFORE — the readers over the un-archived carrier.
  const rowsBefore = readRoundRows(root);
  const latestBefore = latestRound(rowsBefore);
  const durBefore = [...loadDurationAverages(livePath, root, 3).entries()].sort();
  const perFileBefore = readCarrierPerFile(root).recs;
  const roundBefore = readCurrentRound(root);

  await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 1500 }) });

  // AFTER — the same readers, pointed at the segment-iterating materialization.
  const replay = await replayRoot(root, carrier);
  const rowsAfter = readRoundRows(replay);
  const latestAfter = latestRound(rowsAfter);
  const durAfter = [...loadDurationAverages(carrierPath(replay, carrier), replay, 3).entries()].sort();
  const perFileAfter = readCarrierPerFile(replay).recs;
  const roundAfter = readCurrentRound(replay);

  assert.equal(rowsBefore.length, 64);
  assert.deepEqual(rowsAfter, rowsBefore, "readRoundRows (WHOLE history — max `round`) must be preserved");
  assert.deepEqual(latestAfter, latestBefore);
  assert.deepEqual(durAfter, durBefore, "loadDurationAverages (latest-N per file) must be preserved");
  assert.deepEqual(perFileAfter, perFileBefore, "readCarrierPerFile (WHOLE perFile population) must be preserved");
  assert.equal(roundAfter, roundBefore, "readCurrentRound counts EVERY line — the whole-history reader");

  // ⛔ AND the opposite arm: reading the archived LIVE TAIL ALONE must DIFFER. Without this, the
  // equality above could hold for a helper that quietly re-read something else.
  assert.notEqual(readCurrentRound(root), roundBefore,
    "the live tail alone must NOT reproduce the whole-history round count — that is why read-through exists");
  assert.ok(readRoundRows(root).length < rowsBefore.length);
});

test("AC3: goal-round reader (goal-merge.readGoalSufficiency — LAST matching verdict) is reading-preserving", async () => {
  const root = mkroot();
  const carrier = "goal-round.jsonl";
  const lines = [
    JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", value: { sufficiency: { goal: "GOAL-999", verdict: "insufficient" } }, reason: "early" }),
    JSON.stringify({ ts: "2026-01-01T00:01:00.000Z", other: true }),
    JSON.stringify({ ts: "2026-01-01T00:02:00.000Z", value: { sufficiency: { goal: "GOAL-999", verdict: "covered" } }, reason: "late" }),
    ...makeLines(20, { carrier: "goal" }),
    JSON.stringify({ ts: "2026-01-01T00:03:00.000Z", other: true }),
  ];
  writeCarrier(root, carrier, lines);

  const before = readGoalSufficiency(root, "GOAL-999");
  assert.equal(before.verdict, "covered", "fixture premise: the LAST verdict is the one that wins");

  await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 400 }) });
  const replay = await replayRoot(root, carrier);
  assert.deepEqual(readGoalSufficiency(replay, "GOAL-999"), before,
    "the last-matching-verdict reading must survive archiving");

  // Opposite arm: the archived live tail no longer carries the verdict that decides the reading
  // (it was in the archived prefix), so a tail-only read reports the distinguishable not-evaluated.
  assert.equal(readGoalSufficiency(root, "GOAL-999").verdict, "not-evaluated");
});

test("AC3: promotion-round reader (observation.parsePromotionRoundRecords) is reading-preserving", async () => {
  const root = mkroot();
  const carrier = "promotion-round.jsonl";
  const lines = makeLines(30, { carrier: "promotion" }).map((l) => {
    const o = JSON.parse(l);
    return JSON.stringify({ ts: o.ts, round: o.round, action: "promote", pool: o.round, promoted_ids: [`gap-${o.round}`], error: null });
  });
  const livePath = writeCarrier(root, carrier, lines);

  const before = parsePromotionRoundRecords(fs.readFileSync(livePath, "utf8"));
  await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 900 }) });
  const after = parsePromotionRoundRecords(readAllRecords(livePath).text);
  assert.equal(before.length, 30);
  assert.deepEqual(after, before);
  assert.ok(readAllRecords(livePath).lines.length > fs.readFileSync(livePath, "utf8").split("\n").filter((l) => l.trim()).length,
    "the read-through must carry MORE than the live tail, else the equality is trivially true");
});

// ── `--dry-run` and the disabled CLI write nothing (AC4 read side; AC5 write side) ─────────────
test("the CLI writes nothing for a workspace with no `retention:` — dry-run or not", async () => {
  const root = mkroot();
  for (const c of ROUND_CARRIERS) writeCarrier(root, c, makeLines(12, { carrier: c }));
  const before = snapshotTree(root);

  for (const args of [["--root", root], ["--root", root, "--dry-run"], ["--root", root, "--json"]]) {
    const r = await runCli(args);
    assert.equal(r.code, 0, `carrier-retention ${args.join(" ")} → ${r.stderr}`);
  }
  assert.deepEqual(snapshotTree(root), before, "a disabled workspace must be byte-for-byte unchanged");
});

test("--dry-run prints the planned segments AND bytes per carrier without writing", async () => {
  const root = mkroot();
  for (const c of ROUND_CARRIERS) writeCarrier(root, c, makeLines(20, { carrier: c }));
  const before = snapshotTree(root);
  const r = await runCli(["--root", root, "--dry-run", "--live-max-bytes", "512"]);
  assert.equal(r.code, 0, r.stderr);
  for (const c of ROUND_CARRIERS) assert.match(r.stdout, new RegExp(c.replace(/\./g, "\\.")), `plan must name ${c}`);
  assert.match(r.stdout, /→ .*segment \d+ B \/ \d+ lines, tail \d+ B/);
  assert.deepEqual(snapshotTree(root), before, "--dry-run must write nothing at all");
});

test("alignment: a window with no newline returns -1, never 0 (the production failure mode)", () => {
  // 硬规则 3b in miniature. Measured 2026-10-13: `.quay/meta-driver-round.jsonl` averages ~65 KB per
  // record, so a fixed-width backward window routinely contains NO newline. Returning 0 there would
  // claim "the file starts here" and hand back an offset that is not a line start — the caller would
  // then cut MID-RECORD, or (as it did before this test existed) refuse every such carrier.
  assert.equal(lineStartAtOrBefore(Buffer.from("a".repeat(100)), 100), -1, "no newline in the buffer ⇒ -1");
  assert.equal(lineStartAtOrBefore(Buffer.from("abc\ndef\n"), 8), 8);
  assert.equal(lineStartAtOrBefore(Buffer.from("abc\ndef\n"), 5), 4);
  assert.equal(lineStartAtOrBefore(Buffer.from("\nxyz"), 1), 1);
});

test("alignment: a single record longer than the scan window is still archived on a real boundary", async () => {
  const root = mkroot();
  const carrier = "meta-driver-round.jsonl";
  // One 200 KB record (wider than the 64 KB first scan window), then short ones.
  const huge = JSON.stringify({ round: 1, ts: "2026-01-01T00:00:00.000Z", blob: "x".repeat(200_000) });
  const rest = makeLines(6, { first: 2 });
  const livePath = writeCarrier(root, carrier, [huge, ...rest]);
  const original = fs.readFileSync(livePath);

  const p = planCarrier(root, carrier, POLICY({ liveMaxBytes: 300 }), Date.now());
  assert.equal(p.rotate, true, "a long record must not make the carrier un-archivable");
  assert.ok(p.headBytes > huge.length, "the 200 KB record lies WHOLLY inside the archived prefix");
  assert.equal(fs.readFileSync(livePath).subarray(p.headBytes - 1, p.headBytes).toString(), "\n",
    "the cut sits on a real line start, not mid-record");
  assert.deepEqual(
    fs.readFileSync(livePath, "utf8").slice(0, p.headBytes).split("\n").filter((l) => l.trim())[0],
    huge, "the archived prefix's first record is the huge one, intact");
  assert.equal(p.headLines + fs.readFileSync(livePath, "utf8").slice(p.headBytes).split("\n").filter((l) => l.trim()).length, 7,
    "every record is on exactly one side of the cut");

  await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxBytes: 300 }) });
  assert.equal(Buffer.compare(allBytesAfter(root, carrier, livePath), original), 0);
});

test("planCarrier on a DISABLED policy reports the reason rather than a plan (no fabricated rotation)", () => {
  const root = mkroot();
  const livePath = writeCarrier(root, "goal-round.jsonl", makeLines(30));
  const p = planCarrier(root, "goal-round.jsonl", POLICY({ enabled: false, liveMaxBytes: 100 }), Date.now());
  assert.equal(p.rotate, false);
  assert.match(p.reason, /disabled/);
  assert.equal(fs.readFileSync(livePath, "utf8").split("\n").filter((l) => l.trim()).length, 30);
});

test("live_max_days keeps unparseable / undated lines (fail-closed: 'cannot tell' never archives)", async () => {
  const root = mkroot();
  const carrier = "worker-round.jsonl";
  const old = JSON.stringify({ round: 1, ts: "2020-01-01T00:00:00.000Z" });
  const undated = JSON.stringify({ round: 2, no_ts_here: true });
  const fresh = JSON.stringify({ round: 3, ts: new Date().toISOString() });
  writeCarrier(root, carrier, [old, undated, fresh]);

  const p = planCarrier(root, carrier, POLICY({ liveMaxDays: 1 }), Date.now());
  assert.equal(p.rotate, true, "the 2020 line is archivable");
  assert.equal(p.headLines, 1, "BOTH the undated line and the fresh line must be KEPT");

  await archiveCarrier({ root, carrier, policy: POLICY({ liveMaxDays: 1 }) });
  // The KEPT side is the live tail (readAllRecords would, correctly, give back the whole history).
  const kept = fs.readFileSync(carrierPath(root, carrier), "utf8").split("\n").filter((l) => l.trim());
  assert.equal(kept.length, 2, "exactly the two lines we must keep stay live");
  assert.equal(kept.includes(undated), true, "an undated line is never archived away");
  assert.equal(kept.includes(fresh), true);
  assert.deepEqual(readAllRecords(carrierPath(root, carrier)).lines, [old, undated, fresh],
    "while the read-through still carries the whole history, including the archived 2020 line");
});

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", RETENTION_CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}
