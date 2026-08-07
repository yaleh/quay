---
id: gap-integration-content-fails-first-complete-tree-verification-fix-21
title: "First complete-tree concurrency-8 verification exposed 21
  integration-content failures (serial mechanism WORKS — the 7 known
  load-sensitive failures are gone; the 21 are the candidate tree's OWN
  problems): capability-catalog 7/8 real (40→6 consolidated scripts
  quay-session/deliver/dispatch/branch/suite/check declare no @instrument
  question ⇒ catalog exits 1), quay-init-loop AC1-skill real (SKILL.md uses
  quay-suite.ts loop-driver-check, test asserts old loop-driver-check.sh),
  quay-init-loop AC2 live-specimens real, session-topology factory (classify),
  PLUS load artifacts (heavy quay-init --loop laydown tests pass isolated but
  time out under concurrency 8 — not serial-routed); fix real defects (40→6
  alignment) + route the extra load-sensitive tests → concurrency-8 true green"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**完整候选树首次并发 8 验证：serial 机制已生效（上轮 7 条已知失败全部消失），但暴露 21 条新失败 =
integration 待合内容自身问题。修完这批 + 补 serial 路由 → 并发 8 真绿。**

### 实测（外层 2026-08-07 11:30 并发 8 全量，integration worktree /tmp/quay-suite-int）

上轮 7 条（runner-grouping 嵌套 spawn / session-liveness noise-gate / test-file-snapshot 竞态）**本轮
一条不在**——serial 组机制对目标批有效。21 条新失败集中在三族，分两类：

**真缺陷（隔离复现）**：
1. **capability-catalog 7/8 隔离失败**——根因：integration 树上的 **40→6 整合脚本**（`quay-session.ts` /
   `quay-deliver.ts` / `quay-dispatch.ts` / `quay-branch.ts` / `quay-suite.ts` / `quay-check.ts`）**未声明
   `@instrument` 问题** ⇒ `capability-catalog.sh --json` 退出 1（AC1c unclassified 门），测试 "catalog
   --json must exit 0" 失败。catalog 本身只读扫 plugin/scripts，直接跑也退出 1（非 head 管道码）。
2. **quay-init-loop.test.mjs:1057 AC1 (skill) 真失败**（隔离 3.55ms）——SKILL.md 用
   `quay-suite.ts loop-driver-check`（整合指令名），测试断言旧名 `loop-driver-check.sh`，**测试与树不一致**。
3. **quay-init-loop AC2 live specimens 真失败**（隔离 5.1s）——check 未报出两个真实活标本
   （monitor-mount-check.sh / send-keys-reliable.sh）在无法落地时。
4. **session-topology 工厂测试**（两窗拓扑 / --dry-run / 幂等）——外层未逐一隔离，大概率同为真缺陷，
   接法时先隔离分类。

**负载伪影（隔离通过、并发 8 失败——未 serial 路由的追加负载敏感测试）**：
- quay-init-loop 其余 6-7 条失败隔离 48 测仅 2 失败 ⇒ 其余是**重的 laydown 测试**（quay-init --loop
  5-17s 每个）在并发 8 下超时，未进 serial 组。
- 需把这些追加进 serial 路由（或修成不依赖时序）。

### 为什么是 40→6 未对齐

40→6 instrument 整合（a4b1d9a9）在 develop 被 revert（gap-forty-to-six-remerge-needs-tests-updated-first，
catalog 真回归），但 **integration 还留着 40→6 状态**——脚本是整合后的（quay-suite.ts 等），而 catalog
问题声明 / SKILL.md 引用 / 测试断言没跟着统一。本任务就是「修测试再合」的活，先在 integration 上暴露了。

## Contract

measure suite_state = `python3 -c "import json;d=json.load(open('.quay/full-suite-state.json'));print(d.get('state'),d.get('reason'),len(d.get('failures',[])))"` stdout 两段（目标：green none 0）
measure catalog_exit = `bash plugin/scripts/capability-catalog.sh --json >/dev/null 2>&1; echo $?` stdout 数字段（目标 0）
measure serial_members = `grep -rlE '@test-group[[:space:]]+serial' plugin/test/ 2>/dev/null | wc -l` stdout 数字段（应 ≥13：原 11 + 追加重 laydown 测试）
band suite_state = green 开头（并发 8 全量真绿）
invoke `bash plugin/scripts/capability-catalog.sh --json >/dev/null 2>&1; echo $?`
control 40→6 脚本声明问题后 catalog 退出 0；重 laydown 测试 serial 路由后并发 8 不再超时；SKILL.md 与测试对同一指令名一致
resume 若中断，先跑 measure 读套件状态 + catalog 退出码 + serial 成员数

## Acceptance Criteria

- [ ] AC1: **capability-catalog 修复**——40→6 整合脚本（quay-session/quay-deliver/quay-dispatch/
      quay-branch/quay-suite/quay-check）声明 `@instrument` 问题；`capability-catalog.sh --json` 退出 0；
      capability-catalog.test.mjs 隔离 + 并发 8 全绿
- [ ] AC2: **SKILL.md/测试名一致**——cold-start SKILL.md 与 quay-init-loop AC1 (skill) 断言引用同一指令名
      （`quay-suite.ts loop-driver-check` 或等价），不再各写各的
- [ ] AC3: **live specimens 修复**——quay-init-loop AC2 报出两个真实活标本在无法落地时（隔离复现通过）
- [ ] AC4: **session-topology 工厂修复**——两窗拓扑构建 / --dry-run / 幂等测试隔离 + 并发 8 全绿
      （若为真缺陷则修，若为负载则 serial 路由）
- [ ] AC5: **追加 serial 路由**——重 laydown 测试（quay-init-loop 等隔离通过但并发 8 超时的）补进 serial 组；
      serial 成员 ≥13
- [ ] AC6: **并发 8 全量真绿**——`full-suite-runner.ts --lane-count 8` 跑完 `fail 0` 且 `cancelled 0`
- [ ] AC7: 与 `gap-forty-to-six-remerge-needs-tests-updated-first`（40→6 修测试再合）、
      `gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests`（serial 机制，done）交叉标注

## Definition of Done

- [ ] AC1-AC7 实跑输出贴进任务体（含 catalog 退出码前后对比、SKILL.md/测试名 diff、并发 8 绿的三次输出）
- [ ] 并发 8 全量套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——human ruling 的「并发拿到真绿」

## Touches
- plugin/scripts/quay-session.ts / quay-deliver.ts / quay-dispatch.ts / quay-branch.ts / quay-suite.ts /
  quay-check.ts（@instrument 问题声明）
- plugin/test/capability-catalog.test.mjs（若需调整）
- plugin/test/quay-init-loop.test.mjs（AC1 skill 断言名 / AC2 live specimens）
- plugin/skills/cold-start/SKILL.md（指令名一致性）
- plugin/test/session-topology.test.mjs（工厂测试）
- scripts/test.sh（追加 serial 路由——若原 serial 组机制未覆盖）
- tasks/gap-forty-to-six-remerge-needs-tests-updated-first.md（AC7 交叉标注）
- tasks/gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests.md（AC7 交叉标注，done）

## Dispatch review

reviewer: outer
at: 2026-08-07T12:0xZ
changed: 外层并发 8 首轮验证（integration worktree）：serial 机制生效（上轮 7 条消失）、21 条新失败 =
  integration 待合内容自身问题。隔离分类：capability-catalog 7/8 真失败（40→6 脚本未声明 @instrument ⇒
  catalog 退出 1）+ quay-init-loop AC1 skill 真失败（SKILL.md 用整合指令名、测试断言旧名）+ 重 laydown
  测试负载伪影（未 serial 路由）。立任务修 21 条 → 并发 8 重跑 → 真绿。管理者方向已确认。
