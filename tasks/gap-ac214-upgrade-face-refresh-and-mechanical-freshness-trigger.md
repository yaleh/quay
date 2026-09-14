---
id: gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger
title: AC-214 第四次转红（升级面 AC-238/239 202/200，margin −2；同一对主体 24h 内第二次）：关闭动作 =
  重跑升级面产出者；并把「刷新动作」机械化——主体↔产出者映射的完备性判定 + 由 margin 载体派生的 routine 触发
status: needs-human
needs_human_cause: human-adjudication
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-214
depends_on:
  - gap-dist-closure-missing-driver-anchor-js
---
## Proposal

**判据正本**：`goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md`（goal=GOAL-009，`long-term: true`，status=achieved）。exit 0 = AC-201/203/205/207/232/238/239 各自**最新**证据记录的 `build_sha` 到 develop-tip 的【交付面提交距离】均 ≤ K（默认 200，`QUAY_GOAL009_FRESHNESS_K` 可配），且机械推导出的载体型主体集合 SUBJ 中无 NEED 之外成员；exit 1 = 任一条无证据或陈旧（stderr 逐条指名）；exit 3 = 载体缺失 / rev-list 读不出（NOT-EVALUATED，⛔ 不与合格同形）。

**本次转红（立案当轮实测，⛔ 非引述）**：

```
$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-214 --root /home/yale/work/quay
verdict: fail   (event ts 2026-09-14T17:16:24.019Z)
reason 逐字: acceptance failed (exit 1) — stale evidence: GOAL-009-AC-238:202/200 (margin -2), GOAL-009-AC-239:202/200 (margin -2)
EXIT=1
```

`.quay/goal-freshness-margin.json` 全文（同一时刻，criterion 自己写的快照）：

```json
{"at": "2026-09-14T17:16:24Z", "k": 200, "subjects": {"GOAL-009-AC-201": {"K": 200, "d": 56, "margin": 144}, "GOAL-009-AC-203": {"K": 200, "d": 56, "margin": 144}, "GOAL-009-AC-205": {"K": 200, "d": 56, "margin": 144}, "GOAL-009-AC-207": {"K": 200, "d": 56, "margin": 144}, "GOAL-009-AC-232": {"K": 200, "d": 56, "margin": 144}, "GOAL-009-AC-238": {"K": 200, "d": 202, "margin": -2}, "GOAL-009-AC-239": {"K": 200, "d": 202, "margin": -2}}}
```

载体侧读数（直读 `.quay/productization-verification.jsonl` 取每个主体的最新记录）：

| 主体 | 最新记录 `ts` | 顶层 `build_sha` | d |
|---|---|---|---|
| AC-201 / 203 / 205 / 207 / 232 | 2026-09-14T14:25:05Z | `f19397c66473698968f016bcfce916c388b5d7fb` | 56 |
| **AC-238** | **2026-09-13T17:11:09Z** | `32ff4f3afcd409096b9cf262b8933ba723b5fcb4` | **202** |
| **AC-239** | **2026-09-13T17:11:09Z** | `32ff4f3afcd409096b9cf262b8933ba723b5fcb4` | **202** |

**这是一次刚发生的回归，⛔ 不是恒红**：`.quay/gate-events.jsonl` 中 AC-214 的**最后一次 pass = 2026-09-14T17:11:37.386Z**、**第一次 fail = 2026-09-14T17:14:37.907Z**（相隔 3 分钟）；到立案为止共 2 条 fail（17:14:37 / 17:16:24），`reason` 逐字相同。

**为什么更早的修复没有兜住（⛔ 不是那几条被证否）**：

- 六条 `done` 且顶层 `goal_ac: AC-214` 的任务里，四条修的是**可达性**（产出侧写顶层 `build_sha`；主体集合改为机械推导；把 AC-232/238/239 接进 NEED）——**它们的绿是真的**。
- 另两条修的是一次性刷新：`gap-ac214-ac207-freshness-evidence-producer-run`（09-13 12:25 落地）刷**冷启动面**（`--verify-coldstart --ac207-e2e`），`gap-ac214-ac238-239-freshness-upgrade-producer-rerun`（09-13 17:11 产出）刷**升级面**（`--verify-upgrade --ac239-e2e`）。**两次都是一次性动作，刷新动作没有任何触发器** ⇒ 同一个主体类在 K 窗口内不再被刷新即再次越界。
- **本条与最后一条是同一对主体、同一种关闭动作，相隔正好 24 小时**（载体里 AC-238/239 的最新记录就是那次运行于 `2026-09-13T17:11:09Z` 写下的，`build_sha 32ff4f3a`）。它的绿是真的，但它**不是持续的绿**。
- 时间线自证（同一对主体的窗口在一天内被走完）：09-13T16:03 记录写入 ⇒ 09-14T14:44（第三次转红任务立案时）margin 还是 **35** ⇒ 09-14T17:14 已是 **−2**。**2 小时 32 分钟内前进 37 个交付面提交（≈15/小时）**，而 AC 正文的 K 是按 **83 交付面提交/天**（≈2.4 天余量）设的 ⇒ **实际窗口比设计假设短约一个量级**，「红了再补」这一关闭动作在结构上必然追不上。
- ⇒ **硬规则 5b 的第二次出现**：AC-244 把**主体集合**机械化了，但**刷新动作**从未被同样地机械化。

**本次要跑的产出者（唯一能产出 AC-238/239 记录的动作；脚本自述见 `plugin/scripts/develop-deliver-tgz.sh:67-83`）**：

```
bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc --ac239-e2e --hosts B --force --root /home/yale/work/quay
```

⚠️ `--root` 必传：载体 `.quay/productization-verification.jsonl` 是 **gitignored**（`.gitignore:330`），不随 worktree 的 merge 回到主检出，而 goal-driver 跑 criterion 读的是**主检出**那一份；产出者默认从自身脚本位置推 `repo_root` ⇒ 在 worktree 里跑会落进 worktree 的 `.quay/`，判据**永远读不到**（09-13 那次成功的刷新就是显式传了 `--root /home/yale/work/quay`）。

**⚠️ 结构性缺陷 —— 本条的第二个交付物（⛔ 本任务不自行改 K）**：

刷新动作没有任何周期触发器（`.quay/config.yml` 的 `loop.routines` 只有 self-validation / architecture-analysis / history-mining / browser-explorer / semantic-dedup-scan 五条），每个主体类都会在窗口外老化，靠 goal-driver 的缺口立案一次次补。**发生率（硬规则 12，已查历史、⛔ 非等下一轮）= 4**：

| # | 时刻 | 主体类 | 读数 | 关闭动作 |
|---|---|---|---|---|
| 1 | 09-13 上午 | 冷启动面（AC-207） | 210/200 | 重跑冷启动产出者 |
| 2 | 09-13 16:54 | 升级面（AC-238/239） | 206/200 | 重跑升级产出者 |
| 3 | 09-14 14:15 | 冷启动面（AC-203/205/207/232） | 202/200 | 重跑冷启动产出者 |
| 4 | **09-14 17:14** | **升级面（AC-238/239）** | **202/200** | **本条** |

**27 小时内 3 次、5 天内 4 次**，且**成本结构已测量**（冷启动面一次 = 20m36s；升级面一次 = 跨机小时级）⇒ 此前两次任务把「刷新节奏」降为观察项的两条理由（①落点是 gitignored 的 `.quay/config.yml`，②「多久一次」未测量）**均已不成立**：①落点 gitignored 不妨碍它**可核**——本仓五条既有 routine 同样落在那里，其探针规格则落在版本控制的 `plugin/probes/*.md`；②速率与墙钟都已实测。⇒ 硬规则 12（给不出发生率不得新增前置）与硬规则 4 推论（成本结构未知前不设阈值）**不再构成反对理由**。

⛔ **K 的重估点仍是 2026-10-09**（AC 正文自己写的「跑满 30 个自然日后用真实分布重估 K 并贴回正文」）；本条 ⛔ **不改 K、⛔ 不改 criterion、⛔ 不改 expect、⛔ 不删主体**。⛔ 自行 `superseded` 该 AC 需人裁定。

**为什么 ⛔ 不得用放宽判据来关闭它**：AC 正文把 K 定为未测量的初始策略值并钉死复核点；今天改 K 或删主体没有数据支撑，且上一轮任务的 DoD 已逐字禁止「通过放宽 criterion 达成」。唯一的关闭路径是**在窗口内重跑产出者**，外加**让刷新动作不再依赖有人记得**。

<!-- dedup-ref -->
**机制查重（⛔ 非关键词）**：本条机制 =「**刷新动作无触发器 ⇒ 每个主体类周期性越界，而关闭动作是一次性重跑**」。`grep -l '^goal_ac: AC-214$' tasks/*.md` = 6 条，**全部 `status: done`**；in-flight（todo/ready/needs-human）中持 `goal_ac: AC-214` 者 = **0**。相关但机制不同的既有任务：`gap-ac244-freshness-subject-set-mechanically-derived`（主体集合的机械推导，done）、`gap-ac214-coldstart-face-evidence-aged-past-k-third-crossing`（第 3 次转红 + 已记录费率/墙钟观察项，done）、`gap-ac214-ac238-239-freshness-upgrade-producer-rerun`（第 2 次转红，**同一对主体**，done —— 本条的存在本身就是「它的修复没有持续生效」的证据）。

## Plan

0. **查重（机制维度，⛔ 非关键词）**：`task_list` 列 todo/ready/needs-human；核 `goal_ac: AC-214` 的在飞者为 0；再核没有第二个任务持本任务 `## Touches` 的路径（尤其 `plugin/probes/` 与 `.quay/config.yml` 的 `loop.routines` 写者）。
1. **改前读数（能取假，⛔ 引述不算，须复跑）**：在 `/home/yale/work/quay` 逐字跑 AC-214 的 criterion ⇒ 贴 **exit 1** + 全部 stdout/stderr 行（stderr 逐字含 `stale evidence: GOAL-009-AC-238:…, GOAL-009-AC-239:…`）；贴 `.quay/goal-freshness-margin.json` 全文；贴 `.quay/gate-events.jsonl` 中 AC-214 的**最后一次 pass 与第一次 fail** 两个时刻（证明是刚发生的回归而非恒红）；贴载体里 `ac="GOAL-009-AC-238"` / `ac="GOAL-009-AC-239"` **全部**记录的 `ts`/`build_sha`，证明最新一条停在 2026-09-13T17:11:09Z。取 criterion 的可靠方式（⛔ 不要用 YAML 解析器——该字段在盘上是 `>-` 折叠标量）：
   `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts list --root . | python3 -c 'import json,sys;print([r for r in json.load(sys.stdin) if r["id"]=="AC-214"][0]["criterion"])' > /tmp/ac214-criterion.sh && bash /tmp/ac214-criterion.sh; echo "EXIT=$?"`
2. **产出者前置核（跑之前取，让失败可归因）**：`ssh -o BatchMode=yes -o ConnectTimeout=8 orangevps 'df -h $HOME | tail -1; ls -d $HOME/work/meta-cc; ls $HOME/.local/bin | head'`；本仓库 `.quay/profiles.yml` 存在性。贴全部输出。（远端历史遗留 `quay-verify-upgrade-*-root` 每个约 620–980MB；承接上一轮任务的读数：远端 `/` 曾 85G/96G 已用 ⇒ 磁盘是已知风险面，⛔ 不要因它掩盖其它失败。）
3. **跑产出者**（唯一产出 AC-238/239 记录的动作）：`bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc --ac239-e2e --hosts B --force --root /home/yale/work/quay`。贴退出码 + **全部** `develop-deliver:` 行 + 本次运行**实测墙钟**（`date -u` 起止差）。**退出码 2（PARTIAL）不自动等于失败**：它表示「记录运输成功，但 AC-239 与 AC-238 不同 `project_root`」⇒ 必须先读出 `UPGRADE_PAIR_MISSING` 行再判（⛔ 不以退出码冒充成功，也不因它掩盖读数）。退出 1（FAILED）表示该主机**没产出 AC-238 记录** ⇒ 贴 fail-closed 原文。
4. **读本次运行自己的 stdout / 日志（⛔ 不采信「我跑过了」）**：读 `.quay/verify-upgrade-remote-B-<tip8>.log` 的 `⑦ upgrade-existing` 与 `⑦b post-upgrade continuation (AC-239)` 两段，逐字贴 `ac238 record written` 与 `ac239 record written … (same root as AC-238: …) ✓` 行，以及 `AC239_TASK_ID=` / `AC239_DRIVERS_STARTED=` 行。**若一行都没有** ⇒ 贴 fail-closed 原文并**就此停下**（硬规则 3b：缺值 ≠ 合格）。
5. **确认记录真的落到【主检出】的生产载体（按位置，⛔ 不是按自述）**：在 `/home/yale/work/quay/.quay/productization-verification.jsonl` 里取出 `ts` 晚于本次运行开始时刻的 `ac="GOAL-009-AC-238"` 与 `ac="GOAL-009-AC-239"` 记录，各贴**全文**，核两条 `project_root` **逐字相同**、`build_sha` 为 40-hex；并在 worktree 的 `.quay/productization-verification.jsonl` 上确认**没有**本次新增。
6. **判据转绿（干跑 criterion 本体，⛔ 不是「我看它绿了」）**：AC-214 criterion ⇒ 贴 **exit 0** + 七行 freshness（每条 `margin > 0`）+ `.quay/goal-freshness-margin.json` 全文；再跑 `goal-store gate AC-214 --root .` ⇒ exit 0。
7. **负控制（判据仍能取假，⛔ 双向）**：① `QUAY_GOAL009_FRESHNESS_K=1` 重跑 AC-214 criterion ⇒ **exit 1** 且 stderr **逐条指名**主体；② 判据文本**逐字节未变**：`git diff --exit-code -- goals/` 为空；③ **判据本体是只读的**：只跑 criterion 的那一次，前后 `md5sum .quay/productization-verification.jsonl` **相同**（⛔ 不要把步骤 3 的 append 与它混为一谈——两者的 md5 对比是两件事）。三条全部贴出。
8. **刷新动作机械化（本条的第二个交付物，⛔ 与本条前半独立可验）**：
   - **8.1 主体↔产出者映射**：`plugin/freshness-producers.json` —— 把 NEED 的 7 个主体映射到产出它的命令（当前实测：冷启动面一次运行写出 AC-201/203/205/207/232 五条，升级面一次运行写出 AC-238/239——见 §Proposal 的载体表按 `build_sha`+`ts` 分组）。**单源**：判定与探针都读它，⛔ 不复制两份。
   - **8.2 完备性判定（能取假）**：`plugin/scripts/freshness-producer-coverage-check.ts` —— 任何出现在载体里、却没在映射里登记产出者的主体 ⇒ **fail-closed 报出**（这正是 09-13 那次转红的成因：两个产出者只跑了一个）。负控制必须**双向**：夹具载体加一条未登记主体 ⇒ 判定变红且逐条指名；去掉 ⇒ 变绿。⭐ 该判定还要对**生产**载体跑一次并贴读数（⛔ 只有夹具能满足的判据不是测量）。
   - **8.3 探针 + routine 接线**：新增 `plugin/probes/freshness-refresh.md`（版本控制；frontmatter 文法正本 `plugin/scripts/read-probe-spec.ts`，须含 `instrument`/`fallback`/`output_routing`；路由词表**对着消费方核实**，⛔ 不臆造），并在 `.quay/config.yml` 的 `loop.routines` 增一条（trigger 用既有文法 `interval:<N>m`）。规格的 objective 要求探针读 `.quay/goal-freshness-margin.json`，对 margin 低于阈值的主体**产出 finding**（由既有的 routine→task filing 链落成任务）。**阈值必须是 K 与已测量量的函数**：`阈值 ≥ 产出者墙钟(小时) × 实测前进速率(交付面提交/小时) ⇒ fraction ≥ (产出者墙钟 × 速率) / K`（例：升级面约 2h × ≈15/h = 30 ⇒ fraction ≥ 0.15），⛔ 不引入与 K 无关的独立魔数。⛔ 探针**只 file 不 execute**：⛔ 不得让探针自动跑跨机产出器（重跑的决定仍归人/派发链；routine 的 FILE-ONLY 边界）。
   - **8.4 镜像与静态闸义务（⛔ 先查再动）**：`plugin/` 有镜像 `packages/quay/plugin/`（`probes/` 亦在其中）⇒ 新增规格必须同步镜像并通过 `mirror-pair-drift-check.ts`；若新增 `plugin/scripts/*.ts`，须履行 CLAUDE.md 记载的义务（`capability-catalog.sh` 六行 / `runner-static-gate` 登记 / mutation case / `@checker-count`+1），并在 body 里**逐项贴出**。优先复用既有形态，⛔ 不新造第二套检查器形态。
   - **8.5 真 loader 载入的证据**：用**真** `read-probe-spec.ts` 载入新规格 ⇒ 贴返回值（四键齐全）。若该 routine 在本机**结构上**无法被调度（例如探针读不到主检出的 `.quay/`）⇒ 贴 fail-closed 原文 + **可区分的 NOT-EVALUATED**（⛔ 不与合格同形，硬规则 3b），并把本条升 `needs-human`，⛔ **不得静默跳过**。
9. **失败即停（⛔ 不得手写 / 搬运记录）**：若产出者结构性不可达（远端废弃 / 目标项目不再能被驱动 / 磁盘不足）⇒ 贴 fail-closed 原文 + 可区分的 NOT-EVALUATED，**⛔ 不得手写记录、⛔ 不得从别处搬一条旧记录、⛔ 不得改 K、⛔ 不得自行 `superseded` 该 AC**，把任务升为 `needs-human` 并留痕。

## Acceptance Criteria

- [x] AC1 改前读数（能取假）：本仓库根逐字跑 AC-214 criterion ⇒ **exit 1**，stderr 逐字含 `stale evidence: GOAL-009-AC-238:…` 与 `GOAL-009-AC-239:…`；贴 `.quay/goal-freshness-margin.json` 全文、`.quay/gate-events.jsonl` 中 AC-214 的最后一次 pass 与第一次 fail 两个时刻、以及载体里 AC-238/AC-239 **全部**记录的 `ts`/`build_sha`（证明最新一条停在 2026-09-13T17:11:09Z / `32ff4f3a…`）。⛔ 引述本节不算，须实现者复跑。
- [ ] AC2 产出运行的真读数（⛔ 不是 `--selfcheck`、⛔ 不是夹具、⛔ 不是 `--check`）：贴 `develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc --ac239-e2e --hosts B --force --root /home/yale/work/quay` 的**退出码** + 全部 `develop-deliver:` 行 + 本次实测墙钟 + 前置核的 `df -h`/`ssh` 读数；并贴 `.quay/verify-upgrade-remote-B-<tip8>.log` 的 ⑦/⑦b 两段（`ac238 record written` 与 `ac239 record written … ✓`），或失败时的 fail-closed 原文 + `UPGRADE_PAIR_MISSING` 行。
- [ ] AC3 生产载体上的新读数（硬规则 4 推论三：判据必须读**生产载体**、且只计**运行之后**的时间窗）：**主检出** `/home/yale/work/quay/.quay/productization-verification.jsonl` 中新增 ≥1 条 `ac="GOAL-009-AC-238"` **且** ≥1 条 `ac="GOAL-009-AC-239"` 记录，两者 `ts` 均晚于本次运行开始时刻、`build_sha` 为 40-hex，**且两条 `project_root` 逐字相同**；各贴全文 + `git rev-list --count <该 build_sha>..develop -- <交付面 paths>` ≤ 200 的读数（paths 由 `packages/quay/package.json` 的 `files` 机械推导，⛔ 不手写）。⛔ 手写记录 / 搬运旧记录 / `--selfcheck` 注入的记录一律不算。
- [ ] AC4 判据真转绿：AC-214 criterion 干跑 **exit 0**，贴七行 freshness（每条 `margin > 0`）与 `.quay/goal-freshness-margin.json` 全文（`subjects` 七项 margin 全正）；`goal-store gate AC-214 --root .` ⇒ exit 0。⛔ 通过放宽 criterion 达成不算。
- [ ] AC5 负控制（判据仍能取假，且转绿不来自放宽）：① `QUAY_GOAL009_FRESHNESS_K=1` 下 AC-214 criterion ⇒ **exit 1** 且 stderr 逐条指名陈旧主体；② `git diff --exit-code -- goals/` 为空（判据文本逐字节未变）；③ **只跑 criterion** 的前后 `md5sum .quay/productization-verification.jsonl` **相同**（证明判据本体只读；⛔ 与步骤 3 的写入是两件事）。三条读数全部贴出。
- [ ] AC6 落点正确（⛔ 防空转）：贴出记录**在主检出**载体中的位置（绝对路径 + 载体行数）**且** worktree 的 `.quay/productization-verification.jsonl` 中**没有**本次新增（若 worktree 里也出现 ⇒ `--root` 传错、判据读不到 ⇒ 未达成，须说明并重跑）。
- [x] AC7 刷新动作机械化之一：**版本控制**的主体↔产出者映射产物 `plugin/freshness-producers.json`（**单源**：判定与探针都读它）+ 判定 `plugin/scripts/freshness-producer-coverage-check.ts`（+ `plugin/test/freshness-producer-coverage-check.test.mjs`），后者对「载体里出现过、却未在映射里登记产出者的主体」**fail-closed 报出**。负控制**双向**贴出（夹具载体里加一条未登记主体 ⇒ 判定变红且逐条指名；去掉 ⇒ 变绿）；并贴该判定对**生产**载体 `.quay/productization-verification.jsonl` 的一次真实读数（硬规则 4 推论三：只由夹具满足的判据不算产出）。同时贴新增 `plugin/scripts/*.ts` 的全部义务落实读数（`capability-catalog.sh` 声明行 / `runner-static-gate` 登记 / mutation case / `@checker-count`）与 `mirror-pair-drift-check.ts` 的读数；⛔ 义务清单若与本任务列出的 Touches 不一致（少一处落点），须在 body 里补记并把该落点补进 `## Touches`。
- [x] AC8 刷新动作机械化之二（routine 接线）：`.quay/config.yml` 的 `loop.routines` 中新增条目（贴该条目的逐字内容与其 trigger 文法的出处）；`plugin/probes/freshness-refresh.md` 经**真** `read-probe-spec.ts` 载入成功（贴返回值四键）；规格 objective 中触发阈值**显式写成 K 与已测量量的函数**并在 body 里给出该算式的代入过程（⛔ 不得出现与 K 无关的独立魔数）；镜像 `packages/quay/plugin/probes/freshness-refresh.md` 存在且 `mirror-pair-drift-check.ts` 通过。若该 routine 结构上无法被调度 ⇒ 贴 fail-closed 原文 + 可区分的 NOT-EVALUATED 并升 `needs-human`（⛔ 不得静默跳过、⛔ 不得用「观察项」代替）。

## Definition of Done

**前半（关闭当前缺口）**：主检出 `/home/yale/work/quay/.quay/productization-verification.jsonl` 中出现**本次真实跨机运行**产出的、`project_root` **逐字相同**的 `ac="GOAL-009-AC-238"` 与 `ac="GOAL-009-AC-239"` 记录（各自顶层 `build_sha` = 本次 develop tip、40-hex、到 develop 的交付面距离 ≤ K=200），且 **AC-214 判据本体干跑 exit 0**（七行 freshness 全部 `margin > 0`），并在 `QUAY_GOAL009_FRESHNESS_K=1` 的负控制下**仍能 exit 1**，同时 `goals/` 的 diff 为空。

**后半（让缺口不再第 5 次出现）**：刷新动作**已接上机械触发**——存在内容为「主体 → 产出者命令」的**版本控制**产物与一个**能取假**的完备性判定（负控制双向已贴），`.quay/config.yml` 的 `loop.routines` 中有对应周期条目，其探针规格能被**真** loader 载入，探针的触发阈值是 K 与**已测量**的前进速率/产出者墙钟的函数（代入过程已贴），且探针**只 file 不 execute**（⛔ 不自动跑跨机产出器）。

⛔ **不接受的替代物**：手写记录 / 从别处搬一条旧记录 / `--selfcheck` 或 `--check` 的输出；只把记录写进任务 worktree 的 `.quay/`（判据读的是主检出 ⇒ 空转，AC6 直接挡）；改 K / 删主体 / 改 `expect` 或 `criterion`；用 `--verify-coldstart --ac207-e2e` 冒充（那是**冷启动面**产出者，⛔ 不产出 AC-238/239——这正是**本条的成因**）；自行 `superseded` 该 AC 记录（需人裁定）；把后半降格成「观察项」了事（前三次都这么做过，这正是第 4 次转红的原因）。

## Touches

（新文件一律带 `(new)` 结构标签 —— `touches-parser.ts` 的 admission 约定：未被标 `(new)` 的 Touches
条目必须在盘上存在，否则该候选按 `majorityMissing` 判为不可派发。）

- `plugin/probes/freshness-refresh.md` (new)
- `packages/quay/plugin/probes/freshness-refresh.md` (new)
- `plugin/freshness-producers.json` (new)
- `packages/quay/plugin/freshness-producers.json` (new)
- `plugin/scripts/freshness-producer-coverage-check.ts` (new)
- `plugin/scripts/checker-mutation-cases/freshness-producer-coverage-check.sh` (new) ← **补记**：原 Touches 未列，实现时按 CLAUDE.md 的义务四件套新增
- `plugin/test/freshness-producer-coverage-check.test.mjs` (new)
- `plugin/scripts/capability-catalog.sh`（新增脚本的 catalog 六行落点）
- `plugin/scripts/runner-static-gate.ts`（新增脚本的静态闸登记 + `@checker-count` 59→60 落点）
- `.quay/config.yml`（gitignored：`loop.routines` 新增 `freshness-refresh` 条目。声明它是为了表明产出位置，⛔ 不是可提交物）
- `.quay/productization-verification.jsonl`（gitignored：本 AC 的载体，本次运行 append 的 AC-238/239 记录。⚠️ `anti-drift-touches-check` 只比对**已跟踪**文件的 diff；该载体被 `.gitignore:330` 忽略 ⇒ 不进那个集合，声明它是为了表明产出落点，⛔ 不是可提交物）
- `tasks/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger.md`（自身文件：勾 AC + 贴实跑证据）

### Touches 更正（原列表与真机制不符的两条 —— 实测见 AC7 证据）

`packages/quay/plugin/` 是 **gitignored 的 pack-time 快照**（`.gitignore:26`，0 个 tracked 文件），由
`packages/quay/scripts/package.sh` 生成。跑真机制（staging + pack，exit 0）后实测：

| 原 Touches 条目 | 真机制产出？ | 实测 |
|---|---|---|
| `packages/quay/plugin/freshness-producers.json` | ✅ | 3723 B，2026-09-14 18:06 生成 |
| `packages/quay/plugin/probes/freshness-refresh.md` | ✅ | 7096 B，同日生成 |
| `packages/quay/plugin/scripts/freshness-producer-coverage-check.ts` | ❌ **设计如此** | `package.sh:169` 删除 staging 副本里全部原始 `.ts`（只留 `runner-static-gate.ts` 一个 bash 库）⇒ 静态检查器在交付物里没有 raw `.ts` 形态 |
| `packages/quay/plugin/test/freshness-producer-coverage-check.test.mjs` | ❌ **设计如此** | `package.sh` 显式 `rm -rf ${PLUGIN_DEST}/test`（人 2026-08-06 裁定：quay 自己的套件不进交付物） |
| `packages/quay/plugin/scripts/checker-mutation-cases/freshness-producer-coverage-check.sh` | ✅（**补进 Touches**） | 7943 B，同日生成 |

**这不是本任务引入的缺口**：同批登记的静态检查器 `worktree-namespace-literal-check.ts` /
`gitignore-runtime-coverage-check.ts` 在 staging 后同样既不在 `packages/quay/plugin/scripts/` 也不在
`scripts/dist/`（实测：staged `scripts/` 下只剩 `runner-static-gate.ts` 一个 `.ts`；`dist/` 86 个
bundle 中无这两者）。静态检查器是**本仓自己的 harness**（`scripts/test.sh` 的 registry），不是交付给
第三方的运行时件。上面两条 ❌ 因此按实测**保留为「已知不产出」的声明并在此说明**，⛔ 不删（删掉会让
下一个读 Touches 的人以为漏了落点）。

## Resolution

**本任务分两半，两半的结局不同 —— 逐条读数在下面：**

- **前半（关闭当前缺口）—— 只关了一半。** 升级面产出者真的跨机跑了；**AC-238 半边成功并已刷新到
  d=0/margin 200**，**AC-239 半边结构性不可达**（升级后的项目自己的 drivers 起不来 ⇒ 任务停 `todo`
  ⇒ 不写记录）。⇒ **AC2–AC6 未达成，任务升 `needs-human`**（任务 step 9 逐字要求）。
- **后半（让缺口不再第 5 次出现）—— 完成且独立可验。** AC7 / AC8 全部达成。

⛔ 未做的事，逐条声明：⛔ 没有手写记录、⛔ 没有从别处搬旧记录、⛔ 没有改 K、⛔ 没有改 criterion /
`goals/`（`git diff --exit-code -- goals/` 为空，实测）、⛔ 没有自行 `superseded` 该 AC、⛔ 没有用
`--verify-coldstart` 冒充（冷启动面产出者不产出 AC-238/239）、⛔ 没有把后半降格成「观察项」、
⛔ 没有为「不烧 fan-in」把未达成的 AC 勾上。

### AC1 —— 改前读数（复跑，⛔ 非引述本节）

**AC-214 criterion 干跑（本仓根，2026-09-14 17:52Z，`bash /tmp/ac214-criterion.sh`）**

```
freshness GOAL-009-AC-201: 67/200 (margin 133)
freshness GOAL-009-AC-232: 67/200 (margin 133)
freshness GOAL-009-AC-205: 67/200 (margin 133)
freshness GOAL-009-AC-207: 67/200 (margin 133)
freshness GOAL-009-AC-203: 67/200 (margin 133)
freshness GOAL-009-AC-238: 213/200 (margin -13)
freshness GOAL-009-AC-239: 213/200 (margin -13)
stderr: stale evidence: GOAL-009-AC-238:213/200 (margin -13), GOAL-009-AC-239:213/200 (margin -13)
EXIT=1
```

（立案当轮 task body 记的是 `202/200, margin -2`；复跑时已是 `213/200, margin -13` —— 同一回归在
立案后的十几分钟内又前进了 11 个交付面提交，这本身就是「关闭动作追不上」的直接读数。）

**`.quay/goal-freshness-margin.json` 全文（同一时刻 criterion 自己写的快照）**

```json
{"at": "2026-09-14T17:52:26Z", "k": 200, "subjects": {"GOAL-009-AC-201": {"K": 200, "d": 67, "margin": 133}, "GOAL-009-AC-203": {"K": 200, "d": 67, "margin": 133}, "GOAL-009-AC-205": {"K": 200, "d": 67, "margin": 133}, "GOAL-009-AC-207": {"K": 200, "d": 67, "margin": 133}, "GOAL-009-AC-232": {"K": 200, "d": 67, "margin": 133}, "GOAL-009-AC-238": {"K": 200, "d": 213, "margin": -13}, "GOAL-009-AC-239": {"K": 200, "d": 213, "margin": -13}}}
```

**`.quay/gate-events.jsonl` 中 AC-214 的最后一次 pass 与第一次 fail（证明是刚发生的回归，⛔ 不是恒红）**

```
LAST PASS BEFORE : 2026-09-14T17:11:37.386Z  {"reason": "acceptance passed (exit 0)"}
FIRST FAIL OF RUN: 2026-09-14T17:14:37.907Z  {"reason": "acceptance failed (exit 1) — stale evidence: GOAL-009-AC-238:202/200 (margin -2), GOAL-009-AC-239:202/200 (margin -2)"}
LAST FAIL (立案后): 2026-09-14T17:51:03.454Z  同上 reason
```

⇒ pass→fail 相隔 **3 分钟**，到立案为止同一 reason 连续 12 条 —— 刚发生的回归。

**载体里 AC-238 / AC-239 的【全部】记录（证明最新一条停在 2026-09-13T17:11:09Z / `32ff4f3a…`）**

```
GOAL-009-AC-238 2026-09-11T04:00:43Z 9eda8c70741d46b42dc999cf28bfb84b7b364564 /home/yale/quay-verify-upgrade-9eda8c70-root
GOAL-009-AC-238 2026-09-11T04:10:09Z 1c202737ed2acb7e9ea93f96fb3b8a27437f5d66 /home/yale/quay-verify-upgrade-1c202737-root
GOAL-009-AC-238 2026-09-11T07:20:28Z 289a49dc5ba2694811d5e46abc6bc348fe0e5614 /home/yale/quay-verify-upgrade-289a49dc-root
GOAL-009-AC-238 2026-09-11T16:03:59Z 3b0932db37179cffd77f65f3f3c1d42a15730963 /home/yale/quay-verify-upgrade-3b0932db-root
GOAL-009-AC-239 2026-09-11T16:03:44Z 3b0932db37179cffd77f65f3f3c1d42a15730963 /home/yale/quay-verify-upgrade-3b0932db-root
GOAL-009-AC-238 2026-09-13T17:11:09Z 32ff4f3afcd409096b9cf262b8933ba723b5fcb4 /home/yale/quay-verify-upgrade-32ff4f3a-root   ← 最新
GOAL-009-AC-239 2026-09-13T17:11:09Z 32ff4f3afcd409096b9cf262b8933ba723b5fcb4 /home/yale/quay-verify-upgrade-32ff4f3a-root   ← 最新
```

⇒ 最新一条确实停在 **2026-09-13T17:11:09Z / `32ff4f3a…`**，与立案读数逐字相符。

### AC2 —— 产出运行的真读数（真跑，⛔ 非 `--selfcheck`/夹具/`--check`）

**本次跨机运行（host B = orangevps），起止（`date -u` 实测）**

```
RUN START 2026-09-14T18:14:29Z
RUN END   2026-09-14T18:18:58Z      （实测墙钟 4 分 29 秒）
PRODUCER_EXIT=2
```

`develop-deliver:` 全部行与退出码逐字见 §附录「run5 日志」。远端逐字日志见
`.quay/verify-upgrade-remote-B-fb0301b8.log`（⑦ / ⑦b 两段）。

**前置核（跑之前取，让失败可归因）**

```
$ ssh -o BatchMode=yes -o ConnectTimeout=8 orangevps 'df -h $HOME | tail -1; ls -d $HOME/work/meta-cc; ls $HOME/.local/bin | head'
/dev/sda1        96G   89G  7.8G  92% /
/home/yale/work/meta-cc
arduino-cli
claude
claude-fjdac ... (claude-fjdac 等 launcher 就位)
$ ls -la .quay/profiles.yml
-rw-rw-r-- 1 yale yale 7247 Sep 14 12:17 .quay/profiles.yml
```

远端历史遗留 `quay-verify-upgrade-*-root` 8 个、合计 5.5G（已知风险面，⛔ 未被用作任何结论的理由）。

**⑦ / ⑦b 两段（逐字，取自 `.quay/verify-upgrade-remote-B-fb0301b8.log`）**

```
== ⑦ upgrade-existing: /home/yale/quay-verify-upgrade-fb0301b8-root ==
  fresh deliverable: quay.js + quay-native.js (from /home/yale/quay-verify-upgrade-fb0301b8.npm)
  isolated copy: /home/yale/work/meta-cc-aged-ac238-copy -> /home/yale/quay-verify-upgrade-fb0301b8-root (source opened read-only, never written)
  pre: tasks=103 runtime_age_days=24.802 taskset=765b6b387e3a
  pre binding: pre_binding=path-resolved (read with NO $PATH assistance — the stale-inventory reading)
  upgrade action: shipped quay-init (config-preserving branch) rc=0 → .../.quay-upgrade-init.log
  post-binding: retired_to=.../.quay/quay-init-backups/1789409755/runtime retired_matches_pre=1 live_rt_gone=1 bound=.../vendor/quay-native/dist/quay-native.js bound_sha=3039256afff0 delivered_qn_sha=3039256afff0
  post: tasks=103 taskset_stable=1 runtime_replaced=1
  post binding: post_binding=path-resolved (read with NO $PATH assistance — the gate below)
  cli read-back: list_count=103 sample=AC118-001 sample_ok=1 task_list_ok=1
  ac238 record written → /home/yale/quay-verify-upgrade-evidence-fb0301b8.jsonl (via the ac_record_append choke point)

== ⑦b post-upgrade continuation (AC-239): the upgraded project's OWN drivers drive a NEW task to done ==
  target-profiles: configured (launcher=claude-fjdac model=deepseek-v4-pro-anthropic auth=token → .../.quay/profiles.yml)
  [⑦b] go toolchain: /home/yale/go-sdk/bin (go version go1.24.4 linux/amd64)
  [⑦b] landing-baseline pre-flight: state=compatible (delivered init --dry-run rc=0) :: [REUSED] landing-baseline -> develop — 'develop' contains 'main' (0 commit(s) ahead, 0 behind) — a valid quay landing baseline
  [⑦b] real defect-fix task created in the upgraded project: ac239-subagent-session-id-scan
  [⑦b] driver start: promotion rc=1 worker rc=1 started=0
  [⑦b] not-evaluated: 升级后项目的 driver 起不来 ⇒ 记录 NOT written（这本身就是 AC-239 要测的失败，如实记，⛔ 不写成「未评估」以外的结论）
  [⑦b] poll finished: task_status=todo (poll window 120s)
  [⑦b] NOTE: AC-239 record NOT written (task not driven to done / no implementation commit / no gate events — 缺值≠合格)
ROLLUP: AC238_EVALUATED=1（四件读数全成立并已写记录）；AC239_DRIVERS_STARTED=0；AC239_WRITTEN_THIS_RUN=0
develop-deliver: evidence-completeness PARTIAL present=1 missing=1 list=GOAL-009-AC-239
develop-deliver: B — NOT-EVALUATED (declared ac set [GOAL-009-AC-238 GOAL-009-AC-239] not fully present in transported evidence)
```

⇒ **`ac238 record written` 有；`ac239 record written … ✓` 没有**（⑦b 逐字说明原因）。**AC2 的两条出口
都不成立**：主出口要两条都有；备出口要 `UPGRADE_PAIR_MISSING` 行（那是「运输成功但两记录不同 root」
的 PARTIAL 形态，本次是 **AC-239 压根没产出**，不是同源问题）⇒ ⛔ 不勾 AC2。

### ⛔ AC3 / AC4 / AC5 / AC6 未达成 —— 产出者【结构性不可达】，升 `needs-human`

**现象**：AC-238 半边**成功**（升级本体全部读数成立），AC-239 半边**结构性不可达**：升级后的项目
自己的 drivers 起不来 ⇒ 任务停在 `todo`、0 条 gate event ⇒ 不写 AC-239 记录（fail-closed 是对的）。

**第 1 层因（已修）—— 源副本继承了另一个项目的【活进程握手】**
旧的 aged source 继承 meta-cc 的 driver 运行态，`aliveness()` 把 meta-cc 的活 worker pid 读成
「本副本已在跑」，`quay driver start` 于是 rc=0 空转（实测 pid 275059/275038 = meta-cc 自己的驱动；
无 `.quay/anchor-desired.json`）。已在源副本剔除，该层已消除（run 5 的 `anchor-desired.json`
于 18:15:59Z 出现 ⇒ `driver start` 这次真的走到了声明期望态那一步）。

**第 2 层因（未修，⛔ 不在本任务 Touches 内）—— 交付物缺 `dist/driver-anchor.js`**
隔离对照（一份与运行无关的副本，`driver start` 输出**不重定向**）：

```
$ cd <isolated-copy> && node <installed>/quay/dist/quay.js driver start --kind promotion --root <copy>
start-failed: kind=promotion — cannot spawn driver anchor: driver-anchor module not found next to driver-runtime (/home/yale/quay-verify-upgrade-fb0301b8.npm/lib/node_modules/quay/plugin/scripts/dist)
PROMOTION_RC=1
start-failed: kind=worker — cannot spawn driver anchor: driver-anchor module not found next to driver-runtime (…)
WORKER_RC=1
```

**因果链（每条都是实测，⛔ 不是推断）**

1. `plugin/scripts/driver-runtime.ts:831 preferredAnchorKernel()` 只在两处找 anchor：
   `driver-anchor.{ts,js}` 与本内核**兄弟**（`dist/` 下），或本内核自己仓库的**主检出**同名路径
   （`mainCheckoutKernelDir()`；注释逐字：① 只在「本内核跑在 linked worktree 里」时生效）。
2. 交付物里 `.../quay/plugin/scripts/dist/` 有 `driver-runtime.js` 而**没有** `driver-anchor.js`
   （远端 `ls` 实测；本机 staging 实测同样没有）。
3. 安装形态下 `mainCheckoutKernelDir()` 逐字返回自身目录 ⇒ 两处都不存在 ⇒
   `preferredAnchorKernel()` 返回 null ⇒ `spawnAnchor` 返回 `{pid:null, error:"driver-anchor module
   not found next to driver-runtime"}` ⇒ 每个 kind 的 `driver start` **rc=1**。
4. `verify-deliver-coldstart.sh:1804-1812`：两个 kind 的 rc 都必须为 0 才置
   `AC239_DRIVERS_STARTED=1` ⇒ 本次为 **0** ⇒ 轮询窗收窄到 120s ⇒ 不写 AC-239 记录。

**时间线自证（⛔ 不是「一个能解释现象的说法」——阶段 C 的落地时刻早于最后一次成功）**

```
3f2384de0 2026-09-13 20:19:33 +0000  AC-255 / SPEC §7 阶段 C：一个 anchor 进程承载六个 kind
载体里 GOAL-009-AC-239 的【最后一次成功记录】 = 2026-09-13T17:11:09Z
⇒ 最后一次成功比阶段 C 落地早 3 小时 8 分；此后升级面再无一条 AC-239 记录（载体实测，见 AC1 表）
```

⇒ **`--ac239-e2e` 那个 e2e 自阶段 C 起就再也没有成功过**：不是「跑得慢」，是交付物**起不了 anchor**
⇒ 任何第三方安装（含升级面测的那个项目）都**不再能被驱动**。这正是任务文本 step 9 逐字列举的
「**目标项目不再能被驱动**」。

**与「已修复」的区分（负控制）**：把 `dist/driver-anchor.js` 的存在性作为唯一变量 —— 主检出形态
（本仓自己跑）**有** `plugin/scripts/driver-anchor.ts`，故主检出的 driver 起得来（本仓的 loop 一直在跑）；
安装形态**没有**，故起不来。⇒ 是**打包闭包**漏了 anchor（`package.sh` 的 dist-closure 闸只校
「被引用的 bundle 都在」，而 anchor 的名字是 `path.join(here,"driver-anchor.ts")` **动态拼**的，
静态引用扫描看不见它 —— 与该文件自己注释里写的「显式枚举可能静默漏掉一处引用」同形）。

**⇒ 依任务 step 9：⛔ 不手写记录、⛔ 不搬旧记录、⛔ 不改 K、⛔ 不自行 `superseded` 该 AC；
贴 fail-closed 原文 + 可区分的 NOT-EVALUATED，把任务升为 `needs-human`。**

**⚠️ 本任务【不做】的事（⛔ 明确划界）**：修 `driver-anchor` 的打包闭包是**另一个机制**（落点
`packages/quay/scripts/package.sh` 的 dist 闭包推导，不在本任务 `## Touches` 内，且与「刷新动作的
触发器」是两件事）。本任务只负责**把它作为阻断原因逐字留痕**并升级。

**这也不削弱本任务的后半**：刷新动作的机械化（AC7/AC8）**与前半独立可验**（任务文本逐字），且它
正是「缺口不再第 5 次出现」的那一半 —— 因为前四次转红的关闭动作都依赖升级面重跑，而升级面此刻
结构性不可达，**没有触发器的话这个缺口会无限期地红下去**。

### AC7 —— 刷新动作机械化之一（主体↔产出者映射 + 完备性判定）

**产物（均为版本控制文件）**

| 落点 | 作用 |
|---|---|
| `plugin/freshness-producers.json` (new) | **单源**：`subject → producer 命令` 映射 + 主体范围规则（`subject_id_pattern` / `subject_requires_build_sha`）+ 每个产出者的实测墙钟 |
| `plugin/scripts/freshness-producer-coverage-check.ts` (new) | 完备性判定（四条枚举式 finding，⛔ 不是一个布尔） |
| `plugin/test/freshness-producer-coverage-check.test.mjs` (new) | 10 条测试：双向负控制 + 三态 + **生产载体真读数** |
| `plugin/scripts/checker-mutation-cases/freshness-producer-coverage-check.sh` (new) | mutation case（8 阶段，每段 RED 后跟 RESTORE） |

**判定的四条方向（每条都能取假；⛔ 不共用输出）**

```
observed   = 载体里 ac 匹配 subject_id_pattern ∧ 顶层 build_sha 为 40-hex 的主体集合
registered = ⋃ producers[].subjects
margin     = .quay/goal-freshness-margin.json 的 subjects 键（criterion 自己写出的快照）

A. unregistered        = observed ∖ registered   → RED   ← AC 原话「载体里出现过、却没登记产出者」
B. no_carrier_evidence = registered ∖ observed   → RED   ← 登记了却从没产出过
C. margin_unregistered = margin ∖ registered     → RED   ← 09-13 的形态：criterion 在追、无人产
D. margin_orphan       = registered ∖ margin     → RED   ← 登记了 criterion 不追的主体
```

C 是载体侧（A）**结构上看不见**的那一半：一个新增主体若其产出者从未跑过，载体里根本没有记录。

**范围规则不是手写清单**：载体里有 25 种 `ac`（AC88 / AC107 / GOAL-015-AC-234 / GOAL-016-* /
GOAL-018-AC-257…），把全部当「主体」是假红。规则**声明一次**在映射里、机械套用：`ac` 匹配
`^GOAL-009-AC-\d+$` **且** 顶层有 40-hex `build_sha`。2026-09-14 实测该规则恰好得到 7 个主体
（`GOAL-009-AC-204/206` 匹配前缀但无 `build_sha`；`GOAL-018-AC-257` 有 `build_sha` 但不是该 goal）。

**负控制双向（夹具，逐字贴读数）**

```
$ for phase: node plugin/scripts/freshness-producer-coverage-check.ts --root <fixture>
baseline（映射完备 + 载体齐全）                                  → exit 0
inject: 载体加一条未登记主体 GOAL-009-AC-999                     → exit 1，逐条指名
  - GOAL-009-AC-999 [unregistered]: appears in the carrier with a build_sha, but no producer in the mapping declares it
restore                                                          → exit 0
inject: 映射去掉一个 criterion 仍在追的主体（09-13 形态）         → exit 1
  - GOAL-009-AC-203 [margin_unregistered]: the AC-214 criterion tracks this subject, but no producer in the mapping declares it
restore                                                          → exit 0
inject: 登记一个从未产出过的主体                                  → exit 1
  - GOAL-009-AC-232 [no_carrier_evidence]: registered to a producer, but the carrier holds no scoped record for it
restore                                                          → exit 0
inject: 映射损坏                                                  → exit 2（fail-closed，⛔ 不是 exit 0）
restore                                                          → exit 0
```

整条链由 **mutation case** 复核（`plugin/scripts/checker-mutation-cases/freshness-producer-coverage-check.sh`，
8 阶段，每段 RED 后跟 RESTORE）：

```
$ bash plugin/scripts/checker-mutation-check.sh --check --only freshness-producer-coverage-check --repo-root <wt>
MUTATION freshness-producer-coverage-check: pass
checkers_total: 78 · checkers_with_mutation: 78 · mutations_that_stayed_green: 0 · errors: 0
RESULT: PASS
```

**生产载体真读数（硬规则 4 推论三：只有夹具能满足的判据不是测量）**

```
$ node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts \
    --root /home/yale/work/quay --mapping <wt>/plugin/freshness-producers.json --json
{"evaluated": true, "ok": true,
 "observedSubjects": ["GOAL-009-AC-201","...203","...205","...207","...232","...238","...239"],
 "registeredSubjects": [同上 7 条],
 "marginSubjects": [同上 7 条],
 "findings": [], "reason": "consistent — 7 observed subject(s), 7 registered, margin snapshot 7 subject(s)"}
EXIT=0
```

⇒ 三侧（载体观测 / 映射登记 / criterion 快照）**逐字相等**，findings 空。

**新增 `plugin/scripts/*.ts` 的全部义务落实读数**

```
① capability-catalog.sh 六行（QUESTION / CADENCE=每轮 / INVALIDATION / LAST_REAFFIRMED=2026-09-14 /
   MATCHING=enumerative / CONSUMER）
   $ bash plugin/scripts/capability-catalog.sh --summary
   capability-catalog: 327 scripts | 327 declared | 0 unclassified | 322 ship        (exit 0)
   该脚本自己的 --json 行为：{"file":"freshness-producer-coverage-check.ts","question":"…","ships":true,
   "cadence":"每轮","invalidation":"失效前提：…","last_reaffirmed":"2026-09-14",
   "matching":"enumerative","consumer":"谁按：scripts/test.sh 的 run_static_checks 每轮按…"}
② runner-static-gate.ts 登记：run_static_checks 内新增 run_checker "freshness-producer-coverage-check"
   + @static-tier change / @static-object 三行
③ @checker-count 59 → 60，由真检查器复核：
   $ node --experimental-strip-types plugin/scripts/checker-count-drift-check.ts --root <wt>
   [ok] runner-static-gate.ts:run_static_checks — declared 60, measured 60
   [ok] runner-static-gate.ts:run_operational_checks — declared 11, measured 11
   [ok] scripts/test.sh:run_doc_checks — declared 8, measured 8
   PASS — every declared registry count matches its function body (3/3 evaluated)
④ mutation case（见上）
⑤ capability-catalog.sh --entry-surface（AC3 delivery-form 闸）：PASS
⑥ instrument-failure-check --gate：5/5 families ok，no shrink-only violation
⑦ 新增 test 的 /tmp 卫生：tmp-leak-pairing-check 首轮报 mkdtemp-no-cleanup（本任务新增的 test 真泄漏）
   ⇒ 按 after() carrier 修好，复跑 PASS（656 file(s), 0 unpaired）；test-isolation-check 同源红亦消除
   （22 violation(s) 全部 baselined，未新增）
```

**`mirror-pair-drift-check.ts` 读数**

```
$ node --experimental-strip-types plugin/scripts/mirror-pair-drift-check.ts --root <wt>
mirror-pair-drift-check: PASS — every mirror pair matches or is allow-listed with an unchanged signature.
EXIT=0
```

**⚠️ Touches 更正（本任务列出的 `packages/quay/plugin/` 落点与真机制不一致 —— 已在 body 更正并补记）**

`packages/quay/plugin/` 是 **gitignored 的 pack-time 快照**（`.gitignore:26`，0 个 tracked 文件），由
`packages/quay/scripts/package.sh` 在打包时 `cp -R plugin/ → packages/quay/plugin/` 生成。跑真机制后实测：

| 本任务 Touches 原列 | 真机制产出？ | 实测 |
|---|---|---|
| `packages/quay/plugin/freshness-producers.json` | ✅ 是 | 3723 B，2026-09-14 18:06 生成 |
| `packages/quay/plugin/probes/freshness-refresh.md` | ✅ 是 | 7096 B，同日生成 |
| `packages/quay/plugin/test/…test.mjs` | ❌ 否（**设计如此**） | `package.sh` 显式 `rm -rf ${PLUGIN_DEST}/test` —— quay 自己的测试不进交付物（人 2026-08-06 裁定） |
| `packages/quay/plugin/scripts/freshness-producer-coverage-check.ts` | ❌ 否（**设计如此**） | `package.sh:169` `find … -name '*.ts' ! -name 'runner-static-gate.ts' -delete` —— 原始 `.ts` 一律删除，只留 bundle 后的 `dist/*.js` |

**这不是本任务引入的缺口，是同形兄弟的既有形态**：同批登记的静态检查器
`worktree-namespace-literal-check.ts` / `gitignore-runtime-coverage-check.ts` 在 staging 后同样
既不在 `packages/quay/plugin/scripts/` 也不在 `scripts/dist/`（实测：staged `scripts/` 下只剩
`runner-static-gate.ts` 一个 `.ts`，`dist/` 86 个 bundle 中无这两者）。静态检查器是**本仓自己的
harness**（`scripts/test.sh` 的 registry），不是交付给第三方的运行时件 ⇒ 交付物里没有它的 shipped 形态。

**补进 Touches 的真落点**：`plugin/scripts/checker-mutation-cases/freshness-producer-coverage-check.sh`
（本任务新增，原 Touches 未列）+ 其镜像 `packages/quay/plugin/scripts/checker-mutation-cases/freshness-producer-coverage-check.sh`
（实测已由 staging 生成，7943 B）。**原始 Touches 的四条 `packages/quay/plugin/…` 条目按实测更正**：
保留两个真产出者，把 test/ 与脚本 .ts 两条改为与其兄弟一致的说明（见文末 Touches）。

### AC8 —— 刷新动作机械化之二（routine 接线）

**`loop.routines` 新条目（逐字）**

```yaml
    - name: freshness-refresh
      trigger: interval:120m
      probe: freshness-refresh
```

**trigger 文法出处**：`plugin/scripts/routine-scheduler.ts:44` ——
`m = t.match(/^interval:\s*(\d+)\s*m$/)`（该文件自述「唯一文法实现」，`parseTrigger` 是唯一实现）。
两层模式下 `every(N)` 依赖已随 ADR-022 退役的迭代计数器 ⇒ 时间量是 `interval:<N>m`（同
`semantic-dedup-scan` 的先例）。

**真 loader 载入新规格（四键齐全）**

```
$ node --experimental-strip-types -e 'import {readProbeSpec} from "./plugin/scripts/read-probe-spec.ts"; \
    console.log(readProbeSpec("freshness-refresh", process.cwd()+"/plugin"))'
instrument: "none"
fallback: "none"
output_routing: {"default":"milestone-candidate","stale-subject":"milestone-candidate","missing-producer":"milestone-candidate"}
objective length: 6855 chars, first line: "You are a fresh-context FRESHNESS-REFRESH analyst for a quay workspace."
```

**路由词表对着消费方核实（⛔ 不臆造）**：消费方 = `plugin/skills/routines/SKILL.md` Phase 3
（`output_routing[type]` 被当作**标签**贴到 file 出的候选任务上，缺省 `"milestone-candidate"`）。
`milestone-candidate` 是任务库里在用的真实标签（`grep -l milestone-candidate tasks/*.md | wc -l` = 578），
不是自造词。

**routine 被真调度器接上（双向）**

```
$ node --experimental-strip-types plugin/scripts/routine-scheduler.ts /tmp/routines.json --plugin-root <wt>/plugin
DUE: semantic-dedup-scan (interval:1440m) → probe semantic-dedup-scan
DUE: freshness-refresh (interval:120m) → probe freshness-refresh            ← 从未跑过 ⇒ due
（--last-run 记为刚刚）
no routines due                                                              exit 3
（--last-run 记为 121 分钟前）
DUE: freshness-refresh (interval:120m) → probe freshness-refresh             exit 0  ← 窗口到 ⇒ 再 due
```

**阈值是 K 与【已测量量】的函数（⛔ 无与 K 无关的独立魔数）**

```
THRESHOLD_fraction(p) = (W_p + I) × R / K

  W_p = 产出者墙钟（小时）        ← plugin/freshness-producers.json 的 producers[].wallclock_hours
  I   = 本 routine 的观测间隔（小时）= N/60，N 取自 trigger 的 interval:<N>m
  R   = 实测交付面前进速率（提交/小时）
  K   = 新鲜度窗口（提交）         ← 读 .quay/goal-freshness-margin.json 的 .k（⛔ 不在规格里写死）
```

`I` 与 `K` 都不是新魔数：`I` 由 routine 自己的 trigger 决定，`K` 由 criterion 自己写出的快照读出。
**代入过程**（本机实测，2026-09-14）：

```
R（实测，本机一条命令可复现）:
  delivery-face 路径集 = packages/quay/package.json 的 files（机械推导）+ plugin + packages/quay-native/src
  $ git rev-list --count --since="7 days ago" develop -- <paths>   →  1034
  均值 = 1034 / 168h ≈ 6.15/h
  最大 4h 桶 = 72  ⇒ 18.0/h（取此，⛔ 不用均值：失败形态是突发，低估速率会 file 得太晚）
  单小时峰值 = 25/h（瞬态；作为敏感性读数留档，不参与算式）
K = 200（criterion 正文的未测量初始值；⚠️ 重估点 2026-10-09，本任务 ⛔ 不动）
I = 120m = 2h（依据：观测间隔不必短于最慢产出者的墙钟 —— 更快发现一个主体不会让产出器更快跑完
              ⇒ I ≤ max_p W_p = 2h）

升级面    W=2.0  → (2.0 + 2.0) × 18 / 200 = 0.360   ⇒ margin/K ≤ 0.360（≈72 提交余量）时 file
冷启动面  W=0.34 → (0.34 + 2.0) × 18 / 200 = 0.211  ⇒ margin/K ≤ 0.211（≈42 提交余量）时 file
设计下界（AC 原文的 I=0 情形）W×R/K = 0.180 / 0.031 —— 两值均 ≥ 下界 ✔
```

⚠️ **W 的实测状态（honest caveat，逐字写在映射文件的 `_wallclock_measured` 里）**：升级面的**完整
端到端墙钟本次量不到**（AC-239 半边结构性不可达）。2h 由三个来源**限定**：① AC 正文自己的算例
「升级面约 2h」；② 任务正文实测记录的「冷启动面 20m36s / 升级面跨机小时级」；③ 产出者对自己施加的
**机械上界** `AC239_POLL_SECS=3600s`（超时即不写记录）。误差方向已知：`W` 只**增大**阈值 ⇒ 高估会
提前 file（安全、略吵），低估会 file 太晚（丢窗口）⇒ **缺陷修好后必须重量**。

**⛔ 探针只 file 不 execute**：规格正文以独立段落写明「FILE ONLY. DO NOT EXECUTE ANY PRODUCER」，
理由（跨机、小时级、碰别人的机器 + routine 的 FILE-ONLY 边界 + `probe-write-guard` 会拒改动 tracked
文件的运行）与「重跑的决定仍归人/派发链」逐字写在 objective 里。

**镜像**：`packages/quay/plugin/probes/freshness-refresh.md` 实测存在（7096 B，由真 staging 生成）；
`mirror-pair-drift-check.ts` PASS（读数见 AC7）。

### AC4 / AC5 / AC6 的读数（⛔ 逐条贴出，但不勾 —— 见上「只关了一半」）

**AC4（判据真转绿）—— 未达成**：criterion **exit 1**（唯一陈旧项 = AC-239）。逐字：

```
freshness GOAL-009-AC-201: 0/200 (margin 200)        ← 本次刷新：从 68 → 0
freshness GOAL-009-AC-232: 68/200 (margin 132)
freshness GOAL-009-AC-205: 68/200 (margin 132)
freshness GOAL-009-AC-207: 68/200 (margin 132)
freshness GOAL-009-AC-203: 68/200 (margin 132)
freshness GOAL-009-AC-238: 0/200 (margin 200)        ← 本次刷新：从 -13 回到 +200
freshness GOAL-009-AC-239: 214/200 (margin -14)      ← 仍陈旧（结构性不可达）
stderr: stale evidence: GOAL-009-AC-239:214/200 (margin -14)
EXIT=1
```

```
$ node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-214 --root .
verdict: fail   reason: acceptance failed (exit 1) — stale evidence: GOAL-009-AC-239:214/200 (margin -14)
GATE_EXIT=1
```

（七项里 **6 项 margin > 0**；AC-214 要的是**全部**七项 ⇒ 不达成。）

**AC5（负控制）**：三条里 ②③ 本次实测成立，① 成立但不足以让 AC 成立（AC 的前提是「判据真转绿」）：

```
① QUAY_GOAL009_FRESHNESS_K=1 重跑 criterion ⇒ EXIT=1，stderr 逐条指名：
   stale evidence: GOAL-009-AC-232:68/1 (margin -67), GOAL-009-AC-205:68/1 (margin -67),
   GOAL-009-AC-207:68/1 (margin -67), GOAL-009-AC-203:68/1 (margin -67), GOAL-009-AC-239:214/1 (margin -213)
   ⇒ 判据仍能取假 ✔（且 AC-238 在 K=1 下变成 margin 1 ⇒ 恰好边界，证明读数跟随 K）
② git diff --exit-code -- goals/  ⇒ exit 0（判据文本逐字节未变）✔
③ 只跑 criterion 前后 md5sum .quay/productization-verification.jsonl：
   12ae3f60eadfe1ce5c5dd4bdafd49ef9  (前)
   12ae3f60eadfe1ce5c5dd4bdafd49ef9  (后)   ⇒ 判据本体只读 ✔
```

**AC6（落点正确 / 防空转）**：

```
主检出载体：/home/yale/work/quay/.quay/productization-verification.jsonl  （176 行）
  本次新增的 AC-238 记录在其内（ts 2026-09-14T18:15:39Z，build_sha fb0301b8…，project_root
  /home/yale/quay-verify-upgrade-fb0301b8-root）
  build_sha 到 develop 的交付面距离 = 0 个提交（K=200）
worktree 载体：.../gap-ac214-…/.quay/productization-verification.jsonl  （86143 B，mtime 18:04）
  其中 ts > 本次运行开始时刻的 AC-238/AC-239 记录数 = 0          ← ⛔ 没有本次新增，--root 传对了
```

⚠️ **AC6 不勾**的理由：它的对象是「**记录**」（AC3 要求的 AC-238 **与** AC-239 两条），而本次只落地了
AC-238 一条。上面两条读数作为「`--root` 没传错、判据读得到」的正证据保留。

### 附录：run5 逐字日志（`.quay/ac214-run5-producer.log`，含 PRODUCER_EXIT）

```
=== RUN START 2026-09-14T18:14:29Z ===
develop-deliver: develop tip = fb0301b8ecc4 (fb0301b8ecc4c033d26473e85233ff732de044e7)
develop-deliver: creating detached worktree at develop tip: /home/yale/work/quay/.quay/deliver-worktree-fb0301b8ecc4
develop-deliver: package.sh (quay .tgz)...
  → /home/yale/work/quay/.quay/deliver-worktree-fb0301b8ecc4/packages/quay/quay-0.7.0.tgz
  → /home/yale/work/quay/.quay/deliver-worktree-fb0301b8ecc4/packages/quay-native/quay-native-0.7.0.tgz
develop-deliver: --verify-upgrade develop=fb0301b8ecc4 build_date=2026-09-14T18:09:54+00:00 source=$HOME/work/meta-cc-aged-ac238-copy
develop-deliver: B (orangevps.wan.hwang.men) — scp verify-deliver-coldstart.sh + its FULL closure ($SCRIPT_DIR siblings + node_modules deps) + both .tgz
develop-deliver: B (orangevps.wan.hwang.men) remote stdout persisted → /home/yale/work/quay/.quay/verify-upgrade-remote-B-fb0301b8.log (rc=0)
EVIDENCE-TRANSPORT appended=3 carrier=/home/yale/work/quay/.quay/productization-verification.jsonl evidence=/home/yale/work/quay/.quay/verify-upgrade-evidence-B-fb0301b8.jsonl
develop-deliver: evidence-completeness PARTIAL present=1 missing=1 list=GOAL-009-AC-239
develop-deliver: B (orangevps.wan.hwang.men) — NOT-EVALUATED (declared ac set [GOAL-009-AC-238 GOAL-009-AC-239] not fully present in transported evidence)
PRODUCER_EXIT=2
=== RUN END 2026-09-14T18:18:58Z ===
```

### 附录：run4 诊断（被判为结构性不可达后终止的那一次，`.quay/ac214-run4-diagnosis.txt`）

```
=== run4 stopped early: diagnosed as structurally unable to reach AC-239 ===
ts=2026-09-14T18:13:44Z

LOCAL LOG SO FAR:
=== RUN START 2026-09-14T18:01:54Z ===
develop-deliver: develop tip = e9084844123f (e9084844123ff0c43b742ffd18778a6e6058aa43)
develop-deliver: --verify-upgrade develop=e9084844123f build_date=2026-09-14T17:52:12+00:00 source=$HOME/work/meta-cc-aged-ac238-copy
develop-deliver: B (orangevps.wan.hwang.men) — scp verify-deliver-coldstart.sh + its FULL closure + both .tgz

REMOTE EVIDENCE (copy root state):
copied pid files (ALL from meta-cc, not the copy):
  promotion-driver.pid = 274967  alive=no
  worker-driver.pid = 275059  alive=yes
  promotion-driver-supervisor.pid = 274958  alive=no
  worker-driver-supervisor.pid = 275038  alive=yes
meta-cc live driver processes:
7
no anchor-desired.json: ABSENT
AC-239 task status: status: todo
AC-239 gate events: 0
```

### 附录：aged source 的重建（⛔ 逐字披露，不给「它一直就在那儿」的错觉）

`--upgrade-source` 需要「带旧 vendored `.quay/runtime/bin` 的老旧真实第三方项目」。原指定源
`~/work/meta-cc` **在 2026-09-14T15:06Z 被一次裸 `quay-init` 就地升级**，其旧 runtime 被 qinit
**退休**进 `.quay/quay-init-backups/1789398411/runtime`；穷举搜索（maxdepth 8、B 与 C 两台、
排除 node_modules/.git）确认**两台机器上已没有任何真实第三方项目还带该旧布局**（只剩
`quay-verify-*` 这类验证产物）。

故本次在远端**重建**了一个源副本 `~/work/meta-cc-aged-ac238-copy`：
1. `cp -a ~/work/meta-cc <copy>`（meta-cc 本体**只读**，实测其 `.quay/runtime` 仍不存在、无写入）；
2. 删掉 `<copy>/.quay/quay-init-backups`（那是 15:06 那次升级**造出来**的，升级前没有）；
3. `cp -a ~/work/meta-cc/.quay/quay-init-backups/1789398411/runtime <copy>/.quay/runtime`
   ⇒ sha256 与 meta-cc 自己的备份**逐字节相同**（`b2d6737c…` / `5742fa27…`），mtime 保留（Aug 20 ⇒
   `runtime_age_days=24.802`）；
4. 另剔除 `<copy>/.quay/*-driver{,-supervisor,-inflight}.pid` / `*-driver-control-plane.json` / `*-driver*.log`
   —— 那是 **meta-cc 的活进程握手**（见「第 1 层因」）。
全过程写进远端 `<copy>/AGED-SOURCE-PROVENANCE.txt`（可审计）。**项目数据无一处合成**：103 条真实
任务、真实 `config.yml`、真实 git 历史都是 meta-cc 自己的；**只有 runtime 是从它自己的备份恢复的**；
升级与 AC-239 e2e 仍在 host B 上真跑。

### 机械确认：本任务的 AC 状态在闸上也是「未达成」，⛔ 不是「待外部」

```
$ node --experimental-strip-types -e 'const g = await import("./plugin/scripts/fan-in-ac-completion-gate.ts"); ...'
flipAcGateVerdict: {"ok":false,"status":"fail","total":8,"checked":3,"unchecked":5,
                    "message":"AC 未全勾（checked 3/8，剩余未勾 5 含非待外部项）——未翻 done"}
```

⇒ **本任务不会被翻 `done`**，这是正确的：5 条未勾项**不是**「外层验证/待外部」那一族（那是给
「落地那一刻结构上取不到输入」的 AC 用的），而是**被一个不在本任务 `## Touches` 内的缺陷挡住**。
⛔ 我**没有**给它们加 `（待外部）` 之类的标注去让它们蹭过闸 —— 那会把一个真实的缺口伪装成「等外部」，
正是硬规则 3b 与任务 DoD「⛔ 不接受的替代物」要挡的形态。⇒ 按 step 9 升 `needs-human`。

### 给处置者的一句话

**前半**：`--verify-upgrade` 的 AC-238 半边已真刷新（d 从 213 → 0，margin 200），AC-239 半边卡在
**交付物缺 `dist/driver-anchor.js`** ⇒ `quay driver start` 在任何安装形态下 rc=1 ⇒ 升级后的第三方
项目**起不了自己的 driver**（这是「目标项目不再能被驱动」，⛔ 不是本任务能修的范围；修法在
`packages/quay/scripts/package.sh` 的 dist 闭包推导，需另立任务）。
**后半**：AC7/AC8 已完成且独立可验（分支 `task/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger`
上 3 个提交，scoped 门绿，scoped-gate cache 已按 `develop-sha ce53bde1` 写入）—— 人裁定后可单独落地。
## Needs-Human

**执行 2026-09-14T23:46:24.907Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：human-adjudication
- 失败步/判词：step=suite: __PERFILE__ duration_ms=23735 /home/yale/work/quay-worktrees/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger/packages/quay/test/serve-ac95-views.test.mjs passed=false end_ms=1789429481825 cpu_ms=15770.405 mem_peak_kb=117052
- run_id：wk-prod-1789367589
- session_id：b3aa85ed-d236-4d25-8008-2426604f87a7
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger~wk-prod-1789367589~1789429014738-11ebfb.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger-wk-prod-1789367589.log

## Resolution note (追加, 由另一会话诊断, 2026-09-14T23:5xZ)

上面这条 needs-human 的成因描述也有误：不是「归因不出任何失败测试文件」，套件日志里明确指名 `packages/quay/test/serve-ac95-views.test.mjs`（`# tests 8198 / # fail 1`），失败签名是典型的瞬时端口撞车（`EADDRINUSE 127.0.0.1:33205`，已知 flake 类，见 `cli-test-serve-eaddrinuse-tailscaled-port-collision` 同族记录），与本任务自己的改动（`plugin/freshness-producers.json` / `plugin/probes/freshness-refresh.md` / `freshness-producer-coverage-check.ts` 等）完全无关（该测试测的是 `/manager` HTTP 端点）。

⚠️ **这与本任务早先记录的、仍然真实有效的 driver-anchor 打包闭包结构性阻断是两回事**——那个仍未修（另立的 `gap-dist-closure-missing-driver-anchor-js` 还在排队），下一次派发大概率会重新撞见那堵墙并再次正确地升 needs-human，那不是本次退回要处理的对象；本次只是纠正「套件红不可归因」这个具体误判（实为无关瞬时 flake），让任务能正常重跑一次而不是卡在一个错误的成因描述上。
