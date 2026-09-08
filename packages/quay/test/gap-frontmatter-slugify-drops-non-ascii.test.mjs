// @test-group product
// gap-frontmatter-slugify-drops-non-ascii — slugify must preserve CJK titles (be
// Unicode-letter-aware) instead of collapsing a mostly-Chinese title to its stray ASCII
// fragments. AC1–AC4 of the task, exercised through the REAL store write path (the four
// `createXStore(...).write(...)` call sites — not a mocked store).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { slugify } from "../src/frontmatter-store-base.ts";
import { createAdrStore } from "../src/adr-store.ts";
import { createMetaStore } from "../src/meta-store.ts";
import { createGoalStore } from "../src/goal-store.ts";
import { createDocumentStore } from "../src/document-store.ts";

// The exact exemplar title from the task body (40 chars, 22 CJK chars). The pre-fix
// slugify collapses it to "store-kind" (ratio 10/40 = 0.25).
const TITLE = "五种 store kind 的提交面统一 —— 一个原语、四态返回、传播跟读者走";

// Path separators / genuinely path-unsafe ASCII (the file-name blacklist the task names).
const PATH_UNSAFE_RE = /[\/\\:*?"<>|]/;

// C0 control chars (0x00–0x1F) + DEL (0x7F).
function hasControlChar(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-slugify-"));
  _tmpDirs.push(dir);
  return dir;
}

// Extract the `<slug>` segment from a `<id>-<slug>.md` filename.
function slugFromFilename(fileName, id) {
  return fileName.replace(/\.md$/, "").replace(new RegExp(`^${id}-`), "");
}

// AC1's shared 判据, applied to a generated filename: not the ASCII-fragment "store-kind",
// and slug length / title length ≥ 0.4.
function assertReadableSlug(id, fileName, title = TITLE) {
  assert.ok(fileName, `${id} must produce a file`);
  const slug = slugFromFilename(fileName, id);
  assert.notEqual(slug, "store-kind", `${id} slug collapsed to ASCII fragments: "${slug}"`);
  const ratio = slug.length / title.length;
  assert.ok(ratio >= 0.4, `${id} slug "${slug}" ratio ${ratio.toFixed(2)} < 0.4`);
  return slug;
}

test("AC1: slugify preserves CJK (not store-kind, similarity ≥ 0.4)", () => {
  const slug = slugify(TITLE);
  assert.notEqual(slug, "store-kind");
  const ratio = slug.length / TITLE.length;
  assert.ok(ratio >= 0.4, `slug="${slug}" ratio=${ratio.toFixed(2)} < 0.4`);
});

test("AC2: all four stores emit readable CJK filenames", () => {
  const dir = tmpDir();
  const adr = createAdrStore(path.join(dir, "adr"));
  const meta = createMetaStore(path.join(dir, "meta"));
  const goal = createGoalStore(path.join(dir, "goals"));
  const doc = createDocumentStore(path.join(dir, "docs-managed"));

  adr.write("ADR-900", { title: TITLE });
  meta.write("META-900", { title: TITLE });
  // GOAL/AC records require a non-empty `origin` (SPEC §2.4, write-time fail-closed), and a
  // `kind: goal` record additionally requires a `body` (gap-goal-record-completeness-undefined
  // — this test exercises slugify, not the completeness gate, so supply a scope body).
  goal.write("GOAL-900", {
    title: TITLE,
    origin: "gap-frontmatter-slugify-drops-non-ascii test",
    body: "验证 slugify 对非 ASCII 标题保持可读文件名；范围：四个 store 的写路径与文件名生成；非目标：内容完整性校验。",
  });
  doc.write("DOC-900", { title: TITLE });

  const adrFile = fs.readdirSync(path.join(dir, "adr")).find((f) => f.startsWith("ADR-900"));
  const metaFile = fs.readdirSync(path.join(dir, "meta")).find((f) => f.startsWith("META-900"));
  const goalFile = fs.readdirSync(path.join(dir, "goals")).find((f) => f.startsWith("GOAL-900"));
  const docFile = fs.readdirSync(path.join(dir, "docs-managed")).find((f) => f.startsWith("DOC-900"));

  // AC2 explicitly requires printing the four actual filenames.
  console.log("AC2 actual filenames:");
  for (const [id, f] of [
    ["ADR-900", adrFile],
    ["META-900", metaFile],
    ["GOAL-900", goalFile],
    ["DOC-900", docFile],
  ]) {
    console.log(`  ${id} -> ${f}`);
    assertReadableSlug(id, f);
  }
});

test("AC3: path safety not regressed (both directions)", () => {
  const controlTitle = "x" + String.fromCharCode(0, 1, 127) + "z";
  const unsafe = [
    "a/b/c",
    "a\\b\\c",
    'a:b*c?d"e<f>g|h',
    "..",
    "..hidden",
    controlTitle,
    "  leading and trailing  ",
    "超长标题".repeat(60), // 240 chars (> 200)
  ];
  for (const t of unsafe) {
    const s = slugify(t);
    assert.ok(
      !PATH_UNSAFE_RE.test(s) && !hasControlChar(s),
      `path-unsafe/control char survives in slug(${JSON.stringify(t)}) => "${s}"`
    );
    assert.ok(!s.startsWith("."), `slug starts with '.' for ${JSON.stringify(t)} => "${s}"`);
    assert.ok(s.length <= 60, `slug exceeds cap for ${JSON.stringify(t)} => "${s}" (${s.length})`);
  }
  // Negative control, the other direction: a normal CJK title must NOT be mangled by these rules.
  const normal = slugify("一个正常的中文标题");
  assert.ok(/[一-鿿]/.test(normal), `CJK stripped from a normal title => "${normal}"`);
  assert.ok(normal.length >= 8, `normal title slug unexpectedly short => "${normal}"`);
});

test("AC4: slugify idempotent + re-write reuses the existing filename", () => {
  assert.equal(slugify(TITLE), slugify(TITLE), "slugify must be deterministic for the same title");

  const dir = tmpDir();
  const adr = createAdrStore(path.join(dir, "adr"));
  adr.write("ADR-901", { title: "原始中文标题 — 第一次写入" });
  const first = fs.readdirSync(path.join(dir, "adr")).filter((f) => f.startsWith("ADR-901"));
  assert.equal(first.length, 1);
  const name1 = first[0];

  // Re-write with a DIFFERENT title: `existingFile ?? ...` must keep name1 (no rename/split).
  adr.write("ADR-901", { title: "完全不同的第二个标题 — 第二次写入" });
  const second = fs.readdirSync(path.join(dir, "adr")).filter((f) => f.startsWith("ADR-901"));
  assert.equal(second.length, 1, "re-write split one record into two files");
  assert.equal(second[0], name1, "re-write must reuse the existing filename");
});
