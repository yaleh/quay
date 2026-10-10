// @test-group engine

// driver-anchor-memory-envelope.test.mjs — the memory envelope of the anchor group
// (gap-driver-anchor-runs-without-host-derived-memory-envelope).
//
// WHY THIS FILE EXISTS: 2026-09-25 a `quay-drivers-*.scope` (hand-made with `systemd-run --user --scope`,
// **no MemoryMax**, no accounting) had its whole driver group + every worker OOM-killed 36 times. The
// mechanism gap was not "the operator forgot systemd-run" — it was that `spawnAnchor` spawned the anchor
// with a bare `spawn(node, […], {detached:true})`, so the six kind loops and EVERY worker inherited the
// caller's cgroup, and the only supported scope in the repo (`full-suite-runner.ts`) wrapped the SUITE.
//
// The three things this file pins (each independently falsifiable):
//   AC1(a) the MemoryMax is **host-derived** — two injected host sizes MUST give two different values,
//          and it must equal the documented derivation (a literal would give the same value twice).
//   AC1(b) `QUAY_DRIVER_SYSTEMD_RUN_LIMITS=""` ⇒ argv carries **no** `-p MemoryMax=` (「不限制」expressed
//          by not setting the property, ⛔ not by a literal that is only unlimited on the machine that
//          wrote it — CLAUDE.md 硬规则 4 推论二); the envelope itself is still reported.
//   AC1(c) systemd-run unavailable ⇒ `envelope: "none"` is **present** (an independently-valued field),
//          ⛔ not a missing field and ⛔ not silently shaped like a working envelope (硬规则 3b).
//   AC5    the enveloped argv keeps the inner argv as its **tail**, with no shell in between — that is the
//          structural reason `systemd-run --scope` (in-place exec, verified on this host) preserves the
//          `.quay/anchor.pid` semantics.
//   + a REAL-cgroup negative control: an over-allocating process inside a tiny scope is OOM-killed by the
//     KERNEL (read back from that scope's own `memory.events`), while this test process (outside the
//     scope) survives. When systemd-run is unavailable the control reports the independent value
//     `not-evaluated` — a SKIP, ⛔ not a pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { makeTmpDir } from "./helpers/tmp-workspace.mjs";
import {
  ANCHOR_ENVELOPE_HOST_FRACTION,
  ANCHOR_LIMITS_ENV,
  ANCHOR_UNIT_PREFIX,
  SHARED_HOST_MIN_CEILING_BYTES,
  SHARED_HOST_OBSERVED_PEAK_BYTES,
  SHARED_HOST_SCOPE_PREFIXES,
  anchorLaunchArgv,
  anchorSystemdRunAvailable,
  defaultAnchorMemoryMax,
  listSharedHostScopes,
  readAnchorEnvelope,
  resolveAnchorEnvelope,
  selfScopeUnitName,
  sharedHostCeilingBytes,
  sharedHostEnvelopeFraction,
} from "../scripts/driver-runtime.ts";

const GIB = 1024 ** 3;

/** 起一个超配 allocator 在 `argv` 描述的命令里跑，返回它读到的 scope 内 OOM 读数。
 *  父进程与 allocator 同时在该 scope 内：内核 OOM killer 挑内存占用最大的那个（allocator），而
 *  `OOMPolicy=continue` 让单元不因一个成员被杀而整体停掉 ⇒ 父进程活下来并把**内核直接量**打回来。 */
function oomControlScript() {
  return `
const fs = require("fs");
const { spawn } = require("child_process");
const cg = (/0::(\\S+)/.exec(fs.readFileSync("/proc/self/cgroup", "utf8")) || [])[1];
const hog = spawn(process.execPath, ["-e", "const a=[];for(;;)a.push(Buffer.alloc(32*1024*1024,1));"], { stdio: "ignore" });
hog.on("exit", (code, signal) => {
  let events = null;
  try { events = fs.readFileSync("/sys/fs/cgroup" + cg + "/memory.events", "utf8"); } catch (e) { events = "unreadable: " + e.message; }
  const oomKill = /(?:^|\\n)oom_kill (\\d+)/.exec(events);
  console.log(JSON.stringify({ cgroup: cg, hogCode: code, hogSignal: signal, oomKill: oomKill ? Number(oomKill[1]) : null, events }));
});
`;
}

test("AC1(a) — MemoryMax is host-derived: two injected host sizes give two different values", () => {
  // `siblingScopeCount: 0` pins the SINGLE-PROJECT case — the case this task's regression requirement
  // (AC3) names, and the case where the shared-host step must return the pre-change value byte for byte.
  const small = resolveAnchorEnvelope({ root: "/w/small", totalmemBytes: 64 * GIB, limitsRaw: undefined, systemdRun: true, nowMs: 1, siblingScopeCount: 0 });
  const big = resolveAnchorEnvelope({ root: "/w/big", totalmemBytes: 256 * GIB, limitsRaw: undefined, systemdRun: true, nowMs: 1, siblingScopeCount: 0 });
  assert.equal(small.source, "host-derived");
  assert.equal(big.source, "host-derived");
  assert.notEqual(small.memoryMax, big.memoryMax, "a literal default would give the SAME value for two different hosts");
  // 数值判据（⛔ 不是只比不相等）：两者都等于文档化的推导式。
  assert.equal(small.memoryMax, defaultAnchorMemoryMax(64 * GIB));
  assert.equal(big.memoryMax, defaultAnchorMemoryMax(256 * GIB));
  assert.equal(Number(big.memoryMax) / Number(small.memoryMax), 4, "the value must scale with the host (4×)");
  // 比例本身是宿主推导量，⛔ 不是某台机器的常量：派生的上限必须随注入值连续变化。
  const mid = resolveAnchorEnvelope({ root: "/w/mid", totalmemBytes: 100 * GIB, limitsRaw: undefined, systemdRun: true, nowMs: 1, siblingScopeCount: 0 });
  assert.ok(Number(mid.memoryMax) > Number(small.memoryMax) && Number(mid.memoryMax) < Number(big.memoryMax));
  assert.equal(os.totalmem() > 0, true);
  assert.ok(ANCHOR_ENVELOPE_HOST_FRACTION > 0 && ANCHOR_ENVELOPE_HOST_FRACTION < 1);
});

test("AC1(b) — an explicitly empty override string yields NO -p MemoryMax= (and still an envelope)", () => {
  const res = resolveAnchorEnvelope({ root: "/w/x", totalmemBytes: 64 * GIB, limitsRaw: "", systemdRun: true, nowMs: 7 });
  assert.equal(res.envelope, "scope");
  assert.equal(res.memoryMax, null);
  assert.equal(res.source, "env-unlimited");
  const argv = anchorLaunchArgv(["node", "driver-anchor.ts", "__anchor"], res);
  assert.equal(argv.some((a) => a.startsWith("MemoryMax=")), false, `argv must not carry MemoryMax: ${argv.join(" ")}`);
  assert.equal(argv.includes("systemd-run"), true, "the envelope (unit/OOMPolicy/accounting) still applies");
  // `MemoryMax=<empty>` 也是同一态（键在、值为空 = 不设该限制），⛔ 不是「无包络」。
  const eq = resolveAnchorEnvelope({ root: "/w/x", totalmemBytes: 64 * GIB, limitsRaw: "MemoryMax=", systemdRun: true, nowMs: 7 });
  assert.equal(eq.memoryMax, null);
  assert.equal(eq.source, "env-unlimited");
});

test("AC1(b') — an explicit override VALUE is used verbatim, and the host default is not applied", () => {
  const res = resolveAnchorEnvelope({ root: "/w/x", totalmemBytes: 64 * GIB, limitsRaw: "MemoryMax=3G", systemdRun: true, nowMs: 7 });
  assert.equal(res.memoryMax, "3G");
  assert.equal(res.source, "env-override");
  const argv = anchorLaunchArgv(["node", "a.ts"], res);
  assert.equal(argv.includes("MemoryMax=3G"), true);
});

test("AC1(c) — systemd-run unavailable ⇒ envelope:'none' is PRESENT and named (⛔ not a missing field)", () => {
  const res = resolveAnchorEnvelope({ root: "/w/x", totalmemBytes: 64 * GIB, limitsRaw: undefined, systemdRun: false });
  assert.equal(Object.hasOwn(res, "envelope"), true, "the field must exist — a missing field is indistinguishable from a broken probe");
  assert.equal(res.envelope, "none");
  assert.equal(res.memoryMax, null);
  assert.equal(res.unit, null);
  assert.equal(typeof res.reason, "string");
  assert.ok(res.reason.length > 0, "「无包络」必须带具名原因（⛔ 不给原因 = 与「没查」同形）");
  // 回退 = **原行为**：内层 argv 一字不动（⛔ 不 spawn 一个 systemd-run 的一半包装）。
  const inner = ["node", "driver-anchor.ts", "__anchor", "--root", "/w/x"];
  assert.deepEqual(anchorLaunchArgv(inner, res), inner);
  // 「无包络」与「明确不设上限」必须是两个不同取值（⛔ 不共用输出）。
  const unlimited = resolveAnchorEnvelope({ root: "/w/x", totalmemBytes: 64 * GIB, limitsRaw: "", systemdRun: true });
  assert.notEqual(unlimited.envelope, res.envelope);
  assert.notEqual(unlimited.source, res.source);
});

test("AC5 — the enveloped argv ends with the inner argv (no shell ⇒ in-place exec keeps the pid)", () => {
  const inner = ["node", "--experimental-strip-types", "/w/driver-anchor.ts", "__anchor", "--root", "/w/x", "--takeover", "42"];
  const res = resolveAnchorEnvelope({ root: "/w/x", totalmemBytes: 64 * GIB, limitsRaw: undefined, systemdRun: true, nowMs: 3 });
  const argv = anchorLaunchArgv(inner, res);
  assert.deepEqual(argv.slice(argv.length - inner.length), inner, "inner argv must be the tail — no `bash -c` in between");
  assert.equal(argv[0], "systemd-run");
  assert.equal(argv.includes("--scope"), true);
  assert.equal(argv.includes("--collect"), true, "transient scope must be collected when the anchor exits");
  assert.equal(argv.includes("OOMPolicy=continue"), true, "one OOM-killed member must not take the whole anchor down");
  assert.equal(argv.includes(`--unit=${res.unit}`), true);
  assert.equal(res.unit.startsWith(ANCHOR_UNIT_PREFIX), true);
  assert.equal(res.unit.endsWith(".scope"), true);
});

test("the env seam is read through when nothing is injected (and only then)", () => {
  const saved = process.env[ANCHOR_LIMITS_ENV];
  try {
    delete process.env[ANCHOR_LIMITS_ENV];
    assert.equal(resolveAnchorEnvelope({ root: "/w/x", totalmemBytes: 64 * GIB, systemdRun: true }).source, "host-derived");
    process.env[ANCHOR_LIMITS_ENV] = "";
    assert.equal(resolveAnchorEnvelope({ root: "/w/x", totalmemBytes: 64 * GIB, systemdRun: true }).source, "env-unlimited");
    process.env[ANCHOR_LIMITS_ENV] = "MemoryMax=5G";
    const v = resolveAnchorEnvelope({ root: "/w/x", totalmemBytes: 64 * GIB, systemdRun: true });
    assert.equal(v.memoryMax, "5G");
    assert.equal(v.source, "env-override");
    // ⛔ 注入优先于 env（否则测试缝会被宿主的 env 悄悄改写）。
    assert.equal(resolveAnchorEnvelope({ root: "/w/x", totalmemBytes: 64 * GIB, limitsRaw: "MemoryMax=9G", systemdRun: true }).memoryMax, "9G");
  } finally {
    if (saved === undefined) delete process.env[ANCHOR_LIMITS_ENV];
    else process.env[ANCHOR_LIMITS_ENV] = saved;
  }
});

test("readAnchorEnvelope — this process is NOT in this mechanism's scope: named reason, ⛔ not a bare 'none'", () => {
  const reading = readAnchorEnvelope();
  if (reading.envelope === "scope") {
    assert.equal(reading.unit.startsWith(ANCHOR_UNIT_PREFIX), true);
    assert.equal(typeof reading.memoryMax, "string");
  } else {
    assert.equal(reading.envelope, "none");
    assert.equal(typeof reading.reason, "string");
    assert.ok(reading.reason.length > 0, JSON.stringify(reading));
  }
});

test("AC4 — real-cgroup negative control: the KERNEL OOM-kills the hog inside a tiny scope", async (t) => {
  if (!anchorSystemdRunAvailable()) {
    // 独立取值：⛔ 不把「没查成」算成 pass（硬规则 3b）。
    t.skip("not-evaluated: systemd-run --user --scope unavailable on this host — the cgroup control did not run");
    return;
  }
  const res = resolveAnchorEnvelope({ root: "/w/negctl", systemdRun: true, limitsRaw: "MemoryMax=256M" });
  const inner = [process.execPath, "-e", oomControlScript()];
  const argv = anchorLaunchArgv(inner, res);
  // 让 OOM 确定发生：不许逃进 swap（否则内存在足够 swap 的宿主上可能「换出去而不是被杀」）。
  const full = [...argv.slice(0, argv.length - inner.length), "-p", "MemorySwapMax=0", ...inner];
  const r = spawnSync(full[0], full.slice(1), { encoding: "utf8", timeout: 120_000 });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}; stderr=${r.stderr}`);
  const line = (r.stdout ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
  assert.ok(line, `no reading from the control — stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)} exit=${r.status}`);
  const reading = JSON.parse(line);
  // ① 内层进程确实在那个 scope 里（⛔ 不是「我们以为它在」）。
  assert.match(reading.cgroup, /\/quay-anchor-.*\.scope$/, `not in our scope: ${reading.cgroup}`);
  // ② allocator 被内核杀掉（SIGKILL / 非零），⛔ 不是自己退出的。
  assert.equal(reading.hogSignal, "SIGKILL", `hog must be SIGKILLed by the kernel, got code=${reading.hogCode} signal=${reading.hogSignal}`);
  // ③ 杀掉这件事有**内核直接量**：该 scope 自己的 memory.events 里 oom_kill ≥ 1（⛔ 不是我们的日志行）。
  assert.ok(Number(reading.oomKill) >= 1, `scope memory.events must record the kill: ${reading.events}`);
  // ④ 负控制另一半：scope 外（本测试进程）不受影响 —— 我还活着，且我自己的 cgroup 不是那个 scope。
  assert.equal(process.pid > 0, true);
  assert.doesNotMatch(fs.readFileSync("/proc/self/cgroup", "utf8"), /quay-anchor-/);
  assert.ok(process.memoryUsage().rss > 0);
  // ⑤ scope 被 --collect 回收（⛔ 不在 user manager 里堆积）。⚠️ 回收是**异步**的：命令退出后的一小段
  // 窗口里 `LoadState` 仍是 `loaded`（实测：全量 suite 负载下必然撞上）⇒ 有界轮询到终态，⛔ 不是查一次就判死。
  if (res.unit) {
    const deadline = Date.now() + 10_000;
    let last = "";
    for (;;) {
      const show = spawnSync("systemctl", ["--user", "show", res.unit, "-p", "LoadState"], { encoding: "utf8" });
      last = show.stdout ?? "";
      if (!/LoadState=loaded/.test(last) || Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.match(last, /LoadState=(not-found|masked|dead|inactive)/, `transient scope must be collected (waited 10s): ${last}`);
  }
});

test("planned == kernel-in-effect == systemctl reading (all three, read from INSIDE the live scope)", () => {
  const planned = "268435456";
  const res = resolveAnchorEnvelope({ root: "/w/x", totalmemBytes: 64 * GIB, limitsRaw: `MemoryMax=${planned}`, systemdRun: true });
  const argv = anchorLaunchArgv([process.execPath, "-e", "0"], res);
  const idx = argv.indexOf(`MemoryMax=${planned}`);
  assert.ok(idx > 0 && argv[idx - 1] === "-p", `property must be passed as a -p pair: ${argv.join(" ")}`);
  if (!anchorSystemdRunAvailable()) return;
  // ⛔ 三个量必须在**单元还活着**时读：`--collect` 之后再问 systemctl 只会拿到一个 not-loaded 的
  // 存根（`MemoryMax=infinity`），那是「读不到」而不是「没设上限」——本测试第一版就踩了这个。
  const probe = `
const fs = require("fs"); const { execFileSync } = require("child_process");
const cg = (/0::(\\S+)/.exec(fs.readFileSync("/proc/self/cgroup", "utf8")) || [])[1];
console.log(JSON.stringify({
  cgroup: cg,
  cgroupMax: fs.readFileSync("/sys/fs/cgroup" + cg + "/memory.max", "utf8").trim(),
  systemctl: execFileSync("systemctl", ["--user", "show", process.env.PROBE_UNIT, "-p", "MemoryMax"], { encoding: "utf8" }).trim(),
}));
`;
  const inner = [process.execPath, "-e", probe];
  const full = anchorLaunchArgv(inner, res);
  const r = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PROBE_UNIT: res.unit },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}; stderr=${r.stderr}`);
  const reading = JSON.parse((r.stdout ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop());
  assert.match(reading.cgroup, /\/quay-anchor-.*\.scope$/, reading.cgroup);
  assert.equal(reading.cgroupMax, planned, "the kernel's in-effect value must equal the planned one");
  assert.equal(reading.systemctl, `MemoryMax=${planned}`, "systemctl must agree with the cgroup and the plan");
});

// ── gap-independent-anchor-memory-envelope-oversubscribes-shared-host ────────────────────────────
// MEASURED 2026-10-10 on this host: 12 live `quay-anchor-*` / `quay-serve-*` scopes, EACH carrying
// `memory.max = 66 295 676 928` (= 0.25 × the 247 GiB host) ⇒ the sum is 2.75 × the host's total
// memory. The fraction `0.25` silently assumes "this host runs ONE project's quay"; nothing
// coordinates the projects, so the assumption is simply false. The fix is read-only (count the live
// same-kind scopes, then tighten) and these tests pin its three load-bearing properties:
//   ① N ≤ 3 ⇒ BYTE-IDENTICAL to the pre-change value (the crossover: the old formula only starts
//      oversubscribing the host at N+1 = 5, i.e. (N+1) × 0.25 > 1);
//   ② N ≥ 4 ⇒ strictly tighter, and never below the measured-demand floor;
//   ③ the count itself is a REAL cgroup reading (real sibling scopes, a real tree walk) — not a mock.

const HOST_BYTES = os.totalmem();

test("shared-host — N≤3 is BYTE-IDENTICAL to the pre-change value; N≥4 tightens; the floor holds", () => {
  const projectBlind = Number(defaultAnchorMemoryMax(HOST_BYTES));
  // Fail-open: a count that was NOT evaluated returns the project-blind value, never a fabricated number.
  assert.equal(sharedHostCeilingBytes(HOST_BYTES, null), projectBlind);
  assert.equal(sharedHostEnvelopeFraction(HOST_BYTES, null), ANCHOR_ENVELOPE_HOST_FRACTION, "not-evaluated ⇒ the ORIGINAL fraction, exactly");
  // ① the crossover. (N+1) × 0.25 ≤ 1 ⟺ N ≤ 3 — below it the old formula was not oversubscribing
  // anything, so tightening there would be a behaviour change with no defect behind it.
  for (const n of [0, 1, 2, 3]) {
    assert.equal(sharedHostCeilingBytes(HOST_BYTES, n), projectBlind, `N=${n} must be byte-identical to the pre-change value`);
    assert.equal(sharedHostEnvelopeFraction(HOST_BYTES, n), ANCHOR_ENVELOPE_HOST_FRACTION, `N=${n} fraction`);
  }
  // ② N=4 is the first tightening step, and the sum over the live scopes is now bounded by the host.
  const four = sharedHostCeilingBytes(HOST_BYTES, 4);
  assert.ok(four < projectBlind, `N=4 must be strictly tighter (got ${four} vs ${projectBlind})`);
  assert.equal(four, Math.floor(HOST_BYTES / 5 / 4096) * 4096, "N=4 ⇒ the page-aligned host/(N+1) split");
  // Monotone: more live siblings can only make each ceiling smaller (up to the floor).
  let prev = projectBlind;
  for (const n of [4, 5, 6, 7, 8, 9, 12, 32]) {
    const c = sharedHostCeilingBytes(HOST_BYTES, n);
    assert.ok(c <= prev, `N=${n}: ${c} must not exceed the value at the previous count (${prev})`);
    assert.ok(c >= SHARED_HOST_MIN_CEILING_BYTES, `N=${n}: ${c} must never drop below the measured-demand floor`);
    prev = c;
  }
  // The floor itself, and where it comes from: 2 × the largest measured long-run anchor peak.
  assert.equal(SHARED_HOST_OBSERVED_PEAK_BYTES, Math.round(13.0 * GIB), "the calibration input is the MEASURED peak (13.0 GiB, cantus, 6 days)");
  assert.equal(SHARED_HOST_MIN_CEILING_BYTES, 2 * SHARED_HOST_OBSERVED_PEAK_BYTES);
  assert.equal(sharedHostCeilingBytes(HOST_BYTES, 10 ** 6), SHARED_HOST_MIN_CEILING_BYTES, "an absurd count clamps AT the floor (⛔ never a bare 1/(N+1) collapse)");
  // The two peaks the task's Finding names must stay clearly below the tightened ceiling — that is the
  // 「不能收紧到低于已观测的真实需求」 requirement, expressed against the same numbers the Finding used.
  const cantusPeak = 13.0 * GIB;
  const claudecodeuiPeak = 12.2 * GIB;
  const ceilingAtFloor = sharedHostCeilingBytes(HOST_BYTES, 10 ** 6);
  assert.ok(ceilingAtFloor >= 2 * cantusPeak && ceilingAtFloor >= 2 * claudecodeuiPeak, `${ceilingAtFloor} must keep ≥2× headroom over both measured peaks`);
  // 硬规则 4: the value is host-DERIVED — two injected hosts must give two different ceilings.
  assert.notEqual(sharedHostCeilingBytes(64 * GIB, 8), sharedHostCeilingBytes(256 * GIB, 8));
  assert.equal(sharedHostCeilingBytes(64 * GIB, 0), Number(defaultAnchorMemoryMax(64 * GIB)));
});

test("shared-host — the count is a REAL read-only cgroup walk: same-kind only, our own unit excluded, not-evaluated is its OWN value", () => {
  const root = makeTmpDir("anchor-sibling-count-");
  const slice = path.join(root, "user.slice", "user-1000.slice", "user@1000.service", "app.slice");
  fs.mkdirSync(slice, { recursive: true });
  const own = "quay-anchor-own-1.scope";
  const counted = ["quay-anchor-a-2.scope", "quay-serve-b-3.scope"];
  for (const u of [...counted, own, "run-u9.scope", "session-1.scope", "app-com.google.Chrome-7.scope"]) {
    fs.mkdirSync(path.join(slice, u), { recursive: true });
  }
  // A scope's INNER cgroup is its delegated subtree, not a unit — it must not be walked into.
  fs.mkdirSync(path.join(slice, "quay-anchor-a-2.scope", "inner"), { recursive: true });
  // A different slice still belongs to the same host: the walk is over the tree, ⛔ not over one dir.
  const other = path.join(root, "user.slice", "user-1001.slice", "user@1001.service", "app.slice");
  fs.mkdirSync(path.join(other, "quay-anchor-c-4.scope"), { recursive: true });

  const r = listSharedHostScopes({ cgroupRoot: root, ownUnit: own });
  assert.equal(r.count, 3, `only the same-kind scopes outside our own unit: ${JSON.stringify(r.units)}`);
  assert.deepEqual(r.units, ["quay-anchor-a-2.scope", "quay-anchor-c-4.scope", "quay-serve-b-3.scope"], "sorted, enumerable, and our own unit is NOT in it");
  assert.equal(r.units.includes(own), false, "our own scope is the `+1` in `N+1`, never one of the N");
  assert.equal(r.units.some((u) => u.startsWith("run-")), false, "transient per-suite scopes are a different kind");
  assert.equal(r.units.some((u) => u.includes("inner")), false, "a scope's delegated subtree is not a unit");
  assert.equal(r.reason, null);
  // The own unit is derived from /proc/self/cgroup's unified line — read it for real, too.
  assert.equal(selfScopeUnitName("0::/user.slice/user-1000.slice/user@1000.service/app.slice/" + own + "\n"), own);
  assert.equal(selfScopeUnitName("0::/user.slice/user-1000.slice/user@1000.service\n"), null, "not inside a .scope ⇒ no unit to exclude");
  assert.equal(selfScopeUnitName(null), null, "unreadable /proc/self/cgroup ⇒ null, ⛔ not a fabricated name");

  // 硬规则 3b: "could not read" must NOT share a value with "read it; there are none".
  const missing = listSharedHostScopes({ cgroupRoot: path.join(root, "does-not-exist") });
  assert.equal(missing.count, null, "an unreadable root is NOT zero");
  assert.equal(missing.count === 0, false);
  assert.equal(typeof missing.reason, "string");
  assert.ok(missing.reason.length > 0, "…and it carries a NAMED reason");
  const empty = path.join(root, "empty-root");
  fs.mkdirSync(empty);
  assert.equal(listSharedHostScopes({ cgroupRoot: empty }).count, 0, "a readable root with no same-kind scope IS zero");
  assert.notEqual(listSharedHostScopes({ cgroupRoot: empty }).count, missing.count, "the two states must not share an output value");
  // The prefix list is derived from the two EXISTING single sources, ⛔ not a third copy of the strings.
  assert.deepEqual([...SHARED_HOST_SCOPE_PREFIXES], ["quay-anchor-", "quay-serve-"]);
});

test("shared-host — an absurd sibling count on a tiny host cannot push the ceiling ABOVE the project-blind value", () => {
  for (const total of [GIB, 8 * GIB, 64 * GIB, 1024 * GIB]) {
    const projectBlind = Number(defaultAnchorMemoryMax(total));
    for (const n of [0, 1, 5, 50, 10 ** 9]) {
      assert.ok(sharedHostCeilingBytes(total, n) <= projectBlind, `total=${total} N=${n}: tightening must never LOOSEN`);
    }
  }
});

test(
  "REAL cgroup — live sibling scopes are really COUNTED, and the derived ceiling really tightens",
  { skip: anchorSystemdRunAvailable() ? false : "not-evaluated: systemd-run --user --scope unavailable on this host" },
  async () => {
    // A REAL cgroup construction (systemd-run --scope — the same technique as the AC4 negative
    // control below and as the anchor's own spawn path), ⛔ not a mock and ⛔ not an injected count:
    // four genuinely live same-kind scopes are started and then read back off the kernel's tree.
    const tag = `${Date.now()}-${process.pid}`;
    const units = [0, 1, 2, 3].map((i) => `quay-anchor-sibling-probe-${tag}-${i}.scope`);
    const started = [];
    try {
      for (const unit of units) {
        // `sleep 30` is the scope's member: it exits on its own, so a crashed test cannot leave the
        // scope behind (the fixture-leak mode this task's AC1 is about).
        const child = spawn(
          "systemd-run",
          ["--user", "--scope", "--quiet", "--collect", `--unit=${unit}`, "-p", "MemoryMax=64M", "-p", "MemorySwapMax=0", "sleep", "30"],
          { detached: true, stdio: "ignore" },
        );
        child.unref();
        started.push(unit);
      }
      // Bounded poll: the scopes appear in the cgroup tree when their units start (⛔ not "assume started").
      const deadline = Date.now() + 15_000;
      let reading = listSharedHostScopes();
      for (;;) {
        const seen = new Set(reading.units);
        if (units.every((u) => seen.has(u))) break;
        if (Date.now() >= deadline) break;
        await new Promise((r) => setTimeout(r, 200));
        reading = listSharedHostScopes();
      }
      // ① the walk really sees live scopes off the real kernel tree — by NAME, not merely "a count moved".
      const seen = new Set(reading.units);
      for (const u of units) assert.ok(seen.has(u), `${u} must appear in the real enumeration: ${JSON.stringify(reading.units)}`);
      assert.ok(reading.count >= units.length, `count ${reading.count} must be at least the ${units.length} scopes just started`);
      assert.equal(reading.units.includes(selfScopeUnitName() ?? "\u0000"), false, "our own scope must not be counted");

      // ② the PRODUCTION path uses that measured count: `resolveAnchorEnvelope` with no injected seam
      //    must resolve exactly to the formula evaluated at the count it reports back.
      const res = resolveAnchorEnvelope({ root: "/w/real-siblings", systemdRun: true, nowMs: 1 });
      assert.equal(res.siblingScopeCount, reading.count, "the returned provenance must be the count that was actually used");
      assert.equal(res.memoryMax, String(sharedHostCeilingBytes(os.totalmem(), res.siblingScopeCount)));
      assert.equal(res.source, "host-derived");
      assert.equal(res.siblingScopeReason, null);

      // ③ the ceiling really TIGHTENED relative to the project-blind one (≥4 live siblings guarantees it).
      assert.ok(res.siblingScopeCount >= 4, `expected ≥4 live same-kind scopes, got ${res.siblingScopeCount}`);
      const projectBlind = Number(defaultAnchorMemoryMax(os.totalmem()));
      assert.ok(Number(res.memoryMax) < projectBlind, `${res.memoryMax} must be strictly below the project-blind ${projectBlind}`);
      assert.ok(Number(res.memoryMax) >= SHARED_HOST_MIN_CEILING_BYTES, "and never below the measured-demand floor");
      // Deterministic mirror of the same claim, with the count injected (immune to host churn).
      const injected = resolveAnchorEnvelope({ root: "/w/real-siblings", systemdRun: true, nowMs: 1, siblingScopeCount: 4 });
      assert.equal(injected.memoryMax, String(sharedHostCeilingBytes(os.totalmem(), 4)));
      assert.ok(Number(injected.memoryMax) < projectBlind, "4 live siblings ⇒ strictly tighter than the single-project ceiling");
    } finally {
      for (const unit of started) spawnSync("systemctl", ["--user", "stop", unit], { encoding: "utf8", timeout: 20_000 });
    }
  },
);
