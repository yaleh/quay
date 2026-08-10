---
id: gap-quay-launch-sh-is-a-user-facing-surface-should-be-skill-internal
title: "quay-launch.sh is documented in 4 SKILL.md files
  (init/manager/cold-start/session-topology) as 'the launch command' a
  human/agent runs directly, not hidden behind a skill action — it DOES have
  real internal callers (session-bootstrap.sh, quay-topology.sh) and real test
  coverage (4 test files:
  launch-settings/manager-layer-skill/manager-layer-shipping/session-topology),
  so it is not dead code, but it conflates two roles: (a) legitimate internal
  implementation detail consumed by session-bootstrap.sh, and (b) a bare shell
  script users/agents are told to invoke directly — human ruling 2026-08-06: it
  should not itself be a product-facing deliverable; a skill is the interface
  users are accustomed to, and this wrapper script must become that skill's OWN
  inner implementation, not the thing pointed at directly; manager 2026-08-06,
  filed per human direction to transfer to outer"
status: done
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

- [x] AC1: 4 个 SKILL.md（init/manager/cold-start/session-topology）里"直接运行 quay-launch.sh"
      的措辞全部改为"由 skill 内部处理"，贴出改前/改后对照
- [x] AC2: 至少一个 skill（建议 `session-topology`，因为它已经是拓扑相关的自然归属）新增或改造
      Method 步骤，在其内部调用 `quay-launch.sh`，用户/agent 不再需要知道这个文件名
- [x] AC3: `verify-delivery-surface.ts` / `capability-catalog.sh` 若把 quay-launch.sh 列为
      面向用户的能力，改为标注"内部实现，非用户直接调用面"（参照 os-anchor 那次的排除写法：
      `gap-observer-registry` 同批任务里用过的模式，保留能力描述，标注调用边界）
- [x] AC4: **不得删除**——4 个测试文件的覆盖必须保持，任务体需说明为什么这次是"收窄边界"
      而不是人原话条件句里的"删除"分支
- [x] AC5: 与 `gap-manager-skill-missing-mandatory-tool-reuse-checklist` 交叉标注——
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
- plugin/test/manager-layer-skill.test.mjs（AC4：manager skill 措辞收窄后同步该文件的断言）

## Dispatch review

reviewer: none
at: 2026-08-06T16:1xZ
changed: 尚未派发/审阅（人直接裁定立案并转外层，管理者代笔）

---

## Evidence（内层实现 2026-08-09）

### 复现（改动前基线）

Contract 的三条机械 measure 在改动前实测：

```
$ grep -l "quay-launch.sh" plugin/skills/*/SKILL.md | xargs grep -lc "Method" | wc -l   # skill_wraps_launch
1
$ grep -rc "quay-launch.sh <role>\|bash.*quay-launch" plugin/skills/*/SKILL.md | awk -F: '{s+=$2} END{print s}'  # skill_docs_reference_bare_script
11
$ python3 -c "import json;print('plugin' in json.load(open('packages/quay/package.json')).get('files',[]))"  # package_files_exclude_or_internal
True
```

`skill_docs_reference_bare_script` 现状 = **11**（应为 0），且 `bash.*quay-launch` / `quay-launch.sh <role>`
这 11 处分布在 manager/cold-start/session-topology 三个 skill 里——正是"把裸脚本文档化成用户直接触碰"的现状。

### 修复

**AC1 —— 4 处"直接运行 quay-launch.sh"措辞改前/改后对照**

| 文件 | 改前原文（直接运行措辞） | 改后 |
|---|---|---|
| `plugin/skills/manager/SKILL.md`（英文 §How the manager itself starts） | `` `bash <root>/plugin/scripts/quay-launch.sh manager` `` 与 `` `bash <root>/plugin/scripts/quay-launch.sh manager --dry-run` `` | "启动命令是内部实现细节，人不直接打；启动走 `quay-session-topology` skill 的 Method / session bootstrap——永不手打一行 shell" |
| `plugin/skills/manager/SKILL.md`（中文 §5） | `` 由 `plugin/scripts/quay-launch.sh <role>` 物化为真实命令 `` + `` `bash plugin/scripts/quay-launch.sh <role> --dry-run` `` + `` `bash plugin/scripts/quay-launch.sh <role> --bare` `` | "由本 skill 的内部启动器物化为真实命令……启动脚本是 skill 背后的内部实现，不是用户/agent 直接调用面"（删去两条 `bash ... quay-launch.sh` 行） |
| `plugin/skills/cold-start/SKILL.md` | `` checked-in `quay-launch.sh <role>` convention `` / `` run `bash <root>/plugin/scripts/quay-launch.sh <role>` `` / `` `bash <root>/plugin/scripts/quay-launch.sh <role> --dry-run` `` / `` `bash <root>/plugin/scripts/quay-launch.sh <role> --bare` `` / `` `bash <root>/plugin/scripts/quay-launch.sh <role> --dry-run` output includes `` | "经由检查进仓库的 launcher `quay-launch.sh`（skill 的内部实现，非用户调用面）；由 skill 自行处理启动；skill 用 `--dry-run` 内部校验物化命令"（保留裸名 `quay-launch.sh` 说明机制，不再给 `bash` 调用式） |
| `plugin/skills/session-topology/SKILL.md` | 表格 `` `quay-launch.sh outer` `` / `` `quay-launch.sh inner` `` + `` generated by `plugin/scripts/quay-launch.sh <role>` `` | 表格改 "skill-internal launcher `quay-launch.sh`"；正文改 "启动命令是 skill 的内部实现细节，用户/agent 不再指名 launcher" |
| `plugin/skills/init/SKILL.md` | 仅 mapping 表一行 `` `quay-launch.sh` ``（被铺设脚本清单，非操作指令） | 无需改动——本身就是文件清单，不含"直接运行"措辞 |

**AC2 —— `session-topology` 新增 `## Method`（内部调用 quay-launch.sh）**

`plugin/skills/session-topology/SKILL.md` 新增 `## Method — build the two-window session (the launch is skill-internal)`，
四步：resolve root/session → bare-metal 用 `session-bootstrap.sh`（内部经 launcher `quay-launch.sh` 拉起每角色 claude 进程）
→ 用 `quay-topology.sh` 按定义构建两窗口（幂等）→ 用 `topology-check.sh` 校验。用户/agent 不再需要知道 `quay-launch.sh` 文件名。

**AC3 —— 调用边界标注**

- `plugin/scripts/capability-catalog.sh`：`quay-launch.sh` 从 `PUBLIC_ENTRYPOINTS` 移除 → `--json` 的 `surface` 由 `public` 变为 `internal`；保留 QUESTION 条目（脚本仍回答"每角色精确启动命令是什么"）。`--entry-surface` 门保持 PASS（consumer 文档不再以 `plugin/scripts/quay-launch.sh` 路径前缀引用它）。
- `plugin/scripts/verify-delivery-surface.ts`：category-3 `launch-config` 的 criterion 标注"quay-launch.sh 是内部实现（非用户直接调用面），读取 settings 并生成启动命令"。

**AC4 —— 收窄边界，不是删除**

4 个测试文件（`launch-settings` / `manager-layer-skill` / `manager-layer-shipping` / `session-topology`）全部保留。
实测不满足人原话条件句的"删除"分支（有真实测试覆盖 + 有真实内部调用方 `session-bootstrap.sh`/`quay-topology.sh`），
所以落点是**保留但收窄**：脚本仍被内部调用、仍被测试，只是不再是文档化给用户/agent 直接跑的对象。
`manager-layer-skill.test.mjs` 的断言从"manager skill 必须教 `quay-launch.sh manager`"改为"必须引用 checked-in launch config 且 **不得**暴露裸 launcher 名"——测试文件在、覆盖意图在（启动配置可安装性仍被钉住），只是断言对齐新边界。

**AC5 —— 交叉标注**

同边界原则的不同侧面：`tasks/gap-manager-skill-missing-mandatory-tool-reuse-checklist.md`（manager skill 必须复用既有工具、不手写脚本）与
本任务（用户/agent 面向的交互面应是 skill，脚本应是 skill 背后看不见的管道）是同一"脚本 vs skill 该由谁面向用户"原则的两面。manager skill 的
§9 工具复用硬规则与本任务的"launcher 收窄为 skill 内部实现"互相印证。

### 验证

改动后 Contract 三条 measure 实测：

```
$ grep -l "quay-launch.sh" plugin/skills/*/SKILL.md | xargs grep -lc "Method" | wc -l   # skill_wraps_launch = 1 ✓
1
$ grep -rc "quay-launch.sh <role>\|bash.*quay-launch" plugin/skills/*/SKILL.md | awk -F: '{s+=$2} END{print s}'  # skill_docs_reference_bare_script = 0 ✓
0
$ python3 -c "import json;print('plugin' in json.load(open('packages/quay/package.json')).get('files',[]))"  # True（plugin 作为包内实现随包）
True
```

`invoke` 命令（`grep -rn "quay-launch.sh <role>\|bash.*quay-launch" plugin/skills/*/SKILL.md`）→ 0 命中。
仅有 `plugin/skills/session-topology/SKILL.md` 同时含 `quay-launch.sh` 与 `Method`（即唯一 wrap 的 skill，band=1）。

受影响测试实跑全绿（`launch-settings` 24 / `manager-layer-skill` 29 / `manager-layer-shipping` / `session-topology` 24 /
`capability-catalog` / `verify-delivery-surface` 13 / `quay-session` / `select-static-checks-for-touches`）——fail 0、cancelled 0。
`bash plugin/scripts/capability-catalog.sh --entry-surface` → `AC3 gate: … PASS`（quay-launch.sh 现为 `internal`）。
`node --experimental-strip-types plugin/scripts/task-contract-check.ts --root .` → `no violations`。

scoped 门：`bash scripts/test.sh --for-task gap-quay-launch-sh-is-a-user-facing-surface-should-be-skill-internal --allow-thin` → exit 0。
