# AC148 inner 执行核逐条归属映射

**任务**：`gap-ac148-inner-core-itemized-attribution`（status: ready → done）
**对象**：`orchestration/fast-mode-tick-core.md` 的 A1–A26 + B1–B5（源文档 A5/A19 编号跳号、不存在，见文末注）
**用途**：AC149（会话真退役）的前置——AC149 据此逐条标删除线 + 指针 + 边界条件。
**纪律**：逐条映射，非抽查（硬规则⑤来源完备性；本仓库已为「抽查即删」付过代价：2026-08-10 删 164 行、3 条无家可归）。

## 三分类

| 记号 | 含义 |
|---|---|
| ① | 已由某 driver 承接（指名哪个） |
| ② | 随会话消失（说明为何不再需要） |
| ③ | 仍需保留（说明由谁执行） |

## 逐条映射

### A 段（每轮必跑）

- **A1**（`.halt` 哨兵）→ **①** 已由 worker-driver 承接：驱动停机态 = MCP halt 控制面（`driver-shared.ts` `isHalted` / `.quay/worker-control.json`），⛔ 不再读 `.halt`（SPEC-unified-driver-architecture §5 阶段 3 退役清单「.halt 文件机制被 MCP halt 取代，不并存」）。
- **A2**（`monitor-mount-check.sh --json`）→ **②** 随会话消失：tmux Monitor 挂载是会话卫生，inner 会话退役即无 pane/Monitor 可查。
- **A3**（判本回合唤起源）→ **②** 随会话消失：`<task-notification>` 是会话/背景 subagent 事件流；worker-driver 常驻协调循环自驱动，无此事件源。
- **A4**（读队列文件 `docs/analysis/batch2-queue-state.md`）→ **②** 随会话消失：队列文件是 inner 会话自维护的 compact 后状态；退役后任务状态 = 盘上 tasks/*.md（ready-pool 直接量）。
- **A6**（Fan-in 经 fan-in-execute workflow）→ **①** 已由 worker-driver 承接：worker 以 scriptPath 直调 fan-in-execute workflow；「是否走 workflow」的三层检查退役（SPEC-worker-driven-inner §5 阶段 2 退役清单②——驱动直调结构上不可能跳过）。
- **A7**（`tmux capture-pane` → inner-blocked-signal --detect-stop）→ **②** 随会话消失：tmux pane 是会话卫生，无 inner 会话即无 pane。
- **A8**（`inner-panel-stale-check.ts --pane`）→ **②** 随会话消失：同上（pane 陈旧检查无对象）。
- **A9**（读外层 `.quay/full-suite-state.json`）→ **③** 仍需保留：suite-state 是直接量，合并闸（轮在跑不可 fan-in）由 fan-in 收尾路径执行（`fan-in-ff-merge.sh` / `fan-in-execute.js`）；派发面不再读 suite-state（worker-driver 只读资源门 + halt）。
- **A10**（`effective_cap=5`）→ **①** 已由 worker-driver 承接：并发 = 驱动自己 fork 的子进程数（直接量）；cap-from-gate / process-budget 的并发裁决用途退役（SPEC-worker-driven-inner §5 阶段 2 退役清单①）。
- **A11**（`ready-pool-check.ts --root --cap --apply`）→ **①** 已由 promotion-driver 承接（todo→ready 晋升，AC130/131，零 LLM）+ worker-driver 承接（选择环读 ready 池，Layer 1a source）。
- **A12**（`slot-refill.ts --cap --in-flight`）→ **①** 已由 worker-driver 承接：「ready→实现」默认由驱动自主派发（AC141 execution face 单一真相源）；slot-refill 的推荐数组读法随 inner 消失。
- **A13**（在飞/槽位读法）→ **①** 已由 worker-driver 承接：在飞 = 驱动自己 fork 的子进程数（直接量，取代「数 subagent / 遥测括号」两个代理量）；cap-counts-subagents 与 --reconcile 随 subagent/括号消失（AC76/C24-1）。
- **A14**（routine track）→ **③** 仍需保留：loop.routines 例程机制由 manager-kind 例程型 driver 承接（AC143/AC151，Layer 1b routines 表；`routine-scheduler.ts` 判定函数已由 driver-runtime 复用）。
- **A15**（派发前逐候选六检查）→ **①** 已由 worker-driver / `driver-filters.ts` 承接：六检查收进可组合谓词列表（AC152：notInFlight / depsSatisfied / touchesDisjoint / retryCapNotExhausted / notNeedsHuman），Touches 互斥单一实现 checkTouchesPair 上收。
- **A16**（`fast-mode-telemetry.ts --task-start/--task-end`）→ **①** 已由 worker-driver 承接：派发留痕与 defer 闭合由 outcome/round 结构化记录承载；遥测括号的「在飞」用途已退役（AC76/C24-1），括号随 inner 消失。
- **A16b**（`dispatch-record.ts --add`）→ **①** 已由 worker-driver 承接：「为什么选它」= selector 真实理由落 `selector_reason` 进 worker-outcome.jsonl；指纹/理由独立核验由 `dispatch-record-fingerprint-reason-check.ts` 保留（run_static_checks）。
- **A17**（`sync-lag-check.sh --push --branch develop`）→ **③** 仍需保留：develop→origin 跨机同步 push 兜底由 manager 巡检例行承接（AC143 manager-kind 巡检例程；「绝不 force」纪律保留）。
- **A18**（账本·ready-pool-check 调用）→ **②** 随会话消失：账本五条存在的唯一理由 = 会话可静默跳过一步；驱动循环要么执行要么死（supervisor alive=0 直接可见），不存在静默跳过。
- **A20**（账本·slot-refill 调用）→ **②** 随会话消失：同上。
- **A21**（账本·sync-lag-check 调用）→ **②** 随会话消失：同上。
- **A22**（账本·--task-start 调用）→ **②** 随会话消失：同上。
- **A23**（账本·monitor-mount-check 调用）→ **②** 随会话消失：同上。
- **A24**（执行模式两数 main_thread_edits / agent_dispatches）→ **②** 随会话消失：inner 主线程/subagent 两数检查随 inner 消失；其判据形态由 AC145 显式复用为 manager 侧「主线程不做产品文件编辑」（复用的是形态，不是本条目）。
- **A25**（直接量活性）→ **②** 随会话消失：inner 自测活性对象随 inner 消失；「在飞 = 直接量」原则由 worker-driver 在飞读数承接（见 A13 ①）。
- **A26**（AC81 锚核实）→ **②** 随会话消失：inner 的 CronList 锚随 inner 消失；`outer-anchor-check.ts` 是绑死在退役层上的 checker（SPEC-methodology-layer-architecture §2.3b）。

### B 段（每轮必产出）

- **B1**（写回队列文件）→ **②** 随会话消失：队列文件是 inner 会话自维护状态；退役后任务状态 = 盘上 tasks/*.md。
- **B2**（tick 必报）→ **①** 已由 driver 承接：结构化 round/outcome 记录（`worker-round.jsonl` / `worker-outcome.jsonl` / `promotion-outcome.jsonl`）取代 tick 散文报告；manager 按需读载体。
- **B3**（重新排程 ScheduleWakeup + wakeup heartbeat）→ **②** 随会话消失：ScheduleWakeup 是会话级唤醒、wakeup heartbeat 是会话活性产物，均随 inner 消失；驱动活性由 round 心跳 + supervisor alive=0 承接。
- **B4**（阻塞信号落盘 inner-blocked-signal）→ **②** 随会话消失：inner 阻塞态落盘随 inner 消失；needs-human 的显式承接面由 AC146（人机接口）承接。
- **B5**（建任务时四件套 + Contract 六键）→ **③** 仍需保留：任务四件套 + Contract 六键是 quay 任务格式判据，不随会话消失；由 AC145 语义面 subagent（manager 派后台 subagent 撰写/立案）执行。

## 覆盖与计数

- **① 已由某 driver 承接：10 条**（A1, A6, A10, A11, A12, A13, A15, A16, A16b, B2）
- **② 随会话消失：16 条**（A2, A3, A4, A7, A8, A18, A20, A21, A22, A23, A24, A25, A26, B1, B3, B4）
- **③ 仍需保留：4 条**（A9, A14, A17, B5）
- **合计 30 条**，每条恰一个分类，无未分类项，无搪塞式归属（每条均指名承接 driver / 消失理由 / 保留执行者）。

## 源文档编号注

源文档 `orchestration/fast-mode-tick-core.md` 的 A 段编号跳号：A5、A19 在源文档中不存在（A4 后直接 A6，A18 后直接 A20），故不在映射范围——非「未分类」，是「源文档无此条」。
