---
id: gap-ac226-target-identity-literal-check
title: B域身份字面量检查器 target-identity-literal-check：存在 + 枚举归零 + 被突变覆盖（AC-226）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-226
---
## Proposal

正本判据 `goals/AC-226-b域身份字面量检查器-存在-枚举归零-被突变覆盖-三者缺一不可-goal-012-退出条件①⑤.md`（goal=GOAL-012，2026-09-10 人裁定三条后授权激活）。exit 0 = 三个断言缺一不可：

- **①能取假** — `node --no-warnings --experimental-strip-types --test plugin/test/target-identity-literal-check.test.mjs` 双向跑通：注入「kernel 代码里把逐项目不同的身份写成无 override 的字面量」（分支名 / `test_command` / `tasks_dir` 各一例）⇒ 检查器红；移除 ⇒ 绿。
- **②本仓库枚举归零** — `node --no-warnings --experimental-strip-types plugin/scripts/target-identity-literal-check.ts --root . --json` exit 0。
- **③登记** — `checker-mutation-check.sh --list --json` 出现 `name=="target-identity-literal-check"` 且 `covered: true`。

**现状（实测，位置判定）**：`plugin/scripts/target-identity-literal-check.ts`、`plugin/test/target-identity-literal-check.test.mjs`、`plugin/scripts/checker-mutation-cases/target-identity-literal-check.sh` 三者均不存在；`--list --json`（63 checkers）无该条目；criterion exit 1。无任务认领 `goal_ac: AC-226`（grep tasks/ = 0）。

**TARGET 域判别标准（写进检查器实现，⛔ 不留给读者意会）**：该字面量是否**逐项目不同**且**没有 override 通道**。立条扫描确认 `plugin/scripts/driver-filters.ts:441` `export const DOC_BRANCH = "author"` 是唯一无覆盖能力的一处——`author` 是本仓库自己的 doc 工作分支命名约定（⛔ 非协议固定部分），`resolveDocBranch(root)` 已把多数调用点改为运行时派生（`currentBranchName(root) ?? DOC_BRANCH`），但该常量本身仍是无 override 的裸字面量兜底 ⇒ 检查器应标红它。`develop`/`integration`/`master` 有 CLI 覆盖且 quay-init 为每个项目建这些分支 ⇒ 合法默认值，检查器**不得误报**（①的负控制方向之一）。

**修法**：建 B 域静态检查器（把「人工枚举 TARGET 身份字面量」换成机械枚举）+ 消除 `DOC_BRANCH="author"` 这唯一残量（给 doc 工作分支一个 override 通道，或去除裸字面量、以运行时派生为唯一来源）使枚举归零 + 双向单测 + 登记进 test.sh / capability-catalog / 突变清单。⛔ 判别标准必须写进检查器实现（不留给读者意会）；⛔ 检查器必须能区分合法默认值（develop/integration/master）与违例。

**与既有任务的关系（机制去重）**：`gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync`（done，goal_ac=AC-207）已把 DOC_BRANCH 的调用点改为运行时派生，但**保留了该常量**——本任务补的是它留下的残量（常量本身仍是逐项目不同的无 override 字面量），⛔ 非重复。

## Plan

1. 建 `plugin/scripts/target-identity-literal-check.ts`：TARGET 域静态检查器，扫 shipped kernel 代码（`plugin/scripts` + `packages/quay/src`）里把逐项目不同的身份（分支名 / `test_command` / `tasks_dir`）写成**无 override 通道的裸字面量**之处。判别标准写进实现：`逐项目不同 ∧ 无 override 通道`。支持 `--root`/`--json`（判据②依赖）。⛔ 合法默认值（develop/integration/master——有 CLI 覆盖且 quay-init 建分支）不得误报。
2. 消除唯一残量 `plugin/scripts/driver-filters.ts:441` `DOC_BRANCH = "author"`：给 doc 工作分支一个 override 通道（读目标 `.quay/config.yml` 或实时 git 状态），或去除该裸字面量、以运行时派生为唯一来源（GOAL-012 TARGET 域正解：读目标 config / 实时 git 状态，⛔ 不得是 kernel 代码里的字面量）。以 AC-226 判别标准（逐项目不同 ∧ 无 override）为验收线。
3. 建突变用例 `plugin/scripts/checker-mutation-cases/target-identity-literal-check.sh`（baseline GREEN → inject → RED → restore → GREEN），使 `covered: true`。
4. 建 `plugin/test/target-identity-literal-check.test.mjs`：自建夹具双向跑通——注入「分支名 / `test_command` / `tasks_dir` 各一例」无 override 字面量 ⇒ 检查器红；移除 ⇒ 绿；负控制断言 develop/integration/master 合法默认值不被误报。
5. 登记进 run_static_checks（`plugin/scripts/runner-static-gate.ts`）与 `plugin/scripts/capability-catalog.sh`（⛔ 否则 unclassified 红 + `--list` 不收录）。
6. 干跑 AC-226 criterion 至 exit 0。

**边界（照实说明，⛔ 不假装机械）**：A 域（AC-224/225，kernel-sibling-resolution-check）与 C 域（AC-227/228，能力降级+一致性夹具）属同 goal 的兄弟任务，⛔ 不属本任务。本任务只建 B 域检查器 + 消除 DOC_BRANCH 残量 + 证双向 + 登记。`runner-static-gate.ts` 与 `capability-catalog.sh` 与 AC-224 任务共享 Touches，派发时注意重叠（dispatch-order-by-touches-overlap-direction 纪律）。

## Touches

- `plugin/scripts/target-identity-literal-check.ts`
- `plugin/scripts/checker-mutation-cases/target-identity-literal-check.sh`
- `plugin/test/target-identity-literal-check.test.mjs`
- `plugin/scripts/driver-filters.ts`
- `plugin/test/driver-filters.test.mjs`
- `plugin/scripts/runner-static-gate.ts`
- `plugin/scripts/capability-catalog.sh`
- `tasks/gap-ac226-target-identity-literal-check.md`

## Acceptance Criteria

- [x] AC1 检查器存在且可跑（判据②前件）：`test -f plugin/scripts/target-identity-literal-check.ts && node --no-warnings --experimental-strip-types plugin/scripts/target-identity-literal-check.ts --root . --json` 可执行且输出结构完整（含 violations 数组，非 spawn 失败）；贴输出前 3 条。
- [x] AC2 本仓库枚举归零（判据②）：同一命令 exit 0，violations 数组长度为 0；贴完整命令与输出。⛔ `DOC_BRANCH` 残量已消除——逐项目不同的身份不再以无 override 裸字面量存在。
- [x] AC3 登记 covered:true（判据③）：`bash plugin/scripts/checker-mutation-check.sh --list --json | python3 -c 'import json,sys; m=json.load(sys.stdin); ok=any(c.get("name")=="target-identity-literal-check" and c.get("covered") for c in m.get("checkers",[])); print("registered:",ok); sys.exit(0 if ok else 1)'` 输出 `registered: true`；贴 checkers 数组里该条目原文。
- [x] AC4 双向能取假（判据①，本条重点）：`node --no-warnings --experimental-strip-types --test plugin/test/target-identity-literal-check.test.mjs` 全绿，断言覆盖两个方向——注入「分支名 / `test_command` / `tasks_dir` 各一例」无 override 字面量 ⇒ 检查器红；移除 ⇒ 绿；负控制：develop/integration/master 合法默认值不被误报（⛔ 三种身份逐条断言，⛔ 不止一种形态）。
- [x] AC5 突变用例生效：`bash plugin/scripts/checker-mutation-cases/target-identity-literal-check.sh <tmpdir>` exit 0（baseline GREEN → inject → RED → restore → GREEN 全程证明，⛔ 非 STAYED-GREEN 非 ALWAYS-RED）。
- [x] AC6 判据翻转：AC-226 criterion 干跑 exit 0（贴完整命令与输出）。

## Definition of Done

AC1–AC6 全绿；AC-226 criterion exit 0（三断言：双向单测绿 ∧ 枚举归零 ∧ manifest `covered: true`）。B 域检查器落地 + `DOC_BRANCH` 残量消除（无 override 的裸字面量不再存在）+ run_static_checks / `capability-catalog.sh` / 突变清单登记完成；合法默认值（develop/integration/master）不被误报。⛔ 「会红」由 AC4 专用单测直接证明，不靠 covered 字段冒充；⛔ 判别标准（逐项目不同 ∧ 无 override 通道）写进检查器实现，不留给读者意会。