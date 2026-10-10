---
id: gap-release-channel-assertions-periodic-ci-and-controls
title: P3（自 gap-release-workflow-definition-lags-one-release 拆出）：把
  verify-plugin-channel-assertions 接进 develop 上的定期 CI，交付正/负控制、拟发布 ref
  的产物一致性、release.yml job 去重决策与可复现验收
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**来源**：从 `gap-release-workflow-definition-lags-one-release` 拆出的 **P3**（人 yale 2026-10-10 裁定 ③）。原任务凭 P1/P2 先落 develop；P3 单独立案，**AC4 整体迁入本条**，不得以给 AC4 加 `（待外部）` 来绕闸。

**为什么必须拆**：原任务的落地闸 `fan-in-ac-completion-gate` 报 `checked 3/5，剩余未勾 2 含非待外部项`（AC1 因 `（待外部）` 被排除 ⇒ 点名的就是 AC4）。而 AC4「`verify-plugin-channel-assertions` 在 develop 上被 CI 定期执行（正控制：一次成功运行）」照字面**在任务内不可满足**，worker 三轮只能原样退出：

- `scripts/resolve-version.ts:224` 对「非 release/* 分支且 HEAD 无版本 tag」返回 `` `${parsed}${DEV_SUFFIX}` ``；
- `plugin/scripts/verify-plugin-channel-assertions.ts:217,228` 的 `judgeVersionConsistency` 用 `/-dev\b/` 判 **FAIL**。
- ⇒ 从 develop 构建的 channel 结构上过不了这道门；且该 assertions 调用步在 tag 上的出现次数 = v0.16.0:0 / v0.17.0:2 / v0.18.0:2，而 v0.17.0 那次 run 只跑 13 步（执行的是 v0.16.0 的定义）⇒ **该步从未有一次成功运行**可引为绿读数，两条控制臂都只能来自新定期 job 上线之后。

**已在分支上存在的 P3 代码（不丢弃）**：`task/gap-release-channel-assertions-periodic-ci-and-controls`（= 原分支 tip `0440ba0dd`）携带两个提交 —— `256a3c58e ci: dispatchable verify-plugin-channel-assertions job`、`0440ba0dd ci: add build_ref input to the dispatchable channel-gate job`，即 `.github/workflows/ci.yml` 上一个**可手动派发**的 job。本任务从该分支继续，不重写它。

**本期要交付**（P3 原文：把门接进 CI，让 `verify-plugin-channel-assertions` 在 develop 上被**定期**执行，夜间/定时、非逐 PR——它需要真实安装；使「某道门第一次执行就是一次真实发布」这个类整体消失）：

1. 把该 job 从「可手动派发」接成 **develop 上的定期执行**（夜间/定时）。
2. 交付**正控制**与**负控制**两条控制臂（见 AC）。
3. 明确**拟发布 ref 的产物一致性**：定期 job 跑的是拟发布 ref 的产物，不是 `-dev` 构建。
4. 就与 `release.yml` 既有两处 assertions 调用步（`:260` / `:294`）的关系作出**去重决策**并留机械判据。

⛔ 不改 `scripts/resolve-version.ts` 的 `-dev` 语义来「让 develop 也能过」——那会把「正式发布产物」与「开发构建」混为一谈，正是本任务要防的东西。

## AC

- [ ] AC1 正控制（承重）：develop 上的定期 job 有一次 `verify-plugin-channel-assertions` 的**成功运行**，给出可回放的 run 标识与日志；且该成功跑的是**拟发布 ref 的产物**（tag 或其等价），**不是** `-dev` 构建 —— 须能从日志读出被检产物的版本载体（`VERSION` / `plugin.json` / `quay --version` 三者一致且无一含 `-dev`）。
- [ ] AC2 负控制（承重）：注入一个**必失败**断言（或等价的确定性变异），同一 job 必须变红；还原后复绿。红/绿两次都要有 run 证据，且红必须落在被注入的那条断言上（不是「文件不存在」式的空洞红）。
- [ ] AC3 产物一致性：定期 job 的被检对象是**拟发布 ref 的产物**。人 yale 2026-10-10 裁定：`--ref` **默认取 `tag`**（把门绑在目标发行产物上）；`develop` 只用于**工作流定义的静态/预验证**，**不得把 `-dev` 当作正式发布**。验证：逐字给出 job 里决定被检对象的那段配置 + 一次运行日志里的版本载体读数。
- [ ] AC4 `release.yml` job 去重决策：明文写出 `.github/workflows/release.yml:260` 与 `:294` 两处 assertions 调用步与本定期 job 的关系（去重 / 分工 / 保留），决策写入本任务，并附机械判据（例如 `grep -c` 的逐字读数或 job 名唯一性断言）——⛔ 不接受只写散文而无判据。
- [ ] AC5 可复现验收：上述每条读数的**复现命令**逐字写入本任务（含如何触发一次运行、看哪个日志、断言哪一行），任何人可在同一 checkout 上重跑。⛔ 不得以「本地模拟 CI」替代真实 CI run 充当 AC1/AC2 的读数。
- [ ] AC6 范围受控：`git diff --name-only $(git merge-base HEAD develop) HEAD` ⊆ `## Touches`；不改 `scripts/resolve-version.ts`、不改 `verify-plugin-channel-assertions.ts` 的判定语义（若因去重决策必须改动，须在 AC4 的决策里点名并给出理由）。

## DoD

真实落地判据：**真实 CI 上**跑出正控制与负控制两条读数（run 标识可回放），而不是本地模拟；定期触发确实存在于 develop（不是只在某个分支上「可手动派发」）；去重决策有机械判据。未达标时如实声明「只做到可派发 / 未接定期触发」，不得声称已交付。

## Touches

- .github/workflows/ci.yml
- .github/workflows/release.yml
- tasks/gap-release-channel-assertions-periodic-ci-and-controls.md (self)

## Notes

- 起点分支 `task/gap-release-channel-assertions-periodic-ci-and-controls`（= `0440ba0dd`）已携带 P3 的可派发 job；本任务从它继续。
- 与 `gap-release-workflow-definition-lags-one-release` 的关系：该条负责 P1（dispatch 带 `--ref`）+ P2（preflight 打印将生效的定义并拒绝漂移），并把 **AC1 的裁定**（`--ref` 默认 `tag`）记录在案；本条负责 P3。
