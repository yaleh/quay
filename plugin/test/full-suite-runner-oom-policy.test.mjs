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

import { runRunner, waitExit, fakeSuite, readState, lastRoundRecord } from "./helpers/full-suite-runner-harness.mjs";

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
    // gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files AC9 — `telemetry`
    // is the NEW key: 「这一维评估过没有」的独立取值（`ok` here — both memory.events and memory.peak read).
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f1, "utf8"))).sort(), [
      "capturedAt", "memoryMaxBytes", "oom", "oomKill", "peakBytes", "phase", "runId", "samples", "scopeUnit", "telemetry",
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
    // gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files AC9 — 「读不到」
    // 从 `null`/`0` 改成**具名的 `"unknown"`**：0 会被读成「读到且无 OOM」，null 会被读成「这个桶不重要」。
    // 两个都不是「本维度评估过没有」的答案（硬规则 3b）。
    assert.equal(inert.peakBytes, "unknown", "no cgroup ⇒ peakBytes is `unknown` (⛔ 不是 0，也不是 null)");
    assert.equal(inert.oomKill, "unknown", "no cgroup ⇒ oomKill is `unknown` (⛔ 不是 0)");
    assert.equal(inert.telemetry, "unknown", "…and the dimension itself is marked not-evaluated");
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

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files
//
// 病（轮 2660 实测）：全量套件被 OOM 杀掉主阶段的一大半——579 个计划文件里 514 个一行都没产出——而
// verdict 仍写 green（pass:466 fail:0），fan-in 照常 suite-end exit 0 → ac-gate → flip-done → ff。
// OOM 证据（oomKill=4）写在旁路文件里、**从未被 verdict 消费**。⇒「跑不成」与「跑过且全绿」同形。
//
// 这一节钉住修法的四半：
//   ① 计划集（执行前落盘）+ 终态集 ⇒ 缺任何一个计划文件 = `not-evaluated: incomplete`（列出缺的）；
//   ② OOM（`oom_kill` 上升）= 永不 green；
//   ③ fan-in 见到「没跑全 / 被 OOM 杀」的标记就**整条重跑链都不进**（隔离重跑移除了造成 OOM 的并发，
//      证明不了任何事），且 reason 用自己的成因 token；
//   ④ telemetry 读不到 = `unknown`，⛔ 不是 0。
//
// ⛔ 每条判据都配**取假控制**（pre-fix 负控制）：把「计划集」这一维关掉，同一份套件输出立刻回到
//    「green + 文件数少」——这正是本任务要消灭的形态。
// ════════════════════════════════════════════════════════════════════════════════════════════════════

import { runMechanicalFanIn, makeMechRepo, mechOpts, rmSafe } from "./helpers/worker-driver-fan-in-harness.mjs";

import {
  computePlannedCompleteness,
  terminalFileSet,
  relTestPath,
  formatSuiteIncompleteMarker,
  resolvePlannedFiles,
  readPlannedManifest,
} from "../scripts/full-suite-runner.ts";
import { extractSuiteIncompleteMarker } from "../scripts/worker-fan-in.ts";

/** `__PERFILE__ <abs>` 行（measure-suite-reporter 的形状；runner 只缓冲这一形状的行）。 */
function perFileLine(root, rel, passed = "true") {
  return `echo "__PERFILE__ duration_ms=12 ${root}/${rel} passed=${passed}"`;
}
/** TAP 摘要行。 */
function tap(lines) {
  return lines.map((l) => `echo ${JSON.stringify(l)}`).join("\n");
}
/** 一个「跑了 rel 这些文件、其余计划文件一行没产出」的假套件。 */
function suiteBody(root, emitted, extra = [], exit = 0) {
  return [
    ...emitted.map((r) => perFileLine(root, r)),
    tap(["# tests 1", "# pass 1", "# fail 0", "# cancelled 0"]),
    ...extra,
    `exit ${exit}`,
  ].join("\n");
}

const PLAN_A = "plugin/test/aaa.test.mjs";
const PLAN_B = "plugin/test/bbb.test.mjs";
const PLAN_C = "plugin/test/ccc.test.mjs";

// ── 单元：计划清单三态 + 归一 + 标记编解码 ────────────────────────────────────────────────────────

test("unit — computePlannedCompleteness is THREE-VALUED: no plan ⇒ evaluated:false (⛔ not 'complete'); a plan ⇒ named missing files", () => {
  // ① 计划不可得 ⇒ **未评估**，⛔ 不得与「完整」同形（硬规则 3b）。
  const none = computePlannedCompleteness(null, ["a.mjs"]);
  assert.equal(none.evaluated, false, "no plan ⇒ evaluated:false");
  assert.equal(none.plannedCount, null, "no plan ⇒ plannedCount null (缺值 ≠ 0)");
  assert.deepEqual(none.missing, [], "no plan ⇒ 不伪造缺失清单");
  // ② 有计划、缺文件 ⇒ 具名列出。
  const partial = computePlannedCompleteness([PLAN_A, PLAN_B, PLAN_C], [PLAN_A]);
  assert.equal(partial.evaluated, true);
  assert.equal(partial.plannedCount, 3);
  assert.equal(partial.terminalCount, 1);
  assert.deepEqual(partial.missing, [PLAN_B, PLAN_C], "missing 具名（排序，便于比对与落盘）");
  // ③ 完整 ⇒ 无缺失，且 planned == terminal == N。
  const full = computePlannedCompleteness([PLAN_A, PLAN_B], [PLAN_A, PLAN_B]);
  assert.equal(full.evaluated, true);
  assert.deepEqual(full.missing, []);
  assert.equal(full.plannedCount, full.terminalCount, "complete fixture: planned == terminal");
  // ④ 计划之外的终态文件是**观测项**，⛔ 不算缺失（计划探针与执行口径有偏差时看得见）。
  const extra = computePlannedCompleteness([PLAN_A], [PLAN_A, PLAN_C]);
  assert.deepEqual(extra.missing, []);
  assert.deepEqual(extra.unexpected, [PLAN_C]);
});

test("unit — terminalFileSet reads the RAW __PERFILE__ path (⛔ not parsePerFileLines: a killed file has NO line at all)", () => {
  const root = "/w/quay-worktrees/task-x";
  const lines = [
    `__PERFILE__ duration_ms=12 ${root}/plugin/test/aaa.test.mjs passed=true`,
    "not a perfile line",
    `__PERFILE__ duration_ms=0 ${root}/plugin/test/zzz.test.mjs passed=false`,
  ];
  const set = terminalFileSet(lines, root);
  assert.ok(set.has("plugin/test/aaa.test.mjs"), "a normal terminal record is in the set");
  assert.ok(set.has("plugin/test/zzz.test.mjs"), "a duration_ms=0 terminal record is STILL a record (⛔ parsePerFileLines would drop it)");
  assert.equal(set.size, 2, "only __PERFILE__ lines contribute");
  // relTestPath 归一：命名空间剥离 / 受测根相对 / 已在计划侧为相对的原样。
  assert.equal(relTestPath(`${root}/plugin/test/a.test.mjs`, root), "plugin/test/a.test.mjs");
  assert.equal(relTestPath("/home/yale/work/quay-worktrees/change-stall-pct-6/plugin/test/a.test.mjs", root), "plugin/test/a.test.mjs");
  assert.equal(relTestPath("plugin/test/a.test.mjs", root), "plugin/test/a.test.mjs");
});

test("unit — resolvePlannedFiles is three-valued and explicit sources win; a bad --planned-files-file is an ERROR, not an empty plan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-plan-resolve-"));
  try {
    // 没有 scripts/test.sh 的根 ⇒ 探针说不出话 ⇒ **计划不可得**（error 非 null），⛔ 不是空计划。
    const missing = resolvePlannedFiles({ argv: [], env: {}, root });
    assert.equal(missing.files, null, "no test.sh ⇒ files null (未评估)");
    assert.ok(missing.error !== null, "成因落 error（可区分）");
    // 显式来源优先，且读不懂的 --planned-files-file 落 error（⛔ 不伪装成空计划）。
    const envPlan = resolvePlannedFiles({ argv: [], env: { QUAY_TEST_PLANNED_FILES: "a.mjs,b.mjs" }, root });
    assert.deepEqual(envPlan.files, ["a.mjs", "b.mjs"]);
    assert.equal(envPlan.source, "explicit:env");
    const badFile = resolvePlannedFiles({ argv: ["--planned-files-file", path.join(root, "nope.json")], env: {}, root });
    assert.equal(badFile.files, null, "unreadable explicit file ⇒ null, ⛔ not []");
    assert.match(badFile.source, /explicit:file-unreadable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unit — the plan probe VALIDATES its own output: a `--list-files` that prints non-paths is an ERROR (plan unreadable), ⛔ never a garbage plan that fakes an incomplete round", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-plan-validate-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    // 反例（本仓库实测形态）：一个把参数忽略掉的 test.sh —— `--list-files` 被当成普通运行，输出的是
    // `__BUCKETS__ …` / `# pass 4`。不校验就会把它们当「计划文件」⇒ 5 计划 / 0 终态 ⇒ **假 incomplete**。
    fs.writeFileSync(
      path.join(root, "scripts", "test.sh"),
      '#!/usr/bin/env bash\necho "__BUCKETS__ buckets=P files=2 full=0"\necho "# pass 4"\nexit 0\n',
      { mode: 0o755 },
    );
    const bogus = resolvePlannedFiles({ argv: [], env: {}, root });
    assert.equal(bogus.files, null, "non-path output ⇒ the plan is UNREADABLE, ⛔ not a garbage plan");
    assert.ok(bogus.error !== null, "the cause is named");
    assert.equal(bogus.source, "probe-failed");
    // 反例②：一份**像路径但盘上不存在**的清单 ⇒ 同样是「读不懂」，⛔ 不是「缺文件」。
    fs.writeFileSync(path.join(root, "scripts", "test.sh"), '#!/usr/bin/env bash\necho plugin/test/ghost.test.mjs\nexit 0\n', { mode: 0o755 });
    const ghost = resolvePlannedFiles({ argv: [], env: {}, root });
    assert.equal(ghost.files, null, "a planned path that does not exist on disk ⇒ unreadable (⛔ not a missing-file verdict)");
    // 正例（能取假）：真清单 ⇒ 计划可读（且与终态集同口径）。
    fs.mkdirSync(path.join(root, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "test", "real.test.mjs"), "// real\n", "utf8");
    fs.writeFileSync(path.join(root, "scripts", "test.sh"), `#!/usr/bin/env bash\necho ${root}/plugin/test/real.test.mjs\nexit 0\n`, { mode: 0o755 });
    const ok = resolvePlannedFiles({ argv: [], env: {}, root });
    assert.deepEqual(ok.files, ["plugin/test/real.test.mjs"], "a real file list is read and normalized to the tested-root-relative 口径");
    assert.equal(ok.error, null);
    // `--buckets` 在没有选桶器的根里说不出计划（⛔ 不回落成全量清单——那是拿 A 的清单校验 B）。
    const b = resolvePlannedFiles({ argv: ["--buckets", "gap-x"], env: {}, root });
    assert.equal(b.files, null, "--buckets without suite-bucket-select.ts ⇒ plan unreadable");
    assert.match(String(b.error), /bucket plan is unreadable/, "…with its own cause");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unit — the SUITE-INCOMPLETE marker round-trips (runner writes it, fan-in reads it); a missing marker is null", () => {
  const marker = formatSuiteIncompleteMarker({
    reason: "incomplete", planned: 579, terminal: 65, missing: 514, oomKill: 4, files: [PLAN_A, PLAN_B],
  });
  const parsed = extractSuiteIncompleteMarker(`some suite noise\n${marker}\nmore noise`);
  assert.ok(parsed, "the marker is found mid-log");
  assert.equal(parsed.reason, "incomplete");
  assert.equal(parsed.planned, 579);
  assert.equal(parsed.terminal, 65);
  assert.equal(parsed.missing, 514);
  assert.equal(parsed.oomKill, 4);
  assert.deepEqual(parsed.files, [PLAN_A, PLAN_B]);
  // 三态：没有标记 ⇒ null（调用方保持既有真失败摘要路径，⛔ 不伪造）。
  assert.equal(extractSuiteIncompleteMarker("suite red\nnot ok 1 - boom\n"), null);
  // oomKill 读不到 ⇒ "unknown"（⛔ 不是 0）。
  const unknown = extractSuiteIncompleteMarker(
    formatSuiteIncompleteMarker({ reason: "oom-killed", planned: null, terminal: 0, missing: 0, oomKill: "unknown", files: [] }),
  );
  assert.equal(unknown.oomKill, "unknown");
  assert.equal(unknown.planned, null, "planned 读不到 ⇒ null（缺值 ≠ 0）");
});

// ── AC1/AC7：计划清单完整性（runner 侧，含取假负控制）─────────────────────────────────────────────

test("AC1/AC7 — a round where scheduled files produced no terminal record is `not-evaluated: incomplete`; the SAME suite with the plan维度 turned off is green with fewer files (pre-fix negative control)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-plan-ac1-"));
  const { f, dir } = fakeSuite(suiteBody(root, [PLAN_A])); // 计划 3 个文件，只有 1 个产出终态
  try {
    // ① 取假负控制（= 修法前的形态）：**没有计划集** ⇒ 判词只数 TAP ⇒ green，514/579 那种「少了一大半
    //    文件却全绿」的形态。
    const pre = runRunner({ root, command: `bash ${f}`, laneCount: 1, runId: "plan-pre" });
    await waitExit(pre);
    const preState = readState(root);
    assert.equal(preState.state, "green", "pre-fix shape: no plan ⇒ green (this is the defect — the negative control MUST reproduce it)");
    assert.equal(preState.notEvaluated, undefined, "pre-fix shape carries no not-evaluated token");
    const preRec = lastRoundRecord(root);
    assert.equal(preRec.completeness, "not-evaluated", "the ledger honestly records the dimension as NOT EVALUATED");
    assert.equal(preRec.plannedFiles, null, "plannedFiles explicit null (缺值 ≠ 0)");

    // ② 修法后：同一份套件输出 + 计划集 ⇒ red + 具名的 incomplete（绝不 green）。
    const post = runRunner({
      root, command: `bash ${f}`, laneCount: 1, runId: "plan-post",
      env: { QUAY_TEST_PLANNED_FILES: [PLAN_A, PLAN_B, PLAN_C].join(",") },
    });
    const { code } = await waitExit(post);
    assert.notEqual(code, 0, "an incomplete round exits non-zero (fan-in must treat it as red)");
    const s = readState(root);
    assert.equal(s.state, "red", "incomplete ⇒ red, ⛔ green");
    assert.equal(s.notEvaluated, "incomplete (2/3 missing)", "具名成因 token + 计数");
    assert.equal(s.reason, "aborted", "NO correctness conclusion (the missing files are UNKNOWN, not failures)");
    assert.deepEqual(s.missingFiles, [PLAN_B, PLAN_C], "缺失文件具名列出");
    assert.equal(s.plannedFiles, 3);
    assert.equal(s.terminalFiles, 1);
    assert.equal(s.completeness, undefined, "state carries no completeness key (absent-unless-applicable — green key set is pinned)");

    // ③ 计划集**执行前**已落盘（AC4 的「Before execution, the runner persists the scheduled set」）。
    const manifest = readPlannedManifest(path.join(root, ".quay"), "plan-post");
    assert.ok(manifest, "the planned manifest was persisted for THIS runId");
    assert.equal(manifest.count, 3);
    assert.deepEqual(manifest.files.map((x) => x.file), [PLAN_A, PLAN_B, PLAN_C]);
    assert.equal(manifest.source, "explicit:env");
    assert.equal(manifest.error, null);

    // ④ suite log 里的标记行（fan-in 就是读它——AC2）。
    const log = fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8");
    const marker = extractSuiteIncompleteMarker(log);
    assert.ok(marker, "the SUITE-INCOMPLETE marker is in the suite log");
    assert.equal(marker.reason, "incomplete");
    assert.equal(marker.missing, 2);
    assert.deepEqual(marker.files, [PLAN_B, PLAN_C], "the marker names the missing files");
    assert.match(log, /SUITE-PLAN planned=3 terminal=1 missing=2/, "the always-on completeness reading is printed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC7 — planned-manifest completeness: (a) never starts, (b) SIGKILLed mid-run, (c) cancelled; a COMPLETE fixture is green with planned == terminal == N", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-plan-ac7-"));
  try {
    // (a) 一个计划文件**从未开始**（一行都没有）。
    const a = fakeSuite(suiteBody(root, [PLAN_A]));
    const ra = runRunner({ root, command: `bash ${a.f}`, laneCount: 1, runId: "ac7-a", env: { QUAY_TEST_PLANNED_FILES: `${PLAN_A},${PLAN_B}` } });
    await waitExit(ra);
    assert.equal(readState(root).notEvaluated, "incomplete (1/2 missing)");
    assert.deepEqual(readState(root).missingFiles, [PLAN_B], "(a) a planned file that never started is named");

    // (b) 一个计划文件**跑到一半被 SIGKILL**（真的有进程被杀，且它没来得及产出终态行）。
    const b = fakeSuite([
      perFileLine(root, PLAN_A),
      "( sleep 30 ) & K=$!; kill -9 $K; wait $K 2>/dev/null",
      tap(["# tests 1", "# pass 1", "# fail 0", "# cancelled 0"]),
      "exit 0",
    ].join("\n"));
    const rb = runRunner({ root, command: `bash ${b.f}`, laneCount: 1, runId: "ac7-b", env: { QUAY_TEST_PLANNED_FILES: `${PLAN_A},${PLAN_B}` } });
    await waitExit(rb);
    assert.equal(readState(root).notEvaluated, "incomplete (1/2 missing)");
    assert.deepEqual(readState(root).missingFiles, [PLAN_B], "(b) a SIGKILLed planned file is named");

    // (c) 一个计划文件被 **cancelled**（TAP 记了 cancelled、但没有它的终态行）。
    const c = fakeSuite([
      perFileLine(root, PLAN_A),
      tap(["# tests 1", "# pass 1", "# fail 0", "# cancelled 1"]),
      "exit 0",
    ].join("\n"));
    const rc = runRunner({ root, command: `bash ${c.f}`, laneCount: 1, runId: "ac7-c", env: { QUAY_TEST_PLANNED_FILES: `${PLAN_A},${PLAN_B}` } });
    await waitExit(rc);
    const sc = readState(root);
    assert.equal(sc.notEvaluated, "incomplete (1/2 missing)", "(c) a cancelled planned file still counts as NO terminal record");
    assert.deepEqual(sc.missingFiles, [PLAN_B], "(c) the cancelled file is named");

    // (d) 完整夹具 ⇒ green，且 planned == terminal == N 被**印出来**（AC4/AC5 要的那个读数）。
    const d = fakeSuite(suiteBody(root, [PLAN_A, PLAN_B, PLAN_C]));
    const rd = runRunner({ root, command: `bash ${d.f}`, laneCount: 1, runId: "ac7-d", env: { QUAY_TEST_PLANNED_FILES: [PLAN_A, PLAN_B, PLAN_C].join(",") } });
    const { code } = await waitExit(rd);
    assert.equal(code, 0, "a complete suite is unaffected (AC4)");
    const sd = readState(root);
    assert.equal(sd.state, "green");
    assert.equal(sd.notEvaluated, undefined, "⛔ a complete round carries no not-evaluated token");
    assert.equal(sd.missingFiles, undefined);
    assert.deepEqual(Object.keys(sd).sort(), [
      "durationMs", "finishedAt", "laneCount", "notEvaluatedCheckers", "pid", "runId", "runner", "scope", "startedAt", "state",
    ], "a complete green round's key set is byte-identical to the pre-fix shape");
    const logD = fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8");
    assert.match(logD, /SUITE-PLAN planned=3 terminal=3 missing=0 .*completeness=complete/, "planned == terminal == 3 printed");
    assert.equal(extractSuiteIncompleteMarker(logD), null, "⛔ a complete round writes NO incomplete marker");
    for (const x of [a, b, c, d]) fs.rmSync(x.dir, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC8/AC9：OOM 与 telemetry（runner 侧）──────────────────────────────────────────────────────────

test(
  "AC8 — a round whose scope really OOM-killed processes is NEVER green, even though every planned file produced its terminal record",
  { skip: systemdRunAvailable() ? false : "not-evaluated: systemd-run --user --scope not usable on this host — the OOM round was not run" },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oom-verdict-"));
    // 一个**完整**的套件（计划 3 / 终态 3），唯一的异常是 cgroup 的 oom_kill 上升 —— 这正是轮 2660 的
    // 反面对照：本任务要证明「OOM 本身（而不是文件数）就足以否掉 green」。
    const cg = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oom-cg-"));
    fs.writeFileSync(path.join(cg, "memory.events"), "low 0\nhigh 0\nmax 0\noom 5\noom_kill 4\n");
    fs.writeFileSync(path.join(cg, "memory.peak"), `${2 * 1024 * 1024 * 1024}\n`);
    const { f, dir } = fakeSuite(suiteBody(root, [PLAN_A, PLAN_B, PLAN_C]));
    const runId = "oom-verdict-1";
    try {
      const child = runRunner({
        root, command: `bash ${f}`, laneCount: 1, runId,
        env: {
          QUAY_TEST_PLANNED_FILES: [PLAN_A, PLAN_B, PLAN_C].join(","),
          QUAY_TEST_SYSTEMD_RUN_AVAILABLE: "1",
          QUAY_TEST_SKIP_SYSTEMD_RUN: "0",
          QUAY_TEST_SYSTEMD_RUN_LIMITS: "MemoryMax=16G",
          // 把 sampler 的 cgroup 读数重定向到夹具（scope 真的起，但读的是我们写的 memory.events）。
          QUAY_TEST_CGROUP_DIR: cg,
        },
      });
      const { code } = await waitExit(child);
      assert.notEqual(code, 0, "an OOM round exits non-zero");
      const s = readState(root);
      assert.equal(s.state, "red", "OOM ⇒ red, ⛔ green (this is the round-2660 shape)");
      assert.equal(s.notEvaluated, "oom-killed (4)", "its own 成因 token, ⛔ not 'suite red' / 'failed'");
      assert.equal(s.oomKill, 4, "the OOM count is surfaced on the verdict (it used to live only in a side file)");
      assert.equal(s.reason, "aborted", "no correctness conclusion");
      const log = fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8");
      const marker = extractSuiteIncompleteMarker(log);
      assert.ok(marker, "the OOM round writes the marker fan-in reads");
      assert.equal(marker.reason, "oom-killed");
      assert.equal(marker.oomKill, 4);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(cg, { recursive: true, force: true });
    }
  },
);

test("AC9 — unreadable memory telemetry is recorded as `unknown`, ⛔ never 0 (a non-scope round omits the dimension entirely — 缺键 ≠ unknown)", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-telemetry-"));
  try {
    // ① 采样器起了、但一次都没读到（cgroup 不存在）⇒ 两个计数 + 一个 telemetry 取值都是 "unknown"。
    const ev = startSuiteMemorySampler({
      cgroupDirProvider: () => null,
      stateDir,
      runId: "tel-unknown",
      memoryMaxBytes: null,
      phaseProvider: () => "main",
      intervalMs: 20,
    }).stop();
    assert.equal(ev.oomKill, "unknown", "⛔ not 0 — 0 means 「read it: no OOM」 (硬规则 3b)");
    assert.equal(ev.oom, "unknown");
    assert.equal(ev.peakBytes, "unknown");
    assert.equal(ev.telemetry, "unknown", "「这一维评估过没有」的独立取值");
    const onDisk = JSON.parse(fs.readFileSync(path.join(stateDir, "suite-memory-evidence-tel-unknown.json"), "utf8"));
    assert.equal(onDisk.oomKill, "unknown", "the EVIDENCE FILE records unknown too (AC9 names both carriers)");
    assert.equal(onDisk.peakBytes, "unknown");
    assert.notEqual(onDisk.oomKill, 0, "an unreadable cgroup must never land as the integer that means 「no OOM」");

    // ② 读得到 ⇒ 正常整数 + telemetry:"ok"（负控制：⛔ 别把「读到了」也写成 unknown）。
    const cg = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-tel-cg-"));
    fs.writeFileSync(path.join(cg, "memory.events"), "low 0\nmax 0\noom 0\noom_kill 0\n");
    fs.writeFileSync(path.join(cg, "memory.peak"), "1024\n");
    const ok = startSuiteMemorySampler({
      cgroupDirProvider: () => cg,
      stateDir,
      runId: "tel-ok",
      memoryMaxBytes: 4096,
      phaseProvider: () => "main",
      intervalMs: 20,
    }).stop();
    assert.equal(ok.oomKill, 0, "a real oom_kill=0 stays 0 (negative control for ①)");
    assert.equal(ok.peakBytes, 1024);
    assert.equal(ok.telemetry, "ok");
    fs.rmSync(cg, { recursive: true, force: true });

    // ③ 非 systemd 轮（没有 scope ⇒ 没有 telemetry 这一维）⇒ **缺键**，⛔ 不是 "unknown"（两者不得压平）。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-tel-run-"));
    const { f, dir } = fakeSuite(suiteBody(root, [PLAN_A]));
    try {
      const child = runRunner({ root, command: `bash ${f}`, laneCount: 1, runId: "tel-noscope", env: { QUAY_TEST_PLANNED_FILES: PLAN_A } });
      const { code } = await waitExit(child);
      assert.equal(code, 0, "the complete round is green");
      const s = readState(root);
      assert.equal(s.oomKill, undefined, "non-scope round: the dimension is ABSENT (缺键 ≠ unknown)");
      assert.equal(s.telemetry, undefined);
      const rec = lastRoundRecord(root);
      assert.equal(rec.oomKill, undefined, "and absent on the ledger row too");
      assert.equal(rec.plannedFiles, 1, "…while the completeness reading IS present (planned == terminal == 1)");
      assert.equal(rec.terminalFiles, 1);
      assert.equal(rec.completeness, "complete");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

// ── AC2/AC3/AC6/AC8：fan-in 侧（见到标记就不落地；重跑通道不得翻案）──────────────────────────────

function suiteMarkerCommand(marker, namedFile) {
  // 既有形态：日志点名了一个失败文件（⇒ 重跑通道本来会把它洗成 rerun-green），外加本任务的新标记。
  const lines = marker === null
    ? [`__PERFILE__ duration_ms=10 ${namedFile} passed=false end_ms=20`]
    : [marker, `__PERFILE__ duration_ms=10 ${namedFile} passed=false end_ms=20`];
  const args = lines.map((l) => `'${l.replace(/'/g, `'\\''`)}'`).join(" ");
  return ["bash", "-c", `printf '%s\\n' ${args}; exit 1`];
}

test("AC2/AC3 — fan-in does NOT land an incomplete round (reason names `incomplete suite (N/M files)` + oomKill), and rerun-green cannot certify it (negative control: without the marker the SAME log lands via rerun-green)", async (t) => {
  const named = "plugin/test/flaky-under-load.test.mjs";
  const marker = formatSuiteIncompleteMarker({
    reason: "incomplete", planned: 579, terminal: 65, missing: 514, oomKill: 4, files: [named],
  });

  // ① 取假负控制：**没有标记**的同一份红日志 + 一个必绿的重跑命令 ⇒ 落到绿块（rerun-green）。
  //    这一半证明重跑通道真的开着——否则「有标记时不重跑」什么都没证明（硬规则 4：零信息读数）。
  const mCtl = makeMechRepo("inc-ctl");
  t.after(() => rmSafe(mCtl.base));
  const rCtl = await runMechanicalFanIn(mechOpts(mCtl, "mfi-inc-ctl", {
    task: "gap-mfh", perSuiteRunId: "mfi-inc-ctl",
    suiteCommand: suiteMarkerCommand(null, named), rerunCommand: ["bash", "-c", "exit 0"],
  }));
  assert.equal(rCtl.outcome, "landed", `negative control: the rerun channel must be live (step=${rCtl.step} reason=${rCtl.reason})`);
  assert.equal(rCtl.rerun.state, "rerun-green", "…and it certifies via rerun-green");
  // AC6 — the **names** of the re-run files must land on a carrier that survives landing cleanup. The
  // landing path prunes `fan-in-suite-*.log` (so the count-only record in the pruned attempt log is
  // unrecoverable — the measured 2026-10-14 proposal); the shared `.quay/fan-in-step-trace.jsonl` is
  // NOT rotated, and the `suite-rerun-green` event now carries `files`.
  const ctlShared = fs.readFileSync(path.join(mCtl.repo, ".quay", "fan-in-step-trace.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const rerunGreenEv = ctlShared.find((e) => e.step === "suite-rerun-green" && e.runId === "mfi-inc-ctl");
  assert.ok(rerunGreenEv, "the landing certification is traced durably");
  assert.deepEqual(rerunGreenEv.files, [named], "…including the NAMES of the re-run files, not just their count");

  // ② 修法后：同一份日志 + 标记 ⇒ 不落地，reason 具名。
  const m = makeMechRepo("inc");
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, "mfi-inc", {
    task: "gap-mfh", perSuiteRunId: "mfi-inc",
    suiteCommand: suiteMarkerCommand(marker, named), rerunCommand: ["bash", "-c", "exit 0"],
  }));
  assert.equal(r.outcome, "red", "an incomplete round must NOT land");
  assert.equal(r.step, "suite");
  assert.match(String(r.reason), /incomplete suite \(514\/579 files\)/, "the reason names incomplete suite (N/M files)");
  assert.match(String(r.reason), /oomKill=4/, "…and the oomKill count when present");
  assert.equal(r.rerun, null, "⛔ the in-round rerun channel was not even entered (isolation proves nothing — it removes the very concurrency that caused the kill)");
  const shared = fs.readFileSync(path.join(m.repo, ".quay", "fan-in-step-trace.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(shared.filter((e) => e.step === "suite-rerun-green" && e.runId === "mfi-inc").length, 0, "⛔ no suite-rerun-green step for this run");
  const inc = shared.find((e) => e.step === "suite-incomplete" && e.runId === "mfi-inc");
  assert.ok(inc, "the decision is traced durably");
  assert.deepEqual(inc.files, [named], "…naming the missing files");
});

test("AC8 — an OOM-killed round whose named failures pass on in-round rerun is NOT landed; reason `oom-killed (n)`, no suite-rerun-green", async (t) => {
  const named = "plugin/test/flaky-under-load.test.mjs";
  const marker = formatSuiteIncompleteMarker({
    reason: "oom-killed", planned: 579, terminal: 579, missing: 0, oomKill: 3, files: [],
  });
  const m = makeMechRepo("oomverdict");
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, "mfi-oomverdict", {
    task: "gap-mfh", perSuiteRunId: "mfi-oomverdict",
    suiteCommand: suiteMarkerCommand(marker, named), rerunCommand: ["bash", "-c", "exit 0"],
  }));
  assert.equal(r.outcome, "red", "an OOM round is never green (re-running in isolation removes the concurrency that caused the kill)");
  assert.match(String(r.reason), /^oom-killed \(3\)/, "reason is the oom-killed token with its count");
  assert.equal(r.rerun, null, "⛔ no in-round rerun");
  const shared = fs.readFileSync(path.join(m.repo, ".quay", "fan-in-step-trace.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(shared.filter((e) => e.step === "suite-rerun-green" && e.runId === "mfi-oomverdict").length, 0, "⛔ no suite-rerun-green step");
});

test("AC6 — a watchdog-killed suite followed by an in-round rerun of the named files does NOT land; the names of the re-run files survive landing cleanup", async (t) => {
  const named = "plugin/test/flaky-under-load.test.mjs";
  const m = makeMechRepo("wd-rerun");
  t.after(() => rmSafe(m.base));
  const ledger = path.join(m.repo, ".quay", "verification-round.jsonl");
  const r = await runMechanicalFanIn(mechOpts(m, "mfi-wd-rerun", {
    task: "gap-mfh", perSuiteRunId: "mfi-wd-rerun",
    // 静默看门狗 SIGKILL 整组：套件从未跑完（实测 2026-10-14 08:43 的形状）。
    suiteCommand: ["bash", "-c", "sleep 100"], silenceMs: 400,
    rerunCommand: ["bash", "-c", "exit 0"],
  }));
  assert.equal(r.outcome, "red", "a suite that never completed must not be certified by a 3-file rerun");
  assert.equal(r.step, "suite");
  assert.equal(r.rerun, null, "⛔ the rerun channel is not entered for a no-conclusion round");
  // 回归检查（gap-watchdog-killed-round-writes-no-verification-round-record）：台账仍出现 NOT-EVALUATED 行。
  assert.ok(fs.existsSync(ledger), "the watchdog-killed round STILL writes its ledger row (regression check)");
  const rec = JSON.parse(fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean)[0]);
  assert.equal(rec.evaluated, false);
  assert.equal(rec.reason, "watchdog-killed");
  assert.equal(rec.state, "red");
  // AC6 — 重跑点名的文件落进**落地清理后仍存活**的载体（.quay/fan-in-step-trace.jsonl 不在 pruneTaskSuiteLogs
  // 的轮转范围内：它只删 `fan-in-suite-*.log`）。本夹具里重跑没跑 ⇒ `files` 为空数组（⛔ 不是「没记」）。
  const shared = fs.readFileSync(path.join(m.repo, ".quay", "fan-in-step-trace.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(shared.filter((e) => e.step === "suite-rerun-green").length, 0, "no rerun certification happened");
  assert.equal(shared.filter((e) => e.reason && String(e.reason).includes(named)).length, 0, "…and nothing claims those files were re-run");
});
