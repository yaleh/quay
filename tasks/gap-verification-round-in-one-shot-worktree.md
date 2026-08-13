---
id: gap-verification-round-in-one-shot-worktree
title: 验证轮跑在一次性 worktree（--root <wt> --state-dir <主 .quay>）——结构性消守卫缺口/假证书/自造脏三条
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

**主建议（manager 2026-08-13 深度分析，人托）**：让验证轮跑在一次性 worktree 里
（`--root <worktree> --state-dir <主 .quay>`）——**一次消掉三条缺陷（不是缓解，是让前提消失）**：
```
守卫覆盖缺口（拦提交不拦工作树编辑）→ 主 checkout 的编辑【物理上不在被测树里】⇒ 污染路径消失
verifiedCommit 假证书                → 被测树【就是】那个 commit 且干净 ⇒ 字段名副其实
自造脏（package-lock 被跑轮改写）    → 改的是一次性 worktree 的副本 ⇒ 主 checkout 不再被跑轮弄脏
```
leak 残留只部分缓解（tmux socket 在 /tmp 不在 worktree）⇒ 仍需 per-run namespace（互补不重叠）。

**四块零件全部已存在（其中一块零生产调用者）**：
```
① --root / --state-dir 解耦：tasks/gap-suite-state-split-across-worktree-and-gate（done）
   现役用法：.claude/workflows/execute-suite-fix.js:78 `--root ${worktree} --state-dir ${stateDir}`
② provision-verify-worktree.sh —— 已实现 + 测试 + --teardown（含回收进程）
   grep 全仓：非测试调用者 = 0 ⇒ 建成、测过、没接上（2026-08-13 已核）
③ node_modules 成本已解决：现存 worktree 符号链接 → 主 node_modules（71M 不复制）
④ worktree-branch-hygiene-check.sh —— 悬挂 worktree/分支卫生检查已有
```
⇒ **这不是「造一个新机制」，是「把一个已经造好、测过、没人调的机制接上」。**

**provision 开销已测（2026-08-13，不是决定性的那个量）**：git worktree add 1.1s + provision 2.4s
+ teardown 0.8s ≈ **4.3s/轮**。

**编译缓存（决定性的量，端到端待测）**：`scripts/test.sh:184` 缓存目录 repo_root 相对 ⇒ 新 worktree
每轮空缓存。**实测（两组独立，2026-08-13）**：缓存收益是**比例**（≈编译时间的 30-40%）非固定 ms——
脚本 322→286（省 136ms）、测试文件 7685→4435（省 3250ms）、同机差 24 倍 ⇒ 随「编译多少代码」缩放。
**config C**：worktree 跑时 `NODE_COMPILE_CACHE=<主 repo>/.quay/node-compile-cache`（test.sh:183 逐字
尊重用户变量）⇒ 复用主仓暖缓存（1.3G/152594 条目实测仍最快档：286 vs 无缓存 422），让 worktree 轮与
主 checkout 轮编译成本同量级。**别用「N×固定 ms」外推**（140ms 是特定脚本收益非常数）。

## Plan

1. 验证轮起跑改为一次性 worktree：provision-verify-worktree.sh（--teardown 完整回收）+ `--root <wt>
   --state-dir <主 .quay>` + `NODE_COMPILE_CACHE=<主>/.quay/node-compile-cache`（config C）。
2. 起跑/终态记 HEAD（A15③ 混合树判据在此形态下天然满足——worktree 每轮新鲜）。
3. 端到端时长对照（AC，非前提）：`worktree 轮 durationMs - 基线 < 20s`（基线 ~441s，rounds 95-99）。
4. 负控：主 checkout 编辑不再进被测树；跑轮不再弄脏主 checkout。

## AC

- [ ] AC1: 验证轮跑在一次性 worktree（provision + --root <wt> --state-dir + config C NODE_COMPILE_CACHE）
- [ ] AC2: 主 checkout 轮运行期间零污染（守卫缺口/自造脏消失的验收——package-lock 不再被改写）
- [ ] AC3: verifiedCommit 指名的树 == 被测树（假证书消失的验收）
- [ ] AC4: 端到端时长对照：worktree 轮 durationMs - 基线 < 20s（must answer before close）
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 端到端时长对照样例贴出（见 Evidence：worktree 轮 durationMs vs 基线）
- [ ] 全量套件绿

## Touches

- plugin/scripts/full-suite-runner.ts（起跑 worktree 化 / provision 调用）
- plugin/scripts/provision-verify-worktree.sh（接上零调用者）
- plugin/scripts/suite-state-trigger.ts（如需）
- scripts/test.sh（config C NODE_COMPILE_CACHE 传递，如需）
- tasks/gap-verification-round-in-one-shot-worktree.md（自身）

## Evidence（端到端时长对照，2026-08-13 round 104 实验）

```
round 104 (worktree, config C, 8e6ecee5): durationMs=571076 (571s) load=12.46 tests=4166 fail=0
同窗 main 对照（rounds 102-103, 01:46-02:15 同段）: 570s / 558s
早前基线（rounds 95-99, inner 大部分空闲）: 412-483s
round 45（早前 worktree 轮）: 462s load 14.42 ≈ 基线
```
**同窗对照是正确比法**：round 104 vs rounds 102-103 = **+1-13s < 20s 阈值** ⇒ worktree 本身开销未证超阈值。
变慢始于 round 102（main 轮同样 558-570s——inner guard-wiring/dispatch-gate 并发负载，`git worktree list`
实锤两个活跃 worktree=驱动源），非 worktree。**跨窗对照（104 vs 95-99）被并发负载混淆**——测量教训：
跨窗比负载变化、同窗比才干净（与 leak-scan 竞态假说的「单点测时间重叠」同族）。provision 另测：
add 1.1s + provision 2.4s + teardown 0.8s ≈ 4.3s。
