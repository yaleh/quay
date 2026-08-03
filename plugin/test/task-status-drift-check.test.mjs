// @test-group engine
// task-status-drift-check.test.mjs — the closeout detector for direct (fast-mode) execution
// (tasks/gap-task-status-closeout-not-mechanized). The detector reports tasks whose AC-declared
// symbols already resolve in the codebase while status is still todo/ready — the "board lies"
// drift where landed code + stale status re-dispatches already-done work. It ALSO reports
// reverse-drift (status done but the implementation never landed), with the code-root Touches
// partition that keeps fast-mode bookkeeping noise out (tasks/gap-reverse-drift-check-buries-true-positives-in-noise).
//
// AC1 mirror byte-identity · AC2 zero false positives on genuinely-unlanded tasks (real store)
// AC3 synthetic all-symbols-exist → suspect · AC4 synthetic no-symbols → nothing
// AC5 exits 0 always · AC6 never writes tasks/** · AC7 --json shape.
// Reverse-drift ACs: AC3 code/bookkeeping partition named · AC4 code-root .some() judgment
// AC5 threshold 1/2 pinned by 1/4 fixture · AC6 fail-closed zero/bookkeeping-only Touches.
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
  parseTouchEntries,
  isBookkeepingTouchEntry,
  isCodeTouchEntry,
  hasAnyCodeRootTouch,
  hasDoneChildren,
  REVERSE_SYMBOL_RATIO_MAX,
  BOOKKEEPING_ROOTS,
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

// status defaults to todo for the forward-drift fixtures; done tasks go to the reverse-drift path.
function makeTask(id, acBody, touchesBody, status = "todo", children = []) {
  const childrenBlock = children.length > 0
    ? `children:\n${children.map((c) => `  - ${c}`).join("\n")}\n`
    : "children: []\n";
  return `---
id: ${id}
title: fixture ${id}
status: ${status}
labels: [test]
${childrenBlock}---

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

// A done task whose AC symbols are all ghosts and whose Touches has NO code-root entry — the exact
// reverse-drift shape the detector must STILL catch after the fast-mode relaxation (AC2-intent).
const REVERSE_UNLANDED_TASK = makeTask(
  "fixture-reverse-unlanded",
  "- [ ] AC1: `revGhostOneXYZ` and `_revGhostTwo` never landed\n- [ ] AC2: `_revGhostThree` also absent",
  "- code/ghost.ts",
  "done"
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

// ── AC3 (forward) / AC4 (forward): synthetic fixture workspaces ──────────────────────────────────

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

// ── reverse-drift AC3: code-root / bookkeeping partition is a named constant + predicates ─────────

test("AC3 (reverse): code-root / bookkeeping partition is a named constant + predicates", () => {
  assert.ok(Array.isArray(BOOKKEEPING_ROOTS) && BOOKKEEPING_ROOTS.length >= 4, "BOOKKEEPING_ROOTS named constant exists");
  // Bookkeeping roots: pipeline artifacts a fast-mode task never produces.
  for (const b of ["milestones/M1/x.json", "docs/plans/M1.md", ".quay/config.yml", "receipts/x.json", "tasks/DIR-1.md"]) {
    assert.equal(isBookkeepingTouchEntry(b), true, `${b} is bookkeeping`);
    assert.equal(isCodeTouchEntry(b), false, `${b} is not code`);
  }
  // Code/implementation roots: packages, plugin code+tests, experiments code+tests, scripts,
  // orchestration/, docs/ outside docs/plans (a fast-mode doc/metric task's implementation surface).
  for (const c of [
    "packages/quay/src/x.ts", "plugin/scripts/x.ts", "plugin/test/x.test.mjs",
    "experiments/quay-perpetual-stream/scripts/x.ts", "experiments/quay-perpetual-stream/test/x.test.mjs",
    "scripts/x.sh", "orchestration/x.md", "docs/x.md", ".claude/workflows/execute-milestone.js",
  ]) {
    assert.equal(isBookkeepingTouchEntry(c), false, `${c} is not bookkeeping`);
    assert.equal(isCodeTouchEntry(c), true, `${c} is code`);
  }
});

// ── reverse-drift: parseTouchEntries annotation stripping ────────────────────────────────────────

test("parseTouchEntries strips backticks and trailing (…) annotations (both forms)", () => {
  const section = "- `code/foo.ts` (extract from)\n"
    + "- `code/bar.ts (new)`\n"
    + "- code/baz.ts (update imports)\n"
    + "- code/plain.ts\n"
    + "- `experiments/quay-perpetual-stream/scripts/*run-identity*`";
  assert.deepEqual(parseTouchEntries(section), [
    "code/foo.ts", "code/bar.ts", "code/baz.ts", "code/plain.ts",
    "experiments/quay-perpetual-stream/scripts/*run-identity*",
  ]);
  assert.deepEqual(parseTouchEntries(null), []);
  assert.deepEqual(parseTouchEntries(""), []);
});

// ── reverse-drift AC4: hasAnyCodeRootTouch (code-root .some() evidence) ─────────────────────────

test("hasAnyCodeRootTouch: any code-root entry exists → true; bookkeeping-only/missing → false", () => {
  const ws = makeWorkspace("rt");
  try {
    fs.writeFileSync(path.join(ws, "code", "landed.ts"), "// landed");
    // At least one code-root entry exists → implementation evidence present.
    assert.equal(hasAnyCodeRootTouch("- code/landed.ts\n- docs/plans/M1.md\n- milestones/M1/x.json", ws), true);
    // All code-root entries absent → no evidence (reverse-drift candidate).
    assert.equal(hasAnyCodeRootTouch("- code/ghost.ts\n- docs/plans/M1.md", ws), false);
    // Bookkeeping-only entries → fail-closed, zero code evidence (AC6).
    assert.equal(hasAnyCodeRootTouch("- docs/plans/M1.md\n- milestones/M1/x.json", ws), false);
    // Section parses to zero entries → fail-closed (AC6).
    assert.equal(hasAnyCodeRootTouch("\nJust a paragraph, no bullets.\n", ws), false);
    // No Touches section → no evidence.
    assert.equal(hasAnyCodeRootTouch(null, ws), false);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── reverse-drift AC5: threshold pinned by a 1/4-resolved fixture ────────────────────────────────

test("AC5 (reverse): 1/4-resolved unlanded done task is STILL reverse-flagged (threshold < 1/2)", () => {
  const ws = makeWorkspace("ac5");
  try {
    // Exactly ONE of four declared symbols resolves (1/4 < REVERSE_SYMBOL_RATIO_MAX = 0.5), and the
    // task's only code-root Touches entry does not exist → must still be reverse-drift. This pins
    // the threshold: the relaxation must not let a mostly-unresolved never-landed task through.
    fs.writeFileSync(path.join(ws, "code", "landed-symbol.ts"), "export function distinctiveLandedMarker() {}\n");
    const task = makeTask(
      "fixture-rev-1of4",
      "- [ ] AC1: `distinctiveLandedMarker` resolves (1/4)\n"
      + "- [ ] AC2: `revGhostOneXYZ` absent\n"
      + "- [ ] AC3: `revGhostTwoXYZ` absent\n"
      + "- [ ] AC4: `revGhostThreeXYZ` absent",
      "- code/ghost.ts",
      "done"
    );
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-1of4.md"), task);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = reverse.find((r) => r.taskId === "fixture-rev-1of4");
    assert.ok(hit, "1/4-resolved unlanded done task must be reverse-flagged");
    assert.equal(hit.matchedSymbols.length, 1, "exactly 1 of 4 symbols resolves");
    assert.equal(hit.totalSymbols, 4);
    assert.equal(hit.codeTouchExists, false);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5 (reverse): 2/4-resolved task is NOT reverse-flagged (0.5 is not < 0.5 boundary)", () => {
  const ws = makeWorkspace("ac5b");
  try {
    fs.writeFileSync(path.join(ws, "code", "landed-symbol.ts"), "export function distinctiveLandedMarker() {}\n");
    fs.writeFileSync(path.join(ws, "code", "second.ts"), "export function _revGhostTwoResolved() {}\n");
    const task = makeTask(
      "fixture-rev-2of4",
      "- [ ] AC1: `distinctiveLandedMarker` resolves (1/4)\n"
      + "- [ ] AC2: `_revGhostTwoResolved` resolves (2/4)\n"
      + "- [ ] AC3: `revGhostThreeXYZ` absent\n"
      + "- [ ] AC4: `revGhostFourXYZ` absent",
      "- code/ghost.ts",
      "done"
    );
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-2of4.md"), task);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = reverse.find((r) => r.taskId === "fixture-rev-2of4");
    assert.equal(hit, undefined, "2/4 = 0.5 is not < 0.5 → must NOT be reverse-flagged");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5: REVERSE_SYMBOL_RATIO_MAX is 0.5 and its source comment agrees (no stale 'NONE resolve')", () => {
  assert.equal(REVERSE_SYMBOL_RATIO_MAX, 0.5, "threshold pinned at 0.5");
  const src = fs.readFileSync(
    path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "task-status-drift-check.ts"),
    "utf8"
  );
  const nearConst = src.split("REVERSE_SYMBOL_RATIO_MAX =")[0];
  assert.match(nearConst, /FEWER than half/i, "comment must say 'fewer than half' (matches < 0.5 impl)");
  assert.ok(!/NONE of them resolve/i.test(src), "stale 'NONE resolve' phrasing must be gone");
});

// ── reverse-drift AC1/AC4: code-root Touches landed → NOT flagged (fast-mode relaxation) ─────────

test("AC1 (reverse): done task with landed code-root Touches + missing bookkeeping is NOT flagged", () => {
  const ws = makeWorkspace("ac1r");
  try {
    fs.writeFileSync(path.join(ws, "code", "run-identity.ts"), "export interface RunIdentity {}\n");
    // B1 shape: code-root globs all exist; bookkeeping (milestones/**, docs/plans/**, .quay/**,
    // tasks/**) is absent — fast mode never produces it. The reverse-drift judgment must ignore the
    // missing bookkeeping and see the landed code.
    const task = makeTask(
      "fixture-rev-b1",
      "- [ ] AC1: `RunIdentity` is the single identity entry point\n- [ ] AC2: `_runIdDerivation` never landed",
      "- code/run-identity.ts\n- docs/plans/M-x.md\n- milestones/M1/preparation.json\n- tasks/fixture-rev-b1.md",
      "done"
    );
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-b1.md"), task);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    assert.equal(reverse.length, 0, "landed code-root touch → must NOT be reverse-flagged (AC1)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── reverse-drift AC6: fail-closed zero / bookkeeping-only Touches ──────────────────────────────

test("AC6 (reverse): zero-entry Touches section is still fail-closed (never relaxed)", () => {
  const ws = makeWorkspace("ac6z");
  try {
    const task = makeTask(
      "fixture-rev-zero",
      "- [ ] AC1: `revGhostZeroXYZ` absent\n- [ ] AC2: `_revGhostZeroTwo` absent",
      "\nA Touches section that claims no paths proves nothing.\n",
      "done"
    );
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-zero.md"), task);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = reverse.find((r) => r.taskId === "fixture-rev-zero");
    assert.ok(hit, "zero-entry Touches → fail-closed → must be reverse-flagged (AC6)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC6 (reverse): bookkeeping-only Touches is still fail-closed (never relaxed)", () => {
  const ws = makeWorkspace("ac6b");
  try {
    // Touches lists ONLY bookkeeping paths (docs/plans + milestones + the task's own file) — zero
    // code-root entries. A leaf (no children) task like this provides no implementation evidence →
    // fail-closed reverse-drift.
    const task = makeTask(
      "fixture-rev-book",
      "- [ ] AC1: `revGhostBookXYZ` absent\n- [ ] AC2: `_revGhostBookTwo` absent",
      "- docs/plans/M-x.md\n- milestones/M1/preparation.json\n- tasks/fixture-rev-book.md",
      "done"
    );
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-book.md"), task);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    const hit = reverse.find((r) => r.taskId === "fixture-rev-book");
    assert.ok(hit, "bookkeeping-only Touches → fail-closed → must be reverse-flagged (AC6)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC6 (reverse): no ## Touches section stays un-judgeable → NOT flagged (preserved)", () => {
  const ws = makeWorkspace("ac6n");
  try {
    // A done task with NO ## Touches heading at all and unresolved symbols. The OLD detector
    // deliberately treated no-Touches as un-judgeable and skipped it; flagging pre-convention done
    // tasks is noise (measured: DIR-044, DIR-073, exp5-DEFECT-* all have landed code but no
    // Touches). Preserved — note this differs from an EMPTY Touches section (heading present, zero
    // bullets), which IS fail-closed per AC6.
    const noTouchesTask = `---
id: fixture-rev-nosection
title: fixture no-touches
status: done
labels: [test]
children: []
---

## Acceptance Criteria

- [ ] AC1: \`revGhostNoSectionXYZ\` absent
- [ ] AC2: \`_revGhostNoSectionTwo\` absent
`;
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-nosection.md"), noTouchesTask);

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    assert.equal(reverse.length, 0, "no Touches section → un-judgeable → must NOT be reverse-flagged");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC6 (reverse): done parent whose children are all done is NOT reverse-flagged", () => {
  const ws = makeWorkspace("ac6p");
  try {
    // DIR-126 shape: a parent directive whose Touches delegates to its (all-done) children. Its
    // implementation IS the children's work, so it is not "implementation never landed".
    const parent = makeTask(
      "fixture-rev-parent",
      "- [ ] AC1: `ProposalReviewGhostXYZ` absent\n- [ ] AC2: `_ProposalAuthorsGhost` absent",
      "- tasks/fixture-rev-parent.md",
      "done",
      ["fixture-rev-child"]
    );
    const child = makeTask("fixture-rev-child", "- [ ] AC1: real work", "- code/child.ts", "done");
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-parent.md"), parent);
    fs.writeFileSync(path.join(ws, "tasks", "fixture-rev-child.md"), child);
    fs.writeFileSync(path.join(ws, "code", "child.ts"), "// child landed");

    const { reverse } = scanTasks({ repoRoot: ws, roots: [path.join(ws, "code")] });
    assert.equal(reverse.length, 0, "done parent with all-done children → must NOT be reverse-flagged");
    assert.equal(hasDoneChildren(parent, path.join(ws, "tasks")), true, "hasDoneChildren recognizes the pattern");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC2: real store — genuinely-unlanded tasks are not flagged, landed-but-stale are ─────────────
// OPT-IN (QUAY_TEST_REAL_STORE=1): scans 553 real tasks, grepping the codebase per task (~47s).
// The default CI run exercises the same scanTasks logic on synthetic fixtures (AC3/AC4 + the
// reverse-drift fixtures above) instead. The exact task-id sets below are snapshots that drift as
// the store changes — the durable assertions are the fixture-based ones.

test("AC2: real store — batch-1 todo tasks (code not landed) are NOT flagged; landed stale tasks ARE",
  { skip: !REAL_STORE_ENABLED && "opt-in with QUAY_TEST_REAL_STORE=1 (scans the real 553-task store, ~47s)" },
  () => {
  const repoRoot = findRepoRoot(process.cwd());
  const { suspects, reverse } = scanTasks({ repoRoot });

  // Forward-drift (todo/ready but code in the tree) measured 2026-08-03: these must be flagged.
  for (const landed of [
    "gap-prepare-milestone-no-worktree-isolation",
    "DIR-100-B",
    "DIR-100-C",
  ]) {
    assert.ok(
      suspects.some((s) => s.taskId === landed),
      `${landed} code is in the tree (measured drift) — must be flagged`
    );
  }

  // Forward-drift: tasks whose code is NOT yet in the tree must NOT be flagged. (Several formerly
  // todo/ready members of this set have since moved to done and left the todo/ready scan set.)
  for (const unlanded of [
    "DIR-124-F-plancheck",
    "gap-extract-mechanism-claims-calibration",
  ]) {
    assert.equal(
      suspects.some((s) => s.taskId === unlanded),
      false,
      `${unlanded} code is NOT landed yet — must not be flagged`
    );
  }

  // Reverse-drift: the five suspects the 2026-08-02 tick reported are ALL false positives — their
  // code landed (DIR-124-B1 run-identity, DIR-073 diagnose-verify-failure, DIR-075 serve.ts, DIR-087
  // gate config, DIR-124-A5 baseline-metrics) or they are done parents (DIR-126). The relaxation must
  // clear exactly these; genuine reverse-drift is covered by the synthetic fixtures (AC5 1/4, AC6).
  for (const falsePositive of [
    "DIR-124-B1",
    "DIR-073",
    "DIR-075",
    "DIR-087",
    "DIR-124-A5",
    "DIR-126",
  ]) {
    assert.equal(
      reverse.some((r) => r.taskId === falsePositive),
      false,
      `${falsePositive} code landed (or is a done parent) — must NOT be reverse-flagged`
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
    [{ taskId: "X-2", matchedSymbols: [], codeTouchExists: false, touchesAllExist: false }],
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
  assert.deepEqual(
    Object.keys(parsed.reverse[0]).sort(),
    ["codeTouchExists", "matchedSymbols", "taskId", "touchesAllExist"],
    "reverse entries carry codeTouchExists (the code-root landing signal)"
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
