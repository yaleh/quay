---
id: gap-retire-inner-agent-budget-report
title: 'A16 裁定(11:5x)宣布 inner-agent-budget-report.ts 整体废弃,但删除从未落地——脚本/测试/7 处引用仍在,全量套件被其 stale 测试挡住(round-250 唯一红:AC4 断言外层 A 段必读 inner-agent-budget.json,而 A16 已把该读从核心删掉)'
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**A16 裁定(人 2026-08-10 11:5x)「彻底取消所有 subagent 计数机制(`inner-agent-budget-report.ts` 整体废弃;`spawned/limit/budgetCritical` 全删)」已宣布,但删除从未落地。** 脚本、测试、7 处引用全部仍在。全量套件被其 stale 测试挡住:round-250 唯一红 = `inner-agent-budget-report.test.mjs` AC4「外层 A 段必读 inner-agent-budget.json」,而 A16 已把该读从核心删掉(换成「上层观察下层失能」)——**测试断言的是被裁定废除的旧行为**。

### 实证(outer 2026-08-10 14:0x 复核)

- **round-250 唯一红**:`inner-agent-budget-report.test.mjs:326` AC4 wiring —— assert core A 段 match `/inner-agent-budget\.json/` + `/inner-agent-budget-report\.ts/`,**失败**(core 已无该读,A16 替换)。
- **A16 裁定原文**(orchestrator-tick-core.md:36):「彻底取消所有 subagent 计数机制(`inner-agent-budget-report.ts` 整体废弃;`spawned/limit/budgetCritical` 全删——计数是我方自造的,Claude Code 无查询余量接口,只给设置上限 env)」。
- **harm 实录**(manager-obligation-ledger.jsonl:138):`inner-agent-budget-report.ts:104` 裸 `includes` 扫到任务体引用 ⇒ inner 自判 201/200 停派,真实用量 18/200,静默数小时——**这正是 A16 要废除的机制**。
- **引用面**:脚本 `plugin/scripts/inner-agent-budget-report.ts`(18KB);测试 `plugin/test/inner-agent-budget-report.test.mjs`(331 行);catalog `capability-catalog.sh` 5 条目(:154/:345/:543/:741/:939);`plugin/loop/fast-mode-loop-tick.md` 3 处(:839/:851/:1038);`tasks/gap-inner-subagent-budget-invisible.md`(原机制任务,status ready)。**零代码 import 消费**(grep 确认)——只有文档/catalog 引用,删除安全。
- **真实产物是 `.quay/inner-wakeup-heartbeat.json`**(inner 心跳),不是 `.quay/inner-agent-budget.json`(该文件不存在——测试断言的产品是虚构的)。

**为什么重要**:这是「裁定宣布但没执行」的实例——与 tonight 的 worktree 家族同形(worktree-include 任务 done 但没接线)。A16 已把核心改成新行为,但残留机制继续跑其 stale 测试,全量套件被一个已被废除的机制的测试挡住。

### 选定机制方向(实现归 outer A15 ④ 接管,判定归 manager)

1. **删除** `inner-agent-budget-report.ts` + `inner-agent-budget-report.test.mjs`(A16 裁定整体废弃)。
2. **清引用**:`capability-catalog.sh` 删 5 条目;`fast-mode-loop-tick.md` 删 3 处预算机制引用(保留对 A16 的交叉标注);`gap-inner-subagent-budget-invisible` 标 retired(A16 取代)。historical 记录(manager-obligation-ledger.jsonl / manager-loop-tick.md / core A16 行内提及)保留——它们是 incident ledger。
3. **验证**:删后 `--for-task` scoped 门绿;全量套件不再被该 stale 测试挡。

**验证锚**:修后 (a) `inner-agent-budget-report.*` 从 plugin/ 消失;(b) catalog 无其条目;(c) 全量套件不再报该测试红。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-250 唯一红(AC4 断言 core 必读 inner-agent-budget.json,而 A16 已删)+ A16 裁定原文 + harm 实录(自触发 201/200 假触顶)(本任务 Proposal 已含——Proposal §实证 三行:round-250 唯一红 / A16 裁定原文 / harm 实录,无需另行固化)
- [x] AC2: **删除脚本+测试**——`inner-agent-budget-report.ts` 与 `.test.mjs` 从 plugin/ 删除(实删于 090a0277;本 worktree 复核 `ls plugin/scripts/inner-agent-budget-report.ts` / `ls plugin/test/inner-agent-budget-report.test.mjs` 均 No such file)
- [x] AC3: **清引用**——capability-catalog 5 条目删(090a0277,QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING 各 1);fast-mode-loop-tick 预算引用改(保留 A16 交叉标注);gap-inner-subagent-budget-invisible 标 retired(体首 RETIRED 注);另清本 commit 发现的一处漏网引用:`plugin/scripts/tick-core-static-check.ts:85` 注释(实删提交遗漏,现改写为「A16-deprecated subagent-budget counting script」)
- [x] AC4: **真实产物不回归**——`.quay/inner-wakeup-heartbeat.json`(真实心跳)仍在、可读(`ls -la` 479 字节;内容 `{"budgetHit":false,"agentDispatches":18,"agentLimit":200,...}`,A16 新行为「上层观察下层失能」结构完整);`.quay/inner-agent-budget.json`(虚构产物)不存在
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿:`bash scripts/test.sh --for-task gap-retire-inner-agent-budget-report --allow-thin` → **exit 0 / tests 15 / pass 15 / fail 0 / cancelled 0**(capability-catalog 12 + 静态检查全 PASS;tick-core-static-check PASS / instrument-failure-check PASS / delivery-inventory drift gate PASS;详 Invoke evidence)

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 删后实跑:grep `inner-agent-budget-report` 在 plugin/ 零命中(贴输出);catalog 无条目
- [ ] 既有测试 + 新增测试全绿(`--for-task` scoped)
- [ ] 全量套件绿(`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`)——外层 verification-round 验证

## Touches

- plugin/scripts/inner-agent-budget-report.ts(删——A16 裁定整体废弃;实删于 090a0277,本 worktree 复核不存在)
- plugin/test/inner-agent-budget-report.test.mjs(删——stale,断言被废除的旧行为;实删于 090a0277,本 worktree 复核不存在)
- plugin/scripts/capability-catalog.sh(删 5 条目;实删于 090a0277,本 worktree 复核零命中)
- plugin/loop/fast-mode-loop-tick.md(删 3 处预算机制引用,保留 A16 交叉标注;本 commit 另将交叉标注中残留的字面量文件名改述为「自计数脚本」——保留 A16 裁定交叉标注,同时满足 plugin/ 零命中)
- plugin/scripts/tick-core-static-check.ts(本 commit 新增——实删提交遗漏的一处注释引用,改写以消除字面量,保留注解语义)
- tasks/gap-inner-subagent-budget-invisible.md(标 retired——A16 取代;090a0277 体首 RETIRED 注,本 worktree 复核在场)
- tasks/gap-retire-inner-agent-budget-report.md(自身:勾 AC + 贴证据)

## Invoke evidence(本 worktree 实跑,2026-08-10)

**Contract measure `budget_report_gone` = 0**:
```
$ grep -rc "inner-agent-budget-report" plugin/scripts plugin/test 2>/dev/null | grep -v ":0" | wc -l
0
```

**Contract invoke(删后应为零)**:
```
$ grep -rn "inner-agent-budget-report" plugin/ scripts/ 2>/dev/null | grep -v capability-catalog
(零命中,退出码 1)
```

**DoD grep `inner-agent-budget-report` 在 plugin/ 零命中**:
```
$ grep -rn "inner-agent-budget-report" plugin/ 2>/dev/null || echo "PLUGIN CLEAN (zero hits)"
PLUGIN CLEAN (zero hits)
```

**catalog 无条目**:
```
$ grep -n "inner-agent-budget" plugin/scripts/capability-catalog.sh 2>/dev/null || echo "CATALOG CLEAN"
CATALOG CLEAN
```

**删除复核(AC2)**:
```
$ ls plugin/scripts/inner-agent-budget-report.ts
ls: cannot access 'plugin/scripts/inner-agent-budget-report.ts': No such file or directory
$ ls plugin/test/inner-agent-budget-report.test.mjs
ls: cannot access 'plugin/test/inner-agent-budget-report.test.mjs': No such file or directory
```

**真实产物不回归(AC4)**——主检出 `.quay/inner-wakeup-heartbeat.json`(gitignored 运行时产物,本 worktree 为新建检出故不含;以主检出为准):
```
$ cat .quay/inner-wakeup-heartbeat.json
{"ts": 1786402782, "delaySeconds": 1500, "reason": "tick heartbeat — 新派 retire-inner-agent-budget-report (a5e45810, A16 裁定落地); ...", "runIds": {"retire-agent-budget": "fm-gap-retire-inner-agent-budget-report-1786402770145-cn5x87"}, "effectiveCap": 5, "suiteState": "running (round-262)", "blocked": [], "budgetHit": false, "agentDispatches": 18, "agentLimit": 200}
```
(`budgetHit:false / agentDispatches:18 / agentLimit:200` —— A16 新行为「上层观察下层失能」结构完整,不受本次删除影响。)

**scoped 门绿(AC5)**:
```
$ bash scripts/test.sh --for-task gap-retire-inner-agent-budget-report --allow-thin
tick-core-static-check: AC3 src:N coverage manager-tick-core.md=39/39 / orchestrator-tick-core.md=47/47 / fast-mode-tick-core.md=44/44 (target 100%)
tick-core-static-check: AC4 pointer targets OK
tick-core-static-check: AC5 B3 numbering OK
tick-core-static-check: AC6 prohibition consistent
tick-core-static-check: PASS — execution cores are statically covered.
instrument-failure-check --gate: PASS — 5/5 families mechanically detectable, no shrink-only violation
PASS: delivery-inventory drift gate (plugin/scripts A/D without outline update: no)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
(EXIT=0)
```

## Contract

measure   budget_report_gone = `grep -rc "inner-agent-budget-report" plugin/scripts plugin/test 2>/dev/null | grep -v ":0" | wc -l` 的 stdout
band      budget_report_gone = 0(脚本+测试删除后零命中)
invariant a16_executed = 1(A16 裁定落地:计数机制整体废弃,上层只观察下层失能)
invariant real_heartbeat_intact = 1(`.quay/inner-wakeup-heartbeat.json` 仍在、可读)
invoke    `grep -rn "inner-agent-budget-report" plugin/ scripts/ 2>/dev/null | grep -v capability-catalog`(贴命中——删后应为零)
control   删除;清引用;真实产物不回归;既有不回归
resume    删除 / 清引用 / 标 retired 分步提交,任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: round-250 唯一红 = inner-agent-budget-report.test.mjs AC4(core 已不读 inner-agent-budget.json,测试断言旧行为)。A16 裁定(11:5x)已宣布整体废弃但删除未落地——脚本/测试/7 引用仍在。立案:删除 + 清引用 + 标 retired。实现归 outer A15 ④ 接管(套件被此挡住),判定归 manager
