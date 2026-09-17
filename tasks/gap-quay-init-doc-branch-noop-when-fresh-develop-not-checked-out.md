---
id: gap-quay-init-doc-branch-noop-when-fresh-develop-not-checked-out
title: quay-init 为默认分支非 develop 的全新项目建出 develop 后不切换检出，doc-branch 判定恒为
  no-op，author 永不出现
status: todo
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

## Requested action

让 `ensureBranchModel()`/`ensureDocBranch()` 的调用序列感知"develop是不是这一次运行才刚创建的"：
`develop` 由 absent 变为 created 时，`ensureDocBranch` 判定前应该把这次creation计入判断——最直接的
做法是 `ensure_target_branch_model`（`quay-init.sh`）里，`ensureBranchModel` 创建了 `develop` 之后，
如果创建时的动作是"created"（不是"reused"），就把主检出**也**切到新建的 `develop` 上，再调用
`ensureDocBranch`（这样场景B就会退化成场景A的路径，doc-branch自然被创建）。⛔ 不要在
`ensureDocBranch` 内部悄悄假设develop态，判定函数本身应保持对"develop怎么来的"无感——把切换动作放在
调用方（`ensure_target_branch_model`）的编排层，判定逻辑不变。

## Acceptance Criteria

- [ ] AC1: 用本任务描述的"场景B"（全新仓库、默认分支`main`、develop不存在）跑一次真实
      `quay init --branch-model-only --doc-branch-name author`，运行后必须：`develop`存在、
      **主检出已切到`author`**、`author`分支存在且sha等于develop（即等于main运行前的tip）。
      取假判据：改动前对同一fixture跑，必须复现当前的no-op（author不存在，检出仍在main）。
- [ ] AC2: 场景A（默认分支本来就是develop）的现有行为不得回归——同样构造一次，改动前后行为逐字一致
      （created author, switched checkout）。
- [ ] AC3: 幂等——对AC1构造的场景连续跑两次quay-init，第二次必须是no-op（已经在author上，develop/
      author sha均不变），不得二次创建或报错。
- [ ] AC4: `plugin/scripts/target-identity-literal-check.ts` 跑一遍必须仍然通过（本任务不引入新的
      "author"协议层字面量，只改编排时机）。

## Definition of Done

- [ ] 四条AC全部满足，且AC1的负控制（改动前必须复现no-op）已经在任务证据里留痕。

## Touches

- plugin/scripts/quay-init.sh（ensure_target_branch_model 的编排顺序）
- packages/quay/src/branch-model.ts（如需要新增一个"是否刚创建"的返回信号供调用方读取）
- packages/quay/test/branch-model.test.mjs
- plugin/test/quay-init-loop-helpers.mjs（如涉及）
- tasks/gap-quay-init-doc-branch-noop-when-fresh-develop-not-checked-out.md（自身）
