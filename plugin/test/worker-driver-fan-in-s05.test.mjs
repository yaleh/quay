// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/10 (10 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { ORDINARY_REASON, QUICK_DEATH_BACKOFF_DEFAULT, RATE_LIMIT_NO_RESET_REASON, RATE_LIMIT_REASON, WORKER_OUTCOME_REL, after, appendOutcomeToFile, assert, classifyQuickDeathCause, computeOutcome, dispatchStoreFile, fs, isBackedOff, isQuickDeath, makeGitRoot, newQuickDeathBackoffState, parseBackoffBaseMs, parseBackoffMaxMs, parseBackoffThreshold, parseQuickDeathMs, parseRateLimitResetAtMs, path, readDispatchStore, readOutcomeLines, readTaskStatus, recordQuickDeathBackoff, resolveWorkerProcessName, rmSafe, runGit, spawn, spawnResident, splitArgs, upsertDispatchRecord, waitFor, writeProfileCarrier, writeTaskFile } from "./helpers/worker-driver-fan-in-harness.mjs";

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
