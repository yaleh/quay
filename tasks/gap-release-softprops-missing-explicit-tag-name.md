---
id: gap-release-softprops-missing-explicit-tag-name
title: release.yml 两处 softprops/action-gh-release 都没传 tag_name，隐式依赖 dispatch ref 上下文
status: ready
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

- [x] `release` job 与 `sea-release` job 的两处 `softprops/action-gh-release@v2` 步骤，`with:` 均含
      `tag_name: ${{ inputs.tag }}`。
- [x] 负控制（结构性，非真跑一次 release）：`grep -cF 'uses: softprops/action-gh-release' .github/workflows/release.yml`
      与 `grep -cF 'tag_name: ${{ inputs.tag }}' .github/workflows/release.yml` 两个计数相等——每一处
      softprops 调用都配了显式 tag_name，不是只修了其中一处。
      （`-F` 必需，见 Evidence「仪器修正」：该模式含 `$` 与 `{}`，双引号下 bash 报 `bad substitution`
      使 grep 根本没跑，单引号+BRE 下恒 0——两种写法均已用【已知为真】样本干跑证伪。）
- [x] 若本任务着陆时机允许一次真实 dispatch 验证：`gh workflow run release.yml -f tag=<existing-tag>`
      **不传 `--ref`**（刻意复现本任务描述的误用场景）也能正确挂载到该 tag 的 Release 上，不再报
      "GitHub Releases requires a tag"。（若无法安排真实 dispatch，负控制那条静态检查已经是可核实的
      最低门槛，不阻塞本任务落地。）

## DoD

`.github/workflows/release.yml` 落地后，即便未来有人（人或脚本）dispatch 时漏传 `--ref`，release 产物
依然会挂到 `inputs.tag` 指定的那个 tag 上，不再需要调用方自己记得两个参数都要传对。

## Evidence

- 实现：`release.yml` 两处 `with:` 均含 `tag_name: ${{ inputs.tag }}`（line 165 / line 354）；两处各带
  解释性注释（为什么不能再依赖 dispatch ref）。
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
- **本轮续跑（处置前两轮 exited-not-landed）**：
  - ① 上一轮 suite 红（真因日志 `fan-in-suite-...~1789549690367-23cef8.log`：`STATIC_CHECK_FAILED:
    quay-init-closure-ratchet-stale exit=1`，`# tests 0 / # fail 10` —— 0 个测试跑到，静态面即中止）
    由本分支既有重锚提交处置；合并 develop 后在本 worktree 复跑
    `quay-init-closure-ratchet.ts --check-stale` = `PASS: … laydown source fingerprint fresh
    (233a7b2fd39d5a31…, 4 sources) — baseline in sync`、exit 0。
  - ② 上一轮 `step=ff: fan-in-ff-merge: FF FAILED — not a fast-forward` 是**分支落后**（develop 前进），
    非代码缺陷：本轮 `git merge --no-edit develop` **无冲突**成功（合入 24 个提交），分支不再落后。
  - ③ 合并后跑 fan-in 同一条 scoped 门（`scripts/test.sh --for-task gap-release-softprops-missing-explicit-tag-name
    --allow-thin`）**exit 0**：选择器取 0 个测试文件（thin 允许，全量仍在 fan-in 跑），静态面全 PASS
    ——含直接读 `release.yml` 的 `advance-master.needs` 检查（7 个 job，6 个被 needs 覆盖，0 个漏）。
- **AC3 明示取 fallback 分支**：本轮**未安排真实 dispatch**。`.quay/ci-runs.jsonl` 中 `Release` 类记录里，
  本缺陷复现 run = `35075347245`（08:43:26Z, branch=`develop`, cancelled），其后最新一条 =
  `35076017292`（08:50:36Z, branch=`v0.7.1` = 正确传了 ref 的那次, failure，与本事象不同因）。
  修复未落地前**不存在「已修后的真实 dispatch」** ⇒ 依 AC3 自带条款以静态负控制为准，不阻塞落地。

## Touches

- .github/workflows/release.yml
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-release-softprops-missing-explicit-tag-name.md
