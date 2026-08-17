---
id: gap-direct-to-develop-exclude-cron-registry-receipt
title: direct-to-develop-bypass-check 排除集加
  plugin/scripts/outer-cron-registry.json（AC81 git 跟踪遥测收据，冷启动 cron 重建必直写且无
  fan-in 路——发生率 3：f9577da1/167b7052/f882ad76）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**问题**：`direct-to-develop-bypass-check.ts` 把 `plugin/scripts/outer-cron-registry.json` 判为代码/断言面（不在 `DESIGN_INTERNAL_RE` 排除集内）。该文件是 **AC81 的 git 跟踪注册表收据**（cron id / 表达式 / prompt sha256 / verifiedAt），**冷启动 cron 重建必须直写 develop**——CronCreate 是会话级动作（进程被杀 → cron 随会话消失 → 按 AC81 四判据清扫重建），**没有对应的任务/worktree/fan-in 路径**（fan-in-execute.js 无 task 即 bad-args）。⇒ 每次冷启动 cron 重建都产生一条直写该文件的 commit，被 bypass-check 报红，阻断其后所有 fan-in。

**发生率（2026-08-17 冷启动实测）**：f9577da1（inner AC81 锚重建，OOM 死会话，manager 已 ruled one-off）+ **167b7052（inner cron 重建）+ f882ad76（outer cron 重建）** = **3 次**同一类。f9577da1 走的是 ruled 表一次性豁免——**按 commit 逐条豁免不可扩展**（每次冷启动都要新增 ruled 条目），正确修法是结构性排除该文件（同 `plugin/skills/manager/**` 先例：`gap-direct-to-develop-exclude-manager-skill-granularity`——"manager 独占 + 走不了 fan-in 路" 同一理由）。

**⛔ 范围**：只加 `plugin/scripts/outer-cron-registry.json` 这一个**精确文件路径**，不加 `plugin/scripts/outer-cron-registry.ts`（读它的 verifier 是产品机件，直改必须仍红）、不加 `plugin/scripts/**`（会掩盖真直投）。

**能取假（⊢ 对照）**：
- 加后：167b7052 / f882ad76 / f9577da1（回放）→ design-internal → GREEN。
- 加后：直改 `plugin/scripts/outer-cron-registry.ts`（verifier 机件）必须**仍红**——排除粒度到 json 收据，不掩 verifier 直改。
- 加后：`--baseline b11ce720` enforcement 判定 → `ok: true`。

## Plan

1. `plugin/scripts/direct-to-develop-bypass-check.ts` `DESIGN_INTERNAL_RE` 加 `plugin\/scripts\/outer-cron-registry[.]json`（精确路径，正则转义 `.`）。
2. `plugin/test/direct-to-develop-bypass-check.test.mjs`：`isDesignInternalPath` 正例加该 json；负例加 `plugin/scripts/outer-cron-registry.ts`（仍红，AC 能取假）。
3. 跑 `bash scripts/test.sh plugin/test/direct-to-develop-bypass-check.test.mjs` 全绿；`bash scripts/test.sh --for-task <本任务> --allow-thin` scoped 门绿。
4. 回放验证：`--baseline b11ce720` enforcement → ok:true；`outer-cron-registry.ts` 直改 fixture → 仍 RED。

## Acceptance Criteria

- [x] AC1: `DESIGN_INTERNAL_RE` 含 `plugin/scripts/outer-cron-registry.json`（精确路径）。
- [x] AC2: 回放——167b7052 / f882ad76 的 bypass-check 判定转 design-internal（GREEN）；`--baseline b11ce720` enforcement 报 `ok: true`。
- [x] AC3: ⛔ 粒度——`plugin/scripts/outer-cron-registry.ts`（verifier 机件）仍判 code-surface（RED），`plugin/scripts/**` 未排除。
- [x] AC4: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [x] `plugin/scripts/outer-cron-registry.json` 进 design-internal 排除集（json 收据转绿、verifier .ts 仍红）+ 测试绿 + enforcement `ok:true`。

## Evidence

**实现**：`DESIGN_INTERNAL_RE` 加 `plugin\/scripts\/outer-cron-registry[.]json$`（精确路径，`[.]` 转义点号；只豁免 json 收据）。

**取假**：① 正例——`isDesignInternalPath("plugin/scripts/outer-cron-registry.json")` = true；② 负例——`plugin/scripts/outer-cron-registry.ts`（verifier 机件）仍 false（RED）；③ 回放——`--baseline b11ce720` enforcement 实跑：`ok: true`（`ac65-authorized-or-ruled-historical-only`），confirmed bypass=0（167b7052/f882ad76 均转 design-internal）。

**验证**：`node --test plugin/test/direct-to-develop-bypass-check.test.mjs` → 30/30 pass；`bash scripts/test.sh --for-task gap-direct-to-develop-exclude-cron-registry-receipt --allow-thin` → EXIT 0，tests 30 / pass 30 / fail 0。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（DESIGN_INTERNAL_RE 加该 json 路径）
- plugin/test/direct-to-develop-bypass-check.test.mjs（正/负例）
- tasks/gap-direct-to-develop-exclude-cron-registry-receipt.md（自身）
