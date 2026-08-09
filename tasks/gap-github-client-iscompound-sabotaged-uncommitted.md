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

- [x] AC1: **复现固化**——任务体记录 round-190 实证 + 两处 isCompound 被改 + git blame Not Committed Yet + 恢复后全绿（本任务 Proposal 已含）
- [x] AC2: **github-client.ts 恢复提交版**——`isCompound` 回到 `role === "compound" && (children || []).length > 0`，compound-gate/create-mcp 全绿
- [x] AC3: **来源确认**——查明是 inner 误改、工具残留、还是其它；留痕（不静默）
- [x] AC4: **防复发**——quay-github 源文件改动后对应测试在 scoped/fan-in 阶段被跑（cross-cut 或 fan-in 闸），不再全量才暴露
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：compound-gate 1/1 + create-mcp 2/2（贴任务体）；github-client.ts clean
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

### AC2 验证（github-client.ts 恢复提交版）

- `grep -c 'isCompound = role' packages/quay-github/src/github-client.ts` = **2**（两处均回到 `role === "compound" && (children || []).length > 0`）。
- `git status --short packages/quay-github/src/github-client.ts` 空 = clean（无未提交改动）。
- compound-gate.test.mjs：**pass 1 / fail 0**（328ms）。
- create-mcp.test.mjs：**pass 2 / fail 0**（3.3s）。

### AC3 来源确认——根因是 task-check-passthrough.test.mjs 的 adversarial break/restore 写真实源文件

**结论：不是 inner 误改，是本仓自己的测试基础设施在进程被杀时把变异留在工作树。**

- `packages/quay-github/test/task-check-passthrough.test.mjs` 的 3 个 adversarial break/restore 块（QN-072 done 分支 / QN-073 ready 分支 / needs-human 分支）直接把 `isCompound = false` / 删分支的**变异写入真实 `packages/quay-github/src/github-client.ts`**，只在 `finally` 里还原。
- 若测试进程在 `await withGithubMcpForMulti(...)`（spawn 的 MCP 子进程交互窗口）期间被杀（SIGKILL / OOM / 超时），`finally` 不执行 → **变异以未提交工作树编辑的形式残留**——正是本次失效的签名。
- **同一签名 2026-08-03 已出现过一次**（`isCompound = false` @ github-client.ts 第 566 行 done 分支，写入 20:21:08，套件运行中；当时同样无归属、`git checkout --` 还原；meta-cc 会话 `a725919c`/`3bbd3095` 有记录）。2026-08-09 复发为两处（ready+done 分支）。
- 排查已排除：checker-mutation-cases（5 个用例均不碰 product src，grep 验证）、测试写 src（task-check-passthrough 是唯一 `fs.writeFileSync` 写 github-client.ts 的测试）、无 commit/reflog 记录。
- **根治**：3 个 adversarial 块改为 `withAdversarialCopy()`——把整个 quay-github package（bin+src）复制到 `os.tmpdir()/quay-adv-*` 临时目录（R8 shared-root-mkdtemp 安全根；复制树内 symlink 仓根 node_modules 以解析依赖），对**副本**做变异，MCP 子进程从副本启动；共享检出真实源文件永不被写。即使 SIGKILL，最多残留一个 `/tmp` 下的 `quay-adv-*` 目录（OS 回收），不会破坏生产源。

### AC4 防复发——cross-cut 闸 + 根因修复

1. **cross-cut（plugin/scripts/select-tests-for-touches.ts）**：新增 `quay-github-src` 条目——`packages/quay-github/src/*` 改动触发 `compound-gate / create-mcp / gate / gate-gameability / task-check-passthrough` 进入 scoped 选择。github-client.ts 无同 basename 测试，basename 配对永远看不到这些测试；此前改 github-client 不跑 quay-github 测试是 scoped 盲区。
2. **根因修复（packages/quay-github/test/task-check-passthrough.test.mjs）**：adversarial 变异改为 temp-copy 隔离（见 AC3）。跑后验证真实源 clean、无 `.adv-*` 残留。
3. **测试**：plugin/test/select-tests-for-touches.test.mjs 新增 AC7 用例（25/25 pass）。

### AC5 scoped 门

- `bash scripts/test.sh --for-task gap-github-client-iscompound-sabotaged-uncommitted --allow-thin` → exit 0，fail 0 / cancelled 0，contract-check 0 violations。

## Touches

- packages/quay-github/src/github-client.ts（isCompound 恢复——outer 已做，inner 核实无回归）
- plugin/scripts/select-tests-for-touches.ts（AC4 cross-cut：新增 quay-github-src 触发 quay-github 测试）
- plugin/test/select-tests-for-touches.test.mjs（AC4 新增 quay-github-src cross-cut 测试用例）
- packages/quay-github/test/compound-gate.test.mjs（既有，AC2 验证）
- packages/quay-github/test/task-check-passthrough.test.mjs（AC3 根因修复：adversarial break/restore 改为 os.tmpdir temp-copy 隔离，不再写真实源文件）
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
