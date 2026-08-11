---
id: gap-full-suite-runner-cgroup-scope-evidence-unfound
title: full-suite-runner's findSuiteScopeUnit matches rigid run-p<pid>- prefix
  but this host's systemd names transient scopes run-r<hex>.scope ⇒
  suite-cgroup-evidence.txt never written ⇒ AC1 test 1/75 consistently times out
  (poll timeout 10000ms), full-suite never green on this host
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**`findSuiteScopeUnit`（plugin/scripts/full-suite-runner.ts:898-911）只匹配 `run-p${pid}-` 前缀的 systemd transient scope，而本机 systemd 把 `systemd-run --scope` 的 transient scope 命名为 `run-r<hex>.scope`（`r` = 随机/运行时），前缀不匹配 ⇒ `suite-cgroup-evidence.txt` 永远写不出来 ⇒ full-suite-runner.test.mjs 的 AC1 测试（「runner 用 systemd-run cgroup scope 包套件」）恒 10s poll 超时。**

### 实证（2026-08-11，两个独立 subagent + 本 tick 复核）

1. **verification-round subagent**（gap-verification-round-missing-phase-ms-breaks-cost-attribution）：
   该任务 scoped 跑报 `tests 75 / pass 74 / fail 1 / cancelled 0`，唯一 fail = AC1「runner wraps suite in a
   systemd-run cgroup scope」（10s poll `suite-cgroup-evidence.txt` 超时）；**隔离单跑在 pristine develop
   (51885b79) 同样失败**——前存在环境性，非本次改动回归（C11 判定）。
2. **suite-red-verdict subagent**（gap-suite-red-verdict-carries-empty-failures-payload）独立复现并给出根因：
   本机 systemd 命名 transient scope 为 `run-r<hex>.scope`，而 `findSuiteScopeUnit` 搜 `run-p<pid>-` 前缀
   ⇒ 证据文件永不写入（隔离也失败；与该任务 AC 无关，不在其 Touches）。
3. **本 tick 复核**（C13）：`full-suite-runner.ts:899` `const prefix = `run-p${pid}-``；`systemctl --user
   list-units --type=scope` 只查该前缀（:910 `unit.startsWith(prefix)`）。代码对 scope 命名的假设与本机
   systemd 实际命名错配。
4. **影响**：full-suite-runner.test.mjs 恒 74/75 ⇒ 本机全量套件永远差一个 fail 无法判绿；外层
   verification-round 的判绿三条件（`fail 0` + `FULL-SUITE-EXIT=0` + reference `tests`）被此环境性失败卡住。

### 选定机制

修 `findSuiteScopeUnit` 的 scope-unit 匹配：从刚性 `run-p<pid>-` 前缀改为对本机 systemd 命名健壮
（例如：从 `systemd-run` 的 spawn 结果/`systemctl --user` 输出里取实际创建的 scope 名，或同时匹配
`run-p<pid>-` 与 `run-r*.scope` 形态，或改由 runner 直接记录 systemd-run 返回的 unit 名）。
AC1 测试随之补一个本机命名形态的 fixture。

## Acceptance Criteria

- [x] AC1: `full-suite-runner.test.mjs` 在本机 75/75 全绿（AC1 cgroup-evidence 测试不再 poll 超时），隔离单跑验证
- [x] AC2: `findSuiteScopeUnit` 不再只匹配 `run-p<pid>-` 前缀——对本机 systemd 实际 scope 命名健壮（有单测 pin 本机形态）
- [x] AC3: 既有 74 个测试零回归（scoped `scripts/test.sh --for-task <id> --allow-thin` 全绿）

## Invoke evidence（inner 2026-08-11）

实现：`findSuiteScopeUnit` 主路径改为读被 spawn 的 `systemd-run --scope` 进程自己的 cgroup
（`/proc/<pid>/cgroup` → leaf 即 scope unit 名），对本机 `run-r<hex>.scope` 与经典 `run-p<pid>-*.scope`
任意命名健壮；`systemctl --user list-units` 的 `run-p<pid>-` 前缀轮询降级为 fallback。新增
`scopeUnitFromCgroupLine` / `readScopeUnitFromCgroup` 两个可测导出（AC2 单测 pin 本机形态 + 拒绝
`init.scope`/`tmux-spawn-*.scope` 等非 transient scope）。AC1 测试断言同步放宽：`scope_unit=` 匹配
`run-r<hex>.scope` 或 `run-p<pid>-` 两形态；`TasksMax=200` 匹配普通或 `EffectiveTasksMax=200`
（systemd 255 对本机 scope 不暴露 `Effective*`，实测 `systemctl --user show` 无该属性）。

- 隔离单跑 `bash scripts/test.sh plugin/test/full-suite-runner.test.mjs`：
  `tests 77 / pass 77 / fail 0 / cancelled 0 / skipped 0 / duration_ms 32041.7` — EXIT 0。
  其中 AC1「runner wraps the suite in a systemd-run cgroup scope; the applied limits are visible as
  durable evidence (real systemd)」通过（3149.9ms，证据文件正常写出，不再 10s poll 超时）。
- scoped `bash scripts/test.sh --for-task gap-full-suite-runner-cgroup-scope-evidence-unfound --allow-thin`：
  `tests 77 / pass 77 / fail 0 / cancelled 0 / skipped 0 / duration_ms 36235.9` — EXIT 0。
- Contract invariant `full_suite_runner_tests = 75` 现为 77：74 既有 + AC1 恢复 + AC2 新增 2 个本机形态单测（additive，零删除）。

## Definition of Done

- [ ] 全量套件（外层 verification-round 判据：fail 0 + FULL-SUITE-EXIT=0 + reference tests 数）在本机绿

## Contract

measure   scope_unit_found   = `findSuiteScopeUnit(<spawned pid>)` 在本机返回非 null（`full-suite-runner.ts` stdout/测试断言）
band      scope_unit_found   = 本机 `systemd-run --scope` 实际命名的 scope 被捕获（不再是 `run-p<pid>-` 空搜）
invariant full_suite_runner_tests = 75（本机 74 既有 + AC1 恢复）
invoke    `bash scripts/test.sh --for-task gap-full-suite-runner-cgroup-scope-evidence-unfound --allow-thin`（贴 pass/fail/cancelled + EXIT）
control   人为用非本机命名形态创建 scope ⇒ 仍能按真实 systemd 命名捕获（负控制）
resume    每跑完一次即写盘

## Touches

- plugin/scripts/full-suite-runner.ts（findSuiteScopeUnit 匹配健壮化）
- plugin/test/full-suite-runner.test.mjs（AC1 fixture + 本机命名形态单测）
- tasks/gap-full-suite-runner-cgroup-scope-evidence-unfound.md（自身：勾 AC + 贴证据）

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: 建任务（inner 2026-08-11 full tick 期间由 verification-round/suite-red-verdict 两个 subagent 独立发现：本机 systemd 把 transient scope 命名为 run-r<hex>.scope 而 findSuiteScopeUnit 只匹配 run-p<pid>- ⇒ suite-cgroup-evidence.txt 永不写 ⇒ full-suite-runner.test.mjs AC1 恒 10s 超时，本机全量套件恒 74/75 无法判绿）。status: todo 未派发；outer 补 Dispatch review 消除 task-contract-check ratchet 静态红。
