---
id: gap-ac81-anchor-check-canonical-live-byte-mismatch
title: AC81 判据4 outer-anchor-check 恒报 VIOLATED——canonical prompt 829b vs live 578b 字节不符，对账不一致（registry verify 却说 OK）
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（inner 2026-08-16 立案——每 tick AC81 判据4 报 VIOLATED，但按 prompt 规则「三条全真则不动」不触发重建，差异被报告为 follow-up。实测：`outer-anchor-check.ts --layer inner --stdin` canonical 828/829b vs live 578b，byte 不符；而 `outer-cron-registry.ts --verify` 四判据全真（anchorMatches=true）。两个检查器对同一锚给出【相反】判据4 → 对账不一致，必须裁决谁对。）**

**现象**：`outer-anchor-check.ts` 读 canonical（`plugin/loop/fast-mode-loop-tick.md` 里的 inner tick prompt 段）比对 live cron prompt，字节不符（828 vs 578）。而 `outer-cron-registry.ts --verify` 说 anchorMatches=true（cron 存储 prompt sha == registry）。**两条读法对「锚是否正确」给出相反答案 ⇒ 至少一条错了（或读的是不同的正本）。**

**先行澄清（必须）**：①canonical 提取读的是 fast-mode-loop-tick.md 的哪一段（`outer-anchor-check.ts` 提取逻辑）？②registry 的 anchorMatches 比对的是什么（registry 存的 prompt hash vs CronList 的？）？③live cron prompt 到底是多少字节（578b 是我喂 stdin 的实际 text）？——三条合起来裁决：是 canonical 文档段过时（prompt 正本被改短/改长），还是 cron 创建时用了与正本不同的 prompt，还是 outer-anchor-check 提取了错误的段。

**判据1**：AC81 判据4 不再每 tick 报 VIOLATED（canonical 与 live 一致，或检查器修正）。
**判据2（能取假）**：改坏任一（canonical 或 live）仍报 VIOLATED；两条检查器（registry verify + anchor-check）对判据4 给出一致的读法。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 outer-anchor-check.ts 提取逻辑 + outer-cron-registry.ts anchorMatches 逻辑 + 实测 live/canonical 字节。
2. 裁决：canonical 段过时（更新文档）或 cron prompt 过时（重建 cron）或检查器提取 bug（修）。
3. 落地 + 测试（负控制）。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：AC81 判据4 不再恒 VIOLATED。
- [x] AC2 判据2 能取假：改坏任一仍 VIOLATED；两检查器判据4 一致。
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿（51/51 绿，EXIT 0）。

## Definition of Done

- [x] AC81 判据4 对账一致（canonical/live 一致或检查器修正），不再每 tick 报 VIOLATED。

## Evidence

**裁决 = (d) 以上皆非——doc canonical 未过时、live cron 未过时、提取无 bug；578B「live」是手工缩写假活值。**
**两检查器都正确，只是没喂同一个活值。**

**核心证据（三层全部对账一致，真值是 828B）：**
- 当前 doc AC80 canonical = **828B**，sha256 = `336ab98718d1…`（`extractCanonical` 实测）。
- 注册表 `outer-cron-registry.json` inner 记录 `promptBytes: 828`、`promptSha256: 336ab98718d1…`（**== doc canonical sha**）——registry verify 的 anchorMatches=true 由此而来。
- 主会话 transcript（`bc1a438b`）内的 inner-tick CronCreate 时间线：
  - `2026-08-14T15:14:11Z` CronCreate **815B**（旧路径 `plugin/loop/…`）→ job `025f4132`；
  - `2026-08-15T01:03:25Z`「Cancelled job 025f4132」；
  - `2026-08-15T01:03:29Z` CronCreate **828B**（新路径 `$REPO_ROOT/docs/analysis/…`）→ tool result「Scheduled recurring job **ff96ad7e**」；
  - `2026-08-15T01:03:37Z` CronList 显示 `ff96ad7e … [inner-tick] 执行内层 tick。…（…` —— **显示文本被截断（`…` 结尾）**；
  - `2026-08-15T01:04:02Z` anchor-check 喂**提取出的 canonical** ⇒ `byteCompare: {ok:true, canonicalBytes:828, liveBytes:828}` **PASS**。
- 之后无任何 inner-tick CronCreate/CronEdit ⇒ **当前 live cron（ff96ad7e）= 828B = doc canonical = registry hash**。

**578B 假活值来源**：`2026-08-16T00:03:07Z` 的 Bash 命令用 heredoc 喂了一个**手工缩写**版（删掉
`（执行核；理由/实测/代价在 $REPO_ROOT/docs/…）`、`（只 tail…）`、`（当前阶段…）` 三个括号段及反引号），
缺 `docs/analysis/fast-mode-loop-tick.md` required pointer ⇒ anchor-check 判据3 字节不符正确报 VIOLATED（canonical 828 vs live 578）。
这不是检查器错，是喂进去的值不是真 live prompt。registry verify 不接收 live 值（判据④ 比的是 doc vs registry，均 828B），故它 OK。

**根因（操作/接线层，非代码）**：doc AC81 判据2 接线只写「活 prompt 从 stdin 喂」，未说清活值必须逐字等于 cron 完整 prompt、
CronList 显示截断不可用、禁手工缩写 —— 操作者手写短版 ⇒ 每 tick 恒 VIOLATED 被误读为「canonical 过时」。

**修复（3 处 + 测试）**：
1. `plugin/scripts/outer-anchor-check.ts`（`checkAnchor` 判据3 findings）：字节不符且活输入自身缺 required pointer 时，
   追加「判据3 诊断: 活 prompt 本身非合格指针（…）——活值疑似手工缩写/旧版…」——把「canonical 过时」与「live 喂错」分开。
2. `plugin/loop/fast-mode-loop-tick.md`：修正过时 job-id（`025f4132`→`ff96ad7e`，建于 `15:17:16Z`→`01:03:45Z`，两处）；
   在 AC81 判据2 接线加「活 prompt 来源」三条（CronList 截断不可作活值 / 禁手工缩写 / 取不到完整串时以 registry 判据④ 为对账主判据）。
3. 测试：`outer-anchor-check.test.mjs` 加「578B 假活值同形 ⇒ VIOLATED + 诊断」负控制；`outer-cron-registry.test.mjs` 加
   「live doc canonical sha == 注册表 inner promptSha256」跨检查器一致测试。
   `outer-cron-registry.ts` 无需改动（anchorMatches 逻辑正确，Touches 标注「如需」）。

**post-fix 实测**：
- 喂真 canonical（828B）⇒ `byteCompare: {ok:true, canonicalBytes:828, liveBytes:828, firstDiffByte:-1}`（仅余未提交-正本 VIOLATED，提交后清零）。
- 喂 578B 短版 ⇒ `判据3: 正本 vs 活 prompt 逐字节不一致（canonical 828b vs live 578b）` + `判据3 诊断: 活 prompt 本身非合格指针（缺指向 docs/analysis/fast-mode-loop-tick.md）…`。
- `outer-cron-registry --verify --layer inner --cron-list '[{"id":"ff96ad7e",…}]'` ⇒ **code 0 OK**，四判据全真，剩余寿命 142h。
- 两测试文件：outer-anchor-check 25/25、outer-cron-registry 26/26（提交后全绿；提交前 default-path 用例因正本未提交改动按设计报 VIOLATED）。
- `--for-task` scoped 门：见下方（EXIT 0）。

**协调项（给 inner 层）**：live cron（ff96ad7e, 828B）无需重建——它已与 doc canonical/registry 逐字节一致。
若后续任何一侧单边改 canonical，registry 判据④ 与 anchor-check 判据3 会同时翻假，按 AC81 哨兵规则重建。

## Touches

- plugin/scripts/outer-anchor-check.ts（判据3 诊断：活输入缺 required pointer 时输出根因）
- plugin/scripts/outer-cron-registry.ts（无需改动——anchorMatches 逻辑正确）
- plugin/loop/fast-mode-loop-tick.md（job-id 修正 + 活 prompt 来源三条）
- plugin/test/outer-anchor-check.test.mjs（新增 578B 假活值负控制）
- plugin/test/outer-cron-registry.test.mjs（新增跨检查器一致测试）
- tasks/gap-ac81-anchor-check-canonical-live-byte-mismatch.md（自身）
