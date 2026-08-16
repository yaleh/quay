// @test-group governance
// touches-one-entry-one-path-check.test.mjs — the Touches「一条目一路径」shape rule
// (tasks/gap-touches-one-entry-one-path, 判据1/判据3). A Touches bullet must declare EXACTLY ONE
// path/glob entry; a bullet containing a path-separating delimiter — " / " (multi-path, e.g. AC66's
// `orchestration/A.md / orchestration/B.md / orchestration/C.md`（说明）), or "、" / "，" / "," (the
// AC76 fan-in case `plugin/scripts/slot-refill.ts、plugin/scripts/fast-mode-telemetry.ts`) — is RED
// because the ONE Touches parser (parseTouchEntriesWithTags) turns the whole line into ONE composite
// entry that (a) matches NO file on disk and (b) HIDES each real path inside it from
// checkTouchesPair's overlap judgment — AC66's 3-path bullet hid
// `orchestration/fast-mode-tick-core.md` from AC78 (判据3).
//
// This file pins:
//   * the MECHANICAL flag — flagMultiPathTouchEntries in
//     plugin/scripts/touches-one-entry-one-path-check.ts;
//   * the SCAN — scanTasksOneEntryOnePath over tasks/*.md with the shrink-only grandfather baseline
//     (docs/analysis/touches-one-entry-one-path-baseline.md), so the whole-repo CLI exits 0;
//   * 判据3 能取假 — the AC66 real 3-path bullet replays RED; after the split it replays GREEN, and
//     checkTouchesPair(AC78, AC66-split) reports the TRUE overlap on
//     orchestration/fast-mode-tick-core.md (the fake-disjoint is corrected).
//
// AC1 negative controls: a one-entry-per-line Touches is NOT flagged; a bullet whose " / " lives
// inside a （…） annotation followed by "——" text is NOT flagged (gap-serial-install's real bullet).
//
// Run: scripts/test.sh plugin/test/touches-one-entry-one-path-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { extractTouchesSection } from "../scripts/touches-parser.ts";
import { parseTouches, expandGlobs, checkTouchesPair } from "../scripts/touches-orthogonality-check.ts";
import {
  flagMultiPathTouchEntries,
  scanTasksOneEntryOnePath,
  readOneEntryBaseline,
  checkTaskOneEntryOnePath,
} from "../scripts/touches-one-entry-one-path-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "touches-one-entry-one-path-check.ts");
const TASKS_DIR = path.join(REPO_ROOT, "tasks");

// The 10 in-scope task files the task's `## Touches` authorized for splitting — all now single-path.
const INSCOPE_FILES = [
  "tasks/gap-ac37-exec-core-ships-with-package.md",
  "tasks/gap-ac41-coldstart-skill-reference-only.md",
  "tasks/gap-ac58-retired-clauses-delete-and-archive.md",
  "tasks/gap-ac59-family5-scan-covers-execution-cores.md",
  "tasks/gap-ac66-ac-driven-behavior-change-verifiable.md",
  "tasks/gap-batch-merge-authoritative-direction-hardcoded-develop.md",
  "tasks/gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible.md",
  "tasks/gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red.md",
  "tasks/gap-inner-session-check-discovery-reads-wrong-transcript.md",
  "tasks/gap-tick-driver-live-ship-drift-no-backflow.md",
];

// ── 判据1: the mechanical flag ──────────────────────────────────────────────────────────────────────

test("判据1 positive — the AC66 real 3-path bullet is flagged (RED)", () => {
  const section = [
    "- orchestration/orchestrator-tick-core.md / orchestration/manager-tick-core.md / orchestration/fast-mode-tick-core.md（C17：outer 专属，本任务只给改法建议、不编辑——建议文本见 Evidence）",
    "- plugin/scripts/ac66-a22-agent-id-check.ts (new)",
  ].join("\n");
  const flagged = flagMultiPathTouchEntries(section);
  assert.equal(flagged.length, 1, "the 3-path bullet must be the only flagged entry");
  assert.match(flagged[0].path, /fast-mode-tick-core\.md/, "flagged composite must include fast-mode-tick-core.md");
});

test("判据1 negative — a one-entry-per-line Touches is not flagged (GREEN)", () => {
  const section = [
    "- orchestration/orchestrator-tick-core.md（C17 说明）",
    "- orchestration/fast-mode-tick-core.md（C17 说明）",
    "- plugin/scripts/x.ts (new)",
  ].join("\n");
  assert.deepEqual(flagMultiPathTouchEntries(section), []);
});

test("判据1 negative control — ' / ' inside a （…） annotation is not a multi-path bullet", () => {
  // gap-serial-install's real bullet: the slashes live inside the （…） annotation, which is NOT
  // trailing (——夹具复用改造 follows), so a naive " / " test would false-positive. The checker
  // strips every parenthetical before judging.
  const section = "- plugin/test/ 真安装族 12 文件（quay-init-loop-core / loop-runtime / drift-report）——夹具复用改造";
  assert.deepEqual(flagMultiPathTouchEntries(section), []);
});

// ── 判据2 (gap-touches-multipath-delimiter-coverage-gap): the AC76 full-width-delimiter gap ───────

test("判据2 positive — the AC76 fan-in case: '、'-separated 2-path bullet is flagged (RED)", () => {
  // AC76's historical `、`-composite Touches bullets (before they were split). flagMultiPathTouchEntries
  // missed these at author time (only " / " was tested) and anti-drift was the first mechanism to catch
  // them (out-of-declared HARD-FAIL). Now the author-time checker must redden them.
  const section = [
    "- plugin/scripts/slot-refill.ts、plugin/scripts/fast-mode-telemetry.ts（AC76 判据5 退役标注）",
    "- plugin/test/red-on-omission-audit.test.mjs (new)",
  ].join("\n");
  const flagged = flagMultiPathTouchEntries(section);
  assert.equal(flagged.length, 1, "the '、'-composite bullet must be the only flagged entry");
  assert.match(flagged[0].path, /fast-mode-telemetry\.ts/, "flagged composite must include the second path");
  assert.match(flagged[0].path, /slot-refill\.ts/, "flagged composite must include the first path");
});

test("判据2 positive — '，'-separated 2-path bullet is flagged (RED)", () => {
  const section = "- plugin/scripts/a.ts，plugin/scripts/b.ts";
  const flagged = flagMultiPathTouchEntries(section);
  assert.equal(flagged.length, 1, "the '，'-composite bullet must be flagged");
  assert.match(flagged[0].path, /plugin\/scripts\/b\.ts/);
});

test("判据2 positive — ','-separated 2-path bullet is flagged (RED)", () => {
  const section = "- plugin/scripts/a.ts, plugin/scripts/b.ts";
  const flagged = flagMultiPathTouchEntries(section);
  assert.equal(flagged.length, 1, "the ','-composite bullet must be flagged");
  assert.match(flagged[0].path, /plugin\/scripts\/b\.ts/);
});

test("判据2 positive — a 3-path bullet mixing ' / ' and '、' is flagged once (RED)", () => {
  const section = "- orchestration/a.md / orchestration/b.md、orchestration/c.md";
  const flagged = flagMultiPathTouchEntries(section);
  assert.equal(flagged.length, 1, "one multi-path bullet ⇒ exactly one flag");
  assert.match(flagged[0].path, /orchestration\/c\.md/);
});

test("判据2 negative — single-path bullets are not flagged for any new delimiter (能取假)", () => {
  // A real repo path never contains 、/，/, — verified no tracked file carries them in its name. A
  // delimiter that lives inside a （…） annotation is annotation, not a path separator (stripped first).
  assert.deepEqual(flagMultiPathTouchEntries("- plugin/scripts/a.ts"), []);
  assert.deepEqual(flagMultiPathTouchEntries("- plugin/scripts/a.ts（含顿号、的说明）"), []);
  assert.deepEqual(flagMultiPathTouchEntries("- plugin/scripts/a.ts（含全角逗号，的说明）"), []);
  assert.deepEqual(flagMultiPathTouchEntries("- plugin/scripts/a.ts（含半角逗号,的说明）"), []);
});

// ── 判据1 consumer: per-body check with the grandfather baseline ───────────────────────────────────

test("判据1 consumer — a multi-path bullet in a non-grandfathered body is a violation; grandfathered is not", () => {
  const body = "---\nid: T\ntitle: t\nstatus: done\n---\n\n## Touches\n\n- a.md / b.md\n";
  const v = checkTaskOneEntryOnePath(body, "tasks/some-task.md", new Set());
  assert.equal(v.length, 1);
  assert.equal(v[0].code, "touches-multi-path-bullet");
  // Grandfathered → no violation (documented pre-rule debt).
  assert.deepEqual(checkTaskOneEntryOnePath(body, "tasks/some-task.md", new Set(["tasks/some-task.md"])), []);
});

test("判据1 consumer — a body with NO ## Touches section is NOT-EVALUATED, never a violation", () => {
  const body = "---\nid: T\ntitle: t\nstatus: done\n---\n\n## Plan\n\nnothing here\n";
  assert.deepEqual(checkTaskOneEntryOnePath(body, "tasks/no-touches.md", new Set()), []);
});

// ── 判据2 + baseline: the whole-repo scan ─────────────────────────────────────────────────────────

test("判据2 — the 10 in-scope task files carry no multi-path bullet after the split", () => {
  for (const f of INSCOPE_FILES) {
    const body = fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
    const { hasSection, section } = extractTouchesSection(body);
    assert.ok(hasSection, `${f} has ## Touches`);
    assert.deepEqual(flagMultiPathTouchEntries(section), [], `${f} must be single-path after the split`);
  }
});

test("baseline — every entry is a real task file and baseline-count matches", () => {
  const { baseline, baselineCount } = readOneEntryBaseline(REPO_ROOT);
  assert.ok(baselineCount > 0, "baseline-count is present");
  assert.equal(baseline.size, baselineCount, "baseline-count must equal the number of listed entries");
  for (const f of baseline) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, f)), `baseline entry exists: ${f}`);
  }
});

test("scan — the whole-repo scan finds EXACTLY the 2 pre-existing '、'-bullets the old ' / '-only check missed (能取假), and the CLI exits 1 naming them", () => {
  // gap-touches-multipath-delimiter-coverage-gap: expanding the delimiter set to '、'/'，'/',' means
  // two DONE (historical) task files whose Touches declare ≥2 REAL paths in ONE bullet are now caught —
  // they were invisible to the old ' / '-only test (the same gap class as the AC76 fan-in case). They
  // are NOT grandfathered and are OUT of this task's Touches scope to split, so the scan reports them
  // for a follow-up to split into one entry per line. Grandfathered files are still skipped (baseline
  // mechanism unchanged), and no prose/brace/timestamp bullet is a false positive (判据2 能取假).
  const violations = scanTasksOneEntryOnePath(TASKS_DIR, REPO_ROOT);
  const files = violations.map((v) => v.file).sort();
  assert.deepEqual(files, [
    "tasks/gap-serve-pid-derived-port-collision-family.md",
    "tasks/gap-tmp-dir-leak-unpaired-mkdtemp-cleanup.md",
  ], "exactly the 2 pre-existing '、'-multi-path bullets are flagged (nothing else)");
  assert.ok(violations.every((v) => v.code === "touches-multi-path-bullet"), "every flagged task carries the multi-path bullet code");
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", REPO_ROOT], { encoding: "utf8" });
  assert.equal(r.status, 1, `CLI must exit 1 naming the 2 violations:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /2 multi-path bullet/, "CLI reports two multi-path bullets");
});

// ── 判据3: 能取假 — AC66 real sample replay RED → GREEN; AC78∩AC66 overlap corrected ──────────────

test("判据3 — AC66 3-path bullet replays RED; split AC66 replays GREEN; AC78∩AC66 overlap on fast-mode-tick-core.md", () => {
  // (a) replay the ORIGINAL AC66 3-path bullet → RED (D2 真样本, 不构造).
  const originalBullet =
    "orchestration/orchestrator-tick-core.md / orchestration/manager-tick-core.md / orchestration/fast-mode-tick-core.md（C17：outer 专属，本任务只给改法建议、不编辑——建议文本见 Evidence）";
  assert.equal(flagMultiPathTouchEntries(`- ${originalBullet}`).length, 1, "original AC66 3-path bullet replays RED");

  // (b) the SPLIT AC66 Touches parses to distinct globs incl. orchestration/fast-mode-tick-core.md → GREEN.
  const ac66 = fs.readFileSync(path.join(REPO_ROOT, "tasks/gap-ac66-ac-driven-behavior-change-verifiable.md"), "utf8");
  const { hasSection, section } = extractTouchesSection(ac66);
  assert.ok(hasSection, "AC66 has ## Touches");
  assert.deepEqual(flagMultiPathTouchEntries(section), [], "split AC66 Touches replays GREEN");
  const p66 = parseTouches(ac66);
  assert.ok(p66.globs.includes("orchestration/fast-mode-tick-core.md"), "split AC66 declares orchestration/fast-mode-tick-core.md as its own glob");
  const expand = (globs) => expandGlobs(globs, REPO_ROOT);
  assert.ok(expand(p66.globs).has("orchestration/fast-mode-tick-core.md"), "AC66's expanded file-set includes orchestration/fast-mode-tick-core.md");

  // (c) AC78 ∩ AC66 — the machine now sees the TRUE overlap on that exact file (the fake-disjoint is
  //     corrected: before the split the composite entry matched no file, so this overlap was invisible).
  const ac78 = fs.readFileSync(path.join(REPO_ROOT, "tasks/gap-ac78-fan-in-workflow-a6-check.md"), "utf8");
  const r = checkTouchesPair(parseTouches(ac78), p66, expand);
  assert.equal(r.disjoint, false, "AC78 ∩ AC66-split must NOT be judged disjoint");
  assert.ok(r.overlaps.includes("orchestration/fast-mode-tick-core.md"), `overlap must include orchestration/fast-mode-tick-core.md (got ${JSON.stringify(r.overlaps)})`);
});

// ── CLI no-args is non-silent (the symlink-mirror invocation contract) ─────────────────────────────

test("CLI — no args prints usage and exits 2 (non-silent, the symlink-mirror contract)", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER], { encoding: "utf8" });
  assert.equal(r.status, 2, "no-args must exit 2");
  assert.match(r.stderr, /Usage: touches-one-entry-one-path-check\.ts/, "no-args prints usage");
});
