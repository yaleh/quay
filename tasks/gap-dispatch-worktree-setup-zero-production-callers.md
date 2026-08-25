---
id: gap-dispatch-worktree-setup-zero-production-callers
title: dispatch-worktree-setup.sh 零生产调用者——worker-driver 派发不做 provisioning，每个 worker 手工重推 bootstrap
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

`plugin/scripts/dispatch-worktree-setup.sh` 已存在、已有测试（`plugin/test/dispatch-worktree-setup.test.mjs`，15996 字节），头注释写明它就是为了消灭「whether a dispatched worktree can self-verify was AGENT-REMEMBERING, not mechanism」这个失败模式——每个被派发的 worktree 得到 node_modules（symlink 主检出，缺则 npm install 兜底）+ config.yml（走 `.worktreeinclude`），使 `scripts/test.sh` 在 worktree 里不再依赖 agent 记得做这两步。

**但它的唯一非自引用调用者是已退役的 `plugin/loop/fast-mode-loop-tick.md:1033`（经典/fast-mode 循环文档），不是现行派发路径 `worker-driver.ts`。** 核实（2026-08-25）：
- `grep -n "provision\|node_modules\|config.yml\|worktreeinclude\|setup.sh" plugin/scripts/worker-driver.ts` ⇒ **零命中**；
- `buildWorkerPrompt`（worker-driver.ts:778）原文只说 "(1) create an isolated git worktree for <task>"——**没有任何 provisioning 指示**；
- `buildContinueWorkerPrompt`（续做路径）同样零 provisioning 字样。

⇒ 每个 worker 都在手工重新推导这套 bootstrap（`ln -s .../node_modules` + `cp .../config.yml`），**正是该脚本被写出来要消灭的那个失败模式**。

**生产实证**（`gap-webui-serve-dev-watch-mode`，session c820d24f，纯文档任务往 CLAUDE.md/README 加 ~4 行）：56 个工具调用里 3 个 edit 是真正工作（5.4%），explore 里约 6-8 个调用纯属手工 bootstrap（`ln -s`/`git ls-files`/`cp config.yml`/`node --version`/`ls -la .quay`），零判断成分、每个任务完全相同。按实测每步中位 10.7s / 均值 19.9s，每任务约 120-160s + 同等数量 LLM 回合（cache_read 占 99.3%）。

## Plan

`worker-driver.ts` 的派发路径在 `git worktree add` 之后调用 `bash plugin/scripts/dispatch-worktree-setup.sh <worktree>`（幂等：node_modules symlink-or-install + config.yml 经 worktree-include.sh）。**两条路径都处理**：
- **create 路径**（`buildWorkerPrompt` 的新 worktree）：派发前/创建后调用脚本，worker prompt 里去掉「自己建 node_modules/config.yml」的隐含责任（机制接管）；
- **continue 路径**（`buildContinueWorkerPrompt` 复用已有 worktree）：该 worktree 前一轮 worker 若已手工 bootstrap 则已就绪，但为幂等安全也在 continue 派发后调用一次脚本（脚本幂等，重复跑无害）。⛔ 此处 manager 已标未展开（是否续做路径真需要），实现时先核：续做 worktree 的 node_modules/config.yml 是否已在（若前一轮已手工做则恒在，脚本幂等跑一遍成本低仍可保留）。

## Acceptance Criteria

- [x] AC1（能取假，接线）：`worker-driver.ts` 派发路径在 `git worktree add` 后调用 `dispatch-worktree-setup.sh <worktree>`（结构针：grep 到调用 + 位置在 worktree 创建之后）；（⛔ 仍零调用 ⇒ 假）。
- [ ] AC2（能取假，负控制）：新派发 worker 的 transcript 不再出现手工 `ln -s .../node_modules` 或 `cp .../config.yml`（现在必然出现）；（⛔ 仍手工 bootstrap ⇒ 假）。（待外部）
- [x] AC3（能取假，幂等）：对已手工 bootstrap 过的 worktree 再跑一次脚本不报错、不重复创建（幂等）；（⛔ 报错或重复 ⇒ 假）。

## Definition of Done

`worker-driver.ts` 派发（create + continue 两条）接 `dispatch-worktree-setup.sh`；AC1/AC2/AC3 全勾；`dispatch-worktree-setup.test.mjs` 绿（不回归）；真机派发一个任务，worker transcript 无手工 `ln -s`/`cp config.yml`。

## Touches

- plugin/scripts/worker-driver.ts（派发路径接线 dispatch-worktree-setup.sh）
- plugin/scripts/dispatch-worktree-setup.sh（如需幂等加固）
- plugin/test/worker-driver.test.mjs（接线测试）
- plugin/test/dispatch-worktree-setup.test.mjs（幂等测试）
- tasks/gap-dispatch-worktree-setup-zero-production-callers.md（自身）
