// @test-group engine
// identity-replication-check.test.mjs — P2 身份复制检测器 (docs/proposals/archguard-generation-era-primitives.md §3 P2)。
// Covers the pure detection primitives on synthetic fixtures (never the live repo — deterministic):
//   - tsCommentMask / shCommentMask: 注释被标为非代码, 字符串字面量保持代码 (字面量是被测对象)。
//   - findPathConstants: *_REL 路径常量按位置命中, 注释提及不命中。
//   - findJudgmentRewrites: 读 /proc/<pid>/cmdline ∧ 比较名字 = 判定重写; 仅注释/无比较不命中。
//   - findByteIdenticalPairs: plugin/scripts ↔ experiments/*/scripts 字节相同对计数 + 行数。
//   - literalReplication: full vs code 分列 (证明脚本自己做位置区分, 不靠人工)。
//   - sharedModuleControl: 经 import 单一访问器的真共享模块不得报高复制度 (AC4 负控制)。
//
// Run:
//   node --experimental-strip-types plugin/test/identity-replication-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  tsCommentMask,
  shCommentMask,
  findPathConstants,
  findJudgmentRewrites,
  findByteIdenticalPairs,
  literalReplication,
  sharedModuleControl,
  run,
} from "../scripts/identity-replication-check.ts";

/** Temp dirs created this run — removed in the top-level `after` hook below (test-isolation R6). */
const _createdDirs = [];

/** Build a temp dir from a {relPath: content} map. Registered for cleanup in the `after` hook. */
function mktmp(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "irc-test-"));
  _createdDirs.push(dir);
  for (const [rel, data] of Object.entries(contents)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
  return dir;
}

function occurrences(src, needle) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) { out.push(i); i += needle.length; }
  return out;
}

const NEEDLE = "session-liveness.sh";

test("tsCommentMask — 注释被标非代码, 字符串字面量保持代码", () => {
  const src = `const a = "${NEEDLE}";\n// ${NEEDLE} in comment\n/* block ${NEEDLE} */\n`;
  const mask = tsCommentMask(src);
  const idx = occurrences(src, NEEDLE);
  assert.equal(idx.length, 3);
  assert.equal(mask[idx[0]], 0, "string literal is a code reference");
  assert.equal(mask[idx[1]], 1, "line comment is not code");
  assert.equal(mask[idx[2]], 1, "block comment is not code");
});

test("shCommentMask — # 注释被标非代码, 字符串字面量保持代码", () => {
  const src = `echo "${NEEDLE}"\n# ${NEEDLE}\n`;
  const mask = shCommentMask(src);
  const idx = occurrences(src, NEEDLE);
  assert.equal(idx.length, 2);
  assert.equal(mask[idx[0]], 0, "string literal is a code reference");
  assert.equal(mask[idx[1]], 1, "# comment is not code");
});

test("findPathConstants — 命中 *_REL 路径常量, 注释提及不命中", () => {
  const dir = mktmp({
    "packages/quay/src/obs.ts":
      'export const RESOURCE_GATE_REL = "../../../plugin/scripts/resource-gate.sh";\n' +
      '// const FAKE_REL = "../../../plugin/scripts/fake.sh";\n',
    "plugin/scripts/resource-gate.sh": "#!/usr/bin/env bash\n",
  });
  const files = [path.join(dir, "packages/quay/src/obs.ts")];
  const found = findPathConstants(dir, files);
  assert.equal(found.length, 1, `exactly the code-position constant, got ${JSON.stringify(found)}`);
  assert.equal(found[0].name, "RESOURCE_GATE_REL");
  assert.equal(found[0].script, "resource-gate.sh");
  assert.equal(found[0].targetExists, true);
});

test("findJudgmentRewrites — 读 /proc/<pid>/cmdline ∧ 比较名字 = 判定重写", () => {
  const dir = mktmp({
    "plugin/scripts/a.ts":
      'const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");\nif (cmd.includes("claude")) {}\n',
    "plugin/scripts/b.ts": "// reads /proc/<pid>/cmdline in a comment only — NOT a rewrite\n",
    "plugin/scripts/c.ts": "const x = fs.readFileSync(`/proc/${pid}/cmdline`, \"utf8\");\n", // 读但无名字比较
  });
  const files = [
    path.join(dir, "plugin/scripts/a.ts"),
    path.join(dir, "plugin/scripts/b.ts"),
    path.join(dir, "plugin/scripts/c.ts"),
  ];
  const found = findJudgmentRewrites(dir, files);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].file, "plugin/scripts/a.ts");
});

test("findByteIdenticalPairs — 字节相同对计数 + 行数, 漂移副本不算", () => {
  const dir = mktmp({
    "plugin/scripts/foo.ts": "export const x = 1;\n",
    "plugin/scripts/bar.ts": "export const x = 1;\n",
    "experiments/quay-perpetual-stream/scripts/foo.ts": "export const x = 1;\n",
    "experiments/quay-perpetual-stream/scripts/bar.ts": "export const x = 2;\n", // 已漂移
  });
  const { pairs, totalLines } = findByteIdenticalPairs(dir);
  assert.equal(pairs.length, 1, JSON.stringify(pairs));
  assert.equal(pairs[0].plugin, "plugin/scripts/foo.ts");
  assert.equal(totalLines, 1);
});

test("literalReplication — full vs code 分列 (脚本自己做位置区分)", () => {
  const dir = mktmp({
    "plugin/scripts/a.ts": `const p = "${NEEDLE}";\n`, // code
    "plugin/scripts/b.ts": `// ${NEEDLE}\n`, // comment
    "plugin/scripts/c.ts": "export const q = 1;\n", // absent
  });
  const files = [
    path.join(dir, "plugin/scripts/a.ts"),
    path.join(dir, "plugin/scripts/b.ts"),
    path.join(dir, "plugin/scripts/c.ts"),
  ];
  const r = literalReplication(dir, files, NEEDLE);
  assert.equal(r.full, 2, "two files carry the literal");
  assert.equal(r.code, 1, "only one carries it at a code position");
});

test("sharedModuleControl — 经 import 单一访问器的真共享模块不得报高复制度 (AC4 负控制)", () => {
  const dir = mktmp({
    "plugin/scripts/gate-script-base.ts": "export function helpExit(){}\n",
    "plugin/scripts/consumer.ts": 'import { helpExit } from "./gate-script-base.ts";\n',
    "plugin/scripts/consumer2.ts": 'import { helpExit } from "./gate-script-base.ts";\n',
  });
  const files = [
    path.join(dir, "plugin/scripts/consumer.ts"),
    path.join(dir, "plugin/scripts/consumer2.ts"),
  ];
  const c = sharedModuleControl(dir, files, "gate-script-base.ts", 2);
  assert.equal(c.importAccessor, 2, "both consumers go through the single import accessor");
  assert.equal(c.hardcoded, 0, "no hardcoded basename reference");
  assert.equal(c.flagged, false, "a single-accessor module must NOT be flagged as replicated");
});

test("run — 产出完整 report (各 section 在场)", () => {
  const dir = mktmp({
    "plugin/scripts/foo.ts": "export const x = 1;\n",
    "packages/quay/src/obs.ts": 'export const R_REL = "../../../plugin/scripts/foo.ts";\n',
  });
  const report = run(dir, 5);
  assert.equal(typeof report.root, "string");
  assert.ok(Array.isArray(report.pathConstants));
  assert.ok(Array.isArray(report.judgmentRewrites));
  assert.equal(typeof report.byteIdentical.count, "number");
  assert.ok(report.literalReplication.sessionLiveness);
  assert.ok(report.sharedModuleControl);
  assert.ok(Array.isArray(report.table));
});

after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});
