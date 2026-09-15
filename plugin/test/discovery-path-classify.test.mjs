// @test-group engine
// discovery-path-classify.test.mjs — tasks/gap-who-discovered-it-first-sample-is-only-five
//
// 这个分类器产出的**是一个占比结论**（human 类占多少 vs 原文的 3/5），所以它自己最要紧的
// 性质不是「能分类」，而是**「判不出」必须与「判成某一类」可区分**（硬规则 3b）。
// 本文件的前三组用例就是围着这条写的：
//
//   A 组 —— 四类输出契约（AC1）：`class ∈ {human, loop-patrol, suite-gate, other}`、
//          `method ∈ {rule, llm}`、**判不出时 `evidenceSpan` 必须是空串且 class 是 `other`**。
//   B 组 —— 位置纪律（硬规则 2）：证据窗口只取叙事段，`## Acceptance Criteria` /
//          `## Definition of Done` 里**引用**原结论的句子不得把任务判成 human。
//   C 组 —— 否定/待办上下文：「需人裁定」「无人报告」不是「人先发现」。
//   D 组 —— 确定性：同一种子给同一抽样（报告里的「种子写进文档」只有在这一条成立时才有意义）。
//   E 组 —— 真实语料（非 fixture）：对盘上真实 `tasks/gap-*.md` 跑一遍，断言
//          **AC1 的形状**与 `enumerateTasks` 的真读数 —— 关掉任何 fixture 这条仍然跑。

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLASSES,
  AGENT_RULES,
  OTHER_VERDICT,
  classifyTaskBody,
  narrativeWindow,
  stripFrontmatter,
  matchAttribution,
  classifyProvenanceLabel,
  inTodoContext,
  summarize,
  classifiedShares,
  makeRng,
  stratifiedSample,
  trendBy,
  enumerateTasks,
  monthOf,
} from "../scripts/discovery-path-classify.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 造一个最小任务体：`title` 段 + `body`。窗口取 body 里的第一个叙事段。 */
const task = (title, body) => `---\nid: ${title}\ntitle: ${title}\nstatus: ready\n---\n${body}\n`;

const REC = (taskId, cls) => ({
  taskId,
  file: `/nonexistent/${taskId}.md`,
  verdict: { ...OTHER_VERDICT, cls },
  filedAt: null,
  windowChars: 1,
  narrativeHeading: null,
});

// ── A. 四类输出契约（AC1）───────────────────────────────────────────────────────────────────
test("AC1 — 四类闭集；判不出落 other 且 evidenceSpan 为空串（不得静默并进实质类）", () => {
  assert.deepEqual([...CLASSES], ["human", "loop-patrol", "suite-gate", "other"]);
  // 硬规则 3b 的负控制：一段**没有任何主体**的叙述，必须是 other 且证据为空，
  // 不能因为「它讲了半天缺陷」就默认归进任何一个实质类。
  const v = classifyTaskBody(task("t", "## Proposal\n\n这一段里没有任何责任主体，也没有测量记号。\n"));
  assert.equal(v.cls, "other");
  assert.equal(v.evidenceSpan, "");
  assert.equal(v.tier, "none");
  assert.equal(v.rule, null);
  assert.equal(OTHER_VERDICT.cls, "other");
});

test("AC1 — method 恒为 rule（本机件不含 LLM 调用），并随每条记录报出", () => {
  const cases = [
    "## Proposal\n\n人 2026-08-10 指出这里有个缺口。\n",
    "## Proposal\n\n**来源**：manager 投立案。\n",
    "## Proposal\n\n判据干跑 ⇒ exit 1，套件报红。\n",
  ];
  for (const body of cases) {
    const v = classifyTaskBody(task("t", body));
    assert.equal(v.method, "rule", body);
    assert.ok(["human", "loop-patrol", "suite-gate", "other"].includes(v.cls));
  }
});

test("AC1 — 每条判定的 evidenceSpan 逐字取自任务体（非构造）", () => {
  const body = "## Proposal\n\n人 2026-08-10 指出这里有个缺口。\n";
  const v = classifyTaskBody(task("t", body));
  assert.equal(v.cls, "human");
  assert.ok(v.evidenceSpan.length > 0);
  assert.ok(body.includes(v.evidenceSpan), `evidenceSpan 不在正文里：${JSON.stringify(v.evidenceSpan)}`);
});

// ── B. 位置纪律（硬规则 2）─────────────────────────────────────────────────────────────────
test("AC1/硬规则2 — AC 与 DoD 段里【引用】原结论的句子不得把任务判成 human", () => {
  // 这正是原文 §2.1 ① 的句子。它出现在 AC 段里时是**引用**，不是「人先发现」的证据。
  const cited = "人的追问是唯一的样本外探测器，自主循环对自身盲区结构上不可见";
  const body = `## Proposal\n\n本任务扩展一个样本量不足的结论。\n\n## Acceptance Criteria\n\n- [ ] AC1: ${cited}\n`;
  const v = classifyTaskBody(task("t", body));
  assert.notEqual(v.cls, "human", "AC 段的引用被当成了发现路径证据");
  assert.equal(v.cls, "other");
});

test("硬规则2 — 叙事段的标题不止 Proposal：Finding / Resolution 同样被取到", () => {
  for (const h of ["Finding", "Proposal", "Resolution", "Requested action", "Setup"]) {
    const v = classifyTaskBody(task("t", `## ${h}\n\n人 2026-08-10 指出缺口。\n`));
    assert.equal(v.cls, "human", `标题 ${h} 未被识别为叙事段`);
  }
});

test("硬规则2 — 无叙事段时退回正文前 N 字符（不是不判，也不是扫全篇）", () => {
  const w = narrativeWindow(task("t", "## 别的标题\n\n人 2026-08-10 指出缺口。\n"));
  assert.equal(w.heading, null);
  assert.ok(w.text.includes("人 2026-08-10"));
});

test("stripFrontmatter — 有闭合 `---` 才剥；没有则原样返回（缺值≠已剥）", () => {
  assert.equal(stripFrontmatter("---\nid: x\n---\nbody").trim(), "body");
  assert.equal(stripFrontmatter("no frontmatter here"), "no frontmatter here");
});

// ── C. 否定/待办上下文 ──────────────────────────────────────────────────────────────────────
test("硬规则3b — 「需人裁定 / 供人裁定」不是「人先发现」", () => {
  assert.equal(inTodoContext("需", 1), true);
  assert.equal(inTodoContext("不需要", 3), true);
  assert.equal(inTodoContext("无", 1), true);
  assert.equal(inTodoContext("，", 1), false);
  const body = "## Proposal\n\n这条 AC 的退役需人裁定。\n";
  assert.notEqual(classifyTaskBody(task("t", body)).cls, "human");
});

test("硬规则3b — 「无人报告 / 没人说」不是「人先发现」", () => {
  for (const s of ["今天全部无人报告", "没人说它是替代"]) {
    assert.notEqual(classifyTaskBody(task("t", `## Proposal\n\n${s}。\n`)).cls, "human", s);
  }
});

test("主体与动作之间可穿过日期（本语料的出处写法：主体+日期+动作）", () => {
  const v = classifyTaskBody(task("t", "## Proposal\n\n管理者 2026-08-13 读实现确认了这一处。\n"));
  assert.equal(v.cls, "loop-patrol");
  assert.ok(v.evidenceSpan.includes("管理者"));
});

test("T1 出处标签：主体写在标签名的括号里也算（`**背景（manager 实测…）**：`）", () => {
  const hit = classifyProvenanceLabel("**背景（manager 实测 + outer 独立核实，2026-08-17 23:5xZ）**：AC101 目标（人裁定「绝不接受」）当前未达标");
  assert.ok(hit, "标签命中为 null");
  assert.equal(hit.cls, "loop-patrol", "把标签名括号里的 manager 漏成了标签内容里引用的人");
});

test("matchAttribution 返回最早偏移；并列取规则表次序", () => {
  const hit = matchAttribution("先有套件报红，后来人指出了根因。");
  assert.ok(hit);
  assert.equal(hit.cls, "suite-gate");
  assert.ok(AGENT_RULES.length > 0);
});

// ── D. 确定性抽样 ──────────────────────────────────────────────────────────────────────────
test("AC3 — 同一 seed 给同一序列（Math.random 不可复跑，故不用它）", () => {
  const a = makeRng(20260915);
  const b = makeRng(20260915);
  const c = makeRng(20260916);
  const sa = [a(), a(), a()];
  const sb = [b(), b(), b()];
  const sc = [c(), c(), c()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
});

test("AC3 — 分层抽样：小类也有名额，样本量恰为 n，且同 seed 可复跑", () => {
  const recs = [];
  for (let i = 0; i < 100; i++) recs.push(REC(`loop-${i}`, "loop-patrol"));
  for (let i = 0; i < 40; i++) recs.push(REC(`suite-${i}`, "suite-gate"));
  for (let i = 0; i < 10; i++) recs.push(REC(`hum-${i}`, "human"));
  const s1 = stratifiedSample(recs, 30, 4242);
  const s2 = stratifiedSample(recs, 30, 4242);
  assert.equal(s1.length, 30);
  assert.deepEqual(s1.map((r) => r.taskId), s2.map((r) => r.taskId), "同 seed 抽样不可复跑");
  assert.ok(s1.some((r) => r.verdict.cls === "human"), "human 类一条都没抽到 —— 分层失效");
  assert.ok(s1.some((r) => r.verdict.cls === "suite-gate"));
});

// ── E. 聚合读数与真实语料 ──────────────────────────────────────────────────────────────────
test("AC2 — 占比只在判得出的那部分里算；`other` 是未判，不是一类", () => {
  const c = summarize([REC("a", "human"), REC("b", "human"), REC("c", "other"), REC("d", "loop-patrol")]);
  assert.equal(c.total, 4);
  assert.equal(c.byClass.other, 1);
  assert.equal(c.otherRatio, 0.25);
  const s = classifiedShares(c);
  assert.equal(s.denominator, 3);
  assert.ok(Math.abs(s.human - 2 / 3) < 1e-9, "分母把 other 也算进去了");
});

test("AC4 — human 上界：把全部 `other` 都算成 human 时也到不了的占比", () => {
  const rows = trendBy([REC("a", "human"), REC("b", "other"), REC("c", "other"), REC("d", "loop-patrol")], () => "g");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].humanShareUpperBound, 0.75); // (1 + 2) / 4
  assert.equal(rows[0].humanShareClassified, 0.5); // 1 / 2
});

test("AC4 — 无立案时刻的任务不进任何分组（未查 ≠ 归入某一类）", () => {
  const rows = trendBy([REC("a", "human"), { ...REC("b", "human"), filedAt: "2026-08-20T00:00:00+00:00" }], (r) => (r.filedAt ? monthOf(r.filedAt) : null));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].group, "2026-08");
  assert.equal(rows[0].total, 1);
});

test("AC2 — 真实语料（非 fixture）：≥300 条真实 gap 任务，且每条输出都满足 AC1 的形状", () => {
  const files = enumerateTasks(REPO_ROOT);
  assert.ok(files.length >= 300, `真实 tasks/ 只有 ${files.length} 条 gap-* —— 读的不是真语料`);
  // 对真实语料按确定次序取前 120 条跑分类：断言的是**契约**（闭集 + method + 证据形态），
  // 不是某一类的占比 —— 占比是会随语料增长漂移的量，钉进测试只会造出一个过期的判据。
  const sample = files.slice(0, 120);
  assert.equal(sample.length, 120);
  let sawEvidence = 0;
  for (const f of sample) {
    const raw = fs.readFileSync(f.file, "utf8");
    const v = classifyTaskBody(raw);
    assert.ok(CLASSES.includes(v.cls), `${f.taskId}: 非法类 ${v.cls}`);
    assert.equal(v.method, "rule");
    if (v.cls === "other") {
      assert.equal(v.evidenceSpan, "", `${f.taskId}: other 的 evidenceSpan 必须为空串`);
    } else {
      assert.ok(v.evidenceSpan.length > 0, `${f.taskId}: 实质类必须带证据`);
      // 证据必须来自该任务体自身（窗口内），不是别处拼来的串。
      assert.ok(raw.includes(v.evidenceSpan), `${f.taskId}: evidenceSpan 不在该任务体里`);
      sawEvidence++;
    }
  }
  assert.ok(sawEvidence > 0, "120 条真实任务里一条实质类都没判出 —— 分类器对真语料恒 other");
});
