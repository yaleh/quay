---
id: gap-ac214-fifth-crossing-routine-detects-but-nothing-acts
title: AC-214 第五次转红（冷启动面 AC-203/205/207/232 = 201/200，margin
  −1）：第四次任务建的「刷新动作机械化」只机械化了【检测】——freshness-refresh 例程今日跑了 9 次、报了 30+ 条 stale 主体
  finding 落进 .quay/routine-findings.jsonl，而该载体【没有消费者】，10.5 小时预警窗内零动作
status: ready
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-214
---
## Finding

**判据此刻为假（复跑读数，非引述）**：`bash /tmp/ac214-criterion.sh` ⇒ `EXIT=1`，逐字 stderr：
`stale evidence: GOAL-009-AC-232:201/200 (margin -1), GOAL-009-AC-205:201/200 (margin -1), GOAL-009-AC-207:201/200 (margin -1), GOAL-009-AC-203:201/200 (margin -1)`
stdout 七行：`AC-201/238/239 = 123/200 (margin 77)`；`AC-203/205/207/232 = 201/200 (margin −1)`。

**这是第 5 次越界，且不是恒红**：`.quay/goal-round.jsonl` 中 AC-214 的**最后一次 pass = 2026-09-15T18:57:13.313Z**，本次复跑（2026-09-15T19:0xZ）已 fail ⇒ 刚发生的回归。四次历史的关闭动作与主体见 `tasks/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger.md` 与 `tasks/gap-ac214-coldstart-face-evidence-aged-past-k-third-crossing.md`：01 冷启动面 → 02 升级面 → 03 冷启动面（202/200）→ 04 升级面（202/200），**本条是第 5 次，主体回到冷启动面**。

**本次与第 4 次的区别（这是本条的全部要点）**：第 4 次任务的 DoD 逐字要求「让缺口不再第 5 次出现」，其交付物是**刷新动作的机械化**——`plugin/probes/freshness-refresh.md` + `plugin/freshness-producers.json` + `.quay/config.yml` 的 `loop.routines` 条目（`trigger: interval:120m`）+ `plugin/scripts/freshness-producer-coverage-check.ts`。**该机制【确实跑起来了、也确实检测到了】**，实测（`.quay/quality-round.jsonl` 中 `facts[].name=="freshness-refresh"`）：

| 轮 | 时刻 (UTC) | findings | state |
|---|---|---|---|
| 1 | 02:17:52 | 0 | verified |
| 72 | 04:26:37 | 0 | verified |
| 148 | 06:28:12 | 0 | verified |
| **248** | **08:30:28** | **4** | verified |
| 323 | 10:29:47 | 4 | verified |
| 390 | 12:31:57 | 4 | verified |
| **473** | **14:36:50** | **6** | verified |
| 532 | 16:36:38 | 4 | verified |
| 617 | 18:37:51 | 4 | verified |

⇒ **interval:120m 被遵守（实际 ~2h 一次），且从 08:30 起就持续报出 4–6 条 stale 主体 finding。** 载体 `.quay/routine-findings.jsonl` 现在直接读得到 8 条 freshness finding（16:35 / 18:35 两轮各 4 条 `stale-subject`），与 scan-round 的 `inventory.subjects_filed: 4` 相符。

**⇒ 缺陷不在检测，在【检测没有动作面】。** 该例程的**机械通道**（`plugin/scripts/probe-routine.ts` → quality driver Layer-1b）的终点是**把结构化 finding 追加进 `.quay/routine-findings.jsonl`**；`plugin/scripts/capability-catalog.sh` 对它的 CONSUMER 声明（`:1925` 行）逐字止于此，全仓**没有任何机械消费者**把 finding 转成任务或触发产出者重跑。`routine-file-gate.ts`（立案闸）**只由 `plugin/skills/routines/SKILL.md` 的 agent 通道 Phase 3 调用**；而该 SKILL 自己第 20–31 行声明：两层 driver 架构下生效的是**机械通道**，且「两条通道不要同时驱动同一条 routine」——机械通道正是被启用的那条，**而它没有立案步**。

**后果（实测，非推断）**：08:30 首次报出陈旧 ⇒ ~19:00 判据越界 = **10.5 小时预警窗**，而冷启动面产出者一次墙钟仅 **20m36s**（`plugin/freshness-producers.json` 的 `coldstart-face.wallclock_hours: 0.34`）⇒ 窗口是关闭成本的 ~30 倍，**零动作**。

**5b 扫描（同载体内的同形点，⛔ 不只修被报出来的那一个）**：`.quay/routine-findings.jsonl` 现有 **61 条 finding 记录 / 57 个 distinct findingId**（`semantic-dedup-scan` 53 条 + `freshness-refresh` 8 条）。对全部 57 个 id 逐个 `grep -rl <id> tasks/`：**命中 6 个，且全部落在同一个文件** `tasks/gap-productize-deep-semantic-dedup-scan-routine.md`——那是**建该例程的任务自己在 body 里引用了探针输出**，不是由 finding 立案的任务。⇒ **没有任何一条例程 finding 曾经变成过任务**，形态遍及全部 routine，⛔ 不是 freshness 独有。（谓词干跑：`grep -rl freshness-refresh tasks/` 命中该机制自己的任务文件 ⇒ 谓词本身可命中。）

**第二处独立缺陷（同一条链的载体侧，实测）**：`.quay/routine-findings.jsonl` 是 **git-tracked** 文件（`git ls-files` 命中；唯一提交 `53cc833b5`），而其 append **不提交** ⇒ 工作树永久脏、且**会被静默回退**。实测：例程自报 `recordsAppended` 合计 33 条（轮 1/72/148 各 1 + 248/323/390 各 5 + 473 计 7），而文件当前只有 64 行 = HEAD 的 54 行 + 最后两轮的 10 行；**02:17–14:36 的 25 条 append 已不在文件里**，HEAD 那份 `grep -c freshness-refresh` = **0**、末条记录停在 `2026-09-13T18:03:58Z`。⇒ 08:30–12:31 那几轮**报出的 stale finding 本体已丢失**（这正是无法复核 14:36 那轮为何报 6 条的原因）。回退者尚未定位（候选类：共享主检出上的 tree-hygiene `git checkout`/`reset`；已排除 `meta-driver.ts:1214 settleEvidenceWrites`——它只作用 `goals/`，有 `-- goals` 限定）。**⛔ 不把候选当结论**：定位它是下方 AC7。

**为什么更早的修复没兜住（⛔ 不是那几条被证否）**：7 条 `status: done` 且顶层 `goal_ac: AC-214` 的任务里，四条修**可达性**（产出侧写 `build_sha`、主体集合机械推导、AC-232/238/239 接进 NEED），两条修**一次性刷新**（冷启动面 / 升级面各重跑一次）。它们的绿都是真的。**第 4 条把「刷新动作」机械化了，但机械化的是【发现】，不是【执行】**——它的 DoD 逐字写「⛔ 探针只 file 不 execute（重跑的决定仍归人/派发链）」，这本身正确；**而它假设存在的「既有的 routine→task filing 链」在机械通道里并不存在**（只在 agent 通道里）。⇒ 交付物每 2 小时产出一条无人读的记录，形态与「观察项」完全相同——而第 4 条的 DoD 逐字禁止「把后半降格成观察项了事」。**它没有降格，它造了一个看起来不是观察项的观察项**（硬规则 9：可见性 ≠ 执行；硬规则 3b：一个恒「已产出」的记录与「已处理」同形）。

**⛔ 本任务不做的事**：⛔ 不改 K、⛔ 不改 `criterion`/`expect`/`goals/`、⛔ 不删主体、⛔ 不自行 superseded 该 AC（需人裁定）。

## Requested action

1. **先关闭当前缺口**：按 `plugin/freshness-producers.json` 的 `coldstart-face` 条目在窗口内重跑冷启动面产出者，把 AC-203/205/207/232 四条记录刷到 develop tip 附近（`--root /home/yale/work/quay` 必传：该载体 gitignored，不随 worktree 的 merge 回到主检出，而 goal-driver 读的是主检出那一份）。判据本体干跑 exit 0 才算关闭。
2. **补上机械通道的立案步（本条的机制交付物）**：让 `probe-routine.ts` 在 append finding 之后，把 **actionable** finding 经既有 `routine-file-gate.ts`（质量 / 去重 / 限流三闸，复用 `meta-driver.ts:fileProposals` 的既有形态）落成**新任务文件**——**FILE-ONLY：只立案、⛔ 不执行**（缺口重跑仍归派发链）。判据必须能取假：夹具 finding 未登记产出者时变红、登记后转绿，**并对生产载体跑一次**（⛔ 只有夹具能满足的判据不是测量）。
3. **载体不再可被静默回退**：给出 `.quay/routine-findings.jsonl` 的落点决定（gitignore + append-only，或纳入提交），并**定位那 25 条记录丢失的回退者**（⛔ 候选不得当结论）。
4. **负控制**：把探针 dispatch seam 关掉后，新增的立案步必须不再产出任务（区分「立案步在工作」与「恒有输出」）。

## Acceptance Criteria

- [x] AC1 改前读数（能取假）：在 `/home/yale/work/quay` 逐字跑 AC-214 criterion ⇒ **exit 1**，stderr 逐字含四条主体；贴 `.quay/goal-freshness-margin.json` 全文、`.quay/goal-round.jsonl` 中 AC-214 的最后一次 pass 与本次 fail 两个时刻、以及载体里 AC-203/205/207/232 最新记录的 `ts`/`build_sha`（证明停在 `2026-09-14T14:25:05Z` / `f19397c66473`）。⛔ 引述本任务不算，须复跑。
- [ ] AC2 冷启动面产出者真跑：贴命令、退出码、全部 `develop-deliver:` 行、实测墙钟、前置核读数；并在**主检出**载体上贴出 `ts` 晚于本次运行开始时刻的四条记录全文（各自 `build_sha` 为 40-hex）。 **⛔ 未满足，见 Evidence/AC2 · Evidence/AC3 —— 本条不勾。**
- [ ] AC3 判据真转绿：AC-214 criterion 干跑 **exit 0** + 七行 freshness（每条 `margin > 0`）+ margin 快照全文；`goal-store gate AC-214 --root .` exit 0。⛔ 通过放宽 criterion 达成不算。 **⛔ 未满足，见 Evidence/AC2 · Evidence/AC3 —— 本条不勾。**
- [x] AC4 负控制：① `QUAY_GOAL009_FRESHNESS_K=1` 下 criterion ⇒ exit 1 且逐条指名；② `git diff --exit-code -- goals/` 为空；③ 只跑 criterion 前后 `md5sum .quay/productization-verification.jsonl` 相同（证明判据本体只读）。
- [x] AC5 立案步存在且能取假：给出「机械通道 append 后把 actionable finding 经 `routine-file-gate.ts` 落成新任务文件」的实现落点（文件:行），并贴**双向负控制**（夹具 finding 未登记产出者 ⇒ 变红且逐条指名；登记后 ⇒ 转绿），**并对生产载体 `.quay/routine-findings.jsonl` 跑一次真实读数**（⛔ 只由夹具满足的判据不算产出）。
- [x] AC6 立案步真在生产上生效（硬规则 4 推论三：判据须读**生产**载体且只计**实现落地之后**的时间窗）：贴出实现落地后**由例程 finding 立案**的 ≥1 条任务（路径 + `ts` 晚于落地时刻 + 其 `## Finding` 与该例程 finding 逐字对应）；并贴反向对照——**关掉探针 dispatch seam** 的那一趟不产出任何任务（证明不是恒有输出）。
- [x] AC7 载体不再可被静默回退：贴出回退者的定位（文件:行 + 一次能复现的回退读数），或若判定应改落点，则贴落点决定 + 依据；并贴 HEAD 与工作树两份 `.quay/routine-findings.jsonl` 的行数 / 末条 `ts` 对照，证明 append 不再依赖「没人碰它」。
- [x] AC8 5b 扫描产物：对 `.quay/routine-findings.jsonl` 全部 distinct findingId 重跑「是否曾立案」的谓词，贴**命中数与前 3 条**，证明本条的修法覆盖全部 routine（⛔ 不只覆盖被报出来的 freshness 一条）。

## Evidence

本次全部读数均为**复跑**结果（⛔ 无一条引述任务正文或历史记录）。命令与原始输出见下。

### AC1 改前读数（能取假）

- 命令：`bash /tmp/ac214-5th/criterion.sh`（= 逐字照抄 `goals/AC-214-*.md` 的 `criterion:` 折叠块，`--root /home/yale/work/quay`）
- **exit 1**，stderr 逐字：`stale evidence: GOAL-009-AC-232:201/200 (margin -1), GOAL-009-AC-205:201/200 (margin -1), GOAL-009-AC-207:201/200 (margin -1), GOAL-009-AC-203:201/200 (margin -1)`
- stdout 七行：`AC-201 123/200 (margin 77)`；`AC-232/205/207/203 = 201/200 (margin -1)`；`AC-238/239 = 123/200 (margin 77)`
- `.quay/goal-freshness-margin.json` 全文（本次运行所写，`at = 2026-09-15T19:17:07Z`）：
  `{"at": "2026-09-15T19:17:07Z", "k": 200, "subjects": {"GOAL-009-AC-201": {"K": 200, "d": 123, "margin": 77}, "GOAL-009-AC-203": {"K": 200, "d": 201, "margin": -1}, "GOAL-009-AC-205": {"K": 200, "d": 201, "margin": -1}, "GOAL-009-AC-207": {"K": 200, "d": 201, "margin": -1}, "GOAL-009-AC-232": {"K": 200, "d": 201, "margin": -1}, "GOAL-009-AC-238": {"K": 200, "d": 123, "margin": 77}, "GOAL-009-AC-239": {"K": 200, "d": 123, "margin": 77}}}`
- `.quay/goal-round.jsonl` 中 AC-214 两个时刻（按 `facts[].value.criteria[]` 逐条取，共 3274 条）：
  **最后一次 pass = `2026-09-15T18:57:13.313Z`**（`acceptance passed (exit 0)`）；**本次 fail = `2026-09-15T19:13:51.904Z`**（reason 逐字含四条 stale 主体）⇒ 是刚发生的回归，不是恒红。
- 载体里四条主体的最新记录（`ts` / `build_sha`，四条完全相同）：
  `GOAL-009-AC-203/205/207/232  ts=2026-09-14T14:25:05Z  build_sha=f19397c66473698968f016bcfce916c388b5d7fb`（`f19397c66473` 前缀与任务正文一致）
  对照 `GOAL-009-AC-201  ts=2026-09-14T23:14:12Z  build_sha=10c664c9e32c766d3b22dce6e3973ea2340068dc`。

### AC2 冷启动面产出者真跑（本轮）—— **⛔ 未满足（三段满足，第四段被阻塞）**

下面三段（命令 / 退出码 / 全部 `develop-deliver:` 行 / 前置核读数 / 三条记录全文）**已满足**；第四段「四条记录」**只到三条**，第四条（AC-205）被外部前置阻塞，原因见本节末尾。

- 命令（`plugin/freshness-producers.json` 的 `coldstart-face.command`，`<main-checkout>` = `/home/yale/work/quay`）：
  `bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root /home/yale/work/quay`
- 前置核读数（`--check`，**运行前**）：`{"decision":"deliver","lastDelivered":"78dc4dfe2f5e2917accbbf4d561da5a7009409","develop":"c529e4258b44a6398c4ec37314db8d42d6342c33","age_seconds":624579,"max_age":21600}`
- 第 1 轮：开始 `2026-09-15T19:17:34Z`，结束 `2026-09-15T19:34:16Z` ⇒ **实测墙钟 16m42s**（`plugin/freshness-producers.json` 记的 `wallclock_hours: 0.34` = 20m24s，同一量级）；**退出码 = 2**（⛔ 不是 0 —— 两台的 `evidence-completeness` 都是 `PARTIAL present=5 missing=1 list=GOAL-009-AC-205`）。
- 第 2 轮（为排除「AC-205 是偶发」而重跑一遍）：开始 `2026-09-15T19:36:00Z`、结束 `2026-09-15T19:48:36Z`（墙钟 12m36s），**两台同样以 `PARTIAL present=5 missing=1 list=GOAL-009-AC-205` 收场**、退出码同样 2 ⇒ AC-205 的缺失是**可复现的**，不是一次偶发。
- 全部 `develop-deliver:` 行（raw 块，逐字，含每台机的 `scp`/`rc`/`evidence-completeness`/`e2e-pairing`）：

```
RUN1 (19:17:34Z start)
develop-deliver: develop tip = c529e4258b44 (c529e4258b44a6398c4ec37314db8d42d6342c33)
develop-deliver: creating detached worktree at develop tip: /home/yale/work/quay/.quay/deliver-worktree-c529e4258b44
develop-deliver: package.sh (quay .tgz)...
develop-deliver: --verify-coldstart develop=c529e4258b44 build_date=2026-09-15T19:12:29+00:00 carrier=/home/yale/work/quay/.quay/productization-verification.jsonl
develop-deliver: B (orangevps.wan.hwang.men) — scp verify-deliver-coldstart.sh + its FULL closure ($SCRIPT_DIR siblings + node_modules deps) + SPEC + both .tgz
develop-deliver: B (orangevps.wan.hwang.men) remote stdout persisted → /home/yale/work/quay/.quay/verify-coldstart-remote-B-c529e425.log (rc=0)
develop-deliver: B (orangevps.wan.hwang.men) remote verify rc=0 evidence_lines=9
develop-deliver: B (orangevps.wan.hwang.men) — scp back: ... orangevps.wan.hwang.men:/home/yale/quay-verify-coldstart-evidence-c529e425.jsonl ...
develop-deliver: evidence-completeness PARTIAL present=5 missing=1 list=GOAL-009-AC-205
develop-deliver: B (orangevps.wan.hwang.men) — PARTIAL (transport OK but some expected records missing)
develop-deliver: e2e-pairing E2E-PAIR OK host=orangevps roots=/home/yale/quay-verify-coldstart-c529e425-root
develop-deliver: C (ad-arm1.wan.hwang.men) — scp verify-deliver-coldstart.sh + its FULL closure (...) + SPEC + both .tgz
develop-deliver: C (ad-arm1.wan.hwang.men) remote stdout persisted → /home/yale/work/quay/.quay/verify-coldstart-remote-C-c529e425.log (rc=0)
develop-deliver: C (ad-arm1.wan.hwang.men) remote verify rc=0 evidence_lines=9
develop-deliver: C (ad-arm1.wan.hwang.men) — scp back: ... ad-arm1.wan.hwang.men:/home/yale/quay-verify-coldstart-evidence-c529e425.jsonl ...
develop-deliver: evidence-completeness PARTIAL present=5 missing=1 list=GOAL-009-AC-205
develop-deliver: C (ad-arm1.wan.hwang.men) — PARTIAL (transport OK but some expected records missing)
develop-deliver: e2e-pairing E2E-PAIR OK host=instance-20221019-1509 roots=/home/yale/quay-verify-coldstart-c529e425-root
（exit 2 — 两台的 evidence-completeness 都是 PARTIAL，缺的都是 GOAL-009-AC-205）
```

- **主检出载体上 `ts` 晚于运行开始时刻的新记录**（`.quay/productization-verification.jsonl`；两轮合计 36 条 = 2 轮 × 2 台 × 9 条）：

```
按 (ac, host) 计数，ts > 19:17:34Z 的记录共 36 条（= 2 轮 × 2 台 × 9 条）：
  ('GOAL-009-AC-201', None)                        4      ← 无 host 字段
  ('GOAL-009-AC-203', 'orangevps')                 4      ← B
  ('GOAL-009-AC-203', 'instance-20221019-1509')    4      ← C
  ('GOAL-009-AC-207', 'orangevps' / 'instance-…')  2 / 2
  ('GOAL-009-AC-232', 'orangevps' / 'instance-…')  2 / 2
  （其余为 GOAL-009-AC-204 / GOAL-009-AC-206 / GOAL-015-AC-234 / AC88 ——
    按 freshness-producers.json 的 scope 规则【不是可刷新主体】：前三个无 40-hex build_sha，AC88 不是 GOAL-009 前缀）
  ★ 四条主体里**没有任何一条 GOAL-009-AC-205**。
```
四条主体记录全文（各自 `build_sha` 为 40-hex，取 ts 最新的一条；`GOAL-009-AC-203` 的全文示例）：
```json
{"ac": "GOAL-009-AC-203", "build_sha": "c529e4258b44a6398c4ec37314db8d42d6342c33", "carrier_records": 1, "driver_alive": 1, "has_plugin_dir": false, "host": "instance-20221019-1509", "kind": "promotion", "project_root": "/home/yale/quay-verify-coldstart-c529e425-root", "ts": "2026-09-15T19:44:58Z"}
```
其余三条（AC-201/207/232）与示例同源：`build_sha` 同为 `c529e4258b44a6398c4ec37314db8d42d6342c33`（= 本次运行时刻的 develop tip，40-hex），`ts` 落在 `2026-09-15T19:18:53Z`（第 1 轮）与 `2026-09-15T19:44:58Z`（第 2 轮）两批，**全部晚于运行开始时刻**。

- **⚠️ AC-205 这一条本轮没产出（两轮各试一次都没产出）——这是本条唯一未闭合的主体，根因已定位到 AC-205 腿的一条【未登记的外部前置】，并已单独立案为 `tasks/gap-ac205-delivery-held-unidentified-peer-sender.md`**：
  - 第 1 轮 host B：`target: pid=1003072`，`send-to-session failed to connect`。**实测该机 4 个已登记会话的 pid 全部不是活进程**（`ps -p 1664053/1634692/1429681/1003072 -o comm=` 全空）⇒ 该机根本没有可投递的同址会话。
  - 第 1 轮 host C：`target: pid=1958929`（活），send exit 0，但 `transcript_confirmed=0`（30 × 1s 轮询窗口内 transcript 未物化）⇒ 按 AC-205 自己的负控制不落账。
  - **该失败不是「没投出去」，而是「投出去了但被【扣下】」**。事后直接读目标 transcript：probe 文本确实在里面（`grep -c ac205-probe` = **4**），但四条记录的形态全部是
    `type: "system"` / `subtype: "informational"` / `content: "Held peer message — from an unidentified session [verified pid 157212] (peer cla…"`。
  - `transcript-delivery-check.ts` 的三态契约（本文件自己第 25-40 行）规定 **DELIVERED 只认两类物化形态**：a real USER message（`type==="user"` ∧ `message.role==="user"`）或 `type==="attachment"`。**`type:"system"` 的「Held peer message」两者都不是** ⇒ 判 UNKNOWN(exit 3) ⇒ `transcript_confirmed=false` ⇒ 按 AC-205 自己的负控制**正确地不落账**（⛔ 不是检查坏了）。
  - ⇒ **根因在【接收方的 settings】，不在投递方**（`plugin/scripts/send-to-session.ts` 文件头 2026-08-15/2.1.241 实测记录逐字：「投递不由 token 类型决定，由【接收方 settings】——`permissions.defaultMode=bypassPermissions` 或 `crossSessionInbound:accept` 任一即直通，皆无则 held→expired」）。`from an unidentified session` 是**扣下时的措辞**，不是根因。⇒ **改投递方改不了这个结局**；文档里唯一「免 hold」的通道是把目标会话自己的 childToken 带出来，而该脚本的安全边界段与 outer 2026-08-15 的裁定都禁止这个形态。
  - ⇒ **AC-205 的产出前置 = 验证机上有一个 settings 允许 inbound 的【活】会话**（2026-09-14 那次成功就是在 `orangevps` 上恰好满足了这个前提）。**这是一个外部环境前提，`plugin/freshness-producers.json` 把 AC-205 登记在 `coldstart-face` 下时没有记录它**；本任务当前**两条验证机都不满足**：B 的 4 个登记会话 pid 全不是活进程、C 唯一的候选会话（`/home/yale/work/archguard`）settings 两者皆无。
  - ⇒ 因此 **AC-205 本轮无法刷新**，AC-214 判据因此仍为 exit 1（六条主体全部 margin 200，只剩它 201）。**⛔ 不通过改 K / 改 criterion / 删主体 / 手写搬运记录来绕过——那正是本任务 DoD 逐字禁止的替代物。**

### AC3 判据真转绿 —— **⛔ 未满足**

- 本轮（刷到 6/7 主体之后）判据干跑读数：**exit 1**，stdout 七行、`margin > 0` 的是 **6 条**：
  `AC-201 0/200 (margin 200)`；`AC-232 0/200 (margin 200)`；`AC-207 0/200 (margin 200)`；`AC-203 0/200 (margin 200)`；`AC-238 123/200 (margin 77)`；`AC-239 123/200 (margin 77)`；
  **`AC-205 201/200 (margin -1)`** —— stderr 逐字：`stale evidence: GOAL-009-AC-205:201/200 (margin -1)`。
- ⇒ **六条主体已全部刷到窗口内（四条冷启动面主体 d=0、margin 满 200），判据转绿只差 AC-205 一条**；而 AC-205 由上面诊断出的**外部前置**阻塞。
- ⛔ 未通过放宽 criterion / 改 K / 删主体 / 手写搬运记录达成 —— **本条如实不勾**，阻塞已立案为 `tasks/gap-ac205-delivery-held-unidentified-peer-sender.md`。

### AC4 负控制

- ① `QUAY_GOAL009_FRESHNESS_K=1` ⇒ **exit 1**，stdout 七行逐条给出，stderr 逐条指名：`stale evidence: GOAL-009-AC-205:201/1 (margin -200), GOAL-009-AC-238:123/1 (margin -122), GOAL-009-AC-239:123/1 (margin -122)` ⇒ 判据随 K 变化，不是恒绿。
- ② `git -C /home/yale/work/quay diff --exit-code -- goals/` ⇒ **exit 0（空）** ⇒ 全程未改 `goals/`（⛔ 未改 K / `expect` / `criterion`）。
- ③ 只跑 criterion 前后 `md5sum .quay/productization-verification.jsonl`：**前后同为 `31195580c110e6da757e003c97aba49f`**（本次实跑，产出者已停）⇒ **判据本体只读**，它不写它读的那个载体（它只写 `.quay/goal-freshness-margin.json` 那份 margin 快照，那是 AC-214 自己的 AC6 契约）。

### AC5 立案步存在且能取假

实现落点（文件:行，本 worktree）：

| 落点 | 是什么 |
|---|---|
| `plugin/scripts/probe-routine.ts:690` | `run()` 的第 ⑦ 步：**append 之后**把 actionable finding 经三道闸落成新任务文件 |
| `plugin/scripts/probe-routine.ts:341` | `selectFilings()` —— 逐条处置的**纯函数**（不写盘、不 spawn，故可对生产载体跑读数而不改变它） |
| `plugin/scripts/probe-routine.ts:393` | `fileRoutineTask()` —— 唯一写盘点（spawn 工作区自己的 task store CLI，⛔ 不手搓 markdown） |
| `plugin/scripts/probe-routine.ts:458` | `commitRoutineWrite()` —— 写盘即提交（见 AC7） |
| `plugin/scripts/routine-file-gate.ts:188` | `producerGate()` —— AC5 红侧那道闸（三值） |
| `plugin/scripts/routine-file-gate.ts:229` | `renderRoutineTaskBody()` —— finding → 任务体（⛔ 复用既有质量/去重/限流三闸，不另立判据） |

**双向负控制**（`plugin/test/probe-routine.test.mjs`，实跑 21/21 绿）：

- 红侧：夹具 finding 点名 `coldstart-face`，而登记面只有 `upgrade-face` ⇒ Fact `state=failed`，reason **逐条指名** `freshness-goal-009-ac-207` 与 `coldstart-face`，且 `written.length=0`（⛔ 幻影主体不进板）。
- 绿侧：同一个 finding，把 `coldstart-face` 登记进去 ⇒ Fact `state=verified`，任务文件产出，且任务体逐字含该 finding 的 `rationale`。
- 第三值（⛔ 不是二值）：**未声明登记面**的例程 ⇒ 该闸不适用（`evaluated:false`）；**声明了但读不懂** ⇒ fail-closed 且**不写半条立案轮记录**。第一版把这两态合并成同一个返回值，被本用例抓住。

**对生产载体跑一次真实读数**（`.quay/routine-findings.jsonl`，主检出那份，`ts` 快照 2026-09-15T19:27Z）：

```
records = 98 (94 finding, 0 filing-round, 4 scan-round)   routines = freshness-refresh, semantic-dedup-scan
── freshness-refresh (probe freshness-refresh) — 8 finding(s); producers_file DECLARED, read (coldstart-face,upgrade-face)
   dispositions: {"filed":3,"quality-dedup-rate":5}
── semantic-dedup-scan (probe semantic-dedup-scan) — 86 finding(s); producers_file not declared
   dispositions: {"filed":3,"quality-dedup-rate":65,"action":18}
TOTAL dispositions = 94; accepted = 6
```

⇒ **94 条 finding 每一条都有处置**（硬规则 3：枚举不布尔）；`action:18` 是 semantic-dedup 的 `suggestedAction: "leave"` 判定被正确当作**测量**而非工作（否则这条轨道每轮都会刷 86 条任务）。**该读数是纯的**：同一份 carrier 前后逐字节相同（`readFileSync().equals()` 断言）。

### AC6 立案步真在生产上生效

由**生产载体里真实的例程 finding** 立案的 6 条任务（生产者 = 生产代码路径 `selectFilings` + `fileRoutineTask`；唯一未重跑的是探针自己的 LLM spawn —— 被立案的 finding 正是那次 spawn 已经产出的真实记录）：

| 任务文件 | 源 finding | 源 finding 的 ts / runId | 立案 ts（git commit 时刻） |
|---|---|---|---|
| `tasks/gap-routine-semantic-dedup-scan-fs-walk-family.md` | `fs-walk-family` | 2026-09-13T18:03:58.156Z / `semantic-dedup-scan-1789322638156` | 2026-09-15T19:30:43+00:00 |
| `tasks/gap-routine-semantic-dedup-scan-shell-scan-surface-family.md` | `shell-scan-surface-family` | 同上 | 2026-09-15T19:30:43+00:00 |
| `tasks/gap-routine-semantic-dedup-scan-firstargregion-stripshellcomments.md` | `firstargregion-stripshellcomments` | 同上 | 2026-09-15T19:30:43+00:00 |
| `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-203.md` | `freshness-goal-009-ac-203` | 2026-09-15T16:35:29.772Z / `freshness-refresh-1789490129772` | 2026-09-15T19:30:43+00:00 |
| `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-205.md` | `freshness-goal-009-ac-205` | 同上 | 2026-09-15T19:30:43+00:00 |
| `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-207.md` | `freshness-goal-009-ac-207` | 同上 | 2026-09-15T19:30:43+00:00 |

- **实现落地时刻 = `2026-09-15T19:26:58+00:00`**（`4c7e5c230`，本任务分支上立案步的落地提交）⇒ 六条任务的 `ts` 全部**晚于**落地时刻 ✅
- **`## Finding` 与源 finding 逐字对应**（程序化比对 `task 的 ## Finding 首段` vs `carrier 记录的 rationale`，全部 `VERBATIM MATCH: True`）：`fs-walk-family`（`22 recursive readdirSync({withFileTypes:true}) walkers across 19 files share one skeleton …`）、`freshness-goal-009-ac-207`（`delivery-face evidence for AC-207 (build_sha f19397c6, 2026-09-14T14:25:05Z) is d=190 comm…`）、`shell-scan-surface-family`（`collectShellScripts and listExecutableFiles are whole-function byte-identical copies (521b…`）。每条任务体还逐字携带源 `runId`。
- **六条都过 `quay task check`**：`PASS — all required artifacts present; eligible to move to ready`。
- **反向对照（关掉产出面 ⇒ 不产出）**：`plugin/test/probe-routine.test.mjs` 的 `FILING AC6 reverse control` —— 同一个 finding、同一个登记面，`filingEnabled:false` 那一趟 `written.length=0`，且立案轮记录 `evaluated:false / filed:[]`；而 `filingEnabled` 缺省的那一趟 `written.length=1` ⇒ **「不是恒有输出」有对照**。
- ⚠️ 诚实标注：本轮这 6 条是由**生产代码路径 + 生产载体数据**立案，而**不是**由常驻 driver 的调度自动触发（常驻 driver 读的是主检出那份代码，本分支尚未落地）。落地后每轮 interval:120m 会自动走同一条路径。

### AC7 载体不再可被静默回退

**① 回退者定位：结论是「仓内不存在这样的机件」，且有穷尽性证据。**
- 全仓对载体的引用**只有 4 处**（`grep -rn "routine-findings"`，排除 `dist/` 与 `packages/quay/plugin/`）：`plugin/scripts/capability-catalog.sh`（描述文案）、`plugin/scripts/probe-routine.ts`（**写入方**）、`plugin/scripts/quality-gate-driver.ts:1136`（`--probe-state-dir` 的帮助文本）、`plugin/skills/routines/SKILL.md:33`（文档）。
  ⇒ **没有任何仓内机件【读它并还原它】**，故丢失不可能由仓内脚本造成。
- 已逐条排除的三个候选（各带代码位置）：
  - `meta-driver.ts:1195 settleEvidenceWrites` —— `git status --porcelain -- goals` + `git checkout -- <rel>`，**路径被 `-- goals` 限定**；
  - `worker-driver.ts:2842 stashIfDirty` —— 恒 `stashed:false`（其注释明写「驱动不 stash 主检出的任何未提交改动」），**结构性不可能回退**；
  - `packages/quay/src/store-commit.ts:173` —— `git checkout HEAD -- <relPath>` 存在，但四个调用点传的 `relPath` 只可能是 `adr/` `docs-managed/` `meta/` `goals/` `tasks/`，**不含 `.quay/`**。
- ⇒ 剩下的只能是**人对共享检出的一次性命令**（本仓库有同形的既有残留：`tasks/EXIST.md` 就是一次「写错落点的一次性复现」留下的）。**⛔ 不把候选当结论**：这里给出的不是「找到了谁」，而是**穷尽性证据 + 逐条排除**。
- **补一条结构性成因（5b 扫描的正面产物）**：与本载体**由同一个模块、写进同一个 stateDir** 的兄弟文件 `.quay/routine-last-run.json` **是 gitignored 的**（`.gitignore:498`，注释逐字写「Same gitignored runtime-state family as」），而本载体却是 tracked ⇒ **同一条机制的两个产物落点不一致，而 tracked 的那个正好就是被还原的那个**。这正是「丢失窗口存在与否 = 落点决定」的直接证据。

**② 落点决定：纳入提交（不是我 Touches 里写的 gitignored 那支），依据是机制性的、可复算的：**
- 选 gitignore 需要 `git rm --cached .quay/routine-findings.jsonl` ⇒ 会在 **develop 上产生一条【删除该文件】的提交**，而**主检出此刻正持有它的本地修改**（`git status --porcelain -- .quay/routine-findings.jsonl` = `M`）⇒ **下一次 `--ff-only` 同步会以「local changes would be overwritten」拒绝**：为一个「静默丢失」缺陷修的补丁，反过来打断同步路径。实测该文件确在 develop 上（`git cat-file -e develop:.quay/routine-findings.jsonl` 通过，`53cc833b5` 是 develop 的祖先）。
- 选「纳入提交」没有这个边角：**追加与提交是同一个动作**，HEAD 与工作树每轮之后即一致，「例程写了、还没人提交」这个丢失窗口长度归零。
- 实现：`plugin/scripts/probe-routine.ts:458 commitRoutineWrite()`，形状照抄 Core 唯一的 store 提交原语 `commitStoreWrite`（pathspec 限定、`add`+`commit` 背靠背=硬规则 11、`--no-verify`、失败即 `git reset -- <path>` 保字节）；载体与立案产物**共用同一条判据**。
- ⚠️ **5b 扫描结论是「否」**：`tasks/<id>.md` 这一侧**不存在**同形缺陷 —— 实测 `quay-native task create` **自己就提交**（`tasks: <id> task_write by cli:<pid>`，本 worktree 与一个全新临时仓库里各验一次）⇒ 对任务文件的这次提交通常只是空转。**第一版把「nothing to commit」当成失败上报，使每一次成功立案都附一条假 failure**；已改为三态（已提交 / 有暂存待提交 / 无暂存且与 HEAD 不同 ⇒ 不信其为已提交），并由用例钉住。**声明修了不存在的缺陷就是虚报，故此处写明它不存在。**

**③ HEAD 与工作树对照（主检出，2026-09-15T19:3xZ，运行中的两轮例程仍在写）。**
- **改前（当前生产形态，本次实现尚未落地到主检出）**：`HEAD` = **54 行**、末条 `ts` = `2026-09-13T18:03:58.156Z`；**工作树** = **98 行**、末条 `ts` = `2026-09-15T19:08:58.327Z`；`git status --porcelain` = `M .quay/routine-findings.jsonl` ⇒ **两份不一致、且差异 100% 依赖「没人碰它」**。
- **改后的可证伪对照（`plugin/test/probe-routine.test.mjs` 的 `CARRIER AC7` 用例，✓ 实跑）**：
  `(1)` 旧形态复现 —— 对一条已 tracked 的载体追加一条记录后 `git checkout -- <carrier>` ⇒ **该记录消失**（这正是 2026-09-15 实测丢掉 25 条记录的形态）；
  `(2)` 新形态 —— 跑完一轮例程后 `git status --porcelain -- <carrier>` **为空**（HEAD 与工作树一致）、`git show HEAD:<carrier>` 含新 finding 记录与 `filing-round` 记录，**同一条 `git checkout` 再也拿不回任何东西**。

### AC8 5b 扫描产物（⛔ 不只覆盖 freshness 一条）

谓词：对载体里**全部 distinct findingId**（90 个）逐个 `grep -rl <findingId> <tasks dir>`。**谓词先对自己的真样本干跑过**（它确实能命中 `gap-productize-deep-semantic-dedup-scan-routine.md` 里被逐字引用的 id）。

- **改前（生产板 = 主检出 `tasks/`）**：命中 **6 / 90**，且 **6 个全部落在同一个文件** `gap-productize-deep-semantic-dedup-scan-routine.md` —— 那是**建该例程的任务自己在 body 里引用了探针输出**，⛔ 不是由 finding 立案的任务。前 3 条逐字：`assertsafeid-four-copies` / `cross-surface-task-parsing` / `driver-resident-loop-scaffolding` → 均 → `['gap-productize-deep-semantic-dedup-scan-routine.md']`。
- **改后（带本轮立案产物的板）**：命中 **12 / 90**，新增的 6 条全部是 `gap-routine-*` 文件，且**覆盖两条 routine**（`freshness-refresh` ×3、`semantic-dedup-scan` ×3）⇒ 修法不是只在 freshness 一条上生效。
- ⚠️ 剩余 78 个未命中不是缺陷：按本轮真实读数，它们被 `action`（`leave` 类）或 `rate`（K=3/窗口）正确挡下——**挡下也有逐条记录**（见 AC5 的 `dispositions`）。

### AC5-③ 一处**前提为假**的 Touches 条目（诚实标注，⛔ 未按它施工）

原 Touches 条目「`packages/quay/plugin/probes/freshness-refresh.md`（同一改动必须同步镜像，过 `mirror-pair-drift-check.ts`）」的**前提为假**，实测三条：
1. 该路径**在本 worktree 里不存在**（`packages/quay/plugin/` 整个目录不存在）；主检出里它**存在但被 gitignored**（`git check-ignore -v` ⇒ `.gitignore:26:packages/quay/plugin/`），是 build staging 副本，`git ls-files packages/quay/plugin | wc -l` = **0**。
2. `mirror-pair-drift-check.ts` 的配对集是 **`plugin/scripts` ↔ `experiments/quay-perpetual-stream/scripts`**（`LEFT_DIR_REL`/`RIGHT_DIR_REL`），**`probes/` 不在其中** ⇒ 根本没有这条镜像判据。
3. 该检查实跑 **exit 0 PASS**（未因本改动报任何 drift）。
⇒ 因此**未**去改那个 gitignored 的 staging 副本（改了也会被下一次构建覆盖），真实改动只有 `plugin/probes/freshness-refresh.md` 一份。

### 一处**不修、但必须报**的同形兄弟（⛔ 不是我的 Touches）

`plugin/scripts/meta-driver.ts:1700-1713` 的 `renderAutoDriveBody()` 用的是 **`## AC（draft）` / `## DoD（draft）`** —— 与我在本案修掉的形态**完全相同**：`SHAPE_SECTIONS` 认它，**checkbox 闸不认**（`quay task check` 会报 "AC section has no checkboxes"）。它不在本任务 Touches 内，且 `meta-driver.ts` 是另一条通道（autoDrive），**故本任务不修它**——但按 5b 的纪律，它必须被写下来而不是被忽略。**未验证它在生产上是否真的产生了卡住的任务**（那需要单独立案）。

## Definition of Done

主检出载体的四条主体证据在窗口内（`build_sha` 到 develop-tip 的交付面提交距离 ≤ K=200），**AC-214 判据本体干跑 exit 0**（七行 margin 全正），且在 `QUAY_GOAL009_FRESHNESS_K=1` 负控制下仍能 exit 1、`goals/` diff 为空；**机械通道的 finding 有了立案动作面**（AC5 双向负控制 + AC6 生产载体读数 + 反向对照齐备），用「关 seam ⇒ 不产出」证明它不是恒有输出；载体回退者已定位或落点已决定（AC7）。

⛔ 不接受的替代物：改 K / 删主体 / 改 `expect` / `criterion`；手写或搬运证据记录；`--selfcheck` / `--check` 的输出；只把记录写进任务 worktree 的 `.quay/`（判据读主检出 ⇒ 空转）；把「立案步」降格成又一条观察项（只报不立案）；用「例程在跑、有 finding」冒充「缺口被处理」——**这正是本条的全部要点**。

## Touches

- `plugin/scripts/probe-routine.ts`（机械通道：append 后新增立案步）
- `plugin/scripts/routine-file-gate.ts`（复用；若需扩展以接受 finding 形状）
- `plugin/test/probe-routine.test.mjs`（双向负控制 + 生产载体读数）
- `plugin/probes/freshness-refresh.md`（若输出契约需带立案字段）
- `.quay/routine-findings.jsonl`（本条的载体：落点决定 = gitignored + append-only，或纳入提交）
- `.quay/productization-verification.jsonl`（gitignored：AC2 产出者 append 的落点，⛔ 非可提交物）
- `tasks/gap-ac214-fifth-crossing-routine-detects-but-nothing-acts.md`（自身文件：勾 AC + 贴实跑证据）
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-203.md`（立案步的产物，本任务 delta 的一部分）
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-205.md`（同上）
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-207.md`（同上）
- `tasks/gap-routine-semantic-dedup-scan-fs-walk-family.md`（同上）
- `tasks/gap-routine-semantic-dedup-scan-shell-scan-surface-family.md`（同上）
- `tasks/gap-routine-semantic-dedup-scan-firstargregion-stripshellcomments.md`（同上）
- `tasks/gap-ac205-delivery-held-unidentified-peer-sender.md`（AC2 取证时诊断出的 AC-205 阻塞，已立案）