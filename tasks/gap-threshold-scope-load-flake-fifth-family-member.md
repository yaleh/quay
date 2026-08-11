---
id: gap-threshold-scope-load-flake-fifth-family-member
title: threshold-scope-check.test.mjs 套件红 solo 绿——load-flake 第 5
  同族(relation-sync/ create-mcp/proposal-convergence/branch-model 之后);spawnSync×9
  重子进程、@test-group governance 跑 main 相、KNOWN-LOAD-SENSITIVE=0、round-215
  passed=false@7721ms 无断言输出; 处方=收编 KNOWN-LOAD-SENSITIVE + serial 相(前四同族同套路)
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**threshold-scope-check.test.mjs（222 行，`@test-group governance`，跑 main 并发相）是 load-flake 第 5 同族成员：round-215（14a6ed97）`passed=false` @ 7721ms、early、无断言输出；solo 4089ms 全绿。签名与前四同族一致——spawnSync 重子进程（AC1-AC9 各 spawn 一次 checker 子进程，共 ~9 次）、KNOWN-LOAD-SENSITIVE=0、@test-group governance 在 main 并发相跑。处方=前四同族同套路：收编 KNOWN-LOAD-SENSITIVE + serial 相。**

### 实证（manager 2026-08-10 分诊 + outer 核实 + 时序订正）

- **round-215 红已核实**：threshold-scope-check.test.mjs `passed=false` @ 7721ms，`early=true`（fail-fast），无断言输出。solo 4089ms 9/9 绿。
- **时序订正（outer 2026-08-10 03:41）**：round-215 树冻结在 0ec583b4（02:58:52），**不含** 250eb77f（≥50 行，03:15:27 落地）——我此前归因「红 = ≥50 行 unscoped-threshold」**错了**（merge-base 证实行不在树）。manager 判定对：round-215 红是 load-flake 不是 CLAUDE.md 改动。≥50 行是当前树的独立真缺陷（solo 复现 1!==0 ratchet breach），b190fda4 fix 必要，但与本红无关。
- **load-flake 签名（manager 三要点）**：①spawnSync 重（AC1-9 各 spawn checker，~9 次子进程）；②`@test-group governance` 跑 main 并发相（非 serial/lowconc）；③`KNOWN-LOAD-SENSITIVE=0`、套件红 solo 绿、无断言输出。前四同族（relation-sync/create-mcp/proposal-convergence/branch-model）同签名，全部收编 KNOWN-LOAD-SENSITIVE + serial 相后不再红。
- **为什么是 main 相问题**：main 相并发 N=4（nproc），spawnSync 子进程在高并发下启动慢/被调度延迟 ⇒ 超时或 killed ⇒ 无断言输出。

**为什么重要**：这是验证机件自身的 load-flake——不改会每轮在 main 相随机红，且红无断言输出难分诊。收编后进 serial 相（并发 1）稳定。

### 选定机制方向（实现归 inner，判定归 outer）

1. **收编**：threshold-scope-check.test.mjs 声明 `// @load-sensitive <kind>`（对照前四同族的声明形态）+ 进 KNOWN-LOAD-SENSITIVE manifest + 路由 serial 相。
2. **接线**：沿用 `plugin/scripts/known-load-sensitive.ts` 的机械解析（`@load-sensitive` 注释 + manifest），不改 test.sh glob。
3. **对照前四**：relation-sync/create-mcp/proposal-convergence 均已收编，本任务照同一套路。

**验证锚**：修后 (a) manifest 含 threshold-scope-check；(b) serial 相跑通（并发 1）；(c) 连续多轮不再在 main 相红。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 round-215 红（passed=false@7721ms 无断言输出）+ 时序订正（行不在树,红=load-flake 非 CLAUDE.md）+ 签名三要点（本任务 Proposal 已含）
- [ ] AC2: **@load-sensitive 声明**——threshold-scope-check.test.mjs 声明 @load-sensitive（对照前四同族形态）
- [ ] AC3: **manifest 收编**——KNOWN-LOAD-SENSITIVE manifest 含 threshold-scope-check
- [ ] AC4: **serial 相路由**——进 serial 相（并发 1），main 相不再跑
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：serial 相跑通 + manifest 含该文件（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/test/threshold-scope-check.test.mjs（@load-sensitive 声明）
- plugin/scripts/known-load-sensitive.ts（manifest 收编）
- scripts/test.sh（serial 相路由接线，若 manifest 不含路由）
- tasks/gap-threshold-scope-load-flake-fifth-family-member.md（自身：勾 AC + 贴输出）

## Contract

measure   threshold_scope_in_manifest = `grep -c "threshold-scope-check" plugin/scripts/known-load-sensitive.ts` 的 stdout 数字
band      threshold_scope_in_manifest >= 1（manifest 收编）
invariant load_sensitive_declared = 1（@load-sensitive 声明在档）
invariant serial_phase_routed = 1（serial 相路由,main 相不再跑）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --list`（贴输出：threshold-scope-check 在列）
control   收编进 manifest；@load-sensitive 声明；serial 相路由；scoped 门绿
resume    @load-sensitive / manifest / serial 路由分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 分诊(第 5 同族)+ outer 时序订正(round-215 树无 ≥50 行,红=load-flake;≥50 行是独立当前树缺陷已 fix)。裁定:收编 KNOWN-LOAD-SENSITIVE + serial 相,照前四同族套路。实现归 inner
