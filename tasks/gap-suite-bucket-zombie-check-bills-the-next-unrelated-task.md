---
id: gap-suite-bucket-zombie-check-bills-the-next-unrelated-task
title: suite-bucket-reattr ③-AC8 的僵尸检查把账记在「下一个跑套件的任务」头上（已提交 reattr 表 vs 活盘文件集）
status: todo
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

**与 seam 类的关系**：同**危害**（账算在无关任务头上），不同**机制**——这里被读的量是「一次提交的数据 vs 活盘文件集」，注入它等于取消该检查本身 ⇒ seam 不套用，另立案。

## Plan

1. **先归因**：对 10 次红各查出「谁删的文件」——`git log` 该表与那些文件的变更列，把成因提交 sha 与其所属任务列出来，证明记账错位（⛔ 不得只给形态）。
2. **让检查跟着删除者走**：要么在删除路径上强制同步该表（机制：删文件而不更新该表的提交在提交时被拦），要么把僵尸判定挪到删除发生的那一处，⛔ 不再在每个无关任务的套件轮里判。
3. ⛔ 不是「把僵尸条目删掉让红消失」——那只是把检查变成恒绿（硬规则 3b）。

## Acceptance Criteria

- [ ] AC1（归因读数，⛔ 非布尔）：10 次红各自的成因提交 sha + 该提交属于哪个任务，列表贴进读数段；并给出「红落在哪个任务身上」与「成因属于哪个任务」的错位计数。
- [ ] AC2（机制落地）：删除路径上强制同步该表，或该检查不再在每个无关任务的轮里判定。判据：写出新机制的落地文件与调用点。
- [ ] AC3（可告伪，防空转）：人为删一个 suite 测试文件而不更新该表 ⇒ 新机制必须报红。判据：干跑一次，退出码非 0，命令与输出尾部贴进读数段。⛔ 取假形态：删了仍绿 ⇒ 检查已成恒绿。
- [ ] AC4（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后该文件 `perFile` 失败率下降。判据：落地时刻 / 落地前 runs·fails（646/10）/ 落地后窗口 runs·fails / 窗口长度；落地后 runs < 20 ⇒ not-evaluated 并写明 runs 数。

## Definition of Done

- AC1 的错位列表在案（成因任务 ≠ 记账任务）。
- 新机制落地且 AC3 的干跑读数在案。
- ⛔ 不接受「把僵尸条目删掉」作为修法。

## Touches

- tasks/gap-suite-bucket-zombie-check-bills-the-next-unrelated-task.md
- plugin/test/suite-bucket-reattr-ratchet-check.test.mjs
- .quay/suite-bucket-reattribution.jsonl
