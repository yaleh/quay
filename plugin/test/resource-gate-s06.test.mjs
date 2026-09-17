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

// SPLIT from resource-gate.test.mjs by gap-suite-split-15-over-30s-test-files — shard 6/8 (8 tests). Shared fixtures: ./helpers/resource-gate-harness.mjs (single source).

import { test } from "node:test";
import { GATE, REPO_ROOT, SUITE_SLOT_LIB, TEST_SH, assert, fs, path, runGate, spawn, spawnSync } from "./helpers/resource-gate-harness.mjs";

test("AC7 — test.sh consults the gate on the full-suite default path and skips it for scoped runs", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // resource_gate_check moved out of test.sh into runner-static-gate.ts (gap-ac128-hub-split-harness-concerns)
  const staticGateSrc = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "runner-static-gate.ts"), "utf8");
  assert.match(staticGateSrc, /resource-gate\.sh" --for full-suite/, "resource_gate_check must invoke the gate in gate mode");
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

// ── gap-suite-lock-starvation-long-validation-hold: lock-hold cap + lock_hold_ms ───────────────────
// AC1 (能取假): a validation-type long task must not hold a single-flight slot for hours. The hold cap
//   lives in the HOLDING process (test.sh → suite-slot-lib.sh watchdog), ⛔ not a worker-driver kill —
//   the suite process can outlive its worker session (the suite-load-sampler orphan), so an outside
//   tracker would be the SAME orphanization defect.
// AC2 (能取假): lock_hold_ms rides the records so「长时间持锁」is distinguishable from「worker 慢」.


test("gap-suite-lock-starvation AC1/AC2 (structural) — the hold cap + lock_hold_ms markers live in the holding process (test.sh + suite-slot-lib.sh), not worker-driver", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  const lib = fs.readFileSync(SUITE_SLOT_LIB, "utf8");
  assert.match(src, /FULL_SUITE_LOCK_HOLD_MAX_S/, "test.sh must carry the hold-cap knob (T seconds)");
  assert.match(src, /spawn_suite_lock_hold_watchdog/, "test.sh must spawn the hold-cap watchdog after acquiring the slot");
  assert.match(src, /__OVERHEAD__ lock_hold_ms=/, "test.sh must emit lock_hold_ms at release (the held half, alongside lock_wait_ms)");
  assert.match(lib, /spawn_suite_lock_hold_watchdog/, "the watchdog spawn lives in suite-slot-lib.sh (single definition point, sourceable/testable)");
  assert.match(lib, /lock_hold_exceeded=1/, "the watchdog must record a fail-loud lock_hold_exceeded=1 marker (never silent)");
});


test("gap-suite-lock-starvation AC1/AC3 (behavioral) — the watchdog releases the slot after T (a waiter acquires within ~T, not starved) + fail-loud marker", () => {
  const script = `
    set -u
    . "${SUITE_SLOT_LIB}"
    tmp="$(mktemp -d)"
    base="\${tmp}/full-suite.lock"
    exec {fd}>"\${base}.0"
    flock -n "\${fd}" || { echo "PRE-FLOCK-FAILED"; exit 1; }
    flag="\${tmp}/hold.flag"
    : > "\${flag}"
    wpid="$(spawn_suite_lock_hold_watchdog "\${fd}" "\${flag}" "$$" "2")"
    if [ -e "\${flag}" ]; then echo "SPAWN-NON-BLOCKING"; else echo "SPAWN-BLOCKED"; fi
    sleep 3
    exec {probe}<>"\${base}.0"
    if flock -n "\${probe}"; then echo "PROBE-ACQUIRED"; else echo "PROBE-STILL-HELD"; fi
    flock -u "\${probe}" 2>/dev/null || true
    exec {probe}>&- 2>/dev/null || true
    if [ -e "\${flag}" ]; then echo "FLAG-PRESENT"; else echo "FLAG-REMOVED"; fi
    wait "\${wpid}" 2>/dev/null || true
    exec {fd}>&- 2>/dev/null || true
    rm -rf "\${tmp}"
  `;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 15_000 });
  assert.equal(r.status, 0, `watchdog script must exit 0, got status=${r.status} stderr=${r.stderr}`);
  assert.match(r.stdout, /SPAWN-NON-BLOCKING/, `the watchdog spawn must NOT block the caller (⛔ 命令替换阻塞 T 秒 = 生产 30min hang), got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /SPAWN-BLOCKED/, "the spawn must return immediately (a blocked spawn waits T for the watchdog to fire)");
  assert.match(r.stdout, /PROBE-ACQUIRED/, `a waiter must acquire the slot after the cap (within ~T), got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /PROBE-STILL-HELD/, "the slot must NOT still be held after the cap");
  assert.match(r.stdout, /FLAG-REMOVED/, "the watchdog must remove the flag after releasing (no lingering)");
  assert.match(r.stderr, /lock_hold_exceeded=1/, `the watchdog must emit the fail-loud marker, got stderr:\n${r.stderr}`);
});


test("gap-suite-lock-starvation AC3 (negative control) — WITHOUT the watchdog the slot is still held after the same window (the release is attributable to the cap, not an artifact)", () => {
  const script = `
    set -u
    tmp="$(mktemp -d)"
    base="\${tmp}/full-suite.lock"
    exec {fd}>"\${base}.0"
    flock -n "\${fd}" || { echo "PRE-FLOCK-FAILED"; exit 1; }
    sleep 1
    # probe from a SEPARATE process (fresh OFD) — must still be held without a watchdog
    exec {probe}<>"\${base}.0"
    if flock -n "\${probe}"; then echo "PROBE-ACQUIRED"; else echo "PROBE-STILL-HELD"; fi
    exec {probe}>&- 2>/dev/null || true
    exec {fd}>&- 2>/dev/null || true
    rm -rf "\${tmp}"
  `;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 15_000 });
  assert.equal(r.status, 0, `negative-control script must exit 0, got status=${r.status}`);
  assert.match(r.stdout, /PROBE-STILL-HELD/, "without the watchdog the slot stays held (the positive release is the cap's doing)");
});

// ── gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in: dead-holder-only mode ────────────
// AC2 (能取假): the fan-in lock's hold = merge→suite→ff legitimately EXCEEDS any fixed timer.
//   Reusing the suite lock's FULL_SUITE_LOCK_HOLD_MAX_S (1800s) cut the lock at 30min mid-suite ⇒ the ff
//   ran lock-less (ff-race re-exposed). The fix: `timer-cut=0` disables path (c) (the timer yield) while
//   path (b) (crash-autorelease) stays. This behavioral test proves a LIVE holder is NEVER cut in dead-
//   holder-only mode — the contrast to the default (timer-cut=1) AC1/AC3 test above, where the SAME window
//   DOES release the slot.


test("gap-full-suite-lock-hold-watchdog-threshold (dead-holder-only) — timer-cut=0 never cuts a LIVE holder past the would-be timer (no path (c)), and emits no marker", () => {
  const script = `
    set -u
    . "${SUITE_SLOT_LIB}"
    tmp="$(mktemp -d)"
    base="\${tmp}/full-suite.lock"
    exec {fd}>"\${base}.0"
    flock -n "\${fd}" || { echo "PRE-FLOCK-FAILED"; exit 1; }
    flag="\${tmp}/hold.flag"
    : > "\${flag}"
    # timer-cut=0 (dead-holder-only): the 2s max-s is a placeholder that must NOT fire a timer cut.
    wpid="$(spawn_suite_lock_hold_watchdog "\${fd}" "\${flag}" "$$" "2" "0")"
    # Sleep PAST the 2s timer window: a LIVE holder must STILL hold the slot (no (c) cut).
    sleep 3
    exec {probe}<>"\${base}.0"
    if flock -n "\${probe}"; then echo "PROBE-ACQUIRED"; else echo "PROBE-STILL-HELD"; fi
    flock -u "\${probe}" 2>/dev/null || true
    exec {probe}>&- 2>/dev/null || true
    if [ -e "\${flag}" ]; then echo "FLAG-PRESENT"; else echo "FLAG-REMOVED"; fi
    rm -f "\${flag}"          # normal release: flag removed ⇒ the watchdog exits (path a), no leak
    wait "\${wpid}" 2>/dev/null || true
    exec {fd}>&- 2>/dev/null || true
    rm -rf "\${tmp}"
  `;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 15_000 });
  assert.equal(r.status, 0, `dead-holder script must exit 0, got status=${r.status} stderr=${r.stderr}`);
  assert.match(r.stdout, /PROBE-STILL-HELD/, `timer-cut=0 must NOT release a live holder past the would-be timer (no path (c)), got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /PROBE-ACQUIRED/, "a waiter must NOT acquire the slot in dead-holder-only mode (the holder is alive)");
  assert.match(r.stdout, /FLAG-PRESENT/, "the flag must stay present (the watchdog did not remove it)");
  assert.doesNotMatch(r.stderr, /lock_hold_exceeded=1/, "dead-holder-only mode must never emit the timer-cut marker");
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
