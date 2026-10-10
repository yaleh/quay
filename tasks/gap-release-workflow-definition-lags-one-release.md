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
- **P1** 显式化 ref：

```
run("gh", ["workflow", "run", "release.yml", "--ref", tag, "-f", `tag=${tag}`], …)
```

并同步 `:392`（dry-run 打印）与 `:493`/`:501` 两处失败/提示文案——否则文案与行为不一致。取值二选一（**需人裁定**）：`--ref <tag>` = 门与产物绑定、同一 tag 重派得到同一判定（与 release.yml 自身的 IDEMPOTENCY 契约一致），代价是 tag 不可变、坏门只能回退或重切；`--ref develop` = 门是当前主干、可向前修（推 develop 后重派同一 tag），代价是门与产物不绑定。
- **P2** preflight 可见性：取**将要供给 workflow 的那个 ref** 上的 release.yml 与**该 tag** 上的同名文件比对，打印 diffstat，有差异即拒绝（或要求显式确认）。这是硬规则 9 的形态：让"实际会生效的定义"可见，而不是靠默认分支语义隐含。
- **P3** 把门接进 CI：让 `verify-plugin-channel-assertions` 在 develop 上被**定期**执行（夜间/定时，非逐 PR——它需要真实安装），使"某道门第一次执行就是一次真实发布"这个类整体消失。

**P3 前提修正（2026-10-10）**：P3 原设想"把这道门接进 CI、在 develop 上定期跑"**不成立**——`verify-plugin-channel-assertions.ts:201` 要求 "none may carry a `-dev` suffix"，而 `scripts/resolve-version.ts` 对非 `release/*` 分支且 HEAD 无版本 tag 的产物返回 `X.Y.Z-dev`（v0.18.0 那次能过，只因为产物是在 tag 上构建的）。故 AC4 已改写为"接线存在 + 真实读数被如实记录"，而"nightly 该从哪个 ref 构建产物 / 这道门该不该容忍非发布渠道的 `-dev`"作为**开放设计问题**保留，⛔ 不在本任务内擅自裁定。

## AC

- [ ] AC1: `--ref` 取值**已由人裁定为 `tag`**（人 2026-10-10），且 `release-cut.mjs` 的 `--dispatch-ref` 默认值与之相符（实现已做成该 flag、默认即 `tag`；本 AC 现只需核实默认值与裁定一致）
- [x] AC2: `release-cut.mjs` 的 dispatch 显式带 `--ref`（按位置判定：该 `gh workflow run` 调用点含 `--ref` 参数），且 dry-run 打印与两处文案同步更新 —— 已落地：调用点为 `run("gh", ["workflow", "run", "release.yml", "--ref", dispatchRef, "-f", `tag=${tag}`])`；ref 由新 flag `--dispatch-ref <ref>` 选择（默认即 tag 本身，故默认把门绑定在产物上），dry-run 计划行与 `release-cut-dispatch-unavailable` / `-failed` 两处文案同步带同一 `--ref`。判定不靠 grep 源码：`P1/AC2: the REAL dispatch argv carries --ref` 用假 `gh` **记录真实 argv** 并按位置断言 `--ref` 与其取值相邻；`P1/AC2: with gh absent…` 断言手工补派文案带同一 `--ref`。
- [x] AC3: preflight 打印"将生效的 workflow 定义"与 tag 上同名文件的 diffstat，二者不一致时拒绝（负控制：构造一次不一致，必须拒绝） —— 已落地：preflight 打印 `preflight: the run will be governed by '.github/workflows/release.yml' at <ref>; vs '<base>': <numstat>`（tag 尚不存在，其树即 `--base` 的树，已在代码注释里说明），不一致即 `CAUSE=release-cut-workflow-definition-drift` 退出 2，`--allow-workflow-drift` 才显式放行且仍打印 diffstat。负控制 = 用例 `P2/AC3: a release.yml that DIFFERS at the dispatch ref is REFUSED`（fixture 造出真差异的 ref，必须拒绝，并断言 diffstat 逐字出现）。另有两个**独立取值**不与"相等"同形：`release-cut-dispatch-ref-unresolvable` / `release-cut-workflow-definition-unreadable`。
- [ ] AC4（2026-10-10 改写；原字面形态经证伪为**结构上不可满足**——该门要求非 `-dev` 产物，而 develop 产物必为 `-dev`，见 `## Evidence`）：CI 侧存在一条**可显式触发**的 `verify-plugin-channel-assertions` 接线（workflow 文件 + `workflow_dispatch`），且其**真实运行的读数被如实记录进本任务**（pass 或 fail 皆算达成，但必须是真实运行产出，⛔ 不是 fixture 回声）；负控制：注入一条必失败断言时该 job 必须变红。⛔ 构建所用 ref 作为**开放项**记录，不在本 AC 内裁定；⛔ 不得为使它变绿而放宽任何判据。
- [x] AC5: 变异对照——把 P2 的比较改成"永远相等"，必须有一条测试变红 —— 已实测（2026-10-10）：把 `const drifted = effectiveText !== shippedText;` 改成 `const drifted = false;`，`P2/AC3` 用例变红，证据行 `a drifted governing definition must REFUSE the cut: preflight: the run will be governed by '.github/workflows/release.yml' at drifted; vs 'develop': 0 insertions / 0 deletions (identical to 'develop')  0 !== 2`；改回后 12/12 复绿。

## DoD

真实落地：一次**真实**切版中，dry-run/preflight 输出**如实显示**"将生效的 workflow 定义来自哪个 ref、与 tag 差异多少"；且 P1 落地后，任何 release.yml 的改动**不再延迟到下一版才生效**（用一次真实切版或等价端到端演练证明）。仅"测试存在"不算达标。

## Evidence

**已实现并验证（P1 + P2）**：`plugin/scripts/release-cut.mjs` 的 dispatch 调用点带 `--ref <ref>`；dry-run 计划行与两处文案同步；preflight 打印将生效的 workflow 定义及其与 tag 树（= `--base`）的 diffstat，不一致即拒绝。`plugin/scripts/release-cut.sh` 头部（`--help` 正本）同步更新。scoped gate 绿（`scripts/test.sh --for-task gap-release-workflow-definition-lags-one-release --allow-thin` → exit 0）；anti-drift `ANTI-DRIFT OK — 3 actual file(s), all within declared Touches (5 glob(s))`。

**测试**：`node --test plugin/test/release-cut.test.mjs` 12/12 绿。新增 4 条用例按位置判定，不 grep 源码。⚠️ 其中 drift 用例的 PATH 上放了一个**假 `gh`**——实测该用例第一版在"拒绝"被变异掉时会打到**真实 GitHub API**（`HTTP 422: No ref found for: drifted`，repo yaleh/quay）；测试自身的失败模式不应是一次真实派发，故已隔离。

**AC1（待外部）**：`--ref` 取 `tag` 还是 `develop` 是人裁定项。本实现把两者都做成一个 flag，默认 `tag`（门绑定产物、同一 tag 重派得同一判定）；裁定后改默认值即可，无需改实现。

**AC4 未落地 —— 且它的两条判据都不在本 worker 可诚实取得的证据范围内**（留待作者/人裁定；本 worker ⛔ 不自行给 AC 加标注，也不自行加无人值守的 nightly）：

1. **照字面读不通（已实测，非注释转述）**：`verify-plugin-channel-assertions` 断言版本载体"不带 `-dev`"，而 `resolveVersion(VERSION,'build')`（`scripts/resolve-version.ts:215-229`）在非 `release/*` 且 HEAD 无版本 tag 时返回 `X.Y.Z-dev` —— 实测 `resolveVersion("0.18.0",{mode:"build",branch:"develop"})` ⇒ `0.18.0-dev`，`branch:"release/v0.18.0"` ⇒ `0.18.0`。⇒ **从 develop 构建的 channel 永远过不了这道门**，"在 develop 上被 CI 定期执行"只能取"**job 定义在 develop 上、定期跑，产物取自一个 release-form 的 ref（如最新 tag）**"这一读法 —— 而"取哪个 ref"本身是要拍板的选择。
2. **按该读法落地，新增的是一处无人值守的 nightly**：要在共享自托管 runner（tokyo-alpha）上 `npm install -g @anthropic-ai/claude-code`、真实安装插件、起 driver 与 server。加不加、用哪个 ref 构建、是否与 release.yml 的 `verify-plugin-channel` job 去重，都是需要人决定的运维动作；本任务 AC1 本身就在等人裁定，说明人已在此环内。
3. `publish-plugin-dist.yml` 已被 2026-09-14 人裁定为"只能显式发布、**不得隐式触发**"（其头部原话），定时发布这条路不可取。
4. AC4 的两条判据（真实 CI 的绿/红各一轮）都是**落地后外部验证**；而新 nightly 的首次执行本身就是本任务要消灭的那一类"首跑即真实发布"。

**建议**：P1/P2 可先行落地；P3 单独立项、由人决定形态（含"哪个 ref 构建产物"与"是否去重 release.yml 的 job"）后再实现其两条控制。


**本轮复核（2026-10-10）——AC4 是本任务唯一的落地阻塞，而它不是 worker 能关闭的**：

- **权威判据**（fan-in 真正跑的那道闸，不是正则推断）：`node --experimental-strip-types plugin/scripts/fan-in-ac-completion-gate.ts --task gap-release-workflow-definition-lags-one-release --worktree <wt> --json` ⇒ `{"ok":false,"status":"fail","total":5,"checked":3,"unchecked":2,"message":"AC 未全勾（checked 3/5，剩余未勾 2 含非待外部项）——未翻 done"}`。AC1 因末尾 `（待外部）` 被排除；报错里那个"非待外部项"就是 **AC4** ⇒ AC4 保持现状则本任务**永远不能翻 done**，worker 每次续做都只能原样退出。
- **AC4 照字面在 develop 上不可能通过**（本轮读代码复核）：`scripts/resolve-version.ts:224` 对"非 release/* 分支且 HEAD 无版本 tag"返回 `` `${parsed}${DEV_SUFFIX}` ``；`plugin/scripts/verify-plugin-channel-assertions.ts:217,228` 的 `judgeVersionConsistency` 用 `/-dev\b/` 判 **FAIL** ⇒ 从 develop 构建的 channel 过不了这道门，"正控制：一次成功运行"无法由 develop 提供。
- **也没有可回放的历史载体**：assertions 调用步在 tag 上的出现次数 = v0.16.0:0、v0.17.0:2、v0.18.0:2，而 v0.17.0 那次 run 只跑 13 步（执行的是 v0.16.0 的定义）⇒ 该步**从未有一次成功运行**可引为绿读数；两条控制臂都只能来自新 nightly 上线之后。
- **需要的裁定（三种都是作者/人的动作；worker 自改 AC 文本或自加外部标注均被禁止）**：①把 AC4 改写成在任务内可取的形态；②给 AC4 加外部标注；③把 P3 拆成独立任务，让本任务凭 P1/P2 + AC1 的裁定先落 develop。⛔ 本轮**不勾 AC4、不改 AC 文本、不动 status**。
- **本轮复绿读数**：`node --test plugin/test/release-cut.test.mjs` 12/12；`scripts/test.sh --for-task gap-release-workflow-definition-lags-one-release --allow-thin` ⇒ exit 0；worktree 与 develop 无分叉、无未合并路径；P1/P2 实现未再改动（分支上仍为那 3 个文件）。
**第三轮复核（2026-10-10，续做 worker）——阻塞不变；本轮已发出带外升级通知**：`fan-in-ac-completion-gate` 仍报 `checked 3/5，剩余未勾 2 含非待外部项`（AC1 因末尾 `（待外部）` 被排除 ⇒ 点名的就是 AC4）。本轮**未**改 AC 文本 / **未**自加 `（待外部）` / **未**动 `status:`（均为 authoring 动作，worker 禁止）；已完成可做的机械部分：`git merge develop` 无冲突、`scripts/test.sh --for-task … --allow-thin` exit 0（12/12）、scoped-gate cache 已写、anti-drift OK（4 文件 ⊆ 5 条 Touches）。⇒ **AC4 维持现状时本任务结构性不可落地**，worker 每轮只能原样退出（前两轮）或完成机械部分后退出（本轮）。待裁定同上一轮：①改写 AC4 为任务内可取形态；②给 AC4 加 `（待外部）`；③把 P3 拆成独立任务，让本任务凭 P1/P2 先落 develop。
## Touches

- plugin/scripts/release-cut.mjs
- plugin/scripts/release-cut.sh
- plugin/test/release-cut.test.mjs
- .github/workflows/ci.yml
- tasks/gap-release-workflow-definition-lags-one-release.md
## Needs-Human

**执行 2026-10-10T06:39:36.186Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：AC 未全勾（checked 3/5，剩余未勾 2）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：0952dc6e-fa8d-4613-90be-0866815dd336
