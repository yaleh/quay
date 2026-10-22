// @test-group engine
// extension-point-criteria-check.test.mjs — the mechanical judge for DIR-133 裁定 2's
// "extension-point criteria four-piece set" (正臂 / 负臂 / 注入泄漏 / 红线基线) and its scaffold.
// (tasks/gap-extension-point-refactor-criteria-scaffold; template §13 of
//  docs/references/ownership-first-refactoring-methodology.md)
//
// WHAT IS PINNED HERE (each test maps to the task's own ACs):
//   判据 satisfied        — four arms written as AC checklist items ⇒ verdict "satisfied", exit 0.
//   判据 missing-arms     — any absent arm is named individually (`missing` / `missingLabels`).
//   判据 not-applicable   — a task with no slice semantics is NOT judged (and is not "missing").
//   判据 NOT-EVALUATED    — an absent `## Acceptance Criteria` section is a DISTINCT value, and every
//                           discriminating field differs from `satisfied` (硬规则 3b: "could not
//                           evaluate" must never share a shape with "evaluated and satisfied").
//   判据 position         — the four arms written in `## Proposal` prose do NOT count; the same four
//                           arms written as AC checklist items DO (硬规则 2: position, not keyword).
//   判据 vacuous-negative — a body carrying ONLY a negative arm, with the positive arm written as
//                           "handler 存在" (an existence check), is `missing-arms` NAMING the positive
//                           arm; rewriting it to `triggered=1` alone makes it `satisfied` (AC8).
//   判据 scaffold         — the generator prints four arm placeholders, the `triggered=1` count form,
//                           and the "single-shot AC, not a standing ratchet" note; exit 0 (AC2).
//   判据 scan             — a directory reading produces {evaluated, satisfied, missing,
//                           notApplicable} counts (the AC5 production-reading shape).
//
// Run:
//   scripts/test.sh plugin/test/extension-point-criteria-check.test.mjs
//   node --test plugin/test/extension-point-criteria-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  ARMS,
  judgeTaskBody,
  scanTasksDir,
  parseAcItems,
} from "../scripts/extension-point-criteria-check.ts";
import {
  buildScaffold,
  POSITIVE_COUNT_FORM,
  SINGLE_SHOT_NOTE,
} from "../scripts/extension-point-criteria.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "extension-point-criteria-check.ts");
const SCAFFOLD = path.join(REPO_ROOT, "plugin", "scripts", "extension-point-criteria.ts");

const createdDirs = [];
after(() => {
  for (const d of createdDirs) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(d);
  return d;
}

function writeTask(dir, name, frontmatter, body) {
  const p = path.join(dir, `${name}.md`);
  fs.writeFileSync(p, `---\n${frontmatter}\n---\n${body}`, "utf8");
  return p;
}

function run(script, args) {
  return spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", script, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
}

// The canonical four-arm AC block. Kept in ONE place so the satisfied/position/vacuous fixtures
// differ only in the dimension each test is about.
const FOUR_ARMS = [
  "- [ ] 正臂：从 handlers/registry.ts 注册后触发，读数 triggered=1。",
  "- [ ] 负臂：未注册时 triggered=0。",
  "- [ ] 注入泄漏：把分派器换成泄漏实现后同一断言必红。",
  "- [ ] 红线基线：改动前 `wc -l center.ts` 的断言为红（单次验收）。",
];

const SLICE_FM = "id: slice\ntitle: 拆分中心文件并建扩展点\nlabels: [refactor-slice]";

test("satisfied: the four arms written as AC checklist items", () => {
  const reading = judgeTaskBody(`---\n${SLICE_FM}\n---\n## Acceptance Criteria\n\n${FOUR_ARMS.join("\n")}\n`);
  assert.equal(reading.evaluated, true);
  assert.equal(reading.verdict, "satisfied");
  assert.equal(reading.applicable, true);
  assert.equal(reading.satisfied, true);
  assert.deepEqual(reading.missing, []);
  for (const a of ARMS) assert.equal(reading.arms[a], true);
});

test("missing-arms: every absent arm is named individually", () => {
  const body = `---\nid: partial\ntitle: 重构切片\nlabels: []\n---\n## Acceptance Criteria\n\n${FOUR_ARMS[1]}\n`;
  const reading = judgeTaskBody(body);
  assert.equal(reading.verdict, "missing-arms");
  assert.equal(reading.satisfied, false);
  assert.deepEqual(reading.missing, ["positive", "injectionLeak", "redLineBaseline"]);
  assert.deepEqual(reading.missingLabels, ["正臂", "注入泄漏", "红线基线"]);
  assert.equal(reading.arms.negative, true);
});

test("not-applicable: a task with no slice semantics is not judged", () => {
  const body =
    "---\nid: ui\ntitle: 修复按钮颜色\nlabels: [bug]\n---\n## Acceptance Criteria\n\n- [ ] 按钮是蓝色。\n";
  const reading = judgeTaskBody(body);
  assert.equal(reading.evaluated, true);
  assert.equal(reading.verdict, "not-applicable");
  assert.equal(reading.applicable, false);
  assert.equal(reading.satisfied, false);
  assert.deepEqual(reading.missing, []);
});

test("NOT-EVALUATED is a distinct value: EVERY discriminating field differs from satisfied", () => {
  const satisfied = judgeTaskBody(`---\n${SLICE_FM}\n---\n## Acceptance Criteria\n\n${FOUR_ARMS.join("\n")}\n`);
  const notEvaluated = judgeTaskBody(`---\n${SLICE_FM}\n---\n## Proposal\n\nno AC section here.\n`);

  assert.equal(notEvaluated.verdict, "NOT-EVALUATED");
  assert.equal(notEvaluated.reason, "ac-section-missing");
  // 硬规则 3b: one field at a time, "could not evaluate" must not look like "satisfied".
  assert.notEqual(notEvaluated.evaluated, satisfied.evaluated);
  assert.notEqual(notEvaluated.verdict, satisfied.verdict);
  assert.notEqual(notEvaluated.applicable, satisfied.applicable);
  assert.notEqual(notEvaluated.satisfied, satisfied.satisfied);
  for (const a of ARMS) assert.notEqual(notEvaluated.arms[a], satisfied.arms[a], `arm ${a} must differ`);
});

test("position, not keyword: four arms in ## Proposal prose do not count; the same text as AC items does", () => {
  const dir = tmpDir("epc-position-");
  const prose = writeTask(
    dir,
    "prose-only",
    "id: prose-only\ntitle: 重构中心文件\nlabels: []",
    `## Proposal\n\n${FOUR_ARMS.map((l) => l.replace(/^- \[ \] /, "- ")).join("\n")}\n\n## Acceptance Criteria\n\n- [ ] 中心文件拆成三块后行数下降。\n`,
  );
  const inAc = writeTask(
    dir,
    "in-ac",
    "id: in-ac\ntitle: 重构中心文件\nlabels: []",
    `## Proposal\n\n一段普通散文。\n\n## Acceptance Criteria\n\n${FOUR_ARMS.join("\n")}\n`,
  );

  const proseRun = run(CHECKER, ["--task", prose, "--json"]);
  assert.equal(proseRun.status, 1, proseRun.stderr);
  const proseJson = JSON.parse(proseRun.stdout);
  assert.equal(proseJson.verdict, "missing-arms");
  assert.deepEqual(proseJson.missing, ["positive", "negative", "injectionLeak", "redLineBaseline"]);

  const acRun = run(CHECKER, ["--task", inAc, "--json"]);
  assert.equal(acRun.status, 0, acRun.stderr);
  const acJson = JSON.parse(acRun.stdout);
  assert.equal(acJson.verdict, "satisfied");
});

test("vacuous negative: only a negative arm + 'handler 存在' positive ⇒ missing-arms naming 正臂", () => {
  const dir = tmpDir("epc-vacuous-");
  const weak = writeTask(
    dir,
    "weak",
    "id: weak\ntitle: 重构切片\nlabels: []",
    `## Acceptance Criteria\n\n- [ ] 正臂：从中心文件之外注册的 handler 存在。\n- [ ] 负臂：未注册时 triggered=0。\n- [ ] 注入泄漏：替换分派器后必红。\n- [ ] 红线基线：wc -l 基线。\n`,
  );
  const weakRun = run(CHECKER, ["--task", weak, "--json"]);
  assert.equal(weakRun.status, 1, weakRun.stderr);
  const weakJson = JSON.parse(weakRun.stdout);
  assert.equal(weakJson.verdict, "missing-arms");
  assert.deepEqual(weakJson.missing, ["positive"]);
  assert.deepEqual(weakJson.missingLabels, ["正臂"]);
  assert.equal(weakJson.weak[0].arm, "positive");
  assert.equal(weakJson.weak[0].reason, "named-but-no-count-assertion");

  // The ONLY change is the positive arm's form: existence → the required COUNT.
  const strong = writeTask(
    dir,
    "strong",
    "id: strong\ntitle: 重构切片\nlabels: []",
    `## Acceptance Criteria\n\n- [ ] 正臂：从中心文件之外注册的 handler 被触发，读数 ${POSITIVE_COUNT_FORM}。\n- [ ] 负臂：未注册时 triggered=0。\n- [ ] 注入泄漏：替换分派器后必红。\n- [ ] 红线基线：wc -l 基线。\n`,
  );
  const strongRun = run(CHECKER, ["--task", strong, "--json"]);
  assert.equal(strongRun.status, 0, strongRun.stderr);
  assert.equal(JSON.parse(strongRun.stdout).verdict, "satisfied");
});

test("scaffold: four arm placeholders + triggered=1 + the single-shot (non-ratchet) note; exit 0", () => {
  const r = run(SCAFFOLD, ["--scaffold", "--task-id", "EX-1", "--central", "src/center.ts", "--outside", "src/handlers/registry.ts"]);
  assert.equal(r.status, 0, r.stderr);
  for (const arm of ["正臂", "负臂", "注入泄漏", "红线基线"]) {
    assert.ok(r.stdout.includes(arm), `scaffold must contain the ${arm} placeholder`);
  }
  assert.ok(r.stdout.includes(POSITIVE_COUNT_FORM), "scaffold must state the counted positive form");
  assert.ok(r.stdout.includes(SINGLE_SHOT_NOTE), "scaffold must carry the single-shot/not-a-ratchet note");
  assert.ok(r.stdout.includes("非常设棘轮"), "the note must say NOT a standing ratchet");
  // The generated text is the SAME template the checker judges — round-trip it through the parser.
  assert.equal(buildScaffold({ taskId: "EX-1", central: "src/center.ts", outside: "src/handlers/registry.ts" }), r.stdout);
  const items = parseAcItems(r.stdout);
  assert.ok(items && items.length === 4, "the scaffold's AC block must parse as four checklist items");
});

test("scan: a directory reading exposes evaluated/satisfied/missing/notApplicable counts", () => {
  const dir = tmpDir("epc-scan-");
  writeTask(dir, "ok", "id: ok\ntitle: 重构切片\nlabels: []", `## Acceptance Criteria\n\n${FOUR_ARMS.join("\n")}\n`);
  writeTask(dir, "bad", "id: bad\ntitle: 重构切片\nlabels: []", `## Acceptance Criteria\n\n${FOUR_ARMS[0]}\n`);
  writeTask(dir, "na", "id: na\ntitle: 修复按钮\nlabels: []", `## Acceptance Criteria\n\n- [ ] 蓝色。\n`);
  const result = scanTasksDir(dir);
  assert.equal(result.evaluated, true);
  assert.equal(result.satisfied, 1);
  assert.equal(result.missing, 1);
  assert.equal(result.notApplicable, 1);
  assert.deepEqual(result.missingIds, ["bad"]);

  const r = run(CHECKER, ["--scan", "--tasks-dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.evaluated, true);
  assert.equal(json.satisfied, 1);
  assert.equal(json.missing, 1);
  assert.equal(json.notApplicable, 1);
  assert.deepEqual(json.missingIds, ["bad"]);
});
