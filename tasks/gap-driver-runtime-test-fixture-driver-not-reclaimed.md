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

**⛔ 方向更正（manager 08-26，读码）**：清理机制**不是缺失、是有而逃逸**——`driver-runtime.test.mjs:119 killIfAlive`、`:241/:259/:299/:369 t.after rmSync`、`:273/:316/:336/:385/:407 t.after killIfAlive` 均已存在。真问题是「已有回收为何对这几条路径不生效」。候选（⛔ 不代拍）：`:332` AC3 测试名「kill -9 supervisor ⇒ orphan driver not 'running'」，其**被测行为本就制造孤儿 driver**，`:336-337` 的 `killIfAlive(dpid())` 若 driver 在 supervisor 死后换了 pid、`dpid()` 拿到死 pid。另：`dispatch-record-fingerprint-reason-check.test.mjs:51` 也用 `dr-${tag}-` 前缀但**非生产者**（spawnSync 同步 + after rmSync 配对，命名撞车）——界定范围应按「是否 spawn 常驻 driver」不按 `dr-` 前缀。

## Plan

诊断 `driver-runtime.test.mjs` 已有 `killIfAlive`/`t.after` 的**逃逸路径**（⛔ 非新增第二份回收——回收机制已存在），修复逃逸。候选方向（manager 指路，⛔ 不代拍）：AC3 测试的被测行为「kill -9 supervisor ⇒ orphan driver」本身产生孤儿 driver，`dpid()` 读的 pid 文件可能在 supervisor 死后已失效/已换 pid。⛔ 顺带把 `--orphans` vs `--worktree` 互斥关系写进机件头注释（一句：跑了 --orphans ≠ 扫过活 worktree）。

## Acceptance Criteria

- [ ] AC1（能取假，修复已有回收的逃逸）：`driver-runtime.test.mjs` **已有** `killIfAlive`（:119）+ `t.after`（:241/:259/:299/:369 rmSync，:273/:316/:336/:385/:407 killIfAlive）——诊断它们为何对 spawn 的 driver 逃逸（候选：:332 AC3 被测行为本就制造孤儿 driver，`dpid()` 读 pid 文件可能拿到死/已换 pid），修复逃逸路径，⛔ **非新增第二份回收**；（⛔ 逃逸仍在 ⇒ 假）。
- [ ] AC2（能取假，负控制）：跑一遍 `driver-runtime.test.mjs`，测试后 `ps aux | grep "worker-driver.*--root /tmp/dr-"` 零命中（无残留 PPID=1 driver）；（⛔ 仍有残留 ⇒ 假）。
- [ ] AC3（能取假，--orphans 语义入文档）：`--orphans` vs `--worktree` 的互斥关系写进 worktree-process-reaper.ts 头注释（或 capability-catalog）；（⛔ 无该说明 ⇒ 假）。

## Definition of Done

测试回收其 spawn 的 driver + fixture 目录；AC1-AC3 全勾；跑测试后无 /tmp/dr-* 残留 driver；--orphans 语义说明落地。

## Touches

- plugin/test/driver-runtime.test.mjs（spawn driver 回收 + fixture rm）
- plugin/test/dispatch-record-fingerprint-reason-check.test.mjs（同上）
- plugin/scripts/worktree-process-reaper.ts（--orphans vs --worktree 互斥说明）
- tasks/gap-driver-runtime-test-fixture-driver-not-reclaimed.md（自身）
