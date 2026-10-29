---
id: gap-meta-codex-stage1-spawn-verify-sh
title: "落 SPEC Task A（goal_ac: AC-927）：建 codex-stage1-spawn-verify.sh + 修
  .codex/config.toml cwd"
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
goal_ac: AC-927
---
## Finding
AC-927 的判据指向 plugin/scripts/codex-stage1-spawn-verify.sh，该文件在树中不存在，且 SPEC §4.3 的 Task A 从未立案（无任务带 goal_ac: AC-927），goal-driver 每轮只能重跑一个解析不到的副作用脚本、永远 not-evaluated。

本轮读数（criteria.AC-927.verdict）= `"not-evaluated"`，采于 2026-10-29T07:41:12Z，由 meta-driver 机械采集。
涉及机制关键词：`codex-stage1-spawn-verify.sh`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `cd packages/quay && bash ../../plugin/scripts/codex-stage1-spawn-verify.sh` ⇒ exit 0——从 packages/quay 子目录按 .codex/config.toml 真正 spawn 配置的 quay MCP server 并完成 initialize 握手；worker 须另跑负控制（把 config 的 cwd 改错或改回相对 args 时该脚本必须 exit 非零，⛔ 不得 SKIP 后 exit 0）。

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `.codex/config.toml`
- `plugin/scripts/codex-stage1-spawn-verify.sh`
- `plugin/scripts/codex-stage1-selfcheck.sh`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/codex-stage1-spawn-verify.test.mjs`
- `tasks/gap-meta-codex-stage1-spawn-verify-sh.md`

该轴仍暗,理由:本任务仅改 .codex/config.toml、两个 codex shell 脚本、capability-catalog 声明与一个测试文件，未触及 packages/* 源码依赖结构，L_D/L_G 无可测增量。

## Evidence
- 正向：从 packages/quay 子目录 `bash ../../plugin/scripts/codex-stage1-spawn-verify.sh` ⇒ exit 0（`RESULT: PASS`，server spawned + completed MCP initialize handshake）。
- 负控制 1（config cwd 指向不存在路径）：exit 1（`RESULT: FAIL`，configured cwd does not exist or is not a directory）。
- 负控制 2（改回相对 args、无 cwd）：exit 1（`RESULT: FAIL`，no jsonrpc/result/serverInfo response）。
- `node --test plugin/test/codex-stage1-spawn-verify.test.mjs` ⇒ 5/5 pass（含正向与两条负臂）。
- `bash plugin/scripts/codex-stage1-selfcheck.sh`（从 packages/quay 子目录）⇒ exit 0（含 spawn-verify PASS，codex-cli 0.156.1）。

## Blocker

**2026-10-29T11:24:24.317Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=merge-develop: Auto-merging plugin/test/codex-stage1-spawn-verify.test.mjs
CONFLICT (add/add): Merge conflict in plugin/test/codex-stage1-spawn-verify.test.mjs
Auto-merging tasks/gap-codex-mcp-cwd-any-root-spawn-verify.md
Automatic merge failed; fix conflicts and then commit the result.
- run_id：wk-prod-anchor
- session_id：e0a4f4c8-3008-4644-8d38-7247c6fbdee3
