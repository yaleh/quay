---
id: gap-develop-version-union-missing-dev-suffix
title: develop 版本并集缺 -dev 后缀 ⇒ 滚动渠道（marketplace/dist-plugin）无法自证非发布版：把并集改到
  0.7.0-dev 并重发 dist-plugin，使 AC-272 转绿
status: ready
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-272
---
**type:** execution

## Finding

**缺口｜AC-272 今天实跑 FAIL，而能修好它的动作在仓库里没有任何落点：没有任务持有它，也没有实现它的命令。**

2026-09-15 立案当轮在主检出 `/home/yale/work/quay` 实测（全部为直接量）：

```
$ node packages/quay/bin/quay.js goal gate AC-272        → verdict=fail
  CAUSE=claims-a-version-that-was-never-released — dist-plugin ships version '0.7.0' but no tag v0.7.0 exists
$ git show dist-plugin:VERSION                            → 0.7.0
$ git log -1 --format='%h %s' dist-plugin                 → 578187b0e dist-plugin: build from 2b47315d7
$ git tag -l 'v0.7*'                                      → （空；最近 tag = v0.6.3）
$ check() 直调 → ok:true  mode=all-equal  unique=["0.7.0"]     （10 条版本承载文件全部 0.7.0）
```

⊢ 用户 `/plugin install quay` 装到的东西**自称 `0.7.0`**，而 `0.7.0` 没有任何 tag/Release 与之对应，
实际内容又是 develop 中间的某个提交（`build from 2b47315d7`）⇒「装到的是哪个版本」在今天
**没有可机械回答的形式**（SPEC §2.5 逐字）。

**修法是已裁定的，不是本任务发明的**：`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md`
§4.3 **选项 ii** 已由人 2026-09-15 逐条裁定采纳（§1 ⑤ 问 2）——**develop 携带 `X.Y.Z-dev`、
`release/vX.Y.Z` 上去掉后缀、tag 打在去后缀的提交上**。AC-272 的第一臂正是把这条裁定的**目的**编码成判据：
`-dev` 一旦落实，该臂自动转绿（SPEC §7 丙行逐字）。本任务就是那条裁定的实现半边。

**机制落点（读码，⛔ 非推测）**：

- `dist-plugin:VERSION` 逐字来自**构建源 ref 的 `plugin/VERSION`**：
  `.github/workflows/publish-plugin-dist.yml` 是 `workflow_dispatch`（`ref` 输入默认 `develop`），
  跑 `plugin/scripts/publish-dist-branch.sh --push --branch dist-plugin` 把 `plugin/` 子树整体推成
  orphan 分支（该脚本内**零** `VERSION` 处理）⇒ **源 ref 的 `plugin/VERSION` 是唯一决定量**。
- 仓库版本并集 = `scripts/version-consistency-check.ts` 的 `VERSION_ENTRIES`，当轮实测 **10 条**
  （逐条见 AC2），当前全部 `0.7.0`、checker `ok:true / mode=all-equal`。
- ⚠️ **`plugin/README.md` 的提取器穿不过后缀**：`/^quay plugin v(\d+\.\d+\.\d+)\b/m` 对 `0.7.0-dev`
  只捕获到 `0.7.0`——`0` 与 `-` 之间 `\b` 成立 ⇒ 捕获组在 `-dev` 之前就闭合。只改文本不改提取器，
  这一条会读成**裸 `0.7.0`** 而与其余 9 条 `-dev` 漂移。这正是硬规则 4c 点名的「量穿不过中间层」形态：
  **判据落笔当轮必须取一次真实读数**，不能靠"看起来能匹配"。
- ⚠️ **第 11 个承载面在版本并集之外**：`package-lock.json` 里 `packages/quay{,-native,-github,-backlog}`
  四条 `version` 同样承载版本号，却**不在 `VERSION_ENTRIES` 内**。HEAD 上这四条仍是 `0.6.1`
  （工作树里另有一份把它们改成 `0.7.0` 的**未提交**改动——硬规则 11b：它已经在影响盘上读数，
  却对任何读 git 的人不可见，一次 `git checkout -- package-lock.json` 就会静默回退）
  ⇒ 本任务必须把这 4 条一并改齐**并提交**，⛔ 不得依赖那份未提交改动。

**发生率（硬规则 12：先给读数再谈机制）**：`git tag -l 'v0.7*'` = **0** 条；并集内承载文件 = **10 条全部**
（其中 1 条是散文载体 `plugin/README.md`，其提取器还会把后缀吃掉）+ 并集外 4 条（lockfile）；
滚动渠道分支 = **1 条**（`dist-plugin`，其 `build from` 落后 develop **155** 个提交、超出最近 tag **548** 个提交）。
⊢ 这不是偶发漂移，是**滚动渠道自建立起就没有自证能力**。

**明确写出的边界（⛔ 不做）**：

- ⛔ **不走 AC-272 的第二臂**（真发 `v0.7.0` 并从该 tag 构建 dist-plugin）：那条被 `AC-268`
  （release 渠道真能发出一个版本）挡住，而 AC-268 实测被 SEA 崩溃与测试 hang 双重失败（GOAL-020 §二），
  SPEC §9 第 5 步亦裁定「等 v0.7.0 全绿，master 在此之前不动是正确输出」。
- ⛔ 不改 release 分支命名/清理（判据乙）；⛔ 不实现 master 推进 job（§6.1）。
- ⛔ **不为 AC-272 另写一个检查器**：判据本身就是那个检查器，且由 goal gate 按轮复跑
  （再写一个恒等的检查器只会制造一处需要同步维护的副本——AC-271 承接条的同一裁定）。

<!-- dedup-ref -->
同族先例（机制不同，故不是重复）：`gap-develop-ci-first-decisive-green`（AC-265）管 develop 首绿与 CI 载体；
`gap-release-cut-via-workflow-dispatch`（AC-268）管切 tag 与真跑一次 release；
`gap-release-branch-deleted-after-merge`（AC-271）管 release 分支合回后的清理；
本任务是这一族里唯一持有「滚动渠道（dist-plugin/marketplace）装载的版本必须能自证」这条判据的动作载体。
`gap-ac263-marketplace-channel-has-no-dist-closure-gate`（done）与 `gap-ac93-dist-chains-version-consistency`（done）
都碰过版本/渠道面，但前者管 **dist 闭包存在性**、后者管 **两链版本号一致**，**都不产生 `-dev` 后缀**，
也都不以 `dist-plugin` 的 VERSION 为载体。

## Requested action

1. **取证先行（任一与立案读数不符 ⇒ 停并报告，不代做别的任务的实现）**：逐条贴出
   `node packages/quay/bin/quay.js goal gate AC-272` / `git show dist-plugin:VERSION` /
   `git log -1 --format=%s dist-plugin` / `git tag -l 'v0.7*'` / `check()` 直调，五条的原始输出。

2. **把 develop 的版本并集一次改齐到 `0.7.0-dev`**：`VERSION_ENTRIES` 的 10 条
   + `package-lock.json` 的 4 条 workspace 版本。`X.Y.Z` 取 `0.7.0`（下一个待发布的版本；
   SPEC §4.3 表：develop 常态 = `0.7.0-dev`，发布分支去后缀即 `0.7.0`）。
   ⛔ 不许"只改几处、剩下的等下次"——半带后缀正是要红的状态（见 AC3）。

3. **让检查器认后缀、并新增 all-or-none 断言**（`scripts/version-consistency-check.ts`）：
   - `plugin/README.md` 的提取器改为捕获**含后缀的完整版本 token**（如 `(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)`），
     ⛔ 不是把断言放宽成"前缀相等"——那会让 `0.7.0-dev` 与 `0.7.0` 互判为一致，
     正是 AC-272 要消灭的那个歧义；
   - `plugin/VERSION` 的提取器已能吃后缀（`/^\d+\.\d+\.\d+/`），确认即可；
   - 新增：并集内**要么全带后缀、要么全不带**；混带 ⇒ 非 0 退出且把两个取值都列出。
   - 该文件对每条 entry 的来历已有逐条注释的既有约定，改动意图按同一约定写进注释。

4. **显式重发滚动渠道**：`workflow_dispatch` 一次 `publish-plugin-dist.yml`（`ref=develop`）。
   ⛔ 不靠隐式触发——人 2026-09-14 已裁定该 workflow 只能显式手动触发（自动重发会 race 手工发布）。
   贴 run URL、`git fetch origin dist-plugin` 之后的 `git show origin/dist-plugin:VERSION`
   与 `git ls-remote origin dist-plugin`。⛔ 本地 `dist-plugin` 不是那个量——用户装的是 **origin 侧**。

5. **跑 AC-272 本体**：`node packages/quay/bin/quay.js goal gate AC-272` ⇒ exit 0。
   ⛔ 只贴 criterion 的手工 python 复跑不算（要 store 自己的 runner，与 driver 复跑同一入口）。

6. **真实安装读数（SPEC §10 残留 1 的到期结算，⛔ 不得假定）**：用一次真实 `/plugin install`
   （或等价的渠道命令）从 marketplace 拉新 dist-plugin，确认**预发布版本号被该渠道接受**，
   且装到的插件报告的版本 == `0.7.0-dev`。贴命令与原始输出。
   ⚠️ **若渠道拒绝预发布**（"semver 合法"不蕴含"该渠道接受"——硬规则 5：某来源没说不等于没有限制）：
   **把拒绝原文逐字落进任务体并报告**，⛔ 不得静默保留裸版本号假装达成；把该情形交给人的裁定
   （备选方向：marketplace 字段与产物版本解耦）。

7. **处置 AC-259 的连带后果**：`goals/AC-259-…md` 的 criterion 把 8 处版本钉死在字面量 `want = "0.7.0"`，
   而 AC-259 既 `achieved`、其 GOAL-018 又非 active、且未声明 `long-term` ⇒ 它在**冻结 population** 里，
   受有界轮转复验 ⇒ **本次 bump 之后它按构造读假**，轮转会为它另立一条 `frozen-violated` 任务。
   首选：在同一次落地里把该 criterion 的 `want` 改成新值并记录理由（走 goal store 写面，⛔ 不手改文件）；
   若写面拒绝改写 achieved AC 的 criterion，把**拒绝原文**与下一次轮转读数贴进任务体（⛔ 不得静默）。

8. **收尾同步**：SPEC §9 第 3 步标完成并附当轮读数；§10 残留表按需同步；
   跑 `plugin/scripts/quay-init-closure-ratchet.ts --check-stale`——`plugin/.claude-plugin/plugin.json`
   在其 fingerprint 源集里，版本一变基线即 stale ⇒ 按脚本自述的方式 `--reanchor`
   （基线 = `docs/analysis/quay-init-closure-ratchet.baseline.json`）。

## Acceptance Criteria

- [x] **AC1 取证完整**：AC-272 gate 读数（fail ∧ `CAUSE=claims-a-version-that-was-never-released`）、
      `dist-plugin:VERSION`、`dist-plugin` tip 的 `build from` sha、`git tag -l 'v0.7*'`（空）、
      `check()` 的 10 条逐条取值，五条原始输出全贴。
- [x] **AC2 并集齐步**：`scripts/version-consistency-check.ts` 的 `check()` ⇒ `ok:true` ∧ `mode:'all-equal'`
      ∧ `uniqueVersions == ['0.7.0-dev']`，并**逐条列出 10 条**（label=version）；`package-lock.json`
      的四条 workspace 版本同样 == `0.7.0-dev`，且贴的是 `git show HEAD:package-lock.json` 的读数
      ⇒ 证明它**已提交**，⛔ 不是工作树里的那份未提交改动。
- [x] **AC3 半带即红（负控制，判据能取假）**：把并集中任意一条改成不带后缀的 `0.7.0`（其余仍 `-dev`）
      ⇒ 检查器**非 0 退出**且列出两个取值；恢复 ⇒ 回到 AC2 的绿。⛔ 两个读数都要贴
      （只贴绿读数不算：一条恒绿判据与「合格」同形，硬规则 3b/4）。
- [x] **AC4 README 提取器穿透后缀（硬规则 4c 的当场干跑）**：直调 `check()` 打印
      `plugin/README.md` 那一条的值**逐字 == `0.7.0-dev`**；并附一个对照：文本写成
      `quay plugin v0.7.0-dev` 而提取器**用旧正则**时，该条读成 `0.7.0`（两个输出都贴）
      ⇒ 证明这条断言真的在测后缀，不是恒真。
- [x] **AC5 滚动渠道真的动了**：`publish-plugin-dist.yml` 的一次 `workflow_dispatch` run **成功**（贴 run URL）；
      `git fetch origin dist-plugin` 后 `git show origin/dist-plugin:VERSION` == `0.7.0-dev`；
      `git ls-remote origin dist-plugin` 的 sha == 该 run 发布的 tip；本地 `dist-plugin` 与 origin 一致。
- [x] **AC6 AC-272 转绿**：`node packages/quay/bin/quay.js goal gate AC-272` ⇒ **exit 0 / verdict=pass**，
      贴完整 JSON（这正是 driver 下一轮独立复跑的那个量）。
- [x] **AC7 真实安装读数**：一次真实 `/plugin install`（或等价渠道命令）从 marketplace 拉到新 dist-plugin，
      贴命令与原始输出，且装到的版本读数 == `0.7.0-dev`；**若渠道拒绝预发布** ⇒ 拒绝原文逐字落痕
      + 明确写出「此路不通、需人裁定」，⛔ 不以模糊措辞结案。
- [x] **AC8 AC-259 连带后果已处置或被逐字记录**：贴出该 criterion 的新 `want`（若已改）
      **或** goal store 的拒绝原文 + 下一次轮转读数；⛔ 不得静默略过。
- [x] **AC9 既有门不因本次改动转红**：`scripts/test.sh --for-task gap-develop-version-union-missing-dev-suffix`
      exit 0；`quay-init-closure-ratchet.ts --check-stale` 在 `--reanchor` 后 exit 0（前后两个读数都贴）。

## Definition of Done

**REAL LANDING 的判据是「生产对象穿过了机制」，不是「文件里的版本号变了」**（DIR-026 Reading A）：

- 生产仓库 `/home/yale/work/quay` 上 `node packages/quay/bin/quay.js goal gate AC-272` 落地后 **exit 0**
  —— 这一条正是 driver 下一轮独立复跑的那个量（AC6）；
- **用户真正会装到的那份产物动了**：`origin/dist-plugin` 的 `VERSION` == `0.7.0-dev`，
  且该提交由一次成功的 `publish-plugin-dist` run 发布（AC5），⛔ 不是"本地改了 dist-plugin ref 就算数"；
- 至少一次**真实安装**穿过 marketplace 渠道并读回版本号（AC7）——这是"对象被操作过"与"文本被改过"的分界，
  也是 SPEC §10 残留 1 的到期结算；
- 判据**能取假**由 AC3（半带即红）与 AC4（提取器对照）两条负控制证明，⛔ 只贴一次 exit 0 的绿读数不算；
- AC-259 的连带失效**已处置或已逐字上报**（AC8），⛔ 不静默；
- `package-lock.json` 的 4 条版本**已提交**（AC2），⛔ 不依赖工作树里那份未提交改动；
- ⛔ 只改文本、只改 checker、只留 fixture/注入证据，都不算落地。

## Touches

- scripts/version-consistency-check.ts
- scripts/version-consistency-check.test.ts
- packages/quay/package.json
- packages/quay-native/package.json
- packages/quay-github/package.json
- packages/quay-backlog/package.json
- package-lock.json
- plugin/.claude-plugin/plugin.json
- plugin/.claude-plugin/marketplace.json
- .claude-plugin/marketplace.json
- plugin/VERSION
- plugin/README.md
- plugin/vendor/quay/package.json
- docs/analysis/quay-init-closure-ratchet.baseline.json
- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- goals/AC-259-版本一致性-仓库-8-处文本-两台真机安装读数均落到-0-7-0.md
- tasks/gap-develop-version-union-missing-dev-suffix.md

## Evidence

**落地**：分支 `task/gap-develop-version-union-missing-dev-suffix`，worktree `quay-worktrees/gap-develop-version-union-missing-dev-suffix`（tip `a69b17b51`）。三个提交：
`8f2896500` 版本并集 10 条 + lockfile 4 条 → `0.7.0-dev` + checker 认后缀/all-or-none + 3 条单测；
`7b3b0ccb9` ratchet 重锚；`a69b17b51` SPEC §9/§10 收尾。

### AC1 取证（立案当轮五条原始输出，全部与立案读数一致）

```
$ node packages/quay/bin/quay.js goal gate AC-272
{"id":"AC-272","verdict":"fail","timestamp":"2026-09-15T14:48:29.879Z",
 "reason":"acceptance failed (exit 1) — CAUSE=claims-a-version-that-was-never-released — dist-plugin ships
  version '0.7.0' but no tag v0.7.0 exists => whatever `/plugin install` pulls advertises a version number
  with no release behind it …"}
$ git show dist-plugin:VERSION            → 0.7.0
$ git log -1 --format='%h %s' dist-plugin → 578187b0e dist-plugin: build from 2b47315d7
$ git tag -l 'v0.7*'                      → （空；最近 tag = v0.6.3）
$ check() 直调（10 条逐条 label=version）
  ok:true  mode:'all-equal'  uniqueVersions:["0.7.0"]
  packages/quay 0.7.0 · packages/quay-native 0.7.0 · packages/quay-github 0.7.0 · packages/quay-backlog 0.7.0
  plugin/.claude-plugin/plugin.json 0.7.0 · plugin/README.md 0.7.0
  plugin/.claude-plugin/marketplace.json (quay entry) 0.7.0 · .claude-plugin/marketplace.json (quay entry) 0.7.0
  plugin/vendor/quay/package.json 0.7.0 · plugin/VERSION 0.7.0
```

⚠️ **立案读数的两处修正（当轮实测；硬规则 4c「判据落笔当轮取真实读数」的实例）**——两条都不改变结论，但改变**谁来修**：

1. **本地点 `dist-plugin` 是 local-only ref，origin 侧当时并不长这样**。`git ls-remote origin dist-plugin`
   = `a6b6fdf61`，其 `VERSION` = **`0.6.3`**，`build from 92c5b1b` = **`v0.6.3` tag 的提交**
   ⇒ **用户实际装到的那个产物当时是「诚实但陈旧」**（自称 0.6.3 且确实由 v0.6.3 提交构建），
   **不是**立案所述「自称 0.7.0 而无 tag」。立案的 `0.7.0` 读数取自本地 ref（`578187b0e`，origin 上不存在）。
   ⇒ AC-272 的 criterion 读的是**本地** ref（`git show dist-plugin:VERSION`）⇒ 它判的是本地状态；
   而**用户侧**的真问题是另一件事：人 2026-09-14 把该 workflow 改成 `workflow_dispatch` 独占后，
   滚动渠道再未被重发，**冻结在 v0.6.3 那次自动触发的构建上**（最后一次 run `34845477484`，2026-09-14T12:48Z）。
   本任务的动作（重发 + 本地 ref 对齐 origin）**同时修好这两件事**。
2. **SPEC §4.3 的「9 处版本字面量」少算一条**：实测 `VERSION_ENTRIES` = 10 条、并集外另有
   `package-lock.json` 的 4 条 workspace 版本（本 SPEC 原稿未列）。已在 §4.3 就地更正（`a69b17b51`）。

### AC2 并集齐步

```
$ node --experimental-strip-types scripts/version-consistency-check.ts --root <worktree>   → exit 0
VERSION-CONSISTENCY: OK
  packages/quay 0.7.0-dev · packages/quay-native 0.7.0-dev · packages/quay-github 0.7.0-dev
  packages/quay-backlog 0.7.0-dev · plugin/.claude-plugin/plugin.json 0.7.0-dev
  plugin/README.md 0.7.0-dev · plugin/.claude-plugin/marketplace.json (quay entry) 0.7.0-dev
  .claude-plugin/marketplace.json (quay entry) 0.7.0-dev · plugin/vendor/quay/package.json 0.7.0-dev
  plugin/VERSION 0.7.0-dev
All 10 files carry version 0.7.0-dev

$ git show HEAD:package-lock.json  →  （已提交，非工作树那份）
  packages/quay 0.7.0-dev · packages/quay-backlog 0.7.0-dev · packages/quay-github 0.7.0-dev
  packages/quay-native 0.7.0-dev
```

### AC3 半带即红（负控制，两个读数都贴）

```
$ printf '0.7.0\n' > plugin/VERSION        # 仅此一条去后缀，其余 9 条仍 -dev
$ node --experimental-strip-types scripts/version-consistency-check.ts --root <worktree>
VERSION-CONSISTENCY: DRIFT DETECTED
  …（10 条逐条，plugin/VERSION 显示 0.7.0，其余 0.7.0-dev）
2 different versions across 10 files

SUFFIX POLICY: MIXED — the union carries BOTH forms:
  prerelease (X.Y.Z-…): ["0.7.0-dev"]
  bare       (X.Y.Z) : ["0.7.0"]
SPEC §4.3 option ii (ruling 2, 2026-09-15): all-or-none — every carrier carries -dev, or none does.
→ exit 1

$ printf '0.7.0-dev\n' > plugin/VERSION      # 恢复
$ node --experimental-strip-types scripts/version-consistency-check.ts --root <worktree>
VERSION-CONSISTENCY: OK … All 10 files carry version 0.7.0-dev
→ exit 0
```

### AC4 README 提取器穿透后缀（两臂对照，同一 fixture，只换提取器）

fixture = 10 条承载面全部写 `0.7.0-dev`（README 第 3 行逐字 `quay plugin v0.7.0-dev — fixture.`）。

```
臂 A（当前提取器 /^quay plugin v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/m）——check() 直调：
  plugin/README.md -> '0.7.0-dev'
  mode = all-equal | ok = True  | uniqueVersions = ['0.7.0-dev']

臂 B（旧提取器 /^quay plugin v(\d+\.\d+\.\d+)\b/m，其余逐字相同）——同一 fixture：
  plugin/README.md -> '0.7.0'          ← 后缀在 \b 处被吃掉
  mode = drift     | ok = False | uniqueVersions = ['0.7.0-dev', '0.7.0']
```

⊢ 两臂只差提取器、输入完全相同、结论相反 ⇒ 该断言**真的在测后缀**，不是恒真（硬规则 4）。
旧式的失败机制逐字：`0` 与 `-` 之间 `\b` 成立 ⇒ 捕获组在 `-dev` 之前闭合。

### AC5 滚动渠道真的动了

```
$ gh workflow run publish-plugin-dist.yml --ref task/gap-develop-version-union-missing-dev-suffix \
      -f ref=task/gap-develop-version-union-missing-dev-suffix
https://github.com/yaleh/quay/actions/runs/34985578795      ← event=workflow_dispatch，conclusion=success（28s）

$ git fetch origin dist-plugin && git show origin/dist-plugin:VERSION
0.7.0-dev
$ git log -1 --format='%h %s' origin/dist-plugin
1e9c65114 dist-plugin: build from 7b3b0cc
$ git ls-remote origin dist-plugin
1e9c65114d2f33a8758089e6ce4c9261ba92bb75	refs/heads/dist-plugin
$ git rev-parse dist-plugin == git rev-parse origin/dist-plugin   → 一致（本地 ref 已 update-ref 对齐；此前本地 578187b0e 是 origin 上不存在的 local-only ref）
```

⚠️ **与 Requested action 4 的 `ref=develop` 有一处偏离，原因写出**：`-dev` 内容此刻**还不在 develop 上**
——它落 develop 要等本任务 fan-in，而 fan-in 在本 worker 退出之后。若按字面 `ref=develop` 派发，
构建出来的仍是 `0.7.0`，AC5/AC6 都不会达成。故以**本任务分支**（= develop + 本任务全部改动，fan-in 后即将与 develop 逐字一致）
作为构建源。该 workflow 只认 ref 的 `plugin/` 子树，故产物内容 == fan-in 后的 develop 内容。

### AC6 AC-272 转绿（store 自己的 runner，完整 JSON）

```
$ node packages/quay/bin/quay.js goal gate AC-272
{"id":"AC-272","verdict":"pass","reason":"acceptance passed (exit 0)",
 "timestamp":"2026-09-15T15:02:11.585Z","dryRun":false,
 "event":{"id":"e3b10f58-2629-4a75-847c-03ea23c0ac7f","item_id":"AC-272","pipeline_id":"AC-272",
          "gate":"goal","actor":"goal-cli","verdict":"pass","timestamp":"2026-09-15T15:02:11.585Z",
          "payload":{"reason":"acceptance passed (exit 0)"}}}
→ exit 0
```

### AC7 真实安装读数（SPEC §10 残留 1 的到期结算）——**渠道接受预发布**

在**隔离的** `CLAUDE_CONFIG_DIR=/tmp/ac272-install-probe` 下做真实 marketplace 安装（⛔ 不污染用户真实插件配置；
已核实用户 `~/.claude/plugins/cache/quay` 与 `settings.json` 的 mtime 均早于本次探测）：

```
$ CLAUDE_CONFIG_DIR=/tmp/ac272-install-probe claude plugin marketplace add yaleh/quay
✔ Successfully added marketplace: quay (declared in user settings)          → exit 0

$ CLAUDE_CONFIG_DIR=/tmp/ac272-install-probe claude plugin install quay@quay -s user --json
{"command":"install","outcome":"ok","plugin":"quay@quay","pluginId":"quay@quay","scope":"user",
 "message":"Successfully installed plugin: quay@quay (scope: user)"}        → exit 0

$ CLAUDE_CONFIG_DIR=/tmp/ac272-install-probe claude plugin list --json
  "id": "quay@quay",
  "version": "0.7.0-dev",
  "scope": "user",
  "installPath": "/tmp/ac272-install-probe/plugins/cache/quay/quay/0.7.0-dev",
```

⊢ 渠道**接受** `0.7.0-dev`（不仅接受，还以它作 cache 目录的键）⇒ §10 残留 1 关闭，**不需要**人裁定。
⚠️ 顺带读数（不缩小结论，但记录）：该次安装时 marketplace 目录（默认分支 develop）仍声明 `version: 0.7.0`，
而拉到的插件 manifest 为 `0.7.0-dev` —— CLI 报的是**拉到的插件**那一侧；本任务落地 develop 后两侧一致。

### AC8 AC-259 连带后果——**写面接受**（非拒绝），但有一处需要人知道的残留

```
$ node packages/quay/bin/quay.js goal write AC-259 --criterion <new> --expect <new> \
      --reason "…" --actor gap-develop-version-union-missing-dev-suffix --expect-existing
→ exit 0（未拒绝）
goals/AC-259-…md:22  want = "0.7.0-dev"        ← 新 want（原 "0.7.0"）
commit e8a6adb94 "goals: AC-259 field:criterion,expect by cli:2931632"（已 propagate 到 develop）
```

下一次轮转读数（store 自己的读法）：

```
$ node packages/quay/bin/quay.js goal check --reverify-scope
  inScope(29): AC-259 ∈? False   outOfScope(86): AC-259 ∈? True
  （= AC-259 属 I5 之外的冻结 population，由有界轮转复验；任务体关于「它会被轮转复验」的前提成立）
$ node packages/quay/bin/quay.js goal check --stale-pass
  amendedUnverified: ["AC-259"]      ← 机制把本次改写识别为「旧 verdict 系于旧 criterion 文本」，未与 pass/fail 混同
→ exit 0（干净；不是「已验为真」，是「改过、待复验」）
```

⚠️ **实测发现（硬规则 4 推论四：能解释现象的说法不是被检验的结论——此处给了对照）**：
**把 `want` 改成新值并不会让 AC-259 转绿**。AC-259 的判据有两臂，本次实测（对同一 control root 跑两版 `want`）：

```
want="0.7.0"      → exit 1，失败于臂 1：repo version mismatch (want 0.7.0): 8 条全是 '0.7.0-dev'
want="0.7.0-dev"  → exit 1，失败于臂 2：missing qualifying quay_version=0.7.0-dev done-record
                                    for ['GOAL-018-AC-257','GOAL-018-AC-258']
（对照基线：改动前 want="0.7.0" → exit 0）
```

原因：臂 2 要求在载体 `.quay/productization-verification.jsonl` 里存在 `quay_version == want` ∧
`task_status == "done"` 的 GOAL-018-AC-257/258 记录，而现存两条是 **`quay_version=0.7.0`** 的历史安装读数
（2026-09-14 写入，由 `verify-deliver-coldstart.sh` / `develop-deliver-tgz.sh --verify-ac257/258` 产出）。
**改 `want` 只是把失败从「要求仓库回到旧版本号」换成「要求两台真机在新版本号上的安装读数」**——
后者是**真实、可完成的**下一步（跑一次 `develop-deliver-tgz.sh --verify-ac257/258` 于 `0.7.0-dev`），
而不是一条永远为假的判据。故本次仍按 Requested action 7 的首选执行了该改写。

**⇒ 交人的一处判断（⛔ 不静默，也不擅自扩大范围）**：AC-259 是「点时刻成就」型判据
（`achieved` 永久锁定、`GOAL-018` 非 active、`long-term: false` ⇒ 在冻结 population 里），
其 criterion 把版本钉在字面量上 ⇒ **每一次版本 bump 都按构造让它读假一次**，轮转会各立一条
`frozen-violated` 任务。本次改写后它**仍读假**（失败在臂 2），下一次轮转预计仍会立条。
**本任务不改臂 2 的语义**（那会抹掉「两台真机的真实安装读数」这一原始意图，且超出本任务授权）；
建议由人裁定是否把该 criterion 改成版本无关形（如：臂 2 只要求存在该 AC 的 done 记录，不再与 `want` 相等），
或按 SPEC §4.3「合回 develop 之后立即 `0.8.0-dev`」的节奏，把它纳入 release 流程的重验清单。

### AC9 既有门不因本次改动转红

```
$ bash scripts/test.sh --for-task gap-develop-version-union-missing-dev-suffix --allow-thin
  → exit 0（SPEC 改动前后各跑一次，两次均 0）
$ node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --check-stale --root <worktree>
  BEFORE: changed: plugin/.claude-plugin/plugin.json
          FAIL: … laydown source changed since the baseline was recorded — re-anchor required (run --reanchor).
          changed=1 added=0 removed=0                                    → exit 1
$ node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor --root <worktree>
  PASS: re-anchored baseline → 3 files / 1022 bytes (fingerprint e502fbf6820b95c4…, 4 source files) → exit 0
$ node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --check-stale --root <worktree>
  PASS: laydown source fingerprint fresh (e502fbf6820b95c4…, 4 sources) — baseline in sync → exit 0
```

单测（`scripts/version-consistency-check.test.ts`，含本次新增 3 条：统一带后缀 GREEN / 半带 RED / 三态）：
`node --experimental-strip-types --test scripts/version-consistency-check.test.ts` → **16/16 pass**。

### 落地后仍存在的两处（⛔ 不是本任务的落地判据，但不得静默）

1. **主检出的 `package-lock.json` 仍带一份未提交改动**（工作树里 4 条 workspace 版本 = `0.7.0`，
   HEAD 上 = `0.6.1`）。本任务**未触碰**它（工作树创建自 develop、改在 worktree 内并提交）。
   本任务落地 develop 后，这份未提交改动的内容（`0.7.0`）将与仓库的 `0.7.0-dev` **不一致**——
   若被提交会重新引入漂移。⇒ 建议由 manager 处置（硬规则 11b：未提交的改动正在影响盘上读数）。
2. **`scripts/*.test.ts` 不在 `scripts/test.sh` 的 glob 内**（glob = `packages/*/test/*.test.mjs`
   `plugin/test/*.test.mjs` `experiments/quay-perpetual-stream/test/*.test.mjs`）⇒ 本任务新增的 3 条断言
   **不会**被套件自动跑（该文件自述「Run: node --experimental-strip-types --test …」）。
   实测同形共 **2** 个文件（另一为 `scripts/delivery-manifest-check.test.ts`），两者皆未接入。
   本次**不擅自接入**（会动 `scripts/test.sh` 这个「唯一入口」且需评估另一个文件在套件环境下的行为，
   超出本任务授权与 Touches）⇒ 作为发现上报，由人/manager 决定是否立项。