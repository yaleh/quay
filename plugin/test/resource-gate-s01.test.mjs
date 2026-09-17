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

// SPLIT from resource-gate.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/8 (9 tests). Shared fixtures: ./helpers/resource-gate-harness.mjs (single source).

import { test } from "node:test";
import { GATE, WAIT_THRESHOLD, assert, fs, runGate } from "./helpers/resource-gate-harness.mjs";

test("AC2 — gate reads /proc/pressure/cpu `some avg10` as PRIMARY; load average is a SUPPLEMENTARY overload-window criterion", () => {
  const src = fs.readFileSync(GATE, "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(src, /\/proc\/pressure\/cpu/, "gate must read /proc/pressure/cpu");
  assert.match(src, /avg10=/, "gate must parse the some avg10 field");
  assert.match(src, /some avg10 < 60|CPU_LIMIT/, "gate must carry the some avg10 < 60 band (unified with cap-from-gate's WAIT_THRESHOLD)");
  // The load-average overload-window criterion (AC3) — load is a SUPPLEMENT, PSI stays primary.
  assert.match(code, /\/proc\/loadavg/, "gate must read /proc/loadavg (the supplementary overload-window signal)");
  assert.match(src, /LOAD_OVER_FACTOR/, "gate must carry the load >= nproc × LOAD_OVER_FACTOR overload-window band");
  assert.match(src, /RESOURCE_GATE_TEST_LOAD_OVERRIDE/, "the load test seam must exist");
  assert.match(src, /NOT a replacement|not a replacement|SUPPLEMENT|supplementary/, "the header must state load is a supplement, not a replacement for PSI");
});

// ── AC2 (gap-adaptive-concurrency-cap-tied-to-resource-gate): the gate also reports avg300 ─────────
// cap-from-gate reads the adaptive-concurrency signal via the SAME report line (single source): the
// avg300 field must be parsed AND printed under its own test seam.

test("AC2b — gate parses AND prints `some avg300` (the adaptive-cap signal), seam-controlled", () => {
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /avg300=/, "gate must parse the some avg300 field");
  assert.match(src, /RESOURCE_GATE_TEST_CPU_AVG300/, "the avg300 test seam must exist");
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_CPU_AVG300: "12.34", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" });
  assert.match(r.stdout, /cpu_stall\(some avg300\)=12\.34/, "report mode must print the avg300 line");
});

// ── AC2-AC4 (gap-resource-gate-psi-does-not-capture-load-flake-driver) ──────────────────────────────
// Empirical flake correlation (round-230/231/232, suite-fix subagent 2026-08-10 + outer 复核):
// loop-shipping passed=false at load 6.4 / 6.04 / 11.76 while PSI some avg10 stayed 8-10 < 60 and the
// gate returned GO — the red rounds tracked LOAD (runnable+uninterruptible queue depth, incl. the
// loop's own claude sessions), not PSI. AC3 adds the overload-window criterion (load >= nproc ×
// LOAD_OVER_FACTOR ⇒ WAIT) WITHOUT weakening the PSI primary band; AC4 is the negative control.

test("AC4 — overload-window negative control: load >= nproc×2 ⇒ WAIT even when PSI is low (round-232 reproduction)", () => {
  // round-232: load 11.76 / nproc=4 (~3× oversubscription), PSI 8.27 < 60. Old gate: GO. New gate:
  // load_wait fires (11.76 >= 4×2=8) ⇒ WAIT, exit 1 — the round no longer starts into the overload
  // window that produced the loop-shipping flake.
  const r = runGate(
    { RESOURCE_GATE_TEST_CPU_AVG10: "8.27", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000", RESOURCE_GATE_TEST_LOAD_OVERRIDE: "11.76", RESOURCE_GATE_TEST_NPROC: "4" },
    ["--for", "full-suite"],
  );
  assert.equal(r.status, 1, `load 11.76 / nproc 4 must WAIT (overload window), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /loadavg=11\.76/, "the loadavg line must print the reading");
  assert.match(r.stdout, /=> WAIT: 过载窗口/, "the verdict must name the overload window");
});


test("AC4 — load below the threshold stays GO (normal machine state, PSI low)", () => {
  const r = runGate(
    { RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000", RESOURCE_GATE_TEST_LOAD_OVERRIDE: "3", RESOURCE_GATE_TEST_NPROC: "4" },
    ["--for", "full-suite"],
  );
  assert.equal(r.status, 0, `load 3 / nproc 4 must GO, got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /loadavg=3\.00/, "the loadavg line must print the reading");
  assert.match(r.stdout, /=> GO/);
});


test("invariant psi_still_waits — PSI high ⇒ WAIT even when load is low (the supplementary load criterion does NOT weaken the primary)", () => {
  const r = runGate(
    { RESOURCE_GATE_TEST_CPU_AVG10: "84.77", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000", RESOURCE_GATE_TEST_LOAD_OVERRIDE: "1", RESOURCE_GATE_TEST_NPROC: "4" },
    ["--for", "full-suite"],
  );
  assert.equal(r.status, 1, `PSI high must still WAIT, got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> WAIT: CPU 饥饿/, "the PSI primary verdict must still name CPU starvation");
});


test("AC4 — unmeasurable load fails CLOSED (a gate that silently opens when a signal is missing is a quietly-lying instrument)", () => {
  const r = runGate(
    { RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000", RESOURCE_GATE_TEST_LOAD_OVERRIDE: "unmeasurable", RESOURCE_GATE_TEST_NPROC: "4" },
    ["--for", "full-suite"],
  );
  assert.equal(r.status, 1, `unmeasurable load must WAIT (fail-closed), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /loadavg=UNMEASURABLE/, "the output must say UNMEASURABLE, not a fake number");
});


test("AC2 — the gate's header records the flake/load correlation (the red-round pairs that motivated the supplementary criterion)", () => {
  // The ## Contract invariant flake_load_correlation: the red-round load+PSI pairs (round-230/231/232
  // @ load 6.4/6.04/11.76, PSI 8-10 < 60) are recorded in the gate's header, so a future reader sees
  // WHY load is added — the correlation is pinned, not prose elsewhere.
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /round-230\/231\/232|6\.4\/6\.04\/11\.76|11\.76/, "the header must record the flake/load correlation evidence");
  assert.match(src, /overload.window|OVERLOAD-WINDOW|SUPPLEMENT/, "the header must explain load is the overload-window supplement");
});

// ── AC4: CMDLINE-based node count (host-independent), never a comm literal / pgrep -f / grep -x node
// (gap-node-mainthread-comm-literal-host-dependent) The old `pgrep -xc node-MainThread` enumeration
// was HOST-DEPENDENT: boheidc (Node v24.19.0) reports comm=`MainThread`, so it silently returned 0
// there. The gate now enumerates node pids via CMDLINE; the node-MainThread literal survives ONLY as
// the dual-read self-check cross-count.

test("AC4 — gate counts node procs via CMDLINE (host-independent), not a comm literal; keeps the dual-read self-check", () => {
  const src = fs.readFileSync(GATE, "utf8");
  // The header comment may MENTION the forbidden spellings (as warnings) — the CODE must not.
  const code = src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(src, /list_node_cmdline_pids|\/proc\/.*cmdline/, "gate must enumerate node pids via cmdline");
  assert.doesNotMatch(code, /pgrep -xc node-MainThread/, "gate must NOT enumerate via the host-dependent comm literal `pgrep -xc node-MainThread`");
  assert.doesNotMatch(code, /pgrep -f/, "gate must NOT use `pgrep -f` (matches any cmdline containing node)");
  // NB: a bare `grep -x node` (standalone grep, not pgrep) is a fragment — always 0 on a host whose
  // comm is `node-MainThread`, and ALSO 0 on boheidc (comm=`MainThread`).
  assert.doesNotMatch(code, /(^|[^a-zA-Z])grep -x node\b/m, "gate must NOT use `grep -x node` as a standalone command (fragment — always 0)");
  // The dual-read self-check cross-reads the comm literal against cmdline candidates.
  assert.match(src, /count_comm_node_mainthread|node_comm_mainthread/, "gate must carry the dual-read comm cross-count");
  assert.match(src, /list_node_cmdline_pids|node_cmdline_procs/, "gate must carry the dual-read cmdline candidate count");
  assert.match(src, /instrument_failure|INSTRUMENT-FAILURE/, "gate must report instrument failure on the dual-read mismatch");
});


test("AC4 negative control — the old comm literal is reported as INSTRUMENT FAILURE when comm=0 but cmdline>0 (the boheidc shape)", () => {
  const r = runGate({
    RESOURCE_GATE_TEST_CPU_AVG10: "10",
    RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    RESOURCE_GATE_TEST_COMM_COUNT: "0",
    RESOURCE_GATE_TEST_CMDLINE_COUNT: "5",
  });
  assert.match(r.stdout, /node_comm_mainthread=0/, "the comm cross-count must be reported");
  assert.match(r.stdout, /node_cmdline_procs=5/, "the cmdline candidate count must be reported");
  assert.match(r.stdout, /INSTRUMENT-FAILURE/, "comm=0 with cmdline=5 must report instrument failure, not machine idle");
});
