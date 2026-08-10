---
id: gap-b3-arbitration-inflight-vs-backlog
title: B3 ①(in_flight<cap 派发)与 ④(integration 领先且 suite 绿)冲突无仲裁——④ 是 ① 的下游约束但 B3
  把五条写成独立强制动作；当前 integration 169 排红门后(01:05 162→01:15 169,develop 9.6h)填满 cap=5
  是加 WIP 不加吞吐(新做完的变 174)；处方=④ 被红阻塞且积压>阈值时 ① cap 收窄到修红所需
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**B3 的 ①（in_flight<cap 则派发）和 ④（integration 领先 develop 且 suite 绿）在这个状态下互相矛盾，而 B3 没有仲裁规则——①是「生产侧有空槽就派发」，④是「交付侧被红阻塞」。当前：integration-only 从 01:05 的 162 涨到 01:15 的 169（10 分钟 +7），develop 上次前进 15:47Z 已 9.6 小时。瓶颈不在生产侧在交付侧——169 个提交排在批量合并门后，门是红的。此刻把在飞从 1 填到 5，增加的是 WIP 不是吞吐，新做完的只会排到 169 后面变成 174。B3 把五条写成了五条独立强制动作，但 ④ 实际是 ① 的下游约束——这是我的设计缺陷。**

### 实证（manager 2026-08-10 收窄指示 + outer 复核）

- **01:07 指示**：B3① 成立就派发（in_flight=0<cap5 + dispatchable=10 + inner idle）——执行正确，前置 display-message 窗口名校验做进了代码（记功）。
- **01:07 只读了 ① 的三个前件，没读 ④**：integration-only 从 01:05 的 162 → 01:15 的 169（10 分钟 +7），develop 上次前进 15:47Z 已 9.6 小时。
- **瓶颈在交付侧非生产侧**：169 个提交排在批量合并门后，门是红的。填满 cap=5 是加 WIP 不加吞吐——新做完的排到 169 后变 174。
- **设计缺陷**：B3 把五条写成五条独立强制动作，但 ④ 是 ① 的下游约束（交付被红阻塞时，生产侧派发增加的只是排队，不是吞吐）。B3 无 ①/④ 冲突仲裁规则。
- **仲裁规则（manager 建议）**：当 ④ 被红阻塞且 integration 积压 > 阈值时，① 的 cap 应收窄到「够修红即可」而不是满 cap。

**为什么重要**：B3 是外层派发判据——①④ 冲突无仲裁时，红窗下会把 WIP 填满而门不开，积压只增不减。仲裁规则让派发在「交付被堵」时自动收窄到修红所需，力气放在开门上。

### 选定机制方向（实现归内层，接法留执行时）

1. **仲裁规则**：B3 增 ①/④ 冲突仲裁——当 `④` 被红阻塞（suite 非绿）且 `integration 积压 > 阈值`（如 >50）时，① 的 cap 收窄到「够修红即可」（如 2）而非满 cap=5。
2. **接线**：外层 tick 核（orchestrator-tick-core.md）的 B3 部分增仲裁判定；派发脚本读取仲裁后的 cap。
3. **回归验证**：红窗 + 高积压 → cap 收窄；绿窗 → cap 恢复满；无积压 → 不影响。

**验证锚**：修后 (a) 红窗 + 积压>阈值 → ① cap 收窄（实测派发数 ≤ 窄 cap）；(b) 绿窗 → cap 恢复；(c) 无积压不影响。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实证（01:05 162→01:15 169、develop 9.6h、169 排队在红门后、填满=加 WIP 不加吞吐）（本任务 Proposal 已含）
- [ ] AC2: **仲裁规则**——B3 增 ①/④ 冲突仲裁：④ 被红阻塞且积压>阈值 → ① cap 收窄到修红所需
- [ ] AC3: **接线**——外层 tick 核 B3 部分增仲裁判定；派发脚本读仲裁后 cap
- [ ] AC4: **回归验证**——红窗+高积压 → cap 收窄；绿窗 → 恢复；无积压不影响
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：红窗+积压 → 派发数 ≤ 窄 cap（贴任务体）；绿窗恢复
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- orchestration/orchestrator-tick-core.md（B3 增 ①/④ 冲突仲裁判定）
- plugin/scripts/slot-refill.ts 或派发脚本（读仲裁后 cap）
- plugin/test/slot-refill.test.mjs（AC2-AC4 测试）
- tasks/gap-merge-green-snapshot-verified-commit-livelock.md（交叉标注——同族：批量合门/积压）
- tasks/gap-suite-empty-wait-no-auto-retrigger.md（交叉标注——同族：套件轮调度）
- tasks/gap-b3-arbitration-inflight-vs-backlog.md（自身：勾 AC + 贴证据）

## Contract

measure   effective_dispatch_cap_under_red_backlog = `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root <repo> --json` 输出里红窗+高积压时的实际 cap
band      effective_dispatch_cap_under_red_backlog = 收窄（≤2，红窗+积压>阈值时）
invariant cap_restores_on_green = 1（绿窗 cap 恢复满）
invariant no_backlog_no_effect = 1（无积压不影响）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root <repo> --json`（红窗+高积压 fixture 贴回）
control   红窗+积压 → cap 收窄；绿窗恢复；无积压不影响
resume    仲裁规则 / 接线分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 收窄指示——B3 ① ④ 冲突无仲裁：④ 被红阻塞且积压>阈值时 ① cap 应收窄到修红所需而非满 cap。实证：01:05 162→01:15 169、develop 9.6h、169 排红门后。立案。实现归内层
