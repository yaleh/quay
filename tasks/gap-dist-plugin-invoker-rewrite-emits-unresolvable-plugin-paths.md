---
id: gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths
title: dist-plugin 交付面的 dist 引用在消费项目里解析不到：重写器只换扩展名、从不加 plugin-root 锚（96/96 错形 +
  11 条悬空 .ts 兄弟实例）
status: done
labels:
  - gap
  - defect
  - packaging
parent: null
children: []
extra:
  schema: v1
goal_ac: AC-260
---
## Proposal

把 AC-260 的缺口当成**一个重写器缺陷**来修：机制修在 `packages/quay/scripts/build-plugin-dist.mjs` 的重写函数里，而不是逐个手改交付面上的文档。问题框架与根因见 `## Finding`，选定机制见 `## Requested action`，可执行的量见 `## Contract`。

## Finding

AC-260 的缺口：`dist-plugin` 交付面（marketplace 渠道真正被消费的那个面，由 `plugin/scripts/publish-dist-branch.sh` 生成）上，`.md` 里的 `scripts/dist/*.js` 引用全部带 cwd 相对 `plugin/` 前缀，例如 `plugin/scripts/dist/task-status-drift-check.js`。消费项目里 plugin 本身就是树根（plugin-level marketplace source 不支持 `path` 参数，见 `publish-dist-branch.sh:106-107`），所以这些路径在消费项目里解析不到。

**根因（已读代码，非推断）**：`packages/quay/scripts/build-plugin-dist.mjs` 的 `rewriteMarkdown()`（`:445-459`）把 `plugin/scripts/X.ts` 改写成 `plugin/scripts/dist/X.js` —— 只换扩展名，**从不引入任何 plugin-root 锚**（该文件内 `CLAUDE_PLUGIN_ROOT` grep = 0 命中）。`rewriteShell()`（`:466-501`）对 `.sh` 是同一形状。这是 `SPEC-plugin-lifecycle-single-bundle-2026-09-02.md:203-206` 活着的那一半：引擎解析已由 `packages/quay/src/plugin-root.ts` 修好，产物里的路径没修。

**基线（2026-09-15 本会话重测，直接读分支内容而非转述）**：`dist-plugin` 分支 66 个 `.md`，`scripts/dist/*.js` 引用 **96 条，96 条全是 offender**，正确形式 0 条 —— 与 AC-260 的记载逐字一致。放宽到全部载体：50 个文件共 **260 条** cwd 相对 `plugin/` 前缀引用（`.md` 96 / `.sh` 134 / `.js` 30）。

**同类兄弟实例（硬规则 5b：修好被报出来的那一个 ≠ 只有那一个）**：同一分支上还有 **11 条** `${CLAUDE_PLUGIN_ROOT}/scripts/X.ts` 形式的引用（5 个 SKILL.md：loop-driver 5、routines 3、quay-directive / quay-file-task / quay-task-operator 各 1）。它们的锚是对的，但指向的 raw `.ts` 已被 `publish-dist-branch.sh:136` 的 strip 步删除（11 个目标在该分支上逐个验证均不存在），而对应的 `scripts/dist/*.js` 打包产物存在（抽样 `scripts/dist/concurrent-batch-scheduler.js` = 存在）。AC-260 的谓词**数不到它们**（不带 cwd 相对 `plugin/` 前缀）⇒ 只修那 96 条会让 AC-260 变绿而交付面仍是半坏。两类同一根因：重写器不认识「以 plugin 根为锚」这种形态，必须一起修。

<!-- dedup-ref -->
关联（仅供追溯，不构成任何依赖）：`gap-delivery-laydown-dist-closure-gap`（done）当初引入的正是本文件的 .md 重写规则；`gap-dist-plugin-missing-node-modules-task-schema-yaml`（done）修的是同一条发布链的 strip 步。两者都不覆盖本缺陷。

## Requested action

1. 在 `packages/quay/scripts/build-plugin-dist.mjs` 的两个重写函数里，把产出路径从**仓库相对**形态改成**以 plugin 根为锚**的形态（`rewriteMarkdown()` 管 `.md`/`.js`，`rewriteShell()` 管 `.sh`）—— 只改一处会让另一侧同样数量的残留原样留下。
2. 让同一函数认识「已经以 plugin 根为锚、但仍指向 raw `.ts`」的那一类（本轮实测 11 条），把它们改写成对应的 dist 产物形态：这类引用在产物分支上指向的文件已被 strip 步删掉。
3. 同步更正 `packages/quay/test/build-plugin-dist.test.mjs` 里把缺陷形态写成期望值的两条既有断言，并补上覆盖上述两种输入形态的用例。
4. 改完重跑 `bash plugin/scripts/publish-dist-branch.sh` 重新生成交付面分支（本地提交即可，判据读本地 ref；无需 `--push`，也无需改这个脚本），然后再跑 AC-260 的谓词取值。

## Contract

```
measure bad_refs = dist-plugin 分支全部 .md 中 cwd 相对 plugin/{scripts,gate-scripts}/dist/*.js 引用数（即 AC-260 的谓词）；本轮基线 96
measure total_refs = 同一集合里 scripts/dist/*.js 引用总数；本轮基线 96
measure dangling_root_ts = 该分支上 plugin-root 锚定的 scripts/*.ts 引用里、目标文件不存在于该分支的条数；本轮基线 11
band all_clear = bad_refs == 0 且 total_refs >= 1 且 dangling_root_ts == 0
invariant root_relative_only = 重写器产出的每条路径都必须相对 plugin 根可解析；不得产出依赖「当前工作目录恰好是仓库根」的路径（消费项目里 plugin 就是树根）
invoke `bash plugin/scripts/publish-dist-branch.sh`
control before_fix_nonzero = 重跑发布【之前】对同一谓词取一次读数，必须仍报 96 offenders（本轮已实测基线）—— 证明该扫描能命中，故修后的 0 携带信息（硬规则 3b）
resume `node --test packages/quay/test/build-plugin-dist.test.mjs`
```

## Acceptance Criteria

- [x] AC1 机制修在重写器：`node --test packages/quay/test/build-plugin-dist.test.mjs` exit 0，且用例断言重写函数对 `plugin/scripts/X.ts` 与 plugin-root 锚定的 `scripts/X.ts` 两种输入，产出都相对 plugin 根可解析、都不含 cwd 相对 `plugin/` 前缀。⚠️ 既有两条断言（`:136` 期望 `<root>/plugin/scripts/dist/...`、`:155` 期望 `plugin/scripts/dist/...`）**正在把缺陷形态钉成期望值**，必须一并更正。
- [x] AC2 交付面判据（不锁实现形式）：改后重跑 `bash plugin/scripts/publish-dist-branch.sh`，再逐字执行 `goals/AC-260-*.md` 里 criterion 的 python 谓词，exit 0 且原始输出落档。判据刻意不要求必须写成 `${CLAUDE_PLUGIN_ROOT}`：若实测该变量在 SKILL.md 正文上下文不可用，可换任何等价自解析形式而**无需改判据**。
- [x] AC3 兄弟实例扫描（硬规则 5b 的产物）：对 `dist-plugin` 分支跑一次覆盖全部载体（`.md` / `.sh` / `.js`）的同类扫描，把**命中数与前 3 条实际命中**贴进证据；修后 cwd 相对 `plugin/` 前缀引用与悬空 `.ts` 引用均为 0。只修 `.md` 里那 96 条 ⇒ 本 AC 不满足。
- [x] AC4 负控制：谓词读的是**分支内容**而非工作树。用修前的分支状态跑同一谓词必须报非零 offender（96）并留档，与修后对拍；给不出修前读数则修后的 0 不作数（硬规则 2 / 3b）。

## Definition of Done

- [x] 标准 DoD（`inherited-core` 的 standard clauses，由 `it0-dod-check.sh` 这个 meta-enforcer 强制）逐条适用：真实落地 = 交付面分支上的**实际内容**变了，不是产物存在、也不是命令 exit 0。
- [x] 改动落在 `packages/quay/scripts/build-plugin-dist.mjs` 与其单测；**不手改 `plugin/**/*.md` 源来打补丁** —— 源里的 dev 形态是对的，坏的是重写产物。
- [x] `dist-plugin` 分支已重跑发布，并从**每个受影响面各抽一个文件**核内容（`git show dist-plugin:skills/loop-driver/SKILL.md`、`git show dist-plugin:loop/fast-mode-loop-tick.md`、任一 `.sh`），肉眼可见路径已是相对 plugin 根可解析的 dist 形式。
- [x] 「跑过一次 publish」不算落地：落地证据是**分支上的实际文件内容**，不是命令 exit 0。
- [x] `plugin/scripts/publish-dist-branch.sh` 只被**运行**、不被修改（主发布渠道的闭包断言属 AC-263 的范围，此处不重复实现），故不进 Touches。
- [x] 证据落 `.quay/ac260-*.txt`（修前基线 + 修后谓词原文 + AC3 的扫描计数与前 3 条命中）并随改动提交。

## Touches

- packages/quay/scripts/build-plugin-dist.mjs
- packages/quay/test/build-plugin-dist.test.mjs
- tasks/gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths.md
- .quay/ac260-criterion.py
- .quay/ac260-before-predicate.txt
- .quay/ac260-after-predicate.txt
- .quay/ac260-before-scan.txt
- .quay/ac260-after-scan.txt
- .quay/ac260-before-stderr.txt
- .quay/ac260-after-stderr.txt
- .quay/ac260-sibling-scan.txt
- .quay/ac260-branch-content-spotchecks.txt
- .quay/ac260-residual-after.txt
- .quay/ac260-residual.py
- .quay/ac260-scan.py
- .quay/ac260-evidence-notes.txt
