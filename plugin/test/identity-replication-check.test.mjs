// @test-group engine
// identity-replication-check.test.mjs — P2 身份复制检测器 (docs/proposals/archguard-generation-era-primitives.md §3 P2)。
// Covers the pure detection primitives on synthetic fixtures (never the live repo — deterministic):
//   - tsCommentMask / shCommentMask: 注释被标为非代码, 字符串字面量保持代码 (字面量是被测对象)。
//   - findPathConstants: *_REL 路径常量按位置命中, 注释提及不命中。
//   - findJudgmentRewrites: 读 /proc/<pid>/cmdline ∧ 比较名字 = 判定重写; 仅注释/无比较不命中。
//   - classifyRewriteSite / isMergeableRewriteSite: 判定重写的**可合并性**分类 (test / .sh /
//     已 import leaf / repo-import-free .mjs 四类 carve-out, 按类不按文件名; `--no-carve-out` 两态)。
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
  blankComments,
  accessorRegexSource,
  isPathInvocationMention,
  occurrenceRole,
  findPathConstants,
  findJudgmentRewrites,
  findMergeableJudgmentRewrites,
  classifyRewriteSite,
  isMergeableRewriteSite,
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

// ── 可合并性 carve-out: 「哪些站点算判定重写」的类别判定 ──────────────────────────────────────────
// 立案缺陷 (gap-identity-rewrite-count-includes-carve-outs): 计数语义曾把**结构上不可能合并到
// kernel leaf** 的站点点名成缺陷 —— 现场 8 条全部如此（4 个 test 载体 / 2 个 .sh / 1 个已 import leaf
// / 1 个 repo-import-free 的随包 .mjs），于是已 done 的 proc-identity 迁移机制每轮被 judge 重报一次。
//
// ⛔ 两个方向都要钉住（硬规则 2 的另一半是「零计数也要干跑已知真样本」）：
//   · 真可合并站点**必须**在列（否则收窄把检测器砍空 ⇒ 与「没有判定重写」同形）；
//   · 四条 carve-out 类各自的站点**必须**出列，且出列得**说得出是被哪条规则排除的**（枚举，非布尔）。
//
// AC4 fixture 矩阵: **同一段**「读 cmdline ∧ 绑到这次读的比较」内联进四个临时文件，只有载体属性
// 不同 —— 这保证出列是载体分类的功劳，而不是判据恰好看不见那三个文件。

/** 那段被判据识别的实现（AC4 逐字要求「同一段」）：读 /proc/<pid>/cmdline ∧ 绑到这次读的比较。
 *  ⛔ shell 的绑定形态与 TS 不同（`COMPARE_PRIM` 词表进不去 `case … in`，shell 那一支走
 *  `SHELL_CMP` 的管道形态）—— 同一条**指纹**，载体语言决定了它的绑定表达式。 */
const GRAFTED_TS_JUDGMENT =
  'const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");\nif (cmd.includes("claude")) return true;\n';
const GRAFTED_SH_JUDGMENT =
  '#!/usr/bin/env bash\nif tr \'\\0\' \' \' < "/proc/$pid/cmdline" 2>/dev/null | grep -q claude; then echo 1; fi\n';

function carveOutFixture() {
  return {
    "plugin/scripts/genuine.ts": GRAFTED_TS_JUDGMENT,
    "plugin/scripts/genuine.test.mjs": GRAFTED_TS_JUDGMENT,
    "plugin/scripts/genuine.sh": GRAFTED_SH_JUDGMENT,
    "plugin/scripts/genuine-imports-leaf.ts":
      'import { readProcCmdline } from "../../packages/quay/src/kernel/proc-identity.ts";\n' + GRAFTED_TS_JUDGMENT,
  };
}

const CARVE_OUT_FIXTURE_FILES = Object.keys(carveOutFixture());

test("AC4 — carve-out 矩阵: 同一段判定在四种载体里的命运 (双向, 非空转)", () => {
  const dir = mktmp(carveOutFixture());
  const mergeable = (rel) =>
    findMergeableJudgmentRewrites(dir, [path.join(dir, rel)]).length > 0;

  assert.equal(mergeable("plugin/scripts/genuine.ts"), true,
    "真可合并站点 (非 test / 非 .sh / 未 import leaf) 必须【在列】—— 否则这条收窄就是把检测器关掉");
  assert.equal(mergeable("plugin/scripts/genuine.test.mjs"), false,
    "test 载体必须出列 (G3: 判据与被判对象必须独立实现)");
  assert.equal(mergeable("plugin/scripts/genuine.sh"), false,
    "`.sh` 载体必须出列 (shell 不能 import TS kernel leaf)");
  assert.equal(mergeable("plugin/scripts/genuine-imports-leaf.ts"), false,
    "已 import kernel leaf 的载体必须出列 (残余 /proc 读取不是被迁移判定的独立重写)");

  // ⛔ 出列 ≠ 没扫到: 检测器仍报出全部四处, 只是分类不同 (硬规则 3b —— 两态必须可区分)。
  const all = findJudgmentRewrites(dir, CARVE_OUT_FIXTURE_FILES.map((p) => path.join(dir, p)));
  assert.equal(all.length, 4, `检测面不得被收窄吞掉任何站点, got ${JSON.stringify(all.map((j) => j.file))}`);
  assert.equal(all.filter((j) => !j.mergeable).length, 3, "其中三处是 carve-out");

  const byFile = Object.fromEntries(all.map((j) => [j.file, j]));
  assert.equal(byFile["plugin/scripts/genuine.test.mjs"].carveOut, "test");
  assert.equal(byFile["plugin/scripts/genuine.sh"].carveOut, "shell");
  assert.equal(byFile["plugin/scripts/genuine-imports-leaf.ts"].carveOut, "imports-leaf");
  for (const j of all) {
    assert.equal(j.mergeable, j.carveOut === null, `${j.file}: mergeable ⇔ carveOut===null`);
    assert.equal(typeof j.carveOutReason === "string" && j.carveOutReason.length > 0, !j.mergeable,
      `${j.file}: 每条 carve-out 必须带理由, 可合并站点不带 (理由为空 = 「排除」与「没扫到」同形)`);
  }
});

test("AC3 — 两态可区分: 关掉一条规则 ⇒ 该条下的站点回到可合并列表", () => {
  const dir = mktmp(carveOutFixture());
  const off = ["test", "shell", "imports-leaf"];
  const on = findMergeableJudgmentRewrites(dir, CARVE_OUT_FIXTURE_FILES.map((p) => path.join(dir, p)));
  const disabled = findMergeableJudgmentRewrites(
    dir,
    CARVE_OUT_FIXTURE_FILES.map((p) => path.join(dir, p)),
    { disabledCarveOuts: off },
  );
  assert.deepEqual(on.map((j) => j.file), ["plugin/scripts/genuine.ts"]);
  assert.deepEqual(
    disabled.map((j) => j.file).sort(),
    ["plugin/scripts/genuine-imports-leaf.ts", "plugin/scripts/genuine.sh", "plugin/scripts/genuine.test.mjs", "plugin/scripts/genuine.ts"],
    "关掉三条规则 ⇒ 对应三处回到可合并列表 (谓词不是恒假: 它的取值随输入变)",
  );

  // `isMergeableRewriteSite` 与分类本体同源 (AC2: 一处定义, 消费者 import)。
  assert.equal(isMergeableRewriteSite(dir, "plugin/scripts/genuine.ts"), true);
  assert.equal(isMergeableRewriteSite(dir, "plugin/scripts/genuine.sh"), false);
  assert.equal(isMergeableRewriteSite(dir, "plugin/scripts/genuine.sh", undefined, ["shell"]), true);
});

test("AC2 — carve-out 按【类】判定, 不按文件名白名单", () => {
  const dir = mktmp({
    // 同一段内容放在**从未出现过的**文件名/目录下 ⇒ 分类必须照样成立 (按文件名硬编码会漏掉它)。
    "plugin/scripts/never-seen-before-carrier.ts": GRAFTED_TS_JUDGMENT,
    "plugin/scripts/nested/test/another-unseen-name.ts": GRAFTED_TS_JUDGMENT, // test 段在任何位置都算
    "plugin/scripts/weird.spec.ts": GRAFTED_TS_JUDGMENT, // basename 约定, 不依赖 test/ 目录
  });
  assert.equal(isMergeableRewriteSite(dir, "plugin/scripts/never-seen-before-carrier.ts"), true);
  assert.equal(isMergeableRewriteSite(dir, "plugin/scripts/nested/test/another-unseen-name.ts"), false);
  assert.equal(
    classifyRewriteSite(dir, "plugin/scripts/nested/test/another-unseen-name.ts").carveOut,
    "test",
  );
  assert.equal(classifyRewriteSite(dir, "plugin/scripts/weird.spec.ts").carveOut, "test");
  // 反向: 一个带 `test` 字样的**普通**目录名不构成 test 载体 (`testimony/` 不是 `test/`)。
  const dir2 = mktmp({ "plugin/scripts/testimony/plain.ts": GRAFTED_TS_JUDGMENT });
  assert.equal(isMergeableRewriteSite(dir2, "plugin/scripts/testimony/plain.ts"), true,
    "路径段必须【整个】等于 test/tests/__tests__, 前缀相似的目录名不排除");
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
    // ④ 负控制 (AC3 的反向实例): 整段字符串字面量**就是** basename、从不 source/import ⇒ 仍是 hardcoded。
    //    ⛔ 这条在 gap-identity-hardcoded-needs-occurrence-role-filter 后仍成立的**理由**要说清:
    //    该字面量的内容恰为实体名 ⇒ 出现角色 = name-value (身份值)。移动的是**另一条**边界 ——
    //    嵌在更长叙述串里的提及 (test 标题 / 断言消息 / 错误消息, 见 usage-text.ts 那条) 不再是证据。
    "plugin/scripts/string-only.sh": '#!/usr/bin/env bash\necho "shared-lib.sh"\n',
    // ⑤ 负控制【放宽过头】: 真 source 的【行尾注释】里提到 basename, 不得因此升为 accessor。
    //    第 3 行的提及必须是**身份值**形态 (整段字面量 = 实体名), 否则整文件会被**出现角色**
    //    过滤器提前剔除, 这条守卫就成了空转 (与「忽略」同形) —— 散文串 (`echo "loads shared-lib.sh"`)
    //    在本任务后已不是命名点。两种过头放宽都会在第 2 行命中: `[^\n]*?` 直接吞到行尾; 只要求引号成对
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

// ── 判据产地的三处修正 (gap-identity-replication-requires-structural-relation) ────────────────
// 立案缺陷: 判词「named in 52 code file(s) without a single accessor」的两半都不成立 ——
//   ① 「without a single accessor」是**写死的字面量**, 与行上的 accessor 无关 (17 簇里 14 簇如此);
//   ② 52 个「hardcoded」里 0 个是复制 —— 注释行与**按路径调用**各行其是地混在一起。
// 下面五条各自钉住一个产地, 且**每一条在修前实现上都是红的** (负控制: 证明它测的是这个缺陷):
//   · AC3 地形  → tsCommentMask 的幻影字符串 (根因, 不是「疑似反引号让词法器失步」那类假说);
//   · AC1 地形  → 多行命名导入 (本仓主流写法) 读不进去;
//   · AC2 地形  → 按路径调用被计成 hardcoded;
//   · AC6③ 地形 → 判红行给不出命中样本 (计数与内容不同源);
//   · 反向边界  → 文本里的裸 basename 仍须是证据 (否证「一律放宽」把检测器关掉)。

test("tsCommentMask — 含引号的正则字面量不打开幻影字符串 (AC3 根因)", () => {
  // 与 plugin/scripts/task-ops.ts:97 同形: 正则里 `["']` 的引号成对出现后, 紧跟的 `'` 在【旧实现】里
  // 会打开一个单引号串并一路吞到下一个 `'` —— 中间整块注释因此被标成【代码位置】。
  const src =
    'const items = list.split(",").map((s) => s.trim().replace(/^["\']|["\']$/g, "")).filter(Boolean);\n' +
    "/** Ensure the frontmatter carries the label (moved from session-liveness.sh; single\n" +
    " *  source now lives here). */\n" +
    "// session-liveness.sh in a line comment\n";
  const mask = tsCommentMask(src);
  const idx = occurrences(src, NEEDLE);
  assert.equal(idx.length, 2, `two mentions (block + line comment), got ${idx.length}`);
  assert.equal(mask[idx[0]], 1, "块注释里的提及不是代码位置 (旧实现打开幻影字符串后此处为 0)");
  assert.equal(mask[idx[1]], 1, "行注释里的提及同样不是代码位置");
  // 反向: 同一份源码里的**字符串字面量**仍须算代码 (否证「把正则一并标死」)。
  const codeOnly = 'const p = "session-liveness.sh";\n';
  assert.equal(tsCommentMask(codeOnly)[occurrences(codeOnly, NEEDLE)[0]], 0,
    "字符串字面量仍是被测对象, 必须保持代码位置 (掩码不能把真样本一起剔掉)");
});

test("blankComments — 抹平注释但逐位保持长度与偏移 (结构性判定跑在它上面)", () => {
  const src = 'const a = 1; // session-liveness.sh here\necho "session-liveness.sh"\n';
  const blanked = blankComments(src, tsCommentMask(src));
  assert.equal(blanked.length, src.length, "长度不变 ⇒ 命中下标与 src 一一对应");
  assert.equal(blanked.split("\n").length, src.split("\n").length, "行号不变");
  assert.equal(blanked.includes("here"), false, "注释内容被抹掉");
  assert.equal(blanked.includes('"session-liveness.sh"'), true, "字符串字面量**不**被抹平 (抹平它等于关掉 accessor 判定)");
});

test("accessorRegexSource — 多行命名导入是 accessor, 且不吞掉另一个 import 的 specifier (AC1)", () => {
  const re = new RegExp(accessorRegexSource("shared-lib"));
  assert.equal(re.test('import { a } from "./shared-lib.ts";'), true, "单行命名导入");
  assert.equal(re.test('import {\n  a,\n  b,\n} from "./shared-lib.ts";'), true, "多行命名导入 (AC1 命令的形态)");
  // 本仓主流形态: 30+ 行、子句内部夹注释 (含撇号) —— 调用方先 blankComments, 所以这里的输入是抹平后的视图。
  const big =
    "import {\n  a,\n  // the pool's marker, reused\n  b,\n} from \"./shared-lib.ts\";\n";
  assert.equal(re.test(blankComments(big, tsCommentMask(big))), true, "带注释的多行导入块");
  assert.equal(re.test('export { a } from "./shared-lib.ts";'), true, "re-export 也是结构性关系");
  assert.equal(re.test('import "./shared-lib.ts";'), true, "无 from 的副作用 import");
  assert.equal(re.test('import { a } from "./other.ts";'), false, "别的 specifier 不算");
  // ⛔ 负控制【不许吞掉别的语句】: `export function` 不是 re-export 形态, 不得一路扫到后面 import 的 from。
  assert.equal(re.test('export function f() { return 1 }\nimport { z } from "./other.ts";\n'), false,
    "export 声明不得被读成 re-export (否则它会跨语句吞掉下一个 import 的 specifier)");
  assert.equal(re.test('const p = "shared-lib";\n'), false, "裸字符串提及不是 accessor");
});

// ── 出现角色过滤器 (gap-identity-hardcoded-needs-occurrence-role-filter, AC5 的旧边界重裁定) ──
// ⛔ 旧边界逐字是「**文本里的裸 basename 是身份**, 仍是证据」—— 它把 `console.error("Usage: node
// x.ts --json")` 这类**嵌在散文里的提及**算成独立命名。本任务把它重新裁定为:
//   · 出现角色 = `name-value` (字面量内容**恰为**实体名 / 赋值右侧的身份值 / 名字清单里的裸名)
//     ⇒ **是**独立命名 (证据);
//   · 出现角色 = `text` (嵌在更长的叙述/标题/消息/散文里) ⇒ **不是**证据。
// 反向边界同时钉住: 「全部不认」等于把检测器关掉 (硬规则 2 的零计数半边)。

test("occurrenceRole — 出现角色四态: 身份值 / 叙述串 / 按路径 / 注释 (AC1 逐态)", () => {
  const ent = "resource-gate.sh";
  const ts = (src) => { const m = tsCommentMask(src); return occurrenceRole(src, m, blankComments(src, m), src.indexOf(ent), ent); };
  const sh = (src) => { const m = shCommentMask(src); return occurrenceRole(src, m, blankComments(src, m), src.indexOf(ent), ent); };
  // 非证据: 叙述串 (test 标题 / 断言消息 / 期望值 / 错误消息) 与按路径调用、注释
  assert.equal(ts('test("AC99 — resource-gate.sh --json is valid", () => {});\n'), "text", "test 标题是叙述");
  assert.equal(ts('assert.ok(fs.existsSync(gate), "resolved resource-gate.sh exists on disk");\n'), "text", "断言消息是叙述");
  assert.equal(ts('return { reason: "resource-gate.sh not found (kernel install location) — fail-closed" };\n'), "text", "错误消息是叙述");
  assert.equal(sh("C3 resource-gate.sh --for full-suite。\n"), "text", "heredoc fixture 正文里的散文是叙述");
  assert.equal(ts('const s = path.join(pluginRoot, "scripts", "resource-gate.sh");\n'), "by-path", "按路径调用是位置 (未退化)");
  assert.equal(ts("// resource-gate.sh is the gate\nexport const a = 1;\n"), "comment", "注释由位置掩码排除");
  // 反向边界 (证据): 字面量内容**恰为**实体名 ⇒ 身份值; `NAME=<entity>` 的裸右侧同理。
  assert.equal(sh('NEVER_LAYDOWN="resource-gate.sh"\n'), "name-value", "裸 basename 被赋成身份值 ⇒ 仍是证据");
  assert.equal(sh("NEVER_LAYDOWN=resource-gate.sh\n"), "name-value", "无引号的赋值右侧 = 身份值");
  assert.equal(ts('export const GATE_NAME = "resource-gate.sh";\n'), "name-value", "整段字面量 = 独立命名");
  assert.equal(sh("printf '%s\\n' a.ts resource-gate.sh b.ts >> \"$out\"\n"), "name-value",
    "名字清单 (邻词也是脚本名) 里的裸名 = 登记, 不是散文");
});

test("isPathInvocationMention — 按路径调用是位置 (只此一维; 叙述串由 occurrenceRole 排除)", () => {
  const ent = "shared-lib.ts";
  const at = (src) => isPathInvocationMention(src, src.indexOf(ent), ent);
  assert.equal(at('const p = "plugin/scripts/shared-lib.ts";'), true, "A 路径尾 (仓库相对路径串)");
  assert.equal(at('const p = path.join(__dirname, "../scripts/shared-lib.ts");'), true, "A 路径尾 (path.join 的相对段)");
  assert.equal(at('const p = path.join(root, "plugin", "scripts", "shared-lib.ts");'), true, "B 实参位 (路径分段拼出)");
  assert.equal(at('const p = resolveKernelSibling("shared-lib.ts");'), true, "B 实参位 (kernel 同胞解析)");
  assert.equal(at('spawn("node", ["shared-lib.ts"]);'), true, "B 实参位 (spawn argv)");
  // 本谓词**只**判「按路径调用」: 下列三处都不是实参位 ⇒ 仍返回 false。它们**不是证据**这件事由
  // occurrenceRole 的 `text` 角色负责 (散文串) —— ⛔ 旧注释曾在这里写「仍是命名, 仍是证据」, 该边界
  // 已在 gap-identity-hardcoded-needs-occurrence-role-filter 重新裁定, 见上一个 test。
  assert.equal(at('console.error("Usage: node shared-lib.ts --json");'), false, "用法串不是实参位 (但它也不是证据: role=text)");
  assert.equal(at("echo \"shared-lib.ts\"\n"), false, "`echo \"x\"` 不是实参位");
  assert.equal(at("<h2>shared-lib.ts</h2>"), false, "UI 标签不是实参位 (但它也不是证据: role=text)");
});

test("literalReplication — 按路径调用/叙述串的文件不再计入, 身份值的仍计入 (AC2 + 反向边界)", () => {
  const dir = mktmp({
    "plugin/scripts/path-rel.ts": 'const p = "plugin/scripts/shared-lib.ts";\n',
    "plugin/scripts/path-join-tail.ts": 'const p = path.join(__dirname, "../scripts/shared-lib.ts");\n',
    "plugin/scripts/path-join-args.ts": 'const p = path.join(root, "plugin", "scripts", "shared-lib.ts");\n',
    "plugin/scripts/sibling-resolve.ts": 'const p = resolveKernelSibling("shared-lib.ts");\n',
    "plugin/scripts/usage-text.ts": 'console.error("Usage: node shared-lib.ts --json");\n',
    "plugin/scripts/comment-only.ts": "// shared-lib.ts is the single accessor\nexport const a = 1;\n",
  });
  const one = (rel) => literalReplication(dir, [path.join(dir, rel)], "shared-lib.ts");
  for (const rel of [
    "plugin/scripts/path-rel.ts",
    "plugin/scripts/path-join-tail.ts",
    "plugin/scripts/path-join-args.ts",
    "plugin/scripts/sibling-resolve.ts",
    "plugin/scripts/comment-only.ts",
  ]) {
    assert.equal(one(rel).code, 0, `${rel} 只有按路径调用/注释 ⇒ 连提及级 code 都不进`);
    assert.equal(one(rel).codeFiles.length, 0, `${rel} 不进 codeFiles`);
  }
  // 叙述串 (role=text): **提及级 code 仍是 1** (它确实出现在代码位置) 而**命名级**为 0 ⇒ 不进
  // codeFiles。这正是两个字段的分工: `code` 是读数面 (修前/修后同面), `codeFiles` 是命名级名单。
  assert.equal(one("plugin/scripts/usage-text.ts").code, 1, "散文用法串仍是代码位置提及 (读数面不动)");
  assert.equal(one("plugin/scripts/usage-text.ts").codeFiles.length, 0, "但它不进 codeFiles (非命名点)");
  // 反向边界 (**不许砍空**): 把裸 basename 赋成身份值的文件**仍须**计入 —— 否则这条修法就是把
  // 检测器关掉 (硬规则 2 的零计数半边)。两条对照只差「字面量内容是否恰为实体名」。
  assert.equal(one("plugin/scripts/usage-text.ts").hardcoded, 0, "散文用法串 ⇒ 非命名点");
  const two = mktmp({
    "plugin/scripts/identity-value.sh": '#!/usr/bin/env bash\nNEVER_LAYDOWN="shared-lib.ts"\n',
  });
  assert.equal(literalReplication(two, [path.join(two, "plugin/scripts/identity-value.sh")], "shared-lib.ts").hardcoded, 1,
    "身份值位点仍计入 (反向边界非空转)");
});

test("literalReplication — 判红行必须就地给出命中样本 (AC6③: 计数与内容同源)", () => {
  const dir = mktmp({
    // ⛔ 两条 fixture 必须是**身份值**形态 (整段字面量 = 实体名): 散文串 (`console.error("Usage: …")`)
    // 在本任务后已不是命名点, 用它当样本来源会让这条测试断言一个恒为 0 的量 (空转)。
    "plugin/scripts/a.ts": 'export const A_NAME = "shared-lib.ts";\n',
    "plugin/scripts/b.ts": 'const { b } = { b: "shared-lib.ts" };\n',
  });
  const files = ["plugin/scripts/a.ts", "plugin/scripts/b.ts"].map((p) => path.join(dir, p));
  const one = literalReplication(dir, files, "shared-lib.ts");
  assert.equal(one.hardcoded, 2, "两个文件独立命名它");
  assert.equal(one.hardcodedSamples.length, 2, "每个硬编码文件都带一条实测样本 (修前没有这个字段)");
  assert.match(one.hardcodedSamples[0], /^plugin\/scripts\/[ab]\.ts:\d+ {2}/, `样本形如 文件:行 + 该行原文, got ${one.hardcodedSamples[0]}`);
  assert.equal(one.hardcodedSamples[0].includes("shared-lib.ts"), true, "样本里含命中的实际内容, 不是一个空的占位");

  // 与 replicationTable 同源 (两条读数路径共用同一份分类)。
  const row = replicationTable(dir, files, ["shared-lib.ts"]).find((r) => r.entity === "shared-lib.ts");
  assert.deepEqual(row.hardcodedSamples, one.hardcodedSamples, "表读数与单实体读数给出同一批样本");
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
  // 两个列表互补: 并集 = 检测到的全部站点 (carve-out 是「排除」, 不是「没扫到」)。
  assert.ok(Array.isArray(report.judgmentRewriteCarveOuts));
  assert.ok(report.judgmentRewrites.every((j) => j.mergeable && j.carveOut === null));
  assert.ok(report.judgmentRewriteCarveOuts.every((j) => !j.mergeable && typeof j.carveOut === "string"));
  assert.equal(typeof report.byteIdentical.count, "number");
  assert.ok(report.literalReplication.sessionLiveness);
  assert.ok(report.sharedModuleControl);
  assert.ok(Array.isArray(report.table));
});

after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});
