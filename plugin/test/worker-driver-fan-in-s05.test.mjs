// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/10 (10 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { CONTROL_STATE_REL, ENVIRONMENT_FATAL_HALTED_BY, ENVIRONMENT_FATAL_SIGNATURES, ENV_FATAL_FANOUT_WINDOW_MS, ORDINARY_REASON, QUICK_DEATH_BACKOFF_DEFAULT, RATE_LIMIT_NO_RESET_REASON, RATE_LIMIT_REASON, WORKER_OUTCOME_REL, after, appendOutcomeToFile, assert, classifyQuickDeathCause, classifyQuickDeathEvidence, computeOutcome, dispatchStoreFile, environmentFatalHaltReason, fs, haltForEnvironmentFatal, isBackedOff, isQuickDeath, makeGitRoot, makeRoot, newQuickDeathBackoffState, parseBackoffBaseMs, parseBackoffMaxMs, parseBackoffThreshold, parseQuickDeathMs, parseRateLimitResetAtMs, path, quickDeathSignature, readControlState, readDispatchStore, readOutcomeLines, readTaskStatus, recordQuickDeathBackoff, resolveWorkerProcessName, rmSafe, runEnvironmentSmoke, runGit, spawn, spawnResident, splitArgs, upsertDispatchRecord, waitFor, writeProfileCarrier, writeTaskFile } from "./helpers/worker-driver-fan-in-harness.mjs";

test("AC1+AC3 pure — recordQuickDeathBackoff: 退避按 task、间隔随次数增长、到上限转 needsHuman、非快速死亡复位", () => {
  const state = newQuickDeathBackoffState();
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 1000, maxBackoffMs: 5000 };
  // 1st quick death → backed off, delay = base（1000ms）。
  const r1 = recordQuickDeathBackoff(state, "gap-a", "failed", 5000, 100_000, 3, cfg);
  assert.equal(r1.quickDeath, true);
  assert.equal(r1.backedOff, true, "1st quick death (≥threshold=1) ⇒ backed off");
  assert.equal(r1.newlyNeedsHuman, false);
  assert.equal(state.backoffUntil.get("gap-a"), 101_000, "1st backoff until = now + base");
  assert.equal(isBackedOff(state, "gap-a", 100_000), true, "backed off at now");
  assert.equal(isBackedOff(state, "gap-a", 100_999), true, "still backed off just before expiry");
  assert.equal(isBackedOff(state, "gap-a", 101_000), false, "backoff elapsed ⇒ eligible again");
  // 2nd quick death → backoff grows（2×base）。
  const r2 = recordQuickDeathBackoff(state, "gap-a", "failed", 5000, 200_000, 3, cfg);
  assert.equal(r2.backedOff, true);
  assert.equal(state.backoffUntil.get("gap-a"), 202_000, "2nd backoff = now + 2×base（随次数增长）");
  // 3rd quick death → cap → needsHuman（⛔ 不无限退避）。
  const r3 = recordQuickDeathBackoff(state, "gap-a", "failed", 5000, 300_000, 3, cfg);
  assert.equal(r3.newlyNeedsHuman, true, "3rd quick death ≥ maxRetries ⇒ needsHuman");
  assert.equal(r3.backedOff, false, "needsHuman ⇒ no more backoff（notNeedsHuman 过滤停止重派）");
  assert.equal(state.backoffUntil.get("gap-a"), undefined, "backoff cleared on needsHuman");
  // 非快速死亡复位（「连续」断链）：quick death 后再活过 quickDeathMs ⇒ 计数清零。
  const s2 = newQuickDeathBackoffState();
  recordQuickDeathBackoff(s2, "gap-b", "failed", 5000, 100_000, 3, cfg);
  assert.equal(s2.counts.get("gap-b"), 1, "one quick death counted");
  const reset = recordQuickDeathBackoff(s2, "gap-b", "failed", 70_000, 200_000, 3, cfg); // 70s ≥ 60s ⇒ not quick death
  assert.equal(reset.quickDeath, false);
  assert.equal(s2.counts.get("gap-b"), undefined, "survived run resets the consecutive quick-death count");
  assert.equal(s2.backoffUntil.get("gap-b"), undefined, "backoff cleared on non-quick-death");
});

// ── gap-reconcile-finalizes-live-worker-as-exited-and-double-dispatches-same-task（AC4）────────────
// 孤儿 finalize 的 outcome 带 orphan_pid_liveness（/proc 实测取值）。⛔ 一个【没测量出来的】死亡不得
// 烧重试预算：unknown（/proc 读不到）与 alive（其实还活着）都不算快速死亡，也不打断已测量的连续序列。


test("AC4 (三值分流) — isQuickDeath/recordQuickDeathBackoff：只有实测 'exited' 才算死亡；'unknown'/'alive' 不计入连续计数", () => {
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 1000, maxBackoffMs: 5000 };

  // ① 纯函数面：同一 (finalState, wallClock) 下三个取值给出不同判定。
  assert.equal(isQuickDeath("failed", 5000, cfg, "exited"), true, "measured exit ⇒ quick death (既有语义不变)");
  assert.equal(isQuickDeath("failed", 5000, cfg, "unknown"), false, "⛔ 没测成的死亡不是死亡");
  assert.equal(isQuickDeath("failed", 5000, cfg, "alive"), false, "⛔ 还活着当然不是死亡");
  assert.equal(isQuickDeath("failed", 5000, cfg, undefined), true, "缺字段（普通 worker 终态）⇒ 既有语义不变");

  // ② AC4 左臂：N 次「无法判定」（N > backoffMaxRetries）⇒ 永远不 needs-human，且状态【不动】。
  const unknownState = newQuickDeathBackoffState();
  for (let i = 0; i < 5; i++) {
    const r = recordQuickDeathBackoff(unknownState, "gap-unk", "failed", 5000, 100_000 + i, 3, cfg, "unknown");
    assert.equal(r.quickDeath, false, `AC4: unknown #${i + 1} is not a quick death`);
    assert.equal(r.newlyNeedsHuman, false, `AC4: unknown #${i + 1} never parks the task needs-human`);
  }
  assert.equal(unknownState.counts.get("gap-unk"), undefined, "AC4: unknown 不计数（⛔ 不烧重试预算）");
  assert.equal(unknownState.backoffUntil.get("gap-unk"), undefined, "AC4: unknown 也不产生退避（没有死亡可退避）");

  // ③ AC4 右臂（同构对照）：同样 N 次，换成「确认已退出」⇒ 到上限即 needs-human。
  const exitedState = newQuickDeathBackoffState();
  let parked = false;
  for (let i = 0; i < 5; i++) {
    parked = recordQuickDeathBackoff(exitedState, "gap-exi", "failed", 5000, 100_000 + i, 3, cfg, "exited").newlyNeedsHuman || parked;
  }
  assert.equal(parked, true, "AC4 对照：5 次【实测】快速死亡 ⇒ 到 maxRetries 标 needs-human");
  assert.ok(exitedState.counts.get("gap-exi") >= 3, "AC4 对照：连续计数已达 maxRetries=3");
  assert.notEqual(unknownState.counts.get("gap-unk"), exitedState.counts.get("gap-exi"),
    "AC4 承重：同一构造下 unknown 与 exited 必须给出【不同】计数结果（否则这条判据什么也没测）");

  // ④ unknown 不打断【已测量】的连续死亡序列（⛔ 与「非快速死亡 ⇒ 复位」刻意不同形，硬规则 3）。
  const mixed = newQuickDeathBackoffState();
  recordQuickDeathBackoff(mixed, "gap-mix", "failed", 5000, 100_000, 3, cfg, "exited");
  assert.equal(mixed.counts.get("gap-mix"), 1, "one measured quick death");
  recordQuickDeathBackoff(mixed, "gap-mix", "failed", 5000, 100_001, 3, cfg, "unknown");
  assert.equal(mixed.counts.get("gap-mix"), 1, "unknown 后计数保持 1（⛔ 不复位——否则交错注入 unknown 可洗白真实 streak）");
  const third = recordQuickDeathBackoff(mixed, "gap-mix", "failed", 5000, 100_002, 3, cfg, "exited");
  assert.equal(mixed.counts.get("gap-mix"), 2, "the measured streak continues past an unknown");
  assert.equal(third.newlyNeedsHuman, false, "2 < maxRetries ⇒ not yet parked");
});

// ── gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human ───────────
// 根因：快速死亡退避把【一切】<quickDeathMs 的非零退出计入【同一个桶】（QUICK_DEATH_FINAL_STATES），
// 连续 ≥backoffMaxRetries 次即 newlyNeedsHuman。但账号级限流在性质上不同：瞬时的、外部的、自愈的，
// 且【错误文本自带失效时刻】——被计入同一个桶 ⇒ 任务被永久停摆（终态不自愈），真相却只是「等一会儿」。
// 实测（2026-09-13，第三方项目 quay-fleet 的 .quay/worker-outcome.jsonl）：连续三条 selector_reason
// 逐字相同（含 `You've hit your session limit · resets 11:30am (UTC)`），wall_clock_ms = 4643 / 7685 /
// 5106（三次都 <60s ⇒ 三次都计入上限）⇒ 任务被机械翻 needs-human，成因类记成 human-adjudication。
// ⛔ 关键点：driver 已经握着能区分的证据（限流原文完整落在 selector_reason 里）——不是看不出来，
// 是看出来了但不分类。修法只用【已捕获文本】做字面子串匹配（⛔ 不新增探测面、⛔ 无语义判断）。



test("AC1 (能取假, 双输入对照) — classifyQuickDeathCause: 限流文本 ⇒ transient-external；换成普通失败文本 ⇒ 不同取值", () => {
  const a = classifyQuickDeathCause(RATE_LIMIT_REASON);
  const b = classifyQuickDeathCause(ORDINARY_REASON);
  assert.equal(a, "transient-external", "第一手样本（quay-fleet 逐字 selector_reason）⇒ transient-external");
  assert.notEqual(a, b, "AC1 承重：两个输入必须给出【不同】输出（否则这条判据空转）");
  assert.equal(b, "ordinary", "反例输入 ⇒ 普通快速死亡（⛔ 不命中任何限流签名）");
});


test("AC3 (能取假, 双输入) — 退避时刻取自文本自带的重置时刻；解析不出 ⇒ 回落指数退避且 backoffUntil 非空", () => {
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 1000, maxBackoffMs: 5000 };
  // 固定 nowMs（2026-01-15 11:13:00Z）——正是实测里 11:13:05.897Z 那条的附近。
  const nowMs = Date.UTC(2026, 0, 15, 11, 13, 0);

  // 臂①：文本自带 `resets 11:30am (UTC)` ⇒ backoffUntil 恰为该时刻（⛔ 不是 now+指数退避）。
  const s1 = newQuickDeathBackoffState();
  const r1 = recordQuickDeathBackoff(s1, "gap-rl", "failed", 4643, nowMs, 3, cfg, undefined, RATE_LIMIT_REASON);
  assert.equal(r1.cause, "transient-external");
  assert.equal(
    s1.backoffUntil.get("gap-rl"),
    Date.UTC(2026, 0, 15, 11, 30, 0),
    "退避到错误文本自带的重置时刻（2026-01-15T11:30:00Z）",
  );
  // 双输入对照：换掉文本里的重置时刻 ⇒ backoffUntil 跟着变（⛔ 非硬编码）。
  const s1b = newQuickDeathBackoffState();
  recordQuickDeathBackoff(s1b, "gap-rl", "failed", 4643, nowMs, 3, cfg, undefined,
    'got "You\'ve hit your session limit · resets 11:47am (UTC)"');
  assert.equal(s1b.backoffUntil.get("gap-rl"), Date.UTC(2026, 0, 15, 11, 47, 0), "换输入 ⇒ 换读数");
  assert.notEqual(s1.backoffUntil.get("gap-rl"), s1b.backoffUntil.get("gap-rl"), "AC3 承重：读数随输入变");
  // 重置时刻已过 ⇒ 次日同时刻（⛔ 不返回一个已过去的时刻 = 静默退化成「立刻重试」）。
  const s1c = newQuickDeathBackoffState();
  recordQuickDeathBackoff(s1c, "gap-rl", "failed", 4643, Date.UTC(2026, 0, 15, 12, 0, 0), 3, cfg, undefined, RATE_LIMIT_REASON);
  assert.equal(s1c.backoffUntil.get("gap-rl"), Date.UTC(2026, 0, 16, 11, 30, 0), "已过 ⇒ 次日同时刻");

  // 臂②：文本【不含】重置时刻 ⇒ 回落指数退避，且 backoffUntil 非空（⛔ 不是"立刻重试"）。
  const s2 = newQuickDeathBackoffState();
  const r2 = recordQuickDeathBackoff(s2, "gap-rl2", "failed", 5106, nowMs, 3, cfg, undefined, RATE_LIMIT_NO_RESET_REASON);
  assert.equal(r2.cause, "transient-external", "无重置时刻不改成因类（仍是限流）");
  assert.equal(s2.backoffUntil.get("gap-rl2"), nowMs + 1000, "回落到 now + baseBackoffMs（指数退避底数）");
  assert.ok(r2.backoffUntil != null, "backoffUntil 非空");
  // 解析器本身的两个取值：读得出 / 读不出，⛔ 不与「不适用」同形。
  assert.equal(parseRateLimitResetAtMs(RATE_LIMIT_REASON, nowMs), Date.UTC(2026, 0, 15, 11, 30, 0));
  assert.equal(parseRateLimitResetAtMs(RATE_LIMIT_NO_RESET_REASON, nowMs), null, "无重置时刻 ⇒ null（缺值 = 未查）");
  assert.equal(parseRateLimitResetAtMs("resets soon (UTC)", nowMs), null, "读不懂 ⇒ null");
});


test("AC4 (能取假, 硬规则 3b) — 三态互不相同：transient-external / ordinary / unclassifiable（读不懂不得与任一合格态同形）", () => {
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 1000, maxBackoffMs: 5000 };
  const transient = classifyQuickDeathCause(RATE_LIMIT_REASON);
  const ordinary = classifyQuickDeathCause(ORDINARY_REASON);
  const unreadable = classifyQuickDeathCause(null);
  const unreadableBlank = classifyQuickDeathCause("   ");
  const unreadableUndef = classifyQuickDeathCause(undefined);
  assert.equal(transient, "transient-external");
  assert.equal(ordinary, "ordinary");
  assert.equal(unreadable, "unclassifiable", "读不懂（null）⇒ 第三取值，⛔ 不落成前两者之一");
  assert.equal(unreadableBlank, "unclassifiable", "全空白同判");
  assert.equal(unreadableUndef, "unclassifiable", "undefined 同判");
  // 三个取值【逐一】断言不相等（AC4 的字面要求）。
  assert.notEqual(transient, ordinary);
  assert.notEqual(transient, unreadable);
  assert.notEqual(ordinary, unreadable);

  // 判别式上按 ordinary 计（fail-safe：读不懂不得无限重派），但取值【如实】为 unclassifiable。
  const s = newQuickDeathBackoffState();
  let last = null;
  for (let i = 0; i < 3; i++) {
    last = recordQuickDeathBackoff(s, "gap-u", "failed", 5000, 100_000 + i, 3, cfg, undefined, null);
    assert.equal(last.cause, "unclassifiable", `第 ${i + 1} 次的成因取值如实可区分`);
  }
  assert.equal(last.newlyNeedsHuman, true, "unclassifiable 到上限 ⇒ 转 needs-human（⛔ 不无限重派）");
  // 对照臂：同样 3 次换成 transient-external ⇒ ⛔ 永不 newlyNeedsHuman。
  const s2 = newQuickDeathBackoffState();
  let parkedTransient = false;
  for (let i = 0; i < 3; i++) {
    parkedTransient = recordQuickDeathBackoff(s2, "gap-t", "failed", 5000, 100_000 + i, 3, cfg, undefined, RATE_LIMIT_NO_RESET_REASON).newlyNeedsHuman || parkedTransient;
  }
  assert.equal(parkedTransient, false, "AC4 对照：transient-external 到上限也不停摆");
  assert.equal(s2.counts.get("gap-t"), undefined, "transient 不进普通连续计数（⛔ 混桶会让限流顶满上限）");
});


test("AC2 (能取假, 双向对照) — N > maxRetries 次 transient-external 快速死亡 ⇒ ⛔ 不翻 needs-human；同样次数换成普通快速死亡 ⇒ 翻", async (t) => {
  const MAX_RETRIES = 2;
  // 退避压到 20/40ms（默认 30s/300s 会让本测试等到天亮）——⛔ 只压时长，不压机制。
  const FAST_BACKOFF = ["--max-retries", String(MAX_RETRIES), "--backoff-base-ms", "20", "--backoff-max-ms", "40", "--interval", "20"];
  // selector 输出的 reason 用 \x20/\x27 拼空格与单引号：splitArgs 按空白裸切、无 shell 引号（见 driver-runtime.ts）。
  const selectorFor = (reason) => `node -e console.log('gap-rl\\x20${reason}')`;

  // ── 臂①（限流）：N=4 > maxRetries=2 次 transient-external 快速死亡 ⇒ 任务【仍不是】needs-human ──
  const rootA = makeGitRoot("transient-ac2");
  writeTaskFile(rootA, "gap-rl", "ready");
  const drvA = spawnResident(rootA, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-rl'],pool:1}))",
    "--selector-cmd", selectorFor("You\\x27ve\\x20hit\\x20your\\x20session\\x20limit"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(1)",
    ...FAST_BACKOFF,
  ]);
  t.after(() => drvA.stop());
  t.after(() => rmSafe(rootA));

  await waitFor(() => readOutcomeLines(rootA).length >= 4, 30000);
  const recsA = readOutcomeLines(rootA);
  assert.ok(recsA.length >= 4, `AC2 臂①：至少 4 次派发（> maxRetries=${MAX_RETRIES}），实测 ${recsA.length}`);
  assert.ok(recsA.every((r) => r.final_state === "failed"), "AC2 臂①：每次都是 failed（快速死亡）");
  // 生产载体字段（硬规则 4 推论三）：真驱动跑 ⇒ quick_death_cause 真的落进 .quay/worker-outcome.jsonl。
  assert.ok(
    recsA.slice(0, 4).every((r) => r.quick_death_cause === "transient-external"),
    "AC2 臂①：载体字段取值为 transient-external（⛔ 不是 fixture 顶替）",
  );
  assert.equal(readTaskStatus(rootA, "gap-rl"), "ready", "AC2 承重左臂：N 次限流快速死亡后任务【仍不是】needs-human");
  const bodyA = fs.readFileSync(path.join(rootA, "tasks", "gap-rl.md"), "utf8");
  assert.ok(!bodyA.includes("## Needs-Human"), "AC2 承重左臂：⛔ 不写 ## Needs-Human（任务未被停摆）");
  await drvA.stop();

  // ── 臂②（负控制, 同构）：同样 N 次换成【普通】快速死亡 ⇒ 到 maxRetries 即 needs-human ──
  const rootB = makeGitRoot("ordinary-ac2");
  writeTaskFile(rootB, "gap-rl", "ready");
  const drvB = spawnResident(rootB, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-rl'],pool:1}))",
    "--selector-cmd", selectorFor("flaky-red"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(1)",
    ...FAST_BACKOFF,
  ]);
  t.after(() => drvB.stop());
  t.after(() => rmSafe(rootB));

  await waitFor(() => readTaskStatus(rootB, "gap-rl") === "needs-human", 30000);
  assert.equal(readTaskStatus(rootB, "gap-rl"), "needs-human", "AC2 承重右臂：普通快速死亡到上限 ⇒ needs-human");
  const recsB = readOutcomeLines(rootB);
  assert.equal(recsB[0].quick_death_cause, "ordinary", "AC2 右臂载体字段 = ordinary（⛔ 与左臂取值不同）");
  assert.notEqual(recsB[0].quick_death_cause, recsA[0].quick_death_cause, "AC2 承重：两臂成因取值必须不同");
  await drvB.stop();
});


test("AC5 (结构性, 负控制) — 非快速死亡（completed / exited-not-landed / timed-out / 慢速失败）⛔ 不发射成因字段（缺键 ≠ 某个取值）", () => {
  const base = {
    task: "gap-x", selectorReason: RATE_LIMIT_REASON, exitCode: 0, signal: null,
    startedAtMs: 0, endedAtMs: 1000, workerPid: 1, runId: "r",
  };
  // completed（exit 0 + landed）⇒ 非快速死亡 ⇒ 缺键。
  const completed = computeOutcome({ ...base, landed: true });
  assert.equal(completed.final_state, "completed");
  assert.ok(!("quick_death_cause" in completed), "completed ⇒ ⛔ 无成因字段（缺键，不是某个取值）");
  // exited-not-landed（exit 0 + 未落地）⇒ 缺键（自有重试上限机制，⛔ 不与其重叠计数）。
  const notLanded = computeOutcome({ ...base, landed: false, landReason: "x" });
  assert.equal(notLanded.final_state, "exited-not-landed");
  assert.ok(!("quick_death_cause" in notLanded), "exited-not-landed ⇒ ⛔ 无成因字段");
  // timed-out ⇒ 缺键。
  const timedOut = computeOutcome({ ...base, timedOut: true });
  assert.equal(timedOut.final_state, "timed-out");
  assert.ok(!("quick_death_cause" in timedOut), "timed-out ⇒ ⛔ 无成因字段");
  // 慢速失败（failed 但墙钟 ≥ quickDeathMs）⇒ 缺键（⛔ 不进快速死亡桶，同 isQuickDeath 语义）。
  const slow = computeOutcome({ ...base, exitCode: 1, endedAtMs: QUICK_DEATH_BACKOFF_DEFAULT.quickDeathMs + 1 });
  assert.equal(slow.final_state, "failed");
  assert.ok(!("quick_death_cause" in slow), "慢速失败 ⇒ ⛔ 无成因字段");
  // 对照：同一条限流文本在【快速死亡】时 ⇒ 字段出现且取值正确（⛔ 证明上面不是恒缺）。
  const quick = computeOutcome({ ...base, exitCode: 1, endedAtMs: 5000 });
  assert.equal(quick.quick_death_cause, "transient-external", "快速死亡 ⇒ 字段出现且取值为 transient-external");
  assert.notEqual(quick.quick_death_cause, completed.quick_death_cause, "两态必须可区分");
});

// ── AC5 (读生产载体) — 真解析 + 真 /proc + 真 .quay/worker-outcome.jsonl，经常驻环的 reconcile 步 ──
// ⚠️ 这是【临时 root 的真实驱动跑】而不是 quay 的自然生产样本：实现落地时点之后，主仓/第三方仓的
// 自然样本数为 0（窗口还开着，见任务体的 AC5 记述）。本条证明的是【字段真的经常驻环落进载体】——
// 硬规则 4 推论三点名的失败形态正是「实现了、单测绿了、生产载体一次都没写过」。
// 臂① 孤儿 pid【确已退出】⇒ reconcile 写出一条带 orphan_pid_liveness="exited" 的记录。
// 臂② 孤儿 pid【仍是本任务活 worker】⇒ ⛔ 一条孤儿 finalize 记录都不落（这正是本缺陷写过的那条假记录）。

test("AC5 (生产载体, 双臂) — 常驻环 reconcile：确已退出的孤儿 ⇒ 载体落一条带 liveness 的假阳性可检验记录；活 worker ⇒ ⛔ 不落", async (t) => {
  const root = makeGitRoot("orphan-carrier-ac5");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-ac5`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });
  writeProfileCarrier(root); // worker 名 = quay-test-worker（⛔ 不是 quay-task-worker）⇒ 顺带压住名字解析
  const workerName = resolveWorkerProcessName(root);
  assert.equal(workerName, "quay-test-worker", "precondition: 名字解析自载体，不是写死的字面量");
  const taskId = "gap-orphan-carrier-ac5";
  const taskDead = "gap-orphan-carrier-ac5-dead";
  writeTaskFile(root, taskId, "ready");
  writeTaskFile(root, taskDead, "ready");
  runGit(root, ["worktree", "add", "-q", "-b", `task/${taskId}`, wtPath]);
  const outcomeFile = path.join(root, WORKER_OUTCOME_REL);
  const dispatchFile = dispatchStoreFile(root);
  const orphanRecords = () => (fs.existsSync(outcomeFile) ? readOutcomeLines(root) : [])
    .filter((o) => /orphaned worker finalized by reconcile/.test(o.failure_reason ?? ""));

  // 臂②：一个【仍是本任务活 worker】的孤儿（cmdline 含解析出的 worker 名 + task id）。
  const live = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", workerName, taskId], { stdio: "ignore" });
  t.after(() => { try { live.kill("SIGKILL"); } catch { /* gone */ } });
  await new Promise((r) => setTimeout(r, 100));
  upsertDispatchRecord(dispatchFile, {
    taskId, runId: "fm-ac5-live", workerPid: live.pid, selectorReason: "ac5 live arm",
    startedAtMs: Date.now() - 1000, timeoutDeadlineMs: 0,
    cmdlineFingerprint: `claude -n ${workerName} -p '... Task: ${taskId} ...'`,
  });

  let drv = null;
  t.after(async () => { if (drv) await drv.stop(); });
  drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:[],pool:0}))",
    "--selector-cmd", "node -e console.log('gap-x\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
    // 臂② adopt 了一个长跑孤儿 ⇒ 退出边沿事件不来，循环只在【协调地板】上醒；缺省 300s 会让臂①
    // 等不到下一趟 reconcile（实测：25s 等待超时，唯一的失败就是这个）。地板压到 1s。
    "--reconcile-interval", "1",
  ]);
  // ⚠️ waitFor 超时【不抛】而是返回 falsy ⇒ 必须显式断言，⛔ 不能只 await（那是恒真的空转判据）。
  const adopted = await waitFor(() => drv.events().some((e) => e.event === "orphan-adopted" && e.task === taskId), 20000);
  assert.ok(adopted, "AC5 臂②: 活 worker 被 adopt（⛔ 不是被判死）——这是 reconcile 的正确归宿");
  assert.equal(orphanRecords().length, 0, "AC5 臂②: 活 worker 期间载体里【零】孤儿 finalize 记录（⛔ 这正是本缺陷写过的那条假记录）");
  assert.ok(readDispatchStore(dispatchFile)[taskId], "AC5 臂②: 记录仍在（adopt 中，⛔ 不被判死清掉）");
  // AC3 的派发计数侧（配置名 ≠ 写死名的形态）：存活 worker 在飞 ⇒ 同任务派发计数 = 0。
  assert.equal(drv.events().some((e) => e.event === "worker-spawned" && e.task === taskId), false,
    "AC3: 同一 taskId 已有存活 worker ⇒ ⛔ 不再派第二个（派发计数 = 0）");

  // 臂①：另起一个【确已退出】的孤儿（真 spawn、真等退出、真等 /proc 条目消失）。
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await new Promise((r) => dead.once("exit", r));
  const deadPid = dead.pid;
  await waitFor(() => { try { return !fs.existsSync(`/proc/${deadPid}`); } catch { return true; } }, 15000);
  assert.equal(fs.existsSync(`/proc/${deadPid}`), false, "precondition: 「确已退出」本身也是测量出来的（/proc 条目已消失）");
  upsertDispatchRecord(dispatchFile, {
    taskId: taskDead, runId: "fm-ac5-dead", workerPid: deadPid, selectorReason: "ac5 dead arm",
    startedAtMs: Date.now() - 1000, timeoutDeadlineMs: 0,
    cmdlineFingerprint: `claude -n ${workerName} -p '... Task: ${taskDead} ...'`,
  });

  const landed = await waitFor(() => orphanRecords().some((o) => o.task === taskDead), 25000);
  assert.ok(landed, "AC5 臂①: reconcile 真的往生产载体写了一条孤儿 finalize 记录（⛔ 不是只写进单测的返回值）");
  const rec5 = orphanRecords().find((o) => o.task === taskDead);
  assert.equal(rec5.final_state, "failed", "AC5 臂①: 非 completed 终态");
  assert.equal(rec5.orphan_pid_liveness, "exited",
    "AC5 承重: 载体记录带【实测】liveness ⇒ 断言从此可被读者取假（⛔ 此前载体里没有这个字段，声称无法被检验）");
  assert.match(rec5.failure_reason, /already exited/, "AC5 臂①: 实测已退出 ⇒ 保留原措辞");
  // ⚠️ 本断言此前是【立即】`assert.equal(readDispatchStore(...)[taskDead], undefined)`，在满载下偶发红
  // （`AC5 臂①: 记录被清（孤儿有归宿）`）。根因是【观测时差】，不是记录没被清：驱动的
  // `finalizeOrphanDispatch` 在同一函数里【先】`appendOutcomeToFile`（= 上面 waitFor 的触发条件）
  // 【后】`removeDispatchRecord`，两者在驱动进程内同步且相邻；而本测试是从【另一个进程】经文件系统
  // 观测的 ⇒ 看到 outcome 行的那一刻，清记录可能尚未跑完（fs 延迟随宿主负载增长，窗口随之变宽）。
  // 判别对照（决定性）：在 append 与 remove 之间注入 400ms 同步延迟 ⇒ 该断言 5/5 必红 ⇒ 这是观测时差，
  // 不是跨进程 read-modify-write 竞争（无并发写者也能构造出该红）。故改为【等待终态成立】——
  // 判据语义逐字不变（终态仍必须清记录；`removeDispatchRecord` 若被移除/失效 ⇒ 轮询超时 ⇒ 断言取假）。
  const clearedOrphan = await waitFor(() => readDispatchStore(dispatchFile)[taskDead] === undefined, 10000);
  assert.ok(clearedOrphan, "AC5 臂①: 记录被清（孤儿有归宿）");

  // AC5 的判据形式：该载体里此类记录数 ≥1 且【假阳性 = 0】（假阳性 = 声称已退出但实测不是已退出）。
  const all = orphanRecords();
  const falsePositives = all.filter((o) => o.orphan_pid_liveness !== "exited");
  assert.ok(all.length >= 1, `AC5: 该类记录数 ≥1（实测 ${all.length}）`);
  assert.equal(falsePositives.length, 0,
    `AC5: 假阳性 = 0（实测 ${falsePositives.length}；每条都带 orphan_pid_liveness ⇒ 该计数不是自证而是可复核的）`);
  drv.stop();
});


test("AC1 pure — 按 task 隔离：一个 task 退避不影响另一个 task 的退避状态", () => {  const state = newQuickDeathBackoffState();
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 1000, maxBackoffMs: 5000 };
  recordQuickDeathBackoff(state, "gap-a", "failed", 5000, 100_000, 3, cfg);
  assert.equal(isBackedOff(state, "gap-a", 100_000), true, "gap-a backed off");
  assert.equal(isBackedOff(state, "gap-b", 100_000), false, "gap-b unaffected（退避按 task，⛔ 不全局）");
});


test("parse helpers — quick-death-ms/backoff-base-ms/backoff-max-ms/backoff-threshold fail-to-default", () => {
  assert.equal(QUICK_DEATH_BACKOFF_DEFAULT.quickDeathMs, 60_000);
  assert.equal(parseQuickDeathMs(undefined), 60_000, "no --quick-death-ms ⇒ default 60s");
  assert.equal(parseQuickDeathMs("120000"), 120_000, "explicit honored");
  assert.equal(parseQuickDeathMs("garbage"), 60_000, "garbage ⇒ default");
  assert.equal(parseBackoffBaseMs(undefined), 30_000);
  assert.equal(parseBackoffBaseMs("100"), 100, "explicit honored");
  assert.equal(parseBackoffBaseMs("0"), 30_000, "non-positive ⇒ default");
  assert.equal(parseBackoffMaxMs(undefined), 300_000);
  assert.equal(parseBackoffMaxMs("1000"), 1000);
  assert.equal(parseBackoffMaxMs("-5"), 300_000, "negative ⇒ default");
  assert.equal(parseBackoffThreshold(undefined), 1, "default threshold = 1");
  assert.equal(parseBackoffThreshold("2"), 2);
  assert.equal(parseBackoffThreshold("0"), 1, "threshold must be ≥1 ⇒ default");
  assert.equal(parseBackoffThreshold("1.5"), 1, "non-integer ⇒ default");
});


// ── gap-worker-quick-death-environment-fatal-halts-driver ────────────────────────────────────────────
// 根因（生产实例 claudecodeui 2026-09-20）：`.quay/profiles.yml` 还是出厂模板（launcher `claude` /
// model 为网关专用名），首个 API 调用 404 `model_not_found` ⇒ 秒死。driver 把这当成【任务级】快速死亡
// 逐个计数、逐个 park，直到池子被清空（13 条快速死亡全被判 ordinary、载体里 `model_not_found` 出现
// 0 次、5 个任务被翻 needs-human）。两处结构性原因：① 分类器只读 selector_reason，而 worker 的 stderr
// 以 `stdio:"inherit"` 流走、一个字节都进不了判定面；② 动作只有「退避重试 / 翻该任务」两种，没有
// 「停 driver」。修法 = 环境级第四类 + 跨任务关联 + driver 自停 + 启动冒烟。

/** worker 命令夹具（真驱动臂）：写一行 stderr 后非零退出。⛔ 不能含空白——splitArgs 按空白裸切、无
 *  shell 引号（同本文件上面的 selectorFor）：空格一律写成 `\x20`，由 `node -e` 在 JS 字符串字面量里还原。 */
const workerCmdWritingStderr = (body) => `node -e process.stderr.write('${body}');process.exit(1)`;
/** 第一手字面形态（AC1① 的字面要求：`404 … model_not_found`）。 */
const MODEL_NOT_FOUND_STDERR = "API\\x20Error:\\x20404\\x20model_not_found";
/** 一个【不在清单里】的签名（AC1② 的跨任务关联臂：两个任务以它快速死亡 ⇒ 第二条判 environment-fatal）。 */
const UNKNOWN_SIGNATURE_STDERR = "flaky\\x20unknown\\x20signature\\x20E42";
const CONTROL_STATE_ABS = (root) => path.join(root, CONTROL_STATE_REL);
const readControlFile = (root) => {
  try { return JSON.parse(fs.readFileSync(CONTROL_STATE_ABS(root), "utf8")); } catch { return null; }
};

test("签名表 (能取假, 双向) — 每条环境级签名命中自己的 example、【不】命中自己的 counterexample；正反例都非空", () => {
  assert.ok(ENVIRONMENT_FATAL_SIGNATURES.length >= 4, `签名表非空且覆盖四族（实测 ${ENVIRONMENT_FATAL_SIGNATURES.length} 条）`);
  for (const sig of ENVIRONMENT_FATAL_SIGNATURES) {
    assert.ok(!sig.re.global, `${sig.name}: 正则不得带 g（带 g 的 test 有 lastIndex 状态 ⇒ 判据会抖动）`);
    assert.ok(sig.example.length > 0 && sig.counterexample.length > 0, `${sig.name}: 正反例都必须非空`);
    assert.ok(sig.re.test(sig.example), `${sig.name} 必须命中自己的 example（否则这条签名是死的）`);
    // 承重条：过宽的签名必然在自己的反例上命中 ⇒ 「宁窄勿宽」在这个断言上真正取假。
    assert.ok(!sig.re.test(sig.counterexample), `${sig.name} ⛔ 不得命中自己的 counterexample（过宽即在此失败）`);
  }
  // 整张表对 canonical 普通失败文本一条都不命中（负控）。
  assert.equal(classifyQuickDeathEvidence(ORDINARY_REASON, ORDINARY_REASON).cause, "ordinary",
    "普通快速死亡文本 ⇒ ordinary（⛔ 不命中任何环境级签名）");
});

test("AC1①+AC1④ (纯函数, 双输入) — stderr 尾部的 `404 … model_not_found` ⇒ environment-fatal；限流文本 ⇒ 仍 transient-external（不回归）", () => {
  // ① 判定面②（stderr）：selector_reason 是普通文本，环境级证据只在 stderr 尾部——旧实现看不到它。
  const byStderr = classifyQuickDeathEvidence(ORDINARY_REASON, "API Error: 404 model_not_found");
  assert.equal(byStderr.cause, "environment-fatal", "AC1①：stderr 尾部的 model_not_found ⇒ environment-fatal");
  assert.equal(byStderr.signature, "model_not_found");
  assert.match(String(byStderr.evidence), /model_not_found/, "带命中处原文（停机原因要附的「签名原文」）");
  // 双输入对照：同一 selector_reason 换成普通 stderr ⇒ 不同取值（否则这条判据空转）。
  const plain = classifyQuickDeathEvidence(ORDINARY_REASON, null);
  assert.notEqual(plain.cause, byStderr.cause, "AC1 承重：有/无 stderr 证据必须给出不同判定");
  assert.equal(plain.cause, "ordinary");
  // ② 判定面①（selector_reason）：环境级证据只在这一面时同样命中。
  const byReason = classifyQuickDeathEvidence("API Error: 404 model_not_found", null);
  assert.equal(byReason.cause, "environment-fatal", "两个判定面都可独立命中");
  // ③ 限流文本【不回归】：单面 / 双面 / 两个任务都仍是 transient-external。
  assert.equal(classifyQuickDeathEvidence(RATE_LIMIT_REASON).cause, "transient-external", "AC1④：限流文本仍判 transient-external");
  assert.equal(classifyQuickDeathEvidence(ORDINARY_REASON, RATE_LIMIT_REASON).cause, "transient-external",
    "AC1④：限流文本出现在 stderr 面时同样判 transient-external");
  // ④ 三态互不相同（硬规则 3b：读不懂不得与任一合格态同形）。
  assert.equal(classifyQuickDeathEvidence(null, "   ").cause, "unclassifiable", "两个面都读不懂 ⇒ unclassifiable");
  const three = new Set([byStderr.cause, classifyQuickDeathEvidence(RATE_LIMIT_REASON).cause, plain.cause, classifyQuickDeathEvidence(null, null).cause]);
  assert.equal(three.size, 4, "四态两两不同形");
});

test("AC1②+AC2 (纯函数) — 跨任务关联：同一【未知】签名 + 不同任务 + 窗口内 ⇒ 第二次判 environment-fatal；同任务/超窗口/限流 三条对照臂都不判", () => {
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 1000, maxBackoffMs: 5000 };
  const SIG = "flaky unknown signature E42";
  // 主臂：任务 t1 先死（普通），任务 t2 以同一签名紧随其后 ⇒ environment-fatal。
  const s = newQuickDeathBackoffState();
  const r1 = recordQuickDeathBackoff(s, "gap-t1", "failed", 5000, 1_000_000, 3, cfg, undefined, ORDINARY_REASON, SIG);
  assert.equal(r1.cause, "ordinary", "第一例：单个任务的未知签名 ⇒ 仍是普通（一个样本不构成环境证据）");
  const r2 = recordQuickDeathBackoff(s, "gap-t2", "failed", 5000, 1_000_100, 3, cfg, undefined, ORDINARY_REASON, SIG);
  assert.equal(r2.cause, "environment-fatal", "AC1②：第二个【不同任务】同签名 ⇒ environment-fatal（即使签名不在清单里）");
  assert.match(String(r2.signature), /^cross-task:/, "跨任务关联的签名名带 cross-task: 前缀（与字面签名可区分）");
  assert.equal(r2.newlyNeedsHuman, false, "AC2：跨任务关联命中 ⇒ ⛔ 也不翻该任务");
  assert.equal(s.counts.get("gap-t2"), undefined, "AC2：跨任务关联命中的任务⛔ 不增加其快速死亡计数");
  assert.equal(s.backoffUntil.get("gap-t2"), undefined, "⛔ 不设退避（该停的是 driver，不是这个任务）");
  // 对照臂①：同一任务重复同一签名 ⇒ ⛔ 不判（任务级缺陷，正是本条要与之区分的那一类）。
  const same = newQuickDeathBackoffState();
  recordQuickDeathBackoff(same, "gap-t1", "failed", 5000, 1_000_000, 3, cfg, undefined, ORDINARY_REASON, SIG);
  const again = recordQuickDeathBackoff(same, "gap-t1", "failed", 5000, 1_000_100, 3, cfg, undefined, ORDINARY_REASON, SIG);
  assert.equal(again.cause, "ordinary", "同一任务重复 ⇒ ⛔ 不判环境级（对照臂：证明「不同任务」这一条真的在判）");
  // 对照臂②：超出窗口 ⇒ ⛔ 不判（否则一个跑了一天的 driver 会把任意两次同签名死亡关联起来）。
  const late = newQuickDeathBackoffState();
  recordQuickDeathBackoff(late, "gap-t1", "failed", 5000, 1_000_000, 3, cfg, undefined, ORDINARY_REASON, SIG);
  const beyond = recordQuickDeathBackoff(late, "gap-t2", "failed", 5000, 1_000_000 + ENV_FATAL_FANOUT_WINDOW_MS + 1, 3, cfg, undefined, ORDINARY_REASON, SIG);
  assert.equal(beyond.cause, "ordinary", "超出窗口 ⇒ ⛔ 不判（对照臂：证明窗口真的生效）");
  // 对照臂③：两个任务同样【限流】⇒ 仍 transient-external（AC1④ 的承重条——限流是同族但动作不同）。
  const rl = newQuickDeathBackoffState();
  recordQuickDeathBackoff(rl, "gap-r1", "failed", 5000, 1_000_000, 3, cfg, undefined, RATE_LIMIT_REASON);
  const rl2 = recordQuickDeathBackoff(rl, "gap-r2", "failed", 5000, 1_000_100, 3, cfg, undefined, RATE_LIMIT_REASON);
  assert.equal(rl2.cause, "transient-external", "两个任务同样限流 ⇒ 仍是 transient-external（⛔ 不被跨任务关联判成环境级）");
  // 签名指纹归一化：易变量（数字/路径/哈希）折占位，措辞逐字保留——复用全仓唯一归一化点。
  assert.equal(quickDeathSignature(null, "boom 1234 x").fingerprint, quickDeathSignature(null, "boom 9876 x").fingerprint,
    "易变量差异不产生不同指纹（同一缺陷在不同任务上必须是同一签名，否则跨任务关联结构性永不成立）");
  assert.notEqual(quickDeathSignature(null, "boom 1234 x").fingerprint, quickDeathSignature(null, "other 1234 x").fingerprint,
    "措辞差异必须产生不同指纹（否则所有错误互相「关联」——硬规则 3b 的镜像面）");
  assert.equal(quickDeathSignature(null, "  "), null, "读不懂 ⇒ null（⛔ 不伪造成一个空指纹 ⇒ 读不懂的死亡不互相关联）");
  assert.equal(quickDeathSignature(null, "1 !== 2"), null, "退化指纹（折叠后无字母）⇒ null（⛔ 不当作身份，否则所有数字型失败互相关联）");
});

test("AC2 (纯函数 + 停机写盘) — environment-fatal：计数未增加/无退避/不翻 needs-human；worker-control.json halted:true 且原因含签名原文", () => {
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 1000, maxBackoffMs: 5000 };
  // maxRetries=1：普通快速死亡【一次】就该翻 needs-human——用来对照环境级「一次也不翻」。
  const s = newQuickDeathBackoffState();
  const env = recordQuickDeathBackoff(s, "gap-env", "failed", 5000, 100_000, 1, cfg, undefined, ORDINARY_REASON, "API Error: 404 model_not_found");
  assert.equal(env.cause, "environment-fatal");
  assert.equal(env.newlyNeedsHuman, false, "AC2：⛔ 不翻（maxRetries=1 也不翻——逐个 park 池子正是本缺陷）");
  assert.equal(s.counts.get("gap-env"), undefined, "AC2：涉事任务的快速死亡计数【未增加】");
  assert.equal(s.backoffUntil.get("gap-env"), undefined, "⛔ 不设退避（该停的是 driver）");
  // 对照臂（同构造）：换成普通 stderr ⇒ 计数 +1 且到上限翻 needs-human。
  const s2 = newQuickDeathBackoffState();
  const ord = recordQuickDeathBackoff(s2, "gap-ord", "failed", 5000, 100_000, 1, cfg, undefined, ORDINARY_REASON, null);
  assert.equal(ord.cause, "ordinary");
  assert.equal(s2.counts.get("gap-ord"), 1, "对照臂：普通快速死亡照常计数");
  assert.equal(ord.newlyNeedsHuman, true, "对照臂：maxRetries=1 ⇒ 到上限翻 needs-human");
  assert.notEqual(env.newlyNeedsHuman, ord.newlyNeedsHuman, "AC2 承重：两臂的翻/不翻必须不同（否则这条判据什么也没测）");
  // 停机写盘（AC2 的载体面）。
  const root = makeRoot("env-fatal-halt-write");
  try {
    const reason = environmentFatalHaltReason(env);
    const file = haltForEnvironmentFatal(root, reason);
    assert.equal(file, CONTROL_STATE_ABS(root), "写在控制态单一真相源路径上");
    const raw = fs.readFileSync(file, "utf8");
    const ctl = JSON.parse(raw);
    assert.equal(ctl.halted, true, "AC2：worker-control.json 为 halted:true");
    assert.equal(ctl.halted_by, ENVIRONMENT_FATAL_HALTED_BY, "停机主体可辨识（人/start 拒绝信息读它）");
    assert.match(ctl.halt_reason, /model_not_found/, "AC2：停机原因含【签名原文】");
    assert.equal(readControlState(root).state.halted, true, "经单一真相源 API 读回也是 halted（⛔ 不是只写了个文件）");
  } finally { rmSafe(root); }
});

test("AC1①+AC2 (真驱动, 生产载体) — stderr 尾部的 `404 … model_not_found` 快速死亡 ⇒ 载体判 environment-fatal、driver 自停、涉事任务仍 ready", async (t) => {
  const root = makeGitRoot("env-fatal-ac1");
  t.after(() => rmSafe(root));
  writeTaskFile(root, "gap-env", "ready");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-env'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-env\\x20ordinary\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", workerCmdWritingStderr(MODEL_NOT_FOUND_STDERR),
    "--max-retries", "2", "--backoff-base-ms", "20", "--backoff-max-ms", "40", "--interval", "20",
  ]);
  t.after(() => drv.stop());
  await waitFor(() => readOutcomeLines(root).length >= 1, 30000);
  const rec = readOutcomeLines(root)[0];
  assert.ok(rec, "至少一条 outcome（真驱动的生产载体）");
  assert.equal(rec.final_state, "failed", "快速死亡（<60s 非零退出）");
  assert.equal(rec.quick_death_cause, "environment-fatal", "AC1①：真驱动把 stderr 尾部的 model_not_found 判成 environment-fatal（⛔ 不是 fixture 顶替）");
  assert.match(String(rec.worker_stderr_tail ?? ""), /model_not_found/,
    "生产载体带 worker stderr 尾部（旧实现的 stdio:inherit 让它一个字节都进不到判定面/载体）");
  await waitFor(() => readControlFile(root)?.halted === true, 20000);
  const ctl = readControlFile(root);
  assert.equal(ctl?.halted, true, "AC2：environment-fatal ⇒ driver 自己 halt（worker-control.json halted:true）");
  assert.equal(ctl?.halted_by, ENVIRONMENT_FATAL_HALTED_BY);
  assert.match(String(ctl?.halt_reason ?? ""), /model_not_found/, "AC2：停机原因含签名原文");
  // 控制态与事件写在【同一段代码】里（控制态在前），但事件还要过一次 stdout 管道才到父进程 ⇒ 用
  // 有界 waitFor 兜住送达延迟，⛔ 不用裸断言（同 AC1② 的成因，见那里的注释）。
  assert.ok(await waitFor(() => drv.events().some((e) => e.event === "environment-fatal-halt"), 20000),
    "驱动发射 environment-fatal-halt 事件");
  assert.equal(readTaskStatus(root, "gap-env"), "ready", "AC2：涉事任务状态保持 ready（⛔ 未被翻 needs-human）");
  assert.ok(!fs.readFileSync(path.join(root, "tasks", "gap-env.md"), "utf8").includes("## Needs-Human"),
    "AC2：⛔ 不写 ## Needs-Human");
  await drv.stop();
});

test("AC1② (真驱动, 两个不同任务) — 同一【未知】签名快速死亡 ⇒ 第二条判 environment-fatal；池中无任务被翻 needs-human", async (t) => {
  const root = makeGitRoot("env-fatal-cross");
  t.after(() => rmSafe(root));
  writeTaskFile(root, "gap-env-a", "ready");
  writeTaskFile(root, "gap-env-b", "ready");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-env-a','gap-env-b'],pool:2}))",
    // ⛔ 固定选择 gap-env-a：它在飞时过滤器（notInFlight）把它滤掉 ⇒ parseSelectorOutput 回退到剩下的
    //    那个候选（gap-env-b）——两个任务都会被派发（--concurrency 2），这正是本臂要的形态。
    "--selector-cmd", "node -e console.log('gap-env-a\\x20cross\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", workerCmdWritingStderr(UNKNOWN_SIGNATURE_STDERR),
    "--concurrency", "2", "--max-retries", "5", "--backoff-base-ms", "5000", "--backoff-max-ms", "5000", "--interval", "20",
  ]);
  t.after(() => drv.stop());
  await waitFor(() => readOutcomeLines(root).some((r) => r.quick_death_cause === "environment-fatal"), 30000);
  const recs = readOutcomeLines(root);
  const envRecs = recs.filter((r) => r.quick_death_cause === "environment-fatal");
  const ordRecs = recs.filter((r) => r.quick_death_cause === "ordinary");
  assert.equal(envRecs.length, 1, `AC1②：恰好一条被判 environment-fatal（实测 ${recs.length} 条 outcome：${recs.map((r) => r.quick_death_cause).join(",")}）`);
  assert.ok(ordRecs.length >= 1, "AC1②：另一条（先死的那个任务）仍是 ordinary——单任务同签名不构成环境证据");
  // 载体必须记的是【判定】：被判 environment-fatal 的那条记录不能写成 ordinary（判定依赖跨任务状态，
  // 逐记录的无状态重算看不到它 —— 否则「driver 因它而停」与「载体说它普通」并存，读载体的人找不到真因）。
  assert.notEqual(ordRecs[0].task, envRecs[0].task, "两条结果分属不同任务");
  assert.match(String(envRecs[0].worker_stderr_tail ?? ""), /unknown signature E42/,
    "被判 environment-fatal 的记录带原始签名文本（跨任务关联命中的那个任务）");
  // 跨任务关联的签名标识出现在 json 事件流里（载体可核）。
  // ⛔ 顺序承重（实测过一次负载相关的假红）：上面的 waitFor 等的是【载体】(worker-outcome.jsonl)，
  // 它在 runOneWorker 内落盘；而 environment-fatal-halt 事件在 onWorkerFinished 里【之后】才写 stdout
  // ⇒ 载体一可见就断言事件 = 与 stdout 管道送达赛跑（判定本身是对的，事件也发了，只是还没到父进程）。
  // 故先等 driver 侧的停机控制态（与事件同一段代码、写在其【前】），事件断言再走一次 waitFor 兜住送达
  // 延迟。⛔ 断言不弱化：事件若根本不发，waitFor 超时返回假 ⇒ 照常红（AC1① 同型）。
  await waitFor(() => readControlFile(root)?.halted === true, 20000);
  assert.equal(readControlFile(root)?.halted, true, "driver 自己 halt");
  assert.ok(await waitFor(() => drv.events().some((e) => e.event === "environment-fatal-halt" && String(e.signature ?? "").startsWith("cross-task:")), 20000),
    "跨任务关联命中的签名名带 cross-task: 前缀，并出现在 environment-fatal-halt 事件里");
  assert.equal(readTaskStatus(root, "gap-env-a"), "ready", "池中无任务被翻 needs-human（maxRetries=5 且每次至多 1-2 次死亡）");
  assert.equal(readTaskStatus(root, "gap-env-b"), "ready", "同上（跨任务关联命中的那个任务也保持 ready）");
  await drv.stop();
});

test("AC3 (能取假, 四态) — 启动冒烟：launcher 立即以 model_not_found 退出 ⇒ refused 且原因含原文；退出 0 ⇒ pass；无 profiles ⇒ not-evaluated；非环境级失败 ⇒ failed-non-environment", async (t) => {
  const roots = [];
  const mk = (tag) => { const r = makeRoot(tag); roots.push(r); return r; };
  t.after(() => roots.forEach((r) => rmSafe(r)));
  const writeLauncher = (root, name, body) => {
    const p = path.join(root, name);
    fs.writeFileSync(p, body, { mode: 0o755 });
    return p;
  };

  // ① 假 launcher：把收到的 argv 落盘、打签名到 stderr、退出 1（AC3 的字面夹具）。
  const rootA = mk("env-smoke-refuse");
  const argvDump = path.join(rootA, "launcher-argv.txt");
  const fakeBad = writeLauncher(rootA, "fake-launcher.sh",
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${argvDump}\necho 'API Error: 404 {"type":"not_found_error"} model_not_found' >&2\nexit 1\n`);
  writeProfileCarrier(rootA, { launcher: fakeBad, model: "v4.1flash" });
  const refused = await runEnvironmentSmoke(rootA, { timeoutMs: 30000 });
  assert.equal(refused.verdict, "refused", "AC3：launcher 立即以 model_not_found 退出 ⇒ refused（调方据此非零退出、不 spawn 任何东西）");
  assert.equal(refused.signature, "model_not_found");
  assert.match(refused.reason, /model_not_found/, "AC3：原因含该原文");
  // 非空转条：冒烟用的确实是【解析出的 launcher + model】（读假 launcher 收到的 argv，而不是自证）。
  const seenArgv = fs.readFileSync(argvDump, "utf8");
  assert.match(seenArgv, /--model\nv4\.1flash/, `冒烟调用用的是 profiles.yml 解析出的 model（实测 argv: ${JSON.stringify(seenArgv)}）`);

  // ② 负控：launcher 退出 0 ⇒ pass。
  const rootB = mk("env-smoke-pass");
  const fakeOk = writeLauncher(rootB, "ok-launcher.sh", "#!/bin/sh\necho ok\nexit 0\n");
  writeProfileCarrier(rootB, { launcher: fakeOk, model: "test-model" });
  const pass = await runEnvironmentSmoke(rootB, { timeoutMs: 30000 });
  assert.equal(pass.verdict, "pass", "对照臂：launcher 退出 0 ⇒ pass");
  assert.notEqual(pass.verdict, refused.verdict, "AC3 承重：两臂取值必须不同（否则这条判据空转）");

  // ③ 读不懂：无 profiles.yml ⇒ not-evaluated（⛔ 不与 pass 同形，硬规则 3b）。
  const rootC = mk("env-smoke-not-evaluated");
  const notEval = await runEnvironmentSmoke(rootC, { timeoutMs: 5000 });
  assert.equal(notEval.verdict, "not-evaluated", "解析不出 launcher/model ⇒ 未评估（⛔ 不伪装成通过）");

  // ④ 非环境级失败（如瞬时限流）⇒ 只告警不拒启。
  const rootD = mk("env-smoke-non-env");
  const fakeOrd = writeLauncher(rootD, "ord-launcher.sh", "#!/bin/sh\necho boom >&2\nexit 3\n");
  writeProfileCarrier(rootD, { launcher: fakeOrd, model: "test-model" });
  const nonEnv = await runEnvironmentSmoke(rootD, { timeoutMs: 30000 });
  assert.equal(nonEnv.verdict, "failed-non-environment", "非环境级失败 ⇒ 只告警（拒启会把一次限流变成「起不了 driver」）");

  const verdicts = [refused.verdict, pass.verdict, notEval.verdict, nonEnv.verdict];
  assert.equal(new Set(verdicts).size, 4, `四态两两不同形（实测 ${verdicts.join(",")}）`);
});
