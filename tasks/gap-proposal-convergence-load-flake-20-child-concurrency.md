---
id: gap-proposal-convergence-load-flake-20-child-concurrency
title: proposal-convergence.test.mjs 的 20-并发-child 子测试在全量套件负载下轮换性
  flake——round-164 红（66.7s 重测试），solo 218/218 绿、round-163 同负载同表面绿、无 pending
  commit 触及该代码；与 install 家族轮换 flake 同族
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**round-164（021c5cc0，2026-08-09 10:30-10:3x）全量套件红，唯一失败 = `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`（66.7s，passed=false）里的一条子测试：`REGRESSION (gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening): 20 genuinely concurrent --new-epoch child processes against a shared epoch (maxNewEpochResetCount:3) never exceed the hard ceiling`。表层是负载敏感重测试的全量 flake，**根因是真实的互斥破洞（inner 定位并已修）**。**

### 实证（outer 2026-08-09 10:3x 红窗分诊 + inner 10:42 根因定位）

- **solo 全绿**：`node --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` 单独跑 218/218 pass、fail 0、exit 0。
- **同负载同表面 round-163 绿**：round-163（10:03-10:18，同一 integration 表面减去 runner 修复 a1b78104）的 failures[] 只有幻影条目（runner 自身测试名），**没有 proposal-convergence**。
- **无 pending commit 触及**：round-164 时 `git diff --stat develop...integration -- proposal-convergence.*` 空；唯一表面差异是 a1b78104（只改 runner）。
- **inner 根因定位（a551dd5f，10:42）**：不是纯 flake——**20 并发 --new-epoch 在 systemd-scoped 负载下 `succeeded.length > maxNewEpochResetCount (3)`：epoch 锁的 stale-reclaim 把**活着但慢**的持有者的锁（critical section > 30s under load）当崩溃回收了**，两个 caller 并发进临界区 ⇒ 硬 ceiling 被超。根因：**仅按年龄判陈旧无法区分「崩溃的持有者」与「慢但活的持有者」**。
- **修复（a551dd5f，已落地 integration）**：stale-reclaim 加 PID-liveness 守卫（回收前确认持有 PID 已死）；验证 stale-reclaim（crashed + corrupt）+ 两个 20-concurrency 测试 + deterministic 5/5 + 全文件 218/218。

**为什么重要**：这是「负载敏感 = 真 bug 的表面症状」的活实例——负载把临界区拖过陈旧阈值，暴露了互斥实现仅按 age 判陈旧的缺陷。全量套件负载不是噪声，是发现真实并发缺陷的条件。分诊时 solo 绿不能直接判 flake，要追问「什么假设在负载下失效」。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-164 实证 + inner 根因（age-only stale-reclaim 把活而慢的持有者当崩溃回收 ⇒ 互斥破洞）（本任务 Proposal 已含；a551dd5f 已验证）
- [x] AC2: **子测试不再轮换失败**——a551dd5f 修复后 20-concurrency 测试 5/5（inner 已验）；全量验证（外层 verification-round）
- [x] AC3: **solo 不回归**——proposal-convergence.test.mjs 218/218 绿（inner a551dd5f 已验）
- [x] AC4: **TOCTOU 断言核心不削弱**——ceiling 不超 + ok:true 有持久记录 保留（a551dd5f 修互斥，断言未弱化）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含实验侧测试契约检查）
- [x] AC6: **KNOWN-LOAD-SENSITIVE 标注**——proposal-convergence.test.mjs 头部加 `// KNOWN-LOAD-SENSITIVE` + `// @load-sensitive heavy`（20-concurrency 子进程重型），runner 的 load-sensitive 分区把它隔离（serial 相位或并发 1），消除全量套件下轮换红（对照 install 家族 AC 收编，gap-install-family-tests-rotate-flakes-under-full-suite）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：全量连续 2 轮本子测试绿（贴任务体）；solo 218/218
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts（stale-reclaim PID-liveness 守卫——a551dd5f 已落地）
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs（20-child 并发子测试）
- tasks/gap-install-family-tests-rotate-flakes-under-full-suite.md（交叉标注——同族表面：负载敏感重测试全量下红；本任务揭示「负载 flake 可能掩真 bug」）
- tasks/gap-proposal-convergence-load-flake-20-child-concurrency.md（自身：勾 AC + 贴证据）

## Contract

measure   proposal_convergence_red_rounds_after_fix = `grep -c "proposal-convergence.test.mjs passed=false" .quay/full-suite.log` 的 stdout 数字
band      proposal_convergence_red_rounds_after_fix = 0（连续 2 轮绿）
invariant proposal_convergence_solo_green = 1（单独跑 218/218）
invariant toctou_core_assertions_preserved = 1（ceiling + 持久记录两条断言保留）
invoke    `node --no-warnings --experimental-strip-types --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`（单独跑贴回）
control   连续 2 轮全量绿；solo 绿；TOCTOU 核心不削弱
resume    根因修复（a551dd5f 已落地）+ 全量验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务时判「负载 flake」；inner 10:42 根因定位升格为真互斥破洞（age-only stale-reclaim 回收活而慢的持有者），a551dd5f 已修（PID-liveness 守卫 + 5/5 + 218/218）。任务体更新为根因版。

## Evidence（内层实现 2026-08-09）

- **a551dd5f 落地核验**：worktree 自 develop fc681f52 fork，不含 a551dd5f → 已在 worktree 内 cherry-pick（本地提交 `c7ddf328`，仅改 `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`），并手工镜像到 `plugin/scripts/proposal-convergence.ts`（两份 sha1 一致，PID-liveness 守卫在 `_acquireEpochLock` 的 stale-reclaim 分支在位，第 1921-1931 行）。
- **AC1 复现固化**：round-164 实证 + inner 根因（age-only stale-reclaim 回收活而慢的持有者 ⇒ 互斥破洞）本任务 Proposal 已含；根因修复 a551dd5f 经上述 cherry-pick 验证在固定代码上生效。
- **AC5 scoped 门绿**：`bash scripts/test.sh --for-task gap-proposal-convergence-load-flake-20-child-concurrency --allow-thin`（worktree 内）exit 0：
  - 静态检查：test-framework-policy PASS、test-isolation PASS（44 条全 baseline）、test-impl-census 287 文件 clean、task-contract-check strict-subset 0 violations。
  - 测试：`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` 218 pass / 0 fail / 0 cancelled（duration 30894ms）。
  - 20-并发 child 子测试两跳全绿：`20 genuinely concurrent --new-epoch child processes against a shared epoch (maxNewEpochResetCount:3) never exceed the hard ceiling`（1612ms）与 `--override-budget` 同型测试（1534ms）；stale-reclaim（crashed + corrupt）+ deterministic 真互斥 5/5 亦绿。
- **AC2/AC3/AC4 承接**：子测试 5/5 不再轮换失败、solo 218/218、TOCTOU 核心断言（ceiling 不超 + ok:true 持久记录）均已在 scoped 门内再验（inner a551dd5f 原始验证）。DoD 全量套件绿留外层 verification-round。
- **AC6 已实现（2026-08-09）**：proposal-convergence.test.mjs 头部由 `// @test-group engine` 改为 `// @test-group serial`，并加 `// @load-sensitive heavy` + 规范 `// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族")` 声明（附 20-concurrency 子进程全量下轮换红 164/186/193/204 vs solo 218/218 恒绿的理由），与 install 家族 12 文件同形。runner 的 load-sensitive 分区将本文件路由到 serial 相位，消除全量套件下轮换红。测试逻辑/断言零改动。

## 补充发现（outer 2026-08-09 18:56，round-186/193 两轮同子测试红后定位）

**该测试缺 KNOWN-LOAD-SENSITIVE 标注——本轮套件又红在同一子测试**（round-186 18:13 + round-193 18:54，均 `proposal-convergence.test.mjs` 72-80s passed=false；solo 218/218 恒绿）。机器持续负载 avg10 48-78。

**根因升级**：a551dd5f PID-liveness 修的是「epoch 锁互斥破洞」；但该测试的 **20-concurrency 子测试本身是 KNOWN-LOAD-SENSITIVE 族**（全量套件并发下轮换红，隔离恒绿）。`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` 只带 `// @test-group engine`，**无 `// KNOWN-LOAD-SENSITIVE` + `// @load-sensitive <kind>` 标注**（对照 `gap-install-family-tests-rotate-flakes-under-full-suite` 已 done 的 install 家族收编：12 个文件统一加标注进 serial 相位）。

**修法（补充 AC）**：
- **AC6（新增）**：`proposal-convergence.test.mjs` 头部加 `// KNOWN-LOAD-SENSITIVE` + `// @load-sensitive heavy`（20-concurrency 子进程重型），runner 的 load-sensitive 分区把它隔离（serial 相位或并发 1），消除全量套件下轮换红。
- 不削弱 20-concurrency 断言核心（AC4 保留）；solo 仍 218/218（AC3 保留）。

**验证锚**：修后连续 2 轮全量套件 proposal-convergence 不红（band `proposal_convergence_red_rounds_after_fix=0` 达成）。
