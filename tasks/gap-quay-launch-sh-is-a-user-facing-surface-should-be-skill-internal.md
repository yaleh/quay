---
id: gap-quay-launch-sh-is-a-user-facing-surface-should-be-skill-internal
title: "quay-launch.sh is documented in 4 SKILL.md files (init/manager/cold-start/session-topology)
  as 'the launch command' a human/agent runs directly, not hidden behind a skill action — it DOES
  have real internal callers (session-bootstrap.sh, quay-topology.sh) and real test coverage
  (4 test files: launch-settings/manager-layer-skill/manager-layer-shipping/session-topology), so
  it is not dead code, but it conflates two roles: (a) legitimate internal implementation detail
  consumed by session-bootstrap.sh, and (b) a bare shell script users/agents are told to invoke
  directly — human ruling 2026-08-06: it should not itself be a product-facing deliverable; a skill
  is the interface users are accustomed to, and this wrapper script must become that skill's OWN
  inner implementation, not the thing pointed at directly; manager 2026-08-06, filed per human
  direction to transfer to outer"
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**`quay-launch.sh` 目前身兼两职，人裁定只该留一个。**

### 实测（现状普查）

| 项 | 结果 |
|---|---|
| 有真实内部调用方 | `session-bootstrap.sh`、`quay-topology.sh`——这一半是**正当的实现细节**，不该删 |
| 有真实测试覆盖 | `launch-settings.test.mjs` / `manager-layer-skill.test.mjs` / `manager-layer-shipping.test.mjs` / `session-topology.test.mjs`——**不是"测试也不用"的情况** |
| 被 4 个 SKILL.md 文档引用 | `init` / `manager` / `cold-start` / `session-topology`——但引用方式是**表格描述"launch command 是 `quay-launch.sh <role>`"**，即教读者直接去跑这个 `.sh`，不是 skill 自己在内部调用后隐藏掉 |

**人的裁定原话**："quay-launch.sh 不应作为产品交付物，而只能作为内部测试用（如果测试也不用就应当删除）。
skill 才是用户更习惯的方式，也是这个套壳脚本自身也必须用的更内层实现。"

按实测结果，"测试也不用就删除"这个条件**不成立**（有真实测试覆盖）——所以按人裁定的逻辑，
落点是**保留，但收窄为纯内部实现，不再是用户/agent 直接调用的对象**。

### 性质

这跟今晚立案的另一条（manager 手里出现 `.sh`/`.ts` 即越界）是同一个原则的另一面：
**面向用户/agent 的交互面应当是 skill，脚本应当是 skill 背后看不见的管道。**
`quay-launch.sh` 现在的问题不是它不该存在，是它被**文档化成了用户该直接触碰的东西**。

## Contract

```
measure skill_wraps_launch = `grep -l "quay-launch.sh" plugin/skills/*/SKILL.md | xargs grep -lc "Method" | wc -l` stdout 的数字段（内部调用而非仅描述的 skill 数）
band skill_wraps_launch = 1
measure skill_docs_reference_bare_script = `grep -rc "quay-launch.sh <role>\|bash.*quay-launch" plugin/skills/*/SKILL.md | awk -F: '{s+=$2} END{print s}'` stdout 的数字段
band skill_docs_reference_bare_script = 0
measure package_files_exclude_or_internal = `python3 -c "import json;print('plugin' in json.load(open('packages/quay/package.json')).get('files',[]))"` stdout 的布尔字段
invariant quay-launch.sh 的调用方只能是仓库内其他脚本/skill 的内部实现，不得出现在任何面向用户的操作说明里
invoke `grep -rn "quay-launch.sh <role>\|bash.*quay-launch" plugin/skills/*/SKILL.md`
control 改动前先贴出 4 处"直接运行"措辞的原文；改动后同一处 grep 必须为 0
resume 若中断，先跑 measure 读当前 4 个 SKILL.md 的引用方式，不要假设已经改完
```

## Acceptance Criteria

- [ ] AC1: 4 个 SKILL.md（init/manager/cold-start/session-topology）里"直接运行 quay-launch.sh"
      的措辞全部改为"由 skill 内部处理"，贴出改前/改后对照
- [ ] AC2: 至少一个 skill（建议 `session-topology`，因为它已经是拓扑相关的自然归属）新增或改造
      Method 步骤，在其内部调用 `quay-launch.sh`，用户/agent 不再需要知道这个文件名
- [ ] AC3: `verify-delivery-surface.ts` / `capability-catalog.sh` 若把 quay-launch.sh 列为
      面向用户的能力，改为标注"内部实现，非用户直接调用面"（参照 os-anchor 那次的排除写法：
      `gap-observer-registry` 同批任务里用过的模式，保留能力描述，标注调用边界）
- [ ] AC4: **不得删除**——4 个测试文件的覆盖必须保持，任务体需说明为什么这次是"收窄边界"
      而不是人原话条件句里的"删除"分支
- [ ] AC5: 与 `gap-manager-skill-missing-mandatory-tool-reuse-checklist` 交叉标注——
      两条都在处理"脚本 vs skill 该由谁面向用户"这同一条边界原则的不同侧面

## Definition of Done

- [ ] AC1-AC5 实跑输出/文件片段贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- plugin/skills/init/SKILL.md
- plugin/skills/manager/SKILL.md
- plugin/skills/cold-start/SKILL.md
- plugin/skills/session-topology/SKILL.md
- plugin/scripts/quay-launch.sh
- plugin/scripts/capability-catalog.sh
- plugin/scripts/verify-delivery-surface.ts

## Dispatch review

reviewer: none
at: 2026-08-06T16:1xZ
changed: 尚未派发/审阅（人直接裁定立案并转外层，管理者代笔）
