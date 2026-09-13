---
id: gap-enum-surfaces-hand-copied-across-cli-web-docs
title: 枚举事实在实现/帮助/Web/文档各存一份手抄副本 —— driver kind 七处四值，GOAL_STATUSES
  两份取值已不同（ADR-036 的实现载体）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**本任务是 `adr/ADR-036`（枚举事实的单一真源与表层派生）的实现载体。** ADR 记录规范与理由，本任务负责让规范**有机械强制**并修掉已确认的活漂移。

**症状一：driver kind 一个事实、七处副本、四种取值（2026-09-13 实测枚举，非抽样）**：

```
packages/quay/src/cli/driver.ts:33        KINDS = [promotion,worker,outer,quality,meta,goal]   6 个 ← 权威
packages/quay/src/cli/driver.ts:71        --kind <promotion|worker|outer|quality>              4 个
packages/quay/src/cli/help.ts:53          --kind <promotion|worker>                            2 个
packages/quay/src/cli/help.ts:324         --kind <promotion|worker>                            2 个
packages/quay/src/serve-sessions.ts:449   WEB_DRIVER_KINDS = [promotion,worker]                2 个
CLAUDE.md:240                             --kind <promotion|worker>                            2 个
plugin/skills/drivers/SKILL.md:3          "Start the promotion + worker drivers"               2 个
```

**代价已经兑现，⛔ 不是理论风险**：ad-arm1 的 archguard 自 2026-09-12 被接管起**只跑 promotion + worker**，其余四个 kind 从未被启动——而六个实现**早已全部在交付物里**（实测安装包 `dist/` 内六个 driver 齐全）。⇒ **分发做到了，暴露没做到**；用户与 agent 只看得到帮助那一份。直到人 2026-09-13 裁定「所有 driver 都应在目标项目实际运行」才被发现。

**症状二：另有两个枚举的副本取值已经不同（实测）**：

```
abi.ts:80         GOAL_STATUSES       = [draft,active,achieved,superseded,retired]              5 个
goal-store.ts:77  VALID_GOAL_STATUSES = [draft,active,achieved,superseded,retired,needs-human]  6 个
  ⇒ ABI 声明面少一个 needs-human。后果实在：按 ABI 枚举做校验的消费者会判它非法，而 store 接受它。

serve-sessions.ts:449  WEB_DRIVER_KINDS = 2 个   vs   driver.ts:33  KINDS = 6 个
  ⇒ Web UI 的 driver 控制面同样只暴露两个 kind。
```

`help.ts` 对 `KINDS` / `VERBS` / `STATUSES` 的引用次数均为 **0** ⇒ 至少 11 处权威枚举在帮助面全是手抄。

**这一类的失败形态是静默的**：帮助少列四个 kind，既不报错也不影响功能，只是让能力在产品表层消失——**与「该能力不存在」完全同形**（硬规则 3b）。

**现成的设计参考**：兄弟项目 archguard 的 `ADR-007` 用 `scripts/check-adr.ts` 对 CLI↔MCP parity 做同类强制并挂 Stop hook，2026-09-13 经本仓库独立验证有效（修复后候选集 32→35）。**它也留下了一个必须避开的坑**：豁免注释若写在被检测构造**内部**（而非之前），提取正则整个匹配失败、该项目**彻底隐形**于检查（archguard TASK-88 实证，三个工具因此漏检）。

## Plan

1. **先取直接量**：枚举全部「权威枚举定义」（形如 `export const X = [...]`）及其在各表层的副本位置与取值，**打印清单与两向差集**（⛔ 不只报数量；引用计数前先打印命中内容）。
2. **造检查器**：断言各表层与权威枚举一致。**读不出某表层时必须输出独立取值（`NOT-EVALUATED`），⛔ 不与「一致」共用输出**（硬规则 3b）。
3. **豁免机制**：某表层确有理由只暴露子集时，须在**代码处**写显式豁免并带理由。⛔ **豁免识别不得依赖注释与被检测构造的相对位置**——见 Proposal 末尾 archguard TASK-88 的实证坑。
4. **修掉两个已确认的活漂移**：`GOAL_STATUSES` ↔ `VALID_GOAL_STATUSES`（决定 `needs-human` 该不该进 ABI，给出理由）；`WEB_DRIVER_KINDS` ↔ `KINDS`（决定 Web 是否该暴露全部六个，若否则走规范 5 的显式豁免）。
5. **接线**：把检查器接进既有的静态闸，⛔ 不新造一条独立的执行路径。

## Acceptance Criteria

- [ ] AC1 能取假：往某个权威枚举**临时加一个值** ⇒ 检查器必须报出各表层未同步；同步后转绿。**两态输出逐字贴出。** 今天此项为假（无任何检查器）。
- [ ] AC2 存量清单：打印全部权威枚举及其表层副本的两向差集；**差集非空者逐条列出**（这是本任务价值的直接读数，⛔ 不是只报一个总数）。
- [ ] AC3 未评估可区分：某表层读不出（文件缺失/解析失败）⇒ 输出 `NOT-EVALUATED` 独立取值，⛔ 既非「一致」也非「不一致」。贴出三态实际输出。
- [ ] AC4 豁免不依赖位置（能取假）：把一条合法豁免注释**移动到被检测构造内部** ⇒ 检查器**仍须正确识别该豁免**（⛔ 不得像 archguard TASK-88 那样整个漏掉该项）。贴出移动前后两态输出。
- [ ] AC5 两个活漂移已消除：`GOAL_STATUSES` 与 `VALID_GOAL_STATUSES` 取值一致（或有显式豁免并说明理由）；`WEB_DRIVER_KINDS` 与 `KINDS` 同理。贴出改前/改后取值。

## Definition of Done

- 五条 AC 满足，AC1/AC3/AC4 的多态输出有实际留档。
- ⛔ **不得通过「把 6 个 kind 手抄进 help.ts」来消除 driver kind 的不一致**——那只是把今天的不一致变成明天的不一致，且会让 AC1 红。
- ⛔ **不得通过删除某一处副本定义来「消除差集」而不确认谁是真源**——先定真源，再让其余派生。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## 范围边界（⛔ 不做，各自去向已记）

- **文档面（CLAUDE.md / SKILL.md）的存量归位不在本任务内**：本任务只负责让检查器**报出**它们，归位另行处理。理由是 Touches 若涵盖 CLAUDE.md 这类核心文件会长期锁住它们，阻塞无关任务（本仓库 touches 锁是文件级）。
- **`driver.ts` ↔ `help.ts` 那一处的具体修复**由 `gap-driver-cli-help-hides-four-of-six-kinds` 承接；本任务提供的是**那一类**问题的统一机制。两者是「规范」与「该规范的第一个实例」的关系，⛔ 不重复实现。

## Touches

- plugin/scripts/enum-surface-parity-check.ts
- packages/quay/src/abi.ts
- packages/quay/src/goal-store.ts
- packages/quay/src/serve-sessions.ts
- adr/ADR-036-枚举事实的单一真源与表层派生-实现-帮助-web-文档不得各存一份手抄副本.md
- tasks/gap-enum-surfaces-hand-copied-across-cli-web-docs.md
