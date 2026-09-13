---
id: gap-ac214-ac238-239-freshness-upgrade-producer-rerun
title: AC-214 第二次因【陈旧】转红：升级面证据 AC-238/239 停在 2026-09-11（206 > K=200）——同一天内第二次，因为
  09-13 那次刷新只重跑了冷启动面产出者（--ac207-e2e），而 AC-238/239 由【另一条】产出路径（--verify-upgrade
  --ac239-e2e）写出
status: done
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

**判据正本**：`goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md`（goal=GOAL-009，`long-term: true`，status=achieved）。exit 0 = AC-201/203/205/207/232/238/239 各自**最新**证据记录的 `build_sha` 到 develop-tip 的【交付面提交距离】均 ≤ K（默认 200，`QUAY_GOAL009_FRESHNESS_K` 可配），且机械推导出的载体型主体集合 SUBJ 中无 NEED 之外的成员；exit 1 = 任一条无证据或证据陈旧（stderr 逐条指名）；exit 3 = 载体缺失 / rev-list 读不出（NOT-EVALUATED，⛔ 不与合格同形）。

**本次转红（立案当轮实测 2026-09-13T16:5xZ，⛔ 非引述）**：在 `/home/yale/work/quay` 把 AC-214 的 `criterion` 逐字取出用 bash 跑 ⇒ **exit 1**，stdout 七行 + stderr 逐字：

```
stale evidence: GOAL-009-AC-238:206/200 (margin -6), GOAL-009-AC-239:206/200 (margin -6)
freshness GOAL-009-AC-201: 65/200 (margin 135)
freshness GOAL-009-AC-232: 65/200 (margin 135)
freshness GOAL-009-AC-205: 65/200 (margin 135)
freshness GOAL-009-AC-207: 65/200 (margin 135)
freshness GOAL-009-AC-203: 65/200 (margin 135)
freshness GOAL-009-AC-238: 206/200 (margin -6)
freshness GOAL-009-AC-239: 206/200 (margin -6)
EXIT=1
```

同一读数经 `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-214 --root .` 复核：exit 1，`reason` 逐字含上列 stderr。

**载体侧读数（同一时刻，直读 `.quay/productization-verification.jsonl` 取每个主体的最新记录）**：

| 主体 | 最新记录 `ts` | `build_sha` | 到 develop 的交付面提交数 |
|---|---|---|---|
| AC-201/203/205/207/232 | 2026-09-13T11:21:24Z | `60136b79785da73973618d3bcfec2c3f5fc32be0` | 65 |
| **AC-238** | **2026-09-11T16:03:59Z** | `3b0932db37179cffd77f65f3f3c1d42a15730963` | **206** |
| **AC-239** | **2026-09-11T16:03:44Z** | `3b0932db37179cffd77f65f3f3c1d42a15730963` | **206** |

**转红时刻（台账逐条，⛔ 不是「一直红」）**：`.quay/gate-events.jsonl` 中 AC-214 的**最后一次 pass = 2026-09-13T16:50:48.300Z**、**第一次 fail = 2026-09-13T16:54:06.892Z**（reason 逐字即上列 stderr）⇒ 这是一次**刚发生的回归**，不是恒红：develop 在 16:50–16:54 那个窗口里推进了 6 个交付面提交，把 AC-238/239 推过 K=200。

**为什么更早的修复没有兜住（⛔ 不是那几条被证否）**：

- 三条 done 且顶层 `goal_ac: AC-214` 的任务（`gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207`、`gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable`、`gap-outer-retirement-test-pins-a-file-that-is-no-longer-orphaned`）与 `gap-ac244-freshness-subject-set-mechanically-derived` 解决的是**可达性**：产出侧写出顶层 `build_sha`、主体集合改为机械推导、把 AC-232/238/239 接进 NEED。**它们的绿是真的。**
- 第四条 `gap-ac214-ac207-freshness-evidence-producer-run`（**done，本日 2026-09-13 11:41 立案 / 12:25 落地**）修的是**同一天里第一次陈旧**（AC-207 停在 2026-09-11，210/200）。它跑的产出者是**冷启动面**：`develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts B` ⇒ 该次运行写出的记录只覆盖**那条路径**的主体（AC-201/203/205/207/232，即今天 d=65 的那五个），**⛔ 不产出 AC-238/239**——后两者由**另一条产出路径**（升级面，见下）写出。
- ⇒ **本次的第一手成因：AC-214 的主体集合里有两个【不同】的产出者，而 09-13 那次刷新只重跑了其中一个。** 这正是硬规则 5b 的形态（把一条原则只落实到它被发现的那一处）：判据的**主体**是机械推导的（AC-244 做的），但**刷新动作**没有被同样地机械化 ⇒ 哪个主体被重跑，取决于哪条 AC 先转红。
- 时间线自证：09-13 11:21 冷启动面刷新 ⇒ AC-201/203/205/207/232 归零；同日 16:54 AC-238/239 越过 200 ⇒ 判据再次转红，而**这一批主体与上一批不相交**。

**AC-238/239 的产出者（本次要跑的那一条）**：两条记录都是 **2026-09-11T16:03** 由**同一次跨机运行**产出（同 `build_sha 3b0932db`、同 `project_root /home/yale/quay-verify-upgrade-3b0932db-root`、同 `host orangevps`），其驱动命令逐字为（`tasks/gap-aged-project-post-upgrade-driver-e2e.md:320` 与 `.quay/verify-upgrade-remote-B-3b0932db.log` 头部一致）：

```
bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc --ac239-e2e --hosts B --force
```

该脚本自带文档（`plugin/scripts/develop-deliver-tgz.sh:67-78`）：`--verify-upgrade` = 把 develop-tip 现 build 的两个 `.tgz` scp 到目标机，在那里对一份 **aged 真实第三方项目（远端 `$HOME/work/meta-cc`）的隔离副本**跑 `--upgrade-existing`，并**只**把 `ac=GOAL-009-AC-238` 的记录运输回本地载体；`--ac239-e2e` 额外在**已升级的那个 root 上**由该项目**自己的 drivers** 驱动一个新任务到 done 并写出 `ac=GOAL-009-AC-239` 记录，两条记录必须同 `project_root`（`check_upgrade_pairing`，不同源 ⇒ 退出码 2 = PARTIAL）。⇒ **这是唯一能产出这两条记录的动作**；重跑它就是本次的关闭动作。

**⚠️ 一个必须显式说明的落点问题（否则本任务会空转）**：载体 `.quay/productization-verification.jsonl` 是 **gitignored**（`.gitignore:330` 的 `**/.quay/productization-verification.jsonl`），**不会**随任务 worktree 的 `git merge develop` 回到主检出；而 goal-driver 跑 criterion 的地方是**主检出**（`dataRoot`），它读的就是主检出的那一份。产出者默认把 `repo_root` 从**自身脚本位置**推导 ⇒ 在任务 worktree 里直接跑，记录会落进 worktree 的 `.quay/`，判据**永远读不到**。⇒ 必须显式传 `--root /home/yale/work/quay`（09-13 那次成功的刷新就是这么做的——其证据包里运输行逐字为 `/home/yale/work/quay/.quay/productization-verification.jsonl`）。

**⚠️ 前置核（立案当轮实测，⛔ 不是假设）**：host B `orangevps` ssh 可达（`BatchMode=yes` 实测返回 `orangevps`）；远端 `$HOME/work/meta-cc` 存在；远端已有 7 个历史 `quay-verify-upgrade-*-root`（每个约 620–980MB）+ 7 个 `.npm`（约 93MB）；远端 `/` 为 **85G/96G 已用、余 11G**（本次运行新增约 750MB ⇒ 有余量但**不宽裕**，实现者跑前应取一次 `df -h` 读数，让 ENOSPC 类失败可归因）；本仓库 `.quay/profiles.yml` 存在（`--ac239-e2e` 要 scp 它到远端，目标项目才真起得起 worker）；远端 `$HOME/.local/bin` 有 `claude-*` 启动器与 `$HOME/go-sdk/bin/go`。

**为什么 ⛔ 不得用放宽判据来关闭它**：AC 正文自己把 K 定为**未测量的初始策略值**，并把重估点定在「跑满 30 个自然日后用真实分布重估 K 并贴回 AC 正文」（2026-09-09 + 30d = **2026-10-09**）；今天（09-13）改 K 或删主体**都没有数据支撑**，且上一轮任务的 DoD 已逐字禁止「通过放宽 criterion 达成」。⇒ 唯一的关闭路径是**在窗口内重跑产出者**。

**✅ 结构性建议（⛔ 本任务不自行裁定、⛔ 不作阻塞前置）**：AC-214 的设计就是**随 develop 前进自动转红**并需要「在 K 窗口内重跑一次证据产出验证」，而**刷新动作没有任何周期性触发器**（`.quay/config.yml` 的 `loop.routines` 只有 self-validation / architecture-analysis / history-mining / browser-explorer 四条）。⇒ 每个主体都会在窗口外老化，靠 goal-driver 的缺口立案一次次地补。**发生率（硬规则 12，已查历史、非等下一轮）= 2，且集中在同一天**：① 2026-09-13 上午冷启动面（AC-207 210/200）；② 2026-09-13 16:54 升级面（AC-238/239 206/200，本条）。两次的关闭动作都是「重跑产出者」。

⇒ 可行方向有两条，**都属人 / goal 层的裁定**：(a) 给刷新动作加周期触发器（routine / probe）；(b) 承认升级面产出者比冷启动面贵若干个量级（一次 = 跨机 build + scp + 装 + 在真第三方项目上起 driver 把任务驱动到 done，实测小时级），为不同主体类**分别定 K**。

⛔ **本条不在任务里自行选一条实现**：K 的重估点（2026-10-09）尚未到，而「多久重跑一次」「哪个主体类配哪个 K」这两个量的成本结构**尚未测量**（硬规则 4 推论：成本结构未知前不设数值阈值；硬规则 12：给不出发生率的前置/机制不得阻塞）。⇒ 如实记录发生率与两条方向，交由 2026-10-09 的复核点或人裁定。**本任务的 DoD ⛔ 不依赖它。**

<!-- dedup-ref -->
**关联但机制不同的既有任务（均 done，不构成重复、也不构成前置声明）**：`gap-ac214-ac207-freshness-evidence-producer-run`（**同一判据、同一种关闭动作，但主体集合不相交**——它刷冷启动面 AC-201/203/205/207/232，本条刷升级面 AC-238/239；两者**不能互相代替**，正如本次转红所证）；`gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207` / `gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable`（可达性：产出侧写顶层 `build_sha`）；`gap-ac244-freshness-subject-set-mechanically-derived`（主体集合机械推导并接线 AC-232/238/239）；`gap-aged-project-post-upgrade-driver-e2e`（第一次产出 AC-239 记录，落地 `--ac239-e2e` 这条产出路径）；`gap-aged-third-party-project-quay-upgrade-verification`（第一次产出 AC-238 记录）。**机制查重（⛔ 非关键词）**：本条的机制是「**升级面产出者未在 K 窗口内被重跑**」，不是关键词 `freshness`/`陈旧`/`证据`；`grep -l '^goal_ac: AC-214$' tasks/*.md` = 4 条全 `done`；`task_list` 实查 in-flight（todo 4 / ready 6）全部任务，**无一条**持 `goal_ac: AC-214`，`grep -l '^goal_ac: AC-239$'` 的 5 条亦全 `done` ⇒ 无重复立案。

## Plan

0. **查重（机制维度，⛔ 非关键词）**：`task_list` 列 todo/ready/needs-human；核 `goal_ac: AC-214` 的在飞者为 0；再核没有第二个任务持本任务 `## Touches` 的路径（特别是 `.quay/productization-verification.jsonl` 的写者）。
1. **改前读数（能取假，⛔ 引述不算，须复跑）**：在 `/home/yale/work/quay` 逐字跑 AC-214 的 criterion ⇒ 贴 **exit 1** + 八行输出（stderr 逐字含 `stale evidence: GOAL-009-AC-238:206/200 (margin -6), GOAL-009-AC-239:206/200 (margin -6)`）；并贴载体里 `ac="GOAL-009-AC-238"` / `ac="GOAL-009-AC-239"` **全部**记录的 `ts`/`build_sha`，证明最新一条停在 2026-09-11（`3b0932db…`）。取 criterion 的可靠方式（⛔ 不要用 YAML 解析器——该字段在盘上是 `>-` 折叠标量，折叠后 `if k == "id": …` 会与下一行粘成语法错）：
   `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts list --root . | python3 -c 'import json,sys;print([r for r in json.load(sys.stdin) if r["id"]=="AC-214"][0]["criterion"])' > /tmp/ac214-criterion.sh && bash /tmp/ac214-criterion.sh; echo "EXIT=$?"`
2. **产出者前置核（跑之前取，让失败可归因）**：`ssh -o BatchMode=yes -o ConnectTimeout=8 orangevps 'df -h $HOME | tail -1; ls -d $HOME/work/meta-cc; ls $HOME/.local/bin | head'`；本仓库 `.quay/profiles.yml` 存在性。贴全部输出。
3. **跑产出者**（唯一产出 AC-238/239 记录的动作）：`bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc --ac239-e2e --hosts B --force --root /home/yale/work/quay`。贴退出码 + **全部** `develop-deliver:` 行。**退出码 2（PARTIAL）不自动等于失败**：它表示「记录运输成功，但 AC-239 与 AC-238 不同 `project_root`」⇒ 必须先读出 `UPGRADE_PAIR_MISSING` 行再判（⛔ 不以退出码冒充成功，也不因它掩盖读数）。退出 1（FAILED）表示该主机**没产出 AC-238 记录** ⇒ 贴 fail-closed 原文。
4. **读本次运行自己的 stdout / 日志（⛔ 不采信「我跑过了」）**：读 `.quay/verify-upgrade-remote-B-<tip8>.log` 的 `⑦ upgrade-existing` 与 `⑦b post-upgrade continuation (AC-239)` 两段，逐字贴 `ac238 record written` 与 `ac239 record written … (same root as AC-238: …) ✓` 行，以及 `AC239_TASK_ID=` / `AC239_DRIVERS_STARTED=` 行。**若一行都没有** ⇒ 贴 fail-closed 原文并**就此停下**（硬规则 3b：缺值 ≠ 合格）。⭐ 该 log 与取回的 `.quay/verify-upgrade-evidence-B-<tip8>.jsonl` 都是**未跟踪**的运行时产物（不进 `git diff --name-only`），故 ⛔ 不在 `## Touches` 里声明（声明它们会被 `isOverbroadDeclaration` 判 overbroad ⇒ 反而 HARD FAIL）；它们只是读数来源。
5. **确认记录真的落到【主检出】的生产载体（按位置，⛔ 不是按自述）**：在 `/home/yale/work/quay/.quay/productization-verification.jsonl` 里取出 `ts` 晚于本次运行开始时刻的 `ac="GOAL-009-AC-238"` 与 `ac="GOAL-009-AC-239"` 记录，各贴**全文**，核两条 `project_root` **逐字相同**、`build_sha` 为 40-hex；并在 worktree 的 `.quay/productization-verification.jsonl` 上确认**没有**本次新增。
6. **判据转绿（干跑 criterion 本体，⛔ 不是「我看它绿了」）**：AC-214 criterion ⇒ 贴 **exit 0** + 七行 freshness（每条 `margin > 0`）+ `.quay/goal-freshness-margin.json` 全文；再跑 `goal-store gate AC-214 --root .` ⇒ exit 0。
7. **负控制（判据仍能取假，⛔ 双向）**：① `QUAY_GOAL009_FRESHNESS_K=1` 重跑 AC-214 criterion ⇒ **exit 1** 且 stderr **逐条指名**主体（预期至少含仍停在 65 的冷启动面五个）；② 判据文本**逐字节未变**：`git diff --exit-code -- goals/` 为空 ⇒ 转绿不可能来自放宽判据；③ 载体是**只读**读取的：`md5sum .quay/productization-verification.jsonl` 在负控制前后相同。三条全部贴出。
8. **零代码改动**：本任务不改产品代码、也不改判据 ⇒ `git diff --name-only <base>..HEAD -- plugin/ packages/ goals/` 为空；贴 scoped 门读数（`--for-task <本任务 id>`）与着地归属说明（全量套件归机械 fan-in 的一步，本 worker 不持该共享锁）。
9. **失败即停（⛔ 不得手写 / 搬运记录）**：若产出者结构性不可达（远端废弃 / 目标项目不再能被驱动 / 磁盘不足）⇒ 贴 fail-closed 原文 + 可区分的 NOT-EVALUATED，**⛔ 不得手写记录、⛔ 不得从别处搬一条旧记录、⛔ 不得改 K、⛔ 不得自行 `superseded` 该 AC**（`superseded` 需人裁定），把任务升为 `needs-human` 并留痕。

## Acceptance Criteria

- [x] AC1 改前读数（能取假）：本仓库根逐字跑 AC-214 criterion ⇒ **exit 1**，stderr 逐字含 `stale evidence: GOAL-009-AC-238:206/200 (margin -6), GOAL-009-AC-239:206/200 (margin -6)`；并贴载体里 AC-238/AC-239 **全部**记录的 `ts`/`build_sha`，证明最新一条停在 2026-09-11（`3b0932db…`）。⛔ 引述本节不算，须实现者复跑。
- [x] AC2 产出运行的真读数（⛔ 不是 `--selfcheck`、⛔ 不是夹具、⛔ 不是 `--check`）：贴 `develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc --ac239-e2e --hosts B --force --root /home/yale/work/quay` 的**退出码** + 全部 `develop-deliver:` 行 + 前置核的 `df -h` 读数；并贴 `.quay/verify-upgrade-remote-B-<tip8>.log` 的 ⑦/⑦b 两段（`ac238 record written` 与 `ac239 record written … ✓`，或失败时的 fail-closed 原文 + `UPGRADE_PAIR_MISSING` 行）。
- [x] AC3 生产载体上的新读数（硬规则 4 推论三：判据必须读**生产载体**、且只计**运行之后**的时间窗）：**主检出** `/home/yale/work/quay/.quay/productization-verification.jsonl` 中新增 ≥1 条 `ac="GOAL-009-AC-238"` **且** ≥1 条 `ac="GOAL-009-AC-239"` 记录，两者 `ts` 均晚于本次运行开始时刻、`build_sha` 为 40-hex，**且两条 `project_root` 逐字相同**；各贴全文 + `git rev-list --count <该 build_sha>..develop -- <交付面 paths>` ≤ 200 的读数（paths 由 `packages/quay/package.json` 的 `files` 机械推导，⛔ 不手写）。⛔ 手写记录 / 搬运旧记录 / `--selfcheck` 注入的记录一律不算。
- [x] AC4 判据真转绿：AC-214 criterion 干跑 **exit 0**，贴七行 freshness（每条 `margin > 0`）与 `.quay/goal-freshness-margin.json` 全文（`subjects` 七项 margin 全正）；`goal-store gate AC-214 --root .` ⇒ exit 0。⛔ 通过放宽 criterion 达成不算。
- [x] AC5 负控制（判据仍能取假，且转绿不来自放宽）：① `QUAY_GOAL009_FRESHNESS_K=1` 下 AC-214 criterion ⇒ **exit 1** 且 stderr 逐条指名陈旧主体；② `git diff --exit-code -- goals/` 为空（判据文本逐字节未变）；③ `md5sum .quay/productization-verification.jsonl` 在负控制前后相同（该命令只读）。三条读数全部贴出。
- [x] AC6 落点正确（⛔ 防空转）：贴出记录**在主检出**载体中的位置（绝对路径 + 载体行数）**且** worktree 的 `.quay/productization-verification.jsonl` 中**没有**本次新增（若 worktree 里也出现 ⇒ `--root` 传错、判据读不到 ⇒ 未达成，须说明并重跑）。
- [x] AC7 零代码改动（本任务不改产品代码、也不改判据 ⇒ 着地路径最轻）：`git diff --name-only <base>..HEAD -- plugin/ packages/ goals/` 为空；贴 scoped 门读数（`--for-task <本任务 id>`）与着地归属说明（全量套件归机械 fan-in 的一步，本 worker 不持该共享锁）。

## Definition of Done

主检出 `/home/yale/work/quay/.quay/productization-verification.jsonl` 中出现**本次真实跨机运行**产出的、`project_root` **逐字相同**的 `ac="GOAL-009-AC-238"` 与 `ac="GOAL-009-AC-239"` 记录（各自顶层 `build_sha` = 本次 develop tip、40-hex、到 develop 的交付面距离 ≤ K=200），且 **AC-214 判据本体干跑 exit 0**（七行 freshness 全部 `margin > 0`，`.quay/goal-freshness-margin.json` 可核），并在 `QUAY_GOAL009_FRESHNESS_K=1` 的负控制下**仍能 exit 1**（证明不是恒绿），同时 `goals/` 的 diff 为空（证明转绿不来自放宽判据）。

⛔ **不接受的替代物**：手写记录 / 从别处搬一条旧记录 / `--selfcheck` 或 `--check` 的输出；只把记录写进任务 worktree 的 `.quay/`（判据读的是主检出 ⇒ 空转，AC6 直接挡）；改 K / 删主体 / 改 `expect` 或 `criterion`；用 `--verify-coldstart --ac207-e2e` 冒充（那是**冷启动面**产出者，⛔ 不产出 AC-238/239——这正是本次转红的成因）；自行 `superseded` 该 AC 记录（需人裁定）。

## Touches

- `.quay/productization-verification.jsonl`（本 AC 的载体：本次运行 append 的 AC-238 / AC-239 记录 ⚠️ anti-drift-touches-check 只比对 `git diff --name-only <merge-target>...HEAD`（**已跟踪**文件）；该载体被 `.gitignore:330` 忽略 ⇒ 它不进那个集合，声明它是为了表明「本任务的产出落在这里」，⛔ 不是可提交物）
- `tasks/gap-ac214-ac238-239-freshness-upgrade-producer-rerun.md`（自身文件：勾 AC + 贴实跑证据）