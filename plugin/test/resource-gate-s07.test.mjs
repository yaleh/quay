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

// SPLIT from resource-gate.test.mjs by gap-suite-split-15-over-30s-test-files — shard 7/8 (8 tests). Shared fixtures: ./helpers/resource-gate-harness.mjs (single source).

import { test } from "node:test";
import { GATE, assert, execSync, fs, os, path, runGate, spawnSync } from "./helpers/resource-gate-harness.mjs";

test("AC1 — auto-detection: the gate reports caller_scope=worktree when invoked from a real linked worktree (no seam)", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "rg-wtrepo-"));
  const worktree = path.join(os.tmpdir(), `rg-wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    execSync("git init -b main", { cwd: repo, stdio: "ignore" });
    execSync("git config user.email t@example.com", { cwd: repo, stdio: "ignore" });
    execSync("git config user.name t", { cwd: repo, stdio: "ignore" });
    fs.writeFileSync(path.join(repo, "a.txt"), "x");
    execSync("git add a.txt && git commit -m init", { cwd: repo, stdio: "ignore" });
    execSync(`git worktree add -b feature ${worktree}`, { cwd: repo, stdio: "ignore" });
    // Run the REAL gate from the worktree (no caller_scope seam) with a CPU seam so it stays GO.
    const env = { ...process.env, RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" };
    const res = spawnSync("bash", [GATE], { cwd: worktree, encoding: "utf8", env });
    assert.match(res.stdout, /caller_scope=worktree/, `worktree invocation must auto-detect caller_scope=worktree, got:\n${res.stdout}`);
  } finally {
    try {
      execSync(`git worktree remove --force ${worktree}`, { cwd: repo, stdio: "ignore" });
    } catch {
      // worktree may not exist if the test failed early
    }
    fs.rmSync(repo, { recursive: true, force: true });
  }
});


test("AC2 — main-repo priority: --main-repo-priority lets the main-repo full suite proceed over worktree scoped load (WAIT->GO at cpu=70)", () => {
  // LOAD_OVERRIDE=12 ALSO above the nproc×2=8 overload-window threshold: the override must clear the
  // load_wait too (worktree-sourced load is deferrable — it is exactly what pushes load average high).
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "70",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 0, `main-repo suite must GO over worktree load; got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /worktree_priority: ON/, "the priority override must be announced");
  assert.match(r.stdout, /=> GO: 主仓 full-suite 优先/, "the verdict must name the priority rule");
});


test("AC2 negative — the SAME load WITHOUT --main-repo-priority stays WAIT (the override is opt-in)", () => {
  // cpu=70 AND load=12 (both WAIT signals); no override ⇒ WAIT. CPU is primary so the verdict names
  // CPU starvation.
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "70",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    },
    ["--for", "full-suite"],
  );
  assert.equal(r.status, 1, `without the priority flag the gate must WAIT; got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> WAIT: CPU 饥饿/);
});


test("AC2 negative — a WORKTREE caller passing --main-repo-priority stays WAIT (a worktree full-suite is itself deferrable)", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "70",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "worktree",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 1, `a worktree caller must NOT get the main-repo override; got ${r.status}\n${r.stdout}`);
});


test("AC2 negative — CPU above the priority ceiling (>=85) stays WAIT even with worktree load + priority (machine too loaded for ANY heavy op)", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "90",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 1, `cpu=90 above the ceiling must stay WAIT; got ${r.status}\n${r.stdout}`);
});


test("AC2 negative — worktree load below the min threshold (4) does NOT trigger the override", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "70",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "2",
      RESOURCE_GATE_TEST_LOAD_OVERRIDE: "12",
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 1, `only 2 worktree procs is not dominant load; got ${r.status}\n${r.stdout}`);
});


test("AC2 negative — mem_wait is NEVER overridden: low memory stays WAIT even with worktree load + priority (OOM is a cliff, not deferrable)", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "10", // calm CPU — only mem blocks, so the verdict names memory alone
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "1000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 1, `mem_wait must remain a hard blocker; got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> WAIT: 内存不足/);
  assert.doesNotMatch(r.stdout, /worktree_priority: ON/, "the override must NOT announce when memory is the blocker");
});


test("AC3 — negative control: the worktree load is OBSERVABLE via the gate even when the worktree writes no state file (the 'no signal' half is closed)", () => {
  // The deadlock's second half: a worktree scoped run writes no .quay/full-suite-state.json, so its
  // completion updates nothing anyone waits on. The gate's worktree_node_tests line is a LIVE
  // observable that exists regardless of any state file — a waiter reads `resource-gate.sh` and sees
  // the worktree is consuming the machine.
  const r = runGate({
    RESOURCE_GATE_TEST_CPU_AVG10: "30",
    RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
    RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "12",
  });
  assert.equal(r.status, 0, "report mode exits 0 (read-only)");
  assert.match(r.stdout, /worktree_node_tests=12\s+caller_scope=main/, "the worktree signal is readable without any state file");
  assert.doesNotMatch(r.stdout, /full-suite-state/, "the gate itself needs no state file to report the worktree load");
});

// ── AC99 (gap-ac99-webui-machine-readable-json): the --json machine-readable interface ─────────────
// Every System/Manager view field traces to a mechanism emitting a stable JSON document. These tests
// read the PRODUCTION carrier — the real script's --json stdout — not a fixture (硬规则④推论三:
// 关掉 fixture/注入 seam 后判据仍能通过才算测量；fixture 只用于驱动确定性读数，判据读的是真输出).
