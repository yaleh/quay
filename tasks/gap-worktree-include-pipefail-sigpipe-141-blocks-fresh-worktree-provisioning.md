---
id: gap-worktree-include-pipefail-sigpipe-141-blocks-fresh-worktree-provisioning
title: worktree-include.sh 在 pipefail 下被 awk 早退触发 SIGPIPE(141) 当场退出：新 worktree
  一个声明文件都不拷，而 dispatch-worktree-setup 只报一行 "failed"
status: todo
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

## Touches

- tasks/gap-worktree-include-pipefail-sigpipe-141-blocks-fresh-worktree-provisioning.md
- scripts/worktree-include.sh

## AC

- [ ] 修法落地：把 primary-checkout 解析换成不产生早退消费端的读法（已验证可用的一条：
      `PRIMARY=$(git -C "$WORKTREE" rev-parse --path-format=absolute --git-common-dir)` +
      `PRIMARY=${PRIMARY%/.git}`），或把 `awk` 的早退去掉。
- [ ] 正/负控制：在一个**全新** worktree 上跑 `dispatch-worktree-setup.sh`，断言 `.quay/config.yml`
      与两个 `plugin/vendor/*/dist/*.js` **三个文件都在**（读文件本身，⛔ 不读那行消息）；并让它在
      修法前取假（把修法换回复现：应看到 0 个文件被拷）。
- [ ] `dispatch-worktree-setup.sh` 的失败面不再与「半成功」同形：失败时它必须以非 0 退出并说明少了
      哪些文件，⛔ 不是只打印一行 `failed` 然后继续。
- [ ] 跑一次既有测试 `plugin/test/dispatch-worktree-setup.test.mjs` 证不回归。

## DoD

- [ ] 修法随 develop 落地
- [ ] 在真机上用一个全新 worktree 跑一次，三个声明文件真的到位（贴 `ls` 与 `diff` 读数）
- [ ] `dispatch-worktree-setup.sh` 的退出码在「一个文件都没拷」时为非 0
