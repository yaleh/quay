---
id: gap-ac-record-schema-duplicated-between-criterion-and-writer
title: 每条 AC 手写一个 write_acNNN_record —— 字段清单在 criterion 与产出侧各存一份，漂移即静默失败
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**本条是 GOAL-016 四条 AC 走完后的需求采集产物**（人 2026-09-12 裁定方案 B：先让四条 AC 真跑一遍，把真实执行当需求依据，完成后再立案）。**采集结论与立案当初的假设有出入，以下按实测修正，⛔ 不要照抄早先的「零机件」说法。**

**已被这四次执行解决的（⛔ 不在本任务范围）**：

```
投送      verify-deliver-coldstart.sh:48-49 逐字：scp 本脚本 + 两个 .tgz 到目标机 →
          远端以显式 --ac89 <远端临时路径> 执行 → scp 该证据文件回本地 → 追加进驱动方仓库
回收      同上；落点 ac89_append_goal009()（:770），带 BUILD_SHA 40-hex 与 AC89 路径的 fail-closed
跨机守卫  --ac250-ssh <dest>（:143）：BatchMode，且【须与判读侧是两台机器，否则 not-evaluated】
读数      脚本 4306 → 5530 行；ssh 命中 0 → 11
```

⇒ 「跨主机投送/回收零机件」这个前提**已经过期**，本任务⛔ 不重复造它。

**仍未解决的第一条（本任务主体）：记录 schema 在两处各存一份。**

字段清单同时存在于**判读侧**（AC 的 `criterion` 读什么）与**产出侧**（`write_acNNN_record` 写什么），**两处漂移即静默失败**——产出侧写 `driver_alive` 而判据读 `driverAlive` ⇒ 判据永远 exit 1，**且与「这次没跑过」完全同形**（硬规则 3b）。

这个模式**仍在增长**（实测）：

```
write_acNNN_record 函数数  9 → 11
合计行数                   约 110 → 153
  207:18  239:17  247:12  248:25  250:18
  203:8   206:17  204:10  205:6   234:11  232:11
```

**⛔ 该抽象的是 schema，不是 write_record 本身**（这一点早先判错过，已被数据推翻并记录）：11 个函数各 6–25 行，`write_ac207_record` vs `write_ac247_record` 行级相似度仅 **14%**（归一化 ACn 后 15%）——**字段集本就该各不相同**，它们不是复制粘贴。真正的问题是**同一份字段清单被写了两遍**（criterion 一遍、writer 一遍），而不是 writer 之间彼此重复。

**仍未解决的第二条（一并纳入）：回收后不自动复跑判据。**
记录被 scp 回来并追加进载体后，**没有任何逻辑复跑对应 AC 的 criterion 确认它真的翻绿**（grep「复跑/re-run criterion/rerun judge」零命中）。GOAL-009 AC-207 的执行说明逐字承认这一步「没有机制兜底，是执行者的显式义务」，并记载过实证损失：2026-09-09 orangevps 产出的 3 条记录滞留远端从未带回，本机载体里 GOAL-009 长期只有 AC-201 一条。**投送与回收已机制化之后，这一步成了链条上唯一仍靠人的环节。**

## Plan

1. **先取直接量**：打印当前 11 个 `write_acNNN_record` 的字段集，与其对应 AC 的 `criterion` 实际读取的字段集，**逐 AC 做两向差集**（⛔ 不只报数量；差集非空处即当前已存在的漂移）。
2. **定 schema 的唯一真源**：由 AC 的 `criterion` 派生产出侧字段，还是另立一份被两侧共同消费的 schema 声明——**给出选择理由**，⛔ 不要两条都做。
3. **迁移**：至少覆盖 GOAL-016 的四条 AC（247/248/249/250），证明新机制能承载**真实存在的**字段集。
4. **回收后复跑判据**：证据追加进载体后自动复跑对应 criterion，并把「复跑结果」落进记录（⛔ 不以「我拷过了」为准——GOAL-009 AC-207 执行说明第 3 条逐字要求以判据退出码为准）。
5. **负控制**：故意让产出侧少写一个判据要求的字段 ⇒ 新机制必须在**产出时**报错，⛔ 不是等到判据 exit 1 才发现（那正是当前形态）。

## Acceptance Criteria

- [ ] AC1 漂移可检出：对 11 个现有 writer 逐一做「criterion 字段集 vs writer 字段集」两向差集，打印结果；**若存在差集非空者，逐条列出**（这是本任务价值的直接读数）。
- [ ] AC2 单一真源生效：新增一条 AC 时，**无需新增产出侧手写函数**即可产出合格记录——用一条真实新 AC（或等价 fixture）走通并贴出记录原文。
- [ ] AC3 产出时 fail-closed（能取假）：故意漏写一个判据要求的字段 ⇒ 产出侧**报错且不写记录**；补齐后写入成功。两态输出贴出。⛔ 「判据 exit 1」不算满足本条——那是现状。
- [ ] AC4 回收后自动复跑：证据追加后自动复跑该 AC 的 criterion，结果（退出码）落进记录；构造一条「记录已追加但判据仍 exit 1」的情形 ⇒ 必须被报出，⛔ 不得静默视为成功。
- [ ] AC5 覆盖真实字段集：GOAL-016 的 AC-247/248/249/250 四条的字段集均可由新机制承载（逐条贴出迁移前后的记录对照）。

## Definition of Done

- 五条 AC 满足，AC1 的差集清单与 AC3/AC4 的两态输出有实际留档。
- ⛔ 不得重造投送/回收（已存在，见 Proposal 首节）。
- ⛔ 不得为满足 AC2 而把 11 个 writer 简单合并成一个巨型函数——字段集本就各不相同（相似度 14%），合并只会把差异藏进分支；要抽的是 schema 的真源，不是函数体。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac-record-schema-duplicated-between-criterion-and-writer.md
