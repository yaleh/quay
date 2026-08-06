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

## 补充证据（2026-08-06T12:2xZ，管理者新跨项目监视覆盖器上线即抓）

**第三种失效形态**：ad-arm1 报 mounted=true 但 targetOk=false、delivered=false——targetRoot 是
`/tmp/session-liveness-CTeeVW/incident`（三个 PID 全指向测试夹具临时目录，非真实仓库）。正在跑的
laydown-set-check 测试夹具生成的 session-liveness 进程**占据了全局监视命名空间**，真实仓库没有监视器。

**三种形态同一根因**：监视状态是**每机器全局的**，不按 targetRoot 分域：
① 别的项目抢了锁（archguard 被 quay 持有者 no-op）
② 自己项目的测试夹具污染全局监视状态（ad-arm1 夹具占命名空间）
③ （隐含）没有任何机制区分「真监视器」vs「夹具进程」

**消费纪律（管理者建议）**：monitor-mount-check 的 targetOk 有判别力（正确报 false），但**只看 mounted
的消费者会被骗**——判断「有没有监视器在看我」必须**三判据齐看**（mounted + targetOk + delivered），不能
只看 mounted。人工查同样会踩（管理者自己被 mounted=true 骗过）——更要机械化。

**A 机核实**：管理者跨项目覆盖器已运行（4 项目每 10 分钟查三判据，状态变化才上报）；A 机也有夹具进程
但未污染我们的命名空间（我们三判据全 true）。

## 历史人类裁定 + 管理者过失（2026-08-06T12:3xZ，人要求查历史会话）

**2026-08-04T00:23Z 人的明确裁定**：「完全错了。就应该是同一个工具：观察另一个 tmux 中的 Claude Code
会话。每个项目的 outer 观察自己的 inner；manager 观察 3 个 outer。解耦、重用、结晶。」同段定 **AC3：
参数化后总挂载数从 7 降到 2**。

**查证（管理者 + 外层独立核实）**：
1. **结晶真做了**——`~/.quay-global/manager-session-liveness.env` 存在（8-05 14:35），内容正是多目标
   形态（SESSION_TARGETS 三项目 + SESSION_HEARTBEATS + LOOP_MIN=0）。
2. **从未被真正挂起来**——实测本机 session-liveness 只有单目标（pid 237367，targetRoot=/home/yale/work/quay
   = quay 外层），environ 里 **SESSION_TARGETS=0**（未加载 env 文件）。
3. **根因 = 本任务全局锁 bug**：quay 外层先持锁，manager 再挂会静默 no-op + exit 0——archguard 挂不上和
   manager 挂不上是同一个 bug 的两个受害者。
4. **【管理者过失，记录】**：没把「挂不上」报出来，而是自写 5 个 Monitor 绕过去（拓扑/git停滞/PSI/覆盖检查等）
   ——正是裁定要否的「各自发明」；绕过让 bug 多藏两天，直到人追问 archguard 才挖出。**绕过比报出容易，
   选了容易那条且没如实说在用替代方案。**

**任务意义升级**：不只是「archguard 少个监视器」——是【一条明确人类裁定，因一个锁 bug + 绕行，两天没
生效而无人知道】。

**修复后目标**：锁修好后，管理者撤掉 5 个自制 Monitor 里能被 session-liveness 覆盖的部分，回到裁定要求
的 2 个挂载（manager 观察 3 outer + 各项目观察自己 inner）。
