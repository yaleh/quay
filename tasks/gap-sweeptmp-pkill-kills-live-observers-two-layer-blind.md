---
id: gap-sweeptmp-pkill-kills-live-observers-two-layer-blind
title: "session-liveness 清理用 pkill -f 按名批量杀，杀掉在用监视器——两层观测同时失明且无观测者（外层+manager 2026-08-08 取证）"
status: ready
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

- [ ] AC1: **取证固化**——任务体记录本次 kill 调用与被杀 pid 对照（1632950 等），确认清理路径确实按名
      批量杀了在用实例（本任务 Proposal 已含，实现前复核）
- [ ] AC2: **清理路径无 pkill -f 'session-liveness.sh' 类命令**——全仓清理逻辑 grep `pkill -f.*session-liveness`
      = 0 命中（或改为精确 pid / 属主存活判据）
- [ ] AC3: **区分判据落地**——清理器区分「泄漏残留」与「在用实例」的依据 = **属主会话是否存活**（不是
      进程名/路径匹配），实现 + 测试
- [ ] AC4: **负控制**——构造「属主会话活着的 session-liveness 实例」+「属主已死的残留」两种，清理器
      只清后者，前者保留（测试）
- [ ] AC5: **观测层（若做候选 D）**——「观测者被杀」可被检测：session-liveness 实例注册状态可查，外层
      /manager 能发现实例消失（而非靠 Monitor 被动报 failed）

## Definition of Done

- [ ] AC1–AC5 全部勾上（AC5 若选做）
- [ ] 修后实测：内层清理逻辑跑完，外层/manager/inner 的 session-liveness 监视器**全部仍在报事件**
      （实跑贴任务体）
- [ ] 既有 session-liveness 测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/test/session-liveness-helpers.mjs（sweepTmp 清理逻辑）
- plugin/test/session-liveness-signals.test.mjs（AC3/AC4 测试）
- plugin/test/session-liveness-events.test.mjs（AC3/AC4 测试）
- plugin/test/session-liveness-heartbeat.test.mjs（AC3/AC4 测试）
- plugin/scripts/session-liveness.sh（候选 D：观测层注册）
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

measure   live_observers_after_cleanup = 清理逻辑运行后存活的 session-liveness 实例数（应 = 清理前在用数）
band      live_observers_after_cleanup = 全部在用实例存活（outer/manager/inner 一个不少）
invariant no_pkill_by_name_on_live = 1（清理路径无 `pkill -f 'session-liveness.sh'` 类命令）
invariant observer_death_detectable = 1（若做候选 D：观测者被杀可被发现，非被动等 Monitor failed）
invoke    `pkill -f 'session-liveness.sh'`（修后应 0 命中清理路径）/ 清理器实跑贴回
control   清理前在用实例全存活；清理后仍全存活（AC3 负控制：只清属主已死的残留）
resume    清理判据修正 + 测试 + 观测层（可选）分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-08
changed: 建任务（manager 指出两层同时失明 + 外层从子代理 transcript 补齐 kill 对照取证；方向已定候选 A-D，
实现与测试归内层）
