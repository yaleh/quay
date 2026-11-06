---
id: gap-worktree-quay-snapshot-copies-multi-gb-ledgers
title: refresh-worktree-quay.sh 把约 4 GB 台账拷进每个 worktree —— 一轮 suite 就制造上千次 cp/mkdir
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**症状（实测，2026-11-06，本机；数字逐字取自现场读数）**

- 主检出 `.quay/` = **8.6 GB / 443,026 files / 1,939 dirs**。
- 每个任务 worktree 的 `.quay/` 快照 = **约 3.9–4.0 GB**（实测 `gap-routine-semantic-dedup-scan-readtasks-duplicate` 3.9G、`gap-goal-driver-filing-ledger` 4.0G）。构成：`meta-driver-round.jsonl` **2.0G**、`goal-round.jsonl` 350M、`measure-history.jsonl` 297M、`verification-round.jsonl` 275M、`gate-events.jsonl` 207M。
- `plugin/scripts/refresh-worktree-quay.sh` 把主检出 gitignored 的 `.quay/*` 复制进 worktree 快照；唯一排除项是 `.quay/node-compile-cache/**`（4.1G）与 dated/log/inbox 路径。**上面这些 append-only 台账不在排除集**，所以每轮 fan-in / scoped-gate 在 worktree 里都会重新拷一遍多 GB 文件（`cp -p`，幂等覆盖）。
- 实测代价：一次 `bash scripts/test.sh --for-task …` scoped-gate 运行期间，bpftrace execve 追踪记录到 **约 5 秒内 cp 1,638 / mkdir 1,637 / dirname 1,639 次 exec**（~1,000 execs/s），父进程全部是 `refresh-worktree-quay.sh`；所有测试套件停止之后，它仍是本机残余进程抖动的主导来源（当时 host loadavg 259，而真实 CPU 工作约 10 核）。
- 磁盘：7 个在飞 quay worktree × ~4 GB ≈ 28 GB，且各 worktree 的副本会陈旧、彼此不一致。

<!-- dedup-ref --> 相关历史（上下文，非重复立案）：`gap-fan-in-worktree-quay-provisioning`（done）**创建**了这个脚本；`gap-driver-round-carriers-unbounded-growth-retention-design`（done）处理过 `*-round.jsonl` 无界增长（当时 meta = 513M）——同一个载体今天已是 **2.0G**，即那条任务的前提被超过 4 倍。

**候选修法（形状留给实现者，择一或组合）**：① 把 append-only 历史台账从 worktree 快照里排除（worktree 套件需要 config/gates/runtime 载体，不需要主检出的全部历史）；② 用 `cp --reflink=auto` 或硬链接复制，使代价是 O(metadata) 而不是 O(bytes)；③ 在源头截断/轮转这些载体。无论选哪个，**排除集必须 data-driven，并断言一个快照大小上界**，使未来的新载体不能悄悄把它重新灌大。

## Plan

1. 先取直接量再动手：一次 refresh 前后 `du -sb` 快照、`strace -f -e trace=execve -c` 或既有计数口径的 cp/mkdir 次数，作为改动前基线（贴原文读数，⛔ 只报「变快了」不算）。
2. 选定修法并落到 `plugin/scripts/refresh-worktree-quay.sh`：排除集单一声明（数据，不是散落在条件里的字面量）；若选 reflink/硬链接，确认 worktree 内写入不会回写主检出（当前设计是副本、非 symlink，正是为了不污染主检出，这条约束不能丢）。
3. 加**快照大小上界**判据：算出大小并与声明上界比较；算不出 ⇒ 记 `NOT-EVALUATED` 并以可区分的输出暴露，⛔ 不得与「合格」同形（硬规则 3b）。
4. 补测试（含负控制：未列入排除集的载体仍必须被复制）并在本任务 worktree 内跑一次真实 scoped-gate 取前后对照。
5. 若实现新增了 `plugin/scripts/*` 文件或需要改刷新调用点 `scripts/test.sh`，**在合入 develop 之前**先用 task_write 把该文件补进 `## Touches`（anti-drift 读的是 worktree 内的任务文件，事后补会假红）。

## AC

- [x] AC1 排除/去重生效（能取假）：构造 mock 主检出 `.quay/`（含一个 `truncate -s 500M` 造的 ledger）跑一次 refresh ⇒ worktree 快照里**不含**该 ledger（或它走 reflink/硬链接、块数不翻倍），并打印快照大小读数；**负控制**：同一 fixture 里放一个未列入排除集的载体 ⇒ 它**仍必须被复制**。两态读数贴出。
  - 证据：`plugin/test/refresh-worktree-quay.test.mjs` 的 `AC1`；实测两态 `excluded ledger present=false · negative-control carrier present=true · snapshot=141 bytes`（fixture：500M 的 `meta-driver-round.jsonl` 不入快照，未声明的 `zz-not-excluded-carrier.json` 入快照且字节一致）。生产侧读数见文末「落地」。
- [x] AC2 exec 次数与台账字节数解耦：同一 fixture 用 5M 与 500M 两个 ledger 各跑一次 refresh，execve 计数差值 ≤ 一个小常量上界（写明该上界与理由），并贴出两次数值。
  - 证据：`AC2` 用 PATH shim 数 `cp`/`mkdir` 调用：`5M ⇒ 6 · 500M ⇒ 6 · |Δ|=0 ≤ 2`。**上界=2 的理由（结构性，不是经验值）**：复制循环按【枚举路径数】而非字节计费，同一 fixture 两次运行唯一能改变计数的事件是「多/少一个路径」；台账字节 ×100 在排除后贡献 **0** 次 exec。生产读数 cp 8,129→122 / mkdir 8,130→122。
- [x] AC3 排除集 data-driven 且可核：排除集在脚本头部以单一声明表达；测试读该声明与实际行为交叉核对——往声明里加一个载体名 ⇒ 测试回报它被排除；从声明里删掉 ⇒ 测试回报它被复制（两态贴出）。
  - 证据：`AC3` 把脚本复制一份并把 `"zz-policy-probe-carrier.json"` 注入 `REFRESH_SNAPSHOT_EXCLUDE` ⇒ 该载体不再被复制；用未修改的脚本 ⇒ 被复制（`declared=absent · undeclared=present`）。声明位于脚本头部 `# >>> REFRESH_SNAPSHOT_POLICY` 块，并同时驱动三处：① git pathspec（排除项根本不被枚举）② 复制循环 ③ 陈旧副本 prune —— 三者同源，不可能各说各话。
- [x] AC4 快照大小上界存在且能取假：refresh 结束时算快照大小并与 `plugin/scripts/refresh-worktree-quay.sh` 声明的上界比较，超界 ⇒ 非零退出或显式告警；算不出/读不懂 ⇒ `NOT-EVALUATED` 独立取值。贴「界内 pass」「人为超界 fail」两态。
  - 证据：`AC4` 三态 `within=exit 0(+「within bound」行) · over=exit 3(+SNAPSHOT OVER BOUND) · unmeasurable=NOT-EVALUATED`（`du` shim 失败时**不**出现「within bound」，即不与被判合格的形态同形）。上界 `REFRESH_SNAPSHOT_MAX_BYTES=512MiB`，量的是 worktree `.quay` 去掉 cache 类后的口径（worktree 自有的 NODE_COMPILE_CACHE 不计入、也不被 prune —— `AC1b` 用 700M 稀疏 cache 反向验证：若被计入就会 exit 3）。
- [x] AC5 真实证据（本任务 worktree 内、合入之前）：改动后在该 worktree 跑一次 `bash scripts/test.sh --for-task gap-worktree-quay-snapshot-copies-multi-gb-ledgers`，记录 ① 快照大小（改前 vs 改后）② 一次 refresh 的 cp/mkdir exec 计数（改前 vs 改后）。⛔ 只贴 fixture 数字不贴生产读数 ⇒ 不算。
  - 证据：见文末「落地」表 —— 全部读数取自**本任务 worktree**（`/data/home/yale/work/quay-worktrees/gap-worktree-quay-snapshot-copies-multi-gb-ledgers`）+ 真实主检出，`strace -f -e trace=execve` 直接计数。scoped 门 `bash scripts/test.sh --for-task … --allow-thin` ⇒ **exit 0**，13/13 该文件测试通过，`real 8.09 s`。

## Definition of Done

- 五条 AC 全部满足，AC5 有真实前后对照读数（快照大小与 exec 次数各一对）。
- 一个真实任务 worktree 的 refresh 后 `.quay` 快照**显著小于**改动前（给出具体数字，不是「更小」），且一次 refresh 的 cp/mkdir exec 次数不再随台账字节数增长。
- 负控制成立：未列入排除集的 `.quay` 载体仍被复制进 worktree（证明不是一刀切不拷、套件所需 config/gates/runtime 仍可读）。
- 项目自身闸门：`--for-task` scoped 门 + 全量套件绿；若改动了调用点或新增脚本，`## Touches` 已在合入前补齐。

## Touches

- plugin/scripts/refresh-worktree-quay.sh
- plugin/test/refresh-worktree-quay.test.mjs
- plugin/scripts/capability-catalog-declarations.json — 仅当本任务新增 plugin/scripts 文件时（同时按 capability-catalog.sh 头部登记 outline 条目）
- tasks/gap-worktree-quay-snapshot-copies-multi-gb-ledgers.md


2026-11-06 部分落地（人直接授权热修，commit bb23e77a1，已 ff 进 develop）：① `refresh-worktree-quay.sh` 的 per-path case 增加 `.quay/meta-driver-round.jsonl` 与 `.quay/goal-round.jsonl` 排除（快照字节约 −59%）；② `cp -p` → `cp -p --reflink=auto`（/data 为 XFS reflink，实测拷 357 MB 只占 640 KB；worktree 内 `filefrag` 显示 extents shared）。**尚未做**：`gate-events.jsonl` / `verification-round.jsonl` / `measure-history.jsonl` 仍在拷贝（担心活检查器读它们，需要测试覆盖后再排除）；以及枚举仍有 8,125 条路径 ⇒ 单次 refresh 仍要 ~24 s / ~16k execs，本任务的「exec 数与台账字节解耦」那条 AC 仍未满足。

## 落地（2026-11-06，本任务；supersedes bb23e77a1）

**形状**：排除集成为脚本头部 `# >>> REFRESH_SNAPSHOT_POLICY` 内的**单一声明** `REFRESH_SNAPSHOT_EXCLUDE`，同一份数据驱动三处 —— ① git pathspec（排除项不被枚举）② 复制循环 ③ 陈旧副本 prune。`!` 前缀 = cache 类：从不复制、也从不 prune（worktree 自有的 `NODE_COMPILE_CACHE`、嵌套 deliver worktree）。复制走 `cp -p --reflink=auto`（探测一次，非 GNU cp 自动退回）。上界 `REFRESH_SNAPSHOT_MAX_BYTES=512MiB`，超 ⇒ exit 3，量不出 ⇒ `NOT-EVALUATED`。

**被排除的类**：`*-round.jsonl`、`*-outcome.jsonl`、`gate-events.jsonl`、`measure-history.jsonl`、`checker-cost.jsonl`、`ci-runs.jsonl`、`doc-develop-sync.jsonl`、`*.log`、`suite-load-*`、`suite-memory-evidence-*`、`manager-inbox/**`、`outer-inbox/**`（+ cache 类 `node-compile-cache/**`、`deliver-worktree-*`）。**保留**：`config.yml`、控制态（`worker-control.json`/`promotion-control.json`/`goal-control.json`）、pid/anchor 载体、各 `*-state.json`、findings 与 slice-readings —— 即「当前态」而非「写入历史」。

**生产前后对照（同一 worktree / 同一主检出，`strace -f -e trace=execve` 直接计数）**

| 量 | 改前 | 改后 | 备注 |
|---|---|---|---|
| worktree `.quay` 快照 | **4,130,948,895 B** | **83,229,731 B**（test.sh 内刷新自报 82,274,116 B） | −98.0% |
| 一次 refresh 复制的文件数 | 8,127 | 121 | |
| `cp` execs | 8,129 | 122 | |
| `mkdir` execs | 8,130 | 122 | |
| `dirname` execs | 8,129 | 121 | |
| execve 合计 | 24,390 | 383 | |
| 一次 refresh 墙钟 | 56.02 s | 1.55 s（首轮含迁移 prune 为 20.76 s） | |

**迁移**：改动后第一次 refresh 从既有快照里 **prune 掉 8,007 个陈旧文件**（4 GB → 78.5 MiB），此后稳态 0～1 个。**只 prune gitignored 路径** —— 真实 case：`.quay/ac-devci-ac4-carrier-written-by-round.jsonl` 是 **tracked** 文件且命中 `*-round.jsonl`，早期版本把它删了并弄脏 worktree；现由 `AC1c` 钉住（tracked 载体必须存活、stale ignored 副本必须被删）。

**suite 侧风险与实测**：`verification-round.jsonl` / `gate-events.jsonl` 不再进 worktree 快照 ⇒ `prod-data-audit.test.mjs` 在 worktree 里会走它自己写明的 `t.skip`（NOT-EVALUATED，与全新 CI checkout 同态），这是硬规则 3b 已设计的形态而非红。实跑核对：`prod-data-audit` / `accounting-emit` / `gate-staleness-check` / `stale-ready-audit` / `help-contract-incompatible-behaviors` 共 45 tests 全绿、0 skipped。

**ADR-007 暗轴（L_D/L_G）**

该轴仍暗,理由:本次改动只落在 `plugin/scripts/refresh-worktree-quay.sh`（bash）+ 它的测试，不改变 `packages/` 的模块依赖图，archguard 的 L_D/L_G 对此 delta 无读数可产出。

## Blocker

**2026-11-06T13:07:20.564Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=dark-axis: dark-axis (ADR-007 per-milestone predicate) refused the flip — MISSING: MISSING — the task body records no L_D/L_G reading (a numeric quantity at an axis-anchored line) and carries no explicit "该轴仍暗,理由:<...>" declaration. ADR-007 requires one or the other before the task may be called done.
- run_id：wk-prod-anchor