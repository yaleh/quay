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

// ── 真实行为控制：注入假 archguard CLI（ARCHGUARD_RUNNER_CLI 测试缝）─────────────────────────────
//
// 这个假 CLI 模仿真 archguard 的两件事：`--version` 与 `analyze`（按 `--output-dir` + source basename
// 落 class/all-classes.json）。模式由 FAKE_ARCHGUARD_MODE 选择：
//   noop          — analyze 成功但【不写产物】⇒ AC1（读不到 ≠ 干净）
//   zero-entities — 产物存在但 totalEntities=0 ⇒ AC3（有 .ts 却 0 实体）
//   mismatch      — 产物可用（sccCount=0, entities>0），但 sourceFiles 有重复 realpath 且数量与
//                   git ls-files 不一致 ⇒ AC4；同时这条也是 AC2 的版本锚阳性样本。
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
const outDir = outIdx >= 0 ? argv[outIdx + 1] : "";
const source = srcIdx >= 0 ? argv[srcIdx + 1] : "";
const mode = process.env.FAKE_ARCHGUARD_MODE || "noop";
if (mode === "noop") process.exit(0);
const file = path.join(outDir, path.basename(source), "class", "all-classes.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
const artifact = {
  version: "1.1",
  language: "typescript",
  sourceFiles: mode === "mismatch" ? ["dup.ts", "dup.ts", "extra.ts"] : [],
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
  return spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", RUNNER, "--root", REPO_ROOT, "--work-dir", workDir],
    {
      encoding: "utf8",
      env: { ...process.env, ARCHGUARD_RUNNER_CLI: fakeCli, FAKE_ARCHGUARD_MODE: mode },
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

test("AC1（能取假）— 产物读不到 ⇒ exit 1，metrics 记录 evaluated:false 且 sccCount 为 null（⛔ 不以 0 冒充无环）", () => {
  const workDir = freshWorkDir("missing-product");
  const r = runRunner("noop", workDir);
  assert.equal(r.status, 1, `runner must fail-closed when no product is written; stderr=${r.stderr}`);

  const record = lastRecord(workDir);
  assert.equal(record.evaluated, false, "the record itself must carry evaluated:false");
  assert.equal(record.verdict, "fail");
  assert.equal(record.scopes.length, 6, "every scope must be represented, not collapsed into one error");
  for (const s of record.scopes) {
    assert.equal(s.evaluated, false, `${s.scope} must be not-evaluated`);
    assert.equal(s.sccCount, null, `${s.scope}.sccCount must be null — 0 would impersonate "no cycles"`);
    assert.match(s.reason, /cannot read archguard output/, `${s.scope} must name why it could not be read`);
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
