---
id: gap-quay-init-no-doc-branch-bootstrap-leaves-main-checkout-on-develop
title: quay-init 从不建立 doc 工作分支——主检出留在 develop 上时,人类编辑和 driver 提交共享同一条分支、同一个 git 索引
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: plan
---
## Proposal

**实测证据（2026-09-13，第三方项目 quay-fleet）**：`git branch -a` 确认 quay-fleet 从建库起从未存在过任何
doc 工作分支，主检出（`~/work/quay-fleet`）直接停在 `develop` 上。`.quay/doc-develop-sync.jsonl`（driver-filters.ts
的 `DOC_DEVELOP_SYNC_EVENT_REL`）在 quay-fleet 里从未存在过一行——因为 `propagateDocBranchToDevelop`
（`plugin/scripts/driver-filters.ts:521-530`）在 `cur === "develop"` 时于 `:527` 直接 `return true`短路，
从未走到需要真正同步的分支。**这不是缺陷本身**——机制正确处理了这个退化场景。**缺陷是：从来没有人／没有
机制让 quay-fleet 走出这个退化场景，去获得 quay 自己在用的那层安全缓冲**。

quay 自己仓库的纪律（CLAUDE.md「分支同步」一节，DIR-027）要求人类在私有 doc 工作分支（`author`）上编辑、
`develop` 只由驱动机制写入——理由是避免人类编辑与驱动的自动提交共享同一条分支、同一个 git 索引产生竞态
（同一节点还记着「不 add 与 commit 之间等待，索引是跨层共享的可变状态」这类实证教训）。quay-fleet 没有这层
缓冲：本次会话里对 `quay-fleet/scripts/test.sh` 的多次直接编辑，与当时活着的 driver 进程共享的是同一条
`develop` 分支——目前没有真的撞车（`git log --all` 未查到一次冲突提交），但这是运气好，不是结构保证。

**已核实的、与直觉相反的既有设计决定（不是我们要绕过的东西，是要在其约束内工作的东西）**：
`packages/quay/src/branch-model.ts:140-151` 的 `resolveDocBranchRole()` 文档字符串逐字写着：
> ⛔ NOT a name. `author` is quay's OWN naming convention, not part of the protocol, so hardcoding it
> is a per-project identity literal — exactly the defect
> `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync` removed from `driver-filters.ts`
> ... `quay init` therefore REPORTS which branch fills the role and **never creates** a doc branch.

且 `plugin/scripts/target-identity-literal-check.ts:60` 有一条**真实、带变异测试的静态检查**：
```ts
export const LEGAL_IDENTITY_VALUES = new Set(["develop", "integration", "master", "HEAD", "tasks"]);
```
`"author"` 被故意排除在外（`:59` 注释：「它是本仓库的 doc 分支命名约定，逐项目不同」）。同文件 `:28` 注释
明确：「配置模板不算代码，不报；注释里拼写 `const DOC_BRANCH = "author"` 也不报」——即该检查只拦**机制代码
里把 "author" 当成放之四海皆准的协议值**，不拦"author"作为某个具体项目的配置默认值出现。

**人已裁定的调和方案（2026-09-13）**：机制本身（`branch-model.ts`/`quay-init.sh`）保持名字无关——只做
「当前主检出所在分支 == develop（即没有独立 doc 分支）时，在 develop 当前尖端建一条新分支并切过去」这个
通用操作；**分支的具体名字来自调用方/配置传入，不由机制硬编码**，默认值可以是 `"author"`，落在配置模板/
CLI 参数层（同 `:28` 注释已豁免的形态），不进 `resolveDocBranchRole()`/`ensure_target_branch_model` 的
判断逻辑本身。

**与既有任务的关系（去重，⛔ 不构成依赖声明）**：
`gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing`（done）建立了
`resolveDocBranchRole()`/`ensureBranchModel` 并明确裁定「只报告不创建」doc 分支；
`gap-upgrade-entry-never-establishes-branch-model`（done）把 landing-baseline 的建立接进 shipped
`quay-init.sh` 的 `ensure_target_branch_model`，但同样只覆盖 master/develop 角色，doc 分支不在其范围；
`gap-ac226-target-identity-literal-check`（done）移除了 `DOC_BRANCH = "author"` 这个裸字面量并把
`"author"` 排除在 `LEGAL_IDENTITY_VALUES` 协议白名单之外。三者都是本任务的前提约束，均未创建过 doc 分支
——本任务是它们共同留下的缺口，不是对它们的重复。

## Plan

1. **状态机（复用 `resolveDocBranchRole()` 已有的运行时判定，不新造判据）**，接入点是
   `plugin/scripts/quay-init.sh:2767` 的 `ensure_target_branch_model`（已在**每次**调用无条件执行——新建
   与老项目重跑都会走到，天然满足"同版本幂等"要求，因为每次都是从当前 git 状态重新判定，不依赖任何缓存
   的"是否已跑过"标记）：
   - **主检出当前 == develop** → 在 develop 当前尖端建一条新分支（名字来自 `--doc-branch-name` CLI 参数
     或 `.quay/config.yml` 配置项，未指定时默认建议 `"author"`）、`git checkout` 切过去。零工作树差异（新
     分支与 develop 内容此刻完全相同），纯 git 元数据操作。
   - **主检出已经在某个非 develop 分支上**（不论叫什么名字）→ 不做任何事，已满足不变式，⛔ 不因为名字
     不是配置默认值就强行改名。
   - **配置默认名对应的分支已存在，但与当前 develop 无祖先关系**（真撞名，历史无关）→ ⛔ 拒绝自动处理，
     报错说明冲突（`git merge-base --is-ancestor` 判定），交给人决定，不静默覆盖——直接复用
     `branch-model.ts` 里 `adopt` 模式已有的「备份旧 tip 到 `<branch>-pre-quay-init-<sha>` 再 `git branch -f`」
     原语（`:476` 附近），不重新发明。
   - **HEAD detached / 无法读取当前分支** → 按 `branch-model.ts` 现有的"unreadable ⇒ 不判定"原则处理
     （`detectDefaultBranch` 的 `null` 返回路径），不假装成任何一种已知状态。
2. **落笔位置**：新逻辑作为 `ensure_target_branch_model` 内、`branch-model.ts` 现有 `--branch-model-only`
   报告之后的一步（或该 CLI 命令自身的新增子选项），不新建一条独立命令——用户裁定明确要求"同一版本的
   quay-init 应当是幂等的"，接入到已经无条件运行的现有步骤里最简单直接。
3. ⛔ 不修改 `target-identity-literal-check.ts` 的 `LEGAL_IDENTITY_VALUES`——"author"故意不在协议层白名单
   这条决定本身不变；本任务只是在配置/参数层使用这个默认值，不需要也不应该动这条检查。

## Acceptance Criteria

- [ ] AC1 四个状态各构造一个真实临时 git 仓库（不是内存 mock）验证：①主检出在 develop 上时，运行后主检出
      切到新建分支，该分支 sha 与运行前的 develop sha 相同；②主检出已在某非 develop 分支（随便起个名字）
      时，运行后分支名和 HEAD sha 均不变（真正的 no-op，不是"看起来没变但悄悄做了什么"）；③预先构造一个
      与默认名同名、但和当前 develop 无共同祖先的分支，运行后必须拒绝（非零退出或明确的 BLOCKED 输出）且
      develop/该分支两者 sha 均不变；④HEAD detached 时运行后必须回退到"不判定"路径，⛔ 不得当作①或②处理。
- [ ] AC2 幂等：对同一个仓库连续跑两次（第二次紧跟第一次之后，不清理任何状态），第二次必须是状态②那类
      no-op（HEAD sha 与第一次跑完后完全相同），⛔ 不得报错、不得二次创建、不得改动任何文件。
- [ ] AC3 `--doc-branch-name` 未指定时默认值确实是 `"author"`，且这个字面量只出现在 CLI 参数/配置默认值
      读取处；跑一遍 `plugin/scripts/target-identity-literal-check.ts` 对本任务改动后的代码库，必须仍然
      **通过**（不因为本任务引入了字面量 "author" 而使该检查转红——这是对"调和方案是否真的没违反既有约束"
      的直接可执行验证，不是靠人读代码判断）。
- [ ] AC4 在真实的第三方项目 quay-fleet 上做一次**只读分类**（复用 AC1 状态①的判定逻辑，`--dry-run`，不
      真的创建/切换分支）：断言判定结果确实是"状态①：主检出在 develop 上，无独立 doc 分支"——用真实项目
      验证判定逻辑读得对，而不是只在合成 fixture 上通过。⛔ 本 AC 不要求真的对 quay-fleet 执行切换（那是
      对一个正在跑活 driver 的真实项目做状态变更，需要人另外决定时机与授权，不在本任务范围内）。
- [ ] AC5 全量 `scripts/test.sh` 绿。

## Definition of Done

- 五条 AC 全部满足。
- ⛔ 不得修改 `LEGAL_IDENTITY_VALUES`（`target-identity-literal-check.ts:60`）——协议层白名单不变，
  AC3 验证的正是"不用改这条清单也能达到人要的效果"。
- ⛔ 不得让 `resolveDocBranchRole()`/`branch-model.ts` 的判定函数本身对任何字面量分支名（含 "author"）
  做特殊分支处理——判定逻辑必须对"主检出当前在哪条分支"保持名字无关，这是 AC1 四态测试要覆盖的核心不变式。
- ⛔ 不在本任务里真的对 quay-fleet 执行分支切换（AC4 明确限定为只读分类）——那是一次对活跃第三方项目的
  状态变更，留给后续单独决定，不因为本任务落地就自动发生。
- 任务体保留本条的两个第一手证据：quay-fleet 的 `git branch -a` 读数（无 author 分支）+ `resolveDocBranchRole`/
  `target-identity-literal-check.ts` 的既有设计决定原文引用。

## Touches
- plugin/scripts/quay-init.sh
- packages/quay/src/branch-model.ts
- tasks/gap-quay-init-no-doc-branch-bootstrap-leaves-main-checkout-on-develop.md
