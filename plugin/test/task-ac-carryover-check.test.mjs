// @test-group engine
// task-ac-carryover-check.test.mjs — the AC-carryover gate
// (tasks/gap-nothing-checks-whether-a-done-task-left-its-acs-behind).
//
// The judgment is NOT "all ACs checked → done" (that invites checkbox fraud — a real instance
// measured 2026-08-03 had an AC's prose claiming 达成 while its box was unchecked). It is: a
// `status: done` task may leave ACs unchecked ONLY IF a successor task's `## Carries` section names
// which of those ACs it carries, and every unchecked AC is covered. This gate closes the gap
// task-status-drift-check cannot see — drift-check judges whether the CODE landed; here the code
// HAD landed and the task closed done with half its ACs uncarried, and nothing noticed.
//
// AC1 ## Carries machine-readable shape (from + acs) · AC2 --json unowned/blocked fields ·
// AC3 negative control BLOCK (half unchecked, no successor) · AC4 negative control PASS (same task
// with a carrying successor) — only proving "can block" is indistinguishable from "blocks
// everything", so both are pinned · AC5 partial coverage reports the missing ids · AC6 executor is
// wired (covered by scripts/test.sh's run_static_checks) · AC7 shrink-only legacy ratchet ·
// AC9 @test-group engine.
//
// Run: scripts/test.sh plugin/test/task-ac-carryover-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  parseCarriesBlocks,
  parseAcBox,
  uncheckedAcIds,
  allAcIds,
  scanStore,
  readBaseline,
  writeBaseline,
  formatJsonReport,
  BASELINE_FILE_REL,
} from "../scripts/task-ac-carryover-check.ts";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "task-ac-carryover-check.ts");

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

const fm = (id, status, extraSections = "") => `---
id: ${id}
title: t
status: ${status}
labels:
  - gap
extra:
  schema: v1
---

## Proposal

body body body

${extraSections}
`;

// A task with `total` ACs of which `unchecked` are left unchecked (the first `unchecked` ids).
function acTask(id, status, total, unchecked) {
  const lines = [];
  for (let i = 1; i <= total; i++) {
    const box = i <= unchecked ? "[ ]" : "[x]";
    lines.push(`- ${box} AC${i}: item ${i}`);
  }
  return fm(id, status, `## Acceptance Criteria\n\n${lines.join("\n")}\n`);
}

function carriesTask(id, from, acs) {
  return fm(id, "todo", `## Carries\n\nfrom: ${from}\nacs: ${acs}\n\n## Acceptance Criteria\n\n- [ ] AC1: carry\n`);
}

// A git-rooted workspace the CLI can run in (findWorkspaceRoot walks up to `.git`).
function makeGitWorkspace(tag, files = {}) {
  const dir = makeTmpDir(`tacc-${tag}-`);
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, "tasks", name), text);
  }
  return dir;
}

function runCli(root, args = []) {
  return spawnSync(process.execPath, ["--experimental-strip-types", CHECKER, "--root", root, ...args], { encoding: "utf8" });
}

// ── Governance self-skip (AC9 @test-group engine) ─────────────────────────────────────────────
// In a DEFAULT (product,engine) run this file reports `skipped`, not absent (ADR-019 decision #1
// precedent); the checker itself is enforced unconditionally via scripts/test.sh's

// ── AC1: ## Carries machine-readable shape ─────────────────────────────────────────────────────────

test("AC1 parseCarriesBlocks: from + acs fields, multiple blocks", () => {
  const text = `## Proposal

x

## Carries

from: gap-a
acs: AC9, AC10, AC11

## Contract

\`\`\`
measure m = 1
\`\`\`

## Carries

from: gap-b
acs: AC1, AC2
`;
  const blocks = parseCarriesBlocks(text);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { from: "gap-a", acs: ["AC9", "AC10", "AC11"] });
  assert.deepEqual(blocks[1], { from: "gap-b", acs: ["AC1", "AC2"] });
});

test("AC1 parseCarriesBlocks: acs tolerates whitespace and dedupes", () => {
  const text = `## Carries

from: gap-a
acs: AC9, AC10,AC9 , AC11
`;
  const blocks = parseCarriesBlocks(text);
  assert.deepEqual(blocks[0].acs, ["AC9", "AC10", "AC11"]);
});

test("AC1 parseCarriesBlocks: missing from/accepted → null/empty", () => {
  const text = `## Carries

acs: AC9
`;
  const blocks = parseCarriesBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].from, null);
  assert.deepEqual(blocks[0].acs, ["AC9"]);
});

// ── AC parsing ───────────────────────────────────────────────────────────────────────────────────

test("parseAcBox / uncheckedAcIds / allAcIds", () => {
  assert.deepEqual(parseAcBox("- [x] AC1: done"), { id: "AC1", checked: true });
  assert.deepEqual(parseAcBox("- [ ] AC13（损失函数结论一）: x"), { id: "AC13", checked: false });
  assert.deepEqual(parseAcBox("- [ ] AC14b（…）: x"), { id: "AC14b", checked: false });
  assert.equal(parseAcBox("- [ ] plain prose without an id"), null);
  const section = "- [x] AC1: done\n- [ ] AC2: not\n- [ ] AC3: not";
  assert.deepEqual(uncheckedAcIds(section), ["AC2", "AC3"]);
  assert.deepEqual(allAcIds(section), ["AC1", "AC2", "AC3"]);
});

// ── AC3 negative control (BLOCK) ────────────────────────────────────────────────────────────────

test("AC3 negative control: half unchecked + NO successor → blocked, missing listed", () => {
  const dir = makeTmpDir("ac3-store-");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "done-half.md"), acTask("done-half", "done", 8, 4));
  const result = scanStore({ repoRoot: dir, tasksDir: path.join(dir, "tasks") });
  assert.equal(result.blocked.length, 1);
  const b = result.blocked[0];
  assert.equal(b.taskId, "done-half");
  assert.deepEqual(b.missing, ["AC1", "AC2", "AC3", "AC4"]);
  assert.deepEqual(b.carried, []);
});

// ── AC4 negative control (PASS) ────────────────────────────────────────────────────────────────

test("AC4 negative control: half unchecked + carrying successor → NOT blocked", () => {
  const dir = makeTmpDir("ac4-store-");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "done-half.md"), acTask("done-half", "done", 8, 4));
  fs.writeFileSync(path.join(dir, "tasks", "succ.md"), carriesTask("succ", "done-half", "AC1, AC2, AC3, AC4"));
  const result = scanStore({ repoRoot: dir, tasksDir: path.join(dir, "tasks") });
  assert.deepEqual(result.blocked, []);
  assert.equal(result.carries.length, 1);
});

// ── AC5 partial coverage ────────────────────────────────────────────────────────────────────────

test("AC5 partial coverage: successor carries 5 of 8 → missing 3 reported", () => {
  const dir = makeTmpDir("ac5-store-");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "done-8.md"), acTask("done-8", "done", 8, 8));
  fs.writeFileSync(path.join(dir, "tasks", "succ.md"), carriesTask("succ", "done-8", "AC1, AC2, AC3, AC4, AC5"));
  const result = scanStore({ repoRoot: dir, tasksDir: path.join(dir, "tasks") });
  assert.equal(result.blocked.length, 1);
  assert.deepEqual(result.blocked[0].carried, ["AC1", "AC2", "AC3", "AC4", "AC5"]);
  assert.deepEqual(result.blocked[0].missing, ["AC6", "AC7", "AC8"]);
});

// ── Unnamed / stale-carry (info, never a block) ─────────────────────────────────────────────────

test("unnamed: unchecked boxes without AC<n> id are info, not a block", () => {
  const dir = makeTmpDir("unnamed-store-");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "done-legacy.md"), fm("done-legacy", "done",
    "## Acceptance Criteria\n\n- [ ] plain prose box one\n- [ ] plain prose box two\n"));
  const result = scanStore({ repoRoot: dir, tasksDir: path.join(dir, "tasks") });
  assert.deepEqual(result.blocked, []);
  assert.equal(result.unnamed.length, 1);
  assert.equal(result.unnamed[0].uncheckedBoxes, 2);
});

test("stale-carry: from id not in store / unknown acs reported as info", () => {
  const dir = makeTmpDir("stale-store-");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "done-a.md"), acTask("done-a", "done", 4, 2));
  fs.writeFileSync(path.join(dir, "tasks", "succ.md"), carriesTask("succ", "done-a", "AC9, AC99"));
  const result = scanStore({ repoRoot: dir, tasksDir: path.join(dir, "tasks") });
  // done-a's AC1/AC2 are unowned (AC9/AC99 don't cover them) → blocked, and the carries are stale.
  assert.equal(result.blocked.length, 1);
  assert.deepEqual(result.blocked[0].missing, ["AC1", "AC2"]);
  assert.equal(result.staleCarries.length, 1);
  assert.equal(result.staleCarries[0].reason, "acs-unknown-in-source");
});

// ── AC2: --json shape ───────────────────────────────────────────────────────────────────────────

test("AC2 CLI --json emits unowned + blocked fields", () => {
  const root = makeGitWorkspace("json", {
    "done-half.md": acTask("done-half", "done", 8, 4),
  });
  const r = runCli(root, ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(Number.isInteger(report.unowned), "unowned count field present");
  assert.equal(report.unowned, 4);
  assert.ok(Array.isArray(report.blocked), "blocked array present");
  assert.equal(report.blocked.length, 1);
  assert.deepEqual(report.blocked[0].missing, ["AC1", "AC2", "AC3", "AC4"]);
  assert.equal(report.ratchet.baselineCount, null);
});

// ── AC7: shrink-only legacy ratchet ─────────────────────────────────────────────────────────────

test("AC7 ratchet: --write-ratchet creates baseline; a NEW unowned AC then exits 1", () => {
  const root = makeGitWorkspace("ratchet", {
    "done-half.md": acTask("done-half", "done", 8, 4),
  });
  let r = runCli(root, ["--write-ratchet"]);
  assert.equal(r.status, 0, r.stderr);
  const dataPath = path.join(root, BASELINE_FILE_REL);
  assert.ok(fs.existsSync(dataPath));
  assert.match(fs.readFileSync(dataPath, "utf8"), /# baseline-count: 4/);

  // Store unchanged → exit 0 (all baselined).
  r = runCli(root);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /new since baseline: 0/);

  // A NEW done task with unchecked ACs, not in the baseline → exit 1.
  fs.writeFileSync(path.join(root, "tasks", "done-new.md"), acTask("done-new", "done", 3, 2));
  r = runCli(root);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /new since baseline: 2/);
});

test("AC7 ratchet shrink: fixing a baselined task exits 0 and reports resolved", () => {
  const root = makeGitWorkspace("shrink", {
    "done-half.md": acTask("done-half", "done", 8, 4),
  });
  let r = runCli(root, ["--write-ratchet"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(root, BASELINE_FILE_REL), "utf8"), /# baseline-count: 4/);

  // Give done-half a carrying successor → the 4 unowned ACs resolve → exit 0, resolved reported.
  fs.writeFileSync(path.join(root, "tasks", "succ.md"), carriesTask("succ", "done-half", "AC1, AC2, AC3, AC4"));
  r = runCli(root);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /resolved: 4/);
  assert.match(r.stdout, /new since baseline: 0/);
});

test("--no-block: a NEW unowned AC is REPORTED + ledgered but does NOT exit 1 (gap-task-file-static-syntax-should-not-block-product-verification, option ①)", () => {
  const root = makeGitWorkspace("noblock", {
    "done-half.md": acTask("done-half", "done", 8, 4),
  });
  let r = runCli(root, ["--write-ratchet"]);
  assert.equal(r.status, 0, r.stderr);
  // Clean store → --no-block exits 0 with zero recorded.
  r = runCli(root, ["--no-block"]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /recorded \(non-blocking\): 0/);
  // A NEW done task with unchecked ACs → DEFAULT exits 1 (ratchet growth, unchanged), --no-block exits 0.
  fs.writeFileSync(path.join(root, "tasks", "done-new.md"), acTask("done-new", "done", 3, 2));
  r = runCli(root);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /new since baseline: 2/);
  r = runCli(root, ["--no-block"]);
  assert.equal(r.status, 0, r.stdout);
  // Reported + ledgered; the runner's static-check failure marker is avoided (no "new since baseline: N").
  assert.match(r.stdout, /unowned: done-new/);
  assert.match(r.stdout, /recorded \(non-blocking\): 2/);
  assert.match(r.stdout, /recorded \(non-blocking, grow-only ledger\): 2/);
  assert.doesNotMatch(r.stdout, /new since baseline: 2/);
  // Grow-only ledger written (one line per unowned AC).
  const ledgerPath = path.join(root, ".quay", "task-file-violation-ledger.jsonl");
  assert.ok(fs.existsSync(ledgerPath), "grow-only ledger must be written");
  const lineCount = () => fs.readFileSync(ledgerPath, "utf8").trim().split(/\r?\n/).filter(Boolean).length;
  assert.equal(lineCount(), 2);
  // Grow-only: a second run does NOT re-append (只增不减, dedup by (checker, violation)).
  r = runCli(root, ["--no-block"]);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(lineCount(), 2);
});

test("writeBaseline refuses to grow past the ceiling or add new entries", () => {
  const root = makeGitWorkspace("norefuse");
  // Baseline of 1 entry, ceiling 1.
  assert.equal(writeBaseline(root, ["done-half: AC1"]).ok, true);
  // A larger set exceeds the ceiling → refused with the shrink-only reason.
  const tooBig = writeBaseline(root, ["done-half: AC1", "done-half: AC2"]);
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.reason, /only get SHORTER/);
  // Same count but a NEW entry not in the baseline → refused with the new-entry reason.
  const newEntry = writeBaseline(root, ["done-half: AC2"]);
  assert.equal(newEntry.ok, false);
  assert.match(newEntry.reason, /NEW unowned AC/);
});

test("AC7 reset: --write-ratchet --reset-baseline re-anchors the ceiling", () => {
  const root = makeGitWorkspace("resetbase", {
    "done-half.md": acTask("done-half", "done", 8, 4),
  });
  let r = runCli(root, ["--write-ratchet"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(root, BASELINE_FILE_REL), "utf8"), /# baseline-count: 4/);

  // A NEW unowned AC not in the baseline → plain --write-ratchet is refused (exit 1).
  fs.writeFileSync(path.join(root, "tasks", "done-new.md"), acTask("done-new", "done", 2, 1));
  r = runCli(root, ["--write-ratchet"]);
  assert.equal(r.status, 1, r.stdout);
  assert.doesNotMatch(fs.readFileSync(path.join(root, BASELINE_FILE_REL), "utf8"), /# baseline-count: 5/);

  // --reset-baseline performs the deliberate one-shot re-anchor.
  r = runCli(root, ["--write-ratchet", "--reset-baseline"]);
  assert.equal(r.status, 0, r.stdout);
  const after = fs.readFileSync(path.join(root, BASELINE_FILE_REL), "utf8");
  assert.match(after, /# baseline-count: 5/);
  assert.match(after, /done-new: AC1/);

  // Ratchet is shrink-only again from the new baseline: the listed set → exit 0.
  r = runCli(root);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /new since baseline: 0/);
});

// ── formatJsonReport shape (AC2) ────────────────────────────────────────────────────────────────

test("formatJsonReport: unowned is the sum of missing across blocked", () => {
  const scan = {
    scanned: 3,
    blocked: [
      { taskId: "a", unchecked: ["AC1", "AC2"], carried: [], missing: ["AC1", "AC2"] },
      { taskId: "b", unchecked: ["AC3"], carried: ["AC3"], missing: [] },
    ],
    carries: [], staleCarries: [], unnamed: [],
  };
  const json = JSON.parse(formatJsonReport(scan, { baselineCount: null, currentCount: 2, newViolations: [], resolved: [], growth: false, writeOutcome: null }, "/tmp/ws", false));
  assert.equal(json.unowned, 2);
  assert.equal(json.blocked.length, 2);
  assert.equal(json.blocked[1].missing.length, 0);
});

// ── CLI smoke: subset mode skips the ratchet (MINOR2 pattern) ──────────────────────────────────

test("subset scan (explicit file) skips the ratchet and exits 0", () => {
  const root = makeGitWorkspace("subset", {
    "done-half.md": acTask("done-half", "done", 8, 4),
  });
  let r = runCli(root, ["--write-ratchet"]);
  assert.equal(r.status, 0, r.stderr);
  r = runCli(root, ["tasks/done-half.md"]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /subset scan/);
  assert.doesNotMatch(r.stdout, /resolved:/);
});

// ── Real-store smoke (opt-in; runs the full-store scan) ──────────────────────────────────────────
const REAL_STORE_ENABLED = process.env.QUAY_TEST_REAL_STORE === "1";

test("REAL-STORE: no unowned ACs beyond the baselined legacy set", { skip: !REAL_STORE_ENABLED && "set QUAY_TEST_REAL_STORE=1 to scan the real store" }, () => {
  const r = runCli(REPO_ROOT, ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ratchet.newViolations.length, 0, `new unowned ACs: ${report.ratchet.newViolations.join(", ")}`);
});

