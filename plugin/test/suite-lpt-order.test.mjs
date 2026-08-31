// @test-group engine
// suite-lpt-order.test.mjs — RED/GREEN tests for the M-bucket LPT ordering + run({files}) runner
// (gap-m-bucket-long-tail-lpt-scheduling).
//
// Two halves, one defect:
//   1. suite-lpt-order.ts — the ORDERING helper: reads .quay/verification-round.jsonl
//      perFile[].durationMs (rolling average of the last --rounds) and reorders longest-known-first
//      (LPT). Scheduling-only (every file emitted exactly once) + FAIL-OPEN (no history ⇒ unchanged).
//   2. suite-lpt-runner.mjs — the DELIVERY half: `node --test <file...>` re-sorts positional globs
//      alphabetically (createTestFileList → ArrayPrototypeSort) ⇒ the LPT order was being discarded.
//      run({files}) passes the array straight through ⇒ order preserved. The runner composes
//      spec→stdout and measure-suite-reporter→stderr via stream.compose (NOT --test-reporter flags).
//
// Covered here (matching the task's AC numbering):
//   - AC1 (take-false, both directions): run({files}) spawn order follows files[] — forward
//     z→m→a AND reverse a→m→z both follow (alphabetical would be a→m→z both times ⇒ red).
//   - AC2 (take-false, first-M): at concurrency M, the first M spawned files = the first M of the
//     input list (the long tests grab lanes FIRST instead of serializing at the tail).
//   - AC5 (take-false, reporter not starved): the runner's stream.compose(perFileReporter) still
//     emits __PERFILE__ duration_ms=<d> <path> passed=<bool> — the LPT ordering's OWN input carrier
//     (break it and LPT has no duration data ⇒ self-defeating).
//   - ordering helpers: repoRelKey normalization, orderByLpt LPT sort, loadDurationAverages
//     per-file rolling-average + malformed-line tolerance, fail-open on an absent carrier, and the
//     --buckets branch wiring behind QUAY_TEST_LPT_ORDER.
//   - gap-suite-lpt-lookback-not-bucket-filtered AC1-AC3 (ordering helper, cross-bucket lookback):
//     AC1 loadDurationAverages finds a P-only file's OWN history even when the last-N records are
//     all another bucket; AC2 production-replay shape (#599) reorders P-only long files ahead by
//     duration; AC3 a normal/with-full lookback still sorts descending with the a.i-b.i tiebreaker.
//
// Run:
//   scripts/test.sh plugin/test/suite-lpt-order.test.mjs
//   scripts/test.sh --for-task gap-m-bucket-long-tail-lpt-scheduling

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { repoRelKey, loadDurationAverages, orderByLpt } from "../scripts/suite-lpt-order.ts";
import { parseRunnerArgs } from "../scripts/suite-lpt-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUNNER = path.join(REPO_ROOT, "plugin", "scripts", "suite-lpt-runner.mjs");

/** Slice the `--buckets` elif branch out of scripts/test.sh (bounded by the next `elif`). */
function bucketsBranchSrc(testSh) {
  const lines = testSh.split("\n");
  const start = lines.findIndex((l) => l.includes('= "--buckets" ]'));
  assert.ok(start !== -1, "scripts/test.sh must contain the --buckets branch");
  const end = lines.findIndex((l, i) => i > start && /^elif\b/.test(l));
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

/** Write a JSONL carrier with perFile records into a temp root's .quay/ (returns the root). */
function makeRootWithCarrier(rounds) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lpt-root-"));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const carrier = path.join(root, ".quay", "verification-round.jsonl");
  const lines = rounds
    .map(
      (files) =>
        JSON.stringify({
          round: 1,
          perFile: files.map(([file, durationMs]) => ({ file, durationMs, passed: true })),
        }) + "\n",
    )
    .join("");
  fs.writeFileSync(carrier, lines);
  return root;
}

// ── synthetic scratch files (os.tmpdir(), NOT the repo — R8: a repo-rooted mkdtemp dirties the
// shared checkout; and collectTestFiles walks packages/plugin/experiments and would count a
// transient .test.mjs under plugin/test/). Each file appends "START <name>" to $SPAWN_LOG at module
// load (its FIRST statement) so the log order = the spawn order, then optionally sleeps so the
// concurrency-M first-wave stays alive while the lanes are full. ────────────────────────────────────
function makeSpawnProbeFile(dir, name, { sleepMs = 0 } = {}) {
  const sleepLine = sleepMs > 0 ? `await new Promise((r) => setTimeout(r, ${sleepMs}));` : "";
  const file = path.join(dir, `${name}.test.mjs`);
  fs.writeFileSync(
    file,
    `import { appendFileSync } from "node:fs";\n` +
      `appendFileSync(process.env.SPAWN_LOG, "START ${name}\\n");\n` +
      `${sleepLine}\n` +
      `import { test } from "node:test";\n` +
      `import assert from "node:assert/strict";\n` +
      `test("${name}", () => assert.equal(1, 1));\n`,
  );
  return file;
}

/** Spawn the runner against the given probe files (concurrency rides in execArgv, as test.sh does)
 *  and return { code, stderr, spawnLog } (spawnLog = the synthetic files' append log, one line per
 *  file in spawn order). NODE_TEST_CONTEXT is stripped so the child run() is not treated as nested. */
function runProbe(probeFiles, { concurrency, logFile }) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  childEnv.SPAWN_LOG = logFile;
  const r = spawnSync(
    process.execPath,
    [`--test-concurrency=${concurrency}`, RUNNER, ...probeFiles],
    { cwd: REPO_ROOT, encoding: "utf8", env: childEnv },
  );
  let spawnLog = "";
  try {
    spawnLog = fs.readFileSync(logFile, "utf8");
  } catch {
    // no probe file ran — leave empty so the assertion below fails loudly
  }
  return { code: r.status, stderr: r.stderr, spawnLog };
}

// ══ ordering-helper tests (suite-lpt-order.ts) ════════════════════════════════════════════════════

test("ordering — LPT wiring lives in lpt_reorder_files (suite-lpt-order.ts behind QUAY_TEST_LPT_ORDER), called by the --buckets branch", () => {
  const testSh = fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
  const branch = bucketsBranchSrc(testSh);
  // The --buckets branch hands its selected file list to the SHARED helper (single definition
  // point with the full-suite default path — gap-suite-lpt-full-bucket-run-selected), never an
  // inline copy that can drift.
  assert.match(branch, /lpt_reorder_files files/, "the --buckets branch must call lpt_reorder_files");
  // The helper itself wires suite-lpt-order.ts behind the QUAY_TEST_LPT_ORDER rollback gate.
  assert.match(testSh, /lpt_reorder_files\(\)\s*\{/, "scripts/test.sh must define lpt_reorder_files()");
  assert.match(testSh, /suite-lpt-order\.ts/, "the helper must invoke suite-lpt-order.ts");
  assert.match(testSh, /QUAY_TEST_LPT_ORDER/, "the wiring must sit behind the QUAY_TEST_LPT_ORDER rollback gate");
});

// ══ full-suite-default-path LPT wiring (gap-suite-lpt-full-bucket-run-selected) ════════════════════
// The full-suite DEFAULT path (no --buckets, and --buckets bucket_full=1) previously ran its MAIN
// body through `node --test "${files[@]}"` — the node --test CLI re-sorts positional globs
// alphabetically, so the longest-known files serialized at the tail (round #557: full-suite-runner.
// test.mjs at 242.6s sat OUTSIDE the first 10 files). The fix routes the main body through
// lpt_reorder_files + suite-lpt-runner.mjs (run({files}) preserves argv order).

test("AC1 — the full-suite default path LPT-reorders its main body and runs it order-preserving via run({files})", () => {
  const testSh = fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
  // The full path's MAIN phase must LPT-reorder `files` (longest-known-first, NOT alphabetical) and
  // hand it to suite-lpt-runner.mjs. The `bucket_test_concurrency "$@"` spelling (vs the --buckets
  // branch's `"${rest_args[@]}"`) is what pins THIS as the full-suite default path's main phase.
  assert.match(
    testSh,
    /lpt_reorder_files files\n    node --test-concurrency="\$\(bucket_test_concurrency "\$@"\)" "\$\{repo_root\}\/plugin\/scripts\/suite-lpt-runner\.mjs"/,
    "the full-suite main phase must LPT-reorder then run suite-lpt-runner.mjs (order-preserving)",
  );
});

test("AC2 — serial/lowconc phases are LPT-reordered and run order-preserving via suite-lpt-runner.mjs at their own concurrency", () => {
  const testSh = fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
  // gap-suite-lpt-serial-lowconc-phases-not-lpt-ordered: the serial/lowconc phases were the last
  // bare `node --test` dispatch points on the full path — node --test re-sorts positional args
  // alphabetically, discarding any LPT order (the serial/lowconc tail waited ≈38% of the round).
  // Each phase is now LPT-reordered IN PLACE and handed to suite-lpt-runner.mjs run({files}) (the
  // ONLY order-preserving path), at its OWN SERIAL_CONCURRENCY / LOWCONC_CONCURRENCY — concurrency
  // rides in execArgv exactly like the main body, so the phase isolation guarantee is unchanged.
  assert.match(testSh, /lpt_reorder_files serial_files/, "serial phase must be LPT-reordered");
  assert.match(testSh, /lpt_reorder_files lowconc_files/, "lowconc phase must be LPT-reordered");
  assert.match(
    testSh,
    /node --test-concurrency="\$SERIAL_CONCURRENCY" "\$\{repo_root\}\/plugin\/scripts\/suite-lpt-runner\.mjs" "\$\{serial_files\[@\]\}"/,
    "serial phase must run suite-lpt-runner.mjs at SERIAL_CONCURRENCY",
  );
  assert.match(
    testSh,
    /node --test-concurrency="\$LOWCONC_CONCURRENCY" "\$\{repo_root\}\/plugin\/scripts\/suite-lpt-runner\.mjs" "\$\{lowconc_files\[@\]\}"/,
    "lowconc phase must run suite-lpt-runner.mjs at LOWCONC_CONCURRENCY",
  );
});

test("ordering — orderByLpt sorts longest-known-first and keeps unknowns at the END in original order", () => {
  const root = "/home/yale/work/quay";
  const avg = new Map([
    ["plugin/test/long-a.test.mjs", 240],
    ["plugin/test/long-b.test.mjs", 180],
    ["plugin/test/short.test.mjs", 1],
  ]);
  const input = [
    `${root}/plugin/test/short.test.mjs`,
    `${root}/plugin/test/unknown.test.mjs`,
    `${root}/plugin/test/long-a.test.mjs`,
    `${root}/plugin/test/long-b.test.mjs`,
  ];
  const out = orderByLpt(input, avg, root);
  assert.deepEqual(
    out.map((f) => f.replace(root + "/", "")),
    [
      "plugin/test/long-a.test.mjs", // 240
      "plugin/test/long-b.test.mjs", // 180
      "plugin/test/short.test.mjs", // 1
      "plugin/test/unknown.test.mjs", // 0 — unknown goes LAST
    ],
  );
});

test("ordering — a known-long file lands in the first N (N = known-long count) of the sorted list", () => {
  const root = "/home/yale/work/quay";
  const avg = new Map([
    ["plugin/test/long.test.mjs", 200],
    ["plugin/test/other.test.mjs", 50],
  ]);
  const input = Array.from({ length: 20 }, (_, i) => `${root}/plugin/test/f${i}.test.mjs`).concat([
    `${root}/plugin/test/long.test.mjs`,
    `${root}/plugin/test/other.test.mjs`,
  ]);
  const out = orderByLpt(input, avg, root);
  assert.equal(out[0], `${root}/plugin/test/long.test.mjs`, "the longest-known file must lead");
  assert.equal(out[1], `${root}/plugin/test/other.test.mjs`);
  assert.equal(out.length, input.length, "every file is emitted exactly once (no drop, no dup)");
});

test("ordering — absent carrier ⇒ loadDurationAverages is empty (fail-open: no history, no reorder)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lpt-empty-"));
  try {
    const avg = loadDurationAverages(path.join(root, ".quay", "verification-round.jsonl"), root, 3);
    assert.equal(avg.size, 0, "an absent/unreadable carrier must yield an empty map");
    // And orderByLpt over an empty map returns the input unchanged (same order, same set).
    const input = ["a.test.mjs", "b.test.mjs"];
    assert.deepEqual(orderByLpt(input, avg, root), input);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ordering — a short/empty helper result never empties the list (spawnSync round-trip over an absent carrier)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lpt-spawn-"));
  try {
    const helper = path.join(REPO_ROOT, "plugin", "scripts", "suite-lpt-order.ts");
    const r = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", helper, "--root", root, "--rounds", "3"],
      { input: "plugin/test/a.test.mjs\nplugin/test/b.test.mjs\n", encoding: "utf8" },
    );
    assert.equal(r.status, 0, `helper must exit 0 (stderr: ${r.stderr})`);
    // No carrier ⇒ input unchanged (a.test.mjs then b.test.mjs).
    assert.equal(r.stdout, "plugin/test/a.test.mjs\nplugin/test/b.test.mjs\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ordering — repoRelKey folds worktree + main-checkout absolute paths to the same repo-relative key", () => {
  const root = "/home/yale/work/quay";
  assert.equal(
    repoRelKey("/home/yale/work/quay-worktrees/gap-x-abc/plugin/test/foo.test.mjs", root),
    "plugin/test/foo.test.mjs",
    "worktree absolute path must strip the quay-worktrees prefix",
  );
  assert.equal(
    repoRelKey("/home/yale/work/quay/plugin/test/foo.test.mjs", root),
    "plugin/test/foo.test.mjs",
    "main-checkout absolute path must strip the repo-root prefix",
  );
  assert.equal(
    repoRelKey("plugin/test/foo.test.mjs", root),
    "plugin/test/foo.test.mjs",
    "an already repo-relative path is unchanged",
  );
});

test("ordering — loadDurationAverages takes a per-file rolling average over each file's last N appearances and tolerates malformed lines", () => {
  const root = makeRootWithCarrier([
    [
      ["plugin/test/x.test.mjs", 100],
      ["plugin/test/y.test.mjs", 200],
    ],
    [["plugin/test/x.test.mjs", 300]], // y absent this round — averages only over appearances
  ]);
  try {
    const carrier = path.join(root, ".quay", "verification-round.jsonl");
    // Append a malformed line + a record without perFile — both must be skipped, not fatal.
    fs.appendFileSync(carrier, "{not json\n" + JSON.stringify({ round: 9, state: "red" }) + "\n");
    const avg = loadDurationAverages(carrier, root, 3);
    assert.equal(avg.get("plugin/test/x.test.mjs"), 200, "x averages (100+300)/2");
    assert.equal(avg.get("plugin/test/y.test.mjs"), 200, "y averages over its one appearance");
    assert.equal(avg.size, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — a lookback whose last N records are all another bucket still finds a P-only file's OWN history (cross-bucket immunity)", () => {
  const root = makeRootWithCarrier([
    // Earlier history: the P-only files appear with their real durations (90–260s range).
    [
      ["packages/quay/test/p-long.test.mjs", 200],
      ["packages/quay/test/p-short.test.mjs", 5],
    ],
    // The LAST 3 records are ALL M-bucket files — the P-only files are absent from them.
    [["plugin/test/m1.test.mjs", 150]],
    [["plugin/test/m2.test.mjs", 120]],
    [["plugin/test/m3.test.mjs", 100]],
  ]);
  try {
    const carrier = path.join(root, ".quay", "verification-round.jsonl");
    const avg = loadDurationAverages(carrier, root, 3);
    assert.equal(
      avg.get("packages/quay/test/p-long.test.mjs"),
      200,
      "a P-only file's duration must be found from its OWN history, not dropped by a last-N window full of M records",
    );
    assert.equal(avg.get("packages/quay/test/p-short.test.mjs"), 5);
    assert.equal(avg.get("plugin/test/m1.test.mjs"), 150);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 — production-replay shape (#599: lookback all-M) reorders P-only long files ahead by duration, not to the tail", () => {
  const root = makeRootWithCarrier([
    // Earlier P-bucket history: the long P-only files' real durations.
    [
      ["packages/quay/test/long-p.test.mjs", 260],
      ["packages/quay/test/mid-p.test.mjs", 90],
    ],
    // The LAST 3 records are all M (rounds 596/597/598 in #599's lookback) — no P files.
    [["plugin/test/m1.test.mjs", 150]],
    [["plugin/test/m2.test.mjs", 120]],
    [["plugin/test/m3.test.mjs", 100]],
  ]);
  try {
    const carrier = path.join(root, ".quay", "verification-round.jsonl");
    const avg = loadDurationAverages(carrier, root, 3);
    const input = [
      `${root}/packages/quay/test/short-p.test.mjs`, // unknown (0) — must stay LAST
      `${root}/packages/quay/test/long-p.test.mjs`, // 260 — must lead
      `${root}/packages/quay/test/mid-p.test.mjs`, // 90 — must follow
    ];
    const out = orderByLpt(input, avg, root);
    assert.deepEqual(
      out.map((f) => path.basename(f)),
      ["long-p.test.mjs", "mid-p.test.mjs", "short-p.test.mjs"],
      "P-only long files must be reordered by real duration, not dropped to the tail as unknown",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 — a normal/with-full lookback still sorts descending by duration with ties keeping original order", () => {
  const root = makeRootWithCarrier([
    // A mixed/full record plus M records, as in #583's lookback [580(M),581(M),582(full)].
    [
      ["plugin/test/full-a.test.mjs", 150],
      ["plugin/test/tie-x.test.mjs", 60],
    ],
    [["plugin/test/tie-y.test.mjs", 60]],
    [["plugin/test/full-b.test.mjs", 200]],
  ]);
  try {
    const carrier = path.join(root, ".quay", "verification-round.jsonl");
    const avg = loadDurationAverages(carrier, root, 3);
    const input = [
      `${root}/plugin/test/tie-x.test.mjs`, // 60 (tie)
      `${root}/plugin/test/full-b.test.mjs`, // 200
      `${root}/plugin/test/tie-y.test.mjs`, // 60 (tie)
      `${root}/plugin/test/full-a.test.mjs`, // 150
    ];
    const out = orderByLpt(input, avg, root);
    assert.deepEqual(
      out.map((f) => path.basename(f)),
      ["full-b.test.mjs", "full-a.test.mjs", "tie-x.test.mjs", "tie-y.test.mjs"],
      "descending duration, ties keep original relative order (a.i-b.i tiebreaker)",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ══ runner tests (suite-lpt-runner.mjs) — the task's AC1 / AC2 / AC5 ═══════════════════════════════

test("AC1 — run({files}) spawn order follows files[] in BOTH directions (forward z→m→a and reverse a→m→z)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lpt-ac1-"));
  try {
    const z = makeSpawnProbeFile(dir, "z");
    const m = makeSpawnProbeFile(dir, "m");
    const a = makeSpawnProbeFile(dir, "a");
    // Forward: z, m, a. Alphabetical would be a, m, z — a DIFFERENT order ⇒ take-false.
    const fwd = runProbe([z, m, a], { concurrency: 1, logFile: path.join(dir, "fwd.log") });
    assert.equal(fwd.code, 0, `forward run must exit 0 (stderr: ${fwd.stderr})`);
    assert.equal(fwd.spawnLog, "START z\nSTART m\nSTART a\n", "forward spawn order must follow files[] (z→m→a)");
    // Reverse: a, m, z. Same set, reversed input ⇒ reversed spawn — alphabetical would be identical.
    const rev = runProbe([a, m, z], { concurrency: 1, logFile: path.join(dir, "rev.log") });
    assert.equal(rev.code, 0, `reverse run must exit 0 (stderr: ${rev.stderr})`);
    assert.equal(rev.spawnLog, "START a\nSTART m\nSTART z\n", "reverse spawn order must follow files[] (a→m→z)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — at concurrency M the first M spawned files are the first M of the input list", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lpt-ac2-"));
  const log = path.join(dir, "spawn.log");
  try {
    // Five files a..e, each sleeping 300ms so the first-wave (a,b,c at concurrency 3) stays alive
    // while all 3 lanes are full — d and e cannot spawn until a lane frees (~300ms), so the first
    // 3 log entries are deterministically {a,b,c} = the first 3 of the input list.
    const files = ["a", "b", "c", "d", "e"].map((n) => makeSpawnProbeFile(dir, n, { sleepMs: 300 }));
    const r = runProbe(files, { concurrency: 3, logFile: log });
    assert.equal(r.code, 0, `run must exit 0 (stderr: ${r.stderr})`);
    const lines = r.spawnLog.trim().split("\n").map((l) => l.replace(/^START /, ""));
    assert.equal(lines.length, 5, "all five files must run exactly once");
    const firstM = new Set(lines.slice(0, 3));
    assert.deepEqual([...firstM].sort(), ["a", "b", "c"], "the first 3 spawned files must be the first 3 of the input list");
    assert.deepEqual(lines.slice(3).sort(), ["d", "e"], "d and e spawn only after the first-wave lanes free up");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 — the runner's stream.compose(perFileReporter) still emits __PERFILE__ (LPT's input carrier intact)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lpt-ac5-"));
  try {
    const ok = path.join(dir, "ok.test.mjs");
    fs.writeFileSync(
      ok,
      'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("ok", () => assert.equal(1, 1));\n',
    );
    const bad = path.join(dir, "bad.test.mjs");
    fs.writeFileSync(
      bad,
      'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("red", () => assert.equal(1, 2, "intentional"));\n',
    );
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ["--test-concurrency=2", RUNNER, ok, bad], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: childEnv,
    });
    assert.equal(r.status, 1, "one failing file ⇒ the runner exits non-zero");
    // Both files emit a __PERFILE__ line on stderr (the reporter is composed, not CLI-flagged).
    assert.match(r.stderr, /^__PERFILE__\s+duration_ms=\S+\s+\S*ok\.test\.mjs\s+passed=true\b/m, `passing file must emit passed=true:\n${r.stderr}`);
    assert.match(r.stderr, /^__PERFILE__\s+duration_ms=\S+\s+\S*bad\.test\.mjs\s+passed=false\b/m, `failing file must emit passed=false:\n${r.stderr}`);
    // __GROUP__ concurrency must echo the execArgv value (single source, no reporter drift).
    assert.match(r.stderr, /^__GROUP__ concurrency=2\b/m, `__GROUP__ must read concurrency from execArgv:\n${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runner — parseRunnerArgs splits files from pass-through flags (--test-concurrency skipped, --test-name-pattern mapped)", () => {
  const { files, testNamePatterns } = parseRunnerArgs([
    "node",
    "runner",
    "--test-concurrency=4",
    "--test-name-pattern=keep me",
    "--test-name-pattern",
    "drop me",
    "a.test.mjs",
    "--test-concurrency",
    "8",
    "b.test.mjs",
  ]);
  assert.deepEqual(files, ["a.test.mjs", "b.test.mjs"], "--test-concurrency args are consumed, not files");
  assert.deepEqual(testNamePatterns, ["keep me", "drop me"], "both --test-name-pattern spellings map to testNamePatterns");
});

// ══ gap-suite-lpt-runner-exitcode-diverges-spec-tally ══════════════════════════════════════════════
// The runner's exit code used to be a SEPARATE `test:fail` event counter — two read surfaces, two
// counts. A "fake red TAP" test file (one that PASSES but leaks a literal `not ok` line from a
// subprocess it spawns) pollutes the spec output the outer runner greps for 判绿/红 while the
// `test:fail` counter stays clean ⇒ exit code green / stdout red (分叉). Fix: ① the exit code reads
// the ROOT test:summary counts (the SAME tally the spec reporter renders as `ℹ fail N` / `ℹ
// cancelled N` — single source, no second driftable counter) and ② raw child stdout/stderr
// (test:stdout / test:stderr) is dropped before the spec reporter so a phantom `not ok` never
// reaches the runner's stdout.

/** Write a test file that PASSES but leaks a literal `not ok 1 - boom` line from a child subprocess
 *  (stdio inherited) — the "fake red TAP" shape of a failure-detection test. */
function makePhantomLeakFile(dir) {
  const file = path.join(dir, "phantom-leak.test.mjs");
  fs.writeFileSync(
    file,
    'import { spawnSync } from "node:child_process";\n' +
      'import { test } from "node:test";\n' +
      'import assert from "node:assert/strict";\n' +
      'test("passes despite phantom", () => {\n' +
      '  spawnSync(process.execPath, ["-e", "console.log(\'not ok 1 - boom\')"], { stdio: "inherit" });\n' +
      '  assert.equal(1, 1);\n' +
      '});\n',
  );
  return file;
}

test("gap-suite-lpt-runner-exitcode AC1/AC2 — a fake-red-TAP file (leaks phantom `not ok`) exits 0 AND the runner stdout carries no `not ok` (exit code and spec output agree, both green)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lpt-phantom-"));
  try {
    const leaky = makePhantomLeakFile(dir);
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ["--test-concurrency=1", RUNNER, leaky], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: childEnv,
    });
    // Green exit code: the phantom `not ok` is not a real failure (the spec fail tally is 0).
    assert.equal(r.status, 0, `a phantom-leaking file must exit 0 (stderr: ${r.stderr})`);
    // The spec reporter's own tally is clean (fail 0) — the single source the exit code reads.
    assert.match(r.stdout, /ℹ fail 0\b/, `spec must report fail 0:\n${r.stdout}`);
    // 判据2 take-false: the phantom `not ok` must NOT reach stdout (the raw child output is dropped
    // before the spec reporter). Before the fix this line leaked ⇒ exit code 0 / stdout red (分叉).
    assert.doesNotMatch(r.stdout, /^not ok\b/m, `the runner stdout must not leak a phantom not ok:\n${r.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gap-suite-lpt-runner-exitcode AC3 — single source: no `test:fail` counter, exit code reads the ROOT test:summary counts", () => {
  const src = fs.readFileSync(RUNNER, "utf8");
  // The second, independently-updated test:fail counter is deleted — the exit code now reads the
  // SAME tally the spec reporter renders, so the two can never drift apart (判据3).
  assert.doesNotMatch(src, /stream\.on\("test:fail"/, "the separate test:fail counter must be gone");
  assert.match(src, /test:summary/, "the exit code must read the test:summary counts (single source)");
  assert.match(src, /dropRawDiagnostics\(\)/, "the raw-diagnostic filter must be wired before the spec reporter");
});

test("gap-suite-lpt-runner-exitcode AC1 — a REAL failure still exits 1 and the exit code equals the spec fail tally (single source, no regression)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lpt-real-"));
  try {
    const bad = path.join(dir, "bad.test.mjs");
    fs.writeFileSync(
      bad,
      'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("red", () => assert.equal(1, 2, "intentional"));\n',
    );
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ["--test-concurrency=1", RUNNER, bad], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: childEnv,
    });
    assert.equal(r.status, 1, `one failing file ⇒ the runner exits non-zero (stderr: ${r.stderr})`);
    assert.match(r.stdout, /ℹ fail 1\b/, `spec must report fail 1 (the exit code's single source):\n${r.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
