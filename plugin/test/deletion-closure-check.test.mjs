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

import { execFileSync } from "node:child_process";

import {
  aliasesOf,
  classifyCodeFile,
  classifyDocFile,
  deletionClosure,
  ignoreSourceOf,
  scanVisible,
} from "../scripts/deletion-closure-check.ts";
import { gitVisiblePaths, visibleDirPrefixes } from "../scripts/fs-walk.ts";

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

// ── skip 面由 gitignore 驱动 (gap-deletion-closure-walker-respects-gitignore) ─────────────────
// 本缺陷：walker 的 skip 面是手工名单，不认 .gitignore ⇒ 把 `.claude/worktrees/` 里【另一个
// worktree 的整份 repo 副本】读成"引用 X 的文件"（立案时 12010 条闭包里 11054 条落在 gitignored
// 前缀下）。下表三组测试钉住修法：机制本身、它的三取值边界 (NOT-EVALUATED 不是空集)、
// 以及"真的会排除"的对照 (同一棵树，面开/面关)。

/** `git init` 过的夹具 —— 让 `git ls-files -co --exclude-standard` 有得可答。 */
function mkgit(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcc-git-"));
  _createdDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  // 宿主的全局 excludes 不是被测对象，会引入无关不确定性 ⇒ 在本夹具里置空。/dev/null 是"读不到
  // 规则"，与"没有任何规则"对 .gitignore 的判定等价（fixture 的 .gitignore 仍然照常生效）。
  execFileSync("git", ["config", "core.excludesFile", "/dev/null"], { cwd: dir });
  for (const [rel, data] of Object.entries(contents)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
  return dir;
}

test("gitVisiblePaths — 非 git 根返回 null (NOT-EVALUATED), 不是空集", () => {
  const dir = mktmp({ "plugin/scripts/a.ts": "export const a=1;\n" }); // mktmp 不 git init
  const v = gitVisiblePaths(dir);
  assert.equal(v, null, "读不懂输入必须与'合格'不同形 (硬规则 3b)：空集会读成'这里没有东西被忽略'");
  assert.equal(scanVisible(dir), null);
  assert.equal(ignoreSourceOf(dir, null).kind, "manual-skip-only", "兜底态必须在报告里可区分");
});

test("gitVisiblePaths — tracked ∪ untracked-not-ignored, 排除 gitignored 树", () => {
  const dir = mkgit({
    ".gitignore": "ignored-tree/\n",
    "plugin/scripts/tracked.ts": "export const t=1;\n",
    "plugin/scripts/untracked.ts": "export const u=1;\n",
    "ignored-tree/copy.ts": "export const c=1;\n",
  });
  execFileSync("git", ["add", "plugin/scripts/tracked.ts"], { cwd: dir }); // 进 index ⇒ --cached 面
  const v = gitVisiblePaths(dir);
  assert.ok(v instanceof Set, "git 回答得了 ⇒ 不是 null");
  assert.ok(v.has("plugin/scripts/tracked.ts"), "--cached 面");
  assert.ok(v.has("plugin/scripts/untracked.ts"), "--others --exclude-standard 面");
  assert.equal(v.has("ignored-tree/copy.ts"), false, "gitignored 树里的文件不在集合里");
  assert.equal(v.has(".gitignore"), true, ".gitignore 自己不是被忽略的");
  assert.equal(ignoreSourceOf(dir, scanVisible(dir)).kind, "git-worktree");
});

test("visibleDirPrefixes — 每个可见路径的全部祖先目录; 根级文件不产生目录", () => {
  const dirs = visibleDirPrefixes(["a/b/c.ts", "a/d.ts", "top.md"]);
  assert.deepEqual([...dirs].sort(), ["a", "a/b"]);
});

test("deletionClosure — gitignored 树不进闭包; 同一棵树关掉这个面则进 (真排除的对照)", () => {
  // 两个 .md 都**逐字**提及构件，唯一差别是所在目录是否被 gitignore —— 所以 refs 的差只能由
  // skip 面解释，不能由"现场恰好没有引用"解释 (AC4 的三读对照在单测层的同形)。
  const MENTION = "run foo.sh to do things\n";
  const dir = mkgit({
    ".gitignore": "ignored-tree/\n",
    "visible.md": MENTION,
    "ignored-tree/ref.md": MENTION,
  });
  const withFace = deletionClosure(dir, ["foo.sh"]);
  assert.equal(withFace.dc.includes("ignored-tree/ref.md"), false, "gitignored 树不进闭包");
  assert.equal(withFace.dc.includes("visible.md"), true, "可见引用面**不许**被一起丢掉");
  assert.equal(withFace.ignoreSource.kind, "git-worktree");

  // 对照：显式传 visible=null (面关掉) —— 同一棵树、同一份内容，gitignored 引用立刻出现。
  // 没有这一读，"前缀为 0" 与 "闭包本来就是空的" 同形。
  const noFace = deletionClosure(dir, ["foo.sh"], null);
  assert.equal(noFace.dc.includes("ignored-tree/ref.md"), true, "关掉面 ⇒ 该引用确实在闭包里");
  assert.equal(noFace.ignoreSource.kind, "manual-skip-only");
  assert.equal(withFace.dc.length + 1, noFace.dc.length, "面开/面关只差被排除的那一条");
});

test("deletionClosure — gitignored 树里的【代码】引用同样排除 (不只 .md)", () => {
  const dir = mkgit({
    ".gitignore": "mirror/\n",
    "plugin/scripts/live.sh": 'bash "$DIR/foo.sh"\n', // 可见 ⇒ CallGraph 的一条
    "mirror/copy.sh": 'bash "$DIR/foo.sh"\n', // gitignored ⇒ 不得进 CallGraph
  });
  const r = deletionClosure(dir, ["foo.sh"]);
  assert.equal(r.callGraph.includes("mirror/copy.sh"), false, "gitignored 代码不进 CallGraph");
  assert.equal(r.callGraph.includes("plugin/scripts/live.sh"), true);
  assert.equal(r.counts.callGraphTotal, 1);
});

after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});
