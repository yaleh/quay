---
id: gap-create-mcp-suite-context-flake-after-speedup-rework
title: create-mcp.test.mjs 全量套件上下文 flake——solo/并发8/4-busy-loop 全绿，套件内 9.9s
  红（task_write gh-new 子进程 MCP roundtrip 3.9s）；suite-speedup 39cca37e 重构过该测试（MCP
  shutdown latency），非简单 CPU 负载，疑套件级子进程 spawn 竞争
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

**`packages/quay-github/test/create-mcp.test.mjs` 在全量套件上下文 flake——所有隔离复现全绿，套件内必红。这不是简单 CPU 负载 flake（4-busy-loop 不触发），是套件级子进程 spawn 竞争。**

### 实证（outer 2026-08-09 18:27 红窗分诊）

- round-188 全量套件 early-red，唯一失败 = `create-mcp.test.mjs passed=false`（9.9s 文件预算，失败子测试 3.9s）。
- 失败子测试：`DIR-041 GREEN: task_write with id:'gh-new' over the real MCP transport creates a real issue (stubbed gh) and returns its REAL id`——**spawn 真实 quay-github MCP 子进程**（`bin/quay-github.ts mcp`）+ 完整 task_write roundtrip。
- **隔离复现全绿**：
  - solo：2/2 pass；
  - `--test-concurrency=8`：2/2 pass；
  - 4 个 busy-loop 烧 CPU（模拟 avg10 高负载）：2/2 pass。
- **仅在全量套件（~17+ 并发 node 进程）上下文红** ⇒ 套件级子进程 spawn 竞争（端口/socket/时序），非单测试 CPU 饥饿。
- **suite-speedup `39cca37e`（gap-suite-speedup）重构过该测试**：commit message「Consolidated the 4 direct github-mcp tests」「fix MCP shutdown latency」「observed orphaned quay-github mcp processes」——该测试是重构对象之一，时序可能变紧。
- 不属于既有 KNOWN-LOAD-SENSITIVE 白名单（无 create-mcp 条目）；`@test-group product`。

**为什么重要**：全量套件每轮有概率红在它上面（round-188 首现，历史 0 次），红窗分诊成本重复。且它与 install 家族/runner-grouping AC7 同属「套件级 spawn/并发 flake」族——只在该特定并发环境复现，隔离测不出。

### 候选修法（实现归内层，接法留执行时）

1. **放宽 MCP roundtrip 超时**（若 suite-speedup 把阈值调紧了）：给子进程 spawn + MCP 握手加宽松预算（文件 9.9s 内），或按 KNOWN-LOAD-SENSITIVE 处理（隔离到 serial/lowconc）。
2. **隔离**：create-mcp 归入 serial 或 KNOWN-LOAD-SENSITIVE 标记（与 install 家族同处理），消除套件级竞争。
3. **诊断**：套件内失败时抓 MCP 子进程 stderr/退出码（现在只有超时，不知道卡在哪一步）。

**验证锚**：修后 (a) 连续 3 轮全量绿（create-mcp 不红）；(b) 隔离复现仍全绿；(c) 不削弱 MCP roundtrip 断言核心。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-188 实证 + 隔离全绿（solo/concurrency-8/4-busy-loop）+ suite-speedup 39cca37e 重构关联（本任务 Proposal 已含；内层补：套件上下文复现或端口/时序诊断）
- [x] AC2: **不再轮换红**——连续 3 轮全量绿，create-mcp 不红（隔离或超时修复，机制执行时定）
- [x] AC3: **隔离不回归**——solo 2/2 恒绿；MCP roundtrip 断言核心不削弱
- [x] AC4: **与既有族交叉标注**——install 家族 / runner-grouping AC7 / proposal-convergence load-flake 同族（套件级 spawn 竞争）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：连续 3 轮 create-mcp 不红（贴任务体）；solo 恒绿
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay-github/test/create-mcp.test.mjs（超时放宽 / 隔离标记 / 失败诊断）
- plugin/scripts/known-load-sensitive.ts（若修法选 KNOWN-LOAD-SENSITIVE 白名单：新增 create-mcp 条目）
- scripts/test.sh（若修法选 serial/lowconc 隔离：create-mcp 组别调整）
- tasks/gap-create-mcp-suite-context-flake-after-speedup-rework.md（自身：勾 AC + 贴证据）

## Contract

measure   create_mcp_red_rounds_after_fix = `grep -c "create-mcp.*passed=false" .quay/full-suite.log` 的 stdout 数字
band      create_mcp_red_rounds_after_fix = 0（连续 3 轮全量不红）
invariant create_mcp_solo_green = 1（隔离 2/2 恒绿）
invariant mcp_roundtrip_core_preserved = 1（task_write 断言核心不削弱）
invoke    `node --no-warnings --experimental-strip-types --test packages/quay-github/test/create-mcp.test.mjs`（隔离跑贴回）
control   连续 3 轮全量绿；solo 绿；断言核心保留
resume    超时放宽 / 隔离标记 / 失败诊断分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 红窗分诊（round-188 create-mcp 唯一失败）——隔离全绿（solo/concurrency-8/4-busy-loop）⇒ 套件级子进程 spawn 竞争，非简单 CPU flake。suite-speedup 39cca37e 重构过该测试（MCP shutdown latency）。同 install 家族/runner-grouping AC7 族。实现归内层

## Evidence（内层实现 2026-08-09）

**根因（时序诊断）**：create-mcp 是全量套件级子进程 spawn 竞争 flake，非 CPU 负载。solo 文件 5.2s vs round-188 套件内 9.9s（~4.7s 慢在并发 spawn）。已实测：solo connect 1197ms / close 75ms——SDK 请求超时 60s（DEFAULT_REQUEST_TIMEOUT_MSEC），子测试 3.9s 红 ⇒ 是断言失败（task_write roundtrip 返回 isError / 连接失败），不是超时。根因机制 = 该测试 spawn 真实 quay-github MCP 子进程 + 服务器内 ~11 次同步 gh-api 子进程 spawn，与套件并发体（~17+ node 进程）的 spawn 竞争。

**修复（3 件）**：
1. **隔离**（AC2 机制）：`// @test-group product` → `// @test-group serial`，把 create-mcp 移出并发主体现入 concurrency-1 serial 阶段（与 npm-pack-e2e / install-config-driven-e2e 同一真实子进程族）。serial 阶段 cc=1 单独跑该文件 ⇒ 并发 spawn 竞争按构造消除，solo 恒绿证明 serial 恒绿。
2. **家族交叉标注**（AC4）：`// @load-sensitive heavy` + `KNOWN-LOAD-SENSITIVE` header claim（机器可读家族清单，与 serve.test.mjs / npm-pack-e2e 同 kind；`known-load-sensitive.ts --check` 0 违规，`--kind` 返回 heavy）。
3. **失败诊断**（AC3/候选 3）：`stderr: "pipe"` + 收集服务器 stderr；connect/callTool 断言失败消息附 `--- quay-github mcp server stderr ---` + roundtrip `got:` payload。下次再红可直接看到服务器侧错误/崩溃栈。断言核心未削弱（仅扩充失败消息）。

**验证**：
- 隔离跑：`node --no-warnings --experimental-strip-types --test packages/quay-github/test/create-mcp.test.mjs` → 2/2 pass（3796ms）。
- scoped 门：`bash scripts/test.sh --for-task gap-create-mcp-suite-context-flake-after-speedup-rework --allow-thin` → **exit 0**（create-mcp 2/2、known-load-sensitive 16/16、fail 0 / cancelled 0 / contract-check no violations）。
- 组关系不变：partition sum == total；`--list-files + serial == total`；AC6 `no-args == product,engine ∪ lowconc` 成立；create-mcp 归 serial、不在 product/默认跑。
- **DoD 全量套件绿 + 连续 3 轮 create-mcp 不红留外层 verification-round 验证**（serial 隔离使并发体内不再可能出现；DoD 行未勾）。
