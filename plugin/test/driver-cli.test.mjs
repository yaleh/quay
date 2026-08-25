// @test-group governance
// driver-cli.test.mjs — AC1-4 (tasks/gap-ac139-unified-driver-subcommand):
// the two drivers' launch surface converges onto ONE `quay driver <verb> --kind <promotion|worker>`
// subcommand + a single generalized supervisor. AC151 ports that supervisor from bash
// (promotion-driver-launch.sh) into TS (plugin/scripts/driver-runtime.ts — Layer 0 kernel); this
// file exercises the CLI → kernel path end-to-end.
//
//   AC1 (统一入口): `quay driver <start|stop|drain|status|restart> --kind <promotion|worker>` exists,
//     both kinds start/stop/drain through it (AC150: promotion now supports drain = halt, writing its
//     own promotion-control.json). Falsifiable: a kind only starts via the old path, or worker
//     `stop` kills in-flight workers ⇒ false.
//   AC2 (单一真相源): exactly ONE respawn/supervisor loop in the repo (now in driver-runtime.ts, the
//     TS kernel — ⛔ no bash .sh carries a supervisor loop anymore). Per-kind differences are a
//     registry data table. Falsifiable: a second launch script with its own supervisor loop ⇒ false.
//   AC3 (status 带 last_record_ts): `status` reports {kind, …, carrier_records, last_record_ts}.
//     Falsifiable: status reports only a record count ⇒ false.
//   AC4 (worktree 拒绝): carrier path resolved from workspace root; start from a worktree is
//     REJECTED. Falsifiable: start from a worktree starts a supervisor on that worktree ⇒ false.
//
// Run: scripts/test.sh --for-task gap-ac139-unified-driver-subcommand
//      node --test plugin/test/driver-cli.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run } from "../../packages/quay/bin/quay.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// The TS kernel (driver-runtime.ts) the CLI spawns + its transitive plugin/scripts deps (a fixed,
// closed set — the CLI resolves the kernel via `path.join(root, DRIVER_RUNTIME_REL)`, so the hermetic
// temp root must carry the kernel and everything it imports).
const KERNEL_DEPS = [
  "driver-runtime.ts",
  "driver-shared.ts",
  "driver-result.ts",
  "driver-filters.ts",
  "gate-script-base.ts",
  "profile-policy.ts",
  "routine-scheduler.ts",
  "task-schema.ts",
  "touches-orthogonality-check.ts",
  "touches-parser.ts",
  "concurrent-batch-scheduler.ts",
  "derive-touches-heuristic.ts",
  "fast-mode-telemetry.ts",
  "wiring-coverage-check.ts",
  "workflow-event-schema.mjs",
];

// A fake driver for both kinds: idles forever (the supervisor writes the driver's own pid via the
// spawn `$!` equivalent; the real worker driver writes in-flight worker pids to --pid-file, but the
// fake need not).
const FAKE_DRIVER = "setInterval(() => {}, 1000);\n";

/** Copy the kernel + its transitive deps into the temp root's plugin/scripts, then overwrite the two
 *  driver entry files with fakes so `start` spawns an idling child instead of a real driver loop. */
function copyKernel(scripts) {
  for (const dep of KERNEL_DEPS) {
    fs.copyFileSync(path.join(SCRIPTS_DIR, dep), path.join(scripts, dep));
  }
  // L3（gap-driver-binding-semantic-kind-to-profile）后 driver-runtime.ts import profile-policy.ts
  // （→ `yaml`），kernel 首次带 node_modules 依赖。给 temp root 铺 node_modules 符号链接（同
  // dispatch-worktree-setup.sh 的手法），让裸说明符 `import "yaml"` 从 temp root 向上可解析。
  const root = path.resolve(scripts, "..", "..");
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
  fs.writeFileSync(path.join(scripts, "promotion-driver.ts"), FAKE_DRIVER, "utf8");
  fs.writeFileSync(path.join(scripts, "worker-driver.ts"), FAKE_DRIVER, "utf8");
}

async function cli(args) {
  const r = await run(args, { capture: true });
  // run() leaks process.exitCode as a global side effect (a rejected/erroring command leaves it
  // non-zero); reset it so node:test does not report the whole file as failed.
  process.exitCode = 0;
  return r;
}

// A hermetic bare root (not a git repo): .quay/config.yml + the kernel (copyKernel) + fake drivers.
// The CLI resolves the kernel from THIS root via --root.
function makeRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `driver-cli-${tag}-`));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers: {}\n", "utf8");
  copyKernel(scripts);
  return root;
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
}

// A real git main checkout + a linked worktree (both carry .quay/config.yml + the kernel), so the
// AC4 worktree path actually traverses `git worktree list`.
function makeGitWorktree() {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), "driver-main-"));
  const wt = path.join(os.tmpdir(), `driver-wt-${path.basename(main)}`);
  const scripts = path.join(main, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(main, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(main, ".quay", "config.yml"), "providers: {}\n", "utf8");
  copyKernel(scripts);
  git(main, ["init", "-q"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "init"]);
  git(main, ["worktree", "add", "-q", wt, "HEAD"]);
  return { main, wt };
}

function statusJson(root, kind) {
  return cli(["driver", "status", "--kind", kind, "--root", root, "--json"]);
}

// ── AC1 (falsifiable): both kinds start/stop through `quay driver`; stop/drain are separate verbs ──

test("AC1 — both kinds start + status + stop through `quay driver`", async (t) => {
  const root = makeRoot("ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const kind of ["promotion", "worker"]) {
    const start = await cli(["driver", "start", "--kind", kind, "--root", root]);
    assert.equal(start.code, 0, `start ${kind} failed: ${start.stdout}\n${start.stderr}`);

    const st = await statusJson(root, kind);
    assert.equal(st.code, 0, `status ${kind} failed: ${st.stdout}\n${st.stderr}`);
    const json = JSON.parse(st.stdout.trim());
    assert.equal(json.kind, kind, `status kind=${kind}: ${st.stdout}`);
    assert.equal(json.alive, 1, `${kind} should be alive after start: ${st.stdout}`);
    assert.equal(json.running, 1, `${kind} running=1 after start`);

    const stop = await cli(["driver", "stop", "--kind", kind, "--root", root]);
    assert.equal(stop.code, 0, `stop ${kind} failed: ${stop.stdout}\n${stop.stderr}`);
  }
});

test("AC1 — stop/drain are separate verbs; both kinds support drain = halt (AC150-2)", async (t) => {
  const root = makeRoot("ac1-drain");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // promotion DOES support drain now (AC150-2): writes promotion-control.json halted=true.
  const p = await cli(["driver", "drain", "--kind", "promotion", "--root", root]);
  assert.equal(p.code, 0, `drain for promotion must succeed: ${p.stdout}\n${p.stderr}`);
  const pctl = JSON.parse(fs.readFileSync(path.join(root, ".quay", "promotion-control.json"), "utf8"));
  assert.equal(pctl.halted, true, "promotion drain writes halted=true");
  assert.equal(pctl.schemaVersion, 1, "promotion drain preserves schemaVersion");

  // worker DOES support drain = halt (write worker-control.json halted=true).
  const d = await cli(["driver", "drain", "--kind", "worker", "--root", root]);
  assert.equal(d.code, 0, `drain for worker must succeed: ${d.stdout}\n${d.stderr}`);
  const ctl = JSON.parse(fs.readFileSync(path.join(root, ".quay", "worker-control.json"), "utf8"));
  assert.equal(ctl.halted, true, "drain writes halted=true");
  assert.equal(ctl.schemaVersion, 1, "drain preserves schemaVersion");

  // ⛔ 两 kind 独立：halting one does NOT halt the other (distinct control files, AC150-2)。
  const pctl2 = JSON.parse(fs.readFileSync(path.join(root, ".quay", "promotion-control.json"), "utf8"));
  assert.equal(pctl2.halted, true, "worker drain leaves promotion-control.json untouched (independent halt)");
});

test("AC1 — worker `stop` does NOT kill in-flight workers (⛔ falsifiable: kill in-flight ⇒ false)", async (t) => {
  const root = makeRoot("ac1-stop");
  const inflight = path.join(root, ".quay", "worker-driver-inflight.pid");
  let inflightPid = "";
  t.after(() => {
    if (inflightPid) { try { process.kill(Number(inflightPid), "SIGKILL"); } catch { /* gone */ } }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const start = await cli(["driver", "start", "--kind", "worker", "--root", root]);
  assert.equal(start.code, 0, `worker start failed: ${start.stdout}\n${start.stderr}`);

  // A real live "in-flight worker": a detached long sleep whose pid we record in the in-flight pid
  // file (the file the real worker driver appends worker pids to). `spawn` + `detached` + `unref`
  // (⛔ not spawnSync — that would BLOCK until the sleeper exits and then report a dead pid).
  const sleeper = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  inflightPid = String(sleeper.pid);
  sleeper.unref();
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(inflight, `${inflightPid}\n`, "utf8");

  const stop = await cli(["driver", "stop", "--kind", "worker", "--root", root]);
  assert.equal(stop.code, 0, `worker stop failed: ${stop.stdout}\n${stop.stderr}`);

  // The in-flight worker is STILL alive (worker stop kills the supervisor+driver, ⛔ not in-flight).
  try { process.kill(Number(inflightPid), 0); } catch { assert.fail(`worker stop killed the in-flight worker ${inflightPid}`); }
});

// ── AC2 (falsifiable): a single supervisor loop, in the TS kernel — no duplicate launch script ────

test("AC2 — exactly ONE respawn/supervisor loop in the repo (TS kernel; ⛔ no .sh supervisor anymore)", () => {
  // The would-be duplicate from AC138's Touches must not exist.
  assert.ok(
    !fs.existsSync(path.join(SCRIPTS_DIR, "worker-driver-launch.sh")),
    "no worker-driver-launch.sh (the duplicate supervisor AC139 prevents)"
  );
  // AC151: the supervisor loop (__supervise internal mode + runSupervisor) now lives in the TS kernel.
  // A bash .sh with its own supervisor loop ⇒ false.
  const superviseSh = fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".sh") &&
    fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8").includes("__supervise"));
  assert.deepEqual(
    superviseSh,
    [],
    `⛔ no .sh carries the supervisor loop anymore (ported to driver-runtime.ts), got: ${superviseSh.join(",")}`
  );
  // The kernel carries the single supervisor loop + registry data table.
  const kernel = fs.readFileSync(path.join(SCRIPTS_DIR, "driver-runtime.ts"), "utf8");
  assert.ok(kernel.includes("runSupervisor"), "driver-runtime.ts carries the supervisor respawn loop");
  assert.ok(kernel.includes("DRIVER_KINDS"), "driver-runtime.ts carries the registry data table");
});

// ── AC3 (falsifiable): status reports last_record_ts, not just a count ─────────────────────────────

test("AC3 — status reports last_record_ts (the carrier's last-record timestamp), not just a count", async (t) => {
  const root = makeRoot("ac3");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Negative control: no carrier yet ⇒ last_record_ts is null (⛔ not fabricated).
  const before = JSON.parse((await statusJson(root, "promotion")).stdout.trim());
  assert.equal(before.kind, "promotion");
  assert.equal(before.carrier_records, 0, `no carrier yet ⇒ 0 records: ${JSON.stringify(before)}`);
  assert.equal(before.last_record_ts, null, `no carrier yet ⇒ null ts: ${JSON.stringify(before)}`);

  // Write a carrier with a known last-record timestamp (the promotion outcome ledger shape).
  const outcome = path.join(root, ".quay", "promotion-outcome.jsonl");
  fs.writeFileSync(outcome, '{"ts":"2026-08-23T12:00:00Z","task":"X","action":"promote"}\n', "utf8");

  const after = JSON.parse((await statusJson(root, "promotion")).stdout.trim());
  assert.equal(after.carrier_records, 1, `one carrier record: ${JSON.stringify(after)}`);
  assert.equal(after.last_record_ts, "2026-08-23T12:00:00Z", `last_record_ts = the carrier's last ts: ${JSON.stringify(after)}`);
  assert.match(after.carrier_path, /promotion-outcome\.jsonl$/, `carrier_path names the primary carrier: ${after.carrier_path}`);
  // The death-alarm field `alive` is also present (status is the AC138-1 / liveness consumer).
  assert.equal(typeof after.alive, "number", "status carries alive");
});

// ── AC4 (falsifiable): start from a worktree is rejected, no supervisor on the worktree ────────────

test("AC4 — start from a worktree is REJECTED (no supervisor on the worktree)", async (t) => {
  const { main, wt } = makeGitWorktree();
  t.after(() => {
    fs.rmSync(main, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  });

  const r = await cli(["driver", "start", "--kind", "promotion", "--root", wt]);
  assert.equal(r.code, 1, `worktree start must exit non-zero: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /worktree/, `rejection names a worktree: ${r.stderr}`);
  assert.ok(
    !fs.existsSync(path.join(wt, ".quay", "promotion-driver-supervisor.pid")),
    "no supervisor pid file in the worktree (falsifiable: supervisor on worktree ⇒ false)"
  );
  // Rejected, not relocated: nothing was started anywhere.
  assert.ok(
    !fs.existsSync(path.join(main, ".quay", "promotion-driver-supervisor.pid")),
    "no supervisor started in the main checkout either (reject ≠ relocate)"
  );
});

test("AC4 — cwd inside a worktree is also rejected (spawned subprocess)", (t) => {
  const { main, wt } = makeGitWorktree();
  t.after(() => {
    fs.rmSync(main, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  });

  const r = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "packages", "quay", "bin", "quay.js"), "driver", "start", "--kind", "promotion"],
    { cwd: wt, encoding: "utf8" },
  );
  assert.notEqual(r.status, 0, `cwd-in-worktree start must exit non-zero: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /worktree/, `cwd rejection names a worktree: ${r.stderr}`);
});
