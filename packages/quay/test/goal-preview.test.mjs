// @test-group serial
//
// goal-preview.test.mjs — SPEC-goal-branch-2026-10-03 §4.10 (rulings ⑮⑫㉒㉓): the goal PREVIEW
// INSTANCE — a branch-mode goal's criterion worktree PLUS a `quay serve` whose workspace root IS
// that worktree — and the `quay goal preview <GOAL> start|stop|status` verbs that the human drives.
//
// WHAT EACH CASE MEASURES (all against a REAL git repo + a REAL child process, ⛔ no injected seam
// that fakes a reading):
//   · AC1 — `start` brings up a serve under the preview root: that root's OWN `.quay/server.json`
//     appears, its pid is ALIVE and its /proc cmdline IS a `quay serve`, the MAIN root's admission
//     lock is untouched; `status` reports that pid and port; `stop` ends the process and clears the
//     carrier.
//   · AC2 — the `.quay/` snapshot the refresh writes carries the main checkout's files but NEVER its
//     instance-identity files (`server.lock` / `server.json`) — otherwise the preview serve would
//     read the PRODUCTION instance's registration.
//   · AC3 — the AC-288 address-derivation block, run with cwd = the preview root, FINDS the preview
//     serve (its candidate set is `pgrep -f 'quay.ts serve'` × `/proc/<pid>/cwd` == git root).
//   · AC4 — after the goal is written `retired` (which discards `goal/<id>`), the goal-driver stops
//     the serve BEFORE it deletes the criterion worktree: no residual process, worktree gone.
//
// The preview worktree and the goal-driver's criterion worktree are THE SAME OBJECT
// (`goalCriterionWorktreeDir`) — that identity is the point of §4.10, so the fixture builds it the
// way the driver does (`syncGoalCriterionWorktrees`) rather than by a parallel construction.
//
// The serve child is a REAL process at `<previewRoot>/packages/quay/bin/quay.ts` that publishes the
// REAL carrier shape (`server-state.ts`) and dies on SIGTERM — the same "serve-shaped real process"
// seam the 17 `ac*-criterion-address-derivation.test.mjs` files use. What is under test here is the
// ORCHESTRATION (which code, which cwd, which port, which carrier, which kill), not the web app.
//
// Run: node --test packages/quay/test/goal-preview.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import {
  snapshotQuayDirInto,
  readPreviewStatus,
  stopPreviewServe,
  startPreviewServe,
  previewWorktreeDir,
  PREVIEW_INSTANCE_FILES,
} from "../src/goal-preview.ts";
import { isQuayServe, readProcCmdline } from "../src/kernel/proc-identity.ts";
import { syncGoalCriterionWorktrees } from "../../../plugin/scripts/goal-driver.ts";
import { installLiveWebAddressHelper, derive } from "./helpers/live-web-address-fixture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root of THIS checkout (a task worktree during dispatch). */
const REPO = path.resolve(HERE, "..", "..", "..");

const GOAL = "GOAL-901";
const BRANCH = "goal/GOAL-901";

/** The serve-shaped child: its argv carries `quay.ts … serve`, its cwd is the preview root, and it
 *  publishes the REAL `.quay/server.json` carrier (schemaVersion 1 + a live `web` entry) so every
 *  reader under test — `readServerState`, `live-web-address.ts` — sees a genuine instance. */
const SERVE_STUB = `import fs from "node:fs";
import path from "node:path";
const argv = process.argv.slice(2);
if (!argv.includes("serve")) process.exit(2);
function flag(n) { const k = argv.indexOf(n); return k >= 0 ? argv[k + 1] : undefined; }
const port = Number(flag("--port"));
const host = flag("--host") ?? "127.0.0.1";
const root = process.cwd();
const carrier = path.join(root, ".quay", "server.json");
const lock = path.join(root, ".quay", "server.lock");
fs.mkdirSync(path.dirname(carrier), { recursive: true });
fs.writeFileSync(lock, String(process.pid) + "\\n");
function publish() {
  fs.writeFileSync(
    carrier,
    JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      services: [
        { name: "web", pid: process.pid, host, port, up: true },
        { name: "control", pid: process.pid, host: "127.0.0.1", port: 1, up: true },
      ],
    }, null, 2),
  );
}
publish();
function bye() {
  try { fs.rmSync(carrier, { force: true }); fs.rmSync(lock, { force: true }); } catch {}
  process.exit(0);
}
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
setInterval(() => {}, 1000);
`;

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

/** A real git repo: `main` carries the serve-shaped entry, `goal/GOAL-901` adds a branch-only file,
 *  and the main checkout's `.quay/` carries BOTH instance-identity files and ordinary files. */
function mkPreviewFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-preview-"));
  const ns = fs.mkdtempSync(path.join(os.tmpdir(), "goal-preview-ns-"));
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "quay", "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".quay/\n", "utf8");
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), `loop:\n  worktree_root: ${ns}\n`, "utf8");
  // The PRODUCTION instance's identity — must never travel into a preview.
  fs.writeFileSync(path.join(root, ".quay", "server.lock"), "4242\n", "utf8");
  fs.writeFileSync(
    path.join(root, ".quay", "server.json"),
    JSON.stringify({ schemaVersion: 1, pid: 4242, startedAt: "2026-01-01T00:00:00.000Z", services: [{ name: "web", pid: 4242, host: "127.0.0.1", port: 4173, up: true }] }, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, ".quay", "server-services.json"),
    JSON.stringify({ pid: 4242, services: { web: { up: true } } }, null, 2),
    "utf8",
  );
  // Non-identity runtime state — a snapshot must carry it.
  fs.writeFileSync(path.join(root, ".quay", "gate-events.jsonl"), '{"gate":"x"}\n', "utf8");
  fs.writeFileSync(path.join(root, ".quay", "notes.txt"), "preview me\n", "utf8");
  fs.mkdirSync(path.join(root, ".quay", "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "sub", "nested.txt"), "nested\n", "utf8");
  // A branch-mode GOAL record in the store's own frontmatter shape (the retire below goes through
  // the goal-store CLI, which parses it).
  fs.writeFileSync(
    path.join(root, "goals", `${GOAL}-fixture.md`),
    ["---", `id: ${GOAL}`, `title: ${GOAL} fixture`, "status: active", "kind: goal", "branch: true", "origin: test fixture", "---", "", "## body", "x", ""].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(root, "packages", "quay", "bin", "quay.ts"), SERVE_STUB, "utf8");

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@example.invalid"]);
  git(root, ["config", "user.name", "t"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  git(root, ["branch", "-M", "main"]);
  git(root, ["branch", "develop"]);
  git(root, ["checkout", "-q", "-b", BRANCH]);
  fs.writeFileSync(path.join(root, "only-on-goal-branch.txt"), "goal branch only\n", "utf8");
  git(root, ["add", "only-on-goal-branch.txt"]);
  git(root, ["commit", "-q", "-m", "goal-branch-only file"]);
  const tip = git(root, ["rev-parse", "HEAD"]);
  git(root, ["checkout", "-q", "main"]);
  return { root, ns, tip, wtPath: previewWorktreeDir(root, GOAL) };
}

/** Remove a fixture and any process still holding its preview root. Fail-safe: the test has already
 *  asserted what it needed. */
function teardown(fx) {
  if (fx?.wtPath) {
    try {
      stopPreviewServe(fx.wtPath, { graceMs: 2000 });
    } catch {
      /* best-effort */
    }
  }
  for (const d of [fx?.root, fx?.ns]) {
    if (d) fs.rmSync(d, { recursive: true, force: true });
  }
}

/** The `## Touches`-free criterion block of AC-288's goal file — extracted VERBATIM, so AC3 runs the
 *  shipped derivation rather than a re-statement of it (硬规则 4). */
const MARK_START = ">>> addr-derivation";
const MARK_END = "<<< addr-derivation";
function ac288DerivationBlock() {
  const dir = path.join(REPO, "goals");
  const name = fs.readdirSync(dir).find((n) => n.startsWith("AC-288-") && n.endsWith(".md"));
  assert.ok(name, `no goals/AC-288-*.md under ${dir}`);
  const raw = fs.readFileSync(path.join(dir, name), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  assert.ok(fm, "AC-288 goal file has no YAML frontmatter");
  const criterion = YAML.parse(fm[1]).criterion;
  assert.equal(typeof criterion, "string", "AC-288 record has no criterion string");
  const lines = criterion.split("\n");
  const start = lines.findIndex((l) => l.includes(MARK_START));
  const end = lines.findIndex((l) => l.includes(MARK_END));
  assert.ok(start >= 0 && end > start, "AC-288 criterion is missing its derivation markers");
  const block = lines.slice(start + 1, end).join("\n");
  for (const needle of ["pgrep -f 'quay.ts serve'", "live-web-address.ts"]) {
    assert.ok(block.includes(needle), `extracted block is not the derivation (missing ${needle})`);
  }
  return block;
}

function cmdlineOf(pid) {
  return readProcCmdline(pid);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const PORT_A = 45931;
const PORT_B = 45932;
const PORT_C = 45933;

test("AC1: start brings up a serve under the preview root; main lock untouched; status reports pid+port; stop ends it", async () => {
  const fx = mkPreviewFixture();
  try {
    const sync = syncGoalCriterionWorktrees(fx.root, [{ id: GOAL, branch: true }]);
    assert.equal(sync[0]?.state, "created", `criterion worktree must be created: ${JSON.stringify(sync)}`);
    assert.ok(fs.existsSync(fx.wtPath), "preview worktree must exist");

    const mainLockBefore = fs.readFileSync(path.join(fx.root, ".quay", "server.lock"), "utf8");
    const mainCarrierBefore = fs.readFileSync(path.join(fx.root, ".quay", "server.json"), "utf8");

    const start = await startPreviewServe({ previewRoot: fx.wtPath, port: PORT_A, host: "127.0.0.1" });
    assert.equal(start.state, "started", `preview serve must start: ${start.detail}`);
    assert.equal(start.port, PORT_A, "status must report the explicit port");
    assert.ok(Number.isInteger(start.pid) && start.pid > 0, "start must report a live pid");

    // The carrier that appeared is the PREVIEW root's own — and its pid is a real `quay serve`.
    const carrierPath = path.join(fx.wtPath, ".quay", "server.json");
    assert.ok(fs.existsSync(carrierPath), "preview root must publish its OWN .quay/server.json");
    const parsed = JSON.parse(fs.readFileSync(carrierPath, "utf8"));
    assert.equal(parsed.pid, start.pid);
    assert.ok(alive(parsed.pid), "the registered pid must be ALIVE");
    const cmd = cmdlineOf(parsed.pid);
    assert.ok(isQuayServe(cmd), `registered pid must be a quay serve (argv=${JSON.stringify(cmd)})`);
    // ⛔ It must NOT be the production carrier copied in — different file, different pid.
    assert.notEqual(parsed.pid, 4242, "the preview must not carry the production instance's pid");

    // The MAIN root's admission lock + carrier are untouched (the two instances are independent).
    assert.equal(fs.readFileSync(path.join(fx.root, ".quay", "server.lock"), "utf8"), mainLockBefore);
    assert.equal(fs.readFileSync(path.join(fx.root, ".quay", "server.json"), "utf8"), mainCarrierBefore);

    const status = readPreviewStatus(fx.wtPath);
    assert.equal(status.state, "running", `status must read running: ${status.detail}`);
    assert.equal(status.pid, start.pid);
    assert.equal(status.port, PORT_A);

    const stop = stopPreviewServe(fx.wtPath);
    assert.equal(stop.state, "stopped", `stop must stop the host: ${stop.detail}`);
    // Wait for the reap: `kill(pid, 0)` reports a zombie as alive, so assert on the carrier + a
    // bounded liveness re-read (the group signal is what ends BOTH the watch supervisor and the serve).
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      let aliveCheck = true;
      try {
        process.kill(parsed.pid, 0);
      } catch {
        aliveCheck = false;
      }
      if (!aliveCheck) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(fs.existsSync(carrierPath), false, "stop must clear the carrier");
    assert.equal(readPreviewStatus(fx.wtPath).state, "not-running");
  } finally {
    teardown(fx);
  }
});

test("AC2: the snapshot carries the main checkout's .quay/ but never its instance-identity files", () => {
  const fx = mkPreviewFixture();
  try {
    const sync = syncGoalCriterionWorktrees(fx.root, [{ id: GOAL, branch: true }]);
    assert.equal(sync[0]?.state, "created", `criterion worktree must be created: ${JSON.stringify(sync)}`);
    const snap = sync[0].quaySnapshot;
    assert.ok(snap, "a created criterion worktree must carry its quaySnapshot reading");
    assert.equal(snap.state, "copied", `the snapshot must run: ${JSON.stringify(snap)}`);

    const mainQuay = path.join(fx.root, ".quay");
    const wtQuay = path.join(fx.wtPath, ".quay");
    // ⛔ No instance-identity file may exist in the preview — a copied `server.json` would make the
    // preview serve read the PRODUCTION instance's registration.
    for (const name of PREVIEW_INSTANCE_FILES) {
      assert.equal(fs.existsSync(path.join(wtQuay, name)), false, `snapshot must NOT copy ${name}`);
      assert.ok(snap.excluded.includes(name), `${name} must be reported as EXCLUDED, not silently absent`);
    }
    // Everything else matches the main checkout, byte for byte.
    const others = [];
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(mainQuay, rel), { withFileTypes: true })) {
        const childRel = rel ? path.join(rel, e.name) : e.name;
        if (e.isDirectory()) { walk(childRel); continue; }
        if (!rel && PREVIEW_INSTANCE_FILES.includes(e.name)) continue;
        others.push(childRel);
      }
    };
    walk("");
    assert.ok(others.length >= 3, `fixture must have ordinary .quay files to compare (${JSON.stringify(others)})`);
    for (const rel of others) {
      const a = fs.readFileSync(path.join(mainQuay, rel), "utf8");
      const b = fs.readFileSync(path.join(wtQuay, rel), "utf8");
      assert.equal(b, a, `.quay/${rel} must match the main checkout`);
    }
    // Direct unit check of the same function (independent of the driver path).
    const direct = snapshotQuayDirInto(fx.root, fx.wtPath);
    assert.equal(direct.state, "copied");
    for (const name of PREVIEW_INSTANCE_FILES) assert.equal(fs.existsSync(path.join(wtQuay, name)), false);
  } finally {
    teardown(fx);
  }
});

test("AC3: the AC-288 address-derivation block, run in the preview root, finds the preview serve", async () => {
  const fx = mkPreviewFixture();
  try {
    const sync = syncGoalCriterionWorktrees(fx.root, [{ id: GOAL, branch: true }]);
    assert.equal(sync[0]?.state, "created", `criterion worktree must be created: ${JSON.stringify(sync)}`);
    // The criterion's derivation helper must be resolvable where the block runs (cwd = preview root),
    // exactly as it is in a real root.
    installLiveWebAddressHelper(fx.wtPath);
    const start = await startPreviewServe({ previewRoot: fx.wtPath, port: PORT_B, host: "127.0.0.1" });
    assert.equal(start.state, "started", `preview serve must start: ${start.detail}`);

    const r = derive(fx.wtPath, ac288DerivationBlock());
    assert.equal(r.code, 0, `derivation must succeed in the preview root: ${r.stderr}`);
    assert.match(r.stdout, new RegExp(`DERIVED_ADDR=127\\.0\\.0\\.1:${PORT_B}\\b`), `must derive the preview serve's address; stdout=${r.stdout} stderr=${r.stderr}`);
    // The per-candidate report (stdout, `REPORT:` line) must name the preview serve WITH an address —
    // "found a serve" is not the same reading as "found THIS serve at THIS address".
    const report = (r.stdout.match(/^REPORT:(.*)$/m) ?? [])[1] ?? "";
    assert.match(
      report,
      new RegExp(`pid=${start.pid} addr=127\\.0\\.0\\.1:${PORT_B}\\b`),
      `the preview serve (pid ${start.pid}) must appear as a candidate WITH an address; REPORT=${report}`,
    );
  } finally {
    teardown(fx);
  }
});

test("AC4: a retired goal's serve is stopped BEFORE its criterion worktree is deleted", async () => {
  const fx = mkPreviewFixture();
  let servePid = null;
  try {
    const sync = syncGoalCriterionWorktrees(fx.root, [{ id: GOAL, branch: true }]);
    assert.equal(sync[0]?.state, "created", `criterion worktree must be created: ${JSON.stringify(sync)}`);
    const start = await startPreviewServe({ previewRoot: fx.wtPath, port: PORT_C, host: "127.0.0.1" });
    assert.equal(start.state, "started", `preview serve must start: ${start.detail}`);
    servePid = start.pid;
    assert.ok(alive(servePid), "the preview serve must be alive before retirement");

    // Retire the goal through the goal-store CLI — the SAME path the product uses — which discards
    // `goal/<id>` (§4.2). ⛔ Not `git branch -D`: the trigger under test is the retirement.
    const write = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", path.join(REPO, "packages", "quay", "bin", "quay.ts"),
        "goal", "write", GOAL, "--store", "--root", fx.root, "--status", "retired", "--actor", "goal-preview-test", "--reason", "preview teardown test"],
      { encoding: "utf8", cwd: fx.root },
    );
    assert.equal(write.status, 0, `goal retire must succeed: ${write.stderr || write.stdout}`);
    const refs = spawnSync("git", ["-C", fx.root, "rev-parse", "--verify", "--quiet", BRANCH], { encoding: "utf8" });
    assert.notEqual(refs.status, 0, `retirement must discard ${BRANCH}`);

    // The next driver round must stop the serve as part of removing the worktree.
    const after = syncGoalCriterionWorktrees(fx.root, [{ id: GOAL, branch: true }]);
    assert.equal(after[0]?.state, "removed", `the orphaned criterion worktree must be removed: ${JSON.stringify(after)}`);
    assert.ok(after[0].previewStop, "the removal must carry its previewStop reading");
    assert.equal(after[0].previewStop.state, "stopped", `the preview serve must be stopped before deletion: ${JSON.stringify(after[0].previewStop)}`);
    assert.equal(fs.existsSync(fx.wtPath), false, "the criterion worktree must be gone");

    // No residual process.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && alive(servePid)) await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(servePid), false, `the preview serve (pid ${servePid}) must NOT survive the removal`);
  } finally {
    teardown(fx);
  }
});
