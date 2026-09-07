// @test-group engine
// dispatch-preference-check.test.mjs — AC54 判据1/判据2 检查器测试
// (tasks/gap-ac54-dispatch-preference-file).
//
// AC54 判据1: the dispatch-preference file is git-visible (NOT under the gitignored .quay/), AND
// carries all three sections — 默认段 (default, effective when manager absent) / 覆盖段 (override,
// current preference when manager present) / 维护者字段 (who updates). AC54 判据2 (falsifiable,
// negative control PRODUCED BY THE IMPLEMENTER, AC49 判据1 D2 attribution): deleting ANY one section
// ⇒ the checker must go RED; a checker that has never gone red on a missing-section sample doesn't
// count.
//
// This file pins:
//   (a) the pure logic (plugin/scripts/dispatch-preference-check.ts) — heading find / section
//       extraction / the three-section verdict;
//   (b) the REAL preference file is GREEN (all three sections present);
//   (c) the NEGATIVE CONTROL — three samples, each missing ONE section, each MUST exit 1 (RED).
//
// Run:
//   scripts/test.sh plugin/test/dispatch-preference-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  PREFERENCE_FILE_REL,
  REQUIRED_SECTIONS,
  SECTION_MIN_CONTENT_CHARS,
  findHeadingLine,
  extractSectionContent,
  checkPreferenceText,
} from "../scripts/dispatch-preference-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "dispatch-preference-check.ts");
const REAL_FILE = path.join(repoRoot, PREFERENCE_FILE_REL);

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("REQUIRED_SECTIONS is exactly the three AC54 sections", () => {
  assert.deepEqual(REQUIRED_SECTIONS, ["默认段", "覆盖段", "维护者字段"]);
});

test("findHeadingLine — locates an exact ## heading, case/line-sensitive", () => {
  const text = "# header\n\n## 默认段\ncontent a\n## 覆盖段\ncontent b\n";
  assert.equal(findHeadingLine(text, "默认段"), 2);
  assert.equal(findHeadingLine(text, "覆盖段"), 4);
  assert.equal(findHeadingLine(text, "维护者字段"), -1, "absent heading must be -1");
});

test("extractSectionContent — content runs to the next ## heading or EOF", () => {
  const text = "## 默认段\nline A\nline B\n## 覆盖段\nline C\n";
  const got = extractSectionContent(text, "默认段");
  assert.ok(got);
  assert.equal(got.headingLine, 0);
  assert.match(got.content, /line A\nline B/);
  assert.doesNotMatch(got.content, /line C/, "must stop at the next ## heading");
});

test("checkPreferenceText — all three sections present ⇒ ok", () => {
  const text = [
    "## 默认段",
    "manager 不在时生效：红窗优先 → gap 优先于 DIR → 其余任选。",
    "## 覆盖段",
    "manager 在时的当前倾向：本阶段 AC54–AC57 相关任务优先。",
    "## 维护者字段",
    "维护者：manager（负责更新覆盖段）。",
  ].join("\n");
  const r = checkPreferenceText(text, "sample");
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.ok(r.sections.every((s) => s.ok));
});

test("checkPreferenceText — a section whose heading is deleted ⇒ RED", () => {
  const text = [
    "## 默认段",
    "manager 不在时生效：红窗优先 → gap 优先于 DIR → 其余任选。",
    "## 维护者字段",
    "维护者：manager（负责更新覆盖段）。",
  ].join("\n"); // 覆盖段 heading+content removed
  const r = checkPreferenceText(text, "sample-no-override");
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("覆盖段"));
  const verdict = r.sections.find((s) => s.section === "覆盖段");
  assert.equal(verdict?.why, "heading-absent");
});

test("checkPreferenceText — an EMPTY section (heading kept, content deleted) ⇒ RED, not ok", () => {
  // "delete a section" must include the content-deleted case: an empty heading must not read as a
  // present section (empty-vs-absent conflation would let the negative control slip through).
  const text = [
    "## 默认段",
    "",
    "## 覆盖段",
    "manager 在时的当前倾向：本阶段 AC54–AC57 相关任务优先。",
    "## 维护者字段",
    "维护者：manager（负责更新覆盖段）。",
  ].join("\n");
  const r = checkPreferenceText(text, "sample-empty-default");
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes("默认段"));
  const verdict = r.sections.find((s) => s.section === "默认段");
  assert.equal(verdict?.why, "content-too-thin");
  assert.ok((verdict?.contentChars ?? 0) < SECTION_MIN_CONTENT_CHARS);
});

// ── real preference file ────────────────────────────────────────────────────────────────────────────

test("AC54 判据1 — the REAL git-visible preference file is GREEN (all three sections)", () => {
  assert.ok(fs.existsSync(REAL_FILE), `preference file must exist at ${PREFERENCE_FILE_REL}`);
  // git-visible: must NOT be under the gitignored .quay/ (its raison d'être is surviving
  // compaction / cross-session restart — a gitignored location would not survive).
  assert.ok(!PREFERENCE_FILE_REL.startsWith(".quay/"), "preference file must be git-visible (not under .quay/)");
  const text = fs.readFileSync(REAL_FILE, "utf8");
  const r = checkPreferenceText(text, REAL_FILE);
  assert.equal(r.ok, true, `real preference file must be three-section complete:\n${JSON.stringify(r, null, 2)}`);
});

// ── negative control (AC54 判据2, AC49 判据1 D2 attribution) ─────────────────────────────────────────

/** Line-based extraction of one section block (heading line through the next ## heading / EOF). */
function sectionBlockText(text, key) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${key}`);
  if (start === -1) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** Build a sample preference file missing ONE section (heading + content removed), in a tmp dir. */
function buildMissingSectionSample(tag, missingKey) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dp-neg-${tag}-`));
  // tmp-leak-pairing-check (gap-tmp-leak-...): every mkdtempSync MUST be paired with a cleanup.
  // after() (node:test) runs the rmSync after the current test completes.
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const text = fs.readFileSync(REAL_FILE, "utf8");
  const block = sectionBlockText(text, missingKey);
  assert.ok(block !== null, `section block for ${missingKey} must exist in the real file`);
  const sample = text.replace(block, "", 1);
  const file = path.join(dir, `${tag}.md`);
  fs.writeFileSync(file, sample, "utf8");
  // sanity: the other two sections are still present (only the target one was removed)
  for (const key of REQUIRED_SECTIONS) {
    const present = new RegExp(`^## ${key}\\n`, "m").test(sample);
    assert.equal(present, key !== missingKey, `sample ${tag}: section ${key} present=${present}`);
  }
  return file;
}

function runCheckCli(file) {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--file", file], { encoding: "utf8" });
  return r;
}

test("AC54 判据2 — negative control: delete 默认段 ⇒ RED (exit 1)", () => {
  const sample = buildMissingSectionSample("no-default", "默认段");
  const r = runCheckCli(sample);
  assert.equal(r.status, 1, `checker must exit 1 on a missing 默认段 sample:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /默认段/, "RED output must name the missing section");
});

test("AC54 判据2 — negative control: delete 覆盖段 ⇒ RED (exit 1)", () => {
  const sample = buildMissingSectionSample("no-override", "覆盖段");
  const r = runCheckCli(sample);
  assert.equal(r.status, 1, `checker must exit 1 on a missing 覆盖段 sample:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /覆盖段/, "RED output must name the missing section");
});

test("AC54 判据2 — negative control: delete 维护者字段 ⇒ RED (exit 1)", () => {
  const sample = buildMissingSectionSample("no-maintainer", "维护者字段");
  const r = runCheckCli(sample);
  assert.equal(r.status, 1, `checker must exit 1 on a missing 维护者字段 sample:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /维护者字段/, "RED output must name the missing section");
});

// ── meta-driver focus 转向通道（tasks/gap-meta-driver-no-steering-channel-focus-unreachable AC1）────
// 与 AC54 同源：orchestration/meta-driver-focus.md 也必须三段齐全（默认段 / 覆盖段 / 维护者字段），
// 由 dispatch-preference-check.ts --file 判定；删任一段 ⇒ exit 非 0（两个方向都断言）。

const FOCUS_FILE_REL = "orchestration/meta-driver-focus.md";
const FOCUS_REAL_FILE = path.join(repoRoot, FOCUS_FILE_REL);

test("meta-driver focus AC1 — the REAL file is GREEN (all three sections, --file exit 0)", () => {
  assert.ok(fs.existsSync(FOCUS_REAL_FILE), `focus file must exist at ${FOCUS_FILE_REL}`);
  assert.ok(!FOCUS_FILE_REL.startsWith(".quay/"), "focus file must be git-visible (not under .quay/)");
  const r = runCheckCli(FOCUS_REAL_FILE);
  assert.equal(r.status, 0, `dispatch-preference-check --file must exit 0 on the real focus file:\n${r.stdout}\n${r.stderr}`);
  // 双保险：纯逻辑也直接判一遍（不依赖 spawn——若 CLI 因参数/崩溃 exit 非 0 会被上面的断言抓住，
  // 但纯逻辑断言把「三段齐全」钉死在数据面上）。
  const text = fs.readFileSync(FOCUS_REAL_FILE, "utf8");
  const v = checkPreferenceText(text, FOCUS_REAL_FILE);
  assert.equal(v.ok, true, `real focus file must be three-section complete:\n${JSON.stringify(v, null, 2)}`);
});

/** 从任意源文件构造缺一段的样本（focus 文件复用 AC54 的同一判据与同一抽取逻辑）。 */
function buildMissingSectionSampleFrom(sourceFile, tag, missingKey) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dp-neg-${tag}-`));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const text = fs.readFileSync(sourceFile, "utf8");
  const block = sectionBlockText(text, missingKey);
  assert.ok(block !== null, `section block for ${missingKey} must exist in ${sourceFile}`);
  const sample = text.replace(block, "", 1);
  const file = path.join(dir, `${tag}.md`);
  fs.writeFileSync(file, sample, "utf8");
  for (const key of REQUIRED_SECTIONS) {
    const present = new RegExp(`^## ${key}\\n`, "m").test(sample);
    assert.equal(present, key !== missingKey, `sample ${tag}: section ${key} present=${present}`);
  }
  return file;
}

test("meta-driver focus AC1 负控制 — delete 覆盖段 ⇒ RED (exit 1)", () => {
  const sample = buildMissingSectionSampleFrom(FOCUS_REAL_FILE, "focus-no-override", "覆盖段");
  const r = runCheckCli(sample);
  assert.equal(r.status, 1, `checker must exit 1 on a focus file missing 覆盖段:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /覆盖段/, "RED output must name the missing section");
});

test("meta-driver focus AC1 负控制 — delete 默认段 ⇒ RED (exit 1)", () => {
  const sample = buildMissingSectionSampleFrom(FOCUS_REAL_FILE, "focus-no-default", "默认段");
  const r = runCheckCli(sample);
  assert.equal(r.status, 1, `checker must exit 1 on a focus file missing 默认段:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /默认段/, "RED output must name the missing section");
});

test("meta-driver focus AC1 负控制 — delete 维护者字段 ⇒ RED (exit 1)", () => {
  const sample = buildMissingSectionSampleFrom(FOCUS_REAL_FILE, "focus-no-maintainer", "维护者字段");
  const r = runCheckCli(sample);
  assert.equal(r.status, 1, `checker must exit 1 on a focus file missing 维护者字段:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /维护者字段/, "RED output must name the missing section");
});
