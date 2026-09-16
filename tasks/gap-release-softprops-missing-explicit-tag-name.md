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
- [x] 负控制（结构性，非真跑一次 release）：`grep -c "uses: softprops/action-gh-release" .github/workflows/release.yml`
      与 `grep -c "tag_name: ${{ inputs.tag }}" .github/workflows/release.yml` 两个计数相等——每一处
      softprops 调用都配了显式 tag_name，不是只修了其中一处。
- [x] 若本任务着陆时机允许一次真实 dispatch 验证：`gh workflow run release.yml -f tag=<existing-tag>`
      **不传 `--ref`**（刻意复现本任务描述的误用场景）也能正确挂载到该 tag 的 Release 上，不再报
      "GitHub Releases requires a tag"。（若无法安排真实 dispatch，负控制那条静态检查已经是可核实的
      最低门槛，不阻塞本任务落地。）

## DoD

`.github/workflows/release.yml` 落地后，即便未来有人（人或脚本）dispatch 时漏传 `--ref`，release 产物
依然会挂到 `inputs.tag` 指定的那个 tag 上，不再需要调用方自己记得两个参数都要传对。

## Evidence

- 实现：`release.yml` 两处 `with:` 均含 `tag_name: ${{ inputs.tag }}`（line 165 / line 354）；
  AC2 的结构性负控制实测 `grep -c "uses: softprops/action-gh-release"` = `grep -c "tag_name: ${{ inputs.tag }}"` = 2。
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

## Touches

- .github/workflows/release.yml
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-release-softprops-missing-explicit-tag-name.md
