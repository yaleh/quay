// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-10-09 real npm pack + npm install of this package into a temp consumer, proving the quay/dashboard-kernel publish surface resolves from OUTSIDE packages/quay
// dashboard-kernel.test.mjs — gap-dashboard-kernel-export-for-cross-project-reuse.
//
// The published half of the "Loop pulse" gantt (`quay/dashboard-kernel`, src/dashboard-kernel.ts) is
// quay's FIRST public API commitment to an external package consumer (claudecodeui's Quay tab). These
// tests pin the three things that commitment consists of:
//
//   AC3 — the kernel's own behaviour: greedy lane packing order, the fixed-5-lane cap + overflow
//         count, window filtering, and the cross-source dedup key.
//   AC4 — the versioned cross-project equivalence vector (src/dashboard-kernel-vectors.json) replays
//         byte-identically against this implementation, so the artifact a consumer is told to trust
//         cannot silently rot away from the code it describes.
//   AC1 — the PUBLISH SURFACE itself: this package is really `npm pack`ed and really `npm install`ed
//         into a directory OUTSIDE packages/quay, and a bare `import ... from "quay/dashboard-kernel"`
//         is resolved and CALLED there. `import "../src/dashboard-kernel.ts"` (which the AC3 tests
//         below use) proves nothing about the publish surface — the exports map is what is under test.
//
// LOAD-SENSITIVE (real-install family, kind `real-install`): the AC1 test runs a real npm pack +
// npm install, so this file is routed to the concurrency-1 serial phase. Classification and the
// entry record above follow the family discipline in plugin/scripts/known-load-sensitive.ts.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  FIXED_GANTT_LANES,
  LIVE_INTERVAL_FINAL_STATES,
  LIVE_INTERVAL_PHASES,
  mergeLiveAndHistoryIntervals,
  packLanes,
} from "../src/dashboard-kernel.ts";
import { buildDashboardKernel } from "../scripts/build-dist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const VECTORS_PATH = path.join(pkgDir, "src", "dashboard-kernel-vectors.json");

const HOUR_MS = 3_600_000;
const NOW_MS = 1_700_000_000_000;

/** A LiveGanttInterval with every non-timing field defaulted — keeps the packing tests about packing. */
function iv(taskId, startMs, endMs, extra = {}) {
  return { taskId, runId: `run-${taskId}`, startMs, endMs, phase: null, finalState: null, fanInOutcome: null, ...extra };
}

// ── AC3: the kernel's own published behaviour ──────────────────────────────────────────────────────

test("AC3: packLanes sorts by startMs and reuses the earliest lane whose previous interval has ended", () => {
  // Deliberately NOT start-ordered on the way in: `a` and `c` do not overlap (they share lane 0);
  // `b` straddles them and needs its own lane.
  const a = iv("a", 0, 10);
  const b = iv("b", 5, 15);
  const c = iv("c", 12, 20);

  const { lanes, overflow } = packLanes([c, b, a]);

  assert.equal(overflow, 0);
  assert.deepEqual(lanes.map((lane) => lane.map((x) => x.taskId)), [["a", "c"], ["b"]],
    "startMs order decides assignment: a(0) then c(12) reuse lane 0; b(5) straddles both and takes lane 1");
});

test("AC3: packLanes caps at FIXED_GANTT_LANES and reports the excess as overflow — never clips, never drops", () => {
  // 7 simultaneous runs, window far from the cap: 5 lanes get exactly one each, the 2 leftovers are
  // COUNTED. If this ever index-clipped instead, `lanes` would still be 5 long but overflow would be
  // 0 and the two extra runs would vanish from every visible surface.
  const seven = Array.from({ length: 7 }, (_, i) => iv(`s${i}`, 1_000, 2_000));
  const { lanes, overflow } = packLanes(seven, FIXED_GANTT_LANES);

  assert.equal(FIXED_GANTT_LANES, 5, "the lane count is the dashboard's fixed visual contract");
  assert.equal(lanes.length, FIXED_GANTT_LANES);
  assert.equal(overflow, 2, "exactly the runs past the cap are counted, not swallowed");
  assert.equal(lanes.reduce((n, lane) => n + lane.length, 0) + overflow, seven.length,
    "every input interval is either packed onto a lane or counted as overflow — none disappears");
  for (const lane of lanes) assert.equal(lane.length, 1, "simultaneous runs cannot share a lane");
});

test("AC3: mergeLiveAndHistoryIntervals drops history that ended before the window and in-flight that starts after now", () => {
  const windowStartMs = NOW_MS - 3 * HOUR_MS;
  const inFlight = [
    { taskId: "live-in-window", runId: "r1", startedAtMs: NOW_MS - 30 * 60_000, phase: "implementing" },
    // Starts in the FUTURE relative to `now` — not a run in this window.
    { taskId: "live-future", runId: "r2", startedAtMs: NOW_MS + HOUR_MS, phase: "implementing" },
  ];
  const records = [
    { task: "hist-in-window", run_id: "r3", started_at: iso(NOW_MS - 2 * HOUR_MS), ended_at: iso(NOW_MS - HOUR_MS), final_state: "completed", mechanical_fan_in: { outcome: "merged" } },
    // ENDED before windowStartMs — outside the window, so absent even though it is a real run.
    { task: "hist-too-old", run_id: "r4", started_at: iso(NOW_MS - 10 * HOUR_MS), ended_at: iso(NOW_MS - 9 * HOUR_MS), final_state: "failed", mechanical_fan_in: null },
  ];

  const merged = mergeLiveAndHistoryIntervals(inFlight, records, windowStartMs, NOW_MS);

  assert.deepEqual(merged.map((x) => x.taskId), ["live-in-window", "hist-in-window"],
    "only the in-window entries survive; the pre-window history and the future in-flight are both filtered out");
  assert.equal(merged[0].endMs, NOW_MS, "an in-flight interval is left OPEN — it ends at `now`");
  assert.equal(merged[1].endMs, Date.parse(records[0].ended_at), "a historical interval ends at its recorded ended_at");
});

test("AC3: mergeLiveAndHistoryIntervals dedups on (taskId, startMs) — in-flight wins — and never merges distinct tasks that share a run_id", () => {
  const windowStartMs = NOW_MS - 3 * HOUR_MS;
  const shared = NOW_MS - 30 * 60_000;
  const inFlight = [{ taskId: "dup", runId: "round-shared", startedAtMs: shared, phase: "implementing" }];
  const records = [
    // The SAME run, already on the outcome carrier: must collapse to the in-flight interval.
    { task: "dup", run_id: "round-shared", started_at: iso(shared), ended_at: iso(NOW_MS - 10 * 60_000), final_state: "completed", mechanical_fan_in: { outcome: "merged" } },
    // Two DISTINCT tasks in the SAME driver round (run_id is the driver-process round id, shared by
    // every task that lifetime) — deduping on run_id would collapse these; both must survive
    // (gap-dashboard-gantt-runid-dedup-collapses-driver-round-shared-id).
    { task: "peer-a", run_id: "round-shared", started_at: iso(NOW_MS - 50 * 60_000), ended_at: iso(NOW_MS - 40 * 60_000), final_state: "completed", mechanical_fan_in: null },
    { task: "peer-b", run_id: "round-shared", started_at: iso(NOW_MS - 45 * 60_000), ended_at: iso(NOW_MS - 35 * 60_000), final_state: "completed", mechanical_fan_in: null },
  ];

  const merged = mergeLiveAndHistoryIntervals(inFlight, records, windowStartMs, NOW_MS);

  assert.deepEqual(merged.map((x) => `${x.taskId}@${x.startMs}`).sort(), [
    `dup@${shared}`,
    `peer-a@${NOW_MS - 50 * 60_000}`,
    `peer-b@${NOW_MS - 45 * 60_000}`,
  ], "the shared run collapses to one interval; the two peer tasks sharing its run_id both survive");

  const dup = merged.find((x) => x.taskId === "dup");
  assert.equal(dup.phase, "implementing", "the in-flight side wins the dedup, so the open phase survives");
  assert.equal(dup.endMs, NOW_MS, "…and so does its open end");
  assert.equal(dup.finalState, null, "the historical terminal state is NOT copied onto the in-flight interval");
});

// ── AC4: the versioned cross-project equivalence vector ────────────────────────────────────────────

test("AC4: the versioned equivalence vector replays exactly (the artifact a consumer is handed describes the shipped behaviour)", () => {
  const doc = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8"));

  assert.equal(doc.schemaVersion, 1, "the vector carries a schema version so a consumer can detect an incompatible revision");
  assert.equal(doc.contract, "quay/dashboard-kernel");
  assert.ok(Array.isArray(doc.vectors) && doc.vectors.length >= 3, "the vector must cover packing, overflow and window filtering");
  assert.equal(new Set(doc.vectors.map((v) => v.name)).size, doc.vectors.length, "vector names are unique (they are the consumer's failure labels)");

  for (const v of doc.vectors) {
    const merged = mergeLiveAndHistoryIntervals(
      v.input.inFlight,
      v.input.records,
      v.input.windowStartMs,
      v.input.nowMs,
    );
    assert.deepEqual(merged, v.expectedMerged, `[${v.name}] merged intervals drifted from the published vector`);
    assert.deepEqual(packLanes(merged), v.expectedLanes, `[${v.name}] lane packing drifted from the published vector`);
  }
});

test("AC4: the vector's own inputs exercise every published state value", () => {
  const doc = JSON.parse(fs.readFileSync(VECTORS_PATH, "utf8"));
  const seen = new Set();
  for (const v of doc.vectors) {
    for (const x of v.expectedMerged) {
      if (x.phase != null) seen.add(`phase:${x.phase}`);
      if (x.finalState != null) seen.add(`final:${x.finalState}`);
    }
  }
  assert.ok(seen.has(`phase:${LIVE_INTERVAL_PHASES.find((p) => p === "implementing")}`),
    "the vector must show an in-flight phase, the half of the state vocabulary a consumer colours by phase");
  assert.ok(seen.has(`final:${LIVE_INTERVAL_FINAL_STATES.find((s) => s === "completed")}`),
    "…and a historical terminal state, the half it colours by outcome");
});

test("AC4: the state vocabulary the kernel publishes matches the union types it declares", () => {
  assert.deepEqual([...LIVE_INTERVAL_PHASES], ["implementing", "fan-in", "awaiting-land", "landed"]);
  assert.deepEqual([...LIVE_INTERVAL_FINAL_STATES], ["completed", "failed", "killed", "timed-out", "exited-not-landed"]);
});

// ── AC1: the publish surface, from OUTSIDE the package ─────────────────────────────────────────────

let tmpRoot = null;
let consumerDir = null;
let probeOut = null;

/** The consumer script. It runs with cwd = the temp consumer dir (so `quay` resolves through that
 *  dir's node_modules), imports the subpath by BARE SPECIFIER, calls it, and reports both the result
 *  and WHERE the module was resolved from — the second half is the actual publish-surface evidence. */
const PROBE = `import { FIXED_GANTT_LANES, LIVE_INTERVAL_PHASES, mergeLiveAndHistoryIntervals, packLanes } from "quay/dashboard-kernel";
const nowMs = 1700000000000;
const merged = mergeLiveAndHistoryIntervals(
  [{ taskId: "probe-task", runId: "probe-run", startedAtMs: nowMs - 600000, phase: "implementing" }],
  [],
  nowMs - 3 * 3600000,
  nowMs,
);
const { lanes, overflow } = packLanes(merged);
console.log(JSON.stringify({
  resolvedFrom: import.meta.resolve("quay/dashboard-kernel"),
  fixedLanes: FIXED_GANTT_LANES,
  phases: [...LIVE_INTERVAL_PHASES],
  mergedTaskIds: merged.map((x) => x.taskId),
  lanes: lanes.map((lane) => lane.map((x) => x.taskId)),
  overflow,
}));
`;

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-dashboard-kernel-publish-"));
  const packDir = path.join(tmpRoot, "pack");
  fs.mkdirSync(packDir, { recursive: true });

  // Build into a COPY of the package, never packages/quay/dist/ itself: that path is a SHARED build
  // artifact (scripts/test.sh's test-isolation contract), and every other test that needs a dist
  // builds into its own temp dir for the same reason. The copy is what gets packed, so the artifact
  // under test is still produced by the package's REAL build entrypoint.
  const copyDir = path.join(tmpRoot, "pkg");
  fs.cpSync(pkgDir, copyDir, { recursive: true });
  fs.rmSync(path.join(copyDir, "dist"), { recursive: true, force: true });
  // The package's tsconfig `extends` the repo root's, which does not exist beside the copy —
  // esbuild warns about it (harmless, but this suite's log is read for real esbuild failures).
  fs.rmSync(path.join(copyDir, "tsconfig.json"), { force: true });
  await buildDashboardKernel({
    entry: path.join(copyDir, "src", "dashboard-kernel.ts"),
    outfile: path.join(copyDir, "dist", "dashboard-kernel.js"),
  });

  // Real pack of that built tree — the exact file set an external consumer would receive.
  const packed = JSON.parse(
    execFileSync("npm", ["pack", copyDir, "--pack-destination", packDir, "--json"], {
      encoding: "utf8",
      cwd: tmpRoot,
      timeout: 240_000,
    }),
  );
  const tarball = path.join(packDir, packed[0].filename);

  // Real install into a directory that is NOT inside packages/quay. `--ignore-scripts` skips the
  // package's postinstall (register-plugin.mjs); it is irrelevant to this subpath and we do not want
  // a test touching the developer's Claude Code settings.
  consumerDir = path.join(tmpRoot, "consumer");
  fs.mkdirSync(consumerDir, { recursive: true });
  execFileSync("npm", ["install", "--prefix", consumerDir, tarball, "--no-save", "--no-audit", "--no-fund", "--ignore-scripts", "--prefer-offline"], {
    encoding: "utf8",
    cwd: consumerDir,
    timeout: 240_000,
  });

  const probePath = path.join(consumerDir, "probe.mjs");
  fs.writeFileSync(probePath, PROBE, "utf8");
  probeOut = JSON.parse(
    execFileSync("node", [probePath], { encoding: "utf8", cwd: consumerDir, timeout: 60_000 }),
  );
});

after(() => {
  if (tmpRoot != null) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test("AC1: a bare `quay/dashboard-kernel` import resolves and runs from a real install OUTSIDE packages/quay", () => {
  const resolved = probeOut.resolvedFrom;

  assert.ok(resolved.includes(`${path.sep}node_modules${path.sep}quay${path.sep}`),
    `the subpath must resolve through an installed node_modules/quay, got: ${resolved}`);
  assert.ok(!resolved.startsWith(`${pkgDir}${path.sep}`),
    `the module must come from the INSTALLED copy, not this checkout's src/ — got: ${resolved}`);
  // The runtime target is the BUILT .js, never the .ts source: Node refuses to strip TypeScript
  // under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so a `.ts` subpath would
  // resolve in-repo and fail for every genuinely external consumer. If this assertion regresses to
  // `.ts`, the subpath is unusable outside the monorepo's workspaces symlink even though the test
  // that packs and installs it would still "pass" everywhere except here.
  assert.ok(resolved.endsWith(path.join("dist", "dashboard-kernel.js")),
    `the exports map must point at the built JS bundle, got: ${resolved}`);
});

test("AC1: the externally imported kernel returns the same packing as the in-repo module", () => {
  assert.equal(probeOut.fixedLanes, FIXED_GANTT_LANES);
  assert.deepEqual(probeOut.phases, [...LIVE_INTERVAL_PHASES]);
  assert.deepEqual(probeOut.mergedTaskIds, ["probe-task"]);
  assert.deepEqual(probeOut.lanes, [["probe-task"]], "a single in-flight run packs onto lane 0");
  assert.equal(probeOut.overflow, 0);
});

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────

/** Epoch ms → the ISO-8601 shape the worker-outcome carrier writes (`started_at`/`ended_at`). */
function iso(ms) {
  return new Date(ms).toISOString();
}
