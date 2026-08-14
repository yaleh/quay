// @test-group governance
// ac61-staleness-disposition-check.test.mjs — AC61 清单逐条处置检查器测试
// (tasks/gap-ac61-staleness-list-item-disposition, AC1/AC2/AC3 + DoD 负控制).
//
// AC61 判据1: A-1…A-7 / B-1…B-4 逐条处置（迁出带落点映射 或 经核实仍有效+读数）。
// AC61 判据2: inner/outer loop 文档 integration 命中逐条打印并分类，不得只给计数。
// AC61 判据3: inner 核 C7 活指令指向退役模块 ⇒ 修。
// DoD 负控制 (AC49 判据1 D2 attribution): 某条无处置记录 ⇒ 红。
//
// This file pins:
//   (a) the pure logic (plugin/scripts/ac61-staleness-disposition-check.ts) — extractH2/extractH3,
//       checkDispositions / checkIntegrationClassification / checkC7Gone;
//   (b) the REAL task file + REAL loop docs are GREEN;
//   (c) the NEGATIVE CONTROLS — (1) a disposition record deleted ⇒ exit 1; (2) an integration
//       classification row deleted ⇒ exit 1; (3) a core still carrying the C7 live instruction ⇒ RED.
//
// Run:
//   scripts/test.sh plugin/test/ac61-staleness-disposition-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  LIST_ITEMS,
  ENFORCED_LOOP_DOCS,
  INNER_CORE_COPIES,
  C7_LIVE_MARKERS,
  norm,
  extractH2,
  extractH3,
  checkDispositions,
  parseClassificationRows,
  checkIntegrationClassification,
  checkC7Gone,
} from "../scripts/ac61-staleness-disposition-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "ac61-staleness-disposition-check.ts");
const TASK_REL = "tasks/gap-ac61-staleness-list-item-disposition.md";
const REAL_TASK = path.join(repoRoot, TASK_REL);

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("LIST_ITEMS is exactly A-1..A-7 / B-1..B-4", () => {
  assert.deepEqual(LIST_ITEMS, ["A-1", "A-2", "A-3", "A-4", "A-5", "A-6", "A-7", "B-1", "B-2", "B-3", "B-4"]);
});

test("norm strips backticks + collapses whitespace", () => {
  assert.equal(norm("`a b`  c"), "a b c");
  assert.equal(norm("  x\ny "), "x y");
});

test("extractH2 — finds a ## section by prefix (suffix allowed)", () => {
  const text = "# h\n## AC61 处置记录（A-1…A-7）\nline A\n## integration 命中逐条分类\nline B\n";
  const s = extractH2(text, "AC61 处置记录");
  assert.ok(s, "section must be found despite the （…） suffix");
  assert.match(s, /line A/);
  assert.doesNotMatch(s, /line B/);
});

test("extractH3 — finds a ### subsection within an H2 section", () => {
  const section = "### A-1 — outer\n- 处置：经核实仍有效\n- 读数：x\n### A-2 — outer\n- 处置：迁出\n";
  const a1 = extractH3(section, "A-1");
  assert.ok(a1);
  assert.match(a1, /处置：经核实仍有效/);
  assert.doesNotMatch(a1, /A-2/);
  assert.equal(extractH3(section, "A-7"), null);
});

test("checkDispositions — a record missing entirely ⇒ not ok (DoD 负控制 core)", () => {
  const text = [
    "## AC61 处置记录",
    "### A-1 — x",
    "- 处置：经核实仍有效",
    "- 核实读数：grep ⇒ 1",
    "### A-2 — x",
    "- 处置：经核实仍有效",
    "- 核实读数：grep ⇒ 1",
  ].join("\n");
  const r = checkDispositions(text);
  assert.equal(r.ok, false);
  const missing = r.verdicts.filter((v) => !v.ok).map((v) => v.id);
  assert.ok(missing.length >= 9, `only A-1/A-2 present; the other ${LIST_ITEMS.length - 2} must be missing`);
  assert.ok(missing.includes("B-1"));
});

test("checkDispositions — a 迁出 record without a landing-point ⇒ not ok", () => {
  const text = [
    "## AC61 处置记录",
    "### B-1 — x",
    "- 处置：迁出（AC58）",
    "- 核实读数：n/a",
  ].join("\n");
  const r = checkDispositions(text);
  assert.equal(r.ok, false);
  assert.ok(r.verdicts.some((v) => v.id === "B-1" && !v.ok && /landing-point/.test(v.why)));
});

test("checkDispositions — a 经核实仍有效 record without a 读数 ⇒ not ok", () => {
  const text = [
    "## AC61 处置记录",
    "### B-3 — x",
    "- 处置：经核实仍有效",
    "- 落点：archive#R99",
  ].join("\n");
  const r = checkDispositions(text);
  assert.equal(r.ok, false);
  assert.ok(r.verdicts.some((v) => v.id === "B-3" && !v.ok && /读数/.test(v.why)));
});

test("checkC7Gone — a core still carrying the C7 live instruction ⇒ not ok", () => {
  const clean = fs.readFileSync(path.join(repoRoot, INNER_CORE_COPIES[0]), "utf8");
  assert.ok(!C7_LIVE_MARKERS.some((m) => clean.includes(m)), "the real instance core must be C7-clean");
  const poisoned = { [INNER_CORE_COPIES[0]]: "| C7 | `integration-branch-model.ts --overlaps-unverified` **不得传空串**——空串使该判定恒假、机制半死 |" };
  // Use a temp root so checkC7Gone reads our poisoned core text.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac61-c7-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(dir, "plugin", "loop"), { recursive: true });
  fs.writeFileSync(path.join(dir, INNER_CORE_COPIES[0]), poisoned[INNER_CORE_COPIES[0]], "utf8");
  fs.writeFileSync(path.join(dir, INNER_CORE_COPIES[1]), "", "utf8");
  const r = checkC7Gone(dir);
  assert.equal(r.ok, false);
  assert.equal(r.verdicts[0].hits.length, C7_LIVE_MARKERS.length, "both C7 live markers must be flagged");
});

// ── real files ──────────────────────────────────────────────────────────────────────────────────────

test("AC61 判据1/2/3 — the REAL task file + REAL loop docs are GREEN (CLI exit 0)", () => {
  assert.ok(fs.existsSync(REAL_TASK), `task file must exist at ${TASK_REL}`);
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", repoRoot], { encoding: "utf8" });
  assert.equal(r.status, 0, `real repo must be GREEN:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /11 list items dispositioned/);
});

// ── negative controls (DoD / AC61 判据2 / AC61 判据3) ───────────────────────────────────────────────

function runCheckCli(root, taskFileOverride) {
  const args = ["--no-warnings", "--experimental-strip-types", CLI, "--root", root];
  if (taskFileOverride) args.push("--task-file", taskFileOverride);
  return spawnSync("node", args, { encoding: "utf8" });
}

test("AC61 DoD 负控制 — deleting one disposition record ⇒ RED (exit 1)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac61-neg-rec-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const text = fs.readFileSync(REAL_TASK, "utf8");
  // Delete the `### B-2` record (heading through the next `### `).
  const m = text.match(/^### B-2 .*\n(?:.*?\n)*?(?=^### B-3 )/m);
  assert.ok(m, "the B-2 record must exist in the real task file");
  const sample = text.replace(m[0], "");
  const file = path.join(dir, "no-b2.md");
  fs.writeFileSync(file, sample, "utf8");
  assert.ok(!/^### B-2 /m.test(sample), "sample must have no B-2 record");
  const r = runCheckCli(repoRoot, file);
  assert.equal(r.status, 1, `checker must exit 1 on a missing B-2 disposition record:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /B-2/, "RED output must name the missing record");
});

test("AC61 判据2 负控制 — deleting one integration classification row ⇒ RED (exit 1)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac61-neg-cls-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const text = fs.readFileSync(REAL_TASK, "utf8");
  // Remove the FIRST data row (a `| … | … | … |` line, skipping the `|---|---|---|` separator) under
  // the inner-template subsection. Line-based so anchors containing `|` are handled.
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("### inner-template："));
  assert.ok(start !== -1, "the inner-template classification subsection must exist");
  let rowIdx = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("### ")) break;
    // A DATA row (skip the column header row and the |---|---| separator).
    if (/^\| .+\| .+\| .+\|$/.test(lines[i]) && !/^\| *---/.test(lines[i]) && !lines[i].includes("命中行")) { rowIdx = i; break; }
  }
  assert.ok(rowIdx !== -1, "the inner-template table must have a data row");
  lines.splice(rowIdx, 1);
  const sample = lines.join("\n");
  const file = path.join(dir, "one-less-row.md");
  fs.writeFileSync(file, sample, "utf8");
  const r = runCheckCli(repoRoot, file);
  assert.equal(r.status, 1, `checker must exit 1 when an integration classification row is removed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /row count|no classification row|uncovered/, "RED output must flag the classification gap");
});

test("AC61 判据3 — parseClassificationRows finds a row per enforced-loop hit in the real task", () => {
  const rows = parseClassificationRows(fs.readFileSync(REAL_TASK, "utf8"));
  for (const rel of ENFORCED_LOOP_DOCS) {
    const abs = path.join(repoRoot, rel);
    const hits = fs.readFileSync(abs, "utf8").split(/\r?\n/).filter((l) => l.includes("integration"));
    const anchors = rows.get(rel) ?? [];
    assert.equal(anchors.length, hits.length, `${rel}: one classification row per integration hit`);
  }
});
