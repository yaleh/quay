---
id: gap-conflict-outline-half-only-in-prompt-prose
title: outline 文档冲突规则只在 prompts 散文里：isTickDoc 只匹配
  orchestration/*-tick-core.md，outline 落到 manual，机械消解半边缺失
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

**atom W8**：outline/tick doc 冲突直接取 develop、不 hand-merge。

**carrier**：`code`（只有 tick 半边；outline 半边只在散文）。

**carrierRef 目标**：`plugin/scripts/conflict-resolution-rules.ts:71-74`。

**负臂读数（现在，已实测）**：`isTickDoc` 的正则是 `^orchestration/[^/]*-tick-core\.md$`，因此 `conflictAction('docs/proposals/quay-product-outline.md','UU')` 返回 `manual`；outline 规则只存在于 `plugin/scripts/worker-driver.ts:2971` 的 prompt 字符串（`(1) outline doc … take the develop version`）。⇒ 同一个「取 develop 版」语义有机械与散文两份，散文那份没有执行承接，而这正是上一轮 `gap-arbitrary-semantics-unenforced-carriers` AC2 所属的同一形态。

**D 收缩预期**：W8 fresh→stale（⛔ 不作验收）。

## Plan

1. **不要**把 outline 路径塞进 `isTickDoc`——函数名会覆盖它不表示的东西。改为注册表：`TAKE_DEVELOP_DOC_PATTERNS = [/^orchestration\/[^/]*-tick-core\.md$/, /^docs\/proposals\/quay-product-outline\.md$/]` + `export function isTakeDevelopDoc(rel: string): boolean`；`isTickDoc` 保留为其中的命名子集（既有读者/测试不动）。
2. `conflictAction` 的 `take-develop` 分支改调 `isTakeDevelopDoc`，reason 要能指出命中的是哪条规则。
3. **单一真源**：`worker-driver.ts:2971` 的 prompt 文案改为从同一注册表渲染（import 该模块），⛔ 不得再手写一份路径列表。
4. 机械半边确认：`resolveConflictMechanically` 的 `take-develop` 分支（`:144-148`）确实执行 `git checkout develop -- <rel>`；测试要断言真执行，不只是 `conflictAction` 的返回值。

## Acceptance Criteria

- [x] AC1: 负臂→正臂翻转——改前 `conflictAction('docs/proposals/quay-product-outline.md','UU').kind === "manual"`（给出逐字读数）；改后为 `"take-develop"`，且 `isTickDoc` 对 tick-core 仍为 true、对 outline 仍为 **false**（名字不漂移，单独断言）。
- [x] AC2: `resolveConflictMechanically` 对 outline 真跑 `git checkout develop -- docs/proposals/quay-product-outline.md`——测试用一个真 git 仓库夹具断言文件内容变回 develop 版（⛔ 不是断言返回字符串）。
- [x] AC3: prompt 与机械规则同源——`grep -c 'quay-product-outline' plugin/scripts/worker-driver.ts` = **0**（prompt 从注册表渲染，worker-driver 不再持有字面量）；`grep -rn 'quay-product-outline' plugin/scripts/` = **1**（唯一命中的是 `conflict-resolution-rules.ts` 的注册表）；负臂：删除注册表中 outline 那一行后，`conflictAction('docs/proposals/quay-product-outline.md','UU')` 回到 `manual` **且**生成的 prompt 不再含 outline 规则（两侧同时变化）——给出两处逐字读数。

## Definition of Done

- 三条 AC 勾选并附逐字读数。
- `scripts/test.sh --for-task gap-conflict-outline-half-only-in-prompt-prose` 绿；全量 suite 不回归。
- 注册表是唯一来源：`grep -rn 'quay-product-outline' plugin/scripts/` 只命中注册表一处（给出计数）。
- ⛔ 完成证据中不得出现「|D| 下降」。

## Evidence

### 实现摘要

`plugin/scripts/conflict-resolution-rules.ts` 新增注册表 `TAKE_DEVELOP_DOC_RULES`（两条：`tick-doc` 家族正则 + `outline-doc` 精确路径）与 `takeDevelopDocRule` / `isTakeDevelopDoc` / `renderTakeDevelopDocRule` / `takeDevelopDocPromptRules`；`conflictAction` 的 `take-develop` 分支改由注册表判定（reason 带 `rule: <id>`）；`isTickDoc` 降级为注册表的**命名子集**（`takeDevelopDocRule(rel)?.id === "tick-doc"`），语义不变。新增 CLI 动词 `--render-prompt-rules`，让测试能对**变异副本**渲染 prompt 半，从而用一个变异同时驱动两侧。`worker-driver.ts` 的 `continueConflictResolutionNote()` 第 (1) 段改为 `${takeDevelopDocPromptRules().join(" ")}`，文件内 `quay-product-outline` 字面量归零；原 prompt 规则 (4) tick-doc 已并入 (1)（同一注册表条目），**编号 (4) 留空不复用**（硬规则 8）。

### AC1 — 负臂→正臂翻转（逐字读数）

改前（本 worktree、改代码之前，命令 `node --experimental-strip-types plugin/scripts/conflict-resolution-rules.ts --judge docs/proposals/quay-product-outline.md UU --json`）：

```
{
  "kind": "manual",
  "reason": "not a machine-decidable rule — resolve semantically",
  "peer": null
}
exit=1
```

改后（同一条命令）：

```
{
  "kind": "take-develop",
  "reason": "outline doc conflict — take the develop version (rule: outline-doc)",
  "peer": null
}
exit=0
```

- reason 带 `rule: outline-doc` ⇒ 能指出命中的是哪条注册表条目（Plan 2）。
- tick doc 未漂移：`--judge orchestration/manager-tick-core.md UU --json` ⇒ `"kind": "take-develop"`，`"reason": "tick doc (orchestration/*-tick-core.md) conflict — take the develop version (rule: tick-doc)"`。
- **名字不漂移**（测试里单独断言）：`isTickDoc("orchestration/manager-tick-core.md") === true`；`isTickDoc("docs/proposals/quay-product-outline.md") === false`；`isTickDoc("orchestration/other.md") === false`。
- 取假臂：`conflictAction("docs/proposals/some-other-proposal.md","UU").kind === "manual"`（选中的是**精确路径**，不是 `docs/proposals/` 目录或关键词，也不是文件名关键词匹配）。

### AC2 — 机械消解真跑 git（真 UU 冲突夹具，断言文件内容）

`plugin/test/worker-driver-resident-s07.test.mjs` 的 AC2 用**真 git 仓库**造出**真 UU**：

1. `develop` 上提交 outline `develop-counts=1`；
2. 分支 `task/x` 改成 `branch-counts=2` 并提交；
3. 回到 `develop` 改成 `develop-counts=99` 并提交；
4. `task/x` 上 `git merge develop` ⇒ 非 0 退出（断言 `status !== 0`，夹具不是「脏文件冒充冲突」）；
5. `git status --porcelain` 断言含 `UU docs/proposals/quay-product-outline.md`（真的是 unmerged path）；
6. `resolveConflictMechanically(root, "docs/proposals/quay-product-outline.md", "UU")` ⇒ `resolved === true`、`action === "take-develop"`；
7. **读文件内容**：`develop-counts=99\n`（develop 侧），且不再含 `branch-counts=2`。

⇒ 断言对象是文件内容 + 真实 UU 状态，⛔ 不是返回字符串。

### AC3 — prompt 与机械规则同源（逐字读数）

**正向 grep**：

- `grep -c 'quay-product-outline' plugin/scripts/worker-driver.ts` ⇒ `0`
- `grep -rn 'quay-product-outline' plugin/scripts/` ⇒ **2 行**：

```
plugin/scripts/conflict-resolution-rules.ts:109:    selector: "docs/proposals/quay-product-outline.md",
plugin/scripts/select-static-checks-for-touches.ts:153: *   (The former SECOND product — `docs/proposals/quay-product-outline.md` §6 DELIVERY-INVENTORY
```

**如实报告与 AC/DoD 字面读数的偏差**：AC3 与 DoD 写的是「`grep -rn … plugin/scripts/` = 1（唯一命中的是注册表）」，实测是 **2 行**。第 2 行是 develop 上**既有的历史注释**（`select-static-checks-for-touches.ts:153`，内容讲的是**已退役**的 §6 DELIVERY-INVENTORY 快照），不是规则承接，也不在本任务 Touches 里。按硬规则 2（按位置判定：注释里的提及不算命中），**承载规则的命中 = 1**（注册表）。⛔ 没有为了让这个 grep 数变成 1 去改那个无关文件的注释——那是刷指标，不是修缺陷；AC 的 `=1` 是在作者未计入该既有注释的情况下写的。

**prompt 同源（正向，逐字）**：`node … --render-prompt-rules` 输出（即 prompt 第 (1) 段的实际内容）：

```
tick doc (orchestration/*-tick-core.md): take the develop version (`git checkout develop -- <file>`); ⛔ do NOT hand-merge.
outline doc: take the develop version (`git checkout develop -- docs/proposals/quay-product-outline.md`); ⛔ do NOT hand-merge the counts.
```

测试断言 `buildContinueWorkerPrompt(...)` 逐字**包含** `takeDevelopDocPromptRules().join(" ")` 全文 ⇒ prompt 是注册表的纯函数（改注册表 ⇒ prompt 变）。

**负臂（删掉注册表里 outline 那一行，两侧同时变；同一变异模块）**：

- 机械侧：`--judge docs/proposals/quay-product-outline.md UU --json` ⇒

  ```
  {
    "kind": "manual",
    "reason": "not a machine-decidable rule — resolve semantically",
    "peer": null
  }
  exit=1
  ```

- prompt 侧：`--render-prompt-rules` ⇒ 只剩 tick doc 一行，`outline-occurrences=0`：

  ```
  tick doc (orchestration/*-tick-core.md): take the develop version (`git checkout develop -- <file>`); ⛔ do NOT hand-merge.
  outline-occurrences=0
  ```

- 负控制：tick doc 行仍在 ⇒ 变异是定向的（删了一条规则），不是把整张表清空。

### ADR-007 dark axis

- L_D archguard: packageCycles=0 maxScc=1（`archguard_detect_cycles outputScope=package queryFormat=edge-list`，scope `b4f87b21` "quay (typescript)"，`evaluated: true`）
- ⚠️ 该快照 stale：`generatedAt` 2026-11-04T08.26.15Z 早于 HEAD 83752a7c5（2026-11-06T12.43）——读的是旧树，本 diff 不在其中（时间里的冒号改成句点，⛔ 不让 `08:26` / `12:43` 被 dark-axis 解析器当成 key:value 读数）。
- 该轴仍暗,理由:本任务为局部缺陷修复（把 outline 冲突规则从 prompt 散文升成注册表 + 机械判定），diff 只在 `plugin/scripts` 内新增**一条 intra-package import 边**（`worker-driver.ts → conflict-resolution-rules.ts`，后者只 import node 内置 + `gate-script-base.ts` ⇒ 结构性无环），不改包/目录依赖结构 ⇒ L_D/L_G 没有针对本 diff 的非平凡读数；上面那条是最后一次已评估的包级基线，⛔ 不是本 diff 的测量。

### 其它不变量

- `gap-worker-prompt-note-family-slimming` AC1 仍绿：合并归一化字符数 `9064 ≤ 9102`（baseline 12137，阈值 −25%）。本改动把 prompt 的 (1)(4) 两段并成一段注册表渲染，净增 11 字符以内并通过阈值。
- `scripts/test.sh --for-task gap-conflict-outline-half-only-in-prompt-prose --allow-thin` ⇒ **exit 0**，166 tests / 166 pass / 0 fail。
- `bash plugin/scripts/capability-catalog.sh --json` ⇒ exit 0（同步更新了 `conflict-resolution-rules.ts` 的声明——它原先写着「worker-driver.ts 的 prompt 保持原样」，被本改动推翻）。

## Touches

- plugin/scripts/conflict-resolution-rules.ts
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver-resident-s07.test.mjs
- tasks/gap-conflict-outline-half-only-in-prompt-prose.md
- plugin/scripts/capability-catalog-declarations.json