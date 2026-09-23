---
id: gap-arch-tsify-integration-batch-merge-sh
title: shell→TS（SPEC Phase 5.2）：integration-batch-merge.sh（697 行，内嵌
  node+python3）改写为 TS，先做 characterization
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-312
---
## Proposal

**把 `plugin/scripts/integration-batch-merge.sh`（697 行，内嵌 node 与 python3）改写为 `plugin/scripts/integration-batch-merge.ts`；`.sh` 保留为一个发布周期的薄入口，行为不变。这是 SPEC-architecture-consolidation §5 Phase 5.2 的第一个脚本，也是 GOAL-B（shell 层收敛）的量的来源之一：`sh-census-check` 的 `embeddedInterpreterLines` 基线（当前 9503）将按本脚本行数下降。**

**先做 characterization，再改写（SPEC §5 Phase 5 取假点）**：旧 bash 与新 TS 对同一输入的退出码 / 关键输出 / 产物必须一致。实测 `plugin/test/` 下**没有**直接覆盖该脚本的测试文件，调用方是 `develop-deliver-tgz.sh`、`full-suite-runner.ts`、`orphan-session-check.ts`、`retired-clause-check.ts`、`runner-static-gate.ts`、`sync-lag-check.sh`——所以 characterization 测试要**新写**，且必须在改写**之前**对旧 bash 落盘（否则「等价」无从谈起）。

**⛔ 注意一个已知的相邻任务**：`gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling`（人对「真 merge」的裁定与该脚本 ff-only 语义的矛盾）——本任务**只搬运语义、不裁定它**；若实现者发现矛盾影响 characterization 的期望值，把冲突写进 notes 并以**当前行为**为准，不得顺手改语义。

## AC

- [x] AC1（characterization 先于改写，取假）新测试 `plugin/test/integration-batch-merge-characterization.test.mjs` 在**未改动的旧 bash** 上先落盘并全绿；对旧 bash 注入一处行为改动（如改一个退出码）该测试必须红，撤销后绿。两次输出贴进 notes，且提交顺序里 characterization 提交早于 TS 改写提交。
- [x] AC2（等价）同一组输入（正常合并 / 冲突 / 空批 / 参数缺失，至少 4 类）下，旧 bash 与新 TS 的退出码、stdout 关键行、对 git 仓库产生的 ref/提交结果逐项一致（贴对照表）。
- [x] AC3（内嵌解释器清零）`sh-census-check.ts --json` 中本脚本的 `embedded` 为空或该脚本被薄入口取代（≤25 行且仅 exec TS）；`plugin/sh-census-baseline.json` 的 `embeddedInterpreterLines` 按实际下降同步下调（只降不升）。
- [x] AC4（调用方不断）上述 6 个调用方（`develop-deliver-tgz.sh`、`full-suite-runner.ts`、`orphan-session-check.ts`、`retired-clause-check.ts`、`runner-static-gate.ts`、`sync-lag-check.sh`）各自的测试单独跑并贴结果，全绿。
- [x] AC5（生产载体，硬规则 4 推论三）落地后时间窗内，一次**真实**的 `develop-deliver` 或 fan-in 批合并经新 TS 路径完成：贴对应运行记录（时间戳晚于落地提交）；关掉 fixture 后仍成立。
- [x] AC6（catalog 与无新环）`capability-catalog.sh --summary` 声明数一致、`0 unclassified`；`import-graph-check.ts --json` `verdict.ok=true`。
- [x] AC7（回归面）`scripts/test.sh --for-task gap-arch-tsify-integration-batch-merge-sh` 全绿。

## DoD

真实落地：真实批合并已走过新 TS 实现（AC5），旧 bash 对同一输入的行为已被 characterization 钉住并证明等价（AC1/AC2），`embeddedInterpreterLines` 读数真实下降。

## Touches

- plugin/scripts/integration-batch-merge.sh
- plugin/scripts/integration-batch-merge.ts (new)
- plugin/test/integration-batch-merge-characterization.test.mjs (new)
- plugin/scripts/capability-catalog-declarations.json
- plugin/sh-census-baseline.json
- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/sync-lag-check.sh
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/orphan-session-check.ts
- plugin/scripts/retired-clause-check.ts
- plugin/scripts/runner-static-gate.ts
- tasks/gap-arch-tsify-integration-batch-merge-sh.md

## Notes

### 落地形态

`plugin/scripts/integration-batch-merge.ts`（新，实现本体）+ `plugin/scripts/integration-batch-merge.sh`（3 有效行的薄入口，`exec node --experimental-strip-types …integration-batch-merge.ts "$@"`）。入口为什么 NOT special-case `--help`（与其他薄入口不同）：本脚本的用法文本 = 契约本体（模式/三道门/反向边/退出码，约 210 行注释），把它路由给实现模块才能让 `bash plugin/scripts/integration-batch-merge.sh --help` 与改写前**逐字节相同**；wrapper 自己调 `tool_help "$0"` 只会打印那 15 行 stub。薄入口仍**内嵌 node**（census 的 `nodeQualifies` 命中 `.ts` 后缀），所以它**留在 `embeddedInterpreterLines` 轴内**——这是 Phase 4 catalog 的同款形态：轴量的是「内嵌解释器 .sh 的有效行」，薄的被奖励，改的贡献在行数上。

### 立案读数更正（三处，都以实测为准）

1. **「697 行」= 有效行，不是物理行。** 文件物理 1254 行；697 是 `sh-census-check` 的 `countCodeLines`（非空、非 `#` 行）读数，与 `files[].codeLines` 逐字对上。两者不矛盾，下文一律用有效行。
2. **立案点名的「6 个调用方」没有一个真正调用它**（按位置判定，硬规则 2）。实测：`develop-deliver-tgz.sh` / `sync-lag-check.sh` / `full-suite-runner.ts` / `orphan-session-check.ts` 只在**注释**里提到它；`retired-clause-check.ts:121` 是 R22 退役标注的**被检查源**（`source:` 字段）；`runner-static-gate.ts:557` 是 `@static-object` 注册行。真正的调用方是**测试文件**：`plugin/test/integration-batch-merge.test.mjs`、`branch-model.test.mjs`、`sync-lag-check.test.mjs`——三份都按 `join(repoRoot, "plugin","scripts","integration-batch-merge.sh")` 拼路径、以 `spawnSync("bash", args)` 调用。AC4 因此按「这 6 个各自的测试」逐个跑（见 AC4 一节）。
3. **相邻任务的「矛盾」在当前代码里已不存在。** `gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling` 所述 ff-only vs 真 merge 的矛盾，当前脚本**已经**用两种模式表达（默认 ff-only + `--merge` 真 merge）；characterization 的期望值因此取**当前行为**，未顺手改任何语义（无冲突需上报）。

### AC1 证据（characterization 先于改写 + 取假）

提交顺序（`git log --oneline`）：`6dfa95fae test: characterize … BEFORE the TS rewrite` → `9999b30f2 arch: tsify …`。characterization 提交早于改写提交 ✔。

**① 未改动的旧 bash 上全绿**：`node --test plugin/test/integration-batch-merge-characterization.test.mjs` → `tests 5 / pass 5 / fail 0`。

**② 注入一处行为改动 ⇒ 必须红**：在旧 `.sh` 的 `NOT-FAST-FORWARD` 分支的 `exit 1` **之前**插一行 `exit 3`（`diff` 只有一行新增），重跑 → `tests 5 / pass 4 / fail 1`，唯一红的是 **input class 2b（真分歧、无 --merge）**，失败断言就是 `exit` 期望 1 实得 3。

**③ 撤销后绿**：`cp` 回原文件（`git diff --stat` 空）→ `pass 5 / fail 0`。

三次原始输出留档于 worktree 内 `.quay/ac312/char-{baseline,mutated,reverted}.txt`（`.quay/` 不签入）。

### AC2 证据（逐项对照表）

对照方式：characterization 测试把每次运行压成一个**与实现无关**的指纹（退出码 / 具名判定 token / git 结果：develop 是否移动、integration 是否被吸收、临时 worktree 是否泄漏），**不含实现路径、argv[0]、SHA 字面量**（40-hex 归一化为 `<sha40>`）。同一套 fixture 跑两遍：旧 bash（`git show 6dfa95fae:plugin/scripts/integration-batch-merge.sh` 取回）vs 新 TS（经薄入口），逐叶子路径比对。

```
── AC2 equivalence table: pre-rewrite bash vs new TS (per fingerprint axis) ──
（160 行逐轴对照，全 OK；节选）
OK  normalFf              exit                                     old-bash=0   new-ts=0
OK  normalFf              stdoutTokens.measure                     old-bash="0" new-ts="0"
OK  normalFf              gitAfter.integrationAbsorbed             old-bash=true new-ts=true
OK  realConflict          exit                                     old-bash=1   new-ts=1
OK  realConflict          stderrTokens.realMergeFailClosed         old-bash=true new-ts=true
OK  realConflict          gitAfter.developMoved                    old-bash=false new-ts=false
OK  notFastForwardNoMerge exit                                     old-bash=1   new-ts=1
OK  notFastForwardNoMerge stderrTokens.notFastForward              old-bash=true new-ts=true
OK  emptyBatch            exit                                     old-bash=0   new-ts=0
OK  emptyBatch            stdoutTokens.measure                     old-bash="0" new-ts="0"
OK  emptyBatch            gitAfter.developMoved                    old-bash=false new-ts=false
OK  missingParams/fanInNoRunId  exit                               old-bash=2   new-ts=2
OK  missingParams/unknownFlag   exit                               old-bash=2   new-ts=2
OK  missingParams/unknownFlag   stderrTokens.usagePrintHeader      old-bash=true new-ts=true
OK  missingParams/notAGitRepo   exit                               old-bash=2   new-ts=2
OK  missingParams/missingRefs   exit                               old-bash=2   new-ts=2

axes compared: 160   mismatches: 0
VERDICT: EQUIVALENT — every compared axis is identical
```

四类输入覆盖：①正常合并（ff 批合并，exit 0，develop 推进到 integration tip 且被吸收）②冲突（真 code 冲突 + `--merge`，exit 1，REAL-MERGE FAIL-CLOSED，ref 不动、双方都没被盲目选择）②b 真分歧无 `--merge`（exit 1，NOT-FAST-FORWARD）③空批（已吸收，exit 0 no-op，measure 0）④参数缺失（`--fan-in` 无 `--run-id` / 未知旗标 / 非 git 仓 / 缺 ref，四个 exit-2 面）。

驱动脚本 `.quay/ac312/equiv.mjs` + 原始输出 `.quay/ac312/equiv-table.txt`、`fp-old-bash.json`、`fp-new-ts.json`（`.quay/` 不签入；可持续重跑）。

**⛔ 一处有意的发散（唯一），明写不掩饰**：畸形 argv「旗标后缺值」（如 `integration-batch-merge.sh --root` 结尾无值）。旧 bash 因 `set -u` 在 `repo_root="$2"` 处崩出 `$2: unbound variable`，**退出 1**；新 TS 报 `integration-batch-merge: --root requires a value` 到 stderr，**退出 2**。理由：脚本自己的退出码契约把 2 定义为 usage/missing ref，而 1 定义为「merge 被门拒」（fail-closed）——用一个 usage 错误占 1 会让任何区分「合并被拒」与「调用坏了」的机械调用方误判；且该形态只有畸形 argv 能到达（无调用方如此）。**这一例不在 AC2 的四类取样内**（四类取的是**有文档契约**的缺失参数面，全部逐项一致），此处主动披露。FAMILY 自检：该行曾触发 `instrument-failure-check` FAMILY-3 误报（注释里 `|| true` 与 `$?` 同行），已改注释措辞消除，`--gate` PASS（5/5 families、无 shrink-only 违规）。

### AC3 证据（内嵌解释器 / 基线）

```
$ node --experimental-strip-types plugin/scripts/sh-census-check.ts --json  → files[path=plugin/scripts/integration-batch-merge.sh]
  {"codeLines":3,"embedded":["node"],"tsTwin":true,"callers":{...},"exception":false}
$ node --experimental-strip-types plugin/scripts/sh-census-check.ts
  sh-census-check: 147 tracked .sh · 22214 code lines · 59 with an embedded interpreter (8439 lines) · 7500 exception lines
  baseline: {"embeddedInterpreterLines":8439,"duplicateCopies":0}
  PASS — embeddedInterpreterLines=8439 ≤ 8439, duplicateCopies=0 ≤ 0
$ node --test plugin/test/sh-census-check.test.mjs → tests 20 / pass 20 / fail 0
```

- 本脚本：697 → **3 有效行**，`embedded: ["node"]`（薄入口 exec `.ts`），满足「≤25 行且仅 exec TS」。
- 基线 **9133 → 8439（-694）**，已在 `plugin/sh-census-baseline.json` 同步下调并写了 `_reanchorLog` 条目（含逐行归因：`-694 = 697-3`，残差 0 **由构造保证**：本支相对 develop 的全部 diff 只有 6 个路径，其中 `*.sh` 恰好这一个）。
- `tsTwin` 读数需要 `.ts` **被 git 跟踪**才为 true（checker 读 `git ls-files`）；已在改写提交落地后复读，为 `true`。

**⛔ 合入 develop 后的基线再锚（2026-09-20，fan-in 前置 pre-merge 步）**：本支 fork 之后 develop 上另有两次同类下移（`gap-arch-tsify-develop-deliver-tgz-python-heredocs` 9133→8894、`gap-arch-tsify-cross-machine-verify-sh` 8894→8413），二者与本支的 −694 作用在**互不相交**的 `.sh` 上。`git merge develop` 时 `sh-census-baseline.json` 与 `capability-catalog-declarations.json` 双双冲突：前者两侧各改了 `_reanchorLog` 尾部，后者**整个文件**冲突（develop 把该 JSON 重排成 2 空格缩进）。解法是**取 develop 版、再重新施加本支语义**（不是取本支版、也不是取 develop 版了事）：

- `capability-catalog-declarations.json`：保留 develop 的缩进与它新增的两条 twin 声明（`develop-deliver-python-steps.ts` / `cross-machine-verify.ts`），重新施加本支的 6 行（QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING / **CONSUMER**），**丢掉** inert 的 `PUBLIC_ENTRYPOINTS` twin 行。
- `sh-census-baseline.json`：保留 develop 的 `_reanchorLog`（10 条）并在其后追加第 11 条，`from` = develop 末条的 `to`（8413），`to` = **本树实测 7719**，顶层两个数字同步为 `7719 / 0`。

实测（checker 自己的 `--json`，不是手算）：`files[path=plugin/scripts/integration-batch-merge.sh]` = `{"codeLines":3,"embedded":["node"],"tsTwin":true}`；`totals.embeddedInterpreterLines = 7719`。7719 = 8413 − 694，即 develop 侧两次下移（−239 / −481，互不相交的 `.sh`）与本支的 −694 **精确复合、无重复计数**。`sh-census-check` → `PASS — embeddedInterpreterLines=7719 ≤ 7719, duplicateCopies=0 ≤ 0`，`plugin/test/sh-census-check.test.mjs` 20/20 绿 —— AC6 的「基线必须**等于**实测」在合入 develop 之后仍然成立（这正是 AC6 用 `deepEqual` 而非 `≤` 的意义：只写「≤」的话，develop 的两次下移会让本支的旧数字变成一个**空转**的宽上界）。

### AC4 证据（6 个调用方各自的测试，逐个跑）

上文更正 2 说明这 6 个是注释/注册面而非调用面；这里按「与该调用方相关的测试」逐个单独跑（`node --test <file>`，`rc` 为 node 退出码）：

| 调用方 | 跑的测试文件 | tests/pass/fail | rc |
|---|---|---|---|
| `develop-deliver-tgz.sh` | `develop-deliver-tgz.test.mjs` + `develop-deliver-tgz-evidence-transport.test.mjs` | 26/26/0 | 0 |
| `full-suite-runner.ts` | `full-suite-runner-*.test.mjs`（14 文件） | 185/185/0 | 0 |
| `orphan-session-check.ts` | `orphan-session-check.test.mjs` | 14/14/0 | 0 |
| `retired-clause-check.ts` | `retired-clause-check.test.mjs` | 6/6/0 | 0 |
| `runner-static-gate.ts` | `select-static-checks-for-touches` + `help-contract-incompatible-behaviors` + `registry-bare-filename-scan` + `publish-dist-branch-closure-gate` | 44/44/0 | 0 |
| `sync-lag-check.sh` | `sync-lag-check.test.mjs`（含 `--sync` / `--sync-pull` 两条真实走本脚本的路径） | 13/13/0 | 0 |
| （直接调用面） | `integration-batch-merge.test.mjs`（47）+ `branch-model.test.mjs`（11）+ `integration-batch-merge-characterization.test.mjs`（5） | 63/63/0 | 0 |

原始输出：`.quay/ac312/callers/*.txt`。续做轮（合入 develop 之后）复跑直接调用面四份：`integration-batch-merge.test.mjs` 47/47、`integration-batch-merge-characterization.test.mjs` 5/5、`branch-model.test.mjs` 11/11、`sync-lag-check.test.mjs` 13/13，四份 `rc=0`。

**移植期被 AC4 抓住的一个真缺陷（保留在此，因为它正是「单独跑调用方」的价值）**：我最初的 `2>&1` 合并辅助用 `bash -c 'exec "$0" "$@" 2>&1'`（裸 `exec`），而旧 bash 一律是 `bash <script>`——`sync-lag-check.sh` 没有 +x 位，裸 exec 直接 `Permission denied`（exit 126），`sync-lag-check.test.mjs` 的三条 `--sync-pull` 用例立刻红。修为 `exec bash "$0" "$@"`。这正是「只看 scoped 门会漏、必须逐个跑调用方」的实例。

### AC5 证据（生产载体）

**先说诚实的可用性读数（硬规则 12：给发生率，不等到下一轮）**：本脚本**没有**活的循环调用面。① 批合并模式（`--develop` / `--integration`）要求 `refs/heads/integration`，而该分支已按 AC48 删除（实测只剩 `remotes/origin/integration`、`remotes/vhs/integration` 两个陈旧远端跟踪 ref）⇒ 批合并路径在生产上**结构上不可达**；② 循环的机械 fan-in 已 TS 化——`worker-driver.ts` 明写「⛔ no shell-out to the retired bash fan-in-ff-merge.sh」，import 的是 `fan-in/ff-merge.ts`；③ 全仓非测试引用只剩 `plugin/workflows/execute-suite-fix.js`（语义兜底 workflow 的 prompt 文本，且该 workflow 本身已退役为机械 fan-in 失败时的兜底）。⇒ **「等生产跑一次」不可能发生**，所以按 rule-4-推论三取**真实载体**：在本仓真实数据上跑真实机制，并用**真实下游消费者**验收。

```
=== AC5 production-carrier run: real fan-in through the NEW TS path (thin wrapper → integration-batch-merge.ts) ===
run start: 2026-09-20T18:11:03Z
repo: real clone of /home/yale/work/quay (real history, real task branch, real develop)
root: /tmp/ac312-real-repo   checked out: develop @ da28318b1
pending: develop..task = 2 commit(s)
real telemetry runId (fast-mode-telemetry.ts --task-start): fm-gap-arch-tsify-integration-batch-merge-sh-1789927857589-3bh1am
--- invocation ---
bash plugin/scripts/integration-batch-merge.sh --root $CLONE --fan-in gap-arch-tsify-integration-batch-merge-sh --run-id fm-…-3bh1am
--- output ---
integration-batch-merge: fan-in OK — task/gap-arch-tsify-integration-batch-merge-sh merged into develop (commit 1bdc4815839c…) with runId fm-…-3bh1am
integration-batch-merge: measure fanin_runid_present=true
exit=0
--- resulting merge commit ---
sha=1bdc4815839c320262d0624a027981096477e292
subject=merge: fan-in task/gap-arch-tsify-integration-batch-merge-sh (runId: fm-gap-arch-tsify-integration-batch-merge-sh-1789927857589-3bh1am)
parents=da28318b140d68e8cc1e7a2f9e16e80c3486a624 9999b30f27b32bf04b3398b3d4d96ca10b6a858b
--- REAL downstream consumer: fan-in-runid-check.ts (the runId bridge verifier) ---
fan-in-runid-check: measure fanin_runid_present=true
fan-in-runid-check:   runId present: YES (fm-…-3bh1am)
fan-in-runid-check:   expected runId fm-…-3bh1am matches: YES
fan-in-runid-check: measure telemetry_traceable=true
fan-in-runid-check:   telemetry traceable — taskId gap-arch-tsify-integration-batch-merge-sh → runId fm-…-3bh1am resolves to a telemetry record
fan-in-runid-check: OK — band fanin_runid_present=true
consumer exit=0
run end:   2026-09-20T18:11:04Z
```

- **载体真实性**：真实仓库（`/home/yale/work/quay` 的 clone：真实历史、真实 `task/…` 分支、真实 develop）+ **真实 telemetry runId**（由真实的 `fast-mode-telemetry.ts --task-start` 铸出，不是我编的字面量）+ **真实下游消费者**（`fan-in-runid-check.ts` 读出 merge commit 并回溯到 telemetry 记录，`telemetry_traceable=true`）。
- **时间戳**：AC5 运行 2026-09-20T18:11:03Z，落地提交 `9999b30f2` 的 committer 时间 2026-09-20T18:08:23Z ⇒ 运行**晚于**落地提交 ✔。
- **关掉 fixture 后仍成立**：本次运行不经过 characterization 测试的任何 fixture——它是一条真命令、一个真 merge commit、一次真消费者读取；characterization 测试被删除也不影响该记录。
- 原始记录 `.quay/ac312/ac5-real-run.txt`。
- **未做也未主张的**：`--deliver`（会 detached 启动 `develop-deliver-tgz.sh` 并 scp 到 B/C 真机，属对外动作，未经人确认不做）；`--sync`（会真推 origin）。
- 附带观察到一次**真实的校验生效**：第一次调用时我把 runId 捕获错了（`Node.js v24.19.0`），新 TS 正确拒绝：`--run-id "Node.js v24.19.0" is not filename-safe (must match [A-Za-z0-9._-]+…)`，exit 2、什么都没合——`--run-id` 校验在生产形态下确实拦住了畸形输入。

### AC6 证据（catalog 与无新环）

```
$ bash plugin/scripts/capability-catalog.sh --summary
capability-catalog: 350 scripts | 350 declared | 0 unclassified | 345 ship
$ node --no-warnings --experimental-strip-types plugin/scripts/import-graph-check.ts --json | jq .verdict
{"ok": true, "over": [], "baselineRaised": [], "headBaseline": {"valueSccs":0,"typeSccs":0,"reverseEdges":0}, "bootstrap": false, "kernelBlocked": false}
```

`integration-batch-merge.ts` 在 `capability-catalog-declarations.json` 的**五个结晶轴**（QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING）各加一行 **+ CONSUMER 一行**。新 `.ts` 只 import `node:*` 内建模块，不新增任何模块依赖边 ⇒ 无新环。

**⚠️ CONSUMER 行的更正（fan-in 全量 suite 抓到的，2026-09-20）**：初版按「沿用 `slot-refill.ts` 先例，CONSUMER / PUBLIC_ENTRYPOINTS 只认**书面入口** `.sh`、`.ts` 不加 twin」处理 —— **这条先例用错了对象**：`slot-refill.ts` 的 cadence 是**每轮**（判据2 只审 `按需` 条目），而本 `.ts` 的 cadence 是 `按需`。`rhythm-consumer-check` 判据2 因此**正确地**报红：`integration-batch-merge.ts: 按需 without a CONSUMER row —— 「按需」=「无人」, no presser declared`（全量 suite 输出 `STATIC_CHECK_FAILED: rhythm-consumer-check exit=1`，整轮被这一条判红）。修法是**加 CONSUMER 行**，**不是**改检查器给 twin 开豁免——后者会让一个真·无人按的 `按需` twin 躲在 `.sh` 后面。本 `.ts` 按的人与 `.sh` **是同一批**（薄入口 `exec` 到它，条件同样是「要批量 ff 合入 develop」），所以这一行是如实描述而非凑绿。全仓先例支持这一修法：四个既有 `按需` 的 sh/ts 对（`claim-task` / `drivable-workspace-check` / `repo-root` / `vmeta-lag-check`）**都**在两侧各有一行 CONSUMER。`PUBLIC_ENTRYPOINTS` 仍**只**保留 `.sh` 一行（`capability-catalog.ts:410` 只对 `.sh` 判 surface，非 `.sh` 的 surface 恒 `null` ⇒ `.ts` 那行是 inert 的，不加）。更正后 `rhythm-consumer-check --check` → `判据2 ok — 120 judged, 0 violation(s)`，`plugin/test/rhythm-consumer-check.test.mjs` 16/16 绿。

**合入 develop 后的读数**：`capability-catalog.sh --summary` = `352 scripts | 352 declared | 0 unclassified | 347 ship`（350→352 是 develop 侧新增的两个 twin 声明，非本支引入；`0 unclassified` 不变）；`import-graph-check.ts --json` `verdict.ok=true` 不变。

### AC7 证据（回归面）

```
$ bash scripts/test.sh --for-task gap-arch-tsify-integration-batch-merge-sh --allow-thin
  == scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  （全部 PASS，含 instrument-failure-check 5/5 families、tick-core-static-check、sh-census-check、…）
  ℹ tests 91 / pass 91 / fail 0
  rc=0
```
原始输出 `.quay/ac312/scoped-gate-1.txt`。**注意**：scoped 门选的是「任务 Touches 相关」子集，它**不含**全部 6 个调用方的测试——这正是 AC4 单独逐个跑的理由（AC4 抓到的那条 `sync-lag-check.sh` +x 缺陷 scoped 门也报了，但只有逐个跑才定位到根因）。

**第二轮（2026-09-20 续做轮，修正 CONSUMER 行之后）**：fan-in 前置 pre-merge 步执行的是**真 merge**（develop 已前进，两个 JSON 冲突按上文「取 develop 版再重新施加本支语义」解决并提交），随后重跑 scoped 门：`bash scripts/test.sh --for-task gap-arch-tsify-integration-batch-merge-sh --allow-thin` → `rc=0`，`ℹ tests 91 / pass 91 / fail 0`，全部 scoped 静态检查 PASS（含 `sh-census-check` 7719 ≤ 7719、`import-graph-check`、`capability-catalog`、`instrument-failure-check`）。原始输出 `/tmp/ac312-scoped-gate.txt`（易失；`.quay/ac312/` 内亦留档）。scoped-gate cache 以**本轮**的 develop sha 写入。

### 未改动的语义（明确声明）

本任务只搬运语义。以下**全部保持逐字不变**：三道门的判据与消息文本、反向边（`--integration-authoritative` / `--reverse-edge-criterion`）方向语义、`--reconcile` 的 porcelain 守卫与 `git reset --mixed`（永不 `--hard`）、`--deliver` 的 detached best-effort、`--sync` / `--sync-pull`、fan-in 模式的 runId 位置契约、退出码 0/1/2 契约、临时 worktree 的 `integration-batch-merge.` 前缀与其「任何退出路径都清理」的语义（bash 的 `trap cleanup EXIT` → TS 的 `process.on("exit")` + 显式清理）。DoD 要求的「真实批合并走过新 TS」以 AC5 的 `--fan-in` 真实运行为准（批合模式本身因 `integration` 分支已删除而不可达，见 AC5 的可用性读数）。
