---
id: gap-ac206-goals-tasks-dual-carrier-quay-init-goals-closed-set
title: quay-init 闭集缺 goals/ → 六处同步改动 + verify-deliver 落 ac=GOAL-009-AC-206
  双载体记录（AC-206）
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-206
---
## Proposal

正本判据 `goals/AC-206-目标项目具备-goals-tasks-双载体-goals-与-tasks-一同由-quay-init-创建.md`（goal=GOAL-009，2026-09-09 人裁定④「goals/ 目录应当和 tasks/ 目录一起由 quay-init 创建」）：exit 0 = SPEC 闭集块含 `goals/` ∧ `CLOSED_SET_DIRS` 含 `goals` ∧ `quay-init.sh` 真的 `mkdir -p "$WORKSPACE_ROOT/goals"` ∧ 载体 `.quay/productization-verification.jsonl` 存在 `ac="GOAL-009-AC-206"` 记录（host≠本机、非本仓库项目、`goals_dir_created`/`tasks_dir_created`/`goal_store_readable`/`task_store_readable` 均 True）。exit 1 = 任一不成立；exit 3 = SPEC 块/常量读不出。

**现状（实测，位置判定）**：2026-09-09 干跑 exit 1 报 "SPEC closed set lacks goals/"。SPEC 闭集块（`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` QUAY-INIT-CLOSED-SET，:163-170）只有 6 项、无 `goals/`；`plugin/scripts/quay-init-closure-assertion.ts:36` `CLOSED_SET_DIRS = ["tasks"]`；`quay-init.sh:2232` 只 `mkdir -p "$WORKSPACE_ROOT/tasks"`；载体四字段（`goals_dir_created` 等）全仓库零命中——无人写。

**修法（两半，缺一 criterion 仍 exit 1）**：

A. **六处同步改动**（AC 正本判据读①②③；硬规则 5b：修好一个 ≠ 只在一处）：
① SPEC 闭集块加 `- goals/`（`verify-deliver-coldstart.sh:568` 解析、闭集唯一正本）；
② `quay-init.sh` dry-run 文案加 `would-create: goals/` + 真跑 `mkdir -p "$WORKSPACE_ROOT/goals"` + `created: goals/`；
③ `quay-init-closure-assertion.ts:36` `CLOSED_SET_DIRS` 加 `"goals"`；
④ `docs/analysis/quay-init-closure-ratchet.baseline.json` 机械 `--reanchor`（⛔ 非手工并 JSON）；
⑤ `plugin/scripts/laydown-set-check.sh` 同步加 `goals/` 条目（与闭集一致）；
⑥ `plugin/test/quay-init*.test.mjs` 五个测试同步断言（closure-ratchet / laydown-closure / loop / tmux-detection / quay-init）。

B. **载体写**（criterion exit 0 的另一半）：`plugin/scripts/verify-deliver-coldstart.sh` 在 `--ac89` 追加面新增一条 `ac="GOAL-009-AC-206"` 记录，top-level 字段 `{ts, ac, host, project_root, goals_dir_created, tasks_dir_created, goal_store_readable, task_store_readable}`——校验目标项目 `goals/` 与 `tasks/` 均创建、两 store（`goals/*.md` 与 `tasks/*.md`）均可读。⛔ 缺输入不写/如实写 False（硬规则 3b，缺值≠合格）。

相关（非重复）：`gap-ac168-quay-init-contract-closed-set`（AC-168，闭集收缩机制的来源，done）——本任务是在其产出的 6 项闭集上**新增** `goals/`。

## Acceptance Criteria

- [x] AC1 机制六处落地：`grep -c '^- goals/$'` SPEC 闭集块 ≥1、`grep -c '"goals"' quay-init-closure-assertion.ts` ≥1、`grep -Fc 'mkdir -p "$WORKSPACE_ROOT/goals"' quay-init.sh` ≥1，各贴前 3 条命中（硬规则②）。
- [x] AC2 干跑：本仓库 `quay-init.sh --dry-run` 输出含 `would-create: goals/`；对真实 laydown 跑闭集断言——含 `goals/` 时 PASS、删除 `goals/` 的负样本 FAIL（能取假，非恒绿）。
- [x] AC3 判据前半翻转：`bash -c "$(criterion)"` 不再打印 "SPEC closed set lacks goals/" / "CLOSED_SET_DIRS lacks goals" / "does not create goals/"——后半（载体）此时为 exit 1 或 3（无记录/载体），是如实读数。
- [x] AC4 载体写 + selfcheck：`verify-deliver-coldstart.sh --ac89` 追加 `ac="GOAL-009-AC-206"` 记录，四字段均布尔、`host`/`project_root` 非空；`--selfcheck` 正/负控制——正：注入已建 goals/+tasks/ 且两 store 可读 ⇒ 四字段 True；负：goals/ 缺失 ⇒ `goals_dir_created=false`（仍写、criterion 不 exit 0，如实非静默）。
- [x] AC5 判据双向控制（注入后移除，不污染生产载体）：向载体注入一条 `ac="GOAL-009-AC-206"`、`host=注入假主机≠本机`、`project_root=第三方路径`、四字段全 True 的记录 ⇒ criterion exit 0；改 `goals_dir_created=false` ⇒ criterion exit 1。两条注入记录验证后均移除。

## Definition of Done

- [x] AC1–AC5 全绿；`scripts/test.sh`（含 quay-init 五测试 + verify-deliver-coldstart.test.mjs）全绿。
- [x] AC-206 criterion 可被满足且能取假（AC5 正/负控制为证）。⛔ 本任务到「goals+tasks 双载体」代码层；真实 host≠本机、非本仓库项目的生产记录由下游跨主机验证轮（verify-deliver-coldstart 对 B/C 跑）落盘，是 AC-207 端到端主题、非本任务代码范围。

## Touches

- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
- plugin/scripts/quay-init.sh
- plugin/scripts/quay-init-closure-assertion.ts
- docs/analysis/quay-init-closure-ratchet.baseline.json
- plugin/scripts/laydown-set-check.sh
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/quay-init-closure-ratchet.test.mjs
- plugin/test/quay-init-laydown-closure.test.mjs
- plugin/test/quay-init-loop.test.mjs
- plugin/test/quay-init-tmux-detection.test.mjs
- plugin/test/quay-init.test.mjs
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac206-goals-tasks-dual-carrier-quay-init-goals-closed-set.md