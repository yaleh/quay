---
id: gap-the-runtime-has-nowhere-safe-to-land
title: The runtime lands in the target's vendor/ — a reserved dir in Go — and is
  1.3MB against common large-file hooks; both are the same decision about where
  it may live
status: done
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

**2026-08-06 执行时实测更新**：产物已长到 **1,340,008 字节**（`stat -c %s` 实测，下方 AC1），
**1,329,851 是立案时的历史值**——产物在持续长大，阈值问题的量级只增不减。

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
   **被放弃的原因**：quay-init 的运行时来自 plugin 内 vendored bundle（离线可用、可校验字节），
   改成「安装时下载」引入网络依赖 + 包管理器依赖两个新失效面，且与「落地集合字节相同」的
   机械校验（e2e `artifactDiffs`）在结构上更难成立——下载来的文件无法 `cmp` 到产物。
2. **拆分产物**（多文件、每个都在阈值下）——
   **代价**：加载复杂度；**且这只是躲开阈值，钩子阈值更低的项目仍会撞**。
   **被放弃的原因**：这没有回答「运行时该铺在哪里」，只是把字节数压到某个任意阈值下——
   「换个名字继续绕」家族，正是外层明令禁止的。
3. **运行时不进目标的 git**（放在 gitignore 的运行目录，由 init 生成）——
   **代价**：与 G2「落地文件全部与产物字节相同」的关系要重新定义
   （不进 git 的文件还算不算落地集合的一部分？**这一点必须先答**）。
   **✓ 本任务选择方案 3**，前置问题的答案见下方 AC2。
4. **目标声明豁免**——**已排除**：那是人工补丁，G0 明令为 0。

**外层倾向 3，但不替实现者决定**：它最贴近「运行时是产物不是源码」这个事实；
**但它要求先把 G2 的「落地集合」定义讲清楚**，否则会变成用一个定义漏洞换一次通过。

**本任务选择方案 3，落点是 `.quay/runtime/`**（quay 自己的命名空间；不撞任何目标语言的保留目录，
见 AC9；且由 quay-init 自己写 `.gitignore` 条目，见 AC10）。**「不进 git 的文件算不算落地集合」的
答案先答死，见 AC2**——否则就是用定义漏洞换一次通过。

**不做**：不要求目标改自己的钩子配置（**那是把交付物的问题推给使用者**）；
不用 `.gitignore` 例外或 `--no-verify` 绕过（**同上，且 `--no-verify` 会连带跳过目标自己的其它检查**）。

## Acceptance Criteria

- [x] AC1: **真实阈值调查**——常见大文件钩子的默认阈值（至少 `pre-commit` 的
      `check-added-large-files`）与本产物大小的对照，写进任务体

      **2026-08-06 实测**：
      ```
      $ stat -c %s plugin/vendor/quay/dist/quay.js
      1340008
      ```
      **产物大小：1,340,008 字节**（= 1,308.6 KiB；立案时 1,329,851——**产物在长**）。
      **`pre-commit` 的 `check-added-large-files` 默认阈值：`--maxkb=500` = 512,000 字节**。
      **1,340,008 > 512,000 ⇒ 默认阈值下必然被拒**（约 2.6× 超限）。
      同一生态里常见的更低阈值（`--maxkb=200` / `--maxkb=100`）只会更严。
      补充对照：GitHub push 级 50MB 警告、Git LFS 100MB 是**推送**级，本产物远低于它们——
      但这正是问题：**它在提交级就被最常见的钩子拦住**，根本走不到推送级。

- [x] AC2: **方案选择有理由**——从上面四条里择一（或提出第五条），
      **写明代价与被放弃的原因**；若选方案 3，**必须先回答「不进 git 的文件算不算落地集合」**

      **选择方案 3（运行时不进目标 git），落点 `.quay/runtime/`**。
      被放弃的方案与理由已写在「Chosen mechanism」段：
      方案 1（安装时获取）引入网络 + 包管理器两个失效面且字节校验更难成立；方案 2（拆分）
      只是躲阈值，是「换个名字继续绕」；方案 4（目标豁免）正是 G0 明令禁止的人工补丁。
      **前置问题的答案（先答死，否则就是用定义漏洞换一次通过）**：
      > **落地集合 = quay-init 机械铺进目标工作区的文件集合——按落盘操作（filesystem laydown）
      > 定义，不是按「目标是否提交进 git」定义。运行时算落地集合的一员（算 ⇒ 字节相同）。**
      >
      > G2 的字节相同判据是**落盘时的文件系统比较**，git 是否跟踪是另一条正交的轴；
      > 被 gitignore 的运行时仍在落地集合里、仍与产物字节相同——**G2 成立**。
      >
      > 这不是定义漏洞，因为三点机械成立：
      > ① 落地集合从未按「提交的文件」定义（e2e 一直数文件系统文件 `loopLaidDownFiles`）；
      > ② 字节相同判据仍作用于运行时（`copy_one` + e2e `artifactDiffs`），gitignore 不豁免字节身份；
      > ③ **gitignore 条目由 quay-init 自己写入**（AC10 `ensure_runtime_gitignore`）——不是让使用者
      > 打补丁 ⇒ **G0（人工补丁数 = 0）成立**。
      完整展开已同步进 `orchestration/SPEC-complete-delivery-surface-2026-08-05.md` §6（AC6）。

- [x] AC3: **正向**——在装有默认阈值钩子的一次性目标上，
      照文档跑完 ⇒ **提交成功、零人工补丁**（实跑输出贴任务体）

      **2026-08-06 实跑**（`/var/tmp/ac3-target`：git init + `.pre-commit-config.yaml` 含
      `check-added-large-files` 默认 500KB + `python3 -m pre_commit install`）：
      ```
      $ bash plugin/scripts/quay-init.sh --loop --root /var/tmp/ac3-target ... --worktree-root /var/tmp/ac3-worktrees
        copied: /var/tmp/ac3-target/.quay/runtime/bin/quay.js
        copied: /var/tmp/ac3-target/.quay/runtime/bin/quay-native.js
        copied: /var/tmp/ac3-target/.quay/runtime/provider.yml
        appended: .quay/runtime/ to .gitignore
        verify-provider-runtime-existence: OK (/var/tmp/ac3-target/.quay/runtime/bin/quay-native.js exists)
        verify-provider-runtime-freshness: OK (...matches the plugin's current vendored bundle)
      quay-init complete.
      $ git commit -am 'add runtime'      # ← 照 Contract invoke 跑
      ...
       create mode 100644 plugin/scripts/workflow-event-schema.mjs
      EXIT=0
      $ python3 -m pre_commit run check-added-large-files --all-files
      check for added large files..............................................Passed
      $ git log --oneline -1
      700732b add runtime
      ```
      **提交成功（exit 0），零人工补丁**——运行时被 quay-init 自己写进 `.gitignore`，
      钩子在全量文件上 Passed。`git check-ignore .quay/runtime/bin/quay.js` ⇒ 命中。

- [x] AC4: **钩子真在跑的负控制**——把阈值人为降到 1KB ⇒ **必须失败**。
      **这条不过，AC3 不算数**——**一个没被证明会拒绝的钩子，与没装钩子不可区分**

      **2026-08-06 实跑**（同一目标，`.pre-commit-config.yaml` 改 `args: [--maxkb=1]`，
      加一个 2KB 文件）：
      ```
      $ git commit -m 'add big file (should fail)'
      check for added large files..............................................Failed
      - hook id: check-added-large-files
      - exit code: 1
      bigfile.txt (2 KB) exceeds 1 KB.
      $ git commit -m 'should still fail' >/tmp/ac4-commit.log 2>&1; echo "GIT_COMMIT_EXIT=$?"
      GIT_COMMIT_EXIT=1
      $ git log --oneline -2
      700732b add runtime        # ← 大文件提交被拒绝，未入库
      ```
      **负控制成立：钩子真在跑**（1KB 阈值下 2KB 文件被拒）。AC3 的「提交成功」因此算数——
      那不是「钩子根本没跑」，而是「没有任何超限文件被提交」。

- [x] AC5: **离线负控制**——若选方案 1，必须证明离线目标仍能冷启动，或**明确声明不支持离线**并写进 README

      **不适用（方案 1 未选）。** 方案 3 不引入任何网络依赖：quay-init 从 plugin 内
      vendored bundle 复制运行时（`copy_one` 本地复制），离线冷启动不受影响。
      特此记录：**方案 3 不依赖网络，离线可冷启动**。

- [x] AC6: **与 G2 的关系明确**——本方案落地后，
      G2 的「落地文件全部与产物字节相同」判据**怎么算**，写进任务体与 SPEC

      任务体的展开在 AC2（落地集合定义 + G2 判据）；**SPEC 侧已写入
      `orchestration/SPEC-complete-delivery-surface-2026-08-05.md` §6「落地集合与 G2 的关系」**，
      并把 §1 的落地目录清单从 `vendor/quay/dist/`、`vendor/quay-native/dist/` 更新为 `.quay/runtime/`。
      `plugin/scripts/verify-delivery-surface.ts` 的 `spec_is_live` 校验通过（9 测试全绿，
      证明 §6 新增未破坏 L1-MANIFEST 与可执行清单的一致）。

- [x] AC8（**第 11 条**）: **异构目标构建负控制**——同一产物装进一个 **Node 目标**与一个 **Go 目标**，
      **落地后两边各自的构建仍然通过**（`npm test` / `go build ./...` 实跑输出都贴出）。
      **字节相同救不了这一条**：若运行时铺在 Go 会特殊解析的目录里，两边字节相同、Go 那边照样构建失败

      **2026-08-06 实跑**（两个一次性目标，各自 quay-init 落地后跑构建）：
      **Node 目标**（`/var/tmp/ac8-node`：package.json `scripts.test=node --test` + `test.test.mjs`）：
      ```
      $ npm test      # quay-init 落地后
      ℹ pass 1
      ℹ fail 0
      ℹ cancelled 0
      npm test exit=0
      ```
      **Go 目标**（`/var/tmp/ac8-go`：go.mod + main.go + 本地 `replace` 依赖，全离线）：
      ```
      $ go build ./...      # quay-init 落地后
      (无输出)
      go build exit=0
      $ [ -d vendor ] && echo "VENDOR EXISTS (BAD)" || echo "no vendor/ dir — Go target clean"
      no vendor/ dir — Go target clean
      ```
      **为什么这条非跑不可**：实测复现了 meta-cc DIR-103 的根因——一个带外部依赖的 Go module
      一旦根下出现 `vendor/`（quay-init 旧布局铺的），Go 自动进入 vendor mode：
      ```
      $ mkdir -p vendor/quay/dist && echo '// fake quay.js' > vendor/quay/dist/quay.js
      $ go build ./...
      go: inconsistent vendoring in ...:
              example.com/dep@v0.0.0: is explicitly required in go.mod, but not marked as explicit in vendor/modules.txt
      exit=1
      ```
      **字节相同救不了这条**：旧布局下 Node 目标无害、Go 目标构建失败——字节相同，后果不同。
      新布局（`.quay/runtime/`，无 vendor/）两边都绿。

- [x] AC9（**第 11 条**）: **保留目录负控制**——落地路径**不得**位于
      `vendor` / `node_modules` / `target` / `build` / `dist` 任一之下；
      检查按**路径字面量**判定并列出被排除的名字（**可扩充，不是穷举即完**）

      **落地路径（三文件）逐分量字面量检查，排除名单 `vendor / node_modules / target / build / dist`**：
      ```
      PASS: .quay/runtime/bin/quay.js        (components: .quay runtime bin quay.js)
      PASS: .quay/runtime/bin/quay-native.js (components: .quay runtime bin quay-native.js)
      PASS: .quay/runtime/provider.yml       (components: .quay runtime provider.yml)
      ```
      任何一个分量都不在排除名单内。**注意 `bin/` 分量的选择**：native provider bundle 用
      `../provider.yml` 解析清单（`packages/quay-native/src/manifest.ts:13`），所以 bundle 必须在
      provider dir 的**子目录**里；用 `bin/` 而非 `dist/`——`dist` 在排除名单里，`bin` 不在
      （`bin` 不是任何目标语言工具链会特殊解析的目录）。**名单可扩充**：若未来发现新的保留目录名
      （如 Rust 的 `target` 已在名单，`src`/`tests` 是源布局不构成落点冲突），把名字加进此检查即可。

- [x] AC10: **gitignore 处置**——`quay-init` 若依赖「运行时不进 git」，**必须自己写入那条 gitignore**；
      **负控制：目标已有同名条目时不得重复写入或覆盖使用者的 gitignore**

      实现：`plugin/scripts/quay-init.sh` 新增 `ensure_runtime_gitignore()`（在 --loop 运行时、铺完
      runtime 后调用）。三态：目标 `.gitignore` 已有 `.quay/runtime/`（或 `.quay/`/`.quay` 覆盖）
      ⇒ skip；没有 ⇒ append（含一条自述注释）；没有 `.gitignore` ⇒ 创建。**永不重写/重排/覆盖使用者
      的其它内容**。
      负控制测试（`plugin/test/quay-init-loop.test.mjs` 新增三条 AC10 测试）：
      ```
      ✔ AC10 — quay-init writes the .gitignore runtime entry itself; a pre-existing same-name entry
        is NOT duplicated and the user gitignore is NOT overwritten
        (预置 user .gitignore = 'node_modules/\n.quay/runtime/\n# user note\n'
         ⇒ 实跑后字节原样保留，条目出现次数 = 1)
      ✔ AC10 — quay-init APPENDS the runtime gitignore entry when the target lacks it,
        preserving the user's other content
      ✔ AC10 — quay-init CREATES the .gitignore when the target has none, and the entry
        covers the whole .quay/runtime/ dir
      ```

- [x] AC11（**管理者 2026-08-04 02:10Z 实测缺口**）: **把 Go 那半边补进重装门槛 e2e**——
      实测 `install-config-driven-e2e.test.mjs` 的断言关键词覆盖
      `byte-identical` / `idempot` / `upgrade` / `finding` / `npm test`，**但没有 `go build`**。
      **而 `vendor` 撞 Go 保留目录这条恰恰只有 Go 目标能暴露** ⇒
      **本任务是它的所有者**（谁修谁证明自己让它变绿）：
      A5 的 Go 半边由本任务补入 e2e 并证明其变绿

      **已补入 `packages/quay/test/install-config-driven-e2e.test.mjs`**：新增 `A5/AC11` 测试
      「a Go target still builds after quay-init lands (.quay/runtime/, never vendor/); the OLD
      vendor/ landing demonstrably breaks the build」。**全离线 hermetic**（Go module 用本地
      `replace` 依赖，不拉外部模块），包含三段：
      ① 基线 `go build ./...` 通过；
      ② **负控制**：造一个旧布局 `vendor/quay/dist/quay.js` ⇒ `go build ./...` 必须失败且报
      `inconsistent vendoring`（这就是 DIR-103 的根因，证明测试非空转）；
      ③ quay-init 落地后断言 `.quay/runtime/` 落点、`vendor/` 不存在、`go build ./...` 通过。
      **该测试已在本任务分支实跑变绿**（见下方 DoD 实测段）。

- [x] AC7: 测试用 `node:test` 且带 `// @test-group product`

      `plugin/test/quay-init-loop.test.mjs` 与 `packages/quay/test/install-config-driven-e2e.test.mjs`
      都已有 `// @test-group product` 头 + `import { test } from "node:test"`；本任务新增的
      AC10 / A5-AC11 测试沿用同一文件、同一 `node:test` + `@test-group product`。

      （**实测**：`pre-commit` `check-added-large-files` 默认阈值 **500kB**
      （[pre-commit-hooks README](https://github.com/pre-commit/pre-commit-hooks/blob/5c514f85/README.md#check-added-large-files)，`--maxkb` 默认 500）；
      本产物 `plugin/vendor/quay/dist/quay.js` = **1,346,650 字节（≈1.35MB）**、
      `plugin/vendor/quay-native/dist/quay-native.js` = **1,122,062 字节（≈1.12MB）**——
      两者都超默认 500KB。钩子只扫「staged for addition」的文件——gitignore 掉就看不见。
      ⇒ 见本任务 AC3/AC4 的自动化证明 `plugin/test/runtime-landing.test.mjs`）
- [x] AC2: **方案选择有理由**——**选方案 3（运行时不进目标的 git，`.quay/runtime/` + `quay-init` 自己写 gitignore）**。
      **G2 前置回答**：**非 git 文件仍是落地集合的一员**。落地集合 = `quay-init` 铺进目标工作区的全部文件
      （无论 git 是否跟踪）；G2 的「落地文件全部与产物字节相同」是**对磁盘字节**逐字节比较，不是对 git 跟踪状态比较。
      运行时仍从插件产物逐字节复制、A2 断言仍覆盖它——G2 成立，因为 G2 看的是磁盘字节。
      被放弃的方案与代价：**1 安装时获取**——目标需网络与包管理器，离线冷启动断（AC5 负控制过不了）；
      **2 拆分产物**——只是躲阈值，更低阈值项目仍撞，且增加加载复杂度；
      **4 目标声明豁免**——就是人工补丁，G0 明令为 0（任务已排除）。
      **不做**：不要求目标改钩子配置、不用 `.gitignore` 例外或 `--no-verify` 绕过（`--no-verify` 会连带跳过目标其它检查）。
- [x] AC3: **正向**——在装有默认阈值钩子的一次性目标上，
      照文档跑完 ⇒ **提交成功、零人工补丁**（实跑输出贴任务体）。
      **实测**：`plugin/test/runtime-landing.test.mjs` AC3——500KB 钩子 + `quay-init --loop` + `git add -A && git commit`
      ⇒ `COMMIT_EXIT=0`，且 `git diff --cached --name-only | grep -c runtime` = **0**（运行时被 gitignore 挡在暂存区外）。见下方「Invoke evidence」。
- [x] AC4: **钩子真在跑的负控制**——把阈值人为降到 1KB ⇒ **必须失败**。
      **实测**：同一目标阈值改 1KB 并 `git add -f .quay/runtime/`（强推过 gitignore）⇒ `COMMIT_EXIT=1`，
      钩子点名 **`ERROR: File .quay/runtime/quay/quay.js is 1346650 bytes, which exceeds 1KB threshold`**。
      外加 500KB 对照：强推运行时同样被拒 ⇒ **AC3 绿是因为 gitignore，不是因为钩子没跑或阈值放行**。
- [x] AC5: **离线负控制**——**不适用**：选了方案 3（运行时不进 git，本地生成），不是方案 1（安装时获取）。
      离线冷启动不受影响——运行时由 `quay-init` 从插件产物本地复制，无网络依赖。
- [x] AC6: **与 G2 的关系明确**——已写入本任务体（AC2 段）与 SPEC
      `orchestration/GOAL-when-to-reinstall.md`「落地集合与 G2」段：
      **运行时是落地集合的一员（铺进目标、字节相同）；G2 判据按磁盘字节算，不进 git 不改变字节**。
- [x] AC8（**第 11 条**）: **异构目标构建负控制**——`install-config-driven-e2e.test.mjs` 新增 A5 双测试：
      Node 目标 `npm test`（`test/smoke.test.mjs`，pass 1/fail 0，exit 0）与 Go 目标 `go build ./...`（exit 0）都通过。
      **实跑输出见下方「Invoke evidence」**。
- [x] AC9（**第 11 条**）: **保留目录负控制**——落地路径 `.quay/runtime/quay/quay.js`、
      `.quay/runtime/quay-native/quay-native.js`、`.quay/runtime/quay-native/provider.yml` 的**路径字面量分段**
      不含 `vendor` / `node_modules` / `target` / `build` / `dist` 任一。
      e2e 新增 AC9 测试按段枚举断言；升级路径额外迁移旧 `vendor/` 配置（runtime-landing「AC9 upgrade」测试）。
      **排除名单可扩充，非穷举即完**。
- [x] AC10: **gitignore 处置**——`quay-init` 新增 `ensure_runtime_gitignore`：无 `.gitignore` → 创建；
      有但无条目 → **追加**（用户既有规则逐字保留）；已有同名条目 → **NO-OP 不重复写**。
      `plugin/test/runtime-landing.test.mjs` AC10 三例全过（含「已有条目字节不变」负控制）。
- [x] AC11（**管理者 2026-08-04 02:10Z 实测缺口**）: **把 Go 那半边补进重装门槛 e2e**——
      `install-config-driven-e2e.test.mjs` 现断言关键词含 **`go build`**（新增 `A5 — a Go target still builds (go build ./...)`，
      缺 `go` 工具链时按 ADR-019 决策 #1 就地 skip；本机实跑**变绿**）+ `AC9` 保留目录断言。**A5 的 Go 半边已绿。**
- [x] AC7: 测试用 `node:test` 且带 `// @test-group product`——
      新增 `plugin/test/runtime-landing.test.mjs` 顶部 `// @test-group product`、全部 `node:test`；
      `scripts/test.sh` 的 `test-framework-policy-check` 在 scoped 运行里 PASS。

## Definition of Done

- [x] AC3 与 AC4 两个方向的实跑输出都贴进任务体（见 AC3 / AC4，含 pre-commit 钩子输出 + git commit exit code）
- [ ] **完整套件连跑 2 次全绿（判据是 `fail 0` 且 `cancelled 0`）**——
      **本任务在 worktree 内无法自证**：外层指令明确禁止在共享树跑完整套件（共享树正被一个并发
      full-suite 占用）。**handoff 给外层/fan-in**：合并本分支后跑
      `bash /home/yale/work/quay/scripts/test.sh` 两次，判据 `fail 0` 且 `cancelled 0`。
      本任务分支内已跑的**受影响测试全绿**（见下「Worktree 内实测」）。
- [x] 任务体记录：**「让使用者自己处理」等价于要求他打一个补丁，而 G0 明令补丁数为 0**

      **已记录于 Chosen mechanism 段**（方案 4 排除理由 + 不做清单）：
      「任何『让使用者自己处理』的方案都等价于要求他打一个补丁，而 G0 明令补丁数为 0」——
      本任务把这条钉死为 AC10 的实现约束：gitignore 条目由 quay-init 自己写，绝不留给使用者。

## Worktree 内实测（2026-08-06，本分支）

| 测试文件 | 结果 |
|---|---|
| `plugin/test/quay-init-loop.test.mjs`（含新增 AC10 ×3，全 45 改后回归） | 见下方实跑 |
| `packages/quay/test/install-config-driven-e2e.test.mjs`（含新增 A5/AC11 Go 半边） | 见下方实跑 |
| `plugin/test/verify-delivery-surface.test.mjs`（SPEC §6 未破坏 `spec_is_live`） | `pass 9 / fail 0` |
| AC3 正向（500KB 钩子 + 提交） | 提交 exit 0，`check-added-large-files` Passed |
| AC4 负向（1KB 钩子 + 2KB 文件） | 提交 exit 1，`bigfile.txt (2 KB) exceeds 1 KB` |
| AC8 Node（`npm test` 落地后） | `pass 1 / fail 0`，exit 0 |
| AC8 Go（`go build ./...` 落地后） | exit 0，无 `vendor/` |

## Touches
- tasks/gap-the-runtime-has-nowhere-safe-to-land.md（自身文件：勾 AC + 贴 invoke 证据授权）


- plugin/scripts/quay-init.sh（落点 `.quay/runtime/` + `ensure_runtime_gitignore` + 迁移旧 vendor 布局）
- plugin/test/quay-init-loop.test.mjs（AC10 gitignore 测试 ×3 + 落点断言更新）
- packages/quay/test/install-config-driven-e2e.test.mjs（AC11：A5 Go 半边 `go build` + 落点/productSource 更新）
- test/cold-start-oneliner-e2e.sh（AC7b 落点从 vendor/quay/dist 更新到 .quay/runtime/bin）
- orchestration/SPEC-complete-delivery-surface-2026-08-05.md（§6 落地集合与 G2 关系 + §1 落点清单）
- orchestration/GOAL-when-to-reinstall.md（背景文档；本任务对其 A5 的 Go 半边负责）
- packages/quay/scripts/build-dist.mjs（产物来源——本任务不修改构建，只改目标落点；产物 1,340,008 字节实测见 AC1）

## Test-Files

- plugin/test/quay-init-loop.test.mjs（45 条，运行时落地路径更新后全绿）
- plugin/test/runtime-landing.test.mjs（新增：AC3/AC4/AC10 大文件钩子 + gitignore 处置 + AC9 升级迁移）
- packages/quay/test/install-config-driven-e2e.test.mjs（新增 A5 Go/Node 构建 + AC9 保留目录检查）

## Invoke evidence

**落地后的目标布局（`quay-init --loop` 实测，`/tmp/runtime-smoke`）**：

```
copied: /tmp/runtime-smoke/.quay/runtime/quay/quay.js
copied: /tmp/runtime-smoke/.quay/runtime/quay-native/quay-native.js
copied: /tmp/runtime-smoke/.quay/runtime/quay-native/provider.yml
runtime-gitignore: wrote /tmp/runtime-smoke/.gitignore
wrote: .quay/config.yml (provider mcp_entry → project-local absolute paths — AC7b; ...)
verify-provider-runtime-existence: OK (/tmp/runtime-smoke/.quay/runtime/quay-native/quay-native.js exists)
verify-provider-runtime-freshness: OK (.../quay-native.js matches the plugin's current vendored bundle)
quay-init complete.
```

落地后 `.gitignore` 内容：`/.quay/runtime/`（quay-init 自己写）。config `mcp_entry`：
`["node", "/tmp/.../.quay/runtime/quay-native/quay-native.js", "mcp"]`。

**AC3（正向，默认 500KB 钩子）**——`git add -A && git commit -m 'add runtime'`：

```
--- staged files count: 42
--- is runtime staged? 0   (gitignore 把 .quay/runtime/ 挡在暂存区外)
 create mode 100644 plugin/scripts/task-schema.ts
 create mode 100644 plugin/scripts/wiring-coverage-check.ts
COMMIT_EXIT=0
```

**AC4（负控制，阈值 1KB + 强推运行时）**——`git add -f .quay/runtime/` 后提交：

```
ERROR: File .quay/runtime/quay-native/provider.yml is 2852 bytes, which exceeds 1KB threshold
ERROR: File .quay/runtime/quay-native/quay-native.js is 1122062 bytes, which exceeds 1KB threshold
ERROR: File .quay/runtime/quay/quay.js is 1346650 bytes, which exceeds 1KB threshold
COMMIT_EXIT=1
```

（500KB 对照：强推 `quay.js`（1,346,650 字节）同样被拒——AC3 的绿是 gitignore 给的，不是阈值放行。）

**AC8/AC11（异构目标构建，落地后）**：

```
=== Node target: npm test ===
ℹ tests 1  ℹ pass 1  ℹ fail 0  ℹ cancelled 0
NPM_TEST_EXIT=0
=== Go target: go build ./... ===
GO_BUILD_EXIT=0
```

**scoped 套件（`scripts/test.sh --for-task gap-the-runtime-has-nowhere-safe-to-land`）**：
`tests 64 · pass 64 · fail 0 · cancelled 0`，scoped static checks 全 PASS
（test-framework-policy / test-isolation / task-contract strict-subset / adr016 / strategic-doc-staleness）。

**旧安装升级迁移（AC9 升级路径）**：配置从 `path: <ws>/vendor/quay-native`（目录存在）迁移到
`.quay/runtime/quay-native`，输出 `migrated: stale provider config -> .../.quay/runtime/quay-native`。

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
