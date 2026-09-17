---
id: gap-quay-init-doc-branch-noop-when-fresh-develop-not-checked-out
title: quay-init 为默认分支非 develop 的全新项目建出 develop 后不切换检出，doc-branch 判定恒为
  no-op，author 永不出现
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
**type:** execution

## Finding

2026-09-17 排查"有用户使用当前版本quay后发现并没有创建author分支"这个报告。查了2026-09-14落地的
`gap-quay-init-no-doc-branch-bootstrap-leaves-main-checkout-on-develop`（status: done）——机制本身是
真实存在且已接线的：`packages/quay/src/branch-model.ts` 的 `ensureDocBranch()` 由 `cli/init.ts:164`
调用，`quay-init.sh` 的 `ensure_target_branch_model` 无条件传入 `--doc-branch-name`（默认"author"）。

**但用两个干净的、从零构造的临时 git 仓库做端到端复现，发现该机制只在一种前置条件下真正生效**：

**场景A（项目默认分支本来就叫 `develop`）——正常工作**：
```
$ git init -b develop . && git commit ... && quay init --branch-model-only --doc-branch-name author
[REUSED] landing-baseline -> develop — 'develop' contains 'develop' ...
[CREATED] doc-branch -> author — created 'author' at 'develop' (257c0339) and switched the main checkout to it
```

**场景B（项目默认分支是 `main`，develop 还不存在——绝大多数真实项目的常态）——静默 no-op，author 永不出现**：
```
$ git init -b main . && git commit ... && quay init --branch-model-only --doc-branch-name author
[CREATED] landing-baseline -> develop — created 'develop' at main (ac60e490)
[NOOP] doc-branch -> author — the main checkout is on 'main', which is not the landing baseline
       'develop' — the doc-branch invariant already holds; nothing was created, renamed or switched

后：git branch -a → develop（新建，未检出） / * main（仍然检出在这里）
```

**根因**：`ensureBranchModel()` 在 `develop` 缺失时会在当前默认分支尖端**新建** `develop`
（`branch-model.ts` 的 `landing-baseline` 角色 provisioning 分支），但**只用 `git branch`，不
`git checkout`**——不切换主检出。紧接着运行的 `ensureDocBranch()` 判定"主检出是否已经在 develop
上"时，读到的是**未切换的旧状态**（仍在 `main`），于是落入四态里的 `independent`（"不在develop上⇒
不变量已经满足"）分支，判定为no-op。**这是两个各自正确的步骤（建develop / 判doc-branch）之间的
时序交互缺口**——develop"刚刚被创建"这个事实，没有被doc-branch判定感知到。

**这正是绝大多数真实项目会踩到的场景**：现有项目几乎都用 `main`/`master` 而不是 `develop` 作为
默认分支，`quay init` 是这些项目第一次接触quay的入口——也就是说，**对典型的新用户，doc-branch
bootstrap 从设计上就不会触发**，author（或任何名字）永远不会被创建，直到有人手动把检出切到
develop、再重跑一次quay-init。

**已排除**：ad-arm1 的 archguard 项目（`/home/yale/work/archguard`）实测**是有** `author` 分支的
（当前就检出在上面，与`develop`同一时刻2026-09-15T17:35创建）——不是失败案例，只是说明它满足了
"已经手动切到develop"这个前置条件（推测是quay task工作流程中途某次操作把检出带到了develop上），
不代表这个缺口不存在。

**为什么这个缺口重要，不只是"分支名不对"（人 2026-09-17 追加）**：author 分支不是可有可无的命名
习惯——它存在的理由是把"人/主检出直接编辑"与"任务 worker 的 fan-in 目标"物理分开。`develop` 同时
承担两个角色：①落地基线（worker 任务 worktree 从它 fork、fan-in 快进回它）；②本仓库自己 CLAUDE.md
记录的纪律（"分支同步（author ↔ develop）"一节）里，`develop` 被明确要求保持
**权威、可快进**。若用户直接在 `develop` 上工作（因为 doc-branch bootstrap 没有把他们带到
`author`），常态下 `develop` 会带着未提交/已提交的本地编辑——这会在下一次 worker 任务 fan-in 
（`git merge --ff-only` 或语义合并）时产生冲突或挡住快进，因为 fan-in 假定 `develop` 除了 driver
自己的提交之外是"干净、只前进"的。**doc-branch（author）机制的全部意义就是让人有一个安全的、
不参与 fan-in 拓扑的地方去编辑**——这个意义目前没有在任何面向用户的文档（README.md 等）里说明，
使得即便本任务把 bootstrap 缺口本身修好，用户仍然不知道"为什么不能直接在 develop 上改东西"，
遇到 fan-in 冲突时无法自行诊断根因。

## Requested action

让 `ensureBranchModel()`/`ensureDocBranch()` 的调用序列感知"develop是不是这一次运行才刚创建的"：
`develop` 由 absent 变为 created 时，`ensureDocBranch` 判定前应该把这次creation计入判断——最直接的
做法是 `ensure_target_branch_model`（`quay-init.sh`）里，`ensureBranchModel` 创建了 `develop` 之后，
如果创建时的动作是"created"（不是"reused"），就把主检出**也**切到新建的 `develop` 上，再调用
`ensureDocBranch`（这样场景B就会退化成场景A的路径，doc-branch自然被创建）。⛔ 不要在
`ensureDocBranch` 内部悄悄假设develop态，判定函数本身应保持对"develop怎么来的"无感——把切换动作放在
调用方（`ensure_target_branch_model`）的编排层，判定逻辑不变。

**同时更新面向用户的文档（人 2026-09-17 追加要求）**：在 `README.md`（以及若存在的等价 init/quickstart
说明处）补一段，说明：①为什么 `quay init` 会创建一个独立的 doc-branch（默认名 `author`）并把检出
切到它上面；②为什么用户不应该手动把主检出切回 `develop` 去做日常编辑——`develop` 是 worker 任务
worktree 的 fork 起点与 fan-in 快进目标，若主检出长期停留在 `develop` 上并产生本地提交/未提交改动
（这是直接在 develop 上工作的常态），会在下一次任务 fan-in 时造成非快进冲突，挡住整条自动化流水线；
③ `author`/`develop` 各自的同步方向（doc→develop 单向传播，`develop`→`author` 靠 ff 追赶），指向
`CLAUDE.md` "分支同步（author ↔ develop）"一节作为机制正本，README 只写用户需要知道的"为什么"，
不复制机制细节（避免这份新增内容自己制造硬规则5b意义上的漂移源）。

## Implementation note (WHERE the orchestration layer actually is)

`quay-init.sh` 的 `ensure_target_branch_model` 是**薄委派**：它把"判 landing-baseline + 建 doc-branch"
**一次** `node <vendored>/quay.js init --branch-model-only --doc-branch-name <name> --root <root>` 全
交给 CLI。而 `ensureBranchModel` → `ensureDocBranch` 的**真实编排点**是
`packages/quay/src/cli/init.ts` 的 `branch-model-only` 分支。所以切换动作落在那里（两个步骤之间），
shell 侧无需拆成两次调用、也无需新增 CLI flag。判定函数 `ensureDocBranch` **逐字节未改**
（file 内新增的是三个独立导出的机件，判定四态一字未动），符合"⛔ 不要在 ensureDocBranch 内部悄悄
假设 develop 态"。

切换条件取**两个事实的合取**：①baseline 是**本次运行**才建立的（`created` ∥ `adopted`）；
②baseline 的 sha **等于主检出 HEAD 的 sha**。②保证切换是**纯元数据**——working tree 一字节不变；
若 develop 不解析到当前检出 commit，则报 NOT-EVALUATED 并**不动**（把用户工作树搬到另一棵树上不是
这一步的授权范围）。`reused` 被**刻意排除**：该 ref 早于本次运行存在，检出相对它的位置是操作者
自己的状态，且 `--branch-model-only` 必须在场景①/②上逐字不变。

## Acceptance Criteria

- [x] AC1: 用本任务描述的"场景B"（全新仓库、默认分支`main`、develop不存在）跑一次真实
      `quay init --branch-model-only --doc-branch-name author`，运行后必须：`develop`存在、
      **主检出已切到`author`**、`author`分支存在且sha等于develop（即等于main运行前的tip）。
      取假判据：改动前对同一fixture跑，必须复现当前的no-op（author不存在，检出仍在main）。
- [x] AC2: 场景A（默认分支本来就是develop）的现有行为不得回归——同样构造一次，改动前后行为逐字一致
      （created author, switched checkout）。
- [x] AC3: 幂等——对AC1构造的场景连续跑两次quay-init，第二次必须是no-op（已经在author上，develop/
      author sha均不变），不得二次创建或报错。
- [x] AC4: `plugin/scripts/target-identity-literal-check.ts` 跑一遍必须仍然通过（本任务不引入新的
      "author"协议层字面量，只改编排时机）。
- [x] AC5: `README.md` 新增一段落，同时命中以下两个可 grep 判据（各取一条关键词即可，允许改写措辞
      但语义须覆盖）：(a) 提及为什么 `quay init` 会创建/切换到一个独立的 doc 分支（如"author"）；
      (b) 提及直接在 `develop` 分支上编辑/提交会挡住任务 fan-in（关键词如"fan-in"/"快进"/"ff-only"
      与"develop"同段共现）。取假判据：改动前对当前 README.md 跑同一 grep，必须命中 0（即当前完全
      没有这段说明——已核实 2026-09-17 现状：README.md 不含"doc-branch"/"author 分支"任何解释性文字）。

## Definition of Done

- [x] AC1-AC4 全部满足，且AC1的负控制（改动前必须复现no-op）已经在任务证据里留痕。
- [x] AC5 满足，README.md 的新增段落已提交，且负控制（改动前 grep 命中 0）已在任务证据里留痕。

## Evidence

**载体 = 交付物本身的 `plugin/vendor/quay/dist/quay.js`（用户真实运行的那个 runtime；`scripts/test.sh`
的 build_dist_once + sync-vendor.sh --sync-dist 每次套件都会重建并镜像它）。** 实现提交
`87b1014f7`，自动化判据在 `packages/quay/test/branch-model.test.mjs`（51/51 绿，其中 10 条为本任务
新增）。

**AC1 取假判据（改动前的负控制，2026-09-17 实测）** — 同一 fixture（`git init -q -b main` + 一个
commit），改动前跑 `quay-init.sh`：
```
  [CREATED] landing-baseline -> develop — created 'develop' at main (79f24d7f)
  [NOOP] doc-branch -> author — the main checkout is on 'main', which is not the landing baseline
         'develop' — the doc-branch invariant already holds; nothing was created, renamed or switched
-> HEAD=main  branches=[develop main]  author_exists=0
```
改动后同一 fixture：`[SWITCHED] baseline-checkout` 出现，然后
`[CREATED] doc-branch -> author — created 'author' at 'develop' (c1f93db2)`，
`-> HEAD=author  develop=author=<pre-run main tip>`。

**同形兄弟（硬规则 5b 扫描）**：`grep` landing-baseline 的 provisioning 动作点，除 `created` 外还有
`adopted` —— 它留下**完全相同**的状态（baseline 被重指到检出所在的 commit），实测同样产出
`[NOOP] doc-branch` / HEAD=main / author 不存在。**已一并修复并单测覆盖**（与 `created` 同一谓词、
同一守卫，不是另一条码路）。其余动作：`reused` 刻意不触发（见 Implementation note）、
`blocked`/`unreadable` 什么都没建立。

**AC5 取假判据**：改动前 `grep -n "doc-branch\|doc branch\|author 分支" README.md` 命中 **0**。

## Touches

- plugin/scripts/quay-init.sh（ensure_target_branch_model 的编排顺序 + 新增 `[FAILED] baseline-checkout` 中继臂）
- packages/quay/src/branch-model.ts（新增 `landingBaselineEstablishedNow` / `moveCheckoutOntoLandingBaseline` / `formatBaselineCheckoutReport`；判定函数四态未改）
- packages/quay/src/cli/init.ts（handoff 的真实调用点）
- packages/quay/test/branch-model.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json（quay-init.sh 变更后的机械重锚；gate 绿=shrink-only）
- README.md（新增 author/doc-branch 说明段落）
- tasks/gap-quay-init-doc-branch-noop-when-fresh-develop-not-checked-out.md（自身）
