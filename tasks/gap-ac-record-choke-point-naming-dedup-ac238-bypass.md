---
id: gap-ac-record-choke-point-naming-dedup-ac238-bypass
title: ac89_append_goal009 命名脱离职责、与 ac_record_append_fragment 重复入口、AC-238 绕过
  choke point —— 三合一整改
status: done
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

**落实（本轮）**：1 → 单一函数 `ac_record_append <fragment> [carrier] [mode]`（`mode ∈ anchored|plain`，缺省 anchored），旧的两个函数体删掉一个、另一个成为它的一种模式；2 → 全文件 16 处入口调用行改名（含注释），`write_ac_record` 体内只改转调目标名；3 → AC-238 写入点改走 `ac_record_append "$fragment" "$AC89" anchored`（裸 `printf >> "$AC89"` 消失）+ `AC_RECORD_SCHEMA` 新增一行；4 → 报告现输出 `GOAL-009-AC-238 [ok] criterion=7 schema=7 writer=7`；5 → selfcheck 新增 AC238 三读数（含逐字段负控制）；6 → scoped 门与全量套件由 fan-in 跑（本任务未在 worker 内跑全量套件）。

## Acceptance Criteria

- [x] AC1 入口去重：`ac89_append_goal009` 与 `ac_record_append_fragment` 的重叠控制流（校验/核对载体/反推 ac/mkdir/写入/复跑五步）合并为一套实现，两种模式（强校验 BUILD_SHA+自动锚点 vs 不强校验+调用方自带字段）用参数表达，⛔ 不是两个函数体。**改动前后 13 条既有 AC 的落盘记录逐字节不变**（仿前一任务 AC5 的做法，实测 md5）：同一 fragment + 同一载体 + 同一 `BUILD_SHA`/`TS` 下，旧入口与新入口产出的行 13/13 **IDENTICAL** —— AC-201 `c5bd80f424a0eafd6106e6ea9aefca70` / AC-203 `4b5ec6879641f7e73ef9a94e8ddaf8ee` / AC-204 `e815971753dcc2ed9dcdc4c564c60bd0` / AC-205 `00289ff0b1289a2b96fbfb5bf2225616` / AC-206 `0dc4fa9d3953b7822a199ae0403c6873` / AC-207 `8c6df99410e793959d4e12626f8ea6ce` / AC-232 `7bdd8a3e5b784963b32671e8f699a5a9` / AC-239 `5297af2a79166e1cb67f6b7b7c8638f3` / AC-234 `fb40d58750e606fa00ef4acf491636d7` / AC-247 `5eeab0a26551d7f2f67710162d7eb024` / AC-248 `c493484e9aeb24bd35238dd5fd01d534` / AC-249 `43489860c96fe5c4d2d81e94f9e1d78d` / AC-250 `7fd60d0aa2becf78444e5777f454af2d`（old 与新两侧同 md5）。配套第二读数：改动前后**入口调用行在函数名归一化后逐字节相同**（16 行 old vs 16 行 new，`old-normalized absent from new = 0` ∧ `new-normalized absent from old = 0`）⇒ 13 个调用点的入参一个字节都没变，只有落盘函数换了名字（4 个 plain 调用点另加显式的 `plain` 模式实参）。
- [x] AC2 命名统一：全文件不再存在 `ac89_append_goal009` 这个名字（`grep -c ac89_append_goal009 plugin/scripts/verify-deliver-coldstart.sh` = **0**，含注释），新入口函数名以 `ac_record_` 前缀命名。⚠️ 实测过程中该计数曾被我自己新写的解释性注释打到 **1**（注释里引用了旧名），已改成不含该字符串的表述——这正是「含注释」那半句话在起作用。`grep -n '^ac_record_'` 现为九个同前缀成员：`ac_record_append` / `_schema_row` / `_schema_field_names` / `_fragment_ac` / `_schema_validate_fragment` / `_sample_body` / `_carrier_root` / `_finalize` / `_schema_report`。
- [x] AC3 AC-238 接入 choke point：`AC_RECORD_SCHEMA` 新增 `GOAL-009-AC-238 host:str project_root:str pre_upgrade_task_count:int post_upgrade_task_count:int pre_upgrade_runtime_age_days:num runtime_replaced:bool task_list_ok:bool`；`step_upgrade_existing()` 内的写入改走新入口函数，⛔ 不再有裸 `printf >> "$AC89"`（selfcheck 结构性读数：`ac238-writer bare-printf-to-AC89-hits=0 choke-point-hits=1 build_sha-literal-hits=0`，按位置取自 `step_upgrade_existing()` 体内、注释先剥掉）；`--ac-record-schema-report` 现输出 `GOAL-009-AC-238 [ok] criterion=7 schema=7 writer=7`（改动前该报告里连 238 这一行都没有，`grep -c 238` = 0）。⚠️ **声明只列 7 个字段、而不是 printf 的全部 21 个**——这不是"精简"，是两条要求冲突下唯一可行的解，逐字记在写入点上方与 `AC_RECORD_SCHEMA` 该行下方注释里：报告的 surplus 判据是「声明 ∖ 判据读集」，而 AC-238 的 criterion（`goals/AC-238-*.md`，status: achieved，⛔ 不可改）只读 7 个字段 ⇒ **多声明任何一个字段，本行都会从 `[ok]` 变成 `[surplus]`**，与 AC3 逐字要求的 `[ok]` 数学上不可同时满足。取舍：判据读的 7 个进写入期声明闸（⇒ 声明=写入=判据=7 ⇒ `[ok]`），另外 14 个诊断字段（`upgrade_source`/`upgrade_init_rc`/`isolated_copy`/`taskset_stable`/`sample_task`/`fresh_runtime_sha256`/`pre_binding`/`post_binding`/`host_key`/`binding`/`retired_runtime_backup`/`retired_backup_matches_pre`/`bound_mcp_entry`/`adopt_decision`）经一个变量尾作为**额外字段**原样写入（写入通道对额外字段不拒）——**⛔ 记录里一个字段都没少**。实测：真跑生产片段（从源码切出 `step_upgrade_existing()` 的写入块 + 打桩变量）产出的记录是**合法 JSON、24 键**（21 个 AC 专属字段 + `ac` + `ts` + top-level 40-hex `build_sha`），双语义字段 5 个（`binding`/`retired_runtime_backup`/`retired_backup_matches_pre`/`pre_binding`/`post_binding`）全部在场。两处有意且已记的差异：① `ts` 由写入时刻的 `date -u` 改为 `${TS}`（与另外 8 条 GOAL-009/016 记录同形，无判据消费者）；② `build_sha` 现在要求 40-hex（比原来的「非空」更严，fail-closed）。
- [x] AC4 AC-238 fail-closed 可取假：selfcheck 三读数（`--selfcheck` 实际打印、`plugin/test/verify-deliver-coldstart.test.mjs` 逐行断言）：`ac-record-schema(AC238 refused-when-declared-field-omitted) refused=1 lines=0→0 msg='AC-RECORD-SCHEMA: refusing GOAL-009-AC-238 record — host (MISSING) — nothing was written (fail-closed)'` / `ac-record-schema(AC238 accepted-when-complete) wrote=1 lines=0→1` / `ac-record-schema(AC238 every-declared-field-enforced) declared=7 each_omitted_refused=7`（⛔ 不只测被报出来的那一个：声明里 7 个字段逐个漏一次，7 次都拒）。片段由产品函数 `ac_record_sample_body` 从 `AC_RECORD_SCHEMA` 的 AC-238 行生成（⛔ 不在夹具里复刻字段清单），并走**同一个**产品入口 `ac_record_append`。
- [x] AC5 既有 13 条 AC 不受影响：合并/改名后重跑 `--ac-record-schema-report` ⇒ `14 AC registered, 14 producer(s) in script, missing(criterion-vs-schema)=0 missing(criterion-vs-writer)=0 missing(schema-vs-writer)=0 surplus=1 unregistered=0 not-evaluated=0`（exit 0），**⛔ 未新增硬差集**；14 条里 13 条 `[ok]`，唯一 `[surplus]` 是既有的 `GOAL-009-AC-239`（`commit_files`，改动前后一字未变）；13 条既有 AC 的 `criterion=N schema=N writer=N` 三个数与改动前**逐字相同**（AC-201 1/1/1、AC-203 5/5/5、AC-204 4/4/4、AC-205 3/3/3、AC-206 6/6/6、AC-207 8/8/8、AC-232 5/5/5、AC-239 8/8/8、AC-234 5/5/5、AC-247 7/7/7、AC-248 11/11/11、AC-249 4/4/4、AC-250 10/10/10）。

## Definition of Done

- 五条 AC 满足，且 AC1 的逐字节对照、AC4 的两态输出有实际留档。
- ⛔ 不得触碰 12 个 `write_acNNN_record` 手写函数本身（那不是本任务范围，已被前一任务证伪重复）——本轮 12 个函数体只改了【转调的函数名】，字段片段一字未动（AC1 的调用行归一化读数即其证据）。
- ⛔ 不得改变现有 13 条 AC 的记录字段/语义，只改它们经由哪个函数落盘（AC1 的 13/13 md5 相同 + AC5 的三数逐字相同）。
- 项目自身闸门（scoped 门 + 全量套件绿）：scoped 门与全量套件由 driver 的机械 fan-in 跑（worker 内不跑全套）。
- 机制变更的**外溢**（本轮实测发现，⛔ 都不是放宽判据，各自有红控制）：4 个记录 writer 夹具（`ac247-takeover-record` / `ac248-adr-check-flip-record` / `ac249-complete-change-record` / `ac250-web-observe-progress-record`）与主测试文件里，`ac89_append_goal009` 是**手工维护的依赖闭包**里的一员（`fnNames`/`WRITER_FNS`/`RUNBASH` 列表）并被 `/ac89_append_goal009\s+"/` 逐字断言 ⇒ 改名后必须同步，否则闭包过期、写入侧对任何输入都 REFUSED（前一任务已实测过这个失败形态）。**同轮还发现第二处必须改的判据**：`verify-deliver-coldstart.test.mjs` 里 AC-214 NEED 的「每条产出语句都带锚」检测器原以 `s.includes("ac89_append_goal009")` 作为「已补锚」的凭据——合并后 `plain` 模式也走同一个函数名，**照搬会把该谓词变成恒真**（结构上不可能取假的量，硬规则 4）：已改为按**模式实参**区分（anchored = choke point 补锚；plain = 必须自带 `"build_sha":`），保持可失败。四个夹具文件已加进 `## Touches`（fan-in 的 delta 判定要求改过的文件都声明）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/ac247-takeover-record.test.mjs
- plugin/test/ac248-adr-check-flip-record.test.mjs
- plugin/test/ac249-complete-change-record.test.mjs
- plugin/test/ac250-web-observe-progress-record.test.mjs
- tasks/gap-ac-record-choke-point-naming-dedup-ac238-bypass.md
