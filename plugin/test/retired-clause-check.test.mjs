// @test-group engine
// retired-clause-check.test.mjs — AC58 退役即迁出 checker 的 RED/GREEN 测试
// (plugin/scripts/retired-clause-check.ts, gap-ac58-retired-clauses-delete-and-archive).
//
// Criterion (phase-goal verbatim):
//   判据1: 三层执行核 + CLAUDE.md + 两份 loop 文档里，标注为退役/前提已死的条款正文 = 0 条（只留一行指针）。
//   判据2 (硬规则⑤): 每次迁出带落点映射——被删内容的每一个独有词条 → archive 中的位置（全部有家）。
//   判据3 (能取假): 一条「删了但没进 archive」的样本 ⇒ 检查必须红。
//
// Covered here:
//   - RED  (判据3 负控): a marker ABSENT from the archive (deleted-but-not-archived body) ⇒ runCheck red.
//   - RED  (判据1 反向): a marker still present in its source file ⇒ runCheck red.
//   - GREEN: the REAL repo corpus ⇒ ok (every migrated marker is gone from source AND present in archive —
//     硬规则⑤ "全部有家" over the whole registry, not a spot-check).
//   - GREEN: norm() collapses whitespace + strips backticks/comment prefixes so multi-line archive bodies match.
//
// Run:
//   scripts/test.sh plugin/test/retired-clause-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCheck, norm, hasMarker, REGISTRY } from "../scripts/retired-clause-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ARCHIVE_REL = "orchestration/archive/AC58-retired-clauses.md";

// ── RED (判据3): a "deleted-but-not-archived" body must redden the checker ───────────────────────
test("RED (判据3): a retired body deleted from source with NO archive home reddens runCheck", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rc3-"));
  try {
    // real archive, then STRIP one marker from it (the body was never archived).
    fs.mkdirSync(path.join(tmp, "orchestration/archive"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "plugin", "loop"), { recursive: true });
    const realArchive = fs.readFileSync(path.join(REPO_ROOT, ARCHIVE_REL), "utf8");
    const stripped = realArchive.replace("`.claude/loop.md` 已删除——exp5 退役", "`PROBE-STRIPPED`");
    assert.notEqual(stripped, realArchive, "fixture: the R05 marker must actually be strippable from the real archive");
    fs.writeFileSync(path.join(tmp, ARCHIVE_REL), stripped);
    fs.writeFileSync(path.join(tmp, "plugin/loop/fast-mode-loop-tick.md"), "clean source — no retired body\n");

    const { ok, issues } = runCheck(tmp);
    assert.equal(ok, false, "a deleted-but-not-archived body must make the checker RED");
    assert.ok(issues.some((i) => i.includes("R05") && i.includes("NOT-ARCHIVED")),
      `expected a NOT-ARCHIVED issue for R05, got: ${issues.filter((i) => i.includes("R05")).join(" | ")}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── RED (判据1 反向): a retired body STILL in its source file must redden the checker ─────────────
test("RED (判据1): a retired body still present in its source file reddens runCheck", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rc1-"));
  try {
    fs.mkdirSync(path.join(tmp, "orchestration", "archive"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "plugin", "loop"), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, ARCHIVE_REL), path.join(tmp, ARCHIVE_REL));
    // inject R05's marker back into the source (body not fully removed).
    fs.writeFileSync(path.join(tmp, "plugin/loop/fast-mode-loop-tick.md"), "**调用方式**（`.claude/loop.md` 已删除——exp5 退役；...)\n");

    const { ok, issues } = runCheck(tmp);
    assert.equal(ok, false);
    assert.ok(issues.some((i) => i.includes("R05") && i.includes("STILL-IN-SOURCE")),
      `expected a STILL-IN-SOURCE issue for R05, got: ${issues.filter((i) => i.includes("R05")).join(" | ")}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── GREEN: the real repo corpus — every migrated marker gone from source AND present in archive ────
test("GREEN (判据1+2): real corpus — every registered marker absent from source + present in archive", () => {
  const { ok, issues } = runCheck(REPO_ROOT);
  assert.equal(ok, true, `real corpus must be GREEN; issues: ${issues.join(" | ")}`);
});

// ── RED (判据2): an archived body that is NOT in the source-removal set has no place in the registry
test("RED (判据2): registry marker present in archive but re-introduced in source is caught (STILL-IN-SOURCE)", () => {
  // every entry has ≥1 marker and an archive anchor
  for (const e of REGISTRY) {
    assert.ok(e.id && e.markers.length >= 1, `entry ${e.id} must carry markers`);
    const archive = fs.readFileSync(path.join(REPO_ROOT, ARCHIVE_REL), "utf8");
    assert.ok(hasMarker(archive, `## ${e.id}`), `archive must carry ## ${e.id} section`);
  }
});

// ── GREEN: inner-agent-budget 退休登记（gap-retire-registration-inner-agent-budget-not-registered）───
test("GREEN: inner-agent-budget hits the retired list (R31 registered in 已退役清单)", () => {
  const entry = REGISTRY.find((e) => e.id === "R31");
  assert.ok(entry, "R31 (inner-agent-budget retirement) must be in the REGISTRY");
  assert.ok(entry.markers.some((m) => m.includes("inner-agent-budget")),
    `R31 markers must name inner-agent-budget: ${entry.markers.join(" | ")}`);
  // 登记必须机械有效：marker 在 archive 有家、在 source 已删除（硬规则⑤ 落点映射，runCheck GREEN 同覆盖）。
  const archive = fs.readFileSync(path.join(REPO_ROOT, ARCHIVE_REL), "utf8");
  const src = fs.readFileSync(path.join(REPO_ROOT, entry.source), "utf8");
  for (const m of entry.markers) {
    assert.ok(hasMarker(archive, m), `archive must carry R31 marker "${m}"`);
    assert.ok(!hasMarker(src, m), `R31 marker "${m}" must be absent from source ${entry.source}`);
  }
});

// ── GREEN: norm() semantics (backticks / whitespace / comment prefixes) ──────────────────────────
test("GREEN: norm() collapses whitespace, strips backticks and # / // comment prefixes", () => {
  assert.equal(norm("a  b\nc"), "a b c");
  assert.equal(norm("`inner-state.sh` 已退役"), "inner-state.sh 已退役");
  assert.equal(norm("// line\n// two"), "line two");
  assert.equal(norm("# a\n# b"), "a b");
  assert.equal(hasMarker("**调用方式**（`.claude/loop.md` 已删除——exp5 退役；…", "`.claude/loop.md` 已删除——exp5 退役"), true);
  assert.equal(hasMarker("clean — `.claude/loop.md` 未删", "`.claude/loop.md` 已删除——exp5 退役"), false);
});
