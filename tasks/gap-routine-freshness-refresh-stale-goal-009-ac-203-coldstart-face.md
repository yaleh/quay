---
id: gap-routine-freshness-refresh-stale-goal-009-ac-203-coldstart-face
title: "freshness-refresh: AC-203's newest delivery evidence is build_sha
  2d3a6fa3580947889d42f8234e9d2fe389386f18 (2026-09-18T04:32:56Z, carrier line
  262); d=161 of K=200 leaves margin 39"
status: done
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
AC-203's newest delivery evidence is build_sha 2d3a6fa3580947889d42f8234e9d2fe389386f18 (2026-09-18T04:32:56Z, carrier line 262); d=161 of K=200 leaves margin 39 (fraction 0.195) below the 0.2808 threshold a coldstart-face run needs, so a run started after the next 2h look lands past the window.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789909757223` · ts `2026-09-20T13:09:17.223Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`develop-deliver-tgz.sh`、`GOAL-009-AC-203`、`goal-freshness-margin`
- 涉及文件：
- `plugin/freshness-producers.json:37`
- `plugin/freshness-producers.json:39`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl:262`
- `plugin/scripts/develop-deliver-tgz.sh`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Re-run the coldstart-face producer on hosts B C (one run refreshes AC-203/207/232 together) against the current develop tip.

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-203-coldstart-face`（routine `freshness-refresh`，runId `freshness-refresh-1789909757223`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【修掉】（失败步骤具名 + 有对照），并【实跑产出者】刷新了主体。⛔ 不是「已注意到」。**

### ① 立案读数 → 处置后读数

| 量 | 立案时（finding ts `2026-09-20T13:09:17.223Z`） | 处置后 |
|---|---|---|
| AC-203 最新载体记录 `build_sha` | `2d3a6fa3580947889d42f8234e9d2fe389386f18`（`2026-09-18T04:32:56Z`，carrier line 262） | `c80040ad49b335df44269ac07ea829d2a3511843`（`2026-09-20T13:50:36Z`，= 当前 develop tip） |
| `d`（K=200） | **161** | **0** |
| `margin = K − d` | **39** | **200** |

⛔ 上表的 `d` 不是从快照抄的：同一谓词对两个 sha 各跑一次
`git rev-list --count <sha>..develop -- <交付面路径>` ⇒ pre-fix `2d3a6fa3` = **161**、post-fix `c80040ad4` = **0**
（交付面路径按判据同一规则机械推导自 `packages/quay/package.json` 的 `files` + `plugin` + `packages/quay-native/src`，⛔ 不手写清单）。
**零计数的对照动作 = 这条**：谓词在旧 sha 上取到 161 ⇒ 它不是恒绿。

### ② 「失败在哪一步」—— 重跑为什么跑不动（逐字，含对照）

⛔ 本 finding 的 `suggestedAction`（「重跑产出者」）**在执行前是不成立的**：产出者的第 1 步就是坏的。
`2026-09-20T13:16:37Z` 的一次重跑逐字落痕（`.quay/ac203-coldstart-rerun-20260920T131637Z.log`，全文 4 行）：

```
develop-deliver: develop tip = c80040ad49b3 (c80040ad49b335df44269ac07ea829d2a3511843)
develop-deliver: creating detached worktree at develop tip: /home/yale/work/quay/.quay/deliver-worktree-c80040ad49b3
develop-deliver: package.sh (quay .tgz)...
develop-deliver: BUILD FAILED — see worktree /home/yale/work/quay/.quay/deliver-worktree-c80040ad49b3
```

失败链（每一步都有文件落点）：

```
build_develop_tgz: git worktree add --detach <develop-tip>
  ⇒ 全新 worktree 无 vendor bundle
  ⇒ packages/quay/scripts/package.sh:60-61
  ⇒ plugin/scripts/sync-vendor.sh:505  node scripts/stamp-version.mjs --mode build --git-root <worktree>
  ⇒ scripts/resolve-version.ts:212  "HEAD is detached and carries no version tag"
  ⇒ evaluated:false ⇒ scripts/stamp-version.ts:318-326  return 3（"nothing was written"）
  ⇒ sync-vendor.sh:57  set -euo pipefail 中止 ⇒ package.sh 走 error 分支
  ⇒ npm pack 从未运行 ⇒ BUILD FAILED
```

**对照（同一 commit `c80040ad4`，2026-09-20 本机实测一对，其余变量只有「HEAD 是否 detached」）**：

```
detached worktree:  STAMP-VERSION: NOT-EVALUATED — HEAD is detached and carries no version tag   rc=3
branch   worktree:  STAMP-VERSION: OK — all 4 carriers already == 0.10.0-dev; wrote nothing        rc=0
```

**为什么此前一直是好的（时间次序对照，⛔ 不是推测）**：`--detach` 自 `2026-08-11 14:21:53Z`（`7c147b390`，DIR-123）
就在该脚本里；而「detached HEAD ⇒ NOT-EVALUATED」这一支是 **`2026-09-20T04:19:23Z`（`7dc6bfcba`）** 才落的。
最后一次成功的冷启动面载体记录是 `2026-09-18T04:32:56Z` —— **早于**该 commit。
⇒ 回归窗口与「证据从哪天起不再更新」在时间上闭合。（定位命令：
`git log --oneline -S'worktree add --detach' -- plugin/scripts/develop-deliver-tgz.sh` 与
`git log --oneline -S'HEAD is detached and carries no version tag' -- scripts/resolve-version.ts`。）

### ③ 修法

提交 `151465ddd`（本任务 worktree 分支）：

- `build_develop_tgz` 改用 **transient branch** `deliver-build-<sha12>`（`git worktree add -B`）——**同一个 commit、同一份产物**，
  变的只是「build 能读到的 git 上下文」；并加一条 `deliver-build-*` 清扫。
  **「只扫孤儿」是实测过的，⛔ 不是推理**：在本次在飞运行占着该分支时执行
  `git branch -D deliver-build-c80040ad49b3` ⇒ `error: cannot delete branch ... used by worktree at ...`，rc=1。
- `plugin/test/develop-deliver-tgz.test.mjs` 新增一条，钉住**命令行**（⛔ 不是整文件——文件自己的注释里就写着 `--detach` 三个字，
  整文件匹配是错的仪器）。**能取假（突变实测）**：把该行改回 `--detach` 后重跑 ⇒ `fail 1 / pass 0`。
- 该测试文件已在 `## Touches` 内声明（见文末）。

### ④ 实跑产出者（Requested action 的答复）

命令逐字：

```
bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root /home/yale/work/quay
```

`13:21:57Z`（运行日志文件名自带）→ `13:57:29Z`（实测退出时刻）。本地日志全文 22 行，关键行逐字：

```
develop-deliver: creating build worktree on branch deliver-build-c80040ad49b3 at develop tip: ...
  → .../quay-0.10.0-dev.tgz
  → .../quay-native-0.10.0-dev.tgz
develop-deliver: B (orangevps...) remote verify rc=0 evidence_lines=10
EVIDENCE-TRANSPORT appended=10 carrier=.../productization-verification.jsonl
develop-deliver: evidence-completeness COMPLETE present=6
develop-deliver: e2e-pairing E2E-PAIR OK host=orangevps roots=/home/yale/quay-verify-coldstart-c80040ad-root
develop-deliver: C (ad-arm1...) remote verify rc=0 evidence_lines=9
EVIDENCE-TRANSPORT appended=9 carrier=.../productization-verification.jsonl
develop-deliver: evidence-completeness PARTIAL present=5 missing=1 list=GOAL-009-AC-205
develop-deliver: e2e-pairing E2E-PAIR OK host=instance-20221019-1509 roots=/home/yale/quay-verify-coldstart-c80040ad-root
develop-deliver: --verify-coldstart PARTIAL
```

**⛔ 该运行退出码是 `rc=2`（PARTIAL），不是 0**（`develop-deliver-tgz.sh:1900-1902`：transport 成功但某 host 缺记录 ⇒ exit 2，
与 `rc=0`/`rc=1` 三态可区分）。缺的唯一一条是 **host C 的 `GOAL-009-AC-205`** —— 这不是本次新伤：
`2026-09-18T04:32:56Z` 那次运行的收尾逐字也是 `C ... PARTIAL present=5 missing=1 list=GOAL-009-AC-205`。
原因写在 `plugin/freshness-producers.json` 的 `session-delivery.preconditions`：AC-205 需要验证机上有一个【活】且
settings 允许 inbound 的会话，**该前置不由本仓库保证**；本次 host B 满足了（B 侧 `evidence-completeness COMPLETE present=6`），
host C 没有。⇒ **本 finding 的主体 AC-203 与它同一次运行的 AC-207/AC-232/AC-201 在【两台】机器上都落了记录**，
唯一缺席的那条属于另一条 producer（session-delivery），且是本文件早已写明的「先要满足前置」的那条。

载体侧（`.quay/productization-verification.jsonl` 272 → 291，+19 条）本主体新增记录，`build_sha` 全为当前 develop tip：

| host | ts | ac | build_sha |
|---|---|---|---|
| `orangevps`(B) | `2026-09-20T13:23:10Z` | AC-203 / AC-207 / AC-232 / AC-201 / AC-205 | `c80040ad49b3` |
| `instance-20221019-1509`(C) | `2026-09-20T13:50:36Z` | AC-203 / AC-207 / AC-232 / AC-201 | `c80040ad49b3` |

闭环自证（⛔ 不靠「记录存在」反推）：两台机的远端日志各带
`VERIFY-RC 0` + `E2E_CLOSURE_AC203_WRITTEN_THIS_RUN=1 E2E_CLOSURE_AC207_WRITTEN_THIS_RUN=1` +
`E2E_CLOSURE_SELF_EVIDENCED=1`（AC-203 与 AC-207 由**同一次运行**对**同一** `project_root` 写出）。
host B 侧那次 e2e 的靶任务 `e2e-verify-207` 由**那个项目自己的 driver** 驱动到 `done`（其 git log：`e4594de`），
另一条 `verify-task-234` 同样 `done`（`aee748a`）—— 证明的是「第三方项目自身的 worker-driver 能产出真实实现提交」，不是本仓库的代跑。

### ⑤ 判据本体逐字跑

criterion 由 `goals/AC-214-…md` frontmatter 经文首的 `yaml` 解析器取出（`.quay/ev/extract.mjs`），
与上一轮取出的副本 `diff` **完全相同** ⇒ 跑的是正文，⛔ 不是引述。处置后 stdout 逐字（stderr 空）：

```
freshness GOAL-009-AC-201: 0/200 (margin 200)
freshness GOAL-009-AC-232: 0/200 (margin 200)
freshness GOAL-009-AC-205: 0/200 (margin 200)
freshness GOAL-009-AC-207: 0/200 (margin 200)
freshness GOAL-009-AC-203: 0/200 (margin 200)   ← 本 finding 的主体
freshness GOAL-009-AC-238: 48/200 (margin 152)
freshness GOAL-009-AC-239: 48/200 (margin 152)
EXIT=0
```

### ⑥ 硬规则 5b 扫描：同一载体里其它 `worktree add`

`grep -rn 'worktree add' plugin/scripts/*.sh plugin/scripts/*.ts` ⇒ **4 处**，逐处分类：

1. `plugin/scripts/develop-deliver-tgz.sh:1707` —— **本缺陷，已修**（②③）。
2. `plugin/scripts/verify-deliver-coldstart.sh:848` —— **同族、潜伏未发**：它同样在 detached worktree 里跑 `package.sh`（`:851`），
   但只经 `--build-root` 可达。**当前没有任何 producer 传该 flag**（三条 producer 命令行都是本地 build + `--tgz`）
   ⇒ 本次要恢复的运行不会踩到它。**本任务⛔未改它**：改它需要跑通一次 `--build-root` 全流程才算验证过，超出本任务范围；
   记录在此供后续立案。
3. `plugin/scripts/publish-dist-branch.sh:99` —— detached worktree，**但**它的 `stamp-version` 调用带 `--git-root ${REPO_ROOT}`
   （真检出，非 worktree），从不读那个 detached HEAD ⇒ **结构上安全**（这正是它不踩该分支的原因）。
4. `plugin/scripts/integration-batch-merge.sh:968` —— detached worktree 只用于 merge，**从不 build** ⇒ 安全。

### ⑦ 本任务未做的事（⛔ 逐条，不以沉默代替）

⛔ 未改 `plugin/freshness-producers.json`：producer 命令行不变（修的是它调用的脚本内部），映射与主体归属均无需变更。
**但附一条本任务实测到的量**（⛔ 不是「已注意到」，是留给后续的读数）：该文件给 coldstart-face 记
`wallclock_hours: 0.34`（= 20m36s）。本次运行实测 **≈35.5 min**（`13:21:57Z → 13:57:29Z`），
而 `2026-09-18` 那次约 21 min ⇒ 这个 W 是**下界而非中心值**，且该方向是危险方向（文件自己的话：W 只会上抬阈值，
即高估 ⇒ 早立案（安全）；低估 ⇒ 晚立案（丢窗口））。⛔ 本次仍未改它：该文件把 W 定义为「**一次**观测到的端到端墙钟」并要求
每条目自带出处，改它是对一个阈值单源的改动、不是本任务的副产品；两条样本也不足以定值（该腿时长由 e2e 驱动，天然可变 ——
与文件对 upgrade-face 的 `0.38` 所写的「floor to re-measure, not a settled constant」同形）。
⛔ 未改 `K`、未改 `criterion`、未动 `.quay/routine-findings.jsonl`、未改本 finding 的 `files:`/`symbols:` 观测面。

### ⑧ 续做轮（2026-09-20）：上一轮 fan-in `step=suite` red 的真因与修法

上一轮 exited-not-landed 在 `step=suite`，失败断言 `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal`，
失败文件 `plugin/test/sh-census-check.test.mjs`。fan-in 的 delta 相关度提示把该文件判为 `UNRELATED` ——
**该提示是错的，本任务就是真因**（提示自身已声明「不是结论，复现即当真」；这里复现了，且根因机械可考）。

- 读数：`embeddedInterpreterLines` **live 9503 / committed baseline 9504**。AC6 要求两者**相等**（不只是 ≤）
  —— 所以**下缩也会红**，这正是该断言存在的理由（记录收益、防止日后 +1 悄悄回涨）。
- 根因（逐文件实测，用 checker 自己的原语 `countCodeLines`）：本任务对 `plugin/scripts/develop-deliver-tgz.sh`
  的修改把 `if [ -e ... ]; then …; fi` 三行 stale-worktree 清理折成一行 `[ -e ... ] && { …; }`
  ⇒ 该文件有效行 **2355 → 2354（−1）**。该文件**在轴内**（`python3` 在命令位；checker 自己的读数 `embedded:["python3"]`，`exception:false`）。
- **残差 = 0，且是结构性为 0**（⛔ 不是抽样）：`git diff develop HEAD --name-only` 只有两个路径，
  其中唯一的 `*.sh` 就是它；另一个是 `plugin/test/develop-deliver-tgz.test.mjs`，`.mjs` 不在 `*.sh` 普查内。
- 修法 = **下锚**（该文件自己的 `_note`：「Lowering a baseline is the intended direction … needs no ceremony,
  but the file change must still be committed」）：`plugin/sh-census-baseline.json` 9504 → 9503，
  并按该文件的 `_reanchorLog` 约定补一条带 attribution 的条目（约定「最后一条的 `to` 等于文件末尾两个数值」——已校验 `true`）。
- 实测（修后，逐字）：

```
node --experimental-strip-types --test plugin/test/sh-census-check.test.mjs
  ℹ tests 20   ℹ pass 20   ℹ fail 0
node --no-warnings --experimental-strip-types plugin/scripts/sh-census-check.ts --root <worktree>
  PASS — embeddedInterpreterLines=9503 ≤ 9503, duplicateCopies=0 ≤ 0 (headBaseline 9504)   rc=0
```

**5b 扫描：还有谁按「shell 行数」设闸** ⇒ 只有 `sh-census-check` 这一族：
`grep -rln 'sh-ratchet|RATCHET_BASELINE|ratchet-baseline'` **零命中**；读同一份基线文件的只有 4 处
（`sh-census-check.ts` / 其测试 / `runner-static-gate.ts` / `checker-mutation-cases/sh-census-check.sh`），
其中 mutation case **自建 hermetic fixture**（自带 `{0,0}` 基线，与真实基线文件无关）⇒ 不受影响；
`quay-init` closure ratchet 只覆盖 4 个文件（`plugin/.claude-plugin/plugin.json`、`plugin/.claude/launch.settings.json`、
`plugin/.quay/profiles.yml`、`plugin/scripts/quay-init.sh`）⇒ **不含本次改动的任何文件**。

**新增 Touches 一项**：`plugin/sh-census-baseline.json`（anti-drift 要求 diff ⊆ 声明，故必须声明）。

## Touches
- `plugin/freshness-producers.json`
- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/sh-census-baseline.json`
- `plugin/test/develop-deliver-tgz.test.mjs`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-203-coldstart-face.md`