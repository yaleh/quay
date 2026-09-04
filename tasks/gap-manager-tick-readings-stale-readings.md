---
id: gap-manager-tick-readings-stale-readings
title: manager-tick-readings 两处静默陈旧（ticklog 只认旧格式陈旧命中 / liveness 跨主机恒 window-missing）
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

> **翻 done（outer 2026-08-12, r314-green 覆盖）**：代码合入 develop 686b5540（r314 green, 3361 pass/0 fail），AC 勾选 + measure 复核通过。

## Proposal

**出厂脚本缺陷 ×2（manager 2026-08-12 01:17 011742，源码级定位）**：`plugin/scripts/manager-tick-readings.ts` 有两处「答案看起来完全正常，但已经三天没变」的静默陈旧读数。

**缺陷 ①：`outer.ticklog` 只认已废弃的行格式，报出三天前的行且不可区分**
- 读数：`outer.ticklog quay | 2026-08-09 10:04Z | correct | round-162 红…`；真值：文件 mtime 2026-08-12，含 08-11/08-12 的行。**读数落后三天。**
- 根因（`latestTickLog` 源码 + 注释）：quay 的 tick-log 有两个时代——旧格式 `| 2026-MM-DD HH:MMZ |`（倒序，386 条，最新 08-09）+ 新格式 `> **HH:MMZ …`（追加顺序无日期，273 条）。**新时代的行一条都不认，稳定返回旧时代最新的那条。**
- 修法方向：三种格式都解析并取全局最新；新格式无日期 ⇒ 回退到行在文件中的位置或文件 mtime；无法确定新鲜度时返回显式 `stale-unknown` 而不是看似正常的旧行。

**缺陷 ②：`outer.liveness` 对跨主机项目恒报 `window-missing`**
- 读数：`outer.liveness archguard:outer window-missing`；真值：archguard 的 outer 活着，在 ad-arm1 的 tmux 会话 `archguard-0`。
- 两处不匹配：①会话名（它找 `archguard`，真名 `archguard-0`）②主机（它只看本机 tmux，而该会话在 ad-arm1）。
- 对 manager 层尤其致命——**跨项目正是它存在的理由**。
- 修法方向：会话名从配置/`_launchSpec` 取而非硬编码推导；跨主机目标走 `supervisor-deliver.sh` 已支持的 `<host>:<target>` 形态（a15dc33c 已落地）。

**与 #53 的关系**：011128 报「manager 层不可冷启动」，这两条是同一件事的另一面——manager 机件即使铺过去了，对「本机之外的项目」也看不见。**两任务合并为「manager 跨项目/跨主机可观测性」**。

**验证锚**：修后 (a) `outer.ticklog quay` 返回最新行（08-11/08-12）；(b) `outer.liveness archguard:outer` 返回 alive（跨主机）；(c) 无法确定新鲜度时返回 `stale-unknown`；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录两处静默陈旧实测（ticklog 落后三天 / liveness 跨主机 window-missing）（本任务 Proposal 已含）
- [x] AC2: **ticklog 多格式解析**——三格式都解析取全局最新；新格式无日期回退到位置/mtime；无法确定时显式 `stale-unknown`
- [x] AC3: **liveness 跨主机**——会话名从配置取；跨主机目标走 supervisor-deliver `<host>:<target>` 形态；`archguard:outer` 在 ad-arm1 上报 alive
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修后实跑：ticklog 返回最新行 + liveness 跨主机 alive 读数贴出（见 Evidence）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/manager-tick-readings.ts（latestTickLog 多格式 + liveness 跨主机）
- plugin/test/manager-tick-readings.test.mjs（两缺陷用例）
- plugin/scripts/supervisor-deliver.sh（交叉标注——`<host>:<target>` 形态）
- tasks/gap-manager-layer-no-verified-install-vector.md（交叉标注——合并「manager 跨项目/跨主机可观测性」）
- tasks/gap-manager-tick-readings-stale-readings.md（自身：勾 AC + 贴证据）

## Contract

measure   ticklog_fresh = `node --no-warnings --experimental-strip-types plugin/scripts/manager-tick-readings.ts outer.ticklog quay` 返回行 outer.ticklog 字段是否含 2026-08-11/12
band      ticklog_fresh = true（返回最新行，非 08-09）
measure   liveness_cross_host = `node --no-warnings --experimental-strip-types plugin/scripts/manager-tick-readings.ts outer.liveness archguard:outer` 返回行 outer.liveness 字段读数
band      liveness_cross_host = alive（跨主机会话名 + host 正确解析）
invariant stale_unknown_on_uncertain = 1（无法确定新鲜度时显式 stale-unknown）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/manager-tick-readings.ts outer.ticklog quay`（贴最新行 + 时间）
control   ticklog 最新；liveness 跨主机；stale-unknown 显式；既有不回归
resume    ticklog 解析 / liveness 跨主机 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: manager 011742 源码级定位（两处静默陈旧）。与 #53 合并「manager 跨项目/跨主机可观测性」。实现归 inner。

## Evidence

**修复后实跑（Contract invoke，worktree 分支 task/gap-manager-tick-readings-stale-readings）**：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/manager-tick-readings.ts outer.ticklog quay
outer.ticklog quay ## 2026-08-12 03:2xZ tick — #50 fan-in 完成（compound 死锁解除）; #54 派发

$ node --no-warnings --experimental-strip-types plugin/scripts/manager-tick-readings.ts outer.liveness archguard:outer
outer.liveness archguard:outer alive pane_pid=295132 cmd=claude session=archguard-0 host=ad-arm1.wan.hwang.men
```

- **ticklog_fresh = true**：返回行含 `2026-08-12`（修复前恒返回 08-09 陈旧行）。旧倒序 `| 2026-...`（463 条）+ 新 `## 2026-08-12 03:2xZ tick` 节 + `> **HH:MMZ` inner tick + archguard `| N | HH:MMZ |` 表都解析；dated 取最大 epoch，无日期行按位置（append-only），无 mtime 锚定 ⇒ 显式 `stale-unknown`（`latestTickLogReading`）。
- **liveness_cross_host = alive**：会话名 `archguard-0` 与主机 `ad-arm1.wan.hwang.men` 从 `Project.session/host` 配置取（`DEFAULT_PROJECTS`），跨主机经 `ssh <host> tmux list-panes -a -F ...` 只读解析（`remoteTmuxListPanes`，整体引号避免 ssh 吞 `-F`、`$'\t'` 展开真 tab）。修复前本机 tmux 恒 `window-missing`。
- **stale_unknown_on_uncertain = 1**：无日期行 + `mtimeEpoch=0` ⇒ `stale-unknown`（测试断言）。
- **scoped 门（AC4）**：`scripts/test.sh --for-task gap-manager-tick-readings-stale-readings` → **tests 35, pass 35, fail 0, cancelled 0, GATE EXIT 0**（21 个 manager-tick-readings + 14 个 supervisor-deliver 交叉选中；10 个 change-relevant static checks 全过，含 task-contract-check 无 violation）。

**测试新增（缺陷①/② 用例）**：`plugin/test/manager-tick-readings.test.mjs`——跨时代最新行（08-12）、无日期位置/mtime 回退、stale-unknown、cross-host session 配置正/负控制、`MTR_REMOTE_TMUX_LIST_PANES` 远端接缝、`renderSelected` 单读数子命令。既有 21 用例 + 新增，全绿。

**交叉标注**：`plugin/scripts/supervisor-deliver.sh`（`<host>:<target>` 形态注释）、`tasks/gap-manager-layer-no-verified-install-vector.md`（合并「manager 跨项目/跨主机可观测性」）。

**DoD 全量套件项**：未由 inner 跑——外层 verification-round 验证（同 #53 处理）。
