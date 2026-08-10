---
id: gap-runner-grouping-ac7-nested-spawn-load-flake
title: runner-grouping.test.mjs AC7 nested-spawn 负载 flake——round-168 红（engine+1
  断言失败），solo 18.4s 绿、无 pending commit 触及、同族第 3
  例（install-config/proposal-convergence）
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

**round-168（797cb22a，2026-08-09 11:48-12:08）全量套件红，唯一失败 = `plugin/test/runner-grouping.test.mjs` 的 `AC7: an undeclared file defaults to engine in --list-groups`（13.3s）——`AssertionError: undeclared file should count as engine`（`after.engine == before.engine + 1` 失败）。solo 18.4s 绿。这是 `@test-group serial` + `@load-sensitive nested-spawn` 的嵌套 spawn 负载 flake——与 install-config / proposal-convergence 同族。**

### 实证（outer 2026-08-09 12:08 红窗分诊）

- **失败签名**：`✖ AC7: an undeclared file defaults to engine in --list-groups (13332ms)` + `AssertionError: undeclared file should count as engine`。AC7 逻辑：写临时文件 `zz-runner-grouping-undeclared.test.mjs` → 两次 `runTestSh("--list-groups")`（写前/写后）→ 断言 `after.engine == before.engine + 1`。
- **solo 绿**：`timeout 240 bash scripts/test.sh --test-name-pattern="AC7: an undeclared file" plugin/test/runner-grouping.test.mjs` → `✔ AC7 (18422ms)`、tests 1 / pass 1 / fail 0。
- **全文件 164s**：round-168 perfile `runner-grouping.test.mjs duration_ms=164722ms`——嵌套 spawn 多次调用真实 `scripts/test.sh --list-groups`，每次都是全量 glob 扫描，负载下极慢。
- **@load-sensitive nested-spawn**：文件头标注，路由 serial 组（并发 1）。但 serial 相位只是并发 1，**嵌套 spawn 的 test.sh 内部仍可能受系统负载影响**（systemd-run CPUQuota=200%、内存 4G 下的 nproc 争抢）。
- **无 pending commit 触及**：`git log develop..integration -- runner-grouping.test.mjs` 空。同轮新 fan-in（DIR-043 external-dogfooding / round5 复核）只加文件不改它。
- **同族**：gap-install-config-driven-e2e-load-flake、gap-proposal-convergence-load-flake-20-child-concurrency——负载敏感重测试/嵌套 spawn 全量下轮换 flake。

**为什么重要**：这是「嵌套 spawn 负载 flake」族第 3 例。AC7 的 `engine+1` 断言对「临时文件是否被 `--list-groups` 看到」敏感——全量负载下嵌套 test.sh 的 glob 扫描时序抖动 ⇒ 断言失败。**serial 组只解决并发侧隔离，不解决嵌套 spawn 自身的负载敏感**（同 gap-serial-phase-install-test-residue-dependency 的「隔离是并发侧不是顺序侧」教训）。

**修的方向（实现归内层）**：
- 候选 A：**AC7 断言脱敏**——临时文件的 `engine+1` 改为「engine ≥ before.engine」（宽松）或加 nested-spawn 重试（负载瞬时抖动不构成真失败）。
- 候选 B：**嵌套 test.sh 轻量模式**——nested `--list-groups` 调用走轻量 glob（`QUAY_TEST_SKIP_STATIC_CHECKS` 已有类似机制），不触发全量扫描开销。
- 候选 C：**重试**——node:test `--test-retries` 或测试内 self-retry（同 proposal-convergence 候选 C）。
- 候选 D：**隔离到更轻的组**——runner-grouping 已 serial；若仍 flake，考虑降低其嵌套 spawn 频率（多次 `--list-groups` 合并为一次）。

**验证锚**：修后，(a) 连续 2 轮全量 AC7 绿；(b) solo 仍绿；(c) `engine+1` 断言核心（undeclared 文件归 engine）不削弱。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-168 实证（AC7 engine+1 失败 + solo 18.4s 绿 + 全文件 164s + 无 pending commit 触及）（本任务 Proposal 已含；内层补：全量负载下构造复现，或记录第 2 次全量红）
- [ ] AC2: **AC7 不再轮换失败**——连续 2 轮全量 AC7 绿（外层 verification-round 验证）
- [x] AC3: **solo 不回归**——runner-grouping.test.mjs 单独跑仍绿
- [x] AC4: **断言核心不削弱**——「undeclared 文件归 engine」保留（负控制：弱化为「只要 total+1 就行」即违）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 runner-grouping / serial 组契约检查）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [ ] 修后实跑：全量连续 2 轮 AC7 绿（贴任务体）；solo 绿
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

**AC1 复现（内层补）**：round-168 的 AC7 失败**根因已定位为并发树变更竞态**，非纯负载 flake——
外层 suite 运行期间内层 fan-in 了 `task/DIR-043`（merge 4e867b19 @ 12:06:30Z），新增 engine 组测试
`plugin/test/external-dogfooding-check.test.mjs`，恰好落在 AC7 的 `--list-groups` before/after 两次快照
之间 ⇒ `after.engine` 比 `before.engine` 多了 **2**（temp 文件 +1 与并发 fan-in 的 +1），断言 `+1` 失败
（`77 !== 76`）。这是 delta 式断言对并发树变更的本征脆弱，正是本任务要修的。

**AC4 修法——从 count-delta 改 DIRECT 归属**（`plugin/test/runner-grouping.test.mjs` AC7）：旧断言是
「写前/写后两次 `--list-groups` 快照，engine 必须 +1」。改为**直接归属**：写 temp 文件后查
`--group engine --list-files`，断言 temp 文件**在 engine 列表里**；再查 `--group product --list-files`，
断言**不在 product 列表里**。核心断言（undeclared → engine）**不削弱反而更强**（从「数量 +1」升级为
「该文件被归类为 engine」的直接成员断言）；并发加入的无关文件无法把它从 engine 列表里抹掉——竞态免疫。

**AC3 验证**：`bash scripts/test.sh --test-name-pattern="AC7: an undeclared file" plugin/test/runner-grouping.test.mjs` → exit 0，`✔ AC7`；整文件 `bash scripts/test.sh plugin/test/runner-grouping.test.mjs` → **11/11 pass / 0 fail**。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-runner-grouping-ac7-nested-spawn-load-flake --allow-thin` → exit 0，11 pass / 0 fail / 0 cancelled，violations 0。

**再验证（2026-08-10 inner re-dispatch，develop @ f05a4bdf）**：
- **AC5 scoped 门重跑**：`bash scripts/test.sh --for-task gap-runner-grouping-ac7-nested-spawn-load-flake --allow-thin` → **GATE EXIT: 0**，`pass 11 / fail 0 / cancelled 0`。外层全量套件并发、系统负载 avg 9.75–14.5 下 AC7 仍绿（57.9s）——DIRECT 归属断言对并发树变更免疫成立，runner-grouping 全 11 测试全绿。
- **AC3 Contract solo invoke 重跑**：`node --no-warnings --experimental-strip-types --test plugin/test/runner-grouping.test.mjs` → **SOLO EXIT: 0**，`tests 11 / pass 11 / fail 0 / cancelled 0`，其中 `✔ AC7: an undeclared file defaults to engine in --list-groups (24653ms)`。

**再验证（2026-08-10 inner re-dispatch #2，develop @ 255c9edb，fork `task/gap-runner-grouping-ac7-nested-spawn-load-flake`）**：
- **AC5 scoped 门重跑**：`bash scripts/test.sh --for-task gap-runner-grouping-ac7-nested-spawn-load-flake --allow-thin` → **GATE EXIT: 0**，`tests 11 / pass 11 / fail 0 / cancelled 0`（duration 134.5s），其中 `✔ AC7: an undeclared file defaults to engine in --list-groups (13339ms)`；静态检查全过（test-framework-policy / test-isolation / test-impl-census / task-contract-check / superseded-capability，violations 0）。
- **AC3 Contract solo invoke 重跑**：`node --no-warnings --experimental-strip-types --test plugin/test/runner-grouping.test.mjs` → **SOLO EXIT: 0**，`tests 11 / pass 11 / fail 0 / cancelled 0`（duration 244.2s），其中 `✔ AC7 (15813ms)`。
- **确认**：AC7 DIRECT-membership 修法（`--group engine --list-files` 成员断言 + `--group product` 非成员断言）在 develop head 上仍在位（`a9523011` 起），本 re-dispatch 未改动测试代码——fix 已在 develop，重新验证其经受 develop 后续 ~27 个提交（f05a4bdf→255c9edb）无回归。

**AC2（连续 2 轮全量绿）与 DoD 全量绿**：留给外层 verification-round 验证（SCOPED ONLY 纪律）。

## Touches

- plugin/test/runner-grouping.test.mjs（AC7 断言脱敏 / 重试 / 嵌套调用轻量）
- tasks/gap-install-config-driven-e2e-load-flake.md（交叉标注——同族：负载敏感重测试全量 flake）
- tasks/gap-proposal-convergence-load-flake-20-child-concurrency.md（交叉标注——同族）
- tasks/gap-serial-phase-install-test-residue-dependency.md（交叉标注——「隔离是并发侧不是顺序侧」同教训）
- tasks/gap-runner-grouping-ac7-nested-spawn-load-flake.md（自身：勾 AC + 贴证据）

## Contract

measure   runner_grouping_red_rounds_after_fix = `grep -c "runner-grouping.test.mjs passed=false" .quay/full-suite.log` 的 stdout 数字
band      runner_grouping_red_rounds_after_fix = 0（连续 2 轮绿）
invariant runner_grouping_solo_green = 1（单独跑绿）
invariant AC7_engine_core_preserved = 1（undeclared 文件归 engine 断言保留）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/runner-grouping.test.mjs`（单独跑贴回）
control   连续 2 轮全量绿；solo 绿；断言核心不削弱
resume    断言脱敏 / 重试 / 轻量嵌套分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-168 全量红分诊：runner-grouping AC7 engine+1 失败——nested-spawn 负载 flake，solo 18.4s 绿、无 pending commit 触及、同族第 3 例。实现归内层）
