---
id: gap-ac162-console-guidance-line-reddens-criterion
title: AC162 判据被运行时提示行重新打红：register-plugin console.log 非注释行仍含 enabledPlugins
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-162
---
## Proposal

<!-- dedup-ref -->
**问题（立案当轮实测，非推断）**：AC-162 的判据当前 exit 1。判据原文（`goals/AC-162-register-plugin-no-user-enabled.md`）要求 `grep -vE '^[[:space:]]*(//|\*|#)' packages/quay/scripts/register-plugin.mjs | grep -q 'enabledPlugins'` **不命中**；实测注释剥离后仍有 1 行命中——原文件 `:202` 的 `console.log(...)`（**非注释行**），内容是给用户的项目级启用指引：`console.log(`       project by adding  "enabledPlugins": { "${pluginRef}": true }  to that project's`);`（同文件 `:13/:21/:147/:155/:173` 的五处命中都在 `//` 注释里，按 expect「注释里提到不算命中」不算。）

<!-- dedup-ref -->
**为什么早先那次修复没有保持住（本条不是重复立案）**：① 早先任务 `gap-ac162-register-plugin-no-user-enabled`（commit `a0dccdf51`，status: done）删掉了真正的写入点（原 `:102/:106` 的赋值）并翻转了行为断言——那一半成立且至今成立，脚本确实不再写用户级启用。② 但 AC-162 判据不是行为判据，是源码文本判据（剥注释后 grep 字面量），而这个谓词没有任何测试钉住它 ⇒ 任何后续在非注释行提到该字面量的改动都会静默把它打红。③ 2026-09-14 23:02:53Z 的 commit `86e5c1db4`（任务 `gap-ac161-user-scope-enable-repolluted-by-cli-materialization` 的收尾，亦已 done）为新默认行为新增了这段运行时指引——动机正确（告诉用户去项目级启用，正是 AC-161 要的方向），但它把字面量放进了非注释行 ⇒ AC-162 判据由此从 pass 变 fail。④ 台账佐证：`.quay/goal-round.jsonl` 里 AC-162 最后一次读数在 round 149（2026-09-08，verdict pass），早于 `86e5c1db4`；此后 GOAL-003 不再是活跃复验域、AC-162 又非 long-term ⇒ 没有任何机制再跑它 ⇒ 判据红着而无人认领。⑤ 共同形态：修复只落在被判出来的那一处，同一文件同一字面量的另一种出现形态（写入点 vs 提示文本）没被扫（硬规则 5b）；且因为缺一个钉住判据本身的产物，复红不可见（硬规则 9）。

## Plan

1. **让判据为真（改源码，不改判据、不改 AC record）**：把 `packages/quay/scripts/register-plugin.mjs:202` 的运行时指引改写成不含该字面量的散文，同时不丢信息——该项目级 JSON 形状已经**在同文件头部注释 `:155` 逐字写明**（`"<repo>/.claude/settings.json": { "enabledPlugins": { "quay@quay": true } }`），继续保留在那里（注释不计命中）；运行时消息改为指向「项目级启用条目」+ `.claude/settings.json`（`:203` 已有该路径）。⛔ 禁止用拼接/转义规避（`"enabled" + "Plugins"`、`\x65nabledPlugins` 等）——那是糊弄判据而非满足它，会让判据变空转（硬规则 3b/4）；expect 已明确允许注释里提到，正解就是把精确形状留在注释、运行时不粘贴裸键。⛔ 不改 `goals/AC-162-*.md` 的 criterion（改判据 = 搬球门）。
2. **补一个钉住判据的产物（这才是让「不再复红」成立的部分）**：在 `packages/quay/test/npm-pack-e2e.test.mjs` 增加一个测试，逐字复用 AC-162 的谓词（对源码做 `^[[:space:]]*(//|\*|#)` 剥注释后 grep 该字面量），非注释行命中即 fail。这样下一个像 `86e5c1db4` 那样顺手加提示行的人会被当场红挡住，而不是等台账下一轮（硬规则 9：可见性≠执行，给规则造产物）。
3. **双向控制**：写回原 `:202` 行（prefix-code-swap 手法）⇒ 新守卫必须红；换回 ⇒ 绿。两条读数都贴进 Evidence——没有红控制就无法区分「守卫在跑」与「守卫恒绿」。
4. **行为不变的正控制**：脚本仍注册 marketplace 源、仍不写用户级启用——复用已存在的行为断言 `packages/quay/test/npm-pack-e2e.test.mjs:227`（`settings.enabledPlugins?.["quay@quay"] === undefined`）保持绿；不得为了绿而放宽它。
5. **回读**：在工作树里跑 AC-162 判据原文，贴出 exit 0 与「无命中」的证据。

<!-- dedup-ref -->
**非依赖说明（traceability only）**：本任务自足，没有任何依赖边；`gap-ac161-user-scope-enable-repolluted-by-cli-materialization`（done）只作为成因出处被引用（它是 `86e5c1db4` 那段提示行的作者），不构成对本任务的任何约束。

## AC

- [x] AC-162 判据 exit 0：`grep -vE '^[[:space:]]*(//|\*|#)' packages/quay/scripts/register-plugin.mjs | grep -q 'enabledPlugins'` 不命中（内层 grep exit 1 ⇒ 判据整体 exit 0）；证据 = 判据原文在落地后的工作树上的一次真实运行输出。
- [x] `packages/quay/scripts/register-plugin.mjs` 的所有非注释行不含该字面量；精确的项目级 JSON 形状仍在该文件头部注释里可查（不因本次改动丢失）。
- [x] 运行时指引仍告诉用户「去项目级启用」并指向 `.claude/settings.json`（信息不缩水；不得为过判据而删掉整段指引）。
- [x] 新守卫测试逐字复用 AC-162 谓词并对源码取值，位于 `packages/quay/test/npm-pack-e2e.test.mjs`；`node --test packages/quay/test/npm-pack-e2e.test.mjs` 全绿。
- [x] 红控制：临时把原 `:202` 行写回 ⇒ 新守卫 fail（贴输出）；换回 ⇒ pass（贴输出）。缺红控制不算达成（恒绿守卫 = 假保证）。
- [x] 行为不变：同文件行为断言 `packages/quay/test/npm-pack-e2e.test.mjs:227`（无用户级 enabledPlugins 键）保持绿；marketplace 源仍注册。
- [x] 未改判据：`goals/AC-162-register-plugin-no-user-enabled.md` 的 `criterion:` 逐字未变（`git diff` 该文件为空）。

## DoD

真实对象被操作过、判据能取假：`packages/quay/scripts/register-plugin.mjs` 的非注释行已无该字面量（原 `:202` 改写完成），且新守卫在**同一份源码**上双向可判（写回原行红 / 换回绿，两条读数落痕）；AC-162 判据在生产上由 goal-driver 下一轮从 fail 翻 pass（读 `.quay/goal-round.jsonl` 中该 AC 的 verdict）。

⛔ 反例判据：若一条 AC 在把注入/fixture 关掉后仍能通过，它只是回声——本任务的红控制正是这条的当场实现。

⛔ 只把字面量挪进注释而使运行时不告用户项目级启用（信息缩水）⇒ 不算达成。

## Touches

- packages/quay/scripts/register-plugin.mjs
- packages/quay/test/npm-pack-e2e.test.mjs
- tasks/gap-ac162-console-guidance-line-reddens-criterion.md
