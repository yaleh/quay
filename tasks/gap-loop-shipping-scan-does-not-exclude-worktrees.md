---
id: gap-loop-shipping-scan-does-not-exclude-worktrees
title: loop-shipping AC1b/AC2 扫描器不排除 .claude/worktrees/ —— 外层 worktree 存在时假红
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
---
id: gap-loop-shipping-scan-does-not-exclude-worktrees
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

**`plugin/test/loop-shipping.test.mjs` 的 `walk(repoRoot)`（:109/:172）不排除 `.claude/worktrees/`——外层 agent worktree（如 `.claude/worktrees/agent-*/`，git worktree 有独立 repo 内容副本）被扫进 corpus，其内的旧路径引用造成 AC1b/AC2 假红。**

### 实证（inner 2026-08-10 10:0x fan-in 复验）

- **AC1b 失败**：`walk(repoRoot)` 只跳过 node_modules/.git/dist（:90），扫到 `.claude/worktrees/agent-a8fd141c573f3e7e4/README.md` 等含旧路径 `orchestration/orchestrator-loop-tick.md` / `docs/analysis/fast-mode-loop-tick.md` → `assert.deepEqual(hits, [])` 红。
- **AC2 失败**：`fast-mode-telemetry.ts` 物理副本断言 `[".../agent-a8fd.../plugin/scripts/fast-mode-telemetry.ts", ".../plugin/scripts/fast-mode-telemetry.ts"]` —— worktree 副本被计入。
- **不是任务回归**：任务在 develop fork（无 `.claude/worktrees` 存在）上 21/21 绿；merge 到 integration 后因外层 worktree 存在而假红。
- **`.claude/worktrees` 已 gitignore**（gap-gitignore-worktree-scratch-dirs-kills-round4-false-red 证实）——但 `walk()` 是 fs 遍历不认 gitignore，且 worktree 里是另一份完整 repo 内容。
- **判定形状同族**（gap-checks-that-verify-an-empty-set）：corpus 地板断言（scanned≥200, sawTestSh）不会拦住 worktree 混入。

**为什么重要**：外层随时可能在 `.claude/worktrees/` 跑 agent（本次就是外层 agent worktree），任何「全仓 fs 扫描」测试都会把 worktree 内容当主 repo 内容 → 假红 → 正确实现被误回退/误判。

### 选定机制方向

1. **扫描器排除 `.claude/worktrees/`**：`walk()` 跳过 `.claude/worktrees` 目录（git worktree 容器，类似 `.git`）。
2. **也考虑其它 worktree 容器**：`git worktree list --porcelain` 列出的路径都应排除（不只 .claude/worktrees/，还有 /home/yale/work/quay-worktrees/* 等）。
3. **负控制**：构造一个含旧路径的 worktree 存在场景 ⇒ 扫描器不报（排除生效）；删除该 worktree ⇒ 报（正常捕获）。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录本次 AC1b/AC2 假红完整输出（.claude/worktrees/agent-a8fd... 前缀路径清单）
- [ ] AC2: **排除生效**——`walk()` 跳过所有 git worktree 容器路径（.claude/worktrees/ + `git worktree list` 的非主路径），含旧路径的 worktree 不触发 AC1b/AC2
- [ ] AC3: **正常捕获保留**——主 repo 内真实旧路径引用仍被 AC1b 捕获（负控制）
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：外层 worktree 存在时 AC1b/AC2 绿（贴输出）；主 repo 造一个旧路径引用仍红
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/test/loop-shipping.test.mjs（AC2：walk() 排除 git worktree 容器路径）
- plugin/scripts/loop-shipping-exclusion-data.mjs（AC2：若排除表需扩展）
- tasks/gap-loop-shipping-scan-does-not-exclude-worktrees.md（自身：勾 AC + 贴证据）
- tasks/gap-gitignore-worktree-scratch-dirs-kills-round4-false-red.md（交叉标注——同族：worktree 引起假红）

## Contract

measure   worktree_exclusion = `node --no-warnings --experimental-strip-types --test plugin/test/loop-shipping.test.mjs` 的 stdout 中 AC1b/AC2 通过数
band      worktree_exclusion_full = 外层 worktree 存在时 AC1b/AC2 全绿（0 fail）
invariant main_repo_scan_resolution = 1（主 repo 真实旧路径仍捕获）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/loop-shipping.test.mjs`
control   删除 worktree ⇒ 旧路径引用恢复捕获（负控制）
resume    排除逻辑 / 负控制 / 复验分步提交

## Dispatch review

reviewer: inner
at: 2026-08-10
changed: 立案即补 Dispatch review 段（首版遗漏，被 round static-check 共享闸门捕获——正是本任务描述的「检查器抓问题」的实例）
