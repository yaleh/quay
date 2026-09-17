// Shared harness for the promotion-driver shards (split of promotion-driver.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../promotion-driver.test.mjs", import.meta.url).href;

// @test-group engine
// promotion-driver.test.mjs — AC130 + AC131 + AC132 + AC134 (tasks/gap-ac130-promotion-driver-resident-loop,
// tasks/gap-ac131-promotion-mechanical-no-llm, tasks/gap-ac132-fix-worker-structured-input,
// tasks/gap-ac134-promotion-outcome-ledger): the resident
// promotion driver loops forever, calling ready-pool-check for the FULL-pool determination (never a
// single --targeted task) each round, does not exit after one round, and enters the next round after
// --interval. AC2 is the FALSIFIABLE half: stop the driver ⇒ a newly-eligible todo in the pool is NOT
// promoted — proving promotion is driven by the driver, not some outer tick.
// AC131 (falsifiable): a qualified todo (four artifacts complete + empty deps) is promoted to ready
// within one round via the mechanical A22 --apply path, with ZERO LLM — the round's outcome record
// carries promote_path_llm_invoked=false (derived from the spawned argv, not hardcoded).
// AC132 (falsifiable): an ineligible todo spawns a short-lived `claude -p` fix worker whose input is
// the task id + the gate's STRUCTURED missing list (A24 三可修/五不可修), never a prose directive.
// AC2: a DoD<40 todo ⇒ the fix worker's prompt carries the structured identifier (fourArtifacts=false
// missing=[dod]); a prompt with only the task id and no missing list would falsify it.
// AC134 (falsifiable): every determination/promotion/fix writes one structured outcome record to
// .quay/promotion-outcome.jsonl (gitignored) with task_id · gate(eligible + missing) · action
// (promote/fix/skip) · result · ts. AC2: the carrier holds REAL records from the real ready-pool-check
// against real task files (not fixture/injected output) — ≥ N records after the driver runs.
//
// The ready-pool-check command is injectable (--ready-pool-cmd) so the pure/loop tests never touch the
// real checker; the AC2 test drives the REAL ready-pool-check --apply against a temp workspace to prove
// the promotion lands on disk while the driver lives and does not after it is SIGTERM'd. The fix-worker
// command is injectable (--fix-worker-cmd) with the structured prompt appended as the last arg, so the
// AC132 AC2 test captures the prompt the worker actually received without spawning a real claude.
//
// Run: scripts/test.sh plugin/test/promotion-driver.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

import {
  defaultPromotionCheckArgv,
  isLlmInvocation,
  runPromotionRound,
  computeRoundRecord,
  prosePrereqGapReading,
  appendRoundRecord,
  computeOutcomeRecords,
  appendOutcomeRecord,
  parseIntervalMs,
  resolveCap,
  classifyCandidate,
  buildFixWorkerPrompt,
  buildFixWorkerArgv,
  spawnFixWorker,
  runFixPass,
  computeReverifyOutcome,
  advanceRetryCap,
  markNeedsHuman,
  ROUND_LOG_REL,
  OUTCOME_LOG_REL,
  INTERVAL_MS_DEFAULT,
  CAP_DEFAULT,
  MAX_FIX_RETRIES_DEFAULT,
  FIX_WORKER_TIMEOUT_MS,
  FIX_WORKER_TIMEOUT_ENV,
  ROUND_TIMEOUT_MS,
  resolveFixWorkerTimeoutMs,
} from "../../scripts/promotion-driver.ts";
// AC150-3：资源门/halt 判定与 worker-driver 共用同一份实现（driver-shared.ts）。
import {
  resourceGateCheck as sharedResourceGateCheck,
  isHalted as sharedIsHalted,
  readControlState,
  writeControlState,
  defaultControlState,
  applyHalt,
  PROMOTION_CONTROL_STATE_REL,
} from "../../scripts/driver-shared.ts";
import { resourceGateCheck as workerResourceGateCheck, isHalted as workerIsHalted } from "../../scripts/worker-driver.ts";
















// ── pure functions ─────────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(SRC_URL));

const DRIVER = path.resolve(__dirname, "..", "scripts", "promotion-driver.ts");

// launchArgv（经 policy 解析 kind → profile）需要一个带 .quay/profiles.yml + .claude/launch.settings.json
// 的 root——L3 后默认 fix-worker argv 不再 `bash quay-launch.sh`，改用真实 repo root 读真 profiles.yml。
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// The REAL ready-pool-check lives in the worktree's plugin/scripts (not under the temp task root), so
// the AC2 test injects it via --ready-pool-cmd pointing at this path — the same seam worker-driver's
// resident-loop tests use. splitArgs splits on whitespace, so both paths here are space-free.
const READY_POOL_SCRIPT = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `promotion-driver-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  return dir;
}

// A minimal contract-shape todo body carrying the four artifacts (Proposal/Contract/AC/DoD) + the
// C8 self-touch (own tasks/<id>.md in ## Touches) — the exact shape ready-pool-check --apply promotes.
function eligibleTodoBody(id) {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars long.",
    "## Contract",
    "measure   ready_pool = ready-pool-check stdout pool field, definitely over forty chars.",
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough to count as an item",
    "- [ ] another AC item that is long enough to count as an item",
    "- [ ] a third AC item that is long enough to count as an item",
    "- [ ] a fourth AC item that is long enough to count as an item",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned, over forty chars long.",
    "## Touches",
    `- tasks/${id}.md`,
  ].join("\n");
}

function writeTask(root, id, status = "todo") {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels:",
    "  - gap",
    "parent: null",
    "children: []",
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${eligibleTodoBody(id)}`);
}

// A contract-shape todo with DoD < 40 non-whitespace chars (the AC2 falsifiable fixture): fourArtifacts
// is false with missingArtifacts=["dod"] — the gate's structured "哪一项不合格" signal.
function dodShortTodoBody(id) {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars long.",
    "## Contract",
    "measure   ready_pool = ready-pool-check stdout pool field, definitely over forty chars.",
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough to count as an item",
    "- [ ] another AC item that is long enough to count as an item",
    "- [ ] a third AC item that is long enough to count as an item",
    "- [ ] a fourth AC item that is long enough to count as an item",
    "## Definition of Done",
    "short",
    "## Touches",
    `- tasks/${id}.md`,
  ].join("\n");
}

function writeDodShortTask(root, id, status = "todo") {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels:",
    "  - gap",
    "parent: null",
    "children: []",
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${dodShortTodoBody(id)}`);
}

function readStatus(root, id) {
  const raw = fs.readFileSync(path.join(root, "tasks", `${id}.md`), "utf8");
  const m = raw.match(/^status:\s*([\w-]+)\s*$/m);
  return m ? m[1] : null;
}

function runDriver(root, args) {
  return execFileSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root, ...args,
  ], { encoding: "utf8" });
}

function readRoundLines(root) {
  const file = path.join(root, ROUND_LOG_REL);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function readOutcomeLines(root) {
  const file = path.join(root, OUTCOME_LOG_REL);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// space-free counter command (splitArgs splits on whitespace) — mirrors worker-driver's counterNodeE.
function counterNodeE(counterFile, logExpr) {
  const f = JSON.stringify(counterFile);
  return `node -e n=0;try{n=Number(require('fs').readFileSync(${f},'utf8'))}catch{};require('fs').writeFileSync(${f},String(n+1));console.log(${logExpr})`;
}

// The real ready-pool-check --apply command (full pool + land promotions) against the temp task root.
// Injected via --ready-pool-cmd so the AC2 test exercises the REAL promotion path (not a fake).
function realReadyPoolCmd(root) {
  return `node --experimental-strip-types ${READY_POOL_SCRIPT} --root ${root} --cap 5 --apply --json`;
}

// AC132 capture seam: --fix-worker-cmd replaces the fix-worker command PREFIX, and the driver appends
// the structured prompt as the LAST argv element. This script writes that last element (process.argv[1]
// for `node -e <script> <prompt>`) to the capture file — so the test can read the prompt the worker
// actually received. splitArgs splits on whitespace ⇒ the script text must be space-free.
function fixWorkerCaptureCmd(captureFile) {
  const f = JSON.stringify(captureFile);
  return `node -e require('fs').writeFileSync(${f},process.argv[1]||'')`;
}

// AC133 seam: a fix worker that "claims success" (exit 0) but changes NOTHING — the falsifiable
// fixture for "⛔ 不信 worker 自述". It also increments a counter so the retry-cap test can count how
// many times the driver actually spawned it (space-free node -e, splitArgs splits on whitespace).
function fixWorkerNoopCounter(counterFile) {
  const f = JSON.stringify(counterFile);
  return `node -e n=0;try{n=Number(require('fs').readFileSync(${f},'utf8'))}catch{};require('fs').writeFileSync(${f},String(n+1));process.exit(0)`;
}

// AC133 positive-control fixer: a REAL fix worker (a .cjs helper, since `node -e` must be space-free)
// that actually rewrites the DoD-short fixture to a ≥40-char DoD, then exits 0. Returns the space-free
// command prefix `node <abs path>`; the driver appends the prompt as the last arg (ignored here).
function writeDoDFixer(root) {
  const file = path.join(root, "fix-dod.cjs");
  fs.writeFileSync(file, [
    "const fs=require('fs');",
    "const path=require('path');",
    "const dir=path.join(process.cwd(),'tasks');",
    "for(const f of fs.readdirSync(dir)){",
    "  if(!f.endsWith('.md'))continue;",
    "  const p=path.join(dir,f);",
    "  let raw=fs.readFileSync(p,'utf8');",
    "  raw=raw.replace('short','standard DoD — the five clauses; meta-enforcer fixture-pinned, over forty chars long.');",
    "  fs.writeFileSync(p,raw);",
    "}",
    "process.exit(0);",
  ].join("\n"));
  return `node ${file}`;
}

// A self-contained temp root whose plugin/ is a SYMLINK to the worktree's plugin/ — so the driver's
// DEFAULT ready-pool-check argv (`node <root>/plugin/scripts/ready-pool-check.ts --root <root> ...`)
// resolves the REAL checker WITHOUT the --ready-pool-cmd injection seam (AC134 AC2: turn the seam off).
function makeSelfContainedRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `promotion-outcome-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.symlinkSync(path.resolve(__dirname, ".."), path.join(dir, "plugin"), "dir");
  return dir;
}

// A dep-blocked (unfixable) todo: `depends_on: gap-missing-dep` points at a task that does not exist
// ⇒ depsReady=false (fail closed) ⇒ classifyCandidate → unfixable (五不可修) ⇒ skip, no fix worker.
function writeDepBlockedTask(root, id) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    "status: todo",
    "labels:",
    "  - gap",
    "parent: null",
    "children: []",
    "depends_on:",
    "  - gap-missing-dep",
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${eligibleTodoBody(id)}`);
}

export { CAP_DEFAULT, DRIVER, FIX_WORKER_TIMEOUT_ENV, FIX_WORKER_TIMEOUT_MS, INTERVAL_MS_DEFAULT, MAX_FIX_RETRIES_DEFAULT, OUTCOME_LOG_REL, PROMOTION_CONTROL_STATE_REL, READY_POOL_SCRIPT, REPO_ROOT, ROUND_LOG_REL, ROUND_TIMEOUT_MS, __dirname, advanceRetryCap, appendOutcomeRecord, appendRoundRecord, applyHalt, assert, buildFixWorkerArgv, buildFixWorkerPrompt, classifyCandidate, computeOutcomeRecords, computeReverifyOutcome, computeRoundRecord, counterNodeE, defaultControlState, defaultPromotionCheckArgv, dodShortTodoBody, eligibleTodoBody, execFileSync, fileURLToPath, fixWorkerCaptureCmd, fixWorkerNoopCounter, fs, isLlmInvocation, makeRoot, makeSelfContainedRoot, markNeedsHuman, os, parseIntervalMs, path, prosePrereqGapReading, readControlState, readOutcomeLines, readRoundLines, readStatus, realReadyPoolCmd, resolveCap, resolveFixWorkerTimeoutMs, runDriver, runFixPass, runPromotionRound, sharedIsHalted, sharedResourceGateCheck, spawn, spawnFixWorker, test, workerIsHalted, workerResourceGateCheck, writeControlState, writeDepBlockedTask, writeDoDFixer, writeDodShortTask, writeTask };
