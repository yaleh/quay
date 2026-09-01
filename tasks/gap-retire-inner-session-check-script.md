---
id: gap-retire-inner-session-check-script
title: 退役 inner-session-check.sh——manager-adopt.sh 已切换新检查器后删旧脚本 +
  全部消费点/测试同步（quay-session/outer-loop-tick-split/quay-init-laydown-closure/orchestrator-loop-tick
  step3）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-manager-adopt-outer-role-check-broken
---
**type:** execution

## Proposal

`inner-session-check.sh`（294 行）100% 是 tmux/pane 逻辑，硬编码窗口角色 `"inner"`（`window_exists`/`has_claude_child` 全部写死该字符串），没有可留的一半。它原本被判①类保留的理由是"被 `inner-exec-mode-report.ts` 复用做 pane-pid→session 反解"，但该复用路径已在 `gap-retire-inner-hygiene-migrate-helper` 落地时随 `main_thread_edits` 判据一起迁到 `main-thread-edit-check.ts`（现为死回退分支，由 `gap-retire-inner-hygiene-delete-session-face` 清理），保留理由已失效——应整体退役，而非之前误判的"改名/改注释"。

**依赖 `gap-manager-adopt-outer-role-check-broken` 先落地**：该任务把 `manager-adopt.sh` 唯一的真实实调消费点切到新造的 `outer-session-check.sh`，本任务才能安全删除旧文件而不留下一个立刻断裂的生产依赖。

除 `manager-adopt.sh` 外还有 4 个**纯引用型消费点**（铺设/注册/文档断言，非功能调用），本任务负责逐一同步：
1. `quay-session.ts:27` 把 `inner-session-check` 注册为 CLI 组成员——`quay-session.test.mjs` 断言精确成员列表 + `list().length === 10`。
2. `outer-loop-tick-split.test.mjs`（`outerOnlyCritical` 列表，约 91 行）断言 `orchestrator-loop-tick.md` 保留对 `inner-session-check.sh` 的引用。
3. `quay-init-laydown-closure.test.mjs`（AC1，约 100-115 行）把它列为三个"依赖闭包铺设"消费脚本之一，证明该机制拉入 `${SCRIPT_DIR}` 同级依赖（`send-keys-reliable.sh` 独立覆盖同一机制，去掉这一项不损失机制覆盖）。
4. `quay-init.sh` 铺设集数组硬编码该文件名。
5. `orchestrator-loop-tick.md` step 3（双副本 `plugin/loop/` + `orchestration/`）——它的 doc wiring 直接点名 `inner-session-check.sh` 与 healthy/empty-shell/missing/degraded 词表，是独立于 `manager-adopt.sh` 的第二个真实消费点，需要在 `gap-manager-adopt-outer-role-check-broken` 落地后同步指向新检查器（不是简单删除，是重新指向）。

## Plan

1. 确认 `gap-manager-adopt-outer-role-check-broken` 已 done（`manager-adopt.sh` 已不再引用 `inner-session-check.sh`）。
2. 删 `plugin/scripts/inner-session-check.sh` + `plugin/test/inner-session-check.test.mjs`（状态机覆盖已被新任务造的 `outer-session-check.test.mjs` 取代）。
3. `quay-session.ts` 去掉 `inner-session-check` 成员（如新检查器也要挂进 quay-session CLI 组，改注册为新成员名）；`quay-session.test.mjs` 成员列表 + 计数同步（10→9，或替换成新成员名维持 10）。
4. `outer-loop-tick-split.test.mjs` 去掉/替换该 list 条目。
5. `quay-init-laydown-closure.test.mjs` 数组去掉 `'inner-session-check.sh'` + docstring 同步；确认 `send-keys-reliable.sh` 仍单独覆盖同一依赖闭包机制。
6. `quay-init.sh` 铺设集数组去掉该文件（若新检查器需要铺设，加入替代项）。
7. `orchestrator-loop-tick.md`（双副本）step 3 的措辞改为指向新检查器（而非遗留引用已删文件名）。

## Acceptance Criteria

- [ ] AC1（能取假，脚本已删且无死引用）：`plugin/scripts/inner-session-check.sh` 不存在；全仓 `grep -rn inner-session-check --include=*.ts --include=*.sh --include=*.md plugin/ orchestration/` 排除历史归档/SPEC 文档后为 0。⛔ 任何非豁免类活文件仍引用该文件名 ⇒ 假。
- [ ] AC2（能取假，5 个消费点全部同步）：`quay-session.test.mjs`（成员列表+计数）、`outer-loop-tick-split.test.mjs`（list 条目）、`quay-init-laydown-closure.test.mjs`（数组+docstring）、`quay-init.sh`（铺设集）、`orchestrator-loop-tick.md`（双副本 step 3 措辞）均已改动且各自测试绿；⛔ 任一项未同步（原样断言旧文件名）⇒ 假。
- [ ] AC3（能取假，无回归）：typecheck + 相关测试绿。

## Definition of Done

`inner-session-check.sh` 与其专属测试删除、5 个消费点全部同步指向新检查器或去除引用、全仓无死引用残留、typecheck 与相关测试绿。

## Touches

- plugin/scripts/inner-session-check.sh（删）
- plugin/test/inner-session-check.test.mjs（删）
- plugin/scripts/quay-session.ts
- plugin/test/quay-session.test.mjs
- plugin/test/outer-loop-tick-split.test.mjs
- plugin/test/quay-init-laydown-closure.test.mjs
- plugin/scripts/quay-init.sh
- plugin/loop/orchestrator-loop-tick.md
- orchestration/orchestrator-loop-tick.md
- tasks/gap-retire-inner-session-check-script.md（自身）
