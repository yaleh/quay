#!/usr/bin/env node
// scripts/branch-selfhost-probe.mjs — GOAL-030 ③ (task gap-goal030-branch-selfhost-probe).
//
// WHAT THIS PROVES (the goal-branch self-hosting question, SPEC-goal-branch §4.10/§8):
//   A Quay driver launched BY FILE PATH from a GOAL BRANCH tree must load THAT TREE's code, not
//   the main checkout's. The proof is a DIRECT reading, not a self-report: every status flip the
//   branch's `ready-pool-check` performs writes a structured event carrying `writerModule` (the
//   realpath of `packages/quay/src/kernel/task-transition.ts`) and `entry` (the realpath of the
//   process entry). If the flip was executed by main-checkout code those two paths fall OUTSIDE
//   the tree under evaluation ⇒ `loaded-main-checkout-code`.
//
// HOW (all in a /tmp sandbox, production untouched):
//   1. root = realpath of the git toplevel containing THIS file; main = realpath of the main
//      checkout (dirname of `git rev-parse --git-common-dir`).
//   2. Build a throw-away sandbox git repo in /tmp: `develop` and `author` at the SAME commit,
//      `author` checked out; a REAL `.quay/config.yml` (native provider → <root>/packages/quay-native);
//      three seeded tasks — 2 promotion-eligible todos + 1 ready task with a DECAYED artifact set.
//   3. Run the BRANCH's promotion-driver by file path with DEFAULT child resolution (⛔ no
//      `--ready-pool-cmd`) ⇒ todo→ready flips on the sandbox.
//   4. Run the BRANCH's `ready-pool-check --revaluate-apply` ⇒ ready→todo retreat on the sandbox.
//   5. Read every record of the sandbox's `.quay/task-status-events.jsonl` verbatim.
//   6. NEGATIVE CONTROL (when root ≠ main): the MAIN checkout's promotion-driver on an identical
//      second sandbox. Main has no kernel module yet ⇒ it writes ZERO events. That is what makes
//      step 5's events *evidence of branch code* rather than evidence of "some driver ran".
//   7. PRODUCTION UNCHANGED: the four `.quay/*.jsonl` carriers + `git -C <main> status --porcelain
//      -- tasks` are read before and after (see the ATTRIBUTION note below).
//
// ── ATTRIBUTION (why `production.unchanged` is not a raw sha256 comparison) ──────────────────────
// The main checkout runs a LIVE promotion driver, so `promotion-round.jsonl` (and friends) grow
// while this probe runs. A raw before/after sha256 therefore conflates two different things:
//   (a) the probe leaked a write into production  → the thing this check exists to catch;
//   (b) an unrelated live producer appended a record → not the probe's doing, and unavoidable.
// Collapsing (b) into a red would make the criterion permanently flaky (and would report a defect
// that isn't there). So `unchanged` is computed as a PRECISE, FALSEABLE property instead:
//   unchanged ⟺ no watched carrier's delta is attributable to this probe
// where "attributable" means the append mentions this probe's sandbox root path, its unique run id,
// or one of its sandbox task ids — the fingerprints a write *caused by this probe* always carries in
// these carriers. `byteIdentical` (strict) and the per-file `foreign` flag are reported alongside so
// the reading stays honest: a foreign append is named, never hidden. A real leak (the sandbox tasks
// or events landing in main) is attributed to the probe and fails.
//
// USAGE:  node scripts/branch-selfhost-probe.mjs --json [--keep] [--selftest]
// EXIT:   0 = probe ran to completion AND its own self-check passed (identity + both transitions)
//         1 = ran to completion, self-check FAILED (a `CAUSE=` line is written to stderr)
//         3 = could not be evaluated (not a git tree / sandbox could not be built / a driver failed)
//
// ⛔ The exit code is NOT the goal criterion's verdict — AC-337 re-derives every reading from the
// JSON below and independently re-checks the code identity of each event (it does not trust this
// script's own "pass"). `--selftest` exercises that same comparator against injected paths.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ── exit codes ──────────────────────────────────────────────────────────────────────────────────
export const EXIT_OK = 0;
export const EXIT_SELFCHECK_FAILED = 1;
export const EXIT_NOT_EVALUATED = 3;

export const CAUSE_LOADED_MAIN = "CAUSE=loaded-main-checkout-code";
export const CAUSE_PROMOTION_NOT_TRIGGERED = "CAUSE=promotion-not-triggered";
export const CAUSE_REVALUATION_NOT_TRIGGERED = "CAUSE=revaluation-not-triggered";
export const CAUSE_CHILD_PINNED = "CAUSE=child-pinned";
export const CAUSE_NEGATIVE_CONTROL_FAILED = "CAUSE=negative-control-failed";
export const CAUSE_PRODUCTION_TOUCHED = "CAUSE=production-touched";
export const CAUSE_ENV_OVERRIDE = "CAUSE=env-override-present";

// ── the sandbox's task ids (unique; their presence anywhere outside the sandbox is a leak) ──────
const SANDBOX_TASK_IDS = ["bsp-todo-alpha", "bsp-todo-beta", "bsp-ready-decayed"];
const TODO_TASK_IDS = ["bsp-todo-alpha", "bsp-todo-beta"];
const READY_TASK_ID = "bsp-ready-decayed";

// ── the four production carriers a sandbox run must never touch ──────────────────────────────────
const WATCHED_CARRIERS = [
  ".quay/dispatch-record.jsonl",
  ".quay/promotion-round.jsonl",
  ".quay/promotion-outcome.jsonl",
  ".quay/worker-round.jsonl",
];

// ── path helpers ────────────────────────────────────────────────────────────────────────────────
function realpathOr(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** The directory this script lives in (works whether or not it is a symlink). */
function probeDir() {
  return path.dirname(realpathOr(fileURLToPath(import.meta.url)));
}

/** The git toplevel containing `startDir`, realpath'd; null when not inside a git tree. */
function gitToplevel(startDir) {
  try {
    const out = execFileSync("git", ["-C", startDir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out ? realpathOr(out) : null;
  } catch {
    return null;
  }
}

/** The MAIN checkout: the parent of the shared git dir (`--git-common-dir`). null when unavailable. */
function mainCheckoutOf(startDir) {
  try {
    const out = execFileSync("git", ["-C", startDir, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out) return null;
    const abs = path.isAbsolute(out) ? out : path.resolve(startDir, out);
    return path.dirname(realpathOr(abs));
  } catch {
    return null;
  }
}

// ── the code-identity comparator (the one thing --selftest exercises) ────────────────────────────
//
// A record is written by "this tree's code" iff BOTH `writerModule` (the module that executed the
// write) and `entry` (the process entry) realpath INSIDE the tree under evaluation. This mirrors
// AC-337's own re-check verbatim — the criterion re-derives the same `inTree` predicate; this is
// only the probe's self-check, never the authority.
export function classifyEventIdentities(events, treeRoot) {
  const rroot = realpathOr(treeRoot);
  const inTree = (p) => typeof p === "string" && p.length > 0 && realpathOr(p).startsWith(rroot + "/");
  const bad = (Array.isArray(events) ? events : []).filter((e) => !inTree(e && e.writerModule) || !inTree(e && e.entry));
  return { ok: bad.length === 0, bad, treeRoot: rroot };
}

// ── small fs/git helpers ────────────────────────────────────────────────────────────────────────
function sha256OrNull(file) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** True when a carrier's appended delta carries a fingerprint of THIS probe's run (see the
 *  ATTRIBUTION note in the header). Exported so the test can pin both directions of the judgment:
 *  a sandbox-root/run-id/task-id bearing line IS attributable; a live producer's ordinary record
 *  line is NOT. */
export function probeAttributable(delta, markers) {
  if (typeof delta !== "string" || delta.length === 0) return false;
  return markers.some((m) => typeof m === "string" && m.length > 0 && delta.includes(m));
}

export function appendDelta(before, after) {
  // The bytes appended between the two readings. `before === null` ⇒ the file did not exist (its
  // whole content is new). A shrink/rewrite returns the whole new content so attribution can still
  // see the probe's fingerprints.
  if (before === null) return after ?? "";
  if (after === null) return "";
  if (after.length < before.length) return after;
  if (!after.startsWith(before)) return after;
  return after.slice(before.length);
}

function gitStatusPorcelainTasks(mainRoot) {
  try {
    return execFileSync("git", ["-C", mainRoot, "status", "--porcelain", "--", "tasks"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** Read the `status:` scalar out of a task file's frontmatter (null when absent/unreadable). */
function taskStatusOf(file) {
  const raw = readIfExists(file);
  if (raw === null) return null;
  const m = raw.match(/^status:[ \t]*([^\r\n]*)$/m);
  return m ? m[1].trim() : null;
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// ── the sandbox ─────────────────────────────────────────────────────────────────────────────────
/** Non-whitespace character count of a `## <heading>` section (the MIN_SECTION_CHARS floor shape). */
function sectionChars(body, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const m = body.match(re);
  if (!m) return 0;
  const rest = body.slice(m.index + m[0].length);
  const stop = rest.match(/^#{1,2}\s/m);
  return (stop ? rest.slice(0, stop.index) : rest).replace(/\s/g, "").length;
}

/** A plan-shape todo body: Proposal / Plan / AC / DoD each ≥ 40 non-whitespace chars, self-touch. */
function todoTaskBody(id) {
  return `---
id: ${id}
title: sandbox promotion candidate ${id}
status: todo
labels:
  - gap
---

**type:** execution

## Proposal

A throw-away candidate planted by the branch self-host probe so that the promotion driver has real
eligible work to flip. Every section below clears the forty non-whitespace character floor the
shape judge enforces, and this sentence plus the three that follow are here purely to clear it.

## Plan

Run the branch tree's promotion driver over this sandbox and confirm the file's status scalar moves
from todo to ready while the structured transition event it writes names this tree's own module.

## Acceptance Criteria

- [ ] The sandbox file's status scalar reads ready after one promotion round

## Definition of Done

One status transition is observed on disk and one structured event names this sandbox as its root.

## Touches

- tasks/${id}.md
`;
}

/** A ready task whose artifact set has DECAYED (DoD absent) ⇒ the revaluation detector retreats it. */
function readyDecayedTaskBody(id) {
  return `---
id: ${id}
title: sandbox decayed ready task ${id}
status: ready
labels:
  - gap
---

**type:** execution

## Proposal

A throw-away ready task planted by the branch self-host probe so that the revaluation executor has
real decayed work to retreat. Its Definition of Done section is deliberately absent, which is the
decayed condition the revaluation detector reports as four-artifacts-incomplete.

## Plan

Run the branch tree's ready-pool-check with the revaluate-apply write flag over this sandbox and
confirm the file's status scalar moves from ready back to todo while the structured transition event
it writes names this tree's own module and this sandbox as its root.

## Acceptance Criteria

- [ ] The sandbox file's status scalar reads todo after one revaluation run

## Touches

- tasks/${id}.md
`;
}

function sandboxConfigYml(nativeProviderDir) {
  return `# .quay/config.yml — throw-away sandbox config planted by scripts/branch-selfhost-probe.mjs.
providers:
  native:
    enabled: true
    path: "${nativeProviderDir}"
    tasks_dir: "./tasks"
    mcp_entry: ["node", "./bin/quay-native.ts", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "./tasks"

loop:
  board: native
  gates: [acceptance]
  fork_baseline: develop
  merge_target: develop
`;
}

function git(args, cwd) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Build one sandbox workspace. Returns { dir, seedStatuses } where seedStatuses maps task id → the
 * status read off disk right after the seed commit. Throws on any git failure (caller ⇒ exit 3).
 */
function buildSandbox(parentDir, name, repoRoot) {
  const dir = path.join(parentDir, name);
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });

  // A REAL config whose native provider points at THIS tree's provider package by absolute path.
  fs.writeFileSync(path.join(dir, ".quay", "config.yml"), sandboxConfigYml(path.join(repoRoot, "packages", "quay-native")));

  for (const id of TODO_TASK_IDS) fs.writeFileSync(path.join(dir, "tasks", `${id}.md`), todoTaskBody(id));
  fs.writeFileSync(path.join(dir, "tasks", `${READY_TASK_ID}.md`), readyDecayedTaskBody(READY_TASK_ID));

  // Commit identity is pinned locally so the driver's own commit-after-write path works without
  // depending on the host's global git config (the probe's own commits pass `-c` explicitly too).
  git(["init", "-q", "-b", "author"], dir);
  git(["config", "user.name", "branch-selfhost-probe"], dir);
  git(["config", "user.email", "branch-selfhost-probe@example.invalid"], dir);
  git(["add", "-A"], dir);
  git(["-c", "user.name=branch-selfhost-probe", "-c", "user.email=branch-selfhost-probe@example.invalid", "commit", "-q", "-m", "sandbox: seed tasks"], dir);
  // `develop` and `author` point at the SAME commit, `author` checked out (the goal-branch shape).
  git(["branch", "-f", "develop"], dir);

  const seedStatuses = {};
  for (const id of SANDBOX_TASK_IDS) seedStatuses[id] = taskStatusOf(path.join(dir, "tasks", `${id}.md`));
  return { dir, seedStatuses };
}

function readSandboxStatuses(dir) {
  const out = {};
  for (const id of SANDBOX_TASK_IDS) out[id] = taskStatusOf(path.join(dir, "tasks", `${id}.md`));
  return out;
}

function readSandboxEvents(dir) {
  const raw = readIfExists(path.join(dir, ".quay", "task-status-events.jsonl"));
  if (raw === null) return [];
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // A torn/partial line must not silently vanish — surface it as an unparsable sentinel so the
      // criterion's identity check sees a record it cannot vouch for (硬规则 3b).
      out.push({ unparsable: t.slice(0, 200) });
    }
  }
  return out;
}

// ── child process runner (hermetic env) ─────────────────────────────────────────────────────────
function childEnv(extra) {
  const env = { ...process.env, TMPDIR: "/tmp" };
  // ⛔ The whole point of the probe: the driver must resolve its sibling scripts from ITS OWN
  // location. `QUAY_PLUGIN_ROOT` overrides that anchor (driver-runtime.ts resolveKernelScriptsDir),
  // so it is DELETED — and reported as null in the output so the criterion can check it.
  delete env.QUAY_PLUGIN_ROOT;
  return { ...env, ...(extra || {}) };
}

function runNode(args, opts) {
  const res = spawnSync(process.execPath, ["--no-warnings", ...args], {
    cwd: opts.cwd,
    env: childEnv(opts.env),
    encoding: "utf8",
    timeout: opts.timeoutMs,
    maxBuffer: 128 * 1024 * 1024,
    killSignal: "SIGKILL",
  });
  return {
    status: res.status,
    signal: res.signal,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    error: res.error ? String(res.error.message) : null,
  };
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────
function runProbe(opts) {
  const out = { runId: opts.runId };
  const selfRoot = gitToplevel(probeDir()) || realpathOr(path.resolve(probeDir(), ".."));
  const mainRoot = mainCheckoutOf(probeDir()) || selfRoot;
  out.root = selfRoot;
  out.main = mainRoot;
  out.env = { QUAY_PLUGIN_ROOT: process.env.QUAY_PLUGIN_ROOT ?? null, TMPDIR: "/tmp" };
  // ⛔ A probe that ran with the override in place would not be measuring the default anchor.
  if (out.env.QUAY_PLUGIN_ROOT !== null) {
    return { notEvaluated: `QUAY_PLUGIN_ROOT is set (${out.env.QUAY_PLUGIN_ROOT}); the probe must run with it unset` };
  }

  const promotionDriver = path.join(selfRoot, "plugin", "scripts", "promotion-driver.ts");
  const readyPoolCheck = path.join(selfRoot, "plugin", "scripts", "ready-pool-check.ts");
  if (!fs.existsSync(promotionDriver)) return { notEvaluated: `branch promotion-driver not found: ${promotionDriver}` };
  if (!fs.existsSync(readyPoolCheck)) return { notEvaluated: `branch ready-pool-check not found: ${readyPoolCheck}` };

  const tmpParent = fs.mkdtempSync(path.join("/tmp", "branch-selfhost-probe-"));
  let sandbox;
  try {
    sandbox = buildSandbox(tmpParent, "sandbox", selfRoot);
  } catch (e) {
    rmrf(tmpParent);
    return { notEvaluated: `sandbox could not be built: ${e && e.message ? e.message : String(e)}` };
  }

  // ── production baseline (before ANY branch child is spawned) ──────────────────────────────────
  const prodBefore = snapshotProduction(mainRoot);

  // ── 1. promotion round: the BRANCH tree's driver, DEFAULT child resolution ────────────────────
  const promRun = runNode(
    [
      "--experimental-strip-types",
      promotionDriver,
      "--root",
      sandbox.dir,
      "--once",
      "--cap",
      "2",
      // ⚠️ The task Proposal names `--max-fix-retries 0`; the driver REJECTS 0 ("must be a positive
      // integer", exit 2). 1 is the smallest accepted value — with every candidate eligible there is
      // no fix decision at all, so no fix worker is ever spawned either way.
      "--max-fix-retries",
      "1",
      "--run-id",
      opts.runId,
      "--json",
    ],
    { cwd: sandbox.dir, timeoutMs: opts.driverTimeoutMs },
  );
  if (promRun.status !== 0) {
    const kept = opts.keep ? tmpParent : null;
    if (!opts.keep) rmrf(tmpParent);
    return {
      notEvaluated:
        `branch promotion-driver did not run to completion (status=${promRun.status} signal=${promRun.signal || "-"}): ` +
        `${(promRun.stderr || promRun.error || "").trim().split("\n").slice(-3).join(" ")}`,
      kept,
    };
  }

  const afterPromotion = readSandboxStatuses(sandbox.dir);

  // ── 2. revaluation round: the BRANCH tree's ready-pool-check, --revaluate-apply ───────────────
  const revalRun = runNode(
    ["--experimental-strip-types", readyPoolCheck, "--root", sandbox.dir, "--revaluate-apply", "--json"],
    { cwd: sandbox.dir, timeoutMs: opts.driverTimeoutMs },
  );
  if (revalRun.status !== 0) {
    const kept = opts.keep ? tmpParent : null;
    if (!opts.keep) rmrf(tmpParent);
    return {
      notEvaluated:
        `branch ready-pool-check --revaluate-apply did not run to completion (status=${revalRun.status} ` +
        `signal=${revalRun.signal || "-"}): ${(revalRun.stderr || revalRun.error || "").trim().split("\n").slice(-3).join(" ")}`,
      kept,
    };
  }

  const afterReval = readSandboxStatuses(sandbox.dir);
  const events = readSandboxEvents(sandbox.dir);

  // ── flips are read off the SANDBOX FILES, not off the events (so the two readings are independent)
  const promotionFlips = TODO_TASK_IDS.filter((id) => sandbox.seedStatuses[id] === "todo" && afterPromotion[id] === "ready").length;
  const revaluationFlips = SANDBOX_TASK_IDS.filter((id) => afterPromotion[id] === "ready" && afterReval[id] === "todo").length;

  // ── 3. negative control: the MAIN checkout's driver on an identical sandbox ───────────────────
  let negativeControl = { evaluated: false, events: null, mainHasModule: false, reason: "root == main" };
  const mainHasModule = fs.existsSync(path.join(mainRoot, "packages", "quay", "src", "kernel", "task-transition.ts"));
  negativeControl.mainHasModule = mainHasModule;
  if (selfRoot !== mainRoot) {
    try {
      const negSandbox = buildSandbox(tmpParent, "sandbox-negative", mainRoot);
      const negDriver = path.join(mainRoot, "plugin", "scripts", "promotion-driver.ts");
      const negRun = runNode(
        ["--experimental-strip-types", negDriver, "--root", negSandbox.dir, "--once", "--cap", "2", "--max-fix-retries", "1", "--run-id", `${opts.runId}-neg`, "--json"],
        { cwd: negSandbox.dir, timeoutMs: opts.driverTimeoutMs },
      );
      const negEvents = readSandboxEvents(negSandbox.dir);
      negativeControl = {
        evaluated: negRun.status === 0,
        events: negEvents.length,
        mainHasModule,
        exit: negRun.status,
        reason: negRun.status === 0 ? "ran" : `${(negRun.stderr || negRun.error || "").trim().split("\n").slice(-2).join(" ")}`,
      };
    } catch (e) {
      negativeControl = { evaluated: false, events: null, mainHasModule, reason: `negative sandbox failed: ${e && e.message ? e.message : String(e)}` };
    }
  }

  // ── 4. production after ───────────────────────────────────────────────────────────────────────
  const markers = [realpathOr(tmpParent), sandbox.dir, opts.runId, ...SANDBOX_TASK_IDS];
  const production = diffProduction(prodBefore, snapshotProduction(mainRoot), mainRoot, markers);

  out.promotion = {
    childResolution: "default", // ⛔ `--ready-pool-cmd` was not passed: the driver resolved its own child
    childEntry: events.find((e) => e && e.kind === "promote")?.entry ?? null,
    driverExit: promRun.status,
    flips: promotionFlips,
    seedStatuses: sandbox.seedStatuses,
    afterPromotion,
  };
  out.revaluation = {
    exit: revalRun.status,
    flips: revaluationFlips,
    afterRevaluation: afterReval,
  };
  out.events = events;
  out.negativeControl = negativeControl;
  out.production = production;

  // ── 5. self-check (the criterion re-derives all of this independently) ────────────────────────
  const causes = [];
  const identity = classifyEventIdentities(events, selfRoot);
  if (!identity.ok) causes.push(CAUSE_LOADED_MAIN);
  const promEvents = events.filter((e) => e && e.from === "todo" && e.to === "ready" && e.kind === "promote");
  const retrEvents = events.filter((e) => e && e.from === "ready" && e.to === "todo" && e.kind === "retreat");
  if (!(promotionFlips >= 2) || promEvents.length !== promotionFlips) causes.push(CAUSE_PROMOTION_NOT_TRIGGERED);
  if (!(revaluationFlips >= 1) || retrEvents.length !== revaluationFlips) causes.push(CAUSE_REVALUATION_NOT_TRIGGERED);
  if (out.promotion.childResolution !== "default") causes.push(CAUSE_CHILD_PINNED);
  if (selfRoot !== mainRoot && mainHasModule !== true && !(negativeControl.evaluated === true && negativeControl.events === 0)) {
    causes.push(CAUSE_NEGATIVE_CONTROL_FAILED);
  }
  if (production.unchanged !== true) causes.push(CAUSE_PRODUCTION_TOUCHED);

  out.selfCheck = { ok: causes.length === 0, causes, badEvents: identity.bad.slice(0, 3) };
  out.sandboxKept = opts.keep ? tmpParent : null;
  if (!opts.keep) rmrf(tmpParent);
  return out;
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* best effort — a leftover /tmp dir is not a probe failure */
  }
}

function snapshotProduction(mainRoot) {
  const files = WATCHED_CARRIERS.map((rel) => {
    const abs = path.join(mainRoot, rel);
    return { rel, sha: sha256OrNull(abs), content: readIfExists(abs) };
  });
  return { files, tasksStatus: gitStatusPorcelainTasks(mainRoot) };
}

function diffProduction(before, after, mainRoot, markers) {
  const files = [];
  const foreignDrift = [];
  let anyAttributable = false;
  for (let i = 0; i < WATCHED_CARRIERS.length; i++) {
    const b = before.files[i];
    const a = after.files[i];
    const changed = b.sha !== a.sha;
    const delta = changed ? appendDelta(b.content, a.content) : "";
    const attributableToProbe = changed && probeAttributable(delta, markers);
    if (attributableToProbe) anyAttributable = true;
    if (changed && !attributableToProbe) foreignDrift.push(b.rel);
    files.push({
      path: b.rel,
      before: b.sha,
      after: a.sha,
      changed,
      attributableToProbe,
      foreign: changed && !attributableToProbe,
    });
  }
  // A leaked sandbox task file inside main's tasks/ is unambiguous proof of a probe write.
  let sandboxLeak = false;
  try {
    const names = fs.readdirSync(path.join(mainRoot, "tasks"));
    sandboxLeak = SANDBOX_TASK_IDS.some((id) => names.includes(`${id}.md`));
  } catch {
    sandboxLeak = false;
  }
  const tasksStatusChanged = before.tasksStatus !== after.tasksStatus;
  const tasksStatusAttributable = tasksStatusChanged && probeAttributable(after.tasksStatus, markers);
  const unchanged = !anyAttributable && !sandboxLeak && !tasksStatusAttributable;
  return {
    unchanged,
    byteIdentical: files.every((f) => !f.changed) && !tasksStatusChanged,
    files,
    foreignDrift,
    tasksStatusChanged,
    tasksStatusBefore: before.tasksStatus,
    tasksStatusAfter: after.tasksStatus,
    sandboxArtifactsLeakedIntoMain: sandboxLeak,
  };
}

// ── --selftest: the comparator, two-sided, with injected paths (no driver, no sandbox) ──────────
export function selftest() {
  const root = gitToplevel(probeDir()) || realpathOr(path.resolve(probeDir(), ".."));
  const main = mainCheckoutOf(probeDir()) || root;
  const failures = [];

  // (a) an event whose writerModule lives under MAIN must be judged loaded-main-checkout-code.
  const mainEvent = {
    writerModule: path.join(main, "packages", "quay", "src", "kernel", "task-transition.ts"),
    entry: path.join(main, "plugin", "scripts", "ready-pool-check.ts"),
    from: "todo",
    to: "ready",
    kind: "promote",
  };
  const a = classifyEventIdentities([mainEvent], root);
  if (a.ok !== false || a.bad.length !== 1) {
    failures.push(`main-checkout event was NOT flagged (ok=${a.ok}, bad=${a.bad.length})`);
  }

  // (b) every event inside ROOT must pass.
  const rootEvents = [
    {
      writerModule: path.join(root, "packages", "quay", "src", "kernel", "task-transition.ts"),
      entry: path.join(root, "plugin", "scripts", "ready-pool-check.ts"),
      from: "todo",
      to: "ready",
      kind: "promote",
    },
    {
      writerModule: path.join(root, "packages", "quay", "src", "kernel", "task-transition.ts"),
      entry: path.join(root, "plugin", "scripts", "ready-pool-check.ts"),
      from: "ready",
      to: "todo",
      kind: "retreat",
    },
  ];
  const b = classifyEventIdentities(rootEvents, root);
  if (b.ok !== true) {
    failures.push(`in-tree events were flagged: ${JSON.stringify(b.bad).slice(0, 200)}`);
  }

  // (c) a null/absent entry must NOT be silently accepted (硬规则 3b — an unreadable provenance is
  //     not a passing one).
  const c = classifyEventIdentities([{ writerModule: path.join(root, "x.ts"), entry: null }], root);
  if (c.ok !== false) failures.push("a null entry was accepted as in-tree");

  return { ok: failures.length === 0, failures, root, main };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { json: false, keep: false, selftest: false };
  for (const a of argv.slice(2)) {
    if (a === "--json") opts.json = true;
    else if (a === "--keep") opts.keep = true;
    else if (a === "--selftest") opts.selftest = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write("usage: node scripts/branch-selfhost-probe.mjs [--json] [--keep] [--selftest]\n");
      process.exit(0);
    } else {
      process.stderr.write(`branch-selfhost-probe: unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);

  if (opts.selftest) {
    const r = selftest();
    if (opts.json) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    else {
      process.stdout.write(`branch-selfhost-probe --selftest: root=${r.root} main=${r.main}\n`);
      for (const f of r.failures) process.stderr.write(`  FAIL ${f}\n`);
      process.stdout.write(r.ok ? "SELFTEST PASS\n" : "SELFTEST FAIL\n");
    }
    if (!r.ok) {
      for (const f of r.failures) process.stderr.write(`${CAUSE_LOADED_MAIN} — selftest: ${f}\n`);
    }
    return r.ok ? EXIT_OK : EXIT_SELFCHECK_FAILED;
  }

  const runId = `bsp-${process.pid}-${Date.now()}`;
  const result = runProbe({
    runId,
    keep: opts.keep,
    driverTimeoutMs: Number(process.env.BSP_DRIVER_TIMEOUT_MS || 40000),
  });

  if (result.notEvaluated) {
    process.stderr.write(`NOT-EVALUATED: ${result.notEvaluated}\n`);
    if (opts.keep && result.kept) process.stderr.write(`NOT-EVALUATED: sandbox kept at ${result.kept}\n`);
    return EXIT_NOT_EVALUATED;
  }

  if (opts.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`branch-selfhost-probe: root=${result.root}\n`);
    process.stdout.write(`  promotion flips=${result.promotion.flips} revaluation flips=${result.revaluation.flips} events=${result.events.length}\n`);
    process.stdout.write(`  negative control: ${JSON.stringify(result.negativeControl)}\n`);
    process.stdout.write(`  production unchanged=${result.production.unchanged} (byte-identical=${result.production.byteIdentical})\n`);
    process.stdout.write(result.selfCheck.ok ? "SELF-CHECK PASS\n" : "SELF-CHECK FAIL\n");
  }

  for (const cause of result.selfCheck.causes) {
    process.stderr.write(`${cause} — ${JSON.stringify({ promotion: result.promotion, revaluation: result.revaluation, negativeControl: result.negativeControl, production: { unchanged: result.production.unchanged, foreignDrift: result.production.foreignDrift, leak: result.production.sandboxArtifactsLeakedIntoMain } }).slice(0, 500)}\n`);
  }
  return result.selfCheck.ok ? EXIT_OK : EXIT_SELFCHECK_FAILED;
}

// Direct-entry guard: importing this module (the test does) must not run the probe.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return realpathOr(entry) === realpathOr(fileURLToPath(import.meta.url));
})();

if (invokedDirectly) {
  process.exitCode = main(process.argv);
}
