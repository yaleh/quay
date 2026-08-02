// @test-group engine
// task-status-drift-check.test.mjs — the closeout detector for direct (fast-mode) execution
// (tasks/gap-task-status-closeout-not-mechanized). The detector reports tasks whose AC-declared
// symbols already resolve in the codebase while status is still todo/ready — the "board lies"
// drift where landed code + stale status re-dispatches already-done work.
//
// AC1 mirror byte-identity · AC2 zero false positives on genuinely-unlanded tasks (real store)
// AC3 synthetic all-symbols-exist → suspect · AC4 synthetic no-symbols → nothing
// AC5 exits 0 always · AC6 never writes tasks/** · AC7 --json shape.
//
// Run: scripts/test.sh plugin/test/task-status-drift-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  extractSymbolCandidates,
  resolveSymbol,
  touchesAllExist,
  scanTasks,
  formatJsonReport,
  findRepoRoot,
  isDistinctiveName,
} from "../../experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Real-store scans grep the whole codebase per task (~47s for 553 tasks) — NOT something CI should
// run every time (dev-session-handoff §4). The real-store assertions (AC2, the CLI smoke tests) are
// opt-in via QUAY_TEST_REAL_STORE=1; CI runs only the fast fixture cases by default.
const REAL_STORE_ENABLED = process.env.QUAY_TEST_REAL_STORE === "1";

// A git-rooted synthetic workspace the CLI can run in (findRepoRoot walks up to `.git`), so the CLI
// exit-0 / --json tests scan a tiny fixture store, not the real 553-task store.
function makeGitWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `drift-cli-${tag}-`));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "fixture-landed.md"), LANDED_TASK);
  fs.writeFileSync(path.join(dir, "code", "landed-symbol.ts"), "export function distinctiveLandedMarker() {}\nexport function _internalLandedHelper() {}\n");
  return dir;
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `drift-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

function makeTask(id, acBody, touchesBody) {
  return `---
id: ${id}
title: fixture ${id}
status: todo
labels: [test]
---

## Acceptance Criteria

${acBody}

## Touches

${touchesBody}
`;
}

const LANDED_TASK = makeTask(
  "fixture-landed",
  "- [ ] AC1: call `distinctiveLandedMarker` in the landed implementation\n- [ ] AC2: `_internalLandedHelper` handles the boundary",
  "- code/landed-symbol.ts"
);

const UNLANDED_TASK = makeTask(
  "fixture-unlanded",
  "- [ ] AC1: call `noSuchMarkerAnywhereXYZ` in the future implementation\n- [ ] AC2: `_alsoNotPresentAnywhere` handles the boundary",
  "- code/ghost.ts"
);

// ── AC1: both mirrors byte-identical ─────────────────────────────────────────────────────────────

test("AC1: experiments and plugin mirrors are byte-identical", () => {
  const a = fs.readFileSync(path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "task-status-drift-check.ts"), "utf8");
  const b = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "task-status-drift-check.ts"), "utf8");
  assert.equal(a, b, "mirrors must be byte-identical");
});

// ── pure extraction ──────────────────────────────────────────────────────────────────────────────

test("extractSymbolCandidates: distinctive names yes, generic words / file basenames no", () => {
  const cands = extractSymbolCandidates(
    "Call `_splitCheck()` and `planCheckNextAction`, then `BuildEvidenceGate`. " +
    "Do not touch `findings`, `quay`, `test`, `loader.ts`; `task_write` is a generic API."
  );
  assert.ok(cands.includes("_splitCheck"), "call-parens stripped, underscore internal kept");
  assert.ok(cands.includes("planCheckNextAction"), "camelCase kept");
  assert.ok(cands.includes("BuildEvidenceGate"), "PascalCase kept");
  // Generic single words and file basenames are weak signals — never candidates.
  for (const noise of ["findings", "quay", "test", "loader.ts"]) {
    assert.ok(!cands.includes(noise), `generic/basename must not be a candidate: ${noise}`);
  }
  // Compound identifiers like `task_write` ARE name-distinctive; the resolve stage's frequency
  // filter (≤8 files) is what keeps over-recurring infrastructure words from resolving.
  assert.ok(cands.includes("task_write"), "task_write is a candidate by name; resolveSymbol freq-filters it");
  assert.equal(resolveSymbol("task_write", findRepoRoot(process.cwd())), false, "task_write recurs across many files → must not resolve");
});

test("isDistinctiveName: multi-part identifiers only", () => {
  assert.ok(isDistinctiveName("planCheckNextAction"));
  assert.ok(isDistinctiveName("_splitCheck"));
  assert.ok(isDistinctiveName("BuildEvidenceGate"));
  assert.ok(!isDistinctiveName("findings"));
  assert.ok(!isDistinctiveName("quay"));
  assert.ok(!isDistinctiveName("test"));
});

// ── AC3 / AC4: synthetic fixture workspaces ──────────────────────────────────────────────────────

test("AC3: fixture task whose declared symbols all exist → reports status-drift-suspect", () => {
  const ws = makeWorkspace("ac3");
  try {
    fs.writeFileSync(path.join(ws, "code", "landed-symbol.ts"), "export function distinctiveLandedMarker() {}\nexport function _internalLandedHelper() {}\n");
    fs.writeFileSync(path.join(ws, "tasks", "fixture-landed.md"), LANDED_TASK);

    const { suspects } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = suspects.find((s) => s.taskId === "fixture-landed");
    assert.ok(hit, "fixture-landed should be a status-drift-suspect");
    assert.ok(hit.matchedSymbols.includes("distinctiveLandedMarker"), "marker symbol must be reported");
    assert.equal(hit.touchesAllExist, true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC4: fixture task whose symbols do not exist → reports nothing", () => {
  const ws = makeWorkspace("ac4");
  try {
    fs.writeFileSync(path.join(ws, "code", "landed-symbol.ts"), "export function distinctiveLandedMarker() {}\n");
    fs.writeFileSync(path.join(ws, "tasks", "fixture-unlanded.md"), UNLANDED_TASK);

    const { suspects } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = suspects.find((s) => s.taskId === "fixture-unlanded");
    assert.equal(hit, undefined, "fixture-unlanded must NOT be flagged (symbols absent)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC2: real store — genuinely-unlanded tasks are not flagged, landed-but-stale are ─────────────
// OPT-IN (QUAY_TEST_REAL_STORE=1): scans 553 real tasks, grepping the codebase per task (~47s).
// The default CI run exercises the same scanTasks logic on synthetic fixtures (AC3/AC4) instead.

test("AC2: real store — batch-1 todo tasks (code not landed) are NOT flagged; landed stale tasks ARE",
  { skip: !REAL_STORE_ENABLED && "opt-in with QUAY_TEST_REAL_STORE=1 (scans the real 553-task store, ~47s)" },
  () => {
  const repoRoot = findRepoRoot(process.cwd());
  const { suspects, reverse } = scanTasks({ repoRoot });

  // These batch-1 tasks have NOT landed (their mechanisms are the batch-1 work). Flagging any would
  // be a false positive.
  for (const unlanded of [
    "DIR-124-A4",
    "DIR-124-B1",
    "DIR-124-F-plancheck",
    "gap-extract-mechanism-claims-calibration",
  ]) {
    assert.equal(
      suspects.some((s) => s.taskId === unlanded),
      false,
      `${unlanded} code is NOT landed yet — must not be flagged`
    );
  }

  // These are MEASURED drift (2026-08-02): implementing code present in the tree while status was
  // todo/ready — the detector's whole reason to exist. (DIR-099 was reconciled to `done` by batch
  // 0.3, so it is correctly no longer in the todo/ready scan set; these three remain ready because
  // their ACs demand real-dispatch evidence.)
  for (const landed of [
    "gap-planauthor-shape-rules-not-injected",
    "gap-prepare-milestone-no-worktree-isolation",
    "gap-prepare-milestone-epoch-scope-change-grants-full-review",
  ]) {
    assert.ok(
      suspects.some((s) => s.taskId === landed),
      `${landed} code is in the tree (measured drift) — must be flagged`
    );
  }

  // Reverse drift: a done task whose implementation never landed must be reported in `reverse`
  // (the mirror-image leak — e.g. the silenced RED test for no-size-aware-routing-A class).
  for (const neverLanded of ["DIR-073", "DIR-075", "DIR-087"]) {
    assert.ok(
      reverse.some((r) => r.taskId === neverLanded),
      `${neverLanded} is done but its implementation never landed — must be reverse-drift flagged`
    );
  }
});

// ── AC6: never writes to tasks/** ────────────────────────────────────────────────────────────────

test("AC6: source contains zero write calls, and a run leaves a task store byte-identical", () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "task-status-drift-check.ts"),
    "utf8"
  );
  // Zero fs-write APIs in the module ⇒ no code path can mutate tasks/** (the detector's Touches
  // walk only reads). The literal `tasks/**` string in its own doc comment is fine — what matters
  // is that no write primitive exists.
  assert.ok(!/writeFile|appendFile|createWriteStream|mkdirSync|rmSync|rm\(|unlink|copyFile|rename/.test(src), "no filesystem write calls in the detector");

  // A run must not mutate the store: snapshot and compare on a synthetic workspace (fast — the real
  // 553-task store scan is opt-in via AC2).
  const ws = makeGitWorkspace("ac6");
  try {
    const tasksDir = path.join(ws, "tasks");
    const before = {};
    for (const f of fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"))) {
      before[f] = fs.readFileSync(path.join(tasksDir, f), "utf8");
    }
    scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    for (const f of Object.keys(before)) {
      assert.equal(fs.readFileSync(path.join(tasksDir, f), "utf8"), before[f], `task ${f} must be untouched`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC5: exits 0 always ─────────────────────────────────────────────────────────────────────────

test("AC5: CLI exits 0 in all cases (report-only, never a gate)", () => {
  const cli = path.join(REPO_ROOT, "plugin", "scripts", "task-status-drift-check.ts");
  const ws = makeGitWorkspace("ac5");
  try {
    for (const args of [[], ["--json"], ["--bogus-flag"]]) {
      const r = execFileSync("node", ["--experimental-strip-types", cli, ...args], {
        cwd: ws, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      });
      assert.equal(typeof r, "string", `CLI ${args} must exit 0 (execFileSync throws on non-zero)`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC7: --json shape ───────────────────────────────────────────────────────────────────────────

test("AC7: --json mode emits { suspects: [...], reverse: [...], scanned }", () => {
  const report = formatJsonReport(
    [{ taskId: "X-1", matchedSymbols: ["planCheckNextAction"], touchesAllExist: true }],
    [{ taskId: "X-2", matchedSymbols: [], touchesAllExist: false }],
    10
  );
  const parsed = JSON.parse(report);
  assert.deepEqual(Object.keys(parsed).sort(), ["reverse", "scanned", "suspects"]);
  assert.equal(parsed.suspects.length, 1);
  assert.equal(parsed.reverse.length, 1);
  assert.deepEqual(
    Object.keys(parsed.suspects[0]).sort(),
    ["matchedSymbols", "taskId", "touchesAllExist"]
  );

  // The CLI itself emits the same shape (synthetic workspace — fast, no real store).
  const cli = path.join(REPO_ROOT, "plugin", "scripts", "task-status-drift-check.ts");
  const ws = makeGitWorkspace("ac7");
  try {
    const out = execFileSync("node", ["--experimental-strip-types", cli, "--json"], {
      cwd: ws, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const fromCli = JSON.parse(out);
    assert.deepEqual(Object.keys(fromCli).sort(), ["reverse", "scanned", "suspects"]);
    assert.ok(Array.isArray(fromCli.suspects), "suspects must be an array");
    assert.ok(Array.isArray(fromCli.reverse), "reverse must be an array");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
