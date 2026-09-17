---
id: gap-spec-release-hotfix-branching-2026-09-17-revision
title: orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md 未按 GOAL-023
  修订 ⇒ AC-287 判据 exit 1（CAUSE=spec-not-amended）——§3.2.1 补 2026-09-17
  追加裁定（反转默认分支到 master）+ AC-273 转 superseded + 三条线设计补第四条 author
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-287
---
**type:** execution

## Proposal

**缺口（AC-287 判据，立案当轮直接量，2026-09-17，cwd = 主检出 `/home/yale/work/quay`）**：

`goals/AC-287-spec-release-and-hotfix-branching-2026-09-15-md-完成对应修订.md` 的 criterion 逐字重跑，**实测 exit 1**，逐字：

```
CAUSE=spec-not-amended — orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md is missing: no-2026-09-17-addendum
exit=1
```

⇒ 缺口不是「判据读不懂」（它打印了具名 `CAUSE=` 与**缺哪一臂**，不是硬规则 3b 的静默通过），是**被判定对象尚未修订**。

**三臂现状（逐条打印命中，硬规则 2 的配套动作）**：

```
$ grep -n  "2026-09-17" SPEC        →  0 命中
$ grep -n  "AC-273"     SPEC        →  4 命中: 218, 445, 485, 572
$ grep -in "author"     SPEC        →  1 命中: 65
```

⚠️ **关键判读（硬规则 3b/4 形态，本任务体的立论支点）**：criterion 的三臂里有**两臂今天已经绿**——
但绿在**反转之前写的旧文本**上：line 65 是 §2.1 的旧四条线表行（2026-09-15 写），
lines 218/445/485/572 是 2026-09-15 的旧判据与迁移顺序行。
⇒ **只往 SPEC 里塞一个 `2026-09-17` 字符串，AC-287 就会转绿，而三处实质修订一处都没做。**
**AC-287 是这次修订的一个弱代理**——它的三臂是「存在性」检查，不是「修订已发生」检查。
⊢ 本任务的 DoD 因此**不锚在 criterion 上**，只把 criterion 当**必要条件之一**；实质达成的判据是下面三处修订各自的
行级「改前/改后」对照。

**三处实质修订**（GOAL-023 §方案 5 逐字要求）：

**① §3.2.1 增补一条 2026-09-17 追加裁定**，记录这次反转及理由（**参照该 SPEC 自己 §11 的追加裁定写法**——
「背景 → 人裁定 → ⊢ 效力 → 与既有授权链的关系」）：
- **反转内容**：默认分支 `develop` → `master`。人 2026-09-17 提议：本地开发继续以 develop 为主不变，
  但 GitHub 默认分支 / marketplace 对外展示应为 `master`（已发布版）。
- **理由（直接量）**：`claude plugin marketplace add yaleh/quay`（**不带 ref**）读的是 GitHub 仓库**默认分支**
  ⇒ 当前 default=develop 使外部用户浏览 marketplace 时看到 `0.10.0-dev` 这类 `-dev` 版本号
  （实际装出的字节仍正确来自 `dist-plugin`=0.9.0，这是**元数据展示层**问题，不是产物错误）。
- **§3.2.1 原裁定哪一半失效**：line 192-196「nvie 原文时代『默认分支 = master』是因为默认分支同时承担『门面』和
  『PR 目标』；本仓库的 PR/worktree 目标应当是主干，**发布线不需要当默认分支**」——**前半句的观察今天仍然对**，
  但它**没料到 marketplace 的对外门面复用「默认分支」这同一个量**：PR/worktree 目标要 develop，
  而门面要 master，两者在 2026-09-15 被当成一件事 ⇒ 这是**一个量承担两个目的**的形态，反转的是目的排序，不是观察本身。
- **本 SPEC 不自行写 goal store**（§7 头的既有纪律）；反转的**判据**由 GOAL-023 的 AC-285 / AC-284 承载。

**② `AC-273` 标记 `superseded`，并注明被谁取代**：
- goal store 侧：`node packages/quay/bin/quay.js goal write AC-273 --status superseded`（`abi.ts:96` 的 goal 状态机
  `draft → active → achieved / superseded / retired` 已支持；AC-273 现为 `achieved`）。
- **取代关系**：原 `AC-273` 一条判据**混合检查了两件正交的事**——「GitHub 默认分支对不对」与隐含地
  「worktree 会不会跟着分叉对」。拆成两条正交判据：**AC-285**（默认分支实测=master）+ **AC-284**（worktree 分叉点被
  merge-base/is-ancestor 结构性校验，不再只查分支名）。
- SPEC 侧：§7 丁 行（line 445）与 §9 第 1 行（line 485）**就地标注** superseded + 接替关系。
  ⚠️ **硬规则 5b**：这不是「改一处」，同一裁定在 SPEC 内至少有 **4 处**落点（上面 grep 的 218/445/485/572）——
  218/572 是**转引**其它上下文，就地加一行指向 §3.2.1 新裁定的短注即可；445/485 是**判据行与迁移行**，必须显式标注。

**③ 三条长期线的设计补第四条 `author`**：
- 现落点：§2.1「四条线的实际角色」表（line 59-66）已有 `author` 行，但 **§3.1「每条线的唯一权威角色」表
  （line 176-183）只有三条长期线**，且 §3 的 ASCII 图（line 150-174）没有它。
- 补写内容：`author` = **本地 doc-only 写面**（非权威）、与 `develop` **双向 ff 同步**、**现在起也推送 origin 备份**
  （单点失效防护，见 `gap-ac283-author-pushed-to-origin-and-ancestor-of-local`）、**写清推送频率约定**。

**非目标（⛔ 边界，避免与在飞的兄弟任务重叠）**：

| ⛔ 不做 | 已由谁持有 |
|---|---|
| 把 GitHub 默认分支真翻到 master | `gap-ac285-github-default-branch-master`（`goal_ac: AC-285`） |
| 把 `author` 推到 origin | `gap-ac283-author-pushed-to-origin-and-ancestor-of-local`（`goal_ac: AC-283`，已 done） |
| 加固 `dispatch-worktree-setup.sh` 的分叉点闸 | `gap-ac284-worktree-forkpoint-check`（`goal_ac: AC-284`） |
| 改 `CLAUDE.md` 的「分支同步」节（task 状态写入面） | GOAL-023 §范围与非目标 明确排除 |

⇒ **本任务的落地面只有两项：SPEC 文档与 AC-273 的 goal 记录状态。零代码改动。**

<!-- dedup-ref -->
**追溯（⛔ 非前置声明）**：本条与 AC-283 / AC-284 / AC-285 三条任务是**同一 GOAL 下的正交切片，彼此不构成
prerequisite，任意一条的完成都不被另一条拉黑**；本条判据的 `grep` 只读 SPEC 文本与 AC-273 的 goal 状态，
**不读**那三条任务所改变的任何量（远端 ref / 仓库设置 / `dispatch-worktree-setup.sh`）。

## Plan

1. **取基线**：把 SPEC 现有 4 处 `AC-273` 落点（218/445/485/572）与 §2.1 / §3 的线表逐行存档，
   作为「改前」对照（⛔ 不能事后凭记忆重建）。
2. **写 §3.2.1 追加裁定**：在该节末尾（line 231 的 `---` 之前）插入 2026-09-17 追加裁定块，
   形式对齐 §11（背景 / 人裁定 / ⊢ 效力 / 与 §1 授权链的关系）。
3. **写 §3.1 第四条线 + §2.1 补推送备份约定**：§3.1 表加 `author` 行；§3 的 ASCII 图补 `author` 双向 ff 边；
   §2.1 的 `author` 行读数列补「已推送 origin，sha = …」与推送频率约定。
4. **在 445 / 485 就地标注 superseded**，并给 218 / 572 加指向 §3.2.1 新裁定的短注。
5. **翻 AC-273 的 goal 状态**：`quay goal write AC-273 --status superseded`，回读 `quay goal show AC-273 --json` 确认。
6. **复跑 AC-287 criterion**：`node packages/quay/bin/quay.js goal gate AC-287 --dry-run`（⛔ 不用本地 python 重写）
   ⇒ 必须 exit 0；同时贴修订**前**的 exit 1 读数作为可打红的对照。
7. **行级对照留痕**：三处修订逐条给出「改前行号+内容 / 改后行号+内容」，落成任务体内联或 `.quay/ac287-*` 未跟踪
   scratch 文件（⛔ 不是只写「已修订」）。
8. **核作用域**：`git diff --stat` 中无 `plugin/**`、`packages/**`、`.github/**` 条目。

## AC

- [ ] AC1 **§3.2.1 含 2026-09-17 追加裁定**：`grep -n "2026-09-17" orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` 命中 ≥1，**且打印命中行内容证明它是 §3.2.1 区间（line 198-231 附近）内的裁定条目**，⛔ 不是正文别处顺带出现的日期
- [ ] AC2 **AC-273 在 goal store 转 superseded**：`node packages/quay/bin/quay.js goal show AC-273 --json` 的 `status == "superseded"`（⛔ 不是任务体里一句声称）
- [ ] AC3 **SPEC 内旧裁定就地标注**：`grep -n "superseded"` 命中 ≥2，且命中包含 §7 丁 行与 §9 第 1 行；每处点名 **AC-285 + AC-284** 的接替关系
- [ ] AC4 **`author` 作为第四条线写入 §3.1 表**：`grep -n "author"` 命中 ≥3，**且命中行包含 §3.1 表的新行与推送备份约定行**（⛔ 不只是 line 65 的旧 §2.1 表行）；打印全部命中行内容
- [ ] AC5 **AC-287 criterion 逐字重跑 exit 0**：贴完整输出（走 store 自己的 runner `quay goal gate AC-287`，⛔ 不是本地重写的副本）
- [ ] AC6 **负控制（判据能取假）**：修订**前**的读数已实测为 exit 1 / `CAUSE=spec-not-amended`（见 Proposal 逐字），贴出；证明 AC-287 不是恒绿
- [ ] AC7 **防「旧文本冒充新修订」**（硬规则 2 配套动作）：打印三臂各自命中的**行号 + 行内容**，逐条核对——`author` 命中含 §3.1 新行、`AC-273` 命中含 445/485 的 superseded 标注行、`2026-09-17` 命中含 §3.2.1 裁定块；⛔ 只贴 `grep -c` 计数不算

## DoD

1. **落地对象**：SPEC 修订**真的在 `develop` 上**——`git show develop:orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md | grep -c "2026-09-17"` ≥1（⛔ 不是停在某个未合并的 `task/*` worktree 分支上，见 `promotion-gate-reads-develop-ref-so-unpropagated-fix-is-invisible`）。
2. **AC-273 的 superseded 是 goal store 的真实状态**：由 `quay goal show AC-273 --json` 直读，⛔ 不是任务体里的声称。
3. **AC-287 criterion 实跑 exit 0** 且输出贴进任务记录；同时附上修订前的 exit 1 读数（AC6）作为**可打红的对照**。
4. **三处修订逐条给出「改前 / 改后」的行级对照**（行号 + 内容），使下一轮可独立复算，⛔ 不是只写「已修订」。
5. **作用域**：`git diff --stat develop...HEAD` 无 `plugin/**`、`packages/**`、`.github/**` 条目（零代码改动）。
6. **证据留痕**：判据输出、正/负控制、行级对照落成**任务体内联**或 `.quay/ac287-*` **未跟踪** scratch 文件。

## Touches

- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- goals/AC-273-默认分支落在主干-origin-head-指向-origin-develop-新-clone-与-harness-wor.md
- tasks/gap-spec-release-hotfix-branching-2026-09-17-revision.md

（说明：本任务的落地面是**两份文档类产物**——SPEC 正文 + AC-273 的 goal 记录 frontmatter 里的 `status` 字段——
**不改产品代码、不新增检查器**。因此 Touches 里**没有「实现文件 + 测试文件」这一对可列**：这一改动的常设守卫
就是 **AC-287 自己的 criterion**（`goals/AC-287-*.md`），它由 goal-driver **每轮**执行，本身就是「修订是否仍然在位」的
回归检查——AC6 的负控制读数证明它能取假，不是恒绿。同款先例：`gap-ac285-github-default-branch-master`
的 Touches 亦只有自身一条具体路径，理由同形。
证据一律**内联在任务体**或写进 `.quay/` 下的**未跟踪** scratch 文件——按
`touches-glob-on-quay-runtime-artifacts-blocks-promotion`，未跟踪运行时产物不进 `anti-drift-touches-check` 的
`actualFiles`，声明它们反而是噪声且会挡晋升；⛔ 若确要把某个 `.quay/ac287-*` 文件**提交**，必须把它的
**精确路径**（⛔ 不是通配形）加进本节。）