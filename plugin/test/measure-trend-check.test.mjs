// @test-group engine
// measure-trend-check.test.mjs — AC1/AC2/AC3 of
// gap-single-file-test-duration-trend-unwatched: the append-only per-file duration
// history (.quay/measure-history.jsonl) that makes single-file duration GROWTH watchable
// round over round, instead of "can measure but doesn't watch".
//
// The mechanism REUSES measure-suite-reporter.mjs's `__PERFILE__` output (AC3 — no new
// measurer): scripts/test.sh already loads the reporter into every real-suite node --test
// run and full-suite-runner.ts tees the suite output to .quay/full-suite.log, so the
// trend-check only PARSES the reporter's lines that are already in the log.
//
// Coverage:
//   AC1 — landMeasureHistory appends one {file, duration_ms} record per test file as a new
//         append-only round, and is IDEMPOTENT (a second land over the same log is a no-op —
//         no duplicated round).
//   AC2 — compareLastTwoRounds reports a single file whose duration grew past baseline
//         (relative >2× OR absolute >+30 s) with the file + growth amount; NO growth ⇒ NO
//         report (no false positive).
//   AC3 — the history is built from measure-suite-reporter's __PERFILE__ lines (the parser
//         regex matches the reporter's exact line shape); no separate measurer is built.
//   Wiring — full-suite-runner.ts lands the history after a suite that emitted __PERFILE__
//         lines (an e2e fake-suite proof that the "套件后接 measure-history" touch is live).
//
// Run:
//   scripts/test.sh plugin/test/measure-trend-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parsePerFileLines,
  normalizePerFileKey,
  computeLogDigest,
  readHistoryRounds,
  landMeasureHistory,
  compareLastTwoRounds,
  DEFAULT_RELATIVE_FACTOR,
  DEFAULT_ABSOLUTE_MS,
} from "../scripts/measure-trend-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TREND_CHECK = path.join(REPO_ROOT, "plugin", "scripts", "measure-trend-check.ts");
const RUNNER = path.join(REPO_ROOT, "plugin", "scripts", "full-suite-runner.ts");

/** Synthetic measure-suite-reporter log text (the EXACT __PERFILE__ line shape). */
function fakeLog(entries) {
  return entries
    .map(([file, durationMs, passed = true]) => `__PERFILE__ duration_ms=${durationMs} ${file} passed=${passed}`)
    .join("\n") + "\n";
}

function waitExit(child) {
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
}

test("AC3 — parsePerFileLines matches measure-suite-reporter's __PERFILE__ line shape only", () => {
  const log =
    "__PERFILE__ duration_ms=275.156896 /repo/a.test.mjs passed=true\n" +
    "__PERFILE__ duration_ms=1000.5 /repo/b.test.mjs passed=false\n" +
    "not ok 1 - a normal failure line is not a duration record\n" +
    "# tests 5\n";
  const recs = parsePerFileLines(log);
  assert.equal(recs.length, 2, "only the two __PERFILE__ lines parse as records");
  assert.deepEqual(recs[0], { file: "/repo/a.test.mjs", durationMs: 275.156896, passed: true });
  assert.deepEqual(recs[1], { file: "/repo/b.test.mjs", durationMs: 1000.5, passed: false });
  // Duration must be > 0 (a crashed/0-ms file is not a comparable measurement).
  assert.equal(parsePerFileLines("__PERFILE__ duration_ms=0 /repo/x.test.mjs passed=false\n").length, 0);
});

test("gap-test-detail-timeline AC1 — parsePerFileLines extracts end_ms → endedAtMs + back-computed startedAtMs (and tolerates legacy lines without end_ms)", () => {
  const log =
    "__PERFILE__ duration_ms=210.5 /repo/slow.test.mjs passed=false end_ms=1724000000123\n" +
    "__PERFILE__ duration_ms=12.25 /repo/fast.test.mjs passed=true\n";
  const recs = parsePerFileLines(log);
  assert.equal(recs.length, 2, "both lines parse");
  // end_ms present ⇒ both time fields land, start = end − duration.
  const slow = recs.find((r) => r.file === "/repo/slow.test.mjs");
  assert.equal(slow.endedAtMs, 1724000000123, "endedAtMs carried verbatim from end_ms");
  assert.equal(slow.startedAtMs, 1724000000123 - 210.5, "startedAtMs = endedAtMs − durationMs (back-computed)");
  // Legacy line without end_ms ⇒ the record omits both time fields (never a fabricated 0).
  const fast = recs.find((r) => r.file === "/repo/fast.test.mjs");
  assert.equal(fast.endedAtMs, undefined, "legacy line (no end_ms) has no endedAtMs");
  assert.equal(fast.startedAtMs, undefined, "legacy line (no end_ms) has no startedAtMs");
});

test("gap-fan-in-suite-log-cross-relaunch-reuse — parsePerFileLines slices by the last __FANIN_SUITE_START__ marker (current round only, no stale-old-round read)", () => {
  // A fan-in relaunch rotates the log: old round (marker round=full) then current round (marker round=full).
  // The parser must read ONLY the current (last-marker) round's __PERFILE__ lines — the old round's
  // `passed=false` must NOT leak into the current-round records.
  const log =
    "__FANIN_SUITE_START__ iso=2026-08-19T00:00:00.000Z ms=100 head=old round=full\n" +
    "__PERFILE__ duration_ms=275.1 /repo/old.test.mjs passed=false\n" +
    "__FANIN_SUITE_START__ iso=2026-08-19T00:10:00.000Z ms=600 head=new round=full\n" +
    "__PERFILE__ duration_ms=120.5 /repo/cur.test.mjs passed=true\n" +
    "__PERFILE__ duration_ms=42.2 /repo/cur2.test.mjs passed=false\n";
  const recs = parsePerFileLines(log);
  assert.deepEqual(
    recs.map((r) => [r.file, r.passed]),
    [
      ["/repo/cur.test.mjs", true],
      ["/repo/cur2.test.mjs", false],
    ],
    "only the last-marker round's records are parsed; the stale old-round passed=false is excluded",
  );
  // No marker ⇒ whole file (backward compat with full-suite-runner direct writes / test-authored logs).
  const noMarker = parsePerFileLines("__PERFILE__ duration_ms=9 /repo/plain.test.mjs passed=true\n");
  assert.equal(noMarker.length, 1, "no marker ⇒ whole file read (backward compat)");
});

test("gap-measure-trend-check-slice-line-anchor — an inline (mid-line) mention of __FANIN_SUITE_START__ does NOT slice away the real __PERFILE__ line", () => {
  // A suite's OWN test output can mention the marker MID-LINE (e.g. the node:test description
  // "parsePerFileLines slices by the last __FANIN_SUITE_START__ marker …"). A bare lastIndexOf
  // matches that mid-line mention (the LAST occurrence) and slices from INSIDE the test run —
  // dropping the real __PERFILE__ line that precedes it (fake checker-misreport). Line-start
  // anchoring keeps the real line.
  const log =
    "__FANIN_SUITE_START__ iso=2026-08-19T00:00:00.000Z ms=100 head=cur round=full\n" +
    "__PERFILE__ duration_ms=120.5 /repo/cur.test.mjs passed=true\n" +
    "✔ parsePerFileLines slices by the last __FANIN_SUITE_START__ marker (current round only)\n";
  const recs = parsePerFileLines(log);
  assert.deepEqual(
    recs.map((r) => [r.file, r.passed]),
    [["/repo/cur.test.mjs", true]],
    "the real __PERFILE__ line is retained despite a mid-line marker mention AFTER it",
  );
});

test("constraint 6 — normalizePerFileKey strips the verify-round worktree root (same file across rounds keys once)", () => {
  // The same physical test file under two different per-task worktree roots MUST map to ONE key
  // (basename 归一 — gap-phase-overlap-two-phase-parallel-exploration constraint 6; 1179 full-path
  // "files" vs ~360 real). The key keeps package context (repo-root-relative), so `cli.test.mjs` in
  // packages/quay and packages/quay-github do NOT collide (measure-suite-reporter.mjs:156).
  assert.equal(
    normalizePerFileKey("/home/yale/work/quay-worktrees/gap-aaa-1a2b3c/packages/quay/test/cli.test.mjs"),
    "packages/quay/test/cli.test.mjs",
  );
  assert.equal(
    normalizePerFileKey("/home/yale/work/quay-worktrees/gap-bbb-9z8y7x/packages/quay/test/cli.test.mjs"),
    "packages/quay/test/cli.test.mjs",
  );
  assert.equal(
    normalizePerFileKey("/home/yale/work/quay-worktrees/gap-ccc-000/packages/quay-github/test/cli.test.mjs"),
    "packages/quay-github/test/cli.test.mjs",
    "same basename in another package stays distinct",
  );
  // A path already outside any worktree (shared-checkout dev run) is returned unchanged.
  assert.equal(normalizePerFileKey("/home/yale/work/quay/packages/quay/test/a.test.mjs"), "/home/yale/work/quay/packages/quay/test/a.test.mjs");
  // The parser applies the normalization, so a landed history record carries the stable key.
  const recs = parsePerFileLines(
    "__PERFILE__ duration_ms=120 /home/yale/work/quay-worktrees/gap-aaa-1a2b3c/packages/quay/test/a.test.mjs passed=true\n",
  );
  assert.deepEqual(recs, [{ file: "packages/quay/test/a.test.mjs", durationMs: 120, passed: true }]);
});

test("AC3 — computeLogDigest is order-independent and content-sensitive", () => {
  const a = [
    { file: "/b.test.mjs", durationMs: 10, passed: true },
    { file: "/a.test.mjs", durationMs: 20, passed: true },
  ];
  const b = [
    { file: "/a.test.mjs", durationMs: 20, passed: true },
    { file: "/b.test.mjs", durationMs: 10, passed: true },
  ];
  assert.equal(computeLogDigest(a), computeLogDigest(b), "same set ⇒ same digest regardless of order");
  const c = [
    { file: "/a.test.mjs", durationMs: 20, passed: true },
    { file: "/b.test.mjs", durationMs: 11, passed: true },
  ];
  assert.notEqual(computeLogDigest(a), computeLogDigest(c), "a duration change ⇒ a different digest");
});

test("AC1 — landMeasureHistory appends an append-only round and is idempotent over the same log", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mtc-land-"));
  try {
    const historyFile = path.join(dir, "measure-history.jsonl");
    const logFile = path.join(dir, "full-suite.log");
    const log = fakeLog([
      ["/a.test.mjs", 100.5],
      ["/b.test.mjs", 250],
    ]);
    writeFileSync(logFile, log, "utf8");

    const first = landMeasureHistory({ historyFile, logFile, laneCount: 8, runAt: "2026-08-08T00:00:00.000Z" });
    assert.equal(first.landed, true, "first land appends a round");
    assert.equal(first.round, 1);
    assert.equal(first.files, 2);

    const second = landMeasureHistory({ historyFile, logFile, laneCount: 8, runAt: "2026-08-08T00:00:01.000Z" });
    assert.equal(second.landed, false, "same log ⇒ idempotent no-op");
    assert.equal(second.reason, "duplicate-log");

    const lines = readFileSync(historyFile, "utf8").trim().split("\n");
    assert.equal(lines.length, 2, "exactly 2 lines (one per file), never duplicated");
    const rounds = readHistoryRounds(historyFile);
    assert.equal(rounds.length, 1, "one round after one distinct log");

    // A DIFFERENT log (durations changed) lands as round 2 — the append-only trend source.
    const log2 = fakeLog([
      ["/a.test.mjs", 100.5],
      ["/b.test.mjs", 999],
    ]);
    writeFileSync(logFile, log2, "utf8");
    const third = landMeasureHistory({ historyFile, logFile, laneCount: 8, runAt: "2026-08-08T00:00:02.000Z" });
    assert.equal(third.landed, true, "a changed log lands the NEXT round");
    assert.equal(third.round, 2);
    assert.equal(readHistoryRounds(historyFile).length, 2, "two rounds total");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — landMeasureHistory skips a log with no __PERFILE__ lines (no empty round)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mtc-empty-"));
  try {
    const historyFile = path.join(dir, "measure-history.jsonl");
    const logFile = path.join(dir, "full-suite.log");
    writeFileSync(logFile, "# tests 1\n# pass 1\n", "utf8");
    const res = landMeasureHistory({ historyFile, logFile });
    assert.equal(res.landed, false);
    assert.equal(res.reason, "no-perfile-lines");
    assert.equal(existsSync(historyFile), false, "no history file written for an empty log");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — compareLastTwoRounds reports a single-file duration doubling (file + growth amount)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mtc-cmp-"));
  try {
    const historyFile = path.join(dir, "measure-history.jsonl");
    const logFile = path.join(dir, "full-suite.log");
    // round 1: a.test = 10s (LARGE — relative threshold applies), b.test = 100s (large),
    //          small.test = 300ms (small — relative exempt, gap-measure-trend-... AC2)
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 10_000], ["/b.test.mjs", 100_000], ["/small.test.mjs", 300]]), "utf8");
    landMeasureHistory({ historyFile, logFile, laneCount: 8, runAt: "2026-08-08T00:00:00.000Z" });
    // round 2: a.test grows 10s→30s (3× relative, large baseline); b.test grows 100s→140s
    //          (+40s absolute); small.test grows 300→800ms (2.7× relative BUT small baseline —
    //          must NOT flag, this is the round-172 load-noise class); c.test is NEW.
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 30_000], ["/b.test.mjs", 140_000], ["/small.test.mjs", 800], ["/c.test.mjs", 5]]), "utf8");
    landMeasureHistory({ historyFile, logFile, laneCount: 8, runAt: "2026-08-08T00:00:01.000Z" });

    const growth = compareLastTwoRounds(historyFile);
    assert.equal(growth.length, 2, "a.test (3× relative, large) and b.test (+40s absolute) reported; small.test (2.7× but small) exempted");
    const byFile = new Map(growth.map((g) => [g.file, g]));

    const a = byFile.get("/a.test.mjs");
    assert.ok(a, "a.test reported");
    assert.equal(a.prevMs, 10_000);
    assert.equal(a.currMs, 30_000);
    assert.equal(a.growthMs, 20_000);
    assert.equal(a.reason, "relative", "3× relative on a LARGE baseline ⇒ relative threshold");
    assert.ok(Math.abs(a.ratio - 3) < 1e-9);

    const b = byFile.get("/b.test.mjs");
    assert.ok(b, "b.test reported");
    assert.equal(b.growthMs, 40_000);
    assert.equal(b.reason, "absolute", "+40s > +30s ⇒ absolute threshold");
    assert.ok(!byFile.has("/c.test.mjs"), "new file with no baseline is not compared");
    assert.ok(!byFile.has("/small.test.mjs"), "small test (300→800ms, 2.7×) must NOT flag — load noise (gap-measure-trend-load-noise-false-positive AC2)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2/Control — an EXACT doubling (2.0×) on a LARGE baseline is reported; a small-baseline exact doubling is NOT", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mtc-double-"));
  try {
    const historyFile = path.join(dir, "measure-history.jsonl");
    const logFile = path.join(dir, "full-suite.log");
    // a.test: LARGE baseline 10s -> 20s (exact 2.0×, large ⇒ relative trigger fires).
    // small.test: SMALL baseline 100ms -> 200ms (exact 2.0×, but small-baseline ⇒ exempt —
    // gap-measure-trend-load-noise-false-positive AC2: a 100ms test doubling is load noise, not
    // regression, so the relative trigger must NOT fire for it).
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 10_000], ["/small.test.mjs", 100]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 20_000], ["/small.test.mjs", 200]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    const growth = compareLastTwoRounds(historyFile);
    assert.equal(growth.length, 1, "only the LARGE-baseline exact doubling reported; small-baseline exempted");
    assert.equal(growth[0].file, "/a.test.mjs");
    assert.equal(growth[0].reason, "relative");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — NO growth ⇒ NO report (no false positive)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mtc-nogrowth-"));
  try {
    const historyFile = path.join(dir, "measure-history.jsonl");
    const logFile = path.join(dir, "full-suite.log");
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 1000], ["/b.test.mjs", 50_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    // round 2: a.test shrinks, b.test flat, plus a tiny 1% jitter on a third file.
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 900], ["/b.test.mjs", 50_000], ["/d.test.mjs", 100_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    // round 3: everything within noise (d.test +5%, far below 2× and +30s).
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 910], ["/b.test.mjs", 50_500], ["/d.test.mjs", 105_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });

    const growth = compareLastTwoRounds(historyFile);
    assert.equal(growth.length, 0, "shrink/flat/sub-threshold jitter must NOT be reported as growth");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2/Contract — the CLI --json output carries one 'growth' line per slow file (grep -c)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mtc-cli-"));
  try {
    const historyFile = path.join(dir, "measure-history.jsonl");
    const logFile = path.join(dir, "full-suite.log");
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 10_000], ["/b.test.mjs", 100_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 30_000], ["/b.test.mjs", 140_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });

    const res = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", TREND_CHECK, "--history", historyFile, "--json", "--no-land"],
      { encoding: "utf8" },
    );
    assert.equal(res.status, 0, `CLI exit 0; stderr: ${res.stderr}`);
    const growthLines = res.stdout.split("\n").filter((l) => l.includes("growth"));
    assert.equal(growthLines.length, 2, "one growth line per slow file (a.test 3× relative + b.test +40s absolute)");
    for (const line of growthLines) {
      const parsed = JSON.parse(line);
      assert.equal(parsed.type, "growth");
      assert.ok(parsed.growthMs > 0, "growth amount present");
    }
    // The exact Contract measure shape: grep -c 'growth' over stdout counts the slow files.
    const grep = spawnSync("grep", ["-c", "growth"], { input: res.stdout, encoding: "utf8" });
    assert.equal(Number(grep.stdout.trim()), 2, "grep -c 'growth' == number of slow files");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Wiring — full-suite-runner lands the measure-history after a suite that emitted __PERFILE__ lines", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "mtc-wire-"));
  const suite = path.join(root, "fake-suite.sh");
  try {
    const perFileLine = `__PERFILE__ duration_ms=123.5 ${path.join(root, "suite.test.mjs")} passed=true`;
    writeFileSync(
      suite,
      "#!/usr/bin/env bash\necho '" + perFileLine + "'\necho \"# tests 1\"\necho \"# pass 1\"\necho \"# fail 0\"\necho \"# cancelled 0\"\nexit 0\n",
      { mode: 0o755 },
    );
    const child = spawn(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-strip-types",
        RUNNER,
        "--root",
        root,
        "--command",
        `bash ${suite}`,
        "--lane-count",
        "4",
      ],
      {
        env: {
          ...process.env,
          QUAY_TEST_SKIP_RESOURCE_GATE: "1",
          QUAY_TEST_SKIP_SYSTEMD_RUN: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    const { code } = await waitExit(child);
    assert.equal(code, 0, "fake green suite exits 0");

    const historyFile = path.join(root, ".quay", "measure-history.jsonl");
    assert.ok(existsSync(historyFile), "AC1 wiring — .quay/measure-history.jsonl lands after the suite");
    const text = readFileSync(historyFile, "utf8");
    assert.match(text, /suite\.test\.mjs/, "the per-file record from the reporter line is in the history");
    assert.match(text, /123\.5/, "the duration_ms from the reporter line is preserved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-measure-trend-large-test-load-noise AC2/AC3: historical-variance exemption ─────────
// A LARGE test (it0-dod-check 71s baseline) that historically swings 35-110s under load must NOT
// flag on a +33s absolute excursion that stays within its OWN historical max (round-173b false
// positive). A reading that EXCEEDS the historical max is a genuine trend and still flags.

test("AC2 — large-test absolute growth WITHIN its historical max is not flagged (load noise)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mtc-hist-"));
  try {
    const historyFile = path.join(dir, "measure-history.jsonl");
    const logFile = path.join(dir, "full-suite.log");
    // rounds 1-3: it0-dod-check swings 35s → 74s → 110s (historical max 110s = load noise band).
    writeFileSync(logFile, fakeLog([["/it0-dod-check.test.mjs", 35_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    writeFileSync(logFile, fakeLog([["/it0-dod-check.test.mjs", 74_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    writeFileSync(logFile, fakeLog([["/it0-dod-check.test.mjs", 110_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    // round 4: 71s → 104s (+33s absolute > +30s, but 104s ≤ hist max 110s ⇒ within variance).
    writeFileSync(logFile, fakeLog([["/it0-dod-check.test.mjs", 104_685]]), "utf8");
    landMeasureHistory({ historyFile, logFile });

    const growth = compareLastTwoRounds(historyFile);
    assert.equal(growth.length, 0, `within-historical-max excursion must not flag: ${JSON.stringify(growth)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — large-test absolute growth EXCEEDING its historical max still flags (genuine trend)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mtc-hist2-"));
  try {
    const historyFile = path.join(dir, "measure-history.jsonl");
    const logFile = path.join(dir, "full-suite.log");
    // historical max 110s; round 4 jumps to 150s (>> hist max ⇒ genuine regression).
    writeFileSync(logFile, fakeLog([["/it0-dod-check.test.mjs", 35_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    writeFileSync(logFile, fakeLog([["/it0-dod-check.test.mjs", 110_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    writeFileSync(logFile, fakeLog([["/it0-dod-check.test.mjs", 71_066]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    writeFileSync(logFile, fakeLog([["/it0-dod-check.test.mjs", 150_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });

    const growth = compareLastTwoRounds(historyFile);
    assert.equal(growth.length, 1, "exceeding-historical-max must flag");
    assert.equal(growth[0].file, "/it0-dod-check.test.mjs");
    // 150s vs prev 71s is 2.11× (relative fires) AND > hist max 110s; either reason is the point —
    // what matters is it flags (a genuine regression past history is never suppressed).
    assert.ok(growth[0].reason === "absolute" || growth[0].reason === "relative", `flags by either threshold: ${growth[0].reason}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-measure-trend-relative-trigger-lacks-hist-variance-exemption AC2/AC3 ────────────────
// The RELATIVE ≥2× trigger lacked the withinHistMax guard the ABSOLUTE trigger had
// (d83916e4 only exempted absolute). A high-variance LARGE test returning to its OWN normal
// band after a low point was misreported as "doubling" (round-199: task-check-passthrough
// 9575→21293ms 2.22×, acceptance-env 10304→20974ms 2.04× — both ≤ their own historical max
// 23183/21445). The guard is now isomorphic across BOTH triggers: in-band ⇒ exempt;
// beyond-hist-max ⇒ still flags (real regression never suppressed).

test("AC2 — in-band relative ≥2× on a large test is NOT flagged (round-199 hist-variance scenario)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mtc-relband-"));
  try {
    const historyFile = path.join(dir, "measure-history.jsonl");
    const logFile = path.join(dir, "full-suite.log");
    // Round-199 real history shapes: each file swings to its max (round-32), dips to a low
    // point (round-35), then returns to its normal band (round-36) — the low→band hop is
    // ≥2× relative but stays within the file's own historical max ⇒ must NOT flag.
    const rounds = [
      [["/task-check-passthrough.test.mjs", 9_079], ["/acceptance-env.test.mjs", 9_166]], // min values
      [["/task-check-passthrough.test.mjs", 23_183], ["/acceptance-env.test.mjs", 21_445]], // round-32 hist max
      [["/task-check-passthrough.test.mjs", 9_575], ["/acceptance-env.test.mjs", 10_304]], // round-35 low point
      [["/task-check-passthrough.test.mjs", 21_293], ["/acceptance-env.test.mjs", 20_974]], // round-36 normal band
    ];
    for (const r of rounds) {
      writeFileSync(logFile, fakeLog(r), "utf8");
      landMeasureHistory({ historyFile, logFile });
    }

    const growth = compareLastTwoRounds(historyFile);
    assert.equal(growth.length, 0, `in-band relative ≥2× must NOT flag: ${JSON.stringify(growth)}`);
    // Sanity-check the scenario actually IS a ≥2× relative hop (else the test is vacuous).
    assert.ok(21_293 / 9_575 >= 2, "task-check-passthrough round-35→36 is ≥2× relative");
    assert.ok(20_974 / 10_304 >= 2, "acceptance-env round-35→36 is ≥2× relative");
    assert.ok(21_293 <= 23_183, "task-check-passthrough round-36 within its own hist max");
    assert.ok(20_974 <= 21_445, "acceptance-env round-36 within its own hist max");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — relative ≥2× EXCEEDING the historical max still flags (real regression not swallowed)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mtc-relband2-"));
  try {
    const historyFile = path.join(dir, "measure-history.jsonl");
    const logFile = path.join(dir, "full-suite.log");
    // hist max 16s; round 3 jumps to 33s — 2.06× relative vs prev 16s, > hist max 16s, but
    // +17s absolute is BELOW the +30s absolute threshold ⇒ only the relative trigger can fire.
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 10_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 16_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });
    writeFileSync(logFile, fakeLog([["/a.test.mjs", 33_000]]), "utf8");
    landMeasureHistory({ historyFile, logFile });

    const growth = compareLastTwoRounds(historyFile);
    assert.equal(growth.length, 1, "beyond-hist-max relative ≥2× must flag");
    assert.equal(growth[0].file, "/a.test.mjs");
    assert.equal(growth[0].reason, "relative", "flags via the RELATIVE trigger (absolute +17s < +30s would not fire)");
    assert.ok(growth[0].currMs > 16_000, "curr exceeds the file's historical max");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
