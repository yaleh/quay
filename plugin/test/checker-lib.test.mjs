// @test-group engine
// checker-lib.test.mjs — gap-crystallization-five-directions ④: the extracted checker primitives.
// Covers:
//   - matchAtCommandPosition: 按位置不按关键词 — 代码位置命中 / 注释字符串豁免 (maskNonCode:true) /
//     全文结构命中 (maskNonCode:false) / 行号列号。
//   - buildNonCodeMask: 注释/字符串/正则字面量被标为非代码, 真实代码不被吞。
//   - enumerativeExistence: 枚举式存在性 — 返回 present/absent 两个清单, 缺席是事实不是布尔。
//   - 回归: drive-contract-check 与 test-framework-policy-check 都 import checker-lib (④ 改用 checker-lib)。
//
// Run:
//   scripts/test.sh plugin/test/checker-lib.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  matchAtCommandPosition,
  hasMatchAtCommandPosition,
  buildNonCodeMask,
  enumerativeExistence,
} from "../scripts/checker-lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

test("matchAtCommandPosition — code position hits; comment/string mentions are masked (maskNonCode:true)", () => {
  const src = [
    'import { test } from "node:test";',
    '// TODO: import { test } from "node:test"  (comment — must NOT hit)',
    'const s = "import { test } from node:test";  (string — must NOT hit)',
    'import { test } from "node:test";',
    "",
  ].join("\n");
  const re = /import\s*\{[^}]*\}\s*from\s*"node:test"/g;
  const hits = matchAtCommandPosition(src, re, { maskNonCode: true });
  assert.equal(hits.length, 2, `exactly the two code-position imports hit, got ${hits.length}: ${JSON.stringify(hits)}`);
  assert.equal(hits[0].line, 1);
  assert.equal(hits[1].line, 4);
});

test("matchAtCommandPosition — a regex literal spelling the pattern must NOT hit (maskNonCode:true)", () => {
  const src = 'const re = /import { test } from "node:test"/;  // regex literal\nimport { test } from "node:test";\n';
  const re = /import\s*\{[^}]*\}\s*from\s*"node:test"/g;
  const hits = matchAtCommandPosition(src, re, { maskNonCode: true });
  assert.equal(hits.length, 1, "only the real import hits; the regex literal is masked");
  assert.equal(hits[0].line, 2);
});

test("matchAtCommandPosition — maskNonCode:false matches a structural signature anywhere (drive-contract style)", () => {
  const src = "本批实现三个任务，按 A→B 顺序。\n";
  const hits = matchAtCommandPosition(src, /\b[A-Z][A-Z0-9-]*(?:\s*→\s*[A-Z][A-Z0-9-]*)+\b/g, { maskNonCode: false });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, "A→B");
  assert.equal(hits[0].line, 1);
  assert.ok(hits[0].col >= 1);
});

test("matchAtCommandPosition — lowercase lifecycle arrows are NOT structural order assertions", () => {
  const src = "晋级走 status: todo → ready；发送用 C-u → 文本。\n";
  const hits = matchAtCommandPosition(src, /\b[A-Z][A-Z0-9-]*(?:\s*→\s*[A-Z][A-Z0-9-]*)+\b/g, { maskNonCode: false });
  assert.equal(hits.length, 0, "todo/ready and C-u are not uppercase task-id chains");
});

test("hasMatchAtCommandPosition — boolean convenience matches the hit-list truth", () => {
  assert.equal(hasMatchAtCommandPosition('a\nb "X"\n', /X/g, { maskNonCode: true }), false);
  assert.equal(hasMatchAtCommandPosition("code X\n", /X/g, { maskNonCode: true }), true);
});

test("buildNonCodeMask — comments and strings are non-code, real code stays code", () => {
  const src = 'import { test } from "node:test";\n// comment\nconst x = "string /import/";\n';
  const mask = buildNonCodeMask(src);
  // find "import" at position 0 → code
  assert.equal(mask[0], 0, "import keyword is code");
  // find the comment's '//' → non-code
  const commentIdx = src.indexOf("//");
  assert.equal(mask[commentIdx], 1, "comment slash is non-code");
  // find the string literal content → non-code
  const strOpen = src.indexOf('"string');
  assert.equal(mask[strOpen], 1, "string literal is non-code");
});

test("enumerativeExistence — returns present/absent lists, absence is a fact not a verdict", () => {
  const items = ["a", "b", "c", "d"];
  const { present, absent } = enumerativeExistence(items, (x) => x !== "c");
  assert.deepEqual(present, ["a", "b", "d"]);
  assert.deepEqual(absent, ["c"]);
  // Empty result is distinguishable: absent is a LIST, not a boolean-false that could mean "check failed".
  const allPresent = enumerativeExistence(items, () => true);
  assert.deepEqual(allPresent.absent, []);
  assert.equal(allPresent.absent.length, 0);
});

test("④ refactor regression — drive-contract-check and test-framework-policy-check import checker-lib", () => {
  const dcc = fs.readFileSync(path.join(REPO_ROOT, "plugin/scripts/drive-contract-check.ts"), "utf8");
  const tfp = fs.readFileSync(path.join(REPO_ROOT, "plugin/scripts/test-framework-policy-check.ts"), "utf8");
  assert.match(dcc, /from "\.\/checker-lib\.ts"/, "drive-contract-check must import checker-lib (④)");
  assert.match(tfp, /from "\.\/checker-lib\.ts"/, "test-framework-policy-check must import checker-lib (④)");
  assert.match(dcc, /matchAtCommandPosition/, "drive-contract-check must use matchAtCommandPosition");
  assert.match(tfp, /enumerativeExistence/, "test-framework-policy-check must use enumerativeExistence");
});
