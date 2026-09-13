// @test-group product
// GOAL-017 / AC-251 (SPEC-unified-quay-server-2026-09-13 §7 stage A2) — `quay server status --json`
// must report the Web UI and the MCP control plane as two services under ONE pid.
//
// WHAT THIS FILE IS DEFENDING. Before stage A2, `quay serve` and `serveControlPlane` lived in two
// processes, so AC-251 was structurally false — not "unimplemented" but IMPOSSIBLE: no pid could be
// equal because there were two of them. The merge makes the reading possible; these tests make it
// TAKABLE-FALSE again in the two directions that matter:
//
//   ① the pids must be the LIVE host's (hard rule 4b: a carrier the process writes about itself is
//      not evidence on its own) — so the same pid is confirmed by TWO independent live faces
//      (HTTP GET /health, JSON-RPC initialize) AND, in the child-process test, by `ps -o args=`;
//   ② a stopped server must NOT keep reading green — both the graceful stop (carrier retired) and
//      the SIGKILL (carrier left behind, pid dead) are exercised, because "the file is still there"
//      is exactly how a dead server would masquerade as a running one.
//
// The three-way exit contract (0 running / 1 not-running / 3 not-evaluated) is asserted directly:
// AC-251's own criterion reads 3 as "unreadable" and 1 as "not achieved", so collapsing them would
// make "I could not read the carrier" indistinguishable from "no server is running".
//
// Run (scoped): node --test packages/quay/test/server-status-web-control-same-pid.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { startServer } from "../src/serve.ts";
import { readServerState, pidAlive, SERVER_STATE_REL, CONTROL_PLANE_NAME } from "../src/server-state.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

const START_TIMEOUT_MS = 30000;

/** A minimal but REAL workspace: `.quay/config.yml` pointing at the native provider (a bare
 *  `tasks/` dir is not a valid workspace — the config is a provider map, not a flat path). */
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

/**
 * Run the Core CLI as a REAL child process against `cwd` and return { code, stdout, stderr, json }.
 *
 * Why a child process and NOT the import-callable `run()`: `run({capture:true})` replaces
 * `process.stdout.write` for the duration of the call, and under `node --test` the test runner's own
 * reporter writes its v8-serialized events to fd 1 — a flush that lands inside the capture window
 * interleaves foreign bytes into the captured stdout and makes `JSON.parse` throw. Measured on this
 * very file (2026-09-13): in-process capture swallowed a `test:complete` frame of the PREVIOUS test
 * and the reading came back unparseable while the CLI had in fact printed correct JSON. A child
 * process cannot race the reporter, and it is what the AC-251 criterion itself does.
 *
 * ASYNC `spawn`, never `spawnSync`: tests that host the server IN THIS PROCESS need the event loop
 * free to answer the child's probes — a blocking spawnSync would make the server unreachable for the
 * duration and turn a green reading into `degraded`.
 */
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
        /* left null — a test that expects JSON asserts on it */
      }
      resolve({ code, stdout, stderr, json });
    });
  });
}

/** Run the criterion's OWN predicate over a `server status --json` reading — the shape AC-251
 *  checks: a `services[]` entry named web and one named control, both carrying an INTEGER pid, and
 *  the two equal. Returns null when satisfied, else the reason. */
function criterionViolation(json) {
  const svcs = {};
  for (const s of json?.services ?? []) if (s && typeof s === "object" && s.name) svcs[s.name] = s;
  const web = svcs.web;
  const ctl = svcs.control;
  if (!web || !ctl) return `status lists no web/control service (have: ${Object.keys(svcs).sort().join(",")})`;
  if (!Number.isInteger(web.pid) || !Number.isInteger(ctl.pid)) return "web/control carry no integer pid";
  if (web.pid !== ctl.pid) return `web pid ${web.pid} != control pid ${ctl.pid}`;
  return null;
}

/** Spawn a REAL `quay serve` process rooted at `ws` (detached, so the whole group can be killed). */
function spawnServe(ws) {
  const child = spawn(
    process.execPath,
    ["--no-warnings", QUAY_CLI, "serve", "--port", "0", "--host", "127.0.0.1"],
    { cwd: ws, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  return {
    child,
    out: () => ({ stdout, stderr }),
    kill() {
      try {
        process.kill(-child.pid, "SIGKILL"); // whole group: the serve process AND its provider child
      } catch {
        /* already gone */
      }
    },
  };
}

/** Poll until the workspace's carrier exists (the server publishes it after BOTH binds). */
async function waitForCarrier(ws, timeoutMs = START_TIMEOUT_MS) {
  const p = path.join(ws, SERVER_STATE_REL);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// ── AC1 + AC3 + §6.10: one process, two services, both independently live ─────────────────────────

test("AC1/AC3 — the unified server reports web+control under ONE live pid, confirmed by two independent live faces", async (t) => {
  const ws = makeWorkspace("ac251-unified");
  const prevCwd = process.cwd();
  t.after(() => {
    process.chdir(prevCwd);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  process.chdir(ws);
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  // Retire BOTH hosted services AND the HTTP listener. Leaving the web listener open is not a
  // cosmetic leak: a listening socket keeps this `node --test` file's event loop alive forever, so
  // the file would finish its tests and then hang the whole run (the failure mode
  // serve-bind-failure-no-leak.test.mjs was written for).
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await server.control.close();
    await server.client.close();
  });

  // The carrier itself: both services carry THIS process's pid (that equality is stage A2).
  const carrier = readServerState(ws);
  assert.equal(carrier.evaluated, true, "the carrier is published and readable");
  assert.deepEqual(
    carrier.state.services.map((s) => s.name).sort(),
    ["control", "web"],
    "exactly the two stage-A2 services are hosted",
  );
  for (const s of carrier.state.services) {
    assert.equal(s.pid, process.pid, `carrier service ${s.name} carries the host pid`);
    assert.ok(Number.isInteger(s.port) && s.port > 0, `carrier service ${s.name} carries the bound port`);
  }

  // The CLI reading (the criterion's exact input).
  const res = await cli(["server", "status", "--json"], ws);
  assert.equal(res.code, 0, `server status --json exits 0 (stderr: ${res.stderr})`);
  assert.equal(criterionViolation(res.json), null, "AC-251's criterion is satisfied by the reading");
  assert.equal(res.json.status, "running");
  assert.equal(res.json.pid, process.pid);

  // 硬规则 4b — the carrier is the process's OWN self-report, so it is NOT evidence by itself.
  // Two independent live faces must answer on the SAME pid's two ports:
  const web = res.json.services.find((s) => s.name === "web");
  const control = res.json.services.find((s) => s.name === "control");
  for (const s of [web, control]) {
    assert.equal(s.liveness.evaluated, true, `${s.name}: liveness was evaluated`);
    assert.equal(s.liveness.alive, true, `${s.name}: liveness is alive`);
  }

  // Independent face 1: HTTP /health on the web port.
  const health = await fetch(`http://127.0.0.1:${web.port}/health`);
  assert.equal(health.status, 200, "the web face answers /health");
  assert.equal((await health.json()).ok, true);

  // Independent face 2: a JSON-RPC `initialize` on the control port, answered by OUR control plane.
  const rpc = await fetch(`http://127.0.0.1:${control.port}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ac251-test", version: "1" } },
    }),
  });
  const raw = await rpc.text();
  const frame = JSON.parse(/^data:\s*(.+)$/m.exec(raw)?.[1] ?? raw);
  assert.equal(frame.jsonrpc, "2.0", "the control face answers JSON-RPC");
  assert.equal(frame.result.serverInfo.name, CONTROL_PLANE_NAME, "and it is OUR control plane, not a squatter");
});

// ── AC2: stopping the server must turn the reading red (graceful close AND SIGKILL) ───────────────

test("AC2 — graceful stop retires the carrier ⇒ exit 1 (≠0, ≠3); a SIGKILL leaves it stale ⇒ the dead pid is not reported as live", async (t) => {
  const ws = makeWorkspace("ac251-stop");
  const prevCwd = process.cwd();
  t.after(() => {
    process.chdir(prevCwd);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  process.chdir(ws);
  const server = await startServer({ port: 0, host: "127.0.0.1" });
  assert.equal((await cli(["server", "status", "--json"], ws)).code, 0, "green while running");

  // (a) GRACEFUL close: the carrier is retired, so the reading is "absent" — not "unreadable".
  await server.control.close();
  await new Promise((resolve) => server.close(resolve));
  await server.client.close();

  const afterClose = await cli(["server", "status", "--json"], ws);
  assert.notEqual(afterClose.code, 0, "a stopped server must not read green");
  assert.notEqual(afterClose.code, 3, "「没有 server 在跑」落在未达成，不落在未评估 (AC2)");
  assert.equal(afterClose.code, 1);
  assert.equal(afterClose.json.carrier, "absent", "the graceful close retired the carrier");
  assert.equal(afterClose.json.status, "not-running");
  assert.equal(criterionViolation(afterClose.json) !== null, true, "AC-251's criterion now fails");

  // (b) SIGKILL: no graceful close ⇒ the carrier FILE survives. It must not be believed.
  const killed = spawnServe(ws);
  t.after(() => killed.kill());
  const carrier = await waitForCarrier(ws);
  assert.ok(carrier, `the spawned server published its carrier (stderr: ${killed.out().stderr})`);
  assert.equal((await cli(["server", "status", "--json"], ws)).code, 0, "the spawned server reads green");

  const deadPid = carrier.pid;
  killed.kill();
  const deadline = Date.now() + 10000;
  while (pidAlive(deadPid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.equal(pidAlive(deadPid), false, "the spawned server is really gone (else this proves nothing)");

  assert.equal(fs.existsSync(path.join(ws, SERVER_STATE_REL)), true, "SIGKILL leaves the carrier file behind");
  const afterKill = await cli(["server", "status", "--json"], ws);
  assert.equal(afterKill.code, 1, "a stale carrier naming a dead pid is NOT-RUNNING");
  assert.notEqual(afterKill.code, 3, "「没有 server 在跑」落在未达成，不落在未评估 (AC2)");
  assert.equal(afterKill.json.carrier, "present", "the file is still there — the pid check is what turned it red");
  assert.equal(afterKill.json.status, "not-running");
  for (const s of afterKill.json.services) {
    assert.equal(s.pid, null, `${s.name}: a dead host must not be reported under a live integer pid`);
    assert.equal(s.liveness.evaluated, false, `${s.name}: the probe was NOT run — the reading says so`);
    assert.equal(s.liveness.alive, null, `${s.name}: unevaluated ≠ "down" (硬规则 3b)`);
  }
});

// ── AC3: the reported pid IS the unified server entry (ps), not an in-process impostor ────────────

test("AC3 — `ps -p <status 报出的 pid> -o args=` is the unified server entry, and web.pid === control.pid === that pid", async (t) => {
  const ws = makeWorkspace("ac251-ps");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));

  const serve = spawnServe(ws);
  t.after(() => serve.kill());
  const carrier = await waitForCarrier(ws);
  assert.ok(carrier, `the serve process published its carrier (stderr: ${serve.out().stderr})`);

  const res = await cli(["server", "status", "--json"], ws);
  assert.equal(res.code, 0, `server status --json exits 0 (stderr: ${res.stderr})`);
  assert.equal(criterionViolation(res.json), null);
  assert.equal(res.json.pid, serve.child.pid, "the reported pid is the process we started");

  const ps = spawnSync("ps", ["-p", String(res.json.pid), "-o", "args="], { encoding: "utf8" });
  assert.equal(ps.status, 0, "the reported pid is a real process");
  const cmdline = ps.stdout.trim();
  assert.match(cmdline, /serve/, `ps args are the serve entry (got: ${JSON.stringify(cmdline)})`);
  assert.ok(cmdline.includes(QUAY_CLI), `ps args carry the CLI entry ${QUAY_CLI} (got: ${JSON.stringify(cmdline)})`);
});

// ── AC5: the carrier is WORKSPACE-relative — two workspaces never read each other's server ────────

test("AC5 — two workspaces each report their OWN server's pid (never a shared/global carrier), and the carrier is untracked", async (t) => {
  const wsA = makeWorkspace("ac251-wsA");
  const wsB = makeWorkspace("ac251-wsB");
  t.after(() => {
    fs.rmSync(wsA, { recursive: true, force: true });
    fs.rmSync(wsB, { recursive: true, force: true });
  });

  const a = spawnServe(wsA);
  const b = spawnServe(wsB);
  t.after(() => {
    a.kill();
    b.kill();
  });

  const carrierA = await waitForCarrier(wsA);
  const carrierB = await waitForCarrier(wsB);
  assert.ok(carrierA && carrierB, `both workspaces published their own carrier (a:${a.out().stderr} b:${b.out().stderr})`);
  assert.notEqual(carrierA.pid, carrierB.pid, "the two servers are genuinely different processes");

  const resA = await cli(["server", "status", "--json"], wsA);
  const resB = await cli(["server", "status", "--json"], wsB);
  assert.equal(resA.code, 0, `workspace A reads its own carrier (stderr: ${resA.stderr})`);
  assert.equal(resB.code, 0, `workspace B reads its own carrier (stderr: ${resB.stderr})`);
  assert.equal(resA.json.workspaceRoot, wsA);
  assert.equal(resB.json.workspaceRoot, wsB);
  assert.equal(resA.json.pid, a.child.pid, "A reads A's process");
  assert.equal(resB.json.pid, b.child.pid, "B reads B's process");
  assert.notEqual(resA.json.pid, resB.json.pid, "the two readings are different pids");

  // Runtime state, never tracked: `git ls-files` must not know the path in ANY workspace.
  for (const ws of [wsA, wsB]) {
    const ls = spawnSync("git", ["-C", ws, "ls-files", SERVER_STATE_REL], { encoding: "utf8" });
    assert.equal(ls.stdout.trim(), "", `\`git ls-files ${SERVER_STATE_REL}\` is empty (${ws})`);
  }
  // And not in the landed commit either — the repo's own checkout does not track it.
  const lsRepo = spawnSync("git", ["-C", REPO_ROOT, "ls-files", SERVER_STATE_REL], { encoding: "utf8" });
  assert.equal(lsRepo.stdout.trim(), "", `the task's landing does not commit ${SERVER_STATE_REL}`);
});

// ── 硬规则 3b: 读不懂 ≠ 未达成 (exit 3), and --json is ALWAYS parseable ───────────────────────────

test("硬规则 3b — a corrupt / wrong-schema carrier is NOT-EVALUATED (exit 3), never silently 'not-running'", async (t) => {
  const ws = makeWorkspace("ac251-corrupt");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const carrierPath = path.join(ws, SERVER_STATE_REL);

  // No carrier at all ⇒ NOT-RUNNING (a definitive reading).
  const none = await cli(["server", "status", "--json"], ws);
  assert.equal(none.code, 1, "no carrier ⇒ 1");
  assert.equal(none.json.status, "not-running");
  assert.equal(none.json.carrier, "absent");

  // Truncated JSON ⇒ NOT-EVALUATED, and the stdout is STILL parseable JSON (so the criterion's
  // `json.loads` never turns our exit 3 into its own "non-JSON output" 3 for a different reason).
  fs.writeFileSync(carrierPath, '{"schemaVersion":1,"pid":');
  const broken = await cli(["server", "status", "--json"], ws);
  assert.equal(broken.code, 3, "unparseable carrier ⇒ 3, not 1");
  assert.equal(broken.json.status, "not-evaluated");
  assert.equal(broken.json.carrier, "unreadable");
  assert.ok(broken.json.services.length === 0, "nothing is invented for a carrier that could not be read");

  // Well-formed JSON but not our schema (a future/foreign carrier) ⇒ still NOT-EVALUATED.
  fs.writeFileSync(carrierPath, JSON.stringify({ schemaVersion: 99, pid: process.pid, startedAt: "x", services: [] }));
  const wrongSchema = await cli(["server", "status", "--json"], ws);
  assert.equal(wrongSchema.code, 3, "an unknown schemaVersion is unreadable, not 'not-running'");
  assert.equal(wrongSchema.json.status, "not-evaluated");

  // A live pid in a wrong-shaped carrier must NOT be enough to read green — the shape check gates it.
  fs.writeFileSync(carrierPath, JSON.stringify({ schemaVersion: 1, pid: process.pid, startedAt: "x", services: [{ name: "web", pid: process.pid }] }));
  const missingPort = await cli(["server", "status", "--json"], ws);
  assert.equal(missingPort.code, 3, "a service entry without a port is not the carrier's shape");
});

// ── The help surface stays in sync with the verb table (one line, machine-checkable) ─────────────

test("`quay server status` is reachable and documented — top-level usage, help block, and the bare verb", async () => {
  // Bare `quay server` is a usage error, not a silent no-op.
  const bare = await cli(["server"], REPO_ROOT);
  assert.equal(bare.code, 1);
  assert.match(bare.stderr, /usage: quay server status/);

  // `quay server --help` documents the three exit codes (the contract of the command).
  const help = await cli(["server", "--help"], REPO_ROOT);
  assert.match(help.stdout, /quay server status \[--json\]/);
  assert.match(help.stdout, /not-evaluated/);

  // `quay --help` lists the new verb next to `serve`.
  const top = await cli(["--help"], REPO_ROOT);
  assert.match(top.stdout, /quay server status \[--json\] \[--root <path>\]/);

  // The fallback usage line names it too (the verb table lives in bin/quay.ts).
  const unknown = await cli(["definitely-not-a-verb"], REPO_ROOT);
  assert.match(unknown.stderr, /server status/);
});

// ── §8 criterion 9: stage A adds NO capability beyond `status` — no start/add/stop verbs ──────────

test("SPEC §8-9 — stage A adds only `status`; the stage-B verbs start/add/stop are NOT reachable", async () => {
  for (const verb of ["start", "add", "stop"]) {
    const res = await cli(["server", verb], REPO_ROOT);
    assert.equal(res.code, 1, `\`quay server ${verb}\` is not implemented`);
    assert.match(res.stderr, /usage: quay server status/, `\`quay server ${verb}\` reports the stage-A usage, not a stage-B action`);
  }
  // And the Web UI's own flag surface did not grow a control-plane knob (env-only override).
  const help = await cli(["serve", "--help"], REPO_ROOT);
  assert.doesNotMatch(help.stdout, /--control-port/, "no new user-visible serve flag (SPEC §8 criterion 9)");
});

// ── AC4 (partial, in-repo): the dist bundle carries the same behaviour as the source tree ─────────

test("AC4 — the built dist bundle is a working unified server too (the shipped entry, not just the source)", async (t) => {
  // cli-entry.mjs falls back to bin/quay.ts with a loud warning when dist is stale/missing; assert
  // the bundle path is the one under test so this test cannot silently pass over a stale build.
  assert.ok(QUAY_CLI.endsWith(".js"), `the CLI entry under test is the prebuilt bundle (got ${QUAY_CLI})`);
  const stat = fs.statSync(QUAY_CLI);
  assert.ok(stat.isFile(), "the bundle exists");

  const ws = makeWorkspace("ac251-dist");
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const serve = spawnServe(ws); // spawnServe runs QUAY_CLI, i.e. the bundle
  t.after(() => serve.kill());

  const carrier = await waitForCarrier(ws);
  assert.ok(carrier, `the bundled server publishes a carrier (stderr: ${serve.out().stderr})`);
  const res = await cli(["server", "status", "--json"], ws);
  assert.equal(res.code, 0, "the bundled unified server reports both services under one pid");
  assert.equal(criterionViolation(res.json), null);

  // It is genuinely the bundle on disk that served, not a source-tree fallback: the process's own
  // argv (read from /proc) must name the bundle path.
  const cmdline = execFileSync("bash", ["-c", `tr '\\0' ' ' < /proc/${carrier.pid}/cmdline`], { encoding: "utf8" });
  assert.ok(cmdline.includes(QUAY_CLI), `the live process runs the bundle (got: ${JSON.stringify(cmdline)})`);
});
