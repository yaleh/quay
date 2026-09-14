---
id: gap-dashboard-snapshot-rebuild-returns-inflight-cold-build
title: dashboard 快照 `rebuild()` 在启动冷构建仍 in-flight
  时静默返回【那趟旧构建】——`gap-dashboard-goal-card-provider-backed` AC4「empty state
  shown」在负载下红，与子任务 delta 无关却消耗其 fan-in 重试预算
status: todo
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

- [ ] **写面判据（新 fixture 或改既有 fixture，⛔ 不读源码版式）**：新增/改一条测试，用 `setDashboardSnapshotStepHook` 把冷构建按住，在按住期间改动 fixture 并 `await rebuildNow()` ⇒ 断言拿到的快照**反映改动后**的状态（今天红：拿到改动前的）。该判据必须能取假。
- [ ] **负控制**：把修法改回「返回 in-flight 构建」形态，上一条必须红；贴出改前 / 改后两次读数。
- [ ] **既有调用方不被破坏**：`gap-dashboard-goal-card-provider-backed` / `gap-ac179-criterion-cold-miss-dashboard-snapshot` 全绿；`rebuild()` 的「不叠加重建」性质对**周期性 tick** 仍然成立（tick 连发时不得排队堆积）——贴出该性质的读数。
- [ ] **生产载体**：真 `quay serve` 上，改动 fixture 后 `GET /dashboard` 反映新状态（⛔ 不是只跑 fixture 单测）。

## DoD

- [ ] 上面的判据实跑通过，且判据本身能取假（贴负控制读数）。
- [ ] 修的是 `serve-dashboard.ts` 的这一个语义缺陷（`rebuildNow()` 必须能表达「在我之后重建」），⛔ 不给测试加 `@load-sensitive` 豁免、⛔ 不在测试里 `sleep` 等冷构建（那是把竞态改成赌时序）。
- [ ] 全量 `scripts/test.sh` 绿。

## Touches

- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs`
- `packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs`