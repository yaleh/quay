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

/** Extract the REAL default_concurrency_formula from scripts/test.sh and run it with seams. */
function derivedConcurrency(nproc, amplification) {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // The formula lives in default_concurrency_formula; default_test_concurrency CALLS it (the
  // 2026-08-03 TEMPORARY pin to 8 was reverted by
  // gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived).
  const fnMatch = src.match(/default_concurrency_formula\(\) \{[^]*?\n\}/);
  assert.ok(fnMatch, "scripts/test.sh must define default_concurrency_formula()");
  const script = `${fnMatch[0]}\nRESOURCE_GATE_NPROC=${nproc}\nRESOURCE_GATE_AMPLIFICATION=${amplification}\nprintf '%s' "$(default_concurrency_formula)"\n`;
  const res = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(res.status, 0, `derivedConcurrency subshell failed: ${res.stderr}`);
  return Number(res.stdout.trim());
}

/** Directly EXECUTE default_test_concurrency (the real effective default) and return its value.
 *  This is the AC1/AC3 "test the real value, not the spelling" seam: it runs the actual function
 *  the exec lines call, so a function that returns a constant instead of the derived formula is
 *  caught HERE, not by a call-site-spelling assertion. */
function currentDefaultConcurrency() {
  const src = fs.readFileSync(TEST_SH, "utf8");
  const fnMatch = src.match(/default_test_concurrency\(\) \{[^]*?\n\}/);
  assert.ok(fnMatch, "scripts/test.sh must define default_test_concurrency()");
  // default_test_concurrency calls default_concurrency_formula — extract BOTH functions so the
  // isolated subshell is self-contained (matches the ## Contract effective_concurrency measure).
  const formulaMatch = src.match(/default_concurrency_formula\(\) \{[^]*?\n\}/);
  assert.ok(formulaMatch, "scripts/test.sh must define default_concurrency_formula()");
  const script = `${formulaMatch[0]}\n${fnMatch[0]}\nprintf '%s' "$(default_test_concurrency)"\n`;
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
