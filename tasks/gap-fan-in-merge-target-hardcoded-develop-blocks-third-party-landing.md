---
id: gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing
title: fan-in 的 merge target 硬编码 develop——真实项目主线不是 develop 时任务结构上永远无法落地（AC-239
  真机实测被此摧毁）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-239
---
## 取证与落地（执行记录，2026-09-11）

**先做的三件取证**（人裁定要求"执行者须自己取证"，Proposal 的三条方向全部核过）：

1. **三处 `?? "develop"` 不是同一个判定函数**——`worker-driver.ts:3701` / `anti-drift-touches-check.ts:213`
   / `fan-in-ts-typecheck-gate.ts:161` 是三处**独立字面量**。
2. **既有 `fork-baseline.ts` / `decideForkBaseline` 不是本条的现成机制**：它的 REF-AWARE OUTPUT 小节
   自己写明它管的是 **worktree 分叉基线**（任务从哪 fort），与 fan-in 的 **merge target**（往哪里落）
   正交；它的输出在本仓库恰好也等于 `develop` 是巧合，不构成"落地基线可不可用"的判定。
   ⇒ 本条是**新造判定**，⛔ 不是接线既有函数。
3. **唯一把基线选择变成硬失败的地方**是 `anti-drift-touches-check.ts:119` 的
   `git diff --name-only <mergeTarget>...HEAD`——AC-239 报的 1566 就是它。

**方案（按人裁定：应用本项目自己的分支模式，而非从目标项目拓扑推导）**：

- `packages/quay/src/branch-model.ts`（新）：`detectDefaultBranch` + `classifyBranch`
  + `ensureBranchModel`。**兼容性谓词 = 项目默认分支是本分支的祖先**
  （`git merge-base --is-ancestor <default> develop`）：是 ⇒ develop 是主线的延续 ⇒ 它是合法落地基线。
- **四态、绝不两态**：`absent` / `compatible` / `divergent` / `unreadable`，`unreadable` **独立取值**
  （硬规则 3b：读不懂 ⇒ 不判，既不算通过也不算 foreign fork）。走不到的根因也各是一个取值
  （`no-commits` / `not-a-git-worktree` / `default-branch-unresolvable` / `ancestry-undecidable`）。
- **`divergent` 可判定，绝不悄悄复用**：默认 **fail-closed 拒绝**且**什么都不写**（半个初始化的项目
  比没初始化更坏）；`--adopt-branch-model` 把旧 tip 保留为 `<branch>-pre-quay-init-<sha>` 再重指
  （**零销毁**）。
- **⛔ 不引入新的分支名字面量**：`develop` 是协议固定 ref（在 `target-identity-literal-check.ts` 的
  `LEGAL_IDENTITY_VALUES` 里）；**doc 分支角色改为派生**（`resolveDocBranchRole` = 当前 checked-out
  分支，与 `driver-filters.ts:resolveDocBranch` 同源），`quay init` **只报告不创建**它。
  ⚠️ **这是对裁定字面的一处收紧，理由是可核的**：本任务第一版写了 `DOC_BRANCH_ROLE = "author"`，
  **被本仓库自己的 `target-identity-literal-check` 判红**——`author` 在 `LEGAL_IDENTITY_VALUES` 里
  **被显式排除**（"`author` 是本仓库自己的命名约定，逐项目不同"，正是同族任务
  `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync` 刚拆掉的那个缺陷）。在第三方项目
  里创建 `author` 还会是**死产物**：shipped 机制运行时派生 doc 分支，永远不会返回它。
  ⇒ 角色（master/develop/doc）三种都到位，**名字**只在开发分支上固定，doc 分支的名字按项目派生。
- `anti-drift-touches-check.ts`：算 diff **之前**先分类基线；`divergent` ⇒ 报 **`BASELINE-MISMATCH`**
  （独立退出码 **3**）+ remedy，**不再**折叠成 "N violation(s)"。在任务 worktree 里必须
  `allowCurrentBranch: false`（那里 HEAD 是 `task/<id>`；拿它当默认分支会把**每一次健康 fan-in**
  误判成 foreign fork ——这是一个我在写完后自己发现的假阳性，已在 `detectDefaultBranch` 的选项里
  固定并单测）。

## Evidence

### AC1 —— 复现（第三方形态夹具：主线 `main` 60 提交，`develop` 从 `main~50` 分叉后从未并回）

命令：`bash /tmp/repro-final2.sh`（脚本逐步：建仓 → 建任务分支 → **fan-in 第 1 步 `git merge develop`**
→ 跑 anti-drift 修前版 / 修后版 → `quay init` → 重新派发再跑）

```
=== branch topology ===
main=6f0df0f develop=b59d9ba fork-point(main,develop)=bbd91c3
main ahead of fork point = 50 | tasks/*.md on develop = 0
T-1's real work  git diff --name-only main...HEAD    = 3 file(s)
quay diffs       git diff --name-only develop...HEAD = 52 file(s)

=== [BEFORE FIX] anti-drift --merge-target develop ===
ANTI-DRIFT HARD FAIL: task T-1 — 50 violation(s)
  out-of-declared: task wrote src/mod11.txt (matches no declared Touches glob)
  out-of-declared: task wrote src/mod12.txt (matches no declared Touches glob)
exit=1

=== [AFTER FIX] same command, same repo ===
BASELINE-MISMATCH: merge target 'develop' is not a continuation of the project's default branch 'main'
  — 'develop' (b59d9ba9) ... it is 50 commit(s) behind and shares only an old merge base, so a task diff
  against it is meaningless.
  The develop...HEAD diff is therefore the mainline's divergence, NOT task T-1's own work; no declaration
  of ## Touches can satisfy it. This is a BASELINE defect, not an out-of-declared write by the task.
  Remedy: `quay init --force --adopt-branch-model` ...
exit=3
```

**修前读数把 50 个文件记成"任务写的"**（`src/mod11.txt`… 全是主线的提交），**修后同一现场读数把成因
归到基线**。这正是 AC1 要的"可归因到基线选择（不是任务越界）"，且是本任务 Finding 里 AC-239 那条
`1566 violation(s)` 的可控复现（同一形态，规模缩小到 50）。
**判据取假说明**：本条**未**在 orangevps 的真机副本上重跑（该机不在本机可达范围内，实测
`ls -d /home/yale/quay-verify-upgrade-*` 无此目录）——复现的是**该项目的形态**，不是那一台机器上的
那一份副本。真机那份的原始读数见 Finding（外部可核，非主张）。

### AC6 —— `quay init` 建仓（两种情况各跑一次，真实输出）

**情况 A：目标项目已有自己的（foreign）`develop`**

```
$ node packages/quay/bin/quay.ts init --force --adopt-branch-model --root <fixture>
branch model (default branch: main):
  [REUSED] default -> main — project default branch (master role; quay never renames or moves it)
  [REUSED] doc-branch -> task/T-1 — the doc-only work branch is DERIVED at runtime (driver-filters.ts
           resolveDocBranch = the checked-out branch) ... no name is created or assumed here
  [ADOPTED] landing-baseline -> develop [backup: develop-pre-quay-init-b59d9ba9]
           — 'develop' was a foreign fork (b59d9ba9); preserved as 'develop-pre-quay-init-b59d9ba9' and
             re-pointed at main (6f0df0fc)
```

不带 flag 时**拒绝且不写任何东西**（`quay init` exit 1，`.quay/config.yml` 不存在）——单测
`runInit: a foreign landing baseline blocks init and writes NOTHING` 即此断言。

**情况 B：目标项目没有 `develop`** → `[CREATED] landing-baseline -> develop`，建在默认分支 tip
（单测 `shape ②b (AC6 second case)`）。

**后续开发真的以新建的 develop 为基线**：见下面 AC4 的 `landedSha` 与
`git show develop:tasks/<id>.md → status: done`（**派发/晋升的读面读的就是 develop**）。

### AC4 —— 端到端（走真实 `runMechanicalFanIn`，不是只调 anti-drift）

`plugin/test/worker-driver.test.mjs` 两条新用例（夹具 = meta-cc 副本形态：主线 `main` + 远古分叉
`develop`，任务自身实现正确）：

```
ok 1 - AC1 (取假): a FOREIGN develop makes a CORRECT task fail anti-drift — and the cause is the baseline
       → outcome=red, step=anti-drift, reason 含 BASELINE-MISMATCH，且 *不含* "violation(s)"
ok 2 - AC4 (端到端负控制): after `quay init` establishes the baseline, the SAME task LANDS
       → outcome=landed，develop:tasks/<id>.md = status: done，旧 develop 保留为 backup ref
```

读数全部是 git ref / 任务文件状态（**直接量**，硬规则 4b），⛔ 不依赖 `$PATH` 辅助，⛔ 不读被测对象
自己写的心跳。**范围诚实**：这是**该形态的夹具**上跑通的机械 fan-in 全程，⛔ 不是在 orangevps 那份
真机副本上跑通的；后者需要那台机器的 driver 重装后重跑（外部）。

### AC3 / DoD2 —— 能取假（真做了变异，不是"我认为会红"）

| 变异 | 结果 |
|---|---|
| `anti-drift-touches-check.ts` 去掉 `divergent` 分支（`if (false && …)`） | 用例 23、24 **红**；其余 25 绿 |
| `runInit` 里 `ensureBranchModel` 换成空实现 | 用例 13、14、16、17 **红**；其余 15 绿 |
| 两处还原 | 27 绿 / 19 绿（负控制：绿是真的绿） |

### AC5 —— 三层同链（本条是第三层）

- `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync`（done）：**硬编码 `author`**
  ⇒ doc→develop 同步恒 no-refs，晋升写入对派发永久不可见（**写面**假设）。
- `gap-develop-sync-reset-hard-destroys-third-party-project-tree`（done）：同步发生了，终局解
  `git reset --hard develop` 在第三方上是破坏性的（**同步解**假设）。
- **本条**：落地闸门以 `develop` 为基线（**落地面**假设）⇒ 主线非 develop 的项目**根本落不下**。
  三者是"quay 假设 develop 是权威主线"被逐层拆除的第三层，且是唯一一层**让任务永久卡死**而不是
  丢数据/不同步的。本条的修法**沿用**第一层已确立的方向（"名字不得硬编码，要按项目派生"）——
  我第一版把 `DOC_BRANCH_ROLE = "author"` 写回来时被仓库自己的 checker 判红，正是这条链还在生效的证据。
- 与 `gap-aged-project-post-upgrade-driver-e2e` 的 AC-239：**同一现场、互为引用**。两侧一致认定
  **不是**"worker 没实现"——那个 worker 真的实现了修复并提交（`d8598f7`，+217/-16，`go test` 绿），
  它倒的是落地路径对项目形态的假设。

### 套件红归因（2026-09-11 续做轮）：与本条 delta 无关的【宿主负载相关】单测 —— 已修根因

上一次 fan-in 的最后一步 `suite` 报 1 红（5616 中 1）：

```
✖ runPackagingHygiene drift ⇒ failed + gap-filing spawned (AC3)
  AssertionError [ERR_ASSERTION]: drift must trigger gap-filing
```

**归因（可复现，非主张）**：`plugin/test/packaging-hygiene-check.test.mjs` 的该用例调
`runPackagingHygiene` 时**未注入 `resourceGateArgv`** ⇒ 内部 `resourceGateCheck` 跑**真实**的
`resource-gate.sh`。该闸自 `d640b8e1b`（2026-08-11）起带 load 判据（`load >= nproc × 2` ⇒ WAIT）；
全量 suite 26 路并发下 load 越过阈值 ⇒ `go:false` ⇒ `gapFiled` **按设计**为 false ⇒ 断言恒红。
（`gapFiled=false` 的其它两条路径都被排除：`drift.length > 0` 已由先通过的 `state === 'failed'` 断言确定；
`halted` 本用例未传 ⇒ 只剩 `gate.go === false` 一条。）

**区分性对照（硬规则 4 推论四——附一个若假说为假则结果会不同的对照）**：

| 条件 | 修前 | 修后 |
|---|---|---|
| 宿主正常（load < nproc×2） | 9/9 绿 | 10/10 绿 |
| **`RESOURCE_GATE_LOAD_OVER_FACTOR=0.01`（强制 WAIT 带）** | **红，断言原文与 suite 日志逐字相同** | 10/10 绿 |

第二行就是那个对照：**把闸强制推进 WAIT 带，修前重放出的正是 suite 日志里那句
`drift must trigger gap-filing`**。⇒ 不必停在一句"环境噪声"，成因是确定的这一条。

**5b 产物（同一原则的其它适用点计数）**：用 `gapWorkerCmd` 的 **9 个**测试文件中，
**8 个都注入 `resourceGateArgv`**（goal-driver 7、goal-triage 2、goal-triage-activate-executed 3、
goal-posture 1、goal-sufficiency-{gate,not-evaluated,semantic-covered} 各 1、goal-triage-fresh-draft 1），
**本文件是唯一例外**（2 处调用 / 0 处注入；其中 `halted:true` 那处按短路无需注入）。
`goal-driver.test.mjs` 里剩下 3 处未配对的经逐行核对是 `halted:true` 与两条断言消息字符串，**不是调用**。
⇒ 不是"偶尔红一条"，是**同族约定在这一个文件上漏了一处**。

**改动**：AC3 用例注入 `resourceGateArgv: ['true']`（确定性 GO）；并补一条资源门负控制
（`['bash','-c','exit 1']` ⇒ drift 仍报 `failed`、gap-filing 延后），与 `goal-driver.test.mjs:373`
的同族用例同形。**⛔ 未改任何产品代码**——`runPackagingHygiene` 在 WAIT 下延后 spawn 是**设计**
（fail-closed 推迟，不是静默 no-op），错的只是这条单测没注入已有的测试缝。

**范围诚实**：本轮**未跑全量 suite**（worker 契约禁止；suite 由 driver 的 fan-in 跑）。上表是
**该文件级**的定向复现 + 双向控制，不是全量 suite 的绿证。

### 改了哪些文件

`packages/quay/src/branch-model.ts`(新) / `packages/quay/src/init.ts` / `packages/quay/src/cli/init.ts` /
`plugin/scripts/anti-drift-touches-check.ts` / `packages/quay/test/branch-model.test.mjs`(新) /
`packages/quay/test/init.test.mjs` / `plugin/test/worker-driver.test.mjs` /
`experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs` /
`plugin/test/packaging-hygiene-check.test.mjs`(续做轮，见上面的套件红归因——测试隔离修复，非产品代码)。
`plugin/scripts/worker-driver.ts` 与 `fan-in-ts-typecheck-gate.ts` 在 Touches 里但**未改**——
判定收在 anti-drift 一处（它才是把基线变成硬失败的那一步），⛔ 不复制第二份判定。
**scoped 门**：`bash scripts/test.sh --for-task <id> --allow-thin` 绿（281 pass / 0 fail）。

## Proposal

**What/Why**：让「合并/落地基线」成为**从项目推导的量**，而不是本仓库字面量——使真实项目
（主线不是 develop）也能被 quay 驱动落地；`develop` 仍作为本仓库的默认值逐字不变。

**Approach（方向，⛔ 不由本任务预设最终裁定；执行者须自己取证）**：

1. 先取证：确认三处默认值是否都走到同一个判定函数；确认现有 `fork-baseline.ts` / `decideForkBaseline`
   是否已经是「从项目推导基线」的既有机制（若已存在则本条的修法是**接线**而非新造）。
2. 定义「落地基线」的判定：候选来源可包括项目默认分支（`git symbolic-ref refs/remotes/origin/HEAD`
   或 config）、任务的 `## Touches` 所依赖的基线、或既有 `fork-baseline` 的产物。
   ⛔ 不得再引入一个新的分支名字面量（硬规则 4 推论二：字面量换台机器/换项目即失效且静默）。
3. 判据须**能取假**：构造一个「主线非 develop 且有分叉 develop」的第三方项目夹具，
   证明修复前该形态任务在 anti-drift 硬失败、修复后能落地；同时证明本仓库（develop 权威）行为**逐字不变**。

**人裁定（2026-09-11，覆盖上面"不预设最终裁定"的开放性——落地基线的选择本身已被人定向）**：

不走"从目标项目自身分支结构推导基线"这条路。改为：**应用本项目自己的 git branch 模式**——
master = 项目默认分支；develop = 任务板权威基线/worktree 分叉点/fan-in 快进目标；author = doc-only
工作分支（见本仓库 CLAUDE.md「分支同步（author ↔ develop）」一节的角色定义）。

`quay init` 在为目标项目建仓时须**创建**符合此模式的分支（实测 2026-09-11：`packages/quay/src/init.ts`
当前对 `branch`/`develop`/`author` 零命中——`grep -n "branch\|develop\|author\b" packages/quay/src/init.ts`
无输出，即该文件当前完全不处理分支）。若目标项目尚无 `develop`/`author` 分支，`quay init` 建出来；
若目标项目已有同名分支但语义不同（例如目标项目自己的 `develop` 本来就是「主线」），需要一个可判定
的处理（不能悄悄复用同名分支去承载不同语义，那会重现本任务 Finding 里①描述的冲突）。

这套分支须在**后续实际开发过程中被真正使用**——fan-in/anti-drift/晋升写面等机制的基线落到这些
新建分支上，而不是目标项目原有的主线分支。

⇒ 本任务的落地范围因此扩大到 `quay init` 的建仓步骤（`packages/quay/src/init.ts` /
`packages/quay/src/cli/init.ts`），原 Touches 清单未覆盖，已在下面补充；执行者仍须自行核实具体
接线点，本裁定只定方向，不预设实现细节。

**Out of scope**：不重做前两条同族任务已修的东西；⛔ 不在本任务里改 AC-239 的判据。

## Acceptance Criteria

- [x] 用一个**真实项目形态**（有分叉 `develop`、主线是 `main`）复现：任务在该项目里被 driver 驱动到
      fan-in 时 `anti-drift` 硬失败，且失败原因可归因到基线选择（不是任务越界）。命令与真实输出贴进本任务
      （判据取假：复现不出 ⇒ 本条判定前提不成立，须如实报出）
      —— 见 Evidence/AC1：夹具复现（50 violation(s) → BASELINE-MISMATCH exit 3）+ 真实 driver 路径的
      两条 e2e；**未**在 orangevps 真机副本上重跑，已在证据里如实标注范围
- [x] 明确裁定「落地/合并基线」应如何判定，并在**机制**上实现（⛔ 不是只在文档里写一句），
      且不引入新的分支名字面量
      —— 谓词 = `merge-base --is-ancestor <default> develop`；实现在 `branch-model.ts` +
      `runInit` + anti-drift；新字面量 0（`develop` 是协议固定 ref，doc 分支改为派生）
- [x] 新增/修改的测试**能取假**：把修复 revert 之后同一条测试必须失败；且覆盖两种形态
      （① 本仓库 develop 权威 ⇒ 行为逐字不变；② 第三方项目主线非 develop ⇒ 不硬失败）
      —— 变异表见 Evidence/AC3（两组变异各自红、还原后绿）；① 形态单测 +
      本仓库 `quay init --dry-run` 实跑全部 `[REUSED]`（develop 含 master，领先 17197）
- [x] 端到端负控制：在 meta-cc 副本形态的项目上，一个**自身实现正确**的任务能走完 fan-in 落地
      （或至少：anti-drift 不再因基线选择而失败），读数不依赖 $PATH 辅助（硬规则 4b）
      —— `runMechanicalFanIn` outcome=landed + `develop:tasks/<id>.md status: done`；夹具形态，非真机
- [x] 与 `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync`、
      `gap-develop-sync-reset-hard-destroys-third-party-project-tree` 的关系已写明（三层同链，本条是第三层）
      —— 见 Evidence/AC5
- [x] `quay init` 为目标项目创建符合本项目分支模式（master/develop/author）的分支，有真实跑过的
      命令与输出（不是文档描述）；且后续开发过程（fan-in/anti-drift/晋升写面）实际以这些新建分支
      为基线，而非目标项目原有的主线分支——用一个真实第三方项目形态（有自己的 `develop`/无 `develop`
      两种情况）各跑一次证明
      —— 情况 A（foreign develop，`[ADOPTED]` + backup ref）/ 情况 B（无 develop，`[CREATED]`）各
      有实跑输出；基线被实际使用由 AC4 的 `landedSha` 与 `git show develop:tasks/<id>.md` 证明。
      **范围诚实**：晋升写面（promotion-driver 的 doc→develop 同步）本轮**未单独跑**——那条链是
      同族任务已修的机制、本次未改；本任务证明的是 **read/落地面**（派发与 fan-in 读的 develop）
      现在指向 quay init 建出来的那支

## Definition of Done

- [x] 复现与修复都已完成，且「第三方形态不再硬失败」有**真实跑过的**正/负两条输出
      —— 负：`ANTI-DRIFT HARD FAIL: 50 violation(s)` / 正：`ANTI-DRIFT OK`、
      `outcome=landed`（均有真实输出，见 Evidence）
- [x] 若新增检查器/判定：它在修复被 revert 后必须取假（硬规则 4：结构上不可能取假的量不是测量）
      —— 变异表（两组，各自红，还原绿）
- [x] 本条的发现与 `gap-aged-project-post-upgrade-driver-e2e` 的 AC-239 实测互相引用（后者在同一现场
      观测到本条；两侧都不许把它写成「worker 没实现」这种更弱的归因）
      —— 见 Evidence/AC5 末条

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/anti-drift-touches-check.ts
- plugin/scripts/fan-in-ts-typecheck-gate.ts
- tasks/gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing.md
- packages/quay/src/init.ts
- packages/quay/src/cli/init.ts
- packages/quay/src/branch-model.ts
- packages/quay/test/branch-model.test.mjs
- packages/quay/test/init.test.mjs
- plugin/test/worker-driver.test.mjs
- experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs
- plugin/test/packaging-hygiene-check.test.mjs
