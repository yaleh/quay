---
id: gap-session-liveness-single-flight-lock-cross-project-blind
title: "session-liveness single-flight lock is PER-MACHINE not per-project — archguard has had NO liveness monitor for a day+ (diagnosed correctly + escalated by archguard tick #53, 2026-08-05 07:31, 'single-flight lock held by quay only watches quay sessions; archguard/meta-cc events never produced → escalated (holder target scope beyond outer authority)'); root cause verified: SL_GLOBAL_DIR=$HOME/.quay-global/session-liveness (per-machine, session-liveness.sh:777), lock_token=$SL_GLOBAL_DIR/heavy-op/token (per-machine not per-project, :799), _sl_acquire_or_noop returns 1=noop+caller exit 0 on live holder (:794-796) so archguard mount silently no-ops with exit 0 (looks successful, monitors nothing); no mechanism catches it — no task filed, monitor-mount-check only answers 'is there a monitor on this machine' (target_ok = all targetRoot==REPO_ROOT, per-project boundary) not 'is there a monitor watching ME'; cross-project defect correctly diagnosed+escalated but falls through 'nobody owns the machine' seam; human ruling 2026-08-06: file it"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**session-liveness 单飞锁按机器不分项目——archguard 一天多无监视器，正确诊断+升级却掉进「谁都不负责」缝隙。**

**【三段查证（管理者 + 外层独立核实）】**：
1. **archguard 诊断正确并升级**（tick #53，2026-08-05 07:31）：「single-flight lock held by quay (pid
   2598198) only watches quay sessions; archguard/meta-cc session liveness events never produced →
   escalated (holder target scope is beyond outer authority)」。
2. **机制结构性 no-op**：`SL_GLOBAL_DIR=${QUAY_GLOBAL_DIR}/session-liveness`（session-liveness.sh:777）**每机器
   一把锁**；`lock_token=$SL_GLOBAL_DIR/heavy-op/token`（:799）**不分项目**；`_sl_acquire_or_noop`（:794-796）
   **0=取得锁继续监视，1=有活持有者=空操作+调用方 exit 0**——archguard 挂载遇 quay 持有者 → 静默 no-op +
   exit 0，看起来成功实际什么都没监视。**「判据在没有依据时仍给出肯定答案」**。
3. **无机制接住**：tasks/ 无立案；`monitor-mount-check.sh` `target_ok = all(t.targetRoot == REPO_ROOT)`
   （:143）只答「本机有没有监视器」，不答「有没有监视器在看我」——每个 outer 判据边界是「我自己这个项目」，
   缺陷作用域是「整台机器」，掉进缝隙。

**【形态】**：跨项目缺陷被正确诊断、正确升级，却掉进「谁都不负责」缝隙。

### 选定机制（管理者建议 + 外层采纳）

1. **机制层——单飞锁按 targetRoot 分域**：`$QUAY_GLOBAL_DIR/session-liveness/<target-root-slug>/heavy-op/token`
   （每项目一把锁）；`_sl_acquire_or_noop` 遇活持有者时检查其 targetRoot 是否是我要监视的那个，不是就不该 no-op
2. **判据层——monitor-mount-check 答「有没有监视器在看我」**：不只「本机有没有监视器」，能答指定项目的
   监视覆盖

## Acceptance Criteria

- [ ] AC1: 单飞锁按 targetRoot 分域——archguard/meta-cc 可各自挂载监视器（不与 quay 冲突）
- [ ] AC2: _sl_acquire_or_noop 遇活持有者检查 targetRoot——不是我要监视的就不 no-op（可并行挂载）
- [ ] AC3: monitor-mount-check 能答「有没有监视器在看我」（指定项目）而非只「本机有没有」
- [ ] AC4: archguard 挂载后事件真实产生（非静默 no-op）——与 session-liveness 多项目并行验证

## Touches

- plugin/scripts/session-liveness.sh（单飞锁分域 + targetRoot 检查）
- plugin/scripts/monitor-mount-check.sh（「在看我」判据）
- plugin/test/（AC1-AC4 测试）

## Contract

measure   per_project_mount = `bash plugin/scripts/monitor-mount-check.sh --json --root <archguard> 2>&1 | grep -c '"mounted": true'` stdout 数字段
band      per_project_mount >= 1（archguard 可挂载监视器，非 no-op）
invoke    `grep -n 'SL_GLOBAL_DIR\|lock_token\|_sl_acquire_or_noop\|targetRoot' plugin/scripts/session-liveness.sh`
control   archguard 挂载成功 + 事件产生（AC4）；quay 不受影响（AC1）
resume    锁分域与判据分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T12:1xZ
changed: 人要求立案——跨项目监视缺口（archguard 一天多无监视器）。三段查证坐实（诊断正确+升级 /
锁机制结构性 no-op / 无机制接住）。跨项目缺陷正确诊断升级却掉「谁都不负责」缝隙。采纳管理者两建议
（锁按 targetRoot 分域 + monitor-mount-check 答「在看我」）。
