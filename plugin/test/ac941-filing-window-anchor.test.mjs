// @test-group engine
// ac941-filing-window-anchor.test.mjs — AC-941 判据的【时间窗锚点】回归锁
// (goals/AC-941-*.md; tasks/gap-ac941-filing-window-anchor-post-landing-row).
//
// 缺陷（本条钉住的）：AC-941 的判据把「实现落地」锚在 `git log -S reconcileGoalFiling` 的
// 【最旧】一条（`log[log.length-1]`），也就是**引入符号的代码提交**（本仓今日实测
// 840956f44 @ 2026-11-06T15:46:57+08:00 = 07:46:57Z）。但「代码提交时刻」≠「它进入工作区树的
// 时刻」：fan-in 是 `--ff-only`，一次 ff 把整条任务分支带进 develop，真正的落地时刻
// （59b5e4325 @ 13:02:42Z，develop 在 13:03:07Z 被 ff 到它）比代码提交晚 5 小时 16 分。
// 落在两者之间的、由**任务 worktree 证据跑**写下的终态行（at=2026-11-06T07:57:41.597Z）因此对
// 「代码提交」是 fresh、对「落地提交」不是 —— 判据会在落地后拿一条**落地前写的静态行**变绿，
// 正是 AC-941 自己的 origin 要排除的形态（硬规则 4 推论三：N 只计实现落地之后的时间窗；
// 硬规则 4c：判据点名的量必须穿过中间层还取得到）。
//
// 本文件的每条腿都是「能取假」的读数，不是「文件存在」：
//   夹具自检 —— fixture 里 `git log -S` 恰返回 C1；C2 的 %cI 严格晚于 C1（谓词先对已知为真的样本干跑）
//   ② 正臂   —— 终态行 at 晚于落地提交 ⇒ 现判据 exit 0 **且** landing-anchored 变体 exit 0
//   ① 取假臂 —— 终态行 at 落在 C1..C2 之间 ⇒ 现判据 exit 0（缺陷可复现：它报 landedAt=C1）
//               而 landing-anchored 变体 exit 1（报 landedAt=C2）
//   负控     —— 台账里没有终态行 ⇒ 两者都 exit 1（防「恒绿」）
//   落地前臂 —— 工作区树里根本没有 writer 符号 ⇒ 现判据 exit 1（"has no ledger writer"）
//
// 判据正文【不从测试里复制一份】：经 goal store（packages/quay-native/src/goal-store.ts 的
// re-export，单一真相源）从 goals/ 读；landing-anchored 变体不是第二份判据 —— 它是**同一段
// 判据**在运行时做一次【锚点段替换】得到的（与 ac939 的变异负控同款），所以 ① 臂上两条腿的
// 差别**只有锚点**。
//
// Run: node --test plugin/test/ac941-filing-window-anchor.test.mjs
//      scripts/test.sh --for-task gap-ac941-filing-window-anchor-post-landing-row --allow-thin

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createGoalStore } from "../../packages/quay-native/src/goal-store.ts";
import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF_SOURCE = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");

// ── 判据来源：goal store（唯一真相源） ────────────────────────────────────────────────────────
/**
 * 从真 goal store 取判据正文。⛔ 测试里不得出现判据副本。
 * @param {string} id 形如 "AC-941"
 * @returns {string}
 */
function criterionOf(id) {
  const store = createGoalStore(path.join(REPO_ROOT, "goals"));
  const rec = store.get(id);
  assert.ok(rec, `goal store 里取不到 ${id} —— 取不到判据就无法执行它，本文件必须红而不是跳过`);
  assert.equal(typeof rec.criterion, "string", `${id} 的 criterion 必须是字符串（实际 ${typeof rec.criterion}）`);
  assert.ok(rec.criterion.trim() !== "", `${id} 的 criterion 不得为空`);
  return rec.criterion;
}

const CRITERION_941 = criterionOf("AC-941");

// ── landing-anchored 变体：同一条判据，只把【锚点段】换掉 ─────────────────────────────────────
/** 现判据锚点段的起点（`git log -S … tail`）与终点（`… : NaN;`）。片段各出现一次，
 *  由下面的 assertExactlyOnce 守住 —— 判据形态变了就红，⛔ 不静默地替换错地方。 */
const ANCHOR_START = "const log = execSync(";
const ANCHOR_END = ": NaN;";

/** @param {string} haystack @param {string} needle */
function assertExactlyOnce(haystack, needle) {
  const count = haystack.split(needle).length - 1;
  assert.equal(count, 1, `锚点必须恰好出现一次（实际 ${count} 次）：${JSON.stringify(needle)}`);
}

/**
 * 把判据里的「代码提交锚点」换成「落地提交锚点」：`land` 改为读 `landingSha` 的 `%cI`。
 * 其余每个字符（终态行过滤、fresh 过滤、输出形态、退出码）**逐字不动** —— 这样 ①/② 两臂上
 * 现判据与变体的差别只有锚点一个变量（硬规则 4 推论四：给不出对照就只是假说）。
 * @param {string} criterion AC-941 的判据正文（从 store 读出）
 * @param {string} landingSha 落地提交（本夹具里就是 C2）
 * @returns {string}
 */
function landingAnchored(criterion, landingSha) {
  assertExactlyOnce(criterion, ANCHOR_START);
  assertExactlyOnce(criterion, ANCHOR_END);
  const start = criterion.indexOf(ANCHOR_START);
  const endAt = criterion.indexOf(ANCHOR_END, start);
  assert.ok(endAt > start, `锚点段的终点必须在其起点之后（start=${start} end=${endAt}）`);
  const replaced = `const land = Date.parse(execSync('git log -1 --format=%cI ${landingSha}',{encoding:'utf8'}).trim());`;
  return criterion.slice(0, start) + replaced + criterion.slice(endAt + ANCHOR_END.length);
}

// ── 夹具：真 git 仓库（C1 引入 writer 符号、C2 是落地提交） ───────────────────────────────────
// 时刻全部显式固定（GIT_*_DATE），⛔ 不依赖墙钟：这条链要区分的正是「时刻先后」，墙钟会让它
// 时绿时红。git 身份走**子进程 env**，⛔ 不写 repo config（memory: fixture-git-identity-in-child-env）。
const C1_DATE = "2026-11-06T07:46:57+00:00"; // = land_code（本仓今日实测）
const C2_DATE = "2026-11-06T13:02:42+00:00"; // = land_landing（本仓今日实测）
const ROW_BETWEEN = "2026-11-06T07:57:41.597Z"; // = 落地前那次 worktree 证据跑留下的终态行
const ROW_AFTER = "2026-11-06T14:00:00.000Z"; // 落地后的终态行

const WRITER_WITH_SYMBOL = [
  "// fixture stub — 判据只读 `typeof mod.reconcileGoalFiling === 'function'` 这一个性质。",
  "export function reconcileGoalFiling() {",
  "  return null;",
  "}",
  "",
].join("\n");

const WRITER_WITHOUT_SYMBOL = [
  "// fixture stub — 落地【前】的 goal-driver：文件在，但还没有台账写入方。",
  "export function runGoalRound() {",
  "  return null;",
  "}",
  "",
].join("\n");

/** 一份终态行（判据只读 `state` 与 `at`）。 */
function terminalRow(at) {
  return {
    state: "filed",
    requestId: "GOAL-914|AC-937|2026-11-06T07:49:45.859Z|0",
    ac: "AC-937",
    goal: "GOAL-914",
    at,
    spawnedAt: "2026-11-06T07:49:45.867Z",
    taskId: "gap-goal-filing-chain-audit",
    reason: null,
  };
}

/** 一个带 GIT_*_DATE 的 git 子进程封装（每调用一次一个 env）。 */
function mkGit(root) {
  const baseEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  return (args, { date } = {}) => {
    const env = date ? { ...baseEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : baseEnv;
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env });
    if (r.error) throw new Error(`git ${args.join(" ")} spawn error: ${r.error.message}`);
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} exit ${r.status}: ${String(r.stderr || "").trim().slice(0, 300)}`);
    }
    return String(r.stdout ?? "").trim();
  };
}

/**
 * 建一个临时工作区：真 git 仓库 + `plugin/scripts/goal-driver.ts` + `.quay/goal-filing.jsonl`。
 * @param {{ withWriter: boolean, terminalAt: string|null }} spec
 * @returns {{ root: string, git: (args: string[], opts?: {date?: string}) => string, c1: string, c2: string|null }}
 */
function makeFixture({ withWriter, terminalAt }) {
  const root = makeTmpDir("ac941-anchor-");
  const git = mkGit(root);
  git(["init", "-b", "main"]);

  const writerPath = path.join(root, "plugin", "scripts", "goal-driver.ts");
  fs.mkdirSync(path.dirname(writerPath), { recursive: true });
  fs.writeFileSync(writerPath, withWriter ? WRITER_WITH_SYMBOL : WRITER_WITHOUT_SYMBOL, "utf8");
  git(["add", "-A"]);
  git(["commit", "-m", "C1: 引入 writer 符号（**代码提交**，⛔ 不等于落地）"], { date: C1_DATE });
  const c1 = git(["rev-parse", "HEAD"]);

  let c2 = null;
  if (withWriter) {
    // 落地提交：动 writer 文件但**不改变符号出现次数** ⇒ `git log -S` 仍然只返回 C1。
    // ⚠️ 追加的文本里 ⛔ 不得出现 `reconcileGoalFiling` 字面量：`-S` 数的是**子串出现次数**，
    // 多提一次符号就会把 C2 也变成 pickaxe 命中的提交（那不是本夹具要的形态）。
    fs.appendFileSync(writerPath, "// C2: landing marker — 落地只改了这段注释\n", "utf8");
    git(["add", "-A"]);
    git(["commit", "-m", "C2: 落地提交（develop 被 ff 到这一点）"], { date: C2_DATE });
    c2 = git(["rev-parse", "HEAD"]);
  }

  // 台账在提交之后写，保持未跟踪：判据只从磁盘读它，与 git 无关。
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const rows = terminalAt === null ? [] : [terminalRow(terminalAt)];
  fs.writeFileSync(
    path.join(root, ".quay", "goal-filing.jsonl"),
    rows.length === 0 ? "" : rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  return { root, git, c1, c2 };
}

/**
 * 逐字执行判据。判据正文【本身就是一条 shell 命令】（`node … -e "…"`），因此必须交给 shell 执行
 * —— 这正是生产侧的解释器（packages/quay/src/core/acceptance-runner.ts 以 `shell: true` 跑
 * acceptance 命令）。⛔ 不能写成 `execFileSync('node', ['-e', criterion])`：那会把字面量
 * `node … -e "…"` 当成 JS 求值 ⇒ SyntaxError ⇒ 判据恒假（硬规则 4c 的「恒假」形态）。
 * 判据里的路径是相对路径（`.quay/…`、`plugin/…`），所以 cwd 必须是 fixture 根。
 * @param {string} root @param {string} criterion
 */
function runCriterion(root, criterion) {
  const r = spawnSync("bash", ["-c", criterion], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.equal(r.error, undefined, `判据未能执行（spawn error）：${r.error && r.error.message}`);
  return r;
}

/** 从 stdout/stderr 取最后一行可解析的 JSON；取不到返回 null（⛔ 不把「没有 JSON」当成空对象）。 */
function lastJsonLine(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* 这一行不是判据的 JSON 读数，继续往前找 */
    }
  }
  return null;
}

// ── 判据来源与夹具自检 ──────────────────────────────────────────────────────────────────────
test("判据取自 goal store（测试里无副本），且夹具两个时刻真的先后可辨", () => {
  // 单一真相源：判据正文不得在测试文件里出现第二份。
  assert.equal(
    SELF_SOURCE.includes(CRITERION_941),
    false,
    "测试文件里出现了判据正文副本 —— 抄一份就是造第二个真相源，改 store 而锁不动",
  );
  // 变体不是第二份判据：它由同一段判据替换一个锚点段得到。
  assert.notEqual(landingAnchored(CRITERION_941, "0".repeat(40)), CRITERION_941, "锚点替换必须真的改动了判据文本（空变异会让本文件静默测真判据）");

  const fx = makeFixture({ withWriter: true, terminalAt: ROW_BETWEEN });
  // 谓词先对已知为真的样本干跑一次：`-S` 只命中 C1（C2 不改变符号次数）。
  const pickaxe = fx.git(["log", "--format=%H", "-S", "reconcileGoalFiling", "--", "plugin/scripts/goal-driver.ts"]);
  assert.deepEqual(pickaxe.split("\n").filter(Boolean), [fx.c1], "`git log -S` 必须恰命中引入符号的 C1（C2 不改变符号次数）");
  const c1Ms = Date.parse(fx.git(["log", "-1", "--format=%cI", fx.c1]));
  const c2Ms = Date.parse(fx.git(["log", "-1", "--format=%cI", fx.c2]));
  assert.ok(Number.isFinite(c1Ms) && Number.isFinite(c2Ms), "两个提交时刻都必须可解析");
  assert.ok(c2Ms > c1Ms, `落地提交必须晚于代码提交（C1=${new Date(c1Ms).toISOString()} C2=${new Date(c2Ms).toISOString()}）`);
  // 夹具里的三个时刻与 AC-941 的实测读数同序：C1 < 落地前行 < C2 < 落地后行。
  assert.ok(Date.parse(ROW_BETWEEN) > c1Ms && Date.parse(ROW_BETWEEN) < c2Ms, "落地前证据行必须落在 C1..C2 之间");
  assert.ok(Date.parse(ROW_AFTER) > c2Ms, "落地后行必须晚于 C2");
});

// ── ② 正臂：终态行晚于落地提交 ⇒ 两条腿都绿 ─────────────────────────────────────────────────
test("正臂：终态行 at 晚于落地提交 ⇒ 现判据 exit 0 且 landing-anchored 变体 exit 0", () => {
  const fx = makeFixture({ withWriter: true, terminalAt: ROW_AFTER });

  const now = runCriterion(fx.root, CRITERION_941);
  assert.equal(now.status, 0, `正臂上现判据必须读绿；stdout=${JSON.stringify(now.stdout)} stderr=${JSON.stringify(now.stderr)}`);
  const nowOut = lastJsonLine(now.stdout);
  assert.ok(nowOut, `正臂的 stdout 必须是 JSON 读数；实际=${JSON.stringify(now.stdout)}`);
  assert.equal(nowOut.fresh, 1, "正臂：恰好 1 条终态行落在窗口内");

  const fixed = runCriterion(fx.root, landingAnchored(CRITERION_941, fx.c2));
  assert.equal(fixed.status, 0, `landing-anchored 变体在正臂上必须读绿；stderr=${JSON.stringify(fixed.stderr)}`);
  const fixedOut = lastJsonLine(fixed.stdout);
  assert.ok(fixedOut, `landing-anchored 变体的 stdout 必须是 JSON 读数；实际=${JSON.stringify(fixed.stdout)}`);
  assert.equal(fixedOut.fresh, 1, "正臂：变体也恰好 1 条终态行落在窗口内");
  assert.equal(
    fixedOut.landedAt,
    new Date(Date.parse(fx.git(["log", "-1", "--format=%cI", fx.c2]))).toISOString(),
    "变体的 landedAt 必须报【落地提交】的时刻",
  );
});

// ── ① 取假臂：终态行落在代码提交与落地提交之间 ⇒ 现判据绿、变体红 ──────────────────────────
test("取假臂：终态行 at 落在代码提交与落地提交之间 ⇒ 现判据 exit 0（缺陷可复现）而 landing-anchored 变体 exit 1", () => {
  const fx = makeFixture({ withWriter: true, terminalAt: ROW_BETWEEN });

  // 现判据：把窗口锚在【代码提交】上 ⇒ 一条落地前写的行也算 fresh。
  const now = runCriterion(fx.root, CRITERION_941);
  assert.equal(
    now.status,
    0,
    "缺陷可复现：现判据在【落地前】写的终态行上也必须读绿（读红说明判据已被改成落地锚点 —— " +
      "那就把本臂改成断言 exit 1，并同步改 docs/evidence/2026-11-06-ac941-post-landing-window.md 的结论；" +
      `⛔ 不要删掉这一臂）。stdout=${JSON.stringify(now.stdout)} stderr=${JSON.stringify(now.stderr)}`,
  );
  const nowOut = lastJsonLine(now.stdout);
  assert.ok(nowOut, `现判据的 stdout 必须是 JSON 读数；实际=${JSON.stringify(now.stdout)}`);
  assert.equal(
    nowOut.landedAt,
    new Date(Date.parse(fx.git(["log", "-1", "--format=%cI", fx.c1]))).toISOString(),
    "现判据报出的 landedAt 必须是【代码提交】C1 的时刻 —— 这正是锚点错位的可执行证据",
  );
  assert.equal(nowOut.fresh, 1, "现判据把落地前的那条行也算作 fresh（=1）");

  // landing-anchored 变体：同一份夹具、同一段判据，只换锚点 ⇒ 必须判红。
  const fixed = runCriterion(fx.root, landingAnchored(CRITERION_941, fx.c2));
  assert.equal(
    fixed.status,
    1,
    "landing-anchored 变体必须判红：终态行早于落地提交 ⇒ 它不是「落地后生产写的行」。" +
      `stdout=${JSON.stringify(fixed.stdout)} stderr=${JSON.stringify(fixed.stderr)}`,
  );
  const fixedErr = lastJsonLine(fixed.stderr);
  assert.ok(fixedErr, `变体的 stderr 必须是 JSON 读数；实际=${JSON.stringify(fixed.stderr)}`);
  assert.equal(fixedErr.fresh, undefined, "变体判红时不应报出 fresh（它没有命中的行）");
  assert.deepEqual(fixedErr.terminal, [ROW_BETWEEN], "变体必须把那条落地前的行原样列出来（⛔ 不吞掉读数）");
  assert.equal(
    fixedErr.landedAt,
    new Date(Date.parse(fx.git(["log", "-1", "--format=%cI", fx.c2]))).toISOString(),
    "变体报出的 landedAt 必须是【落地提交】C2 的时刻",
  );
});

// ── 负控：没有终态行 ⇒ 两条腿都必须红（防「恒绿」） ──────────────────────────────────────────
test("负控：台账里没有终态行 ⇒ 现判据与 landing-anchored 变体都 exit 1", () => {
  const fx = makeFixture({ withWriter: true, terminalAt: null });

  const now = runCriterion(fx.root, CRITERION_941);
  assert.equal(now.status, 1, `没有终态行时现判据必须判红；stdout=${JSON.stringify(now.stdout)}`);
  assert.match(now.stderr, /no terminal goal-filing row/, `判据必须具名「没有终态行」；stderr=${JSON.stringify(now.stderr)}`);

  const fixed = runCriterion(fx.root, landingAnchored(CRITERION_941, fx.c2));
  assert.equal(fixed.status, 1, `没有终态行时变体也必须判红；stdout=${JSON.stringify(fixed.stdout)}`);
  assert.match(fixed.stderr, /no terminal goal-filing row/, `变体必须具名「没有终态行」；stderr=${JSON.stringify(fixed.stderr)}`);
});

// ── 落地前臂：工作区树里没有 writer 符号 ⇒ 现判据红 ──────────────────────────────────────────
test("落地前臂：工作区树里没有 reconcileGoalFiling ⇒ 现判据 exit 1（has no ledger writer）", () => {
  const fx = makeFixture({ withWriter: false, terminalAt: ROW_AFTER });

  const r = runCriterion(fx.root, CRITERION_941);
  assert.equal(r.status, 1, `落地前的工作区树上判据必须判红；stdout=${JSON.stringify(r.stdout)}`);
  assert.match(
    r.stderr,
    /has no ledger writer/,
    `判据必须具名「工作区树里没有台账写入方」；stderr=${JSON.stringify(r.stderr)}`,
  );
});
