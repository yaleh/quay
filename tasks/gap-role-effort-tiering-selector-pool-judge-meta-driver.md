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
2. `packages/quay/src/init.ts` 的 `SHIPPED_PROFILES_TEMPLATE` 逐字同步同三处 `effort: low`——shipped carrier 的两份载体由字节相等不变式绑定（`generateProfilesContent("quay") === plugin/.quay/profiles.yml`），只改一份会被 `profiles-role-coverage-check.test.mjs` / `init.test.mjs` 拒。
3. dev-tree 根 `.quay/profiles.yml` 同步。
4. 不改 profile-policy.ts / driver-runtime.ts。

## Acceptance Criteria

- [x] AC1 `plugin/.quay/profiles.yml` 的 selector/pool-judge/meta-driver 三 role 各含 `effort: low`，且 worker-default profile 本身不含 effort（或仍为 high，不被本任务改动）。
  - shipped carrier（plugin/.quay/profiles.yml）：selector `effort: low`（:55）/ pool-judge（:70）/ meta-driver（:74）；worker-default（:13）无 `effort` 字段，未被本任务改动。
  - 同步镜像 `packages/quay/src/init.ts` `SHIPPED_PROFILES_TEMPLATE` 同三处；字节相等不变式实测 `generateProfilesContent("quay") === plugin/.quay/profiles.yml` → BYTE-EQUAL: yes。
- [x] AC2 dev-tree 根 `.quay/profiles.yml` 与 AC1 同构。
  - dev-tree carrier（.quay/profiles.yml）：selector `effort: low`（:102）/ pool-judge（:125）/ meta-driver（:131）；worker-default `effort: high`（:40）逐字保持。
- [x] AC3 `resolveRole("selector")` / `resolveRole("pool-judge")` / `resolveRole("meta-driver")` 解析结果 `effort: "low"`，且 `resolveRole("task-worker")` / `resolveRole("fix-worker")` 仍为 `effort: "high"`（贴解析结果）。
  - 实测（profile-policy.ts readProfilesConfig + resolveRole，worktree root）：
    `selector => effort: "low"`；`pool-judge => effort: "low"`；`meta-driver => effort: "low"`；
    `task-worker => effort: "high"`；`fix-worker => effort: "high"`；`outer => effort: "high"`。
- [x] AC4 一条真实 selector/pool-judge 或 meta-driver spawn 的 argv 含 `--effort low`（贴 argv）。
  - `launchArgv("meta-driver", "hello", <worktree>)` 产出 argv 含 `[10] --effort [11] low`（其后 `-n quay-meta-driver -p hello`）；selector/pool-judge 同含 `--effort low`（selector 额外带 mcpBlacklist 的 `--strict-mcp-config --mcp-config …`）。
- [x] AC5 `profiles-role-coverage-check.ts` 全绿。
  - `node --no-warnings --experimental-strip-types plugin/scripts/profiles-role-coverage-check.ts --root <worktree> --json` → exit 0，`status:"pass"`，`message:"init output covers all 5 requested role(s) and matches the shipped carrier; … single-model invariant green on 3 carrier(s)"`。
  - `profiles-role-coverage-check.test.mjs` 10/10 绿（含「produced carrier 与 shipped 模板仅差 name 前缀」的字节相等测试）。

## Definition of Done

- AC1–AC5 全部带真实证据勾选。
- task-worker/fix-worker/outer 的 effort 与改动前逐字一致（AC3 覆盖）。

## ADR-007 暗轴记录

- 该轴仍暗,理由:本任务改两份 profiles.yml 的 role 层 `effort` 字段并同步 init.ts 内联 `SHIPPED_PROFILES_TEMPLATE`（字符串常量，无 import/依赖边变化），未增删任何 import/包依赖边、未新增/移动模块、未跑 L_D/L_G 仪器，无可采的 L_D/L_G 读数。

## Touches
- plugin/.quay/profiles.yml
- .quay/profiles.yml
- packages/quay/src/init.ts
- plugin/scripts/profiles-role-coverage-check.ts
- plugin/test/quay-init-characterization.test.mjs
- plugin/test/profile-policy.test.mjs
- tasks/gap-role-effort-tiering-selector-pool-judge-meta-driver.md

## 续做记录（本轮）

- 上轮 suite 红（`.quay/profiles.yml moved` + `NEW-AC5`）的两条测试基线已重锚到本改动的目标形态：
  - `plugin/test/quay-init-characterization.test.mjs`：fresh-install `.quay/profiles.yml` hash 重锚。本分支先重锚到 `d41750ea…`；合并 develop 后，`gap-mcp-blacklist-extend-meta-cc-archguard-plantuml` 的 mcpBlacklist 扩展也落在同一 profiles.yml（两个改动同文件重叠）⇒ 双方 hash 都不存活，最终按合并后模板重锚 `8ec2d6c5…`（其余五 surface 文件 hash 不变）。
  - `plugin/test/profile-policy.test.mjs`：`NEW-AC5` 从「shipped carrier 全部 role 不声明 effort」收紧为「只有 selector/pool-judge/meta-driver 三个窄判定 role 声明 `effort: low`，其余 role 与全部 profile 仍不声明；permissionMode 仍谁都不声明」。

## Blocker

**2026-11-01T12:16:58.513Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: .quay/profiles.yml moved. [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/quay-init-characterization.test.mjs,plugin/test/profile-policy.test.mjs changed=-]
- run_id：wk-prod-anchor