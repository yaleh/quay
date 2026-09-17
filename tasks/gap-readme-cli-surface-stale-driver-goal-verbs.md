---
id: gap-readme-cli-surface-stale-driver-goal-verbs
title: README.md 的 CLI 用法说明（顶层子命令行 + quay driver 用法）已随代码演进漂移，且"已知缺口"提示引用了已 done 的任务
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
**type:** execution

## Finding

2026-09-17 排查 README.md 安装/初始化/使用描述是否符合当前版本（0.10.0-dev）时，抽查了 CLI 用法这几节，发现3处具体、已验证的漂移。**插件市场安装流程（Option C + Option A 的 npm postinstall 注册）已单独核实过，是准确的，不在本任务范围内**（`register-plugin.mjs` 的 `extraKnownMarketplaces`/`QUAY_PLUGIN_SCOPE`/`QUAY_SKIP_PLUGIN_REGISTER`/`QUAY_SKIP_PLUGIN_CLI` 行为、`plugin/bin/quay` shim、`dist-plugin` 远端分支，均与 README 描述一致）。

**不属于 GOAL-021**（README 定位叙事/自举统计/截图，AC-276/277/278）也**不属于 GOAL-022**（CI test job 提速，与本发现完全正交）——这是第三类问题：CLI 表面文档随代码演进漂移，未同步。

### 漂移1：顶层 `quay` 用法行少了7个以上子命令（README:480）

README 声称（且断言是"字面打印出来的消息"）：
```
usage: quay <init|task list|view|create|edit|check|gate|gate-log|complete|adjudicate|promote|retreat|run|migrate|config validate|action list|serve|mcp|manager start|manager arm> ...
```
实测当前真实输出（`node --experimental-strip-types packages/quay/bin/quay.ts`）：
```
usage: quay <adr|goal|meta|init|task list|view|create|edit|check|gate|gate-log|complete|adjudicate|promote|retreat|run|migrate|config validate|config check|action list|action run|serve|server start|server add|server stop|server restart|server status|mcp|manager start|manager arm|driver> ...
```
README 缺失：`adr`、`goal`（这次立 GOAL-022 用的正是这个子命令，README 完全没提）、`meta`、`config check`、`action run`、整个 `server start|add|stop|restart|status` 家族（GOAL-017 服务收敛的产物）、以及 `driver` 本身。

### 漂移2：`quay driver` 的动词/kind 说明行过时（README:554）

README：
```
quay driver <start|stop|drain|status|restart> --kind <promotion|worker>
```
实测（`quay driver --help`）：动词是 `start|stop|drain|resume|status|restart`（README 缺 `resume`）；`--kind` 支持 `<promotion|worker|outer|quality|meta|goal>`（README 只列了2种，缺4种）。

### 漂移3："已知缺口"提示引用的任务已经 done（README:565-569）

README 在 Driver processes 一节写道（原文）：
> **Known gap** (until `gap-worker-driver-cold-start-inflight-blind` lands): a cold start (explicit `restart`, or the supervisor's 5s auto-respawn after a crash) rebuilds the in-flight set from memory, so a driver restarted while tasks are in flight may **duplicate-dispatch** them. Prefer `drain` over `restart` when in-flight workers must be preserved.

实测：`tasks/gap-worker-driver-cold-start-inflight-blind.md` 的 `status: done`——这个缺口已经修好，README 这段警告和"优先用 drain"的建议已经没有意义，应该删除或替换成"已修复"的说明。

## Acceptance Criteria

- [ ] AC1: README:480 的顶层 `quay` 用法行更新为与当前 `node packages/quay/bin/quay.ts`（无参数）实际打印的字面输出一致。取假判据：`diff <(node --experimental-strip-types packages/quay/bin/quay.ts 2>&1 | head -1) <(README 里那一行加上 "usage: " 前缀抽出来的字符串)` 必须为空。
- [ ] AC2: README:554 的 `quay driver` 用法行更新为与 `quay driver --help` 实际输出一致（动词含 `resume`，`--kind` 含全部6种）。取假判据同款 diff 对照。
- [ ] AC3: README:565-569 的"Known gap"提示删除或改写为反映 `gap-worker-driver-cold-start-inflight-blind` 已 done 的现状（若该任务记录了替代读法，一并引用）。
- [ ] AC4: 排查 README 里是否还有其它地方引用了同一批"字面打印的用法行"或已经 done 的任务作为"未解决缺口"（硬规则 5b：改好一处不等于只有那一处）——至少 grep 一遍 README 全文里所有 `usage: quay` 出现处 和所有 `` `gap-`` 反引号任务id引用，逐条核对状态。

## Definition of Done

- [ ] README.md 里所有被 AC1-AC4 点名的位置都已更新，且更新后的字面文本经 diff 对照与真实命令输出/任务状态一致。

## Touches

- README.md
- tasks/gap-readme-cli-surface-stale-driver-goal-verbs.md（自身）
