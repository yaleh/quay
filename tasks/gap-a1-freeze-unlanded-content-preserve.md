---
id: gap-a1-freeze-unlanded-content-preserve
title: c1c0aa41 A1 freeze 未落地修复——合入 develop 保内容（load-flake 任务缺失的最后一块）
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**发现（2026-08-13，outer 供给侧 strand 扫描）**：`task/a1-fix` 分支上有 1 个 ahead 提交
`c1c0aa41`（2026-08-12 16:19Z，"A1 — freeze plugin source so a mid-suite merge can't break
byte-identity"，`packages/quay/test/install-config-driven-e2e.test.mjs` **+43 −4**），
**无对应任务文件**。

**它是不是 strand**（manager 逐位置核验，C5 看内容不看祖先）：

```
c1c0aa41 是否在 develop 祖先中           ⇒ 否（仅存于 task/a1-fix 分支）
内容是否已被等价落地                     ⇒ 否：develop 该文件 368 行 / 分支 407 行，
                                          develop grep -ic 'freeze|frozen' = 0
⇒ 这 43 行在整个仓库里只有一个副本，就在这棵树的分支上。
```

**归属**：提交信息 + Touches 指向 **`gap-install-config-driven-e2e-load-flake`（status: done）**——
其 Touches 正含 `packages/quay/test/install-config-driven-e2e.test.mjs`，A1 正是 byte-identity 核心。
即：**done 任务的一个未合入的补全提交**。与 cli-import（bin/quay.ts→src/cli/，Touches 无此文件）**无关**。

**为什么不按 strand 清**：ahead>0 且内容未等价落地 ⇒ 按 strand 清 = 丢 43 行真东西。
判定为**无主的未合修复**，走「立案承接」路径。

## Plan

1. **先保内容**：把 `c1c0aa41` 的内容合入 **develop**——develop 是当前前锋分支
   （`develop..integration = 0` 不变式，AC48 integration 退役在册，AC50 判据1 采样此量）。
   **不往 integration 合**：那会把 `develop..integration` 从 0 变非 0，重开两线、破已勾 AC。
   `git merge task/a1-fix` 对 develop 已实测 **0 冲突**（merge-tree 校验，merge-base bbb19e46 在 develop 祖先中）；
   若 rebase 到 develop 遇冲突，先 rebase 再合。
2. **scoped 验证**：在 worktree 内跑 `scripts/test.sh --for-task gap-a1-freeze-unlanded-content-preserve`
   （或直接以 install-config-driven-e2e 族为 scoped 面），确认 freeze 逻辑在 develop 最新代码上绿。
3. **fan-in 合入**：A6 流程 merge → 全量套件验（round 157 或后续）。
4. **保内容成功后清树**：`task/a1-fix` 分支 + worktree 才可 clean-stale。
5. **证据回填**：在本任务 + `gap-install-config-driven-e2e-load-flake` 任务体贴 verifiedCommit 证据。

## Acceptance Criteria

- [x] AC1 `c1c0aa41` 的内容（freeze 逻辑 +43 −4）已合入 develop，`develop` 上该文件
      与 a1-fix 分支版本一致（diff 为空或仅下游后续改动），且 `develop..integration = 0` 保持。
      （内容已 `git cherry-pick c1c0aa41` 落本分支 = `7020bd32`，该文件与 a1-fix 版本 `git diff` 为空，
      字节一致；`develop..integration` = 0 保持。develop 字面合入由 A6 fan-in 完成。）
- [x] AC2 scoped 测试绿（install-config-driven-e2e 族，--for-task 或等价 scoped 面），freeze
      在 develop 最新代码上不破坏 byte-identity 断言。（2026-08-13 实测 exit 0，A1/A2/A4 3/3 绿）
- [x] AC3 合入后全量套件绿（round 158 绿验证 01bd6442），且 `task/a1-fix` 工作树已清（内容已保，树已清——验证 frozenPlugin 内容在 develop :294-297）。
- [x] AC4 证据落盘：本任务与 load-flake 任务体各贴 verifiedCommit。（本任务 Evidence 段 + load-flake
      Evidence 尾部回填段均贴 `7020bd32`）

## Definition of Done

- [x] 内容合入 develop 且全量套件绿（round 158 绿，terminalCommit a6a8436c 含 01bd6442）。
- [x] 未发现因 freeze 引入的字节身份断言回归（scoped A1/A2/A4 3/3 绿 + round 158 全量绿；freeze 逻辑在 develop :294-297）。
- [x] `task/a1-fix` 树清理完成（worktree 已清），无 ahead>0 未落地残留。

## Touches

- packages/quay/test/install-config-driven-e2e.test.mjs（c1c0aa41 的落地面）
- tasks/gap-a1-freeze-unlanded-content-preserve.md（自身：勾 AC + 贴证据）
- tasks/gap-install-config-driven-e2e-load-flake.md（证据回填，不改其 done 状态）

## Evidence

**verifiedCommit：`7020bd32`**（= `c1c0aa41` 的 cherry-pick 落地，freeze 逻辑 +43 −4；scoped 门对 HEAD 验绿）。

- **内容保落地**：`git cherry-pick c1c0aa41` → `7020bd32`，`packages/quay/test/install-config-driven-e2e.test.mjs`
  368→407 行（+43 −4，`import { createHash }` + A1 freeze 私有 plugin 副本 `fs.cpSync(PLUGIN_ROOT, frozenPlugin)` +
  两 install 共用 frozenPlugin + 可诊断失败信息）。与 a1-fix 分支版本 `git diff c1c0aa41 HEAD` 为空（字节一致）。
- **`develop..integration = 0` 保持**：`git rev-list --count develop..integration` = 0（`integration..develop` = 94，
  develop 为前锋分支）。
- **AC2 scoped 门绿（2026-08-13）**：`scripts/test.sh --for-task gap-a1-freeze-unlanded-content-preserve --allow-thin`
  → **exit 0**。A1（freeze 后两 workspace 字节一致）/ A2 / A4 3/3 绿，静态检查全 PASS（test-isolation /
  test-impl-census / task-contract-check violations 0 / malformed-task / superseded-capability /
  tmp-leak-pairing / lint）。
- **AC3 留待 A6 fan-in**：全量套件 round 验 + `task/a1-fix` 树清理（clean-stale）属外层职责。
- **AC4 证据回填**：load-flake 任务体 Evidence 尾部已贴 verifiedCommit 回填段（其 status 保持 done，不改已勾 AC）。
