---
id: gap-it0-dep-done-iff-deps-blind-to-superseded
title: it0-split-or-commit-check 的 DEP-DONE-IFF-DEPS 对
  superseded（退役依赖）没有第三取值——done 任务的退役前置与"没做完"同形输出，全店不变式因此在静态层 fail-closed，使每一个提交的
  CI 恒红并阻塞 release
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

**机制**：`plugin/scripts/it0-split-or-commit-check.ts` 的 `DEP-DONE-IFF-DEPS` 规则要求「一个 `done` 任务的**全部** `depends_on` 都是 `done`」，**没有第三个取值**——一条指向 `superseded`（终态：前提被人裁定退役）的依赖，与「依赖尚未做完」**共用同一输出**（都是 violation）。这正是硬规则 3b 的形态：**不可满足**被伪装成**尚未满足**。

**生产读数（2026-09-24 立案当轮，全部为直接量）**：

```
$ bash plugin/scripts/it0-split-or-commit-check.sh <repo-root>
FAIL: 1 split-or-commit violation(s) found:
  - DEP-DONE-IFF-DEPS: task "gap-ac194-production-criterion-owner" is done but has 1 non-done
    prerequisite(s) in depends_on:
    gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check (status: superseded)
exit=1
```

- 该规则是**全店不变式**，注册在 `scripts/test.sh` 的静态层 ⇒ **每一个提交**的 CI 都在静态层 fail-closed（CI 日志逐字：`STATIC_CHECK_FAILED: it0-split-or-commit-check exit=1` → `checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed)`），`node --test` 一行都没跑（`Run tests` 38s 即退出）。develop CI 自该 fan-in 起恒红，release 被阻塞。
- 全店扫描（2415 个任务，`status` + `depends_on` 全量配对）：**只有 1 对**。

**这是硬规则 5b 的成簇形态，不是一次意外**：同一原则在本仓**已经修过两条路径**——

- 散文路径：`plugin/scripts/ready-pool-check.ts` 的 `prosePrereqRefs` 的 `add()` 逐字写着「A retired task (`superseded`) is not a current-prereq target — its successor carries the real dependency」，并与 `done` 一起排除出 gap 集；
- 关系边路径：`plugin/scripts/driver-filters.ts` 的 `judgeDeps`（三值：`done` / `superseded`（退役，**不阻塞**，⛔ 不等于 done）/ 其它（阻塞）），且 `ready-pool-check.ts` 已 import 它（AC152）。

**第三个消费者（本 checker）没有跟上**：`grep -c superseded plugin/scripts/it0-split-or-commit-check.ts` = **0**。

⚠️ **一个必须由实现者判定的设计岔口（⛔ 不要默认选边，选定后把理由写进结论）**：

- **读法 A（推荐：与既有两个路径一致）**：退役依赖是**独立的第三态**——不阻塞，也 ⛔ 不等于 done ⇒ 规则放行 retired，同时对「真正没做完」继续 fail-closed。
- **读法 B**：本 checker 的严格性是**故意的数据卫生闸**（一条 done 任务不该留退役边，应由后继承担）⇒ 那么正确动作不是豁免，而是把**输出升级为可执行的修复指引**（指名后继任务 id），并保留 fail-closed。

两种读法都要求同一件事：**输出必须能区分「退役」与「没做完」**（硬规则 3b）。选 B 时 ⛔ 不得把 retired 静默当成 done（那会把「它的前提没了」伪装成「它的前提做完了」）。

## Plan

1. 把该规则的判定改为**三值**，⛔ 不新写一份判定逻辑：优先复用 `driver-filters.ts` 的 `judgeDeps`（`ready-pool-check.ts` 已是同一做法）；若该 import 会造成新的环或反向边（`plugin/scripts/import-graph-check.ts` 会拦），则在同文件内实现**同一口径**，并在注释里指名它 mirror 的来源。
2. `--selftest` 补两个方向的自证 fixture（ADR-018 selfcheck-fixture 模式）：① done 任务的依赖是 `superseded` ⇒ 按选定读法给出**可区分**的输出；② done 任务的依赖是 `todo` / `needs-human` ⇒ **仍然 violation**（负控制：豁免不得扩成「任何非 done 都放行」）。
3. 生产读数落地：对真实 repo root 跑一次，确认处置与选定读法一致。

## AC

- AC1 三值可区分：fixture「done 任务的 depends_on 含一条 superseded」⇒ 输出中出现**独立的** retired 读数，⛔ 既不与 `done` 合并、⛔ 也不与 blocking 合并。
- AC2 负控制·真样本仍红：同一 fixture 把该依赖换成 `todo` ⇒ **exit 1**，且 violation 指名该依赖。
- AC3 负控制·谓词对已知为真样本干跑（硬规则 2 的零计数半边）：对当前生产 root 跑，读数与 AC1/AC2 的口径一致。
- AC4 回归守卫：`bash plugin/scripts/it0-split-or-commit-check.sh <repo-root>` 在真实仓库上 **exit 0**。⚠️ 该条在数据侧修复之后**本就为绿** ⇒ ⛔ **不得**把它当作"机制生效"的证据（硬规则 4 推论三），机制生效的证据是 AC1/AC2/AC5。
- AC5 mutation case 仍能取假：`bash plugin/scripts/checker-mutation-cases/it0-split-or-commit-check.sh <workdir>` 通过；且**把新规则改坏（注入缺陷）时它必须转红**——⛔ 一个永不红的 mutation case 不是测量。

## DoD

- REAL LANDING：本 checker 在**生产仓库**上 exit 0，**且** mutation case 仍能取假（AC5），**且**本文件/帮助/注释里对该规则的描述与三值口径一致（⛔ 不留一处仍写着"必须全部 done"的旧措辞——硬规则 5b）。
- ⛔ 不以「fixture 绿了」为落地。

## Touches

- plugin/scripts/it0-split-or-commit-check.ts
- plugin/scripts/checker-mutation-cases/it0-split-or-commit-check.sh
- tasks/gap-it0-dep-done-iff-deps-blind-to-superseded.md

(If the implementer must also write a test file to satisfy AC5, they update `## Touches` at dispatch time rather than the file list above being guessed wider here.)