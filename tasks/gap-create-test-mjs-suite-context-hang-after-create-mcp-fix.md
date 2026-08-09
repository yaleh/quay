---
id: gap-create-test-mjs-suite-context-hang-after-create-mcp-fix
title: create.test.mjs 全量套件并发下 fake-gh spawn 挂死（15 min ceiling）——solo 4/4 绿
  1.9s；与 create-mcp 同族（spawn 真实子进程套件级竞争）但缺 serial/KNOWN-LOAD-SENSITIVE
  标注（@test-group product 在并发池）；round-202 唯一失败
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

**`packages/quay-github/test/create.test.mjs` 在全量套件并发下挂死——fake-gh 子进程 spawn 竞争（15 分钟 ceiling 才被杀，套件 red）。solo 4/4 绿（1.9s）。与已修复的 `create-mcp.test.mjs` 同族（spawn 真实 MCP/fake-gh 子进程 + 套件级并发竞争），但 create.test.mjs 是 `@test-group product`（并发池），缺 KNOWN-LOAD-SENSITIVE + serial 处理。**

### 实证（outer 2026-08-09 22:20 红窗分诊）

- **round-202 红**：唯一失败 = `packages/quay-github/test/create.test.mjs`，`__PERFILE__ duration_ms=904209`（15 min ceiling，passed=false）。
- **挂死根因**：测试 spawn 一个 fake-gh 子进程（`node /tmp/quay-github-fake-gh-create-FaKnoA/gh api repos/o/r`），该子进程在全量套件并发下 **14:41 未返回**——spawn 竞争/端口/时序，套件级上下文问题。
- **solo 绿**：`node --test packages/quay-github/test/create.test.mjs` → 4/4 pass，1.9s。
- **缺标注**：文件头 `// @test-group product`（并发池），无 `// KNOWN-LOAD-SENSITIVE` + `// @load-sensitive <kind>`。
- **对照（已修复的同胞）**：`create-mcp.test.mjs` 头 `// @test-group serial` + `// @load-sensitive heavy` + `KNOWN-LOAD-SENSITIVE`——内层 bc1c77d2 把它移出并发主体现入 serial 相位，消除套件级 spawn 竞争。create.test.mjs 是同一文件族（quay-github create 路径）的兄弟，没被收编。
- **家族**：与 create-mcp / install 家族 / runner-grouping AC7 / proposal-convergence 同属「套件级 spawn/并发 flake」族。

**为什么重要**：全量套件每轮有概率挂死在 create.test.mjs（15 min ceiling 才 abort，浪费 15 分钟 + 红轮）。solo 恒绿证明是套件上下文问题不是测试逻辑。与 create-mcp 同根（spawn 真实子进程在套件并发下竞争）。

### 选定机制方向（实现归内层，接法留执行时）

1. **隔离**：`create.test.mjs` 加 `// @test-group serial` + `// @load-sensitive heavy` + `KNOWN-LOAD-SENSITIVE`，移出并发主体现入 serial 相位（与 create-mcp 同构）。
2. **家族交叉标注**：任务体标注与 create-mcp / install 家族 / runner-grouping AC7 同族。

**验证锚**：修后 (a) 连续 3 轮全量绿（create.test.mjs 不挂死）；(b) solo 4/4 恒绿；(c) 断言核心不削弱。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 round-202 实证（fake-gh spawn 14:41 挂死、15 min ceiling、solo 4/4 绿、缺 serial 标注）（本任务 Proposal 已含）
- [ ] AC2: **不再挂死**——连续 3 轮全量绿，create.test.mjs 不触发 ceiling（隔离或超时修复）
- [ ] AC3: **solo 不回归**——solo 4/4 恒绿；断言核心不削弱
- [ ] AC4: **与既有族交叉标注**——create-mcp / install 家族 / runner-grouping AC7 同族
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：连续 3 轮 create.test.mjs 不挂死（贴任务体）；solo 4/4 绿
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay-github/test/create.test.mjs（@test-group serial + @load-sensitive heavy + KNOWN-LOAD-SENSITIVE 标注）
- plugin/scripts/known-load-sensitive.ts（若需：白名单新增 create.test.mjs）
- scripts/test.sh（若修法选 serial/lowconc 隔离：组别调整）
- tasks/gap-create-mcp-suite-context-flake-after-speedup-rework.md（交叉标注——同族：create.test.mjs 是 create-mcp 的兄弟文件）
- tasks/gap-create-test-mjs-suite-context-hang-after-create-mcp-fix.md（自身：勾 AC + 贴证据）

## Contract

measure   create_test_red_rounds_after_fix = `grep -c "create.test.mjs.*passed=false" .quay/full-suite.log` 的 stdout 数字
band      create_test_red_rounds_after_fix = 0（连续 3 轮全量不挂死）
invariant create_test_solo_green = 1（solo 4/4 恒绿）
invariant create_test_core_preserved = 1（create 路径断言核心不削弱）
invoke    `node --no-warnings --experimental-strip-types --test packages/quay-github/test/create.test.mjs`（隔离跑贴回）
control   连续 3 轮全量绿；solo 绿；断言核心保留
resume    隔离标注 / 白名单 / 组别分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 红窗分诊（round-202 red，create.test.mjs 唯一失败）——fake-gh spawn 挂死 14:41、15 min ceiling、solo 4/4 绿。create-mcp 同族（已修复 bc1c77d2：serial + KNOWN-LOAD-SENSITIVE），create.test.mjs 是兄弟文件没被收编。实现归内层
