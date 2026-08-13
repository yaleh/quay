---
id: gap-worktree-node-modules-inconsistent-self-verify
title: "Some worktrees can't self-verify: node_modules presence is agent-dependent, so verification falls back to the shared checkout (where mutations land)"
status: ready
labels:
  - gap
extra:
  schema: v1
---

**type:** execution

## Proposal

2026-08-03 实测：两个同批派发的 worktree 环境不一致——

| worktree | node_modules | 能自证？ |
|---|---|---|
| `/tmp/quay-wt-tasklist` | **符号链接** → `/home/yale/work/quay/node_modules` | 能 |
| `/tmp/quay-wt-tokenwait` | **无** | 不能——`scripts/test.sh` 在构建阶段 fail-closed（`Cannot find package esbuild`，拒绝在可能陈旧的 bundle 上跑测试，**这个 fail-closed 本身是对的**） |

两者都是 `git worktree add` 建的（`.git` 文件都指向共享 repo 的 worktrees 管理目录）。
**差在 agent 的 setup 步**：tasklist agent 建了 `node_modules` 符号链接（它要跑 serve.test.mjs，
构建需要 esbuild）；tokenwait agent 没建（它只跑 heavy-op-token 测试，不需要）。

**后果**：不能自证的 worktree 只好把验证跑到共享检出上——而今晚的变异体污染
（`github-client.ts`）和未跟踪夹具泄漏（`zz-runner-grouping-undeclared.test.mjs`）**都发生在共享检出**。
**验证落点越靠近共享检出，污染被扫进 master 的风险越高。**

**本质**：worktree 是否可自证是 agent 的临时行为，不是机制。机制应保证每个派发的 worktree
都能自证（node_modules 就绪），不依赖 agent 记得建符号链接。

## Contract

```
measure self_verifiable_worktrees = `for w in /tmp/quay-wt-*; do [ -e "$w/node_modules" ] && echo yes; done | wc -l` 的 wc -l 计数字段（可自证 worktree 数）
measure dispatched_worktrees = `ls -d /tmp/quay-wt-* 2>/dev/null | wc -l` 的 wc -l 计数字段（worktree 总数）
band   self_verifiable_worktrees = dispatched_worktrees（全等）
invariant 派发的 worktree 必须能自证；不能自证时不静默回退到共享检出
invoke `bash plugin/scripts/dispatch-worktree-setup.sh <wt> && bash scripts/test.sh <scoped>`（机制示例）
control 新建一个 worktree 不跑 setup ⇒ `scripts/test.sh` 构建阶段 fail-closed；跑了 setup ⇒ 能跑
resume 先定 setup 步骤（符号链接 vs 复制 vs install），再接派发流程
```

## Chosen mechanism

1. **一个标准的 worktree setup 脚本**（`dispatch-worktree-setup.sh` 或并入现有派发工具）：
   建 worktree 后统一建 `node_modules` 符号链接 → 共享检出的 node_modules（与 tasklist 先例一致，
   零磁盘复制、共享已装的依赖）。若共享检出无 node_modules（裸 clone），fall back 到 `npm install`。
2. **接进派发流程**：内层派发 agent 的 prompt 模板强制要求先跑 setup；或把 setup 并入
   `milestone-worktree`/派发工具本身（更硬）。
3. **检查器（可选）**：一个 `worktree-node-modules-check`，扫在飞 worktree 的 node_modules 就绪度，
   缺失即报（fail-closed 或不阻断取决于定位）。

**不做**：不要求每个 worktree 独立 `npm install`（复制共享 node_modules 是浪费）；
不改 `scripts/test.sh` 的构建 fail-closed（那个行为是对的——拒绝陈旧 bundle）。

## Acceptance Criteria

- [ ] AC1: 标准 setup 脚本落地，符号链接或 install 两条路径都有测试
- [ ] AC2: 派发流程接入 setup（写进内层派发 prompt 或派发工具），新 worktree 不再依赖 agent 记得
- [ ] AC3: 负控制——不跑 setup 的 worktree 在构建阶段 fail-closed（贴实跑输出）；跑了 setup 的能自证
- [ ] AC4: 检查器（若有）接执行者并被真实触发一次
- [ ] AC5: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 实跑：新建 worktree 不跑 setup ⇒ `scripts/test.sh` 构建阶段 fail-closed；跑了 setup ⇒ 能自证（贴两路径输出）
- [ ] 派发流程已接入 setup（内层派发 prompt 或派发工具），新 worktree 不再依赖 agent 记得建 node_modules
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

**AC46 第一层（outer 2026-08-13）**：本任务 Touches 仍为「待定」（未声明 dispatch-worktree-setup.sh 等落点），self-touch 缺失 ⇒ 非 ready-可派，retreat 回 todo。待 Touches 落定（新 setup 脚本设计）再晋 ready。

## Touches

- （待定：新 `dispatch-worktree-setup.sh` + 派发 prompt 模板 + 测试；若加检查器则 `scripts/test.sh` 的 `run_static_checks`）
- tasks/gap-worktree-node-modules-inconsistent-self-verify.md（自身，C8 self-touch）
## Dispatch review

reviewer: outer
at: 2026-08-03T22:4xZ
changed: 外层发现并提问（tokenwait 与 tasklist 差在哪一步），内层实测回答：差在 node_modules 符号链接，
tasklist agent 建了、tokenwait 没建。外层判断值得成任务——验证落点越靠近共享检出，污染被扫进
master 的风险越高。
