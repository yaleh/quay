---
id: gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env
title: driver-anchor 环境泄漏的 QUAY_GOAL_ACCEPTANCE_ACTIVE=1 被 suite 继承 ⇒ 8 个 goal
  家族测试文件恒红（同一份与 delta 无关的红，视 anchor 谱系时而落地、时而烧到重试上限）——scripts/test.sh 入口归一化块（既有
  unset FORCE_COLOR 那一块）缺了这个成员
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** finding

## Finding

**同族已有先例，本条是它的缺失实例**：`scripts/test.sh:167-176` 已有一块 **entry normalization**，其唯一既有成员是
`unset FORCE_COLOR`，自述理由逐字是「Normalize HERE at the entry so EVERY child process / spawnSync inherits the
unset var (AC2: entry-level, never a single-point patch)」（配套任务 `gap-suite-force-color-ansi-test-sh-normalize`，done）。
**同一个块里少了一个成员**：`QUAY_GOAL_ACCEPTANCE_ACTIVE` —— 硬规则 5b 的形态（修的人只盯被报出来的那一个，
而兄弟实例在同一个文件、同一个代码块里）。

**它是什么**：`GOAL_ACCEPTANCE_ACTIVE_ENV`（`packages/quay/src/goal-store.ts:118`）是**判据重入闸** ——
跑 goal 判据前置位、嵌套调用读到 `"1"` 即短路（`goal-store.ts:1784/1992`、`goal-driver.ts:639`）。
它的语义是**「本进程正在跑判据」**，因此**绝不该被子进程继承**。

**泄漏链（逐层实测，⛔ 非转述）**：

1. 常驻 `driver-anchor`（本工作区实测 `/proc/2391720/environ`）**带着 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`** ——
   PPID=1（启动者已退出），即它是从一个已导出该变量的 shell 启动的。
2. 该 anchor 派生的 worker-driver / worker 会话**继承**它：本 worker 自己的会话进程 `/proc/2808476/environ` 实测带它。
3. `plugin/scripts/suite-driver.ts:176` 的 spawn 用 `env: { ...process.env, … }` ⇒ 随 fan-in 传进 `scripts/test.sh` ⇒ `node --test`。
4. `scripts/test.sh` **只 unset `FORCE_COLOR`**（`:176`），没有 unset 它。

**后果（实测；同一 worktree、同一 HEAD，被红测试文件与 develop 逐字节相同 ⇒ 与任何任务 delta 无关）**：

上一轮 ac295 的 fan-in suite 日志
`.quay/fan-in-suite-gap-ac295-criterion-cmdline-port-literal-stale~wk-prod-anchor~1790189536705-d5c44a.log`：
`# fail 30`，而 `__PERFILE__ … passed=false` **恰好 8 个文件**（`goal-driver-s02/s04/s10/s12/s13`、
`l1-delivery-surface-check`、`goal-store`、`goal-invariants-standing`），其余文件全部 `passed=true`
⇒ 30 条失败**全部**落在这 8 个 goal 家族文件里。

**受控 A/B（一行复现，本次实测）**：

```
QUAY_GOAL_ACCEPTANCE_ACTIVE=1     node --test plugin/test/goal-invariants-standing.test.mjs ⇒ 红（assertion，actual:[]）
env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --test plugin/test/goal-invariants-standing.test.mjs ⇒ 19/19 pass
```

⇒ 这 8 个文件是**环境产物**，不是代码缺陷。

**发生率（硬规则 12：先给已经发生过几次）**：载体 `.quay/worker-outcome.jsonl`（append-only、不轮转）中，
带 `mechanical_fan_in.suiteSignatures` 且含本条签名 `缺口立案侧：违反且无在飞任务 ⇒ standing-violated（可立案）`
的记录 **2 条** —— `gap-fan-in-delta-classify-declared-doc-surfaces` @2026-09-23T18:53:27.828Z 与
`gap-ac295-criterion-cmdline-port-literal-stale` @2026-09-23T18:56:12.532Z，两条均 `step=suite, outcome=red`。

**泄漏不是恒在的 —— 这正是它危险的地方**：同族 17 个任务（ac179、ac288-ac294、ac296-ac303）在
2026-09-24T00:31–02:23 全部 `done` 落地，而那段时间 anchor 未被污染；同一批任务在 09-23 更早的窗口里则可能被卡。
⇒ **症状取决于 anchor 谱系，不取决于任务 delta**：同一份与 delta 无关的红，有时豁免落地、有时把任务烧到重试上限。

**为什么修在入口而不是各测试内**：入口归一化是既有设计（`unset FORCE_COLOR` 就在同一块），
逐个测试加 `env -u` 是第二个定义面，且新测试会持续漏掉。

## Acceptance Criteria

- [x] **AC1（能取假 —— 双向控制，⛔ 不靠读源码）**：一条新测试对**入口本身**取读数：以导出
  `QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 的父环境调用 `scripts/test.sh` 的最小形态，断言**子进程看不到该变量**；
  随后对**未修的**入口（或把修复回退）跑同一读数，结果必须**相反**。两条读数都贴逐字输出。
  ⛔ 只断言「test.sh 里有 unset 那一行」不算（硬规则 2：按位置判定，不按关键词）。
  ⇒ 读数见 §Evidence-AC1：改后 `✔ arm A · pass 2 · fail 0 · EXIT=0`；回退（`git diff` 只差一个 token）`✖ arm A · pass 1 · fail 1 · EXIT=1`。
- [x] **AC2（生产载体 · 硬规则 4 推论三）**：落地后，**在导出 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 的外层环境下**，
  经 `scripts/test.sh` 真跑上一轮红的 8 个 goal 家族文件 ⇒ 全绿；贴命令 + 逐文件 `passed=true` 计数。
  ⛔ fixture/注入 seam 单独满足不算；⛔ N 只计【实现落地之后】的时间窗。
  ⇒ 见 §Evidence-AC2：改后 **8/8 `passed=true`**、`tests 136 / pass 136 / fail 0 / EXIT=0`；同一条命令在回退树上 **7/8 `passed=false`、`fail 29 / EXIT=1`**。
- [x] **AC3（不削弱闸本身）**：重入闸在**它该生效的地方**仍然生效 —— `goal-store` / `goal-driver` 里
  「带闸 ⇒ 跑判据深度 1、`env -u` ⇒ 深度 ≥3」那两条既有判据**逐字仍绿**（贴读数）。
  ⛔ 修的是「子进程不该继承」，不是「把闸拆了」。若某条既有判据**依赖环境里带着闸**，必须点名并说明改法。
  ⇒ 见 §Evidence-AC3：两条 **✔**（污染环境下）；点名结论＝**0 条**既有判据依赖环境带闸（各自设/各自清，逐个点名）。
- [x] **AC4（同族枚举 · 硬规则 5b）**：对 `scripts/test.sh` 的入口归一化块**及** `suite-driver.ts` 的 spawn env
  做逐项枚举：列出全部「driver/anchor 会继承、而测试语义要求其缺席」的环境变量候选，逐项贴
  「已 unset / 不需 unset（一句为什么）/ 需 unset 但本条未做（为什么）」。
  ⛔ 给不出枚举 ⇒ 视为只修了被报出来的那一个。
  ⇒ 见 §Evidence-AC4：13 项逐项判定（含实测锚点 environ），第三类 **0 条**。
- [x] **AC5（不回归）**：`bash scripts/test.sh --for-task <本任务>` 绿，且本任务 delta 只触及 `## Touches` 内路径。
  ⇒ 见 §Evidence-AC5。

## Definition of Done

**REAL LANDING（DIR-026 Reading A）**：不是「test.sh 加了一行」，而是**一条在污染环境下经入口真跑、且由生产载体留痕的绿读数**：

1. **落地对象**：入口归一化经提交落 develop（`scripts/test.sh` 的 unset，或 `suite-driver.ts` spawn env 剔除），
   且 AC1 的双向控制在**改后**的树上取到两个相反读数。
2. **生产载体**：AC2 的读数来自真实 `scripts/test.sh` 调用（不是 fixture 直接 import `node --test`），
   且发生在实现落地**之后**；贴逐文件 `passed=true` 与总数。
3. **闸未削弱**：AC3 两条既有判据逐字仍绿。
4. **家族差量**：AC4 的逐项枚举贴出，证明不是「只修了被报出来的那一个」。
5. **⛔ 三种凑绿禁止**：改测试断言；把这 8 个文件从 suite 选择面里排除（skip / 黑名单 / 收窄 glob）；
   只在 anchor 启动处硬删该变量而不处理「子进程不应继承」这一语义。三项均不得发生。

## Touches

- `scripts/test.sh`
- `plugin/scripts/suite-driver.ts`
- `plugin/test/test-sh-entry-normalization.test.mjs`
- `tasks/gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env.md`

## Evidence — 实现落点（本轮）

- `scripts/test.sh:216` —— 入口归一化块的**第二个成员**，与既有成员同一条语句：
  `unset FORCE_COLOR QUAY_GOAL_ACCEPTANCE_ACTIVE`（理由注释在 `:167-215`）。
  **为什么并进同一条 `unset` 而不是新起一行**：`sh-census-check` 的 `embeddedInterpreterLines` 是对
  「带内嵌解释器的 .sh」**代码行数**的 shrink-only 棘轮（`scripts/test.sh` 在其中，基线 7686；
  只加一行 ⇒ 7687 > 7686 FAIL，`plugin/sh-census-baseline.json` 的上限同样只能降）。net-zero 编辑是本块
  加成员的方式；注释不计数，代码行计数——注释里已把这个约束写死给下一个人。
- `plugin/test/test-sh-entry-normalization.test.mjs`（新增）—— 入口归一化的**读数器**（不是又一个断言某行的文本检查）。
  arm A＝本进程即入口的子进程，读它自己的 `process.env`（前置条件＝入口自己的 `QUAY_TEST_NESTED=1` 标记，
  缺它则报 **NOT-EVALUATED** 独立取值，⛔ 不与通过同形）；arm B＝自 spawn 的 `node --test` 控制子进程（注入标记＋闸），
  同一断言必须翻红 ⇒ 证明 arm A 是可取假的测量（硬规则 4），而不是恒真。
- `plugin/scripts/suite-driver.ts` —— **未改**，理由见 §Evidence-AC4 末段（DoD 的「或」取了入口侧；入口是
  CI 与本地唯一规范入口，覆盖 driver 路径**和**「人从污染 shell 直接跑」的路径）。

## Evidence — AC1（入口双向控制：同一条命令，改后 vs 回退，读数相反）

工具：`plugin/test/test-sh-entry-normalization.test.mjs`（新增）。

### ① 改后（HEAD `e1a1f1b1b`）

```
$ QUAY_GOAL_ACCEPTANCE_ACTIVE=1 bash scripts/test.sh --scoped plugin/test/test-sh-entry-normalization.test.mjs
✔ arm A — a child of scripts/test.sh sees no QUAY_GOAL_ACCEPTANCE_ACTIVE (entry-normalization reading) (0.563017ms)
✔ arm B — falsifiability control: the same assertion FLIPS when the guard is present (71.177392ms)
ℹ tests 2 · ℹ pass 2 · ℹ fail 0            ### EXIT=0
```

arm A 本次**已评估**（`grep -c NOT-EVALUATED` ⇒ `0`；未评估会在输出里显式出现）。逐字日志：
`/data/scratch/yale/ac-leak-evidence/ac1-POSITIVE-fixed.txt`。

### ② 修复回退（唯一差别——`git diff -- scripts/test.sh` 只差一个 token）

```
-unset FORCE_COLOR QUAY_GOAL_ACCEPTANCE_ACTIVE
+unset FORCE_COLOR

$ QUAY_GOAL_ACCEPTANCE_ACTIVE=1 bash scripts/test.sh --scoped plugin/test/test-sh-entry-normalization.test.mjs
✖ arm A — a child of scripts/test.sh sees no QUAY_GOAL_ACCEPTANCE_ACTIVE (entry-normalization reading) (1.385337ms)
  AssertionError [ERR_ASSERTION]: arm A: this process IS a child of scripts/test.sh (QUAY_TEST_NESTED=1) yet sees
  QUAY_GOAL_ACCEPTANCE_ACTIVE="1". The entry-normalization block of scripts/test.sh does not unset it, so the
  goal-layer re-entrancy guard leaks into the suite: every goal-family test whose subject runs a criterion reads a
  store that REFUSES (evaluated:false / guardRefused:true) and goes red for a reason unrelated to any delta.
  Fix the ENTRY (the `unset` next to `unset FORCE_COLOR`), never the individual test files.
✔ arm B — falsifiability control: the same assertion FLIPS when the guard is present (74.621737ms)
ℹ tests 2 · ℹ pass 1 · ℹ fail 1            ### EXIT=1
```

逐字日志：`/data/scratch/yale/ac-leak-evidence/ac1-NEGATIVE-unfixed.txt`（回退后已 `git checkout` 复原，`git status` 干净）。

### ⛔ 本文件为什么不自己 spawn `scripts/test.sh`（AC 的字面形态）

test-isolation 契约的 **R3 棘轮**挡住：`plugin/test-isolation-violations.txt` 是 shrink-only，报文逐字要求
「fix the test (… **stop spawning scripts/test.sh** …). **Do NOT add it to the list.**」（扫描面＝canonical test glob）。
⇒ 入口以【父进程】身份到达本文件（arm A 就是它的子进程），回退读数由同一条命令在回退树上取（②）。
**没有**把 spawn 挪进 `plugin/test/helpers/`、**没有**用拼接路径绕开扫描面、**没有**增长基线清单——
三者都是绕闸，本条走的是「把约束写在明面上」。

## Evidence — AC2（生产载体：污染环境下经入口真跑上一轮红的 8 个文件）

```
$ QUAY_GOAL_ACCEPTANCE_ACTIVE=1 bash scripts/test.sh --scoped \
    --test-reporter=spec --test-reporter=<repo>/plugin/scripts/measure-suite-reporter.mjs \
    --test-reporter-destination=stdout --test-reporter-destination=stderr \
    plugin/test/goal-driver-s02.test.mjs plugin/test/goal-driver-s04.test.mjs plugin/test/goal-driver-s10.test.mjs \
    plugin/test/goal-driver-s12.test.mjs plugin/test/goal-driver-s13.test.mjs plugin/test/l1-delivery-surface-check.test.mjs \
    packages/quay/test/goal-store.test.mjs plugin/test/goal-invariants-standing.test.mjs
```

（reporter 三 flag ＝ `scripts/test.sh` 自己的 `suite_reporter_flags()` 逐字那三个；⛔ 必须排在文件列表**之前** ——
`node --test` 只认 positional 之前的 flag，同 test.sh 对 `--test-name-pattern` 的既有注释。）

### ① 改后（HEAD `e1a1f1b1b`，实现落地之后）

```
__PERFILE__ duration_ms=262.01955  /…/plugin/test/goal-invariants-standing.test.mjs   passed=true
__PERFILE__ duration_ms=851.801373 /…/plugin/test/l1-delivery-surface-check.test.mjs   passed=true
__PERFILE__ duration_ms=1366.041284 /…/plugin/test/goal-driver-s12.test.mjs           passed=true
__PERFILE__ duration_ms=1623.811904 /…/plugin/test/goal-driver-s13.test.mjs           passed=true
__PERFILE__ duration_ms=2831.080207 /…/plugin/test/goal-driver-s02.test.mjs           passed=true
__PERFILE__ duration_ms=4083.215683 /…/plugin/test/goal-driver-s04.test.mjs           passed=true
__PERFILE__ duration_ms=5046.92967  /…/plugin/test/goal-driver-s10.test.mjs           passed=true
__PERFILE__ duration_ms=13002.56647 /…/packages/quay/test/goal-store.test.mjs          passed=true
ℹ tests 136 · ℹ pass 136 · ℹ fail 0        ### EXIT=0        ⇒ 8/8 passed=true
```

逐字日志：`/data/scratch/yale/ac-leak-evidence/ac2-POSITIVE-fixed.txt`。

### ② 同一条命令、修复回退（同 AC1 的单一 token 差别）

```
goal-invariants-standing=false · l1-delivery-surface-check=TRUE · goal-driver-s12=false · s13=false ·
s02=false · s10=false · s04=false · goal-store=false                      ⇒ 7/8 passed=false
ℹ tests 136 · ℹ pass 107 · ℹ fail 29       ### EXIT=1
```

（`l1-delivery-surface-check` 是这 8 个里唯一**不跑判据**的文件 ⇒ 闸泄漏与它无关，它两次都 `true`。
对照：上一轮 ac295 fan-in suite 日志 `# fail 30`，同一批 8 文件。）
逐字日志：`/data/scratch/yale/ac-leak-evidence/ac2-NEGATIVE-unfixed.txt`。

## Evidence — AC3（闸未削弱：两条既有判据逐字仍绿 + 依赖点名）

**POSITIVE（同一污染环境、经入口）——三个 `✔` 逐字**：

```
✔ AC1 — 递归结构上不可能：criterion 调 check --staleness ⇒ 跑判据深度 = 1（进程级观测，非 guard 断言） (180.928169ms)
✔ AC2 — 去掉闸 ⇒ 深度 ≥3：criterion 调 check --achieved-failing（env -u 清闸）递归；带闸 ⇒ 深度 1 (570.728261ms)
✔ AC-242 successor — 重入闸：轮转在 QUAY_GOAL_ACCEPTANCE_ACTIVE=1 下【拒绝】，⛔ 不返回空结果 (169.230544ms)
```

**NEGATIVE（同一次回退运行）**：前两条 `✖`，报文 `跑判据最大嵌套深度必须 = 1，实测 marker 行数 0`
—— 外层进程自己带着闸 ⇒ 判据**一次都没跑**（正是泄漏的签名，⛔ 不是闸被削弱）；第三条 AC-242 仍 `✔`
⇒ 闸的**拒绝语义**本身完好。

**点名（AC 要求「若某条既有判据依赖环境里带着闸，必须点名并说明改法」）——结论：0 条**。
每个需要闸的判据都**自己设**（`goal-store.test.mjs:1378`、`goal-driver-s04:35/:283`、`goal-driver-s10:125`、
`goal-standing-ac-reverify-scope:39`）；每个需要闸缺席的判据都**自己清**（`ac301-criterion-address-derivation:154` 的 `delete`、
`goal-criterion-timeout-resolution:88-104` 的子进程 env `delete`）。
最后一个是**同 5b 的局部补丁先例**（它同时清 `QUAY_ACCEPTANCE_*`）—— ⛔ 保留不动：入口清不掉
`QUAY_ACCEPTANCE_*`，而该文件要两者一起清；入口这条只接管「子进程不该继承」那一半。

## Evidence — AC4（同族逐项枚举：入口归一化块 + `suite-driver.ts` 的 spawn env）

枚举面：① `scripts/test.sh` 的入口归一化块（`:167-216`）与它读到的**全部** `${VAR}`（grep 实测）；
② `plugin/scripts/suite-driver.ts:176-181` 的 spawn env（`{...process.env, ...(env ?? {}), QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT: "1"}`）；
③ **实测锚点 environ**（`/proc/2391720/environ`，2026-09-24）——其 `QUAY_*` 只有 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 一个。

| # | 候选 | 判定 |
|---|---|---|
| 1 | `QUAY_GOAL_ACCEPTANCE_ACTIVE` | **已 unset**（本条）。语义＝「本进程正在跑判据」；锚点 environ 实测带着它 |
| 2 | `FORCE_COLOR` | **已 unset**（既有成员 `gap-suite-force-color-ansi-test-sh-normalize`）。语义＝输出设备能力，宿主态 |
| 3 | `QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT` | **不需 unset**：`suite-driver.ts:179` 在 spawn 那一刻注入的「driver 持槽」握手，入口是它的**消费者**（`test.sh:767`）⇒ 入口 unset 会把 `gap-mech-fan-in-suite-silence-watchdog-fired` 的静默看门狗 bug 放回来。实测锚点 environ 无（它从不比一次 spawn 活得更久） |
| 4 | `QUAY_TEST_NESTED` / `QUAY_TEST_NESTED_ROOT` | **不需 unset**：由 test.sh 自己（`mark_nested()`）给子树设置，语义＝「本次调用嵌套在一个正在跑的 suite 内」，边界是同根相等检查；入口 unset 会让嵌套调用去抢外层已持有的槽 ⇒ 卡死。**残余风险点名**：长命会话若带着 `=1` 且 ROOT 恰等于本仓根，外层 suite 会跳过取槽/静态检查/dist 重建；要收就改 ROOT 校验，⛔ 不是加 unset |
| 5 | `QUAY_TEST_SKIP_{RESOURCE_GATE,STATIC_CHECKS,DIST_BUILD,QUAY_REFRESH}` | **不需 unset**：显式逃生阀（调用者主动选）；非归档的**生产写入者 grep = 0** |
| 6 | `QUAY_ACCEPTANCE_{TIMEOUT_MS,CWD,ENV}` | **不需 unset**：判据解析的配置旋钮（env > `gates.timeoutMs` > 默认），继承即机制；依赖默认值的测试在**子进程**上局部清（specimen：`goal-criterion-timeout-resolution.test.mjs:88-104`） |
| 7 | `QUAY_MAX_CONCURRENT_SUITES` / `QUAY_SERIAL_CONCURRENCY` / `QUAY_LOWCONC_CONCURRENCY` / `QUAY_SUITE_SCHEDULER` / `QUAY_TEST_LPT_ORDER` / `QUAY_TEST_LPT_ROUNDS` / `QUAY_FS_TRACE_LIMIT` / `QUAY_PHASE_OVERLAP` / `LPT_BASELINE` / `QUAY_SCOPED_STATIC_EVIDENCE` | **不需 unset**：并发/调度/成本的配置面，继承就是它被设计出来的送达方式（「ONE-KEY ROLLBACK」等）；入口 unset 等于擅自改调用者的运行配置 |
| 8 | `NODE_OPTIONS` | **不需 unset**：生产量测载体（`full-suite-runner.ts:1866` 追加拿 per-file CPU preload）；unset 会让 `__PERFILE__` 成本字段变暗（缺字段＝未测量，不伪造 0） |
| 9 | `NODE_COMPILE_CACHE` | **不需 unset**：test.sh 自己设置（性能），只影响编译缓存，无判定语义 |
| 10 | `NODE_TEST_*`（`NODE_TEST_CONTEXT` 等） | **不需 unset**：node:test 自己的子进程协议，每个 per-file 子进程都靠它 |
| 11 | `TMPDIR` | **不需 unset**：宿主配置；测试按 `os.tmpdir()` 取，R8 已把「mkdtemp 落在共享检出」判红 |
| 12 | `LC_ALL` / `LANG` / `TZ` | **已归一（是【设置】不是 unset）**：`test.sh:272-274` 强制 `C.UTF-8`/`UTC`（2026-09-23 宿主 locale/TZ 那批红） |
| 13 | `CLAUDECODE` / `CLAUDE_*` / `AI_AGENT` | **不需 unset**：宿主会话继承（锚点 environ 里有）；读它们的都是「读不到就走退化路径」的形状（`run-identity.ts` 等），unset 反而破坏「我在一个 Claude 会话里」的判定 |

**第三类（需 unset 但本条未做）：0 条** —— 逐项判定见上；唯一近似者是 #4（残余风险已点名，修法不在此处）。

**为什么 `suite-driver.ts` 的 spawn env 不做剔除**（DoD 的「或」取了入口侧）：`scripts/test.sh` 是 CI 与本地**唯一**的规范入口
（ADR-019/DIR-109，其自述），入口归一化同时覆盖 driver 路径**和**「人从被污染 shell 直接跑」的路径（正是 AC2 的场景）；
在 suite-driver 再剔一遍是**第二个定义面**（`FORCE_COLOR` 那块的理由逐字反对 single-point patch），且只覆盖 driver 一条路。

## Evidence — AC5（不回归 + delta 范围）

- `bash scripts/test.sh --for-task gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env` ⇒ 见 fan-in 前的 scoped 门读数（本任务提交后在本 worktree 取）。
- delta（`git diff --name-only develop...HEAD`）＝ `scripts/test.sh`、`plugin/test/test-sh-entry-normalization.test.mjs`、`tasks/gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env.md`
  ⇒ **全部落在 `## Touches` 内**（`plugin/scripts/suite-driver.ts` 已声明但按上表判断不改，属允许的写入面之内、非必须触及）。
- **⛔ 三种凑绿均未发生**：未改任何测试断言（新文件是新增读数器）；未把这 8 个文件移出选择面（两次读数都在同一 glob 下取得）；
  未在 anchor 启动处硬删变量（改的是**入口**的 `unset`，处理的是「子进程不该继承」这一语义本身——闸在 goal-store/goal-driver
  的 set/restore 纪律原样保留，AC3 有读数）。
