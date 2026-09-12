---
id: gap-ac-record-schema-duplicated-between-criterion-and-writer
title: 每条 AC 手写一个 write_acNNN_record —— 字段清单在 criterion 与产出侧各存一份，漂移即静默失败
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

**实施结论（本轮）**：

- **单一真源 = `AC_RECORD_SCHEMA`**（脚本内的一份声明表，一行一条 AC）：选它而不是「从 criterion 反推产出侧字段」，理由三条——① criterion 是 shell 包 python heredoc，且一个程序常同时读【多个 AC】的记录（实测 AC-239 的 criterion 同时读 AC-238 与 AC-239，字段按 `r.get("ac")!=…` 守卫分段），反推会把判据里每一次 `r.get`（含探测性读）都升格成硬要求；② 脚本会被 scp 到目标机执行，目标机上没有本仓库的 `goals/` ⇒ 生产期校验不能依赖解析 criterion；③ **criterion 仍是 oracle**——声明与它的一致性由 `--ac-record-schema-report` 机械核对（三侧两向差集），所以是「criterion 是判据、声明是被判据校验的产物侧真源」，⛔ 不是两份并列的真源。
- **落点**：`ac89_append_goal009`（9 个 writer 的既有 choke point）+ `ac_record_append_fragment`（3 个自补 ts 的 printf 形 writer 与 `append_ac201_record`）在落盘前按声明校验。⛔ writer 函数体一行未改（AC-247/248/249/250 逐字节对照见 AC5）。
- **实测读数（`--ac-record-schema-report`）**：13 条 AC（12 个 `write_acNNN_record` + `append_ac201_record`；Proposal 里的「11」已过期）——**硬差集 0**（判据读/声明缺 0、判据读/writer 不写 0、声明有/writer 不写 0），**多余字段 1**：`GOAL-009-AC-239` 的 `commit_files`（writer 写、判据不读，记录在案，⛔ 不是硬缺陷）。
- ⚠️ **报告第一版漏比了 criterion↔schema 这一对**，导致 AC1 的可失败控制在它上面取不到假（删掉一个判据在读的字段，报告仍打印 ok）。这是本任务自己的「一个恒绿的检查」实例，已在实现中修正并留了红控制。

## Plan

1. **先取直接量**：打印当前 writer 的字段集，与其对应 AC 的 `criterion` 实际读取的字段集，**逐 AC 做两向差集**（⛔ 不只报数量；差集非空处即当前已存在的漂移）。
2. **定 schema 的唯一真源**：由 AC 的 `criterion` 派生产出侧字段，还是另立一份被两侧共同消费的 schema 声明——**给出选择理由**，⛔ 不要两条都做。
3. **迁移**：至少覆盖 GOAL-016 的四条 AC（247/248/249/250），证明新机制能承载**真实存在的**字段集。
4. **回收后复跑判据**：证据追加进载体后自动复跑对应 criterion，并把「复跑结果」落进记录（⛔ 不以「我拷过了」为准——GOAL-009 AC-207 执行说明第 3 条逐字要求以判据退出码为准）。
5. **负控制**：故意让产出侧少写一个判据要求的字段 ⇒ 新机制必须在**产出时**报错，⛔ 不是等到判据 exit 1 才发现（那正是当前形态）。

**落实**：1 → `ac_record_schema_report`（criterion 侧 yaml.safe_load + AST，按 `r.get("ac")!=…` 守卫分段；writer 侧只取函数体内落盘那一行）；2 → `AC_RECORD_SCHEMA` 声明表（理由见 Proposal）；3 → 13 条 AC 全部登记，四条 GOAL-016 逐条贴出对照；4 → `ac_record_finalize` 在落盘后复跑并把退出码以 `<ac>#criterion-rerun` 落账；5 → `ac_record_schema_validate_fragment` 在写入通道上 fail-closed。

## Acceptance Criteria

- [x] AC1 漂移可检出：对 13 个现有 writer（12 个 `write_acNNN_record` + `append_ac201_record`；Proposal 里的「11」已过期）逐一做「criterion 字段集 vs writer 字段集」两向差集，打印结果；**若存在差集非空者，逐条列出**。实测读数：`AC-RECORD-SCHEMA-REPORT: 13 AC registered, 13 producer(s) in script, missing(criterion-vs-schema)=0 missing(criterion-vs-writer)=0 missing(schema-vs-writer)=0 surplus=1 unregistered=0 not-evaluated=0`（exit 0）；唯一非空差集逐条列出：`GOAL-009-AC-239 [surplus] · 声明/实写有、判据不读（多余字段，记录在案，⛔ 不是硬缺陷）: ['commit_files']`。**可失败控制**（selfcheck ⑨c）：删掉一个判据在读的字段（AC-247 的 `carrier_records`）⇒ `rc=1 drift-line=1 names-field=1`；整行删掉 ⇒ `rc=1 unregistered=1`（按行驱动的报告否则会打印全绿）。⛔ 实现中实测过一次「恒绿」：报告第一版漏比 criterion↔schema 这一对，红控制取不到假，已修正。
- [x] AC2 单一真源生效：新增一条 AC 时，**无需新增产出侧手写函数**即可产出合格记录。走通并贴出记录原文（等价 fixture，AC 逐字允许）：只加一行声明 `GOAL-016-AC-999 host:str project_root:str made_by:str` + 调通用 `write_ac_record`，产出 `{"build_sha":"0123456789abcdef0123456789abcdef01234567","ts":"2026-09-12T00:00:00Z","ac":"GOAL-016-AC-999","host":"hostB-fake","project_root":"/tmp/p","made_by":"write_ac_record"}`，**本组未新增任何 `write_acNNN_record` 函数**（selfcheck 行 `ac-record-schema(AC2 new-ac, no new writer fn) wrote=1`）。未登记的 AC 会被拒（`refused=1`）⇒ 「加一行声明」是新增 AC 的必经动作。
- [x] AC3 产出时 fail-closed（能取假）：故意漏写一个判据要求的字段 ⇒ 产出侧**报错且不写记录**；补齐后写入成功。两态输出：`ac-record-schema(AC3 missing-field) refused=1 lines=0→0` / `ac-record-schema(AC3 complete) accepted=1 lines=0→1`；报错点名缺件：`AC-RECORD-SCHEMA: refusing GOAL-016-AC-249 record — host (MISSING) — nothing was written (fail-closed)`。⛔ 本条不是「判据 exit 1」——那是现状；本条发生在**产出时**且零新增行。
- [x] AC4 回收后自动复跑：证据追加后自动复跑该 AC 的 criterion，结果（退出码）落进记录；构造一条「记录已追加但判据仍 exit 1」的情形 ⇒ 必须被报出，⛔ 不得静默视为成功。两态：`ac-record-rerun(after-append, criterion-green) wrote=1 rerun_rc=0 loud=0 rerun_records=1` / `ac-record-rerun(appended-but-criterion-red) wrote=1 rerun_rc=1 loud=1 rerun_records=1`，后者 stderr 落 `AC-RECORD-RERUN-FAILED: ac=… 的记录已追加，但复跑其 criterion 仍 exit 1`。退出码以 `<ac>#criterion-rerun` 为 ac 独立落账。⛔ rerun rc 不并入写入通道返回值（把「写了但判据不服」与「根本没写」压成同一种输出，正是本任务要消灭的形态）；判据方读 `AC_RECORD_RERUN_RC`（0/非 0/`not-evaluated` 三态可分）。
- [x] AC5 覆盖真实字段集：GOAL-016 的 AC-247/248/249/250 四条的字段集均可由新机制承载。**迁移前后对照**：四条 writer 函数体**逐字节未改**（md5 对照：AC-247 `f41594ced08f` / AC-248 `2d57931049b4` / AC-249 `7f0cae27a4cd` / AC-250 `cda236f1551e` 前后相同）⇒ 落盘记录逐字节不变；三侧字段数逐条相符（`criterion=7 schema=7 writer=7` / `11/11/11` / `4/4/4` / `10/10/10`）；声明里**每个字段都在写入期被逐个强制**：`ac-record-schema(AC5 GOAL-016-AC-247) declared=7 accepted=1 omitted('host')_refused=yes`（248: 11 / 249: 4 / 250: 10，同形）。

## Definition of Done

- 五条 AC 满足，AC1 的差集清单与 AC3/AC4 的两态输出有实际留档（落点：`--ac-record-schema-report` 输出 + `--selfcheck` 的 ⑨c 组读数，二者均被 `plugin/test/verify-deliver-coldstart.test.mjs` 逐行断言，可复现）。
- ⛔ 不得重造投送/回收（已存在）——本轮未触碰 `verify-deliver-coldstart.sh` 的投送/回收段。
- ⛔ 不得把 12 个 writer 简单合并成一个巨型函数——`write_acNNN_record` 12 个全部保留（`grep -c` 前后同为 12），只新增了声明表 + 通用产出通道 + 校验/复跑；要抽的 schema 真源已抽出。
- 项目自身闸门（scoped 门 + 全量套件绿）：scoped 门已跑绿（**41/41**，`--for-task … --allow-thin`，exit 0，实测 duration 262.8s）；全量套件由 driver 的机械 fan-in 跑。⚠️ 读数由 22 长到 41 是本任务 DoD ⑤ 的直接后果——三个 writer 夹具文件进了 `## Touches`，scoped 门遂把它们纳入选择（ac248 6 + ac249 8 + ac250 5 = 19，22+19=41）；两个读数都是实测，⛔ 不是估算。
- 机制变更使**多处**既有检测器/夹具需同步（**都不是放宽判据**，各附红控制）：① selfcheck anchor 控制的两个合成片段补全为 schema 合法；② 测试里 AC-214 NEED 的「产出侧落盘点」检测器新增识别第三种产出形（`ac_record_append_fragment`）并在判 anchor 前反转义——已用「删掉 `build_sha` 即报红」证明它仍能取假。③ 新增代码用 `if F; then x=0; else x=$?; fi` 形而非短路赋值：后者会踩 `instrument-failure-check` FAMILY-3（该检查器把短路符号读作管道，实测 15→20 越基线），改回后 15=baseline（⛔ 未抬高 shrink-only 基线）。④ **三个记录 writer 夹具**（`ac248-adr-check-flip-record` / `ac249-complete-change-record` / `ac250-web-observe-progress-record`）的 `writeRecordViaProduct` 是**手工维护**的闭包模型，此前只从函数体切片；而 `ac89_append_goal009` 本轮**首次**开始调用其它 shell 函数（`ac_record_schema_validate_fragment` / `ac_record_fragment_ac` / `ac_record_finalize` / `ac_record_carrier_root`）并读 top-level 声明 `AC_RECORD_SCHEMA` ⇒ 闭包过期，函数名缺失 ⇒ command not found、声明缺席 ⇒ `set -u` unbound variable ⇒ **写入侧对任何输入都返回 REFUSED**。实测（2026-09-12 本分支 suite 日志）：ac248/ac249 有正向控制 ⇒ 报红（`'REFUSED' !== 'WROTE'`，即这两个失败的真因）；**ac250 在该路径上唯一的断言是负向的 ⇒ 静默变空转**——测试仍绿而什么也没测到，与硬规则 3b 同形（读不懂输入的判定器返回了与「合格」同形的值）。修法三条：闭包补全；`AC_RECORD_SCHEMA` 经新增的 `bashDeclarationSource()` 从**产品脚本原文**提取进 harness（⛔ 不在夹具里再抄一份字段清单——那正是本任务要消灭的重复真源）；给 ac250 补**正向控制**（同一次调用换成观测到的非回环监听地址必须 WROTE），使三处此后闭包过期一律**报红而非静默通过**。可失败控制（已跑）：把 ac250 的闭包改回旧表重跑 ⇒ 新正向控制报红（`the same writer must ACCEPT the observed non-loopback listener`），证明它取得到假；三文件全绿（ac248 6/6、ac249 8/8、ac250 5/5）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/ac248-adr-check-flip-record.test.mjs
- plugin/test/ac249-complete-change-record.test.mjs
- plugin/test/ac250-web-observe-progress-record.test.mjs
- tasks/gap-ac-record-schema-duplicated-between-criterion-and-writer.md
