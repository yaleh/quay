---
id: gap-arch-thin-sh-wrappers-callers-call-ts-directly
title: 架构清理：27 个「≤25 行且有 TS 孪生」的薄 .sh 包装——调用方改为直接调 TS，逐个核对后退役（SPEC Phase 1c）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**SPEC Phase 1c：`sh-census-check --json` 中 `tsTwin=true ∧ codeLines≤25` 的 .sh 现有 27 个（含 experiments 侧同名条目）——它们只是 `node --experimental-strip-types <x>.ts` 的壳。把调用方改为直调 `.ts`（或经一个统一 helper），壳退役。**

**⚠️ 范围要先收窄再动手**：这 27 条里有相当一部分是 `experiments/…/scripts/*.sh` → `plugin/scripts/*.sh` 的**符号链接**（Phase 1a 的产物，计数按路径不按 inode）。真实待处理的壳数 ≠ 27。**第一步用 `git ls-files -s | awk '$1==120000'` 区分符号链接与真文件，重算真实清单**，写进 notes；符号链接侧随其目标一起处理，不单独改。

**为什么不能一把梭**：这些壳被大量入口引用（例：`audit-independence-check.sh` 的 callers 计数 ts=1 sh=1 test=4 other=25；`task-schema-check.sh`、`capability-catalog.sh` 是 CLAUDE.md 与 skill 文案点名的入口——`capability-catalog.sh` 为「唯一清单」入口，SPEC Phase 4 已明确**入口不可断**）。⇒ **对外文案点名的入口一律保留**；只处理内部调用方可安全改直调的。分批提交，每批只动 Touches 不相交的一组，避免与在飞任务抢文件。

## AC

- [ ] AC1（真实清单，枚举）贴出区分符号链接后的真实壳清单（路径 + 行数 + callers 四类计数），并给每个的处置：`保留（对外入口，理由）` / `调用方改直调后删` / `随目标处理（符号链接）`。
- [ ] AC2（引用面核对，硬规则 5）每个拟删壳：`git grep -n <basename>` 全仓前 3 条命中内容 + 动态拼接引用检查；有对外文案/skill/hook/`settings` 引用者的不删。产出「被删壳 → 直调 TS 命令」落点映射贴进提交信息。
- [ ] AC3（负控制）把一个仍被对外文案引用的壳临时列入删除集，引用面核对必须拦下；撤销后通过。两次输出贴进 notes。
- [ ] AC4（等价，characterization）对每个改直调的调用点，旧壳与新直调对同一输入的退出码与关键输出一致（贴对照）；⛔ 不得只看「脚本能跑」。
- [ ] AC5（读数下降）`sh-census-check.ts --json` 的 `totals.scripts` 下降且 `plugin/sh-census-baseline.json` 只降不升；`capability-catalog.sh --summary` 声明数与脚本数一致、`0 unclassified`。
- [ ] AC6（回归面）`scripts/test.sh --for-task gap-arch-thin-sh-wrappers-callers-call-ts-directly` 全绿，且被改调用方各自的测试文件已单独跑并贴结果。

## DoD

真实落地：真实仓库上薄壳数按 AC1 清单下降，且被保留的每个壳都有写明的「对外入口」理由；没有任何被删壳仍有引用者（AC2 的枚举为证）。

## Touches

- plugin/scripts/capability-catalog-declarations.json
- plugin/sh-census-baseline.json
- plugin/test/sh-census-check.test.mjs
- tasks/gap-arch-thin-sh-wrappers-callers-call-ts-directly.md

（具体被删壳与被改调用方文件，由实现者在 AC1 清单出来后**逐文件**补入本节——Touches 不得写目录；补入须在同一次编辑里完成。）
