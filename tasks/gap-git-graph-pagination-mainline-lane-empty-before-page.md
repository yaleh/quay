---
id: gap-git-graph-pagination-mainline-lane-empty-before-page
title: git-history 分页页 mainline 泳道恒空：layoutGitGraph 脊柱从 tip 起走而 before 页不含
  tip，滚动加载第一页即停
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra: {}
---
## Proposal

**实测（2026-09-09，`node --experimental-strip-types` 直调 `readGitHistory` + `layoutGitGraph` 对生产仓库 `/home/yale/work/quay` 复核）**：`/git-history.json` 的 `before=` 分页页，`branches[0].commits`（mainline 泳道）恒为 0——首屏 `mainline:develop:70`，第二页 `mainline:develop:0`，故客户端滚动加载第一页即停。

**根因（`serve-git.ts` `layoutGitGraph`）**：脊柱从 `spineRoot = heads[develop]`（develop 的 tip，来自 `for-each-ref`，不受 `before` 过滤）起走首父链 `while (cur && byHash.has(cur) && …)`。而 `before` 页的 mainline batch 是 `git log develop --before=<wm>`（严格老于游标）⇒ tip 不在 `byHash` ⇒ `byHash.has(tip)` 假 ⇒ 脊柱循环体一次都不执行 ⇒ `spineHashes` 空 ⇒ mainline 泳道空。

**叠加客户端效应（`serve-git.ts` `loadOlder`）**：`var older = next.branches[0].commits || []` 为空 ⇒ `finishOlder()`。这是 `gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag`（客户端自链死代码）之外的第二重缺陷——客户端自链已修（AC1–AC4），但服务端分页数据为空使其生产 DoD（连续加载 ≥3 页）仍不可达。

**修法方向**：主链 batch 改 `--first-parent`（`git log develop --first-parent -n <limit> [--before=<wm>]`），并让脊柱在 tip 不在 batch 时从 batch 内最新主链提交起走；侧枝（merge 第二父链）从 mainline batch 分离单独取数，避免破坏 `live`/`reconstructed` 泳道。

## Plan

1. `readGitHistory` 主链 batch 改为 `--first-parent`（分页与非分页同路径）；侧枝单独 fetch（`--not <mainlineRefs>` 或按 merge 第二父枚举），使 `byHash` 仍含侧枝提交。
2. `layoutGitGraph` 脊柱根 `spineRoot`：当 `heads[develop]`（tip）不在 `byHash` 时，回退到 batch 内最新主链提交（`--first-parent` 下即 batch 首个提交），使分页页脊柱非空。
3. 回归测试：直调 `readGitHistory` + `layoutGitGraph`，断言 `before` 页 `branches[0].commits.length > 0`，且连续三页合并后 mainline 泳道单调增长、侧枝泳道不减少。

## AC

- [x] AC1 分页页非空：`before=<首屏最老 t>` 直调 `readGitHistory` + `layoutGitGraph`，断言 `branches[0].commits.length > 0`（当前 = 0）。
- [x] AC2 连续三页单调增长：连调三页（cursor 逐页回退），合并 mainline 泳道后提交数单调增长且第三页非空。
- [x] AC3 侧枝不丢：`live`/`reconstructed` 泳道总数在分页前后不减少（`--first-parent` 主链分离不破坏侧枝）。

## DoD

生产 `/git-history.json` 上 `before=` 分页页 `branches[0].commits` 非空；`gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag` 的 AC5（Playwright 滚到底后行数至少增长两次）可被验证为真。

## Touches

- packages/quay/src/observation.ts（readGitHistory 主链 batch --first-parent + 侧枝分离）
- packages/quay/src/serve-git.ts（layoutGitGraph 脊柱根分页回退）
- packages/quay/src/serve-dashboard.ts（GitHistoryResult 加 mainlineHead 字段，fallback 对象补字段）
- packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs（本任务回归测试）
- tasks/gap-git-graph-pagination-mainline-lane-empty-before-page.md