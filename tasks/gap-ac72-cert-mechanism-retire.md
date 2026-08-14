---
id: gap-ac72-cert-mechanism-retire
title: AC72「cert」机制退役 + per-task suite 结果第三方可读落盘（人：「cert 是一个应尽快退役的机制」）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac67-fan-in-executor-to-task-subagent
---

**type:** execution

## Proposal

**AC72（「cert」机制退役 + per-task suite 结果必须第三方可读落盘 —— 人 2026-08-14 05:0xZ：「cert 是一个应尽快退役的机制」）判据（phase-goal 逐字）**：

**事实一：「cert」不是本仓库的机件。** 2026-08-14 实测：`capability-catalog.sh` 182 条声明 **0** 命中（唯一 grep 命中是 `uncertain` 假阳性，已打印核对）、`plugin/scripts/` 文件名 **0**、三层执行核各 **0**。**它是 inner 对一整套做法的自造简称**：主线程为每个已返回任务跑一遍全量 suite、挂 monitor 盯结果、排队等两个 suite 槽、按 `cert1/cert2/…` 编号重跑。

**事实二：替代它的机制已经写好了，只是没人说它是「替代」。** AC62（协议）+ AC67（执行者）合起来规定的是：**subagent 在自己 worktree 内 `merge develop` → 全量 suite → doc 检查 → 持锁 `ff-only`，主线程不再有 merge 动作。** **⇒ 新机制里【没有 cert 这一步】，也没有 monitor、没有主线程队列、没有重跑编号。cert 不是被替换，是【在新机制下无处安放】。**

**事实三（本条要补的洞）：没有任何一条 AC 说它退役，也没有任何一条规定【成功路径】的结果记到哪。** 逐条核过：AC62 只规定了 ff **失败**的重试记录（判据3），**成功路径零留痕**；`manager-phase-goal.md` 里 `退役` 40 处命中**无一条指向 cert**。

- **判据1（退役是可判定的事件，不是自然消失）**：inner 执行核里**不再有「为已返回任务在主线程跑 suite」的条款**；`.quay/inner-tick-log.jsonl` 的 `phase` **不再出现 `fan-in-cert-*` 族取值**。**⚠️ 后半条是自述量（4b），只作辅助**；**主判据是执行核的条款，那是位置判定。**
- **判据2（成功路径也要留痕，且第三方可读）**：每次 per-task 全量 suite 落**一条**记录，含 `taskId / runId / state / laneCount / durationMs / 失败文件清单 / 起止时刻`，**写在共享检出可读的位置**——不是 worktree 内那份 fork 继承的副本。**理由是一次实测**：四棵在飞 worktree 的 `.quay/full-suite-state.json` 的 `runId` **全部 = `eac3ee98`**、`startedAt` **全部 = `08-13T16:19:54`**，与主检出逐字相同 ⇒ **它们是 fork 时继承的同一份，不是各自的实测** ⇒ **至今零条 per-task 全量套件的时长实测**，且**第三方无法复核 cert 结果**（代价已实际发生：manager 2026-08-14 因此发出过一条错的失败文件归因，被 inner 用真 cert 输出纠回；inner 已认领 `gap-cert-result-no-third-party-readable-landing`，本 AC 与它是同一件事的两侧——**合并或互相 depends_on**）。

**⭐ 第一次实证（manager 2026-08-14 06:1xZ 实测，AC2 归因触发）——从「预测会挡住」变成「已经挡住了」**：AC68 的 AC2 归因需要判别 inner 06:04:40Z 那条 cert 红的 (a) laneCount/并发槽读数 与 (c) 失败形态，**第三方（manager/outer/人）全部读不到**——
```
读 AC67 worktree 的 .quay/full-suite-state.json  → runId=eac3ee98 startedAt=16:19:54（fork 继承的旧记录，非本次 cert）
读 .quay/fan-in-merge-lock-events.jsonl            → 尚未产生（ff 没跑过）⇒ 无法判「同刻有没有第二条 suite」
per-task cert 真结果（/tmp/… 重定向 + laneCount + 失败形态）→ 只活在 inner 会话里
```
**⇒ AC2 归因只能由 inner 单方给出，第三方无法复核。** **AC72 判据2 不再是「将来会有用」的清理性判据，它现在就是归因的前置——本次归因的不可复核性本身就是它的价值证明，也是下次有人想跳过 AC72 时的负控制。**
- **判据3（能取假·用真样本，不构造）**：**AC57 的 7 轮 cert 是现成的真实缺席样本**——回放它们，判据2 要求的记录集合**应当为空** ⇒ **必须报红**。合 D2；亦满足 AC49 判据1。
- **顺序（明确写死，决定别的条能不能落）**：**AC62 → AC67 → AC72**。
- **⚠️ 不覆盖**：不规定记录的格式与文件名（实现面）；不改 AC62 协议本体；不引入任何新的 monitor（**新机制的要点之一就是不再需要有人盯着**）；不规定 suite 槽数（那是 AC68/AC69 的范围，且人已裁定保持既定 lane 设置）。

**⚠️ 同轮附带：AC68 的「止损：不需要」已被一次新读数推翻，必须重判。**（见 AC68 任务体更新。）

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 AC62/AC67（协议+执行者）+ inner 认领的 `gap-cert-result-no-third-party-readable-landing`。
2. 判据1：inner 执行核去掉「为已返回任务在主线程跑 suite」条款（AC67 后本就无此动作——按位置判定）。
3. 判据2：per-task 全量 suite 落第三方可读记录（taskId/runId/state/laneCount/durationMs/失败文件清单/起止时刻，共享检出）——与 inner 的 gap-cert-result-no-third-party-readable-landing 合并或互相 depends_on。
4. 判据3：AC57 的 7 轮 cert 回放 ⇒ 记录集合应为空 ⇒ 必须报红（真样本，D2）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：inner 执行核无「为已返回任务在主线程跑 suite」条款（位置判定，主判据）；phase 不再出现 `fan-in-cert-*`（自述量辅助）。
- [ ] AC2 判据2：per-task 全量 suite 落一条第三方可读记录（taskId/runId/state/laneCount/durationMs/失败文件清单/起止时刻，共享检出非 worktree fork 副本）——与 inner 的 gap-cert-result-no-third-party-readable-landing 合并或互相 depends_on。
- [ ] AC3 判据3 能取假：AC57 的 7 轮 cert 回放 ⇒ 记录集合应为空 ⇒ 必须报红（真样本不构造）。
- [ ] AC4 顺序 AC62 → AC67 → AC72 遵守；不改 AC62 协议本体；不引入新 monitor。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] cert 机制退役（执行核条款消失 + phase 无 fan-in-cert-*）+ per-task suite 第三方可读记录落地 + AC57 7 轮回放红。

## Touches

- orchestration/fast-mode-tick-core.md（inner 执行核去 cert 条款——C17 外层落盘；本任务只给改法建议，不编辑）
- plugin/scripts/per-task-suite-record.ts (new)
- plugin/scripts/per-task-suite-record-check.ts (new)
- plugin/test/per-task-suite-record-check.test.mjs (new)
- .quay/per-task-suite-records.jsonl (new)
- .gitignore（新增 `.quay/per-task-suite-records.jsonl` 运行时状态 ignore）
- plugin/scripts/capability-catalog.sh（两个新脚本入目录声明）
- scripts/test.sh（接入 run_static_checks，@static-tier change）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照再生）
- tasks/gap-ac72-cert-mechanism-retire.md（自身）

## Evidence

**判据1（AC1，退役是可判定的事件）——位置判定**：两份执行核副本（`orchestration/fast-mode-tick-core.md` + `plugin/loop/fast-mode-tick-core.md`）对 `cert` 的 grep 命中均 **0**；A6 主语已是「Fan-in 回到任务 subagent」（AC67 落地——无锁段+持锁段全在 subagent 自回合内，主线程不再为已返回任务跑 suite）；C1「inner 零全量套件自跑——只读外层 suite-state，只跑 `--for-task` 选中集」照旧。**⇒ 执行核【无 cert 条款】由位置判定成立，无需删**；C17 落点只剩一件事：A6 无锁段全量 suite 之后加一步调 `per-task-suite-record.ts` 写第三方可读记录（逐字改法建议见下「C17 建议」段）。

**判据2（AC2，成功路径留痕·第三方可读）——writer 落地**：`plugin/scripts/per-task-suite-record.ts`（新增）为每次 per-task 全量 suite 追加**一条**记录（taskId/runId/state/laneCount/durationMs/failedFiles/startedAt/finishedAt）到**共享检出** `.quay/per-task-suite-records.jsonl`（gitignored 运行时状态，同 full-suite-state.json 家族）。共享检出解析 = `git rev-parse --git-common-dir` 的父目录——实测从 worktree 解析到主检出而非 fork 副本：
```
worktree cwd: /home/yale/work/quay-worktrees/gap-ac72-cert-mechanism-retire
resolveSharedCheckout: /home/yale/work/quay        ← 主检出（.git 存在）
default record file: /home/yale/work/quay/.quay/per-task-suite-records.jsonl
```
fail-closed（硬规则 3b）：缺任何必填字段 ⇒ exit 2、**不写**（无部分记录）；`--state-file` 从 full-suite-state.json 取默认值（显式 flag 优先），`failures[].file` 自动抽取为失败文件清单；`--record-file` 供 hermetic 测试覆盖。

**判据3（AC3，能取假·真样本回放）——checker 落地**：`plugin/scripts/per-task-suite-record-check.ts`（新增）+ `plugin/test/per-task-suite-record-check.test.mjs`（负控制 fixture）。AC57 的 7 轮 cert（`orchestration/manager-loop-tick.md:1796`「跑了 7 轮 cert」；fan-in 提交 `28330e5b` 以「cert9 全量绿」收尾）作为现成真实缺席样本内嵌 `REAL_AC57_CERT_ROUNDS`（runId 取本仓真实 cert-era suite runId，含 `eac3ee98`——判据2 自身点名的「无第三方记录」样本）。回放对空记录集**必须报红**（实测）：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/per-task-suite-record-check.ts --replay-real-samples --record-file /tmp/x.jsonl
per-task-suite-record-check: FAIL — per-task-suite-record-violation
  [record-shape] ok — well-formed (1 record(s))
  [expected-suite-runs] RED — missing-record (7/7 expected per-task suite run(s) not recorded) missing=eac3ee98,11ba6f95,bcf3790d-…,1d0bac1d,32265be6,19e5a998,021c5cc0
exit=1
```
全部 7 条在（taskId+runId 匹配）⇒ GREEN；部分在 ⇒ RED 列出缺的；无样本/空文件 ⇒ NOT-EVALUATED（硬规则 3b：无法评估 ≠ 合格）。`plugin/test/per-task-suite-record-check.test.mjs` **20 条全绿**（真样本回放红 + 部分缺红 + 全在绿 + malformed 形状红 + NOT-EVALUATED + writer append/fail-closed/state-file/round-trip + resolveSharedCheckout）。

**判据4（AC4，顺序 + 不覆盖）**：AC62/AC67 均已 `done`（协议与执行者先落，本条才可落）；AC62 协议本体未改（`fan-in-ff-protocol-check.ts` / `fan-in-ff-merge.sh` 未动）；未引入任何新 monitor（新机制的要点就是不再需要有人盯着）。

**判据5（AC5，测试绿 + scoped 门绿）**：
```
ts-typecheck 闸（新增 2 个 .ts）：fan-in-ts-typecheck-gate.ts → Touches cover new .ts (2); typecheck GREEN — ADMITTED (exit 0)
scoped 门：bash scripts/test.sh --for-task gap-ac72-cert-mechanism-retire --allow-thin
  → scoped 静态检查全绿（test-framework-policy PASS / test-isolation PASS /
    run_checker "per-task-suite-record-check" … → OK — nothing-to-judge (NOT-EVALUATED)）
  → 36 tests / 36 pass / 0 fail（含 capability-catalog 全绿 + per-task-suite-record-check 20 条）
capability-catalog：unclassified=0；两个新脚本五段全声明（question/cadence/invalidation/last/matching）
DELIVERY-INVENTORY：scripts 238→240，inventory_drift=0（verify-delivery-surface --write-inventory）
```

**接线（随本任务落地）**：`.gitignore` 新增 `**/.quay/per-task-suite-records.jsonl`；`capability-catalog.sh` 声明两脚本（writer=按需 / checker=每轮）；`scripts/test.sh` 接入 `run_static_checks`（@static-tier change，@static-object 含两个新脚本 + 记录文件）；`docs/proposals/quay-product-outline.md` DELIVERY-INVENTORY 快照再生。

**C17 建议（outer 落 `orchestration/fast-mode-tick-core.md` A6；`plugin/loop/fast-mode-tick-core.md` 按同一行由 inner 落 shipped 副本，AC73 判据4 双副本同改）**：执行核【无 cert 条款】已由位置判定成立，无需删；A6 无锁段 ③（全量 suite）绿后、持锁段 ④ 之前加一步：
```
node --no-warnings --experimental-strip-types plugin/scripts/per-task-suite-record.ts \
  --task-id <id> --state-file <worktree>/.quay/full-suite-state.json
（state-file 提供 runId/state/laneCount/durationMs/startedAt/finishedAt；红时失败文件清单由 writer
 从 failures[].file 自动抽取；writer 经 git common-dir 把记录写到【共享检出】.quay/per-task-suite-records.jsonl，
 非 worktree fork 副本——判据2）
```
