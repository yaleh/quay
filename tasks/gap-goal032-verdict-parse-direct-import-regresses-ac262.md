---
id: gap-goal032-verdict-parse-direct-import-regresses-ac262
title: GOAL-032 的 parseBinaryVerdict 直连 import 绕过 Layer-0 导入面，goal-driver.ts 重现
  packages/quay/src 字面量 ⇒ AC-262 判据第二支翻假
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-262
---
**type:** execution

## Proposal

**机制（2026-10-09 直接跑 AC-262 判据本体，⛔ 非账本尾读）**：AC-262 三支里**只有第二支**翻假：

```
ARM1 ['goal','gate']               rc=2  has_unknown=False
ARM1 ['goal','check','--staleness'] rc=0  has_unknown=False
ARM1 ['goal','batch']              rc=2  has_unknown=False
ARM2 hits: 2
    ('plugin/scripts/goal-driver.ts',  58, 'import { parseBinaryVerdict } from "../../packages/quay/src/kernel/verdict-parse.ts";')
    ('plugin/scripts/goal-driver.ts', 1147, '*  GOAL-032：解析算法已收敛到 kernel 单一实现 `packages/quay/src/kernel/verdict-parse.ts::')
ARM3 seen=1720 ok=1720 last=('2026-10-09T14:29:32.055Z', ['verified'])
```

第一支（vendored bundle 跑三个 goal 子命令无 `unknown goal subcommand`）与第三支（生产载体 `.quay/goal-round.jsonl` 有落地后非 failed 的 goal-ring 轮次，1720/1720）**都过**；唯一翻假的是第二支——两个 driver 剥掉 `//` 行注释后不得出现 Core 源码树字面量。

**回归来源（按位置判定）**：提交 `ec0b1a8f7`（2026-10-09T10:03:04+08:00，GOAL-032 ①「extract parseBinaryVerdict to kernel; two parsers become thin wrappers」）在 `plugin/scripts/goal-driver.ts:58` 直接加了 `import { parseBinaryVerdict } from "../../packages/quay/src/kernel/verdict-parse.ts";`，并在 `:1147` 的 JSDoc 里写了同一个字面量。AC-262 第二支的谓词是逐行 `code = ln.split("//", 1)[0]` 后查 `packages/quay/src`——**它只剥 `//` 行注释，块注释散文会存活**，所以 import 说明符（:58）与 JSDoc 散文（:1147）两者都计命中。

**为什么上一次修复没有守住（本条要补的另一半）**：`gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache`（done）把旧调用点清到 0，但它的 AC5 pin 只钉了 **argv 的形态**——现存于 `plugin/test/goal-driver-s06.test.mjs:169`「AC5: goal 动词 argv 不含 packages/quay/src」，**从未钉住这两个文件的源文本**。GOAL-032 加的是一次**静态 import**，与 argv 构造是不同机制；argv pin 结构上取不到假 ⇒ 静默回归。所以本任务除修复外，还要补一个**按源文本**的硬检查（AC3），否则下一次同类 import 会照旧漏过。

**修法（机制 = 单一导入面，硬规则 5b「一个结构上的修点 ≠ 只有那一处」）**：`plugin/scripts/driver-runtime.ts` 已经是这两个 driver 消费 Core 符号的**唯一落点**（文件内 470–574 行是一长串 `export { … } from "../../packages/quay/src/…"`），它自己的注释就写着「⊢ AC-262 判据按源文本扫这两个文件（剥掉 `//` 行注释后不得出现 Core 源码树字面量），故符号本身必须在这里落地一次；⛔ 不是把字面量藏起来——是把『谁知道布局』收敛到它该在的地方」。故：

① `driver-runtime.ts` 增一条 `export { parseBinaryVerdict } from "../../packages/quay/src/kernel/verdict-parse.ts";`（布局字面量只在 Layer 0 出现一次）；
② `goal-driver.ts:58` 改从 `./driver-runtime.ts` 取该符号（并入已有的 `from "./driver-runtime.ts"` import 块）；
③ `:1147` 的 JSDoc 改写为不再含 `packages/quay/src` 字面量的表述（例如只称 `kernel/verdict-parse.ts`）——driver 只表达「我需要这个符号」，不表达「它在哪棵树」。

**⚠️ 准确边界（别据此把修法辩论掉）**：这个直连 import 在**构建期**其实能解析——`coreSrcAliasPlugin`（`packages/quay/scripts/build-plugin-dist.mjs:439-455`）按 `packages/quay/src/` 后缀把说明符重指到真实 kernel 文件并内联进 bundle（`bundle:true`）。所以这是**单一真源 / 约定**层面的回归（driver 复写了布局知识），不是运行时故障。⛔ 但 AC-262 第二支本身就是**按源文本**的判据，且上述约定已写进 `driver-runtime.ts` 正文——「构建能过」不是本条的合格线。

<!-- dedup-ref -->相关但机制不同：`gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache`（done）是上一次修复本体；它的 argv pin 抓不到静态 import，故本次以**源文本硬检查**补上，按新条立（⛔ 不是它的重复；done 的 AC 已无法覆盖 GOAL-032 新引入的 import 形态）。

## AC

- [ ] AC1：`plugin/scripts/goal-driver.ts:58` 改从 `./driver-runtime.ts` 取 `parseBinaryVerdict`；`plugin/scripts/driver-runtime.ts` 增 `export { parseBinaryVerdict } from "../../packages/quay/src/kernel/verdict-parse.ts";`；`:1147` 的 JSDoc 改写为不含该字面量。判据（与 AC-262 第二支逐字同一谓词）：对 `goal-driver.ts` 与 `meta-driver.ts` 逐行取 `code = ln.split('//', 1)[0]` 后 `"packages/quay/src" in code`，命中 **0**；贴出扫描脚本实跑输出（命中数与命中位置）。
- [ ] AC2：AC-262 判据本体 **exit 0**（三支全过）。直接复跑判据原文并把完整 stdout/stderr 贴进 Evidence；⛔ 不接受「只跑第二支」或「只跑单测」。
- [ ] AC3：新增**按源文本**的硬检查用例（落在 `plugin/test/goal-driver-s06.test.mjs`，与该文件既有 AC-262 argv pin 相邻），断言 `goal-driver.ts` 与 `meta-driver.ts` 两文件剥 `//` 后 `packages/quay/src` 命中数为 0。**取假（必做）**：临时把 `:58` 改回直连 import ⇒ 用例必红；`cp` 备份恢复（⛔ 不用 `git checkout --`）⇒ 绿；两次实跑输出都贴进 Evidence。
- [ ] AC4：打包面未被改坏——走 Layer-0 后重新构建 plugin dist，`scripts/dist/goal-driver.js` 内 `parseBinaryVerdict` 仍被内联、无 `Could not resolve`；`node --test plugin/test/goal-driver-s*.test.mjs` exit 0。
- [ ] AC5：`bash scripts/test.sh --for-task gap-goal032-verdict-parse-direct-import-regresses-ac262` 绿。

## DoD

真实落地判据：AC-262 判据本体在生产上 **exit 0**（落地后**直接复跑**，非账本尾读），且 goal-driver 下一轮把该 AC 的 verdict 记入 `.quay/goal-round.jsonl` 时不再是不合格。⚠️ 本轮**唯一**翻假支是第二支（源文本），第一、三支已过 ⇒ 完成门槛 = 「②归零 ∧ 判据 exit 0」；⛔ 单测绿、或「构建能过」都不等于落地——判据点名的量（源文本 0 命中 + 判据 exit 0）必须真的取到。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver-s06.test.mjs
- tasks/gap-goal032-verdict-parse-direct-import-regresses-ac262.md
