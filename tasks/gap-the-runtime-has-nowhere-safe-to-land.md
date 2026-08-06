---
id: gap-the-runtime-has-nowhere-safe-to-land
title: The runtime lands in the target's vendor/ — a reserved dir in Go — and is
  1.3MB against common large-file hooks; both are the same decision about where
  it may live
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

meta-cc 冷启动实测（管理者 2026-08-04 转达）。**产品侧缺陷**，
`orchestration/GOAL-when-to-reinstall.md` 已知缺陷清单第 10 条。

`vendor/quay/dist/quay.js` 是**单文件 1.3MB**，撞上 meta-cc 的 **pre-commit 大文件检查钩子**。

外层实测：`packages/quay/dist/quay.js` = **1,329,851 字节**；
出厂副本在 `plugin/vendor/quay/dist/quay.js`。

**大文件钩子是很常见的配置，不是 meta-cc 的怪癖**——
`pre-commit` 生态里 `check-added-large-files` 默认阈值 500KB，是最常被启用的钩子之一。
**⇒ 任何装了它的目标项目，在提交运行时的时候都会撞。**

### 外层判断：这不止是「烦人」，它同时挡住两道门

| 目标方按哪条路走 | 后果 | 撞哪道门 |
|---|---|---|
| **不提交运行时** | 目标的落地集合与产物不同 | **G2 失败**（落地文件必须全部与产物字节相同） |
| **改钩子/加豁免再提交** | 那是一次人工补丁 | **G0 失败**（人工补丁数必须为 0） |

**⇒ 两条路都通不过，它不是可以绕过去的小事。**
**任何「让使用者自己处理」的方案都等价于要求他打一个补丁**，而 G0 明令补丁数为 0。

### 第 11 条缺陷（管理者转 meta-cc，2026-08-04 02:05Z）——同一个决定的另一面

meta-cc 的 `DIR-103` 提交：*fix build: make Go robust to non-Go vendor dir from quay-init*。

**根因在 quay 这边**：`quay-init.sh:517` 把运行时铺成
`$WORKSPACE_ROOT/vendor/quay/dist/quay.js`——而 **`vendor` 在 Go 里是保留目录名**，
Go module vendoring 会去解析它 ⇒ **一个非 Go 的 `vendor` 目录打断 Go 项目的构建**。

**meta-cc 在自己那边让构建容错了，但那是目标项目替交付物打补丁，不是修复**——
**按门槛判据，那正好是一条人工补丁，应当计入而不是被吸收掉。**

**管理者把问题问对了，原样保留**：

> **正确的问法不是 `vendor` 该改叫什么，而是运行时该铺在哪里才不与任何目标语言的约定冲突。**
> `vendor` 只是我们撞上的第一个——`node_modules`、`target`、`build`、`dist` 各有语义。

### 外层复核：两条缺陷是同一个决定，因此合并本任务

**⇒ 本任务从「1.3MB 撞大文件钩子」扩为「运行时该铺在哪里」**，
因为**两条问的是同一件事的两面：铺在哪里、进不进目标的 git。**

**一处需要更正管理者的候选**：管理者提议铺到 `.quay/`，理由是「那已是 quay 的命名空间，
目标工具链不会去解析它」——**前半对，后半不完整**。实测本仓 `.gitignore`：

```
**/.quay/gate-events.jsonl
**/.quay/prepare-leases/
**/.quay/inner-blocked.json
```

**是选择性忽略，不是整个目录**；`.quay/config.yml` 是**被跟踪的**。
且 **`quay-init` 根本不往目标写 gitignore**（`grep -nE 'gitignore' quay-init.sh` **零命中**）。

**⇒ 铺到 `.quay/` 解决语言冲突，但不自动解决提交问题**——
**⇒ 这也正是第 10 条的根**：今天 `quay-init` 铺下的任何东西，**默认成为目标的被跟踪内容**。

### 三个必须同时满足的约束

| # | 约束 | 来源 |
|---|---|---|
| 1 | **不与任何目标语言的保留目录冲突**（非 `vendor`/`node_modules`/`target`/`build`/`dist`） | 第 11 条 |
| 2 | **不触发常见大文件钩子**（不提交，或拆分） | 第 10 条 |
| 3 | **「落地集合」的定义必须讲清**：运行时算不算其中一员（算 ⇒ 字节相同；不算 ⇒ 写明理由） | A2/G2 |

**`.quay/runtime/` + `quay-init` 主动管理一条 gitignore 条目**能同时满足 1 与 2，
**但 3 必须先答**——否则是用一个定义漏洞换一次通过。

## Contract

```
measure runtime_bytes = `stat -c %s plugin/vendor/quay/dist/quay.js` 的字节数字段
measure hook_rejects = `pre-commit run check-added-large-files --all-files` 在装有默认阈值钩子的目标上的失败数字段
band hook_rejects = 0
invariant 目标提交运行时不得需要任何人工补丁（改钩子、加豁免、加 .gitignore 例外都算补丁）
invoke `bash plugin/scripts/quay-init.sh --loop --root <target> && git -C <target> commit -am 'add runtime'`
control 目标装有默认阈值(500KB)大文件钩子 ⇒ 提交必须成功；人为把阈值降到 1KB ⇒ 必须失败（证明钩子真在跑）
resume 先量出真实阈值分布与可选方案的代价，再选方案
```

## Chosen mechanism

**先量再选，不要直接挑一个方案。** 候选路线各有真实代价，**必须写明取舍理由**：

1. **不提交运行时，改为安装时获取**（npm 依赖 / postinstall 下载）——
   **代价**：目标需要网络与包管理器；离线冷启动会断。
2. **拆分产物**（多文件、每个都在阈值下）——
   **代价**：加载复杂度；**且这只是躲开阈值，钩子阈值更低的项目仍会撞**。
3. **运行时不进目标的 git**（放在 gitignore 的运行目录，由 init 生成）——
   **代价**：与 G2「落地文件全部与产物字节相同」的关系要重新定义
   （不进 git 的文件还算不算落地集合的一部分？**这一点必须先答**）。
4. **目标声明豁免**——**已排除**：那是人工补丁，G0 明令为 0。

**外层倾向 3，但不替实现者决定**：它最贴近「运行时是产物不是源码」这个事实；
**但它要求先把 G2 的「落地集合」定义讲清楚**，否则会变成用一个定义漏洞换一次通过。

**不做**：不要求目标改自己的钩子配置（**那是把交付物的问题推给使用者**）；
不用 `.gitignore` 例外或 `--no-verify` 绕过（**同上，且 `--no-verify` 会连带跳过目标自己的其它检查**）。

## Acceptance Criteria

- [ ] AC1: **真实阈值调查**——常见大文件钩子的默认阈值（至少 `pre-commit` 的
      `check-added-large-files`）与本产物大小的对照，写进任务体
- [ ] AC2: **方案选择有理由**——从上面四条里择一（或提出第五条），
      **写明代价与被放弃的原因**；若选方案 3，**必须先回答「不进 git 的文件算不算落地集合」**
- [ ] AC3: **正向**——在装有默认阈值钩子的一次性目标上，
      照文档跑完 ⇒ **提交成功、零人工补丁**（实跑输出贴任务体）
- [ ] AC4: **钩子真在跑的负控制**——把阈值人为降到 1KB ⇒ **必须失败**。
      **这条不过，AC3 不算数**——**一个没被证明会拒绝的钩子，与没装钩子不可区分**
- [ ] AC5: **离线负控制**——若选方案 1，必须证明离线目标仍能冷启动，或**明确声明不支持离线**并写进 README
- [ ] AC6: **与 G2 的关系明确**——本方案落地后，
      G2 的「落地文件全部与产物字节相同」判据**怎么算**，写进任务体与 SPEC
- [ ] AC8（**第 11 条**）: **异构目标构建负控制**——同一产物装进一个 **Node 目标**与一个 **Go 目标**，
      **落地后两边各自的构建仍然通过**（`npm test` / `go build ./...` 实跑输出都贴出）。
      **字节相同救不了这一条**：若运行时铺在 Go 会特殊解析的目录里，两边字节相同、Go 那边照样构建失败
- [ ] AC9（**第 11 条**）: **保留目录负控制**——落地路径**不得**位于
      `vendor` / `node_modules` / `target` / `build` / `dist` 任一之下；
      检查按**路径字面量**判定并列出被排除的名字（**可扩充，不是穷举即完**）
- [ ] AC10: **gitignore 处置**——`quay-init` 若依赖「运行时不进 git」，**必须自己写入那条 gitignore**；
      **负控制：目标已有同名条目时不得重复写入或覆盖使用者的 gitignore**
- [ ] AC11（**管理者 2026-08-04 02:10Z 实测缺口**）: **把 Go 那半边补进重装门槛 e2e**——
      实测 `install-config-driven-e2e.test.mjs` 的断言关键词覆盖
      `byte-identical` / `idempot` / `upgrade` / `finding` / `npm test`，**但没有 `go build`**。
      **而 `vendor` 撞 Go 保留目录这条恰恰只有 Go 目标能暴露** ⇒
      **本任务是它的所有者**（谁修谁证明自己让它变绿）：
      A5 的 Go 半边由本任务补入 e2e 并证明其变绿
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group product`

## Definition of Done

- [ ] AC3 与 AC4 两个方向的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**「让使用者自己处理」等价于要求他打一个补丁，而 G0 明令补丁数为 0**

## Touches

- tasks/gap-the-runtime-has-nowhere-safe-to-land.md
- plugin/scripts/quay-init.sh
- packages/quay/scripts/build-dist.mjs
- plugin/test/quay-init-loop.test.mjs
- orchestration/GOAL-when-to-reinstall.md

## Dispatch review

reviewer: outer
at: 2026-08-04T00:00:00Z
changed: 管理者转 meta-cc 冷启动新出的第 10 条交付缺陷。
**外层实测证实规模**：`packages/quay/dist/quay.js` = **1,329,851 字节**，出厂副本在
`plugin/vendor/quay/dist/quay.js`。
**外层的主要判断是把它从「烦人」提到「同时挡住两道门」**：
目标若**不提交运行时** ⇒ 落地集合与产物不同 ⇒ **G2 失败**；
若**改钩子或加豁免再提交** ⇒ 那是一次人工补丁 ⇒ **G0 失败**。
**⇒ 两条路都通不过，它不是可以绕过去的小事**，
且**任何「让使用者自己处理」的方案都等价于要求他打补丁**，而 G0 明令为 0。
**机制段列了四条候选并各写代价，明确排除了「目标声明豁免」**（那正是人工补丁）。
**外层倾向方案 3（运行时不进目标 git）但不替实现者决定**，
**并把它的前置问题写死**：「不进 git 的文件还算不算落地集合的一部分」必须先答——
**否则会变成用一个定义漏洞换一次 G2 通过**，那与本仓今晚反复记录的
「换个名字继续绕」是同一族。
**AC4 是真判据**：把阈值降到 1KB 必须失败——
**一个没被证明会拒绝的钩子，与没装钩子不可区分**，
不先证明这一点，AC3 的「提交成功」可能只是钩子根本没跑。
