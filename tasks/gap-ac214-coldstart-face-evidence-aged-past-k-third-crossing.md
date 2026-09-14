---
id: gap-ac214-coldstart-face-evidence-aged-past-k-third-crossing
title: AC-214 第三次因【陈旧】转红：冷启动面四条主体 AC-203/205/207/232 同批越过 K（202/200，margin
  −2）——27 小时内第 3 次，缺 K 窗口内的刷新节奏
status: todo
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

**判据正本**：`goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md`（goal=GOAL-009，`long-term: true`，status=achieved）。exit 0 = AC-201/203/205/207/232/238/239 各自【最新】证据记录的 `build_sha` 到 develop-tip 的【交付面提交距离】均 ≤ K（默认 200，`QUAY_GOAL009_FRESHNESS_K` 可配），且机械推导出的载体型主体集合 SUBJ 中无 NEED 之外的成员；exit 1 = 任一条无证据或证据陈旧（stderr 逐条指名）；exit 3 = 载体缺失 / rev-list 读不出（NOT-EVALUATED，⛔ 不与合格同形）。

**本次转红（本轮实测，⛔ 非引述）**：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-214 --root /home/yale/work/quay` ⇒ **exit 1**（event timestamp `2026-09-14T14:15:10.374Z`），`reason` 逐字：

```
acceptance failed (exit 1) — stale evidence: GOAL-009-AC-232:202/200 (margin -2), GOAL-009-AC-205:202/200 (margin -2), GOAL-009-AC-207:202/200 (margin -2), GOAL-009-AC-203:202/200 (margin -2)
```

七行 freshness 读数（`.quay/goal-freshness-margin.json` @ `2026-09-14T14:12:55Z`、`k=200`，逐字）：AC-201 **137/200 (margin 63)** · AC-203 **202/200 (−2)** · AC-205 **202/200 (−2)** · AC-207 **202/200 (−2)** · AC-232 **202/200 (−2)** · AC-238 **137/200 (63)** · AC-239 **137/200 (63)**。**只有冷启动面这一批越界**，升级面与 AC-201 仍有 63 的余量。

**越界主体与其证据（按位置，⛔ 不是「过期了」一句）**：越界的四条（AC-203/205/207/232）的最新记录**是同一条**：`build_sha=60136b79785da73973618d3bcfec2c3f5fc32be0`、`ts=2026-09-13T11:21:24Z`、`host=orangevps`、`project_root=/home/yale/quay-verify-coldstart-60136b79-root` —— 即 09-13 那次 `--verify-coldstart` 跨机运行（`.quay/ac214-producer-run.log` 逐字：`develop tip = 60136b79785d`、`EVIDENCE-TRANSPORT appended=10`、`evidence-completeness COMPLETE present=6`；`ac_record_append` 统一补顶层 `build_sha`，⛔ 无人手写）。未越界的三条（AC-201/238/239）最新记录来自**另一次**运行：`build_sha=32ff4f3afcd409096b9cf262b8933ba723b5fcb4`、`ts=2026-09-13T17:11:09Z`。`git rev-list --count 60136b79..develop -- <交付面 paths>` = **202**（> K=200），`32ff4f3a..develop` = **137**。

**为什么更早的修复没有兜住（⛔ 不是那几条被证否）**：五条 `done` 且顶层 `goal_ac: AC-214` 的任务里，三条修的是**可达性**（`gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207`、`gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable`、`gap-outer-retirement-test-pins-a-file-that-is-no-longer-orphaned`：让产出侧写出顶层 `build_sha`），两条修的是**一次点刷新**（`gap-ac214-ac207-freshness-evidence-producer-run` 刷冷启动面一次、`gap-ac214-ac238-239-freshness-upgrade-producer-rerun` 刷升级面一次）。它们的绿都是真的，但都**不是「节奏」**：本判据被设计成随 develop 前进自动转红（AC 正文逐字：「把证据换成 434 个交付面提交之前的 commit ⇒ exit 1 `stale evidence`（证明随 develop 前进会自动转红）」），所以它需要的是**在 K 窗口内重复发生的刷新**，而点刷新天然会过期 —— 这正是本条的存在理由（硬规则 5b：同族 ≠ 同一处）。

**发生率（硬规则 12 / 12b：查历史，不是等下一轮）**：AC-214 的 `stale evidence` 这一支在 `.quay/gate-events.jsonl` 与 `.quay/goal-round.jsonl` 全历史上共转红 **3 次，全部落在最近 27 小时内**：

| # | 转红时刻 | 越界主体 | 关闭时刻 | 关闭动作 |
|---|---|---|---|---|
| 1 | 2026-09-13T11:11:31Z | AC-207:203/200 | 11:42:38Z | 冷启动面运行 → `60136b79` |
| 2 | 2026-09-13T17:04:13Z | AC-238/239:206/200 | 17:51:10Z | 升级面运行 → `32ff4f3a` |
| 3 | 2026-09-14T14:11:58Z | AC-203/205/207/232:202/200 | ⛔ 未关闭（本条） | — |

**关闭它的动作（运行型，同前两条的形态）**：一次真实的跨机冷启动面产出运行 —— `bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B"`。它从 develop-tip 现 build 两个 `.tgz`、scp 到目标主机、远端跑 `verify-deliver-coldstart.sh --ac205-session --ac207-e2e`（`develop-deliver-tgz.sh:1739` 的远端脚本**总是**带 `--ac205-session`，`--ac207-e2e` 由本地 flag 追加），再把证据 scp 回、经 `transport_evidence_append` 追加进**本地**载体并补顶层 `build_sha` = 该次 develop tip ⇒ AC-203/205/207/232（+AC-201）到 develop 的距离 ≈ 0 ⇒ AC-214 转绿。⛔ AC-207 的探针在 `--ac207-e2e` 后面（opt-in、第三方项目里真 spawn worker、`AC207_POLL_SECS` 缺省 3600s），不传它这一面刷不齐。

**可复核的节奏读数（本条顺带产出的数）**：一条 09-13T11:21:24Z 补的 develop-tip 记录，到 2026-09-14T14:15Z 已积累 **202 个交付面提交 / 26.9 小时**（≈7.5/小时 ≈180/天），而 AC 正文记载的实测基线是 **83/天** ⇒ 现状下 K=200 ≈ **1.27 天**的窗口。⇒ 两个产出面都必须**至少每天重跑一次**才可能持续保持 `margin > 0`。

**观察项（⛔ 全部不作为本任务的阻塞条件）**：

1. **缺 K 窗口内的刷新节奏**（发生率：**3**，见上表；上一条任务在发生率为 1 时把它记为观察项并延后，现已在 27 小时内 3 次）。⚠️ 本轮**仍不**把它做成阻塞性交付，理由是两条硬约束而非惰性：①**落点未定**——例行刷新应落在 `.quay/config.yml` 的 `loop.routines`（现存 5 条例程，最近一条 `semantic-dedup-scan` 于 2026-09-13 加入，先例成立），而该文件被 `.gitignore:436` 忽略 ⇒ 声明在那里的节奏**不是受版本控制、可核对的产物**，与「判据要锚在受版本控制的载体上」冲突；②**成本未测**——硬规则 4 推论（成本结构未知前不设数值阈值）⇒ 在量出「一次冷启动面运行的墙钟」之前定 interval 数字就是凭空设阈值。**本条任务正好产出这两个数**（本次运行实测墙钟 + 上述 27 小时/202 提交的节奏读数），把 K/节奏的判定留给 AC-214 正文自己写下的复核点。
2. ⛔ **不动 K**：AC 正文逐字「复核点：本判据跑满 30 个自然日后，用真实分布重估 K 并把结果贴回 AC 正文……在此之前，任何「K 太松/太紧」的论断都是无数据的」（起算 2026-09-09 ⇒ 2026-10-09）。本条只**记录**分布，⛔ 不重估 K。
3. ⛔ **本任务不改 `goals/AC-214-*.md`** —— 判据文件出现在本任务 diff 里就是「既当选手又当裁判」（前两条先例的 AC4 已把它写成硬约束）。分布读数落在**本任务体**与本次运行证据里。

<!-- dedup-ref -->
机制查重（⛔ 非关键词）：`grep -l '^goal_ac: *AC-214' tasks/*.md` 命中 **5 条，全部 `done`**；在飞（todo/ready/needs-human）任务里 `grep -l 'AC-214'` 命中 **0 条** ⇒ 无在飞者。相关但机制不同（均 done）：上表两条是同判据的**前两次点刷新**（主体集合与本次相交但不相同，且各只刷一个面，⛔ 不能互相代替）；`gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207` / `gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable` / `gap-outer-retirement-test-pins-a-file-that-is-no-longer-orphaned` 是可达性；`gap-ac244-freshness-subject-set-mechanically-derived` 是主体集合接线。

## Plan

0. **先查重复（机制维度）**：`task_list` 列全部 `todo`/`ready`/`needs-human`，核 `goal_ac: AC-214` 的在飞者为 0；再核没有第二个任务持本任务 `## Touches` 的路径（特别是 `.quay/productization-verification.jsonl` 的写者与本次产出运行的调用者）。
1. **改前读数（能取假）**：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-214 --root /home/yale/work/quay` ⇒ 贴 **exit 1** 与 `reason` 原文；并 `grep` 载体里 `ac` ∈ {GOAL-009-AC-203,205,207,232} 的最新记录，逐条贴 `ts`/`build_sha`/`host`，证明四条同为 `60136b79…` @ 2026-09-13T11:21:24Z。⛔ 引述不算，须实现者复跑。
2. **记运行开始时刻**（载体 `ts` 是整趟运行的**开始**时刻，⛔ 不用完成时刻当窗界）：`date -u +%Y-%m-%dT%H:%M:%SZ` 落盘；同时 `md5sum .quay/productization-verification.jsonl`（负控制前后比对用）。
3. **跑产出者**：`bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B"`，贴**退出码**与全部 `develop-deliver:` 行（含 `remote verify rc=`、`EVIDENCE-TRANSPORT appended=`、`evidence-completeness`、结尾 `OK`/`PARTIAL`）。⚠️ 退出码 2（PARTIAL）不自动等于失败——先读出缺的是哪一条再判（⛔ 不以退出码冒充成功，也不因它掩盖越界主体的读数）。该命令可长跑（`--ac207-e2e` 的 `AC207_POLL_SECS` 缺省 3600s）。
4. **读本次运行自己的 stdout（⛔ 不信「我跑过了」）**：贴 `.quay/verify-coldstart-remote-B-<tip8>.log` 里 step⑤（AC-207 e2e）与 AC-203/205/232 各自的 `record written` 行；**若某条一行都没写**，贴 fail-closed 原文并就此停下（硬规则 3b：缺值 ≠ 合格；⛔ 不得手写记录、不得搬旧记录充数）。同时记录本次运行的**实测墙钟**（观察项①要的那个数）。
5. **确认记录真落到本地载体（按位置）**：在 `.quay/productization-verification.jsonl` 里 `grep` 出 `ac` ∈ {201,203,205,207,232} 且 `ts` 晚于步骤 2 记录的运行开始时刻的记录，逐条贴全文（至少 203/205/207/232 四条）。
6. **判据真转绿**：AC-214 criterion 干跑 **exit 0**；贴七行 `freshness … (margin …)` 与 `.quay/goal-freshness-margin.json` 全文（七项 `margin` 全 > 0）。
7. **负控制（判据仍能取假）**：`QUAY_GOAL009_FRESHNESS_K=1` 下 AC-214 criterion ⇒ **exit 1** 且 stderr 逐条指名陈旧主体；贴输出 + 负控制前后载体 `md5sum` 相同。

## Acceptance Criteria

- [ ] AC1 改前读数（能取假）：AC-214 criterion 干跑 ⇒ **exit 1**，`reason` 逐字含 `stale evidence: GOAL-009-AC-232:202/200 (margin -2), GOAL-009-AC-205:202/200 (margin -2), GOAL-009-AC-207:202/200 (margin -2), GOAL-009-AC-203:202/200 (margin -2)`；并贴 `.quay/productization-verification.jsonl` 里 AC-203/205/207/232 各自最新记录的 `ts`/`build_sha`/`host`，证明四条同为 `60136b79…` @ 2026-09-13T11:21:24Z。⛔ 引述不算，须实现者复跑。
- [ ] AC2 产出运行的**真**读数（⛔ 不是 `--selfcheck`、⛔ 不是夹具）：贴 `develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B"` 的退出码 + 全部 `develop-deliver:` 行 + `.quay/verify-coldstart-remote-B-<tip8>.log` 中 step⑤ 与 AC-203/205/207/232 的 `record written` 行；并贴本次运行**实测墙钟**（观察项①的成本读数：`date -u` 起止差）。
- [ ] AC3 生产载体上的新读数（硬规则 4 推论三：判据必须读**生产载体**且只计**运行之后**的时间窗）：`.quay/productization-verification.jsonl` 中新增 ≥1 条 `ac="GOAL-009-AC-203"`（同理 AC-205/207/232）记录，`ts` 晚于本次运行开始时刻、`build_sha` 为 40-hex。⛔ 手写记录 / 搬运旧记录 / `--selfcheck` 注入的记录一律不算。
- [ ] AC4 判据真转绿：AC-214 criterion 干跑 **exit 0**，贴七行 `freshness`（每条 `margin > 0`）与 `.quay/goal-freshness-margin.json` 全文（`subjects` **七项** margin 全正，⛔ 不是只贴四条），并贴 `git rev-list --count <新 build_sha>..develop -- <交付面 paths>` 读数。⛔ 通过放宽 criterion 达成不算（`goals/AC-214-*.md` 不得出现在本任务的 diff 里）。
- [ ] AC5 负控制（判据仍能取假）：`QUAY_GOAL009_FRESHNESS_K=1` 下 AC-214 criterion ⇒ **exit 1** 且 stderr 逐条指名陈旧主体；贴该输出 + 负控制前后载体 `md5sum` 相同。
- [ ] AC6 零产品代码改动（着地路径最轻）：`git diff --name-only <base>..HEAD -- plugin/ packages/ goals/` 为空；贴 scoped 门读数（`--for-task <本任务 id>`）与着地归属说明（全量套件归机械 fan-in 的一步，本 worker 不持该共享锁）。

## Definition of Done

本仓库生产载体 `.quay/productization-verification.jsonl` 中出现**本次真实跨机运行**产出的 `ac` ∈ {GOAL-009-AC-201/203/205/207/232} 记录（顶层 `build_sha` = 本次 develop tip、40-hex、到 develop 的交付面距离 ≤ K=200），其中原本越界的 **AC-203/205/207/232 四条全部刷新**，且 **AC-214 判据本体干跑 exit 0**（七行 freshness 全部 `margin > 0`，`.quay/goal-freshness-margin.json` 可核），并在 `QUAY_GOAL009_FRESHNESS_K=1` 的负控制下**仍能 exit 1**（证明不是恒绿）。⛔ 靠放宽 criterion（改 K 字面量 / 删主体 / 改 `expect`）达成不算；⛔ 用手写记录、搬运旧记录、`--selfcheck` 夹具达成不算；⛔ 用夹具根跑 criterion 冒充生产载体读数不算（硬规则 4 推论三）。本次运行的**实测墙钟**与越界节奏读数（27 小时 3 次、202 交付面提交/26.9h）留在本任务体，供 AC-214 正文自己的复核点（2026-10-09）使用。

## Touches

- `.quay/productization-verification.jsonl`（本 AC 的载体：本次运行 append 的记录落在这里。⚠️ anti-drift-touches-check 只比对 `git diff --name-only <merge-target>...HEAD`（**已跟踪**文件）；该载体被 `.gitignore:339` 忽略 ⇒ 不进那个集合，声明它是为了表明「本任务的产出落在这里」，⛔ 不是可提交物）
- `tasks/gap-ac214-coldstart-face-evidence-aged-past-k-third-crossing.md`（自身文件：勾 AC + 贴实跑证据）