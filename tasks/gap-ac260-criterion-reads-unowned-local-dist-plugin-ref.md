---
id: gap-ac260-criterion-reads-unowned-local-dist-plugin-ref
title: AC-260 恒假的仪器失败：criterion 读【无主】本地 dist-plugin ref（发布脚本每次 branch -D
  删它），而交付面本身是对的 ⇒ 改读渠道 ref（refs/remotes/origin/dist-plugin 优先）并扫掉兄弟实例 AC-261
status: done
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-260
---
**type:** execution

## Finding

### 一、AC-260 当前实测 FAIL —— 三条独立读数

**读数 1｜store 自己的 runner（= driver 下一轮复跑的同一入口）**

```
$ node packages/quay/bin/quay.js goal gate AC-260 --dry-run
{"id":"AC-260","verdict":"fail",
 "reason":"acceptance failed (exit 1) — AC-260: cannot read branch dist-plugin (Command
  '['git', 'ls-tree', '-r', '--name-only', 'dist-plugin']' returned non-zero exit status 128.)
  => the marketplace delivery face is absent, so this AC has never been exercised", …}
→ exit 1
```

**读数 2｜机制自己的常设失效清单（AC-242 的 frozen population）**

```
$ node packages/quay/bin/quay.js goal check --stale-pass
{"frozenScope":119,"evaluated":true,
 "failing":["AC-260","AC-261"],
 "staleUnverified":[38 条],"notEvaluated":[],"verifiedFresh":[79 条],
 "amendedUnverified":[],"neverGated":[], …}
→ exit 1     （failing 恰是 AC-260 与 AC-261 两条）
```

⚠️ 读数 2 **同时是兄弟实例的直接证据**：同一次读数里 `AC-261` 与 `AC-260` 并列 ⇒ 本任务必须一并处置
（硬规则 5b），⛔ 不是"顺带提一句"。

**读数 3｜失败原因按 AC 自己的词表属【仪器失败】，不是交付面违规**

`git ls-tree -r --name-only dist-plugin` 的 rc=128（该 ref 不存在），而 AC 原文把"分支不可读"写作
"交付面缺失 ⇒ 本 AC 从未被行使"。⇒ 这是一条**结构上恒假**的常驻判据在每轮生成假红。

### 二、根因：criterion 读的是一个【无主】的本地 ref（观察器缺陷，不是交付面违规）

判据的解析步骤是裸 ref。git 的 ref dwim 顺序是 `refs/<name>` → `refs/tags/<name>` → `refs/heads/<name>`
→ `refs/remotes/<name>`，**不含 `refs/remotes/origin/<name>`** ⇒ 裸 `dist-plugin` 只可能命中本地分支，
而本检出它不存在：

```
$ git rev-parse --verify -q refs/heads/dist-plugin^{commit}   → 非 0（ABSENT）
$ git branch -a | grep -i dist
  implement-dist-plugin-fix                                   ← 无关
  remotes/origin/dist-plugin                                  ← 渠道（在）
  remotes/vhs/dist-plugin …                                   ← 另一台主机，非本渠道
```

**它没有主人 —— 这是机制决定的，不是偶发**（与已裁定的 AC-272 同类，见 §三）：

- `plugin/scripts/publish-dist-branch.sh` **每次发布先删**本地 ref：`git branch -D "$BRANCH"`
  （注释自述：为让 `checkout --orphan` 能复用该名）；
- orphan 是在一个**一次性 worktree** 里建并提交的，`cleanup()` = `git worktree remove --force`
  ⇒ 发布**从不留下**一个持久的本地 ref；
- 发布本体在 GitHub Actions runner 上跑（`publish-plugin-dist.yml` → `--push`），CI 上删的是 runner 的克隆。

**而交付面本身此刻是对的**（⇒ 失败不来自交付面）：

```
$ git rev-parse refs/remotes/origin/dist-plugin          → f57218052b2f4ee71ef90c24f19048cb49c174b5
$ git ls-remote origin refs/heads/dist-plugin            → f57218052b2f4ee71ef90c24f19048cb49c174b5
                                                            （逐字相同 ⇒ 不是陈旧副本）
$ git ls-tree -r --name-only origin/dist-plugin | wc -l  → 348
```

按 AC-260 自己的三支谓词，**只把 ref 换成渠道那一侧、其余逐字不动**：

| 支 | 读数 |
|---|---|
| 总 `scripts\|gate-scripts/dist/*.js` 引用数（零计数守卫） | **175**（≥1 ⇒ 谓词确实命得中） |
| 带 cwd 相对 `plugin/` 前缀的 | **0** |
| `plugin` 根锚定且指向已被 strip 步删除的 raw `.ts` | **0** |

⇒ **交付面合格**；判据原文 exit 1 的唯一来源是 ref 解析。

**对照取证（只换 ref 表达式，判据其余逐字不动）**：换成候选表后同一判据 **exit 0**；退回裸 ref
**exit 1**（= 读数 1）。⇒ 这是被检验的结论，不是可解释的说法（硬规则 4 推论四）。

### 三、为什么上一次的修法没有守住（两件事，各自独立）

**1｜AC-260 自己的落地任务修的是【被判据读的那个面】，不是【判据读它的方式】。**
`gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths`（done，`goal_ac: AC-260`）把重写器
`build-plugin-dist.mjs` 修对了——交付面因此**真的**干净（§二读数）——但它一个字节都没碰 criterion 的
ref 来源。⇒ 交付面转绿、判据仍恒假。

**2｜同类修法已在同级 AC 上做过一次，但它的清扫范围把 `goals/` 漏掉了。**
`gap-ac272-rolling-channel-criterion-reads-unowned-local-ref`（done，2026-09-20）把 AC-272 的 criterion
改成候选表、并留了取假回归测试——**这正是本任务要复制的形状**。但它的 §二 逐字写的是：

> 全仓 grep：判据是本地 `dist-plugin` ref 的唯一读者——`show dist-plugin:` / `rev-parse … dist-plugin`
> 在 `plugin/` `scripts/` `packages/` `.github/` 下零命中（除判据自身）

—— **`goals/` 不在那份清单里，而判据恰恰住在 `goals/`**。⇒ 硬规则 5b 的教科书漏项：修的人只盯着被报
出来的那一个，兄弟实例在**同一载体**（`goals/*.md`）里原样存活。

### 四、规则 5b 清扫读数（全部 194 条 goal 记录的 criterion）

```
criteria referencing bare dist-plugin: 3
   AC-260 bare_occurrences=1   ('BR = "dist-plugin"')
   AC-261 bare_occurrences=3   (ls-tree 的 ref + 两处消息正文)
   AC-272 bare_occurrences=6   ← 假阳性：是已修的候选表 refs/heads/dist-plugin + 消息正文（对照物，不是缺陷）
```

⇒ **真实待修实例 = 2 条（AC-260、AC-261）**，另有 1 条已修对照（AC-272）。
⇒ ⛔ 只修 AC-260 会让 `check --stale-pass` 的 `failing` 从两条变一条，而不是清零 ⇒ 本任务必须同轮处置 AC-261。

### 五、为什么不把本地 ref 摆回去（⛔ 显式决策，不静默）

1. 用户装的是 **origin 侧**：marketplace source = `{"source":"github","repo":"yaleh/quay","ref":"dist-plugin"}`。
   本地 ref 只是副本，会与 origin 分叉 ⇒ 它既能产生【假红】（本次），也能产生【假绿】。
2. 发布机制**按设计删除**它（§二）⇒ 任何"摆回来"的做法都在与机制对赌。
3. 全仓只有判据读它 ⇒ 摆回来除了喂判据之外**没有第二个消费者**。
4. `gap-ac272-…` 已就同一决策写过裁定（其 §四），并记录过一次**已证失败**的同类修法
   （`gap-develop-version-union-missing-dev-suffix` 用 `git update-ref` 把本地 ref 摆成对的，该 ref 后来没存活）
   ⇒ 不重复第二次。

## Requested action

1. **取证先行**（任一与本文读数不符 ⇒ 停并报告，⛔ 不代做别的任务）：贴 `goal gate AC-260 --dry-run`、
   `goal check --stale-pass`、`git rev-parse --verify -q refs/heads/dist-plugin^{commit}`（预期非 0）、
   `git rev-parse refs/remotes/origin/dist-plugin` 与 `git ls-remote origin refs/heads/dist-plugin`（预期同值）、
   以及 §二 三支谓词在**渠道 ref** 上的三个计数（175／0／0）。

2. **改 AC-260 与 AC-261 的 criterion：只改 ref 来源，不放宽任何断言。** 走 **goal store 的写面**
   （`node packages/quay/bin/quay.js goal write <id> --criterion <全文> --actor <who> --reason <why>`），
   ⛔ **不手改 `goals/*.md`**。⛔ 该 verb 的旗标**以 verb 自身为准**（`quay goal write --help`），
   ⛔ 不照抄本任务体。
   改法：ref 解析改为**候选表、remote-tracking 优先** ——
   `refs/remotes/origin/dist-plugin`（那才是渠道）→ `refs/heads/dist-plugin`（本地副本）；
   解析出的 `CHAN`/`BR` 供后续每一步使用。
   ⛔ **断言、三支语义、零计数守卫、exit 码一字不改**（只换"从哪里读"）。
   ⛔ AC-261 另有一处必须同步：它把 `dist-plugin` 写进了 `expect`/消息正文，改成 `%s`/`CHAN`
   （消息不得对一个可能是 remote-tracking 的 ref 谎称自己是本地分支）。AC-261 的**其余四臂**
   （工作树 `plugin/bin/quay` 存在且可执行、branch 上 mode 100755、最小 PATH 下 `quay --version` 出 semver、
   `command -v quay` 解析到该 shim）**一字不改**。

3. **负控制：两条判据都必须仍能取假（硬规则 4 / 3b）。** 逐臂跑出并贴原始输出 —— 至少四臂：
   ① 渠道候选可解析且交付面干净 ⇒ exit 0；② 退回裸 ref ⇒ exit 1（恒假已消除的对照）；
   ③ 候选 ref 全删 ⇒ exit 1 且原因**可区分**（仪器态，不得与"合格"同形）；
   ④ 在候选面上人为构造一个 cwd 相对 `plugin/` 前缀引用 ⇒ exit 1 且打出计数与前 3 条命中。
   ⛔ **只贴一次 exit 0 不算**（恒绿判据与"合格"同形）。criterion 只含裸 `git`（无 `-C`）⇒ 在
   `mktemp -d` 的 scratch 仓库里以该目录为 cwd 跑同一脚本即可，**对生产仓库零破坏**。

4. **过写入门**：贴写面读数（接受原文，或拒绝逐字 + 处置）。⚠️ 本文作者已**实测**：按 §2 改法构造的
   AC-260 criterion 经 `goal write AC-260 --criterion <改写全文> --actor … --reason … --dry-run`
   **rc=0 被接受**，且改写后 criterion 直接执行 **exit 0**；AC-261 同改动后 **exit 0**。
   执行者须**自己重跑**，⛔ 不转抄本文读数。

5. **落地后用 store 自己的 runner 复跑**（⛔ 手工 python 复跑不算，driver 复跑的是前者）：
   `goal gate AC-260` ⇒ exit 0；`goal gate AC-261` ⇒ exit 0；
   `goal check --stale-pass` ⇒ `failing: []` ∧ exit 0（贴完整 JSON）。
   ⚠️ `goal gate` 的 runner 在 **criterion 所在的 checkout** 上跑 ⇒ 要让生产读数（主检出 `author`）当场可取，
   **主检出那份也必须写**（`gap-ac272-…` 的 Evidence 记录过同一结构性要求）；两处内容须**逐字相同**以免 merge 冲突。

6. **回归守护：把候选表来源落成套件里的一条测试**（新文件，或并入
   `plugin/test/ac272-rolling-channel-version-selfproof.test.mjs` 已在的机制——⛔ 不复制第二份恒等检查器；
   该文件已有 `candidateList` / `revertToBareLocalRef` / `runCriterion` 等可复用件）。
   判据是「**退回读裸 `dist-plugin` 会红**」——即这条测试真的在钉住 ref 来源，不是恒真。
   ⛔ 新测试文件按 `scripts/test.sh` **头注释的注解契约**标注（正本在读脚本，⛔ 不照抄本任务体）。

7. **报告 amended 复验态**：改写后贴 `goal check --stale-pass`，并**明写** AC-260/AC-261 落在哪个桶
   （`amendedUnverified` / `staleUnverified` / `verifiedFresh` / `failing`）。⚠️ 两条都是 `long-term: false`
   且 goal `GOAL-019` 已 achieved ⇒ 它们**在** frozen 人口内（实测 `frozenScope:119`、
   `failing:["AC-260","AC-261"]`），与 AC-272（`long-term: true`，结构上进不了 frozen）**不同** ⇒
   本条的桶读数必须**取真实值**，⛔ 不得照抄 AC-272 的"取不到"结论。
   ⛔ 也不得手改 AC 的 `status`（`achieved` 由机制写，无路径可翻回）。

8. **⛔ 明确不做**（不静默略过，逐条写一句为什么）：① 不改交付面内容（交付面此刻是对的，无需重发
   `publish-plugin-dist.yml`）；② 不把本地 `dist-plugin` ref 摆回来（§五）；③ 不为 AC-260/261 另写恒等检查器。

9. **门**：`bash scripts/test.sh --for-task <本任务 id>` exit 0；若触发 criterion 归属棘轮计数变化
   （**预期不变**：两条 criterion 的失败出口都在同一行写 stderr，裸退出计数仍为 0），按
   `criterion-failure-attribution-check.ts` 自述的 `--capture` 重锚
   `docs/analysis/criterion-failure-attribution.baseline.json`，⛔ 不得靠放宽检测器过关。

## Acceptance Criteria

- [x] **AC1 取证完整**：§Requested action 1 的全部原始输出已贴，且与本文 §一/§二读数一致（不一致 ⇒ 停并报告）。
- [x] **AC2 两条 criterion 已改且只改了 ref 来源**：贴 AC-260 与 AC-261 改写**前后**的完整文本（diff 形态），
      并逐条指出「断言 / 三支语义 / 零计数守卫 / exit 码一字未动」。⛔ 只贴改写后不算。
- [x] **AC3 负控制四臂全跑通**（每臂贴命令 + 原始输出 + exit 码）：① 渠道候选 ⇒ exit 0；② 退回裸 ref ⇒ exit 1；
      ③ 候选全删 ⇒ exit 1 ∧ 仪器态原因可区分（硬规则 3b）；④ 候选面上人为植入 cwd 相对前缀 ⇒ exit 1 ∧
      打出计数与前 3 条命中。⛔ 缺臂即未完成。
- [x] **AC4 写入门读数**：两条 criterion 均经 goal store 写面接受（或拒绝原文逐字落痕 + 处置），且
      `criterion-failure-attribution-check.ts` 计数未增（贴前后计数）。
- [x] **AC5 store runner 转绿**：`goal gate AC-260` 与 `goal gate AC-261` ⇒ exit 0（各贴完整 JSON）；
      `goal check --stale-pass` ⇒ `failing: []` ∧ exit 0（贴完整 JSON）。
- [x] **AC6 回归守护能取假**：新增/扩展的测试在「把 ref 来源退回裸 `dist-plugin`」时**变红**，恢复后变绿；
      **两个读数都贴**。⛔ 只贴绿不算（恒真断言与"合格"同形）。
- [x] **AC7 amended 复验态已上报**：贴 `goal check --stale-pass` 原始输出，并明写 AC-260/AC-261 落在哪个桶
      （取真实值，⛔ 不照抄 AC-272 的结论）。
- [x] **AC8 既有门不因本次改动转红**：`bash scripts/test.sh --for-task <本任务 id>` exit 0（贴读数）；
      若动了归属棘轮基线，贴重锚前后两个读数。

## Definition of Done

**落地判据是「判据读到了真的那个量」，不是「文件里的字变了」**（DIR-026 Reading A）：

- 生产仓库 `/home/yale/work/quay` 上 **store 自己的 runner** 对 **AC-260 与 AC-261 都** exit 0
  —— 这正是 driver 下一轮独立复跑的那个量（AC5），⛔ 不是手工 python 复跑；
- **反过来的读数也成立**：`goal check --stale-pass` 的 `failing` 从 `["AC-260","AC-261"]` 变成 `[]`
  （同一条命令、同一个 frozen 人口）；
- **判据读的是用户实际会装的那一侧**：`refs/remotes/origin/dist-plugin`，且落地当轮贴出它与
  `git ls-remote origin` 的**同值读数**（证明读的不是陈旧副本）；
- **判据仍能取假**：AC3 四臂 + AC6 的「退回旧来源即红」负控制 —— ⛔ 只贴一次 exit 0 不算（硬规则 4）；
- **仪器态与合格态可区分**：候选 ref 全缺时仍给出独立的仪器态原因（硬规则 3b）；
- **兄弟实例已清零**：AC-261 与 AC-260 同轮处置（§四清扫读数支撑），⛔ 不是"下一轮再说"；
- ⛔ 只改 criterion 文本、只留 fixture/注入证据、或把本地 ref 摆回来喂判据，**都不算落地**。

## Touches

- goals/AC-260-缺口a-dist-plugin-交付面上带-cwd-相对-plugin-前缀的-dist-引用归零-基线-96-96-全.md
- goals/AC-261-缺口c-plugin-bin-quay-shim-让-cli-免-npm-上-path-path-已含该目录而目录不存在.md
- plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs
- docs/analysis/criterion-failure-attribution.baseline.json
- tasks/gap-ac260-criterion-reads-unowned-local-dist-plugin-ref.md

## Evidence

**AC1 取证完整**（全部在 `/home/yale/work/quay` 主检出上取）：

```
$ node packages/quay/bin/quay.js goal gate AC-260 --dry-run   → verdict=fail rc=1
  reason: "cannot read branch dist-plugin (Command '['git','ls-tree','-r','--name-only','dist-plugin']' returned non-zero exit status 128.) => the marketplace delivery face is absent, …"
$ node packages/quay/bin/quay.js goal check --stale-pass      → rc=1
  {"frozenScope":119,"evaluated":true,"failing":["AC-260","AC-261"], …}
$ git rev-parse --verify -q refs/heads/dist-plugin^{commit}   → rc=1（ABSENT）
$ git rev-parse refs/remotes/origin/dist-plugin
  = git ls-remote origin refs/heads/dist-plugin = f57218052b2f4ee71ef90c24f19048cb49c174b5（逐字同值）
渠道 ref 上三支谓词：carriers=348 total=175 bad=0 dangling=0   （= §二 的 175／0／0）
```
⇒ 与 §一/§二逐条一致，未触发停并报告。

**AC2 只改 ref 来源**：改动的物理行 = AC-260 的 `BR = "dist-plugin"` 一行（换成候选表解析 + 仪器态分支）
与 AC-261 的 `ls-tree` ref / 其 except 消息 / `expect` 里的 `随 dist-plugin` 短语。断言、三支语义、
零计数守卫、`sys.exit` 码一字未动 —— `fileset = set(files)` 以下直到 `sys.exit(0)` 与改写前**逐字节相同**
（`diff -u` 只显示 ref 解析与两条消息行）。

**AC3 负控制 10 臂全跑通**（`/tmp/ac260-probe/arms.mjs`；criterion 只含裸 `git`，全部在 `mktemp -d`
scratch 仓库里以该目录为 cwd 跑，对生产仓库零破坏）：

| 臂 | 读数 |
|---|---|
| AC-260 ① 渠道候选（仅 remote-tracking）+ 载体干净 | exit 0 |
| AC-260 ②a 退回**原文**裸 ref 判据 | exit 1（`cannot read branch dist-plugin`） |
| AC-260 ②b 把候选表改回裸 `("dist-plugin",)` | exit 1 |
| AC-260 ③ 候选 ref 全删 | exit 1 ∧ `INSTRUMENT STATE … the face has NOT been judged`（可区分） |
| AC-260 ④ 载体植入 `plugin/scripts/dist/*.js` | exit 1 ∧ `2 of 2 dist references … first 3: [('SKILL.md','plugin/scripts/dist/foo.js'), …]` |
| AC-260 ⑤ 渠道只在 `refs/heads/dist-plugin` | exit 0（第二候选活着） |
| AC-261 ① shim + 渠道候选 + `bin/quay` 100755 | exit 0 |
| AC-261 ②a 退回**原文**裸 ref 判据 | exit 1 |
| AC-261 ②b 候选表改回裸 | exit 1 |
| AC-261 ③ 候选 ref 全删 | exit 1 ∧ `INSTRUMENT STATE … NOT been evaluated`（可区分） |

⇒ 10/10 与预期一致（含仪器态与交付面违规**可区分**，硬规则 3b）。

**AC4 写入门**：

```
$ quay goal write AC-260 --criterion <改写全文> --actor worker:… --reason … --dry-run   → rc=0（被接受）
$ quay goal write AC-261 --criterion <改写全文> --actor worker:… --reason … --expect … --dry-run → rc=0
$ quay goal write AC-260 …  /  AC-261 …   （去 --dry-run）                              → rc=0（落盘 + 提交）
```
criterion 经写面往返**逐字节相同**（`rec.criterion === 改写文本`）。归属棘轮 BEFORE/AFTER 均为
`PASS: … inDomain=155 bareAcs=0 ≤ baseline 0 (bareLines=0)` ⇒ **计数未增，基线未动**。

**AC5 store runner 转绿**（主检出，⛔ 非手工 python）：

```
$ quay goal gate AC-260        → {"verdict":"pass","reason":"acceptance passed (exit 0)"} rc=0
$ quay goal gate AC-261        → {"verdict":"pass","reason":"acceptance passed (exit 0)"} rc=0
$ quay goal check --stale-pass → {"frozenScope":119,"evaluated":true,"failing":[], …} rc=0
```
主检出与 worktree 两份 `goals/AC-26*.md` md5 **逐字相同** ⇒ merge 无冲突。

**AC6 回归守护能取假**：新增 `plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs`（13 tests，
`@test-group engine`，`fs.mkdtempSync(os.tmpdir())` 全程 hermetic）。
- 两个读数都取到：把盘上两条 criterion 的候选表退回裸 `("dist-plugin",)` ⇒ **8 条失败**
  （`✖ AC-260/AC-261 resolves the channel…`、`✖ arm 1`、`✖ arm 4`、`✖ arm 5`、两条 reversion control 等）；
  恢复 ⇒ `ℹ pass 13 / fail 0`。
- 测试自身还内建一次 reversion control（`revertToBareLocalRef`，含 `assert.notEqual` 保证变异真的生效）。

**AC7 复验态**：改写后 `goal check --stale-pass` ⇒ `failing: []` ∧ **exit 0**。桶读数（**真实值**，
随 rotation 走动，取于 2026-09-20 ~11:00Z）：
- 紧随 `goal gate` 之后：AC-260、AC-261 ∈ **`amendedUnverified`** —— 轮转 verdict 的 `criterionHash`
  属于旧文本，AMENDMENT GATE 因此不许它断言新旧任一方向（goal-store.ts 该分支自己的注释）；
- 轮转随后重跑两条（`lastSweepAt` 推进到 `2026-09-20T10:59:25Z`）：AC-260、AC-261 ∈ **`verifiedFresh`**。
⛔ 不照抄 AC-272 的「取不到」结论：AC-272 是 `long-term: true`、结构上进不了 frozen；本条两条 `long-term: false`
且 GOAL-019 已 achieved ⇒ **在** frozen 人口内（`frozenScope` 119 含它们）。⛔ 未手改 AC 的 `status`。

**AC8 既有门**：

```
$ bash scripts/test.sh --for-task gap-ac260-criterion-reads-unowned-local-dist-plugin-ref --allow-thin → rc=0
  ℹ tests 13 / pass 13 / fail 0；scoped 静态闸全 PASS
  PASS: criterion failure attribution intact: inDomain=155 bareAcs=0 ≤ baseline 0 (bareLines=0)
```
归属棘轮基线**未动**（无需 `--capture` 重锚）。fan-in 的 ac-precheck 在 worktree 上读：
`AC 全勾（8/8）——可翻 done`。scoped-gate 缓存按 develop `0fa41cb9c` 落（与所门过的树一致）。

**⛔ 明确不做**（逐条理由）：① 未改交付面内容 —— 渠道 ref 上三支谓词实测 175／0／0，交付面此刻是对的，
重发 `publish-plugin-dist.yml` 无对象；② 未把本地 `dist-plugin` ref 摆回来 —— 见 §五四条裁定，且
`gap-develop-version-union-missing-dev-suffix` 已记录过一次同类修法失败；③ 未为 AC-260/261 另写恒等检查器 ——
新测试复用 `goal-store.createGoalStore` + `runAcceptance`（与 `quay goal gate` 同一个 runner），
不复制第二份判据文本。
