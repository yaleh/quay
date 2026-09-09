// @test-group engine
// goal011-fanin-conflict-rate-post-landing.test.mjs — GOAL-011 退出条件②（AC-220）：
// 「SPEC §5『必须单独一轮验证』以经验读数兑现——fan-in 冲突率前后对照应有实测下降，而非仅测试绿」。
//
// 读的是生产载体本身（.quay/worker-outcome.jsonl，经 mainCheckoutRoot() 定位，⛔ 不注入 fixture 冒充
// 生产——同硬规则「推论三」：只能被 fixture 满足的判据不是测量，它只证明「能产出」不证明「已产出」）。
// 窗口下界钉死在 gap-store-commit-propagation-field-aware 落地提交
// bdbdb368d（2026-09-09T11:28:11Z，字段级 commitTaskWrite + acShortCircuitVerdict 并集读同批落地）——
// 该落地前的样本不算数（本 AC 测的是「落地之后」的行为，⛔ 用落地前数据掺入会把旧问题的残留算成新证据）。
//
// 已知的精度上限（诚实写明,不假装比实际更准）：SPEC 7 天基线把 31 次整体 ff-red 细分出 12 次落在
// tasks/*.md，但 fanInLog（.quay/fan-in-*.log）只记 step/exit/reason 三元组，不含 `git diff`
// 冲突文件清单——本判据只能拿到【整体】ff-red 率，拿不到 tasks/*.md 专属子集；因为 AC/evidence
// 类写占了基线冲突原因的主体（12/31 ≈ 39%），整体 ff-red 率的实测下降是 tasks/*.md 专属下降的
// 一个偏弱代理指标，不是等价物——这一点写在这里，不写进判据输出去冒充精确。
//
// 三态处理（硬规则 3b：读不懂/样本不够 ⇒ 不得与「合格」同形）：样本量不足 MIN_SAMPLE 时本文件让测试
// FAIL（非 vacuous pass）——node:test 的退出码是本判据唯一的信号通道（goal-driver 的 gate 只认 spawn
// exit code，不解析 stdout JSON），fail-closed 是这里能表达「未评估」的唯一手段（同 AC-213 的精神，
// 换了一个没有独立三态出口的判据形状）。
//
// ⚠️ 事故记录 + 修法（2026-09-09T15:xx，本文件落地约 1h 后发现）：本文件在 plugin/test/*.test.mjs
// glob 下会被 scripts/test.sh 的全量 suite 无条件扫到——一旦「样本不足/比率未降」FAIL，就会拖垮【与
// GOAL-011 无关的其它任务】的 fan-in（实测两个牺牲品：gap-ac201-productization-verification-*、
// gap-goal-gap-done-task-not-traction-respawns-every-round，均因本文件的断言失败而 suite 红）。
// 这是本判据的读者错位：它本该只被 goal-driver 的 criterion 单独 spawn 调用（AC-220 未 active 前甚至
// 不会被调），⛔ 不该参与决定「其它任务能不能落地」。修法照搬本仓库已有的 QUAY_TEST_LIVE_GITHUB
// 先例（packages/quay/test/cli.test.mjs）：默认（scripts/test.sh 全量扫）SKIP、不断言、exit 0；
// 只有显式设置 QUAY_GOAL_CRITERION_LIVE=1（AC-220 的 criterion 字段自带这个前缀）才跑真判据。
//
// Run: QUAY_GOAL_CRITERION_LIVE=1 node --no-warnings --experimental-strip-types --test plugin/test/goal011-fanin-conflict-rate-post-landing.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mainCheckoutRoot } from "../scripts/repo-root.ts";

const LIVE_ENV = "QUAY_GOAL_CRITERION_LIVE";
const liveEnabled = process.env[LIVE_ENV] === "1";

// gap-store-commit-propagation-field-aware 落地提交（AC75：merge 不得 rebase，SHA 稳定）。
const LANDING_SHA = "bdbdb368d";
const LANDING_CUTOFF = "2026-09-09T11:28:11Z";

// SPEC-store-commit-unification-2026-09-08.md §5 表格原文的 7 天基线：291 次 fan-in、31 次冲突
// （其中 12 次落在 tasks/*.md，见本文件头注——该子集数不可从当前生产载体机械复算）。
const BASELINE_TOTAL = 291;
const BASELINE_FF_RED = 31;
const BASELINE_RATE = BASELINE_FF_RED / BASELINE_TOTAL;

// 落地后样本量门槛：低于此数，「比率下降」结论不具备起码的统计意义，判 fail（未评估的替代表达）
// 而非放行。30 不是精算值，是「基线窗口 291 次的约十分之一」的粗略下限，先用着，随生产读数迭代。
const MIN_SAMPLE = 30;

const FF_RED_PATTERN = /not a fast-forward|refusing to update checked out branch/;

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
      // 单行损坏不致命——append-only 载体偶发半写行，跳过而非整体判失败。
    }
  }
  return out;
}

function isFfRed(rec) {
  const mfi = rec.mechanical_fan_in;
  if (!mfi || mfi.step !== "ff" || mfi.outcome !== "red") return false;
  const reason = String(mfi.reason ?? "");
  return FF_RED_PATTERN.test(reason);
}

// ── 负控制（硬规则②：对着已知为真的样本先干跑一次）───────────────────────────────────────
// 正则若命中 0 条历史样本，后面「落地后 0 次/低比率」就可能是判据坏了而不是真的变好——先证明它
// 认得出真实发生过的 ff-red。

test("负控制：FF_RED_PATTERN 命中至少一条落地前的历史 ff-red 样本（判据本身没坏）", () => {
  if (!liveEnabled) {
    console.log(`SKIP: 未设置 ${LIVE_ENV}=1——本文件是 GOAL-011 的经验验证判据,不是常规回归测试,` +
      "默认在全量 suite 里不断言(见文件头注的事故记录),只有 goal-driver 显式带该 env var 调用时才跑真判据。");
    return;
  }
  const records = readWorkerOutcomeLines();
  const preLandingFfRed = records.filter((r) => r.ts && r.ts < LANDING_CUTOFF && isFfRed(r));
  assert.ok(
    preLandingFfRed.length > 0,
    `期望在 ${LANDING_CUTOFF} 之前的生产记录里能找到至少一条 ff-red 命中,实际 0 条——` +
      "先确认 .quay/worker-outcome.jsonl 是否被清空/轮转,而不是直接相信『冲突率是 0』"
  );
});

// ── 主判据：落地后样本量达标 且 ff-red 率相对 7 天基线实测下降 ──────────────────────────

test(
  `落地(${LANDING_SHA} / ${LANDING_CUTOFF})后 ff-red 率相对基线(${BASELINE_FF_RED}/${BASELINE_TOTAL}` +
    `≈${(BASELINE_RATE * 100).toFixed(1)}%)实测下降,且样本量 ≥ ${MIN_SAMPLE}`,
  () => {
    if (!liveEnabled) {
      console.log(`SKIP: 未设置 ${LIVE_ENV}=1——见文件头注的事故记录,默认在全量 suite 里不断言。`);
      return;
    }
    const records = readWorkerOutcomeLines();
    const postLanding = records.filter((r) => typeof r.ts === "string" && r.ts >= LANDING_CUTOFF);
    const withFanIn = postLanding.filter((r) => r.mechanical_fan_in);
    const ffRed = withFanIn.filter(isFfRed);
    const total = withFanIn.length;
    const rate = total > 0 ? ffRed.length / total : null;

    assert.ok(
      total >= MIN_SAMPLE,
      `样本量不足(${total}/${MIN_SAMPLE})——落地窗口内机械 fan-in 尝试还不够多,` +
        "现在下『冲突率下降』结论没有统计意义,判 fail 而非放行(硬规则 3b:未评估 ⇒ 不与合格同形)。" +
        "等生产再跑一段时间、样本积累够了再复验此判据。"
    );
    assert.ok(
      rate !== null && rate < BASELINE_RATE,
      `落地后 ff-red 率 ${ffRed.length}/${total}` +
        `${rate === null ? "" : `≈${(rate * 100).toFixed(1)}%`} 未低于基线 ${(BASELINE_RATE * 100).toFixed(1)}%——` +
        "字段级传播 + 并集短路判据的效果在生产读数上还没体现出来,不判 covered。"
    );
  }
);
