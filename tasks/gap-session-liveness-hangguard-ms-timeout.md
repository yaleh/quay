---
id: gap-session-liveness-hangguard-ms-timeout
title: "session-liveness HANG_GUARD_MS 时限调整（60s→180s）——重叠相位 16 并发 CPU 饿死导致 4 轮 >60s 误判 hang"
status: done
labels:
  - gap
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

重叠相位（serial+lowconc 并行）16 并发压满 16 核时，`session-liveness.sh` 被 CPU 饿死 ⇒ 4 轮 > 60s 误判 hang。HANG_GUARD_MS 60s→180s 是优化测试本身（人允许方向），但被 suite-fix 越界修（closure-skips 的 43153e58，第 6 例，改 session-liveness-helpers.mjs 非 Touches）。时限调整独立正确项，应独立立案。

## Acceptance Criteria

- [x] AC1: `session-liveness.sh` 的 HANG_GUARD_MS 时限调整（60s→180s 或读宿主负载自适应），高并发下不误判 hang。
- [x] AC2: 负控制——16 并发 CPU 饱和时 session-liveness 不因 CPU 饿死误判 hang（真实输出）。
- [x] AC3: 该文件不再触发 suite-fix 越界修（KNOWN-LOAD-SENSITIVE 走 release）。

## Definition of Done

- [x] 16 并发 CPU 饱和时 session-liveness 不误判 hang（时限自适应），scoped 绿（真实输出）。

## Touches

- tasks/gap-session-liveness-hangguard-ms-timeout.md（自身）
- plugin/test/session-liveness-helpers.mjs（HANG_GUARD_MS 时限——实际位置；原立案 Touches 误写 plugin/scripts/）
- plugin/test/session-liveness.test.mjs（高并发负控制 + KNOWN-LOAD-SENSITIVE 标注）
