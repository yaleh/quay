---
id: gap-arch-tsify-cross-machine-verify-sh
title: shell→TS（SPEC Phase 5.2）：cross-machine-verify.sh（489 行，内嵌 python3）改写为
  TS，先做 characterization
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-312
---
## Proposal

**把 `plugin/scripts/cross-machine-verify.sh`（489 行，内嵌 python3）改写为 `plugin/scripts/cross-machine-verify.ts`，`.sh` 留作薄入口一个发布周期。SPEC-architecture-consolidation §5 Phase 5.2；GOAL-B 的量来源之一。**

**调用方（实测 `git grep`）**：`packages/quay/src/observation.ts`（产品层运行时引用）、`plugin/scripts/periodic-push-backup.sh`、`plugin/scripts/quay-init.sh`、以及测试 `packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs`。**⚠️ `observation.ts` 属产品层（packages/）**——它对该脚本是**运行时 spawn 引用而非 import 边**（同 `gap-arch-reverse-edges-zero` 对 `ff-merge.ts` spawn 的定性），本任务不得把它变成 import 边：⇒ 若改写后要让产品层调用新 TS，路径解析必须走既有的 sibling-script 解析机制（`siblingScriptArgv`），并遵守 dist 自包含（不得让 bundle 依赖只在开发检出里存在的 .ts）。

**⛔ 与 `quay-init.sh` 的冲突面**：`quay-init.sh` 正在被 `gap-quay-init-native-reconcile`（SPEC Phase 5.1）整体改写。本任务对 `quay-init.sh` **只允许改「调用 cross-machine-verify」的那一处调用点，或干脆不碰**（薄入口保留时调用点可零改动）——优先零改动，避免与 5.1 抢同一文件。

**跨机器语义**：该脚本的判据涉及另一台机器，characterization 不得依赖真实远端；用可注入的传输缝（本地假远端）钉住行为。相关背景见 `gap-no-post-merge-cross-machine-verification-detection-latency-is-luck`、`gap-cross-machine-readonly-observation-orchestration-not-a-tool`——本任务只搬运现有行为，不扩展跨机器能力。

> **⚠️ 实现期实测更正（立案前提，如实）**：`git grep` 命中的 `observation.ts` 与那个 packages 测试对本脚本**都只是注释提及**——产品层**没有**运行时 spawn 引用（普查的 `callers.ts:1` 命中的就是那行注释）。所以「路径解析走 `siblingScriptArgv`」这一步在本任务里**无对象**；AC4/AC5 的实质（不引入 packages→plugin 边、不内联）仍然逐条取了读数。

## AC

- [x] AC1（characterization 先于改写，取假）新测试 `plugin/test/cross-machine-verify-characterization.test.mjs` 在**未改动的旧 bash** 上先落盘并全绿（用本地假远端，不依赖真实机器）；对旧 bash 注入一处行为改动，测试必须红，撤销后绿。两次输出贴进 notes，且 characterization 提交早于 TS 改写提交。
- [x] AC2（等价）至少 4 类输入（远端一致 / 远端落后 / 远端不可达 / 参数缺失）下，旧 bash 与新 TS 的退出码与 stdout 关键行逐项一致（贴对照表）；「远端不可达」必须给出**与「一致」不同形**的取值（硬规则 3b），两态输出贴出。
- [x] AC3（内嵌解释器清零）`sh-census-check.ts --json` 显示本脚本不再含内嵌 python3（或被 ≤25 行薄入口取代）；`plugin/sh-census-baseline.json` 只降不升地下调。
- [x] AC4（调用方不断）`observation.ts` 侧相关测试、`periodic-push-backup.sh` 的调用、`quay-init.sh` 的调用点各自验证并贴结果；`import-graph-check.ts --json` 的 `reverseEdges=[]` 且 `verdict.ok=true`（证明未引入 packages→plugin 边）。
- [x] AC5（dist 自包含，生产载体）`bash packages/quay/scripts/package.sh` 产出的 bundle 中，产品层对该脚本的引用仍走 sibling 解析、不内联 `plugin/scripts/cross-machine-verify`；`grep -c` 读数贴出。
- [x] AC6（生产载体，硬规则 4 推论三）落地后时间窗内，一次**真实**的跨机器验证运行经新 TS 路径产生读数（贴时间戳晚于落地提交的记录）；关掉本地假远端注入后仍成立。若当前环境无第二台机器，则把该条如实标 `NOT-EVALUATED` 并写明原因，不得用 fixture 顶替。
- [x] AC7（回归面）`scripts/test.sh --for-task gap-arch-tsify-cross-machine-verify-sh` 全绿。

## DoD

真实落地：新 TS 实现经一次真实（非 fixture）运行产出读数，或 AC6 被如实标为未评估；characterization 钉住了旧行为并证明等价；产品层依赖方向未被破坏（AC4/AC5）。

## 证据（AC 逐条）

**落地提交**：`80d9aa9f2`（characterization，先）→ `b83dc2485`（TS 改写）→ `111af8d92`（merge develop）→ `31bb61e4a`（isolation 修复）。分支 `task/gap-arch-tsify-cross-machine-verify-sh`。

**AC1 — characterization 先于改写，且可取假。✅**
新 `plugin/test/cross-machine-verify-characterization.test.mjs`（19 用例，覆盖 AC2 的四类输入）在**未改动的旧 bash** 上先落盘并 **19/19** 全绿；提交序 `git log --oneline --reverse develop..HEAD` = `80d9aa9f2 test(…) … BEFORE the TS rewrite` 早于 `b83dc2485 arch(…) the program moves into TS`。
夹具是**真的两台机器**：本地 bare repo 当共享 `origin`，两个真实 clone（`machine-a`/`machine-b`）扮演两台主机，机器身份走 `--machine` 旗标（不读 hostname），**不依赖真实远端**。
取假（负控制）：把旧 bash 的 note 写入行 `"verdict":"${gv}"` 改成 `"verdict":"green"`（其余一字不动）：
```
mutant          : # pass 18 / # fail 1   → not ok 10 - C2b（RED 判决的载体字段不再被记下）
baseline（未改动）: # pass 19 / # fail 0
```
撤销后回到 19/19。

**AC2 — 四类输入下旧 bash 与新 TS 一致。✅**
差分夹具：同一构造顺序 + 固定提交日期 ⇒ 两个夹具 commit sha 逐字相同；对**同一批 21 条 CLI 场景**分别跑旧 bash 与新 TS（`bash plugin/scripts/cross-machine-verify.sh` → thin entry → `.ts`）。
```
commands: 21 · exit-code equal: 21/21 · stdout byte-identical: 20/21 · stdout equal after masking volatile latency/timestamps: 21/21
CONTROL old-vs-old（同一实现跑两遍）: stdout byte-identical 19/21
```
⇒ 唯一那条字节差异是一个 `post_merge_latency_h` 的第 2 位小数（两次运行相隔数秒）。**这是被对照证明、不是被断言的**：把**同一个**旧实现跑两遍，它和自己就有 2 条不一致（19/21 < 20/21）——旧 vs 新的差异**小于**该实现自身的运行间抖动。

| # | 输入类 | 场景 | 旧 rc | 新 rc | stdout |
|---|---|---|---|---|---|
| 1 | C1 远端一致 | record-merge（冷，machine-A） | 0 | 0 | 逐字相同 |
| 2 | C1 | record-merge 重放（幂等） | 0 | 0 | 逐字相同 |
| 3 | C1 | verify（machine-B，绿门） | 0 | 0 | 仅 latency 掩码内 |
| 4 | C1 | report --json（machine-B） | 0 | 0 | 仅 latency 掩码内 |
| 5 | C1 | report（人读） | 0 | 0 | 仅 latency 掩码内 |
| 6 | C1 | verify by 合并者自己（skipped-participant） | 0 | 0 | 逐字相同 |
| 7 | C1 | gate-run RED（点名 `plugin/scripts/example.test.mjs`） | 1 | 1 | 逐字相同 |
| 8 | C1 | gate-run ERROR（exit 3） | 2 | 2 | 逐字相同 |
| 9 | C2 远端落后 | record-merge #2（暖态） | 0 | 0 | 逐字相同 |
| 10 | C2 | machine-b 侧 report --json（待验） | 0 | 0 | 逐字相同 |
| 11 | C2 | verify over RED gate | 1 | 1 | 逐字相同 |
| 12 | C2 | RED 判决后的 report --json | 0 | 0 | 逐字相同 |
| 13 | C2 | RED 判决后的 report（人读） | 0 | 0 | 逐字相同 |
| 14 | C3 远端不可达 | `--remote nope` | 2 | 2 | 逐字相同 |
| 15 | C3 | `--remote dead`（已配置但连不上） | 0 | 0 | 逐字相同 |
| 16–21 | C4 参数缺失 | 无 sha / 未知旗标 / 空 --branches / 非 git 仓库 / 分支不存在 / sha 非提交 | 2,2,2,2,2,0 | 同 | 逐字相同 |

**「远端不可达」与「一致」不同形（硬规则 3b）**——两态输出：
```
不可达: rc=2  stdout=""                                  stderr="cross-machine-verify: remote not found: nope"
一致  : rc=0  stdout='{\n  "verifier_machine": …\n…}'    stderr=""
```

**AC3 — 内嵌解释器清零 + 薄入口（双肢）。✅**
`node --experimental-strip-types plugin/scripts/sh-census-check.ts --json`：
- `files[path=plugin/scripts/cross-machine-verify.sh]` → `codeLines 489 → 8`、`embedded ["python3"] → ["node"]`、`tsTwin false → true`；
- `totals.embeddedInterpreterLines 8894 → 8413`；`plugin/sh-census-baseline.json` 同步**下调** 8894 → 8413（`_reanchorLog` 第 10 条，含逐字归因：−481 = 489−8，且本分支只动这一个 `.sh` ⇒ 残差 = 0）。
- 判据双肢都成立：`python3` 已不在 `embedded` **且** `codeLines 8 ≤ 25` ⇒ 是**薄入口**，不只是变短的程序。
- `sh-census-check` exit 0；`verdict.headBaseline = 8413`（「只降不升」收缩守卫通过）。

**AC4 — 调用方不断 + 未引入 packages→plugin 边。✅**
- `observation.ts` 侧测试 `packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs`：**3/3 pass**。⚠️ 该文件与 `observation.ts:2781` 对本脚本都**只是注释提及**（见 Proposal 下的更正），故无「引用」可解析；`packages → plugin` 边一条也没引入。
- `periodic-push-backup.sh` 两处调用点**零改动**，且**按调用方原样复现验证**：`bash "${SCRIPT_DIR}/cross-machine-verify.sh" --record-merge <tip> --branch develop --root <repo> >/dev/null 2>&1 || true` ⇒ 退出 0、本地 note 落盘、**stderr 为空**（薄入口带 `--no-warnings`；否则 Node 的 MODULE_TYPELESS 横幅会混进调用方读 CAUSE 的那条通道）。`plugin/test/periodic-push-backup.test.mjs` **6/6 pass**。
- `quay-init.sh` **零改动**（不抢 SPEC Phase 5.1 的文件）：`git diff --stat develop HEAD -- plugin/scripts/quay-init.sh` 为空；该文件对本脚本的唯一提及是 `:553` 的一行注释。
- `import-graph-check.ts --json` ⇒ `reverseEdges = []`、`valueSccs = []`、`verdict.ok = true`、`evaluated = true`。

**AC5 — dist 自包含（生产载体）。✅**
- `bash packages/quay/scripts/package.sh` ⇒ rc=0，`dist-closure gate OK: 106 referenced dist bundles all present`。
- **产品层未内联**：`grep -rl cross-machine-verify packages/quay/dist/ | wc -l` = **0**；`packages/quay/src/` 命中数 = **1**（就是那行注释）。
- 打包产物里该 sibling 由**既有 sibling 解析链**派生成 dist 入口（不是内联）：`tar tzf quay-0.12.0-dev.tgz | grep cross-machine-verify` ⇒
  ```
  package/plugin/scripts/dist/cross-machine-verify.js
  package/plugin/scripts/cross-machine-verify.sh
  ```
  且 staged 的 `.sh` 已被改写成 `IMPL="${SCRIPT_DIR}/dist/cross-machine-verify.js"`（从 tgz 解出后读到）。**实测跑过**：在解出的 staged 树上 `--help` 与 `--report --json` 均正常 ⇒ bundle 形态可执行，不是只存在于盘上的文件。
- ⚠️ 同样如实说明：这条 AC 的前提「产品层对该脚本有引用」不成立（见 AC4）——这里被验证的是**没有内联**这个实质，不是「一条引用的解析路径」。

**AC6 — 生产载体：一次真实（非 fixture）跨机器验证运行。✅**
在新 TS 路径上跑了一次**完整的、真实的**跨机器验证：`--root` = 真实检出、`--branch develop`、`--machine boheidc`（**本机就是真身**）、**无任何本地假远端注入**，读的是真实共享 notes 通道里**另一台真实机器** `ser702195427338` 记下的合并。
```
run started 2026-09-20T19:43:48Z        （落地提交 b83dc2485 的提交时刻 = 2026-09-20T19:33:02+00:00 ⇒ 严格在其后）
verify: verifying ce01b71a060a (merger=ser702195427338, verifier=boheidc) — running fast gate...
verify: ce01b71a060a verdict=green post_merge_latency_h=938.43
…（本窗口 6 条；此前一次窗口内另 18 条，合计 24）
cross-machine-verify: verify done (green 6 / red 0 / gate-error 0 / skipped-participant 310 / skipped-unattributed 273 / already-verified 18)
rc=0
run ended   2026-09-20T19:45:02Z
```
随后从**生产载体**读回：`--report --json` ⇒ `verified_merges: 24`（全部 `merger=ser702195427338` → `verifier=boheidc`、`verdict=green`、`post_merge_latency_h` 927–942）、`verifier_is_participant: 0`。载体上的判决记录逐字：
```
verdict note for ce01b71a060a…: {"type":"verdict","verifier_machine":"boheidc","at":"2026-09-20T19:43:56Z","verdict":"green","gate":"laydown-set-check.sh","files":[]}
```
**本机对那 24 个合并是真·非参与者**（它们是 `ser702195427338` 合的），所以不是自我验证、不是 fixture。**保留 `--no-push`**：不向跨机共享面写入任何判决（本任务的裁定范围不含向共享通道写）。「关掉本地假远端注入仍成立」——全程没有注入。

**两个由 characterization 发现、本任务**不修**的既有缺陷**（如实记录，供另立任务）：
1. **冷启动的 `--record-merge` 到不了共享远端**：`push_notes` 把两个 notes ref 放进**一条** `git push`，git 在其中一个 src refspec 不存在时**整条**中止 ⇒ 本机 `refs/notes/quay-cmv-verdict` 还没被创建过时，刚记下的 merge note 只留本地，**别的机器永远看不见**（测试 C1h 把它写死为现状）。暖态（双 ref 都在）不受影响，所以一直是隐性的。
2. **已配置但连不上的远端**退化成与「无事可验」**同形**（测试 C3b 写死）；`fetch_notes`/`push_notes` 的 `|| true` 把失败全吞（硬规则 3b 的典型形状）。
**一处刻意的行为差异**（记在 `.ts` 头部与提交信息里）：旧 bash 在**值型旗标出现在末尾**时**死循环**（`--gate`/`--root`/`--machine` 作最后一个参数：`shift 2` 失败、while 条件恒真；实测 `timeout 5 bash … --gate` → rc=124）。死循环是缺陷不是行为，新实现把缺失值当空串并继续前进。

**AC7 — scoped 门全绿。✅**
`bash scripts/test.sh --for-task gap-arch-tsify-cross-machine-verify-sh --allow-thin` ⇒ **rc=0（28 tests / 28 pass / 0 fail）**。期间修掉两个真实红灯：`tmp-leak-pairing-check` 与 `test-isolation-check` AC5 都判夹具临时目录未配对（原用 `process.on("exit")` 收尾，两个检查器都不认；且本地包装函数取名 `mkdtemp` 让每个调用点都读成裸 mkdtemp）——改成 `TEMP_ROOTS` 载体 + `after()` 的院内形态后双绿。scoped-gate 缓存已写（`developSha=5fca2507ee584e93ccda2febf9d88cb079c65e61`）。

## Touches

- plugin/scripts/cross-machine-verify.sh
- plugin/scripts/cross-machine-verify.ts (new)
- plugin/test/cross-machine-verify-characterization.test.mjs (new)
- plugin/scripts/capability-catalog-declarations.json
- plugin/sh-census-baseline.json
- plugin/scripts/periodic-push-backup.sh
- packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs
- tasks/gap-arch-tsify-cross-machine-verify-sh.md
