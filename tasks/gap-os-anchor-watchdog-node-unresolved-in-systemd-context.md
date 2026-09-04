---
id: gap-os-anchor-watchdog-node-unresolved-in-systemd-context
title: "os-anchor-watchdog.sh:298 uses bare `node --experimental-strip-types`
  with NO node resolution — fails in systemd --user context (PATH lacks nvm →
  node 18.19.1; bare 'bad option' + 'DRIVE NOT YET DELIVERED (exit 9)',
  measured B machine 22:35:51): the drive IS delivered but the VERIFICATION
  fails → watchdog judges 'not delivered, retry next round' → RE-DRIVES
  (double-drive); breeding defect — A machine's 11:40 case stuck at an earlier
  'no transcript found' never reached line 298, daily healthy branch doesn't
  call it (child in a different niche exposed the parent's blind spot, same as
  archguard bare ✖); fix: explicitly resolve node (read nvm default / config
  item) OR use a non-strip-types form; ALSO: the failure mode does NOT alarm,
  only writes a log nobody reads — watchdog needs alarm-on-failure (see
  lease-model task)"
status: superseded
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  supersededBy: gap-manager-productization-five-constraints
  schema: v1
---

> **【作废 — 2026-08-06 人裁定，两条独立理由，任一条即足以作废】**
>
> 1. **「不得重启 watchdog。请专注于以产品化方法改进」** ⇒ 本条要修的装置**不得再运行**。
> 2. **「会话真死不要管。我明确这不在本项目需要监控和恢复的范围内」** ⇒ 本条要修的装置的
>    **目的本身**（探测会话死亡并拉回）**已被移出项目范围**。
>
> ⇒ 修好它也不会被使用。**实测佐证（2026-08-06 17:5xZ）**：os-anchor watchdog 当前
> **0 个 systemd unit、0 条 os crontab 条目、0 个进程**——装置已完全停摆。
>
> **不删除本文件**：保留缺陷描述，因为若将来范围重新放开，这些实测缺陷仍然成立、
> 不必重新发现。**但不得派发**（`status: superseded`）。
>
> 完整裁定记录见 `tasks/gap-manager-productization-five-constraints.md` 的 AC5/AC5b/AC5c。
**type:** execution

## Proposal

**os-anchor watchdog 的 node 调用未解析——systemd 环境下必然失败，B 机实测。**

**【实测（管理者，B 机 watchdog 日志 22:35:51）】**：`DRIVE NOT YET DELIVERED (exit 9)` +
`node: bad option: --experimental-strip-types`。根因实测确认：systemd --user 的 PATH
（/usr/local/sbin:...:/snap/bin）**不含 nvm** ⇒ node v18.19.1；交互式 shell 是 v25.2.0。
`os-anchor-watchdog.sh:298` 的 `node --experimental-strip-types <transcript-delivery-check.ts>`
在 systemd 环境下**必然失败**。

**【性质】**：驱动**实际送达**（outer 确实开始 cold-start），失败的是**核实送达**那一步 ⇒ watchdog 判
「没送达下轮重试」⇒ **会重复驱动**（double-drive，一个驱动被重复发）。

**【繁殖缺陷（子代暴露亲代盲区）】**：A 机 11:40 那次卡在更早的「no transcript found」**从没走到这行**；
日常 healthy 分支不调用它。**B 机进入不同生态位（systemd 环境）才暴露**——同 archguard 裸 ✖ 形态。

**【修法（管理者意见 + 外层采纳）】**：
1. watchdog 里所有 node 调用**显式解析到可用 node**（读 nvm default / 配置项），或
2. 改用**不需要 strip-types 的形态**。
3. **同时**：失败模式不告警、只写日志（日志没人读）——需 alarm-on-failure（与 lease-model 任务同主题）。

### 选定机制

1. watchdog node 解析：读 nvm default 或配置项（`NODE_BIN` 或类似），不用 PATH 里的裸 node
2. 或非 strip-types 形态（预编译 JS）
3. 失败告警（不只日志）：watchdog 失败时发信号（事件/通知），不静默

## Acceptance Criteria

- [ ] AC1: watchdog 的 node 调用在 systemd 环境（PATH 无 nvm）下能跑（显式解析/非 strip-types，B 机实测）
- [ ] AC2: 驱动送达核实不因 node 版本假失败（不再 exit 9 / 重复驱动）
- [ ] AC3: watchdog 失败**告警**（不只日志）——失败模式不静默
- [ ] AC4: 与 gap-os-anchor-watchdog-lease-model 交叉标注（同文件，alarm + 租约一起改）

## Touches

- plugin/scripts/os-anchor-watchdog.sh（node 解析 + 告警）
- tasks/gap-os-anchor-watchdog-lease-model-instead-of-absence-inference.md（AC4 交叉标注）

## Contract

measure   node_ok = `bash plugin/scripts/os-anchor-watchdog.sh --check-node 2>&1 | grep -c 'ok\|resolved'` 在无 nvm PATH 下 stdout 数字段
band      node_ok >= 1（systemd 环境 node 解析成功）
invoke    `grep -n 'NODE_BIN\|strip-types\|resolve.*node' plugin/scripts/os-anchor-watchdog.sh`
control   PATH 无 nvm ⇒ 仍能跑（AC1）；驱动核实不再假失败（AC2）
resume    node 解析与告警分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T22:5xZ
changed: 管理者繁殖视角 B 机实测立案（systemd PATH 无 nvm → node 18.19.1 → strip-types 失败 → 重复驱动）。
修正方向：显式解析 node / 非 strip-types / 失败告警（不只日志）。
