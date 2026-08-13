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

**窗口采样基线（manager 2026-08-13，round 97 全程 77 个采样每 5s——对照基线，非结论）**：
```
残留非零：17/77 采样，区间 01:01:43→01:04:35，峰值 5（01:03:47）
最后一次非零 01:04:35、终态 ≈01:06:50 ⇒ 扫描前残留为 0 的【余量 ≈135 秒】（轻载）
inner 几乎全程空闲（仅 1 采样非零）⇒ 套件自造残留已确证（非快照推断）
主 checkout 全程 16-33 个 node --test
```
**这条把定性假说变成可算的量**：round 95 要红，须「残留出现得更晚」或「回收被拖慢 >135 秒」之一。
**下次再红，把它的残留时间线与这条基线对照即可判定是哪一种**。有区分力轮（inner 扫描窗口内在跑）
仍未出现——采样器常挂，等 inner 忙的轮抓。

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

- [x] AC1: leak-scan 与测试回收次序修复——run 末扫描前等待回收完成 / 测试同步清理
- [x] AC2: 负控——round 95 形态（残留活到扫描时刻）不再误报 NEW
- [x] AC3: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC3 全部勾上
- [ ] 负控样例贴出（见 Evidence：round 95 形态不复发）
- [ ] 全量套件绿

## Touches

- plugin/scripts/tmux-leak-scan.sh（回收等待 / 持有判定）
- scripts/test.sh:1217（--check 调用点，如需扫描前等待）
- plugin/test/tmux-leak-scan.test.mjs（若存在）
- tasks/gap-leak-scan-reap-race-false-red.md（自身）

## Evidence

**实现**：bounded reap-wait（持有判定）落在 `tmux-leak-scan.sh --check` 内部（2026-08-13）。
判定前先扫描；发现 NEW 残留时不立即 FAIL，而是以 `$TMUX_LEAK_REAP_WAIT_MS`（默认 10000ms、
`$TMUX_LEAK_REAP_POLL_MS` 默认 250ms）为界的轮询等待——残留若在界内消失，即收尾回收中的
瞬态残留（测试自造 tmux server 退出异步：kill-session 后进程退出 + /tmp socket dir 删除是异步的），
判定 clean 并输出 `note — …cleared during reap-wait`；界满仍残留才是真泄漏，FAIL 并列出。
**门未削弱**：真泄漏（没人 kill 的 server）永不清零 ⇒ 仍 FAIL；干净 run 首次扫描即过、零额外延迟。
`scripts/test.sh:1217` 调用点只加注释（等待逻辑在脚本内，`--check` 自带），不另起等待。

**负控（round 95 形态 = 残留活到扫描时刻、随后被回收）**：`plugin/test/tmux-leak-scan.test.mjs`
R2 精确复现——`--snapshot` 后新建 `/tmp/session-liveness-*` 残留、`--check` 开始时残留仍在、
0.6s 后被独立 reaper 移除 ⇒ `--check` 判定 **clean + cleared during reap-wait note**，不误报 NEW。
R3 对照：残留不被移除（真泄漏）⇒ 界满 FAIL 且列出该残留。R1（干净 run 零等待）、R4（快照排除
既有匹配）、R5（无快照 fail-closed）全绿。

**scoped 门**：`scripts/test.sh --for-task gap-leak-scan-reap-race-false-red` 退出 0——
scoped 静态检查（dead-code-after-return-check / tick-core-static-check / delivery-inventory-drift-gate）过，
5/5 测试过。既有受影响测试手验过：`test-isolation-check.test.mjs` AC5/tmux-leak-scan DELTA（真脚本）、
`session-liveness-sweep.test.mjs`（脚本只读断言：无 pkill/killall）、`full-suite-runner.test.mjs`
AC5/AC1 leak-scan 失败形态识别。全量套件绿留待 DoD/fan-in（本任务不跑全量）。

```
$ scripts/test.sh --for-task gap-leak-scan-reap-race-false-red   # EXIT=0
✔ R1 — a clean delta (no NEW matches) is immediate clean with no reap-wait note
✔ R2 — TRANSIENT NEW residue (the round-95 shape) clears within the bound → CLEAN + note
✔ R3 — PERSISTENT NEW residue (a genuine leak) still FAILs after the bound, listing the match
✔ R4 — a pre-existing match recorded in the before-run snapshot is excluded (DELTA preserved)
✔ R5 — fail closed: --check with no before-run snapshot exits 1
ℹ tests 5 · pass 5 · fail 0
```
