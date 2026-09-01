---
id: gap-manager-adopt-outer-role-check-broken
title: manager-adopt.sh 三态自检查错窗口角色——硬编码 inner-session-check.sh
  检查「inner」，该窗口已随拓扑收敛永不存在，healthy/empty-shell 分支结构性不可达
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**独立生产缺陷，非清理型任务**（拆自 `gap-retire-inner-session-references` 收尾时的实测发现，2026-09-01）。`manager-adopt.sh:37` 三态 cold-start 自检（healthy/empty-shell/missing）调用 `CHECKER="${SCRIPT_DIR}/inner-session-check.sh"`，且**没有传任何角色参数**；而 `inner-session-check.sh` 内部把窗口角色硬编码为 `"inner"`（`window_exists "$SESSION" "inner"` / `has_claude_child "$SESSION" "inner"`）。`manager-adopt.sh` 自己的文档说是"启动一个项目的 outer（三态）"——即它以为自己在检查 **outer** 会话，实际调的检查器却永远在找一个叫 `"inner"` 的窗口。

`gap-retire-inner-session-references` AC1 落地后拓扑已收敛为单窗口 `outer`（`quay-topology.sh --dry-run` 只建 `outer`），"inner" 窗口**永不存在**——所以 `healthy`/`empty-shell` 两个分支已经结构性不可达，`manager-adopt.sh` 每次都会误判 `state=missing` 去重建，**违背三态检查"绝不误杀健康会话"的设计目的**。

**测试盲区确认**：`manager-productization.test.mjs` 的 AC1/AC7（现有唯一相关覆盖）只驱动 `quay manager adopt <root> --dry-run` 对着一个**不存在**的 tmux session 跑，只走到 `state=missing` 分支——从未验证过角色匹配对不对，所以这个缺陷现有测试套件里没有任何回归会报红。

## Plan

1. 造一个新的三态检查器（复用 `inner-session-check.sh` 的状态机形状——`window_exists`/`has_claude_child`/`transcript_fresh` 三段判据不变，只把硬编码角色字符串从 `"inner"` 换成 `"outer"`），命名不含 `inner`（如 `outer-session-check.sh`）。
2. `manager-adopt.sh:37` 的 `CHECKER` 改指向新脚本。
3. 补回归测试：驱动一个**真实存在 outer 窗口**的场景，断言 state=healthy（或 empty-shell，视窗口内是否有 claude 子进程）；驱动一个不存在的场景断言 state=missing——`manager-productization.test.mjs` 目前只测了 missing 分支，这是当前测试的真实缺口，必须补上 healthy 分支才算真的验证了这个修复。
4. 新脚本注册进 `capability-catalog.sh`（六表）+ 视 `inner-session-check.sh` 原有铺设面决定是否也要进 `quay-init.sh` 铺设集。

## Acceptance Criteria

- [x] AC1（能取假，识别正确窗口）：新检查器对一个真实存在的 `"outer"` 窗口（hermetic tmux fixture）返回 `healthy`/`empty-shell` 中的正确一态（非 `missing`）；对不存在的窗口返回 `missing`。⛔ 对着存在的 outer 窗口仍返回 `missing` ⇒ 假——这正是当前缺陷的复现判据，必须先能复现再验证修复。
- [x] AC2（能取假，manager-adopt 消费新检查器）：`manager-adopt.sh` 走新检查器（grep 确认 `CHECKER` 指向新文件名，不再指向 `inner-session-check.sh`）；对着一个真实存在 outer 窗口的场景跑 `quay manager adopt <root> --dry-run` 得 `state != missing`。
- [x] AC3（能取假，回归覆盖补齐）：`manager-productization.test.mjs` 新增至少一条 healthy-branch（或 empty-shell-branch）测试并绿；⛔ 只有 missing 分支覆盖 ⇒ 假（与修复前的盲区同形）。

## Definition of Done

新三态检查器创建并覆盖 healthy/empty-shell/missing 三态、`manager-adopt.sh` 切换到位、healthy 分支有真实回归测试（不再是只测 missing 的假覆盖）、catalog 注册、typecheck 与相关测试绿。

## Touches

- plugin/scripts/outer-session-check.sh（新：三态检查器，角色="outer"）
- plugin/test/outer-session-check.test.mjs（新：状态机测试，复用 inner-session-check.test.mjs 的测试形状换角色）
- plugin/scripts/manager-adopt.sh（CHECKER 指向切换）
- plugin/scripts/capability-catalog.sh（新脚本六表注册）
- plugin/scripts/quay-init.sh（铺设集，若原 inner-session-check.sh 有铺设面）
- plugin/test/manager-productization.test.mjs（新增 healthy 分支回归测试，AC1/AC7 附近）
- tasks/gap-manager-adopt-outer-role-check-broken.md（自身）
