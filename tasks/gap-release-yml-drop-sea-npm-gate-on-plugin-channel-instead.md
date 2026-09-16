---
id: gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead
title: release.yml：取消 sea/npm 产物 job，advance-master 改为消费 plugin 渠道真实安装验证
status: ready
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-274
---
## Proposal

人 2026-09-16 裁定（逐字，已落 `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §11）：
"取消 sea 和 npm release。这些是我们最近没有精力去保障的。" 追问 `advance-master` 拿什么 gate 后：
"按照 claude code plugin 发布和安装。CI 应当按此设计。"

<!-- dedup-ref -->
触发背景：2026-09-16 当晚两次真 dispatch `release.yml`，`sea-release`（windows-x64）在
"Verify the release archive carries the plugin sidecar (AC3)" 步骤真实失败，卡住了 `advance-master`
（`needs:` 覆盖它）。AC-266/AC-267/AC-268（全部关于 SEA/npm 产物线）已由 manager 会话在同一轮
`superseded`（goal store 写入，理由指向本任务与 SPEC §11），本任务是它们指向的**实现**，不是重复立案。

## Plan

**① 移除 5 个 job**（`.github/workflows/release.yml`）：`release`（npm pack + 挂 GitHub Release 资产）、
`sea-release`（×3 平台矩阵）、`sea-verify-node-free`、`sea-verify-node-free-cross-platform`、
`dist-verify-node-floor`（release.yml 内这份——依赖 `release` job 已发布资产的变体，⛔ 不是 ci.yml 里
自建产物的同名 job，那个不在本任务范围内）、`delivery-manifest-verify`（`--ci` 真资产模式）。
逐条确认删除前没有其它 job 反向依赖它们（`grep -n "needs:.*\b<job>\b" .github/workflows/release.yml`）。

**② 新增一个 job**（暂命名 `verify-plugin-channel`，允许实现时按更贴切的命名调整，但要与
`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §11 第 2 点的描述保持可追溯）：
在一个**全新、隔离**的环境（GitHub-hosted runner 本身即天然隔离，不需要额外沙箱）里，把 2026-09-16
在 ad-arm1 archguard 项目上手工做过的那套验证自动化：
1. `claude plugin marketplace add <this-tag-pinned-source>`（可用 `${{ inputs.tag }}` 或直接
   `github.repository` + `dist-plugin` ref，取决于 marketplace.json 当时的实际声明——落地时核实）。
2. `claude plugin install quay@quay --scope project -y`（针对一个 scratch 测试项目目录，不是这个仓库
   自己——避免自我安装的循环依赖）。
3. 对该 scratch 项目跑 `quay-init.sh`（从装好的 plugin cache 里取，同今晚手工验证路径）。
4. `quay driver start --kind promotion` / `--kind worker`，确认 `quay driver status` 两者 `alive=1`。
5. `quay serve --host 127.0.0.1 --port <free-port>`，确认健康（如 `curl` 探测能拿到响应，不需要 200，
   拿到任何 HTTP 响应即证明进程起来了——参考 `quay-serve-cold-start-blocks-event-loop` 那条已知的冷启动
   行为，不要把"暂时不响应"误判成失败）。
6. 收尾：停掉 driver + serve 进程（scratch runner 本身跑完即销毁，非必须但保持干净）。
失败即该 job 失败（fail-closed，不需要额外的显式判断——GitHub Actions 默认语义）。

**③ `advance-master` 的 `needs:` 改为 `[verify-plugin-channel]`**（只此一项——① 删掉的 job 不再存在，
自然不会出现在 needs 里；⛔ 不要保留任何指向已删除 job 的引用，否则 workflow 语法本身就会拒绝）。

**④ 不需要碰的东西（显式排除，避免范围蔓延）**：
- `plugin/scripts/release-master-advance-needs-check.ts`——**结构性地从文件派生期望的 `needs:` 全集**
  （不是硬编码列表），① ② ③ 落地后它会自动认可新的全集，无需修改，只需要在 AC 里重新跑一次确认。
- `ci.yml` 里那份**同名但独立**的 `dist-verify-node-floor` job——不属于本任务范围，继续自建产物验证，
  与 release.yml 无关。
- `publish-plugin-dist.yml` / `dist-plugin` 分支的构建触发方式——SPEC §11 第 6 点明确排除，本任务不碰。

**⑤ 实现期新增：取消一条产物线会带走它的**检查器**（硬规则 5b，落地时才暴露，非范围蔓延）**。
Plan ①–④ 是按"只有 release.yml 会变"写的，实测有 **3 处**消费者以**已删除的 job** 为对象，
不改就恒红（不是"应该顺手改"，是"不改就落不了地"）：
- `plugin/scripts/release-test-client-close-check.ts`（静态门 `run_static_checks` 内）：对象 = `release`
  job 的 `Run tests` 步骤所跑 glob。job 没了 ⇒ 读不到 step ⇒ 恒定 `NOT-EVALUATED`(exit 3)，而
  `run_checker` 把 exit 3 计为失败 ⇒ **整道静态门永久红**。已**退役**：删检查器 + 其 mutation case +
  capability-catalog 六行，`@checker-count` 63→62。（⚠️ 它断言的属性——`connectStdio` 打开的 MCP client
  必须在**抛错路径**上关闭——是 release 专属接线，退役后**全仓无守卫**，已在 `runner-static-gate.ts`
  就地记明为已知缺口。）
- `scripts/delivery-manifest-check.ts`：对象 = manifest 声明的 npm/SEA 产物集 vs release.yml 实际产出的
  集合，且**结构上要求两个数组非空** ⇒ 取消产物线后它把"正确记录取消"判成红。已改：两节改为可选、
  去掉"必须非空"，**双向对齐判据原样保留**（重新长出产物仍会红）；其 `--ci` 资产核对模式（唯一调用者
  `delivery-manifest-verify` 已被 ① 删除）**已移除**——没有已发布资产可核对，留着只能恒真通过
  （硬规则 3b）。连带 `delivery-manifest.json` 去掉两节、`scripts/version-consistency-check.ts` 里那句
  指向 `delivery-manifest-check.ts:252` 的注释更新（该行已不存在）。
- 未改但记为**观察项**：`plugin/scripts/ci-runs-collect.ts` 的 `seaVerify` 字段——它的 job 基名
  （`sea-verify-node-free*`）已从 release.yml 消失，此后每条 Release run 上它恒读 `absent`。该取值**本来
  就是**"没评估成 ≠ 通过"的独立态，不产生假绿；退役它是另一次决定（会连带 ci-runs-collect 的测试面），
  本任务不做。

## AC

- [x] `.github/workflows/release.yml` 里 `grep -c "^  release:\|^  sea-release:\|^  sea-verify-node-free:\|^  sea-verify-node-free-cross-platform:\|^  dist-verify-node-floor:\|^  delivery-manifest-verify:"` = 0（六个旧 job 全部移除，用精确的行首缩进匹配，不是子串匹配）。〔落地读数 2026-09-16：该命令输出 `0`（rc=1 = grep 无命中行，正常）；对照 `grep -n "^  [a-z][a-z0-9-]*:$"` 打印该文件现在**恰好两个** job 键：`verify-plugin-channel`（:65）与 `advance-master`（:261）。同时删掉了 workflow 级 `env: SEA_NODE_VERSION`——它唯一的消费者就是这六个 job（`verify-sea-artifact.sh` 随 job 一起没了）。〕
- [x] `advance-master` 的 `needs:` 字面量就是 `[verify-plugin-channel]`（或落地时确定的实际命名，需与本任务体和 SPEC §11 保持一致更新）。〔落地读数：`needs: [verify-plugin-channel]` 单元素列表；由 AC3 的检查器独立读出 `advance-master.needs declares 1 [verify-plugin-channel]`、`unknownNeeds` 0。命名沿用 SPEC §11 第 2 点的暂定名，无需"更贴切"的改名。〕
- [x] `node --experimental-strip-types plugin/scripts/release-master-advance-needs-check.ts --root . --json` 在改动落地后重跑，`exit 0`（PASS），且打印的"job 集合"只剩 `verify-plugin-channel` + `advance-master` 两项——证明检查器确实是结构性派生的，不需要本任务去改它。〔落地读数：exit 0；`{"state":"pass","jobs":["verify-plugin-channel","advance-master"],"others":["verify-plugin-channel"],"needs":["verify-plugin-channel"],"unknownNeeds":[]}`。**检查器文件零改动**（`git status` 里没有它）——它每次运行从 release.yml 自身的 job 键派生全集，所以删 6 个 job + 加 1 个 job 自动被认。SPEC §11 第 3 点担心的「只改 workflow、漏改检查器 ⇒ 静默认为没有全集要求」在这个实现上不成立：它不是硬编码全集。〕
- [ ] 一次真实 dispatch（`gh workflow run release.yml --ref <tag> -f tag=<tag>`，⛔ 记得同时传 `--ref`，见 `gap-release-softprops-missing-explicit-tag-name` 的前车之鉴——虽然本任务已经不再有 softprops 步骤了，但仍要传对 `--ref` 让 workflow 定义本身取对版本）验证 `verify-plugin-channel` 真的跑通、`advance-master` 真的把 `master` ff 上去。〔**未勾，记未评估**：本条在落地那一刻**结构上取不到输入**——被 dispatch 的 ref 上必须先存在这份新 workflow（本任务的分支尚未合入 develop），且 master 的 ff 由 run 内 job 在远端完成。⛔ 不勾是硬规则 3b 的要求（把"没验成"记成"通过"正是一条 AC 能犯的最贵的错），也不是放任：job 的**每一条命令**都已在本地以隔离 HOME + scratch 项目的等价 harness 逐条真跑过一遍（见 `## Plan` ⑤ 之外的下述读数），残余风险只剩 GitHub runner 的环境差异。**外层验证（待外部）**：落地后由外层从 develop `gh workflow run release.yml --ref develop -f tag=<该次要发布的 tag>`，核对 run conclusion=success ∧ job 列表只含 `verify-plugin-channel`/`advance-master` ∧ `git rev-parse master` == 该 tag 的 commit。〕
- [x] **实现期补的本地可执行证据（Plan ⑤ 的对照；本条不属于原 AC 集，是 AC4 未勾的降险读数）**：把 `verify-plugin-channel` 的**全部命令**在隔离 HOME + 全新 scratch 项目里按序真跑（等价 harness，非模拟）——`publish-dist-branch.sh`（no-push）→ `git archive` 取产物树（含 `.claude-plugin/marketplace.json` 与 `scripts/quay-init.sh`，raw `.ts` 只剩 `runner-static-gate.ts` 这一个有据的例外）→ `claude plugin marketplace add <产物树>` → `claude plugin install quay@quay --scope project -y`（`✔ Successfully installed plugin: quay@quay (scope: project)`，cache 落在 `~/.claude/plugins/cache/quay/quay/0.7.1`）→ 从**装好的 cache** 跑 `quay-init --all --loop`（exit 0，`.quay/config.yml` 落地）→ 两个 kind 的 `driver start` + `driver status --json`（两者 `"alive":1`）→ `quay serve` + curl（**3 秒**内拿到 HTTP 302）。收尾 `driver stop` 在两个 kind 上各报"60s 内未收尾"但锚日志显示 131s/138s 后确实 `remaining loops=0`——job 的收尾步骤用 `|| true`，不影响判定。
- [ ] **该次真实 dispatch 使用的 tag，必须按 SPEC §4.1 的完整分支纪律切出来，⛔ 不得像 2026-09-16 早些时候的 `v0.7.1` 那样在任意提交上直接 strip 版本号打 tag**（人 2026-09-16 明确追加裁定）：
  ```
  develop（先确认上一次 decisive CI 绿——AC-265 今晚已转 pass，这条前置现在结构上可满足）
    │ 切 release/vX.Y.Z
    ▼
  release/vX.Y.Z：版本 bump 覆盖 SPEC §4.3 的全部 14 处（10 条 VERSION_ENTRIES 并集 + package-lock.json
    里 packages/quay{,-native,-github,-backlog} 四个 workspace 包的 version 字段——⛔ 不能只做
    version-consistency-check.ts 报的 11 个文件那个更窄的清单，2026-09-16 早些时候那次 v0.7.1 就漏了
    package-lock.json 的 4 条，此处必须补全，落地时用 `node --experimental-strip-types
    scripts/version-consistency-check.ts` 加读 package-lock.json 四条一并核验，而不是只信它自己的输出）
    │ 合回 develop
    ▼
  在合并点打 tag vX.Y.Z（⛔ 不是在 release 分支切出的那个提交上打，是在合并回 develop 之后的那个
    merge commit 上打——SPEC §4.1 逐字如此）
    │
    ▼
  用 `plugin/scripts/release-branch-finish.sh` 删除 release/vX.Y.Z（⛔ 不手动 git branch -d，用这个
    既有的 fail-closed 命令——它会核验 develop..<b> == 0 才允许删，SPEC §2.4 记录过"忘删导致哪条线
    代表哪个版本随时间失真"的既有教训，两条历史遗留分支就是这么烂掉的）
    │
    ▼
  develop 合回后立刻 bump 到下一个 -dev 版本号（如 vX.Y.Z 是 0.7.1 就 bump 到 0.8.0-dev 或按实际
    SemVer 判断，⛔ 不能停留在无后缀的已发布版本号上——SPEC §4.3 选项 ii 的口径，停留会让"装到的是不是
    已发布版本"这条自证性质原样失效，只是方向从未来变成过去）
  ```
  核实点（每一步都要有可查读数，不是"照着做了"就算数）：① `git merge-base --is-ancestor` 确认 tag 的
  父提交是那次 merge commit，不是 release 分支切出时的提交；② `git branch --list 'release/*'` 在删除
  后不再列出该分支；③ 删除动作的 stdout/日志显示 `release-branch-finish.sh` 真的跑过（不是手删后事后
  补一条记录）；④ develop tip 此刻的版本号（任取一处 VERSION_ENTRIES）带 `-dev` 后缀。
  〔**未勾，结构上依赖上面 AC4 那次真实 dispatch 先发生**——这条和 AC4 是同一个"外层要做的真实动作"
  的两个互相绑定的验收面：AC4 验"dispatch 本身跑通"，本条验"dispatch 用的那个 tag 是不是按规矩切出来
  的"。两条必须**同一次**外层动作一起满足，不接受先补一次不规范的 dispatch 让 AC4 转绿、再补一次单独
  的"规范切分支"表演。〕

## DoD

`AC-274`（master ff 到全绿 release）在一次真实 dispatch 之后转 pass——不是本地读代码"看起来对"就收工；`.quay/ci-runs.jsonl` 里能看到一条 `workflow=Release conclusion=success` 且 job 列表只含 `verify-plugin-channel`（不再含任何 SEA/npm 相关 job 名）的记录，`master` 的提交正是那次 dispatch 的 tag，且**那个 tag 本身是按上面新增 AC 描述的完整分支纪律切出来的**（不是任意提交上的直接打 tag）。

〔**未达成，且落地时结构上不可达**：DoD 的两个子句都要求一次真实 dispatch 的产物（远端 run + master 的 ff），与 AC4/新增 AC 同源、同一个外层动作兑现。⛔ 不勾（勾了就是把"没发生"写成"已发生"）。⛔ 也不把 `master` 提前 ff：SPEC §1 ⑤ 问 4 的裁定是"等全绿"，而"全绿"的判据在本次改动之后才成立。落地后由**外层**补这一步，读数与 AC4/新增 AC 的核对项相同。〕

## Touches

- .github/workflows/release.yml
- delivery-manifest.json
- scripts/delivery-manifest-check.ts
- scripts/delivery-manifest-check.test.ts
- scripts/version-consistency-check.ts
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/capability-catalog.sh
- plugin/scripts/release-test-client-close-check.ts（删除：它的对象是被 ① 移除的 `release` job，见 Plan ⑤）
- plugin/scripts/checker-mutation-cases/release-test-client-close-check.sh（随上一条一起删除）
- plugin/scripts/release-branch-finish.sh
- package-lock.json
- tasks/gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead.md
