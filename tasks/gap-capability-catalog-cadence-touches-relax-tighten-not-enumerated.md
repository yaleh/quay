---
id: gap-capability-catalog-cadence-touches-relax-tighten-not-enumerated
title: "capability-catalog CADENCE: touches-relax-tighten.ts 夹带说明文字 ⇒
  不是五枚举之一（GOAL-037 AC-367 回归）"
status: done
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

`plugin/test/capability-catalog.test.mjs:391-392` 要求每个 `CADENCE` 值精确匹配 `/^(每轮|每红窗|每里程碑|冷启动|按需)$/`。`plugin/scripts/capability-catalog-declarations.json:755` 的 `CADENCE["touches-relax-tighten.ts"]` 当前值夹带了整段说明：

`每轮（worker-driver 驻留环的轮末一步；loop.touches_relax 未声明或 mode 为 off / 读不懂时不跑，该轮 round 记录的 auto_tighten 为 null）`

因此 `plugin/test/capability-catalog.test.mjs` 在 develop 与主检出上稳定红（17/18）。该行由 commit `2e2d00cef`（GOAL-037 AC-367）引入。说明文字并非无处安放：同一模块的「失效前提」（:1144）与「谁触发」（:2125）两节已经完整承载了这些信息，`CADENCE` 只需要枚举值本身。修复 = 把该值改成 `每轮`，不增删任何键。

这不是同一个红点的唯一来源：fan-in 还记录 `plugin/test/full-suite-runner-cgroup.test.mjs` 的 AC4 墙钟红，由另一条任务处理（`gap-full-suite-runner-ac4-wallclock-noise-envelope`）。本条只清确定性红。

## Plan

1. 只改 `CADENCE["touches-relax-tighten.ts"]` 为 `每轮`；`git diff` 必须只有这一行。
2. 复跑 `node --test plugin/test/capability-catalog.test.mjs`，确认 18/18。
3. 用 grep 证明说明文字仍在 :1144 / :2125 两节。

## Acceptance Criteria

- [x] AC1 — `CADENCE["touches-relax-tighten.ts"] === "每轮"`（逐字）；`git diff -U0 -- plugin/scripts/capability-catalog-declarations.json` 只有这一行变化。证据：`node -e` 读 declarations ⇒ `value= "每轮" exact= true`；`git diff -U0 develop` 该文件恰为 1 行 `-` / 1 行 `+`（@@ -755 +755 @@）。
- [x] AC2 — `node --test plugin/test/capability-catalog.test.mjs` exit 0，`ℹ tests 18 / pass 18 / fail 0`；附输出尾部。证据（worktree 内实跑）：`ℹ tests 18` / `ℹ pass 18` / `ℹ fail 0` / `EXIT=0`。
- [x] AC3 — 说明文字未丢失：`失效前提`（:1144 附近）与 `谁触发`（:2125 附近）两节仍含原有文字（附 grep 行号与原文）。证据：`grep -n` ⇒ :1144 `"touches-relax-tighten.ts": "失效前提：① 判定词表不再是 not-evaluated | within-budget | halt…"`；:2125 `"touches-relax-tighten.ts": "谁按：① plugin/scripts/worker-driver.ts 的驻留环轮末（runAutoTightenPass…"` —— 两节原文未被本条 diff 触碰。
- [x] AC4 — 其余 `CADENCE` 值零变化：`git diff` 中 `CADENCE` 段只有 1 行 `-` / `+`。证据：全文件 diff 只有 `@@ -755 +755 @@`；枚举值集合仍为 `["按需","每轮","每里程碑","冷启动","每红窗"]`，无越界项。

## Definition of Done

确定性红点消失：落地树上 `plugin/test/capability-catalog.test.mjs` 18/18，且 `git diff` 只含一条 cadence 值的变化；不碰任何生产逻辑、不勾任何其它 AC。

## Touches

- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-capability-catalog-cadence-touches-relax-tighten-not-enumerated.md
