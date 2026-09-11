---
id: gap-upgrade-entry-never-establishes-branch-model
title: 交付/升级入口 shipped quay-init.sh 从不建立分支模型——落地基线的 remedy 对真实用户不可达，升级后的旧项目结构性落不了地
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
goal_ac: AC-239
---
## Finding

**实测（2026-09-11，本机直连 orangevps 的 git 输出；⛔ 非推断）**

`gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing`（done）修好了**判定**与**一个入口**：
`packages/quay/src/branch-model.ts` 的 `classifyBranch` / `ensureBranchModel` 接进了 **TS `quay init`**
（`packages/quay/src/init.ts:427`），anti-drift 也改成报 `BASELINE-MISMATCH`（exit 3）而不是
「N violation(s)」。它给出的 remedy 逐字是 `quay init --force --adopt-branch-model`。

**但交付/升级路径跑的不是那个入口。** `plugin/scripts/verify-deliver-coldstart.sh` 的 AC-238 升级动作
跑的是 **shipped shell `plugin/scripts/quay-init.sh`**（SPEC §5 的部署/升级入口；`/quay:init` skill 走的
也是它）。该脚本对 `adopt` 的 `grep` 命中数 = **0**；它对分支模型唯一做的事是往 config 里写一行
`fork_baseline: develop`（`plugin/scripts/quay-init.sh:995` / `:2217`），**既不判定该 ref 是否存在、
也不判定它接不接主线、更不建立它**。

⇒ 同一条原则（「不接主线的 develop 不能当落地基线」）存在**两个入口**，只修了一个；而没修的那个正是
**真实用户升级旧项目时走的那个**（硬规则 5b：修好一个 ≠ 只在那一处）。

**真机直接量 —— 三份升级副本全部同形**：

| 副本（orangevps `$HOME`） | 默认分支 | develop | `merge-base --is-ancestor main develop` | develop 上 `tasks/*.md` |
|---|---|---|---|---|
| `quay-verify-upgrade-9eda8c70-root`（AC-238 已通过） | main | d95dac8 | **FALSE** | 0 |
| `quay-verify-upgrade-1c202737-root`（AC-238 已通过） | main | d95dac8 | **FALSE** | 0 |
| `quay-verify-upgrade-289a49dc-root`（AC-238 已通过） | main | d95dac8 | **FALSE** | 0 |

`git merge-base --is-ancestor main develop` = FALSE 就是 `branch-model.ts` 的兼容性谓词本身
⇒ `classifyBranch(develop)` = **divergent** ⇒ 三份副本的 `develop` **全部不可用作落地基线**。
（三份副本均无 `origin/HEAD`、无 `master`，`develop` 停在 d95dac8 / 2025-10-14，其 mrge-base 之后
main 前进了 553–589 个提交。）

**后果不止本任务的人工任务**：同一个副本上，meta-cc **自己既有的** `DIR-100` 也以同一形态失败 ——
`.quay/fan-in-DIR-100-wk-prod-1789111230.log`：
`{"step":"anti-drift","exit":1,"reason":"ANTI-DRIFT HARD FAIL: task DIR-100 — 1566 violation(s)"}`
（2026-09-11T08:37:47Z，与人工任务 ac239 的 08:14:29Z 同形）。即**该副本上任何任务都落不了地**。

**为什么 remedy 到不了用户手里**：`ensureBranchModel` 目前唯一的 CLI 面是 `quay init`，而 `quay init`
非 dry-run 时会**重写整个 config 面**（`generateConfigContent`）。一个有既有 `gates:` / `loop:` /
`routines:` 的旧项目跑它就是**配置被清空** —— 而这恰恰是 `quay-init.sh` 那条「已有 config ⇒ 配置保留
分支」刻意避免的事（`bound: delivered-vendor` 的升级语义也建立在这条上）。
⇒ 在旧项目上，用户**没有**一条既能建立分支模型、又不毁掉自己 config 的路。

## Proposal

方向（⛔ 具体落点由执行者按源码实际形态定，本段不是预设结论）：

1. **让 shipped `quay-init.sh` 走单一判定源**：⛔ 不要在 shell 里重实现 `classifyBranch`（ADR-004 单一
   来源），而是由它调用交付物的 `branch-model` 面。缺的是一条**只做分支模型、不碰 config 面**的入口
   （形如 `quay init --dry-run` 之外的 `--branch-model-only`，或在 `quay-init.sh` 的 config-preserving
   分支里调用同一个函数）。
2. **该路径要有可区分的取值**：divergent 且未给 adopt 决定 ⇒ 拒绝并打印 remedy（fail-closed，与 TS
   `quay init` 同形）；给了 ⇒ adopt（旧 tip 保留为 `<branch>-pre-quay-init-<sha>`，零销毁）。
3. **修好的可核判据**：本机的 `verify-deliver-coldstart.sh` ⑦b 已有落地基线前置
   `AC239_BASELINE_STATUS`（compatible / divergent / absent / unreadable）；修好后它应从 `divergent`
   翻成 `compatible` —— 那就是「修好了」的读数，⛔ 不是「我加了个 flag」。

## Acceptance Criteria

- [ ] AC1 shipped `plugin/scripts/quay-init.sh` 在目标项目的 `develop` 不接主线时**不再静默放过**：
      留下可核痕迹（拒绝并打印 remedy，或按显式 adopt 决定修复），且判定来自**单一实现** —— 用
      `grep -c` 证明 shell 侧没有第二份 `merge-base --is-ancestor` 之类的手搓判定（命中数为 0 或
      指出那唯一一处并说明为何它不是第二份实现）。
- [ ] AC2 夹具实测（默认分支 `main` + `develop` 是不接主线的分叉）：默认 ⇒ 升级动作**拒绝**且
      `.quay/config.yml` **逐字未变**（前后 sha256 相同）；带 adopt 决定 ⇒ `develop` 被重指到 main tip
      且旧 tip 保留为 `develop-pre-quay-init-<sha>`。两条真实输出（含退出码）贴回本任务。
- [ ] AC3 端到端翻转：同一夹具上，升级动作之后 `verify-deliver-coldstart.sh` ⑦b 的
      `AC239_BASELINE_STATUS` 由 `divergent` 翻成 `compatible`（真实输出贴回；⛔「我加了个 flag」不算）。
- [ ] AC4 负控制：`develop` 本来就兼容（main 是它的祖先）时，升级动作**不**做任何 branch 变更
      —— `git rev-parse develop` 前后逐字相同，且 AC1 的拒绝分支不触发。

## Definition of Done

- [ ] 修的是**产品路径**（shipped `quay-init.sh` 或它调用的交付物面），⛔ 不是给 e2e / 验证器加一条绕过。
- [ ] AC3 的翻转是在**真机升级副本**上读出来的（本任务已给出三份副本的 `divergent` 读数作为 before）。
- [ ] 硬规则 5b 产物：把「分支模型必须在入口处建立」这条原则的其它适用点 grep 一遍，命中数与前 3 条
      贴进提交；命中数写不出 ⇒ 视为只修了被报出来的这一个。

## Touches

- `plugin/scripts/quay-init.sh`
- `packages/quay/src/cli/init.ts`
- `packages/quay/src/branch-model.ts`
- `packages/quay/test/branch-model.test.mjs`
- `tasks/gap-upgrade-entry-never-establishes-branch-model.md`
