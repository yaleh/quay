---
id: gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger
title: AC-214 第四次转红（升级面 AC-238/239 202/200，margin −2；同一对主体 24h 内第二次）：关闭动作 =
  重跑升级面产出者；并把「刷新动作」机械化——主体↔产出者映射的完备性判定 + 由 margin 载体派生的 routine 触发
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

- [ ] AC1 改前读数（能取假）：本仓库根逐字跑 AC-214 criterion ⇒ **exit 1**，stderr 逐字含 `stale evidence: GOAL-009-AC-238:…` 与 `GOAL-009-AC-239:…`；贴 `.quay/goal-freshness-margin.json` 全文、`.quay/gate-events.jsonl` 中 AC-214 的最后一次 pass 与第一次 fail 两个时刻、以及载体里 AC-238/AC-239 **全部**记录的 `ts`/`build_sha`（证明最新一条停在 2026-09-13T17:11:09Z / `32ff4f3a…`）。⛔ 引述本节不算，须实现者复跑。
- [ ] AC2 产出运行的真读数（⛔ 不是 `--selfcheck`、⛔ 不是夹具、⛔ 不是 `--check`）：贴 `develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc --ac239-e2e --hosts B --force --root /home/yale/work/quay` 的**退出码** + 全部 `develop-deliver:` 行 + 本次实测墙钟 + 前置核的 `df -h`/`ssh` 读数；并贴 `.quay/verify-upgrade-remote-B-<tip8>.log` 的 ⑦/⑦b 两段（`ac238 record written` 与 `ac239 record written … ✓`），或失败时的 fail-closed 原文 + `UPGRADE_PAIR_MISSING` 行。
- [ ] AC3 生产载体上的新读数（硬规则 4 推论三：判据必须读**生产载体**、且只计**运行之后**的时间窗）：**主检出** `/home/yale/work/quay/.quay/productization-verification.jsonl` 中新增 ≥1 条 `ac="GOAL-009-AC-238"` **且** ≥1 条 `ac="GOAL-009-AC-239"` 记录，两者 `ts` 均晚于本次运行开始时刻、`build_sha` 为 40-hex，**且两条 `project_root` 逐字相同**；各贴全文 + `git rev-list --count <该 build_sha>..develop -- <交付面 paths>` ≤ 200 的读数（paths 由 `packages/quay/package.json` 的 `files` 机械推导，⛔ 不手写）。⛔ 手写记录 / 搬运旧记录 / `--selfcheck` 注入的记录一律不算。
- [ ] AC4 判据真转绿：AC-214 criterion 干跑 **exit 0**，贴七行 freshness（每条 `margin > 0`）与 `.quay/goal-freshness-margin.json` 全文（`subjects` 七项 margin 全正）；`goal-store gate AC-214 --root .` ⇒ exit 0。⛔ 通过放宽 criterion 达成不算。
- [ ] AC5 负控制（判据仍能取假，且转绿不来自放宽）：① `QUAY_GOAL009_FRESHNESS_K=1` 下 AC-214 criterion ⇒ **exit 1** 且 stderr 逐条指名陈旧主体；② `git diff --exit-code -- goals/` 为空（判据文本逐字节未变）；③ **只跑 criterion** 的前后 `md5sum .quay/productization-verification.jsonl` **相同**（证明判据本体只读；⛔ 与步骤 3 的写入是两件事）。三条读数全部贴出。
- [ ] AC6 落点正确（⛔ 防空转）：贴出记录**在主检出**载体中的位置（绝对路径 + 载体行数）**且** worktree 的 `.quay/productization-verification.jsonl` 中**没有**本次新增（若 worktree 里也出现 ⇒ `--root` 传错、判据读不到 ⇒ 未达成，须说明并重跑）。
- [ ] AC7 刷新动作机械化之一：**版本控制**的主体↔产出者映射产物 `plugin/freshness-producers.json`（**单源**：判定与探针都读它）+ 判定 `plugin/scripts/freshness-producer-coverage-check.ts`（+ `plugin/test/freshness-producer-coverage-check.test.mjs`），后者对「载体里出现过、却未在映射里登记产出者的主体」**fail-closed 报出**。负控制**双向**贴出（夹具载体里加一条未登记主体 ⇒ 判定变红且逐条指名；去掉 ⇒ 变绿）；并贴该判定对**生产**载体 `.quay/productization-verification.jsonl` 的一次真实读数（硬规则 4 推论三：只由夹具满足的判据不算产出）。同时贴新增 `plugin/scripts/*.ts` 的全部义务落实读数（`capability-catalog.sh` 声明行 / `runner-static-gate` 登记 / mutation case / `@checker-count`）与 `mirror-pair-drift-check.ts` 的读数；⛔ 义务清单若与本任务列出的 Touches 不一致（少一处落点），须在 body 里补记并把该落点补进 `## Touches`。
- [ ] AC8 刷新动作机械化之二（routine 接线）：`.quay/config.yml` 的 `loop.routines` 中新增条目（贴该条目的逐字内容与其 trigger 文法的出处）；`plugin/probes/freshness-refresh.md` 经**真** `read-probe-spec.ts` 载入成功（贴返回值四键）；规格 objective 中触发阈值**显式写成 K 与已测量量的函数**并在 body 里给出该算式的代入过程（⛔ 不得出现与 K 无关的独立魔数）；镜像 `packages/quay/plugin/probes/freshness-refresh.md` 存在且 `mirror-pair-drift-check.ts` 通过。若该 routine 结构上无法被调度 ⇒ 贴 fail-closed 原文 + 可区分的 NOT-EVALUATED 并升 `needs-human`（⛔ 不得静默跳过、⛔ 不得用「观察项」代替）。

## Definition of Done

**前半（关闭当前缺口）**：主检出 `/home/yale/work/quay/.quay/productization-verification.jsonl` 中出现**本次真实跨机运行**产出的、`project_root` **逐字相同**的 `ac="GOAL-009-AC-238"` 与 `ac="GOAL-009-AC-239"` 记录（各自顶层 `build_sha` = 本次 develop tip、40-hex、到 develop 的交付面距离 ≤ K=200），且 **AC-214 判据本体干跑 exit 0**（七行 freshness 全部 `margin > 0`），并在 `QUAY_GOAL009_FRESHNESS_K=1` 的负控制下**仍能 exit 1**，同时 `goals/` 的 diff 为空。

**后半（让缺口不再第 5 次出现）**：刷新动作**已接上机械触发**——存在内容为「主体 → 产出者命令」的**版本控制**产物与一个**能取假**的完备性判定（负控制双向已贴），`.quay/config.yml` 的 `loop.routines` 中有对应周期条目，其探针规格能被**真** loader 载入，探针的触发阈值是 K 与**已测量**的前进速率/产出者墙钟的函数（代入过程已贴），且探针**只 file 不 execute**（⛔ 不自动跑跨机产出器）。

⛔ **不接受的替代物**：手写记录 / 从别处搬一条旧记录 / `--selfcheck` 或 `--check` 的输出；只把记录写进任务 worktree 的 `.quay/`（判据读的是主检出 ⇒ 空转，AC6 直接挡）；改 K / 删主体 / 改 `expect` 或 `criterion`；用 `--verify-coldstart --ac207-e2e` 冒充（那是**冷启动面**产出者，⛔ 不产出 AC-238/239——这正是**本条的成因**）；自行 `superseded` 该 AC 记录（需人裁定）；把后半降格成「观察项」了事（前三次都这么做过，这正是第 4 次转红的原因）。

## Touches

（新文件一律带 `(new)` 结构标签 —— `touches-parser.ts` 的 admission 约定：未被标 `(new)` 的 Touches 条目必须在盘上存在，否则该候选按 `majorityMissing` 判为不可派发。）

- `plugin/probes/freshness-refresh.md` (new)
- `packages/quay/plugin/probes/freshness-refresh.md` (new)
- `plugin/freshness-producers.json` (new)
- `packages/quay/plugin/freshness-producers.json` (new)
- `plugin/scripts/freshness-producer-coverage-check.ts` (new)
- `packages/quay/plugin/scripts/freshness-producer-coverage-check.ts` (new)
- `plugin/test/freshness-producer-coverage-check.test.mjs` (new)
- `packages/quay/plugin/test/freshness-producer-coverage-check.test.mjs` (new)
- `plugin/scripts/capability-catalog.sh`（新增脚本的 catalog 声明行落点）
- `plugin/scripts/runner-static-gate.ts`（新增脚本的静态闸登记落点）
- `.quay/config.yml`（gitignored：`loop.routines` 条目落点。声明它是为了表明产出位置，⛔ 不是可提交物）
- `.quay/productization-verification.jsonl`（gitignored：本 AC 的载体，本次运行 append 的 AC-238/239 记录。⚠️ `anti-drift-touches-check` 只比对**已跟踪**文件的 diff；该载体被 `.gitignore:330` 忽略 ⇒ 不进那个集合，声明它是为了表明产出落点，⛔ 不是可提交物）
- `tasks/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger.md`（自身文件：勾 AC + 贴实跑证据）
