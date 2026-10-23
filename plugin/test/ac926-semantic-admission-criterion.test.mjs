// @test-group engine
// ac926-semantic-admission-criterion.test.mjs — AC-926 判据【自身】的可取假验收载体
// (goals/AC-926-*.md; tasks/gap-ac926-import-criterion-take-false-carrier).
//
// 缺陷（本条钉住的）：AC-926 把 GOAL-911 的契约判据从「源码文本扫描」改成「真实 import」，理由正是
// 旧判据能被一个只在注释里提到词表的假模块骗绿。但【判据本身】此前没有任何测试运行它 —— 同级模块任务的
// plugin/test/semantic-admission-contract.test.mjs 直接 import 模块，结构上够不到「模块缺席」路径
// (exit 3) 与「判据文本是否仍是源码扫描」这两面。
//
// 本测试的每一条腿都是「判据被破坏时会红」的臂，不是「文件存在」的读数：
//   A 缺席臂    —— 空沙箱 ⇒ exit 3 且 stderr 含 NOT-EVALUATED；显式断言 code !== 1
//                  （硬规则 3b：没查成 ≠ 查过且不合格）。
//   B 注释-only —— 521 字节零导出 decoy ⇒ exit 1；并在【同一个】沙箱上跑 AC-919 的旧判据 ⇒ exit 0。
//                  这一臂就是「判据不许扫源码文本」的载体：判据若退回 readFileSync+includes 形态，
//                  它会变绿 —— 旧判据在同一输入上的相反读数把这一点做成读数，不是断言。
//   C 真模块    —— 把仓库真实 docs/analysis/semantic-admission-contract.mjs 复制进沙箱 ⇒ exit 0
//                  （硬规则 4 推论三：读生产载体，不造 fixture 冒充真模块）。
//   D 变异臂    —— 只在【副本】上改三处（去 freeze / 改词表 / 取消导出）⇒ 各自具名红；真模块零改动。
//   E 真树臂    —— 在真仓库根上跑判据 ⇒ exit 0（DoD「载体在真实仓库上读绿」）。
//   F 单一正源  —— 判据取自 goals/，测试内不出现副本；且判据文本是 import 形态（AC6）。
//
// 判据正文【不从测试里复制一份】：goalCriterion() 从真 goals/AC-9xx-*.md 的 YAML frontmatter 取。
// 仓库根由 import.meta.url 解析，⛔ 不依赖 process.cwd()。夹具一律 mkdtemp，finally 清理。
//
// ⚠️ 与 Proposal 的一处有意偏离（有据可查，不是偷工）：Proposal 的「判据文本取证」列出「不含
// `.includes(`」，但真判据里 `judge.includes(v)` 是**导入词表上的数组成员测试**（正是正确行为，
// 不是源码文本扫描）。照字面断言会得到一条恒假判据（硬规则 4c「恒假」形态，正确实现被判失败）。
// 因此 F 断言的是【文本扫描形态】缺席：`readFileSync(` / `createRequire` 都不出现，且 `await import(` 出现。
//
// Run: node --test plugin/test/ac926-semantic-admission-criterion.test.mjs
//      scripts/test.sh --for-task gap-ac926-import-criterion-take-false-carrier --allow-thin

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SELF_PATH = fileURLToPath(import.meta.url);

const MODULE_REL = "docs/analysis/semantic-admission-contract.mjs";
const REAL_MODULE = path.join(REPO_ROOT, MODULE_REL);

// 立项时 Proposal 事实三用的 521 字节 decoy：两套词表只出现在注释里，零相关导出。
// 它【故意】能骗过 AC-919 的旧判据（源码文本扫描），这正是 B 臂要证明的事。
const DECOY = [
  "// semantic-admission-contract — DECOY. Zero exports.",
  "// Everything a source-text scan looks for lives in comments and nowhere else:",
  "//   judge verdicts: confirmed / refuted / needs-more-evidence",
  "//   clue states:    candidate / clear / not-evaluated",
  '// A criterion using readFileSync(...).includes("confirmed") on this file reports OK.',
  "// A criterion that really imports it finds no arrays, no frozen vocabularies and no",
  "// checkVocabulariesDisjoint export — and must say so instead of passing.",
  "// AC-926 rejects it",
  "",
].join("\n");

// 真模块全文，在本文件被 import 时读一次：D 臂前后用它做「真模块零改动」的对照，C 臂用它复制进沙箱。
const REAL_SOURCE = fs.readFileSync(REAL_MODULE, "utf8");

/**
 * 取真 goal 的 criterion 正文 —— 判据的【唯一正源】。
 * ⛔ 测试里不得出现第二份判据文本（F 臂断言 `selfSource.includes(criterion) === false`）。
 * @param {string} id 形如 "AC-926"（⛔ 不硬编码中文 slug：文件名前缀才是稳定标识）
 * @returns {string}
 */
function goalCriterion(id) {
  const goalsDir = path.join(REPO_ROOT, "goals");
  const files = fs
    .readdirSync(goalsDir)
    .filter((f) => f.startsWith(`${id}-`) && f.endsWith(".md"))
    .sort();
  assert.equal(files.length, 1, `goals/ 下 ${id} 的判据必须唯一可定位（实际 ${files.length} 个：${files.join(", ")}）`);
  const raw = fs.readFileSync(path.join(goalsDir, files[0]), "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  assert.ok(m, `${files[0]} 缺 YAML frontmatter 块（取不到 criterion 就无法执行判据）`);
  const fm = parseYaml(m[1]);
  assert.ok(
    typeof fm.criterion === "string" && fm.criterion.trim() !== "",
    `${files[0]} 的 criterion 必须是非空字符串（实际 ${typeof fm.criterion}）`,
  );
  return fm.criterion;
}

const CRITERION_926 = goalCriterion("AC-926");
const CRITERION_919 = goalCriterion("AC-919");

/**
 * 逐字执行判据正文。判据文本是一整条 shell 命令（`node --input-type=module -e '…'`），
 * 所以必须交给 shell；cwd = 沙箱根，判据里的相对路径 `./docs/analysis/…` 因此解析到沙箱。
 * @param {string} root
 * @param {string} criterion
 */
function runCriterion(root, criterion) {
  const r = spawnSync("bash", ["-c", criterion], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.equal(r.error, undefined, `判据未能执行（spawn error）：${r.error && r.error.message}`);
  return r;
}

/**
 * mkdtemp 沙箱 + finally 清理。`moduleText` 非 null 时在沙箱里写一份 `docs/analysis/…`。
 * @param {(root: string) => void} fn
 * @param {{ moduleText?: string | null }} [o]
 */
function withSandbox(fn, { moduleText = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ac926-crit-"));
  try {
    if (moduleText !== null) writeSandboxModule(root, moduleText);
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** @param {string} root @param {string} text */
function writeSandboxModule(root, text) {
  const target = path.join(root, MODULE_REL);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
  return target;
}

/**
 * 突变副本时必须能证明「替换真的发生了」：`needle` 在真模块里恰好出现一次。
 * ⛔ 零命中会让变异臂静默跑【未变异】的真模块，然后拿真模块的 exit 0 当「臂红了」——那不是测量。
 * @param {string} haystack @param {string} needle
 */
function assertExactlyOnce(haystack, needle) {
  const count = haystack.split(needle).length - 1;
  assert.equal(count, 1, `变异臂的锚点必须在真模块里恰好出现一次（实际 ${count} 次）：${JSON.stringify(needle)}`);
}

// ── A 臂：模块缺席 ⇒ not-evaluated（exit 3），不与「不合格」(exit 1) 同形 ────────────────────────────
test("A 缺席臂：空沙箱 ⇒ exit 3 + NOT-EVALUATED，且明确不是 fail", () => {
  withSandbox((root) => {
    const r = runCriterion(root, CRITERION_926);
    const code = r.status;
    assert.equal(code, 3, `模块缺席必须读 3（not-evaluated），实际 ${code}；stderr=${r.stderr}`);
    assert.match(r.stderr, /NOT-EVALUATED/, `缺席必须具名 NOT-EVALUATED；stderr=${r.stderr}`);
    // 这一条是硬规则 3b 的断言本体：不是 fail（1）——否则「没查成」与「查过且不合格」同形。
    assert.ok(code !== 1, "not-evaluated 不是 fail（硬规则 3b）：exit 1 会让「没查成」与「查过且不合格」同形");
    assert.equal(r.stdout.trim(), "", `缺席臂不该有 stdout；实际=${JSON.stringify(r.stdout)}`);
  });
});

// ── B 臂：注释-only decoy ⇒ 新判据红；同一沙箱上旧判据（AC-919）绿 ────────────────────────────────
test("B 注释-only 臂：decoy ⇒ exit 1，同一沙箱上 AC-919 旧判据 ⇒ exit 0（判据被退回源码扫描时本臂会变绿）", () => {
  // decoy 的「零导出、纯注释」是它作为诱饵的语义不变量：有人往里面加了真导出，本臂就不再证明任何事。
  assert.equal(Buffer.byteLength(DECOY, "utf8"), 521, "decoy 必须是 Proposal 事实三的 521 字节版本");
  const nonComment = DECOY.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("//"));
  assert.deepEqual(nonComment, [], `decoy 必须【只有】注释（实际有非注释行：${JSON.stringify(nonComment)}）`);

  // 对照的前提：AC-919 的判据仍是源码文本扫描。若它今后被改成 import 形态，这条断言先红并说明原因，
  // 而不是让 B 臂静默失效（AC-914 式「钉死一个已不成立的假设」）。
  assert.ok(
    CRITERION_919.includes("readFileSync("),
    "AC-919 的判据应仍是 readFileSync 源码扫描形态 —— B 臂的对照依据。若 AC-919 已改为 import 形态，请重写 B 臂而不是删掉这条对照。",
  );

  withSandbox((root) => {
    writeSandboxModule(root, DECOY);

    const r926 = runCriterion(root, CRITERION_926);
    assert.equal(r926.status, 1, `同一个 decoy 上 AC-926 必须红；stderr=${r926.stderr}`);
    assert.match(
      r926.stderr,
      /CAUSE=CLUE_STATES\/JUDGE_VERDICTS are not arrays/,
      `AC-926 必须具名「词表不是数组」；stderr=${r926.stderr}`,
    );

    const r919 = runCriterion(root, CRITERION_919);
    assert.equal(r919.status, 0, `旧判据在同一个 decoy 上应当【假绿】(对照读数)；stderr=${r919.stderr}`);
    assert.match(r919.stdout, /OK: contract present/, `旧判据的假绿读数应在 stdout；实际=${JSON.stringify(r919.stdout)}`);
  });
});

// ── C 臂：仓库真模块复制进沙箱 ⇒ exit 0（读生产载体，不造 fixture） ───────────────────────────────
test("C 真模块臂：复制仓库真实模块进沙箱 ⇒ exit 0", () => {
  withSandbox((root) => {
    const target = path.join(root, MODULE_REL);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(REAL_MODULE, target);
    assert.equal(fs.readFileSync(target, "utf8"), REAL_SOURCE, "沙箱副本必须与真模块逐字节相同");

    const r = runCriterion(root, CRITERION_926);
    assert.equal(r.status, 0, `真模块必须读绿；stderr=${r.stderr}`);
    assert.match(r.stdout, /OK: real import —/, `真模块臂的 stdout 应具名 real import；实际=${JSON.stringify(r.stdout)}`);
  });
});

// ── D 臂：只在副本上变异，每处变异各自具名红；真模块零改动 ───────────────────────────────────────
const MUTATIONS = [
  {
    name: "① 去 freeze",
    from: 'export const CLUE_STATES = Object.freeze(["candidate", "clear", "not-evaluated"]);',
    to: 'export const CLUE_STATES = (["candidate", "clear", "not-evaluated"]);',
    expect: /CAUSE=vocabularies are not frozen/,
  },
  {
    name: "② 改词表（candidate 重复）",
    from: 'export const CLUE_STATES = Object.freeze(["candidate", "clear", "not-evaluated"]);',
    to: 'export const CLUE_STATES = Object.freeze(["candidate", "candidate", "not-evaluated"]);',
    expect: /CAUSE=CLUE_STATES=/,
  },
  {
    name: "③ 取消导出 checkVocabulariesDisjoint",
    from: "export function checkVocabulariesDisjoint",
    to: "function checkVocabulariesDisjoint",
    expect: /CAUSE=checkVocabulariesDisjoint is not exported/,
  },
];

test("D 变异臂：三处变异各自的副本 ⇒ exit 1 且具名；变异实际发生，真模块零改动", () => {
  for (const m of MUTATIONS) {
    assertExactlyOnce(REAL_SOURCE, m.from);
    const mutated = REAL_SOURCE.replace(m.from, m.to);
    assert.notEqual(mutated, REAL_SOURCE, `【${m.name}】替换没有发生 —— 变异臂会静默跑真模块`);

    withSandbox(
      (root) => {
        const r = runCriterion(root, CRITERION_926);
        assert.equal(r.status, 1, `【${m.name}】变异的副本必须红；stderr=${r.stderr}`);
        assert.match(r.stderr, m.expect, `【${m.name}】必须具名红；stderr=${r.stderr}`);
      },
      { moduleText: mutated },
    );
  }
  // 硬规则 4 推论三的反面：以上三臂若碰过真模块，这条对照会红。
  assert.equal(
    fs.readFileSync(REAL_MODULE, "utf8"),
    REAL_SOURCE,
    "变异臂只许改副本 —— 真模块 docs/analysis/semantic-admission-contract.mjs 必须零改动",
  );
});

// ── E 臂：真仓库根 ⇒ exit 0（DoD「载体在真实仓库上读绿」） ───────────────────────────────────────
test("E 真树臂：在真仓库根跑 AC-926 判据 ⇒ exit 0", () => {
  assert.ok(fs.existsSync(REAL_MODULE), `真仓库根应有 ${MODULE_REL}`);
  const r = runCriterion(REPO_ROOT, CRITERION_926);
  assert.equal(r.status, 0, `真仓库根上 AC-926 判据必须读绿；stderr=${r.stderr}`);
  assert.match(r.stdout, /OK: real import —/, `实际 stdout=${JSON.stringify(r.stdout)}`);
});

// ── F 臂：判据单一正源 + 判据文本是 import 形态（AC6） ────────────────────────────────────────────
test("F 单一正源：测试内零判据副本，且判据文本是 import 形态（非源码扫描）", () => {
  const selfSource = fs.readFileSync(SELF_PATH, "utf8");
  assert.equal(
    selfSource.includes(CRITERION_926),
    false,
    "verbatim_criterion_copies 必须为 0 —— 判据正文只能来自 goals/AC-926-*.md",
  );
  assert.ok(
    selfSource.includes("AC-926-"),
    "测试文件应可被 `grep -n \"AC-926-\" plugin/test/ac926-semantic-admission-criterion.test.mjs` 命中（≥1）",
  );

  // 判据【是】import 形态（正面），且【不是】源码文本扫描（反面）。
  assert.match(CRITERION_926, /await import\(/, "AC-926 判据必须真实 import 契约模块");
  assert.equal(CRITERION_926.includes("readFileSync("), false, "AC-926 判据不得退回 readFileSync 源码扫描");
  assert.equal(CRITERION_926.includes("createRequire"), false, "AC-926 判据不得用 createRequire 取模块");
  assert.match(CRITERION_926, /NOT-EVALUATED/, "AC-926 判据必须自带 not-evaluated 取值");
  assert.match(CRITERION_926, /process\.exit\(3\)/, "AC-926 的 not-evaluated 必须是 exit 3，不是 1");
});
