---
id: gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red
title: "full-suite-runner FAILURE_PATTERNS matches bare ✖ glyph — vitest console
  output with ✖ triggers false early-red (archguard #3: passing negative-control
  test logs '✖ Diagram test failed' → suite green but stop-dispatch wrongly on;
  vitest 0 failed/exit 0); quay won't self-hit (node:test ✖ is structured),
  downstream verified fix; adopt structured matching + --maxWorkers doc split"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**full-suite-runner 判红模式匹配裸 ✖ 误伤 vitest console 输出（archguard 报告 #3，下游修好上游未修）**：

**实例（archguard TASK-67）**：一个【通过】的负控制测试（故意喂无效 ArchJSON、断言处理器正确报错）在
console.error 里打了 `✖ Diagram test failed...`，导致 runner 触发 early-red；vitest 摘要是
0 failed / exit 0。⇒ **套件全绿却被判红，stop-dispatch 信号错误在位**。

**根因（外层独立核实）**：quay `plugin/scripts/full-suite-runner.ts` 第 93 行 `FAILURE_PATTERNS` 含
`/✖/`（裸字形，注释「node:test failure glyph」）。在 node:test 下这是结构化失败字形，但 vitest
项目里 ✖ 可以是测试自身的 console 输出——**裸字形误伤**。

**为什么重要**：(a) 它是【假红】——与 aborted-no-failure reason 轴同一根轴的另一源头（判红的模式
本身会误伤）；(b) quay 自己跑 node:test，裸 ✖ 恰好是结构化失败字形，所以【quay 不会自己撞到这个
bug】——只在 vitest 项目暴露（上游看不见自己的缺陷，环境恰好掩盖它）；(c) archguard TASK-67 已验证
修复方向（13:52 确认：修复后结构化判红生效，抓到 3 文件 6 真失败，假阳性不复发），quay 直接采纳即可。

**修复（archguard TASK-67 已验证，直接采纳）**：改匹配结构化形态（`❯ <file> (N tests | M failed)`
与 `Test Files ... failed`），不再匹配裸 ✖，保留 node:test/TAP 模式（`not ok`、`# fail 1+`、
`# cancelled 1+`）。

**同一报告的 --test-concurrency 文档 bug**：vitest 真实 flag 是 --maxWorkers（文件级并行），archguard
用 --maxWorkers=8 跑通全量 4902 passed。quay 机制文档里凡指导 vitest 项目用 --test-concurrency 的
地方都该改——同一份文档服务两种测试框架时的分叉没写清。

### 选定机制

1. FAILURE_PATTERNS 去掉裸 `/✖/`，改匹配结构化失败形态（❯ <file> (N tests | M failed)、Test Files ... failed）
2. 保留 node:test/TAP 模式（not ok、# fail、# cancelled）
3. 文档修正：vitest 项目用 --maxWorkers 而非 --test-concurrency（分叉写清）
4. 验证：vitest 假红场景（负控制测试打 ✖ console）⇒ 不再 early-red；node:test 真失败 ⇒ 仍 red

## Acceptance Criteria

- [x] AC1: FAILURE_PATTERNS 去掉裸 `/✖/`，改匹配结构化形态（❯ <file> (N tests|M failed) / Test Files ... failed）——vitest 假红负控制不再误触
- [x] AC2: node:test/TAP 真失败仍触发 red（not ok / # fail / # cancelled）——不回归
- [x] AC3: 文档修正 vitest --maxWorkers（分叉写清，不指导 --test-concurrency）
- [x] AC4: 与 archguard TASK-67 交叉标注（下游验证过，直接采纳）

### 实跑证据（执行 agent，2026-08-05；复核 2026-08-06 执行确认不改动，结果一致）

**AC1 实跑（vitest 假红负控制：通过测试打 ✖ console，0 failed，exit 0 ⇒ 不 early-red）**：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root "$TMP" \
    --command 'echo "✖ Diagram test failed" >&2; echo "# tests 5"; echo "# pass 5"; echo "# fail 0"; echo "# cancelled 0"; exit 0' --lane-count 1 --sync
full-suite-runner: FINAL state=green durationMs=33 exit=0
state: green
```
Contract invoke（`grep -n 'FAILURE_PATTERNS\|✖' plugin/scripts/full-suite-runner.ts`）——`✖` 只出现在注释，FAILURE_PATTERNS 无裸 `/✖/`：
```
96:// vitest-false-red, AC1): a bare `✖` in a vitest suite can be the test's OWN console
104:const FAILURE_PATTERNS: RegExp[] = [
```
结构化匹配已入模式：`❯ <file> (N tests | M failed [| K skipped])`、`Test Files <N> failed`。Contract measure
`node --test plugin/test/full-suite-runner.test.mjs 2>&1 | grep -c '✖'` = **0**（band false_red=0 满足）。

**AC2 实跑（node:test/TAP 真失败 not ok，exit 1 ⇒ 仍 red）**：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root "$TMP" \
    --command 'echo "not ok 1 - boom"; echo "# tests 1"; echo "# pass 0"; echo "# fail 1"; echo "# cancelled 0"; exit 1' --lane-count 1 --sync
full-suite-runner: FAILURE detected on stream -> state=red reason=failed (run still in progress)
full-suite-runner: FINAL state=red reason=failed durationMs=24 exit=1
state: red reason: failed
```
vitest 结构化真失败（`❯ test/foo.test.ts (3 tests | 1 failed) 12ms`）⇒ 同样 state=red reason=failed（early-red 保留）。

**scoped 验证（`scripts/test.sh --for-task gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red --allow-thin`，复核 2026-08-06 EXIT=0）**：
```
ℹ tests 24
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
task-contract-check: no violations.
```
（复核运行选 24 条 —— 自初跑 18 条后 `--wait-check` AC1 Contract invoke 控制等 6 条并入同一文件。
AC1 e2e 负控制 ✖ console + exit 0 ⇒ state=green、AC2 e2e not ok ⇒ state=red reason=failed、
vitest 结构化行 `❯ test/foo.test.ts (3 tests | 1 failed) 12ms` ⇒ 同 red，复核逐一复现，输出与上文一致。）

**AC3 实改**：`plugin/loop/orchestrator-loop-tick.md` 判红模式段 + 新增「并发旋钮分叉」段、
`plugin/loop/fast-mode-loop-tick.md` 并发旋钮分叉、`plugin/scripts/full-suite-runner.ts` 用法头注释
（`--maxWorkers` 而非 `--test-concurrency`，archguard `--maxWorkers=8` 跑通 4902 passed）、
`tasks/gap-no-resource-awareness-heavy-ops-run-blind.md` AC8 交叉标注。

**AC4 交叉标注**：Proposal 已引 archguard TASK-67（13:52 下游验证 3 文件 6 真失败、假阳性不复发）；
runner FAILURE_PATTERNS 注释亦引 archguard TASK-67。直接采纳下游已验证修复。

**复核 2026-08-07（worktree 重执行，代码未改动，结果一致）**：Contract invoke 确认 `✖` 只出现在
注释（runner 第 121-122 行），FAILURE_PATTERNS（第 129 行起）为结构化形态、无裸 `/✖/`；
Contract measure `node --test plugin/test/full-suite-runner.test.mjs 2>&1 | grep -c '✖'` = **0**
（band false_red=0）。AC1/AC2 控制逐条复现（资源闸因 CPU 负载 WAIT，用 QUAY_TEST_SKIP_RESOURCE_GATE=1
走轻量假 suite 验证）：AC1 vitest 假红负控制（`✖ Diagram test failed` console + 0 failed + exit 0）
⇒ `FINAL state=green exit=0`；AC2 node:test `not ok 1 - boom` + exit 1 ⇒
`FINAL state=red reason=failed exit=1`；vitest 结构化 `❯ test/foo.test.ts (3 tests | 1 failed) 12ms`
⇒ 同 `state=red reason=failed`（early-red 保留）。scoped 全绿：`scripts/test.sh --for-task ... --allow-thin`
= tests 24 / pass 24 / fail 0 / cancelled 0，`task-contract-check: no violations.`。driver 树全量套件绿
（`full-suite-state.json` state=green；verification-round round 55-57 均 `suiteGreen:true`）。

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] vitest 假红负控制：通过测试打 `✖` console ⇒ 不 early-red（实跑输出贴任务体）
- [x] node:test 真失败（not ok / # fail）⇒ 仍 red（实跑输出贴任务体，不回归）
- [x] 文档已修正 vitest --maxWorkers 分叉
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/full-suite-runner.ts（FAILURE_PATTERNS 改结构化匹配）
- plugin/test/full-suite-runner.test.mjs（AC1-AC2 测试）
- plugin/loop/orchestrator-loop-tick.md（vitest --maxWorkers 分叉）
- plugin/loop/fast-mode-loop-tick.md（vitest --maxWorkers 分叉）
- docs（vitest --maxWorkers 分叉）
- tasks/gap-no-resource-awareness-heavy-ops-run-blind.md（AC3 交叉标注）

## Contract

measure   false_red = `node --test plugin/test/full-suite-runner.test.mjs 2>&1 | grep -c '✖'` stdout 数字段（vitest 假红负控制测试）
band      false_red = 0（裸 ✖ 不再触发 red）
invariant structured_failure_matching = 1（判红匹配结构化形态，非裸字形）
invoke    `grep -n 'FAILURE_PATTERNS\|✖' plugin/scripts/full-suite-runner.ts`
control   vitest 负控制打 ✖ console ⇒ 不 early-red（AC1）；node:test 真失败 ⇒ red（AC2）
resume    判红模式与文档分叉分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T14:00:48Z
changed: AC12b product hard-blocker #4（HIGHEST priority）直接派发执行。采纳 archguard TASK-67
已下游验证的结构化判红修复（改匹配 `❯ <file> (N tests | M failed)` / `Test Files <N> failed`，
去裸 `✖`），同一报告附带的 vitest `--maxWorkers` 文档分叉一并修正。验证用 scoped 选中集
（`--for-task`），不跑全量。