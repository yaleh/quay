---
id: gap-meta-readparkingrecord
title: needs-human 停放理由有两个生产者、一个读者：worker 写的 `## Blocker` 段 parking-recheck 读不到
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
worker-driver 的 projectBlockerToTaskRecord 把 exited-not-landed 的停放理由写进 `## Blocker`，而 needs-human-parking-recheck 的 readParkingRecord 只认 `## Needs-Human` + `阻碍原因` 行 ⇒ 由 worker 路径停放的整批 needs-human 任务每轮都落 not-evaluated，它们的停放理由永远不会被重判、也就永远不会被判定为已过期。

本轮读数（parking.needsHuman.counts.not-evaluated）= `4`，采于 2026-11-06T17:17:58Z，由 meta-driver 机械采集。
涉及机制关键词：`readParkingRecord`（立案前已搜既有任务，无人认领）。

开工时（2026-11-07）对同一 store 逐条复采：4 条**全部** not-evaluated，但**没有一条是真的读不出**——3 条由 worker 路径写 `## Blocker` / `- 未落地原因：…`，1 条是人手工写进任务体的行首 `2026-11-06 人工暂停（…）：…` 行。⇒ 生产者实际有三个，读者只认其中一个；修法与「已有机制在管、只是失败」一致：**修那个读者**，⛔ 不新建并行探测器。

## AC

- [x] `node --experimental-strip-types plugin/scripts/needs-human-parking-recheck.ts --root . --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s);const c=r.counts;const total=Object.values(c).reduce((a,b)=>a+b,0);if(total<1){console.error('no needs-human tasks judged');process.exit(1)}if((c['not-evaluated']||0)>0){console.error(JSON.stringify(c));process.exit(1)}console.log(JSON.stringify(c))})"` ⇒ recheck 对每一条 needs-human 任务都能从它自己记录下来的停放理由给出判定（not-evaluated 计数为 0），而不是整批不可评估；同时判定的总数仍 >0（负控：⛔ 不许通过把任务移出 needs-human 来凑绿）。

## DoD

- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence

### 判据实跑（正/负对照，同一个 store）

- 修后（本任务分支，2026-11-07）：`{"parking-reason-stale":0,"still-blocked":0,"no-registered-judge":4,"not-evaluated":0}`，total=4，**exit 0**。
- 修前（把 `develop` 版 `needs-human-parking-recheck.ts` 原样取出、`main()` 直接跑同一个 store）：`{"parking-reason-stale":0,"still-blocked":0,"no-registered-judge":0,"not-evaluated":4}`，total=4 ⇒ **AC 红**。⇒ 判据能取假（改坏实现/回退实现时会红），不是回声。
- 负控（⛔ 没靠移出 needs-human 凑绿）：4 条任务 `status: needs-human` 原样未动，判定的**总数仍是 4**；变的是它们的状态分桶（not-evaluated → no-registered-judge），不是分母。

逐条来源（同一次读数 `tasks[]`）：

- `gap-routine-semantic-dedup-scan-discovery-config-reader-template` — via `projectBlockerToTaskRecord(## Blocker / 未落地原因)`
- `gap-routine-semantic-dedup-scan-readtasks-duplicate` — via `projectBlockerToTaskRecord(## Blocker / 未落地原因)`
- `gap-routine-semantic-dedup-scan-release-branch-prefix` — via `manual(人工暂停 line)`（该任务体里 `## Blocker` 之后还有一条更晚的人工暂停行，取**最新**记录）
- `gap-suite-default-oversubscription-assumes-dedicated-host` — via `manual(人工暂停 line)`

### 实现

- `PARKING_RECORD_SOURCES`（`needs-human-parking-recheck.ts`）：登记三种**记录形状**（driver `## Needs-Human`/`阻碍原因`、worker `## Blocker`/`未落地原因`、人手工的行首 `YYYY-MM-DD 人工暂停…` 行）。`readParkingRecord` 在**所有形状**里取**位置最靠后**的那条 —— 一个被重新停放过的任务，当前理由是**最新**那条，不论它由谁写。
- `blockerRecordInBody` + `UNREADABLE_BLOCKER_REASON`（`worker-driver.ts`）：`## Blocker` 记录的**读**器住在**写**它的模块里，与 `buildBlockerSection` / `stripBlockerSection` 共用同一对标题/行标签常量。消费者自己再拼一遍 `## Blocker`/`未落地原因` 就是本缺陷的成因（两份词表、静默漂移），所以这里刻意不复制。
- 硬规则 3b：生产者写的哨兵 `(原因读不出)` **不是原因**，读侧回 `null` ⇒ 下游仍是 `not-evaluated`，⛔ 不让「读不懂」借着可识别理由的形状变成 `no-registered-judge` 或 `clean`。
- 围栏内的 `## Blocker` / `人工暂停` 是**引用**不是记录（位置判定，硬规则 2），有夹具钉住。
- `capability-catalog-declarations.json`：QUESTION 与 INVALIDATION 两条声明同步（原 ② 只写了一种记录形态，正是产生本缺陷的那句前提）。

### AC 命令的一处更正（明记，不掩盖）

原文取值路径是 `r.needsHuman.counts`，但该脚本 `--json` 的顶层**从来没有** `needsHuman` 键（`git log -S "needsHuman:" -- plugin/scripts/needs-human-parking-recheck.ts` 零命中；消费方 promotion-driver / meta-driver 读的是扁平键 `counts` / `stale` / `tasks`，另一臂才叫 `parked`）。⇒ 原命令在任何实现下都会 `TypeError` 而 exit 1，是**判据文本的缺陷**，不是产品缺口。本次只把取值路径改成 `r.counts`，判定语义（`not-evaluated==0` 且 `total>0`）逐字不变。

### 测试

`plugin/test/needs-human-parking-recheck.test.mjs` 新增 AC1(h)(a)–(e)，夹具由**生产者自己**构造（`buildBlockerSection`）：worker 记录可读 / 人工暂停行可读 / 跨生产者取最新 / 围栏内是引用 / 哨兵仍是 not-evaluated。22 条测试全绿。

## ADR-007 dark axis

- L_D phase-declare --ld-reading（本任务提交 `HEAD~1..HEAD` 的 numstat）：docLines=0 codeLines=346 ratio=0 flagged=false verdict=PASS
- L_G：该轴仍暗,理由:本任务只改「谁被读」——新增的唯一依赖边是 needs-human-parking-recheck.ts → worker-driver.ts（复用写侧的唯一一份行标签），未改动任何模块的职责分层或抽象归属，因此没有可归因于本任务的 L_G 读数；archguard 快照是主检出上的陈旧读数，归不到本分支。

## Touches

- `plugin/scripts/needs-human-parking-recheck.ts`
- `plugin/scripts/worker-driver.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/needs-human-parking-recheck.test.mjs`
- `tasks/gap-meta-readparkingrecord.md`