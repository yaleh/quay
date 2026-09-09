---
id: AC-186
title: goal-driver 常驻消费者必须在线——goal store 的强制消费者（kind=goal）进程存活判据
status: retired
kind: criterion
goal: GOAL-001
criterion: node --experimental-strip-types packages/quay/bin/quay.ts driver
  status --kind goal --json 2>/dev/null | grep -q '"alive":1'
expect: goal-driver 的 supervisor+driver 进程在线（status 报 alive:1），goal store
  有常驻机械消费者持续跑 criterion 与 I2 flip
origin: >-
  【退役 2026-09-09——类别错误：活性判据写成目标判据（同 AC-181 / AC-184 一类）】


  原判据：goal-driver 常驻消费者必须在线（`quay driver status --kind goal --json` 报 alive:1）。


  【错在哪】「goal-driver 进程是否在线」是活性量——进程一停即假，天然会回退。与 AC-181 已退役的「meta-driver
  必须留新鲜轮次」同类别错误。


  【为什么照原样激活危险】goal-driver.ts 只做 active→achieved 单向 flip，无反向翻转。一旦翻成 achieved
  即永久锁死——日后 goal-driver 停摆，记录仍永久声称「在线」（硬规则 4）。


  【监控面去向，不缺观测】`quay driver status --kind goal --json` 的
  `alive`/`driver_alive`/`supervisor_alive`/`running` +
  `carrier_records`/`last_record_ts`/`supervisor_stale`（aliveness() 每轮进
  drivers.goal 读数）。⇒ 退役不留观测缺口。
---
