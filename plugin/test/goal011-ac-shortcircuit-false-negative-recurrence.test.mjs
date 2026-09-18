// @test-group engine
// goal011-ac-shortcircuit-false-negative-recurrence.test.mjs — GOAL-011 退出条件③（AC-221）：
// 「2026-09-07 已实证的那类事故（ABI 勾满 AC，worktree 副本看不到，exited-not-landed 重派）在实现
// 落地后的窗口内实测发生次数为 0」。
//
// 读的是生产载体本身（.quay/worker-outcome.jsonl，经 mainCheckoutRoot() 定位）——⛔ 不用 fixture
// 冒充生产（硬规则「推论三」：只能被 fixture 满足的判据不是测量）。窗口下界同 AC-220：
// gap-store-commit-propagation-field-aware 落地提交 bdbdb368d（2026-09-09T11:28:11Z）。
//
// 重写版（人 2026-09-09 反馈「现有 AC 牵扯的因素太多」）：原版无法从 failure_reason 文本本身区分
// 「假阴性复发」与「worker 真没做完的正常拦截」，只能把两种情形都判 fail、要求人工逐条核对——这正是
// 需要拆掉的confound。新版自动消歧：对每一条落地后的 "AC 未全勾" 短路事件，用 git 历史回放 develop
// 分支在该事件时间戳当刻的 tasks/<id>.md blob，跑【与生产同一个判定函数】
// （flipAcGateVerdict，从 fan-in-ac-completion-gate.ts 直接 import，⛔ 不重新实现一遍解析逻辑——
// 硬规则 4c：判据引用的量必须是判定函数本身，不是另一套可能漂移的复刻）：
//   develop 历史态在该时刻已全勾  ⇒ 真·假阴性复发（本 AC 要防的事故）——判定失败，报具体任务+时间戳
//   develop 历史态在该时刻仍未全勾 ⇒ 真阴性（worker 真没做完）——不计入违规，不需要人工介入
// 唯一没有回放的是 worktree 侧（task/<id> 分支通常在 fan-in 后被清理，无法回放历史态）——但
// 2026-09-07 原始事故的形状恰恰是「develop 已全勾、worktree 陈旧」，回放 develop 侧已经直接覆盖
// 这个具体失败模式。
//
// 三态处理：node:test 退出码是唯一信号通道；样本不足/自动消歧发现真复发都 fail-closed。
//
// ⚠️ 回放方法已修（2026-09-18，gap-ac221-replay-anachronistic-develop-ref）：**「develop 在事件时刻
// 的历史态」一度是用 `git log develop --until=<ts> -1` 重放的，那是【时代错置】**——`--until` 对
// **当前 DAG** 按**提交日期**过滤，可以返回一个事件当时还没进 develop、之后才 merge/push 进来的提交。
// 实测：2026-09-18T11:12:40.533Z 那条短路事件，`--until` 取到 ca1a8276d（提交日期 11:11:34），而
// reflog 显示它 11:12:57 才 push 进 develop（事件之后 16.5 秒，其 parent b3d0ea5f3 = 事件当刻的真实
// tip）⇒ 6/6「已全勾」被误报为真复发，实为 0/6 真阴性。现改为 **reflog 忠实重建 ref**（见
// developTipAt：取时间戳 ≤ 事件 ts 的最新一条 reflog 条目 + 完备性自检 + 三态 fail-closed）。
//
// ⚠️ 本判据的 develop 侧口径**不覆盖**「AC 勾选已提交、但尚未到达 develop」的**传播竞态**
// （同上事件：勾选写在 11:11:34 提交，直到 11:12:57 才到达 develop——**83 秒传播延迟**，而 worker
// 在 11:12:40 被短路 ⇒ 烧掉一个 worker 轮次）。按本判据写下的口径（develop 侧）它**不算**复发；
// 但它与 2026-09-07 事故**共享代价形状**（勾完了却被短路）。⛔ 这是**如实记录的残留，不是已解决项**，
// 也**不得**塞进本判据（那会重新引入 AC-221 于 2026-09-09 由人明确要求拆掉的 confound）——
// 它需要自己的一条 AC/裁定。
//
// ⚠️ 事故记录 + 修法（2026-09-09T15:xx，本文件落地约 1h 后发现）：本文件在 plugin/test/*.test.mjs
// glob 下会被 scripts/test.sh 的全量 suite 无条件扫到；落地 1h 后生产真出现短路事件，判据据实 FAIL，
// 拖垮两个【与 GOAL-011 无关】的其它任务的 fan-in（gap-ac201-productization-*、
// gap-goal-gap-done-task-not-traction-respawns-every-round）——本判据的读者本该只是 goal-driver 的
// criterion spawn，⛔ 不该参与决定其它任务能不能落地。修法：照搬本仓库已有的 QUAY_TEST_LIVE_GITHUB
// 先例（packages/quay/test/cli.test.mjs），默认 SKIP、不断言、exit 0；只有显式设置
// QUAY_GOAL_CRITERION_LIVE=1（AC-221 的 criterion 字段自带这个前缀）才跑真判据。
//
// Run: QUAY_GOAL_CRITERION_LIVE=1 node --no-warnings --experimental-strip-types --test plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mainCheckoutRoot } from "../scripts/repo-root.ts";
import { flipAcGateVerdict } from "../scripts/fan-in-ac-completion-gate.ts";

const LIVE_ENV = "QUAY_GOAL_CRITERION_LIVE";
const liveEnabled = process.env[LIVE_ENV] === "1";

const LANDING_SHA = "bdbdb368d";
const LANDING_CUTOFF = "2026-09-09T11:28:11Z";

const SHORTCIRCUIT_PATTERN = /^AC 未全勾/;

// 宿主若泄漏 GIT_* 环境变量（GIT_DIR/GIT_WORK_TREE/…），`git -C <dir>` 会去操作【另一个】仓库——
// 对本判据是**静默错误**（读到的 reflog/tip 全是别处的，而完备性自检照样通过）。显式清掉。
const GIT_ENV = (() => {
  const env = { ...process.env };
  for (const k of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_COMMON_DIR",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ]) {
    delete env[k];
  }
  return env;
})();

function readWorkerOutcomeLines() {
  const root = mainCheckoutRoot();
  const p = path.join(root, ".quay", "worker-outcome.jsonl");
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, "utf8");
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // append-only 载体偶发半写行，跳过而非整体判失败。
    }
  }
  return out;
}

function isShortCircuit(rec) {
  return typeof rec.failure_reason === "string" && SHORTCIRCUIT_PATTERN.test(rec.failure_reason);
}

/** `%gd` 的 --date=unix 形态 `develop@{1789738993}` ⇒ epoch 秒；读不懂返回 null。 */
function parseReflogUnix(gd) {
  const m = /@\{(\d+)\}/.exec(gd);
  return m ? Number(m[1]) : null;
}

/** develop 的 reflog 条目，reflog 顺序（新→旧）；reflog 不可读、或任一行读不懂（格式漂移）返回 null。
 *  ⛔ 读不懂时【不】跳过该行继续——那会让"最新一条"落到一个更旧的条目上，与"回放成功"同形（硬规则 3b）。 */
function readDevelopReflog(root) {
  let out;
  try {
    out = execFileSync(
      "git", ["-C", root, "reflog", "show", "develop", "--date=unix", "--format=%H%x09%gd"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: GIT_ENV, maxBuffer: 64 * 1024 * 1024 }
    );
  } catch {
    return null;
  }
  const entries = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const fields = t.split("\t");
    if (fields.length !== 2) return null;
    const [sha, gd] = fields;
    const unix = parseReflogUnix(gd);
    if (!/^[0-9a-f]{40}$/.test(sha) || unix === null || !Number.isFinite(unix)) return null;
    entries.push({ sha, unix });
  }
  return entries;
}

/** 当前 develop ref 的值（git 自己的读法）；读不到返回 null。 */
function currentDevelopTip(root) {
  try {
    return (
      execFileSync("git", ["-C", root, "rev-parse", "develop"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"], env: GIT_ENV,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * develop 分支在时间戳 ts 当刻的 tip commit sha——**忠实重建 ref 的历史值**，读不出返回 null。
 *
 * ⛔ 不用 `git log develop --until=<ts>`：那是对【当前 DAG】按【提交日期】做的过滤，**不是**
 *    「该时刻 develop ref 的值」。它可以返回一个事件当时还没进 develop、之后才 merge/push 进来的
 *    提交。2026-09-18T11:12:40.533Z 那条事件的实测（时代错置）：
 *      `--until` 取到 ca1a8276d（提交日期 11:11:34），而它直到 11:12:57 才 push 进 develop
 *      —— 事件当刻 develop 真实 tip 是 b3d0ea5f3（11:00:28），ref 移动发生在事件之后 16.5 秒。
 *    两种读法在这一次上给出【相反】的结论（6/6 判复发 vs 0/6 判真阴性），把一条 16.5 秒的传播
 *    竞态误报成 2026-09-07 那类真复发。
 *
 * 三态 fail-closed（AC-221 原文「回放不出历史态时 fail-closed(判不出≠没复发)」）——任一条不成立
 * 即返回 null，调用方据此走 unclassified 分支判 FAIL：
 *   ① reflog 不可读 / 有条目读不懂（格式漂移）
 *   ② 没有任何条目时间戳 ≤ ts（最早条目晚于事件时刻 ⇒ 该时刻回放不出来）
 *   ③ reflog 最新一条 ≠ 当前 develop tip（reflog 被剪枝/不完整 ⇒ 回放不可信）
 */
function developTipAt(root, ts) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  const entries = readDevelopReflog(root);
  if (entries === null || entries.length === 0) return null; // ①
  const tip = currentDevelopTip(root);
  if (tip === null || entries[0].sha !== tip) return null; // ③（完备性自检，⛔ 不静默）
  const hit = entries.find((e) => e.unix * 1000 <= t); // reflog 新→旧 ⇒ 首命中即「≤ts 的最新一条」
  return hit ? hit.sha : null; // ②
}

/** 某个历史 commit 上 tasks/<id>.md 的内容，读不到（文件当时不存在/commit 不存在）返回 null。 */
function taskBodyAtCommit(root, sha, taskId) {
  try {
    return execFileSync(
      "git", ["-C", root, "show", `${sha}:tasks/${taskId}.md`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: GIT_ENV }
    );
  } catch {
    return null;
  }
}

/** 自动消歧一条历史短路事件：develop 在事件时刻的历史态是否其实已经全勾（真复发）。
 *  返回 { classified: true, recurrence: boolean, detail } 或 { classified: false, detail }
 *  （回放不出来——develop 分支/该 commit/该文件路径任一环节读不到，判定不出，⛔ 不当作"没复发"）。 */
function classifyEvent(root, rec) {
  const sha = developTipAt(root, rec.ts);
  if (!sha) return { classified: false, detail: `develop 在 ${rec.ts} 之前无可读提交` };
  const body = taskBodyAtCommit(root, sha, rec.task);
  if (body === null) return { classified: false, detail: `${sha}:tasks/${rec.task}.md 读不到` };
  const verdict = flipAcGateVerdict(body);
  // verdict.ok === true 就是「本可以翻 done」的判定——跟生产 acShortCircuitVerdict 用来判「develop
  // 侧是否全勾」的字段完全同一个（worker-driver.ts:2558 devV.ok），⛔ 不用 verdict.status 这个多态
  // 字符串（"pass"/"pass-no-boxes"/"pass-external"/"fail"/"not-evaluated"）自己再判一次真假。
  const recurrence = verdict.ok === true;
  return {
    classified: true,
    recurrence,
    detail: `develop@${sha.slice(0, 9)}(${rec.ts} 前最近提交) 的 tasks/${rec.task}.md: ` +
      `status=${verdict.status} checked ${verdict.checked}/${verdict.total}`,
  };
}

// ── 负控制（硬规则②：先证明正则认得出真实发生过的短路事件）─────────────────────────────

test("负控制：SHORTCIRCUIT_PATTERN 命中至少一条落地前的历史短路样本（判据本身没坏）", () => {
  if (!liveEnabled) {
    console.log(`SKIP: 未设置 ${LIVE_ENV}=1——见文件头注的事故记录,默认在全量 suite 里不断言。`);
    return;
  }
  const records = readWorkerOutcomeLines();
  const preLanding = records.filter((r) => r.ts && r.ts < LANDING_CUTOFF && isShortCircuit(r));
  assert.ok(
    preLanding.length > 0,
    `期望在 ${LANDING_CUTOFF} 之前的生产记录里能找到至少一条 "AC 未全勾" 短路样本,实际 0 条——` +
      "先确认字段名/正则是否仍匹配 worker-driver.ts 当前写法,而不是直接相信『事故是 0 次』"
  );
});

// ── 负控制二（消歧器本身没坏）：对一条已知真阴性的落地后样本回放,必须分类为「非复发」──────
// （2026-09-09 三次 gap-ac207 事件之一：develop 历史态本来就是 2/5，早已核实——见对话记录）

test("负控制：消歧器对已知真阴性样本（gap-ac207 2026-09-09T14:26:02.187Z）判定为「非复发」", () => {
  if (!liveEnabled) {
    console.log(`SKIP: 未设置 ${LIVE_ENV}=1——见文件头注的事故记录,默认在全量 suite 里不断言。`);
    return;
  }
  const root = mainCheckoutRoot();
  const known = classifyEvent(root, { ts: "2026-09-09T14:26:02.187Z", task: "gap-ac207-e2e-target-driver-driven-real-commit-task-done" });
  assert.ok(known.classified, `消歧器应能回放这条已知样本,实际: ${known.detail}`);
  assert.equal(known.recurrence, false, `已知真阴性样本被误判为复发: ${known.detail}`);
});

// ── 正控制（硬规则 4：把「本方法仍能取假」钉进判据本体，⛔ 不靠注释）──────────────────────
// 只留主判据那条「复发数 = 0」的断言时，任何**恒判非复发**的实现（例如回放永远返回 null 但被当成
// 「没复发」、或判定函数被改成永远 ok=false）都能让判据变绿——那是一个结构上不可能取假的量。
// 所以这里对【同一个断言】做双向对照，两臂都必须实测：
//   正臂 = 2026-09-07 那次原始事故（GOAL-011 立条时引用的就是它）⇒ 必须判「复发」
//   负臂 = 2026-09-09 gap-ac207 已知真阴性                      ⇒ 必须判「非复发」

test("正控制（双向）：消歧器对已知真复发样本判「复发」、对已知真阴性样本判「非复发」", () => {
  if (!liveEnabled) {
    console.log(`SKIP: 未设置 ${LIVE_ENV}=1——见文件头注的事故记录,默认在全量 suite 里不断言。`);
    return;
  }
  const root = mainCheckoutRoot();

  const positive = classifyEvent(root, {
    ts: "2026-09-07T03:37:36.503Z",
    task: "gap-cli-write-surface-lacks-toplevel-fields",
  });
  assert.ok(positive.classified, `正臂：消歧器应能回放这条已知真复发样本,实际: ${positive.detail}`);
  assert.equal(
    positive.recurrence,
    true,
    `正臂：已知真复发样本（2026-09-07 原始事故）未被判为复发 ⇒ 本判据已丧失取假能力: ${positive.detail}`
  );

  const negative = classifyEvent(root, {
    ts: "2026-09-09T14:26:02.187Z",
    task: "gap-ac207-e2e-target-driver-driven-real-commit-task-done",
  });
  assert.ok(negative.classified, `负臂：消歧器应能回放这条已知真阴性样本,实际: ${negative.detail}`);
  assert.equal(
    negative.recurrence,
    false,
    `负臂：已知真阴性样本被误判为复发 ⇒ 本判据会把正常拦截误报成事故: ${negative.detail}`
  );
});

// ── AC3：回放的三态 fail-closed（临时仓库/构造输入实测，⛔ 判不出不得当作「没复发」）──────────

/** 建一个自带 develop reflog 的临时仓库：两次提交，返回 { dir, first, second }。 */
function makeTempRepoWithDevelopReflog(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac221-reflog-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: GIT_ENV }).trim();
  git("init", "-q", "-b", "develop");
  // 显式钉死身份/签名/钩子，避免宿主的全局 git 配置把临时仓库的行为改掉。
  git("config", "user.email", "ac221@example.invalid");
  git("config", "user.name", "ac221");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", path.join(dir, ".git", "hooks"));
  const commit = (text, msg) => {
    fs.writeFileSync(path.join(dir, "f.txt"), text);
    git("add", "f.txt");
    git("commit", "-q", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  const first = commit("one\n", "c1");
  const second = commit("two\n", "c2");
  return { dir, first, second, git };
}

test("AC3-①：reflog 不可读（非 git 目录）⇒ developTipAt 返回 null（fail-closed）", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac221-nogit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(
    developTipAt(dir, new Date().toISOString()),
    null,
    "reflog 读不到时必须 fail-closed（⛔ 不得返回一个看似可用的 sha / 不得静默当作「没复发」）"
  );
});

test("AC3-②：reflog 最早条目晚于事件 ts ⇒ developTipAt 返回 null（fail-closed）", (t) => {
  const { dir, second } = makeTempRepoWithDevelopReflog(t);
  const now = new Date().toISOString();
  assert.equal(developTipAt(dir, now), second, "构造前的正控制：完备 reflog 应能解析出 tip");
  // 2000 年早于该仓库最早一条 reflog 条目 ⇒ 该时刻回放不出来。
  assert.equal(
    developTipAt(dir, "2000-01-01T00:00:00.000Z"),
    null,
    "事件时刻早于最早 reflog 条目时必须 fail-closed，⛔ 不得回退到一个「之后」的提交"
  );
});

test("AC3-③：reflog 最新条目 ≠ 当前 develop tip（不完整）⇒ developTipAt 返回 null（fail-closed）", (t) => {
  const { dir, first, second, git } = makeTempRepoWithDevelopReflog(t);
  const now = new Date().toISOString();
  assert.equal(developTipAt(dir, now), second, "构造前的正控制：完备 reflog 应能解析出 tip");
  // 绕开 git 的 ref API 直接改写 loose ref ⇒ ref 移动了但 reflog 没有对应条目
  // （模拟 reflog 被 gc 剪枝 / 不完整——此时「最新条目」不再等于 ref 的真值，回放不可信）。
  fs.writeFileSync(path.join(dir, ".git", "refs", "heads", "develop"), first + "\n");
  assert.equal(git("rev-parse", "develop"), first, "负控制：ref 确实已被改写");
  assert.equal(
    developTipAt(dir, now),
    null,
    "reflog 最新条目与当前 develop tip 不一致时必须 fail-closed"
  );
});

// ── 主判据：落地后窗口内，自动消歧为「真复发」的短路事件数为 0 ────────────────────────────

test(
  `落地(${LANDING_SHA} / ${LANDING_CUTOFF})后自动消歧为真复发的 "AC 未全勾" 短路事件数为 0`,
  () => {
    if (!liveEnabled) {
      console.log(`SKIP: 未设置 ${LIVE_ENV}=1——见文件头注的事故记录,默认在全量 suite 里不断言。`);
      return;
    }
    const root = mainCheckoutRoot();
    const records = readWorkerOutcomeLines();
    const postLanding = records.filter(
      (r) => typeof r.ts === "string" && r.ts >= LANDING_CUTOFF && isShortCircuit(r)
    );
    const unclassified = [];
    const recurrences = [];
    for (const rec of postLanding) {
      const c = classifyEvent(root, rec);
      if (!c.classified) unclassified.push({ rec, detail: c.detail });
      else if (c.recurrence) recurrences.push({ rec, detail: c.detail });
    }

    assert.equal(
      unclassified.length,
      0,
      `${unclassified.length} 条事件回放不出历史态,无法消歧(硬规则 3b:判不出 ≠ 没复发,fail-closed)：` +
        unclassified.map((u) => `${u.rec.task}@${u.rec.ts}(${u.detail})`).join("; ")
    );
    assert.equal(
      recurrences.length,
      0,
      `发现 ${recurrences.length} 条真复发(2026-09-07 那类假阴性,develop 历史态其实已全勾却被短路)：` +
        recurrences.map((r) => `${r.rec.task}@${r.rec.ts}(${r.detail})`).join("; ")
    );
  }
);
