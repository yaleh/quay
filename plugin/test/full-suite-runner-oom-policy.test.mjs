// @test-group lowconc
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-10-10 child-spawn (spawns a real systemd-run scope + a real full-suite-runner.ts + a python memory hog; under suite load the scope/spawn is start-delayed ⇒ classify load-sensitive, isolate-rerun)
//
// full-suite-runner-oom-policy.test.mjs — gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable.
//
// The defect: the suite cgroup scope passed only MemoryMax/CPUQuota/TasksMax — NO `OOMPolicy`. systemd's
// DEFAULT scope OOMPolicy is `stop`: ONE OOM-killed process TERMs the WHOLE scope, so test.sh's abort trap
// prints "terminated by an external signal" and every remaining test is cancelled with NO failing file
// (the 2026-10-10 claudecodeui phenomenon: 16 occurrences in 136 suite scopes, every one `Result=oom-kill`
// in journalctl). The fix (this task): `OOMPolicy=continue` on the suite scope + a per-run cgroup
// memory/OOM evidence file + worker-driver attribution.
//
// This file covers: AC1 (argv carries OOMPolicy; probe/real share the property source), AC3 (evidence
// content + per-run file), AC2 (REAL cgroup negative control through the runner), AC5 (the falsification
// controls: dropping OOMPolicy ⇒ the scope TERMs; single-slot evidence ⇒ overwrite).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { runRunner, waitExit, fakeSuite, readState } from "./helpers/full-suite-runner-harness.mjs";

import {
  buildSystemdRunArgv,
  DEFAULT_SYSTEMD_RUN_LIMITS,
  systemdRunAvailable,
  parseSystemdBytesToBytes,
  readCgroupMemoryEvents,
  readCgroupMemoryPeak,
  startSuiteMemorySampler,
} from "../scripts/full-suite-runner.ts";
import { scopeProbeArgv, SCOPE_PROPERTY_ARGS } from "../../packages/quay/src/systemd-scope.ts";

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────

/** The `-p <assign>` VALUES in an argv (the property assignments, ⛔ not the flags). */
function propertyPairs(argv) {
  const out = [];
  for (let i = 0; i < argv.length - 1; i++) if (argv[i] === "-p") out.push(argv[i + 1]);
  return out;
}

/** Drop a `-p <assign>` pair (by assignment value) from an argv — the mutation control's argv surgery. */
function withoutProperty(argv, value) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-p" && argv[i + 1] === value) { i++; continue; }
    out.push(argv[i]);
  }
  return out;
}

/** Spawn an argv, collect stdout/stderr, resolve on exit (code + signal). */
function spawnCmd(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, out, err }));
  });
}

/** A fake suite that spawns a memory hog + a surviving sibling. The hog over-allocates past the 300M
 *  scope cap and is OOM-killed; the sibling touches `siblingMarker` after 4s. `expectSurvive` chooses
 *  whether the suite blocks on the sibling (a live scope) or exits immediately after the hog dies. */
function oomSuiteScript(siblingMarker) {
  return [
    "set -u",
    `python3 -c "bufs=[]"$'\\n'"for i in range(2000): bufs.append(bytearray(1024*1024))" &`,
    "HOG=$!",
    `( sleep 4; touch ${JSON.stringify(siblingMarker)} ) &`,
    "SIB=$!",
    "wait $HOG",
    'echo "HOG_RC=$?"',
    "wait $SIB",
    "echo '# tests 1'",
    "echo '# pass 0'",
    "echo '# fail 1'",
    "echo '# cancelled 0'",
    "exit 1",
  ].join("\n");
}

// ── AC1: the suite scope argv carries OOMPolicy=continue; probe + real call share the property source ──

test("AC1 unit — buildSystemdRunArgv sets OOMPolicy=continue and the availability probe exercises the SAME property list", () => {
  const argv = buildSystemdRunArgv("bash scripts/test.sh", DEFAULT_SYSTEMD_RUN_LIMITS);
  assert.ok(
    argv.includes("OOMPolicy=continue"),
    "the suite scope MUST set OOMPolicy=continue — else systemd's default scope policy (stop) TERMs the whole suite when one process is OOM-killed",
  );
  // 硬规则 2: pair the membership reading with a KNOWN-POSITIVE of the SAME predicate on the shared list.
  assert.ok(SCOPE_PROPERTY_ARGS.includes("OOMPolicy=continue"), "the shared property list really does carry the property (the predicate is not vacuous)");

  // 同源 (AC1's second half): every property the PROBE exercises must also be carried by the REAL argv —
  // so 「probe green」 structurally implies the real `systemd-run` accepts them. Change the list in ONE
  // place and both move together.
  const probeProps = propertyPairs(scopeProbeArgv());
  const realProps = propertyPairs(buildSystemdRunArgv("true", { memoryMax: "", cpuQuota: "", tasksMax: "", memorySwapMax: "" }));
  assert.ok(probeProps.length > 0, "the probe carries at least one property");
  for (const p of probeProps) {
    assert.ok(
      realProps.includes(p),
      `the probe property ${JSON.stringify(p)} must also be on the real suite scope argv — else a green probe does not imply the real call succeeds`,
    );
  }
  // the availability probe is a REAL transient scope of the same shape (binary + --scope).
  assert.equal(scopeProbeArgv()[0], "systemd-run");
  assert.ok(scopeProbeArgv().includes("--scope"));
});

test("AC1 unit — MemorySwapMax flows through only when explicitly set (⛔ no new default property)", () => {
  assert.ok(!buildSystemdRunArgv("true", DEFAULT_SYSTEMD_RUN_LIMITS).includes("MemorySwapMax="), "the default argv adds NO MemorySwapMax");
  const swapless = buildSystemdRunArgv("true", { memoryMax: "300M", cpuQuota: "", tasksMax: "", memorySwapMax: "0" });
  assert.ok(swapless.includes("MemorySwapMax=0"), "an explicit MemorySwapMax is passed");
});

// ── AC3: the per-run evidence file's content + two runs never overwrite ───────────────────────────────

test("AC3 unit — the per-run evidence file carries peakBytes/memoryMaxBytes/oomKill/phase/runId, and two runs get two files", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oom-ev-"));
  const cgroupDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oom-cg-"));
  try {
    fs.writeFileSync(path.join(cgroupDir, "memory.peak"), `${321 * 1024 * 1024}\n`);
    fs.writeFileSync(path.join(cgroupDir, "memory.events"), "low 0\nhigh 4\nmax 0\noom 3\noom_kill 2\n");

    // (a) the parsers read the REAL cgroup v2 shapes.
    assert.equal(readCgroupMemoryPeak(cgroupDir), 321 * 1024 * 1024);
    assert.deepEqual(readCgroupMemoryEvents(cgroupDir), { oom: 3, oomKill: 2 });
    // 硬规则 6: a missing file is null (缺值), never a fabricated 0.
    assert.equal(readCgroupMemoryEvents(path.join(cgroupDir, "nope")), null);
    assert.equal(readCgroupMemoryPeak(path.join(cgroupDir, "nope")), null);
    assert.equal(parseSystemdBytesToBytes("300M"), 300 * 1024 * 1024);

    // (b) the sampler lands one file per runId, carrying the required keys. The OOM is introduced AFTER
    //     the sampler's first reading so `phase` is latched on the 0→>0 edge (the phase it happened in).
    let phaseNow = "static";
    let oomKillNow = 0;
    const writeEvents = () => fs.writeFileSync(path.join(cgroupDir, "memory.events"), `low 0\nhigh 0\nmax 0\noom ${oomKillNow > 0 ? 1 : 0}\noom_kill ${oomKillNow}\n`);
    writeEvents();
    const sampler = startSuiteMemorySampler({
      cgroupDirProvider: () => cgroupDir,
      stateDir,
      runId: "run-one",
      memoryMaxBytes: 314572800,
      phaseProvider: () => phaseNow,
      intervalMs: 20,
    });
    phaseNow = "main";
    oomKillNow = 2;
    writeEvents();
    await new Promise((r) => setTimeout(r, 80)); // let one interval sample observe the OOM
    const ev1 = sampler.stop();
    assert.equal(ev1.runId, "run-one");
    assert.equal(ev1.peakBytes, 321 * 1024 * 1024, "peakBytes is the memory.peak high-water mark");
    assert.equal(ev1.memoryMaxBytes, 314572800, "memoryMaxBytes is the scope limit in bytes");
    assert.equal(ev1.oomKill, 2, "oomKill is the memory.events oom_kill counter");
    assert.equal(ev1.phase, "main", "phase = the phase the OOM first became visible in (latched on the 0→>0 edge, not the start phase)");
    const f1 = path.join(stateDir, "suite-memory-evidence-run-one.json");
    assert.ok(fs.existsSync(f1), "the evidence lands at <stateDir>/suite-memory-evidence-<runId>.json");
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f1, "utf8"))).sort(), [
      "capturedAt", "memoryMaxBytes", "oom", "oomKill", "peakBytes", "phase", "runId", "samples", "scopeUnit",
    ]);

    // (c) a SECOND run with a different runId ⇒ a SECOND file; the first is untouched (⛔ not a single slot).
    startSuiteMemorySampler({
      cgroupDirProvider: () => cgroupDir,
      stateDir,
      runId: "run-two",
      memoryMaxBytes: null,
      phaseProvider: () => "serial",
      intervalMs: 20,
    }).stop();
    const files = fs.readdirSync(stateDir).filter((f) => f.startsWith("suite-memory-evidence-")).sort();
    assert.deepEqual(files, ["suite-memory-evidence-run-one.json", "suite-memory-evidence-run-two.json"], "two consecutive runs ⇒ two files, no overwrite");

    // (d) an unreadable cgroup ⇒ samples:0 and peakBytes null (an INERT reading, ⛔ not a fabricated 0).
    const inert = startSuiteMemorySampler({
      cgroupDirProvider: () => null,
      stateDir,
      runId: "run-inert",
      memoryMaxBytes: null,
      phaseProvider: () => "main",
      intervalMs: 20,
    }).stop();
    assert.equal(inert.samples, 0);
    assert.equal(inert.peakBytes, null, "no cgroup ⇒ peakBytes is null (缺值 ≠ 0, 硬规则 6)");
    assert.equal(inert.oomKill, 0);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(cgroupDir, { recursive: true, force: true });
  }
});

// ── AC5(a): the falsification control — dropping OOMPolicy makes ONE OOM TERM the whole scope ─────────

test(
  "AC5 negative control — WITHOUT OOMPolicy=continue the whole scope is TERM'd; WITH it the sibling survives (real cgroup)",
  // An independent NOT-EVALUATED value: a host where the probe cannot run reports a skip, never a silent pass.
  { skip: systemdRunAvailable() ? false : "not-evaluated: systemd-run --user --scope (+OOMPolicy) not usable on this host — the OOM reading was not taken" },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oom-neg-"));
    try {
      const withMark = path.join(dir, "sibling-with");
      const withoutMark = path.join(dir, "sibling-without");

      const withScript = path.join(dir, "suite-with.sh");
      fs.writeFileSync(withScript, "#!/usr/bin/env bash\n" + oomSuiteScript(withMark) + "\n", { mode: 0o755 });
      const withoutScript = path.join(dir, "suite-without.sh");
      fs.writeFileSync(withoutScript, "#!/usr/bin/env bash\n" + oomSuiteScript(withoutMark) + "\n", { mode: 0o755 });

      const base = buildSystemdRunArgv(`bash ${withScript}`, { memoryMax: "300M", cpuQuota: "", tasksMax: "", memorySwapMax: "0" });
      const withContinue = base;
      const withoutContinue = withoutProperty(base, "OOMPolicy=continue");
      // the mutation is EXACTLY the property under test — nothing else moved.
      assert.equal(withContinue.includes("OOMPolicy=continue"), true);
      assert.equal(withoutContinue.includes("OOMPolicy=continue"), false, "the negative control's argv really dropped the property");

      const withRes = await spawnCmd(withContinue);
      // OOMPolicy=continue: the hog dies, the sibling survives, the scope exits with the script's own status (1).
      assert.ok(fs.existsSync(withMark), `with OOMPolicy=continue the sibling MUST survive (scope not TERM'd); stdout=${withRes.out} stderr=${withRes.err}`);
      assert.match(withRes.out, /HOG_RC=137/, "the hog was OOM-killed (137) and the suite continued to observe it");
      assert.equal(withRes.signal, null, "the scope was NOT signal-terminated (it exited on its own status)");
      assert.equal(withRes.code, 1, "the scope returned the suite's own non-zero exit, not a TERM");

      // DEFAULT OOMPolicy (stop): the SAME suite, minus `OOMPolicy=continue` ⇒ one OOM TERMs the whole scope.
      const withoutRes = await spawnCmd(withoutContinue);
      assert.ok(!fs.existsSync(withoutMark), `without OOMPolicy the whole scope is TERM'd ⇒ the sibling never survives; stdout=${withoutRes.out} stderr=${withoutRes.err}`);
      assert.ok(
        withoutRes.signal === "SIGTERM" || withoutRes.code === 143,
        `without OOMPolicy the scope is signal-terminated (got code=${withoutRes.code} signal=${withoutRes.signal}) — this is the defect's shape`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

// ── AC2: the RUNNER, under a real 300M scope, returns the suite's own exit + lands oom_kill>=1 ────────

test(
  "AC2 — a REAL 300M suite scope OOM-kills one process: the sibling survives, the runner reports a failed (not infra-error) red, and the evidence records oomKill>=1",
  { skip: systemdRunAvailable() ? false : "not-evaluated: systemd-run --user --scope (+OOMPolicy) not usable on this host — the runner OOM round was not run" },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oom-run-"));
    const marker = path.join(root, "sibling-alive");
    const { f, dir } = fakeSuite(oomSuiteScript(marker));
    const runId = "oom-r1";
    try {
      const child = runRunner({
        root,
        command: `bash ${f}`,
        laneCount: 1,
        runId,
        // a REAL scope with a 300M cap and NO swap escape ⇒ the hog must be OOM-killed, deterministically.
        env: {
          QUAY_TEST_SYSTEMD_RUN_AVAILABLE: "1",
          QUAY_TEST_SKIP_SYSTEMD_RUN: "0",
          QUAY_TEST_SYSTEMD_RUN_LIMITS: "MemoryMax=300M MemorySwapMax=0",
        },
      });
      const { code } = await waitExit(child);
      assert.notEqual(code, 0, "the runner exits non-zero (the suite went red)");

      // (1) the sibling survived — OOMPolicy=continue kept the scope alive after the OOM.
      assert.ok(fs.existsSync(marker), "the sibling process survived the in-scope OOM (the whole scope was NOT TERM'd)");

      // (2) the red is the suite's OWN failure (reason=failed), NOT a signal-kill of the whole scope
      //     (reason=infra-error) — the pre-fix shape.
      const s = readState(root);
      assert.equal(s.state, "red");
      assert.equal(s.reason, "failed", `a non-zero suite exit is a real failure conclusion, got reason=${s.reason}`);

      // (3) the per-run evidence file records the OOM the kernel actually performed.
      const evPath = path.join(root, ".quay", `suite-memory-evidence-${runId}.json`);
      assert.ok(fs.existsSync(evPath), `the per-run evidence file was written (${evPath})`);
      const ev = JSON.parse(fs.readFileSync(evPath, "utf8"));
      assert.ok(ev.oomKill >= 1, `the evidence records the cgroup OOM kill (oomKill=${ev.oomKill})`);
      assert.equal(ev.runId, runId, "the evidence is keyed by THIS round's runId");
      assert.equal(ev.memoryMaxBytes, 300 * 1024 * 1024, "the evidence carries the scope's MemoryMax in bytes");
      assert.ok(typeof ev.peakBytes === "number" && ev.peakBytes > 0, `the evidence carries the observed peak (${ev.peakBytes})`);
      assert.ok(typeof ev.phase === "string" && ev.phase.length > 0, `the evidence names the phase (${ev.phase})`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
