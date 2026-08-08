// @test-group engine
// resource-gate.test.mjs — gap-no-resource-awareness-heavy-ops-run-blind. Pins the shared resource
// gate (plugin/scripts/resource-gate.sh) + the derived concurrency default (scripts/test.sh
// default_test_concurrency) as a MECHANICAL mechanism, not prose:
//
//   AC2 — the gate reads /proc/pressure/cpu `some avg10` (structural), never load average (proxy)
//   AC4 — it counts `pgrep -xc node-MainThread` (exact comm), never `pgrep -f` / `grep -x node`
//   AC3 — GO ↔ WAIT both directions, deterministically via the env test seams (no busy-loop flake)
//   AC6 — mem_avail < 2048MB → WAIT + prints RSS top-5
//   AC10 — orphaned node procs printed on their own line, excluded from the GO/WAIT verdict
//   AC7 — test.sh consults the gate on the full-suite default path; skips it for scoped runs
//   AC5 — default concurrency = max(1, floor(nproc / amplification)); explicit --test-concurrency=N wins
//
// The gate's own AC3 (raise cpu pressure with real busy loops, watch WAIT, stop, watch GO) is a
// live-system control — recorded in the task body, not here (a unit test cannot hold /proc/pressure
// hostage). The env seams below pin the SAME verdict logic deterministically.
//
// Run:
//   scripts/test.sh plugin/test/resource-gate.test.mjs
//   node --test plugin/test/resource-gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);
const GATE = path.join(REPO_ROOT, "plugin", "scripts", "resource-gate.sh");
const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");

/** Run the REAL gate with env-seam overrides. Returns { status, stdout } (stderr merged). */
function runGate(envOverrides = {}, args = []) {
  const env = { ...process.env, ...envOverrides };
  const res = spawnSync("bash", [GATE, ...args], { cwd: REPO_ROOT, encoding: "utf8", env });
  return { status: res.status, stdout: `${res.stdout}\n${res.stderr}` };
}

/** Extract the REAL default_concurrency_formula from scripts/test.sh and run it with seams.
 *  `in_use` (default 0) is the RESOURCE_GATE_TEST_NODE_PROCS seam — the budget-aware derivation
 *  subtracts it from nproc (gap-test-concurrency-cap-does-not-scope-nested-spawns AC1). */
function derivedConcurrency(nproc, amplification, in_use = 0) {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // The formula lives in default_concurrency_formula; default_test_concurrency CALLS it (the
  // 2026-08-03 TEMPORARY pin to 8 was reverted by
  // gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived).
  const fnMatch = src.match(/default_concurrency_formula\(\) \{[^]*?\n\}/);
  assert.ok(fnMatch, "scripts/test.sh must define default_concurrency_formula()");
  const script = `${fnMatch[0]}\nRESOURCE_GATE_NPROC=${nproc}\nRESOURCE_GATE_AMPLIFICATION=${amplification}\nRESOURCE_GATE_TEST_NODE_PROCS=${in_use}\nprintf '%s' "$(default_concurrency_formula)"\n`;
  const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(res.status, 0, `derivedConcurrency subshell failed: ${res.stderr}`);
  return Number(res.stdout.trim());
}

/** Directly EXECUTE default_test_concurrency (the real effective default) and return its value.
 *  This is the AC1/AC3 "test the real value, not the spelling" seam: it runs the actual function
 *  the exec lines call, so a function that returns a constant instead of the derived formula is
 *  caught HERE, not by a call-site-spelling assertion. `in_use` defaults to 0 — the idle-host
 *  default (the budget-aware subtraction is asserted separately via derivedConcurrency's in_use
 *  seam, so the real-host idle default stays nproc deterministically). */
function currentDefaultConcurrency() {
  const src = fs.readFileSync(TEST_SH, "utf8");
  const fnMatch = src.match(/default_test_concurrency\(\) \{[^]*?\n\}/);
  assert.ok(fnMatch, "scripts/test.sh must define default_test_concurrency()");
  // default_test_concurrency calls default_concurrency_formula — extract BOTH functions so the
  // isolated subshell is self-contained (matches the ## Contract effective_concurrency measure).
  const formulaMatch = src.match(/default_concurrency_formula\(\) \{[^]*?\n\}/);
  assert.ok(formulaMatch, "scripts/test.sh must define default_concurrency_formula()");
  const script = `${formulaMatch[0]}\n${fnMatch[0]}\nRESOURCE_GATE_TEST_NODE_PROCS=0\nprintf '%s' "$(default_test_concurrency)"\n`;
  const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(res.status, 0, `currentDefaultConcurrency subshell failed: ${res.stderr}`);
  return Number(res.stdout.trim());
}

// ── AC2: the gate reads /proc/pressure/cpu some avg10, not load average ────────────────────────────
test("AC2 — gate reads /proc/pressure/cpu `some avg10` (structural), not load average (proxy)", () => {
  const src = fs.readFileSync(GATE, "utf8");
  // The header comment EXPLAINS why load average is rejected (proxy) — the CODE must not use it.
  const code = src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(src, /\/proc\/pressure\/cpu/, "gate must read /proc/pressure/cpu");
  assert.match(src, /avg10=/, "gate must parse the some avg10 field");
  assert.match(src, /some avg10 < 40|CPU_LIMIT/, "gate must carry the some avg10 < 40 band");
  assert.doesNotMatch(code, /load average/, "gate must NOT use load average as the verdict basis");
  assert.doesNotMatch(code, /\/proc\/loadavg/, "gate must NOT read /proc/loadavg");
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

// ── AC4: pgrep -xc node-MainThread (exact comm), never pgrep -f / grep -x node ─────────────────────
test("AC4 — gate counts `pgrep -xc node-MainThread` (exact comm), never `pgrep -f` / `grep -x node`", () => {
  const src = fs.readFileSync(GATE, "utf8");
  // The header comment may MENTION the forbidden spellings (as warnings) — the CODE must not.
  const code = src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.match(src, /pgrep -xc node-MainThread/, "gate must use `pgrep -xc node-MainThread`");
  assert.match(src, /node-MainThread/, "the comm name must be node-MainThread (Node's actual comm)");
  assert.doesNotMatch(code, /pgrep -f/, "gate must NOT use `pgrep -f` (matches any cmdline containing node)");
  // NB: `pgrep -x node-MainThread` legitimately CONTAINS the substring "grep -x node" — the check
  // is for `grep` as a standalone command (a preceding letter, as in "pgrep", means it is not).
  assert.doesNotMatch(code, /(^|[^a-zA-Z])grep -x node\b/m, "gate must NOT use `grep -x node` (comm is node-MainThread → always 0)");
});

// ── AC3: GO ↔ WAIT both directions via deterministic seams ─────────────────────────────────────────
test("AC3 — gate returns GO (exit 0) when cpu some avg10 < 40 and mem ok", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" }, ["--for", "full-suite"]);
  assert.equal(r.status, 0, `expected GO (exit 0), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> GO/);
  assert.match(r.stdout, /cpu_stall\(some avg10\)=10\.00  \[limit 40\]   ok/);
  assert.match(r.stdout, /mem_avail=4000MB             \[limit 2048\] ok/);
});

test("AC3 — gate returns WAIT (exit 1) when cpu some avg10 >= 40 (busy-loop control is the live form)", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "84.77", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" }, ["--for", "full-suite"]);
  assert.equal(r.status, 1, `expected WAIT (exit 1), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> WAIT: CPU 饥饿/);
  assert.match(r.stdout, /cpu_stall\(some avg10\)=84\.77  \[limit 40\]   WAIT/);
});

test("AC3 — report mode always exits 0 even under a WAIT verdict (scoped operator can always read)", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "84.77" }, []);
  assert.equal(r.status, 0, `report mode must exit 0, got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> WAIT: CPU 饥饿/);
});

// ── fail-closed on an unmeasurable signal (no quiet lying) ────────────────────────────────────────
test("gate FAILS CLOSED when /proc/pressure/cpu is unreadable (kernel without PSI)", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "unmeasurable", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" }, ["--for", "full-suite"]);
  assert.equal(r.status, 1, `unmeasurable CPU must be WAIT (fail-closed), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /UNMEASURABLE/, "the output must say UNMEASURABLE, not a fake number");
  assert.match(r.stdout, /fail-closed/, "the verdict must explain the fail-closed decision");
});

test("gate FAILS CLOSED when free -m is unreadable", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "unmeasurable" }, ["--for", "full-suite"]);
  assert.equal(r.status, 1, `unmeasurable mem must be WAIT (fail-closed), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /mem_avail=UNMEASURABLE/, "the output must say UNMEASURABLE");
});

// ── AC6: mem_avail < 2048MB → WAIT + RSS top-5 ─────────────────────────────────────────────────────
test("AC6 — mem_avail < 2048MB refuses the full suite and prints the RSS top-5", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "1000" }, ["--for", "full-suite"]);
  assert.equal(r.status, 1, `expected WAIT (exit 1), got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /mem_avail=1000MB             \[limit 2048\] WAIT/);
  assert.match(r.stdout, /=> WAIT: 内存不足/);
  assert.match(r.stdout, /RSS top-5/, "AC6 must print the RSS top-5 when refusing on memory");
  assert.match(r.stdout, /PID\s+PPID\s+RSS\s+COMMAND/, "RSS listing must actually run ps (header row)");
});

test("AC6 — RSS top-5 is NOT printed when memory is fine (only on the refuse path)", () => {
  const r = runGate({ RESOURCE_GATE_TEST_CPU_AVG10: "10", RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000" }, ["--for", "full-suite"]);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /RSS top-5/);
});

// ── AC10: orphaned node procs on their own line, excluded from the verdict ─────────────────────────
test("AC10 — orphaned node procs (ppid=1, cwd deleted) are listed on their own line and do NOT flip the verdict", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "10",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_ORPHANS: "111:/home/yale/work/quay-worktrees/a (deleted);222:/home/yale/work/quay-worktrees/b (deleted)",
    },
    ["--for", "full-suite"]
  );
  assert.equal(r.status, 0, `orphans are informational — must NOT flip GO, got ${r.status}\n${r.stdout}`);
  const orphanLines = r.stdout.split("\n").filter((l) => l.startsWith("orphan_node:"));
  assert.equal(orphanLines.length, 2, `expected 2 orphan lines, got:\n${r.stdout}`);
  assert.match(orphanLines[0], /111:\/home\/yale\/work\/quay-worktrees\/a \(deleted\)/);
  assert.match(orphanLines[1], /222:\/home\/yale\/work\/quay-worktrees\/b \(deleted\)/);
});

// ── AC5/AC1/AC3: derived default concurrency = max(1, floor(nproc / amplification)) ────────────────
test("AC5 — formula derives max(1, floor(nproc/amp)); the DEFAULT executes that formula (not a constant)", () => {
  // The REAL formula from scripts/test.sh (default_concurrency_formula), run with test seams.
  // AMPLIFICATION = 1.0 since the AC5 cost-side experiment ran
  // (gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible, 2026-08-08):
  // zero cancelled at concurrency 4 AND 8 on the same selected set; nproc is the wall-clock sweet
  // spot. The old 2.1 guard is now reachable only via the explicit seam (it remains valid to prove
  // the formula shape). Default on 4 cores = nproc = 4 (no longer 1).
  assert.equal(derivedConcurrency(4, 1.0), 4, "4 cores / 1.0 → nproc (the cost-side-verified default)");
  assert.equal(derivedConcurrency(16, 1.0), 16, "16 cores / 1.0 → 16");
  assert.equal(derivedConcurrency(4, 2.1), 1, "4 cores / 2.1 → 1 (the old unproven-conservative guard)");
  assert.equal(derivedConcurrency(1, 1.0), 1, "floor(nproc/amp) must clamp at 1 (max(1, ...))");
  assert.equal(derivedConcurrency(8, 1.0), 8, "8 cores / 1.0 → 8");
  // AC1/AC3 of gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived:
  // the EFFECTIVE default (default_test_concurrency) must equal the derived formula on the REAL host
  // — the 2026-08-03 TEMPORARY pin to 8 was reverted (that drift: docs/tests said derived while the
  // code returned a constant). This assertion directly executes the real function, so a future
  // constant-return regression goes RED here (the Contract's control clause).
  const realNproc = Number(execSync("nproc").toString().trim());
  assert.equal(
    currentDefaultConcurrency(),
    derivedConcurrency(realNproc, 1.0),
    "default_test_concurrency must return the derived value max(1, floor(nproc/1.0)) = nproc on the real host (cost-side-verified 2026-08-08 — see the REVERT HISTORY entry)"
  );
});

test("AC5b — the derivation is BUDGET-AWARE: in_use node processes subtract from nproc (cross-layer total budget, AC1)", () => {
  // gap-test-concurrency-cap-does-not-scope-nested-spawns AC1/AC4: the worker derivation reads the
  // shared total-process budget (process-budget.sh) — total_budget = nproc, and in_use (node-MainThread
  // procs ALREADY running across all worktrees) is subtracted, so nested spawns can no longer multiply
  // beyond the cap. The old per-layer derivation ignored in_use entirely (each worker derived nproc,
  // so N nested runners on 4 cores = N×4 procs = the 17-19 / load 18.70 defect).
  assert.equal(derivedConcurrency(4, 1.0, 0), 4, "idle (in_use=0) → nproc, the cost-side sweet spot");
  assert.equal(derivedConcurrency(4, 1.0, 2), 2, "2 node procs already running → 4-2 = 2");
  assert.equal(derivedConcurrency(4, 1.0, 3), 1, "3 running → 4-3 = 1");
  assert.equal(derivedConcurrency(4, 1.0, 8), 1, "budget exhausted (in_use ≥ budget) → clamp at 1, never 0/negative");
  assert.equal(derivedConcurrency(16, 1.0, 12), 4, "16 cores, 12 running → 4");
  // The shared authority (plugin/scripts/process-budget.sh) reports the same total_budget/in_use/
  // available that the formula consumes (single source).
  const budgetScript = path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh");
  assert.ok(fs.existsSync(budgetScript), "the shared total-budget authority must exist");
  const seam = { ...process.env, RESOURCE_GATE_TEST_NPROC: "4", RESOURCE_GATE_TEST_NODE_PROCS: "3" };
  const b = spawnSync("bash", [budgetScript], { cwd: REPO_ROOT, encoding: "utf8", env: seam });
  assert.equal(b.status, 0, `process-budget.sh must exit 0\n${b.stderr}`);
  assert.match(b.stdout, /total_budget=4/, "total_budget = nproc (the single authority)");
  assert.match(b.stdout, /in_use=3/, "in_use = the running node-MainThread count");
  assert.match(b.stdout, /available=1/, "available = max(0, total_budget - in_use)");
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

test("AC5 — process-budget.sh header documents the counting scope (test procs only; infra is a resident constant)", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "process-budget.sh"), "utf8");
  assert.match(src, /COUNTING SCOPE/, "the header must carry a COUNTING SCOPE section (AC5)");
  assert.match(src, /THROTTLE-ABLE TEST processes|node --test worker|throttle-able/, "the header must state that in_use counts test processes only");
  assert.match(src, /MUST NOT count|NOT counted against the test budget/, "the header must state infra is excluded from the budget");
  assert.match(src, /OVERLOAD PROTECTION RETAINED|RESOURCE_GATE_TEST_PROC_CMDLINES/, "the header must document the retained overload protection / new seam");
});

test("AC5 — scripts/test.sh uses the derived default in its exec lines (no hardcoded 8)", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // All FIVE invocation sites must use the derived default: 4 `exec node --test ...` lines
  // (run_selected, --group-explicit, explicit-file, --scoped <file...>) + 1 `node --test ...`
  // line (--for-task, no exec). The --scoped <file...> site was added by
  // gap-scoped-runs-pay-full-static-check-overhead and correctly uses the derived default.
  const allSites = src.match(/node --test --test-concurrency="\$\(default_test_concurrency\)"/g);
  assert.equal(allSites.length, 5, `expected 5 derived-concurrency invocation sites, got ${allSites.length}`);
  assert.doesNotMatch(src, /--test-concurrency=8/, "no hardcoded 8 may remain in test.sh");
});

// ── AC7: test.sh integration — gate on the full-suite default, skip on scoped runs ─────────────────
test("AC7 — test.sh consults the gate on the full-suite default path and skips it for scoped runs", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  assert.match(src, /resource-gate\.sh" --for full-suite/, "test.sh must invoke the gate in gate mode");
  assert.match(src, /resource_gate_check/, "run_selected must call resource_gate_check");
  assert.match(src, /is_default_set "\$groups"/, "the gate must guard the default full-suite set only");
  assert.match(src, /QUAY_TEST_SKIP_RESOURCE_GATE/, "nested-runner escape hatch must exist");
  // Scoped paths must NOT consult the gate: the --for-task and explicit-file branches never call it.
  const gateCallSites = src.split("\n").filter((l) => l.includes("resource_gate_check"));
  assert.ok(gateCallSites.length >= 1, "resource_gate_check must be called somewhere");
});

// ── single-flight lock (gap-resource-gate-no-single-flight-lock-two-suite-overlap) ──────────────────
// AC1/AC4 — the full-suite default path takes a flock on <git-common-dir>/full-suite.lock held for
// the ENTIRE run, so two concurrent cc8 suites can no longer both see GO and start. The lock is
// COMPLEMENTARY to the resource gate (AC2): the gate prevents "starting into a busy machine", the
// lock prevents "a second suite joining". Structural pin (the two-startup negative control is a live
// harness recorded in the task body): the flock reference exists, the acquire is wired into the
// is_default_set branch ahead of the gate, and the release fires before the full-suite exit.
test("AC1/AC4 — the full-suite default path holds a single-flight flock (full-suite.lock, shared across worktrees)", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // flock(1) reference must exist in test.sh (Contract measure suite_lock ≥ 1).
  assert.match(src, /\bflock\b/, "scripts/test.sh must use flock(1) for the single-flight lock");
  assert.match(src, /full-suite\.lock/, "the lock file must be named full-suite.lock");
  // SHARED across worktrees + the primary checkout via git's common dir (the 2026-08-07 incident
  // was two DIFFERENT worktrees each running a cc8 suite — a per-checkout lock would NOT serialize).
  assert.match(src, /git rev-parse --git-common-dir/, "the lock must resolve via git's common dir so all worktrees contend on the same file");
  // The acquire is called in the SAME is_default_set branch that consults the resource gate
  // (the default full-suite set only) — and BEFORE the gate (serialize first, then load-check).
  // The regex targets the CALL site (full_suite_lock_acquire immediately followed by a newline),
  // not the function definition (which is followed by `()`).
  const callSite = src.match(/full_suite_lock_acquire\n([\s\S]*?)\n\s*fi/);
  assert.ok(callSite, "full_suite_lock_acquire must be called inside an if/fi block (the full-suite default branch)");
  const afterAcquire = callSite[1];
  assert.match(afterAcquire, /resource_gate_check/, "the lock acquire must be followed by the resource gate check in the same block");
  assert.doesNotMatch(afterAcquire, /full_suite_lock_release/, "acquire and release must not share a block");
  // The release must fire before the full-suite exit (after the suite-AFTER assertions).
  assert.match(src, /full_suite_lock_release\n\s*exit "\$code"/, "the lock must be released before the full-suite exit");
  // Nested-runner escape hatches must skip the lock (a nested test.sh inside the running suite
  // must not deadlock against the suite's own lock).
  assert.match(src, /QUAY_TEST_SKIP_RESOURCE_GATE/, "nested-runner escape hatch must exist for the lock");
  assert.match(src, /QUAY_TEST_NESTED/, "same-root nested guard must exist for the lock");
});

// ── --for full-suite arg validation ────────────────────────────────────────────────────────────────
test("gate rejects an unknown --for target with exit 2 (usage)", () => {
  const r = runGate({}, ["--for", "bogus"]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /usage:/);
});

// ── gap-worktree-scoped-runs-consume-resources-but-produce-no-signal: AC1/AC2/AC3 ──────────────────
// The coordination root of the deadlock: a worktree's heavy scoped verification consumes the machine
// (resource gate WAIT) while producing NO observable signal — so the main-repo full suite (the signal
// subagents actually wait for) is blocked, and nobody produces the waited-for signal. Two fixes:
//   AC1 — the gate REPORTS worktree_node_tests (a live observable: how many node --test procs are
//         running from linked worktrees) + caller_scope, so the worktree load is visible.
//   AC2 — the main-repo full-suite caller passes --main-repo-priority; the gate then lets the
//         main-repo suite proceed over worktree scoped load (deferrable), never permanently blocked.
//   AC3 — negative control: the worktree load is observable via the gate EVEN IF the worktree writes
//         no state file (the "no signal" half of the deadlock is closed by the gate's own signal).

test("AC1 — the gate reports worktree_node_tests + caller_scope (the observable worktree signal), seam-controlled", () => {
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS/, "the worktree_node_tests test seam must exist");
  assert.match(src, /RESOURCE_GATE_TEST_CALLER_SCOPE/, "the caller_scope test seam must exist");
  const r = runGate({
    RESOURCE_GATE_TEST_CPU_AVG10: "10",
    RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
    RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
    RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
  });
  assert.match(r.stdout, /worktree_node_tests=6\s+caller_scope=main/, "report mode must print the worktree signal line");
});

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

test("AC2 — main-repo priority: --main-repo-priority lets the main-repo full suite proceed over worktree scoped load (WAIT->GO at cpu=50)", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "50",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 0, `main-repo suite must GO over worktree load; got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /worktree_priority: ON/, "the priority override must be announced");
  assert.match(r.stdout, /=> GO: 主仓 full-suite 优先/, "the verdict must name the priority rule");
});

test("AC2 negative — the SAME load WITHOUT --main-repo-priority stays WAIT (the override is opt-in)", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "50",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
    },
    ["--for", "full-suite"],
  );
  assert.equal(r.status, 1, `without the priority flag the gate must WAIT; got ${r.status}\n${r.stdout}`);
  assert.match(r.stdout, /=> WAIT: CPU 饥饿/);
});

test("AC2 negative — a WORKTREE caller passing --main-repo-priority stays WAIT (a worktree full-suite is itself deferrable)", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "50",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "worktree",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
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
    },
    ["--for", "full-suite", "--main-repo-priority"],
  );
  assert.equal(r.status, 1, `cpu=90 above the ceiling must stay WAIT; got ${r.status}\n${r.stdout}`);
});

test("AC2 negative — worktree load below the min threshold (4) does NOT trigger the override", () => {
  const r = runGate(
    {
      RESOURCE_GATE_TEST_CPU_AVG10: "50",
      RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
      RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
      RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "2",
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
