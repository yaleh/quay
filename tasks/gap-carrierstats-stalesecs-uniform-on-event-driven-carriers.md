---
id: gap-carrierstats-stalesecs-uniform-on-event-driven-carriers
title: carrierStats 对事件驱动载体（quality 中位间隔 21 分钟）与逐轮载体（promotion 68737 条）发出同一个
  staleSecs 数，正常呼吸与停摆同形——今日已造成一次假警报
status: todo
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

**这是 `gap-meta-carrierstats`（done, 2026-09-06）的镜像半边，不是重复。** 那条修的方向是：quality 有 15 条记录却 `carrierLastTs=null` ⇒ 逐字记作「**停摆与健康同形**（缺值被伪装成未查）」。修好之后 `staleSecs` 对 quality 有值了——于是打开了**反方向**：**健康与停摆同形**。

**根因**：`carrierStats(root, kind)`（`plugin/scripts/driver-runtime.ts:312`）对所有 kind 用同一个语义算 `staleSecs = now − carrierLastTs`，而各 kind 的载体是**两种性质完全不同的 population**：

| kind | 载体条数 | 写入性质 |
|---|---|---|
| promotion | 68737 | 逐轮写，秒级 ⇒ staleSecs 是有意义的活性量 |
| worker | 14631 | 逐轮写 ⇒ 同上 |
| **quality** | **53（跨 3 天）** | **事件驱动**（`triggerReasons: every-10-rounds` / pool>25 / 最久>48h）⇒ staleSecs 主要反映「有没有触发」，不反映活性 |

`.quay/quality-round.jsonl` 的**历史间隔实测**（53 条、2026-09-05T15:41 → 2026-09-08T16:12）：

```
中位间隔 1271s (21 分钟)   最大间隔 36545s (10.2 小时)   最小 225s
52 个间隔中，有 24 个（46%）> 2837s
```

而这三个数被放在 `drivers[]` 的**同一行**里与 `running` / `supervisorAlive` / `driverAlive` 并列输出，读者（人或 probe）无从知道 quality 的 2837s 属于正常呼吸而 promotion 的 2837s 是灾难。

**今日的实际代价（不是假想）**：2026-09-08 15:2x–16:1x，我据 `drivers.quality.staleSecs` 三轮单调递增（402→1622→2837）判为「心跳第三次冻结」，并以此发起 `META-002` 请 meta-driver 调查；meta-driver 复核后**确认**了该读数（报 staleSecs=5273，第 4 次递增）并按此给出根因假设。**双方都错**——同期该 driver 正每 30s 心跳一次（repo-root `quality-round.jsonl` 7514 条，末条 16:05:40，pid 3584223），从未冻结。杀死这个假警报的对照只需一条命令：**把观测间隔对着该载体自己的历史间隔分布比一次**（2837s 连 75 分位都不到）。

**这与既有任务的分工**：
- `gap-meta-round-log-rel`（done）修的是心跳写错路径（repo root 而非 `.quay/`），其标题已逐字预言「liveness 监测读判词载体 judgedAt 报假 stall」——**但它修的是写端路径，没有修读端把稀疏载体当活性量这件事**；本任务补的正是读端。
- `gap-dashboard-driver-status-card`（ready）计划把 `aliveness()`+`carrierStats()` 直接搬上 Dashboard 卡片 ⇒ **本缺陷会原样传播到生产 UI**，两条应互相知情。

**方案**（三选一，实现者定，但必须满足「未评估有独立取值」硬规则 3b）：
1. `carrierStats` 增一个按 kind 的载体性质标注（`cadence: "per-round" | "event-driven"`），事件驱动 kind 的 `staleSecs` 不得以裸数字与逐轮 kind 并列；
2. 或把陈旧判定改为**相对该载体自身历史间隔分布**（如 `staleSecs > p90(历史间隔)` 才算陈旧），而不是绝对秒数；
3. 或对事件驱动 kind 改用真正的活性直接量（进程 `etime` / 心跳载体），`staleSecs` 只作为「上次判词距今」呈现且改名，⛔ 不与活性混用。

## Acceptance Criteria

- [ ] 单测全绿：`node --experimental-strip-types --test plugin/test/driver-runtime.test.mjs`
- [ ] `carrierStats` 的输出能区分两类载体（按位置判定，非注释）：`node --experimental-strip-types -e 'import("./plugin/scripts/driver-runtime.ts").then(m=>{const q=m.carrierStats(process.cwd(),"quality");const p=m.carrierStats(process.cwd(),"promotion");const ok=JSON.stringify(q)!==undefined&&Object.keys(q).some(k=>/cadence|eventDriven|staleRelative|p90/i.test(k));process.exit(ok?0:1)})'`
- [ ] 新增用例覆盖「事件驱动载体的长间隔不得被判陈旧」：`test "$(grep -ci 'event-driven\|eventDriven\|稀疏载体' plugin/test/driver-runtime.test.mjs)" -ge 1`
- [ ] 负控制（判据能取假）：把新增判定改回统一 staleSecs 后重跑 `node --experimental-strip-types --test plugin/test/driver-runtime.test.mjs` 必须红——若关掉实现仍绿，该判据是回声不是测量
- [ ] 用真实历史数据回归：对 `.quay/quality-round.jsonl` 的历史间隔跑新判定，2026-09-08T15:20 那次读数（间隔 2837s）不得被判为陈旧（该值低于同载体历史间隔的 75 分位）

## Definition of Done

真实落地 = **生产读数上不再出现该假阳性**（DIR-026 Reading A，不是「测试存在」）：实现合并进 `develop` 且常驻 meta-driver 重启加载新代码后，`.quay/meta-driver-round.jsonl` 中实现落地时刻之后的探测轮里，`drivers[]` 里 `kind: quality` 那一行要么不再以裸 `staleSecs` 与逐轮 kind 并列、要么携带可区分载体性质的字段；并做一次真实负控制——人为让 quality driver 真的停摆（`quay driver stop --kind quality`）后，新判定必须仍能把它报出来（⛔ 修掉假阳性不得以牺牲真阳性为代价）。两项都须读生产载体核对，不得由 fixture 或注入数据满足。

## Touches

- `plugin/scripts/driver-runtime.ts`
- `plugin/test/driver-runtime.test.mjs`
- `tasks/gap-carrierstats-stalesecs-uniform-on-event-driven-carriers.md`
