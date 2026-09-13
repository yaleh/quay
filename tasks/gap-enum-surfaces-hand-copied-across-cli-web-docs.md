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

- [x] AC1 能取假：往某个权威枚举**临时加一个值** ⇒ 检查器必须报出各表层未同步；同步后转绿。**两态输出逐字贴出。** 今天此项为假（无任何检查器）。
- [x] AC2 存量清单：打印全部权威枚举及其表层副本的两向差集；**差集非空者逐条列出**（这是本任务价值的直接读数，⛔ 不是只报一个总数）。
- [x] AC3 未评估可区分：某表层读不出（文件缺失/解析失败）⇒ 输出 `NOT-EVALUATED` 独立取值，⛔ 既非「一致」也非「不一致」。贴出三态实际输出。
- [x] AC4 豁免不依赖位置（能取假）：把一条合法豁免注释**移动到被检测构造内部** ⇒ 检查器**仍须正确识别该豁免**（⛔ 不得像 archguard TASK-88 那样整个漏掉该项）。贴出移动前后两态输出。
- [x] AC5 两个活漂移已消除：`GOAL_STATUSES` 与 `VALID_GOAL_STATUSES` 取值一致（或有显式豁免并说明理由）；`WEB_DRIVER_KINDS` 与 `KINDS` 同理。贴出改前/改后取值。

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
- plugin/scripts/checker-mutation-cases/enum-surface-parity-check.sh
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/capability-catalog.sh
- plugin/test/enum-surface-parity-check.test.mjs
- packages/quay/src/abi.ts
- packages/quay/src/goal-store.ts
- packages/quay/src/serve-sessions.ts
- adr/ADR-036-枚举事实的单一真源与表层派生-实现-帮助-web-文档不得各存一份手抄副本.md
- tasks/gap-enum-surfaces-hand-copied-across-cli-web-docs.md

## Evidence（AC1/AC2/AC3/AC4/AC5 的实际留档，输出逐字取自终端）

复现命令（worktree 内）：

```
node --no-warnings --experimental-strip-types plugin/scripts/enum-surface-parity-check.ts --root .
NO_COLOR=1 node --no-warnings --experimental-strip-types --test plugin/test/enum-surface-parity-check.test.mjs
T=$(mktemp -d); bash plugin/scripts/checker-mutation-cases/enum-surface-parity-check.sh "$T"; rm -rf "$T"
```

### AC2 —— 权威枚举清单 + 差集非空者逐条列出（改前 exit 1 → 改后 exit 0）

改后（`PASS`，25 个表层 / 14 条台账登记的已知漂移 / 0 未评估），权威面：

```
  [driver-kind] plugin/scripts/driver-runtime.ts — 6 值: promotion, worker, outer, quality, meta, goal
  [driver-verb] packages/quay/src/cli/driver.ts — 6 值: start, stop, drain, resume, status, restart
  [goal-status] packages/quay/src/abi.ts — 6 值: draft, active, achieved, superseded, retired, needs-human
  [meta-status] packages/quay/src/abi.ts — 2 值: proposed, answered
  [task-status] packages/quay/src/abi.ts — 5 值: todo, ready, done, needs-human, superseded
  [adr-status] packages/quay/src/adr-store.ts — 5 值: proposed, accepted, superseded, deprecated, rejected
  [doc-status] packages/quay/src/document-store.ts — 3 值: draft, active, retired
```

**改前**（修复落地之前跑同一检查器）——3 条未豁免违规逐条列出：

```
  [violation] web-driver-kinds (driver-kind) packages/quay/src/serve-sessions.ts — 2 值 {promotion, worker} · extra=[] missing=[goal,meta,outer,quality] · 收窄但无豁免注释（规范 5：不接受沉默地少列几个）
  [violation] web-driver-verbs (driver-verb) packages/quay/src/serve-sessions.ts — 3 值 {start, stop, restart} · extra=[] missing=[drain,resume,status] · 收窄但无豁免注释（规范 5：不接受沉默地少列几个）
  [violation] goal-store-valid-statuses (goal-status) packages/quay/src/goal-store.ts — 6 值 {draft, active, achieved, superseded, retired, needs-human} · extra=[needs-human] missing=[]
FAIL: 3 violation(s): web-driver-kinds, web-driver-verbs, goal-store-valid-statuses
```

**改后**同一个面的状态（两处活漂移消除后的取值）：

```
  [exempt] web-driver-kinds (driver-kind) packages/quay/src/serve-sessions.ts — 2 值 {promotion, worker} · extra=[] missing=[goal,meta,outer,quality] · 豁免（第 454 行）：Web 控制面只暴露任务处理型 kind（promotion/worker）。
  [exempt] web-driver-verbs (driver-verb) packages/quay/src/serve-sessions.ts — 3 值 {start, stop, restart} · extra=[] missing=[drain,resume,status] · 豁免（第 450 行）：Web 控制面无鉴权（AC3），只暴露三个生命周期动作。
  [derived] goal-store-valid-statuses (goal-status) packages/quay/src/goal-store.ts — 0 值 {} · 差集为空 · 派生自 packages/quay/src/abi.ts:GOAL_STATUSES（规范 2：不手抄）
PASS: all 25 registered surfaces consistent (14 known drift, 0 not evaluated)
```

差集非空但属**已登记存量**的 14 条（`-- 已知漂移（台账登记；报出而不阻断，只有【增长】才红）14 条 --` 段）逐条列出，每条的原文与理由见检查器 `KNOWN_DRIFT` 表；另有 3 条**未登记的候选子集字面量**（`--discover` 段，仅供参考、不参与退出码）逐条列出：
`packages/quay-native/src/mcp-server.ts:378 ⊂ goal-status — {achieved, superseded}` /
`plugin/scripts/criterion-failure-attribution-check.ts:97 ⊂ goal-status — {achieved, active}` /
`plugin/scripts/driver-filters.ts:224 ⊂ task-status — {done, needs-human, ready, todo}`。

### AC1 —— 能取假：往权威临时加一个值（`driver-runtime.ts:DRIVER_KINDS` 注入 `bogus`）

```
  [violation] cli-driver-kinds (driver-kind) packages/quay/src/cli/driver.ts — 6 值 {promotion, worker, outer, quality, meta, goal} · extra=[] missing=[bogus]
  [violation] driver-config-union (driver-kind) plugin/scripts/driver-config.ts — 6 值 {…} · extra=[] missing=[bogus]
  [violation] start-drivers-kinds (driver-kind) plugin/scripts/start-drivers.ts — 4 值 {promotion, worker, outer, goal} · extra=[] missing=[bogus,meta,quality] · KNOWN_DRIFT 台账登记为 extra=[] missing=[quality,meta]；实测差集【增长】
  [violation] driver-runtime-help-kind (driver-kind) plugin/scripts/driver-runtime.ts — 6 值 {…} · extra=[] missing=[bogus]
  [exempt] web-driver-kinds (driver-kind) packages/quay/src/serve-sessions.ts — 2 值 {promotion, worker} · extra=[] missing=[bogus,goal,meta,outer,quality] · 豁免（第 454 行）
FAIL: 12 violation(s): cli-driver-kinds, driver-config-union, start-drivers-kinds, cli-driver-help-kind, cli-help-kind, driver-runtime-help-kind, claude-md-driver-kind, drivers-skill-kind
```

还原权威（`git checkout -- plugin/scripts/driver-runtime.ts`）后逐字：

```
PASS: all 25 registered surfaces consistent (14 known drift, 0 not evaluated)
```

⇒ 三件事同时被钉住：①权威新增值 ⇒ 各表层 missing 增长（含台账面 ⇒ `实测差集【增长】` ⇒ RED）；②**合法豁免面不受影响**（子集仍合法，且差集照原样打印，不是沉默）；③还原即绿。同一形态在 `plugin/scripts/checker-mutation-cases/enum-surface-parity-check.sh`（checker-mutation-check.sh `--check` PASS，71/71 覆盖）与单测里**永久**钉住。

### AC3 —— 未评估可区分（把 `plugin/skills/drivers/SKILL.md` 临时移出 ⇒ 读不出）

```
  [not-evaluated] drivers-skill-kind (driver-kind) plugin/skills/drivers/SKILL.md
-- NOT-EVALUATED（读不出，⛔ 既非「一致」也非「不一致」）1 条 --
  drivers-skill-kind: plugin/skills/drivers/SKILL.md: file not found
NOT-EVALUATED: no violations, but 1 surface(s) could not be evaluated
exit=3
```

三态实际输出并列：**PASS** = `PASS: all 25 registered surfaces consistent …`（exit 0）／**RED** = `FAIL: 12 violation(s): …`（exit 1，AC1 段）／**NOT-EVALUATED** = 上面 exit 3。三者的判词行互不相同，该面在报表里是 `[not-evaluated]` 而**不是** `[in-sync]`。

### AC4 —— 豁免注释移到被检测构造【内部】仍被识别

移动前（注释在构造之前）：

```
  [exempt] web-driver-kinds (driver-kind) packages/quay/src/serve-sessions.ts — 2 值 {promotion, worker} · … · 豁免（第 454 行）：…
PASS: all 25 registered surfaces consistent (14 known drift, 0 not evaluated)
```

把该标记搬到 `WEB_DRIVER_KINDS` 数组字面量**内部**之后：

```
  [exempt] web-driver-kinds (driver-kind) packages/quay/src/serve-sessions.ts — 2 值 {promotion, worker} · extra=[] missing=[goal,meta,outer,quality] · 豁免（第 455 行）：MOVED-INSIDE 控制：豁免注释现在位于被检测构造【内部】，
PASS: all 25 registered surfaces consistent (14 known drift, 0 not evaluated)
```

⇒ 与 archguard TASK-88 相反：豁免的发现与「面」的发现彻底解耦（面来自显式登记表，豁免按 surface-id 扫全文），注释位置不影响识别；而**提取失败只会让该面变成 NOT-EVALUATED**（AC3），绝不伪装成「一致」。单测另附两条负控制：无标记的收窄 ⇒ RED（`无豁免注释`）；标记指名**别的**面 ⇒ 不豁免本面 ⇒ RED。

### AC5 —— 两个活漂移的改前/改后取值

| | 改前 | 改后 |
|---|---|---|
| `abi.ts:GOAL_STATUSES` | `draft, active, achieved, superseded, retired`（5） | `draft, active, achieved, superseded, retired, needs-human`（6） |
| `goal-store.ts:VALID_GOAL_STATUSES` | 手抄 6 值（与 ABI 已不同） | `[...GOAL_STATUSES]`（**派生**，`[derived]` 状态） |
| `serve-sessions.ts:WEB_DRIVER_KINDS` | `promotion, worker`（无理由的收窄） | 同值 + `enum-surface-exempt:` 带理由豁免（`[exempt]`）+ UI 的 `<select>` 由该常量渲染 |
| `serve-sessions.ts:WEB_DRIVER_VERBS` | `start, stop, restart`（无理由的收窄） | 同值 + 带理由豁免（`[exempt]`） |

**真源判定（DoD 要求）**：driver kind 的真源**不是** `cli/driver.ts:KINDS`，而是 kernel 数据表
`plugin/scripts/driver-runtime.ts:DRIVER_KINDS`——respawn 循环/pid/控制态/carrier/per-kind 动词全由它驱动，
新增 kind 的第一处永远是它；`KINDS`、`driver-config.ts` 的 kind 联合类型、以及全部帮助/文档副本都是它的**表层**。
`GOAL_STATUSES` 进 `needs-human` 的理由：store 接受该值，且 goal-store 的转移表记录 `needs-human→active`
是 5 次 reopen 中的 3 次（最高频来源）⇒ ABI 此前是 **under-declare**，修的是 ABI 侧。
