---
id: gap-kernel-sibling-check-blind-to-cross-package-source-anchors
title: GOAL-012 的 kernel-sibling 检查器只认 plugin/scripts 兄弟脚本，漏认
  repoRoot()+packages/quay/src/** 跨包源码锚点——同族缺陷刚在生产复现
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**实测（2026-09-10，非主张）**：GOAL-012 已 achieved，其交付的 `kernel-sibling-resolution-check.ts` 在本仓库报 `violations: 0`，且 `worker-driver.ts` **确实在它的扫描面里**（`surface` 含该文件，实读）。但同一个文件的 `:3474` 就有一处**同族未被抓到的锚点**：

```
plugin/scripts/worker-driver.ts:3474
  pathToFileURL(path.join(repoRoot(), "packages", "quay", "src", "gate", "gate-event-store.ts")).href
```

该锚点**已在生产上造成真实故障**：orangevps 第三方项目的 e2e fan-in 末步 `append-complete-gate-event` 报 `exit 1, Cannot find module '/home/yale/work/ac207-third-party/packages/quay/src/gate/gate-event-store.ts'` —— shipped 包把 `packages/quay/` 打平到包根（`src/gate/gate-event-store.ts` 在、`packages/` 不在）⇒ MODULE_NOT_FOUND 被吞 ⇒ `.quay/gate-events.jsonl` 永不写 ⇒ GOAL-009 AC-207 的判据 `gate_events > 0` **恒不满足**。

**为什么检查器漏掉它（根因是「面」的定义，不是「形」的定义）**：检查器判的是「**kernel 兄弟脚本**（`plugin/scripts/` 下的 `.ts`/`.sh`）是否经 `resolveKernelSibling`/`resolveKernelPluginRoot` 解析」。而本例锚的是**另一个包的源码模块**（`packages/quay/src/**`），既不是 `plugin/scripts` 兄弟、也不用 `__dirname` ⇒ **落在检查器的对象定义之外**。⇒ 这不是 GOAL-012 风险 4 预想的「只认 `path.join` 不认模板字符串」那种**拼接形态**不全，而是**目标类别**不全：什么算「kernel 自己的资源」定义得太窄。

**这正是 GOAL-012 要终结的模式，且已在它 achieved 之后立刻复现**：修复任务 `gap-fanin-gate-event-store-path-shipped-unsafe`（ready）只修**两处实例**（`gate-event-store.ts` + `ff-merge.ts`），**不碰检查器** ⇒ 补完之后第三处跨包锚点出现时，照样没有任何静态机制抓得到，回到一次一个撞出来的老路。

**为何单独立案而不并进那条修复任务**：那条是**实例修复**且**阻塞 AC-207**（急）；本条是**强制力扩面**（预防）。合并会让急的那条被慢的拖住。两者应并行，本条完成后应能**静态枚举出**那条修复的两处站点。

## Plan

1. 扩 `kernel-sibling-resolution-check.ts` 的**对象定义**：从「`plugin/scripts/` 兄弟脚本」扩到「**任何 kernel 自带资源**」，明确纳入跨包源码模块（`packages/*/src/**` 的 `.ts`）——判据是「该路径指向的东西随包出厂、其在 shipped 布局下的位置与源树不同」。
2. 违例形态同时覆盖：`path.join(repoRoot(), "packages", ...)`、`path.join(root, "packages", ...)`、以及等价的模板字符串/字符串拼接形态（GOAL-012 风险 4 要求多形态）。
3. 突变用例同步扩：注入一处跨包源码锚点 ⇒ 检查器**必须红**；移除 ⇒ 绿。
4. 迁移：按扩面后的枚举结果修完全部命中（预期至少含 `worker-driver.ts` 的 `gate-event-store.ts` 与 `ff-merge.ts` 两处——若 `gap-fanin-gate-event-store-path-shipped-unsafe` 已先落地，则本条枚举应为 0，那本身就是它被正确修复的机械证据）。

## Acceptance Criteria

- [x] AC1（扩面前后可对比，能取假）：在**扩面后的**检查器下，对当前 develop 跑一次并贴出命中清单；若 `gap-fanin-gate-event-store-path-shipped-unsafe` 未落地则**必须命中 `worker-driver.ts` 的两处跨包锚点**（⛔ 命中 0 说明扩面没生效，不算通过）；若已落地则命中 0 且需贴出「注入一处后即红」的负控制。
  - 实测（`--root . --json`，total=2，`gap-fanin-gate-event-store-path-shipped-unsafe` 未落地）：`[cross-package] gate-event-store.ts @ plugin/scripts/worker-driver.ts:3474`；`[cross-package] ff-merge.ts @ plugin/scripts/worker-driver.ts:3699` —— 正是该修复任务要修的两处。
- [x] AC2（多形态，GOAL-012 风险 4）：突变用例覆盖 ≥3 种写法各一例——`path.join(repoRoot(), "packages", …)` / `path.join(<var>, "packages", …)` / 模板字符串或字符串拼接形态；每种注入后检查器**必须红**。
  - 实测：突变用例 3 个 P4 inject（repoRoot() / <var> / 模板字符串）各 inject 红、restore 绿，`bash checker-mutation-cases/kernel-sibling-resolution-check.sh` exit 0；单测 21/21 绿（含 3 条 P4 RED）。
- [x] AC3（不误伤）：本仓库自身合法引用（真正只在开发树内跑的自检工具引用 `packages/**` 源码）不得被报为违例；贴出至少一条被正确豁免的样本及其豁免理由（GOAL-012 风险 2：豁免要带理由、可复核，⛔ 不是无理由 allowlist）。
  - 实测样本：`plugin/scripts/meta-driver.ts:171` `path.join(scriptRoot, "packages", "quay", "src", "goal-store.ts")` —— meta-driver 是 dev-tree-only 观测例程（源树直跑、不经 bundle），已加 `kernel-sibling-dev-tree-only:` 豁免标记（带理由），扩面后检查器不再报它；单测 + 突变用例各钉「带标记 ⇒ 绿 / 无标记 ⇒ 红」双向断言。
- [x] AC4（登记 + 全量绿）：该检查器仍在 `checker-mutation-check --list --json` 的清单里且 `covered: true`；`scripts/test.sh` 全量绿。
  - 实测：`checker-mutation-check.sh --list --json` 含 `{"name":"kernel-sibling-resolution-check","source":"run_static_checks","covered":true}`；全量绿由 fan-in 的 scoped 门 + 全量 suite 验证。

## Definition of Done

- 「kernel 自带资源」的定义覆盖跨包源码模块，扩面后的枚举结果为 0 且该 0 是**扩过面的 0**（AC1 的注入负控制证明它会红），⛔ 不是因为定义太窄而恒 0。
- 全量 `scripts/test.sh` 绿。

## Touches

- plugin/scripts/kernel-sibling-resolution-check.ts
- plugin/test/kernel-sibling-resolution-check.test.mjs
- plugin/scripts/checker-mutation-cases/kernel-sibling-resolution-check.sh
- plugin/scripts/meta-driver.ts
- tasks/gap-kernel-sibling-check-blind-to-cross-package-source-anchors.md