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

- [ ] **AC1 取证完整**：AC-272 gate 读数（fail ∧ `CAUSE=claims-a-version-that-was-never-released`）、
      `dist-plugin:VERSION`、`dist-plugin` tip 的 `build from` sha、`git tag -l 'v0.7*'`（空）、
      `check()` 的 10 条逐条取值，五条原始输出全贴。
- [ ] **AC2 并集齐步**：`scripts/version-consistency-check.ts` 的 `check()` ⇒ `ok:true` ∧ `mode:'all-equal'`
      ∧ `uniqueVersions == ['0.7.0-dev']`，并**逐条列出 10 条**（label=version）；`package-lock.json`
      的四条 workspace 版本同样 == `0.7.0-dev`，且贴的是 `git show HEAD:package-lock.json` 的读数
      ⇒ 证明它**已提交**，⛔ 不是工作树里的那份未提交改动。
- [ ] **AC3 半带即红（负控制，判据能取假）**：把并集中任意一条改成不带后缀的 `0.7.0`（其余仍 `-dev`）
      ⇒ 检查器**非 0 退出**且列出两个取值；恢复 ⇒ 回到 AC2 的绿。⛔ 两个读数都要贴
      （只贴绿读数不算：一条恒绿判据与「合格」同形，硬规则 3b/4）。
- [ ] **AC4 README 提取器穿透后缀（硬规则 4c 的当场干跑）**：直调 `check()` 打印
      `plugin/README.md` 那一条的值**逐字 == `0.7.0-dev`**；并附一个对照：文本写成
      `quay plugin v0.7.0-dev` 而提取器**用旧正则**时，该条读成 `0.7.0`（两个输出都贴）
      ⇒ 证明这条断言真的在测后缀，不是恒真。
- [ ] **AC5 滚动渠道真的动了**：`publish-plugin-dist.yml` 的一次 `workflow_dispatch` run **成功**（贴 run URL）；
      `git fetch origin dist-plugin` 后 `git show origin/dist-plugin:VERSION` == `0.7.0-dev`；
      `git ls-remote origin dist-plugin` 的 sha == 该 run 发布的 tip；本地 `dist-plugin` 与 origin 一致。
- [ ] **AC6 AC-272 转绿**：`node packages/quay/bin/quay.js goal gate AC-272` ⇒ **exit 0 / verdict=pass**，
      贴完整 JSON（这正是 driver 下一轮独立复跑的那个量）。
- [ ] **AC7 真实安装读数**：一次真实 `/plugin install`（或等价渠道命令）从 marketplace 拉到新 dist-plugin，
      贴命令与原始输出，且装到的版本读数 == `0.7.0-dev`；**若渠道拒绝预发布** ⇒ 拒绝原文逐字落痕
      + 明确写出「此路不通、需人裁定」，⛔ 不以模糊措辞结案。
- [ ] **AC8 AC-259 连带后果已处置或被逐字记录**：贴出该 criterion 的新 `want`（若已改）
      **或** goal store 的拒绝原文 + 下一次轮转读数；⛔ 不得静默略过。
- [ ] **AC9 既有门不因本次改动转红**：`scripts/test.sh --for-task gap-develop-version-union-missing-dev-suffix`
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
