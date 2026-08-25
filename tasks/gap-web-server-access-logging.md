---
id: gap-web-server-access-logging
title: web server 加访问日志（方法+路径+时间戳，可推热点页面/访问模式）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`quay serve` 现状（`packages/quay/src/serve.ts`）：`:217` 启动时 `console.log`（"listening on..."）、`:179` 请求处理异常时 `console.error`（仅错误路径）——**没有任何成功请求的日志**，不记方法/路径/时间戳，访问本身不产生日志行。活进程（pid 1565331）stdout/stderr 指向 `/tmp/quay-web-server.log`，目前只有 2 行启动信息（`.quay/quay-serve.log` 是旧进程死引用，17.5h 未更新）。需求：加访问日志（至少方法+路径+时间戳），日后能从日志推出热点页面/访问模式。

## Plan

加请求访问日志（middleware 或 handler 层），每条成功请求记方法+路径+时间戳；落盘位置复用现有日志路径或新路径、是否轮转由 impl 定。

## Acceptance Criteria

- [ ] AC1（能取假，成功请求有日志）：每次成功请求产生一条访问日志（含方法+路径+时间戳）；（⛔ 访问无日志行 ⇒ 假）。
- [ ] AC2（能取假，可落盘 grep）：访问日志落盘，可 grep 到请求记录（非只存 stdout 易失）；（⛔ 不落盘 ⇒ 假）。

## Definition of Done

访问日志落地；AC1-2 全勾；方法+路径+时间戳齐全，可推出热点页面/访问模式。

## Touches

- packages/quay/src/serve.ts（请求访问日志）
- packages/quay/test/serve.test.mjs（对应测试）
- tasks/gap-web-server-access-logging.md（自身）