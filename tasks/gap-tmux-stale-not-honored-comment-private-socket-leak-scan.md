---
id: gap-tmux-stale-not-honored-comment-private-socket-leak-scan
title: "过时注释「TMUX_TMPDIR NOT honored」误导立案 + leak-scan 漏私有 socket 孤儿前缀（AC1 负控制证伪旧任务后重定范围）"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---

**type:** execution

## Proposal

`gap-tmux-tmpdir-not-honored-fixtures-leak-default-socket` 的 AC1 负控制被 worker 证伪（外层独立复现确认）：
本机 `env -u TMUX TMUX_TMPDIR=<dir> tmux new-session -d`（无 -S）**落 `<dir>/tmux-1000/default`**（TMUX_TMPDIR
在 `$TMUX` 剥离时被认）；「无 -S」孤儿实为**私有 socket**（`/tmp/quay-init-tmux-*` / `quay-isc-*` /
`repro-rmsync-*`，实测 9 个，`ss -xlp` 映射）。原任务前提（TMUX_TMPDIR 不认 + 落默认 socket 撞生产）错误，
本任务重定范围到两条**已核实**的真问题：

1. **过时误导注释（错误立案源）**：`plugin/test/session-topology.test.mjs:151` 与
   `plugin/test/inner-session-check.test.mjs:110` 明写「TMUX_TMPDIR 在本机不被 tmux 认可（旧注释原文
   'is NOT honored by tmux on this system'）」——实测假。这两条注释 + ps「无 -S」误推断直接导致旧任务误立案。
2. **tmux-leak-scan.sh 漏私有 socket 孤儿前缀**：leak-scan 只覆盖 `skv-|session-liveness-|ol-tok-|
   enter-repro-` + `/tmp/quay-run-<runId>/`，**不覆盖** `/tmp/quay-init-tmux-*` / `/tmp/quay-isc-*` /
   `/tmp/repro-rmsync-*`（mkdtemp 私有 socket 前缀）⇒ 9 个孤儿 tmux:server 不被回收（资源泄漏，非默认撞生产）。

## Plan

1. 修正两条过时注释为真实行为（TMUX_TMPDIR 在 `$TMUX` 剥离时被认；`$TMUX` 继承时覆盖 TMUX_TMPDIR——
   即 guard 任务已修机制）。
2. 扩展 tmux-leak-scan.sh 前缀覆盖到 `quay-init-tmux-` / `quay-isc-` / `repro-rmsync-` 等 mkdtemp 私有 socket 前缀。

## Acceptance Criteria

- [x] AC1（负控制·承重条）：`env -u TMUX TMUX_TMPDIR=<dir> tmux new-session -d` 落 `<dir>/tmux-1000/default`
      （私有）；`env TMUX_TMPDIR=<dir> tmux new-session -d`（`$TMUX` 继承）才落默认。贴两条命令实际落点。
- [x] AC2（注释修正）：两条注释不再含「NOT honored」且改述真实行为；`grep -rn "TMUX_TMPDIR is NOT [h]onored"`
      全仓零命中。
- [x] AC3（scan 覆盖）：tmux-leak-scan.sh 前缀覆盖 `quay-init-tmux-*` / `quay-isc-*` / `repro-rmsync-*`；跑一次
      扫描能识别现存 9 个私有 socket 孤儿。（AC 原写 `repro-*`，落实为精确 `repro-rmsync-*`：裸 `repro-*`
      会命中 /tmp 下 ~25 个人工 scratch 文件，非测试残留 ⇒ 恒假阳性。）

## Definition of Done

注释修正 + leak-scan 前缀覆盖落地，且一次扫描后 `/tmp/quay-init-tmux-*` / `quay-isc-*` / `repro-rmsync-*` 孤儿数
= 0（AC3），全仓 grep「TMUX_TMPDIR is NOT [h]onored」零命中（AC2）。

## 执行证据（2026-08-24，worktree gap-tmux-stale-not-honored-comment-private-socket-leak-scan）

**AC1 负控制实跑**（本机 `$TMUX=/tmp/tmux-1000/default`）：
```
$ env -u TMUX TMUX_TMPDIR=<dir> tmux new-session -d -s ac1a
  → 落 <dir>/tmux-1000/default（srw-rw---- 私有 socket PRESENT；tmux -S <sock> list-sessions 见 ac1a）
$ env TMUX_TMPDIR=<dir> tmux new-session -d -s ac1b    # $TMUX 继承
  → 落默认 socket（tmux list-sessions 见 ac1b；私有 socket 上 ac1b NOT present）
```
两条会话 kill-session 清掉，<dir> 已删。⇒ TMUX_TMPDIR 在 `$TMUX` 剥离时被认；`$TMUX` 继承时覆盖。

**AC2 注释修正**：两条注释（session-topology.test.mjs / inner-session-check.test.mjs）改述真实行为，
`grep -rn "TMUX_TMPDIR is NOT [h]onored" .` 全仓零命中（任务体 AC2 grep 用 `[h]onored` 消除自引用）。

**AC3 scan 覆盖 + 孤儿清理**：leak-scan 前缀扩展 `quay-init-tmux-|quay-isc-|repro-rmsync-`。清理前 `ss -xlp`
映射 9 个孤儿私有 socket server（1 repro-rmsync + 2 quay-isc + 6 quay-init-tmux），+ 3 个无 server 的
quay-init-tmux 目录；按 pid kill 9 个 server（负控制：真实会话 pid 4180331 / /tmp/tmux-1000/default 全程未受影响）
+ rm 11 个孤儿目录后，`ls -d /tmp/quay-init-tmux-* /tmp/quay-isc-* /tmp/repro-rmsync-*` = 无、`ss -xlp` 该三类 = 无。
`repro-*` 裸前缀的 25 个人工 scratch 文件全程保留（负控制：确认落实 `repro-rmsync-*` 而非 `repro-*` 的正确性）。

**scoped 套件**（`bash scripts/test.sh --for-task <id> --test-concurrency=4`）：tests 29 · pass 29 · fail 0 ·
skipped 0；新增 prefix-coverage 测试通过。

## Touches

- plugin/test/session-topology.test.mjs
- plugin/test/inner-session-check.test.mjs
- plugin/scripts/tmux-leak-scan.sh
- plugin/test/tmux-leak-scan.test.mjs
- tasks/gap-tmux-stale-not-honored-comment-private-socket-leak-scan.md（自身）
