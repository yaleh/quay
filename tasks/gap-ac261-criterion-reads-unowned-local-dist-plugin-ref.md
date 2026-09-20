---
id: gap-ac261-criterion-reads-unowned-local-dist-plugin-ref
title: AC-261 恒假的仪器失败：criterion 读【无主】本地 dist-plugin
  ref（publish-dist-branch.sh:97 每次 branch -D 删它）⇒ 改读渠道 ref；四条实质臂实测已全绿，唯一假红来自 ref
  解析
status: todo
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-261
---
**type:** execution

## Finding

### 一、AC-261 当前实测 FAIL —— store 自己的 runner（本轮立案前的直接量）

```
$ node packages/quay/bin/quay.js goal gate AC-261 --dry-run
{"id":"AC-261","verdict":"fail",
 "reason":"acceptance failed (exit 1) — AC-261: cannot read dist-plugin bin/ (Command
  '['git','ls-tree','-r','dist-plugin','bin/']' returned non-zero exit status 128.)
  => cannot confirm the shim reaches the marketplace face", ...}
```

常设失效清单同一次读数里 AC-261 与 AC-260 并列：

```
$ node packages/quay/bin/quay.js goal check --stale-pass
{"frozenScope":119,"evaluated":true,"failing":["AC-260","AC-261"], ...}
```

### 二、根因：判据读的是一个【无主】的本地 ref —— 观察器缺陷，不是交付面违规

判据第 3 步是裸 ref `git ls-tree -r dist-plugin bin/`。git 的 ref dwim 顺序是
`refs/<name>` → `refs/tags/<name>` → `refs/heads/<name>` → `refs/remotes/<name>`，**不含
`refs/remotes/origin/<name>`** ⇒ 裸 `dist-plugin` 只可能命中本地分支，而本检出它不存在：

```
$ git rev-parse --verify -q refs/heads/dist-plugin^{commit}   → 非 0（ABSENT）
$ git branch -a | grep -i dist
  remotes/origin/dist-plugin    ← 渠道（在）
  remotes/vhs/dist-plugin       ← 另一台主机，非本渠道
```

**它没有主人，这是机制决定的，不是偶发**：`plugin/scripts/publish-dist-branch.sh:97`
每次发布先删本地 ref（`git -C "$REPO_ROOT" branch -D "$BRANCH"`，注释自述为让 `checkout --orphan`
能复用该名），orphan 在一个一次性 worktree 里建并提交，`cleanup()` = `git worktree remove --force`
⇒ 发布**从不留下**一个持久的本地 ref。

### 三、四条实质臂实测【全绿】—— 交付面本身是对的

本轮在真实仓库 `/home/yale/work/quay` 上逐臂取读数：

| 臂 | 读数 |
|---|---|
| ① 工作树 `plugin/bin/quay` 存在且可执行 | 存在，mode `-rwxrwxr-x`，6379 bytes |
| ② 随渠道分支以 mode 100755 交付 | `git ls-tree -r refs/remotes/origin/dist-plugin bin/` → `100755 blob 2832d198… bin/quay` |
| ③ 最小 PATH（仅 `<repo>/plugin/bin:/usr/bin:/bin`，`QUAY_PLUGIN_ROOT` 与 `CLAUDE_PLUGIN_ROOT` 均 unset）下 `quay --version` | `command -v quay` → `/home/yale/work/quay/plugin/bin/quay`；输出 `0.10.0-dev`，rc=0 |
| ④ 负控制：PATH 解析到的必须是 plugin bin 那个 | 见 ③，解析到 `plugin/bin/quay`，⛔ 不是 npm-global |

⇒ **AC-261 断言的保证今天成立**；判据 exit 1 的唯一来源是第 3 步的 ref 解析（仪器失败，硬规则 3b）。
⇒ 这也解释了它长期停在 `done-unresolved` 的读数：工作做过（shim 已建、已交付），台账却持续为假。

### 四、为什么上一次的修法没有守住

`gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global`（done，`goal_ac: AC-261`）建了 shim；
`gap-ac261-shim-node-autodetect-nvm-fallback`（done）修了 nvm-only 环境下 `/usr/bin/node` 缺席时的解释器解析。
**两条都修的是【被判据测的那个东西】，一个字节都没碰【判据读它的方式】** ⇒ 交付面转绿、判据仍恒假。

同族先例：`gap-ac272-rolling-channel-criterion-reads-unowned-local-ref`（done）已就 AC-272 做过一次同样的
「只换 ref 来源」修法；但它当时贴出的全仓 grep 清单漏了 `goals/`，而判据恰恰住在 `goals/`
⇒ 硬规则 5b 的教科书漏项（修的人只盯着被报出来的那一个）。

<!-- dedup-ref -->
本条与一个同机制任务相关但不重复，记录以便追溯：`gap-ac260-criterion-reads-unowned-local-dist-plugin-ref`
（`todo`，`task check` → PASS「eligible to move to ready」）的 `## Touches` 已声明
`goals/AC-261-缺口c-plugin-bin-quay-shim-…md`，其 Requested action §2 也把 AC-261 的 criterion 纳入改写范围。
两者在**同一文件**上重叠（`touches-orthogonality-check` 语义：OVERLAP ⇒ 必须串行，⛔ 不并发）。
本条只承担 **AC-261 这一半**（它自己那条 criterion 与它自己那份 goal 记录），⛔ 不碰 `goals/AC-260-…md`。
这是**追溯记录，不是前置声明**：本条不依赖对方先落地，也不会因为它先落地而作废（见 Requested action 2 的收窄条款）。

## Requested action

1. **取证先行**（任一与本文读数不符 ⇒ 停并报告，⛔ 不代做别的任务）：贴 `goal gate AC-261 --dry-run`、
   `goal check --stale-pass`、`git rev-parse --verify -q refs/heads/dist-plugin^{commit}`（预期非 0）、
   `git rev-parse refs/remotes/origin/dist-plugin` 与 `git ls-remote origin refs/heads/dist-plugin`（预期同值），
   以及 §三 四条臂的原始读数（含 `ls -l plugin/bin/quay`、`git ls-tree -r <chan> bin/`、
   最小 PATH 下 `command -v quay` + `quay --version` + `echo $?`）。

2. **改 AC-261 的 criterion：只改 ref 来源，不放宽任何断言。** 走 **goal store 的写面**
   （`node packages/quay/bin/quay.js goal write AC-261 --criterion <全文> --actor <who> --reason <why>`），
   ⛔ **不手改 `goals/*.md`**。⛔ 该 verb 的旗标**以 verb 自身为准**（`quay goal write --help`），
   ⛔ 不照抄本任务体。

   **收窄条款（⛔ 落笔前先读 store 现状）**：若 `gap-ac260-criterion-reads-unowned-local-dist-plugin-ref`
   已落地、且 AC-261 的 criterion 已是候选表形态 ⇒ **逐字沿用它的形态，⛔ 不另造第二种写法**；
   此时本任务退化为**独立复验**（跑 Requested action 3/5 的两个读数并贴出），而不是第二次编辑。

   改法：ref 解析改为**候选表、remote-tracking 优先** —— `refs/remotes/origin/dist-plugin`（那才是渠道）
   → `refs/heads/dist-plugin`（本地副本）；解析出的 `CHAN` 供后续每一步使用。
   ⛔ **断言、四条臂语义、零计数守卫、exit 码一字不改**（只换"从哪里读"）。
   ⛔ AC-261 另有一处必须同步：它把 `dist-plugin` 写进了 `expect`/消息正文，改成 `%s`/`CHAN`
   （消息不得对一个可能是 remote-tracking 的 ref 谎称自己是本地分支）。AC-261 的**其余四臂一字不改**。

3. **负控制：判据必须仍能取假（硬规则 4 / 3b）。** 本轮已实测下列读数，执行者须自己重跑并贴原始输出：
   ① 渠道候选可解析 + 交付面干净 ⇒ **exit 0**；
   ② 候选 ref 全不可解析 ⇒ **exit 1** 且原因**可区分**（仪器态，⛔ 不得与「合格」同形），逐字为
   `AC-261: INSTRUMENT - none of the delivery-channel refs (...) resolve; cannot read the delivery face => NOT an assessment of the artifact`；
   ③ 退回裸 ref `dist-plugin` ⇒ **exit 1**（恒假已消除的对照）。
   ⛔ **只贴一次 exit 0 不算**（恒绿判据与"合格"同形）。criterion 只含裸 `git`（无 `-C`）⇒ 在 `mktemp -d`
   的 scratch 仓库/临时 cwd 里跑同一脚本即可，**对生产仓库零破坏**。

4. **过写入门**：贴写面读数（接受原文，或拒绝逐字 + 处置）。⚠️ accept 判定以写面自身为准。

5. **落地后用 store 自己的 runner 复跑**（⛔ 手工 python 复跑不算，driver 复跑的是前者）：
   `goal gate AC-261` ⇒ exit 0（贴完整 JSON）；`goal check --stale-pass` ⇒ `failing` 中**不再含 AC-261**。
   ⚠️ `goal gate` 的 runner 在 **criterion 所在的 checkout** 上跑 ⇒ 要让生产读数（主检出 `author`）当场可取，
   **主检出那份也必须写**；两处内容须**逐字相同**以免 merge 冲突。

6. **回归守护：把候选表来源落成套件里的一条测试**（⛔ 不复制第二份恒等检查器；优先并入既有机制——
   `plugin/test/ac272-rolling-channel-version-selfproof.test.mjs` 已有 `candidateList` / `revertToBareLocalRef` /
   `runCriterion` 等可复用件；同机制的 `gap-ac260-…` 也声明了 `plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs`，
   若它已存在则并入，⛔ 不另建同义文件）。判据是「**退回读裸 `dist-plugin` 会红**」——即这条测试真的在钉住
   ref 来源，不是恒真。⛔ 新测试文件按 `scripts/test.sh` **头注释的注解契约**标注（正本在读脚本，⛔ 不照抄本任务体）。

7. **⛔ 明确不做**（不静默略过，逐条写一句为什么）：① 不改交付面内容（§三 实测交付面对，无需重发
   `publish-plugin-dist.yml`）；② 不把本地 `dist-plugin` ref 摆回来（发布机制按设计删它，且见 §二；
   `gap-ac272-…` §四已就同一决策写过裁定，并记过一次已证失败的同类修法）；③ 不为 AC-261 另写恒等检查器；
   ④ ⛔ 不碰 `goals/AC-260-…md`（那是 `gap-ac260-…` 的交付物）。

## Acceptance Criteria

- [ ] **AC1 取证完整**：Requested action 1 的全部原始输出已贴，且与本文 §一/§三 读数一致（不一致 ⇒ 停并报告）。
- [ ] **AC2 AC-261 criterion 已改且只改了 ref 来源**：贴改写**前后**完整文本（diff 形态），并逐条指出
      「断言 / 四条臂语义 / exit 码一字未动」。⛔ 只贴改写后不算。若走收窄条款（沿用兄弟任务形态），
      须贴出该任务的落地读数与「逐字沿用」的证据。
- [ ] **AC3 负控制三臂全跑通**（每臂贴命令 + 原始输出 + exit 码）：① 渠道候选 ⇒ exit 0；② 候选全不可解析
      ⇒ exit 1 ∧ 仪器态原因可区分（硬规则 3b）；③ 退回裸 ref ⇒ exit 1。⛔ 缺臂即未完成。
- [ ] **AC4 写入门读数**：AC-261 criterion 经 goal store 写面接受（或拒绝原文逐字落痕 + 处置），且
      `criterion-failure-attribution-check.ts` 计数未增（贴前后计数）；若增，按该检查器自述的 `--capture`
      重锚 `docs/analysis/criterion-failure-attribution.baseline.json`（⛔ 不得靠放宽检测器过关）。
- [ ] **AC5 store runner 转绿**：`goal gate AC-261` ⇒ exit 0（贴完整 JSON）；`goal check --stale-pass`
      ⇒ `failing` **不含 AC-261**（贴完整 JSON）。⚠️ 若该次读数里 `failing` 仍含 AC-260，如实贴出并注明
      那属于 `gap-ac260-…` 的范围，⛔ 不据此判本任务失败、也⛔ 不代它修。
- [ ] **AC6 回归守护能取假**：新增/扩展的测试在「把 ref 来源退回裸 `dist-plugin`」时**变红**，恢复后变绿；
      **两个读数都贴**。⛔ 只贴绿不算（恒真断言与"合格"同形）。
- [ ] **AC7 既有门不因本次改动转红**：`bash scripts/test.sh --for-task gap-ac261-criterion-reads-unowned-local-dist-plugin-ref` exit 0（贴读数）。

## Definition of Done

**落地判据是「判据读到了真的那个量」，不是「文件里的字变了」**（DIR-026 Reading A）：

- 生产仓库 `/home/yale/work/quay` 上 **store 自己的 runner** 对 **AC-261** exit 0
  —— 这正是 driver 下一轮独立复跑的那个量（AC5），⛔ 不是手工 python 复跑；
- **反过来的读数也成立**：`goal check --stale-pass` 的 `failing` **不再含 AC-261**（同一条命令、同一个 frozen 人口）；
- **判据读的是用户实际会装的那一侧**：`refs/remotes/origin/dist-plugin`，且落地当轮贴出它与
  `git ls-remote origin` 的**同值读数**（证明读的不是陈旧副本）；
- **判据仍能取假**：AC3 三臂 + AC6 的「退回旧来源即红」负控制 —— ⛔ 只贴一次 exit 0 不算（硬规则 4）；
- **仪器态与合格态可区分**：候选 ref 全缺时仍给出独立的仪器态原因（硬规则 3b）；
- ⛔ 只改 criterion 文本、只留 fixture/注入证据、或把本地 ref 摆回来喂判据，**都不算落地**。

## Touches

- goals/AC-261-缺口c-plugin-bin-quay-shim-让-cli-免-npm-上-path-path-已含该目录而目录不存在.md
- plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs
- docs/analysis/criterion-failure-attribution.baseline.json
- tasks/gap-ac261-criterion-reads-unowned-local-dist-plugin-ref.md
