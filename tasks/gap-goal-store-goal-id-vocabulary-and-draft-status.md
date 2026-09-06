---
id: gap-goal-store-goal-id-vocabulary-and-draft-status
title: "goal-store 词表与 id 改造——PHASE-NNN→GOAL-NNN、新增 draft 状态、phase: 改 goal:"
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

正本：`orchestration/SPEC-goal-mechanism-2026-09-06.md` §2 + `goals/AC-170-goal-id-vocabulary-migration.md`。
人 2026-09-06 裁定「PHASE-NNN → GOAL-NNN 照做」「draft 状态接受」。

**立条依据（实测）**：`packages/quay/src/goal-store.ts:48` 的 `PHASE_ID_RE` 不匹配 `GOAL-001`，
`list()`（`:168`）只收 `PHASE-`/`AC-` 前缀文件 ⇒ 已落盘的 `goals/GOAL-001-*.md` **被静默跳过**，
本 GOAL 自己的记录机器读不到（干跑实测：`goal-store.ts get GOAL-001` 退出码 1）。

**改名不是品味问题**：「阶段」在语义上排斥并发——没有人会说「当前有 3 个当前阶段」——
而人裁定要求同时推进多条 goal；且 store 已叫 `goal-store`、路由 `/goal`、导航 `Goals`，
唯独记录 id 前缀是 `PHASE-`，命名今天就是内部打架的。

**`draft` 是推导出来的硬性缺口，不是新功能**：现状态词表（`:46`）无「写好但未启动」态，
且 `write()` 默认 `status="active"`（`:258`）⇒ 写入即激活；叠加后续的硬上限（I1′）会把**撰写**
也堵死，而上限本该只约束**激活**。该状态在散文里早已存在（`manager-phase-goal.md:174`
「📋 下一阶段（已创建，未启动）」）。

**相关但不同的既有任务**：`gap-spec-goal-store-third-sibling-kind`（done）建了这个 store；
本任务不是重建它，是改造并启用它。

## Plan

1. `goal-store.ts`：`PHASE_ID_RE` → `GOAL_ID_RE`（`/^GOAL-\d{3,}$/`）；`isPhaseId` → `isGoalId`；
   `:168` list 前缀过滤 `PHASE-` → `GOAL-`；`activePhases`/`listActive`/`isPhaseAchieved`/
   `checkExactlyOneActivePhase` 随之改名；`:260` kind 派生值 `phase` → `goal`。
2. frontmatter 字段 `phase:` → `goal:`：`OWNED_KEYS`（`:53-56`）、`:261` 赋值、`:270-272` 必填校验、
   `GoalFrontmatter`/`GoalFilter`/`GoalViewModel` 接口、CLI `--phase` flag（`:385`）、
   ordered 键序（`:307-310`）。
3. `:46` `VALID_GOAL_STATUSES` 增加 `draft`；`:258` 默认 status 由 `active` 改为 `draft`。
4. `OWNED_KEYS` 与 ordered 键序增加 `activatedAt`、`labels`（SPEC §3.1 的富 meta 字段）。
5. `serve-goal.ts`：列表列与详情 meta 的 `phase` 改 `goal`，筛选参数同改。
6. `gate/factories/goal.ts:24` 注释里的 `PHASE-NNN` 改 `GOAL-NNN`。
7. 测试与 fixture：`goal-store.test.mjs`、`goal-gate.test.mjs`、`serve-goal-doc.test.mjs` 全量改；
   **`serve-nav-inconsistent-routes.test.mjs:101` 与 `webui-modernist-sync.test.mjs:65` 的 fixture
   里写死了 `phase: PHASE-101` / `phase: PHASE-001`，必须同改**（已实测确认）。
8. 补负控制单测：`draft` 状态的 GOAL 不进 `activeGoals()`，其 AC 不进 `listActive()`。

**⛔ 保号约束**：`AC_ID_RE`（`/^AC-\d{3,}$/`）与 AC 编号**一律不动**。
约 20 处生产代码注释（`driver-runtime.ts:4`、`promotion-driver.ts:9,57,185`、
`tick-core-static-check.ts:17,40,105` 等）与 4 个测试断言现有 AC 编号，断裂即静默失效。

**⚠️ `plugin/vendor/quay/dist/quay.js` 未被 git 跟踪**（实测 `git ls-files --error-unmatch` 失败），
是本地构建产物，不入 Touches、不手改。

**⚠️ 立案后补入 Touches（2026-09-06，立案者的遗漏，非执行者越界）**：
新增一个 `orchestration/SPEC-*.md` **必须在 2 个声明点注册** `<!-- reference-doc: ... -->`
（`plugin/skills/init/SKILL.md` 已有 67 条同款，`plugin/skills/manager/SKILL.md` 一条），
否则 `spec-declaration-point-check.ts` **全库红**。该检查器不在 pre-commit 的 doc-check 集内，
所以 SPEC 提交当时没被拦住。develop 侧已由 `gap-manager-skill-session-embodiment-activation`
（`909b9fd62`，已 done、不在飞）补齐 ⇒ **本任务 worktree 里若已暂存同一行，merge develop 后
可能出现重复行，以 develop 侧为准去重即可，不要再加第二条。**

## Acceptance Criteria

- [x] `node packages/quay/src/goal-store.ts get GOAL-001 >/dev/null 2>&1` 退出 0（AC-170 判据，今天取假）
- [x] `node packages/quay/src/goal-store.ts get AC-170 >/dev/null 2>&1` 退出 0（保号未破）
- [x] `grep -rc 'phase: PHASE-' packages/quay/test/ | grep -v ':0$' | wc -l` 输出 0（两个 fixture 已同改）
- [x] 单测断言：`write()` 不传 status 时落盘 `status: draft`（默认不激活）
- [x] 单测断言（负控制）：`draft` 状态的 GOAL 不出现在 `activeGoals()` 返回值中
- [x] `bash scripts/test.sh --for-task gap-goal-store-goal-id-vocabulary-and-draft-status` 退出 0

## Definition of Done

**验收对象是【已落盘的生产记录变得可读】，不是【新增了一个能识别 GOAL 前缀的函数】。**
`goals/GOAL-001-goal-mechanism-enablement.md` 经 `goal-store` CLI 在生产工作树上真实读出
（不是测试 fixture 读出），且 `goals/AC-170-*.md` 的 criterion 在该工作树上跑出退出码 0。
scoped 门绿，且 `git show develop:packages/quay/src/goal-store.ts` 含 `GOAL_ID_RE`。
仅测试绿而 `goals/` 下的真实记录仍读不出 ⇒ 不算完成。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/src/serve-goal.ts
- packages/quay/src/gate/factories/goal.ts
- packages/quay/test/goal-store.test.mjs
- packages/quay/test/goal-gate.test.mjs
- packages/quay/test/serve-goal-doc.test.mjs
- packages/quay/test/serve-nav-inconsistent-routes.test.mjs
- packages/quay/test/webui-modernist-sync.test.mjs
- plugin/skills/init/SKILL.md
- plugin/skills/manager/SKILL.md
- tasks/gap-goal-store-goal-id-vocabulary-and-draft-status.md
