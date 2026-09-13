---
id: gap-ac-record-choke-point-naming-dedup-ac238-bypass
title: ac89_append_goal009 命名脱离职责、与 ac_record_append_fragment 重复入口、AC-238 绕过
  choke point —— 三合一整改
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**背景**：`gap-ac-record-schema-duplicated-between-criterion-and-writer`（已 done）给 `plugin/scripts/verify-deliver-coldstart.sh` 建了一套「AC 记录字段单一真源 + 写入时 fail-closed + 落账后自动复跑判据」的机制，`ac89_append_goal009`（`:814`）与 `ac_record_append_fragment`（`:5832`）是这套机制仅有的两个写入 choke point。本任务是对该机制的一次后续整改，发现于对其设计的复盘讨论，不是新机制，是消除已发现的重复/命名/覆盖缺口。

**症状（机械可复算，三条独立缺陷，同一片代码，合并一起改）**：

1. **AC-238 的证据记录完全绕开了这套 choke point**。`plugin/scripts/verify-deliver-coldstart.sh:1435-1443`（`step_upgrade_existing()` 函数体内）用裸 `printf ... >> "$AC89"` 直接落盘，既不经过 `ac89_append_goal009` 也不经过 `ac_record_append_fragment`。后果：AC-238 不在 `AC_RECORD_SCHEMA` 登记（现有 13 行没有它）；`--ac-record-schema-report` 对它完全不可见（不是"unregistered"分类报出来的那种可见缺口，是报告的扫描方式压根找不到这种写法，连"漏了一条"都不知道）；落盘后不会触发 `ac_record_finalize` 自动复跑判据。`goals/AC-238-*.md` 是真实存在、有自己 criterion 的一条 AC，不是"这套机制不适用"的情况，是被漏掉了。

   复现入口：`bash plugin/scripts/verify-deliver-coldstart.sh --ac-record-schema-report 2>&1 | grep -c 238` → 0（该出现却没出现）。

2. **入口层有两个高度重复的函数**：`ac89_append_goal009`（`:814`）与 `ac_record_append_fragment`（`:5832`）执行几乎相同的五步（校验 → 核对载体路径 → 反推 ac → mkdir → 写一行 JSON → 复跑判据），只在三点上不同——是否强校验 `BUILD_SHA` 为 40-hex、是否自动包一层 `build_sha`/`ts`、载体路径默认取全局 `$AC89` 还是显式传参。9 条 AC 走前者、4 条（AC-201/204/206/234）走后者，区分理由真实存在，但目前是靠"两个函数名"表达，不是"一个函数、几个参数"。

   复现入口：对比两函数体（`:814-829` vs `:5832-5841`），逐行标出重叠段与差异段。

3. **`ac89_append_goal009` 的命名与其实际职责不符**。它自己的注释（`:816-818`）写明"本函数是【所有】GOAL-009/015/016 载体记录的写入 choke point"，但函数名里的 `ac89`/`goal009` 是历史遗留（来自更早的 `gap-ac89-productization-verification-record`），与它现在跨三个 GOAL 的实际作用域不符；而与它协作的其它函数（`ac_record_schema_validate_fragment`/`ac_record_finalize`/`ac_record_append_fragment`/`ac_record_schema_report`）都已统一用 `ac_record_*` 前缀，它是这个家族里唯一没跟上的成员。

   复现入口：`grep -n '^ac_record_\|^ac89_append_goal009' plugin/scripts/verify-deliver-coldstart.sh` 逐一读函数名，对比命名家族一致性。

**为什么合并成一个任务**：三条缺陷改的是同一片代码（`ac89_append_goal009` 定义处 + 它的调用点 + AC-238 写入点），分开改要扫两遍同一个 6654 行文件；且第 1 条（AC-238 补齐）天然需要"选一个入口函数接进去"，正好用第 2/3 条合并后的新函数名去接，一次性做完。

**为什么不是"再造一层抽象"**：入口层的抽象（校验+复跑 choke point）已经存在且工作正常（`gap-ac-record-schema-duplicated-between-criterion-and-writer` 已验证 13 条 AC 0 硬差集）；本任务要做的是消除两个入口函数间的真实重复、把历史命名跟上已有的家族约定、以及把一个被漏掉的写入点接进这套已有机制——不是设计新东西。

<!-- dedup-ref -->
**相关但不重复**：`gap-ac-record-schema-duplicated-between-criterion-and-writer`（已 done）建立了本任务依赖的 schema/choke point 机制本身；本任务不重做它，只整改其入口层的命名/重复/覆盖缺口。

⛔ 不在本任务范围：12 个 `write_acNNN_record` 手写函数之间的重复——已被上述任务用数据证明是假重复（14–15% 相似度，字段集本就不同），不要重提；投送（scp）侧的 sibling-enumeration 隐患——那是另一个独立缺口，不在本任务。

## Plan

1. 把 `ac89_append_goal009` 的行为（强校验 BUILD_SHA 40-hex + 自动包 build_sha/ts 锚点）折成 `ac_record_append_fragment` 的一个参数/开关，消灭两者的重叠控制流；新函数并入 `ac_record_*` 命名家族（具体命名由实现者定，硬要求是消除重复且统一前缀）。
2. 全文件替换全部 `ac89_append_goal009` 调用点（含注释里的提及）指向新入口；`write_ac_record` 不动（它已经是薄封装，只改它内部转调的目标名）。
3. 把 AC-238 的写入点（`step_upgrade_existing()` 内 `:1435-1443` 的裸 `printf >> "$AC89"`）改走新入口函数；在 `AC_RECORD_SCHEMA` 里补一行 `GOAL-009-AC-238` 的字段声明（字段数与现有 printf 字段一一对应，含 `binding`/`retired_runtime_backup`/`retired_backup_matches_pre` 等历史双语义字段——照抄现有 printf 里的字段清单，⛔ 不要精简掉任何一个，那几个字段各自有独立存在理由，见 `:1427-1434` 注释）。
4. 验证 `--ac-record-schema-report` 现在能看到 AC-238（从"完全不可见"变成"已登记、ok"）。
5. 负控制：故意让 AC-238 少写一个 schema 声明要求的字段 ⇒ 新入口必须 fail-closed 拒写（复用现有 `ac_record_schema_validate_fragment` 的既有能力，不必新写校验逻辑）。
6. 项目自身闸门（scoped 门 + 全量套件绿）。

## Acceptance Criteria

- [ ] AC1 入口去重：`ac89_append_goal009` 与 `ac_record_append_fragment` 的重叠控制流（校验/核对载体/反推 ac/mkdir/写入/复跑五步）合并为一套实现，两种模式（强校验 BUILD_SHA+自动锚点 vs 不强校验+调用方自带字段）用参数表达，⛔ 不是两个函数体。改动前后：全部 13 条既有 AC 的落盘记录逐字节不变（md5 对照，仿照前一任务 AC5 的做法）。
- [ ] AC2 命名统一：全文件不再存在 `ac89_append_goal009` 这个名字（`grep -c ac89_append_goal009 plugin/scripts/verify-deliver-coldstart.sh` = 0，含注释），新入口函数名以 `ac_record_` 前缀命名。
- [ ] AC3 AC-238 接入 choke point：`AC_RECORD_SCHEMA` 新增 `GOAL-009-AC-238` 一行（字段数与现有 printf 字段一一对应）；`step_upgrade_existing()` 内的写入改走新入口函数，⛔ 不再有裸 `printf >> "$AC89"`；`--ac-record-schema-report` 输出包含 `GOAL-009-AC-238`，显示 `criterion=N schema=N writer=N` 且 `[ok]`（N 为实测字段数，不预先断言具体值）。
- [ ] AC4 AC-238 fail-closed 可取假：故意在新入口调用点漏传一个 schema 声明要求的字段 ⇒ 拒写且不落盘（exit 非 0，报出缺哪个字段）；补齐后写入成功。两态输出留档。
- [ ] AC5 既有 13 条 AC 不受影响：合并/改名之后重跑 `--ac-record-schema-report`，14 条 AC（13+新增的 238）全部 `[ok]`（或既有的那 1 条 `[surplus]` 维持原样，不新增硬差集）。

## Definition of Done

- 五条 AC 满足，且 AC1 的逐字节对照、AC4 的两态输出有实际留档。
- ⛔ 不得触碰 12 个 `write_acNNN_record` 手写函数本身（那不是本任务范围，已被前一任务证伪重复）。
- ⛔ 不得改变现有 13 条 AC 的记录字段/语义，只改它们经由哪个函数落盘。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac-record-choke-point-naming-dedup-ac238-bypass.md
