---
id: gap-driver-runtime-test-fixture-driver-not-reclaimed
title: driver-runtime.test.mjs 等测试 spawn worker-driver 进 /tmp/dr-* fixture 后不回收——16h 僵尸（PPID=1、0% CPU）污染 node_count 读数
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`driver-runtime.test.mjs`（:99/:107/:141/:240/:258/:368）与 `dispatch-record-fingerprint-reason-check.test.mjs`（:51）用 `mkdtempSync("/tmp/dr-<tag>-")` 建 fixture root、spawn worker-driver，但**测试结束（含异常路径）后不回收**——manager 全扫 11 个 worktree 发现 7 个僵尸（我读码复核）：

```
7 个 node worker-driver，argv 形如 --root /tmp/dr-{ac2-pos,w-cap2,main,ac3,...}-XXXXXX
存活 16h38m–16h47m，全部 PPID=1、0% CPU、无子进程、今日无新产物
⇒ 非生产 driver（quay driver status supervisor=none alive=0，主检出侧确为 0）
⇒ 是测试 fixture 起的 driver，测试进程退出时没杀它，被 init 收养
```

**危害不是 CPU（0%）**：是**污染读数**——`node_count` 这类量把它们算进去 ⇒ 之前「node 68→36」的对照里有一部分是这些 16h 前就在的僵尸、与当轮负载无关。manager 已用正本机件 reap（`worktree-process-reaper.ts --worktree`，先 `--dry-run` 枚举）清掉，但**根（测试不回收）仍在**，下次测试跑还会再漏。

**⊕ 顺带（manager 差点误报仪器缺陷，读码推翻）**：`worktree-process-reaper.ts` 的 `--orphans` 谓词 = cwd 以 " (deleted)" 结尾 AND argv0 含 claude-probe ⇒ **它只扫「已删 worktree 的残留」，不扫「活 worktree 里 PPID=1 的僵尸」**。`--orphans` 与 `--worktree` 覆盖的是【互斥】的两类残留，不是强弱关系——正确工具是 `--worktree`。⛔ 当前注释说清各自定义、但没说「跑了 --orphans ≠ 扫过活 worktree」。

## Plan

测试 spawn worker-driver 后，`t.after()`/`afterEach` 里 kill 该 driver 进程 + `rmSync` 该 fixture root（含异常路径，用 try/finally 或 t.after 保证回收）。⛔ 顺带把 `--orphans` vs `--worktree` 的互斥关系写进机件头注释或 capability-catalog（一句：跑了 --orphans ≠ 扫过活 worktree）。

## Acceptance Criteria

- [ ] AC1（能取假，测试回收 driver）：`driver-runtime.test.mjs` 等 spawn 的 worker-driver 在测试结束（含异常）后被 kill + `/tmp/dr-*` fixture 目录被 rm（t.after/afterEach 回收）；（⛔ 测试后仍残留 driver 进程 ⇒ 假）。
- [ ] AC2（能取假，负控制）：跑一遍 `driver-runtime.test.mjs`，测试后 `ps aux | grep "worker-driver.*--root /tmp/dr-"` 零命中（无残留 PPID=1 driver）；（⛔ 仍有残留 ⇒ 假）。
- [ ] AC3（能取假，--orphans 语义入文档）：`--orphans` vs `--worktree` 的互斥关系写进 worktree-process-reaper.ts 头注释（或 capability-catalog）；（⛔ 无该说明 ⇒ 假）。

## Definition of Done

测试回收其 spawn 的 driver + fixture 目录；AC1-AC3 全勾；跑测试后无 /tmp/dr-* 残留 driver；--orphans 语义说明落地。

## Touches

- plugin/test/driver-runtime.test.mjs（spawn driver 回收 + fixture rm）
- plugin/test/dispatch-record-fingerprint-reason-check.test.mjs（同上）
- plugin/scripts/worktree-process-reaper.ts（--orphans vs --worktree 互斥说明）
- tasks/gap-driver-runtime-test-fixture-driver-not-reclaimed.md（自身）
