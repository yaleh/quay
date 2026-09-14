// @test-group product
// GOAL-017 / AC-256 — SPEC §6.9 不变式 3: restarting ONE service must not take anything else with it,
// and it must be its OWN verb.
//
// WHAT THIS FILE DEFENDS
//
//   (1) `restart` exists and is NOT served by `start`. §6.9 不变式 1 says `start` on a running
//       service is a NO-OP («⛔ 更不是静默重启»); §6.9 不变式 3 constrains the *requested* restart.
//       Read together they mean the two facts must be separately observable — if `start` doubled as
//       the restart, `already-running` would stop being a reading of anything. The discriminator is
//       the SAME on both sides: the host pid. `start` ⇒ same pid; `restart` ⇒ the face really went
//       down and came back, and the HOST pid is still unchanged (a service restart is not a
//       whole-process restart — SPEC §6.9 不变式 2's distinction, which `restart` must not blur).
//
//   (2) The ANCHOR GUARD. Under SPEC §7 阶段 C (AC-255) `.quay/<prefix>.pid` names the ANCHOR
//       process — six kinds, one pid. Running the pre-stage-C per-kind `quay driver restart --kind X`
//       there would SIGTERM that anchor and take every hosted kind down. This file asserts the
//       service layer REFUSES instead, and — the load-bearing half — that the process named by the
//       pid file is still ALIVE afterwards. A guard that "reports not-evaluated" while killing the
//       process anyway would pass a naive assertion; the liveness check is what makes it a control.
//
// 硬规则 3b: `restarted` and `already-running` and `not-evaluated` are three different values here,
// and each assertion below is chosen so that folding two of them together turns it red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const START_TIMEOUT_MS = 30000;

/** A minimal but REAL workspace (a bare `tasks/` dir is not a valid workspace). */
function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${QUAY_NATIVE_CLI.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  return ws;
}

/** Run the Core CLI as a REAL child against `cwd`. ASYNC (never spawnSync): a test that hosts a
 *  server must keep the event loop free to answer the child's probes. */
function cli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", QUAY_CLI, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("exit", (code) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        /* left null; callers that expect JSON assert on it */
      }
      resolve({ code, stdout, stderr, json });
    });
  });
}

function spawnServe(ws) {
  const child = spawn(process.execPath, ["--no-warnings", QUAY_CLI, "serve", "--port", "0", "--host", "127.0.0.1"], {
    cwd: ws,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  return {
    child,
    out: () => stdout + stderr,
    kill() {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    },
  };
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

async function webOk(host, port, timeoutMs = 6000) {
  try {
    const res = await fetch(`http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status === 200;
  } catch {
    return false;
  }
}

function serviceOf(json, name) {
  assert.ok(json && Array.isArray(json.services), "the command emitted a JSON document with a services array");
  const s = json.services.find((x) => x.name === name);
  assert.ok(s, `the report carries a row for ${name}`);
  return s;
}

/** A live process we own that the guard must NOT signal. `node -e 'setInterval(()=>{},1000)'` is a
 *  real process whose pid we can put in the pid file — and whose liveness we can re-read. */
function spawnVictim() {
  const child = spawn(process.execPath, ["--no-warnings", "-e", "setInterval(()=>{}, 1000)"], { stdio: "ignore" });
  return child;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

test("AC-256 — `restart` is its own verb: it really closes and reopens the face, and the HOST pid does not move", async (t) => {
  const ws = makeWorkspace("ac256-restart");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const serve = spawnServe(ws);
  t.after(() => serve.kill());

  const carrier = await waitForCarrier(ws);
  assert.ok(carrier, `the unified host published its carrier (output: ${serve.out().slice(-400)})`);
  const web = carrier.services.find((s) => s.name === "web");
  assert.ok(web, "the carrier carries a web service");
  assert.equal(await webOk(web.host, web.port), true, "web answers before the restart (otherwise 'up after' is vacuous)");

  const r = await cli(["server", "restart", "--only", "web", "--json"], ws);
  assert.ok(r.json, `restart emitted parseable JSON (stderr: ${r.stderr}; stdout: ${r.stdout.slice(0, 300)})`);
  assert.equal(r.code, 0, `restart exited 0 (stderr: ${r.stderr})`);
  const row = serviceOf(r.json, "web");
  assert.equal(row.outcome, "restarted", "the outcome is `restarted` — ⛔ NOT `started` and ⛔ NOT `already-running`");
  assert.equal(row.pid, carrier.pid, "the host pid is UNCHANGED — a service restart is not a whole-process restart (§6.9 不变式 2)");
  assert.equal(r.json.changed, true, "`changed` is true — a restart really moved the service's identity");

  const after = await waitForCarrier(ws);
  assert.equal(after.pid, carrier.pid, "the carrier still names the same host process after the restart");
  await new Promise((r2) => setTimeout(r2, 500));
  assert.equal(await webOk(web.host, web.port), true, "web answers again after the restart — the face was reopened, not merely closed");
});

test("AC-256 (§6.9 不变式 1) — `start` on a RUNNING service is a no-op: same pid, `already-running`, ⛔ never a silent restart", async (t) => {
  const ws = makeWorkspace("ac256-norestart");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const serve = spawnServe(ws);
  t.after(() => serve.kill());

  const carrier = await waitForCarrier(ws);
  assert.ok(carrier, `the unified host published its carrier (output: ${serve.out().slice(-400)})`);

  const r = await cli(["server", "start", "--only", "web", "--json"], ws);
  assert.equal(r.code, 0, `start on a running service exits 0 (stderr: ${r.stderr})`);
  const doc = JSON.parse(r.stdout);
  const row = serviceOf(doc, "web");
  assert.equal(row.outcome, "already-running", "`already-running` — the value `restart` must NOT be able to produce");
  assert.equal(row.pid, carrier.pid, "the pid is unchanged: this was a no-op, not a restart");
  assert.equal(doc.changed, false, "`changed` is false — «nothing was asked that had not already been done»");

  // The contrast that makes the two verbs separable: `restart` produces a DIFFERENT outcome on the
  // very same service. If `start` were allowed to serve as `restart` (or vice versa), one of these
  // two assertions would have to be relaxed — which is the drift this pair exists to catch.
  const rr = await cli(["server", "restart", "--only", "web", "--json"], ws);
  assert.equal(rr.code, 0, `restart still works after the no-op start (stderr: ${rr.stderr})`);
  assert.equal(serviceOf(JSON.parse(rr.stdout), "web").outcome, "restarted", "…and it reports a DIFFERENT outcome on the SAME service");
});

test("AC-256 — `restart` without `--only` is refused: the minimal blast radius of a restart is ONE service", async (t) => {
  const ws = makeWorkspace("ac256-restart-all");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const r = await cli(["server", "restart", "--json"], ws);
  assert.notEqual(r.code, 0, "restarting everything is not what this verb means");
  assert.match(r.stderr, /requires --only/, "and the refusal says why");
  assert.equal(r.stdout, "", "nothing was emitted on stdout — no report of a restart that never happened");
});

test("AC-256 ANCHOR GUARD — a kind hosted by an anchor is REFUSED, and the anchor process is left ALIVE", async (t) => {
  const ws = makeWorkspace("ac256-anchor");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));

  // The victim stands in for the anchor: a real, live process we own. The pid file is the ONE
  // carrier `driverRunning` reads, so putting the victim's pid there makes `st.pid === anchor.pid`.
  const victim = spawnVictim();
  t.after(() => {
    try {
      victim.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  });
  fs.writeFileSync(path.join(ws, ".quay", "worker-driver.pid"), `${victim.pid}\n`);
  fs.writeFileSync(
    path.join(ws, ".quay", "anchor.json"),
    JSON.stringify({ pid: victim.pid, startedAt: new Date().toISOString(), kinds: ["worker", "promotion"], host: "anchor" }),
  );
  assert.equal(alive(victim.pid), true, "the stand-in anchor is alive before the command");

  const r = await cli(["server", "restart", "--only", "driver:worker", "--json"], ws);
  const doc = r.json ?? JSON.parse(r.stdout);
  const row = serviceOf(doc, "driver:worker");
  assert.equal(row.outcome, "not-evaluated", "the guard refuses — ⛔ it must not report `restarted`");
  assert.equal(doc.changed, false, "and nothing was changed");
  assert.equal(row.pid, victim.pid, "the row names the anchor pid it refused to touch");
  assert.match(row.detail, /anchor/i, "the detail says WHY (a per-kind restart here is a loop respawn, not a process replacement)");
  assert.notEqual(r.code, 0, "the refusal is non-zero (a refusal reported as success is 硬规则 3b's failure)");

  // 🔴 The load-bearing half: a guard that merely *reports* not-evaluated while signalling the
  // process anyway would satisfy every assertion above. Only the liveness re-read rules that out.
  assert.equal(alive(victim.pid), true, "the anchor process is STILL ALIVE — the guard refused instead of killing five other services");
});

test("AC-256 — `restart` is advertised in the verb list and the help surface (a verb the user cannot discover is not there)", async () => {
  const ws = makeWorkspace("ac256-help");
  const r = await cli(["server", "--help"], ws);
  fs.rmSync(ws, { recursive: true, force: true });
  assert.equal(r.code, 0, `\`quay server --help\` exits 0 (stderr: ${r.stderr})`);
  assert.match(r.stdout, /quay server restart --only/, "the usage line advertises `restart --only`");
  assert.match(r.stdout, /started \| already-running \| restarted \| stopped/, "and the --json outcome vocabulary documents `restarted` alongside the other five");
});
