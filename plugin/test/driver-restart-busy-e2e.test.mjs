// @test-group lowconc

// driver-restart-busy-e2e.test.mjs — the **ACCEPTANCE** leg for
// "a Quay driver can be restarted at any time, not only in an idle window"
// (task: gap-driver-restart-anytime-busy-e2e-on-dist-kernel; human requirement 2026-10-14).
//
// WHY THIS FILE EXISTS (and why it is NOT a duplicate of the three landed fixes' own tests)
// ----------------------------------------------------------------------------------------------
// Three fixes make the requirement true, each already carrying its OWN fixture-level ACs:
//   • gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window  — a kind stop is
//     honoured INSIDE a round (between routines, plus an AbortSignal at the routine's next model-call
//     boundary) instead of only at the round boundary.
//   • gap-reconcile-books-exited-orphan-with-commits-as-failed-instead-of-adopting-its-fan-in — a worker
//     that exits inside a restart/takeover gap gets its mechanical fan-in resumed, not booked `failed`.
//   • gap-adopted-live-orphan-exits-without-fan-in-so-adopted-work-never-lands — an ADOPTED live orphan
//     that later exits runs the same post-exit pipeline.
//
// Every one of them was measured on the **.ts dev tree**. The original per-kind-stop defect
// (gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles) was INVISIBLE there: on the dev tree
// the anchor and each kind share ONE module instance, while the SHIPPED artifact is a set of independent
// esbuild bundles with a private copy of driver-runtime each. The dev tree therefore cannot be the
// acceptance surface for "restart works". This file runs the scenarios on a **shipped-layout kernel**.
//
// WHAT "SHIPPED-LAYOUT KERNEL" MEANS HERE, AND THE PREMISE IT ASSERTS
// -------------------------------------------------------------------
// A scratch host (its own `git init -b develop`, NOT a `git worktree` of the quay repo — a worktree's
// `.git` file walks back into the source checkout and silently voids the isolation, see
// `dist-artifact-that-is-a-repo-worktree-leaks-plugin-link-to-source`) whose `.quay/plugin` resolves to a
// **`.git`-free plain** kernel tree carrying `scripts/dist/*.js` bundles. The bundles are produced by the
// SAME esbuild + banner the repo's own `build-plugin-dist.mjs` / `publish-dist-branch.sh` use, one bundle
// per entry — i.e. the structural property that matters (separate module instances, no raw `.ts`) is
// reproduced mechanically rather than asserted in prose:
//   • `readlink -f <host>/.quay/plugin` names the kernel tree, never `…/work/quay/plugin`;
//   • the anchor resolves its kernel to `<kernel>/scripts/dist/driver-anchor.js` (the bundle);
//   • `requestKindStop` from the test process returns **false** — the in-process KIND_STOP registry is NOT
//     shared with the bundle, which is the whole reason per-kind stop must (and does) go through the
//     on-disk channel `.quay/anchor-kind-stops.json`.
// (The real `publish-dist-branch.sh` artifact is the same layout; this file builds the layout directly
// because a full publish runs `sync-vendor.sh` + the whole-tree bundler and is far too heavy for the suite
// lane. The layout property that hid the defect is what is reproduced — and it is asserted, not assumed.)
//
// FIXTURES (no live model calls, no budget ceiling touched)
// ---------------------------------------------------------
// `quality` runs the REAL `runResidentQualityGateLoop` with ONE fixture routine whose every "model call"
// goes through the REAL `reservingModel` choke point against a REAL 24h ledger (`openModelBudget`), so the
// "no reservation after the stop" reading is a real reading. The other kinds are trivial heartbeat loops.
// The worker-kind arms drive the REAL shipped `worker-driver.js` bundle resident with fixture commands.
//
// Run: node --test plugin/test/driver-restart-busy-e2e.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DRIVER_KINDS,
  KNOWN_KINDS,
  requestKindStop,
  updateDesired,
  readKindStops,
} from "../scripts/driver-runtime.ts";
import {
  WORKER_OUTCOME_REL,
  WORKER_PROCESS_NAME,
  dispatchStoreFile,
  readDispatchStore,
  upsertDispatchRecord,
  taskBranchHasCommits,
  finalizeOrphanDispatch,
  probePidLiveness,
} from "../scripts/worker-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS = path.join(REPO_ROOT, "plugin", "scripts");

// A bundle built by esbuild needs the CJS interop shim for `yaml` — byte-identical to the banner
// `packages/quay/scripts/build-plugin-dist.mjs` uses (without it the bundle cannot start).
const BUNDLE_BANNER = {
  js: 'import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);',
};

const CARRIERS = Object.fromEntries(KNOWN_KINDS.map((k) => [k, DRIVER_KINDS[k].carriers[0]]));
const QUALITY_ROUND_LOG = ".quay/quality-round.jsonl";
const BUDGET_LEDGER_REL = ".quay/discovery-method-model-budget.jsonl";
const BUDGET_LOCK_REL = ".quay/discovery-method-model-budget.lock";
const ANCHOR_KIND_STOPS_REL = ".quay/anchor-kind-stops.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** QUAY_E2E_EVIDENCE=1 prints the raw readings each case asserted on (the DoD asks for pasted evidence;
 *  the assertions above are the gate, this is the transcript). */
const EVIDENCE = process.env.QUAY_E2E_EVIDENCE === "1";
function evidence(label, obj) {
  if (EVIDENCE) console.log(`\n[evidence ${label}] ${JSON.stringify(obj, null, 1)}`);
}

async function esbuildBundle(entry, outfile) {
  const { build } = await import("esbuild");
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    outfile,
    banner: BUNDLE_BANNER,
    logLevel: "silent",
  });
}

// ── the fixture kind drivers ───────────────────────────────────────────────────────────────────────
//
// A trivial heartbeat loop for the kinds this file does not measure: it writes its `--pid-file` (the
// `pidSelf` contract: the DRIVER writes it after entering its loop — never pre-written by the anchor),
// appends a round heartbeat, and exits when `.quay/anchor-kind-stops.json` carries its kind — i.e. it
// honours the REAL on-disk stop channel a shipped bundle must use.
function plainFixtureSource(kind) {
  return `import fs from "node:fs";
import path from "node:path";
export async function main(argv) {
  const args = argv.slice(2);
  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const root = get("--root");
  const pidFile = get("--pid-file");
  if (pidFile) fs.writeFileSync(pidFile, String(process.pid) + "\\n", "utf8");
  const stops = path.join(root, ".quay", "anchor-kind-stops.json");
  const file = path.join(root, ".quay", ${JSON.stringify(CARRIERS[kind])});
  // QUAY_E2E_IGNORE_STOP==<kind> ⇒ this loop ignores every stop (the AC5 failure-path fixture).
  const ignore = process.env.QUAY_E2E_IGNORE_STOP === ${JSON.stringify(kind)};
  let round = 0;
  while (true) {
    if (!ignore) {
      try { const j = JSON.parse(fs.readFileSync(stops, "utf8")); if (j && j[${JSON.stringify(kind)}]) break; } catch {}
    }
    round += 1;
    try { fs.appendFileSync(file, JSON.stringify({ round, ts: new Date().toISOString(), pid: process.pid }) + "\\n"); } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return 0;
}
`;
}

// The `quality` fixture: the REAL resident loop, one fixture routine, a REAL budget ledger. Each "model
// call" block reserves BEFORE the call (the production order) and then sleeps; the routine observes the
// stop `AbortSignal` at its next boundary and hands back its own `not-evaluated` fact.
const QUALITY_FIXTURE_SOURCE = `import fs from "node:fs";
import path from "node:path";
import { runResidentQualityGateLoop } from ${JSON.stringify(path.join(SCRIPTS, "quality-gate-driver.ts"))};
import {
  openModelBudget, reservingModel, BUDGET_LEDGER_REL, BUDGET_LOCK_REL,
} from ${JSON.stringify(path.join(SCRIPTS, "discovery-method-routine.ts"))};

export async function main(argv) {
  const args = argv.slice(2);
  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const root = get("--root");
  const pidFile = get("--pid-file");
  const runId = get("--run-id") ?? "fixture";
  const budget = openModelBudget({
    root, cap: 50,
    ledgerPath: path.join(root, BUDGET_LEDGER_REL),
    lockPath: path.join(root, BUDGET_LOCK_REL),
    carrierPath: path.join(root, ".quay", "fixture-budget-carrier.jsonl"),
  });
  const blocks = Number(process.env.QUAY_E2E_BLOCKS ?? "25");
  const callMs = Number(process.env.QUAY_E2E_CALL_MS ?? "5000");
  // Every reservation this routine takes carries its invocation number, so a reader can ATTRIBUTE a
  // ledger row to the interrupted round rather than to a later round of the same (restarted) loop.
  let invocation = 0;
  const routine = {
    name: "fixture-model-round",
    schedule: { kind: "interval", minutes: 0 },
    run: async (ctx) => {
      invocation += 1;
      const call = reservingModel(
        async () => ({ stdout: "{}" }),
        budget,
        { step: "fixture", tools: "", max_turns: 1, round: invocation },
        undefined,
        ctx?.signal,
      );
      for (let i = 0; i < blocks; i++) {
        if (ctx?.signal?.aborted) {
          return [{ name: "fixture-model-round", value: { observed: true, blocks_done: i },
            state: "not-evaluated", reason: "stopped-mid-round: the fixture routine observed the signal at its next model-call boundary" }];
        }
        try {
          await call("go");
        } catch (e) {
          if (String(e?.message ?? "").startsWith("stopped-mid-round")) {
            return [{ name: "fixture-model-round", value: { observed: true, blocks_done: i },
              state: "not-evaluated", reason: String(e.message) }];
          }
          throw e;
        }
        // A cancellable block: the routine is still woken only to re-check the signal at its next
        // boundary, but the wait itself does not pin the stop for the rest of the block.
        await new Promise((resolve) => {
          const t = setTimeout(resolve, callMs);
          if (ctx?.signal) ctx.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
      return [{ name: "fixture-model-round", value: { observed: true, blocks_done: blocks }, state: "verified", reason: null }];
    },
  };
  return runResidentQualityGateLoop({
    root, pidFile, intervalMs: 1000, runId, json: false,
    roundLogFile: path.join(root, ".quay", "quality-round.jsonl"),
    routines: [routine], stopGraceMs: 5000, stopPollMs: 100, kind: "quality",
  });
}
`;

/** Build the shipped-layout kernel: real `driver-runtime` + `driver-anchor` bundles, a bundled fixture
 *  `quality-gate-driver`, plain fixture or real bundles for the rest. */
async function buildAnchorKernel(kernelDir, { qualityFixture = true } = {}) {
  const dist = path.join(kernelDir, "scripts", "dist");
  fs.mkdirSync(dist, { recursive: true });
  // If a kernel tree already carries the anchor/runtime bundles (e.g. a real `publish-dist-branch.sh`
  // artifact, pointed at by QUAY_E2E_KERNEL_DIR), keep THOSE — only the kind drivers, which this file has
  // to replace with fixtures, are written here. Same fixture driver, different kernel tree.
  if (!fs.existsSync(path.join(dist, "driver-runtime.js"))) {
    await esbuildBundle(path.join(SCRIPTS, "driver-runtime.ts"), path.join(dist, "driver-runtime.js"));
  }
  if (!fs.existsSync(path.join(dist, "driver-anchor.js"))) {
    await esbuildBundle(path.join(SCRIPTS, "driver-anchor.ts"), path.join(dist, "driver-anchor.js"));
  }
  for (const kind of KNOWN_KINDS) {
    if (kind === "quality" && qualityFixture) {
      const src = path.join(kernelDir, "fixture-quality-gate-driver.ts");
      fs.writeFileSync(src, QUALITY_FIXTURE_SOURCE, "utf8");
      await esbuildBundle(src, path.join(dist, "quality-gate-driver.js"));
    } else {
      fs.writeFileSync(path.join(dist, `${kind}-driver.js`), plainFixtureSource(kind), "utf8");
    }
  }
  return kernelDir;
}

/** The worker-kind kernel: the REAL shipped `worker-driver.js` bundle (run directly, with fixture
 *  commands) — the same entry the anchor would invoke. */
async function buildWorkerKernel(kernelDir) {
  const dist = path.join(kernelDir, "scripts", "dist");
  fs.mkdirSync(dist, { recursive: true });
  const own = path.join(dist, "worker-driver.js");
  // A tree that already carries the worker bundle (a real artifact via QUAY_E2E_KERNEL_DIR) is used
  // AS-IS — then this arm runs THAT kernel, not a source build.
  if (fs.existsSync(own)) return kernelDir;
  await esbuildBundle(path.join(SCRIPTS, "worker-driver.ts"), own);
  return kernelDir;
}

// ── the scratch host ───────────────────────────────────────────────────────────────────────────────

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

/** A fresh `git init` scratch host with `.quay/plugin` resolving to the `.git`-free kernel tree. */
function makeHost(kernelDir, tag) {
  const host = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-restart-${tag}-`));
  git(host, ["init", "-q", "-b", "develop"]);
  git(host, ["config", "user.email", "e2e@test.invalid"]);
  git(host, ["config", "user.name", "e2e"]);
  fs.writeFileSync(path.join(host, ".gitignore"), ".quay/\n");
  fs.mkdirSync(path.join(host, ".quay"), { recursive: true });
  fs.symlinkSync(kernelDir, path.join(host, ".quay", "plugin"), "dir");
  return host;
}

/** The premise, MECHANICALLY: `.quay/plugin` names the kernel tree and NOT the quay source checkout. */
function assertCleanHostPremise(host, kernelDir) {
  const resolved = fs.realpathSync(path.join(host, ".quay", "plugin"));
  assert.equal(resolved, fs.realpathSync(kernelDir), "`.quay/plugin` must resolve to the kernel tree");
  assert.ok(
    !resolved.startsWith(REPO_ROOT + path.sep),
    `the kernel tree must NOT live inside the quay source checkout (got ${resolved})`,
  );
}

function kernelBin(kernelDir) {
  return path.join(kernelDir, "scripts", "dist", "driver-runtime.js");
}

function runKernel(kernelDir, host, args, extraEnv = {}) {
  return spawnSync(process.execPath, ["--no-warnings", kernelBin(kernelDir), ...args, "--root", host], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, QUAY_PLUGIN_ROOT: kernelDir, ...extraEnv },
  });
}

const readLines = (file) =>
  fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).flatMap((l) => {
        try { return [JSON.parse(l)]; } catch { return []; }
      })
    : [];

const anchorLog = (host) => {
  const p = path.join(host, ".quay", "anchor.log");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};

/** Direct quantity: how many times `kind=<k> loop started` appears in the anchor log. */
function loopStartedCount(host, kind) {
  return (anchorLog(host).match(new RegExp(`kind=${kind} loop started`, "g")) ?? []).length;
}

const ledger = (host) => readLines(path.join(host, BUDGET_LEDGER_REL));
const reserves = (host) => ledger(host).filter((l) => l.kind === "reserve");
const qualityRounds = (host) => readLines(path.join(host, QUALITY_ROUND_LOG));

function readAnchorPid(host) {
  const p = path.join(host, ".quay", "anchor.pid");
  return fs.existsSync(p) ? Number(fs.readFileSync(p, "utf8").trim()) : null;
}

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function stopAnchor(host) {
  const pid = readAnchorPid(host);
  if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
}

function cleanup(host, extraPids = []) {
  stopAnchor(host);
  for (const pid of extraPids) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  stopAnchor(host); // the anchor may have respawned between the two reads
  fs.rmSync(host, { recursive: true, force: true });
}

/** Start the six kinds on ONE anchor; the FIRST `start` spawns the anchor and carries `env` with it
 *  (the anchor's environment is fixed at spawn — later `start`s do not re-read it). */
function startAllKinds(kernelDir, host, env = {}) {
  const first = KNOWN_KINDS[0];
  const r0 = runKernel(kernelDir, host, ["start", "--kind", first, "--confirm-timeout", "20"], env);
  assert.equal(r0.status, 0, `start ${first} failed: ${r0.stdout}${r0.stderr}`);
  for (const kind of KNOWN_KINDS.slice(1)) {
    const r = runKernel(kernelDir, host, ["start", "--kind", kind, "--confirm-timeout", "20"]);
    assert.equal(r.status, 0, `start ${kind} failed: ${r.stdout}${r.stderr}`);
  }
}

let SHARED_KERNEL = null;
before(async () => {
  // QUAY_E2E_KERNEL_DIR points the harness at an already-built kernel tree (e.g. a real
  // `publish-dist-branch.sh` artifact extracted `.git`-free); otherwise it builds the shipped layout.
  SHARED_KERNEL = process.env.QUAY_E2E_KERNEL_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "e2e-restart-kernel-"));
  await buildAnchorKernel(SHARED_KERNEL);
});
after(() => {
  if (SHARED_KERNEL && !process.env.QUAY_E2E_KERNEL_DIR) fs.rmSync(SHARED_KERNEL, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// AC1 (scenario 1) — a quality restart issued MID-ROUND confirms within the fix's bound
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("AC1 — mid-round `restart --kind quality` on the shipped-layout kernel confirms within the bound; the interrupted round is a distinct stopped-mid-round state, and no reservation is taken after the stop", async (t) => {
  const host = makeHost(SHARED_KERNEL, "ac1");
  t.after(() => cleanup(host));
  assertCleanHostPremise(host, SHARED_KERNEL);

  // A round far longer than the 60000ms stop window (25 blocks × 5s = 125s), exactly the production shape.
  startAllKinds(SHARED_KERNEL, host, { QUAY_E2E_CALL_MS: "5000", QUAY_E2E_BLOCKS: "25" });

  // The premise for the whole scenario: we are on the bundle layout, so the in-process per-kind stop
  // registry is NOT shared with the anchor (that is the defect class this E2E exists to guard).
  assert.equal(
    requestKindStop("quality"),
    false,
    "the in-process KIND_STOP registry must not reach the bundled anchor (otherwise this is not the shipped layout)",
  );

  // Wait until the fixture routine is genuinely MID-ROUND with reservations already taken.
  await waitFor(() => reserves(host).length >= 1, 20_000, "the fixture routine to take its first reservation");
  const before = Object.fromEntries(KNOWN_KINDS.map((k) => [k, loopStartedCount(host, k)]));
  const anchorPidBefore = readAnchorPid(host);
  assert.ok(anchorPidBefore, "the anchor pid is recorded");

  const t0 = Date.now();
  const r = runKernel(SHARED_KERNEL, host, ["restart", "--kind", "quality", "--confirm-timeout", "20"]);
  const elapsedMs = Date.now() - t0;

  assert.equal(r.status, 0, `restart must succeed on a busy kind; stderr=${r.stderr}`);
  assert.ok(!/stop-failed/.test(r.stderr), `⛔ no stop-failed line: ${r.stderr}`);
  assert.ok(!/restart-aborted/.test(r.stderr), `⛔ no restart-aborted line: ${r.stderr}`);
  const confirmed = /started: anchor pid=(\d+) kind=quality driver pid=(\d+) confirmed_ms=(\d+)/.exec(r.stdout);
  assert.ok(confirmed, `the confirm line with confirmed_ms must be present:\n${r.stdout}`);
  assert.equal(Number(confirmed[1]), anchorPidBefore, "the restart stayed on the same anchor");
  // The fix's stated bound: one stop-probe poll + the in-flight routine's own cancellation granularity
  // + teardown (≈6s) — against the 60000ms window that the pre-fix loop could never beat.
  assert.ok(elapsedMs < 20_000, `mid-round restart must confirm within the bound (measured ${elapsedMs}ms; the stop window is 60000ms)`);
  assert.ok(/^stopped$/m.test(r.stdout), "the stop half reports `stopped`");
  assert.ok(r.stdout.indexOf("stopped") < r.stdout.indexOf("started:"), "`stopped` precedes the new `started`");

  // The interrupted round records a DISTINCT state (硬规则 3b: a half round must never be shaped like a
  // completed one) — not `verified`.
  const rounds = qualityRounds(host);
  assert.ok(rounds.length >= 1, "the round record was written even though the round was interrupted");
  const rec = rounds[rounds.length - 1];
  assert.equal(rec.stopped_mid_round, true, "the round is marked stopped_mid_round");
  assert.equal(rec.facts.length, 1);
  assert.equal(rec.facts[0].state, "not-evaluated", "⛔ a half round is never recorded `verified`");
  assert.ok(
    String(rec.facts[0].reason).startsWith("stopped-mid-round"),
    `the reason comes from the single-source token: ${rec.facts[0].reason}`,
  );
  assert.equal(rec.facts[0].value.observed, true, "the routine's OWN reading is handed back, not a caller-authored one");
  assert.ok(rec.facts.every((f) => f.state !== "verified"), "⛔ no fact of an interrupted round may be `verified`");

  // Budget ledger: reservations BEFORE the stop count; NONE is taken after it. The reservation count is
  // bounded by the blocks the routine actually completed (+ at most one in-flight reservation, which the
  // abort leaves SPENT — it is never refunded), and no reservation's timestamp is after the stop.
  // Budget ledger, attributed by round: the reservations of the INTERRUPTED round (invocation 1) are the
  // ones taken before the stop; the count is bounded by the blocks that round had actually completed, plus
  // at most the single reservation that was IN FLIGHT when the abort arrived (which stays spent — it is
  // never refunded). No reservation of that round can follow the routine's own stop observation.
  const rounds_ = rec.facts[0].value.blocks_done;
  const interrupted = reserves(host).filter((r) => r.round === 1);
  assert.ok(interrupted.length >= 1, "reservations taken before the stop are counted");
  assert.ok(
    interrupted.length <= rounds_ + 1,
    `⛔ no reservation may be taken after the routine observed the stop (round-1 reserves=${interrupted.length}, blocks_done=${rounds_})`,
  );
  assert.ok(interrupted.length < 25, `⛔ the routine stopped early — a full round would have taken 25 (got ${interrupted.length})`);
  assert.equal(
    ledger(host).filter((l) => l.kind === "outcome").length,
    interrupted.length,
    "each reservation of the interrupted round has exactly one outcome (the in-flight one is settled, not leaked)",
  );

  // No double loop: `loop stopped` precedes the next `loop started` for quality.
  const log = anchorLog(host);
  const tail = log.slice(log.lastIndexOf("kind=quality loop stopped"));
  assert.ok(tail.length > 0, "a `kind=quality loop stopped` line exists");
  assert.ok(tail.includes("kind=quality loop started"), "the new quality loop started after the stop");

  // No OTHER kind was restarted, and the anchor is the same process throughout.
  const after = Object.fromEntries(KNOWN_KINDS.map((k) => [k, loopStartedCount(host, k)]));
  for (const kind of KNOWN_KINDS) {
    if (kind === "quality") {
      assert.equal(after[kind], before[kind] + 1, `quality's loop-started count moved by exactly one (${before[kind]} -> ${after[kind]})`);
    } else {
      assert.equal(after[kind], before[kind], `⛔ the ${kind} kind must NOT be restarted (${before[kind]} -> ${after[kind]})`);
    }
  }
  assert.equal(readAnchorPid(host), anchorPidBefore, "the anchor pid is unchanged across the restart");

  evidence("AC1", {
    confirm_line: confirmed[0],
    elapsed_ms: elapsedMs,
    round_record: rec,
    ledger_round1_reserves: interrupted.length,
    ledger_outcomes: ledger(host).filter((l) => l.kind === "outcome").length,
    anchor_log_stop_start: log.split("\n").filter((l) => /kind=quality loop (stopped|started)|host pid=/.test(l)).slice(-3),
    loop_started_before_after: Object.fromEntries(KNOWN_KINDS.map((k) => [k, `${before[k]} -> ${after[k]}`])),
    anchor_pid: `${anchorPidBefore} -> ${readAnchorPid(host)}`,
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// AC4 (scenario 4) — three back-to-back quality restarts, no pause
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("AC4 — three consecutive `restart --kind quality` with no pause all confirm; the other kinds and the anchor pid are unchanged", async (t) => {
  const host = makeHost(SHARED_KERNEL, "ac4");
  t.after(() => cleanup(host));
  assertCleanHostPremise(host, SHARED_KERNEL);

  startAllKinds(SHARED_KERNEL, host, { QUAY_E2E_CALL_MS: "1500", QUAY_E2E_BLOCKS: "40" });
  await waitFor(() => reserves(host).length >= 1, 20_000, "the fixture routine to start its round");

  const before = Object.fromEntries(KNOWN_KINDS.map((k) => [k, loopStartedCount(host, k)]));
  const anchorPidBefore = readAnchorPid(host);

  const confirmations = [];
  for (let i = 1; i <= 3; i++) {
    const r = runKernel(SHARED_KERNEL, host, ["restart", "--kind", "quality", "--confirm-timeout", "20"]);
    assert.equal(r.status, 0, `restart #${i} must confirm; stderr=${r.stderr}`);
    assert.ok(!/stop-failed|restart-aborted/.test(r.stderr), `restart #${i} must not fail: ${r.stderr}`);
    const m = /started: anchor pid=(\d+) kind=quality driver pid=(\d+) confirmed_ms=(\d+)/.exec(r.stdout);
    assert.ok(m, `restart #${i} printed the confirm line: ${r.stdout}`);
    confirmations.push(m[3]);
  }
  assert.equal(confirmations.length, 3, "all three restarts confirmed");

  const after = Object.fromEntries(KNOWN_KINDS.map((k) => [k, loopStartedCount(host, k)]));
  for (const kind of KNOWN_KINDS) {
    if (kind === "quality") {
      assert.equal(after[kind], before[kind] + 3, `quality restarted exactly three times (${before[kind]} -> ${after[kind]})`);
    } else {
      assert.equal(after[kind], before[kind], `⛔ the ${kind} kind must be untouched by three quality restarts (${before[kind]} -> ${after[kind]})`);
    }
  }
  assert.equal(readAnchorPid(host), anchorPidBefore, "the anchor pid is unchanged across all three restarts");
  evidence("AC4", {
    confirmed_ms_each: confirmations,
    loop_started_before_after: Object.fromEntries(KNOWN_KINDS.map((k) => [k, `${before[k]} -> ${after[k]}`])),
    anchor_pid: `${anchorPidBefore} -> ${readAnchorPid(host)}`,
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// AC5 (scenario 5) — the failure path: a loop that ignores every stop ⇒ a legible abort + desired restored
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("AC5 — a loop that ignores every stop makes `restart` abort legibly, with desired state restored and exactly one loop", async (t) => {
  const host = makeHost(SHARED_KERNEL, "ac5");
  t.after(() => cleanup(host));
  assertCleanHostPremise(host, SHARED_KERNEL);

  // `outer` is the ignoring fixture, and it must be the FIRST start: the anchor carries the env at spawn.
  const first = "outer";
  const r0 = runKernel(SHARED_KERNEL, host, ["start", "--kind", first, "--confirm-timeout", "20"], { QUAY_E2E_IGNORE_STOP: first });
  assert.equal(r0.status, 0, `start ${first} failed: ${r0.stdout}${r0.stderr}`);
  for (const kind of KNOWN_KINDS.filter((k) => k !== first)) {
    const r = runKernel(SHARED_KERNEL, host, ["start", "--kind", kind, "--confirm-timeout", "20"]);
    assert.equal(r.status, 0, `start ${kind} failed: ${r.stdout}${r.stderr}`);
  }

  const desiredBefore = JSON.parse(fs.readFileSync(path.join(host, ".quay", "anchor-desired.json"), "utf8")).kinds;
  assert.ok(desiredBefore.includes(first), "precondition: the ignoring kind is in desired state");
  const startedBefore = loopStartedCount(host, first);
  const anchorPidBefore = readAnchorPid(host);

  // Drive the SHIPPED kernel's own `restartKind` — the CLI has no flag for the stop window, and the
  // production window is 60000ms; shrinking it is a test seam of `StopOptions`, not a second mechanism.
  const kernel = await import(new URL(`file://${kernelBin(SHARED_KERNEL)}`).href);
  let out = "";
  let err = "";
  const rc = await kernel.restartKind(host, first, { confirmTimeoutSecs: 20, stopTimeoutMs: 1500 }, (s) => { out += s; }, (s) => { err += s; });

  assert.equal(rc, 1, `an un-stoppable loop must abort the restart (stdout=${out} stderr=${err})`);
  assert.match(err, /^restart-aborted: kind=outer/m, `the abort names itself: ${err}`);
  assert.ok(!/^started:/m.test(out), "⛔ an aborted restart must NOT start a new loop (that would double-dispatch)");

  // Desired state is restored: "restart" asserts the kind SHOULD be running, so an abort must leave it so.
  const desiredAfter = JSON.parse(fs.readFileSync(path.join(host, ".quay", "anchor-desired.json"), "utf8")).kinds;
  assert.ok(desiredAfter.includes(first), `the aborted restart restored desired state: ${JSON.stringify(desiredAfter)}`);
  // Exactly one loop: the abort did not start a second one.
  await sleep(300);
  assert.equal(loopStartedCount(host, first), startedBefore, `⛔ exactly one loop (${startedBefore} -> ${loopStartedCount(host, first)})`);
  assert.equal(readAnchorPid(host), anchorPidBefore, "the anchor pid is unchanged");
  evidence("AC5", {
    rc,
    stderr_first_line: err.split("\n")[0],
    stdout: out.split("\n").filter(Boolean).slice(0, 2),
    desired_before: desiredBefore,
    desired_after: desiredAfter,
    loop_started: `${startedBefore} -> ${loopStartedCount(host, first)}`,
    anchor_pid: `${anchorPidBefore} -> ${readAnchorPid(host)}`,
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// AC2 (scenario 2) — a worker-kind restart does not touch in-flight work; the surviving/exiting worker
// is adopted and fanned in exactly once, and the task is never dispatched twice
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("AC2a — `restart --kind worker` leaves the in-flight worker child alive (§6.9 inv.3) and starts exactly one new loop", async (t) => {
  // Own kernel tree: this case swaps the worker-kind driver for a child-spawning fixture, and the shared
  // tree must stay untouched for the other cases.
  const ownKernel = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-restart-k2a-"));
  await buildAnchorKernel(ownKernel);
  const host = makeHost(ownKernel, "ac2a");
  const childPids = [];
  t.after(() => { cleanup(host, childPids); fs.rmSync(ownKernel, { recursive: true, force: true }); });
  assertCleanHostPremise(host, ownKernel);

  // A worker-kind fixture that spawns a REAL long-lived child before entering its loop. The anchor
  // carries the child command at spawn, so the worker kind must be started first.
  const workerFixture = `import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
export async function main(argv) {
  const args = argv.slice(2);
  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const root = get("--root");
  const pidFile = get("--pid-file");
  if (pidFile) fs.writeFileSync(pidFile, String(process.pid) + "\\n", "utf8");
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},120000)"], { stdio: "ignore" });
  fs.writeFileSync(path.join(root, ".quay", "e2e-worker-child.pid"), String(child.pid) + "\\n", "utf8");
  const stops = path.join(root, ".quay", "anchor-kind-stops.json");
  const file = path.join(root, ".quay", "worker-round.jsonl");
  let round = 0;
  while (true) {
    try { const j = JSON.parse(fs.readFileSync(stops, "utf8")); if (j && j.worker) break; } catch {}
    round += 1;
    try { fs.appendFileSync(file, JSON.stringify({ round, pid: process.pid }) + "\\n"); } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return 0;
}
`;
  fs.writeFileSync(path.join(ownKernel, "scripts", "dist", "worker-driver.js"), workerFixture, "utf8");

  const r0 = runKernel(ownKernel, host, ["start", "--kind", "worker", "--confirm-timeout", "20"]);
  assert.equal(r0.status, 0, `start worker failed: ${r0.stdout}${r0.stderr}`);
  for (const kind of KNOWN_KINDS.filter((k) => k !== "worker")) {
    assert.equal(runKernel(ownKernel, host, ["start", "--kind", kind, "--confirm-timeout", "20"]).status, 0, `start ${kind}`);
  }

  const childPidFile = path.join(host, ".quay", "e2e-worker-child.pid");
  await waitFor(() => fs.existsSync(childPidFile), 20_000, "the worker's in-flight child pid file");
  const childPid = Number(fs.readFileSync(childPidFile, "utf8").trim());
  childPids.push(childPid);
  assert.ok(Number.isInteger(childPid) && pidAlive(childPid), "the in-flight worker child is alive before the restart");
  const startedBefore = loopStartedCount(host, "worker");
  const anchorPidBefore = readAnchorPid(host);

  const r = runKernel(ownKernel, host, ["restart", "--kind", "worker", "--confirm-timeout", "20"]);
  assert.equal(r.status, 0, `restart --kind worker must confirm: ${r.stdout}${r.stderr}`);
  assert.ok(/^started: /m.test(r.stdout), `the confirm line is present: ${r.stdout}`);

  assert.ok(pidAlive(childPid), "⛔ the in-flight worker child SURVIVES `restart --kind worker` (§6.9 inv.3)");
  await waitFor(() => loopStartedCount(host, "worker") === startedBefore + 1, 20_000, "exactly one new worker loop");
  assert.equal(readAnchorPid(host), anchorPidBefore, "the anchor pid is unchanged");
  evidence("AC2a", {
    confirm_line: r.stdout.split("\n").find((l) => l.startsWith("started:")),
    in_flight_worker_child_pid: childPid,
    child_alive_after_restart: pidAlive(childPid),
    worker_loop_started: `${startedBefore} -> ${loopStartedCount(host, "worker")}`,
    anchor_pid: `${anchorPidBefore} -> ${readAnchorPid(host)}`,
  });
});

test("AC2b — an orphan worker that exits is ADOPTED and fanned in exactly once (not booked `failed`), and its task is never dispatched twice", async (t) => {
  // QUAY_E2E_WORKER_KERNEL_DIR: a PRISTINE artifact tree whose own worker bundle this arm should run
  // (the anchor-arm tree has its kind drivers replaced by fixtures, so it cannot double as the kernel).
  const workerKernel = process.env.QUAY_E2E_WORKER_KERNEL_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "e2e-restart-wk2b-"));
  const host = makeHost(workerKernel, "ac2b");
  let orphan = null;
  let resident = null;
  t.after(() => {
    if (resident && resident.exitCode === null) { try { resident.kill("SIGKILL"); } catch { /* gone */ } }
    cleanup(host, orphan ? [orphan.pid] : []);
    if (!process.env.QUAY_E2E_WORKER_KERNEL_DIR) fs.rmSync(workerKernel, { recursive: true, force: true });
  });
  await buildWorkerKernel(workerKernel);
  assertCleanHostPremise(host, workerKernel);

  const taskId = "gap-e2e-orphan-adopt";
  // A real git root + a `task/<id>` worktree carrying an AC-complete commit ahead of develop.
  fs.mkdirSync(path.join(host, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(host, "tasks", `${taskId}.md`), `---\nid: ${taskId}\nstatus: ready\n---\n\n## Proposal\n\nb\n`);
  fs.writeFileSync(path.join(host, ".quay", "profiles.yml"),
    `version: 1\nprofiles:\n  w:\n    launcher: claude\n    model: test-model\n    bare: false\n    auth: key\nroles:\n  task-worker:\n    profile: w\n    name: ${WORKER_PROCESS_NAME}\n`);
  fs.mkdirSync(path.join(host, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(host, ".claude", "launch.settings.json"), JSON.stringify({ $schema: "x", permissions: {}, env: {} }));
  git(host, ["add", "-A"]);
  git(host, ["commit", "-q", "-m", "init"]);
  const wt = path.join(host, "..", `wt-e2e-${path.basename(host)}`);
  git(host, ["worktree", "add", "-q", "-b", `task/${taskId}`, wt, "develop"]);
  fs.writeFileSync(path.join(wt, "impl.txt"), "the worker's implementation\n");
  execFileSync("git", ["-C", wt, "add", "-A"]);
  execFileSync("git", ["-C", wt, "commit", "-q", "-m", "impl: worker commit"]);
  assert.equal(taskBranchHasCommits(host, taskId), true, "precondition: the worktree has commits ahead of develop");

  // A REAL live orphan worker whose cmdline carries the worker name + the task id ⇒
  // `classifyOrphanDispatch` routes it to `adopt` (a genuine orphan, not a fabricated dead pid).
  orphan = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 30000)", WORKER_PROCESS_NAME, taskId], { stdio: "ignore" });
  await waitFor(() => probePidLiveness(orphan.pid) === "alive", 15_000, "the orphan process to be observable in /proc");
  upsertDispatchRecord(dispatchStoreFile(host), {
    taskId,
    runId: "e2e-adopt",
    workerPid: orphan.pid,
    selectorReason: "e2e adopt arm",
    startedAtMs: Date.now() - 5_000,
    timeoutDeadlineMs: Date.now() + 60_000,
    cmdlineFingerprint: `claude -n ${WORKER_PROCESS_NAME} -p '... Task: ${taskId} ...'`,
  });

  const WDRV = path.join(workerKernel, "scripts", "dist", "worker-driver.js");
  const events = [];
  resident = spawn(process.execPath, ["--no-warnings", WDRV, "--root", host, "--json",
    "--ready-pool-cmd", "node -e \"console.log(JSON.stringify({ready:[],pool:0}))\"",
    "--selector-cmd", "node -e \"console.log('x pick')\"",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20", "--reconcile-interval", "1",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  resident.stdout.on("data", (d) => { for (const l of String(d).split("\n")) { if (l.trim()) { try { events.push(JSON.parse(l)); } catch { /* partial */ } } } });
  resident.stdout.on("error", () => {});
  resident.stderr.on("data", (d) => { events.push({ event: "__stderr", text: String(d) }); });

  // The new loop adopts the live orphan rather than finalizing it as dead.
  const adopted = await waitFor(() => events.some((e) => e.event === "orphan-adopted" && e.task === taskId), 30_000, "reconcile to adopt the live orphan");
  assert.ok(adopted, "the live orphan is adopted (not judged dead)");
  assert.ok(readDispatchStore(dispatchStoreFile(host))[taskId], "the dispatch record is still held while the orphan is adopted");

  // The worker EXITS inside the restart window: the adopted orphan's post-exit pipeline runs the
  // mechanical fan-in (here refused on its own AC grounds — AC3's allowed outcome) exactly once.
  orphan.kill("SIGKILL");
  const outcomeFile = path.join(host, WORKER_OUTCOME_REL);
  await waitFor(() => readLines(outcomeFile).length >= 1, 30_000, "the adopted orphan's outcome to be recorded");
  const outcomes = readLines(outcomeFile).filter((o) => o.task === taskId);
  assert.equal(outcomes.length, 1, `⛔ exactly ONE fan-in outcome for the task (got ${outcomes.length})`);
  const o = outcomes[0];
  assert.equal(o.adopted_after_exit, true, "the exit status was never observed ⇒ that stays visible (硬规则 3b)");
  assert.equal(o.exit_code, null, "no fabricated exit code");
  assert.notEqual(o.final_state, "failed", `⛔ an adopted orphan with output is NOT booked failed (got ${o.final_state})`);
  assert.ok(!/orphaned worker finalized by reconcile/.test(String(o.failure_reason)), `⛔ not the orphaned-finalize reason: ${o.failure_reason}`);
  assert.ok(
    /AC 未全勾/.test(String(o.failure_reason)) || o.mechanical_fan_in != null,
    `fan-in ran and refused on its own grounds (or landed): ${JSON.stringify(o).slice(0, 400)}`,
  );
  // No double dispatch: the driver never spawned a worker for a task that already had a live one.
  assert.equal(
    events.some((e) => e.event === "worker-spawned" && e.task === taskId),
    false,
    "⛔ the task must not be dispatched a second time while its orphan was being adopted",
  );
  const dispatch = readDispatchStore(dispatchStoreFile(host));
  assert.equal(dispatch[taskId], undefined, "the dispatch record is cleared once the outcome is written");

  // Negative control, on the SAME fixture state: the pre-fix destination (§ the orphan finalizer the
  // landed fix replaced) still books `failed` with the orphaned reason — so the arm above measures a
  // real difference, not an always-green path.
  const preFixOutcome = finalizeOrphanDispatch({ root: host, outcomeFile: path.join(host, ".quay", "prefix-control.jsonl"), record: { taskId: `${taskId}-prefix`, runId: "e2e-prefix", workerPid: 999999999, selectorReason: "pre-fix control", startedAtMs: Date.now(), timeoutDeadlineMs: 0, cmdlineFingerprint: "x" }, workerName: WORKER_PROCESS_NAME });
  const preFix = preFixOutcome.outcome;
  assert.equal(preFix.final_state, "failed", "negative control: the pre-fix destination books `failed`");
  assert.match(preFix.failure_reason, /orphaned worker finalized by reconcile/, "negative control: with the orphaned reason");
  assert.notEqual(preFix.final_state, o.final_state, "⛔ the two arms must be differently-shaped, or the control measures nothing");
  evidence("AC2b", {
    adopted_outcome: o,
    one_fan_in_outcome: outcomes.length,
    worker_spawned_events_for_task: events.filter((e) => e.event === "worker-spawned" && e.task === taskId).length,
    dispatch_record_cleared: dispatch[taskId] === undefined,
    prefix_negative_control: preFix,
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// AC3 (scenario 3) — the gap-exited worker is not booked `failed: orphaned`
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// The gap (old anchor's grace expiry → new anchor's start) is where the production loss happened: an
// orphan pid that has already exited had NO adopt path, so reconcile wrote `failed` + "orphaned worker
// finalized by reconcile" (81 occurrences, 66 with preserved commits). The AC2b arm above already drives
// the live-orphan exit path; this case drives the DEAD-with-commits path through the SHIPPED worker
// bundle's resident reconcile and pins the boundary (no commits ⇒ unchanged `failed: orphaned`).

test("AC3 — a dead orphan whose worktree carries commits resumes its fan-in (refused on its own AC grounds) and is NOT recorded `failed: orphaned`; a dead orphan with NO commits keeps the old outcome", async (t) => {
  const workerKernel = process.env.QUAY_E2E_WORKER_KERNEL_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "e2e-restart-wk3-"));
  const host = makeHost(workerKernel, "ac3");
  let resident = null;
  t.after(() => {
    if (resident && resident.exitCode === null) { try { resident.kill("SIGKILL"); } catch { /* gone */ } }
    cleanup(host);
    if (!process.env.QUAY_E2E_WORKER_KERNEL_DIR) fs.rmSync(workerKernel, { recursive: true, force: true });
  });
  await buildWorkerKernel(workerKernel);
  assertCleanHostPremise(host, workerKernel);

  const taskId = "gap-e2e-gap-exited";
  const noCommitTask = "gap-e2e-no-commits";
  fs.mkdirSync(path.join(host, "tasks"), { recursive: true });
  for (const id of [taskId, noCommitTask]) {
    fs.writeFileSync(path.join(host, "tasks", `${id}.md`), `---\nid: ${id}\nstatus: ready\n---\n\n## Proposal\n\nb\n`);
  }
  fs.writeFileSync(path.join(host, ".quay", "profiles.yml"),
    `version: 1\nprofiles:\n  w:\n    launcher: claude\n    model: test-model\n    bare: false\n    auth: key\nroles:\n  task-worker:\n    profile: w\n    name: ${WORKER_PROCESS_NAME}\n`);
  fs.mkdirSync(path.join(host, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(host, ".claude", "launch.settings.json"), JSON.stringify({ $schema: "x", permissions: {}, env: {} }));
  git(host, ["add", "-A"]);
  git(host, ["commit", "-q", "-m", "init"]);

  // A task worktree whose ACs are NOT all ticked: the fan-in refuses on its OWN grounds (AC3 allows
  // "or is refused on its own AC grounds"), which keeps the real mechanical fan-in (a whole test suite)
  // out of this fixture while still exercising the resume pipeline end-to-end.
  const wt = path.join(host, "..", `wt-e2e3-${path.basename(host)}`);
  git(host, ["worktree", "add", "-q", "-b", `task/${taskId}`, wt, "develop"]);
  fs.writeFileSync(path.join(wt, "impl.txt"), "gap-exited worker commit\n");
  execFileSync("git", ["-C", wt, "add", "-A"]);
  execFileSync("git", ["-C", wt, "commit", "-q", "-m", "impl"]);
  assert.equal(taskBranchHasCommits(host, taskId), true, "precondition: the gap-exited worker's worktree has commits");

  // Two REAL dead pids (measured dead via /proc, not a fabricated number).
  const deadPids = [];
  for (let i = 0; i < 2; i++) {
    const p = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    await new Promise((r) => p.once("exit", r));
    await waitFor(() => !fs.existsSync(`/proc/${p.pid}`), 10_000, "the fixture pid to leave /proc");
    deadPids.push(p.pid);
  }
  upsertDispatchRecord(dispatchStoreFile(host), {
    taskId, runId: "e2e-gap", workerPid: deadPids[0], selectorReason: "gap-exited arm",
    startedAtMs: Date.now() - 60_000, timeoutDeadlineMs: Date.now() - 1000,
    cmdlineFingerprint: `claude -n ${WORKER_PROCESS_NAME} -p '... Task: ${taskId} ...'`,
  });
  upsertDispatchRecord(dispatchStoreFile(host), {
    taskId: noCommitTask, runId: "e2e-nocommit", workerPid: deadPids[1], selectorReason: "no-commit control",
    startedAtMs: Date.now() - 60_000, timeoutDeadlineMs: Date.now() - 1000,
    cmdlineFingerprint: `claude -n ${WORKER_PROCESS_NAME} -p '... Task: ${noCommitTask} ...'`,
  });

  const WDRV = path.join(workerKernel, "scripts", "dist", "worker-driver.js");
  const events = [];
  resident = spawn(process.execPath, ["--no-warnings", WDRV, "--root", host, "--json",
    "--ready-pool-cmd", "node -e \"console.log(JSON.stringify({ready:[],pool:0}))\"",
    "--selector-cmd", "node -e \"console.log('x pick')\"",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20", "--reconcile-interval", "1",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  resident.stdout.on("data", (d) => { for (const l of String(d).split("\n")) { if (l.trim()) { try { events.push(JSON.parse(l)); } catch { /* partial */ } } } });
  resident.stderr.on("data", (d) => { events.push({ event: "__stderr", text: String(d) }); });

  const outcomeFile = path.join(host, WORKER_OUTCOME_REL);
  await waitFor(
    () => {
      const rows = readLines(outcomeFile);
      return rows.some((o) => o.task === taskId) && rows.some((o) => o.task === noCommitTask);
    },
    30_000,
    "both orphans to reach a terminal outcome",
  );

  const gap = readLines(outcomeFile).find((o) => o.task === taskId);
  assert.ok(gap, `the gap-exited orphan reached a terminal outcome: ${JSON.stringify(readLines(outcomeFile))}`);
  assert.notEqual(gap.final_state, "failed", `⛔ the gap-exited orphan must NOT be booked failed — the pre-fix kernel books \`failed\` here (record: ${JSON.stringify(gap)})`);
  assert.ok(!/orphaned worker finalized by reconcile/.test(String(gap.failure_reason)), "⛔ not the orphaned-finalize reason");
  assert.equal(gap.adopted_after_exit, true, "the unobserved exit status stays visible");
  assert.equal(gap.short_circuit, "ac-not-checked", "refused on its own AC grounds (AC3's allowed outcome)");

  // Boundary control: a dead orphan with NO commits keeps the pre-fix behaviour verbatim.
  const none = readLines(outcomeFile).find((o) => o.task === noCommitTask);
  assert.ok(none, "the no-commit orphan reached a terminal outcome");
  assert.equal(none.final_state, "failed", "no commits ⇒ unchanged `failed`");
  assert.match(String(none.failure_reason), /orphaned worker finalized by reconcile/, "no commits ⇒ the orphaned reason is unchanged");
  evidence("AC3", { gap_exited_outcome: gap, no_commits_outcome: none });
});
