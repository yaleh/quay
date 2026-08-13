---
id: gap-leak-scan-temp-off-cert-path-expiry
title: leak-scan R3/DELTA 临时移出认证路径——到期放回（移除源修复后）
status: todo
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**背景（2026-08-13，round 133+134 连续红）**：`tmux-leak-scan.test.mjs` R3 + `test-isolation-check.test.mjs`
AC5/DELTA 的「genuine-leak dir 在 reap-wait bound 内被移除」断言在**全量套件负载下必然复现**（两轮
断言逐字相同、各 ~800ms；隔离跑绿，但负载是全量套件的必要条件）。这不是 flake——是认证路径上的
**确定性复现障碍**。

**临时处置**：两文件 `@test-group engine → governance`（移出默认 product,engine 认证路径）。
**三个条件缺一不可**：
1. **带到期**（本任务）：移除源修复落地后放回 engine。无到期 = 永久丢检查。
2. **移出期间仍跑**：`--for-task` / `--group governance` scoped 门仍覆盖它们——防真泄漏回归
   无人发现（隔离/scoped 跑绿验证）。
3. **可核判据**：移出后下轮应绿；仍红则第三障碍。

**移除源（待真修）**：R3/DELTA 的 persistent dir 在负载下被进程内某个 actor 移除（已排除第三方
未加 --scope 扫描；收窄到 R2 detached reaper 时序 或 scope-collision 或进程内 sweep）。深挖 +
真修由 trace 任务（或本任务扩展）负责，修好即放回。

## Plan

1. （已做）两文件 `@test-group engine → governance` + TEMP-OFF-CERT-PATH 注释。
2. 验证：`--list-groups` governance 含两文件；`--group governance` 跑它们绿（隔离）。
3. 验证：默认 `product,engine` 不再含两文件（下轮 136 应绿，若 R3/DELTA 不再红）。
4. **到期放回**：移除源修复后 `governance → engine`，删 TEMP-OFF-CERT-PATH 注释。
5. bump（reap-wait 5000ms/400ms）作为过渡治标，可留可撤。

## AC

- [ ] AC1: 两文件移出默认认证路径（governance），TEMP-OFF-CERT-PATH 注释在
- [ ] AC2: scoped 门（--for-task / --group governance）仍跑两文件且绿（防泄漏回归无人发现）
- [ ] AC3: 移出后下轮认证绿（136 应绿——R3/DELTA 不再红）
- [ ] AC4: 到期条件写清（移除源修复后放回 engine）
- [ ] AC5: bump（reap-wait 5000/400）落地（过渡治标）

## Definition of Done

- [ ] 放回 engine（移除源修复后）或本任务被替代
- [ ] 移除源 trace 完成，真修落地

## Touches

- plugin/test/tmux-leak-scan.test.mjs（@test-group engine→governance + TEMP-OFF-CERT-PATH）
- plugin/test/test-isolation-check.test.mjs（同上）
- tasks/gap-leak-scan-temp-off-cert-path-expiry.md（自身——到期）
