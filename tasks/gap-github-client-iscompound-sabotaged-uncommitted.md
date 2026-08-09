---
id: gap-github-client-iscompound-sabotaged-uncommitted
title: github-client.ts 工作树未提交编辑禁用 compound-gate——两处 isCompound 硬编码 false（原
  role==="compound"&&children.length>0），compound-gate.test.mjs 8
  子测试全崩（r.childrenStatus undefined TypeError），round-190 全量红；未提交、无 commit、mtime
  18:3x
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

**`packages/quay-github/src/github-client.ts` 工作树存在未提交编辑——`checkGate` 两处 `isCompound` 从正确的 `role === "compound" && (children || []).length > 0` 被改成硬编码 `false`，完全禁用 quay-github 的 compound-gate（DIR-006/QN-035 移植）。导致 `compound-gate.test.mjs` 8 个子测试全崩（`r.childrenStatus is undefined` TypeError），round-190 全量套件 early-red。**

### 实证（outer 2026-08-09 18:34 红窗分诊）

- round-190 early-red，唯一失败 = `compound-gate.test.mjs passed=false`（274ms）。
- solo 复现：8+ FAIL 子测试，`TypeError: Cannot read properties of undefined (reading 'find')` at compound-gate.test.mjs:100 —— `r.childrenStatus` 是 undefined。
- **根因**：`git blame` 显示 `const isCompound = false` 两行 **Not Committed Yet**（工作树未提交编辑）；`git diff` 确认原提交版本是 `role === "compound" && (children || []).length > 0`。
- **范围**：恰好 2 行（checkGate 的 ready 分支 + done 分支各一处 isCompound → false），无其它未提交源文件改动。
- **修复**：`git checkout HEAD -- packages/quay-github/src/github-client.ts` 恢复提交版 → compound-gate 1/1 pass，create-mcp 2/2 pass。
- **来源不明**：无 commit、reflog 无记录，mtime 18:3x。未提交工作树编辑（可能 inner worktree fan-in 残留、或某工具误改）。

**为什么重要**：未提交的工作树编辑绕过所有 gate（scoped 绿、静态检查绿，因为检查读 HEAD/任务文件，不读工作树运行态），到全量套件才暴露。这正是「绕过不是罪，不留痕才是」——**编辑未提交 = 不留痕**。且 quay-github 是 Provider 参考实现，compound-gate 是 DIR-006/QN-035 的核心能力，被静默禁用。

### 选定机制方向（实现归内层，接法留执行时）

1. **本次修复**：已恢复提交版（outer 完成）。若为 inner 误改，需确认其意图。
2. **防复发**：quay-github 测试是否在 scoped/fan-in 阶段跑过 compound-gate？若 fan-in 后没跑 quay-github 测试，则「改 github-client 但没跑对应测试」是 scoped 盲区——需加 cross-cut 或 fan-in 闸。
3. **留痕**：任何工作树源文件编辑必须提交或标注——未提交编辑是本次失效的直接原因。

**验证锚**：修后 (a) compound-gate 1/1 + create-mcp 2/2 恒绿；(b) github-client.ts 无未提交改动；(c) 若源头是 inner 误改，确认其真实意图。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 round-190 实证 + 两处 isCompound 被改 + git blame Not Committed Yet + 恢复后全绿（本任务 Proposal 已含）
- [ ] AC2: **github-client.ts 恢复提交版**——`isCompound` 回到 `role === "compound" && (children || []).length > 0`，compound-gate/create-mcp 全绿
- [ ] AC3: **来源确认**——查明是 inner 误改、工具残留、还是其它；留痕（不静默）
- [ ] AC4: **防复发**——quay-github 源文件改动后对应测试在 scoped/fan-in 阶段被跑（cross-cut 或 fan-in 闸），不再全量才暴露
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：compound-gate 1/1 + create-mcp 2/2（贴任务体）；github-client.ts clean
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay-github/src/github-client.ts（isCompound 恢复——outer 已做，inner 核实无回归）
- plugin/scripts/select-tests-for-touches.ts（AC4 若走 cross-cut：github-client 改动触发 quay-github 测试）
- packages/quay-github/test/compound-gate.test.mjs（既有，AC2 验证）
- tasks/gap-github-client-iscompound-sabotaged-uncommitted.md（自身：勾 AC + 贴证据）

## Contract

measure   compound_gate_red_after_fix = `node --no-warnings --experimental-strip-types --test packages/quay-github/test/compound-gate.test.mjs 2>&1 | grep -c 'fail [1-9]'` 的 stdout 数字
band      compound_gate_red_after_fix = 0（compound-gate 全绿）
invariant iscompound_restored = 1（`grep -c 'isCompound = role' packages/quay-github/src/github-client.ts` = 2）
invariant github_client_clean = 1（无未提交改动）
invoke    `git status --short packages/quay-github/src/github-client.ts` + `node --no-warnings --experimental-strip-types --test packages/quay-github/test/compound-gate.test.mjs`
control   恢复后 compound-gate 绿；无未提交改动；scoped 门绿
resume    恢复提交版 + 来源确认 + 防复发分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 红窗分诊（round-190 compound-gate 唯一失败）——git blame 定位到两处 isCompound 未提交硬编码 false，git diff 确认原版正确，checkout HEAD 恢复后全绿。未提交编辑不留痕绕过 scoped/静态检查。恢复已由 outer 做；防复发（quay-github 测试在 scoped/fan-in 跑）归内层
