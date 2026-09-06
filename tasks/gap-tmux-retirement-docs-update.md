---
id: gap-tmux-retirement-docs-update
title: 文档更新——tmux 退役后的描述调整（CLAUDE.md/README/SPEC/ADR/skill 文档）
status: ready
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

## AC

- [x] `CLAUDE.md` 中对 `quay manager start` / tmux 启动的描述已更新，指向 `plugin/skills/manager/SKILL.md` 作为新的推荐路线
- [x] `README.md` 的"启用流程"部分已同步，列出 ① 安装 ② 手动启动 Claude Code ③ 调用 init skill ④ 调用 drivers skill ⑤ 调用 manager skill，无过时的"启动 outer"步骤
- [x] `orchestration/SPEC-tmux-retirement-2026-09-03.md` 补充"结论段"，记录各 Phase 的成果（Task 1-4 全部 done 时的最终状态）
- [x] `plugin/skills/manager/SKILL.md` 的第 136 行 `## How the manager itself starts` 部分已由 Task 3 改造，此处文档与新代码一致
- [x] `plugin/skills/cold-start/SKILL.md` 中若提及"会启动 outer"的假设，已清理（说明：outer 已删除，cold-start 不应提及）
- [x] `adr/ADR-016.md` 等若涉及 tmux 依赖，已补充交叉引用说明"tmux 依赖已于 2026-09-04 退役，见 SPEC-tmux-retirement-2026-09-03.md"
- [x] 跨文档 grep 验证：`grep -r "quay-topology\|outer-session-check\|outer tmux" docs/ orchestration/ plugin/skills/ --include="*.md"` 无过时引用指向已删除的脚本

## DoD

落地后，任何新用户读 README → CLAUDE.md → 相关 SPEC/skill 文档，都能看到一致的、现态的启用流程描述：
- 不再提及 outer 作为独立 tmux 会话
- 默认路线是"手动启动 Claude Code，会话内调用 skill"
- 不混杂新旧两套启动方式的描述（若确实要保留备选路线，明确标注为"备选"或"其他启动方式"）
- 所有交叉引用和链接都指向有效、现态的内容（不指向已删除的脚本或过时的机制）

## Touches

- CLAUDE.md
- README.md
- orchestration/SPEC-tmux-retirement-2026-09-03.md
- plugin/skills/manager/SKILL.md（参考，由 Task 3 改造）
- plugin/skills/cold-start/SKILL.md
- plugin/skills/session-topology/SKILL.md（若需清理过时描述）
- adr/ADR-016-cross-workspace-autonomous-operation-via-tmux-remote-drive.md
- docs/proposals/*.md（若有对 tmux 依赖的讨论）
- tasks/gap-tmux-retirement-docs-update.md