---
id: gap-role-effort-tiering-selector-pool-judge-meta-driver
title: selector/pool-judge/meta-driver 三个窄判定 role 降 effort 到 low（role 层，不动
  worker-default）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`worker-default` 把 `effort: high` 拍给全部共享它的 role（task-worker/fix-worker/selector/outer/pool-judge/meta-driver）。但 selector（选任务）、pool-judge（判 ready/needs-work/should-remove/uncertain）、meta-driver 语义半都是 schema 强约束、判据机械的窄判定，high effort 的推理 token 与输出（5× 计费）对它们是浪费。`gap-role-profile-permissionmode-effort-declaration-and-provenance`（done）已把 `effort` 做成 RoleSpec 可选字段，`profile-policy.ts` 有 `EFFORT_LEVELS` 封闭枚举（加载即拒表外值），`launchArgv` 已把它翻译成 `--effort <v>`。本任务只做 role 层降档，不动 task-worker/fix-worker/outer（它们仍继承 worker-default 的 high）。

## Plan

1. `plugin/.quay/profiles.yml`：roles.selector / roles.pool-judge / roles.meta-driver 各加 `effort: low`（role 层覆盖，不写进共享 worker-default，避免连坐 outer/task-worker）。
2. dev-tree 根 `.quay/profiles.yml` 同步。
3. 不改 profile-policy.ts / driver-runtime.ts。

## Acceptance Criteria

- [ ] AC1 `plugin/.quay/profiles.yml` 的 selector/pool-judge/meta-driver 三 role 各含 `effort: low`，且 worker-default profile 本身不含 effort（或仍为 high，不被本任务改动）。
- [ ] AC2 dev-tree 根 `.quay/profiles.yml` 与 AC1 同构。
- [ ] AC3 `resolveRole("selector")` / `resolveRole("pool-judge")` / `resolveRole("meta-driver")` 解析结果 `effort: "low"`，且 `resolveRole("task-worker")` / `resolveRole("fix-worker")` 仍为 `effort: "high"`（贴解析结果）。
- [ ] AC4 一条真实 selector/pool-judge 或 meta-driver spawn 的 argv 含 `--effort low`（贴 argv）。
- [ ] AC5 `profiles-role-coverage-check.ts` 全绿。

## Definition of Done

- AC1–AC5 全部带真实证据勾选。
- task-worker/fix-worker/outer 的 effort 与改动前逐字一致（AC3 覆盖）。

## Touches
- plugin/.quay/profiles.yml
- .quay/profiles.yml
- plugin/scripts/profiles-role-coverage-check.ts
- tasks/gap-role-effort-tiering-selector-pool-judge-meta-driver.md
