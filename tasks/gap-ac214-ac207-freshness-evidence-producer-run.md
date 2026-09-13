---
id: gap-ac214-ac207-freshness-evidence-producer-run
title: AC-214 首次因【陈旧】转红：AC-207 的交付证据停在 2026-09-11（距 develop-tip 203 个交付面提交 >
  K=200），而同一批运行把其余五个主体都刷成了 fresh——`--ac207-e2e` 是 opt-in 且昂贵，没人跑它
status: ready
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-214
---
## Proposal

**判据正本**：`goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md`（goal=GOAL-009，`long-term: true`，status=achieved）。exit 0 = AC-201/203/205/207/232/238/239 各自**最新**证据记录的 `build_sha` 到 develop-tip 的【交付面提交距离】均 ≤ K（默认 200，`QUAY_GOAL009_FRESHNESS_K` 可配），且机械推导出的载体型主体集合 SUBJ 中无 NEED 之外的成员；exit 1 = 任一条无证据或证据陈旧；exit 3 = 载体缺失 / rev-list 读不出（NOT-EVALUATED，⛔ 不与合格同形）。

**本次转红（本轮实测，⛔ 非引述）**：在本仓库根把 AC-214 的 `criterion` 逐字取出用 `python3` 跑 ⇒ **exit 1**，stdout 七行 + stderr 逐字：

```
freshness GOAL-009-AC-201: 40/200 (margin 160)
freshness GOAL-009-AC-232: 40/200 (margin 160)
freshness GOAL-009-AC-205: 40/200 (margin 160)
freshness GOAL-009-AC-207: 203/200 (margin -3)
freshness GOAL-009-AC-203: 40/200 (margin 160)
freshness GOAL-009-AC-238: 134/200 (margin 66)
freshness GOAL-009-AC-239: 134/200 (margin 66)
stale evidence: GOAL-009-AC-207:203/200 (margin -3)
```

⇒ 唯一越界者是 **AC-207**（端到端：目标项目自己的 `*-drivers` 驱动出真实开发提交且任务翻 done）。运行时快照 `.quay/goal-freshness-margin.json`（`2026-09-13T11:03:16Z`）与上表逐字一致，`k=200`。

**为什么是它（按位置判定，⛔ 不是「过期了」这一句）**：载体 `.quay/productization-verification.jsonl` 里 `ac="GOAL-009-AC-207"` 的最新记录 `ts=2026-09-11T04:48:31Z`、`build_sha=4a9654a1e378b22cdc11d8a18627c3cd50ddd03b`、`commit_sha=aff2c2ed46d999e488ef399e611d5abeacf7179f`、`task_id=e2e-verify-207`、`host=orangevps`（该 AC 共 3 条记录，全在 2026-09-11 01:21–04:48Z）；`git rev-list --count 4a9654a1..develop -- <交付面 paths>` = **203**（K=200）。**对照（本任务存在的理由）**：同一天 `05:06`–`05:32Z` 有 **6 次真实跨机 `--verify-coldstart` 运行**（B=orangevps / C=instance-20221019-1509，经 `develop-deliver-tgz.sh` 运输），把**其余每一个主体**都刷新成 fresh（AC-201/203/205/232 = 40，AC-238/239 = 134）——**唯独 AC-207 没有当天的记录**。原因是它的探针在 `--ac207-e2e` 后面（opt-in、要在第三方项目里真 spawn worker、`AC207_POLL_SECS` 缺省 3600s），而那次运行**显式没有传**该 flag：`tasks/gap-ac203-two-distinct-kinds-no-production-run.md` 的 Plan 第 1 步逐字「⛔ 本步不需要 `--ac207-e2e`（AC-240 配对是另一条判据，且它要 target 侧 `profiles.yml` + 真 worker，代价高）」。

**为什么更早的修复没有兜住（⛔ 不是那三条被证否）**：三条 done 且顶层 `goal_ac: AC-214` 的任务（`gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207`、`gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable`）与同族的 `gap-ac244-freshness-subject-set-mechanically-derived`，解决的都是**可达性**：产出侧写出顶层 `build_sha`、主体集合改为机械推导并接线 AC-232/238/239。**它们都不是「产出者」**——本判据的设计就是随 develop 前进而**自动转红**（AC 正文逐字：「把证据换成 434 个交付面提交之前的 commit ⇒ exit 1 `stale evidence`（证明随 develop 前进会自动转红）」），因此它需要一个**在 K 窗口内重跑一次证据产出验证**的动作。那三条修的是「能不能被满足」，不是「有没有人在窗口内重跑」。⇒ 它们的绿是真的，本条的成因不同（硬规则 5b：同族 ≠ 同一处；缺陷是成簇的，但簇里可以有不同机制）。

**并且这是【第一次】因陈旧而转红（发生率，硬规则 12）**：`.quay/goal-round.jsonl` 全历史里 AC-214 的 verdict 只有 4 次翻转 —— `2026-09-09T06:48:35Z` fail（`acceptance failed (exit 1)`，无证据）→ `2026-09-11T03:05:11Z` pass → `2026-09-11T17:09:29Z` fail（`carrier-type AC with no freshness bound in NEED: GOAL-009-AC-239`，主体集合未接线）→ `2026-09-11T17:17:42Z` pass。**`stale evidence:` 这一支此前从未出现过，发生率为 1。**

**关闭它的动作**：一次真实的、带 AC-207 e2e 的跨机产出运行 —— `bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B"`：
- 从 develop-tip 现 build 两个 `.tgz`（`--build-root` 语义：`build_sha`/日期/产物 sha256 全由该次运行自己取），scp 到目标主机；
- 远端跑 `verify-deliver-coldstart.sh --ac207-e2e`（`--build-sha` 由驱动方传入 = 该 develop tip；`--ac207-e2e` 时驱动方还会 scp `.quay/profiles.yml` 到远端 `~/quay-driving-profiles.yml` 并把 `~/.local/bin` 前置进 PATH）；
- 证据文件 scp 回后经 `transport_evidence_append` 追加进**本地**载体 `.quay/productization-verification.jsonl`（按记录**全字段**去重）——**AC-207 正文里那一步「跑完之后必须把证据取回家」的手工 `ssh + grep + >>` 已由该运输层自动化**，⛔ 不需要也不再允许整文件覆盖；
- 记录经 `ac_record_append` 统一补**顶层** `build_sha`（= 该次 develop tip，40-hex）⇒ 到 develop 的距离 ≈ 0 ⇒ AC-214 转绿。

<!-- dedup-ref -->
相关但机制不同的既有任务（均 done，不构成重复）：`gap-ac207-e2e-target-driver-driven-real-commit-task-done`（第一次产出 AC-207 记录）、`gap-ac207-e2e-producer-section-never-landed-on-develop`、`gap-ac240-e2e-closure-same-run-pairing`（同一次运行内 AC-203/AC-207 的配对判定）、`gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable`、`gap-third-party-evidence-no-transport-to-driving-repo-carrier`（运输机件本体）——它们都是**产出侧机制**；本任务要的是**该机制在窗口内被真跑一次**的读数。另：`gap-ac203-two-distinct-kinds-no-production-run`（ready，`goal_ac: AC-203`）是同日同区域的运行型任务，但它的交付物是 AC-203 的 kind 维度记录，⛔ 与 AC-207 的记录不是同一条。在飞任务里 `goal_ac: AC-214` 者为 **0**（`task_list` 实查：todo 2 条 / ready 11 条，无一条持该 goal_ac）。

**观察项（⛔ 全部不阻塞本任务；硬规则 12：给不出发生率的不得作阻塞）**：
1. `develop-deliver-tgz.sh` 的 `expected_acs`（`:1643` 附近）在 `--ac207-e2e` 时**仍不含** `GOAL-009-AC-207`，其自身注释逐字「AC-207 仅 --ac207-e2e 时预期，不在此列」⇒ 一次「声明要产出 AC-207 却静默没产出」的运行，`check_evidence_completeness` **看不出来**，仍可能打印 `OK`（硬规则 3b：部分产出与合格同形）。**已观测发生率：0**。它是同日刚落地的同类修复（同一文件 `transport_evidence_append` 的 kind 维度被旧四键签名吞掉）的**兄弟实例**（硬规则 5b）。⛔ 不在本任务里顺手改——本任务若是零代码改动，着地路径最轻；若本次运行**真的**出现「OK 但无 AC-207 记录」，就地另立一条任务。
2. 交付证据**没有周期性触发器**：`.quay/config.yml` 的 `loop.routines` 只有 self-validation / architecture-analysis / history-mining / browser-explorer 四条，没有刷新交付证据的那条。按 AC 正文实测基线 ~85 交付面提交/天，K=200 ≈ 2.4 天 ⇒ 每个主体都会在窗口外老化，除非有人重跑。**发生率：1**（本条）。AC-214 正文自己把 K 的重估点定在「跑满 30 个自然日后用真实分布重估」（2026-09-09 + 30d）⇒ 现在改 K 或加触发器都还没有数据支撑，只如实记录。

## Plan

0. **先查重复（机制维度，⛔ 非关键词）**：`task_list` 列出全部 `todo`/`ready`/`needs-human` 任务，核 `goal_ac: AC-214` 的在飞者为 0；再核没有第二个任务持本任务 `## Touches` 的文件（特别核 `gap-ac203-two-distinct-kinds-no-production-run` 的 Touches 与本任务是否相交）。
1. **改前读数（能取假，硬规则 3b）**：从 `goals/AC-214-*.md` 取 `criterion` 逐字跑 `python3` ⇒ 贴 **exit 1** + 七行 stdout + stderr `stale evidence: GOAL-009-AC-207:203/200 (margin -3)`；同时 `grep 'GOAL-009-AC-207' .quay/productization-verification.jsonl` 贴出该 AC 全部记录的 `ts`/`build_sha`，证明最新一条停在 2026-09-11。实现者复跑确认，⛔ 不引述本节结论。
2. **跑产出者**：`bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B"`（加 `C` 可选，⛔ 非必需；AC-214 只需 ≥1 条新鲜记录）。贴该命令的退出码与全部 `develop-deliver:` 行（含每台机的 `remote verify rc=`、`EVIDENCE-TRANSPORT appended=`、结尾 `PARTIAL` / `PARTIAL FAILURE` / `OK`）。**退出码 2（PARTIAL）不自动等于失败**：它表示「运输成功但有声明要产出的记录缺失」，必须先读出缺的是哪一条再判（⛔ 不以退出码冒充成功，也不因它掩盖 AC-207 的读数）。
3. **读本次运行自己的 stdout（⛔ 不采信「我跑过了」）**：读 `.quay/verify-coldstart-remote-B-<tip8>.log` 的 step⑤（AC-207 e2e）段，贴 `[⑤ e2e]` 行与 `ac207 record written` 行；**若一行都没写**，贴 fail-closed 的原文并就此停下（硬规则 3b：缺值 ≠ 合格，⛔ 不得手写记录、不得从别处搬一条旧记录充数）。同时贴该次运行的 `E2E_CLOSURE_SELF_EVIDENCED=` 取值（三态可区分）。
4. **确认记录真的落到本地载体（按位置）**：在 `.quay/productization-verification.jsonl` 里 `grep` 出 `ac="GOAL-009-AC-207"` 且 `ts` 晚于本次运行开始时刻的记录，贴记录全文。
5. **判据转绿（干跑 criterion 本体，⛔ 不是「我看它绿了」）**：AC-207 criterion ⇒ 贴 exit 0；AC-214 criterion ⇒ 贴 exit 0 + 七行 freshness（全部 margin > 0）+ `.quay/goal-freshness-margin.json` 内容。
6. **负控制（判据仍能取假）**：`QUAY_GOAL009_FRESHNESS_K=1` 重跑 AC-214 criterion ⇒ **exit 1** 且 stderr 指名主体（证明本次转绿不是「判据恒绿」）；并贴负控制前后 `.quay/productization-verification.jsonl` 的 md5 相同（⛔ 该命令只读，未污染生产载体）。

## Acceptance Criteria

- [ ] AC1 改前读数（能取假）：本仓库根干跑 AC-214 criterion ⇒ **exit 1**，stderr 逐字含 `stale evidence: GOAL-009-AC-207:203/200 (margin -3)`；并贴载体里 `ac="GOAL-009-AC-207"` 全部记录的 `ts`/`build_sha`，证明最新一条停在 2026-09-11（`4a9654a1…`）。⛔ 引述不算，须实现者复跑。
- [ ] AC2 产出运行的**真**读数（⛔ 不是 `--selfcheck`、⛔ 不是夹具）：贴 `develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B"` 的退出码 + 全部 `develop-deliver:` 行；贴 `.quay/verify-coldstart-remote-B-<tip8>.log` 的 step⑤ 段（`ac207 record written` 行，或失败时的 fail-closed 原文）与 `E2E_CLOSURE_SELF_EVIDENCED=` 取值。
- [ ] AC3 生产载体上的新读数（硬规则 4 推论三：判据必须读**生产载体**且只计**运行之后**的时间窗）：`.quay/productization-verification.jsonl` 中新增 ≥1 条 `ac="GOAL-009-AC-207"` 记录，`ts` 晚于本次运行开始时刻、`build_sha` 为 40-hex，且 `git rev-list --count <该 build_sha>..develop -- <交付面 paths>` ≤ 200。贴记录全文 + 该 rev-list 读数。⛔ 手写记录 / 搬运旧记录 / `--selfcheck` 注入的记录一律不算。
- [ ] AC4 判据真转绿：AC-207 criterion 干跑 **exit 0**；AC-214 criterion 干跑 **exit 0**，贴七行 freshness（每条 `margin > 0`）与 `.quay/goal-freshness-margin.json` 全文（`subjects` 七项 margin 全正）。⛔ 通过放宽 criterion 达成不算（判据文件 `goals/AC-214-*.md` / `goals/AC-207-*.md` 不得出现在本任务的 diff 里）。
- [ ] AC5 负控制（判据仍能取假）：`QUAY_GOAL009_FRESHNESS_K=1` 下 AC-214 criterion ⇒ **exit 1** 且 stderr 逐条指名陈旧主体；贴该输出 + 负控制前后载体 md5 相同。
- [ ] AC6 零代码改动（本任务不改产品代码 ⇒ 着地路径最轻）：`git diff --name-only <base>..HEAD -- plugin/ packages/ goals/` 为空；贴 scoped 门读数（`--for-task <本任务 id>`）与着地归属说明（全量套件归机械 fan-in 的一步，本 worker 不持该共享锁）。

## Definition of Done

本仓库生产载体 `.quay/productization-verification.jsonl` 中出现一条**本次真实跨机运行**产出的 `ac="GOAL-009-AC-207"` 记录（顶层 `build_sha` = 本次 develop tip、40-hex、到 develop 的交付面距离 ≤ K=200），且 **AC-214 判据本体干跑 exit 0**（七行 freshness 全部 `margin > 0`，`.quay/goal-freshness-margin.json` 可核），并在 `QUAY_GOAL009_FRESHNESS_K=1` 的负控制下**仍能 exit 1**（证明不是恒绿）。⛔ 靠放宽 criterion（改 K 字面量 / 删主体 / 改 `expect`）达成不算；⛔ 用手写记录、搬运旧记录、`--selfcheck` 夹具达成不算；⛔ 用夹具根跑 criterion 冒充生产载体读数不算（硬规则 4 推论三）。

## Touches

- .quay/productization-verification.jsonl
- tasks/gap-ac214-ac207-freshness-evidence-producer-run.md
