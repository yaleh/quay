---
id: gap-ac190-goal-ac-rule-not-enforced-at-filing
title: AC-190 判据复发：规则只在事后检测、立案/写入面零约束——生效线后第一条 delivery-critical 任务即无 goal_ac
status: todo
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-190
---
## Proposal

**AC-190 判据当前取假（实测 2026-09-13，本仓库生产工作树）**：

    $ node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts
    FAIL: 生效线之后新立案的 delivery-critical 任务未声明 goal_ac（fail-closed）: gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak
    EXIT=1

`--json` 读数：`{"total":156,"violating":["gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak"],"compliant":35,"grandfathered":120,"grandfathered_no_goal_ac":115,"grandfathered_with_goal_ac":5,"cutoff":"2026-09-09T00:00:00Z","ok":false}`。

**反例是真的，不是判据误报**：`tasks/gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak.md`
的 frontmatter `labels` 含 `delivery-critical`（首见于 `ef4c12f37`，2026-09-13T08:17:18Z，
晚于生效线 `2026-09-09T00:00:00Z`），且 top-level 与 `extra` 下都没有 `goal_ac` 键。
⇒ 检测器判对了；红的是仓库本身。

### 为什么上一次修法没守住（根因，不是复述现象）

上一次修法 `gap-long-term-guarantee-registry-hand-maintained`（**status: done**，2026-09-09，
`goal_ac: AC-190`）把判据从「手维护三项登记表」换成位置判定 + 生效线，方向正确；它没守住有三个可查原因：

1. **它落地时的绿是真空的，不是测出来的。** 它自己的 `## Evidence` 逐字记着实现时读到
   `total=120 / grandfathered=120`，即 `compliant=0`、`violating=0`——生效线之后**一条任务都还没有**。
   于是「生效线之后的 delivery-critical 任务均有 goal_ac」在那一刻靠**样本不存在**而成立，
   连 fixture 都不用出场。硬规则④推论三（只能被 fixture / 注入满足的判据不是测量）在这里更弱一档：
   **一个空集上的断言不是断言。**
2. **它的 AC1–AC6 全部测的是脚本，没有一条把规则接到撰写/落地面。** 于是规则只存在于**事后**：
   检测器每轮在 goal 层跑，看得见违反，却没有任何权力阻止违反发生——它是一份只读报告。
   硬规则⑨（守与不守若在记录上无法区分，就只能靠意志 ⇒ 该给它造产物）：产物造出来了，
   但造在了**违反发生之后**。2026-09-13 第一条生效线后的 delivery-critical 任务经本仓自己的立案路径
   写入、promotion-driver 机械晋升到 ready，全程没有任何一步问过 `goal_ac`。
3. **准入面这条路已被明令封死，所以落点只能是立案面。** `ready-pool-check.ts` 的准入合取里曾经有过
   `goalAcMissing` 判据，已按**人 2026-09-11 裁定**移除：「准入集合只由 task 自身的自足属性决定；
   goal 信息最多改变集合内的顺序，**永不改变成员资格**」（机械守卫
   `plugin/scripts/eligible-no-goal-source-check.ts`；`ready-pool-check.ts:2012` 与 `:2181` 两处注释
   逐字记录了这次移除与其理由——准入可以减集合到空 ⇒ 僵尸任务）。
   ⇒ **⛔ 不得把这条规则塞回晋升/准入合取**。AC-190 的标题本身就是「**新立案**任务必须声明 goal_ac」，
   落点是**立案/写入那一刻**。

### 交付什么

1. **清掉当前反例**：给 `gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak` 声明真实的
   top-level `goal_ac`。它是第三方项目 goal/adr/meta store 解析缺陷 ⇒ 属 GOAL-009 的 productization 集合；
   `AC-206`（目标项目具备 goals+tasks 双载体）是具名候选，实现者须读其 criterion 后确认或改选，
   **并把「为什么是这条 AC」写进该任务体**——⛔ 不得只填一个 id 不写理由（那会把 goal_ac 变成装饰）。
2. **把规则接到立案/写入面**：让「新立案 + 带 `delivery-critical` + `goal_ac` 空」在**写入那一刻**被拒。
   判定必须**单源复用** `long-term-guarantee-goal-backed-check.ts` 已导出的纯函数
   （`isDeliveryCritical` / `hasGoalAc`），⛔ 不复制第二份字符串判定。
   主选落点 = `plugin/scripts/precommit-guard.ts`：它已有一条对 **staged `tasks/*.md`** 的检测器先例
   （Touches「一条目一路径」，2026-08-16 立），同一位置、同一形态、同一写入时刻。
3. **双向负控制**（硬规则③b/④）：正控制 = 真仓库现存的 35 条合规任务不报；负控制 = 构造一条
   「staged 新增 + 带 `delivery-critical` + 无 `goal_ac`」的任务文件 ⇒ 判定必须拒（exit 非零）；
   反向对照 = 同一条补上 `goal_ac` ⇒ 必须放行。⛔ 不接受只有单向断言的实现。
4. **不得误伤**：生效线之前的存量（115 条无 `goal_ac`）不得被这条新判定拒；无标签的任务、
   非 `tasks/` 路径的提交、删除操作都不触发。⛔ 让一次存量红卡死所有写入者、卡住 loop，
   比没有这条判定更贵——这正是 `eligible-no-goal-source-check.ts` 立条时记下的「僵尸」教训。

<!-- dedup-ref -->
相关但机制不同的既有任务（立案时按机制查重的记录，无依赖边）：`gap-long-term-guarantee-registry-hand-maintained`（done，交付检测器本身）、`gap-ac190-long-term-guarantee-goal-backed-check`（done，交付脚本）、活着的准入面守卫 `plugin/scripts/eligible-no-goal-source-check.ts`（管「准入不得读 goal 源」，与本条的落点互补而非重叠）。

## Plan

1. 读四份正本再动手：`goals/AC-190-task-ac.md`（判据 + 2026-09-09 换形态记录）、
   `plugin/scripts/long-term-guarantee-goal-backed-check.ts`（现行位置判定、生效线、已导出的纯函数）、
   `plugin/scripts/precommit-guard.ts` 头部与其 staged `tasks/*.md` 检测器（先例形态）、
   `plugin/scripts/eligible-no-goal-source-check.ts` 头部（被封死的落点与其理由）。
2. 固定改前读数：跑 `long-term-guarantee-goal-backed-check.ts --json` 存档 `violating` 清单
   （预期 `["gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak"]`）——这是修复后的对照基线。
3. 给 `gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak` 定 `goal_ac`：读 GOAL-009 相关 AC
   （`goals/AC-19x-*.md` / `goals/AC-20x-*.md`）逐条读 criterion，选领域覆盖「目标项目自己的
   goal/adr/meta store 解析与隔离」的那一条；把选择理由写进该任务体（新增一行或写进其 Proposal）。
   ⛔ 写入走 task_write / Provider ABI，⛔ 不手改 frontmatter 文本；写完用 `quay task check <id> --json` 回读。
4. 实现写入面判定（主选 `precommit-guard.ts`，理由见 Proposal 交付项 2；单源复用 `task-schema.ts` 的
   `frontmatterLabels` / `frontmatterGoalAc` 与检测器导出的 `isDeliveryCritical` / `hasGoalAc`）：
   对 staged `tasks/*.md` 中**新增**（`--diff-filter=A`）的文件，若带 `delivery-critical` 且 `goal_ac` 空
   ⇒ 拒（exit 1，reason=`delivery-critical-without-goal-ac`，输出含文件路径 = 补救位置）。
   ⚠️ 若实现需要新建 `plugin/scripts/*.ts`，则三处注册闸（capability-catalog + outline + laydown）
   必须一并落进 `## Touches`（见 `plugin/scripts/capability-catalog.sh` 头注释）；主选落点不需要新建脚本。
5. 测试：在 `plugin/test/precommit-guard.test.mjs` 加正 / 负 / 对照三类断言——新增 + 标签 + 无 goal_ac ⇒ 拒；
   新增 + 标签 + 有 goal_ac ⇒ 放行；存量（生效线之前）+ 标签 + 无 goal_ac ⇒ 放行；
   新增 + 无标签 + 无 goal_ac ⇒ 放行。每条对照都必须**能取假**（硬规则④）。
6. 跑 `eligible-no-goal-source-check.ts` 确认仍 exit 0（未把 goal 源塞回 `ready-pool-check.ts` 的准入合取）。
7. 跑 AC-190 判据链确认 exit 0：脚本存在 → 真仓库默认运行绿 → `--inject-unbacked-fixture` 仍红；
   并在同一次提交里记下改前 / 改后两个读数（红前 `violating=[...]`、绿后 `violating=[]`）。

## Acceptance Criteria

- [ ] AC1 `node --no-warnings --experimental-strip-types plugin/scripts/long-term-guarantee-goal-backed-check.ts` exit 0；`--json` 的 `ok` 为 `true` 且 `violating` 为 `[]`
- [ ] AC2 `--inject-unbacked-fixture` 仍 exit 非零（负控制未被削弱——⛔ 不得靠放宽判据换绿）
- [ ] AC3 `tasks/gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak.md` 的 top-level `goal_ac` 非空，且该任务体里写明「为什么是这条 AC」的理由
- [ ] AC4 写入面负控制：一条「staged 新增 + `delivery-critical` + 无 `goal_ac`」的任务文件 ⇒ 判定 exit 非零；反向对照（同一条补上 `goal_ac`）⇒ exit 0
- [ ] AC5 不误伤：生效线之前的 delivery-critical 任务文件交给同一判定 ⇒ exit 0；无标签的任务、非 `tasks/` 路径不触发
- [ ] AC6 单源：写入面判定与 `long-term-guarantee-goal-backed-check.ts` 共用同一组判定函数（证据 = `hasGoalAc` / `isDeliveryCritical` 的 `import` 行，⛔ 不是第二份字符串比较）
- [ ] AC7 `plugin/scripts/eligible-no-goal-source-check.ts` exit 0（未把 goal 源塞回准入合取）
- [ ] AC8 `scripts/test.sh` 全量绿（含 AC4/AC5 的正、反、对照断言）
- [ ] AC9 `node packages/quay/bin/quay.ts task check gap-ac190-goal-ac-rule-not-enforced-at-filing --json` 的 `missing` 为 `[]`

## Definition of Done

生产工作树上同时成立两件事，缺一不算完成：

1. **AC-190 判据回到 exit 0，且不是靠放宽判据换来的**：默认运行 `violating=[]`、
   `--inject-unbacked-fixture` 仍非零；`gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak`
   真的有 top-level `goal_ac` 且有理由。
2. **规则在违反发生的那一刻起作用**：存在一条**可运行**的写入面判定，对「staged 新增 +
   `delivery-critical` + 无 `goal_ac`」真的拒写，且正 / 反 / 对照三类断言都实测过
   （⛔ 不是只加了一段散文，也不是只加了一条事后检测器）。

⛔ 只补那一条任务的 `goal_ac` 而不接写入面 ⇒ 下一次任何作者漏写就第三次复发（本 AC 已复发一次，
上一次修法落地 4 天内就被真实立案路径违反），不算完成。
⛔ 只加写入面判定而真仓库仍红，同理不算完成。
⛔ 把判定塞回 `ready-pool-check.ts` 的准入合取（`eligible`）⇒ 违反人 2026-09-11 裁定，
`eligible-no-goal-source-check.ts` 会红；这不算完成，是实现者选错了落点。

## Touches

- plugin/scripts/precommit-guard.ts
- plugin/test/precommit-guard.test.mjs
- plugin/scripts/long-term-guarantee-goal-backed-check.ts
- plugin/test/long-term-guarantee-goal-backed-check.test.mjs
- tasks/gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak.md
- tasks/gap-ac190-goal-ac-rule-not-enforced-at-filing.md
