---
id: gap-repo-shape-inferred-from-test-sh-existence
title: fan-in 按「有没有 scripts/test.sh」推断本仓库形态：改为读 .quay/config.yml 显式声明的契约
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-316
---
## Proposal

**机制**：`plugin/scripts/worker-fan-in.ts:64-68` `hasTestSh(dir)`（注释原文「一个目录是否「本仓库形态」（有 scripts/test.sh）」）是 fan-in / suite 调度判断「目标项目是不是 quay 仓库」的**唯一依据**。它决定：scoped 门命令（`:150`）、doc-check 命令（`:177`）、suite 是否经 `full-suite-runner`（`suiteRunsOutsideRunner`，`:937`）。第三方项目只要按 `loop.test_command` 的约定交付了自己的 `scripts/test.sh`，就会被整体当成 quay 仓库，随后在归因、scoped、doc-check、delta 分类上逐项对不上，而每一处对不上都表现为「读不出东西」，不报错。

**生产实例（claudecodeui，2026-09-20→09-23）**：项目为过关被迫模仿 quay 形态三处——写 perfile 包装让 `scripts/test.sh` 输出 quay 的 `__PERFILE__` 格式（`gap-quay-tests-page-perfile-wrapper`）、给 `--static-checks-doc` 写桩（`scripts/test.sh:59` 打印 `no doc checks in this repo` 后 exit 0）、提交 quay 的检查注册表副本（`f7604c68`）。

**与 GOAL-012 的关系**：这是 GOAL-012 C 域（只在本仓库存在的能力）的一种未被枚举到的形态——用「文件是否存在」当作「能力声明」。

**修法（方向）**：
1. 在 `.quay/config.yml` `loop:` 下显式声明 fan-in 所需的契约（键名由实现定，候选：`test_output`（已有，`worker-fan-in.ts` `readLoopTestOutput`）、`scoped_command`、`doc_check_command`、`doc_surfaces`）。每个能力：**声明了 ⇒ 用；没声明 ⇒ 独立的「未提供」取值**（⛔ 不从文件是否存在推断）。
2. quay 自身仓库也通过同一份声明走同一条路径（本仓库的 `.quay/config.yml` 写上自己的值），从而删除 `hasTestSh`，而不是给它改名。
3. quay-init 写出这些键的缺省值（注释说明含义），`config-key-consumer-check.ts` 能看到每个键都有消费者。
4. `resolveScopedGateCommand` / `docCheckCommandFor` / `suiteRunsOutsideRunner` 三处统一改读声明（硬规则 5b：修完后在同一载体 grep 其它按文件存在判断能力的调用点，把命中数与前 3 条贴进提交）。

本任务是 GOAL-027 / AC-316 的主承载 task。

## AC

- [x] `node --experimental-strip-types packages/quay/bin/quay.ts goal gate AC-316 --dry-run` 退出 0（AC-316 判据：fan-in/suite 调度面上 `hasTestSh(` / `existsSync(…test.sh…)` 的非注释命中 = 0；落笔当轮读数为 exit 1、点名 5 处）。
- [x] `node --experimental-strip-types plugin/scripts/config-key-consumer-check.ts --json` 退出 0，且本任务新增的每个 `loop.*` 键状态为 `has-consumer`。
- [x] `node --test plugin/test/third-party-capability-degradation.test.mjs plugin/test/conformance-target-fixture.test.mjs` 退出 0，新增用例：一个**带自己 `scripts/test.sh`、但未声明 scoped/doc-check 契约**的第三方夹具 ⇒ scoped 门与 doc-check 取值为「未提供」（可区分取值），⛔ 不调用 `--for-task … --allow-thin` / `--static-checks-doc`。
- [x] 负控：quay 自身仓库的 fan-in 路径行为不变（既有 `worker-driver.test.mjs` 中 scoped/doc-check 命令断言照常通过）。
- [x] `bash scripts/test.sh --for-task gap-repo-shape-inferred-from-test-sh-existence` 退出 0，且执行了 ≥1 个测试文件。

## 判定读数（实现完成当轮实测，worktree 内）

- AC1：`goal gate AC-316 --dry-run` → `verdict=pass`，`reason="acceptance passed (exit 0)"`（落笔当轮为 `verdict=fail`，`CAUSE=… 5 处 … worker-fan-in.ts:66/150/177`）。
- AC2：`config-key-consumer-check --json` → `ok=true, keys_total=8, no_consumer_to_wire=0`；新增三键均 `has-consumer`（`suite_runner` 1 / `scoped_command` 2 / `doc_check_command` 1 个消费文件）。
- AC3：`node --test third-party-capability-degradation.test.mjs conformance-target-fixture.test.mjs` → `pass 17 / fail 0`，exit 0（含新增用例「AC-316 正向 — 带自己 scripts/test.sh 但未声明契约的第三方 ⇒ scoped/doc-check 都「未提供」」，其否定断言以「该文件确实存在（旧判据会命中它）」为前提，故可证伪）。
- AC4：`node --test plugin/test/worker-driver.test.mjs` → `pass 104 / fail 0`；scoped/doc-check 逐字一致的断言在夹具改为【显式声明契约】后仍逐字通过。
- AC5：`bash scripts/test.sh --for-task gap-repo-shape-inferred-from-test-sh-existence --allow-thin` → exit 0，`tests 266 / pass 266 / fail 0`。

## DoD

真实落地判据：`quay goal gate AC-316` 在真实仓库上记下一条 `verdict=pass` 的 GateEvent；并且在 claudecodeui 上（driver 重启到含修复的版本后）删除为模仿 quay 形态而加的 `--static-checks-doc` 桩之后，一次真实的机械 fan-in 在 step trace 中把 doc-check 记成「未提供」，而不是调用该桩。完成记录附两条记录原文。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/quay-init.sh
- packages/quay/src/init.ts
- plugin/skills/init/SKILL.md
- .quay/config.yml
- plugin/test/third-party-capability-degradation.test.mjs
- plugin/test/conformance-target-fixture.test.mjs
- plugin/test/worker-driver.test.mjs
- plugin/test/quay-init-characterization.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-repo-shape-inferred-from-test-sh-existence.md

## Needs-Human

**执行 2026-09-23T18:40:58.194Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser attributed no failing file (failure-line count unavailable on this judgment)); stopping instead of spending another worker session
- 失败步/判词：adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/gap-repo-shape-inferred-from-test-sh-existence still present
- run_id：wk-prod-anchor

## Needs-Human

**执行 2026-09-23T22:49:09.817Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 3 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser attributed no failing file (failure-line count unavailable on this judgment)); stopping instead of spending another worker session
- 失败步/判词：adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/gap-repo-shape-inferred-from-test-sh-existence still present
- run_id：wk-prod-anchor
