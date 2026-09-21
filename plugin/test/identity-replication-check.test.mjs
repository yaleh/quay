// @test-group engine
// identity-replication-check.test.mjs — P2 身份复制检测器 (docs/proposals/archguard-generation-era-primitives.md §3 P2)。
// Covers the pure detection primitives on synthetic fixtures (never the live repo — deterministic):
//   - tsCommentMask / shCommentMask: 注释被标为非代码, 字符串字面量保持代码 (字面量是被测对象)。
//   - findPathConstants: *_REL 路径常量按位置命中, 注释提及不命中。
//   - findJudgmentRewrites: 读 /proc/<pid>/cmdline ∧ 比较名字 = 判定重写; 仅注释/无比较不命中。
//   - findByteIdenticalPairs: plugin/scripts ↔ experiments/*/scripts 字节相同对计数 + 行数;
//     任一侧是软链的条目不是 pair (单一来源引用/同一 inode, 与 mirror-pair-drift-check.ts 同规则)。
//   - literalReplication: full vs code 分列 (证明脚本自己做位置区分, 不靠人工)。
//   - sharedModuleControl: 经 import 单一访问器的真共享模块不得报高复制度 (AC4 负控制)。
//   - isFlagged: 阈值谓词的单一实现, 两态都用真读数 (10/231 清白 vs 59/3 成簇)。
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
  replicationTable,
  sharedModuleControl,
  isFlagged,
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

// ── 收窄: 「比」必须绑在【这一次读】上 (gap-judgment-rewrites-route-through-proc-identity-leaf) ─────
// 立案缺陷: 外部事实 B 曾是【文件级】判定 —— 整文件出现任一个比较原语即算「识别进程」。于是纯快照收集器
// (把全部 cmdline 收进数组、比较发生在【另一个函数】里) 只要同文件恰好有一处 `.includes(` 就上榜
// (现场读数: plugin/scripts/fast-mode-telemetry.ts:215 —— 本轮修前它确实在列, 修后出列)。
// 收窄把「比较原语必须作用在【这次读的结果】上」定为判据, 三条绑法: 链式 / 具名 / shell 管道。
// 两个方向都要钉住 —— 只证明「少了」而不证明「没砍空」的收窄会把判据关掉 (硬规则 2 的零计数半边):
//   · col-collector 必须【出列】(文件里确有比较原语, 只是不在这次读上);
//   · hit-* 三条绑法各自的【已知真样本】必须【仍在列】。

/** {relPath: content} —— 收窄的双向 fixture, 每条只说一件事。 */
function narrowingFixtures() {
  return {
    // 负控制 (收窄前会误报的那一个): 收集全部 cmdline 进数组, 比较在另一个函数里。
    "plugin/scripts/col-collector.ts":
      "export function snapAll() {\n" +
      "  const out = [];\n" +
      "  for (const pid of pids()) out.push(fs.readFileSync(`/proc/${pid}/cmdline`, \"utf8\").replace(/\\0/g, \" \"));\n" +
      "  return out;\n" +
      "}\n" +
      "export function alive(cmds, needle) { for (const c of cmds) if (c.includes(needle)) return true; return false; }\n",
    // ② 具名绑定: 读结果赋给 IDENT, IDENT 是比较原语的操作数。
    "plugin/scripts/hit-subject.ts":
      "const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, \"utf8\");\nif (cmd.includes(\"claude\")) return true;\n",
    // ③ 链式绑定: 读表达式之后【紧接着】链上比较原语 (无中间变量 ⇒ 具名绑法不成立, 只有链式能命中)。
    "plugin/scripts/hit-chain.ts":
      "export function argv0(pid) { return fs.readFileSync(`/proc/${pid}/cmdline`, \"utf8\").split(\"\\0\")[0] ?? \"\"; }\n",
    // ④ shell 管道绑定: 同一条语句里读 + 比 (管道把结果交给下一个进程, 不经过变量)。
    "plugin/scripts/hit-pipe.sh":
      "#!/usr/bin/env bash\nif tr '\\0' ' ' < \"/proc/$pid/cmdline\" 2>/dev/null | grep -q claude; then echo 1; fi\n",
    // ⑤ 负控制: 读【绑定了】主体, 但比较发生在【别的主体】上 ⇒ 仍不是「比这次读的结果」。
    "plugin/scripts/col-other-subject.ts":
      "const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, \"utf8\");\nreturn otherText.includes(needle);\n",
  };
}

const NARROWING_FIXTURE_FILES = Object.keys(narrowingFixtures());

test("findJudgmentRewrites — 收窄双向: 纯快照收集器出列 ∧ 三条绑法的真站点保留 (硬规则 2 干跑对照)", () => {
  const dir = mktmp(narrowingFixtures());
  const flagged = (rel) =>
    findJudgmentRewrites(dir, [path.join(dir, rel)]).length > 0;

  assert.equal(flagged("plugin/scripts/col-collector.ts"), false,
    "a pure snapshot collector must NOT be reported: its comparison is in another function, not on this read");
  assert.equal(flagged("plugin/scripts/col-other-subject.ts"), false,
    "a read bound to a subject that is NOT the one compared is still not 'this read is compared'");

  assert.equal(flagged("plugin/scripts/hit-subject.ts"), true,
    "binding ② (subject) — the known-true sample must survive the narrowing");
  assert.equal(flagged("plugin/scripts/hit-chain.ts"), true,
    "binding ③ (chained) — a chain with no intermediate variable is only reachable through this prong");
  assert.equal(flagged("plugin/scripts/hit-pipe.sh"), true,
    "binding ④ (shell pipeline) — the .sh known-true sample must survive (the narrowing must not gut the judge)");

  // 整组读数: 全部命中文件都在这三条绑法里, 一个不多一个不少 (既不空转也不误报)。
  const found = findJudgmentRewrites(dir, NARROWING_FIXTURE_FILES.map((p) => path.join(dir, p)))
    .map((r) => r.file)
    .sort();
  assert.deepEqual(found, [
    "plugin/scripts/hit-chain.ts",
    "plugin/scripts/hit-pipe.sh",
    "plugin/scripts/hit-subject.ts",
  ], `expected exactly the three bound fixtures, got ${JSON.stringify(found)}`);
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

test("findByteIdenticalPairs — 软链不是 pair (单一来源引用), 真副本才报 (AC3 负控制)", () => {
  // a.ts: 两侧都是【常规文件】且逐字节相同 ⇒ 必须报 (真副本对照)
  // b.ts: experiments 侧是【软链】, 指向 plugin 侧那个逐字节相同的真文件 ⇒ 必须不报
  //       (链接目标是真实存在的同内容文件, 所以这是真负控制: 跟随软链的旧实现会把它报成一对)
  const dir = mktmp({
    "plugin/scripts/a.ts": "export const x = 1;\n",
    "experiments/quay-perpetual-stream/scripts/a.ts": "export const x = 1;\n",
    "plugin/scripts/b.ts": "export const y = 2;\n",
  });
  const mirror = path.join(dir, "experiments/quay-perpetual-stream/scripts");
  fs.symlinkSync(path.join(dir, "plugin/scripts/b.ts"), path.join(mirror, "b.ts"));

  // 负控制非空转的前置: 被跳过的那条【确实】逐字节相同 (即旧实现确实会报它)。
  const followed = fs.readFileSync(path.join(mirror, "b.ts"));
  assert.ok(followed.equals(fs.readFileSync(path.join(dir, "plugin/scripts/b.ts"))),
    "fixture must be byte-identical through the symlink, else the negative control is vacuous");

  const { pairs, totalLines, symlinksSkipped } = findByteIdenticalPairs(dir);
  const experiments = pairs.map((p) => p.experiment);
  assert.deepEqual(experiments, ["experiments/quay-perpetual-stream/scripts/a.ts"],
    `expected exactly the real-file copy a.ts, got ${JSON.stringify(pairs)}`);
  assert.equal(experiments.includes("experiments/quay-perpetual-stream/scripts/b.ts"), false,
    "the symlinked entry must NOT be reported as a pair");
  assert.equal(totalLines, 1);
  assert.equal(symlinksSkipped, 1, "the skipped symlink is counted, not silently dropped");
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

// ── 单一访问器的 shell 形态 (gap-identity-accessor-regex-source-computed-path) ────────────────
// 立案缺陷: 旧 importRe 的 source 分支要求「source/. 与路径同行、且路径里不含引号」, 于是本仓两种
// 【主流】引用写法全读不进去, gate-script-lib.sh 的 67 个正当引用被逐个计成 hardcoded=82/accessor=0。
// 下面五条 fixture 同时钉住两个方向: 正当引用升 accessor (① ②), 非引用不得被算成 accessor (③ ④ ⑤)。

const ACCESSOR_ENTITY = "shared-lib.sh";

/** {relPath: content} —— 五条 fixture, 每条只说一件事。 */
function accessorFixtures() {
  return {
    // ① idiom A: source + 内联 computed path, 引号【嵌套】—— 旧正则在内层第一个 " 处必然失败。
    "plugin/scripts/idiom-a.sh": '#!/usr/bin/env bash\nsource "$(dirname "$0")/shared-lib.sh"\n',
    // ② idiom B: 先赋值路径、后 source 变量 (本仓 61 个 .sh 的主流形态; 单行正则做不到, 靠反向引用)。
    "plugin/scripts/idiom-b.sh":
      '#!/usr/bin/env bash\n_lib="$(dirname "${BASH_SOURCE[0]}")/shared-lib.sh"\nif [ -f "$_lib" ]; then . "$_lib"; fi\n',
    // ③ 负控制: 只在【注释】里提及 ⇒ code 位置判定即剔除, 既不 accessor 也不 hardcoded。
    "plugin/scripts/comment-only.sh": "#!/usr/bin/env bash\n# shared-lib.sh is the single accessor\necho hi\n",
    // ④ 负控制 (AC3 的反向实例): 字符串字面量提到 basename、从不 source/import ⇒ 仍是 hardcoded。
    "plugin/scripts/string-only.sh": '#!/usr/bin/env bash\necho "shared-lib.sh"\n',
    // ⑤ 负控制【放宽过头】: 真 source 的【行尾注释】里提到 basename, 不得因此升为 accessor。
    //    第 3 行提供【代码位置】的提及, 否则整文件会被位置判定提前剔除, 这条守卫就成了空转
    //    (与「忽略」同形)。两种过头放宽都会在第 2 行命中: `[^\n]*?` 直接吞到行尾; 只要求引号成对
    //    则把 "$CONF" 读成一个引号段、再吃掉后面的 `#`。匹配起点是行首的 `.` (代码位置), 位置掩码
    //    拦不住 ⇒ 只有「引号成对 ∧ 未加引号片段不含 #」两条合起来才挡得住。
    "plugin/scripts/comment-tail.sh":
      '#!/usr/bin/env bash\n. "$CONF"  # loads shared-lib.sh\necho "shared-lib.sh"\n',
  };
}

const ACCESSOR_FIXTURE_FILES = Object.keys(accessorFixtures());

test("literalReplication — 单一访问器的三族形态: 内联 computed path / 赋值后 source 变量 / 非引用不升 accessor", () => {
  const dir = mktmp(accessorFixtures());
  // 逐文件判 (literalReplication 的 accessor/hardcoded 是文件级计数 ⇒ 单文件读数即该文件的分类)。
  const classify = (rel) => {
    const one = literalReplication(dir, [path.join(dir, rel)], ACCESSOR_ENTITY);
    if (one.code === 0) return "ignored";
    return one.accessor > 0 ? "accessor" : "hardcoded";
  };
  assert.equal(classify("plugin/scripts/idiom-a.sh"), "accessor",
    "idiom A (source + nested-quote inline path) must be a single-accessor reference");
  assert.equal(classify("plugin/scripts/idiom-b.sh"), "accessor",
    "idiom B (assign path to a var, then source that var) must be a single-accessor reference");
  assert.equal(classify("plugin/scripts/comment-only.sh"), "ignored",
    "a comment-only mention is removed by the position mask, not counted in either bucket");
  assert.equal(classify("plugin/scripts/string-only.sh"), "hardcoded",
    "a string-literal mention that never sources/imports stays hardcoded (not an accessor)");
  assert.equal(classify("plugin/scripts/comment-tail.sh"), "hardcoded",
    "mentioning the basename in a TRAILING COMMENT after a real source must NOT upgrade it to accessor " +
      "(the relaxation guard: `[^\\n]*?` here would match from the line-start `.`, which the position mask cannot catch)");

  // 整组计数: 两条真访问器, 两条硬编码, 一条被位置判定剔除 —— 双向都非空, 断言不空转。
  const r = literalReplication(dir, ACCESSOR_FIXTURE_FILES.map((p) => path.join(dir, p)), ACCESSOR_ENTITY);
  assert.equal(r.accessor, 2, `exactly the two real accessors, got ${r.accessor} (codeFiles=${JSON.stringify(r.codeFiles)})`);
  assert.equal(r.hardcoded, 2, `the two non-accessor code mentions stay hardcoded, got ${r.hardcoded}`);
  assert.equal(r.code, 4, "the comment-only fixture is dropped by the position mask");
  assert.equal(r.full, 5, "all five fixtures carry the literal in the full-text sense");
});

test("literalReplication vs replicationTable — 同一实体两条路径读数一致 (AC4: 分叉在结构上不可能)", () => {
  const dir = mktmp(accessorFixtures());
  const files = ACCESSOR_FIXTURE_FILES.map((p) => path.join(dir, p));
  const one = literalReplication(dir, files, ACCESSOR_ENTITY);
  const row = replicationTable(dir, files, [ACCESSOR_ENTITY]).find((r) => r.entity === ACCESSOR_ENTITY);
  assert.ok(row, "replicationTable must return a row for the entity");
  assert.deepEqual(
    { full: row.full, code: row.code, accessor: row.accessor, hardcoded: row.hardcoded },
    { full: one.full, code: one.code, accessor: one.accessor, hardcoded: one.hardcoded },
    "the single-entity entry and the full table must agree on the same entity (no forked judgement)",
  );
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

// ── 阈值谓词 isFlagged：单一实现的直接单测（gap-arch-review-cluster-ignores-detector-flag-predicate AC5）──
// 两个样本都是**实测过的真读数**（不是编出来的边界）：
//   `{hardcoded:10, accessor:231}` = gate-script-base.ts 的 sharedModuleControl —— 检测器判清白；
//   `{hardcoded:59, accessor:3}`   = table 里的 quay-init.sh —— 真复制，必须成簇。
// ⛔ 这条谓词是 cluster 阶段此前整个缺席的那一半判据；它一旦恒真/恒假，本文件与 cluster 侧同时失守。

test("isFlagged — 阈值谓词两态（真样本：10/231 清白 vs 59/3 成簇）", () => {
  assert.equal(isFlagged({ hardcoded: 10, accessor: 231 }), false, "hardcoded >= 5 但 hardcoded <= accessor ⇒ 清白（共享模块正常形态）");
  assert.equal(isFlagged({ hardcoded: 59, accessor: 3 }), true, "hardcoded >= 5 且 hardcoded > accessor ⇒ 真复制");
  // 第一半（阈值）单独能取假：hardcoded 低于阈值且压倒 accessor，仍不成簇。
  assert.equal(isFlagged({ hardcoded: 4, accessor: 0 }), false, "低于阈值 ⇒ 不成簇（第一半能取假）");
  // 第二半（> accessor）单独能取假：accessor 持平/反超即清白，与 hardcoded 多大无关。
  assert.equal(isFlagged({ hardcoded: 1000, accessor: 1000 }), false, "hardcoded == accessor ⇒ 清白（第二半能取假）");
  // 缺席按 0 计（手写 fixture 的行上没有 accessor）：不因缺字段而恒假或抛错。
  assert.equal(isFlagged({ hardcoded: 5 }), true, "accessor 缺席按 0 计（缺值 ≠ 未判）");
  assert.equal(isFlagged({}), false, "两个操作数都缺席 ⇒ 全 0 ⇒ 不成簇");
  // threshold 可调（sharedModuleControl 的既有参数面）。
  assert.equal(isFlagged({ hardcoded: 2, accessor: 0 }, 2), true, "threshold 参数透传");
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
