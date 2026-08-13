---
id: gap-verifiedcommit-dirty-tree-false-certificate
title: verifiedCommit 在脏树下是假证书——声明的是 commit 对象，被测的是工作树，两者之差无任何检查（round 记录无树字段）
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

**实证（manager 2026-08-13 读实现，outer 独立 spot-check 复核）**：`verifiedCommit` 声明的是一个 commit 对象，
实际被测的是当时工作树（commit + 未提交编辑 + untracked），**两者之差没有任何检查**：
```
full-suite-runner.ts:1274  const verifiedCommit = readVerifiedCommit(root)
full-suite-runner.ts:742   注释原文：the integration tip at suite start
全文件 grep porcelain|isDirty|dirty|assert-clean → 0 命中（独立复核：0）
负控制：plugin/scripts/assert-clean-tree.sh【存在】（Aug 11），而 runner 引用它 0 次（真没被调用）
```

**活样本（round 4a3fc0be，2026-08-13 00:06 green）**：该轮 `verifiedCommit=1a5da8ee`，
同一工作树里躺着两个 staged 任务体编辑（outer 23:58:58 提交被守卫拒，jsonl 第 4 行/第 3 起事件）。
现算的三个对象（已独立核过哈希）：
```
HEAD 的树        b463d39d（1a5da8ee）
index 的树       7534998b（含两个 staged 编辑）
被【实际读取】的  = 工作树（既非 b463d39d 也非 7534998b）：
   package-lock.json 是 ` M`（unstaged，不在 index 树里）
   4 个 untracked：./undefined、orphaned diff、task-file-violation-ledger.jsonl、fast-mode-telemetry
```
⇒ 该轮声称验了 1a5da8ee，而 **1a5da8ee 这个对象从未被单独测过**。绿证书对任何 committed 对象都是假的。

**为什么绿比红重**：红是吵闹的、会被查；绿是安静的，且下游 merge 正是信任 `verifiedCommit` 字段。
同一个缺口：红方向后果是浪费一轮；**绿方向后果是放行一个未经测试的对象**。

**缺的是哪个量（为什么「提交后算不算认证」无法回答）**：round 记录没有任何关于「树」的字段——
末条 round 记录的字段：`cancelled commit cpu_time_s durationMs fail laneCount load load_read_error
lowconc_phase_ms main_phase_ms mem_peak_mb pass per_test_ms reason redAt round runner scope
scope_unit serial_phase_ms startedAt state static_phase_ms swap_peak_mb tests`——有 commit，
没有 tree、没有 dirty 标志。记录里唯一的对象标识是 commit，而 commit 恰恰不是被测的那个东西。
⇒ **没有树字段，「事后提交的这个 commit 是不是复现了被测树」无法回答**——不是判断难，是那个量根本没被记。

**与既有机制正交**：`gap-suite-start-verifies-target-commit`（e7f168a4，done）解决「选对了哪个 commit」
（起跑验 verifiedCommit 含目标修复），**不解决「被测的是不是就是那个 commit」**——两个问题正交。

**与守卫覆盖缺口（gap-precommit-guard-blocks-commits-not-working-tree-edits）互引**：同持久记录面——
那条解决「检测轮中被编辑的断言面文件」（快照/隔离），本条要求「脏树时 verifiedCommit 不得称已验证」；
两条都属「把轮与工作树解耦」（快照/隔离），**不是「提醒别在轮内编辑」**——因为触发者是别人，本地不可知，
形如「编辑前先查 state」的缓解结构上不可能生效。

**触发源不可知的实证（为什么纪律类修法不成立）**：23:58:54 manager 提交 1a5da8ee（守卫打印「无运行中的轮，
放行」）→ 23:58:56 round 4a3fc0be 起跑 → 23:58:58 outer 提交任务体被守卫拒。outer 的编辑早就在树里、
没做错什么；让它变成污染的是 2 秒前的一次合规提交。任何一层在动手编辑的那一刻都无法知道自己的编辑何时被暴露。
（`./undefined` 就是 untracked 文件，今天真的参与了一次事故——untracked 不是「可忽略」。）

**自造脏（manager 2026-08-13 新发现——改变缺陷性质）**：脏树里有一块不是任何人忘了提交，是套件自己造的：
```
git diff package-lock.json → 1 insertion / 3 deletions（三处 "peer": true 被删——npm peer 标记重写）
package-lock.json mtime = 2026-08-13 00:08:14（round 90 终态 00:06:22 与 round 91 起跑 ~00:08 之间的 install/build 阶段）
```
⇒ 强指向：跑轮自身（npm install / build_dist）会改写主 checkout 里这个被跟踪文件（未做确证实验——
`git checkout -- package-lock.json` 再跑一轮属改树，不在活 checkout 上做）。⇒ **即使三层纪律完美，
verifiedCommit 仍可能是假证书——轮子在跑的过程中把自己脚下的树改脏了。**
⇒ **脏净判定必须区分【外来脏】（人/agent 编辑）与【自造脏】（跑轮副作用）**：后者不能靠「大家别乱动」
消除，只能靠隔离（worktree/快照）或把该文件排除出判定并说明理由。

## Plan

round 记录带上【被实际读取内容的标识】，最低限度三样（manager 约束，不是实现）：
```
① HEAD commit（已有）
② dirty 标志 —— 必须把 untracked 也算进去（否则 ./undefined 这类正好漏在外面）
③ 被测内容的 tree hash（tracked 部分即可，git stash create / 临时 index 都能取，成本一次 write-tree）
```
有了 ③，「我事后提交的这个 commit 是不是复现了被测树」从一句判断变成一条比对；
没有 ③，绿证书就只能靠「应该没别人动过」这种本地不可知的假设。
另一可选方向（同属「轮与工作树解耦」）：起跑取快照 / worktree 隔离，不让脏树进被测路径。

## AC

- [ ] AC1: 起跑时记录树脏净状态进 round 记录（dirty 标志**含 untracked**；脏 ⇒ verifiedCommit 不声明「已验证」）
- [ ] AC2: round 记录含被测内容 tree hash（tracked 部分，write-tree）
- [ ] AC3: 负控——round 4a3fc0be 形态（vc=1a5da8ee + 工作树 ≠ HEAD 树 ≠ index 树）被检出/标注
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 负控样例贴出（见 Evidence：round 4a3fc0be 形态被标注「验未被记录树」）
- [ ] 全量套件绿

## Touches

- plugin/scripts/full-suite-runner.ts（起跑脏净检测 + round 记录树字段）
- plugin/scripts/assert-clean-tree.sh（启用——现存在但 0 引用）
- plugin/test/full-suite-runner.test.mjs
- tasks/gap-verifiedcommit-dirty-tree-false-certificate.md（自身）

## Evidence（2026-08-13 00:07 提交前记录——hard rule 7：先记录再动作，提交后此对照不可复原）

**round 90（= 4a3fc0be）权威记录**（`.quay/verification-round.jsonl`，2026-08-13 00:06 green）：
```
{"round":90,"state":"green","commit":"1a5da8ee4febad72aa6040dedcf738776ef91d7a","tests":4146,"fail":0}
字段全集：cancelled commit cpu_time_s durationMs fail laneCount load load_read_error lowconc_phase_ms
main_phase_ms mem_peak_mb pass per_test_ms reason redAt round runner scope scope_unit serial_phase_ms
startedAt state static_phase_ms swap_peak_mb tests —— 含 tree/dirty 的字段：【空】。
```

同刻三个对象（提交前实测，哈希已 `git rev-parse` 独立核过）：
```
HEAD      = 1a5da8ee
HEAD 树    = b463d39df642268345e64572057df6076ff226fe（证书指名的那个对象的树）
index 树   = 7534998bc5d0b5308b7e7843503dcd38f5996843（含两个 staged 任务体编辑）
被测       = 工作树 = index + unstaged(package-lock.json ` M`) + 4 untracked
             （./undefined、.quay/orphaned-full-suite-runner-*.diff、.quay/task-file-violation-ledger.jsonl、
               milestones/fast-mode-telemetry/2026-08-12.json）
```
⇒ **被测 ≠ HEAD 树 ≠ index 树**。该轮声称验了 1a5da8ee，而 1a5da8ee 的树（b463d39d）从未被单独测过。
绿证书已落进权威记录，指名一个从未被测过的对象。此对照只存在于提交前的工作树——提交后 index 树变成新
HEAD 树，unstaged/untracked 状态漂移，round 90 的记录永远只说 `commit=1a5da8ee`。

**batch-merge 消费该绿的手工核查（manager 2026-08-13 —— 机制上线后应自动产出的正是这四行）**：
```
被测树相对 HEAD 的全部差异（round 90 形态）：
  staged   : 3 个 tasks/*.md（含本任务体）
  unstaged : package-lock.json + 1 个 tasks/*.md
  untracked: .quay/orphaned-…diff、.quay/task-file-violation-ledger.jsonl、milestones/fast-mode-telemetry、undefined
命中 packages/ 或 plugin/ 的：【0 条】（负控制：同一谓词对 'plugin/scripts/x.ts' → 1 ✓）
⇒ 脏的部分【零产品代码】⇒ round 90/91 的绿对 1a5da8ee 的产品代码覆盖与干净树等价。
```
batch-merge 以该绿推进 develop→1a5da8ee 可走（2026-08-13 00:15 已执行），但这次靠人工查出的四行必须留下
记录——下一次没人查就没人知道，而「没人查也看不出差别」正是这条缺陷成立的原因。

**首次成本（manager 2026-08-13 00:36 指认——这是本缺陷第一次真实收费）**：
「2026-08-13 00:3xZ，outer 需要声明 round 93 跑在干净树上，而记录中无字段可引 ⇒ 只能自述。」
——不是「绿轮出错」，而是「被迫【断言】一件本该可以【引用】的事」；半小时后的读者只能选择相信，
不能核。一次可指认的、发生过的不可核验——比任何论证都更能说明为什么要加那三个字段。
