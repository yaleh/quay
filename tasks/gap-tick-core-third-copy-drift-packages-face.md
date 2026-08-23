---
id: gap-tick-core-third-copy-drift-packages-face
title: tick-core 第三份副本（packages/quay/plugin/loop，npm 打包面）漂移 + 检查器覆盖缺口
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
**type:** execution

## Proposal

**来源**：manager 投立案（硬规则 5b：修好一处≠修好全部）。B9 退役标注时发现 tick-core 有**三份**副本：`orchestration/`（源）、`plugin/loop/`（laid-down）、`packages/quay/plugin/loop/`（npm 打包面）。`tick-core-static-check` 的 drift pair 只配 `orchestration→plugin/loop` 两份，**第三份结构性看不见**。

**证据（实测）**：`packages/quay/plugin/loop/` 四份全漂（orchestrator-tick-core / fast-mode-tick-core / manager-tick-core / manager-loop-tick 均 `cmp` 不一致）——其中 orchestrator-tick-core 的 B9 第三触发器还是**未退役的旧文本**（写「manager 22:0x outer 补 → 跑 ready-pool-check --apply」），与源/plugin-loop 两份都漂。

**代价（manager 2026-08-23 第二实例，⛔ 同一「第三份」形态）**：判准④ 正本 2026-08-16 把读数从 `halt:` 改 `project.status` 并明文「⛔ 不要找 halt: 字段」，同日 `.claude/workflows/manager-tick-core.js` 内嵌清单也改了（其更正注释自嘲「同一文件、同一错误、第二次」），但漏了**第三处** `orchestration/manager-tick-core.md:48` 仍教 `halt:` ⇒ manager 复发 9 次、readings agent 读漂指针连续报 `notEvaluated`。**后果不只是「两份文件不一致」**：新鲜上下文 agent 读到漂指针后【把已退役做法当正本执行】⇒ 稳定产出错误读数、且伪装成 `notEvaluated` 这种看起来合规的形态——比「不整齐」严重得多。

## Plan

1. 同步 `packages/quay/plugin/loop/` 四份 tick-core 与 `orchestration/` 源（或与 `plugin/loop/` 保持一致）。
2. 扩 `tick-core-static-check` 的 drift pair 覆盖第三份（⛔ 否则下次又结构性看不见）。

## Acceptance Criteria

- [ ] AC1：`packages/quay/plugin/loop/` 四份 tick-core 与源一致（`cmp` 逐字节，⛔ 漂移 ⇒ 假）。
- [ ] AC2：`tick-core-static-check` 把第三份纳入 drift pair（⛔ 只配两份、第三份看不见 ⇒ 假）。

## Definition of Done

- [ ] 四份 packages/quay/plugin/loop/ 副本同步到与源 cmp 逐字节一致 + tick-core-static-check 扩第三份覆盖；AC1-2 全勾；land 到 develop。

## Retires

- 无（补检查覆盖 + 同步）

## Touches

- packages/quay/plugin/loop/orchestrator-tick-core.md（同步）
- packages/quay/plugin/loop/fast-mode-tick-core.md（同步）
- packages/quay/plugin/loop/manager-tick-core.md（同步）
- packages/quay/plugin/loop/manager-loop-tick.md（同步）
- plugin/scripts/tick-core-static-check.ts（drift pair 扩第三份）
- tasks/gap-tick-core-third-copy-drift-packages-face.md（自身）

## Finding（worker 阶段 2，2026-08-23 — retreat 到 needs-human）

**本任务的 AC1/AC2 建立在一个机制性错误前提上：`packages/quay/plugin/` 不是「第三份需要维护的副本」，而是 gitignored、pack 时全量再生、且被刻意改写的快照。逐字节同步（AC1）不可能；把第三份当 byte-identical drift pair 加进 `tick-core-static-check`（AC2 字面实现）会立即打红既有套件。故不强行 land，retreat 到 needs-human 待 manager 重新定范围。**

**证据（四条，每条都可一条命令复核）**：

1. **不被 git 跟踪**：`git ls-files 'packages/quay/plugin/*'` = 0；`.gitignore:26` 明文 `packages/quay/plugin/`，注释「generated SNAPSHOT … Never tracked — the source of truth is the repo-root plugin/ tree」。
2. **pack 时全量再生**：`packages/quay/scripts/package.sh:94-96` = `rm -rf "${PLUGIN_DEST}"; cp -R "${PLUGIN_SRC}/." "${PLUGIN_DEST}/"`。每次 pack 从 repo-root `plugin/` 全量重建 ⇒ **出货 artifact 永远是 pack 时刻的新鲜快照，不存在「出货漂移」**；工作树里那份只是上一次本地 pack 的陈旧残留，下次 pack 自愈，且 loop 三层从不读它。
3. **被刻意改写，非 byte-identical**：`build-plugin-dist.mjs` 的 `CONSUMER_DIRS` 含 `loop`（:49），`rewriteMarkdown`（:175-187）把 loop/*.md 里的 `plugin/scripts/X.ts` 改写成 `plugin/scripts/dist/X.js`。实测 orchestrator-tick-core 的第一处差异正是 `--experimental-strip-types …/inner-wakeup-heartbeat-check.ts` → `…/dist/inner-wakeup-heartbeat-check.js`（rewrite），叠加 Aug 21 之后源/plugin-loop 的更新（stale）⇒ npm 面的 tick-core **永远不可能与源逐字节一致**，AC1 结构上不成立。
4. **manager 两份根本没漂**：`packages/quay/plugin/loop/manager-tick-core.md` 与 `manager-loop-tick.md` 与 `plugin/loop/` 已 `cmp` 逐字节相同（都是合法 pointer）。Proposal 的「四份全漂」是把指针文件拿去和 `orchestration/` 全文 `cmp`（指针 vs 全文必然不一致）的误计。

**AC2 若照字面实现会立即打红既有套件**：`tick-core-static-check.test.mjs` 的 `buildDriftRoot()` fixture 没有 `packages/quay/plugin/`（→ shippedLines=-1 → 红）；「real repo drift GREEN」用例（:512）在 main 检出里会撞上陈旧快照（→ 红）。故「加第三份 byte-identical pair」不是补覆盖，是制造恒红。

**可选的正确定范围（供 manager 裁定）**：(a) **弃案**——npm 面是生成物、自愈、零实际代价（出货 artifact 每次 pack 重建，loop 从不读工作树里的陈旧快照）；(b) 若仍要「第三份结构可见」，正确形态不是 byte-identical pair，而是「**若** `packages/quay/plugin/loop/X` 存在，则必须等于 `rewriteMarkdown(plugin/loop/X)`（不陈旧），**不存在则 skip**（gitignored，worktree/CI 缺席）」——但这只为 gitignored 陈旧快照添机制，价值存疑。
