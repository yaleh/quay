---
id: gap-suite-bash-lpt-forwarder-dead-on-default-path
title: bash LPT 转发器在默认路径上是死代码（≈5.4s/轮无用功）：Phase 1 搬进 legacy 分支（行为等价）；Phase 2
  彻底退役需人裁定撤掉 QUAY_SUITE_SCHEDULER=0
status: ready
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-281
---
**type:** execution

## Proposal

**缺口（实测，⛔ 非估算）**：`scripts/test.sh` 里的 bash LPT 转发器 `lpt_order_files`（`:1008`）在**默认路径**上
是**可证的死代码**——它排好的产物**没有任何读者**。

**证据（逐行核过，不是推断）**：
- `serial_files` / `lowconc_files` 在 `:1145` / `:1155` 建、`:1162` / `:1163` 被 LPT，
  而 `:1176–:1209` 的**调度器分支读的是裸的 `${_RG_FILES[@]}`**（`:1181`）并在 `:1208` `exit`
  ⇒ 这两个数组的结果**在默认路径上无人读**。
- bucket 路径同理：`:1707` / `:1708` 排出来的结果只被 `:1736` / `:1746`（legacy fall-through）读。
- **关键结构**：那两个 `if [ "${QUAY_SUITE_SCHEDULER:-1}" = "1" ]`（`:1176` / `:1713`）**没有 `else`**——
  legacy 代码是 `fi` **之后**的 fall-through，所以 **`:1176` 之前的行两条路径都会跑**。

**代价（实测）**：`suite-lpt-order.ts` 每次调用要读 86 MB 的 `.quay/verification-round.jsonl` ⇒
**2.62 s/次**；每轮**浪费 2 次 spawn ≈ 5.2 s**，外加 2 次 `runner-grouping.ts --select`（各 ~0.17 s）
⇒ **≈5.4 s/轮**。

⚠️ **对 AC-281 的记账要说清**：这 5.4 s 发生在**调度器启动之前**，而 `scheduler_ms` 是
`suite-scheduler.ts` **自己量自己**（`:407`）⇒ **它进 job 墙钟，不进 `scheduler_ms`**。
⇒ 本任务对 GOAL-022 的 `job` 面有直接贡献，⛔ 但不要写成"它能把 AC-281 的 8.7 s 补上"。

### 阶段划分（Phase 1 可直接做；Phase 2 需人裁定）

**Phase 1（本任务的交付物，行为等价，无需裁定）**：把默认路径上**无人读取**的那几行搬进 legacy 分支
（`:1162`/`:1163`/`:1657`/`:1707`/`:1708`），并在搬移后补上 legacy bucket 路径原本靠"继承预排序的 `files`"
获得、搬移后会丢掉的 `lpt_order_files bucket_main_files`。⇒ **两条路径的文件集与顺序语义都不变**，只是不再
在默认路径上做无用功。顺带：`:1702` 的 `runner-grouping.ts --classify` 在默认 bucket 路径上同样是死代码
（调度器自己在 `suite-scheduler.ts:246` 分类）。

**Phase 2（⛔ 本任务不做；需人裁定 + 一个前置读数）**：彻底删除 `lpt_order_files()`（`:1008-1017`）与
`QUAY_SUITE_SCHEDULER=0` 这条 legacy 兜底。**阻塞在"要不要撤掉这张网"这个人的裁定**，以及：
- **它从未被用过的证据（已测）**：≥ 2026-09-01 的 **42 份** `.quay/fan-in-suite-*.log` 里，
  **0 份**含 legacy 独有标记（`overlap: running N serial` / `__OVERHEAD__ overlap_serial_ms`）；
  37/42 含 `scheduler: unified group-budget scheduler`；**任何日志里最新的 legacy 标记是 2026-08-31**
  （默认翻转当天）。
- **回滚键是冗余的**：`QUAY_TEST_LPT_ORDER=0` **在完整退役后仍然有效**（默认路径的开关在调度器里，
  `suite-scheduler.ts:520`），所以转发器自己的同名回滚键不提供独有安全价值。
- **真正会丢的**：`QUAY_SUITE_SCHEDULER=0` 本身——**调度器里没有任何开关能回到 phased 模型**；
  若需要调度器侧回滚，那是**新增工作**，不在本任务内。

## Plan

1. **先取一次对照基线（⛔ 改前必取，否则事后无法自证"行为等价"）**：
   - 默认路径：`bash scripts/test.sh 2>&1 | grep -m1 "scheduler: serial="` ⇒ 记下原文
     （该行含 `serial=N≤… lowconc=N≤… main=N≤…`）；
   - legacy 路径：`QUAY_SUITE_SCHEDULER=0 bash scripts/test.sh 2>&1 | grep -E "selected [0-9]+ files \(groups=(serial|lowconc)\)"`
     ⇒ 记下两个计数。
   两条读数都要写进任务体（这是 AC2/AC3 的对照臂）。
2. **Phase 1 搬移**：删 `:1145`/`:1155`/`:1162`/`:1163`/`:1657`/`:1707`/`:1708`；
   在 `:1216` 之后（full，`…` 于 `:1223` 之前）与 `:1732` 之后（bucket）重新插入等价的 select + LPT，
   并在 bucket 一侧补 `lpt_order_files bucket_main_files`。
   ⛔ **`_RG_FILES` 不要动**——它在 `:1067` 无条件填充（经 `build_deduped_files`，`:863-893`），
   每次 `run_selected` 都跑，`:1181` 依赖它。
3. **逐个核对钉住这些文本位置的测试**（它们断言的是**源码里的位置**，搬错只有它们会红）：
   `plugin/test/test-phases-order.test.mjs`、`plugin/test/suite-lpt-order.test.mjs`、
   `plugin/test/suite-bucket-load-sensitive-isolation.test.mjs`、
   `plugin/test/runner-grouping-serial-anti-stomp.test.mjs`。按需同步。
4. **A/B 自证（Phase 1 不能靠单测证明，必须跑两条路径对读数）**：重跑第 1 步的两条命令，
   与基线**逐字对照**。
5. **记录 Phase 2 的入口条件**（⛔ 不执行）：把"42 份日志 0 命中 + 最新 legacy 标记 2026-08-31"这条前置
   写进任务体，供将来那条裁定任务引用。

## AC

- [ ] **AC1（默认路径上不再有死代码）**：`grep -n "lpt_order_files" scripts/test.sh` ⇒
      **每一条命中都位于 legacy 标记行之后**（`# LEGACY PHASED PATH` / `# LEGACY PHASED BUCKET PATH`），
      即 `:1176` / `:1713` 之前不再有任何调用。
      **负对照**：`grep -c "lpt_order_files" scripts/test.sh` ⇒ **非零**（Phase 1 不删 helper；
      这里读到 0 说明误做了 Phase 2）。
- [ ] **AC2（默认路径读数逐字不变）**：改后 `bash scripts/test.sh 2>&1 | grep -m1 "scheduler: serial="`
      与**改前**记录的那行**逐字相同**（改前读数贴在任务体里）。
- [ ] **AC3（两条路径的文件集一致——这是"搬移仍喂 legacy"的证伪臂）**：
      `QUAY_SUITE_SCHEDULER=0 bash scripts/test.sh 2>&1 | grep -E "selected [0-9]+ files \(groups=(serial|lowconc)\)"`
      的两个计数，与默认路径 `scheduler: serial=` 行里的 `serial=` / `lowconc=` **相等**。
      ⛔ 不等 ⇒ 搬移改变了 legacy 的输入集，回滚。
- [ ] **AC4（legacy 的顺序语义没丢）**：`grep -c "lpt_order_files bucket_main_files" scripts/test.sh` ⇒ **≥1**
      （搬移后 legacy bucket 的 main 组若没有这一步，会**静默失去 LPT**）；
      且在 `QUAY_SUITE_SCHEDULER=0` 的一次运行里日志含 `__OVERHEAD__ overlap_serial_ms=`。
- [ ] **AC5（钉住位置的四个测试全绿）**：
      `bash scripts/test.sh plugin/test/suite-lpt-order.test.mjs plugin/test/test-phases-order.test.mjs plugin/test/suite-bucket-load-sensitive-isolation.test.mjs plugin/test/runner-grouping-serial-anti-stomp.test.mjs`
      ⇒ `0 fail`（贴出每个文件的 `ℹ fail 0` 行）。
- [ ] **AC6（Phase-2 闸，⛔ 本任务不得勾）**：把 Phase 2 的前置读数**记进任务体**（42 份日志 0 命中、
      最新 legacy 标记 2026-08-31、`QUAY_TEST_LPT_ORDER=0` 退役后仍有效），并明确
      **本任务不执行 Phase 2**。⛔ 若本条被勾成"已完成"，说明越界做了未经裁定的删除。

## DoD

**REAL LANDING**：不是"删掉几行看着更干净"，而是**默认路径少做 ≈5.4 s 无用功，且两条路径的读数逐字未变**：

1. **落地对象**：AC2 的改前/改后同一行逐字对照 + AC3 的两路径计数相等。
2. **可被打红**：AC3 的 A/B（不等即回滚）+ AC1 的负对照（读到 0 即误删）。
3. **不许越界**：AC6 —— Phase 2 的文件一个都没动（`git diff` 里不出现 `suite-params.ts` /
   `suite-lpt-runner.mjs` / legacy 主体）。
4. **记账正确**：任务体里写明这 5.4 s **不进 `scheduler_ms`**（它进 job 墙钟）——⛔ 不得写成对 AC-281 的贡献。

## Touches

- scripts/test.sh
- plugin/test/test-phases-order.test.mjs
- plugin/test/suite-lpt-order.test.mjs
- plugin/test/suite-bucket-load-sensitive-isolation.test.mjs
- plugin/test/runner-grouping-serial-anti-stomp.test.mjs
- tasks/gap-suite-bash-lpt-forwarder-dead-on-default-path.md
