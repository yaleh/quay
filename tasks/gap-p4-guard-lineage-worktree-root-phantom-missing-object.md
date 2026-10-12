---
id: gap-p4-guard-lineage-worktree-root-phantom-missing-object
title: P4 聚类 `P4-missing-guard-object` 是 worktree root 幻影——quality-gate-driver 在
  task worktree 根跑 guard-lineage，gitignored 运行时载体（tick log）被读成 MISSING 而非
  not-evaluated
status: todo
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

**Defect (在流水线，不在守卫)。** 架构复核的 P4 聚类 `P4-missing-guard-object`（`plugin/scripts/architecture-review-cluster.ts:213`，round 2592 / 2026-10-12）在**任务 worktree 根**上触发，点名两个已声明的文件对象：

- `file:orchestration/manager-tick-log.md`（`manager-tick-log-check.sh` 声明，`plugin/scripts/capability-catalog-declarations.json:405`）
- `file:orchestration/tick-log.md`（`outer-tick-log-check.sh` 声明，`plugin/scripts/capability-catalog-declarations.json:407`）

两者都是 **gitignored 运行时遥测载体**（`.gitignore:542`、`.gitignore:549`）。新鲜的 `git worktree add` 结构上就不含它们。而在主检出上跑 `guard-lineage-check.ts --root <主检出>` 报**两者 PRESENT**——没有任何东西真的缺失。该聚类是幻影。

**机制。** `plugin/scripts/quality-gate-driver.ts` 以 `guard-lineage-check.ts --root <root> --json` spawn P4 谱系步骤（`defaultGuardLineageArgv`，约 600 行），其中 `root` 是本轮的根——架构复核从任务 worktree 跑时 `root` 就是该 worktree。`guard-lineage-check.ts` 的 `checkObjectPresent()`（137-142 行）是**二值**的：`present: existsSync(path.join(root, dec.filePath))`，`note: exists ? "object present" : "object MISSING"`。对一个「因为 root 是 worktree 才缺席」的已声明对象，**没有 not-evaluated 态**。随后 `clusterLineageReport`（architecture-review-cluster.ts:212-220）过滤 `d.present === false` ⇒「在本 root 下结构上不可得」与「守卫对象真被删除」不可区分。

这正是 casebook 硬规则 3b 所禁的形态：判定机件*读不懂/无法评估*的输入，以与确定性否定同形的方式返回。代价：每个 worktree 轮都产出形似 ACTIONABLE 的幻影聚类，消耗 judge/轮预算于非缺陷；更糟的是同一盲点会掩盖一次*真*删除——只要它也是 gitignored 载体。

**修法（实现方选，本立案不指定实现）：**
① 让架构复核的 P4 谱系步骤在**主检出根**上跑——本仓库已有 `QUAY_MAIN_CHECKOUT` 先例（已落地的同类任务 `gap-gitignored-carriers-absent-in-verify-worktree` 用 `full-suite-runner.ts` + `scripts/test.sh` 修了*套件*检查器的同类缺陷）；和/或
② 给 `checkObjectPresent()` 第三态——一个**gitignored 运行时载体**的已声明 `file:` 对象读成 `present: null` + not-evaluated note，而非 `MISSING`——并让 `clusterLineageReport` 不把 `null` 计为 missing。

⛔ **不是修法**：改这两个守卫的声明、删掉聚类定义、或放宽 P4 suspicious-guard 规则。守卫与其声明对象是对的——两个守卫覆盖*不同*的 tick log（`manager-tick-log.md` vs `tick-log.md`），此处**没有**复制/合并债。judge 判的是 `coincidental`；可执行的缺陷是制造它的流水线。

<!-- dedup-ref -->
与 `gap-gitignored-carriers-absent-in-verify-worktree`（done）非重复：那条修的是同一*类*在**套件**检查器上的形态（`full-suite-runner.ts` + `scripts/test.sh`）；本条是**不同调用方**（`quality-gate-driver.ts`）与**不同消费者**（P4 谱系聚类），其落地不会抵达本 driver——保持分立。peer `gap-discovery-method-routine-interval-60m-temporary`（ready）的 Touches 也声明 `plugin/scripts/quality-gate-driver.ts`，但那是无关机制（60m routine 节奏）、验收独立——保持分立（该 peer 已 `ready` 即将派发）。

## AC

- [ ] AC1 回归测试证明幻影消失：对一条路径为 **gitignored / worktree 下不存在** 的已声明 `file:` 守卫对象，P4 报告不把它归类为 `missing`，`clusterLineageReport` 不因它单独发出 `P4-missing-guard-object`。命令 `node --test plugin/test/guard-lineage-check.test.mjs plugin/test/architecture-review-cluster.test.mjs` exit 0。
- [ ] AC2 反向控制（必须仍红）：一条**真被删除**的已声明 `file:` 守卫对象（受跟踪、非 gitignored）**仍然**报 `missing`，**仍然**发出 `P4-missing-guard-object` 聚类——修法不得把检测器对真删除弄瞎。贴真实输出。
- [ ] AC3 worktree 根上的端到端：从**任务 worktree 根**跑 P4 谱系步骤（或 `quality-gate-driver.ts` 的 `--once` 模式），两个 tick log 对象报 not-evaluated / 非 missing 且**不**发出 `P4-missing-guard-object` 聚类；同一命令在主检出根仍报两者 **PRESENT**。两份输出都贴。
- [ ] AC4 `scripts/test.sh --for-task gap-p4-guard-lineage-worktree-root-phantom-missing-object` 绿。

## DoD

对一条真实试跑（非 fixture）：修后从任务 worktree 根运行架构复核 P4 谱系步骤，不再发出点名 `orchestration/manager-tick-log.md` / `orchestration/tick-log.md` 的 `P4-missing-guard-object` 聚类，运行输出贴进任务体；主检出反向控制仍显示两对象 PRESENT。

## Touches

- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/guard-lineage-check.ts
- plugin/scripts/architecture-review-cluster.ts
- plugin/test/guard-lineage-check.test.mjs
- plugin/test/architecture-review-cluster.test.mjs
- plugin/test/quality-gate-driver.test.mjs
- tasks/gap-p4-guard-lineage-worktree-root-phantom-missing-object.md