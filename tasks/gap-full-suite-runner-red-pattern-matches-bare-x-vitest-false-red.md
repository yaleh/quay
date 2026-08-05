---
id: gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red
title: "full-suite-runner FAILURE_PATTERNS matches bare ✖ glyph — vitest console
  output with ✖ triggers false early-red (archguard #3: passing negative-control
  test logs '✖ Diagram test failed' → suite green but stop-dispatch wrongly on;
  vitest 0 failed/exit 0); quay won't self-hit (node:test ✖ is structured),
  downstream verified fix; adopt structured matching + --maxWorkers doc split"
status: todo
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
bug】——只在 vitest 项目暴露（上游看不见自己的缺陷，环境恰好掩盖它）；(c) archguard 已验证修复方向，
quay 直接采纳即可。

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

- [ ] AC1: FAILURE_PATTERNS 去掉裸 `/✖/`，改匹配结构化形态（❯ <file> (N tests|M failed) / Test Files ... failed）——vitest 假红负控制不再误触
- [ ] AC2: node:test/TAP 真失败仍触发 red（not ok / # fail / # cancelled）——不回归
- [ ] AC3: 文档修正 vitest --maxWorkers（分叉写清，不指导 --test-concurrency）
- [ ] AC4: 与 archguard TASK-67 交叉标注（下游验证过，直接采纳）

## Touches

- plugin/scripts/full-suite-runner.ts（FAILURE_PATTERNS 改结构化匹配）
- plugin/test/full-suite-runner.test.mjs（AC1-AC2 测试）
- plugin/loop/orchestrator-loop-tick.md / docs（vitest --maxWorkers 分叉）
- tasks/gap-no-resource-awareness-heavy-ops-run-blind.md（AC3 交叉标注）

## Contract

measure   false_red = `node --test plugin/test/full-suite-runner.test.mjs 2>&1 | grep -c '✖'` stdout 数字段（vitest 假红负控制测试）
band      false_red = 0（裸 ✖ 不再触发 red）
invoke    `grep -n 'FAILURE_PATTERNS\|✖' plugin/scripts/full-suite-runner.ts`
control   vitest 负控制打 ✖ console ⇒ 不 early-red（AC1）；node:test 真失败 ⇒ red（AC2）
resume    判红模式与文档分叉分步提交，任一步完成即写盘