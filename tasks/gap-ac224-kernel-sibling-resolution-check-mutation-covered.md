---
id: gap-ac224-kernel-sibling-resolution-check-mutation-covered
title: A域检查器 kernel-sibling-resolution-check 被突变机制覆盖：能取假由清单证明，恒绿不算保证（AC-224）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-224
---
## Proposal

正本判据 `goals/AC-224-a域检查器被突变机制覆盖-能取假-由清单证明-恒绿检查器不算保证-goal-012-退出条件⑤.md`（goal=GOAL-012，2026-09-10 人裁定三条后授权激活）：exit 0 = `node --no-warnings --experimental-strip-types --test plugin/test/kernel-sibling-resolution-check.test.mjs` 双向跑通（干净夹具 ⇒ 检查器绿；注入 naive 锚点 ⇒ 检查器红，三种拼接形态各一例）∧ `kernel-sibling-resolution-check` 出现在 `checker-mutation-check.sh --list --json` 的 checkers 数组且 `covered: true`。

**现状（实测，位置判定）**：`plugin/scripts/kernel-sibling-resolution-check.ts`、`plugin/scripts/checker-mutation-cases/kernel-sibling-resolution-check.sh`、`plugin/test/kernel-sibling-resolution-check.test.mjs` 三者均不存在；`--list --json` 无该检查器条目；criterion exit 1（test 文件缺失）。无任务认领 `goal_ac: AC-224`（grep tasks/ = 0）。先前的 `gap-plugin-root-resolution-{non-skill-entrypoints,remaining-callsites,remaining-callsites-round2}` 三次人工枚举均已 done，正是 GOAL 判定「3 次 3 漏」被取代的对象，⛔ 非本任务重复。

**修法**：建 A 域静态检查器（把「人工枚举 kernel 调用点」换成机械枚举）+ 突变用例 + 双向单测 + 登记进 test.sh 与 capability-catalog。⛔ 不把 `--check` 当判据（AC-224 正文：它会因别的检查器问题而红，72.6s×每轮代价过大；`covered: true` 只证明「登记了突变用例」不证明「会红」）——「会红」由本任务的专用单测直接证明。

## Plan

1. 建 `plugin/scripts/kernel-sibling-resolution-check.ts`：KERNEL 域静态检查器，扫 shipped kernel 代码（`plugin/scripts` + `packages/quay/src`）把 sibling 脚本锚在 target root / worktree / naive `__dirname` / 模板字符串形态、而非经 `packages/quay/src/plugin-root.ts` 的 `resolveKernelSibling`/`resolveKernelPluginRoot` 之处。支持 `--root`/`--json`（AC-225 依赖）。⛔ 至少覆盖三种拼接形态（GOAL-012 风险 4）；⛔ 必须能表达 DEV-TREE-ONLY 域豁免且带理由可复核（GOAL-012 风险 2：本仓库自检工具锚 root 是正确行为，不得误伤）。
2. 登记进 `scripts/test.sh` 的 run_static_checks（`run_checker "kernel-sibling-resolution-check" node …`），使 `--list --json` 自动收录。
3. 建突变用例 `plugin/scripts/checker-mutation-cases/kernel-sibling-resolution-check.sh`（baseline GREEN → inject → RED → restore → GREEN），使 `covered: true`。
4. 建 `plugin/test/kernel-sibling-resolution-check.test.mjs`：自建夹具双向跑通（干净树 ⇒ 绿；注入三种 naive 锚点各一例 ⇒ 红）。
5. 登记进 `plugin/scripts/capability-catalog.sh`（声明检查器回答的问题，⛔ 否则 AC1c unclassified 红）。⛔ 新 plugin/scripts/*.ts 文件还触发 laydown 登记闸——若该检查器是 laid-down 脚本的传递依赖则需 quay-init --loop 显式 laydown 并把 closure-ratchet baseline 列入 Touches（现基线未 track capability-catalog，实测 grep=0；以 suite 实测为准）。
6. 干跑 AC-224 criterion 至 exit 0。

**边界（照实说明，⛔ 不假装机械）**：~9 处现存 A 域 naive `__dirname` 残量（GOAL-012 立条实测）是 AC-225「枚举归零」的迁移范围，⛔ 不属本任务——本任务只建检查器 + 证其会红 + 登记。检查器落地后会在全量 suite 里正确标红这 9 处直至 AC-225 迁移完成；本任务 DoD 只要求 AC-224 criterion（test + manifest 两断言），⛔ 不把「全量 suite 绿」写进 DoD（它依赖 AC-225）。

## Touches

- `plugin/scripts/kernel-sibling-resolution-check.ts`
- `plugin/scripts/checker-mutation-cases/kernel-sibling-resolution-check.sh`
- `plugin/test/kernel-sibling-resolution-check.test.mjs`
- `plugin/scripts/runner-static-gate.ts`
- `plugin/scripts/capability-catalog.sh`
- `tasks/gap-ac224-kernel-sibling-resolution-check-mutation-covered.md`

## Acceptance Criteria

- [x] AC1 检查器存在且可跑：`test -f plugin/scripts/kernel-sibling-resolution-check.ts && node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts --root . --json` 可执行且输出结构完整（含 violations 数组，非 spawn 失败）；贴输出前 3 条。
- [x] AC2 登记 covered:true：`bash plugin/scripts/checker-mutation-check.sh --list --json | python3 -c 'import json,sys; m=json.load(sys.stdin); ok=any(c.get("name")=="kernel-sibling-resolution-check" and c.get("covered") for c in m.get("checkers",[])); print("registered:",ok); sys.exit(0 if ok else 1)'` 输出 `registered: true`；贴 checkers 数组里该条目原文。
- [x] AC3 双向能取假（本条重点）：`node --no-warnings --experimental-strip-types --test plugin/test/kernel-sibling-resolution-check.test.mjs` 全绿，且断言覆盖两个方向——干净夹具 ⇒ 检查器绿；注入 `path.join(__dirname, "x.sh")` / `path.join(root, "plugin", "scripts", …)` / 模板字符串形态 **各一例** ⇒ 检查器红（三种形态逐条断言，⛔ 不止一种拼接形态，GOAL-012 风险 4）。
- [x] AC4 突变用例生效：`bash plugin/scripts/checker-mutation-cases/kernel-sibling-resolution-check.sh <tmpdir>` exit 0（baseline GREEN → inject → RED → restore → GREEN 全程证明，⛔ 非 STAYED-GREEN 非 ALWAYS-RED）。
- [x] AC5 判据翻转：AC-224 criterion 干跑 exit 0（贴完整命令与输出）。

## Definition of Done

AC1–AC5 全绿；AC-224 criterion exit 0（双向单测绿 ∧ manifest `covered: true`）。三个新文件落地 + `scripts/test.sh` 与 `capability-catalog.sh` 登记完成；`checker-mutation-check.sh --list --json` 中 kernel-sibling-resolution-check 条目 `covered: true`。⛔ 「会红」由 AC3 专用单测直接证明，不靠 covered 字段冒充（AC-224 正文）。~9 处现存 A 域残量的迁移属 AC-225，本任务不碰。