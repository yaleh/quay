// @test-group engine
// resource-gate.test.mjs — gap-no-resource-awareness-heavy-ops-run-blind. Pins the shared resource
// gate (plugin/scripts/resource-gate.sh) + the derived concurrency default (scripts/test.sh
// default_test_concurrency) as a MECHANICAL mechanism, not prose:
//
//   AC2 — the gate reads /proc/pressure/cpu `some avg10` (structural), never load average (proxy)
//   AC4 — it counts node procs via CMDLINE (host-independent — the `node-MainThread` comm literal
//         is host/Node-version-dependent, boheidc comm=`MainThread` ⇒ 恒 0), never `pgrep -f` /
//         `grep -x node`; the comm literal survives only as the dual-read self-check cross-count
//   AC3 — GO ↔ WAIT both directions, deterministically via the env test seams (no busy-loop flake)
//   AC6 — mem_avail < 2048MB → WAIT + prints RSS top-5
//   AC10 — orphaned node procs printed on their own line, excluded from the GO/WAIT verdict
//   AC7 — test.sh consults the gate on the full-suite default path; skips it for scoped runs
//   AC5 — default concurrency = max(1, floor(nproc × oversub / S)); explicit --test-concurrency=N wins
//         (gap-suite-budget-oversubscribe pure computation — nproc read-host, oversub 旋钮③, S 旋钮②)
//
// The gate's own AC3 (raise cpu pressure with real busy loops, watch WAIT, stop, watch GO) is a
// live-system control — recorded in the task body, not here (a unit test cannot hold /proc/pressure
// hostage). The env seams below pin the SAME verdict logic deterministically.
//
// Run:
//   scripts/test.sh plugin/test/resource-gate.test.mjs
//   node --test plugin/test/resource-gate.test.mjs

// SPLIT from resource-gate.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/8 (9 tests). Shared fixtures: ./helpers/resource-gate-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, TEST_SH, assert, defaultLaneCount, defaultTestConcurrency, derivedConcurrency, fs, path, runnerLaneCount, spawn, spawnSync, withSeams } from "./helpers/resource-gate-harness.mjs";

test("AC4 — direct path and runner path BOTH subtract in_use (set in_use back to 0 ⇒ full value)", () => {
  // The DIRECT path (defaultTestConcurrency) and RUNNER path (defaultLaneCount) stay equal under the
  // SAME seams (判据4), and both respond to in_use.
  const busyDirect = derivedConcurrency(16, 2, 1, 4);   // (16−4)/2 = 6
  const busyRunner = runnerLaneCount({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "2", QUAY_MAX_OVERSUBSCRIPTION: "1", RESOURCE_GATE_TEST_NODE_PROCS: "4" });
  assert.equal(busyDirect, 6, "direct in_use=4 → (16−4)/2 = 6");
  assert.equal(busyRunner, 6, "runner in_use=4 → 6 (equal to direct)");
  // Set in_use back to 0 ⇒ back to nproc×oversub/S (bidirectional falsifiable).
  assert.equal(derivedConcurrency(16, 2, 1, 0), 8, "in_use=0 → back to 16×1/2 = 8");
  assert.equal(runnerLaneCount({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "2", QUAY_MAX_OVERSUBSCRIPTION: "1" }), 8, "runner in_use=0 → back to 8");
});


test("AC6 — oversub code default is 1 (not 1.75): QUAY_MAX_OVERSUBSCRIPTION unset ⇒ defaultLaneCount uses 1", () => {
  // The production config's 1.75 was an experiment residue (already ops-changed to 1 by the human);
  // the CODE default must be 1 so a fresh host/install never oversubscribes by 1.75×.
  const defaultOversub = runnerLaneCount({ RESOURCE_GATE_NPROC: "16", RESOURCE_GATE_CONCURRENT_SUITES: "1" });
  // withSeams clears QUAY_MAX_OVERSUBSCRIPTION ⇒ the code default 1 applies (not 1.75 ⇒ not 28).
  assert.equal(defaultOversub, 16, "oversub unset → default 1 → nproc×1/1 = 16 (not 16×1.75=28)");
});

// ── COUNTING SCOPE (gap-process-budget-counts-infra-as-test-concurrency-cap-pinned-1, AC2/AC3/AC4) ──
// The old `in_use = pgrep -xc node-MainThread` counted EVERY node main process as a test worker. On
// this box that was 17 processes — 14 MCP + 2 web serve + 1 suite-state monitor + 0 test workers —
// so on a 4-core box (total_budget=4) available=0 and effective_cap was structurally pinned at 1
// even in the GO band. in_use now counts ONLY throttle-able TEST processes: a node cmdline carrying
// `--test` (node --test runner AND its child workers, whose flags are --test-concurrency /
// --test-coverage-* / --test-name-pattern / --test-isolation / --test-timeout) or a direct test-file
// run (…test.mjs / …test.ts / …_test.mjs). Resident infrastructure (quay.js mcp / quay.ts mcp /
// quay-native mcp / quay serve / suite-state-trigger.ts --monitor) is a CONSTANT, not throttle-able.
//
// The RESOURCE_GATE_TEST_PROC_CMDLINES seam feeds a cmdline list (newline- or semicolon-separated)
// to the SAME classifier process-budget.sh runs over /proc, so the classification is pinned
// deterministically without needing real node --test processes.

test("AC2 — process-budget in_use classifies by cmdline: infra (mcp/serve/monitor) is NOT counted, test workers ARE", () => {
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  // The measured 2026-08-08 19:1xZ host classification: 17 node-MainThread, of which 14 MCP + 2
  // serve + 1 monitor are INFRA (never throttle-able) and 0 are test workers. Excluding infra must
  // give in_use=0, available=4 on a 4-core box — the GO band restored (AC3).
  const infraCmds = [
    "node /home/yale/.local/share/quay-plugin//vendor/quay/dist/quay.js mcp",
    "node packages/quay/bin/quay.ts mcp",
    "node /home/yale/.nvm/versions/node/v26.5.0/bin/quay-native mcp",
    "node /home/yale/.nvm/versions/node/v26.5.0/bin/quay serve --host 100.87.141.82 --port 4174",
    "node --experimental-strip-types packages/quay/bin/quay.ts serve --host 100.87.141.82 --port 4173",
    "node --no-warnings --experimental-strip-types /home/yale/work/quay/plugin/scripts/suite-state-trigger.ts --monitor",
  ];
  const infraOnly = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: infraCmds.join(";") },
  });
  assert.equal(infraOnly.status, 0, `process-budget.sh must exit 0\n${infraOnly.stderr}`);
  assert.match(infraOnly.stdout, /in_use=0/, "infra cmdlines (mcp/serve/monitor) must NOT count against the test budget");
  assert.match(infraOnly.stdout, /available=4/, "4-core GO band with no test workers → available=4 (no longer pinned to 0)");
  assert.match(infraOnly.stdout, /verdict=GO/, "no throttle-able test workers ⇒ GO, cap NOT pinned to 1");

  // Real node --test workers (top-level runner + child worker, measured 2026-08-08) ARE counted.
  const testCmds = [
    "node --test --test-concurrency=2 /tmp/budget-control.mjs",                                    // top-level runner
    "/home/yale/.nvm/versions/node/v26.5.0/bin/node --test-coverage-functions=0 --test-concurrency=1 --test-isolation=process /tmp/budget-control.mjs", // child worker
    "node --test --test-name-pattern=flag /tmp/budget-control.mjs",
    "node --experimental-strip-types packages/quay/test/foo.test.mjs",                             // direct test-file run
  ];
  const testsRunning = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: testCmds.join(";") },
  });
  assert.equal(testsRunning.status, 0, `process-budget.sh must exit 0\n${testsRunning.stderr}`);
  assert.match(testsRunning.stdout, /in_use=4/, "all 4 test-worker cmdlines must count against the budget");
  assert.match(testsRunning.stdout, /available=0/, "4 test workers on 4 cores → available=0");
});


test("AC4 — overload protection RETAINED: injecting test workers drops available and flips verdict to WAIT", () => {
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  const worker = "node --test --test-concurrency=1 /tmp/spawn-test.mjs";
  // nproc=4. 1 worker → available=3, still GO (throttled but not exhausted).
  const one = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: worker },
  });
  assert.equal(one.status, 0);
  assert.match(one.stdout, /in_use=1/);
  assert.match(one.stdout, /available=3/);
  assert.match(one.stdout, /verdict=GO/);
  // 5 workers (one more than nproc) → available=0, WAIT — the budget still prevents over-subscription.
  const five = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: Array(5).fill(worker).join(";") },
  });
  assert.equal(five.status, 0);
  assert.match(five.stdout, /in_use=5/);
  assert.match(five.stdout, /available=0/);
  assert.match(five.stdout, /verdict=WAIT/);
});

// ── COUNTING ACCURACY (gap-fixed-cap-5-dynamic-cap-retired AC4) ────────────────────────────────────
// The human ruling's measured defect: process-budget.sh reported `in_use=5` while only 1 node
// MainThread test process actually ran (infra — mcp/serve/monitor — was being counted as a
// throttle-able test worker). The fix (f126c087) counts ONLY throttle-able TEST procs; THIS test pins
// the exact reported scenario — 1 real test worker among the resident infra cmdlines ⇒ in_use=1,
// never 5. `budget_count_accurate` invariant.

test("AC4 — in_use matches the ACTUAL test-worker count: 1 test worker among infra ⇒ in_use=1 (not 5) — the 报5实1 reproduction", () => {
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  // The measured host infra set (2026-08-08 19:1xZ / the manager's 2026-08-09 ruling): MCP servers,
  // web serve, suite-state monitor — NOT throttle-able. Plus exactly ONE real test worker.
  const infraCmds = [
    "node /home/yale/.local/share/quay-plugin//vendor/quay/dist/quay.js mcp",
    "node packages/quay/bin/quay.ts mcp",
    "node /home/yale/.nvm/versions/node/v26.5.0/bin/quay-native mcp",
    "node /home/yale/.nvm/versions/node/v26.5.0/bin/quay serve --host 100.87.141.82 --port 4174",
    "node --experimental-strip-types packages/quay/bin/quay.ts serve --host 100.87.141.82 --port 4173",
    "node --no-warnings --experimental-strip-types /home/yale/work/quay/plugin/scripts/suite-state-trigger.ts --monitor",
  ];
  const oneWorker = "node --test --test-concurrency=1 /tmp/budget-control.mjs";
  const cmds = [...infraCmds, oneWorker];
  const r = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: cmds.join(";") },
  });
  assert.equal(r.status, 0, `process-budget.sh must exit 0\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /in_use=1/, `6 infra + 1 test worker ⇒ in_use=1, got:\n${r.stdout}`);
  assert.match(r.stdout, /available=3/, "1 test worker on 4 cores ⇒ available=3");
  assert.match(r.stdout, /verdict=GO/, "1 worker leaves the budget GO");
  // Every infra cmdline alone (no test worker) ⇒ in_use=0 — infra is NEVER throttle-able.
  const infraOnly = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_PROC_CMDLINES: infraCmds.join(";") },
  });
  assert.equal(infraOnly.status, 0);
  assert.match(infraOnly.stdout, /in_use=0/, "pure infra ⇒ in_use=0 (infra is a resident constant, not test concurrency)");
});

// ── DUAL-READ SELF-CHECK (gap-node-mainthread-comm-literal-host-dependent, AC1b/AC4) ────────────────
// The comm literal (`node-MainThread`) is host/Node-version-dependent: on boheidc (Node v24.19.0) the
// node comm is `MainThread`, so a comm-literal enumeration silently reads 0. process-budget.sh now
// enumerates via CMDLINE (never the literal) and cross-reads the comm count: comm=0 && cmdline>0 ⇒
// INSTRUMENT FAILURE (never "machine idle").

test("AC1b/AC4 — process-budget reports instrument_failure when comm=0 but cmdline>0 (the boheidc shape)", () => {
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  const r = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_COMM_COUNT: "0", RESOURCE_GATE_TEST_CMDLINE_COUNT: "5" },
  });
  assert.equal(r.status, 0, `process-budget.sh must exit 0\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /node_comm_mainthread=0/, "the comm cross-count must be reported");
  assert.match(r.stdout, /node_cmdline_procs=5/, "the cmdline candidate count must be reported");
  assert.match(r.stdout, /instrument_failure=1/, "comm=0 with cmdline=5 must report instrument failure, not machine idle");
});


test("AC1b/AC4 — process-budget with a matching comm literal (comm>0) is NOT instrument failure", () => {
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  const r = spawnSync("bash", [budgetScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_COMM_COUNT: "2", RESOURCE_GATE_TEST_CMDLINE_COUNT: "2" },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /instrument_failure=0/, "comm>0 is a normal reading");
});


test("AC5 — process-budget.sh header documents the counting scope (test procs only; infra is a resident constant)", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh"), "utf8");
  assert.match(src, /COUNTING SCOPE/, "the header must carry a COUNTING SCOPE section (AC5)");
  assert.match(src, /THROTTLE-ABLE TEST processes|node --test worker|throttle-able/, "the header must state that in_use counts test processes only");
  assert.match(src, /MUST NOT count|NOT counted against the test budget/, "the header must state infra is excluded from the budget");
  assert.match(src, /OVERLOAD PROTECTION RETAINED|RESOURCE_GATE_TEST_PROC_CMDLINES/, "the header must document the retained overload protection / new seam");
});


test("AC5 — scripts/test.sh uses the derived default in its exec lines (no hardcoded 8)", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // FIVE `node --test --test-concurrency="$(default_test_concurrency)"` sites remain: 4
  // `exec node --test ...` lines (run_selected, --group-explicit, explicit-file, --scoped
  // <file...>) + 1 `node --test ...` line (--for-task, no exec). The --buckets site
  // (gap-ac124-suite-bucket-production-carrier-benefit) now hands its LPT-ordered list to
  // suite-lpt-runner.mjs via `node --test-concurrency="$(bucket_test_concurrency ...)"`
  // (gap-m-bucket-long-tail-lpt-scheduling: run({files}) preserves order) — the derived default
  // STILL governs it (bucket_test_concurrency falls back to default_test_concurrency when no
  // explicit --test-concurrency flag is passed), only delivered through execArgv instead of the
  // node --test CLI flag.
  const allSites = src.match(/node --test --test-concurrency="\$\(default_test_concurrency\)"/g);
  assert.equal(allSites.length, 5, `expected 5 derived-concurrency node --test sites, got ${allSites.length}`);
  // The --buckets runner derives its concurrency from the SAME default (no hardcoded literal).
  assert.match(src, /node --test-concurrency="\$\(bucket_test_concurrency/, "the --buckets runner must derive concurrency via bucket_test_concurrency");
  // bucket_test_concurrency thin-forwards to runner-concurrency.ts bucketTestConcurrency, whose fallback
  // is defaultTestConcurrency (SPEC P4 — the derivation moved out of bash, so the fallback is now
  // asserted structurally on the TS source, not a bash `default_test_concurrency\n}` line).
  assert.match(src, /bucket_test_concurrency\(\) \{\n  node --no-warnings --experimental-strip-types "\$\{repo_root\}\/plugin\/scripts\/runner-concurrency\.ts" --bucket-test-concurrency "\$@"/, "bucket_test_concurrency must thin-forward to runner-concurrency.ts");
  const rc = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "runner-concurrency.ts"), "utf8");
  assert.match(rc, /return defaultTestConcurrency\(\);/, "bucketTestConcurrency must fall back to defaultTestConcurrency");
  assert.doesNotMatch(src, /--test-concurrency=8/, "no hardcoded 8 may remain in test.sh");
});

// ── AC7: test.sh integration — gate on the full-suite default, skip on scoped runs ─────────────────
