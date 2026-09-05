// @test-group engine
// registry-bare-filename-scan.test.mjs — 裸文件名引用扫描 + 死集重算测试
// (tasks/gap-dead-set-registry-bare-filename-scan, SPEC-plugin-lifecycle-single-bundle-2026-09-02 §12f).
//
// AC1 (扫描器存在 + 按位置): scanCarrier / extractBareFilenameLiterals 只在字符串字面量（非注释）位置
//   命中裸文件名；capability-catalog.sh 显式排除。AC2 (真样本干跑 + 前 3 条): 对真实仓库 quay-deliver.ts
//   的 supervisor-bus-identity.sh 必须命中，且命中内容可打印。DoD 负控制: 把裸文件名引用从清单载体里
//   删掉，脚本应重新落回死集（computeKept 的 before/after 对照）。
//
// 硬规则 2（按位置）: 注释里的 `file: "x.sh"` 不算引用（maskComments 屏蔽注释）。
//
// Run:
//   scripts/test.sh plugin/test/registry-bare-filename-scan.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  KNOWN_SAMPLE,
  KNOWN_SAMPLE_CARRIER,
  maskComments,
  extractBareFilenameLiterals,
  scanCarrier,
  scanBareFilenameRefs,
  listScriptBasenames,
  computeKept,
} from "../scripts/registry-bare-filename-scan.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

// ── 纯逻辑：按位置命中（注释不算）──────────────────────────────────────────────────────────────────────

test("extractBareFilenameLiterals hits the file: literal, ignores comments and non-matching strings", () => {
  const known = new Set(["supervisor-bus-identity.sh", "other.sh"]);
  const src = [
    '// { name: "supervisor-bus-identity", file: "supervisor-bus-identity.sh" }  // 注释内不算',
    'const x = { file: "supervisor-bus-identity.sh" };',
    'const y = "not-a-script.md";',
  ].join("\n");
  const hits = extractBareFilenameLiterals(src, known);
  assert.equal(hits.length, 1, "only the code-position literal counts, the comment one does not");
  assert.equal(hits[0].value, "supervisor-bus-identity.sh");
  assert.equal(hits[0].line, 2);
  assert.ok(hits[0].snippet.includes('file: "supervisor-bus-identity.sh"'));
});

test("maskComments masks // and /* */ and # but NOT string literals", () => {
  const src = '# c="in-bash-comment.sh"\nconst a = "keep.sh"; // c2="in-line-comment.sh"\n/* c3="in-block-comment.sh" */\n';
  const code = (() => {
    const mask = maskComments(src);
    const chars = [];
    for (let i = 0; i < src.length; i++) chars.push(mask[i] === 1 ? " " : src[i]);
    return chars.join("");
  })();
  assert.ok(code.includes('"keep.sh"'), "string literal preserved");
  assert.ok(!code.includes("in-line-comment.sh"), "// line comment masked");
  assert.ok(!code.includes("in-block-comment.sh"), "/* block comment masked");
  assert.ok(!code.includes("in-bash-comment.sh"), "# bash comment masked");
});

test("scanCarrier detects a bare filename in a code carrier and reports line + snippet", () => {
  const known = new Set(["supervisor-bus-identity.sh"]);
  const src = 'export const MEMBERS = [\n  { name: "x", file: "supervisor-bus-identity.sh" },\n];\n';
  const hits = scanCarrier("plugin/scripts/quay-deliver.ts", src, known);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].script, "supervisor-bus-identity.sh");
  assert.equal(hits[0].carrier.file, "plugin/scripts/quay-deliver.ts");
  assert.equal(hits[0].carrier.line, 2);
});

// ── AC2：真实仓库真样本命中（前 3 条实际内容）────────────────────────────────────────────────────────

test("AC2: real repo — supervisor-bus-identity.sh is bare-filename-referenced by quay-deliver.ts", () => {
  const result = scanBareFilenameRefs(repoRoot);
  const sample = result.refs.find((r) => r.script === KNOWN_SAMPLE);
  assert.ok(sample, `KNOWN_SAMPLE ${KNOWN_SAMPLE} must be found (0 hits = predicate broken, not "no such ref")`);
  const carrier = sample.carriers.find((c) => c.file === KNOWN_SAMPLE_CARRIER);
  assert.ok(carrier, `${KNOWN_SAMPLE} must be referenced by ${KNOWN_SAMPLE_CARRIER}`);
  assert.ok(carrier.snippet.includes(`file: "${KNOWN_SAMPLE}"`), "snippet carries the actual file: literal");
  // AC2 的「打印命中前 3 条」：命中的 carrier 条目可打印、非空。
  for (const c of sample.carriers.slice(0, 3)) {
    assert.ok(c.file.length > 0 && c.line >= 1 && c.snippet.length > 0);
  }
});

test("AC1: capability-catalog.sh is excluded as a carrier (population description, not usage)", () => {
  const result = scanBareFilenameRefs(repoRoot);
  // 任何脚本的命中 carrier 都不该是 capability-catalog.sh。
  for (const ref of result.refs) {
    for (const c of ref.carriers) {
      assert.ok(!c.file.endsWith("capability-catalog.sh"), `${ref.script} must not be "referenced" by the catalog`);
    }
  }
});

// ── DoD 负控制：删除裸文件名引用 ⇒ 重新落回死集 ────────────────────────────────────────────────────────

test("DoD negative control: deleting the bare-filename ref from a manifest drops the script back into the dead set", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-bare-scan-"));
  try {
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", "scripts", "foo.sh"), "#!/usr/bin/env bash\n:\n");
    const manifest = path.join(root, "manifest.json");
    fs.writeFileSync(manifest, '{\n  "scripts": ["foo.sh"]\n}\n');

    const scripts = listScriptBasenames(root);
    assert.deepEqual(scripts, ["foo.sh"]);
    const executed = new Map([["foo.sh", 0]]);

    // WITH the bare-filename ref: foo.sh is kept (not in the dead set).
    const refsWith = scanBareFilenameRefs(root).refs;
    assert.equal(refsWith.length, 1);
    assert.equal(refsWith[0].script, "foo.sh");
    const keptWith = computeKept(root, scripts, executed, refsWith, true);
    assert.ok(keptWith.has("foo.sh"), "bare-filename ref keeps the script out of the dead set");

    // DELETE the ref: foo.sh falls back into the dead set.
    fs.writeFileSync(manifest, '{\n  "scripts": []\n}\n');
    const refsWithout = scanBareFilenameRefs(root).refs;
    assert.equal(refsWithout.length, 0);
    const keptWithout = computeKept(root, scripts, executed, refsWithout, true);
    assert.ok(!keptWithout.has("foo.sh"), "with the ref removed the script returns to the dead set");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
