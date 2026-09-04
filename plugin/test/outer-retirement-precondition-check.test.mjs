// @test-group engine
// outer-retirement-precondition-check.test.mjs — 退役前置检查测试
// (tasks/gap-b0-retirement-precondition-checker-call-surface, SPEC §2.3b B0).
//
// AC1 (前置检查存在): checker 枚举 outer 执行核直接引用的 `-check.{ts,sh}` checker 并逐个判定留存
// 调用面（注册表 / 外部代码引用）。AC2 (负控制): 造一个只被退役层引用的 checker（无外部载体、无
// 注册表、无显式退役标记）⇒ 必须 RED (exit 1)。AC3 (N→0): 带 RETIRED-WITH-RETIRING-LAYER 标记的
// orphan checker ⇒ 已处置（不 RED）；真实仓库当前 N=0。
//
// 硬规则 3b/4: 执行核缺失 / 执行核未引用任何 plugin/scripts 脚本 ⇒ NOT-EVALUATED (exit 3)，绝不与
// 绿混同。
//
// 本文件钉住:
//   (a) 纯逻辑（CHECKER_RE / maskComments / codeOnlyText / referencedScripts / inStaticGateRegistry）;
//   (b) 真实仓库 GREEN（orphan-checker N=0）;
//   (c) 负控制 AC2——只被退役层引用的 checker 无标记 ⇒ exit 1;
//   (d) 显式退役标记 ⇒ 已处置（exit 0）;
//   (e) 留存调用面两态（注册表 / 外部代码引用）⇒ 不 RED;
//   (f) NOT-EVALUATED（执行核缺失 / 零引用）⇒ exit 3。
//
// Run:
//   scripts/test.sh plugin/test/outer-retirement-precondition-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  CHECKER_RE,
  RETIRED_MARKER,
  maskComments,
  codeOnlyText,
  referencedScripts,
  inStaticGateRegistry,
  checkPrecondition,
} from "../scripts/outer-retirement-precondition-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "outer-retirement-precondition-check.ts");

// ── 纯逻辑 ───────────────────────────────────────────────────────────────────────────────────────────

test("CHECKER_RE matches -check.{ts,sh} only, not -registry/-counter/-triage", () => {
  assert.ok(CHECKER_RE.test("ready-pool-check.ts"));
  assert.ok(CHECKER_RE.test("closure-lag-check.sh"));
  assert.ok(!CHECKER_RE.test("outer-cron-registry.ts"), "registry mechanism is not a checker");
  assert.ok(!CHECKER_RE.test("a15-ruling5-counter.ts"));
  assert.ok(!CHECKER_RE.test("red-window-triage.ts"));
  assert.ok(!CHECKER_RE.test("foo-check.mjs"), "checkers are .ts/.sh, not .mjs");
});

test("maskComments masks // and block comments but NOT strings", () => {
  const src = `// line comment foo\nconst a = "// not a comment";\n/* block\ncomment */ const b = 1;`;
  const mask = maskComments(src);
  // "line comment foo" is masked; the string "// not a comment" is NOT masked.
  const lineCommentIdx = src.indexOf("line comment foo");
  assert.equal(mask[lineCommentIdx], 1, "// line comment must be masked");
  const strIdx = src.indexOf("// not a comment");
  assert.equal(mask[strIdx], 0, "string content must NOT be masked (import specifiers are strings)");
  const blockIdx = src.indexOf("block\ncomment");
  assert.equal(mask[blockIdx], 1, "block comment must be masked");
});

test("maskComments masks bash # line comments but NOT # inside strings", () => {
  const src = `# outer-anchor-check.ts in a bash comment\nconst s = "# not a bash comment";\n`;
  const mask = maskComments(src);
  const hashIdx = src.indexOf("outer-anchor-check.ts in a bash comment");
  assert.equal(mask[hashIdx], 1, "bash # line comment must be masked");
  const strIdx = src.indexOf("# not a bash comment");
  assert.equal(mask[strIdx], 0, "# inside a string must NOT be masked");
});

test("codeOnlyText blanks comment content and keeps code + strings", () => {
  const src = `import x from "./outer-anchor-check.ts"; // trailing comment\nrun outer-anchor-check.ts\n`;
  const code = codeOnlyText(src);
  assert.ok(code.includes("outer-anchor-check.ts"), "import specifier (string) must survive comment-masking");
  assert.ok(!code.includes("trailing comment"), "comment content must be blanked");
});

test("referencedScripts filters script basenames by presence in the tick-core text", () => {
  const text = "run plugin/scripts/ready-pool-check.ts --cap 5\nbash monitor-mount-check.sh";
  const names = ["ready-pool-check.ts", "monitor-mount-check.sh", "slot-refill.ts", "outer-driver.ts"];
  assert.deepEqual(referencedScripts("/x", text, names), ["monitor-mount-check.sh", "ready-pool-check.ts"]);
});

test("inStaticGateRegistry is exact-basename substring in the registry text", () => {
  const reg = 'run_checker "ready-pool-check" node ".../ready-pool-check.ts" --root "${repo_root}"';
  assert.equal(inStaticGateRegistry(reg, "ready-pool-check.ts"), true);
  assert.equal(inStaticGateRegistry(reg, "ready-pool-check.sh"), false);
  assert.equal(inStaticGateRegistry(reg, "outer-anchor-check.ts"), false);
});

// ── fixture 助手 ─────────────────────────────────────────────────────────────────────────────────────

/** 建临时仓库：执行核引用 `coreRefs`；scripts 是 plugin/scripts 顶层文件；registryRefs 进注册表；
 *  externalRefs 是任意可执行载体（rel → content）。 */
function buildFixture(tag, { coreRefs, scripts = {}, registryRefs = [], externalRefs = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `orp-${tag}-`));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  const coreBody = coreRefs.map((b) => `run: plugin/scripts/${b}\n`).join("");
  fs.writeFileSync(path.join(dir, "orchestration", "orchestrator-tick-core.md"), coreBody);
  for (const [name, content] of Object.entries(scripts)) {
    fs.writeFileSync(path.join(dir, "plugin", "scripts", name), content ?? `// ${name}\n`);
  }
  if (registryRefs.length > 0) {
    fs.writeFileSync(
      path.join(dir, "plugin", "scripts", "runner-static-gate.ts"),
      registryRefs.map((b) => `run_checker "x" node ".../${b}" --root "$1"\n`).join(""),
    );
  }
  for (const [rel, content] of Object.entries(externalRefs)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function runCli(root) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", root, "--json"], {
    encoding: "utf8",
  });
}

// ── 真实仓库 ─────────────────────────────────────────────────────────────────────────────────────────

test("real repo is GREEN — orphan-checker N=0 (outer-anchor-check.ts explicitly retired)", () => {
  const res = checkPrecondition(repoRoot);
  assert.equal(res.evaluated, true, "the real repo must be evaluable");
  // monitor-mount-check.sh 随 session-liveness 退役（2026-09-03），执行核引用 checker 数 10→9。
  assert.ok(res.checkerCount >= 9, `expected ≥9 referenced checkers, got ${res.checkerCount}`);
  assert.deepEqual(res.undischarged, [], `no orphan checker may lack a disposition: ${res.undischarged.join(", ")}`);
  assert.equal(res.ok, true, "the real repo must be green");
  // outer-anchor-check.ts is the SPEC §2.3b N=1 — it must now carry the explicit retirement marker.
  assert.deepEqual(res.retiredWithMarker, ["outer-anchor-check.ts"], "outer-anchor-check.ts must be explicitly retired");
});

// ── 负控制 AC2 ───────────────────────────────────────────────────────────────────────────────────────

test("AC2 — a checker referenced ONLY by the retiring layer (no marker) ⇒ RED (exit 1)", () => {
  const dir = buildFixture("neg", {
    coreRefs: ["orphan-check.ts"],
    scripts: { "orphan-check.ts": "// orphan, no external carrier, no registry, no marker\n" },
  });
  const r = runCli(dir);
  assert.equal(r.status, 1, `an orphan checker with no disposition must go RED:\n${r.stdout}\n${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.equal(res.ok, false);
  assert.deepEqual(res.orphanCheckers, ["orphan-check.ts"]);
  assert.deepEqual(res.undischarged, ["orphan-check.ts"], "must name the orphan without a disposition");
});

// ── 显式退役标记（AC3 处置面）─────────────────────────────────────────────────────────────────────────

test("orphan checker WITH the RETIRED marker ⇒ disposed (exit 0)", () => {
  const dir = buildFixture("marker", {
    coreRefs: ["orphan-check.ts"],
    scripts: {
      "orphan-check.ts": `// ${RETIRED_MARKER} (gap-b0): retires with the outer layer\n// body\n`,
    },
  });
  const r = runCli(dir);
  assert.equal(r.status, 0, `a marked-retired orphan must not go RED:\n${r.stdout}\n${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.equal(res.ok, true);
  assert.deepEqual(res.retiredWithMarker, ["orphan-check.ts"]);
  assert.deepEqual(res.undischarged, []);
});

// ── 留存调用面（不 RED）──────────────────────────────────────────────────────────────────────────────

test("a checker in the static-gate registry survives (not RED)", () => {
  const dir = buildFixture("reg", {
    coreRefs: ["registry-check.ts"],
    scripts: { "registry-check.ts": "// registered\n" },
    registryRefs: ["registry-check.ts"],
  });
  const r = runCli(dir);
  assert.equal(r.status, 0, `a registry-referenced checker must survive:\n${r.stdout}\n${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.deepEqual(res.orphanCheckers, []);
});

test("a checker referenced by an EXTERNAL executable carrier survives (not RED)", () => {
  const dir = buildFixture("ext", {
    coreRefs: ["safe-check.ts"],
    scripts: { "safe-check.ts": "// imported by an external carrier\n" },
    externalRefs: {
      "plugin/scripts/helper.ts": 'import { x } from "./safe-check.ts";\n',
    },
  });
  const r = runCli(dir);
  assert.equal(r.status, 0, `an externally-referenced checker must survive:\n${r.stdout}\n${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.deepEqual(res.orphanCheckers, []);
});

test("a COMMENT reference is NOT a surviving call surface (orphan stays RED)", () => {
  const dir = buildFixture("comment", {
    coreRefs: ["orphan-check.ts"],
    scripts: { "orphan-check.ts": "// orphan\n" },
    externalRefs: {
      "plugin/scripts/other.ts": "// this only mentions orphan-check.ts in a comment\nconst x = 1;\n",
    },
  });
  const r = runCli(dir);
  assert.equal(r.status, 1, "a comment mention must not count as a surviving call surface");
  const res = JSON.parse(r.stdout);
  assert.deepEqual(res.undischarged, ["orphan-check.ts"]);
});

test("a bash # comment reference is NOT a surviving call surface (orphan stays RED)", () => {
  const dir = buildFixture("hashcomment", {
    coreRefs: ["orphan-check.ts"],
    scripts: { "orphan-check.ts": "// orphan\n" },
    externalRefs: {
      "plugin/scripts/other.sh": "# this only mentions orphan-check.ts in a bash comment\necho hi\n",
    },
  });
  const r = runCli(dir);
  assert.equal(r.status, 1, "a bash # comment mention must not count as a surviving call surface");
  const res = JSON.parse(r.stdout);
  assert.deepEqual(res.undischarged, ["orphan-check.ts"]);
});

// ── NOT-EVALUATED（硬规则 3b/4）───────────────────────────────────────────────────────────────────────

test("missing execution core ⇒ NOT-EVALUATED (exit 3), never green", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orp-ne-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  const r = runCli(dir);
  assert.equal(r.status, 3, `a missing execution core must be NOT-EVALUATED:\n${r.stdout}\n${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.equal(res.evaluated, false);
  assert.ok(res.notEvaluatedReason, "NOT-EVALUATED must carry a reason");
});

test("execution core referencing zero scripts ⇒ NOT-EVALUATED (exit 3)", () => {
  const dir = buildFixture("ne0", { coreRefs: [], scripts: { "unreferenced-check.ts": "// not in core\n" } });
  const r = runCli(dir);
  assert.equal(r.status, 3, `zero referenced scripts must be NOT-EVALUATED:\n${r.stdout}\n${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.equal(res.evaluated, false);
});
