// lanes-cli.test.mjs — `quay lanes --json`, the read-only exit for the dashboard's packed gantt
// lanes (task gap-cli-lanes-json-verb-for-gantt-consumers).
//
// WHAT IS UNDER TEST: the CLI verb publishes EXACTLY what the Web card's "Loop pulse" gantt shows,
// for the same workspace at the same instant — because both run the SAME live call chain
// (observation.readLive + readWorkerOutcomeRecords) into the SAME kernel
// (dashboard-kernel.mergeLiveAndHistoryIntervals / packLanes / FIXED_GANTT_LANES).
//
// The five ACs split across two KINDS of check, deliberately:
//   • AC1/AC2/AC3/AC6 — the verb's own published shape and window/packing semantics (data supplied
//     through the real carriers: `.workflow-events/*.jsonl` + `.quay/worker-outcome.jsonl`).
//   • AC4 (the core judge) — a CROSS-READ between the CLI process and the card path computed
//     in-process over the SAME workspace. ⛔ It is not a comparison against a stored expectation:
//     both sides are computed live, in this run, by the real readers.
//   • AC5 — the control that proves AC4's comparison actually reads the kernel: the SAME comparison
//     re-run with a mutated kernel must report mismatches > 0. The mutation is applied to a COPY of
//     the CLI's module graph (never to the checked-in file — this suite runs files concurrently and
//     other tests import that module).
//
// ⛔ NO in-tree writes: every fixture lives under os.tmpdir(), so this file cannot enroll itself in
// checked-in-write-check (see plugin/scripts/checked-in-write-check.ts).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  FIXED_GANTT_LANES,
  mergeLiveAndHistoryIntervals,
  packLanes,
} from "../src/dashboard-kernel.ts";
import { readLive, readWorkerOutcomeRecords } from "../src/observation.ts";
// The window default/validator the card's `?hours=` param uses — imported (not re-typed) so this
// file cannot agree with the CLI while BOTH disagree with the card.
import { DEFAULT_TIMELINE_HOURS } from "../src/serve-dashboard.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pkgDir, "..", "..");
const CLI_ENTRY = path.join(pkgDir, "bin", "quay.ts");

const HOUR_MS = 3_600_000;

// ── temp fixtures (os.tmpdir() only) ───────────────────────────────────────────────────────────────

const _tmp = new Set();
after(() => {
  for (const dir of _tmp) fs.rmSync(dir, { recursive: true, force: true });
});

function mkTmp(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-lanes-${tag}-`));
  _tmp.add(dir);
  return dir;
}

/** A workspace is a directory carrying `.quay/config.yml` — the resolution marker
 *  (`config.ts#findConfig`); the lanes verb reads carriers, never a provider.
 *
 *  `loop.worktree_root` is declared (and deliberately left NON-EXISTENT) so the fixture is a
 *  well-formed workspace: without it `observation.resolveWorktreeNamespace` falls back and prints a
 *  diagnostic on stderr, and a missing namespace is exactly the state that keeps every in-flight run
 *  (an EXISTING namespace without a per-task dir would mark the run's worktree released and drop it). */
function makeWorkspace(tag) {
  const ws = mkTmp(tag);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers: {}\nloop:\n  worktree_root: "${path.join(ws, "worktrees")}"\n`,
  );
  return ws;
}

/** Write `.workflow-events/<day>.jsonl` in the real A1a record shape. `runs` are
 *  `{runId, taskId, startedAtMs, endedAtMs?}` — an entry with no `endedAtMs` is a START-ONLY record,
 *  i.e. a run that is still in flight (`isStartLike`). */
function writeTelemetry(ws, runs, fileName = "2026-10-10.jsonl") {
  const dir = path.join(ws, ".workflow-events");
  fs.mkdirSync(dir, { recursive: true });
  const lines = runs.map((r) =>
    JSON.stringify({
      stage: "Fast",
      eventKind: r.endedAtMs != null ? "end" : "start",
      runId: r.runId,
      taskId: r.taskId,
      timing: { startedAtMs: r.startedAtMs ?? null, endedAtMs: r.endedAtMs ?? null },
    }),
  );
  fs.writeFileSync(path.join(dir, fileName), lines.join("\n") + "\n");
}

/** Append records to `.quay/worker-outcome.jsonl` (the history carrier), real field names. */
function writeOutcomes(ws, records) {
  const file = path.join(ws, ".quay", "worker-outcome.jsonl");
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/** A closed history record. `ended_at` MUST be after `started_at`, else the kernel drops it. */
function outcome(taskId, startedAtMs, endedAtMs, finalState = "completed", fanIn = "merged") {
  return {
    ts: new Date(endedAtMs).toISOString(),
    task: taskId,
    run_id: `run-${taskId}`,
    started_at: new Date(startedAtMs).toISOString(),
    ended_at: new Date(endedAtMs).toISOString(),
    final_state: finalState,
    mechanical_fan_in: fanIn == null ? null : { outcome: fanIn },
  };
}

// ── the two paths under comparison ─────────────────────────────────────────────────────────────────

/** Spawn the real CLI. Returns the raw process result (never throws on a non-zero exit — the exit
 *  code IS one of the readings under test). */
function runLanesCli(root, extraArgs = []) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", CLI_ENTRY, "lanes", "--json", ...extraArgs, "--root", root],
    { encoding: "utf8", timeout: 180_000 },
  );
}

function lanesDocumentOf(res) {
  assert.equal(res.status, 0, `quay lanes must exit 0; got ${res.status}\nstderr: ${res.stderr}`);
  assert.equal(res.stderr, "", `quay lanes must not write to stderr on a successful read; got: ${res.stderr}`);
  let doc;
  assert.doesNotThrow(() => { doc = JSON.parse(res.stdout); }, `stdout must be valid JSON; got: ${res.stdout}`);
  return doc;
}

/** The WEB CARD PATH — the exact computation `serve-dashboard.renderLiveCard` performs for its
 *  fixed-5-lane gantt, composed here from the same three imports. `nowMs` is passed in (never
 *  re-read from the clock) so a caller can pin both sides to ONE instant.
 *  ⛔ This is NOT a re-implementation of the packing: `mergeLiveAndHistoryIntervals` / `packLanes` /
 *  `FIXED_GANTT_LANES` are the kernel itself. The only thing composed here is the card's own glue —
 *  its `live.status === "ok"` guard and its window arithmetic. */
function cardPath(root, nowMs, windowHours = DEFAULT_TIMELINE_HOURS) {
  const live = readLive(root, { nowMs });
  const intervals =
    live.status === "ok"
      ? mergeLiveAndHistoryIntervals(
          live.inFlight,
          readWorkerOutcomeRecords(root),
          nowMs - windowHours * HOUR_MS,
          nowMs,
        )
      : [];
  const { lanes, overflow } = packLanes(intervals, FIXED_GANTT_LANES);
  const padded = [...lanes];
  while (padded.length < FIXED_GANTT_LANES) padded.push([]);
  return { windowHours, nowMs, lanes: padded, overflow };
}

/** Lane-assignment mismatches between two lane documents. 0 ⇔ every lane carries the same intervals
 *  in the same order AND the overflow count agrees. A differing `nowMs`/`windowHours` is not counted
 *  here — the parity harness pins those to the CLI's own values before comparing. */
function laneMismatches(a, b) {
  let n = 0;
  if (a.overflow !== b.overflow) n++;
  n += Math.abs(a.lanes.length - b.lanes.length);
  for (let i = 0; i < Math.max(a.lanes.length, b.lanes.length); i++) {
    if (JSON.stringify(a.lanes[i] ?? null) !== JSON.stringify(b.lanes[i] ?? null)) n++;
  }
  return n;
}

/** In-flight fingerprint — used to require that the workspace did not move across a CLI spawn
 *  (a run starting/ending between the two reads would otherwise make the cross-read racy, and a
 *  racy comparison is not evidence). */
function inFlightFingerprint(root) {
  const live = readLive(root);
  return (
    live.status +
    "|" +
    live.inFlight
      .map((t) => `${t.taskId}@${t.startedAtMs}@${t.phase}`)
      .sort()
      .join(",")
  );
}

/** AC4/AC5's ONE comparison. Returns `{ mismatches, cli, card }`. */
function parity(root, windowHours = DEFAULT_TIMELINE_HOURS) {
  const res = runLanesCli(root, windowHours === DEFAULT_TIMELINE_HOURS ? [] : ["--window-hours", String(windowHours)]);
  const cli = lanesDocumentOf(res);
  const card = cardPath(root, cli.nowMs, cli.windowHours);
  return { mismatches: laneMismatches(cli, card), cli, card };
}

/** AC4 on a workspace that can move under us (the repo root): retry until the in-flight set is
 *  stable across the spawn. A run that starts or ends between the two reads makes the comparison
 *  undefined — retrying is the honest response, not widening the comparison. */
function parityStable(root) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = inFlightFingerprint(root);
    const out = parity(root);
    const after = inFlightFingerprint(root);
    if (before === after) return out;
  }
  assert.fail(`the workspace's in-flight set never held still across 8 attempts — cannot cross-read ${root}`);
}

// ── AC1: the published shape ───────────────────────────────────────────────────────────────────────

test("AC1: `quay lanes --json` exits 0 and emits {windowHours, nowMs, lanes, overflow} — exactly", () => {
  const ws = makeWorkspace("ac1");
  writeTelemetry(ws, [{ runId: "r-1", taskId: "AC1-1", startedAtMs: Date.now() - 60_000 }]);

  const doc = lanesDocumentOf(runLanesCli(ws));

  assert.deepEqual(
    Object.keys(doc).sort(),
    ["lanes", "nowMs", "overflow", "windowHours"],
    "the document carries the consumer's QuayGanttLanes keys and NOTHING else (extra or missing ⇒ its type does not describe this)",
  );
  assert.equal(typeof doc.windowHours, "number");
  assert.ok(Number.isFinite(doc.nowMs), "nowMs is the reading instant, not null/NaN");
  assert.equal(typeof doc.overflow, "number");
  assert.ok(Array.isArray(doc.lanes), "lanes is an array of lanes");

  const intervals = doc.lanes.flat();
  assert.ok(intervals.length >= 1, "the fixture must publish at least one interval for this AC to bite");
  for (const iv of intervals) {
    assert.deepEqual(
      Object.keys(iv).sort(),
      ["endMs", "fanInOutcome", "finalState", "phase", "runId", "startMs", "taskId"],
      `an interval must carry exactly the consumer's 7 fields (got: ${JSON.stringify(iv)})`,
    );
    assert.equal(typeof iv.taskId, "string");
    assert.equal(typeof iv.runId, "string");
    assert.ok(Number.isFinite(iv.startMs) && Number.isFinite(iv.endMs));
  }
});

// ── AC2: the fixed-5 lane contract ─────────────────────────────────────────────────────────────────

test("AC2: lanes.length === FIXED_GANTT_LANES always — an empty window still yields 5 reference lanes, not 0 and not 'how many are in use'", () => {
  assert.equal(FIXED_GANTT_LANES, 5, "the lane count is the dashboard's fixed visual contract");

  // (a) a window with NO records at all: `.workflow-events/` exists but no in-flight run and no history.
  const empty = makeWorkspace("ac2-empty");
  writeTelemetry(empty, []);
  const emptyDoc = lanesDocumentOf(runLanesCli(empty));
  assert.equal(emptyDoc.lanes.length, FIXED_GANTT_LANES, "an empty window STILL returns 5 lanes");
  assert.equal(emptyDoc.overflow, 0);
  assert.deepEqual(emptyDoc.lanes, [[], [], [], [], []], "…and they are empty, not fabricated intervals");

  // (b) a window with exactly ONE interval: `packLanes` opens one lane, so a verb that returned the
  //     packing verbatim would answer 1 here — the padding is what makes the count a constant.
  const one = makeWorkspace("ac2-one");
  writeTelemetry(one, [{ runId: "r", taskId: "AC2-1", startedAtMs: Date.now() - 60_000 }]);
  const oneDoc = lanesDocumentOf(runLanesCli(one));
  assert.equal(oneDoc.lanes.length, FIXED_GANTT_LANES, "one interval still publishes 5 lanes (1 used + 4 empty)");
  assert.equal(oneDoc.lanes.filter((l) => l.length > 0).length, 1, "exactly one lane carries the interval");
});

// ── AC3: overflow is counted, never dropped ────────────────────────────────────────────────────────

test("AC3: with more concurrent intervals than lanes, the excess lands in `overflow` and sum(lanes)+overflow === the input count", () => {
  const ws = makeWorkspace("ac3");
  const now = Date.now();
  const runs = Array.from({ length: 7 }, (_, i) => ({
    runId: `r-${i}`,
    taskId: `AC3-${i}`,
    startedAtMs: now - 60_000, // ALL still open at `now` ⇒ 7 simultaneous intervals
  }));
  writeTelemetry(ws, runs);

  const doc = lanesDocumentOf(runLanesCli(ws));
  const packed = doc.lanes.flat().length;

  assert.equal(doc.lanes.length, FIXED_GANTT_LANES);
  assert.equal(doc.overflow, 2, "7 simultaneous runs against a 5-lane cap ⇒ exactly 2 past the cap");
  assert.equal(packed + doc.overflow, 7, "every interval is either on a lane or counted — a dropped one breaks this");
  for (const lane of doc.lanes) assert.ok(lane.length <= 1, "simultaneous runs cannot share a lane");
});

// ── AC4: the cross-read (the core judge) ───────────────────────────────────────────────────────────

test("AC4: for one workspace at one instant, `quay lanes --json` and the Web-card path agree lane-for-lane (mismatches === 0)", () => {
  const ws = makeWorkspace("ac4");
  const now = Date.now();
  // A workspace that exercises BOTH record sources and lane REUSE (closed history reusing a freed
  // lane) plus an open in-flight run — the interesting case, not just "one bar on lane 0".
  writeTelemetry(ws, [
    { runId: "live-1", taskId: "AC4-live", startedAtMs: now - 30 * 60_000 },
  ]);
  writeOutcomes(ws, [
    outcome("AC4-h1", now - 170 * 60_000, now - 160 * 60_000),
    outcome("AC4-h2", now - 165 * 60_000, now - 155 * 60_000),
    // starts after BOTH above ended ⇒ the free-lane choice is exercised
    outcome("AC4-h3", now - 140 * 60_000, now - 130 * 60_000, "failed", "red"),
  ]);

  const { mismatches, cli, card } = parity(ws);

  assert.ok(
    cli.lanes.flat().length + cli.overflow >= 3,
    `the fixture must produce a non-trivial packing for this comparison to mean anything; got ${JSON.stringify(cli)}`,
  );
  assert.deepEqual(cli, card, `the CLI and the card path must be field-for-field identical`);
  assert.equal(mismatches, 0, `lanes_parity_mismatches must be 0, got ${mismatches}`);
});

test("AC4: the same cross-read holds against the REAL workspace this suite runs in (live carriers, no fixture)", () => {
  const { mismatches } = parityStable(repoRoot);
  assert.equal(mismatches, 0, `lanes_parity_mismatches must be 0 on the live workspace, got ${mismatches}`);
});

// ── AC5: the control — the comparison must READ the kernel ─────────────────────────────────────────

test("AC5 (control): with the kernel's lane-reuse rule perturbed, the SAME comparison reports mismatches > 0", () => {
  const ws = makeWorkspace("ac5");
  const now = Date.now();
  writeTelemetry(ws, [{ runId: "live-1", taskId: "AC5-live", startedAtMs: now - 30 * 60_000 }]);
  writeOutcomes(ws, [
    outcome("AC5-h1", now - 170 * 60_000, now - 160 * 60_000),
    outcome("AC5-h2", now - 165 * 60_000, now - 155 * 60_000),
    outcome("AC5-h3", now - 140 * 60_000, now - 130 * 60_000),
  ]);

  // Baseline: the unmutated CLI agrees with the card path.
  const baseline = parity(ws);
  assert.equal(baseline.mismatches, 0, "the control's own baseline must be 0 — a red baseline makes the control unreadable");

  // The mutant: a COPY of the CLI's module graph with ONE change to `packLanes`' lane-reuse choice
  // (earliest free lane → LAST free lane: drop the `break`). ⛔ The checked-in kernel is never
  // written — this suite runs test files concurrently and other files import that module.
  const mutant = mkTmp("ac5-mutant");
  fs.cpSync(path.join(pkgDir, "src"), path.join(mutant, "src"), { recursive: true });
  fs.cpSync(path.join(pkgDir, "bin"), path.join(mutant, "bin"), { recursive: true });
  fs.copyFileSync(path.join(pkgDir, "package.json"), path.join(mutant, "package.json"));
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(mutant, "node_modules"), "dir");
  const kernelFile = path.join(mutant, "src", "dashboard-kernel.ts");
  const pristine = fs.readFileSync(kernelFile, "utf8");
  const REUSE_RULE = "if (laneEnds[i] <= iv.startMs) { lane = i; break; }";
  assert.ok(
    pristine.includes(REUSE_RULE),
    "the control's anchor line has moved — re-derive the mutation instead of letting this control go silently vacuous",
  );
  fs.writeFileSync(kernelFile, pristine.replace(REUSE_RULE, "if (laneEnds[i] <= iv.startMs) { lane = i; }"));

  const mutantRes = runLanesCliFrom(mutant, ws);
  const mutantDoc = lanesDocumentOf(mutantRes);
  const card = cardPath(ws, mutantDoc.nowMs, mutantDoc.windowHours);
  const mismatches = laneMismatches(mutantDoc, card);

  assert.ok(
    mismatches > 0,
    `a perturbed kernel MUST break the comparison — 0 here would mean the comparison never read the kernel at all. ` +
      `mutant lanes=${JSON.stringify(mutantDoc.lanes)} overflow=${mutantDoc.overflow}`,
  );
  // …and the control is only meaningful because the perturbation actually MOVED the assignment.
  assert.notDeepEqual(mutantDoc.lanes, baseline.cli.lanes, "the mutant must differ from the baseline CLI, not just from the card");
});

/** Spawn the CLI from an arbitrary package root (used by the AC5 mutant). */
function runLanesCliFrom(pkgRoot, workspaceRoot) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(pkgRoot, "bin", "quay.ts"), "lanes", "--json", "--root", workspaceRoot],
    { encoding: "utf8", timeout: 180_000 },
  );
}

// ── AC6: --window-hours really re-filters the sources ──────────────────────────────────────────────

test("AC6: --window-hours N re-filters BOTH record sources; the default equals the card's (DEFAULT_TIMELINE_HOURS)", () => {
  assert.equal(DEFAULT_TIMELINE_HOURS, 3, "the card's default window — this verb's default must equal it");

  const ws = makeWorkspace("ac6");
  const now = Date.now();
  // One in-flight run (always inside any window) + one history record that sits BETWEEN the 1h and
  // the 3h boundaries. Nothing here is visually scaled: the record simply is or is not in the window.
  writeTelemetry(ws, [{ runId: "live-1", taskId: "AC6-live", startedAtMs: now - 5 * 60_000 }]);
  writeOutcomes(ws, [outcome("AC6-old", now - 150 * 60_000, now - 120 * 60_000)]);

  const ids = (doc) => doc.lanes.flat().map((iv) => iv.taskId).sort();

  const wide = lanesDocumentOf(runLanesCli(ws, ["--window-hours", "3"]));
  assert.deepEqual(ids(wide), ["AC6-live", "AC6-old"], "a 3h window contains the 2h-old record");
  assert.equal(wide.windowHours, 3);

  const narrow = lanesDocumentOf(runLanesCli(ws, ["--window-hours", "1"]));
  assert.deepEqual(ids(narrow), ["AC6-live"], "a 1h window EXCLUDES the record that ended 2h ago — a real re-filter");
  assert.equal(narrow.windowHours, 1);

  const dflt = lanesDocumentOf(runLanesCli(ws));
  assert.equal(dflt.windowHours, DEFAULT_TIMELINE_HOURS, "the default window is the card's");
  assert.deepEqual(ids(dflt), ids(wide), "…and it reads the same window as an explicit 3");

  // Illegal values degrade to the default (the card's own validator), never to a clamped 24.
  for (const bad of ["abc", "0", "999", "1.5", ""]) {
    const doc = lanesDocumentOf(runLanesCli(ws, ["--window-hours", bad]));
    assert.equal(doc.windowHours, DEFAULT_TIMELINE_HOURS, `--window-hours ${JSON.stringify(bad)} → default, not a clamp`);
  }
});

// ── 3b: a failed read must not wear an empty window's clothes ──────────────────────────────────────

test("hard rule 3b: an unreadable carrier exits non-zero with NO document — never 5 empty lanes", () => {
  const ws = makeWorkspace("3b");
  // `.workflow-events` as a FILE (not a directory): readLive's readdirSync throws → status "error".
  fs.writeFileSync(path.join(ws, ".workflow-events"), "not a directory\n");

  const res = runLanesCli(ws);
  assert.notEqual(res.status, 0, "a failed carrier read must not exit 0");
  assert.equal(res.stdout, "", "…and must publish NO document (5 empty lanes would read as 'the loop is idle')");
  assert.match(res.stderr, /could not be read/, "…and must say so on stderr");

  // The contrast the rule is about: a genuinely EMPTY window is exit 0 with 5 empty lanes.
  const ok = makeWorkspace("3b-ok");
  writeTelemetry(ok, []);
  const okRes = runLanesCli(ok);
  assert.equal(okRes.status, 0, "an empty window is a real reading, not an error");

  // No workspace at all is its own refusal (a distinct cause from a read failure).
  const nowhere = mkTmp("3b-nowhere");
  const none = runLanesCli(nowhere);
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /no \.quay\/config\.yml found/);
});
