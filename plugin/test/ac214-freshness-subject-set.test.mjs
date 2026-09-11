// @test-group engine
// ac214-freshness-subject-set.test.mjs — AC-244 的接线钉
// (tasks/gap-ac244-freshness-subject-set-mechanically-derived, goals/AC-244-*.md).
//
// 缺陷（本条钉住的）：AC-214 判据里的新鲜度主体集合 `NEED` 原是一份【手写死列表】(四条载体型判据
// AC-201/203/205/207)。AC-232/AC-238 的判据正文只读载体、只凭「载体里存在过一条记录」通过 ⇒ 转绿即
// 永久绿，却不在 NEED 里 ⇒ 逃出新鲜度约束（AC-244 当轮实测 `gate AC-244` verdict=fail，reason 逐字
// 含 `GOAL-009-AC-232,GOAL-009-AC-238`）。手写列表正是成因本身 —— 所以修法不是把两条 ID 补进去，
// 而是让 AC-214 判据【自己】机械推导主体集合，并与声明的 NEED 比对，`SUBJ - NEED` 非空即 fail-closed。
//
// 本测试的两个取假方向（⛔ 只做单向不算）：
//   AC5 正控制 = 6 条 NEED 都有载体记录但无 build_sha ⇒ exit 1 且 stderr 是 `no evidence yet:`
//                ——证明【控制流越过守卫、到达新鲜度阶段】，守卫不是恒红；
//   AC4 取假   = 夹具里多一条「判据只读载体、且不在 NEED」的 GOAL-009 AC（合成 AC-239）及其载体
//                记录 ⇒ exit 1 且 stderr 含 `carrier-type AC with no freshness bound in NEED` 并指名它。
//
// 判据正文【不从测试里复制一份】—— 测试从真 `goals/AC-214-*.md` 经 YAML 解析取 `criterion` 执行。
// 复制一份就是制造漂移：判据改了而测试仍跑旧正文，测试会绿着说一个已经不存在的事（本仓库反复栽过）。
//
// 夹具全自造（mktemp -d）：⛔ 不写 `tasks/`（免触 task-file-bypass-check）、⛔ 不依赖生产
// `goals/` 与生产载体（`.quay/productization-verification.jsonl` 是 gitignored 的运行产物，
// 其新鲜度随 develop 前进变化 ⇒ 让套件依赖它 = 造一个环境相关的红）。唯一读生产内容的是
// 「真内容」一例（case D），它只复制 `goals/AC-*.md`（已提交、处处可读），并自带夹具载体。
//
// Run: scripts/test.sh plugin/test/ac214-freshness-subject-set.test.mjs
//      node --test plugin/test/ac214-freshness-subject-set.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const CARRIER_REL = ".quay/productization-verification.jsonl";
const GUARD_MSG = "carrier-type AC with no freshness bound in NEED";
const NEED_IDS = [201, 203, 205, 207, 232, 238];

/**
 * 取真 AC-214 判据正文（唯一命中；`ls goals/AC-214-*.md | wc -l` == 1）。
 * @returns {string}
 */
function realAc214Criterion() {
  const goalsDir = path.join(REPO_ROOT, "goals");
  const files = fs.readdirSync(goalsDir).filter((f) => f.startsWith("AC-214-") && f.endsWith(".md"));
  assert.equal(
    files.length,
    1,
    `AC-214 判据必须唯一可定位（实际 ${files.length} 个：${files.join(", ")}）`,
  );
  const raw = fs.readFileSync(path.join(goalsDir, files[0]), "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  assert.ok(m, `${files[0]} 缺 YAML frontmatter 块`);
  const fm = YAML.parse(m[1]);
  assert.ok(
    typeof fm.criterion === "string" && fm.criterion.trim() !== "",
    `${files[0]} 的 criterion 必须是非空字符串（取不到正文就无法执行判据）`,
  );
  return fm.criterion;
}

/** 在夹具 root 上执行判据（判据正文本身是一段 shell 脚本）。 */
function runCriterion(root, criterion) {
  return spawnSync("bash", ["-c", criterion], { cwd: root, encoding: "utf8" });
}

/**
 * 一条【夹具自造】的载体型 AC 记录：判据正文只读载体、不读源码/清单（与 AC-214 推导规则里的
 * `CARRIER ∈ 正文 ∧ 正文不匹配 SRC_RE` 同形）。criterion 写成单行，避免夹具再引入 YAML 折叠加戏。
 */
function probeAcFile(id) {
  return [
    "---",
    `id: AC-${id}`,
    `title: probe ${id}（夹具自造，载体型）`,
    "status: achieved",
    "kind: criterion",
    "goal: GOAL-009",
    `criterion: python3 -c "import os,sys; p='${CARRIER_REL}'; sys.exit(3 if not os.path.exists(p) else 0)"`,
    `expect: exit 0 = 载体里存在 AC-${id} 的记录。`,
    "origin: fixture probe (synthetic; carrier-only by construction).",
    "---",
    "",
  ].join("\n");
}

/**
 * 建一个夹具 root：`goals/`（自造 AC）、`.quay/productization-verification.jsonl`、`packages/quay/package.json`。
 * @param {{ids?: number[], carrierIds?: number[], carrierExtra?: Array<object>, goalsFromRepo?: boolean, sha?: string}} o
 */
function makeFixture(o = {}) {
  const ids = o.ids ?? NEED_IDS;
  const carrierIds = o.carrierIds ?? NEED_IDS;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ac244-"));
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "packages", "quay", "package.json"),
    JSON.stringify({ name: "quay", files: ["bin", "src"] }),
    "utf8",
  );
  if (o.goalsFromRepo) {
    for (const f of fs.readdirSync(path.join(REPO_ROOT, "goals"))) {
      if (f.startsWith("AC-") && f.endsWith(".md")) {
        fs.copyFileSync(path.join(REPO_ROOT, "goals", f), path.join(root, "goals", f));
      }
    }
  } else {
    for (const id of ids) fs.writeFileSync(path.join(root, "goals", `AC-${id}-probe.md`), probeAcFile(id), "utf8");
  }
  const lines = carrierIds.map((id) =>
    JSON.stringify({ ac: `GOAL-009-AC-${id}`, ts: "2026-09-11T00:00:00Z", ...(o.sha ? { build_sha: o.sha } : {}) }),
  );
  for (const extra of o.carrierExtra ?? []) lines.push(JSON.stringify(extra));
  fs.writeFileSync(path.join(root, CARRIER_REL), lines.map((l) => l + "\n").join(""), "utf8");
  return root;
}

function withFixture(o, fn) {
  const root = makeFixture(o);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const CRITERION = realAc214Criterion();

// ── AC5 正控制：守卫不误红（控制流越过守卫、到达新鲜度阶段） ────────────────────────────────────────

test("AC5: 6 条 NEED 均在载体但无 build_sha ⇒ exit 1 且 stderr 为 `no evidence yet:`（守卫不误红）", () => {
  withFixture({}, (root) => {
    const r = runCriterion(root, CRITERION);
    assert.equal(r.status, 1, `判据应 exit 1（stderr=${JSON.stringify(r.stderr)}）`);
    assert.ok(
      r.stderr.startsWith("no evidence yet:"),
      `stderr 必须停在新鲜度阶段（实际 ${JSON.stringify(r.stderr)}）——若为守卫文本 ⇒ 守卫误红了 NEED 内的成员`,
    );
    for (const id of NEED_IDS) {
      assert.ok(r.stderr.includes(`GOAL-009-AC-${id}`), `stderr 应列出无证据的 GOAL-009-AC-${id}`);
    }
    assert.ok(!r.stderr.includes(GUARD_MSG), `守卫不得在本例触发（实际 ${JSON.stringify(r.stderr)}）`);
  });
});

// ── AC4 取假：载体型 AC 不在 NEED ⇒ 守卫 fail-closed 并指名 ───────────────────────────────────────

test("AC4: 夹具多一条载体型 AC-239（不在 NEED）且有载体记录 ⇒ exit 1，stderr 指名它", () => {
  withFixture(
    {
      ids: [...NEED_IDS, 239],
      carrierIds: [...NEED_IDS, 239],
    },
    (root) => {
      const r = runCriterion(root, CRITERION);
      assert.equal(r.status, 1, `判据应 exit 1（stderr=${JSON.stringify(r.stderr)}）`);
      assert.ok(
        r.stderr.includes(GUARD_MSG),
        `stderr 必须含守卫文本 ${JSON.stringify(GUARD_MSG)}（实际 ${JSON.stringify(r.stderr)}）`,
      );
      assert.ok(
        r.stderr.includes("GOAL-009-AC-239"),
        `守卫必须【指名】逃出的那条（实际 ${JSON.stringify(r.stderr)}）——只看「有报错」会把指错对象判成合格`,
      );
      // 非空转：AC-239 的判据正文里就有 `.quay/productization-verification.jsonl` —— 若 SRC_RE 用子串
      // 而非 `\b` 词边界，`.json` 会命中载体自己的 `.jsonl` ⇒ 候选集恒空 ⇒ 本断言（守卫触发）必然失败。
      // 即：本例同时钉住了 AC-214 推导里那个 `\b`。
      assert.ok(!r.stderr.includes("no evidence yet:"), "守卫先于新鲜度阶段，不应走到 no evidence yet");
    },
  );
});

// ── 差分对照：主体集合是【读载体推导】的，不是「goals/ 里有这个文件就算」 ────────────────────────────

test("差分: 保留 AC-239 文件但去掉它的载体记录 ⇒ 守卫沉默（主体集合取自载体）", () => {
  withFixture({ ids: [...NEED_IDS, 239], carrierIds: [...NEED_IDS] }, (root) => {
    const r = runCriterion(root, CRITERION);
    assert.equal(r.status, 1);
    assert.ok(
      r.stderr.startsWith("no evidence yet:"),
      `AC-239 无载体记录 ⇒ 不属载体型主体集合 ⇒ 守卫应沉默（实际 ${JSON.stringify(r.stderr)}）`,
    );
  });
});

// ── 真内容对照：把真 goals/AC-*.md 复制进夹具 ⇒ 守卫沉默（生产内容上推导不退化为恒红） ─────────────

test("真内容: goals/ 用真仓库 AC-*.md + 夹具载体列 6 条 ⇒ 守卫沉默，停在 `no evidence yet:`", () => {
  withFixture({ goalsFromRepo: true }, (root) => {
    const r = runCriterion(root, CRITERION);
    assert.equal(r.status, 1, `判据应 exit 1（stderr=${JSON.stringify(r.stderr)}）`);
    assert.ok(
      r.stderr.startsWith("no evidence yet:"),
      `生产 goals/ 内容上守卫不得误红（实际 ${JSON.stringify(r.stderr)}）`,
    );
    assert.ok(!r.stderr.includes(GUARD_MSG));
  });
});

// ── 真判据正文的形状：AC1 要的两个标识符确实在判据里（SUBJ 推导块与守卫） ───────────────────────────

test("判据正文含 SUBJ 推导块与 unwired 守卫（AC1 的文本面）", () => {
  assert.ok(/SUBJ\s*=\s*set\(\)/.test(CRITERION), "判据里应有 `SUBJ = set()` 机械推导块");
  assert.ok(
    /unwired\s*=\s*sorted\(SUBJ\s*-\s*set\(NEED\)\)/.test(CRITERION),
    "判据里应有 `unwired = sorted(SUBJ - set(NEED))` 守卫",
  );
  const needLine = CRITERION.split("\n").find((l) => l.trim().startsWith("NEED = ["));
  assert.ok(needLine, "判据里应有 `NEED = [...]` 行");
  for (const id of NEED_IDS) {
    assert.ok(needLine.includes(`GOAL-009-AC-${id}`), `NEED 行应含 GOAL-009-AC-${id}（实际 ${needLine}）`);
  }
});
