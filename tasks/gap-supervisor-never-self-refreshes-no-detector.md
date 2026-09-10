---
id: gap-supervisor-never-self-refreshes-no-detector
title: 源码自刷新住在 supervisor 里却从不作用于 supervisor 自身——早于该功能启动的 supervisor
  永不自愈，且无任何检测；今日实测一个 driver 跑了 2 天陈旧代码
status: done
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**：源码自刷新（`gap-meta-driver-source-refresh` / AC-184，`cc854ab27` 落地于 `2026-09-07T05:50:42`）住在 supervisor 的 `sourceCheck` 定时器里（`plugin/scripts/driver-runtime.ts:951-960`）。它逐轮对照被监视源码 mtime 与 **driver** 启动时刻，命中即 `child.kill("SIGTERM")` 复用 exit→respawn 循环重启 **driver**。

**缺陷（位置判定）**：`:958` 杀的是 `child`——**只有 driver，从不包括 supervisor 自己**。supervisor 是常驻前台进程（`:966` `return new Promise<number>(() => {})`，永不 resolve），它内存里的 kernel 代码是**启动那一刻的版本，此后永不刷新**。而 `driver-runtime.ts` 本身就在 `SHARED_SOURCE_FILES`（`:832`）里——改它会重启 driver，却改不动持有该逻辑的 supervisor。

**两个后果，第一个今天已实测发生**：

**① 早于该功能启动的 supervisor 连刷新循环都没有 ⇒ 其 driver 永不自愈。** 实测 2026-09-08：
```
quality supervisor pid=3584214  启动 2026-09-06 08:10:13   ← 早于 cc854ab27 21.7 小时
quality driver     pid=3584223  启动 2026-09-06 08:10:14
被监视源码 quality-gate-driver.ts  mtime 2026-09-08 07:15:26   ← 早该触发重生
                  driver-filters.ts  mtime 2026-09-08 07:33:22
```
该 driver 因此跑了 **2 天 8 小时**的陈旧代码，期间把心跳写到 repo-root `quality-round.jsonl`（7514 行未跟踪文件，`gap-meta-round-log-rel` 已修但它加载不到），并使 `.quay/` 侧载体只剩判词行——**直接导致 2026-09-08 15:2x 一次假警报**：我据 `drivers.quality.staleSecs` 402→1622→2837 判为「心跳冻结」并发起 `META-002`，meta-driver 复核后确认了该读数（报 5273），双方都错；手工 `quay driver restart --kind quality` 后 17 分钟内该载体恢复每 30s 一条心跳、`staleSecs` 降到 15。⊢ 全过程无任何机制报出「这个 supervisor 早于它该有的功能」。

**② 长期形态：supervisor 半边的任何改动对在跑的 supervisor 静默无效。** respawn 逻辑、`sourceCheck` 自身、stop-sentinel 处理——改了就得靠人记得重启，而「记得」不是机制。

**为什么没被发现（硬规则 3b/4b）**：`aliveness()` 报 `supervisorAlive: true`；`carrierStats` 报 driver 侧载体。**没有任何读数把 supervisor 启动时刻与被监视源码 mtime 比一次**——「跑着旧代码的 supervisor」与「健康的 supervisor」在全部现有仪器上同形。

**当前爆炸半径实测 = 1**（仅 quality 早于 `cc854ab27`；promotion 09-07 11:11 / worker 11:11 / meta 09-07 09:03 / goal 12:08 均在之后），但 ② 使它随每次 kernel 改动重新产生。

**方案**（实现者定，须满足硬规则 3b：「无法评估」有独立取值）：
1. **检测优先**（最小、必做）：新增一个直接量——supervisor 进程启动时刻 vs `sourceFilesMaxMtimeMs(root, kind)`，陈旧即报，进 `aliveness()` 输出与 driver status；读不到进程启动时刻 ⇒ `not-evaluated`，⛔ 不与「新鲜」同形。
2. **自愈可选**：supervisor 检测到自身陈旧时以 exec/重启自身的方式换代（须保证不误杀在飞 worker 子进程——`stop`/`restart` 现有语义是只杀 supervisor+driver、不碰 worker 在飞子进程，新路径必须保持）。
3. ⛔ 不新建并行重启机制（同 AC-184 的约束）。

**关联**：`gap-carrierstats-stalesecs-uniform-on-event-driven-carriers`（superseded，我先前基于假前提立的，其真实那一半即本条）；`gap-meta-round-log-rel`（done，写端路径修复——正是它加载不到才暴露本缺陷）；`gap-meta-driver-source-refresh`（done，本机制的来源）。

## Acceptance Criteria

- [x] 单测全绿：`node --experimental-strip-types --test plugin/test/driver-runtime.test.mjs`
- [x] 存在 supervisor 陈旧判定的实现（按位置，非注释）：`test "$(grep -c 'supervisorStartedAt\|supervisorStale\|supervisor_stale' plugin/scripts/driver-runtime.ts)" -ge 1`
- [x] 判定结果进对外读数：`node --experimental-strip-types -e 'import("./plugin/scripts/driver-runtime.ts").then(m=>{const a=m.aliveness(process.cwd(),"quality");process.exit(Object.keys(a).some(k=>/supervisorStale|supervisorStartedAt/i.test(k))?0:1)})'`
- [x] 「读不到启动时刻」有独立取值、不与「新鲜」同形：`grep -qi 'not-evaluated\|notEvaluated' plugin/scripts/driver-runtime.ts`
- [x] 新增用例覆盖「supervisor 早于被监视源码 mtime ⇒ 判陈旧」：`test "$(grep -ci 'supervisor.*stale\|stale.*supervisor' plugin/test/driver-runtime.test.mjs)" -ge 1`
- [x] 负控制（判据能取假）：把该判定分支注释掉后重跑 `node --experimental-strip-types --test plugin/test/driver-runtime.test.mjs` 必须红

## Definition of Done

真实落地 = **在生产上对一个真陈旧的 supervisor 报出来**（DIR-026 Reading A，不是「测试存在」）：实现合并进 `develop` 后，构造一次真实负控制——`touch plugin/scripts/driver-runtime.ts` 使被监视源码 mtime 推进到某个在跑 supervisor 的启动时刻之后，然后 `quay driver status --kind <该 kind>`（或 `aliveness()`）必须把该 supervisor 报为陈旧；随后重启该 kind，同一命令必须不再报陈旧（⛔ 恒报陈旧不算通过，判据须双向可取假）。两次读数都取自生产进程与生产载体，不得由 fixture 或注入数据满足。

## Touches

- `plugin/scripts/driver-runtime.ts`
- `plugin/test/driver-runtime.test.mjs`
- `tasks/gap-supervisor-never-self-refreshes-no-detector.md`
