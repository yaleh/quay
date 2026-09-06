---
id: gap-tmux-retirement-docs-update
title: 文档更新——tmux 退役后的描述调整（CLAUDE.md/README/SPEC/ADR/skill 文档）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-manager-liveness-field-outer-tmux-gone
    - gap-manager-skill-session-embodiment-activation
---
## Proposal

**tmux 退役工程的前期代码改动（Task 1-4）落地后，文档需要同步更新以反映新的架构和启用流程。**

截至 2026-09-04，tmux 退役工程分两个阶段：
1. **Phase 1-2（已完成）**：删除 outer tmux 依赖（Task 1） + 新增 drivers skill（Task 2）
2. **Phase 3-4（进行中）**：重评 manager-liveness 字段（Task 4） + 改造 manager skill（Task 3）

Task 3 和 Task 4 完成后，文档中对 tmux 依赖、启用流程、manager 启动方式的描述都有变化，需要一次集中的文档同步，避免新旧描述混在一起造成混淆。

**要更新的文档位置**（SPEC §7 Task 7 列清）：
1. `CLAUDE.md` — 第 §"Commands" 部分对 `quay manager start` / tmux 会话启动的描述（改为"见 plugin/skills/manager/SKILL.md"）
2. `README.md` — 概览和启用流程部分对 outer 依赖的提及、对"手动启动 Claude Code 会话"的步骤描述
3. `orchestration/SPEC-tmux-retirement-2026-09-03.md` — 补充结论段（已完成各阶段的总结、技术架构调整证明）
4. `plugin/skills/manager/SKILL.md` — 由 Task 3 改造后，此处列出的是该 skill 对外的接口和幂等性承诺
5. `plugin/skills/cold-start/SKILL.md` — 若其中有对 outer/tmux 的假设（如"会启动 outer 会话"），需要清理
6. `plugin/skills/session-topology/SKILL.md` — 若其中有对两窗口 outer/inner 拓扑的过时描述，需要更新（§4 非目标：SPEC 文档不在本任务重写范围）
7. 相关 ADR（如存在）— `adr/ADR-016.md` 等若提及 tmux 依赖已退役，补上交叉引用

**不包含的范围**（§4 非目标）：
- `cold-start`/`session-topology` 两份 skill 文档的深层重写（它们描述的拓扑仍然过时，建议单独立案更新）
- AC149 的验证/修复
- 测试基础设施 tmux 用量的改动
- `orchestrator-tick-core.md` / `manager-tick-core.md` / `manager-loop-tick.md` 三份执行核文档的 outer 过时描述（体量更大、另案追踪，不在本任务范围）

## AC

- [x] `CLAUDE.md` 中对 `quay manager start` / tmux 启动的描述已更新，指向 `plugin/skills/manager/SKILL.md` 作为新的推荐路线
- [x] `README.md` 的"启用流程"部分已同步，列出 ① 安装 ② 手动启动 Claude Code ③ 调用 init skill ④ 调用 drivers skill ⑤ 调用 manager skill，无过时的"启动 outer"步骤
- [x] `orchestration/SPEC-tmux-retirement-2026-09-03.md` 补充"结论段"，记录各 Phase 的成果（Task 1-4 全部 done 时的最终状态）
- [x] `plugin/skills/manager/SKILL.md` 的第 136 行 `## How the manager itself starts` 部分已由 Task 3 改造，此处文档与新代码一致
- [x] `plugin/skills/cold-start/SKILL.md` 中若提及"会启动 outer"的假设，已清理（说明：outer 已删除，cold-start 不应提及）
- [x] `adr/ADR-016.md` 等若涉及 tmux 依赖，已补充交叉引用说明"tmux 依赖已于 2026-09-04 退役，见 SPEC-tmux-retirement-2026-09-03.md"
- [x] 跨文档 grep 验证：`grep -r "quay-topology\|outer-session-check\|outer tmux" docs/ orchestration/ plugin/skills/ --include="*.md"` 无过时引用指向已删除的脚本
- [x] `plugin/test/manager-layer-shipping.test.mjs` AC8 的守卫正则已收窄，不再对合规的 `/quay:manager` skill 调用提法误报为假阳性，且同时具备正控制（断言该提法本身仍存在于 cold-start 文本中）与负控制（断言一个真实违规字符串——如未被 `/quay:...` skill 提法包裹的 `quay-launch.sh manager` 或 tmux `:manager` 窗口键——依然被守卫捕获），经 `scripts/test.sh plugin/test/manager-layer-shipping.test.mjs` 验证通过。
- [x] `CLAUDE.md` 中"每轮必经"表格 pane-状态一行（紧邻 `pane-state-classify.ts` 指针）里过时的"outer 未退役（人 2026-09-01 裁定…）"表述，已依据 `orchestration/SPEC-tmux-retirement-2026-09-03.md` §8 的结论（outer 的会话角色已于 2026-09-04 退役，gap-retire-outer-tmux-window-logic done）更正，且不触碰另案追踪的三份执行核文档（`orchestrator-tick-core.md` / `manager-tick-core.md` / `manager-loop-tick.md`）。

## DoD

落地后，任何新用户读 README → CLAUDE.md → 相关 SPEC/skill 文档，都能看到一致的、现态的启用流程描述：
- 不再提及 outer 作为独立 tmux 会话
- 默认路线是"手动启动 Claude Code，会话内调用 skill"
- 不混杂新旧两套启动方式的描述（若确实要保留备选路线，明确标注为"备选"或"其他启动方式"）
- 所有交叉引用和链接都指向有效、现态的内容（不指向已删除的脚本或过时的机制）
- `plugin/test/manager-layer-shipping.test.mjs` 的 AC8 守卫不再阻挡合规的 `/quay:manager` skill 提法落地，且守卫仍能捕获真实的 tmux/shell 启动方式违规（双向检查，硬规则 2）。

## Touches

- CLAUDE.md
- README.md
- orchestration/SPEC-tmux-retirement-2026-09-03.md
- plugin/skills/manager/SKILL.md（参考，由 Task 3 改造）
- plugin/skills/cold-start/SKILL.md
- plugin/skills/session-topology/SKILL.md（若需清理过时描述）
- adr/ADR-016-cross-workspace-autonomous-operation-via-tmux-remote-drive.md
- docs/proposals/*.md（若有对 tmux 依赖的讨论）
- plugin/test/manager-layer-shipping.test.mjs
- tasks/gap-tmux-retirement-docs-update.md
## Needs-Human

**执行 2026-09-06T06:37:25.873Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: cold-start must not instruct starting a manager window (AC8)
- run_id：wk-prod-1788285192
- session_id：d67c8f96-2d88-4aff-865c-91cb59e51f1c
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-tmux-retirement-docs-update~wk-prod-1788285192~1788675769757-d85f8e.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-tmux-retirement-docs-update-wk-prod-1788285192.log

## Diagnosis (2026-09-06)

**结论：3 次重试全部撞同一个机制性缺陷——不是本任务内容问题，是消费方守卫的假阳性；已诊断，非猜测。**

1. **AC8 假阳性（根因，已直接核实）**：`plugin/test/manager-layer-shipping.test.mjs:126` 的守卫正则

   ```js
   const managerStartHits = cold.split('\n').filter((l) => /manager/i.test(l) &&
     /(quay-launch\.sh manager|:manager|manager 窗口|manager window)/i.test(l));
   ```

   来自另一个**已 done** 的任务（gap-productize-the-manager-layer），其中的 `:manager` 分支意图是捕获
   shell/tmux 窗口启动形态（如 `quay-launch.sh manager` 或 tmux `:manager` 窗口键），但作为裸子串也会
   命中本任务在 worktree（`/home/yale/work/quay-worktrees/gap-tmux-retirement-docs-update`，分支
   `task/gap-tmux-retirement-docs-update`）里对 `plugin/skills/cold-start/SKILL.md` 的正确改动——新增的
   启用流程提法 `① install ② start a Claude Code session ③ /quay:init ④ /quay:drivers ⑤ /quay:manager`。
   已用该正则在 Node 里对该 worktree 编辑后的 `plugin/skills/cold-start/SKILL.md` 实测，唯一命中行是：
   `"③ /quay:init ④ /quay:drivers ⑤ /quay:manager** — there is no \"start outer\" step. The"`——
   这是对合规 skill 调用提法 `/quay:manager` 的误伤，不是内容缺陷。在正则不改的前提下，本任务自身的
   AC/DoD（把 `/quay:manager` 文档化为 manager 的官方启动方式）与 AC8 结构上互斥，3 次 worker 独立尝试
   全部卡在同一点即是此互斥的直接证据。

   **建议修法**（已加入本次 AC，交下一个 worker 实现）：

   ```js
   const SANCTIONED_MANAGER_SKILL_MENTION = /\/quay:manager\b/;
   const managerStartHits = cold.split('\n')
     .filter((l) => !SANCTIONED_MANAGER_SKILL_MENTION.test(l))
     .filter((l) => /manager/i.test(l) && /(quay-launch\.sh manager|:manager|manager 窗口|manager window)/i.test(l));
   assert.deepEqual(managerStartHits, [], 'cold-start must not instruct starting a manager window (AC8)');
   // Positive control: the sanctioned skill-invocation mention itself must still be present (the exclusion
   // above must not silently swallow real content) — dual-direction check discipline (硬规则 2).
   assert.match(cold, SANCTIONED_MANAGER_SKILL_MENTION, 'cold-start should reference /quay:manager as the sanctioned manager-start form');
   ```

   连同一条**负控制**（对一个含真实违规——例如未被 `/quay:...` 包裹的 `quay-launch.sh manager` 或裸
   tmux `:manager` 窗口键——的合成字符串跑同一个收窄后的正则，确认它依然被捕获），证明收窄没有把守卫
   本身削弱成空转（硬规则 3b：判定机件在改动后不得从"能报红"退化为恒绿）。

2. **CLAUDE.md 陈旧的 outer 表述（次要，已直接核实）**：同一 worktree 的
   `CLAUDE.md` 第 17 行仍保留 "**inner(fast-mode) 已退役,outer 未退役(人 2026-09-01 裁定,推翻早前 AC149
   对 outer 的标注)**"——这与该 worktree 自己新增的 `orchestration/SPEC-tmux-retirement-2026-09-03.md`
   §8（outer 的会话角色已于 2026-09-04 退役，gap-retire-outer-tmux-window-logic done）直接矛盾，也与本
   任务自身 DoD 的"不再提及 outer 作为独立 tmux 会话"冲突。该行在本任务已声明的 Touches（`CLAUDE.md`）
   与 DoD 范围内，应在本轮同步更正；**不要**顺手改 `orchestrator-tick-core.md` / `manager-tick-core.md` /
   `manager-loop-tick.md`——那三份执行核文档的过时问题体量更大、超出本任务范围，留待另案追踪。

**依赖确认**：`gap-manager-liveness-field-outer-tmux-gone`、`gap-manager-skill-session-embodiment-activation`
均已在 develop 上确认 `status: done`，本任务此前唯一的真实阻碍（AC8 假阳性）已诊断并附具体修法，判定为
机械性阻碍已解除（非范围/优先级裁定），复位 `status: needs-human → ready`，交由下一个 worker 按新增
AC 实现。
