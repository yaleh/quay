---
id: gap-worktree-include-pipefail-sigpipe-141-blocks-fresh-worktree-provisioning
title: worktree-include.sh 在 pipefail 下被 awk 早退触发 SIGPIPE(141) 当场退出：新 worktree
  一个声明文件都不拷，而 dispatch-worktree-setup 只报一行 "failed"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---

## Finding

`scripts/worktree-include.sh` 的第 ~45 行：

```bash
PRIMARY=$(git -C "$WORKTREE" worktree list --porcelain 2>/dev/null \
  | awk '/^worktree /{print $2; exit}')     # ← awk 读完第一行就 exit
```

`awk` 的早退关掉读端，而 `git` 还有输出要写 ⇒ `git` 拿 EPIPE、退出 **141**；脚本体是
`set -euo pipefail` ⇒ **赋值那一行直接结束整个脚本**，一个字节都不打印、一个文件都不拷。

**触发条件是输出体量（该仓库的 worktree 数量），不是 cwd**：worktree 多时 `worktree list
--porcelain` 输出大，`git` 几乎必然来不及写完。但它**是竞态而非确定**——同一命令同一 worktree 会
在 141 与 0 之间翻转（实测 2026-09-14：连续 8 次重跑全部 141，另一次会话三次得到 141/0/141）。

**代价（实测 2026-09-14，AC-258 的 worker 首轮）**：`plugin/scripts/dispatch-worktree-setup.sh`
的第二步就是调它，而它对外**只打印一行** `dispatch-worktree-setup: worktree-include.sh failed`
（第一步 node_modules symlink 仍成功 ⇒ 脚本"半成功"）。结果是**新 worktree 没有 `.quay/config.yml`**，
后续任何 quay 命令都以一句看起来无关的 `Cannot find repo root: no .quay/config.yml found upward`
收场 —— 而 DISPATCH 的 worker 指令恰好要求「跑 dispatch-worktree-setup.sh 就是 provisioning 机制，
不要靠 agent 记得」⇒ 机制自称做了、实际什么都没做（硬规则 3b 的形态）。

**CONTINUE 轮无害、FRESH worktree 致命**：判别量是 config 在不在，⛔ 不是那行消息（两种情形消息逐字相同）。

## Resolution

`scripts/worktree-include.sh` 的 primary 解析改为**委派给 `plugin/scripts/repo-root.sh` 的
`mainCheckoutRoot`**——即 AC 里那条已验证读法（`git rev-parse --path-format=absolute
--git-common-dir`）的**共享实现**，同时覆盖 git < 2.31 的相对路径回退，且读的链上**不存在任何早退消费端**。

另外两处同源加固（都属于「失败面不得与半成功同形」）：

1. **拷贝路径对自己做磁盘读回后置条件**：拷完后再用同一份已算好的集合逐条读回磁盘，任一声明文件
   不在 ⇒ exit 1。所以 exit 0 是**关于 worktree 内容的断言**，不是「cp 命令发过了」。逐文件失败处理
   （不再是 `set -e` 撞到第一个坏文件就整个脚本退出）⇒ 一次失败不掩盖其余（硬规则 3：枚举，不布尔）。
2. **新增 `--verify` 模式**：同一套 matcher、不拷任何东西，逐个点名缺席的文件。

`plugin/scripts/dispatch-worktree-setup.sh`：拷贝失败时 exit 2 **并点名缺席文件**；「验证器无法评估声明」
被报成**它自己的形态**（⛔ 既不是文件清单，也不是「查过且合格」——硬规则 3b）；`.worktreeinclude`
存在而 `worktree-include.sh` 缺席时**拒绝**（exit 2），不再退回一行 WARNING。

**硬规则 5b 扫描（修的是原则不是实例）**：对全部受跟踪非测试源码里的 `git worktree list` 消费管道
做了结构化枚举（多行 awk 也算）——共 **8 处**，其中恰好 **2 处**使用早退消费端。第二处是
`plugin/scripts/provision-verify-worktree.sh:103` 的 `| grep -Fq`（在 `set -uo pipefail` 下）。
**该处只报告、不在本 delta 修**：后果仅限 teardown 路径残留注册（后面 `rm -rf` 照跑），不在本任务
Touches 内，且 `provision-verify-worktree.test.mjs` 无 teardown 覆盖 —— 未经验证地改它是「声称」不是
「修复」。**需要一个自己的任务。**

**5b 的第二个命中（本次实际修掉的第四处）**：`plugin/test/repo-root.test.mjs` 的
「no private first-line parsing」枚举原本只覆盖**三**处，而 `scripts/worktree-include.sh` 是
**未被枚举的第四处**、带着逐字相同的缺陷。已扩进该枚举（换回旧实现即红，实测过）。

## Evidence

**修法前（负控制，本机实测）**：
```
=== PRE-FIX: config.yml present? ===                MISSING
trial1 exit=141 bytes=0 out=[]
trial2 exit=141 bytes=0 out=[]
trial3 exit=141 bytes=0 out=[]
=== PRE-FIX: config.yml after 3 runs ===            MISSING
```
经 `dispatch-worktree-setup.sh` 在全新 worktree 上（用主检出那份旧脚本）：
`linked node_modules` 成功后 `worktree-include.sh failed`，三个声明文件 **0/3 到位**。

**修法后（真机、全新 worktree、`--root` 指向本 worktree 的修法树）**：
```
=== BEFORE: fresh worktree declared files ===
  ABSENT  .quay/config.yml
  ABSENT  plugin/vendor/quay/dist/quay.js
  ABSENT  plugin/vendor/quay-native/dist/quay-native.js
=== run dispatch-worktree-setup.sh ===            EXIT=0
worktree-include: copied .quay/config.yml -> …/.quay/config.yml
worktree-include: copied plugin/vendor/quay-native/dist/quay-native.js -> …
worktree-include: copied plugin/vendor/quay/dist/quay.js -> …
worktree-include: done — 3 file(s) copied into …
=== diff vs primary checkout originals ===
  IDENTICAL .quay/config.yml
  IDENTICAL plugin/vendor/quay/dist/quay.js
  IDENTICAL plugin/vendor/quay-native/dist/quay-native.js
```
（⛔ 读的是文件本身与 diff，不是那行消息。）

**失败面（AC3）**：不可落盘的拷贝 ⇒ `EXIT=2`，stderr：
```
dispatch-worktree-setup: provisioning INCOMPLETE for … — copy exited 1, verify exited 1
dispatch-worktree-setup: declared files ABSENT from …:
worktree-include: MISSING .quay/config.yml (should be at …/.quay/config.yml)
worktree-include: verify FAILED — 1 of 3 declared file(s) absent from …
```
同一场景下第一步 node_modules 仍成功（symlink 已在）⇒ **这正是「半成功」形态，而消息已能区分它**。

**新增测的差分（红→绿）**：`plugin/test/dispatch-worktree-setup.test.mjs` 的 SIGPIPE-141 守卫用一个
在 `worktree list` 上 exit 141、其余全部转发真 git 的 stub；把旧实现换回去 ⇒ 该测试**红**（实测），
换回修法 ⇒ 绿。竞态无法靠重跑钉住，所以测试钉的是**不变量**：primary 解析不得依赖一次成功的
`git worktree list`。

**测试**：`plugin/test/dispatch-worktree-setup.test.mjs` 27 pass / 0 fail（含既有 17 条不回归）；
`plugin/test/repo-root.test.mjs` 与 `provision-verify-worktree.test.mjs`、`repo-root-unification.test.mjs` 全绿。

## Touches

- tasks/gap-worktree-include-pipefail-sigpipe-141-blocks-fresh-worktree-provisioning.md
- scripts/worktree-include.sh
- plugin/scripts/dispatch-worktree-setup.sh
- plugin/test/dispatch-worktree-setup.test.mjs
- plugin/test/repo-root.test.mjs

## AC

- [x] 修法落地：把 primary-checkout 解析换成不产生早退消费端的读法（已验证可用的一条：
      `PRIMARY=$(git -C "$WORKTREE" rev-parse --path-format=absolute --git-common-dir)` +
      `PRIMARY=${PRIMARY%/.git}`），或把 `awk` 的早退去掉。
      → 采该读法的**共享实现** `repo-root.sh:mainCheckoutRoot`（同一 `--git-common-dir`，另带
      git < 2.31 回退）。`scripts/worktree-include.sh:82`。
- [x] 正/负控制：在一个**全新** worktree 上跑 `dispatch-worktree-setup.sh`，断言 `.quay/config.yml`
      与两个 `plugin/vendor/*/dist/*.js` **三个文件都在**（读文件本身，⛔ 不读那行消息）；并让它在
      修法前取假（把修法换回复现：应看到 0 个文件被拷）。
      → 负控制：修法前 3/3 次 exit 141、0 字节、0 文件。正控制：修法后 exit 0、三文件全部
      `diff` 与主检出逐字相同（读数见 Evidence）。另有自动化正向/负向控制（declared ∩ gitignored
      被拷、未声明的不拷）与 stub-git 差分红/绿。
- [x] `dispatch-worktree-setup.sh` 的失败面不再与「半成功」同形：失败时它必须以非 0 退出并说明少了
      哪些文件，⛔ 不是只打印一行 `failed` 然后继续。
      → exit 2 且逐条点名缺席文件；且「验证器无法评估」与「列出缺席文件」「查过且合格」三态可区分。
- [x] 跑一次既有测试 `plugin/test/dispatch-worktree-setup.test.mjs` 证不回归。
      → 27 pass / 0 fail（既有 17 条全绿）。

## DoD

- [ ] 修法随 develop 落地（待外部）
      提交 `2b4048e3a` 已在本任务的 `task/gap-worktree-include-pipefail-sigpipe-141-blocks-fresh-worktree-provisioning`
      分支上；落地由本任务的 fan-in 机械完成，worker 不自行合 develop。
- [x] 在真机上用一个全新 worktree 跑一次，三个声明文件真的到位（贴 `ls` 与 `diff` 读数）
      → 见 Evidence：`ls -l` 三个文件在位，三条 `diff` 全部 IDENTICAL。
- [x] `dispatch-worktree-setup.sh` 的退出码在「一个文件都没拷」时为非 0
      → 修法前：全新 worktree 上 EXIT=2 且 0/3 到位；修法后不可落盘场景 EXIT=2 且点名缺席文件。
