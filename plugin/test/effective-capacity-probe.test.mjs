// @test-group engine

// effective-capacity-probe.test.mjs — the cgroup-v2-aware effective capacity probe
// (gap-effective-capacity-cgroup-cpu-memory-probe).
//
// WHAT IS PINNED, and why each half is independently falsifiable:
//   · the four parsers, each with a NOT-READABLE input that must NOT read as a limit (硬规则 3b —
//     `null`/unlimited never shares a value with a real 0-core / 0-byte limit);
//   · the derivation's tie-break and floor semantics (min of bandwidth/cpuset/nproc, floor ≥ 1);
//   · the THIRD STATE: cgroup v2 unavailable ⇒ cgroup_v2=false + *_source=*-fallback, which must be
//     distinguishable from "cgroup present and unlimited" (cgroup_v2=true + the same fallback source);
//   · the frozen output contract: exactly the six fields, same key names in report mode and --json;
//   · the five env seams, read through the CLI (not only through the imported function);
//   · AC4 — a REAL cgroup v2 control: a `systemd-run --user --scope -p CPUQuota=… -p MemoryMax=…`
//     scope applies a kernel limit, and the probe (run INSIDE that scope) must report that limit.
//     The kernel's own raw files are read back by an independent reader in the same quota, so the
//     assertion is plan == kernel-in-effect == probe reading (⛔ not "we set a flag, so we trust it").
//     When cgroup v2 or systemd-run is unavailable this test is `not-evaluated` (a SKIP), ⛔ not a pass.
//
// ⛔ The probe itself does NOT change any existing consumer's behaviour: resource-gate.sh /
// process-budget.sh / driver-anchor.ts are byte-identical on this branch (the task's AC5), so this
// file only exercises the NEW module.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CGROUP_ROOT,
  TEST_CPU_MAX,
  TEST_CPUSET_COUNT,
  TEST_MEM_AVAIL_MB,
  TEST_MEMORY_MAX,
  TEST_NPROC,
  computeEffectiveCapacity,
  countCpusetCores,
  cgroupV2Mounted,
  formatJson,
  formatReport,
  hostParallelism,
  parseByteLimit,
  parseCpuMax,
  probeEffectiveCapacity,
  selfCgroupRelPath,
} from "../scripts/effective-capacity-probe.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE = path.join(HERE, "..", "scripts", "effective-capacity-probe.ts");
const FIELD_ORDER = ["effective_cpu", "cpu_source", "effective_mem_mb", "mem_source", "nproc", "cgroup_v2"];

/** A child of this test process must not inherit NODE_TEST_CONTEXT: a `node --test`-speaking child
 *  silently runs NOTHING and exits 0, which is indistinguishable from a passing probe. */
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** Run the probe CLI. Returns {status, stdout, stderr}. Bound is generous but finite: under suite
 *  load an interpreter start has been measured 200×+ slower than standalone. */
function runProbe(args = [], env = {}) {
  return spawnSync(process.execPath, ["--experimental-strip-types", PROBE, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: cleanEnv(env),
  });
}

/** Run a shell-free command inside a real transient cgroup v2 scope with the given `-p` properties. */
function runInScope(properties, argv, env = {}) {
  return spawnSync("systemd-run", ["--user", "--scope", "-q", ...properties.flatMap((p) => ["-p", p]), "--", ...argv], {
    encoding: "utf8",
    timeout: 120_000,
    env: cleanEnv(env),
  });
}

function systemdRunAvailable() {
  const r = runInScope(["CPUQuota=100%"], [process.execPath, "-e", "0"]);
  return r.status === 0;
}

/** Independent reader of the KERNEL's raw cgroup files for the cgroup the command runs in — the
 *  corroborating half of AC4 (never the probe's own parse). */
const RAW_READER = [
  'const fs=require("fs"),p=require("path");',
  'const rel=(/^0::(.*)$/m.exec(fs.readFileSync("/proc/self/cgroup","utf8"))||[])[1];',
  'const dir=p.join("/sys/fs/cgroup",rel);',
  'const rd=(f)=>{try{return fs.readFileSync(p.join(dir,f),"utf8").trim()}catch(e){return "UNREADABLE:"+(e.code||e.message)}};',
  'console.log(JSON.stringify({rel,cpuMax:rd("cpu.max"),memMax:rd("memory.max")}));',
].join("");

// ── parsers ─────────────────────────────────────────────────────────────────────────────────────

test("parseCpuMax — floor(quota/period) clamped to ≥1, and 'max'/non-positive/nonsense are UNLIMITED (not 0)", () => {
  assert.deepEqual(parseCpuMax("200000 100000"), { unlimited: false, cores: 2 });
  assert.deepEqual(parseCpuMax("250000 100000"), { unlimited: false, cores: 2 });
  assert.deepEqual(parseCpuMax("400000 100000"), { unlimited: false, cores: 4 });
  // floor, but never 0 — a 0-core reading would be a fabricated limit (硬规则 3b).
  assert.deepEqual(parseCpuMax("50000 100000"), { unlimited: false, cores: 1 });
  assert.deepEqual(parseCpuMax("99999 100000"), { unlimited: false, cores: 1 });
  // ⛔ "max" is UNLIMITED, never a 0 or an Infinity core count.
  assert.deepEqual(parseCpuMax("max 100000"), { unlimited: true, cores: null });
  assert.deepEqual(parseCpuMax("0 100000"), { unlimited: true, cores: null });
  assert.deepEqual(parseCpuMax("-1 100000"), { unlimited: true, cores: null });
  assert.deepEqual(parseCpuMax(""), { unlimited: true, cores: null });
  assert.deepEqual(parseCpuMax(null), { unlimited: true, cores: null });
  assert.deepEqual(parseCpuMax(undefined), { unlimited: true, cores: null });
  assert.deepEqual(parseCpuMax("garbage"), { unlimited: true, cores: null });
  // a period of 0 would divide by zero ⇒ treat as unreadable, ⛔ not as an infinite quota
  assert.deepEqual(parseCpuMax("100000 0"), { unlimited: true, cores: null });
  assert.deepEqual(parseCpuMax("100000 200000"), { unlimited: false, cores: 1 });
});

test("countCpusetCores — range list counted, empty/nonsense is null (⛔ never 0)", () => {
  assert.equal(countCpusetCores("0-3"), 4);
  assert.equal(countCpusetCores("0-3,8,10-11"), 7);
  assert.equal(countCpusetCores("5"), 1);
  assert.equal(countCpusetCores("0-127"), 128);
  assert.equal(countCpusetCores("0-3\n"), 4);
  // ⛔ absence/unreadability is null — a 0 would read as "a real, tiny cpuset".
  assert.equal(countCpusetCores(""), null);
  assert.equal(countCpusetCores(null), null);
  assert.equal(countCpusetCores(undefined), null);
  assert.equal(countCpusetCores("garbage"), null);
  assert.equal(countCpusetCores("4-2"), null);
});

test("parseByteLimit — bytes, and 'max'/0/nonsense is UNLIMITED (distinguishable from a 0-byte limit)", () => {
  assert.equal(parseByteLimit("1073741824"), 1073741824);
  assert.equal(parseByteLimit("536870912\n"), 536870912);
  assert.equal(parseByteLimit("max"), null);
  assert.equal(parseByteLimit("0"), null);
  assert.equal(parseByteLimit(""), null);
  assert.equal(parseByteLimit(null), null);
  assert.equal(parseByteLimit("nonsense"), null);
});

test("selfCgroupRelPath — only the unified '0::' line counts; no such line is NOT-EVALUATED (null)", () => {
  assert.equal(selfCgroupRelPath("0::/user.slice/x.scope\n"), "/user.slice/x.scope");
  assert.equal(selfCgroupRelPath("2:cpu:/legacy\n0::/\n"), "/");
  assert.equal(selfCgroupRelPath("1:name=systemd:/x\n"), null);
  assert.equal(selfCgroupRelPath(""), null);
});

// ── the derivation ──────────────────────────────────────────────────────────────────────────────

const READINGS = {
  cpuMaxRaw: null,
  cpusetCores: null,
  memoryMaxRaw: null,
  nproc: 128,
  memFallbackMb: 60000,
  cgroupV2: true,
};

test("computeEffectiveCapacity — effective_cpu is min(bandwidth, cpuset, nproc) with a named source", () => {
  // quota binds
  let r = computeEffectiveCapacity({ ...READINGS, cpuMaxRaw: "200000 100000" });
  assert.equal(r.effective_cpu, 2);
  assert.equal(r.cpu_source, "cgroup-cpu-max");
  assert.equal(r.nproc, 128, "nproc stays the CONTROL reading — it is not the final value");

  // quota unlimited ⇒ the cpuset binds
  r = computeEffectiveCapacity({ ...READINGS, cpuMaxRaw: "max 100000", cpusetCores: 4 });
  assert.equal(r.effective_cpu, 4);
  assert.equal(r.cpu_source, "cpuset");

  // both present, cpuset smaller ⇒ cpuset wins
  r = computeEffectiveCapacity({ ...READINGS, cpuMaxRaw: "800000 100000", cpusetCores: 4 });
  assert.equal(r.effective_cpu, 4);
  assert.equal(r.cpu_source, "cpuset");

  // a cpuset larger than the quota does NOT mask the quota
  r = computeEffectiveCapacity({ ...READINGS, cpuMaxRaw: "200000 100000", cpusetCores: 64 });
  assert.equal(r.effective_cpu, 2);
  assert.equal(r.cpu_source, "cgroup-cpu-max");

  // neither ⇒ the host reading
  r = computeEffectiveCapacity({ ...READINGS, cpuMaxRaw: "max 100000" });
  assert.equal(r.effective_cpu, 128);
  assert.equal(r.cpu_source, "nproc-fallback");

  // nproc SMALLER than the quota ⇒ nproc binds (min, not "cgroup always wins")
  r = computeEffectiveCapacity({ ...READINGS, nproc: 1, cpuMaxRaw: "400000 100000" });
  assert.equal(r.effective_cpu, 1);
  assert.equal(r.cpu_source, "nproc-fallback");

  // a TIE is resolved toward the cgroup constraint (it is still the cgroup constraint)
  r = computeEffectiveCapacity({ ...READINGS, cpuMaxRaw: "128000000 1000000" });
  assert.equal(r.effective_cpu, 128);
  assert.equal(r.cpu_source, "cgroup-cpu-max");
});

test("computeEffectiveCapacity — the THIRD STATE: cgroup_v2=false ignores cgroup raws and says so", () => {
  // Raws are PRESENT but the cgroup was not readable ⇒ they must not be consumed, and the result
  // must not be shaped like "cgroup present and unlimited" (硬规则 3b).
  const unavailable = computeEffectiveCapacity({
    ...READINGS,
    cgroupV2: false,
    cpuMaxRaw: "200000 100000",
    cpusetCores: 3,
    memoryMaxRaw: "1073741824",
  });
  assert.equal(unavailable.cgroup_v2, false);
  assert.equal(unavailable.effective_cpu, 128);
  assert.equal(unavailable.cpu_source, "nproc-fallback");
  assert.equal(unavailable.effective_mem_mb, 60000);
  assert.equal(unavailable.mem_source, "free-fallback");

  const unlimited = computeEffectiveCapacity({ ...READINGS, cgroupV2: true, cpuMaxRaw: "max 100000", memoryMaxRaw: "max" });
  // The two agree on the SOURCES — that is exactly why cgroup_v2 is the field that separates them.
  assert.equal(unlimited.cpu_source, unavailable.cpu_source);
  assert.notEqual(unlimited.cgroup_v2, unavailable.cgroup_v2, "cgroup-unavailable must not share a shape with cgroup-readable");
});

test("computeEffectiveCapacity — memory: cgroup limit else the host fallback, in MB", () => {
  let r = computeEffectiveCapacity({ ...READINGS, memoryMaxRaw: "1073741824" });
  assert.equal(r.effective_mem_mb, 1024);
  assert.equal(r.mem_source, "cgroup-memory-max");

  r = computeEffectiveCapacity({ ...READINGS, memoryMaxRaw: "max" });
  assert.equal(r.effective_mem_mb, 60000);
  assert.equal(r.mem_source, "free-fallback");

  r = computeEffectiveCapacity({ ...READINGS, memoryMaxRaw: null });
  assert.equal(r.mem_source, "free-fallback");

  // floor, never 0
  r = computeEffectiveCapacity({ ...READINGS, memoryMaxRaw: "1048575" });
  assert.equal(r.effective_mem_mb, 1);
});

test("the output contract — report mode and --json carry EXACTLY the six frozen fields, in order", () => {
  const r = computeEffectiveCapacity({ ...READINGS, cpuMaxRaw: "200000 100000", memoryMaxRaw: "1073741824" });
  const lines = formatReport(r).split("\n");
  assert.equal(lines.length, 6);
  assert.deepEqual(
    lines.map((l) => l.split("=")[0]),
    FIELD_ORDER,
  );
  const fromText = Object.fromEntries(lines.map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]));
  const json = JSON.parse(formatJson(r));
  assert.deepEqual(Object.keys(json), FIELD_ORDER, "the JSON key names are unchanged from report mode");
  assert.equal(fromText.effective_cpu, String(json.effective_cpu));
  assert.equal(fromText.cpu_source, json.cpu_source);
  assert.equal(fromText.effective_mem_mb, String(json.effective_mem_mb));
  assert.equal(fromText.mem_source, json.mem_source);
  assert.equal(fromText.nproc, String(json.nproc));
  assert.equal(fromText.cgroup_v2, String(json.cgroup_v2));
});

// ── the CLI + the five seams ────────────────────────────────────────────────────────────────────

test("CLI — --json and report mode agree; the five seams override the RAW readings", () => {
  const env = {
    [TEST_CPU_MAX]: "250000 100000",
    [TEST_CPUSET_COUNT]: "6",
    [TEST_MEMORY_MAX]: "2147483648",
    [TEST_NPROC]: "64",
    [TEST_MEM_AVAIL_MB]: "1234",
  };
  const j = runProbe(["--json"], env);
  assert.equal(j.status, 0, `stderr=${j.stderr}`);
  const json = JSON.parse(j.stdout.trim());
  assert.equal(json.cgroup_v2, true, "a cgroup seam asserts the cgroup is present (that is what it simulates)");
  assert.equal(json.nproc, 64, "the nproc seam must be honoured (⛔ never silently the host reading)");
  assert.equal(json.effective_cpu, 2, "floor(250000/100000)");
  assert.equal(json.cpu_source, "cgroup-cpu-max");
  assert.equal(json.effective_mem_mb, 2048);
  assert.equal(json.mem_source, "cgroup-memory-max");

  const text = runProbe([], env);
  assert.equal(text.status, 0, `stderr=${text.stderr}`);
  const fromText = Object.fromEntries(
    text.stdout.trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  assert.deepEqual(Object.keys(fromText), FIELD_ORDER);
  assert.equal(fromText.effective_cpu, String(json.effective_cpu));
  assert.equal(fromText.cpu_source, json.cpu_source);
  assert.equal(fromText.nproc, String(json.nproc));
  assert.equal(fromText.effective_mem_mb, String(json.effective_mem_mb));

  // the cpuset seam can bind over the quota
  const cpuset = JSON.parse(runProbe(["--json"], { ...env, [TEST_CPUSET_COUNT]: "1" }).stdout.trim());
  assert.equal(cpuset.effective_cpu, 1);
  assert.equal(cpuset.cpu_source, "cpuset");

  // an UNLIMITED cpu seam falls back to the override nproc, and still reports a source
  const unlim = JSON.parse(runProbe(["--json"], { ...env, [TEST_CPU_MAX]: "max 100000", [TEST_CPUSET_COUNT]: "" }).stdout.trim());
  assert.equal(unlim.effective_cpu, 64);
  assert.equal(unlim.cpu_source, "nproc-fallback");
  assert.equal(unlim.cgroup_v2, true);

  // memory unlimited ⇒ the mem fallback seam
  const memUnlim = JSON.parse(runProbe(["--json"], { ...env, [TEST_MEMORY_MAX]: "max" }).stdout.trim());
  assert.equal(memUnlim.effective_mem_mb, 1234);
  assert.equal(memUnlim.mem_source, "free-fallback");
});

test("CLI — read-only contract: --help exits 0 with usage, an unknown arg exits 2 (⛔ never a silent report)", () => {
  const help = runProbe(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^effective-capacity-probe\.ts/);
  assert.match(help.stdout, /--json/);

  const bad = runProbe(["--nope"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown argument: --nope/);
  assert.equal(bad.stdout.includes("effective_cpu="), false, "an unknown arg must not produce a report");
});

test("no seams ⇒ the probe reports against THIS host, fail-open and with a named source", () => {
  // Whatever this host is (cgroup v2 or not), the probe must return the six fields with no throw.
  const r = probeEffectiveCapacity();
  assert.deepEqual(Object.keys(r), FIELD_ORDER);
  assert.ok(Number.isInteger(r.effective_cpu) && r.effective_cpu >= 1, JSON.stringify(r));
  assert.ok(Number.isInteger(r.effective_mem_mb) && r.effective_mem_mb >= 1, JSON.stringify(r));
  assert.ok(["cgroup-cpu-max", "cpuset", "nproc-fallback"].includes(r.cpu_source));
  assert.ok(["cgroup-memory-max", "free-fallback"].includes(r.mem_source));
  assert.equal(typeof r.cgroup_v2, "boolean");
  // ⛔ the probe never claims a cgroup constraint it did not read
  if (!r.cgroup_v2) {
    assert.equal(r.cpu_source, "nproc-fallback");
    assert.equal(r.mem_source, "free-fallback");
  } else if (r.cpu_source === "nproc-fallback") {
    assert.ok(r.effective_cpu <= hostParallelism(), "a fallback reading must not exceed the host reading");
  }
});

// ── AC4: the real cgroup v2 control ─────────────────────────────────────────────────────────────

test("AC4 — real cgroup v2 control: the probe reads the limit the KERNEL actually applied", async (t) => {
  if (!cgroupV2Mounted(CGROUP_ROOT)) {
    // 独立取值: ⛔ 不把「没查成」算成 pass（硬规则 3b）。
    t.skip("not-evaluated: no cgroup v2 unified hierarchy at /sys/fs/cgroup — the cgroup control did not run");
    return;
  }
  if (!systemdRunAvailable()) {
    t.skip("not-evaluated: systemd-run --user --scope unavailable on this host — the cgroup control did not run");
    return;
  }

  const PROPS = ["CPUQuota=300%", "MemoryMax=512M"];
  const inside = runProbeInScope(PROPS);
  assert.equal(inside.ok, true, `no reading came back from inside the scope: ${JSON.stringify(inside.why)}`);
  const raw = inside.raw;
  const report = inside.report;

  // ① the command really was in a transient scope (⛔ not "we assume systemd-run nested it")
  assert.match(raw.rel, /\.scope$/, `not in a scope: ${raw.rel}`);

  // ② the KERNEL's own raw files carry the applied limit (independent of the probe's parse)
  assert.equal(raw.cpuMax, "300000 100000", `kernel cpu.max: ${raw.cpuMax}`);
  assert.equal(raw.memMax, "536870912", `kernel memory.max: ${raw.memMax}`);

  // ③ the probe, running INSIDE that scope, reports the same limit with its provenance
  assert.equal(report.cgroup_v2, true);
  assert.equal(report.effective_cpu, 3, JSON.stringify(report));
  assert.equal(report.cpu_source, "cgroup-cpu-max", JSON.stringify(report));
  assert.equal(report.effective_mem_mb, 512, JSON.stringify(report));
  assert.equal(report.mem_source, "cgroup-memory-max", JSON.stringify(report));

  // ④ the CONTROL reading agrees — this is the AC1 measurement re-taken in situ: inside a quota
  //    scope os.availableParallelism() reports the quota, not the host's 128 cores.
  assert.equal(report.nproc, 3, `availableParallelism inside the quota scope: ${report.nproc}`);

  // ⑤ the negative control: the SAME probe OUTSIDE any scope does NOT see a 3-core world
  const outside = runProbe(["--json"]);
  assert.equal(outside.status, 0, `stderr=${outside.stderr}`);
  const out = JSON.parse(outside.stdout.trim());
  if (hostParallelism() !== 3) {
    assert.equal(out.nproc, hostParallelism(), "outside the scope the control reading is the host's");
    assert.notEqual(out.effective_cpu, 3, "the quota is what made the inside reading 3");
  }
});

/** Run BOTH readers INSIDE ONE transient scope with `properties`: the independent raw reader of the
 *  kernel's files, then the probe CLI. Same cgroup ⇒ plan / kernel-in-effect / probe reading are
 *  compared within a single scope (⛔ not "two identically-flagged scopes, so probably equal").
 *  The two scripts are handed over as env vars so no quoting of the node code is needed. */
function runProbeInScope(properties) {
  const r = runInScope(
    properties,
    ["bash", "-c", 'node -e "$__RAW__" && node --experimental-strip-types "$__PROBE__" --json'],
    { __RAW__: RAW_READER, __PROBE__: PROBE },
  );
  const json = (r.stdout ?? "").trim().split("\n").filter((l) => l.startsWith("{"));
  if (json.length < 2) {
    return { ok: false, why: { status: r.status, error: r.error?.message, stdout: r.stdout, stderr: r.stderr } };
  }
  try {
    return { ok: true, raw: JSON.parse(json[0]), report: JSON.parse(json[1]) };
  } catch (e) {
    return { ok: false, why: { parse: e.message, stdout: r.stdout, stderr: r.stderr } };
  }
}

// The raw reader above is kept as a const so the AC4 test can cite ONE definition of "the kernel's
// own reading"; this asserts it stays parseable (a broken reader must not silently look like a pass).
test("the AC4 raw reader is a real reader (self-check on a live cgroup file)", () => {
  const r = spawnSync(process.execPath, ["-e", RAW_READER], { encoding: "utf8", timeout: 120_000, env: cleanEnv() });
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const parsed = JSON.parse(r.stdout.trim());
  assert.match(parsed.rel, /^\//, `unexpected cgroup path: ${parsed.rel}`);
  assert.ok(fs.existsSync(path.join(CGROUP_ROOT, parsed.rel)), `the reader's cgroup dir must exist: ${parsed.rel}`);
  // memory.max is the file this control leans on; on a v2 host it must be readable and parseable
  // (⛔ if it is not, the AC4 assertion above would compare against an "UNREADABLE:" string).
  if (parsed.memMax.startsWith("UNREADABLE:")) {
    assert.equal(cgroupV2Mounted(CGROUP_ROOT), false, `cgroup v2 is mounted but memory.max is unreadable: ${parsed.memMax}`);
  } else {
    assert.match(parsed.memMax, /^(\d+|max)$/);
  }
});
