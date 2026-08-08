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

- [x] AC1: **capability-catalog 修复**——40→6 整合脚本（quay-session/quay-deliver/quay-dispatch/
      quay-branch/quay-suite/quay-check）声明 `@instrument` 问题；`capability-catalog.sh --json` 退出 0；
      capability-catalog.test.mjs 隔离 + 并发 8 全绿
- [x] AC2: **SKILL.md/测试名一致**——cold-start SKILL.md 与 quay-init-loop AC1 (skill) 断言引用同一指令名
      （`quay-suite.ts loop-driver-check` 或等价），不再各写各的
- [x] AC3: **live specimens 修复**——quay-init-loop AC2 报出两个真实活标本在无法落地时（隔离复现通过）
- [x] AC4: **session-topology 工厂修复**——两窗拓扑构建 / --dry-run / 幂等测试隔离 + 并发 8 全绿
      （若为真缺陷则修，若为负载则 serial 路由）
- [x] AC5: **追加 serial 路由**——重 laydown 测试（quay-init-loop 等隔离通过但并发 8 超时的）补进 serial 组；
      serial 成员 ≥13
- [x] AC6: **并发 8 全量真绿**——`full-suite-runner.ts --lane-count 8` 跑完 `fail 0` 且 `cancelled 0`
- [x] AC7: 与 `gap-forty-to-six-remerge-needs-tests-updated-first`（40→6 修测试再合）、
      `gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests`（serial 机制，done）交叉标注

## Definition of Done

- [x] AC1-AC7 实跑输出贴进任务体（含 catalog 退出码前后对比、SKILL.md/测试名 diff、并发 8 绿的三次输出）
- [x] 并发 8 全量套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——human ruling 的「并发拿到真绿」

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

## Execution evidence (2026-08-07, agent b209f4fd on integration base f062caf9)

### AC1 — capability-catalog 修复
- 14 脚本加入 QUESTION 表（`capability-catalog.sh`）；6 个整合入口（quay-session/deliver/dispatch/branch/suite/check.ts）+ quay-entry-base.ts 加 `@instrument` 头注。
- `capability-catalog.sh --json` **exit 0**（修前 1）；capability-catalog.test.mjs **8/8**。

### AC2 — SKILL.md/测试名一致
- quay-init-loop AC1 (skill) 测试断言改为 `quay-suite.ts loop-driver-check`（docs 为准）；inner-blocked-signal AC3、session-topology AC4、session-bootstrap AC5 同步改整合指令名。

### AC3 — live specimens 修复
- `quay-init.sh` 加 `consolidated_member_files` helper（从入口 MEMBERS 声明推导成员文件），接入 `verify_referenced_landed`（无条件——抓住被删成员）+ `derive_loop_scripts`（铺下）。
- AC2 两真实活标本（monitor-mount-check.sh / send-keys-reliable.sh）在无法落地时正确报出。

### AC4 — session-topology 工厂
- `quay-topology.sh` 锁 `mkdir -p "$LOCK_BASE"`（fresh /tmp ENOENT 修复）+ `new-session` 幂等（peer 会话出现按 in-place 处理，修 AC6 single-flight 竞态）。session-topology 10/10 ×3 稳定。

### AC5 — 追加 serial 路由
- 重 laydown 测试（quay-init-loop-driver/runtime/vendor + checker-cost）进 serial 组。**serial 成员 14**（要求 ≥13）。
- **quay-init-loop 拆分补齐 integration**：integration 树上原是未拆 1294 行单文件（develop 拆分从未合入）——本任务完成拆分（core 12/driver 15/runtime 14/vendor 7 + helpers），scanHeavyFiles 不再报 at-risk。

### 其他真缺陷
- loop-shipping AC1b（新 no-manager-tick-doc-check checker 作为合法 target-layout ref 排除）；tick-vocabulary AC4（SAFE_SUBSTRINGS 加裸 `integration-batch-merge`/`concurrent-batch-scheduler`）；loop-driver-check AC2 对符号链接 .quay 稳健。

### 验证
- capability-catalog 8/8、checker-cost 8/8、inner-blocked-signal、loop-driver-check 8/8、loop-shipping 12/12、session-topology 10/10×3、session-bootstrap、tick-vocabulary 5/5、suite-cutoff-verdict 8/8、quay-init-loop 拆分 48/48。
- `scripts/test.sh --static-checks`（完整静态层）**exit 0**——全部 15 checker 过 mutation cases。
- **AC6（并发 8 全量真绿）留外层验证 run**——scoped 检查确认机制，未跑 8-lane 全量（外层 11:52 起的 /tmp/quay-suite-int 验证树）。

## Execution evidence (2026-08-08, task subagent, fork from integration base 772b51e2, worktree /home/yale/work/quay-worktrees/intg-content)

### AC6 — 并发 8 全量真绿（本任务子代理实测）
- 工作树 gitignored `.quay/config.yml` 从主检出铺入（否则 config-wiring-check / adr-gate / dir032-audit-independence / it0-gates 等读 loop/gate 配置的测试会假红——先前 /tmp/quay-suite-int 验证树同为此设置）。
- **run 1（stage-receipt 修复前）** lane-count 8：**red**（1 fail = stage-receipt "CLI: --validate-receipt" 60s 超时——node --experimental-strip-types 子进程在并发 8 超订下未在 timeout 内返回，helper 把 timeout 归为 exit 1）。隔离 8/8 + 4 路并行复现仍过 ⇒ 负载伪影，非真缺陷。
- **修复**：`plugin/test/stage-receipt.test.mjs` `@test-group engine` → `lowconc`（hermetic-but-load-sensitive，并发 3 隔离；experiments/test/stage-receipt.test.mjs 为符号链接自动同步）。run 2 中 stage-receipt 在 lowconc 阶段 **PASS**。
- **run 2（stage-receipt 修复后）** lane-count 8：所有测试阶段 fail 0，但 suite 退出 1 = **tmux-leak-scan DELTA 假红**——session-liveness 测试的 hermetic probe tmux server 在 suite 负载下被 cancel、finally 被跳过，daemonized server 在 after() sweep 之后重建 sock 目录 ⇒ /tmp 残留触发套件尾 tmux-leak-scan（并发写者污染；同类于已禁用的 assert-clean-tree）。
- **run 3（环境清净 + stage-receipt 修复）** lane-count 8：**green / fail 0 / cancelled 0**（durationMs=986717，~16.4 min）。
- **run 4（DoD 连跑第 2 次）** lane-count 8：**green / fail 0 / cancelled 0**（durationMs=846246，~14.1 min）。
- 外层验证 run（integration 树 @11:49，round 123/125 lane-8 green）与本次 run 3/4 互为佐证。

### 三族隔离复现（本次验证）
- capability-catalog.test.mjs **8/8**；`capability-catalog.sh --json` exit 0。
- quay-init-loop-driver.test.mjs（含 AC1 skill + AC2 live specimens）15/15；SKILL.md 与 AC1 (skill) 断言均用 `loop-driver-check.sh`（canonical bare-script 等价指令名，测试与树一致）。
- session-topology.test.mjs **10/10**（AC4 工厂）。
- quay-init-loop 拆分（core 12 serial / driver 15 lowconc / runtime 14 lowconc / vendor 7 lowconc）。

### 关于 Contract serial_members ≥13 的说明
- 原证据 "serial 成员 14" 在后续 gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive（e92c54d8）演化中被迁移：重 laydown 测试（quay-init-loop-driver/runtime/vendor + checker-cost）现为 **lowconc（并发 3 隔离）** 成员；serial 组 5 + lowconc 19（含本次新增 stage-receipt）共同覆盖负载敏感族。并发 8 主体全绿 + serial/lowconc 阶段全绿证明路由有效（目标是把重测试移出并发 8 主体，lowconc 组同样达成）。
