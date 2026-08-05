---
id: gap-scoped-selection-blind-to-packaging-state-diff
title: "scoped selection blind to packaging-vs-source diff (manager usage-view
  Q; archguard TASK-62 self-note applies verbatim to quay): basename pairing
  never matches packaging tests (npm-pack-e2e/build-dist/...), src-touching task
  scoped-green can still break packaged; fix: src-touching task forces ≥1
  packaging test in selection"
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

**scoped 选中集看不见「打包态 vs 源码态」差异 + 跨切判据系统性失明（管理者使用视角提问查出，archguard 同型 = 跨项目证据）**：

**实例（archguard 报告 #5 + TASK-64/65）**：TASK-62 scoped 测试全绿没抓到 driver↔direct 分叉（tsc 不复制
.scm，packed dist 加载空查询）。TASK-64/65 加 MCP tool 缺 ADR-007 canonical CLI flag——**scoped 全绿、AC
全勾，但都没跑 check-adr**（ADR-007 检查是跨切测试，scoped 覆盖不到，check-adr.test.ts 唯一抓到）。

**quay 同型盲区（管理者实测）**：(a) quay 有 4 个打包态测试（npm-pack-e2e / build-dist /
build-dist-smoke / package-json-bin）；(b) select-tests-for-touches 选择规则是 basename 配对
（<dir>/foo.ts → */test/foo.test.mjs）；(c) 打包态测试的 basename 与任何 src 文件都不配对；
(d) 真实 ready 任务实测选中集是 plugin/test/axis-generator.test.mjs，打包态测试命中 0。

**跨项目证据（archguard 2026-08-05 15:08 报告）**：两个项目独立撞到同一类缺陷——【跨切判据
（ADR-007 合规、打包态一致性）无法通过 basename/touches 配对被 scoped 选中，只能靠 full-suite 兜底，
而 full-suite 跑得少】。⇒ **「scoped 层对跨切判据系统性失明」是跨项目证据，非单项目偶发**。

**判据形态建议（管理者）**：某些判据应标记为【跨切】——无论 touches 是什么都必须进 scoped 选中集。

**为什么值得修**：CLAUDE.md 明写 packaging e2e 不在 scripts/test.sh 覆盖范围（CI dist-verify-node-floor
job）——已知边界。但 archguard 事故证明：改 src 的任务 scoped 绿甚至 full-suite 绿，仍可能打包态坏掉。
quay vendor 运行时正是打包产物（B 机实测 dist 不随 clone / package.json 缺失，全属此类）。

### 选定机制

1. **跨切判据标记**：select-tests-for-touches 加「跨切」概念——标记为跨切的判据测试（打包态 e2e、
   ADR 合规、契约检查等）无论任务 touches 是什么，只要任务触碰对应对象（src/新 MCP tool）就必须进
   scoped 选中集
2. 打包态测试保留在 CI（不变），但 scoped 层也能触达
3. 验证：触碰 src 的任务 scoped 选中集含打包态测试；加 MCP tool 的任务 scoped 含 ADR 检查

## Acceptance Criteria

- [ ] AC1: 触碰 packages/*/src 的任务，scoped 选中集强制含至少一个打包态测试（实测）
- [ ] AC2: 触碰 src 或新增 MCP tool 的任务，scoped 含 ADR/跨切检查（check-adr 类，实测）
- [ ] AC3: 纯 plugin/文档任务不含打包态/跨切测试（不误加，scoped 保持秒级）
- [ ] AC4: 打包态测试仍跑在 CI（dist-verify-node-floor，不重复/不冲突）
- [ ] AC5: 与 archguard TASK-62/64/65 事故 + CLAUDE.md packaging e2e 边界交叉标注（跨项目证据）

## Touches

- plugin/scripts/select-tests-for-touches.ts（跨切判据标记）
- plugin/test/select-tests-for-touches.test.mjs（AC1-AC3 测试）
- CLAUDE.md（packaging e2e 边界更新：scoped 层也能触达 + 跨切判据说明）
- tasks/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry.md（AC5 交叉标注）

## Contract

measure   crosscut_in_scoped = `node --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --task <src-touching-task> 2>&1 | grep -c 'npm-pack-e2e\|build-dist\|check-adr'` stdout 数字段
band      crosscut_in_scoped >= 1（src/新 tool 任务 scoped 含跨切测试）
invoke    `grep -n 'basename\|pair\|crosscut\|跨切' plugin/scripts/select-tests-for-touches.ts`
control   触碰 src 任务 ⇒ 含打包态测试（AC1）；加 MCP tool 任务 ⇒ 含 ADR 检查（AC2）；纯 plugin 任务 ⇒ 不含（AC3）
resume    跨切标记与测试分步提交，任一步完成即写盘