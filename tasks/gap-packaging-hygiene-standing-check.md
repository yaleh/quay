---
id: gap-packaging-hygiene-standing-check
title: 打包卫生缺陷转为常设检查项——把 GOAL-015 捕捉的 files 白名单误装/配置键悬空类问题接入 loop.routines
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-shipped-entry-files-not-runnable
---
## Proposal

GOAL-015（AC-233/234/235）捕捉到的两类缺陷——交付包 `files` 白名单误装了"形如入口、实际在安装位置下结构性跑不起来"的文件（AC-233，`gap-shipped-entry-files-not-runnable`）、配置键无消费者（AC-235，`gap-config-key-consumer-check-mechanical-enumeration` 已 done，产出了 `config-key-consumer-check` 机械枚举）——属于**会随代码演化持续复发**的一类打包卫生问题，不是一次修完就完的缺陷。GOAL-009 AC-202（`DRIVER_KINDS` 数据表字面量 6 个 driver kind 曾经不进 tarball、无人发现直到第三方主机上才暴露）是同一类模式的又一个独立实例。

当前的检测机制只在 goal AC 被验收时手工跑一次；验收后没有人定期重跑它——新增配置键、新增 bin 文件、新增字面量表都会重新引入同类缺陷，而不会被发现，直到下一次人工审计或下一次真实的第三方部署踩坑。仓库已有 `loop.routines` 机制（`.quay/config.yml` `loop:` 段，`self-validation`/`browser-explorer` 等既有 routine，由 `quay:routines` skill 周期性触发、发现问题即开新任务），本任务把打包卫生检查接进这个既有常设机制，而不是靠下一次人工发起新 goal 才会被重新检查。

## Plan

1. 在 `.quay/config.yml` `loop.routines` 下新增一个 `packaging-hygiene` probe（`trigger: every(N)`，N 参照既有 routine 的量级选取，不新造一套触发机制）。
2. probe 的实际检查动作复用/包装两个既有机械检测：`config-key-consumer-check`（AC-235 产物，配置键消费者枚举）与交付包入口可运行性枚举（AC-233/`gap-shipped-entry-files-not-runnable` 完成后的产物——若该任务尚未落地，本任务的 AC2 允许先接入 config-key-consumer-check 一个维度，另一维度留 TODO 并在任务体里记录依赖，不得虚报覆盖）。
3. probe 发现新漂移（新的零消费者配置键 / 新的不可运行入口文件）时，遵循既有 routine「发现问题即开新 gap 任务」的模式落新任务，不静默。

## Acceptance Criteria

- [ ] AC1 `loop.routines` 新增 `packaging-hygiene` probe 声明，触发周期形态与既有 routine 一致（贴出 config.yml 片段）
- [ ] AC2 probe 执行体接上 config-key-consumer-check（若 gap-shipped-entry-files-not-runnable 已 done 则两个维度都接，否则接一个维度 + 记录另一维度的依赖任务 id）
- [ ] AC3 probe 发现漂移时能落一个新 gap 任务（不是只打印/只记日志），给出机制说明或实测证据
- [ ] AC4 至少一次真实触发的 routine run 记录（非只接线未跑过——硬规则推论三：实现落地但生产没跑过一轮 ⇒ 与未实现同形，AC 不得只靠 fixture/注入满足）

## Definition of Done

- [ ] AC1-4 全部满足；`--for-task` scoped 门绿
- [ ] 有一条 `.workflow-events/` 或对应 routine 记录载体里，落地后产生的真实 probe run（非 fixture）

## Touches

- .quay/config.yml
- plugin/scripts/config-key-consumer-check.ts（如存在，复用其检测逻辑）
- 新增或复用的 routine probe 脚本（路径由实现者按 loop.routines probe 惯例命名）
- tasks/gap-packaging-hygiene-standing-check.md（本任务自身）