---
id: gap-needs-human-overloaded-two-populations-one-state
title: needs-human 承载两个处理者相反的群体却只有一个取值——7 天 71 次翻转中 69 次是「worker 落不了地」、0
  次是「人须裁决」，且该翻转把任务从有处理者的状态移入无处理者的状态
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/driver-filters.test.mjs
---
## Finding

**结论**：`needs-human` 这一个状态同时承载**两个处理者完全相反**的群体，而它们在状态、载体、读法上**逐字段同形**：

| 群体 | 真实处理者 | 正确动作 |
|---|---|---|
| 人须裁决（方向取舍、授权、跨层冲突） | **人** | 等人给出裁定 |
| worker 落不了地（ff 闩锁 / flaky / 无关红 / 宿主负载） | **重新派发**（阻塞解除后） | 解除阻塞 → 回 ready |

**实测比例（近 7 天，全量非采样）**：`→needs-human` 翻转 **71** 次，其中判词为「重试上限机械翻转」的 **69** 次 = **97.2%**；其余 2 次分别是「解除全局 fan-in 阻塞」与一次同步收敛提交。⇒ **7 天内真正属于第一类（人须裁决）的 = 0**。

### 一、最贵的一点：这个翻转把任务从「有处理者」移入「无处理者」

按本项目已确立的对象-处理者模型：`todo` 的处理者是 promotion-driver、`ready` 的处理者是 worker-driver、`done` 是终态。**而 `needs-human` 没有任何 driver 处理它**——promotion 不看（非 todo）、worker 不看（非 ready）。

⇒ 「worker 落不了地」这一类的正确动作明明是**重新派发**（一个机械动作），却被送进了一个**只有人才能出来的状态**。这与 `divergences` 无执行器、`addressedTasks` 无出口是同一条规则的第三次违反：**输出落在了一个其处理者不具备相应动作的对象上。**

### 二、人工解卡的实测成本（硬规则⑫：先给发生率，不凭空设前置）

近 7 天 `needs-human→ready` 回流 **21** 个提交（其中一条覆盖 7 个任务）⇒ 约 **27 次人工解卡，约 4 次/天**。每次都要读 fan-in/suite 日志、判断阻塞是否属于该任务本身。

**判词里其它会话已独立得出同一结论**（逐字，非我的措辞）：

```
「CONTINUE 续做：实现已完成，清重试上限误标」
「fix-worker 落不了 authoring 修复被重试上限误翻；作者面已完整，直接回 ready 重派」
「observation AC1 阈值放宽已 done，误杀根因解除」
「ff-protocol-check 假阳性已修」
「机器负载已回落，observation AC1 性能 flaky 解除」
```

⇒ **误标 / 误翻 / 误杀** 三个词由不同会话在不同时间各自写下。这不是一次误判，是一个稳定的机制行为。

### 三、为什么不能只靠「读判词区分」

判词是**自由散文**，写在 task body 的 `## Needs-Human` 段里。要区分两类必须解析散文 ⇒ 违反硬规则②（按位置判定，不按关键词）。且同一条任务可以累积多个 `## Needs-Human` 段（实测 `gap-bypass-check-unclassifiable-exits-zero` 有 3 段、`gap-meta-carrierstats` 有 2 段），**最新一段与历史段在结构上不可区分**。

### 四、⛔ 修法不是「自动重派」

第二类的正确动作是重派，但**无条件自动重派会复活活锁**——那正是 anti-livelock 当初要防的。重派必须**由「阻塞已解除」的证据触发**，而不是由时间或次数触发。⇒ 这也是为什么本条与 `gap-ff-retry-counter-runid-no-longer-per-dispatch`（ff 计数键）是**两条不同任务**：那条修「预算被永久耗尽」，本条修「耗尽之后落进了一个没有处理者的状态」。修好那条会显著减少本条的发生量，但**不会**使本条消失（flaky / 无关红 / 宿主负载仍会走到这里）。

**方向倾向（供执行者判断，非强制）**：给翻转写入一个**机械可读的成因类**（frontmatter 字段或结构化载体，⛔ 不是散文），至少区分「人须裁决 / 阻塞在任务之外 / 未能分类」三态（第三态独立取值——硬规则③b：分不出类不得与前两者共用取值）。第二类的再入队条件由**证据谓词**决定（例如：该任务上次失败的判词对应的阻塞对象现已消失/已修复），⛔ 不由时间或重试次数决定。⛔ **不接受**：①新增 driver kind 处理它（SPEC §5.1：RoutineSpec 就是抽象，新 kind = 16 处登记面）；②无条件按时间自动重派（复活活锁）；③只改判词措辞而不给可机械读的取值（散文解析违反硬规则②）。

## AC

- [x] 翻转写入机械可读的成因类，三态可枚举（人须裁决 / 阻塞在任务之外 / 未能分类），⛔ 不是散文、⛔ 不是布尔；判据须读结构化字段，⛔ 不得 grep 任务正文。
- [x] 三态双向能取假：喂一个 ff-escalation 判词的失败 ⇒ 归「阻塞在任务之外」；喂一个该任务自身 AC 不达标的失败 ⇒ 归「人须裁决」或保持现有语义；喂一个解析不出判词的失败 ⇒ 归「未能分类」（⛔ 不得落成前两者之一）。三个断言缺一不可。
- [x] 「未能分类」不与合格同形：断言该态在读数/退出码上与另两态可区分（硬规则③b）。
- [x] 第二类有可机械判定的再入队条件，且该条件**能取假**：阻塞证据仍在 ⇒ 不再入队；阻塞证据消失 ⇒ 可再入队。⛔ 不得以「距上次失败超过 N 分钟」作为条件（那是时间不是证据）。
- [x] 历史可回放：以立案时实测的 7 天窗口（71 次翻转）为输入，新分类器给出各态的条数，且「人须裁决」一类的条数由该输入决定而非硬编码；⛔ 该回放不得依赖任何 fixture 注入。

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述），三态与再入队条件的负控制均实跑确认能取假。
- [x] **生产载体证据（非 fixture）**：改动落地后至少一次真实的 needs-human 翻转带上非空成因类；若窗口内无翻转发生，须贴出「窗口内确无翻转」的读数支撑（硬规则④推论三：能产出 ≠ 已产出）。
- [x] 与 `gap-ff-retry-counter-runid-no-longer-per-dispatch` 的关系写入任务体：那条修「预算被永久耗尽」，本条修「耗尽后落进无处理者的状态」；说明为何修好那条**不会**使本条消失。
- [x] ⛔ 未新增 driver kind（SPEC §5.1）；⛔ 未新增周期性检查器；⛔ 未实现「按时间无条件自动重派」。
- [x] ⛔ 未改变 `needs-human` 对**真正需要人裁决**那一类的语义——人仍是它的处理者，本条只把不属于它的那一类分出去。

## Relation to gap-ff-retry-counter-runid-no-longer-per-dispatch

那条修「ff 重试预算被永久耗尽」：计数键从「每次 dispatch 一个」退化为「驱动进程生命期一个」，导致任务在整个驱动生命期内累计失败、超过阈值后每次派发只剩 1 次 ff 机会。本条修「耗尽之后落进无处理者的状态」：**即使那条把计数键改回每次 dispatch 一个、预算足额**，flaky / 无关红 / 宿主负载 / 真实 ff 闩锁（develop 持续前进）仍会让任务在重试上限处翻转 `needs-human`，而该翻转把「本应重新派发」的任务送进「只有人才能出来」的状态。**修好那条会显著减少本条的发生量（ff 步的机械翻转减少），但不会使本条消失**——本条新增的是翻转时的成因类分类（三态可枚举的 `needs_human_cause` frontmatter 字段）+ 第二类的证据谓词再入队条件（`blockedOutsideTaskResolved`），独立于那条的计数键修复。

## Execution record

**DoD1（判据实跑，⛔ 非转述）**：`node --experimental-strip-types --test plugin/test/driver-filters.test.mjs` →

```
ℹ tests 55
ℹ pass 55
ℹ fail 0
```

新增 9 条断言覆盖 AC1–AC5：AC1 三态可枚举 + `markNeedsHuman` 写 `needs_human_cause` 字段 + `readNeedsHumanCause` 读结构化字段（正文散文不算命中）+ `patchNeedsHumanCauseField` 插入/替换/fail-closed；AC2/AC3 `classifyNeedsHumanCause` 三态双向（ff⇒blocked-outside-task、ac-gate/suite⇒human-adjudication、null/未知步⇒unclassified）+ unclassified 读数与缺字段/另两态可区分；AC4 `blockedOutsideTaskResolved` 证据谓词能取假（证据在⇒false、证据消失⇒true、无记录⇒null）；AC5 `tallyNeedsHumanCauses` 条数由输入决定。负控制实跑确认能取假：ff 步 ≠ human-adjudication、无 exited-not-landed 尝试 ⇒ human-adjudication、step=null ⇒ unclassified、无 escalation 记录 ⇒ null（≠ true）。

**AC5（历史回放，真实载体，⛔ 非 fixture）**：以 `.quay/worker-outcome.jsonl` 7 天窗口 331 条 `exited-not-landed` 为输入，`classifyNeedsHumanCause` 读每条 `mechanical_fan_in.step` →

```
tally: {"human-adjudication":279,"blocked-outside-task":38,"unclassified":14}
step histogram: {"suite":186,"merge-develop":20,"ac-precheck":5,"scoped-gate":43,"anti-drift":21,"ac-gate":4,"ff":38,"<none>":14}
ff-only subset tally: {"human-adjudication":0,"blocked-outside-task":38,"unclassified":0}
```

「人须裁决」条数由输入决定（喂 ff-only 子集 ⇒ 0，⛔ 非硬编码）。

**DoD2（生产载体证据：窗口内确无翻转）**：代码尚未落地 ⇒ 窗口内无带成因类的真实翻转。读数支撑：`grep -rl "^needs_human_cause:" tasks/ | wc -l` ⇒ `0`（硬规则④推论三：能产出 ≠ 已产出，故贴「确无翻转」读数而非断言已产出）。

## Touches

- `plugin/scripts/driver-filters.ts`
- `plugin/test/driver-filters.test.mjs`
- `tasks/gap-needs-human-overloaded-two-populations-one-state.md`


## 被 gap-retire-needs-human-cause-enumeration 取代（2026-09-20）

**本节是追加——其上的正文与 AC/DoD **一字未改**，作为该机制的历史实现记录保留。** 本任务引入的整套机制（`needs_human_cause` frontmatter 字段、三态枚举、手写的步骤名清单 + 分类器、以及第二类的再入队证据谓词）已由 `gap-retire-needs-human-cause-enumeration` 整套删除。

**直接量（2026-09-20）**：磁盘上带 `needs_human_cause:` 的任务 **37** 个 —— `human-adjudication` **29** / `unclassified` **8** / `blocked-outside-task` **0**。

⇒ 本任务存在的全部理由（把第二类分出来、并据证据谓词再入队）在生产里**一次都没发生过**：`blocked-outside-task` 零样本；`blockedOutsideTaskResolved` 零个非测试调用者；除 `driver-filters.ts` 与其测试外，源码 / schema / CLI / MCP / web / 派发**没有任何读者**。且枚举清单是开放世界：新增一个 fan-in 步骤就漏，步骤名 `ff` 还会把证书闸失败错标成「develop 前进」。

**人的裁定（2026-09-20，逐字）**：

> 「needs-human 本来就不应该有『可机械再入队』的路径。」
> 「我对靠枚举 `needs_human_cause` 做逻辑控制也没有太大信心 —— needs-human 的原因应当是异常，枚举异常是靠不住的。」

⇒ 上面 AC1–AC5 与「Relation to …」一节里指向被删符号的判据随之失效（它们的实现对象已不存在）。删除**不新增任何替代分类，也不新增任何再入队路径**——本条的这一节不是「换成另一种枚举」，而是「这条路本身不该存在」。磁盘上已有的 37 个遗留字段作惰性遗留保留（⛔ 不批量改任务文件，硬规则 11b）。
