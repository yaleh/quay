// @test-group lowconc
// @load-sensitive child-spawn
//
// spawn-kernel-process.test.mjs — AC1 of
// tasks/gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping.
//
// AC1: "fixture test that spawns a resident driver and then fails, times out, or is cancelled.
// Pre-fix: the driver process survives the test (pasted negative control). Post-fix: the whole
// process group is gone after the test in all three cases (pasted)."
//
// The fixture is a SMALL node:test file written into a temp dir at run time and executed by a real
// `node --test` child (the same topology as the 18h incident: `node --test` → test file → resident
// driver). Each fixture spawns the REAL resident driver (`plugin/scripts/promotion-driver.ts` with an
// injectable no-op `--ready-pool-cmd` and `--interval 1000` — the incident's leaked fixture shape at a
// lower poll rate), records its pid, then takes one of four paths: pass / throw / hang past a
// node:test timeout / keep running until the runner SIGINTs the file.
//
// Every fixture ALSO writes `<pidfile>.alive` after a short settle — the POSITIVE CONTROL that the
// driver really was resident, so the post-condition ("the group is gone") is never vacuous.
//
// Run: scripts/test.sh plugin/test/spawn-kernel-process.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pidAlive, processGroupAlive, spawnKernelProcess } from "./helpers/spawn-kernel-process.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const HELPER_PATH = path.join(__dirname, "helpers", "spawn-kernel-process.mjs");
const DRIVER_PATH = path.join(REPO_ROOT, "plugin", "scripts", "promotion-driver.ts");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The fixture must be a REAL `node --test` run. Node marks a test-file child with NODE_TEST_CONTEXT /
 * NODE_TEST_WORKER_ID, and `node --test` invoked with those set refuses to run ("node:test run() is
 * being called recursively within a test file. skipping running files" — measured, exit 0 with zero
 * tests, i.e. a SILENT no-op that would make every assertion below vacuous). Drop both for the child.
 */
function fixtureEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

async function poll(fn, { timeoutMs = 20_000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fn()) return true;
    } catch { /* not ready yet */ }
    await sleep(intervalMs);
  }
  return false;
}

/** The driver argv the fixture spawns — a resident loop (no `--once`), the incident's exact shape. */
function driverArgv(root) {
  return [
    "--no-warnings", "--experimental-strip-types", DRIVER_PATH,
    "--root", root,
    "--ready-pool-cmd",
    "node -e console.log(JSON.stringify({pool:0,should_apply:false,promotions:[],applied_promotions:[]}))",
    "--interval", "1000", "--cap", "5", "--json",
  ];
}

/**
 * Write the fixture test file. `withHelper` = true ⇒ spawn through the shared helper (post-fix
 * behaviour); false ⇒ a BARE `spawn` with no group and no cleanup (the pre-fix negative control).
 */
function writeFixture({ mode, withHelper }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `skp-fixture-${mode}-`));
  const root = path.join(dir, "ws");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const pidFile = path.join(dir, "driver.pid");
  const spawnLine = withHelper
    ? `const { pid } = spawnKernelProcess(t, process.execPath, ${JSON.stringify(driverArgv(root))}, { stdio: ["ignore", "ignore", "ignore"] });`
    : `const { spawn: bareSpawn } = await import("node:child_process"); const child = bareSpawn(process.execPath, ${JSON.stringify(driverArgv(root))}, { stdio: ["ignore", "ignore", "ignore"] }); const pid = child.pid; child.unref(); // the leaking test must still be able to FINISH, so the survivor is measured as a leak, not as a hang`;
  const body = `import { test } from "node:test";
import fs from "node:fs";
${withHelper ? `import { spawnKernelProcess } from ${JSON.stringify(HELPER_PATH)};` : ""}

const PIDFILE = ${JSON.stringify(pidFile)};
const MODE = ${JSON.stringify(mode)};

test("resident driver", { timeout: MODE === "timeout" ? 400 : 60000 }, async (t) => {
  ${spawnLine}
  fs.writeFileSync(PIDFILE, String(pid));
  // Settle, then publish the POSITIVE CONTROL: the driver really is resident at this point.
  await new Promise((r) => setTimeout(r, 300));
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { alive = false; }
  fs.writeFileSync(PIDFILE + ".alive", String(alive));
  if (MODE === "fail") throw new Error("fixture: deliberate failure after spawning a resident driver");
  if (MODE === "timeout") await new Promise(() => {}); // never resolves — node:test times it out
  if (MODE === "cancel") await new Promise((r) => setTimeout(r, 60000)); // until the runner SIGINTs us
});
`;
  const file = path.join(dir, "resident.test.mjs");
  fs.writeFileSync(file, body, "utf8");
  return { dir, file, pidFile, root, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Run the fixture to completion with a real `node --test`, returning { code, pid, alive }. */
async function runFixtureToCompletion(t, fixture) {
  const { child } = spawnKernelProcess(t, process.execPath, ["--test", fixture.file], {
    stdio: ["ignore", "pipe", "pipe"],
    env: fixtureEnv(),
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  const code = await new Promise((resolve) => child.once("close", (c) => resolve(c)));
  return readFixtureResult(fixture, code);
}

function readFixtureResult(fixture, code) {
  const pid = fs.existsSync(fixture.pidFile) ? Number(fs.readFileSync(fixture.pidFile, "utf8")) : null;
  const aliveFile = `${fixture.pidFile}.alive`;
  const wasAlive = fs.existsSync(aliveFile) && fs.readFileSync(aliveFile, "utf8").trim() === "true";
  return { code, pid, wasAlive };
}

/**
 * Settle for `pid` and the process group it leads (pgid === pid — the helper spawns `detached`, so
 * every descendant inherits that group). A signal's effect is asynchronous to the signalling process:
 * measured, a SIGKILLed driver is still readable as running for a few ms after the file child that
 * killed it has already exited, so the post-condition is read with a BOUNDED settle (≤5s) rather than
 * at one instant. Returns true iff both the pid and the group are gone within the bound.
 */
async function waitReaped(pid, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!pidAlive(pid) && !processGroupAlive(pid)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(25);
  }
}

/**
 * The post-condition, asserted identically for every terminal path: the driver pid is gone AND the
 * whole process group it led is gone.
 */
async function assertReaped({ pid, wasAlive }, label) {
  assert.equal(wasAlive, true, `${label}: positive control — the driver was resident while the test ran`);
  assert.ok(pid, `${label}: the fixture recorded the driver pid`);
  assert.equal(await waitReaped(pid), true, `${label}: the driver pid AND its whole process group are gone after the test`);
}

// ── post-fix: the helper reaps the group on every terminal path ──────────────────────────────────────

test("AC1 post-fix — SUCCESS path: the resident driver's group is gone after the test", async (t) => {
  const fixture = writeFixture({ mode: "ok", withHelper: true });
  t.after(() => fixture.cleanup());
  const res = await runFixtureToCompletion(t, fixture);
  assert.equal(res.code, 0, "the fixture test passed (this is the success path)");
  await assertReaped(res, "success");
});

test("AC1 post-fix — FAILURE path: a failing test still reaps the resident driver's group", async (t) => {
  const fixture = writeFixture({ mode: "fail", withHelper: true });
  t.after(() => fixture.cleanup());
  const res = await runFixtureToCompletion(t, fixture);
  assert.notEqual(res.code, 0, "the fixture test failed (the failure path is real)");
  await assertReaped(res, "failure");
});

test("AC1 post-fix — TIMEOUT path: a timed-out test still reaps the resident driver's group", async (t) => {
  const fixture = writeFixture({ mode: "timeout", withHelper: true });
  t.after(() => fixture.cleanup());
  const res = await runFixtureToCompletion(t, fixture);
  assert.notEqual(res.code, 0, "the fixture test timed out (the timeout path is real)");
  await assertReaped(res, "timeout");
});

test("AC1 post-fix — CANCELLATION path: SIGINT to the run still reaps the resident driver's group", async (t) => {
  const fixture = writeFixture({ mode: "cancel", withHelper: true });
  t.after(() => fixture.cleanup());
  const { child } = spawnKernelProcess(t, process.execPath, ["--test", fixture.file], {
    stdio: ["ignore", "pipe", "pipe"],
    env: fixtureEnv(),
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  // Wait until the driver is up AND the in-test positive control has been published, then cancel.
  const up = await poll(() => fs.existsSync(`${fixture.pidFile}.alive`));
  assert.equal(up, true, "the fixture reached the point where its resident driver was up");
  child.kill("SIGINT");
  const code = await new Promise((resolve) => child.once("close", (c) => resolve(c)));
  const res = readFixtureResult(fixture, code);
  await assertReaped(res, "cancellation");
});

// ── pre-fix negative control: a bare spawn leaks (proves the helper is what reaps) ──────────────────

test("AC1 negative control — a BARE spawn (no helper) leaks: the driver SURVIVES the test", async (t) => {
  const fixture = writeFixture({ mode: "fail", withHelper: false });
  t.after(() => fixture.cleanup());
  const res = await runFixtureToCompletion(t, fixture);
  assert.notEqual(res.code, 0, "the fixture test failed");
  assert.equal(res.wasAlive, true, "positive control — the bare-spawned driver was resident");
  assert.ok(res.pid, "the fixture recorded the bare-spawned driver pid");
  // THE PRE-FIX READING: nothing reaps a bare spawn, so the driver outlives the test that made it —
  // the measured 18h-leak shape. (If this ever turns green, the negative control has gone vacuous.)
  assert.equal(pidAlive(res.pid), true, "pre-fix: the bare-spawned driver survives the test (the leak class)");
  // Clean up the negative control's own leak — the test owns it and must not leak either.
  t.after(() => {
    try { process.kill(res.pid, "SIGTERM"); } catch { /* already gone */ }
    try { process.kill(res.pid, "SIGKILL"); } catch { /* already gone */ }
  });
  await sleep(50);
});
