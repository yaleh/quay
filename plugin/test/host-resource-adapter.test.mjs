// @test-group engine
//
// host-resource-adapter.test.mjs — gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls.
//
// The defect: resource MEASUREMENT + bounded LAUNCH were Linux-cgroup-shaped code INSIDE
// full-suite-runner.ts (`memory.peak` / `memory.events` / `stat` paths + a `systemd-run` argv spelled
// by hand), so a host without cgroup v2 could not be supported without editing the runner, and the
// runner's own telemetry wrote a FABRICATED `0` for counters it never read.
//
// What this file pins:
//   ① the CONTRACT is satisfied by TWO implementations — the Linux one and the unsupported-host one —
//      with the method set ENUMERATED (硬规则 3: 布尔存在性检查会把「对象没了」伪装成「检查失败」);
//   ② every unproducible reading is `{ value: null, reason: <non-empty> }` — never `0`, never a bare
//      null without a reason (硬规则 3b/6);
//   ③ a foreign scope handle is REFUSED with a named reason rather than misread;
//   ④ the Linux adapter's readings match the real cgroup v2 wire shapes;
//   ⑤ the adapter's argv is the SAME argv the runner's `buildSystemdRunArgv` produces (ONE builder,
//      硬规则 5b) — so the serve/anchor envelope and the suite envelope cannot drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  HOST_RESOURCE_ADAPTER_ENV,
  LINUX_CGROUP_V2_KIND,
  UNSUPPORTED_HOST_KIND,
  createLinuxCgroupV2Adapter,
  createUnsupportedHostAdapter,
  parseCgroupKeyValues,
  parseCgroupNumber,
  resolveHostResourceAdapter,
  scopeHandleFromDir,
  spawnBounded,
} from "../scripts/host-resource-adapter.ts";
import { buildSystemdRunArgv, DEFAULT_SYSTEMD_RUN_LIMITS } from "../scripts/full-suite-runner.ts";

/** The contract's reading methods, ENUMERATED (⛔ not a boolean "has methods" check): every one of
 *  them must exist on every implementation and must answer `null` + a reason on a blind host. */
const READING_METHODS = ["available", "scopeOf", "readMemory", "readMemoryEvents", "readProcessTree"];
/** The contract's full method set (readings + the bounded-launch builder). */
const ALL_METHODS = [...READING_METHODS, "launchArgv", "kind"];

// ── ① both implementations satisfy the contract ──────────────────────────────────────────────────

test("contract — EVERY method of the interface exists on BOTH implementations (enumerated)", () => {
  const implementations = [
    ["linux", createLinuxCgroupV2Adapter()],
    ["unsupported", createUnsupportedHostAdapter()],
  ];
  assert.equal(implementations.length, 2, "two implementations — the interface is not Linux-only");
  for (const [label, adapter] of implementations) {
    for (const m of ALL_METHODS) {
      assert.equal(typeof adapter[m], m === "kind" ? "string" : "function", `${label} adapter is missing ${m}`);
    }
    assert.notEqual(adapter.kind, "", `${label} adapter declares a non-empty kind (it is recorded in evidence)`);
  }
  // The two kinds are DISTINCT — an evidence reader can tell which mechanism produced a reading.
  assert.notEqual(createLinuxCgroupV2Adapter().kind, createUnsupportedHostAdapter().kind);
});

// ── ② an unsupported host: null + reason for EVERY reading, never 0 ──────────────────────────────

test("AC2 unit — the unsupported-host adapter returns { value: null, reason } for EVERY reading method", () => {
  const adapter = createUnsupportedHostAdapter("fixture host: no cgroup v2 hierarchy");
  const readings = {
    available: adapter.available(),
    scopeOf: adapter.scopeOf(1234),
    readMemory: adapter.readMemory({ host: UNSUPPORTED_HOST_KIND, id: "anything" }),
    readMemoryEvents: adapter.readMemoryEvents({ host: UNSUPPORTED_HOST_KIND, id: "anything" }),
    readProcessTree: adapter.readProcessTree({ host: UNSUPPORTED_HOST_KIND, id: "anything" }),
  };
  // 硬规则 2: pair the reading with a KNOWN-POSITIVE of the same predicate — the assertion below is
  // not vacuous only if a readable host CAN produce a non-null value (asserted in the linux tests).
  assert.equal(Object.keys(readings).length, READING_METHODS.length, "every reading method was actually called");
  for (const [name, r] of Object.entries(readings)) {
    assert.equal(r.value, null, `${name} must be null on a host that cannot measure`);
    assert.equal(typeof r.reason, "string", `${name} must carry a reason string`);
    assert.ok(r.reason.length > 0, `${name}'s reason must be non-empty — a bare null is 「not evaluated」 in disguise`);
  }
  // The reason names the FIXTURE's own cause, i.e. it is carried through rather than replaced.
  assert.match(adapter.available().reason, /no cgroup v2 hierarchy/);
  // and it never claims the host can be bounded.
  assert.equal(adapter.available().value, null, "a blind host must not report a capability value");
});

test("AC2 unit — an unsupported host's launchArgv degrades to the PLAIN shell argv (unbounded, not fake-bounded)", () => {
  const argv = createUnsupportedHostAdapter().launchArgv("bash scripts/test.sh", { memoryMax: "16G", cpuQuota: "", tasksMax: "" });
  assert.deepEqual(argv, ["bash", "-c", "bash scripts/test.sh"]);
  assert.ok(!argv.includes("systemd-run"), "no supervisor verb is invented on a host that has none");
});

// ── ③ a foreign handle is refused, not misread ───────────────────────────────────────────────────

test("contract — a scope handle from ANOTHER adapter is refused with a named reason (never misread)", () => {
  const linux = createLinuxCgroupV2Adapter();
  const foreign = { host: UNSUPPORTED_HOST_KIND, id: "/tmp/whatever" };
  for (const name of ["readMemory", "readMemoryEvents", "readProcessTree"]) {
    const r = linux[name](foreign);
    assert.equal(r.value, null, `${name} must refuse a foreign handle`);
    assert.match(r.reason, /belongs to the/, `${name}'s refusal names whose handle it was`);
  }
  const malformed = linux.readMemory({ host: LINUX_CGROUP_V2_KIND });
  assert.match(malformed.reason, /malformed scope handle/);
});

// ── ④ the Linux adapter reads the real cgroup v2 wire shapes ─────────────────────────────────────

/** A cgroup-v2-shaped fixture directory (the REAL file names + the REAL key/value formats). */
function fakeCgroupDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hra-cg-"));
  fs.writeFileSync(path.join(dir, "memory.current"), "1048576\n");
  fs.writeFileSync(path.join(dir, "memory.peak"), `${321 * 1024 * 1024}\n`);
  fs.writeFileSync(path.join(dir, "memory.max"), `${16 * 1024 * 1024 * 1024}\n`);
  fs.writeFileSync(path.join(dir, "memory.swap.current"), "4096\n");
  fs.writeFileSync(path.join(dir, "memory.swap.peak"), "8192\n");
  fs.writeFileSync(
    path.join(dir, "memory.stat"),
    "anon 2048\nfile 8192\nkernel_stack 16\nslab 64\nsock 8\nshmem 32\nfile_mapped 128\ninactive_file 4096\n",
  );
  fs.writeFileSync(path.join(dir, "memory.pressure"), "some avg10=1.00 avg60=0.50 avg300=0.10 total=12345\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=99\n");
  fs.writeFileSync(path.join(dir, "memory.events"), "low 0\nhigh 4\nmax 7\noom 3\noom_kill 2\n");
  fs.writeFileSync(path.join(dir, "cgroup.procs"), "4242\n4243\n");
  return dir;
}

test("linux adapter — reads current/peak/limit/swap/stat-breakdown/PSI/events/process-tree off the real file names", () => {
  const dir = fakeCgroupDir();
  try {
    const adapter = createLinuxCgroupV2Adapter();
    const scope = scopeHandleFromDir(dir);
    const mem = adapter.readMemory(scope);
    assert.equal(mem.reason, null, "a readable scope carries NO reason");
    assert.equal(mem.value.currentBytes, 1048576);
    assert.equal(mem.value.peakBytes, 321 * 1024 * 1024, "peak comes from memory.peak, not memory.current");
    assert.equal(mem.value.limitBytes, 16 * 1024 * 1024 * 1024);
    assert.equal(mem.value.swapCurrentBytes, 4096);
    assert.equal(mem.value.swapPeakBytes, 8192, "memory.swap.peak — the swap high-water mark");
    assert.deepEqual(mem.value.stat, {
      anonBytes: 2048,
      fileBytes: 8192,
      shmemBytes: 32,
      // gap-suite-memory-telemetry-anon-file-shmem-swap-psi-concurrency-process-tree-unknown-not-zero
      // — `file_mapped` and `sock` were on the wire all along and simply never surfaced: the anon/file/
      // shmem split says WHAT filled the scope, these two say what the file half actually IS (mapped
      // executables vs socket buffers).
      fileMappedBytes: 128,
      sockBytes: 8,
      kernelBytes: null, // `kernel` is absent from this fixture ⇒ null, ⛔ not 0
      slabBytes: 64,
      inactiveFileBytes: 4096,
    });
    assert.deepEqual(mem.value.unavailableFields, { "stat.kernelBytes": `memory.stat under ${dir} carries no 'kernel' key` }, "the one stat key the kernel did not report is named — the others are NOT (a readable field must never share the 「unavailable」 shape)");
    assert.match(mem.value.pressure, /^some avg10=1\.00/);
    const ev = adapter.readMemoryEvents(scope);
    assert.deepEqual(ev.value, { oom: 3, oomKill: 2, max: 7, high: 4, unavailableFields: {} });
    const tree = adapter.readProcessTree(scope);
    assert.deepEqual(tree.value.pids, [4242, 4243]);
    // The pids are DESCRIBED as far as /proc allows: both are (almost certainly) gone on this host, so
    // each is reported with NULLs — a torn read, ⛔ never 「it used 0 bytes」 — and the tally names it.
    // If a host really has those pids, the honest reading is a positive RSS instead.
    assert.equal(tree.value.processes.length, 2);
    for (const p of tree.value.processes) {
      if (p.rssBytes === null) {
        assert.equal(p.ppid, null);
        assert.equal(p.cmdline, null);
      } else {
        assert.ok(p.rssBytes > 0, "a live pid with a readable status carries a positive RSS");
      }
    }
    if (tree.value.processes.every((p) => p.rssBytes === null)) {
      assert.match(tree.value.unavailableFields.processes, /2\/2 pid\(s\) listed by cgroup\.procs had no readable/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("linux adapter — an unreadable / counter-less scope is `unavailable`, ⛔ never a fabricated 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hra-empty-"));
  try {
    const adapter = createLinuxCgroupV2Adapter();
    const scope = scopeHandleFromDir(dir);
    // Nothing readable at all ⇒ every dimension reports its own reason.
    for (const name of ["readMemory", "readMemoryEvents", "readProcessTree"]) {
      const r = adapter[name](scope);
      assert.equal(r.value, null, `${name} on an empty dir must be null`);
      assert.ok(r.reason && r.reason.length > 0, `${name} must say WHY`);
    }
    assert.equal(adapter.readMemory(path.join(dir, "does-not-exist")).value, null);
    // A memory.events that exists but carries NEITHER counter is 「not readable」, not 「0 OOMs」.
    fs.writeFileSync(path.join(dir, "memory.events"), "low 0\nhigh 0\n");
    const noCounters = adapter.readMemoryEvents(scope);
    assert.equal(noCounters.value, null, "a counter-less memory.events must NOT be read as { oom: 0, oomKill: 0 }");
    assert.match(noCounters.reason, /neither an oom nor an oom_kill/);
    // A cgroup with no ceiling reports `max` ⇒ limitBytes null (a READING, distinct from 0 bytes).
    fs.writeFileSync(path.join(dir, "memory.max"), "max\n");
    fs.writeFileSync(path.join(dir, "memory.current"), "512\n");
    const uncapped = adapter.readMemory(scope);
    assert.equal(uncapped.value.currentBytes, 512);
    assert.equal(uncapped.value.limitBytes, null, "`memory.max = max` is 「no ceiling」, ⛔ not 0 bytes");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("linux adapter — the parsers treat `max` as 「no ceiling」 (not 0) and ignore malformed lines", () => {
  assert.equal(parseCgroupNumber("0"), 0, "a real zero is a zero");
  assert.equal(parseCgroupNumber("max"), null, "`max` is the ABSENCE of a ceiling");
  assert.equal(parseCgroupNumber(""), null);
  assert.equal(parseCgroupNumber(null), null);
  const kv = parseCgroupKeyValues("anon 12\nnot a number\nshmem 34\n\n");
  assert.equal(kv.get("anon"), 12);
  assert.equal(kv.get("shmem"), 34);
  assert.equal(kv.size, 2, "malformed lines contribute nothing (⛔ no fabricated keys)");
});

// ── ⑤ ONE argv builder: the adapter and the runner cannot drift ──────────────────────────────────

test("ONE builder — the adapter's launchArgv is byte-identical to the runner's buildSystemdRunArgv", () => {
  const adapter = createLinuxCgroupV2Adapter();
  const cases = [
    ["bare", { memoryMax: "", cpuQuota: "", tasksMax: "" }],
    ["declared ceiling", { memoryMax: "16G", cpuQuota: "", tasksMax: "" }],
    ["all dimensions", { memoryMax: "300M", cpuQuota: "400%", tasksMax: "200", memorySwapMax: "0" }],
  ];
  for (const [label, limits] of cases) {
    assert.deepEqual(
      adapter.launchArgv("bash scripts/test.sh", limits),
      buildSystemdRunArgv("bash scripts/test.sh", limits),
      `${label}: the adapter and the runner must produce the SAME argv (one builder, 硬规则 5b)`,
    );
  }
  // 硬规则 2: the predicate is not vacuous — the default template really does carry the properties.
  const def = buildSystemdRunArgv("true", DEFAULT_SYSTEMD_RUN_LIMITS);
  assert.ok(def.includes("--scope") && def.includes("OOMPolicy=continue"), "the shared builder carries the scope + OOM policy");
});

// ── ⑥ selection + the bounded spawn ──────────────────────────────────────────────────────────────

test("selection — the seam forces the adapter; production resolves by host capability, never by project", () => {
  assert.equal(resolveHostResourceAdapter({ [HOST_RESOURCE_ADAPTER_ENV]: "unsupported" }).kind, UNSUPPORTED_HOST_KIND);
  assert.equal(resolveHostResourceAdapter({ [HOST_RESOURCE_ADAPTER_ENV]: "linux-cgroup-v2" }).kind, LINUX_CGROUP_V2_KIND);
  // The default path consults the HOST, not a config key or another project's service.
  const real = resolveHostResourceAdapter({});
  assert.ok([LINUX_CGROUP_V2_KIND, UNSUPPORTED_HOST_KIND].includes(real.kind), `unexpected adapter kind ${real.kind}`);
  if (real.kind === UNSUPPORTED_HOST_KIND) {
    assert.match(real.available().reason, /no cgroup v2 hierarchy/, "the fallback names the host fact that caused it");
  }
});

test("spawnBounded — an unsupported host spawns the plain shell and reports bounded:false with an unreadable scope", async () => {
  const adapter = createUnsupportedHostAdapter("fixture: no cgroup");
  const launched = spawnBounded(adapter, { command: "echo hra-unsupported", limits: { memoryMax: "16G", cpuQuota: "", tasksMax: "" }, cwd: os.tmpdir(), env: process.env });
  assert.equal(launched.bounded, false);
  assert.deepEqual(launched.argv, ["bash", "-c", "echo hra-unsupported"]);
  let out = "";
  launched.child.stdout.on("data", (d) => (out += d));
  await new Promise((r) => launched.child.once("close", r));
  assert.match(out, /hra-unsupported/, "the un-enveloped child really ran");
  const scope = launched.scope();
  assert.equal(scope.value, null, "a blind host cannot resolve a scope");
  assert.ok(scope.reason && scope.reason.length > 0, "…and says why (never a bare null)");
});

test("spawnBounded — the caller's veto (allowBounding:false) forces the un-enveloped argv even on a boundable host", async () => {
  // A FAKE adapter that claims it can bound: this isolates `spawnBounded`'s own logic from whether
  // systemd-run happens to work on the machine running the test (⛔ no host-dependent branch).
  const fake = {
    kind: "fake-boundable",
    available: () => ({ value: { mechanism: "fake", canBound: true }, reason: null }),
    scopeOf: () => ({ value: null, reason: "fake adapter resolves no scope" }),
    readMemory: () => ({ value: null, reason: "fake" }),
    readMemoryEvents: () => ({ value: null, reason: "fake" }),
    readProcessTree: () => ({ value: null, reason: "fake" }),
    launchArgv: (command) => ["env", "bash", "-c", command],
  };
  const bounded = spawnBounded(fake, { command: "echo hra-bounded", limits: { memoryMax: "", cpuQuota: "", tasksMax: "" }, cwd: os.tmpdir(), env: process.env });
  assert.equal(bounded.bounded, true);
  assert.deepEqual(bounded.argv, ["env", "bash", "-c", "echo hra-bounded"], "the ADAPTER's argv is what gets spawned");
  await new Promise((r) => bounded.child.once("close", r));

  const vetoed = spawnBounded(fake, { command: "echo hra-vetoed", limits: { memoryMax: "", cpuQuota: "", tasksMax: "" }, cwd: os.tmpdir(), env: process.env, allowBounding: false });
  assert.equal(vetoed.bounded, false, "the caller's veto wins");
  assert.deepEqual(vetoed.argv, ["bash", "-c", "echo hra-vetoed"]);
  await new Promise((r) => vetoed.child.once("close", r));
});
