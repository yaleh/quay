---
id: gap-leak-scan-reap-race-false-red
title: tmux-leak-scan 与测试回收竞态——重载下回收慢于 run 末扫描 ⇒ session-liveness 测试自己的残留被扫成 NEW 假红
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-13，round 95 假红 + round 96 对照 + 终态四格判据）**：
```
round 95: state=red reason=gate-failed tests=4150 fail=0（产品全过，仅 leak 门红）
  failures[0]: tmux-leak-scan: FAIL — NEW residual test tmux servers/dirs after the run
               (delta vs before-run snapshot) → session-liveness-sig-* 套接字
round 96: state=green（同一套 session-liveness 测试），终态残留 0、tmux 孤儿 0
终态瞬时（manager 独立观察者 00:57:55 抓）：inner worktree node --test = 0（闲）——第四格
  残留0+绿+inner闲，零区分力（两个假说都预测绿）——早期误判「第三行」已更正
```

**竞态假说（待验，manager 2026-08-13 综合——结论是「已观察并发前提、竞态为待验假说」，非已证实）**：
「套件自造」与「并发敏感」不互斥 = 同一机制两半：测试自己产生 tmux server（自造），正常在收尾时被
回收；**收尾回收与 run 末 leak-scan 存在竞态——负载一高，回收慢于扫描，残留就被扫成 NEW**。
round 95 重载扫到（当时 inner 并发跑）、round 96 轻载 2-10s 内回收先于扫描 ⇒ 绿。顺带实测：
round 96 里瞬态残留 2-10s 即被回收（轻载），round 95 扫到了（重载）。

**直接观察支持竞态前提（弱，方向明确，非定论）**：round 96 终态 `state` 已翻 green 时主 checkout 仍有
16 个测试进程退出中 ⇒ **判决写入与子进程回收重叠**；而 leak-scan 跑在判决之前，那一刻退出中的进程只会
更多 ⇒ 「扫描与回收并发」前提被直接观察到，非推想。**但不足定论——见下「量的问题」。**

**两个读法矛盾（2026-08-13 01:00，manager 独立观察者）**：终态瞬时 manager 读 `node --test`（cwd 判）
= 0（inner 闲）、主 checkout = 16；outer 读「worktree cwd 进程」= 9 ⇒ **谓词不同**（outer 数的是
worktree-cwd 全部进程含非 test，manager 数的是 node --test）⇒ outer 的 9 是超计，manager 的 0 是准确值。
**结论：终态瞬时 inner node --test = 0 = 第四格（残留0+绿+inner闲），零区分力。**

**量的问题（manager 2026-08-13 自担）**：竞态假说说的是「回收 vs 扫描」，而 leak-scan 跑在【判决写入
之前】；终态采样都在【判决之后】，且已实测间隔非零（判决绿时 16 进程仍在退出）⇒ 「终态时 inner 在不在
跑」只是「扫描时 inner 在不在跑」的**代理量**，两者被非零间隔隔开。**正确测法**：轮运行期间每 5s 连续
采样（时刻 / worktree node --test 数 / 主 checkout 数 / 残留 tmux 数），终态后回看【终态前 30-60s】
那几行——那才覆盖 leak-scan 实际运行窗口。判据改「扫描窗口内 inner 在跑吗」，非「终态时」。
（manager 下轮挂后台采样器，纯读、不清任何东西。）

**能确定 vs 不能确定**：能确定——① 测试自造 tmux server（00:55 亲见 5 个全新，来自主 checkout 测试）
② 判决写入与子进程回收重叠（16 个仍在退出）⇒「扫描与回收并发」前提直接观察到。**不能确定——round 95
的红是否由此竞态造成**——需要一次覆盖扫描窗口的采样。

**为什么不是「约束别人并发」能治**：round 96 证明并发测试不必然致败——轻载下也会产生残留，
只是回收得快。约束 inner 是净损失且不解决竞态（manager 2026-08-13 明示：别把「轮 running 不跑测试」
固化成规矩，等观察出结果——观察结果已出：第三行，协调已撤销）。

**实现点**：`plugin/scripts/tmux-leak-scan.sh`（`--snapshot` @ scripts/test.sh:1098、`--check` @ :1217）——
delta 判据按路径计数，不判「残留是否仍被活测试进程持有」。

**与既有任务互引**：
- `gap-tests-leak-tmux-servers`（已知泄漏族）——本条是其【竞态形态】子因
- `gap-verifiedcommit-dirty-tree-false-certificate`（自造脏）——同族：套件自己造的脏，
  这次落在 leak 门（package-lock 那次落在脏净判定），同一天两次

## Plan

1. leak-scan `--check` 前等待测试 tmux server 回收完成（或让测试同步清理，不靠进程退出后被 reap）。
2. 或 NEW 残留按「是否仍被活测试进程持有」判定，非纯路径计数。
3. 负控：round 95 形态（重载下残留被扫）不复发。

## AC

- [ ] AC1: leak-scan 与测试回收次序修复——run 末扫描前等待回收完成 / 测试同步清理
- [ ] AC2: 负控——round 95 形态（残留活到扫描时刻）不再误报 NEW
- [ ] AC3: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC3 全部勾上
- [ ] 负控样例贴出（见 Evidence：round 95 形态不复发）
- [ ] 全量套件绿

## Touches

- plugin/scripts/tmux-leak-scan.sh（回收等待 / 持有判定）
- scripts/test.sh:1217（--check 调用点，如需扫描前等待）
- plugin/test/tmux-leak-scan.test.mjs（若存在）
- tasks/gap-leak-scan-reap-race-false-red.md（自身）
