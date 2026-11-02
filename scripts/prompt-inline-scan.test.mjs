// @test-group engine
// prompt-inline-scan.test.mjs — prompt 组装点扫描器的单元/反例测试（gap-prompt-inline-data-scan AC1/AC2）。
// 覆盖分类互斥五值 + 按位置判定（注释里提到不算命中）+ 零计数的干跑正样本（改造前的
// buildProbePrompt 必须判 inline-data——否则「零命中」只是谓词失效）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripComments, classifySnippet, scanSource } from "./prompt-inline-scan.mjs";

const CLASS_VALUES = ["inline-data", "fixed-prose", "pointer", "not-a-prompt", "not-evaluated"];

test("① 插值大对象 JSON.stringify(readings) ⇒ inline-data", () => {
  const preRefactor = [
    "export function buildProbePrompt(objective, readings) {",
    "  return [",
    '    objective.trim(),',
    '    "READINGS (mechanically collected this round):",',
    "    JSON.stringify(readings),",
    '  ].join("\\n");',
    "}",
  ].join("\n");
  assert.equal(classifySnippet(preRefactor).kind, "inline-data");
});

test("② 只拼静态文本 ⇒ fixed-prose", () => {
  const staticOnly = [
    "export function buildWorkerPrompt(task, root) {",
    "  return [",
    '    `You are a per-task worker in the quay repo.`,',
    "    `Task: ${task}. Repo root: ${root}.`,",
    '    `Run the implementation chain.`,',
    '  ].join(" ");',
    "}",
  ].join("\n");
  assert.equal(classifySnippet(staticOnly).kind, "fixed-prose");
});

test("③ 落盘 + 路径指针 ⇒ pointer", () => {
  const pointer = [
    "export function buildProbePrompt(objective, readings, opts) {",
    "  const p = opts.readingsPath;",
    "  writeJsonAtomic(p, readings);",
    "  return [",
    '    `readings file: ${p}`,',
    '    `readings digest: ${digest}`',
    '  ].join("\\n");',
    "}",
  ].join("\n");
  assert.equal(classifySnippet(pointer).kind, "pointer");
});

test("④ 无法解析的输入 ⇒ not-evaluated，独立取值不与 fixed-prose 共用", () => {
  const gibberish = "const x = ; // ???";
  const r = classifySnippet(gibberish);
  assert.equal(r.kind, "not-evaluated");
  // not-evaluated 是枚举词表里的独立取值，不是「干净/fixed-prose」的别名（硬规则 3b）。
  assert.ok(CLASS_VALUES.includes(r.kind));
  assert.notEqual(r.kind, "fixed-prose");
  // 空输入也归 not-evaluated（无组装形状），不是 fixed-prose。
  assert.equal(classifySnippet("").kind, "not-evaluated");
});

test("⑤ 明确不是 prompt 的输出 ⇒ not-a-prompt", () => {
  const logLine = 'console.log(JSON.stringify({ ok: false, error: message }));';
  assert.equal(classifySnippet(logLine).kind, "not-a-prompt");
});

test("按位置判定：注释里提到 JSON.stringify(readings) 不算命中", () => {
  // 正文只是注释；剥掉注释后没有任何组装标记 ⇒ not-evaluated，而非 inline-data。
  const commentOnly = "// we used to inline JSON.stringify(readings) here";
  assert.equal(classifySnippet(commentOnly).kind, "not-evaluated");
  // stripComments 把注释替换成等长空白（行号保持），但内容不再含 JSON.stringify。
  const stripped = stripComments(commentOnly);
  assert.equal(/JSON\.stringify/.test(stripped), false);
});

test("stripComments 保留模板串里的插值标记（插值标记住在模板串里，不能按字符串剥掉）", () => {
  const src = 'const p = `readings: ${JSON.stringify(readings)}`; // 注释里的 JSON.stringify 不算';
  const s = stripComments(src);
  assert.ok(s.includes("${JSON.stringify(readings)}"));
  assert.equal(s.includes("注释里的"), false);
});

test("scanSource 枚举命名 prompt 函数 + 内联 sink 行，且按位置判类", () => {
  const src = [
    "export function poolJudgePrompt(plan, root) {",
    "  return [",
    '    `Repo root: ${root}.`,',
    "    `Mechanical input: ${JSON.stringify(plan.tasks)}.`,",
    '  ].join(" ");',
    "}",
    "async function run() {",
    "  const res = await spawn(argv, { stdinData: `payload: ${JSON.stringify(facts)}` });",
    "}",
  ].join("\n");
  const sites = scanSource("fake.ts", src);
  const byName = (n) => sites.filter((s) => s.name === n);
  assert.equal(byName("poolJudgePrompt").length, 1);
  assert.equal(byName("poolJudgePrompt")[0].kind, "inline-data");
  assert.equal(byName("poolJudgePrompt")[0].line, 1);
  // sink 行（把 JSON.stringify 直接喂给 stdin）也进入清单。
  const sinks = sites.filter((s) => s.name === null);
  assert.equal(sinks.length, 1);
  assert.equal(sinks[0].kind, "inline-data");
});

test("改造前的 buildProbePrompt 干跑必须判 inline-data（AC2 零计数配套动作的正样本）", () => {
  // 与 git 历史 268a68057^:plugin/scripts/meta-driver.ts 里 buildProbePrompt 的旧形态逐字同形。
  const historical = [
    "export function buildProbePrompt(objective: string, readings: MetaRoundReadings): string {",
    "  return [",
    "    objective.trim(),",
    "    \"\",",
    '    "READINGS (mechanically collected this round — arithmetic, not a verdict):",',
    "    JSON.stringify(readings),",
    '  ].join("\\n");',
    "}",
  ].join("\n");
  assert.equal(classifySnippet(historical).kind, "inline-data");
});

test("模板串插值数据变量名 ⇒ inline-data；标量/散文 ⇒ fixed-prose（数据名启发式边界）", () => {
  const dataVar = "const prompt = `# DIGEST\\n${evidencePack}`;";
  assert.equal(classifySnippet(dataVar).kind, "inline-data");
  const scalar = "const prompt = `Task: ${task}. Repo root: ${root}.`;";
  assert.equal(classifySnippet(scalar).kind, "fixed-prose");
});
