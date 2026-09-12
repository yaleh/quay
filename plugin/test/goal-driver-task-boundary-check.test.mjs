// @test-group engine
// goal-driver-task-boundary-check.test.mjs — goal/task 职责边界防回归的双向负控制测试
// (plugin/scripts/goal-driver-task-boundary-check.ts, DIR-131 / gap-goal-driver-task-boundary-check).
//
// Criterion (tasks/gap-goal-driver-task-boundary-check.md, AC1/AC2):
//   检查按位置判定：对当前 goal-driver.ts exit 0；注释形（// task_write 不许调用）仍 exit 0。
//   负控制能取假：插入真实写调用 fs.writeFileSync(path.join(root,"tasks","x.md"),"") ⇒ RED 且点行号。
//
// Covered here — 双向负控制（能取假，硬规则 3b/4）:
//   - 注释形 ⇒ 0 违规（头注释 / 块注释里的动词不算调用面）
//   - 字符串形 ⇒ 0 违规（字符串字面量里的动词 / 写函数名不算调用面）
//   - 真实动词调用 ⇒ 违规 kind=task-verb + 点名 token + 行号
//   - 真实写调用指向 tasks/ ⇒ 违规 kind=task-write + 点名行号（AC2 逐字例）
//   - 写调用指向非 tasks/ ⇒ 0 违规（目标特异性）
//   - 目标探针豁免区（人 2026-09-12 DIR-131 AC6 口径补充裁定）：标记内+字符串内 ⇒ 豁免；
//     同一份文本里标记外仍红；标记不配对 ⇒ fail-closed（不豁免任何位置）
//   - 行号精确性 + 目标文件缺失 ⇒ NOT-EVALUATED（读不到 ≠ 无违规，硬规则 3b）
//
// Run:
//   scripts/test.sh plugin/test/goal-driver-task-boundary-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkGoalDriverBoundary,
  runCheck,
  maskCommentsAndStrings,
} from "../scripts/goal-driver-task-boundary-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ── 注释形负控制：注释里的动词 / 写调用不算（硬规则 2）─────────────────────────────────────────
test("注释形负控制：注释里的 task_write / lifecycle_* / fs.write-to-tasks 不算违规", () => {
  const src = [
    "// task_write 不许调用（DIR-131 正文里逐字出现这个词）",
    "// lifecycle_promote / lifecycle_retreat / lifecycle_complete 都是 task 机制动词",
    "// fs.writeFileSync(path.join(root, \"tasks\", \"x.md\"), \"\"); // 注释里的调用不是调用",
    "/* block: task_write lifecycle_promote fs.writeFileSync tasks/ */",
  ].join("\n");
  assert.deepEqual(checkGoalDriverBoundary(src), [], "a comment mentioning the verbs must be masked (not a call surface)");
});

// ── 字符串形负控制：字符串字面量里的动词 / 写函数名不算（硬规则 2）────────────────────────────
test("字符串形负控制：字符串里的 task_write / fs.writeFileSync 不算违规", () => {
  const src = [
    'const s = "task_write";',
    'const t = `lifecycle_promote`;',
    'const u = "fs.writeFileSync";',
    "const v = 'lifecycle_complete';",
  ].join("\n");
  assert.deepEqual(checkGoalDriverBoundary(src), [], "a string literal mentioning the verbs must be masked (not a call surface)");
});

// ── 动词负控制：真实 task_write 调用 ⇒ RED 且点名 token + 行号 ─────────────────────────────────
test("动词负控制：真实 task_write 调用 ⇒ kind=task-verb 且点行号", () => {
  const src = [
    "export function f() {",
    "  task_write({ id: \"x\", status: \"ready\" });",
    "}",
  ].join("\n");
  const v = checkGoalDriverBoundary(src);
  assert.equal(v.length, 1, `expected 1 violation, got: ${JSON.stringify(v)}`);
  assert.equal(v[0].kind, "task-verb");
  assert.equal(v[0].token, "task_write");
  assert.equal(v[0].line, 2, "must name the line of the real call");
});

// ── lifecycle 动词负控制：lifecycle_promote 也越界 ──────────────────────────────────────────────
test("lifecycle 动词负控制：lifecycle_promote / retreat / complete 都越界", () => {
  for (const verb of ["lifecycle_promote", "lifecycle_retreat", "lifecycle_complete"]) {
    const v = checkGoalDriverBoundary(`${verb}("x");\n`);
    assert.equal(v.length, 1, `${verb} must be flagged`);
    assert.equal(v[0].token, verb);
  }
});

// ── 写调用负控制（AC2 逐字例）：fs.writeFileSync 指向 tasks/ ⇒ RED 且点行号 ───────────────────
test("写调用负控制：fs.writeFileSync 指向 tasks/ ⇒ kind=task-write 且点行号", () => {
  const src = [
    'import path from "node:path";',
    'import fs from "node:fs";',
    "",
    "fs.writeFileSync(path.join(root, \"tasks\", \"x.md\"), \"\");",
  ].join("\n");
  const v = checkGoalDriverBoundary(src);
  assert.equal(v.length, 1, `expected 1 violation, got: ${JSON.stringify(v)}`);
  assert.equal(v[0].kind, "task-write");
  assert.equal(v[0].token, "fs.writeFileSync");
  assert.equal(v[0].line, 4, "must name the line of the real write call");
});

// ── 写调用目标特异性：写非 tasks/ 文件不算违规 ─────────────────────────────────────────────────
test("写调用目标特异性：写 .quay 下文件（非 tasks/）不算违规", () => {
  const src = [
    'import path from "node:path";',
    'import fs from "node:fs";',
    "fs.writeFileSync(path.join(root, \".quay\", \"goal-round.jsonl\"), \"[]\");",
  ].join("\n");
  assert.deepEqual(checkGoalDriverBoundary(src), [], "a write to .quay (not tasks/) is the goal driver's own carrier, not a task write");
});

// ── 写函数名在字符串内部：不算调用 ────────────────────────────────────────────────────────────
test("写函数名在字符串内部：不算调用（位置判定，硬规则 2）", () => {
  const src = 'const hint = "use fs.writeFileSync(path.join(root, \'tasks\', \'x.md\'), \'\')";\n';
  assert.deepEqual(checkGoalDriverBoundary(src), [], "a write-family name inside a string is prose, not a call");
});

// ── fan-in 载体（DIR-131 AC6 归因反例机械化）：goal 侧不以 task 落地指标为输入 ────────────────
test("fan-in 载体注释形负控制：注释里的 fan-in / full-suite-state / 落地率 不算违规", () => {
  const src = [
    "// fan-in 落地率是 task 机制指标，不是 goal 机制缺陷（DIR-131 Finding 反例）",
    "// full-suite-state.json 也不许读",
    "/* block: fan-in full-suite-state 落地率 */",
  ].join("\n");
  assert.deepEqual(checkGoalDriverBoundary(src), [], "a comment mentioning the fan-in carriers must be masked");
});

test("fan-in 载体负控制：读 .quay/fan-in-* 载体 ⇒ kind=fanin-read 且点行号", () => {
  const src = [
    'import fs from "node:fs";',
    "",
    'fs.readFileSync(".quay/fan-in-step-trace.jsonl", "utf8");',
  ].join("\n");
  const v = checkGoalDriverBoundary(src);
  assert.equal(v.length, 1, `expected 1 violation, got: ${JSON.stringify(v)}`);
  assert.equal(v[0].kind, "fanin-read");
  assert.equal(v[0].token, "fan-in");
  assert.equal(v[0].line, 3, "must name the line of the fan-in carrier read");
});

test("full-suite-state 载体负控制：读 full-suite-state.json ⇒ kind=fanin-read", () => {
  const src = 'const s = "full-suite-state.json";\n';
  const v = checkGoalDriverBoundary(src);
  assert.equal(v.length, 1, `expected 1 violation, got: ${JSON.stringify(v)}`);
  assert.equal(v[0].kind, "fanin-read");
  assert.equal(v[0].token, "full-suite-state");
});

test("落地率 载体负控制：字符串里的 落地率 ⇒ kind=fanin-read", () => {
  const src = 'const metric = "落地率";\n';
  const v = checkGoalDriverBoundary(src);
  assert.equal(v.length, 1, `expected 1 violation, got: ${JSON.stringify(v)}`);
  assert.equal(v[0].kind, "fanin-read");
  assert.equal(v[0].token, "落地率");
});

// ── 目标探针豁免区（人 2026-09-12 DIR-131 AC6 口径补充裁定，三选一之①）双向负控制 ─────────────────
// 「读外部被驱动系统」≠「读本仓自身落地率」：标记内 + 字符串内 ⇒ 豁免；标记外（同一份文本里）
// 仍然是 DIR-131 原裁定要挡的形态 ⇒ 不豁免（负控制两态同文件对照，逐字贴出）。

test("目标探针豁免·标记外仍红：同一份源码里，标记外的 fan-in 字面量不受豁免影响", () => {
  const src = [
    'const outside = ".quay/fan-in-step-trace.jsonl";', // 标记外——本仓自身载体，仍应判红
    "// DIR-131-TARGET-PROBE-BEGIN",
    'const inside = "fan-in-step-trace.jsonl";', // 标记内 + 字符串内——豁免
    "// DIR-131-TARGET-PROBE-END",
  ].join("\n");
  const v = checkGoalDriverBoundary(src);
  assert.equal(v.length, 1, `expected exactly 1 violation (the outside one), got: ${JSON.stringify(v)}`);
  assert.equal(v[0].kind, "fanin-read");
  assert.equal(v[0].line, 1, "只有标记外那一行应被判红");
});

test("目标探针豁免·标记配对且在字符串内 ⇒ 豁免（0 违规）", () => {
  const src = [
    "// DIR-131-TARGET-PROBE-BEGIN",
    'const c = ".quay/fan-in-step-trace.jsonl";',
    "// DIR-131-TARGET-PROBE-END",
  ].join("\n");
  assert.deepEqual(checkGoalDriverBoundary(src), [], "标记精确配对 + 字面量在字符串内部 ⇒ 应豁免为 0 违规");
});

test("目标探针豁免·标记不配对 ⇒ fail-closed（仍判红，不豁免任何位置）", () => {
  const missingEnd = ["// DIR-131-TARGET-PROBE-BEGIN", 'const c = ".quay/fan-in-step-trace.jsonl";'].join("\n");
  const v1 = checkGoalDriverBoundary(missingEnd);
  assert.equal(v1.length, 1, `缺 END 标记时不得豁免，got: ${JSON.stringify(v1)}`);

  const twoBegins = [
    "// DIR-131-TARGET-PROBE-BEGIN",
    "// DIR-131-TARGET-PROBE-BEGIN",
    'const c = ".quay/fan-in-step-trace.jsonl";',
    "// DIR-131-TARGET-PROBE-END",
  ].join("\n");
  const v2 = checkGoalDriverBoundary(twoBegins);
  assert.equal(v2.length, 1, `标记数目不对（2 BEGIN/1 END）时不得豁免，got: ${JSON.stringify(v2)}`);
});

test("真实仓库正面例：goal-driver.ts 的 fan-in-failing 信号已落地且门仍绿（PASS，非仅『无违规』）", () => {
  const target = path.join(REPO_ROOT, "plugin", "scripts", "goal-driver.ts");
  const res = runCheck(target);
  assert.equal(res.notEvaluated, false);
  assert.equal(res.ok, true, `expected PASS, got violations: ${JSON.stringify(res.violations)}`);
  // 反向对照：goal-driver.ts 确实读了目标项目自己的 fan-in-step-trace.jsonl（不是零覆盖的豁免）。
  const src = fs.readFileSync(target, "utf8");
  assert.match(src, /fan-in-step-trace\.jsonl/, "goal-driver.ts 应仍然引用该载体（豁免不是删掉这条读数）");
});

// ── 行号精确性：违规在源码第 N 行 ⇒ line === N ─────────────────────────────────────────────────
test("行号精确性：违规行号与源码一致", () => {
  const src = [
    "line1",
    "line2",
    "  lifecycle_complete(\"x\");",
    "line4",
  ].join("\n");
  const v = checkGoalDriverBoundary(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 3, "the violation is on the 3rd line");
});

// ── 真实仓库 smoke：当前 goal-driver.ts 无违规（AC1 正向控制）─────────────────────────────────
test("真实仓库 smoke：当前 goal-driver.ts 无 task 写路径调用点", () => {
  const target = path.join(REPO_ROOT, "plugin", "scripts", "goal-driver.ts");
  const src = fs.readFileSync(target, "utf8");
  assert.deepEqual(
    checkGoalDriverBoundary(src),
    [],
    "the current goal-driver.ts must be clean (this is the DIR-131 boundary being guarded)",
  );
});

// ── NOT-EVALUATED：目标文件缺失 ⇒ notEvaluated=true（读不到 ≠ 无违规，硬规则 3b）─────────────
test("NOT-EVALUATED：目标文件缺失 ⇒ notEvaluated=true", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gdtb-"));
  try {
    const r = runCheck(path.join(tmp, "plugin", "scripts", "goal-driver.ts"));
    assert.equal(r.notEvaluated, true, "missing target must be NOT-EVALUATED, not a vacuous pass");
    assert.deepEqual(r.violations, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 掩码语义：maskCommentsAndStrings 区分 code/comment/string ─────────────────────────────────
test("掩码语义：maskCommentsAndStrings 区分 code / comment / string", () => {
  const src = 'task_write(); // comment\nconst s = "task_write";\n';
  const { comment, str } = maskCommentsAndStrings(src);
  // 第一个 task_write（代码位置）不在 comment 也不在 str
  assert.equal(comment[0], 0);
  assert.equal(str[0], 0);
  // 注释里的 task_write 在 comment
  const commentIdx = src.indexOf("comment");
  assert.equal(comment[commentIdx], 1);
  // 字符串里的 task_write 在 str
  const strIdx = src.lastIndexOf("task_write");
  assert.equal(str[strIdx], 1);
  assert.equal(comment[strIdx], 0);
});
