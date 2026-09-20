---
id: gap-ac272-rolling-channel-criterion-reads-unowned-local-ref
title: AC-272 恒假的仪器失败：criterion 读的是【无主】的本地 dist-plugin ref（发布脚本每次 branch -D
  删它、全仓只此一个读者），而渠道本身是对的 ⇒ 把 ref 来源改成 refs/remotes/origin/dist-plugin（用户实际装的那一侧）
status: ready
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-272
---
**type:** execution

## Finding

### 一、AC-272 当前实测 FAIL —— 两次独立读数 + 机制自报

**读数 1｜store 自己的 runner（= driver 下一轮复跑的同一入口）**

```
$ node packages/quay/bin/quay.js goal gate AC-272 --dry-run
{"id":"AC-272","verdict":"fail",
 "reason":"acceptance failed (exit 1) — CAUSE=dist-plugin-branch-absent — this checkout has no
  dist-plugin ref, so the rolling channel's shipped version cannot be read (fetch it, or run this
  where the branch exists)",
 "timestamp":"2026-09-20T05:19:54.030Z","dryRun":true, …}
→ exit 1
```

**读数 2｜机制自己的常设失效清单（I5 `--achieved-failing`）**

```
$ node packages/quay/bin/quay.js goal check --achieved-failing
{"achievedButFailing":["AC-272"],"evaluated":true,"scopeSize":35, …}
→ AC-272 是 35 条在域 AC 里【唯一】一条 achieved-but-failing。
```

⚠️ 两次读数**给出的是同一个 CAUSE**，而该 CAUSE 按 AC-272 criterion 自己的词表属于**仪器失败**，
不是渠道违规（见 §二：渠道此刻是对的）。⇒ 这是一条**结构上恒假**的常设判据在每轮生成假红。

### 二、根因：criterion 读的是一个【无主】的本地 ref（观察器缺陷，不是渠道违规）

criterion 的解析步骤是 `git rev-parse --verify -q "dist-plugin^{commit}"`。git 的 ref dwim 顺序是
`refs/<name>` → `refs/tags/<name>` → `refs/heads/<name>` → `refs/remotes/<name>`，
**不含 `refs/remotes/origin/<name>`** ⇒ 裸 `dist-plugin` **只可能命中本地分支**，而本检出的
`refs/heads/dist-plugin` **不存在**：

```
$ git branch -a | grep -i dist
  implement-dist-plugin-fix                                   ← 无关
  remotes/origin/dist-plugin                                  ← 渠道（在）
  remotes/vhs/dist-plugin  remotes/vhs/dist-plugin-archlocal  ← 另一台主机，非本渠道
$ git rev-parse --verify -q dist-plugin^{commit}   → 非 0（不存在）
$ ls .git/logs/refs/heads/dist-plugin              → 不存在（从未/已删）
```

**它没有主人 —— 这是机制决定的，不是偶发**：

- `plugin/scripts/publish-dist-branch.sh:97` **每次发布先删**本地 ref：
  `git -C "$REPO_ROOT" branch -D "$BRANCH"`（注释自述：为让 `checkout --orphan` 能复用该名）。
- orphan 是在一个**一次性 worktree**（`$WORK`）里建并提交的，`cleanup()` = `git worktree remove --force "$WORK"`
  —— 发布**从不留下**一个持久的本地 `dist-plugin` ref。
- 发布本身在 GitHub Actions runner 上跑（`publish-plugin-dist.yml` → `--push`），CI 上删的是 runner 的克隆。
- 全仓 grep：**判据是本地 `dist-plugin` ref 的唯一读者**——`show dist-plugin:` / `rev-parse … dist-plugin`
  在 `plugin/` `scripts/` `packages/` `.github/` 下**零命中**（除判据自身）。

**而渠道本身此刻是对的**（⇒ 失败不来自渠道）：

```
$ git rev-parse refs/remotes/origin/dist-plugin    → f57218052b2f4ee71ef90c24f19048cb49c174b5
$ git ls-remote origin refs/heads/dist-plugin      → f57218052b2f4ee71ef90c24f19048cb49c174b5   （逐字相同 ⇒ 不陈旧）
$ git show refs/remotes/origin/dist-plugin:VERSION → 0.10.0
$ git log -1 --format=%s refs/remotes/origin/dist-plugin
  dist-plugin: build from 4c81166
$ git rev-parse v0.10.0^{commit}  → 4c811663235511625b4b0bf607f27dbf653550cc
$ git rev-parse 4c81166^{commit}  → 4c811663235511625b4b0bf607f27dbf653550cc    （相同 ⇒ 第二臂成立）
```

⇒ 判据**第二臂**「确实等于同名 tag 的构建」**已经成立**；第一臂（`-dev` 后缀）不成立也不要求成立。

**对照取证（只换 ref 表达式，判据其余逐字不动）**：把 `dist-plugin` 换成 `refs/remotes/origin/dist-plugin`
后同一判据 **exit 0 / PASS via arm 2**。⇒ 失败的**唯一**来源是 ref 解析（硬规则 4 推论四：给出了
「若 Y 为假则结果会不同」的对照，故这是被检验的结论而不是可解释的说法）。

### 三、为什么上一次的修法没有守住

<!-- dedup-ref -->
`gap-develop-version-union-missing-dev-suffix`（done，2026-09-15）确实把 AC-272 转绿过（其 AC6 贴了
`verdict=pass`）。但它**改的是「被判据读的那个 ref 的状态」，不是「判据读 ref 的方式」**：它手工
`git update-ref` 把本地 dist-plugin 对齐 origin（其 AC5 逐字：「本地 ref 已 update-ref 对齐」）。
那条 ref **没有任何机制维护**（§二），故它没能存活，判据随之退回**永久性仪器失败**。

更关键的是：**同一次取证里已经写下了这个缺陷本身**，只是被当作症状处置——其 AC1 修正 1 逐字：
「⚠️ 本地点 `dist-plugin` 是 local-only ref，origin 侧当时并不长这样…… 立案的 `0.7.0` 读数取自本地 ref
（origin 上不存在）」；Requested action 4 逐字：「⛔ 本地 `dist-plugin` 不是那个量——用户装的是 **origin 侧**」。
⇒ 「判据读本地 ref」**当时已被判定为错误来源**，但处置是「把本地 ref 摆成对的」＝**症状级修补**，
来源未改，缺陷存活至今。

### 四、为什么修判据的 ref 来源，而不是把本地 ref 再摆回去（⛔ 显式决策，不静默）

1. 用户装的是 **origin 侧**：marketplace source = `{"source":"github","repo":"yaleh/quay","ref":"dist-plugin"}`。
   本地 ref 只是副本，会与 origin 分叉 ⇒ 它既能产生【假红】（本次），也能产生【假绿】。
2. 发布机制**按设计删除**它（§二）⇒ 任何「把它摆回来」的做法都在与机制对赌。
3. 全仓只有判据读它（§二）⇒ 摆回来除了喂判据之外**没有第二个消费者**。

⇒ 三条合起来：摆回本地 ref 属于**同一次已证失败的修法**，不重复第二次。本任务改的是**来源**。

## Requested action

1. **取证先行**（任一与本文读数不符 ⇒ 停并报告，⛔ 不代做别的任务）：贴 `goal gate AC-272 --dry-run`、
   `goal check --achieved-failing`、`git rev-parse refs/remotes/origin/dist-plugin`、`ls-remote origin dist-plugin`、
   `git show refs/remotes/origin/dist-plugin:VERSION`、tip 的 `build from` sha 与 `v0.10.0` 的 sha（六条原始输出）。

2. **改 AC-272 的 criterion：只改 ref 来源，不放宽任何断言。** 走 **goal store 的写面**
   （`node packages/quay/bin/quay.js goal write AC-272 …`，⛔ **不手改 `goals/*.md`**）。
   ⛔ 该 verb 的 `--criterion` / `--expect` / `--reason` / `--actor` 等**实际旗标以 verb 自身为准**
   （读 `quay goal write --help` 或 `--store` 方言的帮助，⛔ 不照抄本任务体）。
   改法：把 ref 解析改为**候选表、remote-tracking 优先**——
   `refs/remotes/origin/dist-plugin`（那才是渠道）→ `refs/heads/dist-plugin`（本地副本）。
   ⛔ **断言、两臂语义、CAUSE 词表、exit 码一字不改**（只换「从哪里读」）。
   草稿（已在真实仓库与 scratch 仓库逐臂跑过，见 AC3）见本文末「附录：criterion 草稿」。

3. **负控制：判据必须仍能取假（硬规则 4 / 3b）。** 逐臂跑出并贴原始输出（六臂，本任务已跑通一遍，
   见 AC3 表；执行者须**自己重跑**，⛔ 不转抄本文读数）。六臂 = 两条绿臂 + 四条红臂（三个真违规
   CAUSE + 一个仪器态 CAUSE）。⛔ **只贴一次 exit 0 的绿读数不算**：恒绿判据与「合格」同形。
   做法建议（非强制）：criterion 只用裸 `git` 且不含 `-C` ⇒ 在 `mktemp -d` 的 scratch 仓库里构造
   `refs/remotes/origin/dist-plugin` 后以该目录为 cwd 跑同一脚本即可，**对生产仓库零破坏**。

4. **过写入门（criterion 出生门）**：每个失败出口必须**在同一行**写 `CAUSE=`（谓词在
   `packages/quay/src/goal-store.ts`）——写面会拒绝不满足的 criterion。贴写面读数（接受或拒绝原文）。

5. **落地后用 store 自己的 runner 复跑（⛔ 手工 python 复跑不算，driver 复跑的是前者）**：
   `goal gate AC-272` ⇒ **exit 0**；并 `goal check --achieved-failing` ⇒ `achievedButFailing: []`（贴完整 JSON）。

6. **回归守护：把六臂落成套件里的一条测试**（新文件或并入既有覆盖 goal 记录的测试文件），
   判据是「**退回读裸 `dist-plugin` 会红**」——即这条测试真的在钉住 ref 来源，不是恒真。
   ⛔ 新测试文件按 `scripts/test.sh` **头注释的注解契约**标注（正本在读脚本，⛔ 不照抄本任务体）。
   ⛔ 同时**不得**为 AC-272 另写一个与 criterion 恒等的检查器（判据本身就是那个检查器，由 goal gate
   按轮复跑；另写一份只会制造一处需要同步维护的副本——上一轮同族任务的同一裁定）。

7. **报告 amended criterion 的复验态**：改写后贴 `goal check --stale-pass`（预期把改写识别为
   `amendedUnverified` 一类的「改过、待复验」，**不是**与 pass/fail 混同）。⛔ 不得静默沿用旧
   `verdict=pass` 假装达成（硬规则 3b：读不懂/未复验不得与「合格」同形）。⛔ 也不得手改 AC 的
   `status`（`achieved` 由机制写，无路径可翻回）。

8. **⛔ 明确不做**（不静默略过，逐条写一句为什么）：① 不改渠道内容（渠道此刻是对的，无需重发
   `publish-plugin-dist.yml`）；② 不把本地 `dist-plugin` ref 摆回来（§四）；③ 不为 AC-272 另写恒等检查器（§6）。

9. **门**：`bash scripts/test.sh --for-task <本任务 id>` exit 0；若本次改动触发了 criterion 归属棘轮
   计数变化（**预期不变**：未新增任何裸失败出口），按 `criterion-failure-attribution-check.ts` 自述的
   `--capture` 重锚 `docs/analysis/criterion-failure-attribution.baseline.json`，⛔ 不得靠放宽检测器过关。

## Acceptance Criteria

- [x] **AC1 取证完整**：§Requested action 1 的六条原始输出全贴，且与本文 §一/§二读数一致（不一致 ⇒ 停并报告）。
- [x] **AC2 criterion 已改且**只**改了 ref 来源**：贴出改写**前后**的完整 criterion 文本（diff 形态），
      并逐条指出「断言 / 两臂 / CAUSE 词表 / exit 码一字未动」。⛔ 只贴改写后不算。
- [x] **AC3 负控制六臂全跑通**（每臂贴命令 + 原始输出 + exit 码）：① `-dev` 臂 ⇒ exit 0；
      ② 版本==同名 tag 且 build-from 命中该 tag ⇒ exit 0；③ 裸版本无同名 tag ⇒ exit 1 ∧
      `CAUSE=claims-a-version-that-was-never-released`；④ 有 tag 但 tip 无 `build from` ⇒ exit 1 ∧
      `CAUSE=build-source-unrecorded`；⑤ 有 tag 但 build-from ≠ tag 提交 ⇒ exit 1 ∧
      `CAUSE=released-version-built-from-a-different-commit`；⑥ 候选 ref 全不可解析 ⇒ exit 1 ∧
      `CAUSE=dist-plugin-branch-absent`（仪器态必须与「合格」可区分）。⛔ 缺臂即未完成。
- [x] **AC4 写入门读数**：criterion 经 goal store 写面接受（或拒绝原文逐字落痕 + 处置），且
      `criterion-failure-attribution-check.ts` 计数未增（贴前后计数）。
- [x] **AC5 store runner 转绿**：`goal gate AC-272`（**非** `--dry-run`）⇒ exit 0，贴完整 JSON；
      `goal check --achieved-failing` ⇒ `achievedButFailing: []`，贴完整 JSON。
- [x] **AC6 回归守护能取假**：新增/扩展的测试在「把 criterion 的 ref 来源退回裸 `dist-plugin`」时**变红**，
      恢复后变绿；**两个读数都贴**。⛔ 只贴绿不算（恒真断言与「合格」同形）。
- [x] **AC7 amended 复验态已上报**：贴 `goal check --stale-pass` 的原始输出，并明确写出该 AC 的复验
      状态（不是静默沿用旧 verdict）。
- [x] **AC8 既有门不因本次改动转红**：`bash scripts/test.sh --for-task <本任务 id>` exit 0（贴读数）；
      若动了归属棘轮基线，贴重锚前后两个读数。

## Definition of Done

**落地判据是「判据读到了真的那个量」，不是「文件里的字变了」**（DIR-026 Reading A）：

- 生产仓库 `/home/yale/work/quay` 上 **store 自己的 runner** `goal gate AC-272` **exit 0**
  ——这正是 driver 下一轮独立复跑的那个量（AC5），⛔ 不是手工 python 复跑；
- **判据读的是用户实际会装的那一侧**：`refs/remotes/origin/dist-plugin`（marketplace source 的 ref），
  且落地当轮贴出它与 `git ls-remote origin` 的**同值读数**（证明读的不是陈旧副本）；
- **判据仍能取假**：AC3 六臂（四条红臂各带正确 CAUSE、两条绿臂）+ AC6 的「退回旧来源即红」负控制
  ——⛔ 只贴一次 exit 0 不算（硬规则 4：一条结构上不可能取假的量不是测量）；
- **仪器态与合格态可区分**：候选 ref 全缺时仍走 `CAUSE=dist-plugin-branch-absent`（硬规则 3b）；
- **归因门与既有门全绿**：写入门接受 + 归属棘轮计数未增（AC4）+ scoped 门 exit 0（AC8）；
- ⛔ 只改 criterion 文本、只留 fixture/注入证据、或把本地 ref 摆回来喂判据，**都不算落地**。

## Touches

- goals/AC-272-滚动渠道-marketplace-dist-plugin-自证版本-要么带-dev-后缀自证非发布版-要么确实等于同名.md
- plugin/test/ac272-rolling-channel-version-selfproof.test.mjs
- docs/analysis/criterion-failure-attribution.baseline.json
- tasks/gap-ac272-rolling-channel-criterion-reads-unowned-local-ref.md

## 附录：criterion 草稿（已逐臂实跑；执行者须自行重跑 AC3）

```python
python3 - <<'P'
import re, subprocess, sys

def git(*a):
    r = subprocess.run(["git", *a], capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()

# 渠道 = /plugin install 拉的那一侧：marketplace source 是
# {"source":"github","repo":"yaleh/quay","ref":"dist-plugin"} ⇒ origin 的远端分支。
# 按候选表解析（remote-tracking 优先 = 渠道本身；本地分支是副本），⛔ 不现场联网（GOAL-020 §三）。
CHAN = None
for cand in ("refs/remotes/origin/dist-plugin", "refs/heads/dist-plugin"):
    rc, _, _ = git("rev-parse", "--verify", "-q", "%s^{commit}" % cand)
    if rc == 0:
        CHAN = cand; break
if CHAN is None:
    sys.stderr.write("CAUSE=dist-plugin-branch-absent — neither refs/remotes/origin/dist-plugin (the branch the marketplace source yaleh/quay ref=dist-plugin pulls) nor a local refs/heads/dist-plugin resolves in this checkout, so the rolling channel's shipped version cannot be read\n"); sys.exit(1)

ver = None
for path in ("VERSION", "plugin/VERSION"):
    rc, out, _ = git("show", "%s:%s" % (CHAN, path))
    if rc == 0 and out.strip():
        ver = out.strip().splitlines()[0].strip(); break
if not ver:
    sys.stderr.write("CAUSE=dist-plugin-version-unreadable — neither %s:VERSION nor %s:plugin/VERSION holds a version string, so what the rolling channel claims to ship cannot be determined\n" % (CHAN, CHAN)); sys.exit(1)
if ver.endswith("-dev"):
    sys.exit(0)
rc, tagsha, _ = git("rev-parse", "--verify", "-q", "v%s^{commit}" % ver)
if rc != 0 or not tagsha:
    sys.stderr.write("CAUSE=claims-a-version-that-was-never-released — the rolling channel (%s) ships version %r but no tag v%s exists => whatever `/plugin install` pulls advertises a version number with no release behind it\n" % (CHAN, ver, ver)); sys.exit(1)
rc, msg, _ = git("log", "-1", "--format=%s", CHAN)
m = re.search(r"build from ([0-9a-f]{7,40})", msg or "")
if not m:
    sys.stderr.write("CAUSE=build-source-unrecorded — %s's tip subject %r carries no 'build from <sha>' marker, so the commit it was built from cannot be recovered\n" % (CHAN, (msg or "")[:120])); sys.exit(1)
rc, srcsha, _ = git("rev-parse", "--verify", "-q", "%s^{commit}" % m.group(1))
if rc != 0 or not srcsha:
    sys.stderr.write("CAUSE=build-source-unresolvable — %s says it was built from %s but that commit does not resolve in this repository\n" % (CHAN, m.group(1))); sys.exit(1)
if srcsha != tagsha:
    sys.stderr.write("CAUSE=released-version-built-from-a-different-commit — the rolling channel claims released version %s (tag v%s = %s) but was built from %s => the channel advertises a release while shipping something else\n" % (ver, ver, tagsha[:9], srcsha[:9])); sys.exit(1)
sys.exit(0)
P
```

对应六臂实测（本任务当轮在真实仓库 + scratch 仓库跑通，执行者须自行重跑）：

| 臂 | 构造 | 结果 |
|---|---|---|
| ① | 真实仓库（渠道 `0.10.0` = `v0.10.0` 的构建） | exit 0 |
| ② | scratch：`VERSION=0.99.99-dev` | exit 0 |
| ③ | scratch：`VERSION=0.99.99`，无同名 tag | exit 1 `claims-a-version-that-was-never-released` |
| ④ | scratch：有 tag，tip subject 无 `build from` | exit 1 `build-source-unrecorded` |
| ⑤ | scratch：有 tag，`build from` 指向别的提交 | exit 1 `released-version-built-from-a-different-commit` |
| ⑥ | scratch：候选 ref 全删 | exit 1 `dist-plugin-branch-absent` |

⚠️ criterion 只含**裸** `git`（无 `-C`）⇒ 在 scratch 仓库里以该目录为 cwd 即可复现各臂，对生产仓库零破坏。
⚠️ **不改用 `git fetch`/`gh`** 取渠道状态：GOAL-020 §三已裁定 criterion 不现场联网（网络+认证+限流会被
记成违规；总预算 60s）。remote-tracking ref 的新鲜度是**工作区 fetch 的责任**，落地当轮以
`git ls-remote origin refs/heads/dist-plugin` 对照取证（AC5/DoD）。

## Evidence

（2026-09-20，worker，worktree `/home/yale/work/quay-worktrees/gap-ac272-rolling-channel-criterion-reads-unowned-local-ref`；
分支 `task/gap-ac272-rolling-channel-criterion-reads-unowned-local-ref`；goal 写入提交 `c5eb9e5aa`（worktree）；
实现提交 `09188be90`（判据回归测试）+ `721300573`（把候选表读成数据而非子串位置）。）

### AC1 — 取证完整（六条原始输出，与任务体 §一/§二逐条一致）

```
$ node packages/quay/bin/quay.js goal gate AC-272 --dry-run
{"id":"AC-272","verdict":"fail",
 "reason":"acceptance failed (exit 1) — CAUSE=dist-plugin-branch-absent — this checkout has no
  dist-plugin ref, so the rolling channel's shipped version cannot be read (fetch it, or run this
  where the branch exists)",
 "timestamp":"2026-09-20T05:28:57.286Z","dryRun":true, …}
→ exit 1

$ node packages/quay/bin/quay.js goal check --achieved-failing
{"achievedButFailing":["AC-272"],"evaluated":true,"scopeSize":35, …}
→ exit 1     （AC-272 是 35 条在域 AC 里唯一一条 achieved-but-failing）

$ git rev-parse refs/remotes/origin/dist-plugin
f57218052b2f4ee71ef90c24f19048cb49c174b5                       → exit 0

$ git ls-remote origin refs/heads/dist-plugin
f57218052b2f4ee71ef90c24f19048cb49c174b5	refs/heads/dist-plugin  → exit 0

$ git show refs/remotes/origin/dist-plugin:VERSION
0.10.0                                                          → exit 0

$ git log -1 --format=%s refs/remotes/origin/dist-plugin   → dist-plugin: build from 4c81166
$ git rev-parse 4c81166^{commit}   → 4c811663235511625b4b0bf607f27dbf653550cc
$ git rev-parse v0.10.0^{commit}   → 4c811663235511625b4b0bf607f27dbf653550cc   （两臂相等 ⇒ 第二臂成立）
```

六条与任务体 §一/§二**逐字一致**，故继续（未经停）。

### AC2 — criterion 已改，且**只**改了 ref 来源

改写前后的完整 criterion diff（`goal get --store` 的读回值，⛔ 不是文件里的字）：

```diff
 def git(*a):
     r = subprocess.run(["git", *a], capture_output=True, text=True)
     return r.returncode, r.stdout.strip(), r.stderr.strip()
-rc, _, _ = git("rev-parse", "--verify", "-q", "dist-plugin^{commit}")
-if rc != 0:
-    sys.stderr.write("CAUSE=dist-plugin-branch-absent — this checkout has no dist-plugin ref, so the rolling channel's shipped version cannot be read (fetch it, or run this where the branch exists)\n"); sys.exit(1)
+CHAN = None
+for cand in ("refs/remotes/origin/dist-plugin", "refs/heads/dist-plugin"):
+    rc, _, _ = git("rev-parse", "--verify", "-q", "%s^{commit}" % cand)
+    if rc == 0:
+        CHAN = cand; break
+if CHAN is None:
+    sys.stderr.write("CAUSE=dist-plugin-branch-absent — neither refs/remotes/origin/dist-plugin (the branch the marketplace source yaleh/quay ref=dist-plugin pulls) nor a local refs/heads/dist-plugin resolves in this checkout, so the rolling channel's shipped version cannot be read (fetch it, or run this where the branch exists)\n"); sys.exit(1)
 ver = None
 for path in ("VERSION", "plugin/VERSION"):
-    rc, out, _ = git("show", "dist-plugin:%s" % path)
+    rc, out, _ = git("show", "%s:%s" % (CHAN, path))
     if rc == 0 and out.strip():
         ver = out.strip().splitlines()[0].strip(); break
 if not ver:
-    sys.stderr.write("CAUSE=dist-plugin-version-unreadable — neither dist-plugin:VERSION nor dist-plugin:plugin/VERSION holds a version string, so what the marketplace channel claims to ship cannot be determined\n"); sys.exit(1)
+    sys.stderr.write("CAUSE=dist-plugin-version-unreadable — neither %s:VERSION nor %s:plugin/VERSION holds a version string, so what the marketplace channel claims to ship cannot be determined\n" % (CHAN, CHAN)); sys.exit(1)
 if ver.endswith("-dev"):
     sys.exit(0)
 rc, tagsha, _ = git("rev-parse", "--verify", "-q", "v%s^{commit}" % ver)
 if rc != 0 or not tagsha:
-    … ("… — dist-plugin ships version %r …" % (ver, ver)); sys.exit(1)
+    … ("… — %s ships version %r …" % (CHAN, ver, ver)); sys.exit(1)
-rc, msg, _ = git("log", "-1", "--format=%s", "dist-plugin")
+rc, msg, _ = git("log", "-1", "--format=%s", CHAN)
 m = re.search(r"build from ([0-9a-f]{7,40})", msg or "")
 if not m:
-    … ("… — dist-plugin's tip subject %r …" % (msg or "")[:120]); sys.exit(1)
+    … ("… — %s's tip subject %r …" % (CHAN, (msg or "")[:120])); sys.exit(1)
 rc, srcsha, _ = git("rev-parse", "--verify", "-q", "%s^{commit}" % m.group(1))
 if rc != 0 or not srcsha:
-    … ("… — dist-plugin says it was built from %s …" % m.group(1)); sys.exit(1)
+    … ("… — %s says it was built from %s …" % (CHAN, m.group(1))); sys.exit(1)
 if srcsha != tagsha:
-    … ("… — dist-plugin claims released version %s (tag v%s = %s) but was built from %s …" % (ver, ver, tagsha[:9], srcsha[:9])); sys.exit(1)
+    … ("… — %s claims released version %s (tag v%s = %s) but was built from %s …" % (CHAN, ver, ver, tagsha[:9], srcsha[:9])); sys.exit(1)
 sys.exit(0)
```

**逐条**（「一字未动」的四类，逐类点名）：

1. **断言一字未动**：`ver.endswith("-dev")` 分支、`git rev-parse --verify -q "v%s^{commit}" % ver` 取 tag、
   `re.search(r"build from ([0-9a-f]{7,40})", msg or "")` 取构建来源、`if srcsha != tagsha` 的相等判定、
   两个 `if rc != 0 or not ...` 的「解析不出即红」——**逐字相同**。
2. **两臂语义一字未动**：臂 1 = 版本带 `-dev` 后缀（自证非发布版）⇒ `sys.exit(0)`，在任何 tag 解析之前；
   臂 2 = 版本 == 同名 tag 的提交（`tagsha` == `srcsha`）⇒ `sys.exit(0)`。顺序、短路点、判定对象均未动。
3. **CAUSE 词表一字未动**（六个 token 逐字相同）：`dist-plugin-branch-absent` /
   `dist-plugin-version-unreadable` / `claims-a-version-that-was-never-released` /
   `build-source-unrecorded` / `build-source-unresolvable` /
   `released-version-built-from-a-different-commit`。⛔ 一个都没增删改名。
4. **exit 码一字未动**：每个失败出口仍是 `sys.exit(1)`，两个通过出口仍是 `sys.exit(0)`（共 6 个 `sys.exit(1)` +
   2 个 `sys.exit(0)`，与改写前数目相同）。

**唯一的文本增量**（不算在四类里，显式列出以免冒充「完全无差」）：（i）解析块由单 ref 变候选表；
（ii）CAUSE **消息正文**里作为**主语**出现的 `dist-plugin` 换成 `%s`/`CHAN`（消息不再对一个可能是 remote-tracking
的 ref 谎称自己是本地分支）；（iii）`dist-plugin-branch-absent` 的消息改为**枚举两个候选**——它必须改，
因为旧文案断言「本检出没有 dist-plugin ref」，在候选表下已不再为真。这三处都在**消息与解析**层，
**没有一处触及断言/两臂/CAUSE token/exit 码**。

### AC3 — 负控制六臂全跑通（命令 + 原始输出 + exit 码）

复现脚本（`/tmp/ac272-arms.sh`，仅换 cwd，对生产仓库零破坏；criterion 只含裸 `git`、无 `-C`）：

```
$ bash /tmp/ac272-arms.sh /tmp/ac272-criterion.txt \
    /home/yale/work/quay-worktrees/gap-ac272-rolling-channel-criterion-reads-unowned-local-ref

--- arm 1 (cwd=<worktree>) ---                      ← 真实仓库
(no output)
exit=0 (expected 0)

--- arm 2 (cwd=/tmp/ac272-arm-SlZ6vc) ---           ← scratch：VERSION=0.99.99-dev
(no output)
exit=0 (expected 0)

--- arm 3 (cwd=/tmp/ac272-arm-cT0Ubj) ---           ← scratch：VERSION=0.99.99，无同名 tag
CAUSE=claims-a-version-that-was-never-released — refs/remotes/origin/dist-plugin ships version '0.99.99' but no tag v0.99.99 exists => …
exit=1 (expected 1)   ARM 3: OK CAUSE=claims-a-version-that-was-never-released

--- arm 4 (cwd=/tmp/ac272-arm-rYB5Wk) ---           ← scratch：有 tag，tip subject 无 build from
CAUSE=build-source-unrecorded — refs/remotes/origin/dist-plugin's tip subject 'dist-plugin: refresh bundle (no marker)' carries no 'build from <sha>' marker, …
exit=1 (expected 1)   ARM 4: OK CAUSE=build-source-unrecorded

--- arm 5 (cwd=/tmp/ac272-arm-3azYKI) ---           ← scratch：有 tag，build from 指向别的提交
CAUSE=released-version-built-from-a-different-commit — refs/remotes/origin/dist-plugin claims released version 0.99.99 (tag v0.99.99 = 872de50a2) but was built from f1220a7f1 => …
exit=1 (expected 1)   ARM 5: OK CAUSE=released-version-built-from-a-different-commit

--- arm 6 (cwd=/tmp/ac272-arm-ajOdwU) ---           ← scratch：候选 ref 全删（仪器态）
CAUSE=dist-plugin-branch-absent — neither refs/remotes/origin/dist-plugin (the branch the marketplace source yaleh/quay ref=dist-plugin pulls) nor a local refs/heads/dist-plugin resolves in this checkout, …
exit=1 (expected 1)   ARM 6: OK CAUSE=dist-plugin-branch-absent

=== arms failing: 0 ===
```

**六臂全跑通，缺臂 0。** 臂 6 = 仪器态与「合格」**可区分**（硬规则 3b）：候选 ref 全缺时走
`CAUSE=dist-plugin-branch-absent` 而不是静默通过或与渠道违规同形。两条绿臂（① 真实仓库、② `-dev`）
与四条红臂（③④⑤ 三个真违规 CAUSE + ⑥ 一个仪器态 CAUSE）各自独立取到预期取值 —— 判据**不是恒真**。

### AC4 — 写入门读数 + 归属棘轮计数

```
$ … goal write AC-272 --criterion "<改写后全文>" --actor cli:ac272-worker --reason "…" --dry-run
（打印改写后的完整记录，criterion 逐字回显）⇒ exit 0        ← 写入门【接受】

$ … goal write AC-272 --criterion "<同上>" --actor cli:ac272-worker --reason "…"
→ 提交 "goals: AC-272 field:criterion by cli:3066609"       ⇒ exit 0

归属棘轮（写前 / 写后，同一条命令）：
$ node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts --root /home/yale/work/quay --json
写前：{"inDomain":155,"bareAcs":0,"bareLines":0,"ids":[],"baseline":0,"delta":0,"fixed":[],"status":"pass","ok":true,…}
写后：{"inDomain":155,"bareAcs":0,"bareLines":0,"ids":[],"baseline":0,"delta":0,"fixed":[],"status":"pass","ok":true,…}
⇒ exit 0 / 0，**计数未增（0 → 0）**，`docs/analysis/criterion-failure-attribution.baseline.json`
未改动（仍是 `{"count":0,"inDomain":108,…}`）⇒ 无需重锚，也**没有靠放宽检测器过关**。
```

### AC5 — store runner 转绿（生产仓库 `/home/yale/work/quay`）

```
$ node packages/quay/bin/quay.js goal gate AC-272          ← ⛔ 非 --dry-run
{"id":"AC-272","verdict":"pass","reason":"acceptance passed (exit 0)",
 "timestamp":"2026-09-20T05:45:52.732Z","dryRun":false,
 "event":{"id":"1e355dcd-80a2-4376-a8be-21388ce73e79","item_id":"AC-272","pipeline_id":"AC-272",
          "gate":"goal","actor":"goal-cli","verdict":"pass",
          "timestamp":"2026-09-20T05:45:52.732Z","payload":{"reason":"acceptance passed (exit 0)"}}}
→ exit 0

$ node packages/quay/bin/quay.js goal check --achieved-failing
{"achievedButFailing":[],"evaluated":true,"scopeSize":35,"inScope":["AC-161","AC-188","AC-189","AC-190",
 "AC-202","AC-203","AC-204","AC-206","AC-214","AC-217","AC-233","AC-235","AC-236","AC-237","AC-241",
 "AC-242","AC-243","AC-244","AC-247","AC-248","AC-249","AC-250","AC-265","AC-269","AC-270","AC-271",
 "AC-272","AC-279","AC-280","AC-282","AC-307","AC-308","AC-309","AC-310","AC-311"]}
→ exit 0     （改写前同一条命令是 ["AC-272"] / exit 1）
```

**新鲜度对照**（DoD：证明读的不是陈旧副本）：

```
$ git rev-parse refs/remotes/origin/dist-plugin   → f57218052b2f4ee71ef90c24f19048cb49c174b5
$ git ls-remote origin refs/heads/dist-plugin     → f57218052b2f4ee71ef90c24f19048cb49c174b5   （逐字相同）
```

⛔ **一处必须讲清楚的落地形态**（否则「生产仓库上 exit 0」会与下述读数矛盾）：`goal gate` 的 runner 在
**criterion 所在的 checkout** 上跑。worktree `--root <wt>` 上现在是 pass；而 `/home/yale/work/quay`（主检出，
分支 `author`）**在本次落地前仍持旧 criterion**，只有把改写也写到它那儿才可能 exit 0。故本任务**两处都写了**、
**内容逐字相同**（同一写面、同一 `--criterion`）：

- worktree 提交 `c5eb9e5aa` —— 本任务的声明 delta，随 fan-in 确定性落到 develop（Touches 声明的就是它）；
- 主检出提交 `275cfb57a`（分支 `author`）—— 使**生产读数当场可取**；develop 靠既有 doc→develop 同步收敛
  （实测：写后 `git -C <wt> rev-parse develop` = `275cfb57af5e3f8bc168c2f2b22b27fdadf18825`，**该提交已在 develop 上**）。

两处内容相同 ⇒ 任一合并顺序都不产生冲突（fan-in 的 `git merge develop` 实测 exit 0）。
⛔ **为什么不能只在 worktree 读 AC5 的第二条**：`check --achieved-failing` 的判据**不是 hermetic 的**——
在域 AC 里有一批以 `os.path.realpath(".")` / `socket.gethostname()` 为键、并读 `.quay/<carrier>.jsonl`
（gitignored、且不在 `.worktreeinclude` 声明里）。实测在 worktree 上同一条命令返回 **14 条**额外
achieved-but-failing，例如：

```
$ node packages/quay/bin/quay.js goal gate AC-203 --root <wt>
{"id":"AC-203","verdict":"fail","reason":"acceptance failed (exit 3) — NOT-EVALUATED: carrier absent", …}
$ ls <wt>/.quay/productization-verification.jsonl   → No such file or directory
$ ls /home/yale/work/quay/.quay/productization-verification.jsonl → 129083 bytes
```

⇒ 那 14 条是**worktree 环境**的产物，不是本改动造成的；生产仓库上它们是绿的（`achievedButFailing` 从
`["AC-272"]` 变成 `[]`，说明唯一那条真红被消掉、且没有引入新的）。这也是 DoD 点名「生产仓库
`/home/yale/work/quay`」的原因。

### AC6 — 回归守护能取假（两个读数都贴）

新增 `plugin/test/ac272-rolling-channel-version-selfproof.test.mjs`（`@test-group engine`）。它读
**store 里的 criterion 原文**（`createGoalStore(...).get("AC-272").criterion`，⛔ 不是本文件里的副本），
用 `runAcceptance`（**`quay goal gate` 调的就是这个 runner**）在 `os.tmpdir()` 下的一次性 scratch 仓库里跑；
那些仓库里渠道**只以 `refs/remotes/origin/dist-plugin` 存在**（生产形态）——这正是负控制的取假面。

**读数 1/2（红）** —— 把 criterion 的 ref 来源退回裸 `dist-plugin`（经**同一写面** `goal write`，非手改文件）：

```
$ node --test --test-reporter=tap plugin/test/ac272-rolling-channel-version-selfproof.test.mjs
not ok 1 - AC-272 resolves the channel from refs/remotes/origin/dist-plugin before the local branch
not ok 2 - AC-272 arm 1: green when the channel is the remote-tracking ref and equals the tagged build
not ok 3 - AC-272 arm 2: green on the -dev suffix arm without any tag
not ok 4 - AC-272 arm 3: red with claims-a-version-that-was-never-released
not ok 5 - AC-272 arm 4: red with build-source-unrecorded
not ok 6 - AC-272 arm 5: red with released-version-built-from-a-different-commit
not ok 9 - AC-272 reversion control: reverting the ref source to bare `dist-plugin` turns arm 1 red
         error: "the reversion mutation did not apply — AC-272's candidate list is no longer the two-entry tuple this control edits"
ℹ tests 9   ℹ pass 2   ℹ fail 7
→ exit 1
```

**读数 2/2（绿）** —— 把改写写回后：

```
$ node --test plugin/test/ac272-rolling-channel-version-selfproof.test.mjs
✔ AC-272 resolves the channel from refs/remotes/origin/dist-plugin before the local branch
✔ AC-272 arm 1: green when the channel is the remote-tracking ref and equals the tagged build
✔ AC-272 arm 2: green on the -dev suffix arm without any tag
✔ AC-272 arm 3: red with claims-a-version-that-was-never-released
✔ AC-272 arm 4: red with build-source-unrecorded
✔ AC-272 arm 5: red with released-version-built-from-a-different-commit
✔ AC-272 arm 6: red with dist-plugin-branch-absent when no candidate ref resolves
✔ AC-272: the local branch is still an accepted channel (the second candidate entry is live)
✔ AC-272 reversion control: reverting the ref source to bare `dist-plugin` turns arm 1 red
ℹ tests 9   ℹ pass 9   ℹ fail 0
→ exit 0        （回写后 store 里的 criterion 与改写版逐字节相同：true）
```

⚠️ 一处**自纠**（记录在案，因为它正是本条要防的失败形态）：第一版的位置断言写成
`indexOf(refs/remotes/origin/dist-plugin) < indexOf(refs/heads/dist-plugin)` 扫**整段 criterion**。
实测在 red 读数里它**仍然变绿**——因为 `dist-plugin-branch-absent` 的**消息正文**也同时点名两个 ref，
位置比较被消息满足（5 条臂红、这条断言绿）。⇒ 改为把 `for cand in (...)` 的候选**表当数据取出**再断言
条目与顺序（`candidateList()`）。修正后的 red 读数里这条断言**变红**（见读数 1/2 的 `not ok 1`）。

### AC7 — amended 复验态已上报（⛔ 不是静默沿用旧 verdict）

```
$ node packages/quay/bin/quay.js goal check --stale-pass
{"frozenScope":119,"evaluated":true,"failing":[],
 "staleUnverified":["AC-150","AC-151","AC-152","AC-153","AC-154","AC-155"],
 "notEvaluated":[],
 "verifiedFresh":["AC-143", … ,"AC-306"],
 "amendedUnverified":[],
 "neverGated":[],
 "rotation":{"sweptEver":119,"lastSweepAt":"2026-09-20T05:11:52.407Z","minAgeMs":3600000,"maxAgeMs":14400000}}
→ exit 0
```

**该 AC 的复验状态，明写**：

- **`amendedUnverified` 里没有 AC-272，且这不是「已复验」的意思**——它是**结构性**的：
  `checkStalePass` 只在 `frozenAchievedAcs()` 上判，而该集合由**同一个** scope 谓词排除
  `inAchievedReverifyScope(ac, activeGoalIds)`（`goal-store.ts:1241` = `activeGoalIds.has(goal) || longTerm === true`）。
  AC-272 的 `long-term: true` ⇒ **它根本不进 frozen 人口**（实测：它也**不在** `verifiedFresh` /
  `staleUnverified` / `neverGated` 任何一个桶里，`frozenScope=119` 中无它）⇒ `--stale-pass`
  **在任何情况下都不会**载它。任务体 §Requested action 7 预期的「`amendedUnverified` 一类的改过待复验」
  对 AC-272 **取不到**；如实记录，⛔ 不把这一空桶读成「已复验」。
- **它的复验走的是 I5 热环**（`inScope` 35 条，AC-272 在列）：`goal gate AC-272` 由 driver **每轮**复跑。
  该复跑**发生在改写之后**（写入事件 05:34:24Z / `gate` 事件 05:34:32Z、05:36:42Z、05:45:52Z —— 全部晚于改写），
  故当前 `verdict=pass` 是**对改写后文本的新判定**，⛔ 不是沿用改写前的旧 `verdict=pass`。
  这与 AC5 的 `achievedButFailing: []`（同一判据面、改写前为 `["AC-272"]`）互为印证。
- **`status` 未被人手改**：AC-272 仍是 `achieved`，其 `statusLog` 只有 2026-09-15 由 `goal-driver` 写的
  那一条 `I2: criterion pass`；本次两次 criterion 写入（`c5eb9e5aa` / `275cfb57a`）**没有产生任何 status 变更记录**
  —— 即没有「无路径可翻回」的越权翻转。

### AC8 — 既有门不因本次改动转红

```
$ bash <worktree>/scripts/test.sh --for-task gap-ac272-rolling-channel-criterion-reads-unowned-local-ref --allow-thin
…  + plugin/test/ac272-rolling-channel-version-selfproof.test.mjs
…  PASS: no checked-in-tree writes: 35 write-verb call(s) across 1 executed input(s), 0 inside the tree
…  ✔ AC-272 … ×9   ℹ tests 9  ℹ pass 9  ℹ fail 0
→ exit 0
```

归属棘轮基线**未动**（见 AC4 的两个读数：0 → 0；`baseline.json` 逐字未改），故无重锚前后读数可贴。

### 明确不做（逐条写为什么）

1. **不改渠道内容**——渠道此刻是对的，无需重发 `publish-plugin-dist.yml`。证据：`git rev-parse
   refs/remotes/origin/dist-plugin` = `f57218052b2f4ee71ef90c24f19048cb49c174b5` 与 `git ls-remote origin
   refs/heads/dist-plugin` 逐字相同（非陈旧），`:VERSION` = `0.10.0` = tag `v0.10.0` 的构建；
   `.github/workflows/publish-plugin-dist.yml` 末次提交 `d097f48c7`（09-14）、
   `plugin/scripts/publish-dist-branch.sh` 末次提交 `cc7c4039d`（09-15），本任务**一个字节都没碰**。
2. **不把本地 `dist-plugin` ref 摆回去**（任务体 §四：那是同一次已证失败的修法，且它在与发布机制对赌、
   除判据外没有第二个消费者）。**负控制**：本次操作后 `git rev-parse --verify -q dist-plugin^{commit}`
   ⇒ **exit 1（仍不存在）**，`git branch -a` 里也没有本地 `dist-plugin`（只有 `remotes/origin/…` 与另一台
   主机的 `remotes/vhs/…`）——即判据现在读的是 origin 侧、而本地 ref 依旧**无主**。
3. **不为 AC-272 另写恒等检查器**（判据本身就是那个检查器，由 goal gate 按轮复跑；另写一份只会制造
   一处要同步维护的副本）。新测试**不重实现**判据——它把 store 里的判据**原文**取出来、用 gate 自己的
   runner 跑它。三条可复核读数（在 worktree 上）：

   ```
   # (a) 判据的判定逻辑在代码里有没有第二份？（找它独有的正则）
   $ grep -rn 'build from (\[0-9a-f\]' --include='*.mjs' --include='*.ts' --include='*.js' --include='*.sh' .
   (no hits — 该正则全仓只存在于 goals/AC-272-*.md 里)
   # (b) 测试是内嵌判据还是从 store 读？
   $ grep -c 'createGoalStore'            plugin/test/ac272-rolling-channel-version-selfproof.test.mjs → 2
   $ grep -c "python3 - <<'P'"            plugin/test/ac272-rolling-channel-version-selfproof.test.mjs → 0
   # (c) 测试里出现 CAUSE token 的两处都只是对 runner 输出的断言，不是判定逻辑
   $ grep -n 'claims-a-version-that-was-never-released' plugin/test/ac272-…selfproof.test.mjs
   211:test("AC-272 arm 3: red with claims-a-version-that-was-never-released", () => {
   218:  assert.match(r.reason, /CAUSE=claims-a-version-that-was-never-released/);
   ```

   注：(c) 的两处是**测试名**与**对 `runAcceptance` 返回的 `reason` 的正则断言**——判据自己产出该 token，
   测试只核它出现，⛔ 不是第二份判定实现。测试里唯一与判据文本有关的字符串是**负控制要编辑的那段元组**
   （`for cand in (...)`，见 `revertToBareLocalRef` 与 `candidateList`）——那是**钉住来源**所必需的，
   而且它的失效方式是**响亮失败**（`assert.notEqual` ⇒ red 读数里的
   "the reversion mutation did not apply"），不是静默通过。
