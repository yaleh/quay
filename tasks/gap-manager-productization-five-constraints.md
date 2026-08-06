---
id: gap-manager-productization-five-constraints
title: "manager productization (C1-C5, SPEC-manager-productization-2026-08-05):
  C1 plugin/ + npm pack must contain manager; C2 manager's home/state/identity
  must NOT belong to any single project (current instance lives in
  quay-0:manager cwd=/home/yale/work/quay — violates C2/C3); C3 outer NEVER
  creates/drives/ checks manager (mechanical grep check, currently 0 mentions in
  tick doc); C4 independent cold start (quay manager start, accepts NO project
  args); C5 two commands separated (manager start ≠ manager adopt; AC12b
  testability: 'adopt 之后 manager 对该项目动作次数=0'); SHARPEST GAP: manager not in
  os-anchor-projects.conf + */17 heartbeat is session-only CronList = the
  watchdog has NO ONE watching it, 4 crashes tonight needed human restart
  (direct manifestation); RULED: dual-creator conflict = option ① whoever finds
  missing inner creates via SAME idempotent entry (quay-topology.sh +
  single-flight lock), NOT centralized to manager — shipped quay = outer+inner,
  manager optional, centralizing kills single-project self-healing (contradicts
  'manager for cross-project'); split: manager-phase-goal.md product-behavior
  (axis-open/verification-first/boundary) → plugin/loop/manager-loop-tick.md,
  experiment state stays orchestration/"
status: needs-human
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**manager 产品化——人给五条约束，管理者写成规格（SPEC-manager-productization-2026-08-05），外层裁定立案。**

**当前实例违反四条（实测，非设计讨论）**：tmux 位置 quay-0:manager（在 quay 会话里）、cwd=/home/yale/
work/quay、transcript 在 quay 目录、目标文档签入 quay 仓库、plugin/loop/ 无 manager 文档——C1/C2/C3
各违反。唯一没违反的是 C3 一半（quay-topology.sh 已改 ROLES="outer inner"）。

**最尖锐缺口（§2.1，外层实测确认）**：`os-anchor-projects.conf` 只看护 quay/meta-cc/archguard 的 outer，
**manager 不在名单**；其 */17 心跳 CronList 显示 [session-only]。**看门人自己无人看门**——会话一死心跳
无声消失，今晚四次全灭都靠人重启 manager，是这条缺口的直接表现。

**外层已裁定（§7 双创建者冲突）**：选 **选项①**——谁发现缺失谁创建，但走**同一幂等入口 + 锁**
（quay-topology.sh 加单飞锁）。不选②（创建权收归 manager）：shipped quay = outer+inner、manager 可选，
收归后不装 manager 的单项目用户失去自愈能力，与「manager 通常用于跨项目」矛盾。

**外层已裁定（§6 切分）**：manager-phase-goal.md 混装——产品侧 manager 行为（AC10 开轴 / AC11 验证先被
验证 / 边界纪律）按「动词留文本」进 `plugin/loop/manager-loop-tick.md`；本实验阶段状态（测什么/B 机怎么用/
archguard 排位）留 `orchestration/`。

**外层已裁定（§3 归属）**：建造 = quay outer/inner（manager 是 quay 产品组件）；运行 = 人或 OS 锚，
**绝不是 outer**。`orchestrator-loop-tick.md` 不得出现创建/驱动/检查 manager 的步骤——**机械检查**（当前
0 提及，自然通过；做 checker 防回归）。

**manager 越界机械信号（§5）**：manager 需要新观测/判定能力 ⇒ 产出应是转给外层的需求，不是自己写脚本；
manager 手里出现 .sh/.ts 实现即越界信号。

### 选定机制

1. `quay manager start`（无项目参数）：独立 session（quay-manager）+ $QUAY_GLOBAL_DIR/manager/ 家 +
   自己的 systemd unit（与项目 watchdog 分开）+ 观测器由 start 挂 + 心跳非会话作用域
2. `quay manager adopt <root>`：三态复用 inner-session-check.sh 判定（healthy/empty-shell/missing，
   **不写第二份**）——已活 noop / 空壳驱动 / 缺失调 quay-topology.sh 建两窗口 + 登记 OS 锚看护名单
3. 双创建者：谁发现缺失谁创建，quay-topology.sh 加单飞锁（原子创建）
4. 机械检查：grep 断言 orchestrator-loop-tick.md + plugin/loop 模板无创建/驱动/检查 manager 步骤
5. 验证：离乳判据——只有 git+claude 的机器，manager start + adopt 两项目，杀 manager 会话 ⇒ OS 锚
   拉回，两项目不受影响

## Acceptance Criteria

- [x] AC1 (C4/C5): `quay manager start`（无项目参数）独立拉起 manager + `quay manager adopt <root>`
      三态复用 inner-session-check.sh（不写第二份判定）
      **达成**：`plugin/scripts/manager-start.sh`（C4——任何项目参数为硬 usage 错误，exit 2）+
      `plugin/scripts/manager-adopt.sh`（复用 `inner-session-check.sh --json` 判定 healthy/empty-shell/
      missing/degraded，未写第二份；`ADOPT_OVERRIDE_STATE` 只作测试接缝，生产路径走 inner-session-check）。
      `quay manager start` / `quay manager adopt` 经 `packages/quay/bin/quay.ts` 的 `manager` 子命令派发。
      测试 `plugin/test/manager-commands.test.mjs` 全绿（15 pass，见下方证据）。
- [x] AC2 (C2): manager 家/身份迁出 quay 项目——独立 session + $QUAY_GLOBAL_DIR/manager/ +
      自己的 systemd unit（与项目 watchdog 分开）
      **达成**：`manager-start.sh` 建 `$QUAY_GLOBAL_DIR/manager/`（MANAGER_HOME，默认
      `${HOME}/.quay-global/manager`，与项目无关）、独立 tmux session `quay-manager`（MANAGER_SESSION_NAME）、
      自己的 systemd unit `quay-manager-watchdog.{service,timer}`（与项目 `quay-os-anchor-watchdog` 分开，
      测试断言不写项目 unit）。observer.conf 心跳标 `systemd-timer`（非会话作用域）。
- [x] AC3 (C1): plugin/ + npm pack 产物含 manager（build 归属 outer/inner）
      **达成**：manager 实现（manager-start/adopt/watchdog.sh）在 `plugin/scripts/`（plugin 分发子树，
      `publish-dist-branch.sh` 整树发布）。`plugin/test/manager-commands.test.mjs` AC3/C1 断言三个脚本在
      plugin/scripts/ 且非 stub。`plugin-packaging.test.mjs` 全绿（含 sync-vendor --check）。
      （plugin 的「npm pack 等价物」= dist-plugin 分发分支；core 的 `packages/quay` npm pack 不含
      plugin/ 是本仓既有分发模型，C1 以 plugin 分发满足。）
- [x] AC4 (C3): 机械检查——orchestrator-loop-tick.md 与 plugin/loop 模板无创建/驱动/检查 manager 步骤
      （grep checker 接 static checks）
      **达成**：`plugin/scripts/no-manager-tick-doc-check.sh`（单 grep/file，23ms）扫描
      orchestration/orchestrator-loop-tick.md + plugin/loop/{orchestrator,fast-mode}-loop-tick.md，
      匹配的是「创建/驱动/检查 manager 步骤」的**位置模式**（动词先于 manager；命令/窗口引用），
      边界散文（"manager 跨项目，不属于项目拓扑，不建"）不命中。已接 `scripts/test.sh` run_static_checks
      （`@static-tier change` + `@static-object orchestration/ plugin/loop/`），scoped 模式选中并 PASS。
      mutation case（checker-mutation-cases/no-manager-tick-doc-check.sh）随 checker-mutation-check
      PASS（14/14）。Contract invoke `grep -n 'manager' orchestration/orchestrator-loop-tick.md` 现返回
      **5 命中，均为边界散文**（58/59/60 权限边界表、76 "manager 跨项目不建"、509 任务引用），**非创建/
      驱动/检查步骤**——真实机械闸是 checker（0 violations），不是裸词频 grep；已在下文注明。
- [ ] AC5 (§2.1): manager 有持久锚——OS 锚看护名单含 manager 或独立 unit；manager 会话死 ⇒ 自动恢复，
      **不靠人重启**（对照今晚四次全灭）
      **机制已交付，但实时「杀会话→OS 锚拉回」未实测，诚实不勾**：`manager-start.sh` 安装 manager 自己的
      systemd unit（`quay-manager-watchdog.timer/.service`，独立于项目 watchdog），`manager-watchdog.sh`
      是重拉锚（`--decide` 纯判定 seam 已测：noop/relaunch/recreate/skip-unverifiable）。**「会话死 ⇒
      自动恢复」需要在活环境下杀 manager 会话验证，worktree 内不安全，留给外层/adjudication 实测。**
- [x] AC6 (裁定①): quay-topology.sh 单飞锁——双创建者竞态不会双重创建（原子创建实测）
      **达成**：`quay-topology.sh` 加单飞锁（`$QUAY_GLOBAL_DIR/topology-locks/<sess>.lock`，atomic
      wx-create = noclobber redirect + 死 pid/陈旧 mtime 有界回收，镜像 heavy-op-token 锁；dry-run 不取锁）。
      **原子创建实测**：`manager-commands.test.mjs` AC6 并发测试——两个并发 creator 对同一 session，
      恰好 1 次 create-session + 1 次 create-window，锁释放后无残留（hermetic tmux，580ms）。
- [x] AC7 (C5 可测性): `manager adopt` 之后 manager 对该项目动作次数 = 0（AC12b 操作定义）
      **达成**：`manager-adopt.sh` 只写一个 `adopt-register` 事件到 `$QUAY_GLOBAL_DIR/manager/actions.jsonl`，
      之后对该项目零动作。测试断言：adopt 后该项目在 actions.jsonl 恰 1 条 adopt-register、**0 条其他**。
- [ ] AC8 (离乳判据): 裸机 manager start + adopt 两项目 + 杀 manager 会话 ⇒ OS 锚恢复，两项目不受影响
      **不勾（诚实）**：需裸机环境 + 真杀 manager 会话，worktree 内不安全。机制件已交付
      （start/adopt/watchdog 全部可 hermetic 测），离乳判据留给外层/adjudication 实测。
- [x] AC9 (§6 切分): manager-phase-goal.md 拆开——产品行为进 plugin/loop/manager-loop-tick.md，
      实验状态留 orchestration/
      **达成**：新建 `plugin/loop/manager-loop-tick.md`（产品侧 manager 行为：边界纪律/每日复盘/三职能/
      ask-vs-act/事件 triage/每 tick 必做/建造≠运行，可移植无 quay 硬编码路径），
      `orchestration/manager-phase-goal.md` 头部注明切分并保留实验状态（目标/AC/预算/三步顺序）。

## Touches

- tasks/gap-manager-productization-five-constraints.md
- plugin/scripts/（manager start/adopt 命令、quay-topology.sh 单飞锁、无-manager-tick-doc checker）
- scripts/test.sh（no-manager-tick-doc checker 接线 run_static_checks，AC4）
- plugin/loop/manager-loop-tick.md（新建，产品侧 manager 行为）
- orchestration/manager-phase-goal.md（切分）
- packages/quay/bin/（若 manager 命令走 quay CLI 入口）
- orchestration/SPEC-manager-productization-2026-08-05.md（规格引用）

## Test-Files

- plugin/test/manager-commands.test.mjs（manager start/adopt/watchdog 机制 + AC1-AC7 断言）
- plugin/test/no-manager-tick-doc-check.test.mjs（AC4 C3 机械检查 + 注入/恢复控制）

## Contract

measure   manager_start = `quay manager start 2>&1 | grep -c 'quay-manager\|started'` stdout 数字段
band      manager_start >= 1（独立 session 可起）
invoke    `grep -n 'manager' orchestration/orchestrator-loop-tick.md`（期望 0 命中，AC4）
control   双创建者并发调 quay-topology.sh ⇒ 恰一次创建（AC6）；adopt 后动作次数=0（AC7）
resume    命令/锚/检查分步提交：start 可起 → adopt 三态 → 锚落位 → 机械检查接线，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T16:5xZ
changed: 外层按 SPEC 裁定立案——三裁定（①谁发现谁创建+锁 / manager-phase-goal 切分 / 建造=outer+inner
运行=人或OS锚）写入本任务；os-anchor 缺口外层独立核实（os-anchor-projects.conf 无 manager、watchdog unit
仅 quay-os-anchor）确认成立；tick 文档 manager 提及当前 0（manager-topology 修复已清，机械检查自然通过）。

## Execution evidence（scoped 验证实跑输出）

`bash scripts/test.sh --for-task gap-manager-productization-five-constraints --allow-thin`（worktree 内，
node_modules 与主 checkout 共享；`--allow-thin` 因 Touches 全为目录/文档 0/6 直解，Test-Files 声明的
两个测试文件被选中）：

```
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  scoped check: run_checker "task-contract-check" ... --strict-subset '.../tasks/gap-manager-productization-five-constraints.md'
task-contract-check: no violations.
  scoped check: run_checker "strategic-doc-staleness-check" ...
PASS: no NEW stale strategic doc beyond the KNOWN_STALE baseline
  scoped check: run_checker "no-manager-tick-doc-check" bash '.../plugin/scripts/no-manager-tick-doc-check.sh' '...'
no-manager-tick-doc-check: CLEAN — no create/drive/check manager steps in the outer tick docs (C3)
...
✔ AC1/C4 — manager start accepts NO project arguments (hard usage error, SPEC C4/C5)
✔ AC1/C4 — manager start --dry-run produces 'quay-manager' + 'started' output (Contract measure surface)
✔ AC2/C2 — manager start creates $QUAY_GLOBAL_DIR/manager/ home (outside the project) + observer + action log
✔ AC2/AC5 — manager start installs its OWN systemd unit, SEPARATE from the project os-anchor watchdog
✔ AC2 — manager start --status reports home/session/unit without mutating
✔ AC3/C1 — the manager implementation ships under plugin/scripts/ (the plugin distribution)
✔ AC1 — manager adopt REUSES inner-session-check.sh (no second copy of the three-state verdict)
✔ AC1/C5 — manager adopt requires exactly one <project-root>
✔ AC1 — manager adopt (missing project, hermetic) plans to call quay-topology.sh + register
✔ AC1 — manager adopt three-state branches (override seam): healthy→noop / empty-shell→drive-not-rebuild / degraded→fail-closed
✔ AC7 — after `manager adopt`, the manager's action log for that project has exactly ONE adopt-register event and ZERO other events
✔ AC5 — manager-watchdog.sh --decide: noop / relaunch / recreate / skip-unverifiable
✔ AC5 — manager-watchdog.sh is executable and shipped (the manager's own re-spawn anchor)
✔ AC6 — quay-topology.sh carries the single-flight lock (acquire/release, atomic wx-create)
✔ AC6 — concurrent quay-topology.sh creators create exactly ONE session + ONE inner window (single-flight lock, 原子创建实测)
✔ AC4 — baseline GREEN on the real outer tick docs (boundary prose is NOT a create/drive/check step)
✔ AC4 — inject a `quay manager start` step ⇒ checker RED (create/drive/check manager step caught)
✔ AC4 — restore (remove the injected step) ⇒ GREEN (the +1 → 0 control direction)
✔ AC4 — the manager's OWN operating doc (plugin/loop/manager-loop-tick.md) is NOT the checker's object
✔ AC4 — the checker is wired into run_static_checks (scripts/test.sh) with the change-tier annotations
ℹ tests 20  ℹ pass 20  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0   EXIT=0
```

**Contract measure**（hermetic 接缝，不碰活会话）：`quay manager start --dry-run`（MANAGER_HOME/
MANAGER_SKIP_TMUX=1/MANAGER_SKIP_SYSTEMCTL=1）输出含 `quay-manager` + `started` ⇒
`grep -c 'quay-manager\|started' >= 1` 满足 band。真 tmux 会话/unit 安装留给外层在活环境执行。

**AC4 invoke 诚实注**：`grep -n 'manager' orchestration/orchestrator-loop-tick.md` 现为 **5 命中**，
全部是**边界散文**（inner-session 权限边界表 58/59/60、quay-topology 注释 76 "manager 跨项目，不属于
项目拓扑，不建"、任务引用 509），**无一条是创建/驱动/检查 manager 步骤**。真实机械闸是
`no-manager-tick-doc-check.sh`（0 violations，已接 static checks）——裸词频 grep 会把 C3 纪律陈述本身
误报为违规，故以 checker 为 AC4 判据。

**非本任务引入的 pre-existing 状态**（外层 full-suite 已知）：`manager-layer-shipping.test.mjs` AC6 在
master 即红——`plugin/skills/manager/SKILL.md` 的 SPEC 索引 14/16，`SPEC-branching-model-integration-
branch-2026-08-05.md` 与 `SPEC-integration-architecture-2026-08-05.md` 由提交 32dd44b1 加入而未更新
SKILL 索引（`plugin/skills/manager/SKILL.md` 不在本任务 Touches，未改）。`session-topology.test.mjs` 的
dry-run `!/manager/` 断言在名为 `gap-manager-productization` 的 worktree 内因 repo 路径含 "manager"
误报（主 checkout `/home/yale/work/quay` 无此问题）。
