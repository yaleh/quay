---
id: gap-shipped-profiles-missing-worker-roles
title: shipped plugin/.quay/profiles.yml 缺 worker roles ⇒ worker-driver
  resolveRole 抛 role not found，第三方项目永不派发（AC-207 端到端阻塞）
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-207
---
## Proposal

AC-207 端到端生产复跑继续受阻（第 4 轮实测，host B=orangevps / host C=vhs）：resource-gate 缺陷已落地（gap-driver-resource-gate-path-anchored-at-root-third-party done），但第三方项目 worker 仍无法 spawn。根因（读代码 + 复现，位置判定）：`plugin/.quay/profiles.yml`（quay-init 模板 verbatim 铺进第三方项目 `.quay/profiles.yml`）的 `roles:` 只有 `manager`/`outer`，缺 `task-worker`（及 selector/fix-worker/pool-judge/meta-driver）；worker-driver 派发走 `launchArgv("task-worker", …)` → `profile-policy.ts:140` `resolveRole` 对缺失 role 抛 `role not found: "task-worker"`（fail-closed，无回退）⇒ 第三方项目 worker-driver 无法 spawn worker ⇒ 任务永不派发。dev-tree 根 `.quay/profiles.yml` 有完整七个 role（task-worker/selector/fix-worker/pool-judge/meta-driver），shipped 模板只同步了 manager/outer——shipped 文件头注释自称「两份 profiles 结构一致，只差 launcher/model 取值」，实际 role 键集不一致。

## Plan

1. 把 dev-tree 根 `.quay/profiles.yml` 的 worker roles（task-worker/selector/fix-worker/pool-judge/meta-driver）补齐进 shipped `plugin/.quay/profiles.yml`，保持 shipped 的 `worker-default` launcher=claude / model=null / auth=key 裸机通用默认不变，只补 role 结构（role 引用 worker-default profile，与 dev-tree 同构）。
2. 加测试：`plugin/test/profile-policy.test.mjs`（或等价）钉死 `resolveRole(readProfilesConfig("<repo>/plugin"), 'task-worker')` 不抛且 launcher 解析为 claude（负控制：改前抛 role not found）。
3. 跑 `scripts/test.sh` 全量绿；复跑 AC-207 `--ac207-e2e` 验证 worker 能 spawn（该步依赖 host B/C claude OAuth 恢复，属外部，本任务只保证 role 解析不抛）。

## Acceptance Criteria

- [x] AC1 补齐：`git show HEAD:plugin/.quay/profiles.yml` 的 roles 含 task-worker/selector/fix-worker 三键（各 ≥1 命中，贴命中行）。
- [x] AC2 负控制（能取假）：改前 `resolveRole(readProfilesConfig("<repo>/plugin"), 'task-worker')` 抛 `role not found: "task-worker"`；改后不抛且 launcher=claude（贴前后命令与输出）。
- [ ] AC3 全量绿：`scripts/test.sh` 全量绿（含 profile-policy.test.mjs 与新增钉）。（待外部）

## Definition of Done

shipped `plugin/.quay/profiles.yml` 与 dev-tree 根 `.quay/profiles.yml` 的 roles 键集一致（仅 launcher/model 取值差异保留）；`resolveRole(readProfilesConfig("<repo>/plugin"), 'task-worker')` 不再抛；`scripts/test.sh` 全量绿。

## Evidence

AC1 命中行（worktree `plugin/.quay/profiles.yml` roles 键）：
```
28:  manager:
31:  outer:
38:  task-worker:
43:  selector:
46:  fix-worker:
51:  pool-judge:
54:  meta-driver:
```

AC2 负控制（前后命令与输出）：
- 改前：`git show HEAD:plugin/.quay/profiles.yml` 铺进临时 `.quay/`，`resolveRole(readProfilesConfig("<tmp>"), 'task-worker')` → `THROWS — role not found: "task-worker"`。
- 改后：`resolveRole(readProfilesConfig("<repo>/plugin"), 'task-worker')` → `NO THROW — launcher=claude, model=null, name=quay-task-worker`。

AC3：全量 suite 由 fan-in 机械 driver 跑（待外部）；scoped 门 + `profile-policy.test.mjs`（22/22 绿，含 4 条 SHIPPED 钉）已在 worktree 验证。

## Touches

- plugin/.quay/profiles.yml
- plugin/test/profile-policy.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-shipped-profiles-missing-worker-roles.md
