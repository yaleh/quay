// @test-group engine
// archguard-structural-gate-fan-in.test.mjs — gap-fan-in-remove-archguard-gate
// （前身 gap-archguard-structural-gate-in-fan-in-driver）：archguard 结构闸【已从 fan-in gate 链移除】，
// 降级为【按需命令】。原任务（人 2026-08-27 裁定）把 archguard 依赖环闸从 scripts/test.sh 迁入
// fan-in driver 机械步骤（runMechanicalFanIn 第 5.5 步）；本任务实测该闸零发火、零指引、27s/次串行
// 关键路径（周 1.33h），将其从 fan-in 移除——archguard-runner.ts 保留为按需入口（AC3），结构检查
// 落点为文档化按需命令（AC4）。
//
// 本文件是「单真相源负控制」+ 结构不变量断言（纯文件读，⛔ 不跑真 archguard CLI）：
//   ① scripts/test.sh 无 archguard-runner.ts 调用（suite 路径不触发——旧接线已退役）；
//   ② worker-driver.ts 无 archguard 步（fan-in gate 链不再含 archguard-structure step，AC1）；
//   ③ archguard-runner.ts 仍可直接调用（sccCount=0 判据 + metrics-history 载体 + fail-closed + usage）。
//
// 追加（gap-archguard-runner-missing-not-evaluated-state-and-version）：三态 + 版本锚 + 对账的
// 【真实行为】负控制——本段【会】起一个假 archguard CLI（ARCHGUARD_RUNNER_CLI 测试缝），因为 AC1/
// AC3/AC4 要验的是 runner 跑完之后的读数与 exit code，纯源码 grep 满足不了「能取假」：
//   • AC1 产物路径指向不存在文件 ⇒ exit 1 且 metrics-history 记 evaluated:false（sccCount 为 null）。
//   • AC2 metrics 记录带非空 archguardVersion，且等于 `archguard --version` 输出。
//   • AC3 scope 有 git 跟踪文件却 analyze 出 0 实体 ⇒ exit 1（不冒充「无环」）。
//   • AC4 sourceFiles 与 `git ls-files <source>` 不一致 ⇒ reason 非空且点名差异（含重复 realpath）。
//
// Run:
//   scripts/test.sh plugin/test/archguard-structural-gate-fan-in.test.mjs
//   node --test plugin/test/archguard-structural-gate-fan-in.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const testSh = () => fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
const driverSrc = () => fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "worker-driver.ts"), "utf8");
const runnerSrc = () => fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "archguard-runner.ts"), "utf8");

// ── AC1（能取假，单真相源负控制）：scripts/test.sh 不再调用 archguard-runner.ts ─────────────────

test("AC1（能取假）— scripts/test.sh 不再调用 archguard-runner.ts（旧接线退役，⛔ 两个真相源）", () => {
  const src = testSh();
  // 按位置判定，不是按「提到」：test.sh 内不得再出现 archguard-runner.ts 的脚本名（调用形态），
  // 也不得再出现 run_checker "archguard-structure-check" 接线。
  assert.doesNotMatch(src, /archguard-runner\.ts/, "test.sh must no longer name archguard-runner.ts");
  assert.doesNotMatch(src, /archguard-structure-check/, "test.sh must no longer wire the archguard run_checker");
});

// ── AC1（能取假）：fan-in gate 链不再含 archguard 步（⛔ worker-driver.ts 无该 step）──────────────

test("AC1（gap-fan-in-remove-archguard-gate）— worker-driver.ts 的机械 fan-in 不再含 archguard 步（无 step=archguard-structure、无 archguardCommand 测试缝、无 archguard-runner.ts 接点）", () => {
  const src = driverSrc();
  // 按位置判定（⛔ 不按「提到」——散文注释可合法提及被移除的 step 名，只有真调用才会带这些形态）：
  // ① 无 `step("archguard-structure"`（step 调用是执行语义，移除后不得再有）；
  // ② 无 `archguardCommand` 测试缝（interface 字段已删）；
  // ③ 无 `fail("archguard-structure"`（依赖环 red 的接点已随 step 一起删）。
  assert.doesNotMatch(src, /step\("archguard-structure"/, "runMechanicalFanIn must no longer run an archguard-structure step");
  assert.doesNotMatch(src, /archguardCommand/, "the archguardCommand test seam must be removed from MechanicalFanInOptions");
  assert.doesNotMatch(src, /fail\("archguard-structure"/, "no dependency-cycle red may return step=archguard-structure (the gate is gone)");
  // 负控制（AC3/AC4）：按需命令仍文档化在 worker-driver.ts 的移除说明里（降级落点，⛔ 不是静默消失）。
  assert.match(src, /archguard-runner\.ts --root/, "the on-demand archguard command must be documented where the step was removed (AC4)");
});

// ── AC3：archguard-runner.ts 仍可直接调用并产出 metrics（按需保留）───────────────────────────────

test("AC3 — archguard-runner.ts 仍可直接调用：sccCount=0 判据 + metrics-history 载体 + fail-closed + usage 文档", () => {
  const src = runnerSrc();
  // 依赖环判据（无阈值布尔不变量）、fail-closed 语义、metrics 载体随降级保留，⛔ 不在移除 fan-in 步时削弱。
  assert.match(src, /sccCount/, "the dependency-cycle criterion (sccCount===0) must survive the removal");
  assert.match(src, /metrics-history\.jsonl/, "the metrics-history carrier append must survive the removal");
  assert.match(src, /fail-closed|exit 1/, "the fail-closed semantic must survive the removal (read-unreadable ⇒ red)");
  // 按需调用文档（AC4）：runner 自己头注释带 usage（可直接跑、不依赖 fan-in gate 链）。
  assert.match(src, /node --experimental-strip-types plugin\/scripts\/archguard-runner\.ts --root/, "the runner's own header must document the on-demand usage");
});

// 追加（gap-archguard-structural-gate-reads-entity-scc-not-directory-cycles）：两个粒度的真实行为
// 负控制。假 CLI 同时写出 archguard 的两份产物，并把它们的形状对齐【实测的真 archguard 0.1.40】：
//   • class 产物 = `<output-dir>/<basename>/class/all-classes.json`（metricVector.sccCount = 实体粒度）
//   • query 产物 = `<work-dir>/query/manifest.json` + `<work-dir>/query/<key>/arch.json`
//     （extensions.tsAnalysis.moduleGraph.cycles = 目录粒度；真值实测于 2 文件 fixture：
//      a/x.ts ↔ b/y.ts 互相 side-effect import ⇒ sccCount=0 而 cycles=[{modules:["b","a"]}]）。
// 模式由 FAKE_ARCHGUARD_MODE 选择：
//   noop            — analyze 成功但【不写产物】⇒ 两粒度都读不到
//   zero-entities   — class 产物 totalEntities=0（query 正常）⇒ 0 实体 fail-closed
//   mismatch        — class 产物可用（sccCount=0, entities>0）但 sourceFiles 有重复 realpath 且与
//                     git ls-files 不一致（对账可见性）
//   no-cycles       — 两粒度都可用且都为 0 ⇒ PASS（AC3 负控制）
//   directory-cycle — class 产物 sccCount=0、query moduleGraph.cycles 有 1 个目录环（仅 src scope）
//                     ⇒ 只有目录环的树必须 RED 且点名成员（AC1/AC2）
//   no-module-graph — class 产物可用，query arch.json 无 tsAnalysis.moduleGraph ⇒ 目录粒度
//                     evaluated:false + reason，⛔ 不是「0 环」（AC4）
const RUNNER = path.join(REPO_ROOT, "plugin", "scripts", "archguard-runner.ts");
const FAKE_ARCHGUARD_SOURCE = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
if (argv[0] === "--version") {
  process.stdout.write("9.9.9-fake\\n");
  process.exit(0);
}
const outIdx = argv.indexOf("--output-dir");
const srcIdx = argv.indexOf("-s");
const workIdx = argv.indexOf("--work-dir");
const outDir = outIdx >= 0 ? argv[outIdx + 1] : "";
const source = srcIdx >= 0 ? argv[srcIdx + 1] : "";
const workDir = workIdx >= 0 ? argv[workIdx + 1] : "";
const mode = process.env.FAKE_ARCHGUARD_MODE || "noop";
if (mode === "noop") process.exit(0);

// ── class artifact (entity granularity) ──────────────────────────────────────────────────────────
const file = path.join(outDir, path.basename(source), "class", "all-classes.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
const sourceFiles = mode === "mismatch" ? ["dup.ts", "dup.ts", "extra.ts"] : [];
const artifact = {
  version: "1.1",
  language: "typescript",
  sourceFiles,
  entities: [],
  relations: [],
  metricVector: {
    schemaVersion: 1,
    totalEntities: mode === "zero-entities" ? 0 : 5,
    totalRelations: 2,
    sccCount: 0,
    maxInDegree: 1,
    maxOutDegree: 1,
  },
};
fs.writeFileSync(file, JSON.stringify(artifact));

// ── query artifact (directory granularity) — mirrors real archguard's persisted query scopes ─────
const queryDir = path.join(workDir, "query");
const resolved = fs.realpathSync(path.resolve(source));
const key = Buffer.from(resolved).toString("hex").slice(0, 16);
const cycles =
  mode === "directory-cycle" && source === "packages/quay/src"
    ? [{ modules: ["b", "a"], severity: "warning" }]
    : [];
const arch = {
  version: "1.1",
  language: "typescript",
  extensions:
    mode === "no-module-graph"
      ? {}
      : { tsAnalysis: { version: "1.0", moduleGraph: { nodes: [], edges: [], cycles } } },
};
fs.mkdirSync(path.join(queryDir, key), { recursive: true });
fs.writeFileSync(path.join(queryDir, key, "arch.json"), JSON.stringify(arch));
let manifest = { version: "1.0", generatedAt: new Date().toISOString(), scopes: [] };
try {
  manifest = JSON.parse(fs.readFileSync(path.join(queryDir, "manifest.json"), "utf8"));
} catch {}
manifest.scopes = (manifest.scopes || []).filter((s) => s.key !== key);
manifest.scopes.push({
  key,
  label: path.basename(source) + " (typescript)",
  language: "typescript",
  kind: "parsed",
  sources: [resolved],
  entityCount: mode === "zero-entities" ? 0 : 5,
  relationCount: 2,
  hasAtlasExtension: false,
  generatedAt: new Date().toISOString(),
});
manifest.globalScopeKey = manifest.globalScopeKey || key;
fs.writeFileSync(path.join(queryDir, "manifest.json"), JSON.stringify(manifest));
process.exit(0);
`;

let tmpRoot;
let fakeCli;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archguard-runner-test-"));
  fakeCli = path.join(tmpRoot, "fake-archguard.js");
  fs.writeFileSync(fakeCli, FAKE_ARCHGUARD_SOURCE, "utf8");
  fs.chmodSync(fakeCli, 0o755);
});

after(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** Run the runner against the real repo scopes with a fake archguard. `workDir` is where BOTH the
 *  analyze products and the metrics-history carrier land (the runner's --work-dir seam). */
function runRunner(mode, workDir) {
  return runRunnerWithCli(fakeCli, mode, workDir);
}

/** Same, but with an explicit CLI path — lets the CLI-missing fail-closed path (a DIFFERENT
 *  appendHistory call site) be exercised with a path that does not exist. */
function runRunnerWithCli(cli, mode, workDir) {
  return spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", RUNNER, "--root", REPO_ROOT, "--work-dir", workDir],
    {
      encoding: "utf8",
      env: { ...process.env, ARCHGUARD_RUNNER_CLI: cli, FAKE_ARCHGUARD_MODE: mode },
      timeout: 180000,
    }
  );
}

function lastRecord(workDir) {
  const file = path.join(workDir, "metrics-history.jsonl");
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0);
  return JSON.parse(lines[lines.length - 1]);
}

function freshWorkDir(name) {
  return path.join(tmpRoot, `work-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

// ── AC1（能取假·读不到≠干净）：产物路径指向不存在文件 ⇒ exit 1 且记录 evaluated:false ────────────

test("AC1（能取假）— 产物读不到 ⇒ exit 1，metrics 记录 evaluated:false 且 entitySccCount 为 null（⛔ 不以 0 冒充无环）", () => {
  const workDir = freshWorkDir("missing-product");
  const r = runRunner("noop", workDir);
  assert.equal(r.status, 1, `runner must fail-closed when no product is written; stderr=${r.stderr}`);

  const record = lastRecord(workDir);
  assert.equal(record.evaluated, false, "the record itself must carry evaluated:false");
  assert.equal(record.verdict, "fail");
  assert.equal(record.scopes.length, 6, "every scope must be represented, not collapsed into one error");
  assert.equal(record.entitySccCount, null, "the entity aggregate must be null when nothing was evaluated");
  assert.equal(record.directoryCycleCount, null, "the directory aggregate must be null when nothing was evaluated");
  for (const s of record.scopes) {
    assert.equal(s.evaluated, false, `${s.scope} must be not-evaluated`);
    assert.equal(s.entitySccCount, null, `${s.scope}.entitySccCount must be null — 0 would impersonate "no cycles"`);
    assert.match(s.reason, /cannot read archguard output/, `${s.scope} must name why it could not be read`);
    // Both granularities are unreadable here — and neither may collapse to 0.
    assert.equal(s.directoryCyclesEvaluated, false, `${s.scope} must record directory cycles as not evaluated`);
    assert.equal(s.directoryCycleCount, null, `${s.scope}.directoryCycleCount must be null, not 0`);
    assert.match(s.directoryCyclesReason, /query manifest|cannot read/, `${s.scope} must name why directory cycles could not be read`);
  }
  assert.match(record.reason, /NOT EVALUATED|cannot read archguard output/);
});

// ── AC2（版本入记录）：archguardVersion 非空且等于 `archguard --version` 输出 ─────────────────────

test("AC2（版本入记录）— metrics 记录含非空 archguardVersion，且等于 archguard --version 的首行", () => {
  const workDir = freshWorkDir("version");
  const r = runRunner("mismatch", workDir);
  assert.equal(r.status, 0, `a readable sccCount=0 product must still pass; stderr=${r.stderr}`);

  const versionRun = spawnSync(fakeCli, ["--version"], { encoding: "utf8" });
  assert.equal(versionRun.status, 0);
  const expected = versionRun.stdout.trim().split("\n")[0].trim();

  const record = lastRecord(workDir);
  assert.equal(record.evaluated, true);
  assert.equal(typeof record.archguardVersion, "string");
  assert.ok(record.archguardVersion.length > 0, "archguardVersion must be non-empty");
  assert.equal(record.archguardVersion, expected, "the recorded version must equal the CLI's own --version output");
});

// ── AC3（0 实体 fail-closed）：含 .ts 文件却分析成 0 实体 ⇒ exit 1 ────────────────────────────────

test("AC3（0 实体 fail-closed）— git 跟踪文件存在但 analyze 出 0 实体 ⇒ exit 1 且 evaluated:false", () => {
  const workDir = freshWorkDir("zero-entities");
  const r = runRunner("zero-entities", workDir);
  assert.equal(r.status, 1, `0 entities over a non-empty scope must fail-closed; stderr=${r.stderr}`);

  const record = lastRecord(workDir);
  assert.equal(record.evaluated, false);
  assert.equal(record.entityCount, null, "the aggregate must not be reported as 0 when nothing was evaluated");
  assert.equal(record.scopes.length, 6);
  for (const s of record.scopes) {
    assert.equal(s.evaluated, false, `${s.scope} must be not-evaluated when its analysis produced 0 entities`);
    assert.equal(s.entityCount, null, `${s.scope}.entityCount must be null, not 0`);
    assert.match(s.reason, /0 entities/, `${s.scope} must name the 0-entity condition`);
  }
});

// ── AC4（对账可见）：sourceFiles 与 git ls-files 不一致 ⇒ reason 非空且点名差异 ────────────────────

test("AC4（对账可见）— sourceFiles 与 git ls-files <source> 不一致时 reason 非空并点名差异（含重复 realpath）", () => {
  const workDir = freshWorkDir("reconcile");
  const r = runRunner("mismatch", workDir);
  // The product is readable and sccCount=0 → this control isolates reconciliation from the verdict.
  assert.equal(r.status, 0, `reconciliation alone must not red a readable clean product; stderr=${r.stderr}`);

  const record = lastRecord(workDir);
  assert.equal(record.evaluated, true);
  assert.ok(record.reason && record.reason.length > 0, "a sourceFiles/git mismatch must be recorded in reason");
  assert.match(record.reason, /sourceFiles=/, "reason must name the artifact's own count");
  assert.match(record.reason, /git ls-files/, "reason must name the independent git caliber");
  assert.match(record.reason, /duplicate sourceFiles entr/, "reason must name the duplicate realpath (symlink double-resolution)");

  // The per-scope signal carries the same reconciliation, so a reader does not need the aggregate.
  const src = record.scopes.find((s) => s.scope === "src");
  assert.ok(src, "the src scope must be present");
  assert.equal(src.sourceFiles, 2, "dup.ts resolves to ONE realpath → 2 unique of 3 entries");
  assert.equal(typeof src.gitSourceFiles, "number");
  assert.ok(src.gitSourceFiles > 0);
  assert.match(src.reason, /sourceFiles=2 vs git ls-files packages\/quay\/src=/);
});

// ── 两粒度分离（gap-archguard-structural-gate-reads-entity-scc-not-directory-cycles）──────────────
//
// 下面 4 条 AC 验的是【本任务】的判据。关键前提（CLAUDE.md 硬规则 4 推论四：能解释 ≠ 已检验）：
// 假 CLI 的产物形状对齐实测真 archguard 0.1.40——2 文件 fixture（a/x.ts ↔ b/y.ts 互相 side-effect
// import）实测 class sccCount=0、query moduleGraph.cycles=[{modules:["b","a"]}]。若只读前者，该树恒绿。

test("AC1（能取假·目录环）— 只有目录环、实体 SCC 为 0 ⇒ exit 1 且 stderr 点名环成员", () => {
  const workDir = freshWorkDir("directory-cycle");
  const r = runRunner("directory-cycle", workDir);

  assert.equal(r.status, 1, `a tree with only directory-level cycles must be RED; stderr=${r.stderr}`);
  assert.match(r.stderr, /directory-level dependency cycles/, "stderr must name the directory-granularity violation");
  // The members themselves (not just a count) — AC1 says 点名环成员. JSON-rendered so an empty
  // project-root module id would also be unambiguous.
  assert.match(r.stderr, /\[\s*"b"\s*,\s*"a"\s*\]/, `stderr must name the cycle members b and a; stderr=${r.stderr}`);

  const record = lastRecord(workDir);
  assert.equal(record.verdict, "fail");
  assert.equal(record.evaluated, true, "both calibers WERE read — the red is a violation, not an unreadable artifact");
  const src = record.scopes.find((s) => s.scope === "src");
  assert.ok(src, "the src scope must be present");
  assert.equal(src.entitySccCount, 0, "the entity/class caliber is clean on this fixture");
  assert.equal(src.directoryCycleCount, 1, "the directory caliber sees the one cycle");
  assert.deepEqual(src.directoryCycles[0].modules, ["b", "a"], "the recorded cycle carries its members");
});

test("AC2（两粒度真分开）— 同一 fixture 的 metrics 记录 entitySccCount=0 且 directoryCycleCount>=1（不是同一数的两个名字）", () => {
  const workDir = freshWorkDir("two-granularities");
  const r = runRunner("directory-cycle", workDir);
  assert.equal(r.status, 1, `stderr=${r.stderr}`);

  const record = lastRecord(workDir);
  assert.equal(record.entitySccCount, 0, "entity/class SCC aggregate is 0");
  assert.ok(
    typeof record.directoryCycleCount === "number" && record.directoryCycleCount >= 1,
    `directoryCycleCount must be >= 1, got ${JSON.stringify(record.directoryCycleCount)}`
  );
  assert.notEqual(record.entitySccCount, record.directoryCycleCount, "the two readings must be DIFFERENT values");
  assert.equal(record.entitySccEvaluated, true);
  assert.equal(record.directoryCyclesEvaluated, true);
});

test("AC3（负控制）— 无环 fixture ⇒ exit 0，记录 directoryCycleCount=0 且 evaluated:true", () => {
  const workDir = freshWorkDir("no-cycles");
  const r = runRunner("no-cycles", workDir);
  assert.equal(r.status, 0, `a genuinely cycle-free tree must PASS; stderr=${r.stderr}`);

  const record = lastRecord(workDir);
  assert.equal(record.evaluated, true);
  assert.equal(record.verdict, "pass");
  assert.equal(record.entitySccCount, 0);
  assert.equal(record.directoryCycleCount, 0);
  assert.equal(record.directoryCyclesEvaluated, true, "an evaluated-clean directory reading must be true, not absent");
  assert.equal(record.directoryCyclesReason, null);
  for (const s of record.scopes) {
    assert.equal(s.directoryCyclesEvaluated, true, `${s.scope} must have an evaluated directory reading`);
    assert.equal(s.directoryCycleCount, 0, `${s.scope} must read 0 cycles, not null`);
  }
});

test("AC4（未评估态）— 无 TS module graph 的【多目录】scope ⇒ evaluated:false + reason，不与「0 环」同值（单目录 scope 以文件清单为 basis 读为真）", () => {
  const workDir = freshWorkDir("no-module-graph");
  const r = runRunner("no-module-graph", workDir);

  // A scope whose directory cycle count cannot be read must NOT pass as "0 cycles" (硬规则 3b).
  assert.equal(r.status, 1, `an unreadable directory caliber must fail-closed; stderr=${r.stderr}`);
  assert.match(r.stderr, /NOT EVALUATED/);
  assert.match(r.stderr, /moduleGraph/, `stderr must name the missing module graph; stderr=${r.stderr}`);

  const record = lastRecord(workDir);
  assert.equal(record.evaluated, false);
  assert.equal(record.directoryCyclesEvaluated, false, "the record-level directory reading must be not-evaluated");
  assert.equal(record.directoryCycleCount, null, "not-evaluated must be null, never 0");
  assert.ok(
    typeof record.directoryCyclesReason === "string" && record.directoryCyclesReason.length > 0,
    "not-evaluated must carry a reason"
  );
  assert.match(record.directoryCyclesReason, /moduleGraph/);

  // 精化（gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts Plan 步骤 2）：
  // 「没有 moduleGraph」只说明【没请求 package 级图】，不说明「无环」（硬规则 3b）。能把它变成真实
  // 读数的唯一证据是 **文件清单**：该 scope 受跟踪的非测试 .ts 全在 scope 目录本身 ⇒ 目录级环在
  // 结构上不可能。所以本条负控制按 basis 分开断言，并额外要求**至少一个多目录 scope 仍是
  // not-evaluated**——否则「未评估态」这一条会变成空转（全被 single-directory 覆盖）。
  const multiDirectory = [];
  for (const s of record.scopes) {
    assert.equal(s.evaluated, true, `${s.scope}: the class artifact WAS readable (the failure is directory-only)`);
    assert.equal(s.entitySccCount, 0, `${s.scope}: the entity caliber is readable and clean`);
    if (s.directoryCyclesBasis === "single-directory") {
      // 从文件清单推出的读数，不是「0 环」的伪装：它带着自己的 basis。
      assert.equal(s.directoryCyclesEvaluated, true, `${s.scope}: a single-directory scope IS readable (file-list basis)`);
      assert.equal(s.directoryCycleCount, 0, `${s.scope}: one directory cannot hold a directory-level cycle`);
      assert.equal(s.directoryCyclesReason, null, `${s.scope}: no reason field when the basis is positive`);
    } else {
      multiDirectory.push(s.scope);
      assert.equal(s.directoryCyclesEvaluated, false, `${s.scope}: a MULTI-directory scope without a graph must be not-evaluated`);
      assert.equal(s.directoryCycleCount, null, `${s.scope}: directoryCycleCount must be null, not 0`);
      assert.ok(s.directoryCyclesReason && s.directoryCyclesReason.length > 0, `${s.scope}: reason required`);
      assert.match(s.directoryCyclesReason, /NOT single-directory/, `${s.scope}: the reason must say why the file-list basis did not apply`);
    }
  }
  assert.ok(
    multiDirectory.length >= 1,
    "at least one MULTI-directory scope must stay not-evaluated (otherwise this control is vacuous)"
  );
});

// ── 跨 scope 边边界可见（gap-archguard-cross-scope-edges-structurally-invisible）──────────────────
//
// 六个 SCOPES 各自 analyze ⇒ `plugin/scripts` ↔ `packages/*/src` 的 import 边【不存在于任何一次
// 分析】。因此「跨 scope 无环」是无条件真、不可取假——它不是测量。判据改为【边界可见】：
// 每条 metrics 记录显式声明 crossScope="not-evaluated" + 非空 reason。字段缺席、值为 0/false、
// 或 reason 为空都判假（字段缺席即假是 AC1 的字面要求）。
//
// 覆盖【全部三处写入路径】：① 正常分析后的 PASS 记录；② 产物读不到的 fail-closed 记录；
// ③ CLI 缺失时在 analyze 之前写下的 fail-closed 记录（另一条 appendHistory 调用点）。

function assertCrossScopeDeclared(record, label) {
  assert.equal(record.crossScope, "not-evaluated", `${label}: crossScope must be the literal "not-evaluated"`);
  assert.equal(typeof record.crossScopeReason, "string", `${label}: crossScopeReason must be a string`);
  assert.ok((record.crossScopeReason ?? "").trim().length > 0, `${label}: crossScopeReason must be non-empty`);
  assert.match(record.crossScopeReason, /cross-scope/, `${label}: the reason must name the cross-scope boundary`);
}

test("AC1（能取假·边界可见）— 每条 metrics 记录含 crossScope=not-evaluated + 非空 reason（三处写入路径）", () => {
  // ① 正常分析、两粒度 evaluate 且全 0 ⇒ PASS 记录
  const passDir = freshWorkDir("cross-scope-pass");
  const passRun = runRunner("no-cycles", passDir);
  assert.equal(passRun.status, 0, `a clean fixture must PASS; stderr=${passRun.stderr}`);
  assertCrossScopeDeclared(lastRecord(passDir), "pass record");

  // ② 产物读不到 ⇒ fail-closed（主记录构造点）
  const failDir = freshWorkDir("cross-scope-fail");
  const failRun = runRunner("noop", failDir);
  assert.equal(failRun.status, 1, `an unreadable product must fail-closed; stderr=${failRun.stderr}`);
  assertCrossScopeDeclared(lastRecord(failDir), "fail-closed record");

  // ③ CLI 缺失 ⇒ 分析前写下的 fail-closed 记录（独立的 appendHistory 调用点）
  const missingDir = freshWorkDir("cross-scope-missing-cli");
  const missingRun = runRunnerWithCli(path.join(tmpRoot, "does-not-exist-archguard"), "noop", missingDir);
  assert.equal(missingRun.status, 1, `a missing CLI must fail-closed; stderr=${missingRun.stderr}`);
  assertCrossScopeDeclared(lastRecord(missingDir), "CLI-missing record");

  // 负控制（字段缺席即假）：去掉 crossScope 后断言本身必须失败，否则本测试只是在回显自己。
  assert.throws(
    () => assertCrossScopeDeclared({ crossScopeReason: "unmeasured cross-scope edges" }, "negative control"),
    /crossScope must be the literal/
  );
});
