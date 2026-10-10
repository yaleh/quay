// @test-group product
// gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts
//
// WHAT THIS FILE DEFENDS (measured 2026-10-06, cantus): a serve host started through the DEFAULT path
// was `spawn(…, { detached: true })` and nothing more. `detached:true` leaves the SESSION but **not
// the cgroup** ⇒ the host stayed inside the caller's (CloudCLI session) scope, and restarting
// `claudecodeui-server.service` (KillMode=control-group) killed it together with that scope. A host
// hand-wrapped in `systemd-run --user --scope` in the SAME session survived the restart.
//
// The fix puts the host in its OWN transient `quay-serve-*.scope` through ONE shared implementation
// (`packages/quay/src/systemd-scope.ts`, also used by `plugin/scripts/start-drivers.ts:startServe`).
// These criteria read the RESULT from outside the process — `/proc/<pid>/cgroup` (the kernel's own
// reading), `/proc/<pid>/cmdline`, and the on-disk carrier — never the argv we intended to pass
// (硬规则 4b: an echo of our own parameters is not a measurement).
//
// 硬规则 4c: the assertions below were taken as REAL readings before they were written — on this host
// `/proc/<pid>/cgroup` is
//   `0::/user.slice/user-<uid>.slice/user@<uid>.service/app.slice/quay-serve-<root>-<ts>.scope`
// so the criterion's `/app.slice/quay-serve-…` tail is asserted on the path from `app.slice` onward
// (the user-manager prefix is host-specific and NOT part of the mechanism's naming).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { spawnHost } from "../src/cli/server.ts";
import {
  systemdScopeAvailable,
  serveScopeUnavailableReport,
  SERVE_SCOPE_UNAVAILABLE,
  scopeProbeArgv,
  runScopeProbe,
  scopeLaunchArgv,
  resolveScopeEnvelope,
} from "../src/systemd-scope.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
// The repo's own comment stripper (plugin/scripts/source-text-lib.ts) — the criterion is
// 「排除注释后」(comments MAY name the literal; CODE may not).
import { stripComments } from "../../../plugin/scripts/source-text-lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// `<repo>/packages/quay/test` → three levels up is the repo root.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const nativeProviderDir = path.join(REPO_ROOT, "packages", "quay-native", "bin");
const START_TIMEOUT_MS = 30000;

/** The caller's OWN cgroup path (from `/proc/self/cgroup`'s unified `0::…` line). */
function cgroupPathOf(pid) {
  const m = /(?:^|\n)0::(\/\S*)/.exec(fs.readFileSync(`/proc/${pid}/cgroup`, "utf8"));
  return m ? m[1] : null;
}

/** The mechanism's own slice-relative tail: everything from `app.slice/` onward. On this host the full
 *  path is `/user.slice/user-<uid>.slice/user@<uid>.service/app.slice/<unit>.scope`; the criterion's
 *  「以 /app.slice/quay-serve- 开头」 is asserted on THIS tail (⛔ the user-manager prefix is
 *  host-specific and is not part of the mechanism's naming). */
function scopeTail(cgPath) {
  const at = cgPath.indexOf("/app.slice/");
  return at === -1 ? cgPath : cgPath.slice(at);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** A real workspace: a bare `tasks/` dir is not one (the config is a provider map). The provider is
 *  named explicitly (path/tasks_dir/mcp_entry) so this criterion does not depend on the installed
 *  version's default resolution. */
function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir}"\n    tasks_dir: "${tasksDir}"\n    mcp_entry: ["node", "${QUAY_NATIVE_CLI}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir}"\n`,
  );
  return ws;
}

async function waitForCarrier(ws, timeoutMs = START_TIMEOUT_MS) {
  const p = path.join(ws, ".quay", "server.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      /* absent or half-written — retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** Stop the host by PID (⛔ never `pkill -f`, which would match unrelated `quay.ts serve` peers on
 *  this host) and wait for its transient scope to be collected. */
async function killHostAndWaitScope(pid, unit) {
  if (pid && pidAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!pid || !pidAlive(pid)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (unit) {
    // `--collect` reaps the scope asynchronously; bounded poll to its terminal state.
    const dl = Date.now() + 10000;
    while (Date.now() < dl) {
      const show = spawnSync("systemctl", ["--user", "show", unit, "-p", "LoadState"], { encoding: "utf8" });
      if (/LoadState=(not-found|masked|dead|inactive)/.test(show.stdout ?? "")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

test("AC1 — a host spawned by `spawnHost` runs in its OWN `quay-serve-*.scope`, not the caller's cgroup", async (t) => {
  if (!systemdScopeAvailable()) {
    // 独立取值：⛔ 不把「没查成」算成 pass。The fallback branch (AC3) below still runs on this host.
    t.skip("not-evaluated: systemd-run --user --scope unavailable on this host — the scope membership of a spawned host was not measured");
    return;
  }
  // The workspace basename starts with `test-` so the transient unit is `quay-serve-test-…` and a
  // residue check can find it by name (AC7).
  const ws = makeWorkspace("test-serve-own-scope");
  let hostPid = null;
  let unit = null;
  t.after(async () => {
    await killHostAndWaitScope(hostPid, unit);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  // Drive the REAL spawn path with the REAL CLI entry: `quay server …` → `spawnHost` → `quay serve`.
  // `warnScope` is captured so the SUCCESS path can be asserted to emit NO report — that is what makes
  // `serve-scope-unavailable` (asserted in the AC3 case) a DISCRIMINATING reading rather than a token
  // that appears on both paths.
  const scopeReports = [];
  const spawnErr = spawnHost(ws, ["web"], undefined, undefined, { entry: QUAY_CLI, warnScope: (line) => scopeReports.push(line) });
  assert.equal(spawnErr, null, `spawnHost reports no locating error (got ${JSON.stringify(spawnErr)})`);
  assert.deepEqual(scopeReports, [], "with a working envelope the success path emits NO `serve-scope-unavailable` report");

  const carrier = await waitForCarrier(ws);
  assert.ok(carrier && Number.isInteger(carrier.pid), `the spawned host published a carrier naming its pid (got ${JSON.stringify(carrier)})`);
  hostPid = carrier.pid;
  assert.equal(pidAlive(hostPid), true, "the pid the carrier names is really alive");

  // ① the kernel's own reading: the host is in a transient `quay-serve-*.scope` …
  const cg = cgroupPathOf(hostPid);
  assert.ok(cg, `could not read /proc/${hostPid}/cgroup`);
  const tail = scopeTail(cg);
  assert.ok(
    tail.startsWith("/app.slice/quay-serve-"),
    `the host must live in its own quay-serve-* scope; got cgroup=${cg} (tail=${tail})`,
  );
  assert.ok(tail.endsWith(".scope"), `…a transient scope; got cgroup=${cg}`);
  unit = cg.split("/").filter(Boolean).pop();

  // ② …and NOT in the caller's cgroup. This is the load-bearing difference: without the envelope the
  //    host inherits this test process's scope and dies with it.
  const callerCg = cgroupPathOf(process.pid);
  assert.notEqual(cg, callerCg, `the host must not share the caller's cgroup (caller=${callerCg})`);

  // ③ pid semantics are unchanged by the envelope: the process named on disk is the host, and it is
  //    really `serve` (`--scope` execs in place ⇒ no middle `systemd-run` process, no shell).
  const cmdline = fs.readFileSync(`/proc/${hostPid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
  assert.ok(cmdline.includes("serve"), `the host's cmdline must be "quay serve …"; got ${JSON.stringify(cmdline)}`);
  // Re-read the carrier FROM DISK (⛔ not the earlier parse) and compare the parsed pid: the writer's
  // formatting is not this criterion's business, the recorded PID is.
  const onDisk = JSON.parse(fs.readFileSync(path.join(ws, ".quay", "server.json"), "utf8"));
  assert.equal(onDisk.pid, hostPid, "the on-disk carrier really names the live pid (a direct reading, not our intent)");
});

test("AC3 — systemd-run unavailable: the host is STILL spawned, and the loss of protection is REPORTED (`serve-scope-unavailable`)", async (t) => {
  const ws = makeWorkspace("test-serve-scope-fallback");
  const marker = path.join(ws, "fixture-ran.txt");
  const fixture = path.join(ws, "host-fixture.mjs");
  fs.writeFileSync(
    fixture,
    `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, "ran\\n");\nsetTimeout(() => process.exit(0), 200);\n`,
  );
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));

  // The availability seam is consulted BEFORE the memo, so forcing "0" drives the fallback even on a
  // host where the real probe would have said true (this file's AC1 case may have run first).
  const saved = process.env.QUAY_TEST_SYSTEMD_RUN_AVAILABLE;
  const reports = [];
  let spawnErr;
  try {
    process.env.QUAY_TEST_SYSTEMD_RUN_AVAILABLE = "0";
    assert.equal(systemdScopeAvailable(), false, "setup: the seam really forced the unavailable branch");
    spawnErr = spawnHost(ws, ["web"], undefined, undefined, { entry: fixture, warnScope: (line) => reports.push(line) });
  } finally {
    if (saved === undefined) delete process.env.QUAY_TEST_SYSTEMD_RUN_AVAILABLE;
    else process.env.QUAY_TEST_SYSTEMD_RUN_AVAILABLE = saved;
  }

  // (a) the degradation is REPORTED, exactly once, with the stable token.
  assert.equal(spawnErr, null, "the spawn is NOT refused — an unprotected host is still better than no host");
  assert.equal(reports.length, 1, "reported exactly once (neither swallowed nor repeated)");
  assert.match(reports[0], new RegExp(SERVE_SCOPE_UNAVAILABLE), "…with the stable token (硬规则 3b: ⛔ silent fallback is the defect)");
  assert.match(reports[0], /cgroup scope/, "…naming what is missing");

  // (b) the load-bearing half: "reported" did NOT replace "spawned" — the behaviour is the pre-fix one.
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(marker) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.ok(fs.existsSync(marker), "the host was REALLY spawned despite the missing envelope");

  // (c) the two paths are DISTINGUISHABLE: the report helper yields nothing for a working envelope.
  assert.equal(
    serveScopeUnavailableReport({ envelope: "scope", memoryMax: "1G", source: "env-override", unit: "quay-serve-x.scope", reason: null }),
    null,
    "a working envelope must produce NO report — otherwise the token would be present on both paths",
  );
});

test("AC2 (shared implementation) — neither spawn site builds a `systemd-run` argv; the literal lives in ONE shared module", () => {
  const strip = (src) => stripComments(src);
  const SITES = ["packages/quay/src/cli/server.ts", "plugin/scripts/start-drivers.ts"];
  for (const rel of SITES) {
    const raw = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const code = strip(raw);
    assert.equal(
      /systemd-run/.test(code),
      false,
      `${rel} must NOT spell a \`systemd-run\` argv of its own — it must go through the shared implementation`,
    );
    // The import SPECIFIER lives in a string literal, so this half also reads the raw source: the
    // requirement is that the file reaches the ONE shared module, however it spells the path.
    assert.match(
      raw,
      /from\s+"[^"]*systemd-scope\.ts"/,
      `${rel} must reach the shared envelope implementation (packages/quay/src/systemd-scope.ts)`,
    );
  }
  // NEGATIVE CONTROL for the predicate itself (硬规则 2: a zero count must be paired with a reading of
  // a KNOWN-POSITIVE sample, else 「0」 is indistinguishable from 「the stripper is broken」).
  const positive = strip(fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "full-suite-runner.ts"), "utf8"));
  assert.equal(
    /systemd-run/.test(positive),
    true,
    "the stripper must not be over-broad: full-suite-runner.ts really does build a systemd-run argv",
  );
  // …and the shared implementation itself is the one place that spells it.
  const shared = strip(fs.readFileSync(path.join(REPO_ROOT, "packages", "quay", "src", "systemd-scope.ts"), "utf8"));
  assert.equal(/systemd-run/.test(shared), true, "the shared module is where the literal lives");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// gap-systemd-scope-probe-params-differ-from-real-scope
//
// The availability probe and the REAL invocation must share ONE property definition, so 「probe
// green」 STRUCTURALLY implies the real `systemd-run` accepts the same properties. Measured defect
// (systemd 245, 2026-10-10): the probe carried ONLY `MemoryAccounting=yes` while the real argv added
// `OOMPolicy=continue`, which 245 REJECTS on a `.scope` (`Unknown assignment: OOMPolicy=continue`) ⇒
// green probe, red real call ⇒ the host silently ran without its cgroup envelope (硬规则 3b/4).
//
// NOTE on host coverage (AC2/AC3): this host is systemd 255, where BOTH old and new probes pass — so
// the 245-specific rejection cannot be reproduced here. The readings are therefore (a) an ISOMORPHIC
// negative control (inject a property the host's systemd does not recognise → the probe must report
// unavailable, AC2) and (b) the structural parity + mutation control (AC3). DoD's 「真实落地」 is the
// probe now carrying the real invocation's property list, proven by a REAL systemd-run execution.

/** The `-p <assign>` VALUES in an argv (the property assignments, ⛔ not the flags). */
function propertyPairs(argv) {
  const out = [];
  for (let i = 0; i < argv.length - 1; i++) if (argv[i] === "-p") out.push(argv[i + 1]);
  return out;
}

/** The real invocation's argv with no ceiling (so its property set is the version-sensitive base). */
function realScopeArgv() {
  return scopeLaunchArgv(["true"], { envelope: "scope", memoryMax: null, unit: "quay-serve-probe-parity.scope" });
}

test("probe-parity AC1 — the envelope's property list is defined in ONE place (`OOMPolicy=continue` is not a 2nd literal)", () => {
  const src = path.join(REPO_ROOT, "packages", "quay", "src", "systemd-scope.ts");
  const code = stripComments(fs.readFileSync(src, "utf8"));
  const hits = code.match(/OOMPolicy=continue/g) ?? [];
  assert.equal(
    hits.length,
    1,
    `the version-sensitive property must appear exactly once as CODE (in the ONE shared definition); got ${hits.length}`,
  );
  // 硬规则 2: pair the count with a KNOWN-POSITIVE reading of the SAME predicate — else 「1」 is
  // indistinguishable from 「the stripper is broken and removed the literal too」.
  assert.ok(
    propertyPairs(realScopeArgv()).includes("OOMPolicy=continue"),
    "the real invocation really does pass the property (the predicate is not vacuous)",
  );
});

test("probe-parity AC2 — negative control: an unrecognised property makes the probe report UNAVAILABLE, not a false green", (t) => {
  // Positive control FIRST: on a host where the probe cannot run at all, both readings are meaningless
  // ⇒ report the independent 「not-evaluated」 value instead of a fake pass.
  if (!runScopeProbe(scopeProbeArgv())) {
    t.skip("not-evaluated: systemd-run --user --scope is not usable on this host — the probe reading was not taken");
    return;
  }
  const argv = scopeProbeArgv();
  // Inject BEFORE the trailing `true` member — the same shape the systemd-245 `OOMPolicy=continue`
  // rejection takes (a property assignment the host's systemd does not know).
  argv.splice(argv.length - 1, 0, "-p", "QuayProbeNegativeControl=xyz");
  assert.equal(
    runScopeProbe(argv),
    false,
    "a property the host's systemd does not recognise must make the probe report unavailable (⛔ never a green)",
  );
});

test("probe-parity AC3 — mutation control: the probe carries EVERY property the real invocation carries", () => {
  // Reverting the probe to `-p MemoryAccounting=yes` alone (the measured systemd-245 defect) turns
  // THIS test red: the missing `OOMPolicy=continue` pair is exactly what the loop below asserts.
  const realProps = propertyPairs(realScopeArgv());
  const probeProps = propertyPairs(scopeProbeArgv());
  for (const p of realProps) {
    assert.ok(
      probeProps.includes(p),
      `the probe must exercise the property ${JSON.stringify(p)} the real invocation relies on — else 「probe green」 does NOT imply the real call succeeds`,
    );
  }
  // The probe uses the plain binary name; `--unit`/`--collect` are per-invocation plumbing, not the
  // version-sensitive mechanism, so they are deliberately NOT part of the parity requirement.
  assert.equal(scopeProbeArgv()[0], "systemd-run");
});

test("probe-parity AC4 — systemd-run unavailable and available are two DISTINGUISHABLE values (硬规则 3b)", () => {
  // (a) a binary that cannot be executed at all ⇒ false (⛔ neither a throw nor a green).
  assert.equal(
    runScopeProbe(["quay-no-such-systemd-run-binary-xyz", "--user", "--scope", "true"]),
    false,
    "an absent binary reads as 'unavailable', not as an exception and not as 'available'",
  );
  // (b) the two values reach INDEPENDENT envelope shapes: 「none」 + a NAMED reason vs 「scope」.
  const none = resolveScopeEnvelope({ prefix: "quay-serve-", root: "/w/x", limitsEnv: "QUAY_X_PROBE_PARITY", systemdRun: false });
  const scope = resolveScopeEnvelope({ prefix: "quay-serve-", root: "/w/x", limitsEnv: "QUAY_X_PROBE_PARITY", systemdRun: true, totalmemBytes: 1024 ** 3, nowMs: 1 });
  assert.equal(none.envelope, "none");
  assert.ok(none.reason && none.reason.length > 0, "the unavailable value carries a NAMED reason (⛔ not a bare/missing field)");
  assert.equal(scope.envelope, "scope");
  assert.notEqual(none.envelope, scope.envelope, "available and unavailable must not share one shape");
});
