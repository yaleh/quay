---
id: gap-release-softprops-missing-explicit-tag-name
title: release.yml 两处 softprops/action-gh-release 都没传 tag_name，隐式依赖 dispatch ref 上下文
status: superseded
needs_human_cause: unclassified
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`.github/workflows/release.yml` 里 `release` job（约 line 156）与 `sea-release` job（约 line 341）
各有一处 `uses: softprops/action-gh-release@v2`，**都没有显式传 `tag_name:`**——该 action 在没有这个
输入时，靠触发时的 `GITHUB_REF`/dispatch ref 上下文推断要挂到哪个 tag 上。

这个仓库的 release 渠道设计成纯 `workflow_dispatch`（`gap-github-actions-no-implicit-triggers`，人
2026-09-14 裁定：不再监听 tag push），`inputs.tag` 才是"这次发布的到底是哪个版本"的唯一权威来源——
但两处 `softprops/action-gh-release@v2` 都没有把这个输入接上去，**隐式依赖调用方记得在 `gh workflow
run` 上也传对 `--ref`**。2026-09-16 实测复现：`gh workflow run release.yml -f tag=v0.7.1`（漏传
`--ref`）触发的 run（`35075347245`），`GITHUB_REF` 解析到的是默认分支/dispatch 来源分支（`develop`），
**不是 tag**，导致 `release`/`sea-release` 两个 job 的 Upload 步骤全部报 "GitHub Releases requires a
tag" 而失败——即使 `inputs.tag=v0.7.1` 本身填得完全正确。

<!-- dedup-ref -->
这不是 `sea-release` 独有的问题——`release` job 同一形态的调用点会在同一次误 dispatch 下同样失败，
只是本次复现时 `release` job 还没跑到那一步就被取消了，没有独立留下证据。

修法：两处 `softprops/action-gh-release@v2` 的 `with:` 都显式加 `tag_name: ${{ inputs.tag }}`——
彻底不依赖 dispatch 时的 ref 上下文，不管调用方是否记得传 `--ref`，产物都会挂到正确的 tag 上。

## AC

- [ ] `release` job 与 `sea-release` job 的两处 `softprops/action-gh-release@v2` 步骤，`with:` 均含
      `tag_name: ${{ inputs.tag }}`。
- [ ] 负控制（结构性，非真跑一次 release）：`grep -cF 'uses: softprops/action-gh-release' .github/workflows/release.yml`
      与 `grep -cF 'tag_name: ${{ inputs.tag }}' .github/workflows/release.yml` 两个计数相等——每一处
      softprops 调用都配了显式 tag_name，不是只修了其中一处。
      （`-F` 必需，见 Evidence「仪器修正」：该模式含 `$` 与 `{}`，双引号下 bash 报 `bad substitution`
      使 grep 根本没跑，单引号+BRE 下恒 0——两种写法均已用【已知为真】样本干跑证伪。）
- [ ] 若本任务着陆时机允许一次真实 dispatch 验证：`gh workflow run release.yml -f tag=<existing-tag>`
      **不传 `--ref`**（刻意复现本任务描述的误用场景）也能正确挂载到该 tag 的 Release 上，不再报
      "GitHub Releases requires a tag"。（若无法安排真实 dispatch，负控制那条静态检查已经是可核实的
      最低门槛，不阻塞本任务落地。）

## DoD

`.github/workflows/release.yml` 落地后，即便未来有人（人或脚本）dispatch 时漏传 `--ref`，release 产物
依然会挂到 `inputs.tag` 指定的那个 tag 上，不再需要调用方自己记得两个参数都要传对。

## Evidence

- 实现：`release.yml` 两处 `with:` 均含 `tag_name: ${{ inputs.tag }}`（line 165 / line 354）；两处各带
  解释性注释（为什么不能再依赖 dispatch ref）。
- **结构级核验（覆盖 grep 覆盖不到的面：key 是否挂在【正确的 step 的 `with:`】下、以及整份 workflow
  是否仍是合法 YAML——改 workflow 最贵的失败形态就是改坏它）**：用 `python3 -c "import yaml, …"` 解析
  `.github/workflows/release.yml`，遍历 `jobs[*].steps[*]` 取 `uses` 含 `softprops/action-gh-release` 的项，
  得 `release.steps[8] 'Upload artifact to GitHub Release' -> with.tag_name = '${{ inputs.tag }}'`、
  `sea-release.steps[10] 'Upload SEA archive to GitHub Release' -> with.tag_name = '${{ inputs.tag }}'`，
  且 `jobs = 7`（解析成功）。⇒ 两处 key 的**嵌套位置**正确、文件仍是合法 YAML。
- **仪器修正（AC2 的负控制原文不可执行，已干跑证伪并改成正则可执行的写法）**：原写法
  `grep -c "tag_name: ${{ inputs.tag }}"` 两种 shell 形态**都失效**——①双引号下 bash 直接报
  `tag_name: ${{ inputs.tag }}: bad substitution`，**grep 根本没跑**（无输出、无计数）；②单引号+BRE 下
  **恒 0**：在【已知为真】样本（`printf '%s\n' "          tag_name: \${{ inputs.tag }}"`）上干跑同样得
  `0`/exit 1，根因是该模式含 `$` 与 `{}`，在 BRE 下属元字符序列。⇒ 改用 `grep -cF`（固定串匹配）。
  **修正后真实读数**：`grep -cF 'uses: softprops/action-gh-release' .github/workflows/release.yml` = **2**，
  `grep -cF 'tag_name: ${{ inputs.tag }}'` = **2**（相等 ⇒ AC2 成立）。
  **负控制（证明该谓词能取假、非空转）**：`grep -cF 'tag_name: ${{ inputs.NOPE }}'` = `0`、exit 1。
  零计数配套动作亦已做：非零项打印命中的前 3 条实际内容 —— line 165 / line 354 两处 `with:` 下逐字为
  `tag_name: ${{ inputs.tag }}`。
- **全局阻塞（非本任务 delta，本轮一并处理）**：`quay-init-closure-ratchet --check-stale` 在 develop 上自
  `eb17c4ac1`（v0.7.1 release cut 把 `plugin/.claude-plugin/plugin.json` 去掉 `-dev` 后缀）起为红，
  而该 checker 是 `@static-tier change` 且 fail-closed，整轮 suite 在静态检查面即中止（本任务前两轮
  exited-not-landed 的真因：`STATIC_CHECK_FAILED: quay-init-closure-ratchet-stale exit=1`，0 个测试跑到）。
  核实为 develop 侧而非本任务 delta：`git rev-parse author develop HEAD` 三者同为 `f29dbe30a`，
  两侧 `plugin.json` 逐字相同，主检出（= develop 内容）跑同一 checker 同样 exit 1。
- 修法为机械重锚（shrink-only 未被洗白）：`--gate` PASS `3 files / 1022 bytes ≤ baseline 3/1022`（未增长）
  ⇒ `--reanchor` 得 `3 files / 1022 bytes`（footprint 一字未变）⇒ `--check-stale` exit 0；
  baseline 的 diff 仅 `fingerprint` 与 `plugin.json` 的 `sha`。内容由四个源文件唯一决定且幂等
  ⇒ 与 develop 独立重锚所得逐字相同（develop 若自行修复，本分支该改动在三点 diff 中变空操作）。
  故 `docs/analysis/quay-init-closure-ratchet.baseline.json` 一并登记进 `## Touches`（anti-drift 需要）。
  **事后核对（2026-09-16 本轮）：develop 确已收敛到同一内容** —— 最终 delta 只剩 `release.yml` +
  本任务文件，baseline 那条已从三点 diff 中消失（正是上面预言的「变空操作」）。
- **本轮续跑（处置前两轮 exited-not-landed）**：
  - ① 上一轮 suite 红（真因日志 `fan-in-suite-...~1789549690367-23cef8.log`：`STATIC_CHECK_FAILED:
    quay-init-closure-ratchet-stale exit=1`，`# tests 0 / # fail 10` —— 0 个测试跑到，静态面即中止）
    由本分支既有重锚提交处置；合并 develop 后在本 worktree 复跑
    `quay-init-closure-ratchet.ts --check-stale` = `PASS: … laydown source fingerprint fresh
    (233a7b2fd39d5a31…, 4 sources) — baseline in sync`、exit 0。
  - ② 上一轮 `step=ff: fan-in-ff-merge: FF FAILED — not a fast-forward` 是**分支落后**（develop 前进），
    非代码缺陷：本轮 `git merge --no-edit develop` **无冲突**成功（合入 24 个提交），且退出前
    `git rev-list --left-right --count develop...HEAD` = `0 9`（**0 落后**）⇒ fan-in 复跑时 ff 不再因 lag 失败。
  - ③ 跑 fan-in 同一条 scoped 门（`scripts/test.sh --for-task gap-release-softprops-missing-explicit-tag-name
    --allow-thin`）**两次均 exit 0**（合并后一次、最终并集状态一次）：选择器取 0 个测试文件（thin 允许，
    全量仍在 fan-in 跑），静态面全 PASS——含直接读 `release.yml` 的 `advance-master.needs` 检查
    （7 个 job，6 个被 needs 覆盖，0 个漏）。
  - ④ **一次静默的记录丢失与补救（本轮实测，值得记）**：按 prompt 传完整 body 重写时**漏带了本段两条
    既有 bullet**，而该写入被 store 记为 `self-only`（`.quay/store-commit-propagation.jsonl` 10:54:01
    `propagated:false`）却仍**迟到**传播进 develop；随后 `git merge develop` **clean、无冲突**地把这两条
    bullet 的**删除**一并带进分支（「merge 干净」≠「记录没丢」）。补救 = 用【并集】body 再写一次 +
    **再** merge 一次；判据用**计数** `grep -c '^- ' tasks/<id>.md`（本轮靠它发现 2→0）。
- **AC3 明示取 fallback 分支**：本轮**未安排真实 dispatch**（真实 dispatch 会创建/改动 GitHub Release，
    是对外且不可逆的动作，需人授权，不由本 worker 触发）。`.quay/ci-runs.jsonl` 中 `Release` 类记录里，
  本缺陷复现 run = `35075347245`（08:43:26Z, branch=`develop`, cancelled），其后最新一条 =
  `35076017292`（08:50:36Z, branch=`v0.7.1` = 正确传了 ref 的那次, failure，与本事象不同因）。
  修复未落地前**不存在「已修后的真实 dispatch」** ⇒ 依 AC3 自带条款以静态负控制为准，不阻塞落地。
- **🔴 2026-09-16 第 3 次续跑：三条 AC 由 `[x]` 改回 `[ ]` —— 目标代码已被 develop 整体删除，本修复成为空操作。**
  这不是实现回退，是 develop 侧裁定的后果。读数如下（全部为机械读数，非自述）：
  - **develop 侧事实**：`gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead`（done，已在 develop tip
    `518787b7c`）按人 2026-09-16 裁定重写了 `release.yml` —— 裁定逐字：「取消 sea 和 npm release。这些是
    我们最近没有精力去保障的。」该重写**整段删除了 `release` 与 `sea-release` 两个 job**（即本任务唯一的
    两个 softprops 调用点），连同 `sea-verify-node-free*` / `dist-verify-node-floor` /
    `delivery-manifest-verify`。合并后本 worktree 的 `release.yml` 只剩
    `verify-plugin-channel` + `advance-master` **两个 job**（`grep -nE '^  [a-z][a-z0-9_-]*:$'` 读数：
    line 31 `workflow_dispatch:` / line 65 `verify-plugin-channel:` / line 265 `advance-master:`）。
  - **三条独立机械读数（互校，均指向同一结论）**：① `git grep -nE 'action-gh-release|upload-release-asset|
    gh release (create|upload|edit)' develop -- .github/workflows` = **空**（`.github/workflows` 全域已无
    任何 release 上传面；`publish-plugin-dist.yml` 走 dist 分支，`ci.yml` 无上传）；② 本轮 scoped 门里
    直接读 `release.yml` 的那个检查器自报 `PASS: advance-master.needs covers every other job in
    .github/workflows/release.yml — jobs in .github/workflows/release.yml: 2 [verify-plugin-channel,
    advance-master]`（旧版是 7 个 job）；③ 本任务在 fan-in 里要过的 **anti-drift 检查器**自报
    `ANTI-DRIFT OK: task gap-release-softprops-missing-explicit-tag-name — 0 actual file(s), all within
    declared Touches (3 glob(s))` ⇒ 本分支对 merge target 的**实际改动面 = 0 个文件**。
  - **冲突怎么解的**：`git merge develop` 在 `release.yml` 报 CONFLICT（HEAD 侧 614 行 vs develop 侧空 =
    develop 删了整段）。按「develop 删、我改同一段」处理：**接受 develop 的删除**
    （`git checkout develop -- .github/workflows/release.yml`），⛔ **不是取 union** —— union 会把这批
    被人裁定退役的 job 加回去（prompt 规则 (5)：不得静默复活退役实现）。merge 提交 `de12affd5`。
  - **为何 AC 保持未勾（这是硬规则 3b，不是犯懒）**：三条 AC 如今**结构上不可满足** —— AC1「两处 softprops
    步骤均含 tag_name」现在是对**空集**成立；AC2 的负控制退化为 **0 == 0**（本轮实测
    `softprops=0`、`tag_name=0`，「两个计数相等」不再证明任何一处被配了 tag_name，且它恰恰会以
    「检查通过」的形态出现 —— 这正是 3b 点名的「把『对象没了』伪装成检查通过」）；AC3 的 fallback 以
    「调用点存在」为前提。⇒ 保持未勾 + 本节注解，**且刻意不蹭** `（待外部）`/`外层验证`/`全量套件绿`
    三个 pass-external 标记 —— 本态不属于「待外部验证」，属「对象已退役」，不该走 flip 放行。
  - **develop 是否已独立获得本任务想要的性质**：**是，且是构造性的** —— 重写后 `verify-plugin-channel`
    与 `advance-master` 的 checkout 均为 `ref: ${{ inputs.tag }}`，`advance-master` 用
    `git rev-parse "${TAG}^{commit}"`，全文不再有任何依赖 dispatch ref 上下文之处；且 `release.yml` 已无
    任何 release 上传步骤 ⇒ 本缺陷的用户可见症状（"GitHub Releases requires a tag"）**结构上无法再发生**。
    但 ⛔ 该性质来自**删除 + 重写**，**不是**本任务补丁带来的，**不得记为本任务 delta 的功劳**（硬规则 4
    推论三：实现了、测试绿了、但生产没跑过 ⇒ 与「没实现」同形；此处更进一步：功能已被移除）。
  - **分支现状**：`git diff develop...HEAD` = **空**（内容与 develop 逐字相同）、`git status` 干净、无
    unmerged path；scoped 门 `scripts/test.sh --for-task gap-release-softprops-missing-explicit-tag-name
    --allow-thin` = **exit 0**（选择器取 0 个测试文件；两个 NOT-EVALUATED 均因其为 delta-scoped 判据、
    本 delta 无载体，⛔ 不与 PASS 同形）。
  - **期望的终态 = `superseded`，理由指向人 2026-09-16 裁定与
    `gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead`**；⛔ **不建议 `done`**（那会把 develop 的
    删除记成本任务的修复落地）。转态是生命周期决定，由 driver/人执行 —— 本 worker 不改 `status`。

## Touches

- .github/workflows/release.yml
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-release-softprops-missing-explicit-tag-name.md

## Needs-Human

**执行 2026-09-16T11:08:32.052Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：human-adjudication
- 失败步/判词：step=suite: ✖ AC5 — negative control: the SAME packaged artifact minus dist/driver-anchor.js reproduces the production failure (rc=1 + the exact error) (10279.809185ms)
- run_id：wk-prod-anchor
- session_id：407a79d1-cb3a-4d56-9b9c-4bec0808d71a
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-release-softprops-missing-explicit-tag-name~wk-prod-anchor~1789556494678-4cc931.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-release-softprops-missing-explicit-tag-name-wk-prod-anchor.log

**人复核（manager 会话，2026-09-16T11:16Z）— 判定为宿主负载相关 flake，退回 ready 重试，不碰 delta：**

- 该失败测试（`plugin/test/driver-anchor.test.mjs` 的 "AC5 — negative control: the SAME packaged
  artifact minus dist/driver-anchor.js reproduces the production failure"）与本任务 Touches
  （`release.yml`/`delivery-manifest.json` 等）**完全无关**——本任务不碰任何 driver-anchor 打包逻辑。
- 命中已知模式 `suite-red-spawn-heavy-driver-tests-load-correlated`（spawn 密集的 driver 测试，宿主
  contention 下报内部超时，不是断言失败；该 memory 明确点名 driver-anchor/driver-runtime 这类文件）。
- 现场负控制：复核当下 `uptime` 读数 `load average: 23.63, 13.92, 9.51`（16 核机器，1 分钟负载 23.63
  ≈ 1.5x 核数，明显过载）、`swap` 用了 5.3/8G——与该 memory 描述的"内部超时而非断言失败"一致的宿主状况。
- 结论：**不是实现缺陷，不改 delta**。已确认的三条机械 AC（tag_name 落地、结构级 YAML 校验、负控制）
  均扎实，属误判为 needs-human 的环境噪音。转回 `ready` 让 worker-driver 重新派发一次；若下一轮仍在
  同一个不相关文件上红、且宿主负载已回落，再重新判断。

**worker 第 3 次续跑（2026-09-16T12:1xZ）— ⛔ 建议不要再派 worker，请裁定 `superseded`：**

- **manager 上一条的两个条件都已满足，但结论要改**：宿主负载确已回落（复核当下
  `load average: 4.91, 11.90, 11.10`，1 分钟负载 4.91 < 16 核），且本轮**不会再撞那个 flake** —— 因为
  本任务 delta 已空，fan-in 的 delta 判定走 **doc-only ⇒ 跳过全量 suite**（`worker-driver.ts:4651`
  「doc-only 跳过 suite」；`merge-base(develop,HEAD)` = develop tip `518787b7c`，`git diff --name-only
  <fork> HEAD` 为空）。⇒ 「再跑一轮看 flake 是否复现」这个实验已无对象。
- **真因（比 flake 严重，且与实现无关）**：本任务要修的那两处代码已在 develop 上被人裁定删除
  （详见 Evidence 末条）。本分支现在对 develop 的实际改动 = **0 个文件**。
- **⛔ 不要重派 worker**：没有任何可实现的缺陷 —— 要修的 `release`/`sea-release` 两个 job 已不存在，
  把 `tag_name:` 加回去等于复活一条退役渠道。派 worker 只会重复得出同一结论。
- **请裁定**：本任务转 **`superseded`**（理由指向人 2026-09-16 裁定「取消 sea 和 npm release」与
  `gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead`）。若判 `done`，请连同
  「本任务补丁从未落地、性质由 develop 的删除+重写构造性获得」一并写入理由 —— ⛔ 不要留一个会让人
  以为 softprops→tag_name 补丁跑过的记录。
- 三条 AC 已由本 worker 从 `[x]` 改回 `[ ]` 并附注解（硬规则 3b；⛔ 未蹭 pass-external 标记，故 fan-in
  的 ac-precheck 会如实报红 —— 这是本态应有的可区分取值，不是待修的缺陷）。
## Needs-Human

**执行 2026-09-16T12:14:53.131Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 3 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：unclassified
- 失败步/判词：AC 未全勾（checked 0/3，剩余未勾 3）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：440a59af-2984-4037-af45-9495c7f3557f

## 人裁定（manager 会话，2026-09-16T12:30Z）

按本任务自己 Evidence 末条与「worker 第 3 次续跑」建议，转 superseded：要修的 `release`/`sea-release`
两个 job 已被 `gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead`（done）按人 2026-09-16
裁定（`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §11，取消 sea 和 npm release）
整段删除；本任务对 develop 的实际改动面 = 0 个文件（anti-drift 检查器已确认）。不判 `done`——避免把
develop 侧的删除+重写记成本任务补丁的落地功劳；本任务的 tag_name 补丁从未真正应用/运行过。
