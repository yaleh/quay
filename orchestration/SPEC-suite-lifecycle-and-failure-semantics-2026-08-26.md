# SPEC：suite 生命周期与失败语义 —— 单飞锁 / 看门狗 / 重试 / ff 失败的整体设计

**作者**：manager｜**日期**：2026-08-26｜**状态**：proposal，**待 outer 立案、待人裁定排期**
**来源**：人 2026-08-26 15:2xZ 划定范围与三条方向（逐字见 §0.1），manager 出架构讨论并奉命"整理成
一份 SPEC 投给 outer 立案"。前置分析见同日 manager 对套件吞吐回归的数据分析（`.quay/verification-round.jsonl`
643 轮，已投 outer 并立案 `gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock` /
`gap-suite-longtail-single-file-floor`）。

**⛔ 明确排除（人 15:2xZ 逐字："lane 预算 和 S 暂不动"）**：本 SPEC **不涉及** `defaultLaneCount()`
公式、`QUAY_MAX_CONCURRENT_SUITES` 取值、oversub 旋钮的任何改动。凡本文出现 lane/S，一律是**引用现状
作为约束条件**，不是提议改它们。

---

## 0. 一句话

**把 per-task suite 的"生命周期管理"收进一个常驻 driver（进程级父子关系 + 定时兜底，复用现成的
`DRIVER_KINDS` 骨架），使单飞锁回归为纯粹的资源限制器；把"失败之后怎么办"从机械计数器升级为
workflow 末端的语义 subagent，让它产出【原因分类】，再由既有机械机制按分类执行。**

### 0.1 人的三条方向（逐字，⛔ 不得意译）

```
* 单飞锁应当是一个槽数为 S 的测试并发限制机制。
* 锁持有看门狗 / 单次静默看门狗应当主要应用进程级的自动机制实现，辅以定时检查机制。
  考虑尽量用统一架构实现（例如 *-driver 或类似的机制）。
* 重试上限和 ff-only 合并（输了就整份作废）仅靠机械机制应该是不够了，要考虑对于此类
  （fan-in workflow）失败使用语义机制（如在该 workflow 后部增加一个 subagent 处理失败）处理。
```

---

## 1. 现状：三层被混在一起（实测，非推演）

| 层 | 回答什么问题 | 现有机制 | 正确的策略性格 |
|---|---|---|---|
| **A 资源仲裁** | 此刻允许几个 suite 同时跑 | resource-gate、单飞锁 S 槽 | **可放松**，随负载自适应 |
| **B 活性检测** | 这东西还在推进吗 | 跨 relaunch 卡死 2700s、单次静默看门狗（**缺失**） | **不可放松**，只答是/否，不做处置决定 |
| **C 失败策略** | 还要不要再给它一次机会 | ff-starvation 降 cap、重试上限、两个反活锁 | **必须读原因**，不能只读结果 |

**⊢ 仓库已在一处把这个区分做对了，那正是要推广的模型**：`.claude/workflows/fan-in-execute.js:147`
注释原文——`mergeLockWaitSecs`……"**正确性锁**，覆盖毫秒级 ff……**与 suite 的 single-flight 资源锁无关**
（后者现在是无界排队等待）"。正确性锁绝不因等待过久而放行；资源锁可以、也应该随负载放松。
**本 SPEC 不发明新原则，只是把这个已经想明白的区分推广到其余还混在一起的地方。**

### 1.1 三个泄漏点（每条都有实测支撑）

**泄漏①：B 层动作越界改了 A 层状态，且只改一半。**
`scripts/test.sh:657-663` 的 `FULL_SUITE_LOCK_HOLD_MAX_S=1800`（B 的性格：检测超时）执行了一个 A 层动作
（释放槽位），却没同步 A 层的另一半（lane 配额）。注释自陈接受"the contention risk of a (S+1)-th suite
joining"，**但让进来的那个 suite 仍按 S=1 取满 16 lanes** ⇒ 序列化被换成了双倍超订。
（该缺陷已单独立案 `gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock`，本 SPEC 的 §2
使它在结构上不可能再发生，两者不重复：那条修行为，本条修归属。）

**泄漏②：C 层的输入被 A 层与 B 层的失败污染。**
`advanceRetryCap` 只看 `exited-not-landed` 这个退出码，而该码同时承载"ff 竞速输了"（A 层问题）、
"挂死"（B 层问题）、"测试真红了"（任务自己的问题）。
**实测坐实（2026-08-26，manager 自查推翻自己前一轮的判断）**：
```
grep gap-ac143-observability-ledger-closing-driver in
  .quay/fan-in-retries.jsonl / fan-in-merge-lock-events.jsonl / fan-in-ff-escalations.jsonl
⇒ 三处全部 0 命中（正控制：同谓词对 gap-suite-load-sampler-orphan-process 有命中）
⇒ ac143 三次 exited-not-landed 无一次走到过 ff-merge 这一步
⇒ 却被同一个"该不该放弃它"的计数器等价计数，最终 needs-human
```
**⊢ 同族**：`cause-carrier-must-be-distinguishable`——把"任务自己的问题"与"系统欠它的资源"压成一个整数。

**泄漏③：挂死检测【只有辅、没有主】。**
per-task suite 由 `setsid + & + disown` 起在独立 session（`.claude/workflows/fan-in-execute.js:188-189`），
**没有任何进程在 `wait` 它**；所有检测都靠外部定时扫，而"单次运行静默看门狗"至今不存在
（`gap-fan-in-per-task-suite-no-silence-timeout-watchdog` 刚立案未落地）。
**代价实测**：ac143 挂死 33.7 分钟、`gap-suite-lpt-lookback-not-bucket-filtered` 挂死 **199.5 分钟**
（3.32 小时），两次都靠人工发现 + 手动 `kill -TERM -- -<pgid>` 才解掉；后者从人工 kill 到 worker 感知
又隔了 **49 分钟**。

---

## 2. 设计 ①：单飞锁 = 纯资源限制器（定性收敛）

**定性（人裁定）**：单飞锁只回答一个问题——**"现在允许几个 suite 同时跑"**。
它**不**回答"这个 suite 是不是卡住了"、"该不该放弃这个任务"。

由此推出两条必然结论：

**(a) 锁持有看门狗不属于它。**
"持有超过 1800s 就放行"是**活性判断**，混在资源限制器里是层次错误。资源限制器的正确行为是纯粹的：
占用 → 释放。超时该由 §3 的活性机制判定，然后**通知**资源限制器释放，而不是资源限制器自己长一个计时器。

**(b) 释放必须原子。**
"让槽不让 lane"之所以会发生，正是因为释放动作长在了一个不拥有 lane 概念的地方。释放收归 §3 的持有者
统一执行后，它天然知道该同时归还什么。
**⛔ 注意**：这不是提议改 lane 公式（人已排除），而是要求**释放动作的执行点，与占用动作的执行点是同一个**。

**⚠️ 已知且不在本 SPEC 范围内的漏口**：`--buckets` 正常成功路径结构性跳过 `run_selected()`
⇒ 跳过 `full_suite_lock_acquire`（`scripts/test.sh:914` vs `:1385+`）。
**该修法代码已写在 `gap-suite-serial-lowconc-classification-recheck` 的 worktree（AC3，`scripts/test.sh:1414`），
只差落地** —— **⛔ 本 SPEC 的实现方不得从零重写它**（人 2026-08-25 已裁定"统一收口"）。§3 的 driver 应当
**建立在该修法已落地的前提上**：driver 取槽即经统一后的 `full_suite_lock_acquire`。

---

## 3. 设计 ②：suite 生命周期收进一个 driver kind

> **⛔ 退役标注（人 2026-09-07 A 裁定，`gap-retire-resident-suite-driver-kind`）：本节提议的
> 「常驻 suite driver kind」已退役。** 落地形态与 §3.3 的「建议形态」不同——per-task suite 由
> **worker-driver 在机械 fan-in 中【进程内】`spawnSuiteAndWait` 直接 spawn 并 wait**（`worker-driver.ts`
> import 自 `suite-driver.ts`，该文件保留为共享 spawn+wait 函数库），⛔ 不是一个常驻 `suite` kind 扫
> 请求队列派发。常驻 kind 从未在生产启动（`start-drivers.ts` 的 `DRIVER_KINDS` 不含 suite；
> `.quay/suite-requests` / `.quay/suite-results` 目录无 writer 无 reader），与它矛盾的这条进程内 spawn
> 路径才是生产每轮在跑的。§3.3 的「【唯一】spawn」表述已按下述实际订正——**这是落败一方的就地更正，
> 不是静默删句**。

### 3.1 关键约束（必须先说，否则会设计出一个不可行的方案）

**suite 必须 detach 于 subagent，但可以 parent 于常驻 driver——这两件事不矛盾。**
现有 detach 设计有硬理由（`fan-in-execute.js:40-65` 实测记载）：
```
① Bash 单次 600s 硬顶（GitHub #61405），而全量 suite 实测 19+ min
② ⛔ Bash(run_in_background:true)：subagent 退出被 harness 连带杀（execute-suite-fix.js 实证 runId f6b824b5）
⇒ suite 生命周期【不能】依赖任何 subagent 的回合
```
**⊢ 但 driver 不是 subagent**——它是常驻进程，生命周期独立于任何 agent 回合。
**所以"由 driver 直接 spawn 并 wait"既满足①②，又拿回了进程级父子关系。**
（manager 前一轮口头讨论时曾笼统说"不 detach、父进程 wait"，**那个表述不准确**，此处更正为
"不由 subagent parent，改由常驻 driver parent"。）

### 3.2 复用现成骨架，不新造

**读码确认（`plugin/scripts/driver-runtime.ts:108-174`）**：`DRIVER_KINDS` 已是统一承载，现有三个 kind
（`promotion` / `worker` / `quality`），`KindSpec` 含 `driver`/`prefix`/`verbs`/`capFlag`/`hasInterval`/
`hasReconcile`/`pidSelf`/`runPrefix`/`carriers`/`controlFile`；`:756` 注释逐字：
**"仓库里只此一份 respawn 循环；kind 差异由 DRIVER_KINDS 数据表驱动（⛔ 非两份代码分支）"**。
⇒ **加一个 kind = 表里加一行 + 写该 driver 的 `.ts`**，运维动词（start/stop/drain/status/restart/liveness）
与 supervisor respawn 全部免费继承。

### 3.3 建议形态（落笔方可调整具体切法）

```
kind: "suite"（或并入既有 kind——落笔方据代码结构定，本 SPEC 不指定）
职责（⛔ 2026-09-07 已订正）：per-task suite 由 worker-driver 在机械 fan-in 中进程内
  spawnSuiteAndWait 直接 spawn 并 wait（⛔ 不是常驻 kind 扫请求队列派发——常驻 suite kind
  已退役，见本节顶部退役标注）
  主（进程级，自动）：driver 直接 spawn suite 并 wait ⇒ 子进程退出【立即】得知，
                      且三态可分：正常退出 / 非零退出 / 被信号杀
  辅（定时，兜底）：同一个循环顺带查"活着但无输出 ≥N 秒" ⇒ 判静默挂死 ⇒ 杀 + 记可区分失败态
  资源集成：spawn 前取槽（经统一后的 full_suite_lock_acquire）、子进程终结后释放槽
           ⇒ 释放天然原子（§2(b) 在结构上不可能再违反）
carriers:    suite-round.jsonl（每轮一条，outcome 三态可分：done / red / hung）
controlFile: suite-control.json（drain 语义复用既有实现）
```

**⊢ 这个设计的收益不是"少写一个脚本"，是四条结构性的**：
1. 挂死检测从"没人做"变成"父进程本来就在 wait，顺手的事"；
2. 单飞锁的取/放收进同一持有者 ⇒ "让槽不让 lane"这类半截动作结构上不可能再发生；
3. 复用五个运维动词，不为 suite 另造一套接口；
4. **"谁保证看门狗活着"这个递归问题已有答案**——`runSupervisor` 的 respawn 循环已经在监督 driver 自己。

**⊢ 硬规则 3b 要求（不可省）**：`hung` 必须是与 `red`、与 `done` **可区分的独立取值**。
挂死被杀之后若记成"红"或"没跑完"，就是把三种成因压成一个值——正是本 SPEC §1.1 泄漏②要修的那个病，
不得在新机制里复发。

---

## 4. 设计 ③：失败处置改用语义机制

### 4.1 为什么机械判据在这两处必然不够（人的判断，manager 附理由）

- **重试上限**：机械计数器只能数次数，数不出"这三次是不是同一个原因"、"这个原因是不是任务自己的错"。
- **ff-only 输了**：机械重试只能"整份重来"，判断不了"其实 rebase 一下就行"、"develop 那条新提交与我
  根本不冲突"。**代价实测**：ff 窗口 = merge 到 ff 之间的**整个 suite 时长**（现常态 500-1600s），
  输一次就作废一整轮 suite。

### 4.2 形态：workflow 末端的失败处置 subagent

**(a) 输入必须是【完整现场】，⛔ 不是一个退出码。**
至少需要：失败发生在哪一相（suite / gate / ff）、suite 红的具体文件与断言、ff 失败时 develop 尖端 sha
及本分支与它的**实际 diff 是否冲突**、该任务历史失败次数**及各自原因**。
**⊢ 没有这些，语义 agent 只会做出和机械计数器一样粗的判断**（垃圾进垃圾出）。

**(b) 输出是【分类 + 建议动作】，⛔ 不直接执行。**
```
outcome_class: ff-race-loss | suite-red-own | suite-red-other-task | infra-hang | gate-blocked
suggested:     rebase-and-retry | retry-as-is | fix-then-retry | escalate-human | defer-with-reason
confidence:    high | medium | low  + 理由（自由文本，可补充不可替代结构化字段）
```
**让它【判定】，让既有机械机制【执行】**——既拿到语义能力，又不把"能不能改 develop"这类权限交给
一个 agent 的自由裁量。

**(c) 它天然产出 §1.1 泄漏②缺的那个原因分类——这是本设计最省的一点。**
**⛔ 不需要单独造一个"原因分类层"**：失败 subagent 的 `outcome_class` **就是**那层数据。
重试上限只要改成读它（而不是读裸退出码），"降 cap 让路"与"放弃"两条策略订阅不同的 class，
矛盾自然消解——**它们从来不是策略打架，是被喂了同一个不分原因的输入。**

**(d) 必须防的失败模式：语义机制自己也会挂 / 超时 / 给不出结论。**
它**必须有一个"我判不了"的独立取值**（`outcome_class: unknown` + `evaluated: false`），
**⛔ 不得与"没问题"同形**（硬规则 3b）。判不了时**退回当前的机械行为**（保守重试或升级人），
⛔ 不得静默放行。

---

## 5. 依赖顺序与建议排期

```
§3 suite-driver kind（进程级看门狗 + 锁持有者）
   ├─ 落地时【顺带】完成 §2(b) 的释放原子性 ⇒ §2 不必单列为一条任务
   ├─ 前置：gap-suite-serial-lowconc-classification-recheck 的 AC3（buckets 取锁）先落地
   └─ 其 carrier（suite-round.jsonl 三态 outcome）是 §4 的输入前提之一
        └─ §4 失败处置 subagent（语义分类）
             └─ 其 outcome_class 替换 advanceRetryCap 的裸退出码输入
```

**⊢ 建议 §3 先做**：它是另外两条的地基，且能立刻止住"挂死无人管"这个**正在流血**的伤口
（今日两次，合计 233 分钟人工兜底）。§4 随后。§2 在 §3 落地时自然完成。

**⊢ 与已立案任务的关系（⛔ 防重复，实现方必读）**：
| 已立案 | 与本 SPEC 的关系 |
|---|---|
| `gap-suite-serial-lowconc-classification-recheck`（AC3） | **§3 的前置**，代码已写只差落地，⛔ 不得重写 |
| `gap-fan-in-per-task-suite-no-silence-timeout-watchdog` | **被 §3 吸收或作为其子集**——本 SPEC 给它一个结构性归宿（driver 的 wait + 定时兜底），落笔方判断是合并还是保留 |
| `gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock`（漏口②） | **互补不重复**：那条修"让槽也让 lane"的行为，§2 修"释放执行点的归属"。⛔ 该条的 lane 侧改动仍按其自身 AC 走 |
| `gap-worker-driver-resident-loop-intermittent-hang` | 正交（worker-driver 主循环竞态），但**同属"常驻循环可靠性"族**，§3 新增 kind 时应避免继承同款缺陷 |

---

## 6. 本 SPEC 明确不做的事

- ⛔ 不改 lane 预算公式、不改 S、不改 oversub（人 15:2xZ 逐字排除）
- ⛔ 不改 merge 正确性锁（`mergeLockWaitSecs`）——它是正确性锁，性格与资源锁不同，本 SPEC 只借它作范例
- ⛔ 不动 driver cap（`--concurrency`）与 lane 的乘积问题——manager 已识别"两轴乘积无人拥有"
  （cap 5 × 16 lanes = 结构上限 80 lane on 16 核，实测均值约 39），但人本轮未纳入范围，**记为观察项，不在此推进**
- ⛔ 不为 §4 的语义 agent 设置准确率阈值——成本结构未测量前不设数值阈值（硬规则 4 推论）

---

## 7. manager 的边界声明

本 SPEC 由 manager 撰写（`orchestration/SPEC-*` 属人 2026-08-10/14 裁定的 manager 豁免面）。
**manager 未写任何 `tasks/*.md`、未改任何实现代码**。立案形状（拆成几条、AC 怎么写、优先级）
归 outer 判断；实现归实现方。文中所有 `file:line` 与实测数字均为 manager 直接读码/读载体所得，
**非采信自述**；`gap-ac143` 三处载体 0 命中一条已做正控制。
