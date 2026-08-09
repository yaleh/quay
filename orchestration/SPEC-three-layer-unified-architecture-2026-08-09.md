# 规格:manager / outer / inner 的最小统一架构

**日期**:2026-08-09(管理者)
**触发**:人「按上述讨论,建议一份 SPEC,以基于现有实现创建一个最小的 manager/outer/inner
统一架构,并可以尽快应用和持续演进。」
**定义者**:管理者。**实现者**:quay 外层 + 内层(走项目正常流程)。**AC/DoD 与立案由外层判断。**

**人给的边界**:
- 优先:冷启动加载、事件触发、tick 稳定行为和兜底、任务队列、执行账本、收尾/状态翻转、
  写入落点、停机/抢占的覆盖面
- **暂不动**:信道与投递保证(沿用现有 tmux send-keys,晚些单独改进)
- **tick 机制以 manager 现在的 tick 架构为基础改进**

---

## 0. 方法:不从设计偏好出发,从「同一个缺陷在两层各犯一次」出发

本规格的每一条都对应 2026-08-08~09 一夜里实测到的、**在两层或三层重复出现**的失效。
不重复出现的,不进本规格。

| # | 失效 | 实例 A | 实例 B |
|---|---|---|---|
| 1 | 声称周期执行的机制静默停摆 | manager 的 workflow **21.5h**(死于 08-08 07:49:05 压缩边界) | outer 的 `1b` 收尾例程 **8.5h**(标着「强制/每 tick」,埋在 1095 行文档第 687 行) |
| 2 | 机制建好但没有消费者 | `forkBaseline()` 默认分支从未走到(49/49 fork 自 integration) | `scope` 字段无人读(`grep -c scope integration-batch-merge.sh` = 0);`decideIntegrationToDevelopMerge` 无非测试调用者 |
| 3 | 同一平台行为一层记了一层没记 | outer 有「cron 只在会话空闲时触发」;manager 没有,直到抽取它的文档才知道 | — |
| 4 | 读数存在但判断不存在 | A5 每轮打印 `archguard 无.halt`,而它 2 天无提交,连续多轮未升级 | — |
| 5 | 收据粒度与判据不匹配 | `manager-tick-log-check.sh` 在 workflow 死掉的 21.5h 里**每轮 PASS**(行是手写的) | — |

**⇒ 统一的目标不是让三层长得一样,是让任何一层踩过的坑自动成为另外两层的护栏。**

---

## 1. 一个「层」是什么:七元组

```
Layer = (Role, Anchor, Core, Ledger, QueueView, WriteTarget, HaltResponse)
```

**只有 `Role` 是真差异,其余六项三层各自手搓了一份。** 本规格统一后六项的**形状与契约**,
不统一各层内部怎么实现。

| 项 | 定义 | 三层的差异只在 |
|---|---|---|
| `Role` | 该层负责什么、不负责什么 | **全部**——这是唯一该保留的差异 |
| `Anchor` | 一个纯指针(cron prompt),指向 `Core` | 周期 |
| `Core` | ≤80 行的执行核:A 读数 / B 必产出 / C 硬约束 / D 边界 | 条目内容 |
| `Ledger` | 每轮一行 + 每个声称机制的最近真实执行时刻 | 落盘位置 |
| `QueueView` | 该层看到的任务/工作队列 | 视图范围 |
| `WriteTarget` | 该层的写落哪条线 | 具体分支 |
| `HaltResponse` | 收到停机信号时的机械行为 | 抢占粒度 |

---

## 2. 八个优先维度的统一形态

每条给三样:**现有实现**(不发明)、**统一点**(契约)、**最小改动**(能立刻做的)。

### 2.1 冷启动加载

- **现有**:`plugin/skills/cold-start/SKILL.md`;`SPEC-cold-start-one-liner`(「一两行命令 +
  两个 skill + 内层零操作」);`plugin/scripts/inner-session-check.sh`(查后建,`window_exists()` + 多源探测)。
- **统一点**:冷启动是**一个固定 skill**,对三层同形,只以 `Role` 参数化。它做且只做四件:
  ① 绑身份(我是哪一层、观测对象是谁)② 绑写入落点 ③ 挂 monitor + 武装 anchor ④ 崩溃态对账。
- **人裁定(2026-08-09)**:自愈边界是 **Claude Code 进程**,不是 CC 的「会话」概念——
  `/clear` 与 `/compact` 后 CC 视为新会话,**quay 必须连续覆盖**。跨进程复活不做。
- **启动链作为便利措施**:manager 可启动(不负责自愈)outer 与 inner;outer 可启动 inner。
  **两条路径重叠 ⇒ 必须幂等**(`inner-session-check.sh` 已是查后建形态,不需新发明)。
- **最小改动**:把「绑身份 / 绑落点 / 崩溃态对账」三步显式写进 cold-start skill——
  今天它们散在各层文档里,而**身份绑错已实际发生**(`session-liveness` 曾盯 outer 自己的 pid)。

### 2.2 事件触发

- **现有**:`session-liveness.sh`(pane + transcript 双源,`LOOP_MIN` 噪声闸);`Monitor` 工具任务。
- **统一点**:事件是**旁路**,不是主路。**任何事件的缺失都不得导致停摆**——主路是 tick。
  事件只做一件事:**把「等到下一个 tick」缩短为「立刻」**。
- **最小改动**:每层的 `Core` 必须有一条 A 项检查**自己挂的观测器是否还活着且盯对了对象**
  (manager 的 A10/A11 已是此形态)。**观测器死了没人知道,等价于没挂。**

### 2.3 tick 稳定行为和兜底(**以 manager 现有架构为基础**)

- **现有**:manager 的 `orchestration/manager-tick-core.md`(64 行,A13/B4/C13/D)+
  1138 行理由档案 + 锚指向档案且档案首行指向核。三层执行核已产出(55/79/73 行,共 90 处 `(src:N)`)。
- **统一点**:
  1. **`Core` ≤80 行**,分 A/B/C/D 四段;每条**带源行号 `(src:N)`** 回指理由档案。
  2. **锚是纯指针**,内容现读;**理由档案首行必须指向 `Core`**——
     **凡是必须跨压缩存活的东西,必须落在锚所指向的文件里**(ADR-009 第二次修订)。
  3. **并行对照期**:核建成后不立即改锚;两份并行跑、逐项审计差异、收敛后再切,切换留痕。
     **实证:manager 的核第一次真实使用就暴露 4 项漏抽;若当时改锚,那 4 项会静默消失。**
  4. **兜底**:cron 只在会话空闲时触发 ⇒ **人机对话结束前手动补一次 tick**,并标注「补跑」。
- **最小改动**:outer / inner 各自跑一轮并行对照 + 差异审计(它们的「故意没抽」清单已在手)。

### 2.4 任务队列

- **现有**:`ready-pool-check.ts::analyzeTasks`(真实 pool = `status:ready` 减三类不可派:
  `fixture` / `parked` / `not-yet-flipped`);`slot-refill.ts`(step-4 三检查 + `assembleBatch`);
  `touches-orthogonality-check.ts::checkTouchesPair`(空/过宽 `## Touches` ⇒ 保守串行化)。
- **统一点**:**队列只有一个真源**(`analyzeTasks`),三层看到的是它的**不同视图**,不是各自的计算。
  **`in-flight` 必须是测量值,不是入参**——`slot-refill` 的 `in_flight_count` 是调用方传入的,
  不传即 0(manager 曾据此连报数轮错读数)。
- **最小改动**:把「`pool` / `dispatchable_disjoint` / 真实 `in-flight`」定为三层 `Core` 的
  **同名 A 项**,取值命令一致。今天三层各有各的取法。

### 2.5 执行账本(**本规格的核心,今天最缺的一项**)

- **现有(零散)**:`manager-tick-log-check.sh`(tick 留行 + mtime 新鲜度);
  `closure-lag-check.sh --record --flipped N`(**零收尾也要写 0**,2026-08-09 05:47 新建);
  `verification-round.jsonl`(轮次记录);`meta-cc query_session_content role=tool tool_name=<X>`
  (**任意工具的最近调用时刻,现成可用**)。
- **统一点——四元组,每层每轮吐出,同一格式**:
  ```
  ① 我声称在用的每个机制，最近一次真实执行时刻（与其声称周期比对）
  ② 我的占用率（真实 in-flight / effective_cap）
  ③ 我这一轮的写入落到哪条线
  ④ 本轮账本行（缺值 = 未执行）
  ```
- **两条硬判据**:
  - **收据粒度必须匹配判据**。`manager-tick-log-check.sh` 在 workflow 死掉的 21.5h 里每轮 PASS,
    因为行是手写的。**收据证明「轮次发生过」,不证明「轮次里的步骤用什么方式执行」;
    粒度错了的收据比没有收据更危险,因为它让棘轮报绿。**
  - **静态查「有没有调用者」不足以判定机制有效**,必须再查时间序列:
    最近一次真实执行 vs 声称周期。今晚四例静态缺陷 + 两例动态停摆已证。
- **最小改动**:三层 `Core` 各加一条 A 项,内容为 `meta-cc` 查本层声称机制的 `last(timestamp)`,
  超过 3 个周期未调用 ⇒ 必须写明「已停用 / 已替代 / 是缺陷」三选一,**不得留空**。
  (manager 的 A9 已是此形态,可直接复制。)

### 2.6 收尾 / 状态翻转

- **现有**:outer `1b` 异步收尾例程(探测 `not-yet-flipped` → 逐个关遥测括号 → 核 AC/DoD →
  翻 `status` → 记 `closed`);`closure-lag-check.sh`(滞后信号)。
- **统一点**:**职责跨三层但必须有单一所有者**——inner 做完不翻状态,outer 翻,manager 只观测。
  今天这条已成立,缺的是**它有没有在跑**的证据(见 2.5)。
- **最小改动**:把 `closure-lag-check.sh --record --flipped N` 的**写入端接线**——
  它 05:47 建成,至 06:4x 仍报 `closure_pass_last_run:null`,即写入端一次未被调用。
  **这是「机制建好没接线」在本规格立项当天的活实例。**

### 2.7 写入落点

- **现有**:两线模型(`develop`=FORK_BASELINE / `integration`=MERGE_TARGET);
  `integration-branch-model.ts`(`forkBaseline` / `decideIntegrationToDevelopMerge`,**均无生产调用者**);
  2026-08-09 03:38 结构性修法(**outer 工作检出改为 integration,develop 只经 ff 前进**)。
- **统一点**:**每层必须声明自己的 `WriteTarget`,且该声明可机械核对**。
  今天的事实:manager 的写落 `integration`(我 02:15 落 develop 破过一次不变式);
  outer 工作检出 = `integration`;inner 在 task 分支,fan-in 到 `integration`。
- **最小改动**:`Core` 的 C 段各加一条「本层的写落哪条线」,并在提交前自检——
  判据:`git rev-list --count integration..develop` 必须为 0(`develop-only` 提交即违约)。

### 2.8 停机 / 抢占的覆盖面

- **现有**:`.halt` 哨兵(仓库根);`slot-refill.ts::checkHaltSentinel`(**fail-closed**:
  ENOENT ⇒ 未停机;任何其它读失败 ⇒ 判停机,绝不 fail-open);`supervisor-preempt.sh`(进程级抢占)。
- **统一点**:**停机对三层同时机械生效,不靠自觉**。今天 `.halt` 只对 inner 的**派发**机械生效
  (实测 `should_refill=False`),manager 与 outer 靠读文件后自己遵守。
- **最小改动**:三层 `Core` 的 A 段都加 `.halt` 读取,且 **A5 是组合判据不是单读**:
  `无 .halt` **且** 长期无产出(>24h)⇒ **未标记的停摆**,必须升级。
  **实证:我每轮打印 `archguard 无.halt`,而它已 2 天无提交,连续多轮未升级——
  只读不判会稳定产生「看见但没发现」。**

#### P2-8 验收（`gap-spec-p2-halt-three-layer-mechanical-enforcement`,2026-08-09 落地）

统一检查点 = `plugin/scripts/halt-check.sh --for <layer> --json`,三层 tick 入口各接
(`--for inner` / `--for outer` / `--for manager`)。三层实测:

- **放置 `.halt` ⇒ 三层停**:`halt-check.sh --for {inner,outer,manager} --json` 三层各自输出
  `halted: true`(measure `three_layer_halt_effective` = 3 个 `halted` 字段,band 3 达成)。
- **移除 `.halt` ⇒ 三层恢复**:删哨兵后三层 `halted: false`(invariant `halt_removal_resumes` = 1)。
- **组合判据机械化**:无 `.halt` + 最后提交 >24h ⇒ `stall: true` + 原因「unmarked stall (SPEC 2.8):
  no .halt AND last commit … h ago > 24.00 h threshold」;有 `.halt` ⇒ `stall: false`(标记停不是未标记停摆)
  (invariant `halt_combination_mechanical` = 1)。fail-closed 读语义与 `supervisor-preempt.sh halt-check`
  同形(读失败 ⇒ `halted: true`,绝不 fail-open)。

三层 tick 接线:inner `plugin/loop/fast-mode-loop-tick.md` 步骤 0 / outer `orchestration/
orchestrator-loop-tick.md` 步骤 0d / manager `orchestration/manager-loop-tick.md` 步骤 1a。
capability-catalog 声明 `halt-check.sh`(AC1c 门绿)。

---

## 3. 明确不统一什么

**不统一控制流。** ADR-022(2026-08-03,人裁定)刚刚退役过一次统一尝试——经典里程碑循环的
composite 相位管线,**那次统一的正是控制流**。本规格统一的是**可观测契约**:
每层每轮吐什么、以什么格式、缺值算什么。**各层内部怎么走,不动。**

**不统一信道**(人已明确:沿用现有 tmux send-keys,晚些单独改进)。

**不引入新层。** 三层已是人多次强调要克制的数量。

---

## 4. 交付顺序(最小可用 → 持续演进)

**P0(今天就能做,全部是"接线",不是新建)**
1. 三层 `Core` 各加 2.5 的账本 A 项(复制 manager A9)。
2. `closure-lag-check.sh` 的写入端接线(2.6)。
3. 三层 `Core` 的 A 段补 `.halt` 组合判据(2.8)。
4. outer / inner 各跑一轮并行对照 + 差异审计(2.3)。

**P1(结构,需要一次设计)**
5. cold-start skill 显式化四步(2.1)。
6. 队列三读数在三层同名同命令(2.4)。
7. `WriteTarget` 声明 + 提交前自检(2.7)。

**P2(需要产品改动)**
8. `.halt` 对三层同时机械生效(2.8)。
9. 四元组的统一发射器(三层共用一个实现)。

---

## 5. 验收判据(可机械核,不靠自述)

| # | 判据 | 怎么核 |
|---|---|---|
| AC1 | 三层各有 `Core`,均 ≤80 行,每条带 `(src:N)` | `wc -l` + `grep -c 'src:'` |
| AC2 | 三层锚所指文件的**首行**指向各自 `Core` | `head -5` |
| AC3 | 三层每轮账本行含四元组,**无缺值** | 抽查任意 3 轮 |
| AC4 | 三层各有一条「最近真实执行时刻」A 项,且**已至少触发过一次判定** | 账本里能读到「已停用/已替代/是缺陷」之一 |
| AC5 | `closure-lag-check.sh --json` 的 `closure_pass_last_run` **非 null** | 直接跑 |
| AC6 | `git rev-list --count integration..develop` = 0 | 直接跑 |
| AC7 | 任一层 `Core` 新增一条 C,另两层在**下一轮 tick 内**可见并判定是否借入 | 跨层互查留痕 |

**AC7 是本规格的真正目标**:不是三层长得一样,是**经验能在层间流动**。
今晚已实证一次:manager 从 outer 借走 3 条、从 inner 借走 1 条,
其中「send-keys 三次分开调用」是我做了十几次却零文档记载的动作。

---

## 6. 已知风险(写出来,不藏)

1. **再造一份没人跑的散文。** `plugin/loop/` 下已有三份 100KB 级文档,其中两份里有写着「强制」
   却静默停摆的步骤。**本规格若只产出文档,默认结局是第四份。**
   ⇒ 交付物的第一优先级是 P0 那四条**接线**,不是本文件。
2. **压缩比虚高伪装成成绩。** manager 的核 20.2× 时漏 4 项,补齐后降到 17.8×。
   **漏抽会以「压缩比更高」的形式表现为进步。**
3. **统一动作本身会破坏正在推进的收敛**(我 02:15 与 05:0x 各犯一次:
   立案/写文档推高 tip,挡住 ff)。⇒ P0 的每一步都要先看当前 `WriteTarget` 与 ff 窗口。
4. **本规格的判据全部来自一夜的实测,样本是 n=1 的一晚。** 跨天复现之前,
   AC 的阈值(80 行 / 3 个周期 / 24h)都是**待标定值,不是定论**。
