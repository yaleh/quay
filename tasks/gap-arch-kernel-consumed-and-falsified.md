---
id: gap-arch-kernel-consumed-and-falsified
title: 架构棘轮：kernel/ 被消费 —— AC-309 判据本体取真值 + 两支 CAUSE 取假 + packages 侧跨层消费者 ≥3 逐条可核
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-arch-reverse-edges-zero
goal_ac: AC-309
---
**type:** execution

## Proposal

**AC-309 判「`packages/quay/src/kernel/` 建成**且**被 ≥3 个非测试文件按 import 位置消费」，而承担 kernel/ 落地的是 AC-307 的落点任务——**它的判据是 `reverseEdges === 0`（「边」的读数），不含任何「有消费者」的断言，也不跑 AC-309 的判据本体**。⇒ 本任务承接 AC-309 的**消费半边**：在生产树上把判据本体跑成 exit 0、**把两支 CAUSE 分别取假**、把「消费者是真消费者而非 plugin 侧 re-export shim」单独读出，并在**未被覆盖的真产物**上验证消费者可解析。

来源：`goals/AC-309-kernel-建立且被消费-….md`（判据正本，逐字引用其 `criterion`）、GOAL-025「判据形态」第 1 条（每条 AC 必须附一个「注入后变红」的对照）、`orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md` §3 L0 / §10.3/§10.4（该 SPEC 在分支 `worktree-spec-architecture-refactor` 的 `.claude/worktrees/spec-architecture-refactor/`，本任务体自足，不依赖读到它）。

<!-- dedup-ref -->
**与相邻任务的分工（仅追溯，非前置声明）**：`gap-arch-import-graph-check`（AC-304）建仪器，`gap-arch-reverse-edges-zero`（AC-307）建 `kernel/` 并把反向边降到 0，`gap-arch-sh-census-check`（AC-305）/`gap-arch-coverage-self-report`（AC-306）/`gap-arch-import-cycles-zero`（AC-308）各管别的量。**那一份任务体自己写明**：「AC-309 立案时应写成『**消费**已建立的 kernel 并验证 ≥3 个 kernel 模块被 packages 侧真实 import』，⛔ 不得再立一个『新建 kernel』的任务与本案抢同一批文件」。本任务即按此写：**不新建、不搬迁 kernel/ 文件**（除非 AC6 的实测补足触发）。kernel/ 先建成，由顶层 `depends_on` 表达并串行化，⛔ 不是并列抢文件。

**为什么需要它（三点，各自独立成立；立案时实测，非推断）**：

① **判据的 `CAUSE=kernel-not-consumed` 支从未被观测过**。AC-309 的 `expect` 声明了两支失败态，但该支只有在 kernel/ 建成之后才可能存在 ⇒ 到今天为止**没有任何一次运行证明它能在真仓库上取到**。一个从未红过的子句与恒绿同形（硬规则 3b）；GOAL-025 判据形态第 1 条把「注入一条对照看它变红」列为每条 AC 的硬纪律。立案实测：`packages/quay/src/kernel/` 目录不存在、`git ls-files packages/quay/src/kernel` 为空 ⇒ 今天判据 exit 1 于 **`CAUSE=kernel-missing`**（clause A 支），**clause B 支一次都没跑过**。

② **判据的 `c ≥ 3` 会被 plugin 侧单独满足，使「跨层消费」为零也照样绿**。clause B 的 pathspec 是 `'packages/*.ts' 'plugin/scripts/*.ts'` **两棵树合并计数**，正则 `^\s*(import|export|\})[^'\"]*from ['\"][^'\"]*/kernel/` **同时匹配 plugin 侧的 re-export shim**（AC-307 有意保留一个发布周期的旧路径，形如 `export { writeJsonAtomic } from "…/kernel/write-json-atomic.ts"`）。立案实测（按 import 语句位置、非关键词）：从这 3 个原语 import 的**非测试文件，`plugin/scripts/*.ts` = 10 个**（`driver-shared.ts:22`、`ready-pool-check.ts:168`/`:215`、`worker-driver.ts:192`、`inner-blocked-signal.ts:140`、`suite-state-trigger.ts:83`、`runner-state-write.ts:20`、`red-window-triage.ts:47`、`mirror-full-suite-state.ts:41`、`proposal-convergence.ts:26`、`concurrent-batch-scheduler.ts:46`），**`packages/*.ts` = 3 个**（`serve.ts:38`/`:42`、`server-state.ts:38`、`quay-native/src/store.ts:42`）。⇒ **packages 侧即使一个消费者都不剩，`c` 仍 ≥10，判据照样 exit 0**。而 AC-309 的本意恰是**跨层**共享（AC 正文：「`kernel/` 是 AC-309 为**跨层共享**原语设的」；SPEC §3：L0 供 L1+L2 共享）⇒ clause B 对「跨层」零敏感，绿 ≠ 被验过。

③ **「迁入但无人消费」与「没迁」同形**是 AC-309 立项时写下的理由（AC `origin` 原句：「迁入但无人消费」与「没迁」同形（硬规则 4 推论三），故判据含消费者一半）。本任务给出这一半的**可核读数**（逐文件逐行号），而不是一个「≥3 的数」。

**为什么要验真产物（AC5）**：3 个 packages 侧消费者里，`packages/quay-native/src/store.ts` 是**跨包**消费者，迁移后它的 specifier 由 `../../../plugin/scripts/shape-sections.ts` 变为指向 `quay/src/kernel/`。AC-307 的 AC4 只覆盖 `packages/quay/dist/quay.js` 一个产物 + `packages/quay/test/{npm-pack-e2e,build-dist}.test.mjs`；而 `packages/quay-native` 有自己的产物形态（`package.json` 的 `bin: ./dist/quay-native.js`、`files: [README.md, bin, src, dist, provider.yml, skills]`、`npm run build = bash scripts/build-dist.sh`）**且其 test/ 下没有任何 npm-pack / build-dist 测试**。立案实测该产物今天**内联了 plugin 层**：`packages/quay-native/dist/quay-native.js:7575` 注释 `// plugin/scripts/shape-sections.ts`、`:7578` 模块键 `"plugin/scripts/shape-sections.ts"()`。⇒ 这是同一原则的**兄弟实例**（硬规则 5b：修好一个 ≠ 别处也好），且是「`.ts` 里的相对路径在安装布局下解析不到」（记忆条目 `plugin-tarball-layout-breaks-packages-relative-imports`）那一类的静默失败面 ⇒ 消费半边必须在真产物上取一次读数，**且该量能取两种值**（迁移前内联 plugin、迁移后应内联 kernel）。

## Touches

- tasks/gap-arch-kernel-consumed-and-falsified.md

（以下为**条件段**：仅当 AC6 的实测补足触发时才编辑——AC-307 已声明同一批文件，本任务靠顶层 `depends_on` 串行，⛔ 不并发抢；若未触发则不碰，且须在 notes 里写明「未触发」）

- packages/quay/src/kernel/write-json-atomic.ts (new，条件段)
- packages/quay/src/kernel/shape-sections.ts (new，条件段)
- packages/quay/src/serve.ts (条件段)
- packages/quay/src/server-state.ts (条件段)
- packages/quay-native/src/store.ts (条件段)

回归面（AC4/AC5/AC6 要跑到的测试文件，条件段触发时可能需同步更新）：

- packages/quay-native/test/store.test.mjs
- packages/quay/test/serve.test.mjs

（若实现者把 kernel 拆成别的模块名，新增文件仍属本任务 Touches，须在同一次编辑里补进本清单。）

## AC

- [x] AC1（判据本体在生产树取真值）在**真实仓库根**（不是 worktree fixture）逐字执行 AC-309 的 `criterion` 本体，`d=packages/quay/src/kernel`：`n=$(git ls-files "$d" | grep -c '\.ts$')` ⇒ `n≥3`；`c=$(git grep -lE "^\s*(import|export|\})[^'\"]*from ['\"][^'\"]*/kernel/" -- 'packages/*.ts' 'plugin/scripts/*.ts' ":!$d" | grep -vc '\.test\.')` ⇒ `c≥3`；整条命令 **exit 0**。`n` 与 `c` 两行输出**原样贴进 notes**。
- [x] AC2（取假对照①：`CAUSE=kernel-missing`）在任务 worktree 内把 `packages/quay/src/kernel/` 下 tracked `.ts` **临时**减到 2 个（`git mv` 到 kernel 之外），断言判据 **exit 1** 且 stderr 含 `CAUSE=kernel-missing`；撤销后回到 exit 0 且 `git status --porcelain` 干净。**两次读数（含 stderr 行）贴 notes。** ⛔ 取不出 ⇒ 判据未取假，本任务不算完成。
- [x] AC3（取假对照② + 核心发现：clause B 对跨层消费零敏感）把 **3 个 packages 侧消费者同时**临时改回 import 旧 `plugin/scripts/` 路径（`packages/quay/src/serve.ts`、`packages/quay/src/server-state.ts`、`packages/quay-native/src/store.ts`），断言并记录三个读数：**合并计数 `c` 仍 ≥3**（预期 ≈10）、判据**仍 exit 0**、而 `git grep -lE … -- 'packages/*.ts' | grep -vc '\.test\.'` 的 **packages 侧单独计数 = 0**。撤销后恢复。**三次读数（baseline / reverted / restored）贴 notes**，并把「clause B 单靠 plugin 侧即可满足 ⇒ 绿 ≠ 跨层消费被验过」写成 notes 与提交信息里的**发现**。⛔ 不据此改写判据本体（见 DoD）。
- [x] AC4（packages 侧跨层消费者逐条可核）`git grep -lE "^\s*(import|export|\})[^'\"]*from ['\"][^'\"]*/kernel/" -- 'packages/*.ts' | grep -vc '\.test\.'` **≥3**，并逐条列出 `文件:行号 → 消费的符号`（立案实测的迁移后应然形态：`serve.ts:38 → writeJsonAtomic`、`serve.ts:42 → readProcCmdline,isQuayServe`、`server-state.ts:38 → writeJsonAtomic`、`store.ts:42 → SHAPE_SECTIONS`）。⛔ `plugin/scripts/*` 的计数不得充入本条。
- [x] AC5（真产物：未被覆盖的兄弟消费者）在任务 worktree 内 `bash packages/quay-native/scripts/build-dist.sh` 构建 `packages/quay-native/dist/quay-native.js`，断言：(a) 该产物对 `plugin/scripts/shape-sections.ts` 的 grep **命中 0**，对 `kernel/shape-sections.ts`（或 kernel/ 下的实际模块名）的 grep **命中 ≥1**；(b) 对一份临时 workspace 跑该产物的真实命令（如 `node packages/quay-native/dist/quay-native.js task list`）**exit 0**。**两次 grep 的关键行 + 命令与退出码贴 notes。** 迁移前基线（立案实测，该量能取两种值）：`:7575`/`:7578` 内联 `plugin/scripts/shape-sections.ts`。⛔ 若产物解析不到 kernel（例如 tarball 的 `files` 白名单不含兄弟包 `quay/src/kernel`）⇒ **不得静默改 `package.json` 或构建脚本**，把实测证据写进 notes 作为**发现**上报。
- [x] AC6（条件性补足）若 AC1 的 `n < 3` 或 AC4 的计数 `< 3` ⇒ 在同轮补齐到 ≥3（落点见 Touches 条件段），并在 notes 写明补了哪一个、以及为什么 AC-307 的落点未覆盖它；若两者均已达标 ⇒ 在同轮 notes 写明「条件段未触发」并列出 AC4 的逐条清单。

## DoD

真实落地标准（DIR-026 Reading A）：**判据本体在真实仓库根 exit 0，且两支取假对照已实做并留证**（AC2 的 `kernel-missing`；AC3 的「跨层消费归零而判据仍绿」三次读数）——不是「检查器在 fixture 上绿了」，也不是「`c` 是个 ≥3 的数」。**packages 侧消费者逐条可核且是真消费者**（AC4：文件名 + 行号 + 消费的符号，⛔ 不用 plugin 侧 shim 的计数充当）。**真产物上消费者可解析**（AC5：dist 产物内联 kernel 而非 plugin，且产物本身跑得通）——这一条是消费半边的生产载体读数，只有它能把「import 图里看得见」与「消费者里解析得到」区分开。

边界：**纯核验 + 条件性补足**。不改 Provider ABI 与公开 CLI/MCP 表面（`packages/quay/src/abi.ts` 及其 provider 契约）；⛔ **不重写 AC-309 的判据本体**——AC3 的发现（clause B 对跨层消费零敏感）写进 notes 与人裁定入口，⛔ 不得自行改判据或改 GOAL 文件（先例：AC 括号与实现冲突时改实现、不改 AC）；⛔ 不新建/搬迁 `kernel/` 文件（那是 AC-307 的范围），AC6 仅在实测不足 3 时触发；⛔ 不改 `package.json` 的 `files` 白名单或构建脚本（AC5 的 ⛔ 分支）；⛔ 不动 `packages/quay/src/fan-in/ff-merge.ts` 的运行时 spawn（那是运行时耦合，不是 import 边）。落地后 `bash plugin/scripts/capability-catalog.sh --summary` 的脚本数自报值不变（本任务不新增/搬迁脚本；仅 AC6 触发且确有新增时按其六行登记规则同步补登记）。

## Notes

**执行环境**：读数在任务 worktree `/home/yale/work/quay-worktrees/gap-arch-kernel-consumed-and-falsified`（分支 `task/gap-arch-kernel-consumed-and-falsified`，fork 自 develop `2690caad9`）与主检出 `/home/yale/work/quay` 上取得。本任务**纯核验**：`git diff develop -- packages/quay/src/kernel packages/quay/src/serve.ts packages/quay/src/server-state.ts packages/quay-native/src/store.ts` = **0 行**（AC6 条件段未触发，源码一字未改）。

### AC1 — 判据本体取真值（n / c 两行输出）

判据本体逐字取自 `goals/AC-309-kernel-建立且被消费-packages-quay-src-kernel-下-tracked-ts-3-个-且-3.md` 的 `criterion`，`d=packages/quay/src/kernel`。

两处读数**逐字相同**：

```
真实仓库根 /home/yale/work/quay :
n=5
c=7
AC1-exit=0

任务 worktree :
n=5
c=7
exit=0
```

`packages/quay/src/kernel/` 下 tracked `.ts`（5 个）：`control-plane-http.ts`、`control-state.ts`、`proc-identity.ts`、`shape-sections.ts`、`write-json-atomic.ts`（`n=5 ≥ 3`）。

### AC2 — 取假对照① `CAUSE=kernel-missing`（实做，两次读数）

在任务 worktree 内 `git mv` 3 个 kernel `.ts`（`control-plane-http.ts` / `control-state.ts` / `proc-identity.ts`）到 `.ac2-stash/`（index 同步，故 `git ls-files` 立即反映），kernel 下 tracked `.ts` 由 5 → **2**：

```
=== n after temp removal ===
2
=== criterion run (expect exit 1 + CAUSE=kernel-missing) ===
CAUSE=kernel-missing — packages/quay/src/kernel 下 tracked .ts 数 n=2 < 3（3 个叶子原语未迁入）
AC2 rc (n-check only, n=2) = 1
```

撤销（3 个 `git mv` 回原位 + `rmdir .ac2-stash`）后：

```
n=5
c=7
post-restore exit=0
git status --porcelain → 0 行（干净）
```

⇒ clause A 支**实测能取假**：同一条命令在 n=2 时 exit 1 且 stderr 带 `CAUSE=kernel-missing`，在 n=5 时 exit 0 —— 红/绿两态由同一判据区分，不是「从未红过」。

### AC3 — 取假对照② + 核心发现：clause B 对跨层消费零敏感（实做，三次读数）

把 3 个 packages 侧消费者**同时**临时改回旧 `plugin/scripts/` 路径（每条的旧 specifier 逐字取自 AC-307 的迁移提交 `0280ade44` 的 `-` 侧）：

| 文件 | 现行 kernel specifier | 临时改回旧路径 |
|---|---|---|
| `packages/quay/src/serve.ts:38` | `./kernel/control-plane-http.ts` | `../../../plugin/scripts/driver-shared.ts` |
| `packages/quay/src/serve.ts:40` | `./kernel/write-json-atomic.ts` | `../../../plugin/scripts/write-json-atomic.ts` |
| `packages/quay/src/serve.ts:45` | `./kernel/proc-identity.ts` | `../../../plugin/scripts/worktree-process-reaper.ts` |
| `packages/quay/src/server-state.ts:39` | `./kernel/write-json-atomic.ts` | `../../../plugin/scripts/write-json-atomic.ts` |
| `packages/quay-native/src/store.ts:49` | `../../quay/src/kernel/shape-sections.ts` | `../../../plugin/scripts/shape-sections.ts` |

`git diff --name-only` 恰好 **3 个文件**（未误伤其它文件）。

三次读数：

```
baseline : merged_c=7  packages_c=3  criterion exit 0
reverted : merged_c=4  packages_c=0  criterion exit 0     ← 核心发现
restored : merged_c=7  packages_c=3  criterion exit 0  （git status --porcelain = 0 行）
```

reverted 态下 `merged_c=4` 的**全部内容**（clause B 余下的满足者，**无一在 packages 侧**）：

```
plugin/scripts/driver-shared.ts
plugin/scripts/shape-sections.ts
plugin/scripts/worktree-process-reaper.ts
plugin/scripts/write-json-atomic.ts
```

**发现（核心，写在此处与人裁定入口）**：**clause B 单靠 plugin 侧即可满足 ⇒ 绿 ≠ 跨层消费被验过。** packages 侧消费者**全部归零**时，合并计数仍 `c=4 ≥ 3`、判据仍 **exit 0**。⇒ 判据的「消费」半边**对「跨层」零敏感**：它今天实际测的是「kernel/ 至少被 3 个非测试文件（**任一树**）import」，而不是 AC 正文所写的「跨层共享」。四个 plugin 侧满足者中，3 个是 AC-307 **有意保留一个发布周期的 re-export shim**（`plugin/scripts/{shape-sections,write-json-atomic}.ts` 各 18 行、全文仅一行 `export * from "…/kernel/…"`；`driver-shared.ts:34-35` 同理两条 `export *`），第 4 个 `worktree-process-reaper.ts` 亦只 import + re-export 两个谓词 ⇒ **该计数在「只有转发、没有真实消费者」时同样取真**（硬规则 3b：一个从未红过的子句与恒绿同形）。

⚠️ **一处读数与立案记录不符，已按实测记录并说明成因**：Proposal ② 写「packages 侧即使一个消费者都不剩，`c` 仍 ≥10」。立案实测的 10 是「**从这 3 个原语 import 的非测试文件数**（按内容，不论路径）」，而 clause B 的正则要求 specifier **含 `/kernel/`** —— 迁移后 plugin 侧满足者只有 **4** 个（3 个 shim + `driver-shared.ts`），故 reverted 态实测 `merged_c=4`（不是 ≈10）。**结论方向不受影响、且更强**：`4 ≥ 3`，判据照样绿。

### AC4 — packages 侧跨层消费者逐条可核（≥3，⛔ 不含 plugin 侧计数）

```
packages_c = 3   （git grep -lE … -- 'packages/*.ts' | grep -vc '\.test\.'）
```

逐条 `文件:行号 → 消费的符号`（并给出**真实使用点**，以证其不是转发 shim）：

| # | 文件:行号 | 消费的符号 | 文件内真实使用点 |
|---|---|---|---|
| 1 | `packages/quay/src/serve.ts:38` | `serveControlPlane`, `ControlPlaneHandle` | `:642` / `:873` 调用；`:640` / `:794` / `:1021` 类型 |
| 2 | `packages/quay/src/serve.ts:40` | `writeJsonAtomic` | `:103` 调用 |
| 3 | `packages/quay/src/serve.ts:45` | `readProcCmdline`, `isQuayServe` | `:444` / `:448` 调用 |
| 4 | `packages/quay/src/server-state.ts:39` | `writeJsonAtomic` | `:98` 调用 |
| 5 | `packages/quay-native/src/store.ts:49` | `SHAPE_SECTIONS` | `:90` / `:94` / `:98` / `:105` 取值 |

**真消费者判定（对照 shim）**：上表每个符号在文件内都有 `import` 行以外的真实使用（第 4 列逐处行号）；对照 plugin 侧满足者 —— `plugin/scripts/{shape-sections,write-json-atomic}.ts` 全文只有一行 `export * from "…/kernel/…"`，**零逻辑**，是转发而非消费（硬规则 5b 的形态：计数相同，性质不同）。

立案实测的「应然形态」行号（`serve.ts:38`/`:42`、`server-state.ts:38`、`store.ts:42`）与实测（`serve.ts:38`/`:40`/`:45`、`server-state.ts:39`、`store.ts:49`）不一致，成因是**实测中多出一条未被立案预见的 kernel 消费者**（`serve.ts:38` 的 `control-plane-http`，属 SPEC §8-①b「serveControlPlane 下沉 kernel」那一条），且既有行号因注释改写而位移。**条数与「≥3」判据不变**：3 个文件 / 5 条 import 全在 packages 侧。

### AC5 — 真产物：未被 AC-307 AC4 覆盖的兄弟消费者

在任务 worktree 内 `bash packages/quay-native/scripts/build-dist.sh`（`dist/quay-native.js` 1.2mb，esbuild 412ms；构建前 `packages/quay-native/dist/` 不存在，dist 为 gitignored 生成物）：

```
$ grep -c 'plugin/scripts/shape-sections\.ts' packages/quay-native/dist/quay-native.js
0
$ grep -c 'kernel/shape-sections\.ts' packages/quay-native/dist/quay-native.js
2
关键行：
7575:// ../quay/src/kernel/shape-sections.ts
7578:  "../quay/src/kernel/shape-sections.ts"() {
```

(a) 成立：对 `plugin/scripts/shape-sections.ts` 命中 **0**，对 `kernel/shape-sections.ts` 命中 **≥1**（=2）。

**且行号与本任务 Proposal 记录的立案基线逐字相同（`:7575` 注释 / `:7578` 模块键）** —— 同一行在同一次构建里**能取两种值**（迁移前 `plugin/scripts/shape-sections.ts`，迁移后 `../quay/src/kernel/shape-sections.ts`）。这正是「该量能取两种值」的直接证据（硬规则 4），不是换了个位置的新读数。

(b) 真实命令。临时 workspace `/tmp/ac5-ws-pKr2Nt`（`.quay/config.yml` provider map + `tasks/T-1.md`）：

```
$ cd /tmp/ac5-ws-pKr2Nt && node <worktree>/packages/quay-native/dist/quay-native.js task list
T-1	todo	primitive	smoke
task list exit=0
$ QUAY_NATIVE_TASKS_DIR=/tmp/ac5-ws-pKr2Nt/tasks node <worktree>/packages/quay-native/dist/quay-native.js task list ; echo exit=$?
exit=0
```

⇒ 产物**自身跑得通**，且它内联的是 kernel 而非 plugin。

⚠️ **⛔ 分支未触发**：产物**解析得到** kernel（grep 命中 + 命令 exit 0），故**未改** `package.json` 的 `files` 白名单、**未改**构建脚本。

（附注，非本任务读数、不据此下结论：`quay-native --help` 在该产物上 exit 1，属与 kernel 无关的既有 CLI 表层行为。）

### AC6 — 条件段未触发

`n=5 ≥ 3` **且** `packages_c=3 ≥ 3` ⇒ **条件段未触发**。未新建/搬迁任何 `kernel/` 文件，未编辑 `packages/quay/src/{serve,server-state}.ts` 或 `packages/quay-native/src/store.ts`（AC3 的临时取假已逐字还原，`git status --porcelain` = 0 行）。AC4 逐条清单见上。

### 与 DoD 逐条对账

| DoD 要求 | 读数 |
|---|---|
| 判据本体在真实仓库根 exit 0 | ✅ AC1：`/home/yale/work/quay` `n=5` `c=7` exit 0（worktree 同读数） |
| 两支取假对照已实做并留证 | ✅ AC2（`kernel-missing`，红/绿两态）+ AC3（三次读数 baseline/reverted/restored） |
| packages 侧消费者逐条可核且是真消费者 | ✅ AC4：3 文件 / 5 条 import，逐条真实使用点；无 plugin 计数充入 |
| 真产物上消费者可解析 | ✅ AC5：dist 内联 kernel（plugin 命中 0 / kernel 命中 2），产物 `task list` exit 0 |

**边界核对**：⛔ 未改 AC-309 判据本体（AC3 的发现只进本 Notes 与人裁定入口，不改 GOAL 文件）；⛔ 未新建/搬迁 `kernel/` 文件（AC6 未触发）；⛔ 未改 `package.json` `files` 白名单与构建脚本；⛔ 未动 `packages/quay/src/fan-in/ff-merge.ts`；未改 Provider ABI 与公开 CLI/MCP 表面。`bash plugin/scripts/capability-catalog.sh --summary` = `341 scripts | 341 declared | 0 unclassified | 336 ship`，与主检出**逐字相同** ⇒ DoD 该条成立。
