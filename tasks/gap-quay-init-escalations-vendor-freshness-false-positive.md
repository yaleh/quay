---
id: gap-quay-init-escalations-vendor-freshness-false-positive
title: quay-init vendor-freshness 误判 orchestration/escalations.md referenced-not-landed——self-create 声明已存在但 check 读不到
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

`plugin/test/quay-init-loop-vendor-freshness-passes.test.mjs` AC2 红：`FAIL (referenced-not-landed): orchestration/escalations.md — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md`（判定点 `plugin/scripts/quay-init.sh:1436`）。

**但逐行核实（假阳性嫌疑）**：
- `plugin/skills/init/SKILL.md:143` **已有** `<!-- self-create: orchestration/escalations.md -->`（且 :108 有 laydown 表格行）；
- `orchestration/escalations.md` 文件存在于 repo（56112 B）；
- 该文件被 10+ shipped doc 引用（orchestration/*.md + init/SKILL.md）。

⇒「not declared」与「not existing」都不成立。escalations.md 是 self-create（outer tick 创建），vendor-freshness 在 loop 未跑时判它 not-landed。

**根因方向（二选一，待 worker 定位）**：
1. check 的 fresh-read（`quay-init.sh:1425-1427`）读 `$PLUGIN_ROOT/skills/init/SKILL.md` 是 **stale vendored bundle**（laid-down 快照早于 :143 的 self-create 声明加入），非当前 plugin source；
2. `_read_declarations`（`quay-init.sh:1355`）对 self-create 的解析有缺口，未把 escalations 计入 declared 集合。

## Plan

1. 定位 `$PLUGIN_ROOT` 指向（repo 源 vs workspace laid-down 快照），确认 vendored bundle 是否 stale（init/SKILL.md 快照是否含 :143 self-create）。
2. 修：sync vendored bundle（或改 `_read_declarations` 补 self-create 解析），使 self-create 声明计入 declared。
3. 验证：vendor-freshness 对 escalations.md 判 landed/declared（不再 referenced-not-landed）。

## Acceptance Criteria

- [ ] AC1（能取假）：`plugin/skills/init/SKILL.md:143` 已有 self-create 声明时，vendor-freshness 对 `orchestration/escalations.md` 不判 referenced-not-landed（check 过）；（⛔ 仍红 ⇒ 假）。
- [ ] AC2（能取假，负控制）：真 undeclared + not-landed 的引用文件仍判 referenced-not-landed（fail-closed 不退化）；（⛔ 误放行 ⇒ 假）。

## Definition of Done

vendored bundle 同步 / `_read_declarations` 补 self-create 解析；AC1/AC2 勾；escalations.md 不再误判；真 drift 仍 fail-closed；全量 suite 绿。

## Touches

- plugin/scripts/quay-init.sh（_read_declarations / fresh-read 对 self-create 的 declared 计数）
- plugin/skills/init/SKILL.md（如 vendored bundle 需同步）
- plugin/test/quay-init-loop-vendor-freshness-passes.test.mjs（对应断言/负控制）
- plugin/test/quay-init.test.mjs（quay-init.sh 主测试——torn 声明读回归测试）
- tasks/gap-quay-init-escalations-vendor-freshness-false-positive.md（自身）
