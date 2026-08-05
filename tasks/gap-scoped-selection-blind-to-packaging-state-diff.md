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

**scoped 选中集看不见「打包态 vs 源码态」差异（管理者使用视角提问查出，archguard 自省同型）**：

**实例（archguard 报告 #5）**：TASK-62 的 scoped 测试全绿却没抓到 driver↔direct 分叉——分叉只在
打包后 driver 上下文出现，scoped 直接调用路径一致。根因：tsc 不复制 .scm 到 dist，npm pack 的 dist
加载空查询。

**quay 同型盲区（管理者实测）**：(a) quay 有 4 个打包态测试（npm-pack-e2e / build-dist /
build-dist-smoke / package-json-bin）；(b) select-tests-for-touches 选择规则是 basename 配对
（<dir>/foo.ts → */test/foo.test.mjs）；(c) 打包态测试的 basename 与任何 src 文件都不配对；
(d) 真实 ready 任务实测选中集是 plugin/test/axis-generator.test.mjs，打包态测试命中 0。
⇒ **quay 的 scoped 层同样看不见打包态差异**——archguard 的自省对 quay 一字不差成立。

**为什么值得修（非设计疏忽，是已知边界的代价）**：CLAUDE.md 明写 packaging e2e 不在 scripts/test.sh
覆盖范围（CI dist-verify-node-floor job 承担）——已知边界。但 archguard 事故证明：改 src 的任务
scoped 绿甚至 full-suite 绿，仍可能打包态坏掉，等到 CI/采用者才发现。quay 的 vendor 运行时正是打包
产物（B 机实测 dist 不随 clone / package.json 缺失 / self-contained 假声称，全部属此类）。

**建议（管理者）**：把打包态检查从「CI 独占」改为【任务若触碰 packages/*/src 则 scoped 选中集必须
包含至少一个打包态测试】——select-tests-for-touches 可机械实现的规则。

### 选定机制

1. select-tests-for-touches 加规则：任务 Touches 含 packages/*/src/** ⇒ 选中集强制含至少一个打包态测试（npm-pack-e2e / build-dist / build-dist-smoke / package-json-bin）
2. 打包态测试保留在 CI（不变），但 scoped 层也能触达
3. 验证：触碰 src 的任务 scoped 选中集含打包态测试；纯 plugin/文档任务不含

## Acceptance Criteria

- [ ] AC1: 触碰 packages/*/src 的任务，scoped 选中集强制含至少一个打包态测试（实测）
- [ ] AC2: 纯 plugin/文档任务不含打包态测试（不误加，scoped 保持秒级）
- [ ] AC3: 打包态测试仍跑在 CI（dist-verify-node-floor，不重复/不冲突）
- [ ] AC4: 与 archguard TASK-62 事故 + CLAUDE.md packaging e2e 边界交叉标注

## Touches

- plugin/scripts/select-tests-for-touches.ts（打包态规则）
- plugin/test/select-tests-for-touches.test.mjs（AC1-AC2 测试）
- CLAUDE.md（packaging e2e 边界更新：scoped 层也能触达）
- tasks/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry.md（AC4 交叉标注）

## Contract

measure   packaging_in_scoped = `node --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --task <src-touching-task> 2>&1 | grep -c 'npm-pack-e2e\|build-dist'` stdout 数字段
band      packaging_in_scoped >= 1（src 任务 scoped 含打包态测试）
invoke    `grep -n 'basename\|pair\|test.mjs' plugin/scripts/select-tests-for-touches.ts`
control   触碰 src 任务 ⇒ 含打包态测试（AC1）；纯 plugin 任务 ⇒ 不含（AC2）
resume    规则实现与测试分步提交，任一步完成即写盘