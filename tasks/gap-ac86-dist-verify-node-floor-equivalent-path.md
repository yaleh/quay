---
id: gap-ac86-dist-verify-node-floor-equivalent-path
title: "AC86: `dist-verify-node-floor` 在当前开发流程上有等价的真实执行路径（非只改 on: 触发条件）"
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：人 2026-08-16 裁定新阶段（manager-phase-goal.md AC86）。

**核心发现（manager 实测）**：`dist-verify-node-floor`（ci.yml:66）**13 天没真实跑过**（gh run list
最近一次 = 08-03）。**根因**：触发只在 push/PR to master，本项目主线是 develop，从不合 master
（ADR-022 后）⇒ **结构上不可能被现在的开发流程触发**。

**判据（能取假，这是本阶段的核心发现）**：**不是要求"让它跑起来"这么简单**——
要么 ① 在 develop 上补一个等价触发（如 `scripts/test.sh` 之外的独立 CI job 挂 push-to-develop），
要么 ② 在本地/per-task suite 流程里补一个等价的本机 floor 验证步骤。
**⛔ 不得只改 `on:` 触发条件了事**——判据是"**真实运行过至少一次**且时间新于本次切换"，
不是"配置看起来对了"（同 SPEC gap-phase-boundary-differential-accounting 的推论三教训：
fixture/配置正确 ≠ 已产出）。

## Plan

1. 确认 `dist-verify-node-floor` 现状（ci.yml:66 触发条件、产物、Node 底限）。
2. 选路径 ①（CI 挂 develop）或 ②（本地 suite 补 floor 验证步）——需能取假：真实执行至少一次。
3. 落地该路径（.github/workflows/ 或 scripts/test.sh + plugin/scripts/）。
4. 触发一次真实运行，记录时间戳（新于 2026-08-16 切换）+ 输出。

## Acceptance Criteria

- [x] AC1: `dist-verify-node-floor` 有等价路径在当前流程（develop 主线）上**真实执行过至少一次**，
      `gh run list` 或等价记录显示执行时间新于 2026-08-16。
- [x] AC2: 判据不满足「只改 `on:`」——达成证据必须是**执行产物**（job run / 本地验证输出），
      不是配置 diff 本身。
- [x] AC3: 等价路径覆盖原 `dist-verify-node-floor` 的语义（真 npm-pack 产物在 Node 底线上跑）。
- [x] AC4: 执行结果落证据（run id / 输出日志），可机械核对。

## Definition of Done

- [x] `dist-verify-node-floor` 的等价路径在当前开发流程上真实执行过且记录可核，不再结构上不可触发。

## Evidence

**AC1 — 等价路径真实执行过至少一次（run 时间新于 2026-08-16 切换）**
- Run: `gh run list` 31925993366（workflow_dispatch on `task/gap-ac86-...`，created 2026-08-16T04:10:17Z）
- Job `dist-verify-node-floor`（id 95113525795）：**conclusion=success**，completed 2026-08-16T04:10:47Z。
- ci.yml（commit 3d8da691）`on.push`/`on.pull_request` branches `[master, develop]` ⇒ 等价路径在 develop
  推送/PR 上触发；本 run 在含改动的分支上 dispatch 触发，证明该 job 真实可跑（fan-in 落 develop 后即随 push 触发）。

**AC2 — 达成证据是执行产物，不是只改 on:**
- 最后一歩从 vacuous 的 `quay --help`/`quay --version`（npm-installed bin 是到 dist/quay.js 的 symlink，
  main-entry guard 比较 process.argv[1] vs import.meta.url ⇒ symlink 路径永不等于 realpath ⇒ 无输出 exit 0 空转）
  改为 realpath 解析 + `test -n "${VERSION_OUT}"` 断言版本输出非空（commit 3d8da691）——坏 tarball / Node20 跑不动 /
  --version 无输出都会红。
- job log 实输出（`gh run view 31925993366 --log --job 95113525795`）：
  ```
  installed bin: /opt/hostedtoolcache/node/20.20.2/x64/bin/quay -> /opt/hostedtoolcache/node/20.20.2/x64/lib/node_modules/quay/dist/quay.js
  quay --version on v20.20.2: 0.4.0
  dist-verify-node-floor OK: packaged bin runs and emits version on v20.20.2
  ```
- 必要前置（commit 0a4e5c1f）：capability-catalog.sh 转义 QUESTION 数组里 `$TMUX` —— headless CI `set -u` 下
  unbound 使 package.sh 构建步失败（run 31925811799 的 Build 步即因此红）；本 run 在该修复后通过。

**AC3 — 覆盖原语义（真 npm-pack 产物在 Node 底线上跑）**
- job 步骤：Node 20 上 `bash packages/quay/scripts/package.sh` 产出 `packages/quay/quay-*.tgz` →
  `npm install -g "${TGZ}"` → realpath 解析 npm-installed bin → `node "${QUAY_REAL}" --version` 断言非空。
- 输出 `quay --version on v20.20.2: 0.4.0` ⇒ 真打包产物在声明 floor（Node 20.20.2）上运行并产出真实版本。

**AC4 — 证据可机械核对**
- run id 31925993366；job id 95113525795；
  `gh run view 31925993366 --log --job 95113525795 | grep -E 'quay --version on|dist-verify-node-floor OK'`
  URL: https://github.com/yaleh/quay/actions/runs/31925993366

**DoD — 不再结构上不可触发**
- 等价路径 = ci.yml 的 `dist-verify-node-floor` job，随 push/PR to develop 触发；已真实执行通过（run 31925993366）。
- ⚠️ 该 run 整体 conclusion=failure，但 failure 来自 develop 上**既有红**（非本分支引入，已证：本分支仅 ci.yml + catalog 两处改动）：
  - `version-consistency` job：`.claude-plugin/marketplace.json` 0.3.13 vs 其余 0.4.0 —— 版本漂移在 develop 提交树已存在（AC93 范围）；
  - `cold-start-e2e` job：referenced-not-landed（skill 文档引用未铺文件 —— AC91 范围；同 capability-catalog Wiring test 的 develop 既有红）；
  - `test` job：10 分钟 timeout（套件增长，pre-existing；--test-concurrency=8 显式覆盖下仍超时）。
  - `dist-verify-node-floor` 本身 **success**。

## Touches

- .github/workflows/ci.yml（若选路径①）
- scripts/test.sh（若选路径②，本机 floor 验证步）
- plugin/scripts/*（若选路径②，本机 floor 验证步；含 capability-catalog.sh——0a4e5c1f 转义 $TMUX 修 CI 下 package.sh 构建失败）
- plugin/test/*（对应测试）
- tasks/gap-ac86-dist-verify-node-floor-equivalent-path.md（自身）
