// @test-group governance
// promotion-driver-launch.test.mjs — AC1-3 (tasks/gap-resident-driver-stable-carrier-liveness):
// the resident supervisor/driver must be carried from a STABLE path (main checkout, not a short-lived
// worktree) and a death must be detected + reported within a window (not read as "normal").
//
// AC1 (稳定承载): launch from a git worktree ⇒ the supervisor's cmdline script path is the MAIN
//   checkout, ⛔ not the worktree path. Falsifiable: cmdline contains the worktree path ⇒ false.
// AC2 (死亡告警): a stale supervisor pid file (points at a dead pid) ⇒ `liveness` reports DEATH
//   (exit 1 + deaths field + a durable DEATH line in promotion-driver-liveness.log). Falsifiable:
//   pid file → dead pid yet nobody reports ⇒ false.
// AC3 (supervisor 死): kill -9 the supervisor ⇒ (a) `liveness` reports supervisor_dead, (b) the
//   orphan driver is no longer misjudged as "running" (running = supervisor_alive && driver_alive).
//   Falsifiable: supervisor dead + carrier stall read as "normal" ⇒ false.
//
// Run: scripts/test.sh plugin/test/promotion-driver-launch.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "promotion-driver-launch.sh");

if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {

// A fake promotion-driver.ts (CJS under strip-types in a bare temp root): writes its pid to the
// --pid-file arg (mirroring the real driver's --pid-file self-write that cmd_start waits for), then
// idles forever so the supervisor has a live child to supervise.
const FAKE_DRIVER = [
  "const fs = require(\"node:fs\");",
  "const argv = process.argv.slice(2);",
  "const i = argv.indexOf(\"--pid-file\");",
  "if (i >= 0 && argv[i + 1]) fs.writeFileSync(argv[i + 1], String(process.pid));",
  "setInterval(() => {}, 1000);",
  "",
].join("\n");

function run(args, opts = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env },
    timeout: opts.timeout || 30000,
  });
}

// A hermetic root carrying the fake driver + a copy of the launch script. The launch script
// re-execs the supervisor via `$ROOT/plugin/scripts/promotion-driver-launch.sh`, so a copy must
// live in the temp root (not just the real SCRIPT in this worktree).
function makeRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pd-launch-${tag}-`));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, "promotion-driver.ts"), FAKE_DRIVER, "utf8");
  fs.copyFileSync(SCRIPT, path.join(scripts, "promotion-driver-launch.sh"));
  return root;
}

function readPid(root, name) {
  const p = path.join(root, ".quay", name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : "";
}

function killIfAlive(pid) {
  if (!pid) return;
  try { process.kill(Number(pid), "SIGKILL"); } catch { /* already gone */ }
}

// A pid that is definitely not alive (a fully-reaped child's pid — spawnSync reaps it).
function deadPid() {
  return spawnSync("true", { encoding: "utf8" }).pid;
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

// A real git main checkout + a linked worktree (both carrying the fake driver + launch script), so
// the AC1 launch-from-worktree path actually traverses `git worktree list`.
function makeGitWorktree() {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), "pd-main-"));
  const wt = path.join(os.tmpdir(), `pd-wt-${path.basename(main)}`);
  const scripts = path.join(main, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, "promotion-driver.ts"), FAKE_DRIVER, "utf8");
  fs.copyFileSync(SCRIPT, path.join(scripts, "promotion-driver-launch.sh"));
  git(main, ["init", "-q"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "init"]);
  git(main, ["worktree", "add", "-q", wt, "HEAD"]);
  return { main, wt };
}

function livenessJson(root) {
  const r = run(["liveness", "--root", root, "--json"]);
  return { status: r.status, json: JSON.parse(r.stdout.trim()), stderr: r.stderr };
}

// ── AC2 (falsifiable): stale pid file → death reported, not read as "normal" ─────────────────────

test("AC2 — a stale supervisor pid file (dead pid) ⇒ liveness reports DEATH + exit 1 + durable log", (t) => {
  const root = makeRoot("ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "promotion-driver-supervisor.pid"), String(deadPid()), "utf8");

  const { status, json } = livenessJson(root);
  assert.equal(status, 1, `dead supervisor ⇒ exit 1, got ${status}`);
  assert.equal(json.running, 0);
  assert.match(json.deaths, /supervisor_dead/, `deaths names supervisor_dead: ${json.deaths}`);
  assert.equal(json.supervisor_alive, 0);

  // Durable report: the liveness log gained a DEATH line (a report that outlives stdout).
  const log = fs.readFileSync(path.join(root, ".quay", "promotion-driver-liveness.log"), "utf8");
  assert.match(log, /DEATH deaths=supervisor_dead/, `durable DEATH line written:\n${log}`);
});

test("AC2 positive control — a live supervisor+driver ⇒ liveness exit 0 + deaths=none (⛔ not structurally green)", (t) => {
  const root = makeRoot("ac2-pos");
  t.after(() => {
    run(["stop", "--root", root], { timeout: 15000 });
    fs.rmSync(root, { recursive: true, force: true });
  });
  const start = run(["start", "--root", root, "--restart-delay", "1", "--run-id", "ac2pos"]);
  assert.equal(start.status, 0, `start failed: ${start.stdout}\n${start.stderr}`);
  const spid = readPid(root, "promotion-driver-supervisor.pid");
  const dpid = readPid(root, "promotion-driver.pid");
  assert.ok(spid && dpid, "supervisor and driver pid files both written");

  const { status, json } = livenessJson(root);
  assert.equal(status, 0, `healthy ⇒ exit 0, got ${status}: ${json}`);
  assert.equal(json.running, 1);
  assert.equal(json.deaths, "none");
});

// ── AC3 (falsifiable): kill -9 supervisor ⇒ reported + orphan driver not misjudged ──────────────

test("AC3 — kill -9 supervisor ⇒ liveness reports supervisor_dead AND driver not misjudged as running", async (t) => {
  const root = makeRoot("ac3");
  const spid = () => readPid(root, "promotion-driver-supervisor.pid");
  const dpid = () => readPid(root, "promotion-driver.pid");
  t.after(() => {
    killIfAlive(dpid());
    killIfAlive(spid());
    fs.rmSync(root, { recursive: true, force: true });
  });

  const start = run(["start", "--root", root, "--restart-delay", "1", "--run-id", "ac3test"]);
  assert.equal(start.status, 0, `start failed: ${start.stdout}\n${start.stderr}`);
  const supervisorPid = spid();
  assert.ok(supervisorPid, "supervisor pid recorded");

  // Positive control: before the kill, the resident driver is in service.
  assert.equal(livenessJson(root).json.running, 1, "running=1 before the kill");

  // AC3 falsifiable: SIGKILL the supervisor (the real 33-minute-unnoticed failure mode).
  process.kill(Number(supervisorPid), "SIGKILL");

  // Poll through the transient zombie window until the death is detected (bounded).
  let deaths = "";
  let running = -1;
  for (let i = 0; i < 50; i++) {
    const { json } = livenessJson(root);
    deaths = json.deaths;
    running = json.running;
    if (/supervisor_dead/.test(deaths) && running === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // (a) a mechanism reports the supervisor death.
  assert.match(deaths, /supervisor_dead/, `(a) supervisor_dead reported: ${deaths}`);
  // (b) the driver is NOT misjudged as "running" (running = supervisor_alive && driver_alive).
  assert.equal(running, 0, "(b) running=0 after supervisor death — orphan driver not 'in service'");

  // The orphan driver process is still alive, yet status agrees it is NOT running.
  const after = JSON.parse(run(["status", "--root", root, "--json"]).stdout.trim());
  assert.equal(after.running, 0, "status.running=0 after supervisor death");
  assert.match(deaths, /driver_orphaned/, `orphan driver explicitly named: ${deaths}`);

  // Durable DEATH line in the liveness log.
  const log = fs.readFileSync(path.join(root, ".quay", "promotion-driver-liveness.log"), "utf8");
  assert.match(log, /DEATH deaths=.*supervisor_dead/, `durable DEATH line:\n${log}`);
});

// ── AC1 (falsifiable): launch from a worktree ⇒ supervisor cmdline = main checkout ───────────────

test("AC1 — launch from a worktree ⇒ supervisor cmdline script path = main checkout, ⛔ worktree", (t) => {
  const { main, wt } = makeGitWorktree();
  t.after(() => {
    run(["stop", "--root", main], { timeout: 15000 });
    fs.rmSync(main, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  });

  const start = run(["start", "--root", wt, "--restart-delay", "1", "--run-id", "ac1test"]);
  assert.equal(start.status, 0, `start failed: ${start.stdout}\n${start.stderr}`);
  // The carrier relocation is observable, not silent.
  assert.match(start.stderr, /relocating/, `relocation announced on stderr: ${start.stderr}`);

  // The supervisor pid file landed in the MAIN checkout's .quay, not the worktree's.
  const supPidFile = path.join(main, ".quay", "promotion-driver-supervisor.pid");
  assert.ok(fs.existsSync(supPidFile), "supervisor pid file lives in the MAIN checkout");
  assert.ok(!fs.existsSync(path.join(wt, ".quay", "promotion-driver-supervisor.pid")),
    "no supervisor pid file in the worktree");

  const spid = fs.readFileSync(supPidFile, "utf8").trim();
  const cmdline = fs.readFileSync(`/proc/${spid}/cmdline`, "utf8").replace(/\0/g, " ");
  assert.ok(cmdline.includes(main), `cmdline carries the MAIN checkout path:\n${cmdline}`);
  assert.ok(!cmdline.includes(wt), `cmdline carries NO worktree path (falsifiable):\n${cmdline}`);
  assert.ok(cmdline.includes("__supervise"), `supervisor mode in cmdline:\n${cmdline}`);
});

// ── AC138-3 (status reads ALL worker carriers; last_record_ts = max across outcome + round) ────────

test("AC138-3 — status --kind worker reads ALL carriers; last_record_ts = max (round heartbeat wins)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pd-launch-ac138-worker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  // status only checks the driver FILE exists (never executes it) — an empty worker-driver.ts suffices.
  fs.writeFileSync(path.join(scripts, "worker-driver.ts"), "", "utf8");
  fs.copyFileSync(SCRIPT, path.join(scripts, "promotion-driver-launch.sh"));

  // outcome (event-conditional) carries an OLDER ts; round (unconditional heartbeat) a NEWER ts.
  fs.writeFileSync(
    path.join(root, ".quay", "worker-outcome.jsonl"),
    '{"ts":"2026-08-23T10:00:00Z","task":"gap-a","final_state":"completed"}\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, ".quay", "worker-round.jsonl"),
    '{"ts":"2026-08-23T10:00:00Z","round":1,"action":"stop"}\n{"ts":"2026-08-23T11:30:00Z","round":2,"action":"stop"}\n',
    "utf8",
  );

  const st = JSON.parse(run(["status", "--kind", "worker", "--root", root, "--json"]).stdout.trim());
  assert.equal(st.carrier_records, 3, `both carriers summed (1 outcome + 2 round): ${JSON.stringify(st)}`);
  assert.equal(st.last_record_ts, "2026-08-23T11:30:00Z", `max across BOTH carriers — round wins: ${JSON.stringify(st)}`);
  assert.match(st.carrier_path, /worker-outcome\.jsonl$/, `primary carrier is outcome: ${st.carrier_path}`);
});

} // end governance group
