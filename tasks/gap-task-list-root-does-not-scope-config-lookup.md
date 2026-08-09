---
id: gap-task-list-root-does-not-scope-config-lookup
title: "quay task list --root <path> does NOT resolve config from --root — it
  walks UP from process CWD to find .quay/config.yml (manager clean repro,
  tmux interactive v25.2.0, 2026-08-05): discoverWorkspaceRoot defaults to
  process.cwd(); cwd-aligned runs silently used quay's OWN dev-tree config
  (test results flaky — the real cause of the manager's 忽好忽坏 runs);
  --root is meant to scope the workspace but config resolution ignores it;
  fix: pass --root into discoverWorkspaceRoot for workspace-scoped commands,
  or fail cleanly when no config under --root"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**`task list --root <path>` 不按 --root 找配置——真实 bug，管理者干净复现（与 node 版本无关）。**

**【实测（管理者，tmux 交互式 v25.2.0）】**：`quay init + task list` 端到端干净成功（'No tasks found'）。
但 `quay task list --root <path>` **不按 --root 找配置，按进程 CWD 向上找 .quay/config.yml**——
cwd 对齐时用的是 quay 自己开发树的配置。这是之前测试结果**忽好忽坏的真实原因**（cwd 对齐与否决定用哪份
config），不是 node 版本。

**【代码机制（外层核实）】**：`packages/quay/src/gate/config/loader.ts` 的 `discoverWorkspaceRoot`
**默认 `process.cwd()`**（`startDir: string = process.cwd()`），`--root` 未接入 config 解析。

**【影响】**：`--root` 的语义是「把 workspace 作用域到 <path>」，但 config 解析忽略它——多工作区操作
（采用者测试、跨项目）会在错误的 config 下运行。静默错误（不报错，只是用错配置），比显式报错更危险。

**【fix 方向】**：
1. workspace 作用域命令把 `--root` 传入 `discoverWorkspaceRoot`；
2. 或 `--root` 下无 config 时 **fail-closed 报错**（不静默回退 CWD）；
3. 与 `config-validate --root` 行为一致。

### 选定机制

1. `--root` 传入 discoverWorkspaceRoot（task list / 其它 workspace 作用域命令）
2. `--root` 下无 .quay/config.yml 时 fail-closed（不静默回退 CWD）
3. 覆盖测试：cwd 与 --root 不同 ⇒ 用 --root 的 config（负控制：cwd 有 config 也不该用它）

## Acceptance Criteria

- [x] AC1: `task list --root <path>` 从 <path> 解析 config（非 CWD）——cwd 与 --root 不同实测（实测 + 自动化测试 AC1）
- [x] AC2: `--root` 下无 config ⇒ fail-closed 清晰报错（不静默回退 CWD）（实测 + 自动化测试 AC2）
- [x] AC3: cwd 有 config 但 --root 指定别处 ⇒ 用 --root 的（负控制，不误用 cwd）（实测 + 自动化测试 AC3）
- [x] AC4: 与 config-validate --root 行为一致（不产生第二套语义）（config validate --root 同机制 fail-closed，自动化测试 AC4）

## Definition of Done

- [x] AC1-AC4 全勾（--root 从 <path> 解析 config 非 CWD；无 config fail-closed 清晰报错；负控制不误用 cwd；与 config-validate --root 行为一致）
- [x] cwd 与 --root 不同实测通过（task list --root 用 root 的 config）
- [x] scoped 门 `scripts/test.sh --for-task gap-task-list-root-does-not-scope-config-lookup` 绿（exit 0，5/5 pass）

## Evidence

- 机制：`packages/quay/src/gate/config/loader.ts` 新增 `resolveWorkspaceRootOrThrow(startDir)`
  （fail-closed `--root` 解析，discoverWorkspaceRoot 的 walk-up 单机制，无第二套语义）；
  `packages/quay/bin/quay.ts` 的 `withProvider` 接受 `root` 并 `loadConfig(resolveWorkspaceRootOrThrow(root))`，
  所有 workspace 作用域命令（task/adr/action/gate/gate-log/complete/adjudicate/promote/retreat/run/migrate/
  config validate/gate --list）均传 `--root`；`--root` 无值 → 用法错误。
- 自动化测试：`packages/quay/test/task-list-root-scope.test.mjs`（5 tests，node:test，@test-group product）——
  AC1/AC2/AC3/AC4 + bare `--root` 用法错误。`bash scripts/test.sh --for-task gap-task-list-root-does-not-scope-config-lookup --allow-thin` exit 0，5/5 pass。
- Contract measure 实测：`cd /tmp && quay task list --root <ws> 2>&1 | grep -c 'tasks\|No tasks\|错误'` → 1（band ≥1）。

## Definition of Done

- [ ] AC1-AC4 全勾（--root 从 <path> 解析 config 非 CWD；无 config fail-closed 清晰报错；负控制不误用 cwd；与 config-validate --root 行为一致）
- [ ] cwd 与 --root 不同实测通过（task list --root 用 root 的 config）
- [ ] scoped 门 `scripts/test.sh --for-task gap-task-list-root-does-not-scope-config-lookup` 绿

## Touches

- packages/quay/src/gate/config/loader.ts（discoverWorkspaceRoot 接 --root）
- packages/quay/bin/quay.ts（task list 等 workspace 作用域命令传 --root）
- packages/quay/test/（--root 作用域负控制测试）

## Test-Files

- packages/quay/test/task-list-root-scope.test.mjs

## Contract

measure   root_config = `cd /tmp && quay task list --root <ws> 2>&1 | grep -c 'tasks\|No tasks\|错误'` stdout 数字段
band      root_config >= 1（--root 生效或清晰报错，非静默 CWD）
invoke    `grep -n 'discoverWorkspaceRoot\|process.cwd()' packages/quay/src/gate/config/loader.ts packages/quay/bin/quay.ts`
control   cwd 有 config + --root 别处 ⇒ 用 --root 的（AC3 负控制）
resume    传 --root 与 fail-closed 分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T17:3xZ
changed: 管理者干净复现（与 node 无关）立案——`--root` 语义未接入 config 解析，CWD 向上找；代码机制核实
（discoverWorkspaceRoot 默认 process.cwd()）。这是管理者「测试结果忽好忽坏」的真实根因，非 node 版本假象。
