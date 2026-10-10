---
id: gap-release-workflow-definition-lags-one-release
title: release-cut 的 dispatch 不带 --ref ⇒ 每次发布跑的是上一版的 release.yml（v0.18.0 首次生效的门因此失败）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：v0.18.0 发布事故（2026-10-10）。切版后 release.yml 连续多次失败，其中**第一次失败的那道门本不该在这次首次执行**。

**机制（按位置）**：`plugin/scripts/release-cut.mjs:497` 的 dispatch 是 `gh workflow run release.yml -f tag=<tag>`，**不带 `--ref`**。`workflow_dispatch` 在无 `--ref` 时执行**默认分支 master** 上的 workflow 文件；而 master 只在**上一次发布成功收尾**时由 `advance-master` 推进 ⇒ **发布 N 恒被 N−1 版的 workflow 定义把关**。

**实证**：v0.17.0 的 run `37620677788` 的 `verify-plugin-channel` **只有 13 步、无 assertions 步**，而 v0.17.0 树里的 release.yml **已含**该步（`grep -c verify-plugin-channel-assertions` = 2）⇒ 它跑的是更早的 v0.16.0 版（该版计数为 0）。v0.18.0 的 run 才第一次执行该步并失败。两版 release.yml 的真实差异：`git diff v0.17.0 v0.18.0 -- .github/workflows/release.yml` = **14 insertions / 13 deletions**。⛔ 比较时用 `origin/master` 或直接引 tag——本机 `master` 是**过期 ref**（本次排查中实测踩过，一度得出错误量级）。

**两个不同危害**：
- (a) **发布时刻才首次执行**：`.github/workflows/ci.yml` **完全不跑** `verify-plugin-channel-assertions`（实测 grep 为空）⇒ 这道门的首次执行永远是某次真实发布。
- (b) **自锁**：若坏的是 release.yml **自身**，修它无效——修复不在 master 上，而 master 因发布被卡而推不动。本次能救回纯属故障在 release.yml 之外（runner 环境）。

**三条改进**：
- **P1** 显式化 ref：`run("gh", ["workflow","run","release.yml","--ref", tag, "-f", \`tag=${tag}\`], …)`，并同步 `:392`（dry-run 打印）与 `:493`/`:501` 两处失败/提示文案——否则文案与行为不一致。取值二选一（**需人裁定**）：`--ref <tag>` = 门与产物绑定、同一 tag 重派得到同一判定（与 release.yml 自身的 IDEMPOTENCY 契约一致），代价是 tag 不可变、坏门只能回退或重切；`--ref develop` = 门是当前主干、可向前修（推 develop 后重派同一 tag），代价是门与产物不绑定。
- **P2** preflight 可见性：取**将要供给 workflow 的那个 ref** 上的 release.yml 与**该 tag** 上的同名文件比对，打印 diffstat，有差异即拒绝（或要求显式确认）。这是硬规则 9 的形态：让"实际会生效的定义"可见，而不是靠默认分支语义隐含。
- **P3** 把门接进 CI：让 `verify-plugin-channel-assertions` 在 develop 上被**定期**执行（夜间/定时，非逐 PR——它需要真实安装），使"某道门第一次执行就是一次真实发布"这个类整体消失。

## AC

- [ ] AC1: `--ref` 取值由人裁定为 `tag` 或 `develop`，裁定结论写入本任务（待外部）
- [ ] AC2: `release-cut.mjs` 的 dispatch 显式带 `--ref`（按位置判定：该 `gh workflow run` 调用点含 `--ref` 参数），且 dry-run 打印与两处文案同步更新
- [ ] AC3: preflight 打印"将生效的 workflow 定义"与 tag 上同名文件的 diffstat，二者不一致时拒绝（负控制：构造一次不一致，必须拒绝）
- [ ] AC4: `verify-plugin-channel-assertions` 在 develop 上被 CI 定期执行（正控制：一次成功运行；负控制：注入一个必失败断言，CI 必须变红）
- [ ] AC5: 变异对照——把 P2 的比较改成"永远相等"，必须有一条测试变红

## DoD

真实落地：一次**真实**切版中，dry-run/preflight 输出**如实显示**"将生效的 workflow 定义来自哪个 ref、与 tag 差异多少"；且 P1 落地后，任何 release.yml 的改动**不再延迟到下一版才生效**（用一次真实切版或等价端到端演练证明）。仅"测试存在"不算达标。

## Touches

- plugin/scripts/release-cut.mjs
- plugin/test/release-cut.test.mjs
- .github/workflows/ci.yml
- tasks/gap-release-workflow-definition-lags-one-release.md