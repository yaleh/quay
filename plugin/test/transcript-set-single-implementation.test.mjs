// @test-group engine
// transcript-set-single-implementation.test.mjs — the structural judge for the disposition of
// finding `transcript-set-copy` (routine `semantic-dedup-scan`, runId
// `semantic-dedup-scan-1793251416079`, kind `byte-identical-body`, verdict `real-duplication`,
// Jaccard 1.0 / 202 vs 206 chars, files
// `plugin/scripts/inner-forensics.mjs` + `plugin/scripts/manager-observation-runtime-check.ts`).
//
// 同一条 finding 在 2026-09-17 / 2026-09-28 / 2026-10-29 被同一探针报了三次，此前没有任何产物
// 拦得住「再复制一份」。本文件就是那个产物 —— 判据全部按【代码位置】取（硬规则 2），且有负控制
// 证明谓词能取假（硬规则 3b）：
//
//   ① `plugin/scripts/transcript-set.mjs` 是唯一实现：把它自己的头注释与字符串都算进去，全仓
//      `plugin/scripts/**` + `packages/*/src/**` 里出现 `function transcriptSet(` 的【文件】恰好一个；
//   ② 两个消费者都在代码位置 import `./transcript-set.mjs`（注释里提到不算）；
//   ③ 行为面：主 transcript + `subagents/*.jsonl` 进集合，非 jsonl 不进，缺 subagents 目录不抛；
//   ④ 负控制：①③ 用的谓词对一段故意含本地定义的合成源码必须命中，对一段 import 别的模块的
//      合成源码必须不命中 —— 否则「没有本地定义」与「检查没跑」同形。
//
// Run:
//   scripts/test.sh plugin/test/transcript-set-single-implementation.test.mjs
//   node --test plugin/test/transcript-set-single-implementation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS_DIR = path.join(REPO_ROOT, "plugin", "scripts");
const SHARED_REL = "plugin/scripts/transcript-set.mjs";
const SHARED = path.join(REPO_ROOT, SHARED_REL);

// 两个消费者 —— ③ 的「唯一实现」对象集。少一个 ⇒ 判据的对象集变了，必须当场重看，不是静默通过。
const CONSUMERS = [
  "plugin/scripts/inner-forensics.mjs",
  "plugin/scripts/manager-observation-runtime-check.ts",
];

const { codeOnlyText } = await import("../scripts/source-text-lib.ts");
const sharedMod = await import(SHARED);

// ── predicates (code positions only; comments masked, string specifiers preserved) ────────────────
// 行锚定的 import 形态：`import { … transcriptSet … } from "./transcript-set.mjs"`。
const IMPORTS_SHARED_RE = /^import\s*\{[^}]*\btranscriptSet\b[^}]*\}\s*from\s*["']\.\/transcript-set\.mjs["'];?[ \t]*$/m;
const LOCAL_DEF_RE = /\bfunction\s+transcriptSet\s*\(/;

function importsShared(src) {
  return IMPORTS_SHARED_RE.test(codeOnlyText(src));
}
function definesLocally(src) {
  return LOCAL_DEF_RE.test(codeOnlyText(src));
}
function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/** Every file under `dir` (recursively), skipping VCS/deps/build dirs. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && /\.(?:mjs|js|ts|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

function relOf(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join("/");
}

// ── ① the shared module is the ONLY local definition in the code base ────────────────────────────

test("AC1 — exactly ONE file in plugin/scripts + packages/*/src defines transcriptSet locally", () => {
  const roots = [SCRIPTS_DIR];
  const pkgDir = path.join(REPO_ROOT, "packages");
  for (const e of fs.readdirSync(pkgDir, { withFileTypes: true })) {
    if (e.isDirectory()) roots.push(path.join(pkgDir, e.name, "src"));
  }
  const files = roots.flatMap((r) => walk(r));
  // 语料非空守卫：一个 walked=0 的扫描与「没有重复」同形（gap-checks-that-verify-an-empty-set）。
  assert.ok(files.length > 100, `corpus must be non-trivial (walked ${files.length} files)`);

  const definers = files.filter((p) => definesLocally(fs.readFileSync(p, "utf8"))).map(relOf);
  assert.deepEqual(definers, [SHARED_REL],
    "the transcriptSet body must exist exactly once — " +
    `found: ${JSON.stringify(definers)} (a second copy is the finding transcript-set-copy recurring)`);
});

// ── ② both consumers reach the shared implementation at a CODE position ──────────────────────────

test("AC2 — both consumers import ./transcript-set.mjs and define no local copy", () => {
  const src = new Map(CONSUMERS.map((rel) => [rel, read(rel)]));
  const imports = CONSUMERS.filter((rel) => importsShared(src.get(rel)));
  const locals = CONSUMERS.filter((rel) => definesLocally(src.get(rel)));
  assert.deepEqual(imports, CONSUMERS, "every consumer must import the shared module (code position)");
  assert.deepEqual(locals, [], "no consumer may carry its own transcriptSet definition");
});

// ── ③ behaviour: the merged set is main transcript + subagents/*.jsonl ───────────────────────────

test("AC3 — transcriptSet returns the transcript plus every subagents/*.jsonl, and nothing else", () => {
  assert.equal(typeof sharedMod.transcriptSet, "function", "the shared module must export transcriptSet");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-set-"));
  try {
    const main = path.join(tmp, "sess.jsonl");
    fs.writeFileSync(main, "\n");
    const sub = path.join(tmp, "sess", "subagents");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "agent-1.jsonl"), "\n");
    fs.writeFileSync(path.join(sub, "agent-2.jsonl"), "\n");
    fs.writeFileSync(path.join(sub, "notes.txt"), "not a transcript\n");

    assert.deepEqual(sharedMod.transcriptSet(main), [main, path.join(sub, "agent-1.jsonl"), path.join(sub, "agent-2.jsonl")],
      "main transcript first, then every *.jsonl under subagents/ (non-jsonl excluded)");

    // 缺 subagents 目录是常态（从未派发 subagent 的会话），不是错误。
    const bare = path.join(tmp, "bare.jsonl");
    fs.writeFileSync(bare, "\n");
    assert.deepEqual(sharedMod.transcriptSet(bare), [bare], "a missing subagents/ dir must not throw");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ④ negative controls: the predicates can take false ────────────────────────────────────────────

test("AC4 — negative controls: the same predicates fire on a local copy and stay quiet on another import", () => {
  const withLocalCopy = 'import fs from "node:fs";\nfunction transcriptSet(file) {\n  return [file];\n}\n';
  assert.equal(definesLocally(withLocalCopy), true, "a local definition must be SEEN (else AC1 is an echo)");

  // 注释里提到同一个函数名不算定义（硬规则 2：按位置判定）。
  const commentMention = "// function transcriptSet(file) { … } lives in transcript-set.mjs now\nconst x = 1;\n";
  assert.equal(definesLocally(commentMention), false, "a COMMENTED definition is not a code-position definition");

  const otherImport = 'import { transcriptSet } from "./other-module.mjs";\n';
  assert.equal(importsShared(otherImport), false, "importing another module must NOT satisfy AC2");

  const realImport = 'import { transcriptSet } from "./transcript-set.mjs";\n';
  assert.equal(importsShared(realImport), true, "the real import shape must be SEEN (else AC2 is an echo)");
});
