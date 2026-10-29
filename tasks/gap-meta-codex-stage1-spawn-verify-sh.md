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
---
## Finding
AC-927 的判据指向 plugin/scripts/codex-stage1-spawn-verify.sh，该文件在树中不存在，且 SPEC §4.3 的 Task A 从未立案（无任务带 goal_ac: AC-927），goal-driver 每轮只能重跑一个解析不到的副作用脚本、永远 not-evaluated。

本轮读数（criteria.AC-927.verdict）= `"not-evaluated"`，采于 2026-10-29T07:41:12Z，由 meta-driver 机械采集。
涉及机制关键词：`codex-stage1-spawn-verify.sh`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `cd packages/quay && bash ../../plugin/scripts/codex-stage1-spawn-verify.sh` ⇒ exit 0——从 packages/quay 子目录按 .codex/config.toml 真正 spawn 配置的 quay MCP server 并完成 initialize 握手；worker 须另跑负控制（把 config 的 cwd 改错或改回相对 args 时该脚本必须 exit 非零，⛔ 不得 SKIP 后 exit 0）。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `.codex/config.toml`
- `plugin/scripts/codex-stage1-spawn-verify.sh`
- `plugin/scripts/codex-stage1-selfcheck.sh`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/codex-stage1-spawn-verify.test.mjs`
- `tasks/gap-meta-codex-stage1-spawn-verify-sh.md`