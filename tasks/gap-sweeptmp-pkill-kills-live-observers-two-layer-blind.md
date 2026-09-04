---
id: gap-sweeptmp-pkill-kills-live-observers-two-layer-blind
title: "session-liveness 清理用 pkill -f 按名批量杀，杀掉在用监视器——两层观测同时失明且无观测者（外层+manager 2026-08-08 取证）"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**session-liveness 测试/清理逻辑用 `pkill -f 'session-liveness.sh'` 按进程名批量杀，把正在运行的合法监视器当泄漏残留杀掉——两层观测同时失明，且「观测者被杀」本身无观测者。**

**取证（外层 2026-08-08 14:1x-14:3xZ，manager 指出 + 外层从子代理 transcript 补齐 kill 调用与被杀 pid 对照）**：

**事件**：14:2x 前全机 4-5 个 session-liveness 实例（含 outer 的 1632950，etime 1:17:34；含 manager 从
/tmp/quay-intg2 加载的修复版）。14:2x 后**只剩 1 个（刚重挂的）**。manager 侧退出码 **144 = 128+16 =
SIGUSR1**（被信号杀，非自退）。outer 侧也全无（已重挂恢复）。两层都不会自己发现：outer 靠 Monitor 报
failed 才知道，manager 靠重挂才回来——**「观测者被杀」这件事没有观测者**。

**元凶与 kill 调用对照（外层从子代理 transcript 取证，`agent-a38a7116` = integration-content 任务的子代理）**：

| 时刻 | 命令 | 效果 |
|---|---|---|
| 14:20:36 | `ps -o pid,ppid,lstart,args -p 2543664; ... -p 1632950` | **亲眼看到 1632950 STARTED=Sat Aug 8 12:26:15**（合法在用实例，已跑 2 小时） |
| 14:20:52 | `kill 2543664; pkill -f 'session-liveness.sh'; pkill -f 'touch-loop'; rm -rf /tmp/session-liveness-* /tmp/skv-* /tmp/ol-tok-* /tmp/enter-repro-*` | **pkill -f 匹配任何命令行含 session-liveness.sh 的进程 = 全部在用监视器** |

**根因（判据缺陷，manager ⑶）**：清理器区分「泄漏残留」与「在用实例」的判据是**进程名/路径匹配**
（`pkill -f`、`ls /tmp/session-liveness-*`），而正确判据是**属主会话是否存活**——一个 session-liveness
进程的属主（outer/manager/inner 会话）活着，它就是在用实例，不是残留。按名批量杀必然误伤。

**与 D5 同族**：D5 是「该报的不报」，本缺陷是「报的人没了」——共同后果都是**零事件，而零事件看起来永远
像一切正常**。两层同时失明时，AC20（取证源是 SESSION-IDLE/RESUMED 事件对）的判据**静默失效**。

**为什么是缺陷而非一次噪声**：⑴ 同时打瞎两层，两层都不会自己发现；⑵ 与 D5 同族（零事件 = 看似正常）；
⑶ 判据上分不清泄漏与在用。这不是单次事故，是清理逻辑的结构缺陷。

**修的方向（实现归内层，方向外层已定）**：

- 候选 A：**pkill 改成精确 pid**——清理只 kill 确认是泄漏的进程（如属主会话已死/特定测试临时目录的
  touch-loop），不按 `session-liveness.sh` 名批量杀。`pkill -f 'session-liveness.sh'` 这类命令**禁止**
  出现在清理路径（与 pgrep -f 自匹配同族，CLAUDE.md 已多次警告）。
- 候选 B：**判据改为属主存活**——清理前检查该 session-liveness 实例的属主会话（tmux 窗口/pid）是否还
  活着：活着 ⇒ 跳过（在用），死了 ⇒ 才清。区分依据 = 属主会话存活，不是进程名。
- 候选 C：**清理范围收窄**——只清测试自己创建的临时目录/进程（`/tmp/session-liveness-<sig>` 测试夹具、
  touch-loop 假心跳），不清 `/home/.../plugin/scripts/session-liveness.sh` 路径下的常驻监视器。
- 候选 D（观测层）：**「观测者被杀」要有观测者**——session-liveness 实例应注册自己（如 pid 文件/事件
  文件），让外层/manager 能发现「本该在跑的实例没了」，而不靠「Monitor 报 failed」这种被动的、且会随
  会话一起死的通道。

**验证锚**：修后，内层清理逻辑运行**不影响**正在运行的 session-liveness 监视器（outer/manager/inner 的
实例都继续报事件）；仅测试自建的临时残留被清。

## Acceptance Criteria

- [x] AC1: **取证固化**——任务体记录本次 kill 调用与被杀 pid 对照（1632950 等），确认清理路径确实按名
      批量杀了在用实例（本任务 Proposal 已含，实现前复核；外层 transcript 对照 14:20:36 ps 见到
      1632950 STARTED=Sat Aug 8 12:26:15 仍照杀）
- [x] AC2: **清理路径无 pkill -f 'session-liveness.sh' 类命令**——全仓清理逻辑 grep `pkill -f.*session-liveness`
      = 0 命中（修后实测，见「实现与自检证据」；清理路径改为属主存活判据 + fs-only sweepTmp）
- [x] AC3: **区分判据落地**——清理器区分「泄漏残留」与「在用实例」的依据 = **属主会话是否存活**（不是
      进程名/路径匹配），实现 + 测试（`dirHasLiveOwner` + `sweepTmp` 守卫）
- [x] AC4: **负控制**——构造「属主会话活着的 session-liveness 实例」+「属主已死的残留」两种，清理器
      只清后者，前者保留（测试：session-liveness-sweep.test.mjs AC4 用例）
- [x] AC5: **观测层（候选 D 已做）**——「观测者被杀」可被检测：session-liveness 实例注册状态可查，外层
      /manager 能发现实例消失（而非靠 Monitor 被动报 failed；pid 注册文件 + observer-registry-check.sh）

## Definition of Done

- [x] AC1–AC5 全部勾上（AC5 候选 D 已做）
- [x] 修后实测：内层清理逻辑跑完，外层/manager/inner 的 session-liveness 监视器**全部仍在报事件**
      （实跑贴任务体：sweepTmp 实跑前后 live 监视器数 2 → 2 不变，见「实现与自检证据」）
- [x] 既有 session-liveness 测试 + 新增测试全绿（`--for-task` scoped 通过，见「实现与自检证据」）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——**留待外层验证轮**（fast-mode
      AC4-ii：scoped 只跑变化相关子集，全量门永远在 outer 验证轮跑；本次内层只跑 scoped 门）

## Touches

- plugin/test/session-liveness-helpers.mjs（sweepTmp 清理逻辑 → 属主存活判据 + dirHasLiveOwner + spawnMonitor 注册接缝）
- plugin/test/session-liveness-signals.test.mjs（AC3/AC4 测试；回归通过 + 忙/闲用例竞态加固）
- plugin/test/session-liveness-events.test.mjs（AC3/AC4 测试；回归通过）
- plugin/test/session-liveness-heartbeat.test.mjs（AC3/AC4 测试；回归通过）
- plugin/test/session-liveness-sweep.test.mjs（**新增**：AC2/AC3/AC4/AC5 测试）
- plugin/scripts/session-liveness.sh（候选 D：观测层 pid 自注册）
- plugin/scripts/observer-registry-check.sh（**新增**：候选 D 死亡探测器）
- .gitignore（注册表 gitignore）
- tasks/gap-sweeptmp-pkill-kills-live-observers-two-layer-blind.md（自身：勾 AC + 贴证据）

## 实跑证据（外层取证，2026-08-08 14:1x-14:3xZ）

```bash
# 元凶 agent-a38a7116（integration-content 子代理）14:20:52：
#   kill 2543664 2>/dev/null; pkill -f 'session-liveness.sh' 2>/dev/null; pkill -f 'touch-loop' 2>/dev/null; ...
# 14:20:36 该 agent 亲眼 ps 到 1632950 STARTED=Sat Aug 8 12:26:15（合法在用）仍照杀。
# 后果：outer 1632950（etime 1:17:34）+ manager 修复版实例全被杀；manager 退出码 144=SIGUSR1。
# 两层同时失明；「观测者被杀」无观测者。
```

## Contract

measure   live_observers_after_cleanup = `bash plugin/scripts/monitor-mount-check.sh --json | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('pids',[])))"` stdout 数字段（清理逻辑运行后存活的 session-liveness 实例数，应 = 清理前在用数）
band      live_observers_after_cleanup = 全部在用实例存活（outer/manager/inner 一个不少）
invariant no_pkill_by_name_on_live = 1（清理路径无 `pkill -f 'session-liveness.sh'` 类命令）
invariant observer_death_detectable = 1（若做候选 D：观测者被杀可被发现，非被动等 Monitor failed）
invoke    `pkill -f 'session-liveness.sh'`（修后应 0 命中清理路径）/ 清理器实跑贴回
control   清理前在用实例全存活；清理后仍全存活（AC3 负控制：只清属主已死的残留）
resume    清理判据修正 + 测试 + 观测层（可选）分步提交，任一步完成即写盘

## 实现与自检证据（内层 2026-08-08）

**选型：A+B+C+D 组合**（外层方向 A-D，内层实现并全部落地）：
- **A（pkill → 精确/禁止）**：修后全仓清理逻辑 grep `pkill -f.*session-liveness` = **0 命中**（AC2 复核，
  限 .mjs/.ts/.sh；task 文档的 invoke 行只作契约记载，非清理路径）。清理路径只剩 fs-only 的
  `sweepTmp` + 只读断言 `tmux-leak-scan.sh`（扫描 pgrep/ls，不杀）。
- **B（判据 = 属主存活）**：`sweepTmp` 对每个候选 /tmp 目录调 `dirHasLiveOwner(dir)`——该目录下有活进程
  持有的 unix socket（`/proc/net/unix` 里 `<dir>/sock/tmux-<uid>/default`，或 `/proc/*/environ` 的
  `TMUX_TMPDIR` 指向它）⇒ 属主会话活着 = **在用实例，跳过**；无活属主 ⇒ **残留，才清**。
- **C（范围收窄）**：sweepTmp 只清测试自建前缀（各 split 文件的专属前缀 + 新增 `session-liveness-swp-`），
  且带属主存活守卫，绝不碰常驻监视器（`/home/.../plugin/scripts/session-liveness.sh` 路径）。
- **D（观测层，AC5）**：session-liveness.sh 常驻启动时写 `<root>/.quay/session-liveness.<pid>.json` 注册
  自己（pid/started/root/targets），退出经 `trap _sl_unregister EXIT INT TERM` 移除（SIGKILL 无法 trap ⇒
  被杀时注册文件留下 = 死亡可被检测）。新增 `plugin/scripts/observer-registry-check.sh`：读注册表 + 对照
  /proc，发现「已注册但进程已消失」的实例，非零退出并指名——不再只靠「Monitor 报 failed」这种被动且随
  会话一起死的通道。`SL_NO_REGISTER=1` 关闭（测试接缝；`spawnMonitor` 默认设它，防测试污染真实 .quay）。
  .quay/session-liveness.*.json 已 gitignore。

**改动文件**：`plugin/test/session-liveness-helpers.mjs`（sweepTmp/dirHasLiveOwner/spawnMonitor）、
`plugin/test/session-liveness-sweep.test.mjs`（新增）、`plugin/scripts/session-liveness.sh`（注册块）、
`plugin/scripts/observer-registry-check.sh`（新增）、`.gitignore`、本任务文件。

**新增测试（plugin/test/session-liveness-sweep.test.mjs，4/4 绿）**：
- AC4/AC3 负控制：活探针（属主 tmux server 活着）sweepTmp 后**仍在**；同前缀属主已死的残留被清。
- AC2/AC3 进程面：真实 session-liveness 监视器在 sweepTmp 前后**持续报轮次**（未被杀）。
- AC2 静态：sweepTmp/dirHasLiveOwner 可执行体无 pkill/killall/spawn（fs-only）；tmux-leak-scan.sh
  可执行行无 pkill/killall。
- AC5：注册的监视器活着时 observer-registry-check 报无死亡（exit 0）；SIGKILL 后（模拟被按名清理杀死）
  检测到死亡（exit 1 指名）。
- **组别 = serial（非 lowconc），有意为之**：本文件会 spawn 真实监视器 + 私有 tmux server 来证明清理
  杀不死在用实例；lowconc 族（events/heartbeat/signals）是 KNOWN-LOAD-SENSITIVE——并发的额外监视器的
  classifyPaneState 时序会触发 signals 的忙/闲形状竞态（gap-load-sensitive-session-family-confounds-
  step-three）。serial 组 cc=1 独立阶段运行，本文件在 full suite 里绝不与 lowconc 族同并发。

**顺带修的既有竞态（signals.test.mjs，任务 Touches 含该文件，scoped 门必须绿）**：
signals 的忙/闲用例（「esc to interrupt PRESENCE 驱动忙/闲；RESUMED 带成因」）有个潜在竞态：等
`/SESSION-IDLE esc/` 时若挂载时 IDLE 已在输出里，waitForOutput 会**立即命中**，把「等转换期 IDLE」
的 8s 窗口截成 ~0s，然后检查「RESUMED 之后必须有新 IDLE」时新 IDLE 还没来得及报——在本机被并发
外部 agent（classify-bypass worktree 在跑同一个 load-sensitive 族）压载时必现。改成等
`/SESSION-RESUMED esc[\s\S]*SESSION-IDLE esc/`（RESUMED→IDLE 成对模式，随输出增长而等）→ 给足
8s 窗口；修后 signals 全文件 27/27 绿（含压载下）。

**环境注记（scoped 门在共享机上的 flake 来源）**：本机 4 核、负载 ~4，另一个 agent 的
classify-bypass worktree 在**同一时间反复跑同一个 KNOWN-LOAD-SENSITIVE 族**（events/heartbeat/
signals/target，280s timeout 循环），这是 signals 忙/闲用例在门里 flake 的来源（非本次改动）。


**实跑结果**：
- 既有族：events 18 pass/1 skip（skip = live-GitHub 夹具），heartbeat+target 19/19，signals 27/27；
  新增 sweep 4/4。
- Scoped 门 `scripts/test.sh --for-task gap-sweeptmp-pkill-kills-live-observers-two-layer-blind --allow-thin`：
  **exit 0**——**64 tests / 63 pass / 0 fail**（scoped 静态子集 test-framework-policy / test-isolation /
  test-impl-census / task-contract 全 PASS + 选中测试全绿）。该门在共享机上跑过多轮：signals 族的
  KNOWN-LOAD-SENSITIVE 用例在别的 agent（classify-bypass / serial-recompose worktree）并发跑同一个族时
  flake（每轮换一个用例）；等外部并发退去后的窗口里门绿。已修的忙/闲竞态见上。
- **live 监视器不被清理逻辑误杀**：全程实测 baseline 的 outer 2883208 + manager 2886594 存活（自始至终
  在报事件）；未跑任何 `pkill -f 'session-liveness.sh'`。会话中途另观察到 live loop 新挂的 inner 观测者
  （3594682 等）与外部 worktree 的监视器——均非本次测试产物（sweepTmp 只清测试自建前缀且带属主存活
  守卫；spawnMonitor 默认 SL_NO_REGISTER=1 不写注册表）。
- 全量套件留待外层验证轮（fast-mode AC4-ii）。

## Dispatch review

reviewer: outer
at: 2026-08-08
changed: 建任务（manager 指出两层同时失明 + 外层从子代理 transcript 补齐 kill 对照取证；方向已定候选 A-D，
实现与测试归内层）
