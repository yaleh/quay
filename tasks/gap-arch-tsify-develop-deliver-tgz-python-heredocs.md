---
id: gap-arch-tsify-develop-deliver-tgz-python-heredocs
title: shell→TS（SPEC Phase 5.3 第一阶段）：develop-deliver-tgz.sh 的 10 个内嵌 python3
  heredoc 抽成独立 .ts，编排保留 bash
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-313
---
## Proposal

**SPEC-architecture-consolidation §5 Phase 5.3 只做第一阶段：把 `plugin/scripts/develop-deliver-tgz.sh`（census 有效行 2354，内嵌解释器只有 `python3`，实测 10 个 `python3 … <<` heredoc）里的 python 逻辑逐个抽成独立的 `.ts` 模块，bash 只保留编排（胶水是 bash 的强项，SPEC 非目标 1：不把所有 bash 都改 TS）。「改编排」是 SPEC 写的第二阶段，本任务不做。**

**为什么排在 5.2 之后**：SPEC 排序 5.1 → 5.2 → 5.3。5.1/5.2 已立案。`develop-deliver-tgz.sh` 是**交付产物的生产者**（tgz 出的每一份包都经它），风险高于前三个，且刚被 `gap-fan-in-installed-layout-sibling-script-resolvability-test-and-reaper-bundling` 等任务改过——实现前先读近 3 天对它的提交，避免抢文件。

**调用方（实测 `git grep`）**：`.github/workflows/ci.yml`、`plugin/freshness-producers.json`、`plugin/scripts/{deliver-verify-usage,integration-batch-merge,release-freshness-check}.sh`、`plugin/scripts/{runner-static-gate}.ts`、`plugin/scripts/verify-deliver-coldstart.sh`；测试 `plugin/test/{develop-deliver-tgz,develop-deliver-tgz-evidence-transport,release-freshness-check,freshness-producer-coverage-check}.test.mjs`。**`verify-deliver-coldstart.sh` 属 SPEC §8-④ 例外（不立案），本任务只保证它对本脚本的调用不断，⛔ 不得改它。**

**运行时解析纪律**：抽出的 `.ts` 由该 `.sh` 在运行时 spawn，必须走既有 sibling-script 解析（安装布局 = plugin marketplace cache / npm-pack / vendored 都要能解析），并进 capability-catalog（声明表已是 JSON：`plugin/scripts/capability-catalog-declarations.json`）。**这正是 `gap-fan-in-installed-layout-…` 那一族缺陷的形态——新增 sibling 脚本却在安装布局里不可解析**，所以 AC 里有一条专门读安装布局。

## AC

- [ ] AC1（枚举，先于改动）贴出 10 个 python3 heredoc 的清单：行号、作用一句话、输入/输出（stdin/argv/stdout/退出码），以及每个的抽取落点 `.ts` 文件名。缺一个即不合格。
- [ ] AC2（characterization 先于改写，取假）对每个 heredoc 的输入输出契约，在**未改动**的旧 bash 上先落盘测试并全绿；对旧 bash 注入一处行为改动，测试必须红，撤销后绿。两次输出贴进 notes；characterization 提交早于抽取提交。
- [ ] AC3（等价）迁移前后，同一份输入下 tgz 的**逐文件清单**与各 heredoc 的 stdout/退出码一致（贴 `tar -tzf` 前后 diff，diff 为空）。
- [ ] AC4（目标读数）`node --experimental-strip-types plugin/scripts/sh-census-check.ts --json` 中 `plugin/scripts/develop-deliver-tgz.sh` 的 `embedded` 不含 `python3`；`plugin/sh-census-baseline.json` 的 `embeddedInterpreterLines` 只降不升地同步。前后读数各贴一次。
- [ ] AC5（安装布局可解析，生产载体）`bash packages/quay/scripts/package.sh` 产出的 tarball 解出后，在**安装布局**里跑一次 `develop-deliver-tgz` 到底，所有抽出的 `.ts` 均被解析到并执行（贴运行输出，⛔ 不是源码布局下的测试）。关掉 fixture 注入后仍成立。
- [ ] AC6（生产载体，硬规则 4 推论三）落地后时间窗内，一次**真实**的 develop-deliver（CI 或本机 driver 触发）经新路径产出 tgz：贴时间戳晚于落地提交的产出记录，其逐文件清单与迁前基线一致。
- [ ] AC7（catalog / 无新环 / 回归面）`capability-catalog.sh --summary` 声明数一致且 `0 unclassified`；`import-graph-check.ts --json` `verdict.ok=true`；上列 4 个测试文件单独跑全绿；`scripts/test.sh --for-task gap-arch-tsify-develop-deliver-tgz-python-heredocs` 全绿。

## DoD

真实落地：真实交付产物的 tgz 已经由抽出的 TS 模块产出，且与迁前逐文件一致（AC3/AC6）；安装布局里能解析全部新增 sibling 脚本（AC5）；census 中该脚本不再内嵌 python3（AC4）。

## Touches

- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/develop-deliver-python-steps.ts (new)
- plugin/test/develop-deliver-tgz-characterization.test.mjs (new)
- plugin/test/develop-deliver-tgz.test.mjs
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- plugin/sh-census-baseline.json
- tasks/gap-arch-tsify-develop-deliver-tgz-python-heredocs.md

（若实现者把抽出的 `.ts` 拆成多个模块，新增文件仍属本任务 Touches，须在同一次编辑里补进本清单。）
