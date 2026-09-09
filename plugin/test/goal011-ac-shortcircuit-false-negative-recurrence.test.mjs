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
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mainCheckoutRoot } from "../scripts/repo-root.ts";
import { flipAcGateVerdict } from "../scripts/fan-in-ac-completion-gate.ts";

const LIVE_ENV = "QUAY_GOAL_CRITERION_LIVE";
const liveEnabled = process.env[LIVE_ENV] === "1";

const LANDING_SHA = "bdbdb368d";
const LANDING_CUTOFF = "2026-09-09T11:28:11Z";

const SHORTCIRCUIT_PATTERN = /^AC 未全勾/;

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

/** develop 分支在时间戳 ts 当刻（或之前最近一次提交）的 tip commit sha，读不到返回 null。 */
function developTipAt(root, ts) {
  try {
    const out = execFileSync(
      "git", ["-C", root, "log", "develop", "--format=%H", "--until", ts, "-1"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** 某个历史 commit 上 tasks/<id>.md 的内容，读不到（文件当时不存在/commit 不存在）返回 null。 */
function taskBodyAtCommit(root, sha, taskId) {
  try {
    return execFileSync(
      "git", ["-C", root, "show", `${sha}:tasks/${taskId}.md`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
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
