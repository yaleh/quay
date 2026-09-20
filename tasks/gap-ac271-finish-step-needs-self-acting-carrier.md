---
id: gap-ac271-finish-step-needs-self-acting-carrier
title: AC-271 第三次红：release/v0.11.0 切版未删分支（§12 把 tag 钉在合并点 ⇒ 判据形态 (b)
  不可达，删除是唯一可达的合规形态），而收尾步仍只靠人记得——需要一个【自作用】的收尾载体
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-271
---
**type:** execution

## Finding

**缺口｜AC-271 在 2026-09-20T15:2xZ 第三次翻红，而把它翻红的正是本仓库自己的【切版动作】。** 载体
（`plugin/scripts/release-branch-finish.sh`）**存在、可用、判据正确**，但这次切版**没有经过它**：
`.quay/release-branch-finish.jsonl` 里 2026-09-20 **一行都没有**。⇒ 红的是**保证**，不是判据。

**立案当轮实测（主检出 `/home/yale/work/quay`，全部为直接量）**：

| 量 | 读数 |
|---|---|
| 台账两条独立 fail（立案前） | `2026-09-20T15:24:57.854Z` 与 `2026-09-20T15:29:00.488Z`，两条 `"verdict":"fail"` + `CAUSE=release-branch-not-parked-on-a-tag — 1 of 1 release branches have a tip that is not any tag: release/v0.11.0` |
| 违规分支 | `refs/heads/release/v0.11.0`，tip `7d10a1d2d287820fa970c7c4c9a23e0775a44664`，committerdate `2026-09-20 15:26:57 +0000` |
| `git tag --points-at release/v0.11.0` | **空** |
| `git tag --contains release/v0.11.0` | `v0.11.0` |
| `git merge-base --is-ancestor 7d10a1d2d v0.11.0` | **YES**（EXIT=0） |
| `git rev-list --count develop..release/v0.11.0` | **0**（EXIT=0） |
| tag `v0.11.0` 的落点 | `f00a7486df19b5436b324b9f90219510f2d2c8e5` = 「Merge release/v0.11.0 into develop (release cut per SPEC §4.1/§12)」，`parents=b0aa9f33434167a7d83c35a4ec8e029e29970871 7d10a1d2d287820fa970c7c4c9a23e0775a44664` |
| 载体痕迹 | `bash plugin/scripts/release-branch-finish.sh --log` → `trace: 4 record(s)`，**末条 `2026-09-19T03:52:55Z`** ⇒ 本轮切版**零记录** |
| 远端 | `git ls-remote --heads origin release/*` **空**（release 分支只存在于本地，与 SPEC §4.1.1 ③ 一致） |
| 归因（排除 worker 任务） | `.quay/worker-round.jsonl` 第 119–123 轮（`15:23:24.998Z`–`15:29:07.995Z`）**全部** `"in_flight":0` / `"stop_reason":"pool-empty …"`；`ps aux | grep -c '[q]uay-task-worker'` = **0** |
| **立案后追加读数（约 `15:35Z`）** | **分支已消失，且痕迹为零**：`release-branch-finish.sh --log` 仍为 `trace: 4 record(s)`（末条 `2026-09-19T03:52:55Z`，**无新增行**）；`.git/logs/refs/heads/release/` → `No such file or directory`（`git branch -D` 连 reflog 一起删）；`git rev-parse --verify 7d10a1d2d` 仍可解析（EXIT=0）；`goal gate AC-271` 随之转 **`pass`** |

**这次切版的四个提交（可直接核）**：`513a6a00f`（Merge origin/develop (v0.10.0 release line) into
release/v0.11.0，15:25:12Z）→ `7d10a1d2d`（release/v0.11.0: VERSION -> 0.11.0，15:26:57Z）→
`f00a7486d`（Merge release/v0.11.0 into develop，15:27:47Z，**annotated tag `v0.11.0` 在此**）→
`c437bc0bd`（version: develop bumps VERSION to 0.12.0 after v0.11.0 release cut，15:29:16Z）。
⛔ 本任务**不**声称知道执行者是谁（人或哪个会话）——只给可核的量。可核的是：**它没有走载体**。

**⛔ 立案后的关键追加：同一个无痕形态第三次出现。** 立案当轮（15:34Z）该分支**仍在**（上表读数）；
约 `15:35Z` 前后它**消失了**，`goal gate AC-271` 随之转 `pass`——而这次消失**同样零痕迹**
（`--log` 无新增行；`release/` 的 reflog 目录不存在）。⇒ 与 SPEC §10 残留 4（2026-09-19 那次
「成因不可查的外部删除」）与 §4.1.2（2026-09-20 `ac4-reading` 的创建/销毁）**是同一形态的第三次**。
⇒ **⛔ 该消失不计入任何任务的成果**，⛔ 也**不得**据它声称「AC2 已完成」：**判据的恢复在本任务开工时
已不是可交付项**，本任务真正的交付物是「让这件事今后不需要任何人记得」——即第 3–6 步。

**结构成因 ①（§12 使判据的第二种合规形态不可达）**：AC-271 的 criterion 接受两种终结形态：
(a) 分支不存在；(b) `git tag --points-at <branch>` 非空（tip 逐字停在 tag 上）。而 SPEC §12.2
（人 2026-09-20 裁定「tag 提交不自描述」）把 tag 的落点定为**合回 develop 的合并点**——
`f00a7486d` 是分支 tip `7d10a1d2d` 的**子**提交。⇒ **凡按 §12 规程切的版，形态 (b) 在结构上不可能成立**，
`--points-at` 恒空。**唯一可达的合规形态是 (a) 删除。** ⇒ 整条长期保证**全部压在「删除」这一步上**，
而这一步目前**只靠人记得**。

**结构成因 ②（载体存在，但没有任何东西必须经过它）**：`release-branch-finish.sh <branch> --cut --tag <vX.Y.Z>`
本来正是这次切版末段的载体——一次做完「合回 → 在合并点打 tag → 删除」，exit 0 就等于「分支已消失」
（SPEC §4.1.1 ②）。本轮切版把前两步手工做了（`f00a7486d` + annotated tag `v0.11.0`），**第三步从未发生**。
载体不是被绕过，是被**跳过**；而跳过它**没有任何检查会发现**——判据要到下一轮 goal gate 才读到红
（硬规则 9：可见性 ⊂ 执行）。立案后那次删除则说明**反向也成立**：有人手工补了删除，而**没有任何载体知道
它发生过**——「谁删的、用什么命令删的」在仓库产物里依旧不可查（与 §10 残留 4 逐字同形）。

**为什么上一轮的修复没有覆盖它**（⛔ 这是本任务存在的主要理由）：

<!-- dedup-ref -->
`gap-ac271-release-branch-outlives-its-tag-again`（`goal_ac: AC-271`，**done** 2026-09-19）交付的正是
**这一次**失败的半边——命令 `release-branch-finish.sh`、它的 `--cut --tag` 落地步、以及
`.quay/release-branch-finish.jsonl` 留痕（其 AC 逐字要求「合回+打 tag+删除 走同一条命令」）。
⇒ **本轮的 v0.11.0 切版是它落地之后第一次真实切版，而它逐字复现了被修的那个失败**：三处改动（载体 /
落地步 / 留痕）都还在，**没有一处使载体成为必经之路**。而它用来对治「删除不留痕」的那半边，
本轮也被逐字复现（立案后那次删除零痕迹）。
`gap-ac271-build-reading-creates-shared-release-ref`（`goal_ac: AC-271`，**done** 同日）补的是**创建侧**
（隔离 Git 目录里取 build 读数），与本次（切版收尾）不是同一个机制。
`gap-release-branch-deleted-after-merge`（**done** 2026-09-15）建的是载体本身。⇒ 三者都不与本任务重复。

**发生率（硬规则 12：先给读数，再谈机制）**——`.quay/gate-events.jsonl` 全量，按**违反分支名**去重计数：

| 违规分支 | fail 读数 | 首 / 末 |
|---|---|---|
| `release-v063-build` | 22 | 2026-09-15T14:12:00.916Z / 16:12:00.022Z（协议落地前的基线） |
| `release/v0.10.0` | 4 | 2026-09-19T03:28:56.169Z / 03:33:58.989Z（**切版残留**，无痕迹消失） |
| `release/ac4-reading` | 1 | 2026-09-20T04:52:49.353Z（**build 读数**，已由隔离沙箱对治） |
| `release/v0.11.0` | 3 | 2026-09-20T15:24:57.854Z / 15:30:59.641Z（**本轮**，随后无痕迹消失） |
| `release/v0.0.0-nc` / `-nc271b` / `-ac271cut` | 1 / 1 / 1 | 判据自身的负控制夹具（⛔ 非生产残留） |

⇒ 「**切版的收尾步没有被执行、且其善后不留痕**」这一类真实发生 **3 次**（`v0.10.0` 的消失、
`ac4-reading` 的创建/销毁、`v0.11.0` 的消失），其中**第二次与第三次都发生在第一次的修复落地之后**。
⛔ 本任务不以发生率为前置（AC-271 是 `long-term: true`，它要的是保证；本轮已实测到保证被一次
**自己人的切版**击穿，且善后同样不可查）。

**判别性对照（硬规则 4 推论四：给不出对照就只是假说）**：
- 假说 H1「判据太严，把 §12 的合法状态误判为红」⇒ 预测：分支的两种合规形态里至少一种成立，只是判据读法有偏差。
- 假说 H2「切版收尾步没有被任何机制带着走」⇒ 预测：载体痕迹为零、驱动为空闲、且两种合规形态**都不**成立。
- **实测与 H2 一致、H1 被排除**：`tag --points-at` **空**（形态 (b) 不成立）且分支**存在**（形态 (a) 不成立）；
  `.quay/release-branch-finish.jsonl` 本轮零行；worker 五轮 `in_flight:0`。⇒ 判据一字未改，且它**抓对了**。

**边界（⛔ 不做）**：
- ⛔ **不放宽判据**：`goals/AC-271-*.md` 的 `criterion` / `expect` **一字不改**。前两轮已两次明令此边界。
- ⛔ **不改 SPEC §12.2 的 tag 落点**（tag 打在合并点是人 2026-09-20 的逐字裁定，且自带理由）。本任务只
  **记录**它对 AC-271 的后果（形态 (b) 不可达）。
- ⛔ **不新造第二个判据去复述 AC-271**：AC-271 本身就是那个判定，由 goal gate 按轮复跑。
- ⛔ **不把 janitor 接进 goal gate / goal-driver 的判定路径**：判定者不得成为被判定状态的修复者——那会把判据
  变成自证（硬规则 4）。janitor 与判定**分开**接线。
- ⛔ **不做「切版一条龙命令」**（显式非目标）：`--cut --tag` 已经是末段载体，本轮失败不是因为它能力不足，
  而是因为它**可以不被经过**；再加一条命令不会改变这一点。

## Requested action

1. **先取证（任一不满足就停并报告）**：贴出（a）台账那两条 fail 的原文（含完整 `CAUSE=` 与分支名）；
   （b）上表的分支 / tag 直接量（`for-each-ref` / `tag --points-at` / `tag --contains` / `is-ancestor` /
   `rev-list --count develop..<b>`）；（c）`release-branch-finish.sh --log` 的末条时刻与记录数；
   （d）归因读数（`worker-round.jsonl` 五轮 + `ps aux | grep -c '[q]uay-task-worker'` = 0）；
   （e）**立案后追加读数**：删除后的 `--log` 无新增行 + `release/` reflog 目录不存在 + `7d10a1d2d` 仍可解析。
   ⛔ **不得**把这次切版归因给 `release-branch-finish.sh`（记录里没有对应行）；⛔ **不得**声称知道执行者是谁；
   ⛔ **不得**把立案后那次删除记成任何任务的成果。
2. **判据恢复**：若开工时 `release/v0.11.0` **仍然存在**，用
   `bash plugin/scripts/release-branch-finish.sh release/v0.11.0`
   结束它（它的许可判据两种形态**都**成立：`tag --contains` = `v0.11.0`，且 `develop..<b>` = 0），并贴出：
   命令 + 退出码 + 输出、`--log` 的新增行、枚举为空、`goal gate AC-271` → `pass` / `EXIT=0`。
   ⛔ 不得用 `git branch -D` 手搓（那正是 2026-09-19 与本轮那次「无痕迹删除」的形态）。
   ⚠️ **本轮实测：开工时它已不存在**（立案后约 `15:35Z` 无痕迹消失，见 Finding 的追加读数）。此时：
   贴出它已不可解析的读数，如实记为**不可归因的消失**（SPEC §10 残留 4 的先例），⛔ 不记成本任务成果、
   ⛔ 不据此声称完成，并**直接进入第 3–7 步**——那才是本任务真正要交付的东西。
3. **给收尾步一个【自作用】的载体（janitor）**：新增一条命令（名字由实现者定），每次运行按 AC-271
   **同一份枚举**（`refs/heads/release-*` + `refs/heads/release/*`）判定，并对每条分派到**三种互不共用输出**
   的结果：
   - **已合规**（`tag --points-at <b>` 非空）⇒ **不碰**；
   - **红且可无损删除**（`points-at` 空 **且**（`tag --contains <b>` 非空 **或** `rev-list --count <base>..<b>` = 0））
     ⇒ **经 `release-branch-finish.sh` 结束它**（共用同一份合规定义与同一条痕迹载体；⛔ 不重写删除逻辑、
     ⛔ 不自己 `git branch -D`）；
   - **红且无许可**（两种许可都不成立）⇒ **留在原地**（这正是判据必须继续抓到的「会丢工作」形态）。
   仪器故障（枚举 / `tag` 扫描跑不起来）必须有**独立**退出码与 `CAUSE=`，⛔ 绝不与「枚举为空」共用输出
   （硬规则 3b）。
4. **让它自己发生，而不是等人运行**：把 janitor 接进 **worker-driver 的每轮 housekeeping**
   （`plugin/scripts/worker-driver.ts`，与 `superseded_reclaim` 同一处；⛔ 不接进 goal gate / goal-driver 的
   判定路径，见边界），使「切版忘了删」这一态在**一个 tick 内**被收尾，**不需要任何人记得**。轮次记录里
   能读出这次 janitor 的运行与结果。
5. **留痕 + 「从未发生」独立取值（硬规则 3b/8/9）**：janitor 追加自己的本地记录
   （默认 `.quay/release-branch-janitor.jsonl`），每条含**分支名 / 时刻 / 判定结果 / 许可依据（tag 名或 base）/
   退出码**，用 `--log` 读回；**记录文件不存在**与**存在但读不出**各有独立退出码 + `CAUSE=`，
   ⛔ 不与「运行过、无分支可处理」共用输出。⛔ **词表不得复用**既有 `form=`（`.quay/release-branch-finish.jsonl`）
   与 `shape=`（`.quay/release-reading-sandbox.jsonl`）——用一个新的键名与取值集，并由测试机械把守。
   该记录文件需在 `.gitignore` 里按同族（运行时状态）落一行。
6. **负控制（硬规则 4c：落笔当轮当场干跑，两条读数都贴）**：
   - **① janitor 会收尾**：在真实仓库里造一个**红且被 tag 持有**的状态（例：`release/v0.0.0-jan` 指向一个
     **不被任何 tag 直接持有**、但处在某个 tag 的祖先链上的提交，并把该快照 tag 打在一个**后代**提交上）
     ⇒ 跑 janitor ⇒ 该分支**经载体**结束、janitor 记录新增一行、枚举回到空。
   - **② janitor 不越界，且判据仍能取假**：造一个**红且无许可**的分支（tip 既不在任何 tag 的历史里、
     `develop..<b>` ≠ 0）⇒ 跑 janitor：它**留在原地**（独立退出码 + `CAUSE=`），且同一动作序列里
     `node packages/quay/bin/quay.js goal gate AC-271` **仍然 `verdict=fail` 并点名该分支**。
     ⛔ 两条临时分支与临时 tag 必须同轮清干净，末尾贴枚举为空。
7. **登记与测试**：新增 `plugin/scripts/*` 脚本按 `select-static-checks-for-touches.ts` 的
   `NEW_SCRIPT_REGISTRATION_REQUIRED` 补齐 `plugin/scripts/capability-catalog-declarations.json` 的声明项
   （`bash plugin/scripts/capability-catalog.sh --json` → `unclassified: 0`）；行为变更必须有测试进
   `plugin/test/`；本轮新增的每个文件**同轮**写进 `## Touches`。
8. **落点同步**：`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §4.1.1 补一条**已实测**的后果
   ——§12 把 tag 钉在合并点上 ⇒ 判据形态 (b) 对按 §12 规程切的版**不可达** ⇒ 删除是唯一可达的合规形态
   ⇒ 收尾步是本保证的**唯一承重墙**，现由 janitor 自作用承载；§10 残留表新增一行，如实记
   `2026-09-20T15:24:57Z`–`15:30:59.641Z` 这次 `release/v0.11.0` 残留、**以及它随后那次零痕迹的消失**
   （这是同一形态的第三次，⛔ 不写成「已由命令处理」、⛔ 不计入任何任务的成果）。

## Acceptance Criteria

- [ ] **AC1 现状取证 + 归因诚实**：贴出（a）台账两条 fail 原文（`15:24:57.854Z` / `15:29:00.488Z`，含完整
  `CAUSE=` 与 `release/v0.11.0`）；（b）分支与 tag 直接量：`for-each-ref … release/v0.11.0 7d10a1d2d`、
  `tag --points-at` **空**、`tag --contains` = `v0.11.0`、`is-ancestor 7d10a1d2d v0.11.0` = YES、
  `rev-list --count develop..release/v0.11.0` = 0、`tag v0.11.0` 的落点 `f00a7486d` 且其 `parents` 含
  `7d10a1d2d`（⇒ §12 形态 (b) 不可达）；（c）`release-branch-finish.sh --log` 末条 = `2026-09-19T03:52:55Z`
  且 `trace: 4 record(s)`；（d）`worker-round.jsonl` 第 119–123 轮全 `in_flight:0` + worker 进程数 0；
  （e）立案后追加读数：删除后 `--log` **无新增行**、`.git/logs/refs/heads/release/` **不存在**、
  `git rev-parse --verify 7d10a1d2d` 仍 EXIT=0 ⇒ **不可归因的消失**。
  ⛔ 不得把这次切版或那次删除归因给 `release-branch-finish.sh`；⛔ 不得声称知道执行者是谁。
- [ ] **AC2 判据恢复（经载体）**：若开工时分支仍在：`bash plugin/scripts/release-branch-finish.sh release/v0.11.0`
  的命令原文 + 退出码 + 输出、同轮 `--log` 新增行（含 branch/sha/form/result）、枚举**为空**、
  `goal gate AC-271` → `pass` / `EXIT=0`。⚠️ **本轮实测该分支已于立案后无痕迹消失**：此时改为贴出
  它已不可解析的读数 + 三条无痕读数，如实记为**不可归因的消失**，⛔ 不记成本任务成果、⛔ 不据此声称恢复，
  本任务的可交付性由 AC3–AC7 独立承担。⛔ 任何情况下用 `git branch -D` 手搓都不算。
- [ ] **AC3 janitor 的三个分派互不共用输出（真实仓库）**：贴出 janitor 命令 + 每种结果的独立退出码与
  `CAUSE=`/输出：(i) **已合规**分支 ⇒ 不碰（贴出「未改动」的读数：分支仍在 + `points-at` 非空）；
  (ii) **红且被 tag 持有** ⇒ 经载体结束（贴 janitor 记录行 + `release-branch-finish.sh --log` 同行 +
  枚举回到空）；(iii) **红且无许可** ⇒ 留在原地（贴独立退出码 + `CAUSE=` + 分支仍在）。
  仪器故障（枚举/`tag` 扫描失败）⇒ 独立退出码 + `CAUSE=`，⛔ 不与「枚举为空」同形。贴出该形态的读数
  （可用注入的假 `PATH` shim 或不可读 root 制造一次故障读数）。
- [ ] **AC4 判据未被放宽、也未被绕过**：`git diff <落地前>..<落地后> -- goals/` **为空**（贴出；
  `criterion`/`expect` 一字未改即由此证明）；且在 AC3(iii) 的同一动作序列里 `goal gate AC-271` 仍
  `verdict=fail` 并**点名**该无许可分支（贴原文）⇒ 判据仍能取假、janitor 没有让它恒真。
- [ ] **AC5 痕迹与独立取值（硬规则 3b/8/9）**：`--log` 能读出某次运行（分支名 / 时刻 / 结果 / 许可依据）；
  「从未发生」（记录文件不存在）与「存在但读不出」各有**独立退出码 + 独立 `CAUSE=`**，⛔ 不与
  「运行过、枚举为空」共用输出；贴两条读数。且**词表不复用**：新记录的键名与取值集与既有 `form=` /
  `shape=` 无交集——由 `plugin/test/` 里一条机械断言把守（贴出该测试名与它转红后的形态，或贴断言原文）。
- [ ] **AC6 自作用（生产读数，硬规则 4 推论三）**：janitor 已在**真实 driver 轮次**里运行过——贴出 `ts`
  **晚于本任务实现落地时刻**的 ≥1 条生产运行记录（`.quay/worker-round.jsonl` 里该轮的 janitor 结果，或
  `.quay/release-branch-janitor.jsonl` 的一行），且同一时刻 `goal gate AC-271` = `pass`。
  ⛔ 只贴夹具/临时仓库上的运行**不算**（那是「能产出」，不是「已产出」）。
- [ ] **AC7 登记与套件**：`bash plugin/scripts/capability-catalog.sh --json` → `EXIT=0` 且 `unclassified: 0`，
  并贴出新脚本在 catalog 里的那一行；`bash scripts/test.sh --for-task gap-ac271-finish-step-needs-self-acting-carrier --allow-thin`
  → `EXIT=0` 且选择集**含**本轮新增/修改的测试文件（⛔ 在 worktree 里直接 `node --test` 不算证据）。
- [ ] **AC8 落点同步**：贴出 `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` 被改动的段落
  （改动前后各贴关键行）：§4.1.1 的「§12 ⇒ 形态 (b) 不可达 ⇒ 删除是唯一可达的合规形态」一行，与 §10 残留表
  新增的那一行（如实记本轮残留、**它随后的零痕迹消失**及归因读数，⛔ 不写成「已由命令处理」、⛔ 不计入成果）。

## DoD

- [ ] **AC-271 的保证有了自作用载体**：一次真实 driver 轮次里，一个**红且被 tag 持有**的 release 分支被
  janitor **经载体**收尾并留下可读痕迹（AC3(ii) + AC6）；而一个**无许可**的红分支被**留在原地**、
  判据仍 `fail` 并点名它（AC3(iii) + AC4）。⚠️ 本轮实测判据**当前已为 `pass`**（那次消失不可归因）——
  ⇒ DoD **不以「把它从红转绿」为条**，而以**载体本身可运行、可控、可查**为条。
- [ ] **痕迹缺口闭合**：无论删除由谁发起，它**都能被仓库产物读出来**（`.quay/release-branch-janitor.jsonl`
  与 `release-branch-finish.sh --log` 至少一处有对应行）；「从未发生」与「发生但读不出」各有独立取值（AC5）。
- [ ] ⛔ `goals/AC-271-*.md` 的 `criterion` / `expect` **一字未改**（AC4 的 diff 为空即此条）。

## Touches

- plugin/scripts/release-branch-janitor.ts (new)
- plugin/test/release-branch-janitor.test.mjs (new)
- plugin/scripts/worker-driver.ts
- plugin/scripts/capability-catalog-declarations.json
- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- .gitignore
- tasks/gap-ac271-finish-step-needs-self-acting-carrier.md
