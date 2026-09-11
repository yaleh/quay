---
id: gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit
title: AC-207 记录的 commit_sha 指向「翻 done」记账提交而非实现提交，而判据只查该字段非空 ⇒ 一个零实现、只有记账提交的项目同样能让它通过
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-207
---
## Proposal

**背景（本条不否定 AC-207 的达成）**：AC-207 已于 2026-09-11T01:21:19Z 产出首条记录并转 achieved，**其端到端场景经 ssh 外部核实为真**——远端项目 `/home/yale/quay-verify-coldstart-a2a5aac0-root`（orangevps，非本机、非本仓库）里，由该项目**自己的 drivers** 完成了全链：

```
86fc16f  chore(quay-init): initialize quay project files (plugin v0.6.1)
06e48e4  tasks: e2e-verify-207 todo→ready（promotion-driver 机械晋升）
12899cd  feat(e2e-verify-207): add e2e-marker.txt marker (ac207)   ← 真实实现提交（+1 行；已在 develop 与 main；文件实际存在于工作树）
7779407  tasks: 翻 e2e-verify-207 done（driver 机械 fan-in）
.quay/gate-events.jsonl = 1 条
```

**缺陷**：落进载体的那条记录，其 `commit_sha` 是 **`77794075…`（上表最后一行，「翻 done」的记账提交，改动为 `tasks/e2e-verify-207.md | 2 +-`）**，而**不是**实现提交 `12899cd`（`e2e-marker.txt | 1 +`）。

完整记录逐字：

```json
{"build_sha":"a2a5aac0366f74d2a3af509664ab8cc9046aa83d","ts":"2026-09-11T01:21:19Z",
 "ac":"GOAL-009-AC-207","host":"orangevps",
 "project_root":"/home/yale/quay-verify-coldstart-a2a5aac0-root",
 "commit_sha":"77794075008c776d289539111f73b422d1bb03e3",
 "task_id":"e2e-verify-207","task_status":"done","gate_events":1,"produced_by_driver":true}
```

**为什么这是缺陷而不只是「选错了一条」**：`goals/AC-207-*.md` 的 criterion 对该字段只要求**非空**（`commit_sha/task_id 非空`）。⇒ **一个 quay-init 之后只发生了任务状态翻转、零实现提交的项目，同样会写出非空的 `commit_sha` 并让判据 exit 0。** 而 GOAL-009 的退出条件逐字要的是「在该项目自身的 git 历史里留下**可核的开发提交**」——**该字段没有承载这个性质**（硬规则 4b：代理量与它要代表的东西脱节；硬规则 4：一个不能区分两种情形的量，对这两种情形而言不是测量）。

任务体原文也点名了这一点：「`commit_sha` = 第三方项目 `git log`（**任务 worktree 提交**）」、「产生**实现提交**（⛔ 排除 `chore(quay-init):` auto-commit）」。当前实现只排除了 `chore(quay-init):` 这一种，**没有排除 driver 自己的记账提交**（`tasks: 翻 … done`／`tasks: … todo→ready`／`tasks: … task_write by cli:…`／`goals: … create by cli:…`）——而这些在一次 e2e 里恰恰是**多数**（9 条提交里 7 条是记账类）。

## Plan

1. **让写入点选对提交**：`verify-deliver-coldstart.sh` 的 AC-207 段在取 `commit_sha` 时，从第三方项目 git 历史中筛出**非记账提交**——排除的前缀集合至少含 `chore(quay-init):`、`tasks: `、`goals: `（前两类是 driver/Provider ABI 的机械提交，第三类是 goal 记录写入）。⛔ 不要用「取最新一条」——本缺陷正是这么来的。
2. **判据同步收紧**：`goals/AC-207-*.md` 的 criterion 增加一条——记录须另带一个可区分字段（如 `impl_commit_sha` 或 `commit_is_implementation: true`），或 `commit_sha` 必须满足「其 `git show --stat` 触及的文件不全在 `tasks/`、`goals/`、`.quay/` 之下」。⛔ 仅改写入点而不收紧判据 ⇒ 下次换个写法又能绕过。
3. **fail-closed**：筛不出任何非记账提交 ⇒ **不写记录**并留可区分痕迹（硬规则 3b），⛔ 不得退化成写记账提交充数。

## Acceptance Criteria

- [x] AC1 缺陷存证（改前读数）：贴现有那条 AC-207 记录全文，以及远端 `git show --stat` 两条对照——`77794075`（改 `tasks/e2e-verify-207.md`）与 `12899cd`（改 `e2e-marker.txt`），说明前者是记账提交。
- [x] AC2 写入点选对（能取假）：改后在一次真实跨机 e2e 中，记录的 `commit_sha` 指向**实现提交**；贴该 sha 与其 `git show --stat`（触及的文件不在 `tasks/`/`goals/`/`.quay/` 下）。
- [x] AC3 负控制：构造一个「只有记账提交、无实现提交」的第三方项目状态 ⇒ 该步**不写记录**且留下可区分痕迹（非静默、非写记账提交充数）；贴输出与载体行数不变的前后读数。
- [x] AC4 判据已收紧（能取假）：把一条 `commit_sha` 指向记账提交的记录注入载体 ⇒ AC-207 criterion **仍 exit 1**；换成指向实现提交的记录 ⇒ exit 0。贴两次干跑输出；验证后移除注入记录、不污染生产载体。
- [x] AC5 既有达成不被推翻：收紧后用**同一次真实运行**的实现提交补一条合规记录 ⇒ AC-207 criterion exit 0；贴记录与干跑输出。⛔ 不得为了让判据过而放宽 AC4 的负控制。
- [x] AC6 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

AC-207 的记录 `commit_sha`（或新增的实现提交字段）指向一条**触及非记账路径**的提交，且判据能对「只有记账提交」取假；筛不出实现提交时 fail-closed 且留痕。⛔ 把判据放宽成「非空即可」⇒ 不算达成（那正是本缺陷）；⛔ 把记账提交改名绕过前缀过滤 ⇒ 不算达成（判据要看**触及的文件**，不是提交信息文本，硬规则②按位置不按关键词）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- packages/quay/plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- goals/AC-207-端到端-目标项目自己的-drivers-驱动出真实开发提交且任务翻-done.md
- tasks/gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit.md

## Evidence

### 实现（落在分支上的 4 个提交）

- 判定改为**按位置**（硬规则 ②）：`ac207_is_bookkeeping_commit` 看提交**触及的文件**是否**全部**落在 `tasks/`、`goals/`、`.quay/` 之下；机械前缀（`chore(quay-init):` / `tasks: ` / `goals: `）作并行判据，覆盖不落在这三棵子树的安装 auto-commit。⇒ **改提交信息文本绕不过去**（DoD 逐字禁止关键词判定）。
- `ac207_select_implementation_commit`：从新到旧扫 `--all`，跳过机械前缀与记账提交，取第一条真正的实现提交；⛔ 不再「取最新一条」（本缺陷正由此而来）。筛不出 ⇒ 空 + 非 0。
- 记录新增 `commit_files` 字段（实现提交触及的文件 JSON 数组，由 node 收 argv 生成，⛔ 不拼字符串）；`write_ac207_record` 对「文件全在记账路径下」与「缺 commit_files」**拒写**（fail-closed）。
- `ac207_read_and_write` 抽出为**单点**（读→判定→写），selfcheck 直接驱动**产品函数本身**——⛔ 不让夹具复刻判定逻辑（硬规则 4 推论三）。
- 痕迹可区分（硬规则 3b）：筛不出实现提交时单独打 `AC207-NO-IMPLEMENTATION-COMMIT`，与「任务没跑完」区分开；载体行数不变即此处不写。
- 附带修复（同一次跨机 e2e 暴露）：`produced_by_driver` 不得由 `git … | grep -q` 判定——`set -o pipefail` 下 grep 命中即退出 ⇒ git 收 SIGPIPE ⇒ 管道 141 ⇒ **判据恰在条件成立时取假**。改为先取回文本再 `case` 匹配。实测该竞态依宿主 grep：本机 GNU grep 读满 EOF，旧写法 10/10 通过（本地行为控制是空转）⇒ 本机可用的确定性判据只有**形状**（函数体里不存在管道进 grep）。

### AC1 缺陷存证（改前读数）

载体现存那条记录全文（`/home/yale/work/quay/.quay/productization-verification.jsonl`，`grep -c 'GOAL-009-AC-207'` = 1）：

```json
{"build_sha":"a2a5aac0366f74d2a3af509664ab8cc9046aa83d","ts":"2026-09-11T01:21:19Z","ac":"GOAL-009-AC-207","host":"orangevps","project_root":"/home/yale/quay-verify-coldstart-a2a5aac0-root","commit_sha":"77794075008c776d289539111f73b422d1bb03e3","task_id":"e2e-verify-207","task_status":"done","gate_events":1,"produced_by_driver":true}
```

远端两条对照（`ssh orangevps` → `git -C /home/yale/quay-verify-coldstart-a2a5aac0-root show --stat`）：

```
=== 77794075 ===
77794075008c776d289539111f73b422d1bb03e3
tasks: 翻 e2e-verify-207 done（driver 机械 fan-in）
 tasks/e2e-verify-207.md | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)          ← 改动全在 tasks/ 之下 ⇒ 记账提交

=== 12899cd ===
12899cdb55e9294258425e72d7cce9855f1cb91f
feat(e2e-verify-207): add e2e-marker.txt marker (ac207)
 e2e-marker.txt | 1 +
 1 file changed, 1 insertion(+)                          ← 触及 e2e-marker.txt ⇒ 实现提交
```

⇒ 载体里那条 `commit_sha` 指向的是**记账提交** `77794075`，而同一项目的实现提交是 `12899cd`。**判据当时只看 `commit_sha` 非空**，故两者不可区分。

### AC2 写入点选对（真实跨机 e2e，能取假）

**① 用固定后脚本跑的真实跨机 e2e**：先在 orangevps 上跑了 `--ac207-e2e`（`/home/yale/ac207fix/run2.sh`，2026-09-11T02:30:20Z 起、02:45 止），该项目的 drivers 驱动任务到 done 后写出记录。**当时执行的脚本与分支上的脚本字节相同**（md5 `dc355c49dea76c67c8f1e5dd60775174`，两侧一致）。

记录（`/home/yale/ac207fix/evidence2.jsonl`，`produced_by_driver=1` 前提齐备）：

```json
{"build_sha":"7e5b8d24bb154f21b239605db3e94e84c68159fc","ts":"2026-09-11T02:30:20Z","ac":"GOAL-009-AC-207","host":"orangevps","project_root":"/home/yale/quay-ac207fix2-root","commit_sha":"9634afd47662a3f133cce7e6cc0b40ac1e49a766","commit_files":["e2e-marker.txt"],"task_id":"e2e-verify-207","task_status":"done","gate_events":1,"produced_by_driver":true}
```

该 sha 的 `git show --stat`（远端，同一项目）：

```
9634afd47662a3f133cce7e6cc0b40ac1e49a766
e2e(e2e-verify-207): add e2e-marker.txt proving real worker-driven implementation commit
 e2e-marker.txt | 1 +                                   ← 不在 tasks/ goals/ .quay/ 之下 ⇒ 实现提交
```

**取假关键**：读出该记录那一刻，`--all` 里**最新**的提交是 `588efc7 tasks: 翻 e2e-verify-207 done`（记账）；旧写法（`grep -v 'chore(quay-init):' | head -1`）会取到它，新写法跳过后取到 `9634afd`。

**② 独立复核：用产品函数直接读两个真实 e2e 项目**（函数体由 `sed` 从产品脚本自身逐字取出执行，⛔ 不手抄判定逻辑）：

```
── [a2a5aac0] root=/home/yale/quay-verify-coldstart-a2a5aac0-root
   task_status=done
   commit_sha=12899cdb55e9294258425e72d7cce9855f1cb91f
   commit_files=["e2e-marker.txt"]
   gate_events=1 produced_by_driver=1 evaluated=1 host=orangevps
   newest 3 commits (--all)：
     7779407 tasks: 翻 e2e-verify-207 done（driver 机械 fan-in）      ← 旧写法会取这条
     be34315 tasks: reset e2e-verify-207 done→ready
     854134d tasks: 翻 e2e-verify-207 done（driver 机械 fan-in）
   selected commit git show --stat:
     12899cdb55e9294258425e72d7cce9855f1cb91f feat(e2e-verify-207): add e2e-marker.txt marker (ac207)
      e2e-marker.txt | 1 +
   bookkeeping? (0=记账 1=实现) 1

── [ac207fix2] root=/home/yale/quay-ac207fix2-root
   task_status=done
   commit_sha=9634afd47662a3f133cce7e6cc0b40ac1e49a766
   commit_files=["e2e-marker.txt"]
   gate_events=2 produced_by_driver=1 evaluated=1 host=orangevps
   newest 3 commits (--all)：
     581e9a7 tasks: 翻 verify-task-234 done（driver 机械 fan-in）     ← 旧写法会取这条
     076de0a tasks: reset verify-task-234 done→ready
     972dbf9 tasks: 翻 verify-task-234 done（driver 机械 fan-in）
   selected commit git show --stat:
     9634afd47662a3f133cce7e6cc0b40ac1e49a766 e2e(e2e-verify-207): add e2e-marker.txt proving real worker-driven implementation commit
      e2e-marker.txt | 1 +
   bookkeeping? (0=记账 1=实现) 1
```

两个真实项目里，最新提交都是**别的**记账提交，新实现都越过它们取到实现提交。

### AC3 负控制（只有记账提交 ⇒ 不写记录 + 可区分痕迹）

`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck`（exit 0 / PASS），其中 AC3 的两条控制**同一夹具、同一产品函数，唯一差别是有无实现提交**：

```
selfcheck: ac207-e2e-write(bookkeeping-only) above=0 line=0 trace=1 (expect 0 / 0 / 1 — 不写记录 + AC207-NO-IMPLEMENTATION-COMMIT 痕迹, ⛔ 不拿记账充数)
selfcheck: ac207-e2e-write(with-impl-commit) line=1 files=["e2e-marker.txt"] (expect 1 / ["e2e-marker.txt"] — 同一夹具加一条实现提交即写, 故 39 的「不写」非恒真)
selfcheck: ac207-select(bookkeeping-only) out='' rc=1 (expect '' / non-0 — 筛不出 ⇒ 上游不写记录, ⛔ 不拿记账充数)
selfcheck: ac207-is-bookkeeping(tasks-only)=1 (expect 1 — 只动 tasks/ ⇒ 记账)
selfcheck: ac207-is-bookkeeping(marker-file)=1 (expect 1 — 动了 e2e-marker.txt ⇒ 实现)
```

- **载体行数前后读数**：`above=0` → `line=0`（不写），痕迹 `trace=1`（`AC207-NO-IMPLEMENTATION-COMMIT` 单独一行，非静默）。
- **正对照**（防恒真）：同一夹具加一条实现提交 ⇒ `line=1`，`commit_files=["e2e-marker.txt"]`。
- `ac207-is-bookkeeping(tasks-only)=1` 与 `(marker-file)=1` 是**同一条提交信息文本、不同文件**的翻转 ⇒ 证明判的是**触及的文件**而非关键词。

### AC4 判据已收紧（能取假）

把 `goals/AC-207-*.md` 的 criterion **逐字**（pyyaml 解析 `criterion:` 键，⛔ 不手抄）在**临时载体** `/tmp/ac207-ac4/.quay/productization-verification.jsonl` 上干跑（生产载体此时未被触碰）：

```
=== CASE A: 记账提交（commit_sha=77794075…, commit_files=["tasks/e2e-verify-207.md"]）⇒ 期望 exit 1 ===
EXIT_A=1

=== CASE B: 实现提交（commit_sha=12899cd…, commit_files=["e2e-marker.txt"]）⇒ 期望 exit 0 ===
EXIT_B=0

=== CASE C: 老形态记录（无 commit_files ＝ 生产载体现存那条原文）⇒ 期望 exit 1 ===
EXIT_C=1
```

⇒ 负控制能取假（A=1），正控制能通过（B=0），**且旧形态记录（本缺陷的产物）现在被拒（C=1）**。注入只发生在 `/tmp` 临时载体上，生产载体未污染。

### AC5 既有达成不被推翻

用**同一次真实运行**（`a2a5aac0-root`——就是产出那条记账 `commit_sha` 记录的那一次）的实现提交 `12899cd`，由**产品函数** `ac207_read_and_write` 跨机补写一条合规记录（函数体同样由 `sed` 逐字取自产品脚本）：

```
== ac207_read_and_write root=/home/yale/quay-verify-coldstart-a2a5aac0-root build_sha=a2a5aac0366f74d2a3af509664ab8cc9046aa83d ts=2026-09-11T03:07:12Z host=orangevps ==
  task_status=done commit_sha=12899cdb55e9 commit_files=["e2e-marker.txt"] gate_events=1 produced_by_driver=1 evaluated=1 host=orangevps
  ac207 record written → /home/yale/ac207fix/ac207-record-a2a5aac0.jsonl
```

落进生产载体的那行：

```json
{"build_sha":"a2a5aac0366f74d2a3af509664ab8cc9046aa83d","ts":"2026-09-11T03:07:12Z","ac":"GOAL-009-AC-207","host":"orangevps","project_root":"/home/yale/quay-verify-coldstart-a2a5aac0-root","commit_sha":"12899cdb55e9294258425e72d7cce9855f1cb91f","commit_files":["e2e-marker.txt"],"task_id":"e2e-verify-207","task_status":"done","gate_events":1,"produced_by_driver":true}
```

判据干跑（载体行数 59→60，AC-207 记录 1→2；主检出与 worktree 两份 `productization-verification.jsonl` 同步追加，保持字节一致）：

```
=== criterion 干跑（cwd=主检出）⇒ exit 0 ===
EXIT_MAIN=0
=== criterion 干跑（cwd=worktree）⇒ exit 0 ===
EXIT_WT=0
```

⛔ AC4 的负控制未被放宽：CASE A / CASE C 仍是 exit 1（该收紧一字未动）。**顺带核 AC-214 未被本条推翻**：新增记录的 `build_sha` 到 develop-tip 的交付面提交距离 = **24 ≤ K(200)** ⇒ `bash <AC-214 criterion>` **exit 0**。

### AC6 全量绿

`bash scripts/test.sh`（worktree 内，全量、无 `--for-task`）：

```
ℹ tests 7380
ℹ pass 7372
ℹ fail 0
ℹ cancelled 0
ℹ skipped 8
__GROUP__ concurrency=6 files=595 sum_ms=2647025 floor_ms=441170.8333333333 capped=0
tmux-leak-scan: clean — no NEW residual test tmux servers/dirs (delta vs the before-run snapshot)
SUITE_RC=0
```

`grep -c '^✖'` = 0（日志里 3 处 `passed=false` 是测试**标题**，不是失败）。scoped 门同样绿：`scripts/test.sh --for-task gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit --allow-thin` ⇒ `SCOPED_RC=0`（12/12），`--write-scoped-gate-cache` 已写。
