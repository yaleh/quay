// @test-group engine
// deletion-closure-check.test.mjs — P1 删除闭包检测器 (docs/proposals/archguard-generation-era-primitives.md §3 P1)。
// Covers the pure detection primitives on synthetic fixtures (never the live repo — deterministic):
//   - aliasesOf: basename / stem / spaceStem (连字符名散文形态) / relPath。
//   - classifyCodeFile: 按位置区分 code / comment — 注释引用进闭包但不进 CallGraph。
//   - classifyDocFile: .md 文档提及 = doc 位置; tasks/*.md ## Touches 段 = touches 边。
//   - deletionClosure: 闭包 = code∪comment∪doc 并集; CallGraph 只有结构调用 (import/source/spawn);
//     多构件退役取并集; 反向判据 (AC2) 共享库经单一 source 访问器 R ≈ 1。
//
// Run:
//   node --experimental-strip-types plugin/test/deletion-closure-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  aliasesOf,
  classifyCodeFile,
  classifyDocFile,
  deletionClosure,
} from "../scripts/deletion-closure-check.ts";

const _createdDirs = [];

function mktmp(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcc-test-"));
  _createdDirs.push(dir);
  for (const [rel, data] of Object.entries(contents)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
  return dir;
}

test("aliasesOf — basename/stem/spaceStem/relPath 派生", () => {
  const a = aliasesOf("plugin/scripts/session-liveness.sh");
  assert.equal(a.basename, "session-liveness.sh");
  assert.equal(a.stem, "session-liveness");
  assert.equal(a.spaceStem, "session liveness");
  assert.equal(a.relPath, "plugin/scripts/session-liveness.sh");
  const b = aliasesOf("session-liveness.sh");
  assert.equal(b.relPath, "plugin/scripts/session-liveness.sh");
});

test("classifyCodeFile — code 与 comment 位置分开, 结构调用 = CallGraph", () => {
  const a = aliasesOf("session-liveness.sh");
  // 1) 代码位置字符串字面量, 非调用 → literal
  const lit = classifyCodeFile("plugin/scripts/a.ts", `const p = "session-liveness.sh";\n`, a);
  assert.equal(lit.code, true);
  assert.equal(lit.comment, false);
  assert.equal(lit.call, false);
  assert.equal(lit.literal, true);
  // 2) 纯注释引用 → comment, 不进 code/call
  const cmt = classifyCodeFile("plugin/scripts/b.ts", `// session-liveness.sh retired\n`, a);
  assert.equal(cmt.code, false);
  assert.equal(cmt.comment, true);
  assert.equal(cmt.call, false);
  // 3) 直接 shell-out → call
  const call = classifyCodeFile("plugin/scripts/c.sh", `bash "$DIR/session-liveness.sh" --once\n`, a);
  assert.equal(call.code, true);
  assert.equal(call.call, true);
});

test("classifyCodeFile — 构造路径后 source 形 (gate-script-lib 同款) = call", () => {
  const a = aliasesOf("gate-script-lib.sh");
  const src = '_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"\nsource "$_lib"\n';
  const r = classifyCodeFile("plugin/scripts/x.sh", src, a);
  assert.equal(r.code, true, "路径字面量是代码位置");
  assert.equal(r.call, true, "source 经构造变量调用 = 结构边");
});

test("classifyCodeFile — 连字符名散文形态 (message bus) 是 comment/doc, 不是 call", () => {
  const a = aliasesOf("message-bus.ts");
  const src = `// the message bus mechanism was abolished\n`;
  const r = classifyCodeFile("plugin/scripts/a.ts", src, a);
  assert.equal(r.code, false, "space 形态不算代码位置");
  assert.equal(r.comment, true, "space 形态命中注释位置");
  assert.equal(r.call, false, "叙述性引用永不进 CallGraph");
});

test("classifyDocFile — .md 提及 = doc; tasks ## Touches = touches 边", () => {
  const a = aliasesOf("session-liveness.sh");
  const doc = classifyDocFile("orchestration/foo.md", "see session-liveness.sh for liveness\n", a);
  assert.ok(doc, "doc mention is a closure member");
  assert.equal(doc.doc, true);
  assert.equal(doc.touches, false);
  const t = classifyDocFile(
    "tasks/gap-x.md",
    "## Plan\n\n## Touches\n- plugin/scripts/session-liveness.sh\n- other.md\n",
    a,
  );
  assert.ok(t);
  assert.equal(t.touches, true, "Touches 段声明命中 touches 边");
});

test("deletionClosure — 闭包 = code∪comment∪doc, CallGraph = 结构调用, R 计算", () => {
  const dir = mktmp({
    "plugin/scripts/foo.sh": "#!/usr/bin/env bash\n",
    "plugin/scripts/a.sh": 'bash "$DIR/foo.sh"\n', // call
    "plugin/scripts/b.ts": 'const x = "foo.sh";\n', // literal
    "plugin/scripts/c.ts": "// foo.sh mentioned in a comment\n", // comment
    "orchestration/d.md": "run foo.sh to do things\n", // doc
    "plugin/scripts/other.sh": "echo unrelated\n", // absent
  });
  const r = deletionClosure(dir, ["foo.sh"]);
  assert.equal(r.counts.callGraphTotal, 1, "only a.sh is a structural call");
  assert.equal(r.counts.dcTotal, 4, "closure = call + literal + comment + doc");
  assert.equal(r.counts.code, 2, "a.sh (call) + b.ts (literal)");
  assert.equal(r.counts.comment, 1);
  assert.equal(r.counts.doc, 1);
  assert.equal(r.counts.ratio, 4, "R = |DC|/|CallGraph| = 4/1");
});

test("deletionClosure — 多构件退役取并集, 同名文件合并", () => {
  const dir = mktmp({
    "plugin/scripts/x.ts": "export const a=1;\n",
    "plugin/scripts/y.ts": "export const b=1;\n",
    "plugin/scripts/c.ts": 'import {a} from "./x.ts";\nimport {b} from "./y.ts";\n', // 同文件引用两个构件
  });
  const single = deletionClosure(dir, ["x.ts"]);
  assert.equal(single.counts.dcTotal, 1);
  const both = deletionClosure(dir, ["x.ts", "y.ts"]);
  assert.equal(both.counts.dcTotal, 1, "union 去重, c.ts 只计一次");
  assert.equal(both.counts.callGraphTotal, 1);
});

test("deletionClosure — 反向判据 (AC2): 单一 source 访问器 R≈1, 叙述引用不虚高 R", () => {
  const dir = mktmp({
    "plugin/scripts/gate-script-lib.sh": "helpExit(){ :; }\n",
    "plugin/scripts/u1.sh": '_lib="$(dirname "$0")/gate-script-lib.sh"\nsource "$_lib"\n',
    "plugin/scripts/u2.sh": '_lib="$(dirname "$0")/gate-script-lib.sh"\nsource "$_lib"\n',
    "plugin/scripts/u3.sh": '_lib="$(dirname "$0")/gate-script-lib.sh"\nsource "$_lib"\n',
    "orchestration/d.md": "the gate-script-lib.sh helpers are shared\n", // 叙述性, 不进 CallGraph
  });
  const r = deletionClosure(dir, ["gate-script-lib.sh"]);
  assert.equal(r.counts.callGraphTotal, 3, "3 个 source 调用");
  assert.equal(r.counts.dcTotal, 4, "3 call + 1 doc");
  assert.ok(r.counts.ratio <= 2, `R=${r.counts.ratio} 不得 > 2 (封装良好)`);
  assert.equal(r.callGraph.includes("orchestration/d.md"), false, "doc 提及不进 CallGraph");
});

after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});
