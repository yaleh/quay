---
id: gap-dashboard-snapshot-rebuild-returns-inflight-cold-build
title: dashboard 快照 `rebuild()` 在启动冷构建仍 in-flight
  时静默返回【那趟旧构建】——`gap-dashboard-goal-card-provider-backed` AC4「empty state
  shown」在负载下红，与子任务 delta 无关却消耗其 fan-in 重试预算
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

`packages/quay/src/serve-dashboard.ts:1670` 的 `rebuild()`（`rebuildNow()` 的实现）：

```js
const inFlight = dashboardSnapshotRebuilds.get(root);
if (inFlight) return inFlight;   // never stack rebuilds on one root
```

`startDashboardSnapshotRefresh` 在启动时 `void rebuild()`（`:1684`）发起冷构建。若调用方在冷构建仍 **in-flight** 时调用 `await rebuildNow()`，它拿到的不是「重建」，而是**那趟冷构建**——而冷构建的 `client.goalList()` 早在 `buildDashboardSnapshot` 第一行（`:1612`）就发出去了 ⇒ 装盘的快照带着**调用方改动之前**的数据。

**实测（2026-09-14，非推断；确定性复现，⛔ 不需要负载）**：用仓库自带的公开测试钩子把冷构建按住：

```js
setDashboardSnapshotStepHook(async () => { await held; });
const server = await startServer({ port: 0 });   // 冷构建卡在钩子上
server.dashboardSnapshot.stop();
await sleep(2500);                                // 让 goalList 的往返先返回（旧数据已被捕获）
for (const f of fs.readdirSync(goalsDir)) fs.rmSync(...);   // 调用方删空 fixtures
const p = server.dashboardSnapshot.rebuildNow();  // == 那趟被按住的冷构建（被去重）
release(); await p;                               // 冷构建装盘
// GET /dashboard ⇒ 无「暂无 active GOAL」⇒ 与套件红逐字同一条断言
```

**负控制已做**：同一脚本指向主检出（`/home/yale/work/quay`，其 `goal-store.ts` / `serve-dashboard.ts` / `serve.ts` 与 develop 逐字相同）⇒ **同样 FAIL**。⇒ 该形态在 develop 的代码上就存在。

**代价（实测）**：`gap-goal-create-as-active-skips-zero-ac-gate` 的机械 fan-in 出现 `step=suite: AssertionError [ERR_ASSERTION]: empty state shown`（`packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs:210`）。该文件**不在该任务的 Touches/diff 里**，delta-relatedness 判 UNRELATED；该任务随后**自跑全量套件 651/651 文件全绿**（含这个文件）⇒ 该红与该任务的 delta 无关，却已消耗它一次 fan-in 轮次（`plugin/scripts/worker-driver.ts` 的 `judgeRetryExemption` 只豁免 suite-red，非 suite-red 一律计入该任务的重试预算）。**同一个红会让任何任务的 fan-in 轮次作废**，与任务内容无关。

**为什么不是「负载 flake」**：它需要的是「冷构建比调用方慢」这一时序，**负载只是让它更容易发生**；机制本身是 `rebuildNow()` 的语义缺陷——调用方无法表达「在我这次改动之后重建」。⛔ 不要靠在测试上加 `@load-sensitive` 标注绕过（`plugin/scripts/known-load-sensitive.ts` 那条路会把真缺陷永久合法化）。

## AC

- [x] **写面判据（新 fixture 或改既有 fixture，⛔ 不读源码版式）**：新增/改一条测试，用 `setDashboardSnapshotStepHook` 把冷构建按住，在按住期间改动 fixture 并 `await rebuildNow()` ⇒ 断言拿到的快照**反映改动后**的状态（今天红：拿到改动前的）。该判据必须能取假。
- [x] **负控制**：把修法改回「返回 in-flight 构建」形态，上一条必须红；贴出改前 / 改后两次读数。
- [x] **既有调用方不被破坏**：`gap-dashboard-goal-card-provider-backed` / `gap-ac179-criterion-cold-miss-dashboard-snapshot` 全绿；`rebuild()` 的「不叠加重建」性质对**周期性 tick** 仍然成立（tick 连发时不得排队堆积）——贴出该性质的读数。
- [x] **生产载体**：真 `quay serve` 上，改动 fixture 后 `GET /dashboard` 反映新状态（⛔ 不是只跑 fixture 单测）。

## DoD

- [x] 上面的判据实跑通过，且判据本身能取假（贴负控制读数）。
- [x] 修的是 `serve-dashboard.ts` 的这一个语义缺陷（`rebuildNow()` 必须能表达「在我之后重建」），⛔ 不给测试加 `@load-sensitive` 豁免、⛔ 不在测试里 `sleep` 等冷构建（那是把竞态改成赌时序）。
- [ ] 全量 `scripts/test.sh` 绿（待外部）

## Evidence

修法：`serve-dashboard.ts` 的合并策略一分为二——`RebuildPolicy = "skip" | "after"`。

- `skip`（周期性 tick）：in-flight 时返回 incumbent、不启动任何构建（「不叠加重建」原契约不变）。
- `after`（显式 `rebuildNow()`）：调用方的改动早于 incumbent 的 provider 往返，故 incumbent 结构上不可能反映它
  ⇒ 所有这类调用方**合并到一趟 follow-up 构建**，在 incumbent 落定后启动；`after` 每次 in-flight 至多加一趟
  ⇒ 同样不会无界堆积。
- follow-up 的队列条目在它**启动时**（而非结算时）退役，否则在 follow-up 构建运行期间到达的 `rebuildNow()`
  会拿到那趟已启动的 promise——同一缺陷下沉一层。

新增读数（`packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs`）：AC1 判据 + AC3 性质判据。
两条都**不 sleep 等构建**：「in-flight」是断言出来的（步骤钩子按住 + 计数 client 读到 goalList 已返回，
`goalCalls === 1` 是**读数**不是等待）。

**AC2 负控制（改前 / 改后两次读数，同一测试文件、同一 fixture）**

```
改前（rebuildNow() -> rebuild("skip")，即「返回 in-flight 构建」的旧语义）
  ✖ AC1: rebuildNow() during an in-flight cold build reflects the caller's change
    AssertionError: rebuildNow() must QUEUE a rebuild behind the incumbent — not be satisfied by it
  （把该断言暂时摘掉，让下面那条判决性断言现形：）
    AssertionError: the snapshot handed to the caller reflects the store AS OF THE CALL —
      the incumbent build's pre-change goal answer must not be served as the result of rebuildNow()
      actual: [ 'AC-170', 'AC-171', 'GOAL-001' ]
      expected: []
  ℹ tests 10 / pass 9 / fail 1

改后（rebuildNow() -> rebuild("after")）
  ✔ AC1: rebuildNow() during an in-flight cold build reflects the caller's change (35.6ms)
  ✔ AC3 property: the periodic tick still never stacks — ticks during an in-flight build start no build (253.3ms)
  ℹ tests 10 / pass 10 / fail 0
```

**AC3 读数（既有调用方 + tick 不叠加）**

```
node --test packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs
  ℹ tests 8 / pass 8 / fail 0
node --test packages/quay/test/gap-webui-accent-palette-no-success-color.test.mjs \
              packages/quay/test/gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs
  ℹ tests 6 / pass 6 / fail 0
tick 不叠加（AC3 property，直接量 = build 次数，由 goalList 调用次数读出）：
  冷构建被按住期间给 ~40 次 tick 机会（intervalMs=5，200ms 窗口）⇒ goalList 调用数 1 -> 1
  （`a tick landing on an in-flight rebuild must start NO build`）；且 `isDashboardSnapshotFollowUpQueued === false`
  （tick 也不排 follow-up）。
```

**AC4 生产载体（真 `quay serve`，非 fixture 单测）**

```
READING 1（改动前）: status=200 GOAL-001 rendered=true  "暂无 active GOAL" present=false
CALLER'S CHANGE: goals/ emptied (0 entries left)
READING 2（改动后）: status=200 "暂无 active GOAL" present=true GOAL-001 rendered=false
RESULT: real quay serve reflects the on-disk change on GET /dashboard — PASS
```

**同时携带的机械修复（develop 自身红，merge 修不了）**：`docs/analysis/quay-init-closure-ratchet.baseline.json`
在 `92c5b1b15`（release: 0.6.2 -> 0.6.3）之后 stale——版本 bump 改了 4 个 LAYDOWN_SOURCES 之一
（`plugin/.claude-plugin/plugin.json`）却没带 re-anchor 伴生提交，于是**全量静态闸**
`quay-init-closure-ratchet-stale` 恒 fail-closed（`scripts/test.sh <file>` 实测 `EXIT=1`，与任何任务的
delta 无关）。这是 12:24 那次 `9ea261f14` 的同形复发。本 delta 内 re-anchor：

```
--check-stale 改前: FAIL changed=1 added=0 removed=0 (plugin/.claude-plugin/plugin.json)
--reanchor    : PASS → 3 files / 1022 bytes (fingerprint 58d2c6a57caf03e3…, 4 source files)
--check-stale 改后: PASS — laydown source fingerprint fresh
--gate        : PASS — 3 files / 1022 bytes ≤ baseline 3 files / 1022 bytes（shrink-only 不变）
```

⇒ files/bytes 与基线**逐字相同**，只有 fingerprint 与 plugin.json 的 sha 移动——是那次 bump 漏掉的
伴生提交，不是放松（与 `9ea261f14` 的 before/after 同形）。

## Touches

- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs`
- `packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-dashboard-snapshot-rebuild-returns-inflight-cold-build.md`