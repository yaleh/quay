---
id: gap-suite-bucket-zombie-check-bills-the-next-unrelated-task
title: suite-bucket-reattr ③-AC8 的僵尸检查把账记在「下一个跑套件的任务」头上（已提交 reattr 表 vs 活盘文件集）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：`gap-load-sensitive-tests-read-live-host-class-level-seam` 的 AC5 五本处置表。

**读数（`.quay/verification-round.jsonl`，2026-09-13 核）**：`plugin/test/suite-bucket-reattr-ratchet-check.test.mjs` 646 runs / 10 fails = **1.55%**，妨害 **8** 个不同任务。

**形态**：该文件的 `③-AC8` 拿**已提交**的重归属表（`loadReattribution(REPO_ROOT)`）与**活盘**的套件文件集（`listSuiteFiles(REPO_ROOT)`）对账，要求零僵尸条目。真正制造僵尸的是**删/移了某个 suite 测试文件的那个任务**（本仓库有大量「拆分长文件」「退役脚本」类任务）；而红落在**下一个跑套件的任务**身上——就是本类任务（`gap-load-sensitive-tests-read-live-host-class-level-seam`）要消灭的那种记账错位。

> **⚠️ 2026-09-13 归因更正（读 R1，实测证否本段末句）**：「红落在下一个**无关**任务身上」**不成立**——10 次红的成因任务与记账任务 **10/10 相同**。真正的形态是「**迟到**」而非「错位」：删除与「同步删条目」是两个提交，僵尸只活在**删除者自己的分支**上（develop 没有），所以只有删除者自己的套件轮会红；该变更在删除那一刻**拿不到任何信号**，要等数小时后烧掉一整轮全量套件才知道，并额外付一次「清僵尸条目」的补提交。修法（Plan 2 的第二支）不变，理由换成实测的这条。

**与 seam 类的关系**：同**危害**（账算在无关任务头上），不同**机制**——这里被读的量是「一次提交的数据 vs 活盘文件集」，注入它等于取消该检查本身 ⇒ seam 不套用，另立案。

## Plan

1. **先归因**：对 10 次红各查出「谁删的文件」——`git log` 该表与那些文件的变更列，把成因提交 sha 与其所属任务列出来，证明记账错位（⛔ 不得只给形态）。→ 读数 R1。
2. **让检查跟着删除者走**：要么在删除路径上强制同步该表（机制：删文件而不更新该表的提交在提交时被拦），要么把僵尸判定挪到删除发生的那一处，⛔ 不再在每个无关任务的套件轮里判。→ 采第二支：判定从「只在单测里（= 只在全量套件某一轮判）」移进 checker 本身的第 3 层阻断条件；该 checker 是 `@static-tier change` 且 `@static-object` 含 `plugin/test/` 等，`scripts/test.sh` 的 **scoped** 轮会为「删了 suite 测试文件的那个变更」选中它 ⇒ 制造僵尸的变更在自己那一刻（秒级）被判红。落地文件与调用点见 R2。
3. ⛔ 不是「把僵尸条目删掉让红消失」——那只是把检查变成恒绿（硬规则 3b）。→ 本任务**未改** `.quay/suite-bucket-reattribution.jsonl`（本仓当前 0 僵尸）。

## Acceptance Criteria

- [x] AC1（归因读数，⛔ 非布尔）：10 次红各自的成因提交 sha + 该提交属于哪个任务，列表贴进读数段；并给出「红落在哪个任务身上」与「成因属于哪个任务」的错位计数。→ R1（含 10 行表 + 错位计数 **0/10**）
- [x] AC2（机制落地）：删除路径上强制同步该表，或该检查不再在每个无关任务的轮里判定。判据：写出新机制的落地文件与调用点。→ R2 的「落地文件与调用点」四条
- [x] AC3（可告伪，防空转）：人为删一个 suite 测试文件而不更新该表 ⇒ 新机制必须报红。判据：干跑一次，退出码非 0，命令与输出尾部贴进读数段。⛔ 取假形态：删了仍绿 ⇒ 检查已成恒绿。→ R2（含 (a)(b)(c) 三点与退出码矩阵）
- [ ] AC4（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后该文件 `perFile` 失败率下降。判据：落地时刻 / 落地前 runs·fails（646/10）/ 落地后窗口 runs·fails / 窗口长度；落地后 runs < 20 ⇒ not-evaluated 并写明 runs 数。（待外部）

## Definition of Done

- AC1 的错位列表在案（成因任务 ≠ 记账任务）。→ 列表在案（R1）；**括号里的不等式实测不成立（0/10）**，已在 R1 与 Proposal 更正里写明，不静默改写。
- 新机制落地且 AC3 的干跑读数在案。→ 是（R2）。
- ⛔ 不接受「把僵尸条目删掉」作为修法。→ 未采用；表未改。

## Touches

- tasks/gap-suite-bucket-zombie-check-bills-the-next-unrelated-task.md
- plugin/scripts/suite-bucket-reattr-ratchet-check.ts
- plugin/test/suite-bucket-reattr-ratchet-check.test.mjs
- plugin/scripts/checker-mutation-cases/suite-bucket-reattr-ratchet-check.sh
- plugin/scripts/runner-static-gate.ts
- .quay/suite-bucket-reattribution.jsonl

## Readings（AC1/AC3/AC4 的读数段）

### R1 — AC1 归因（非布尔）

数据源：`.quay/verification-round.jsonl`（1617 轮）+ git 管道（**不是**对失败行做关键词匹配）。
重放方法（可复现）：对每次红的 terminal commit，重建「该 commit 上的重归属表 ∩ 该 commit 的 suite 文件集（三条 SUITE_GLOBS）」得到僵尸集；再对每个僵尸跑 `git log --diff-filter=D -1 <红commit> -- <path>` 取成因提交与其所属任务。

| # | 红 round / 时刻（UTC） | 记账任务（record `taskId`） | 僵尸数 | 成因提交 | 该提交属于哪个任务 |
|---|---|---|---|---|---|
| 1 | 749 · 2026-08-30T16:08 | gap-retire-governance-group-merge-into-bucket | 2 | `4179100385` | 同上（该提交在本任务分支上：`test: 退役 @test-group governance 第三套选择机制——并入 bucket`） |
| 2 | 837 · 2026-09-01T10:54 | gap-retire-inner-session-hygiene-scripts | 8 | `e48656f87c` | gap-retire-inner-session-hygiene-scripts |
| 3 | 853 · 2026-09-01T16:29 | gap-retire-inner-session-check-script | 1 | `b8cd504419` | gap-retire-inner-session-check-script |
| 4 | 859 · 2026-09-01T17:21 | gap-retire-inner-session-check-script | 1 | `b8cd504419` | gap-retire-inner-session-check-script |
| 5 | 989 · 2026-09-04T12:42 | gap-retire-outer-tmux-window-logic | 2 | `87df601bef` | gap-retire-outer-tmux-window-logic |
| 6 | 1210 · 2026-09-07T12:41 | gap-delivery-critical-mechanical-axis-orphaned-needs-ruling | 1 | `480ddb7c34` | gap-delivery-critical-mechanical-axis-orphaned-needs-ruling |
| 7 | 1214 · 2026-09-07T13:37 | gap-delivery-critical-mechanical-axis-orphaned-needs-ruling | 1 | `480ddb7c34` | gap-delivery-critical-mechanical-axis-orphaned-needs-ruling |
| 8 | 1254 · 2026-09-07T21:42 | gap-ac166-second-copy-retirement | 1 | `2cf0f42db9` | gap-ac166-second-copy-retirement |
| 9 | 1321 · 2026-09-08T14:52 | gap-quay-init-closure-shrink-body | 5 | `40743cf74f`（4）+ `6358b2cd65`（1） | gap-quay-init-closure-shrink-body |
| 10 | 1339 · 2026-09-08T17:39 | gap-ac158-execute-archive-batch-one | 8 | `9547d48ebe` | gap-ac158-execute-archive-batch-one |

**错位计数：「成因任务 ≠ 记账任务」= 0 / 10；「相同」= 10 / 10。**

三条支撑读数（各自可取假，不是形态描述）：
1. **删除与「同步删条目」是两个提交**：10/10 的成因提交都**没有**触碰 `.quay/suite-bucket-reattribution.jsonl`（`git show --stat` 核）。
2. **僵尸只活在删除者自己的分支上**：对每次红取该 merge commit 的两个父（任务尖 vs develop），成因提交是**任务尖的祖先、develop 父的祖先之外**（`git merge-base --is-ancestor` 逐个核：10/10 为「是任务尖祖先 ∧ 非 develop 父祖先」）⇒ 只有删除者自己的套件轮会红。
3. **每次红之后都跟着一条专门的「清僵尸条目」补提交**（7 条）：`9383c5c40`(08-30) / `29a805b56`(09-01) / `b47d0ecb2`(09-04) / `bc0407860`(09-07) / `e0b1e1e15`(09-08) / `399e1e2c4`(09-08) / `8caeab89a`(09-08) —— 这 7 条提交信息自述其成因就是本例（例：`8caeab89a  gap-ac158: drop 8 zombie suite-bucket reattribution entries (tests archived this batch)`）。

⇒ 代价形态：**8 个任务**各烧掉一整轮全量套件（本文件 perFile 651 runs / 10 fails = 1.54%，窗口 2026-08-30T14:23Z..2026-09-13T07:25Z），并各付一次补提交。

### R2 — AC2 落地文件与调用点 / AC3 干跑

**AC2（机制）——落地文件与调用点（4 条）**
1. `plugin/scripts/suite-bucket-reattr-ratchet-check.ts` —— `checkReattrRatchet()` 新增 `report.zombies`（第 3 层，阻断）；`--gate` 退出条件由 `layer1>0` 改为 `layer1>0 || zombies>0`；无表（NOT-EVALUATED，exit 3）时 `zombies` 恒空——**缺输入不是「体检合格」**。
2. `plugin/scripts/runner-static-gate.ts:287` —— 既有 `run_checker "suite-bucket-reattr-ratchet-check" ... --gate` 登记点（`@static-tier change`，`@static-object` 已含 `plugin/test/`、`experiments/*/test/`、`packages/*/test/`、表本身）⇒ 第 3 层**无需新登记**即进入静态门。
3. `plugin/scripts/select-static-checks-for-touches.ts` —— scoped 轮据此按 `@static-object ∩ ## Touches` 选中该 checker。实测：`--touches plugin/test/ac56-recommended-deordered-check.test.mjs --commands` ⇒ **命中 1 条**（负控制：`--touches tasks/<无关任务>.md` ⇒ **命中 0**）。⇒ 删除 suite 测试文件的那个变更在自己的 scoped 门就被判红。
4. `plugin/scripts/checker-mutation-cases/suite-bucket-reattr-ratchet-check.sh` —— 新增 cycle B（保留归属、删掉条目所指文件 ⇒ 必须红），与 cycle A（第 1 层）分层。

**AC3（可告伪）——干跑，真数据副本（`cp -a` 本 worktree 的 `plugin/` + `packages/` + `experiments/quay-perpetual-stream/test/` + 表），⛔ 非 fixture**
```
root=[/tmp/zombie-dryrun-real2]        # 显式设值——见下方「一次假阴性」
CMD = node --experimental-strip-types <wt>/plugin/scripts/suite-bucket-reattr-ratchet-check.ts --gate --root $DRY

(a) 未删任何文件
    PASS — reattribution ratchet: 0 pure-S un-attributed test(s) (layer 1, blocking); 0 zombie entr(y|ies) (layer 3, blocking); 29 S-signal-multi un-attributed (layer 2, report-only)
    exit=0
(b) 删 plugin/test/ac56-recommended-deordered-check.test.mjs（表中一条真实条目），表不动
    FAIL — 1 zombie reattribution entr(y|ies) (layer 3, blocking — the entry's file is no longer a suite test; drop the entry in the same change that deletes/archives the file):
      - plugin/test/ac56-recommended-deordered-check.test.mjs
      (layer 2 report-only: 29 S-signal-multi un-attributed)
    exit=1
(c) 对照：把同一入口从表里删掉 ⇒ 回到绿（证明 (b) 的红就是僵尸，不是别的）
    PASS — ...
    exit=0
```
退出码矩阵（**不经管道取 `$?`**）：`0` PASS · `1` 僵尸或第 1 层 · `2` 用法 · `3` NOT-EVALUATED（无表）。

**⚠️ 一次假阴性，记录在案（硬规则 2 的形态）**：第一次干跑我把 `--root` 传成**未设的变量**（展开为空 ⇒ `path.resolve("")` 解析到**主检出**，主检出 0 僵尸），于是「删了文件」却读到 `PASS`——差一步就把「检查已成恒绿」当成结论。把 root 显式设值后重跑才拿到 (b) 的 `exit=1`。**零计数/恒绿读数必须对已知为真的样本干跑一次**，否则假阴性没有命中可打印。

### R3 — AC4 生产载体（**not-evaluated**）

- 落地时刻：**尚未落地**（本任务在写此读数时仍未 fan-in；fan-in 由 worker-driver 机械执行）。
- 落地前：`perFile` **651 runs / 10 fails（1.54%）**，窗口 `2026-08-30T14:23:53Z .. 2026-09-13T07:25:18Z`。
- 落地后窗口：**runs = 0** ⇒ `runs < 20` ⇒ 按 AC4 明文记 **not-evaluated**，**不勾选**（勾了就是用回声冒充测量）。
- 复算命令：对 `.quay/verification-round.jsonl` 逐行取 `perFile[].file == "plugin/test/suite-bucket-reattr-ratchet-check.test.mjs"`，计 `passed===false` 的条数与总条数。
