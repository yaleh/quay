---
id: AC-186
title: goal-driver 常驻消费者必须在线——goal store 的强制消费者（kind=goal）进程存活判据
status: draft
kind: criterion
goal: GOAL-001
criterion: node --experimental-strip-types packages/quay/bin/quay.ts driver
  status --kind goal --json 2>/dev/null | grep -q '"alive":1'
expect: goal-driver 的 supervisor+driver 进程在线（status 报 alive:1），goal store
  有常驻机械消费者持续跑 criterion 与 I2 flip
origin: readings.drivers.goal 报 running=false / supervisorAlive=false /
  driverAlive=false、staleSecs=1936（载体末条 05:56，本轮 06:28）；.quay/ 无 goal-driver.pid
  与 goal-driver-supervisor.pid，而 meta/promotion/quality/worker 四类均有；AC-177 只要求
  goal-round.jsonl 有 ≥3 verdict 记录（一次性、已 achieved），AC-184 只查 promotion/worker
  陈旧写者，均不覆盖 goal 存活
evidence:
  at: 2026-09-07T07:51:35.531Z
  verdict: pass
  reading: acceptance passed (exit 0)
---
