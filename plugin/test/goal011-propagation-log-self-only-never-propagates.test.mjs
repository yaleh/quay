// @test-group engine
// goal011-propagation-log-self-only-never-propagates.test.mjs — GOAL-011 退出条件②（AC-220，
// 重写版）：replaces the original "fan-in 冲突率相对 7 天基线实测下降" proxy metric — 人 2026-09-09
// 反馈「现有 AC 牵扯的因素太多」：ff-red 率混了跟 AC/evidence 写完全无关的普通代码合并冲突，
// 且跟 7 天前一个吞吐量完全不同的窗口比较，分子分母都不可比,是一个弱代理指标,不是直接测量。
//
// 新判据直接读 commitTaskWrite 自己的传播决定（gap-store-commit-propagation-log 新增的
// .quay/store-commit-propagation.jsonl，见 packages/quay-native/src/store.ts 的
// logPropagationOutcome），不是从下游噪声很大的症状（ff-red 率）反推——同硬规则「推论三」：measure
// the actual production carrier, not a downstream noisy symptom。判的是一个【硬不变式】，不是一个
// 【统计比率】：changeKind=self-only 的写，propagated 必须恒为 false——这正是 GOAL-011 退出条件①
// 的字面主张（"AC/evidence 类写跟分支走，不再抢跑 develop"），不再需要跟历史基线比较、不再混入
// 无关的合并冲突噪声。
//
// 窗口下界 = 本文件+日志机制自己的落地提交（gap-store-commit-propagation-log）——日志在此之前不
// 存在，落地前的行数据没有意义。
//
// 三态处理（硬规则 3b）：self-only 样本量为 0 时 FAIL（该不变式没有被真实产生过任何数据支持，
// "0 违规"和"0 样本"必须可区分——0 样本不是"合格"，是"没有被观测过"，硬规则「推论三」的核心）。
//
// ⚠️ 沿用 AC-220/AC-221 已踩过的事故教训（见 goal011-ac-shortcircuit-false-negative-recurrence.
// test.mjs 头注）：本文件在 plugin/test/*.test.mjs glob 下会被 scripts/test.sh 全量扫到，默认
// SKIP、不断言，只有显式 QUAY_GOAL_CRITERION_LIVE=1 才跑真判据——不重演拖垮无关任务 fan-in 的事故。
//
// Run: QUAY_GOAL_CRITERION_LIVE=1 node --no-warnings --experimental-strip-types --test plugin/test/goal011-propagation-log-self-only-never-propagates.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mainCheckoutRoot } from "../scripts/repo-root.ts";

const LIVE_ENV = "QUAY_GOAL_CRITERION_LIVE";
const liveEnabled = process.env[LIVE_ENV] === "1";

// gap-store-commit-propagation-log 落地提交（日志机制本身的起点；AC75：merge 不得 rebase，SHA 稳定）。
const LANDING_SHA = "1e4f006bd";
const LANDING_CUTOFF = "2026-09-09T22:30:07Z";

// self-only 样本量门槛：远低于旧版的 30——这不是一个统计比率（不需要大样本才有意义），是一个硬
// 不变式（任何一个反例都直接判负）；门槛只是防「0 样本 ⇒ 0 违规」这个平凡真——同硬规则「推论三」。
const MIN_SELF_ONLY_SAMPLE = 5;

function readPropagationLog() {
  const root = mainCheckoutRoot();
  const p = path.join(root, ".quay", "store-commit-propagation.jsonl");
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

// ── 负控制：mixed/must-propagate 写仍然会传播（判据没有把分类器的范围看宽）─────────────────

test("负控制：落地后至少有一条 changeKind=must-propagate 且 propagated=true 的记录（分类器没有失控地把一切都判成 self-only）", () => {
  if (!liveEnabled) {
    console.log(`SKIP: 未设置 ${LIVE_ENV}=1——默认在全量 suite 里不断言（见文件头注的事故教训）。`);
    return;
  }
  const records = readPropagationLog().filter((r) => typeof r.ts === "string" && r.ts >= LANDING_CUTOFF);
  const mustPropagateOk = records.filter((r) => r.changeKind === "must-propagate" && r.propagated === true);
  assert.ok(
    mustPropagateOk.length > 0,
    "期望落地后能找到至少一条 must-propagate 且 propagated=true 的记录（正常的状态翻转/新建对象写）—— " +
      "0 条说明要么日志本身没工作,要么分类器把所有写都误判成了 self-only,两者都需要先查清楚再信任下面的主判据"
  );
});

// ── 主判据：self-only 写，propagated 恒为 false（硬不变式，不是比率）───────────────────────

test(
  `落地(${LANDING_SHA} / ${LANDING_CUTOFF})后 changeKind=self-only 的写全部 propagated=false（样本量 ≥ ${MIN_SELF_ONLY_SAMPLE}）`,
  () => {
    if (!liveEnabled) {
      console.log(`SKIP: 未设置 ${LIVE_ENV}=1——默认在全量 suite 里不断言（见文件头注的事故教训）。`);
      return;
    }
    const records = readPropagationLog().filter((r) => typeof r.ts === "string" && r.ts >= LANDING_CUTOFF);
    const selfOnly = records.filter((r) => r.changeKind === "self-only");
    const violations = selfOnly.filter((r) => r.propagated === true);

    assert.ok(
      selfOnly.length >= MIN_SELF_ONLY_SAMPLE,
      `self-only 样本量不足(${selfOnly.length}/${MIN_SELF_ONLY_SAMPLE})——还没有足够的生产写观测到这个不变式,` +
        "判 fail 而非放行(硬规则 3b/推论三:0 样本 ≠ 0 违规)。等生产再跑一段时间、样本积累够了再复验。"
    );
    assert.equal(
      violations.length,
      0,
      `发现 ${violations.length} 条 self-only 写却 propagated=true 的记录(任务: ` +
        `${violations.map((r) => r.id).join(", ")})——字段级传播判据被绕过或退化了,不判 covered。`
    );
  }
);
