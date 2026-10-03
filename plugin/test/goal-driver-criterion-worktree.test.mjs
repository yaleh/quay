// @test-group serial
// goal-driver-criterion-worktree.test.mjs — SPEC-goal-branch-2026-10-03 §5 B1 + §4.10（裁定⑩㉒）。
//
// 回答的问题：**branch-mode goal 的 AC 判据在【哪棵树】上求值。**
//
// B1 的缺陷形态（不是延迟，是死锁）：判据的 cwd 曾恒为主检出的 git root，而主检出跟随 `develop`；
// goal 的代码只在 `goal/<id>` 上 ⇒ 判据看不到 ⇒ AC 永不 achieved ⇒ goal 永不并入。I5 复验同样跑在主
// 检出上，会把 goal 分支上已达成的 AC 全报成 achieved-but-failing 并触发一批**假** gap。
//
// 本文件用**真 git 仓库**夹具（判据真假由「某个提交里有没有这个文件」直接决定，⛔ 不用 fixture 注入
// seam 伪造读数）+ 真 goal-store CLI 端到端跑 goal-driver 的一轮：
//   · AC1 — branch-mode goal 的判据求值 pass，事件 `payload.evaluationRoot` = 判据 worktree 的 realpath，
//           且事件写在**主 root** 的 `.quay/gate-events.jsonl`；同一判据挂在非 branch-mode goal 下 ⇒
//           在主 root 求值并失败。
//   · AC2 — 并入前，一条已 achieved、依赖 goal 分支文件的 AC 不被 I5 报成 achieved-but-failing。
//   · AC3 — goal 分支前进一个提交后，下一轮求值看到新提交（判据 worktree 的 HEAD == 新 tip，且一条
//           只有新提交才满足的判据由 fail 转 pass）。
//
// ⛔ 夹具是**本文件私有**的（`writeStandingGoalFile` 不带 `branch` 字段；改共享 harness 会越出本任务
// 的 ## Touches）——同 goal-driver-s10 自带 `mkLaggingRootFixture` 的先例。
//
// Run: node --test plugin/test/goal-driver-criterion-worktree.test.mjs

import { test } from "node:test";
import {
  assert, fs, mkGitFixtureRoot, os, path, repoRoot, runGoalRound, spawnSync,
  goalAchievedFromRecords, goalFlipDecision,
} from "./helpers/goal-driver-harness.mjs";

const GOAL = "GOAL-901";
const BRANCH = "goal/GOAL-901";
const PLAIN_GOAL = "GOAL-902";
/** 只有 `goal/<id>` 上才有的文件——判据 `test -f <它>` 因此恒等于「求值跑在 goal 分支的树上」。 */
const GOAL_ONLY_FILE = "only-on-goal-branch.txt";
/** 第二个只在 goal 分支上的文件，**后一个提交**才出现（AC3 的刷新读数靠它）。 */
const GOAL_ONLY_FILE_2 = "second-on-goal-branch.txt";
/** SPEC-goal-branch §4.7 相位夹具用：post-merge 判据看的文件，**任何树上都不存在** ⇒ 一旦被求值必
 *  为 fail（因此「not-evaluated」只能来自相位排除，⛔ 不是来自文件恰好缺失）。 */
const POST_MERGE_FILE = "post-merge-production-only.txt";

/** 判据 worktree 的路径 —— 与 Core 的 `goalCriterionWorktreeDir` 同构（命名空间 + `goal-<id>`）。
 *  ⛔ 这里**重算**而不是 import，正是因为要独立复核：若被测实现换了推导，本断言必须变红。 */
const criterionWorktreePath = (ns, goalId = GOAL) => path.join(ns, `goal-${goalId}`);

/** 只写 frontmatter，不经过 store 的写面——夹具要直接控制 `branch` / `status`（⛔ 不触发激活闸）。 */
function writeGoalRecord(root, { id, status, branch }) {
  const lines = ["---", `id: ${id}`, `title: ${id} fixture`, `status: ${status}`, "kind: goal"];
  if (branch !== undefined) lines.push(`branch: ${branch}`);
  lines.push("origin: test fixture", "---", "", "## body", "x", "");
  fs.writeFileSync(path.join(root, "goals", `${id}-fixture.md`), lines.join("\n"), "utf8");
}

function writeAcRecord(root, { id, goal, status, criterion, phase }) {
  const lines = [
    "---", `id: ${id}`, `title: ${id} fixture`, `status: ${status}`, "kind: criterion", `goal: ${goal}`,
  ];
  // SPEC-goal-branch §4.7 — the AC's declared evaluation phase (absent ⇒ the store projects pre-merge).
  if (phase !== undefined) lines.push(`phase: ${phase}`);
  lines.push("criterion: |", `  ${criterion}`, "origin: test fixture", "---", "", "## body", "x", "");
  fs.writeFileSync(path.join(root, "goals", `${id}-fixture.md`), lines.join("\n"), "utf8");
}

/**
 * 真 git 仓库夹具：`main` 上只有 base 提交，`goal/GOAL-901` 上多一个 `GOAL_ONLY_FILE` 提交。
 * 判据 worktree 的命名空间走 `.quay/config.yml` 的 `loop.worktree_root`（**配置解析出的**基目录，
 * ⛔ 不是 `<parent>/quay-worktrees` 那个共享约定目录——测试绝不能往 /tmp/quay-worktrees 里写）。
 */
function mkCriterionWorktreeFixture({ withPlainGoal }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-criterion-wt-"));
  const ns = fs.mkdtempSync(path.join(os.tmpdir(), "goal-criterion-ns-"));
  fs.mkdirSync(path.join(tmp, "goals"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".gitignore"), ".quay/\n", "utf8");
  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), `loop:\n  worktree_root: ${ns}\n`, "utf8");
  const git = mkGitFixtureRoot(tmp);

  writeGoalRecord(tmp, { id: GOAL, status: "active", branch: true });
  // AC1 的 branch-mode 臂。
  writeAcRecord(tmp, { id: "AC-901", goal: GOAL, status: "active", criterion: `test -f ${GOAL_ONLY_FILE}` });
  // AC2 的臂：已 achieved 且判据依赖 goal 分支文件 ⇒ I5 复验必须**看得到**那棵树。
  writeAcRecord(tmp, { id: "AC-903", goal: GOAL, status: "achieved", criterion: `test -f ${GOAL_ONLY_FILE}` });
  // AC3 的臂：`GOAL_ONLY_FILE_2` 在第二个提交才出现 ⇒ 刷新前 fail、刷新后 pass。
  writeAcRecord(tmp, { id: "AC-904", goal: GOAL, status: "active", criterion: `test -f ${GOAL_ONLY_FILE_2}` });
  if (withPlainGoal) {
    // AC1 的第二臂：**非** branch-mode goal 上的**同一条**判据 ⇒ 在主 root 求值，且必然为假。
    writeGoalRecord(tmp, { id: PLAIN_GOAL, status: "active", branch: false });
    writeAcRecord(tmp, { id: "AC-902", goal: PLAIN_GOAL, status: "active", criterion: `test -f ${GOAL_ONLY_FILE}` });
  }

  git(["add", "-A"]);
  git(["commit", "-m", "base"]);
  // develop 与 main 同点：本任务不涉及合并目标，但 build-evidence / 复核类读数要它存在。
  git(["branch", "develop"]);
  git(["checkout", "-q", "-b", BRANCH]);
  fs.writeFileSync(path.join(tmp, GOAL_ONLY_FILE), "on the goal branch only\n", "utf8");
  git(["add", GOAL_ONLY_FILE]);
  git(["commit", "-m", "goal-branch-only file"]);
  const tip = git(["rev-parse", "HEAD"]);
  git(["checkout", "-q", "main"]);
  return { tmp, ns, git, tip };
}

/** goal 分支前进一个提交（新增 `GOAL_ONLY_FILE_2`），返回新 tip。 */
function advanceGoalBranch({ tmp, git }) {
  git(["checkout", "-q", BRANCH]);
  fs.writeFileSync(path.join(tmp, GOAL_ONLY_FILE_2), "added on the goal branch later\n", "utf8");
  git(["add", GOAL_ONLY_FILE_2]);
  git(["commit", "-m", "advance the goal branch"]);
  const tip = git(["rev-parse", "HEAD"]);
  git(["checkout", "-q", "main"]);
  return tip;
}

/** 一轮的测试缝：⛔ 每个可能 spawn LLM 的口都堵死（空数组/`true` ⇒ 无进程、判 not-evaluated）。 */
const ROUND_OPTS = {
  scriptRoot: repoRoot,
  gapWorkerCmd: "true",
  resourceGateArgv: ["true"],
  sufficiencyCmd: [],
  objectiveCmd: [],
  sufficiencyFollowupCmd: "true",
};

/** 读主 root 的账本，按 item_id 取事件（⛔ 不解析别的载体：本任务断言的就是这一条）。 */
function eventsFor(root, itemId) {
  const p = path.join(root, ".quay", "gate-events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l))
    .filter((e) => e.item_id === itemId);
}

// fixture 自己的 git 身份走**子进程 env**（memory: fixture-git-identity-in-child-env）——goal-store 的
// I2 flip 会自己 spawn git 提交，那条子进程继承的是**本测试进程**的 env，故身份必须在这里落地。
process.env.GIT_AUTHOR_NAME ??= "fixture";
process.env.GIT_AUTHOR_EMAIL ??= "fixture@example.invalid";
process.env.GIT_COMMITTER_NAME ??= "fixture";
process.env.GIT_COMMITTER_EMAIL ??= "fixture@example.invalid";

test("AC1+AC2: branch-mode goal 的判据在判据 worktree（detached 于 goal/<id>）上求值并 pass，事件写在主 root 账本且 evaluationRoot=worktree realpath；同一判据挂在非 branch-mode goal 下在主 root 求值并失败；I5 不把 goal 分支上已达成的 AC 报成 achieved-but-failing", async () => {
  const { tmp, ns, git, tip } = mkCriterionWorktreeFixture({ withPlainGoal: true });
  const wtPath = criterionWorktreePath(ns);
  try {
    const r1 = await runGoalRound(tmp, ROUND_OPTS);
    const criteria = new Map(r1.fact.value.criteria.map((c) => [c.id, c]));

    // ── 判据 worktree 被建立（本 pass 先于任何判据求值）────────────────────────────────────
    const wt = r1.fact.value.criterionWorktrees.find((w) => w.goal === GOAL);
    assert.ok(wt, `branch-mode GOAL 必须有判据 worktree 处置读数，实测=${JSON.stringify(r1.fact.value.criterionWorktrees)}`);
    assert.equal(wt.state, "created", `首轮 = 创建（实测 state=${wt.state} reason=${wt.reason}）`);
    assert.equal(wt.headSha, tip, "worktree 处置读数里的 HEAD = goal/<id> 的 tip");
    assert.equal(
      git(["-C", wtPath, "rev-parse", "HEAD"]),
      tip,
      "⛔ 独立复核（direct reading）：判据 worktree 的 HEAD 就是 goal/<id> 的 tip",
    );
    // detached（⛔ 不检出 goal/<id> 本身）：检出该分支会使它无法被 push/ff，正是本设计要避开的。
    assert.equal(
      git(["-C", wtPath, "rev-parse", "--abbrev-ref", "HEAD"]),
      "HEAD",
      "判据 worktree 必须是 DETACHED HEAD（检出 goal/<id> 会挡住该分支自己的快进）",
    );
    // ⛔ 非 branch-mode goal 结构上没有判据 worktree（逐条探 200 个 goal 的分支是白花的 git 调用）。
    assert.equal(
      r1.fact.value.criterionWorktrees.some((w) => w.goal === PLAIN_GOAL),
      false,
      "非 branch-mode goal 不得出现在判据 worktree 读数里",
    );

    // ── AC1 正臂：判据在 worktree 上求值 ⇒ pass，事件 evaluationRoot = worktree realpath ──────
    assert.equal(criteria.get("AC-901")?.verdict, "pass", `实测=${JSON.stringify(criteria.get("AC-901"))}`);
    const ev901 = eventsFor(tmp, "AC-901");
    assert.equal(ev901.length, 1, `AC-901 恰好一条事件（实测 ${ev901.length} 条）`);
    assert.equal(
      ev901[0].payload.evaluationRoot,
      fs.realpathSync(wtPath),
      "payload.evaluationRoot 必须是判据 worktree 的 realpath（⛔ 不是主检出）",
    );
    assert.equal(ev901[0].payload.treeSha, git(["rev-parse", `${tip}^{tree}`]), "treeSha = goal/<id> tip 的树");
    // 账本落在**主 root**，⛔ 不在 worktree 里（worktree 是求值面，不是记录面）。
    assert.equal(
      fs.existsSync(path.join(wtPath, ".quay", "gate-events.jsonl")),
      false,
      "判据 worktree 里不得出现 gate 账本——事件只写主 root",
    );

    // ── AC1 反臂：同一条判据挂在非 branch-mode goal 下 ⇒ 主 root 求值 ⇒ 文件不在那儿 ⇒ fail ────
    assert.equal(criteria.get("AC-902")?.verdict, "fail", `实测=${JSON.stringify(criteria.get("AC-902"))}`);
    const ev902 = eventsFor(tmp, "AC-902");
    assert.equal(ev902.length, 1, `AC-902 恰好一条事件（实测 ${ev902.length} 条）`);
    assert.equal(
      ev902[0].payload.evaluationRoot,
      fs.realpathSync(tmp),
      "非 branch-mode goal 的判据在主检出上求值（evaluationRoot = 主 root realpath）",
    );

    // ── AC2：I5 复验必须看得到 goal 分支的树 ───────────────────────────────────────────────
    const i5 = r1.fact.value.achievedFailing;
    assert.ok(i5, "I5 读数必须存在（否则本断言是空转）");
    assert.ok(i5.scopeSize >= 1, `I5 作用域非空才有意义（实测 scopeSize=${i5.scopeSize}，inScope=${JSON.stringify(i5.inScope)}）`);
    assert.ok(i5.inScope.includes("AC-903"), `AC-903 在 I5 域内（实测 inScope=${JSON.stringify(i5.inScope)}）`);
    assert.deepEqual(
      i5.achievedButFailing,
      [],
      "已 achieved 且依赖 goal 分支文件的 AC **不得**被报成 achieved-but-failing（旧行为在主检出上跑 ⇒ 全报假红）",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(ns, { recursive: true, force: true });
  }
});

test("AC3: goal 分支前进一个提交后，下一轮求值看到新提交（判据 worktree 的 HEAD == 新 tip，且只有新提交才满足的判据由 fail 转 pass）", async () => {
  const { tmp, ns, git, tip: tip1 } = mkCriterionWorktreeFixture({ withPlainGoal: false });
  const wtPath = criterionWorktreePath(ns);
  try {
    const r1 = await runGoalRound(tmp, ROUND_OPTS);
    const c1 = new Map(r1.fact.value.criteria.map((c) => [c.id, c]));
    assert.equal(c1.get("AC-904")?.verdict, "fail", "第 1 轮：GOAL_ONLY_FILE_2 还没提交 ⇒ 判据为假（正控制：⛔ 不是恒真）");
    assert.equal(git(["-C", wtPath, "rev-parse", "HEAD"]), tip1, "第 1 轮：worktree 停在 tip1");

    const tip2 = advanceGoalBranch({ tmp, git });
    assert.notEqual(tip2, tip1, "夹具必须真的前进了一个提交（否则本轮断言是空转）");

    const r2 = await runGoalRound(tmp, ROUND_OPTS);
    const c2 = new Map(r2.fact.value.criteria.map((c) => [c.id, c]));
    const wt2 = r2.fact.value.criterionWorktrees.find((w) => w.goal === GOAL);
    assert.ok(wt2, "第 2 轮必须仍有处置读数");
    assert.ok(
      wt2.state === "refreshed" || wt2.state === "created",
      `第 2 轮应为 refreshed（拆掉重建也可接受），实测 state=${wt2.state} reason=${wt2.reason}`,
    );
    assert.equal(wt2.headSha, tip2, "处置读数里的 HEAD = 新 tip");
    // 直接量（⛔ 不采信自述读数）：worktree 自己说它的 HEAD 是哪个 sha。
    assert.equal(
      git(["-C", wtPath, "rev-parse", "HEAD"]),
      tip2,
      "判据 worktree 的 HEAD == 分支的新 tip —— 下一轮求值看到的是**新提交**",
    );
    assert.equal(c2.get("AC-904")?.verdict, "pass", "第 2 轮：新提交带来了该文件 ⇒ 判据转绿（刷新真的对求值生效）");

    // 刷新不得毁掉 worktree 与主 root 的关系：账本仍**写**在主 root。
    // ⚠️ SPEC-goal-branch §4.10 裁定㉓（gap-goal-branch-preview-instance）之后，判据 worktree 同时是
    // 该 goal 的**预览实例**，建/刷时会拿到一份主检出 `.quay/` 的**只读快照** ⇒ worktree 里现在**有**
    // 一个账本文件。这正是本断言必须换判据的原因（旧判据「worktree 里无账本」描述的是快照落地前的
    // 世界）：有账本 ≠ 事件写进了 worktree。真正的判据是——worktree 里那份是**冻结在快照时刻的副本**，
    // 本轮 append 的事件只在主 root 的账本里。
    const mainLedger = path.join(tmp, ".quay", "gate-events.jsonl");
    const wtLedger = path.join(wtPath, ".quay", "gate-events.jsonl");
    assert.ok(fs.existsSync(mainLedger), "主 root 的账本存在");
    assert.ok(fs.existsSync(wtLedger), "worktree 里是主检出账本的只读快照（§4.10 ㉓；刷新写入的 .quay/ 副本）");
    assert.notEqual(
      fs.statSync(wtLedger).ino,
      fs.statSync(mainLedger).ino,
      "快照是【副本】（独立 inode），⛔ 不是同一文件/硬链——预览内的写操作必须落在副本上",
    );
    const mainLedgerText = fs.readFileSync(mainLedger, "utf8");
    const wtLedgerText = fs.readFileSync(wtLedger, "utf8");
    assert.ok(
      mainLedgerText.startsWith(wtLedgerText),
      "worktree 的账本是主 root 账本在快照时刻的【前缀】：快照之后本轮 append 的事件只在主 root",
    );
    assert.ok(
      wtLedgerText.length < mainLedgerText.length,
      `快照必须【旧于】主账本（wt=${wtLedgerText.length}B main=${mainLedgerText.length}B）——否则本轮事件写进了 worktree`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(ns, { recursive: true, force: true });
  }
});

test("判据 worktree 的路径由【配置解析出的】worktree 基目录派生：`loop.worktree_root` 缺失时回落到约定目录并留痕（⛔ 不静默）", () => {
  // 这是「路径从哪来」的负控制：同一 goal id，两个不同的 loop.worktree_root ⇒ 两个不同的期望路径。
  // ⛔ 它测的是 resolveWorktreeNamespace 的解析链（Core 单一落点），不是把它抄成第二份实现。
  const nsA = fs.mkdtempSync(path.join(os.tmpdir(), "goal-criterion-ns-a-"));
  const nsB = fs.mkdtempSync(path.join(os.tmpdir(), "goal-criterion-ns-b-"));
  const mkRoot = (ns) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-criterion-root-"));
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "config.yml"), `loop:\n  worktree_root: ${ns}\n`, "utf8");
    return root;
  };
  const rootA = mkRoot(nsA);
  const rootB = mkRoot(nsB);
  try {
    const out = spawnSync(
      process.execPath,
      [
        "--no-warnings", "--experimental-strip-types", "-e",
        `import { goalCriterionWorktreeDir } from ${JSON.stringify(path.join(repoRoot, "packages/quay/src/goal-store.ts"))};` +
          `process.stdout.write(JSON.stringify([goalCriterionWorktreeDir(process.argv[1], "GOAL-901"), goalCriterionWorktreeDir(process.argv[2], "GOAL-901")]))`,
        rootA, rootB,
      ],
      { encoding: "utf8" },
    );
    assert.equal(out.status, 0, `子进程读 Core 解析失败：${out.stderr}`);
    const [a, b] = JSON.parse(out.stdout);
    assert.equal(a, criterionWorktreePath(nsA), "配置解析出的基目录 + goal-<id>");
    assert.equal(b, criterionWorktreePath(nsB), "换一个 worktree_root ⇒ 换一个路径（⛔ 不是写死的常量）");
    assert.notEqual(a, b, "两个不同配置必须给出两个不同路径（反例判据：写死路径的实现在这里变红）");
  } finally {
    for (const d of [rootA, rootB, nsA, nsB]) fs.rmSync(d, { recursive: true, force: true });
  }
});

// ── SPEC-goal-branch-2026-10-03 §4.7 (裁定⑭⑮) — AC 的 phase 与分相求值 ─────────────────────────
//
// 回答的问题：**一条「只能并入后判」的 AC，在并入前是否被当成本轮要达成的目标。** 若被求值，它在判据
// worktree 上恒为 not-evaluated（它的载体只在生产跑起来后才有）⇒ 并入前置条件永不满足、goal 永远卡住；
// 若进 gap 计算，gap-filing 会为一个结构上还不可能通过的 AC 立任务。故：并入前 post-merge AC 不求值、
// 不进 gaps，理由记 `pre-merge-phase`；并入后（分支已删）照常求值。`phase` 由**作者显式声明**，
// ⛔ 不按判据文本推断（硬规则 2）。

/** 相位夹具：branch-mode GOAL-901 下三条 AC ——
 *  · AC-901  pre-merge，判据看只有 goal 分支才有的文件 ⇒ 求值 pass（正控制）。
 *  · AC-905  post-merge，判据看的文件**任何树上都没有** ⇒ 一旦被求值必 fail（故 not-evaluated 只可能
 *            来自相位排除，⛔ 不是文件恰好缺失）。
 *  · AC-906  pre-merge，判据自陈载体缺席（exit 3）⇒ 应产生 maybe-post-merge 提示。 */
function mkPhaseFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-phase-"));
  const ns = fs.mkdtempSync(path.join(os.tmpdir(), "goal-phase-ns-"));
  fs.mkdirSync(path.join(tmp, "goals"), { recursive: true });
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".gitignore"), ".quay/\n", "utf8");
  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), `loop:\n  worktree_root: ${ns}\n`, "utf8");
  const git = mkGitFixtureRoot(tmp);

  writeGoalRecord(tmp, { id: GOAL, status: "active", branch: true });
  writeAcRecord(tmp, { id: "AC-901", goal: GOAL, status: "active", criterion: `test -f ${GOAL_ONLY_FILE}` });
  writeAcRecord(tmp, {
    id: "AC-905", goal: GOAL, status: "active", phase: "post-merge",
    criterion: `test -f ${POST_MERGE_FILE}`,
  });
  writeAcRecord(tmp, {
    id: "AC-906", goal: GOAL, status: "active",
    criterion: 'echo "NOT-EVALUATED: production carrier absent on this tree" >&2; exit 3',
  });

  git(["add", "-A"]);
  git(["commit", "-m", "base"]);
  git(["branch", "develop"]);
  git(["checkout", "-q", "-b", BRANCH]);
  fs.writeFileSync(path.join(tmp, GOAL_ONLY_FILE), "on the goal branch only\n", "utf8");
  git(["add", GOAL_ONLY_FILE]);
  git(["commit", "-m", "goal-branch-only file"]);
  const tip = git(["rev-parse", "HEAD"]);
  git(["checkout", "-q", "main"]);
  return { tmp, ns, git, tip };
}

test("AC-phase-split: 并入前 post-merge AC 读 not-evaluated/pre-merge-phase 且不进 gaps；pre-merge AC exit 3 ⇒ maybe-post-merge 提示；并入后同一 AC 被求值", async () => {
  const { tmp, ns, git } = mkPhaseFixture();
  try {
    const r1 = await runGoalRound(tmp, ROUND_OPTS);
    const c1 = new Map(r1.fact.value.criteria.map((c) => [c.id, c]));

    // 正控制：pre-merge AC 在判据 worktree 上求值并通过（证明本轮 gate 真的跑了，⛔ 不是整轮空转）。
    assert.equal(c1.get("AC-901")?.verdict, "pass", `pre-merge AC 应在 goal 分支树上 pass，实测=${JSON.stringify(c1.get("AC-901"))}`);
    // post-merge AC：并入前不求值 ⇒ 读数恰为 not-evaluated + 理由 pre-merge-phase。
    assert.equal(c1.get("AC-905")?.verdict, "not-evaluated", `post-merge AC 并入前必须 not-evaluated，实测=${JSON.stringify(c1.get("AC-905"))}`);
    assert.equal(c1.get("AC-905")?.reason, "pre-merge-phase", "理由必须精确是 pre-merge-phase（可归因，⛔ 不是笼统 not-evaluated）");

    // 不进 gaps：该 AC 不出现在本轮缺口读数的【任何】态里。
    const gaps1 = r1.fact.value.gaps;
    assert.equal(
      gaps1.some((g) => g.ac === "AC-905"),
      false,
      `post-merge AC 不得进 gaps（否则会对结构上不可能通过的 AC 立案），实测 gaps=${JSON.stringify(gaps1.filter((g) => g.ac === "AC-905"))}`,
    );
    // 负控制：同为 active 的 pre-merge 兄弟 AC-906 仍在 gaps 里 ⇒ 上面的「缺席」来自相位排除，
    // ⛔ 不是因为整个 gaps 读数空了。
    assert.equal(
      gaps1.some((g) => g.ac === "AC-906"),
      true,
      `pre-merge AC（exit 3）应仍参与缺口读数——证明 gaps 非空转，实测=${JSON.stringify(gaps1)}`,
    );

    // 相位读数（枚举，⛔ 布尔）：excluded 点名本轮被排除的 post-merge AC；maybePostMerge 点名提示。
    assert.deepEqual(r1.fact.value.phaseSplit.excluded, ["AC-905"], "本轮排除集恰为 post-merge AC");
    assert.deepEqual(r1.fact.value.phaseSplit.maybePostMerge, ["AC-906"], "exit 3 的 pre-merge AC 产生 maybe-post-merge 提示");

    // ── 并入后（分支删除，§4.7/§4.2）⇒ 同一 AC 照常求值 ─────────────────────────────────────
    git(["branch", "-D", BRANCH]);
    const r2 = await runGoalRound(tmp, ROUND_OPTS);
    const c2 = new Map(r2.fact.value.criteria.map((c) => [c.id, c]));
    assert.equal(
      c2.get("AC-905")?.verdict,
      "fail",
      `并入后 post-merge AC 必须被【求值】：判据看的文件不存在 ⇒ fail（⛔ 不再是 not-evaluated），实测=${JSON.stringify(c2.get("AC-905"))}`,
    );
    assert.deepEqual(r2.fact.value.phaseSplit.excluded, [], "分支已删 ⇒ 本轮无相位排除");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(ns, { recursive: true, force: true });
  }
});

test("AC-phase-i2: achieved 判定仍要求全部 AC（含 post-merge）达成——只有 pre-merge 全达成时不被判为 achieved", () => {
  // I2 是【纯】判定（不跑任何判据）：records 由 status 直接表达。post-merge AC 只是多了一个 phase 字段，
  // ⛔ 不该改变「全部 AC 达成」这条语义（裁定⑤：achieved 的元语原样保留）。
  const mkRecords = (postMergeStatus) => [
    { id: "GOAL-901", status: "active", kind: "goal" },
    { id: "AC-901", goal: "GOAL-901", status: "achieved", phase: "pre-merge" },
    { id: "AC-905", goal: "GOAL-901", status: postMergeStatus, phase: "post-merge" },
  ];
  // 只有 pre-merge 全达成（post-merge 仍未达成）⇒ 不达成、且即便充分性 covered 也不 flip。
  assert.equal(
    goalAchievedFromRecords(mkRecords("active"), "GOAL-901"),
    false,
    "post-merge AC 未达成 ⇒ 「全部 AC achieved」为假（phase 不豁免它）",
  );
  assert.equal(
    goalFlipDecision(mkRecords("active"), "GOAL-901", { verdict: "covered" }),
    false,
    "I2 为假 ⇒ 即便 sufficiency=covered 也不写 achieved",
  );
  // 反向控制（证明上面的 false 来自 post-merge 那条，⛔ 不是恒 false）：把同一条改成 achieved ⇒ 达成。
  assert.equal(
    goalAchievedFromRecords(mkRecords("achieved"), "GOAL-901"),
    true,
    "含 post-merge 的【全部】AC 达成 ⇒ 达成（负控制：判定不是恒 false）",
  );
  assert.equal(
    goalFlipDecision(mkRecords("achieved"), "GOAL-901", { verdict: "covered" }),
    true,
    "全部达成 + covered ⇒ flip",
  );
});
