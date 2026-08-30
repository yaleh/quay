---
name: quay-manager
description: "The manager layer — the THIRD layer above outer/inner: cross-project planning, prioritization, and trend-watching. One per network/host, started by the human (or an OS anchor), NEVER by a project's cold start. Crystallizes the daily-review cadence (per orchestration/REVIEW-cadence.md), the three functions (planning / prioritization / trend), and the two verified rules (§1.5 ask-vs-act, §1.6 event triage, extracted from orchestration/manager-loop-tick.md). Installable — ships under plugin/, not quay-local. Use when a network runs more than one quay loop and someone must coordinate between them (the human's job otherwise)."
allowed-tools: Bash, Read, Monitor
---

# quay-manager

**The third layer — cross-project coordination.** The two-layer loop (outer → inner) executes one
project's board fast but never plans, prioritizes, or trend-watches. Those three functions are the
manager layer's job, and they only exist if the manager layer is *installed* — a cold start on a
new machine ships two layers by default, and the manager must be started separately (delivery ≠
startup, AC8).

This skill is the **installable crystallization** of the manager layer. It ships under `plugin/` so
any quay install can bring up a manager; it is not a quay-local artifact in `orchestration/`.

## The three layers

| Layer | Where it ships | Runs | Owns |
|---|---|---|---|
| outer | `orchestration/orchestrator-loop-tick.md` | per-project | the loop driver (cron, dispatch, verification round) |
| inner | `docs/analysis/fast-mode-loop-tick.md` | per-project | the task execution / fast-mode tick |
| **manager** | **this skill** (`plugin/skills/manager/SKILL.md`) | **per network/host, one** | **cross-project planning, prioritization, trend-watching** |

**manager is above outer, below the human.** It is started by the human (or an OS anchor), never by
a project's outer, and never by a project's cold start. A project cold-start skill
(`plugin/skills/cold-start/SKILL.md`) must NOT start it — `quay-topology.sh` builds `outer`+`inner`
only, and the cold-start's `TOPOLOGY-IN-PLACE` key excludes manager.

## Cadence — the daily review (mechanism, not memory)

The manager runs a **daily review**, calendar-tied once per day, per `orchestration/REVIEW-cadence.md`
(a done mechanism — reference it, do not re-invent). The review is the heartbeat of all three
functions below: it is when planning re-checks the roadmap, prioritization re-ranks, and trend-watching
summarizes.

Three checklists, run each review (all mechanical):

1. **Strategic-doc staleness** — `node --experimental-strip-types plugin/scripts/strategic-doc-staleness-check.ts --root .`
   reports stale strategic docs (refs to ADR-022-retired mechanisms without a retired/superseded
   annotation) and pool-candidates that reference retired mechanisms (`--pool-candidate <id>`). New
   staleness is a planning signal.
2. **Near-window `gap-*` traceability** — for each new `gap-*` task since the last review, classify
   traceable-to-written-strategy vs pure-reactive. Repeated pure-reactive is a strategic signal.
3. **Direction drift** — extend the outer/manager phase-goal review record with the direction
   dimension (result of 1 + 2).

## The three functions

### 1. Planning (规划) — "where are we going"

The daily review answers "did we drift", not "where next". The planning function keeps a **written
roadmap / strategic-question reference** — the counterpart a review can check against. The live
fast-mode strategic counterpart in the quay experiment is the
**cross-project portability strategic question** (`gap-fast-mode-cross-project-portability-strategic-question`):
*is the two-layer loop truly portable cross-project, or overfit to quay?* Adopting networks maintain
their own equivalent written reference; the manager's planning rule is:

- the roadmap/strategic reference exists and is **checked for staleness every cadence** (checklist 1);
- a roadmap that references retired mechanisms is stale → rewrite or mark superseded, never silently
  carried;
- a project that answers a strategic question **with no written reference** is pure-ad-hoc — record it
  as such (checklist 2).

### 2. Prioritization (排序) — "what is worth doing, in what order"

Value-ranking across projects is the manager's view alone (a host with several projects — this
perspective exists only at the manager layer). Mechanisms:

- **Priority order** is a human ruling per network (in quay: `quay > archguard/meta-cc`, 2026-08-03).
- **Arbitration is done with `.halt`, not by re-ordering a token** — write
  `echo "<reason> | 解除条件: <cond> | manager <ISO>" > <repo>/.halt` to pause a project, `rm <repo>/.halt`
  to resume.
- **Cross-project heavy ops are NOT serialized** — `heavy-op-token.sh` (the "one heavy test at a
  time" token) was RETIRED 2026-08-06 by human ruling (gap-session-liveness-remove-shared-events-and-
  lock): resource pressure is handled by `plugin/scripts/resource-gate.sh` (per-run load gate), not by
  a cross-project mutex.
- **Escalations are aggregated, not solved** — read each project's `orchestration/escalations.md`,
  dedupe + sort + judge which need the human; solving them is the outer's job. The manager never
  resolves a project's escalation itself.

### 3. Trend watching (看趋势) — "what is happening across the network"

Cross-project liveness and trend observation. 2026-08-06 (gap-session-liveness-remove-shared-events-
and-lock): observation is a tree (manager→N outers, outer_i→inner_i) — each observer owns its own
stdout event stream (who mounts owns it); there is NO shared events.jsonl anymore. The manager mounts
its OWN observers for the outers (LOOP_MIN=0 to see everything if it wants) and reads ITS OWN Monitor
streams; a project outer mounts its own observer for its inner. The manager
**relays a defect discovered in one
project to the others** (a cross-project finding a single project's outer cannot see).

## Two verified rules (extracted from orchestration/manager-loop-tick.md)

### §1.5 ask-vs-act — when to do it yourself, when to ask the human

**Criterion: is this thing *implied* by an AC the manager has already declared?**

- **Implied ⇒ do it directly.** If you don't, some AC's criterion can never be satisfied — so it is
  not an option.
- **Changing the AC itself ⇒ ask.** Scope, priority, resource rulings, and goal direction are the
  human's.

Self-check: *"If I don't do this, which of my ACs' criteria becomes permanently unsatisfiable?"*
If you can answer → don't ask, do it. If you can't (or the answer is "makes it harder but still
possible") → then it is worth asking.

### §1.6 event triage — monitor events are mostly noise

**The criterion is not the event, it is "is there something that should have moved but didn't."**
RESUMED and IDLE describe state *transitions* — both directions are normal. Only GONE / OVERDUE /
NO-COMMIT describe "should-have-moved-but-didn't".

| Event | Disposition |
|---|---|
| `SESSION-RESUMED` | **Do not investigate.** The session resuming activity is it working normally. |
| `SESSION-IDLE` | **Do not investigate**, unless the same session's `IDLE` repeats, the heartbeat stops updating, AND `git log --since` is also empty. |
| `SESSION-GONE` / `HEARTBEAT-OVERDUE` / `NO-COMMIT` | **Investigate.** These three are "should have moved but didn't." |

This is executed mechanically, not by judgment — judgment on this failed four consecutive times.

## Boundaries — what the manager does NOT do

These four are always delegated to the owning project's outer (see `orchestration/manager-loop-tick.md` §0):

1. **Does not write task bodies / AC / DoD** — that is the project outer's job.
2. **Does not run verification / construct negative controls / audit claims line-by-line** — same.
3. **Does not debug any project's own code / tests / CI** — the human drew this line explicitly.
4. **Does not directly edit any project's code.**

**Sole exception:** cross-project shared mechanisms that have no other owner (the shared `.halt`
convention, tmux layout conventions — `heavy-op-token.sh` was retired 2026-08-06).

**Mechanical boundary signal:** if the manager needs a new observation/judgment capability, the
deliverable is a **request to the outer layer**, not a self-written script. A `.sh`/`.ts`
implementation appearing in the manager's hands is the overreach signal.

## How the manager itself starts (launch config, not tribal knowledge)

The manager's launch command is an INTERNAL implementation detail of the launch mechanism — a
human/agent never types it directly. The per-role launch command lives in the checked-in
`.claude/launch.settings.json` (`_launchSpec.roles.*`, settings-schema keys + `_launchSpec`
extension); the manager role runs the Anthropic default model — the deepseek 917k
context/compaction vars are outer/inner-only by `_launchSpec` design. To start the manager,
invoke the skill that owns launching (the `quay-session-topology` skill's Method, or the session
bootstrap) — never hand-type a shell one-liner from memory. The launch script is the skill's
internal pipe, not a user-facing deliverable.

## Delivery ≠ startup (AC8)

The plugin **ships** the manager layer (any network with more than one project needs it — not
shipping it means every network re-invents it). But a **project cold start does NOT start it**: the
manager is cross-project, one per network, and is the human's/OS-anchor's to start. A cold-start
skill must never start the manager just because the plugin contains it — the two-window project
topology is `outer`+`inner` only.

## Methodology sources (SPEC index — referenced, not batch-crystallized)

The methodology SPECs below are the written sources; the manager layer crystallizes the *role and
rules* but does not re-implement each SPEC. Index (under `orchestration/` in the quay repo):

- `orchestration/SPEC-manager-productization-2026-08-05.md` — the manager productization spec (C1–C5 constraints, build-vs-run ownership, two separate starts)
- `orchestration/SPEC-branching-model-integration-branch-2026-08-05.md` — the develop/integration two-line branching model (verified baseline + pending-verification merge target)
- `orchestration/SPEC-execution-loop-productization-2026-08-28.md` — the execution-loop productization umbrella (task-execution→fan-in business moves to quay CLI/MCP; ADR-034 is its locked child)
- `orchestration/SPEC-integration-architecture-2026-08-05.md` — the integration architecture (merge target / batch merge)
- `orchestration/SPEC-outer-liveness-productization.md` — outer liveness, the manager's own anchor gap
- `orchestration/SPEC-cold-start-one-liner.md` — cold-start one-liner (delivery surface)
- `orchestration/SPEC-complete-delivery-surface-2026-08-05.md` — the complete delivery surface (six classes; this skill is the loop-documentation class-2 owner)
- `orchestration/SPEC-cut-the-waiting.md` — waiting / dispatch-form rationale
- `orchestration/SPEC-dispatch-ordering-semantic-2026-08-13.md` — dispatch-ordering semantics (structure-vs-semantics cut / inner chooses / preference-passing three-part)
- `orchestration/SPEC-tick-read-path-slimming-2026-08-14.md` — the tick read path (1-hop entry, pinned `tail -30`, measured E2a/E2b token floors)
- `orchestration/SPEC-tick-quality-2026-08-14.md` — the cross-layer tick spec (R1–R9, each with a criterion and the failure that bought it; D1–D8 quality dimensions with the three-layer baseline)
- `orchestration/SPEC-in-flight-semantics-2026-08-14.md` — 「在飞」的完整语义 (A unlanded-tasks vs B running-subagents; the 10 prior fixes of the same quantity; §6 the system-wide proxy-quantity survey and the proxy registry proposal)
- `orchestration/SPEC-tick-mechanical-checks-mcp-2026-08-15.md` — tick 的机械检查统一为一个 MCP 工具面 (proposed·未排期, future phase; §1 the seven measured per-round coverage points and why an MCP server is the first thing both mechanical AND outside every layer's context; §3 integration into the existing quay MCP server, reusing observation.ts's degradation contract)
- `orchestration/SPEC-suite-lifecycle-and-failure-semantics-2026-08-26.md` — suite 生命周期与失败语义（单飞锁纯资源限制器 / suite-driver kind / 失败语义 subagent；§2/§3/§4，⛔ lane/S 不动）
- `orchestration/SPEC-worker-driven-inner-2026-08-16.md` — inner 改造为「机械驱动进程 + per-task `claude -p` worker 会话」（人 2026-08-16 裁定六个设计点；并发由驱动数子进程控制而非模型自数 subagent；主检出纯为驱动镜像、checkout 前 stash 不 discard；三阶段判据含【检查机制净减少】的贯穿判据）
- `orchestration/SPEC-instruments-behind-one-entry.md` — instrument discovery behind one entry
- `orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md` — isolation + resource governance
- `orchestration/SPEC-methodology-as-a-deliverable.md` — methodology as a deliverable
- `orchestration/SPEC-no-text-substitution-at-install.md` — install is configuration-driven, not text-substitution
- `orchestration/SPEC-unified-driver-architecture-2026-08-23.md` — 统一 `*-driver` 架构：机械化执行面与长会话规划面的分野。**两级分层**（Layer 0 runtime / 1a task-processing / 1b routine，人 2026-08-23 裁定，manager-kind 属 1b）· 核心不变式「⛔ 不信执行者自述」单一实现 · Filter 谓词列表 · Claude Code profile 抽层 · 配置与运行时控制态分界 · 事件触发保留兜底轮询（proposal·判据落为 AC151–155，排期在 AC142 系列收口后）
- `orchestration/SPEC-web-session-observability-and-control-2026-08-24.md` — web server 通用 Claude Code 会话观测 / 消息投递 / 生命周期管理：会话发现三分流（交互式·`-p`·已结束）· 统一锚点 session-id + transcript · `send-to-session.ts` socket 通道 · profile 化启动配置（proposal·人 2026-08-24 裁定三条开放问题，泛化排期在 `gap-worker-task-transcript-access-webui` 落地之后）
- `orchestration/SPEC-codex-session-communication-host-adapter-2026-08-24.md` — Codex App Server 会话通信 Host Adapter：thread/turn 映射、宿主无关 `list/status/send/events` 契约、ack 状态、幂等性与 Claude/Codex 权限边界（proposal·不扩大 Stage 1 自治生命周期权限）
- `orchestration/SPEC-one-observer-two-surfaces.md` — one observer, two surfaces
- `orchestration/SPEC-methodology-layer-architecture-2026-08-25.md` — 方法学层架构：契约面采纳而非重建抽象（checker 契约三层 / state-IO / path-root 三角色，六批次 B0-B5 棘轮演进）
- `orchestration/SPEC-checker-mechanical-spine-contract-2026-08-28.md` — checker 机械脊柱契约（exit 0/1/2/3 语义 + --json 兑现；B1 层 1，检查器 + 豁免棘轮守着，不符者只减不增）
- `orchestration/SPEC-quay-self-hosts-its-own-cold-start.md` — self-hosting the cold start
- `orchestration/SPEC-state-crystallization-2026-08-05.md` — state crystallization
- `orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md` — the three-layer unified architecture (manager/outer/inner minimal unified architecture; AC28–AC34, P0 wiring = SPEC-carrying first-lines + ledger A + parallel-comparison rounds)
- `orchestration/SPEC-goal-store-2026-08-09.md` — the goal-store spec (phase goals/ACs are a THIRD sibling kind: criterion shell-runnable + status(achieved) + phase derivable + origin required; web `/goal`+`/doc`; gate-staleness self-check)
- `orchestration/SPEC-suite-speed.md` — suite speed
- `orchestration/SPEC-typed-axes-and-standing-dynamics.md` — typed axes + standing dynamics
- `orchestration/SPEC-per-task-suite-verification-2026-08-13.md` — per-task suite verification (人 2026-08-13 裁定：取消 integration，每任务从 develop 开 worktree 跑全量 suite 迭代至绿再 merge；suite 不得有 commit 知识；锁容量 2 + cgroup 读宿主；verification-round 降为任务粒度。**取代** `SPEC-branching-model-integration-branch-2026-08-05.md` 的解法而非其诊断；阶段 AC42-AC49）
- `orchestration/SPEC-task-status-flow-target-vs-actual-2026-08-13.md` — task status 流转目标模式 × 当前实际 × 差异清单（人 2026-08-13 指令；不新增工作项——差异映射到已有 AC / 任务 / 观察项）
- `orchestration/SPEC-fan-in-ff-merge-lock-2026-08-14.md` — fan-in 改为「无锁段自测 + 锁内 ff-merge」：subagent 在 merge 前把 develop 最新变更 merge 回自己 worktree 并跑 suite，最后 ff merge 回 develop（单独 merge 锁，只包 ff，持锁期间唯一动作是 ff merge，成功/失败即解锁）；AC62–AC64
- `orchestration/SPEC-fan-in-workflow-lock-and-S1-2026-08-26.md` — fan-in workflow 锁 + S=1：把 merge 锁从毫秒级 ff 扩大到整个 fan-in（merge→suite→ff）使 develop 不前进、ff 结构上不输，S 改 1（fan-in 锁串行化 suite）；修订 AC4 + 两锁固定顺序 + driver 看门狗；与语义 subagent 的 ff-race-loss 二选一（proposal·待 outer 立案、待人裁定排期）
- `orchestration/SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md` — fan-in 机械编排：取消 fan-in workflow 子代理、机械部分（锁/merge/判定/typecheck/scoped门/suite/ff）交 driver、语义部分（冲突/红 suite/typecheck 红/anti-drift 越界）单独 Claude 会话；suite 不再 detach、fan-in 锁机械包裹 suite 锁；取代 S=1 workflow 锁的解法（保留其诊断），锁时长从模型 30min 塌缩到机械 ~10min（proposal·待 outer 立案、待人裁定排期）

Cross-references:
- `orchestration/REVIEW-cadence.md` — the daily-review cadence mechanism (this skill's cadence hook)
- `orchestration/manager-loop-tick.md` — the operational tick doc §1.5/§1.6 are extracted here
- `orchestration/SYNTHESIS-four-gaps-2026-08-05.md` — the four-gap synthesis that motivated shipping the layer

## Non-goals

- **Not a project cold-start step.** A project cold start must complete without a manager; the manager
  is started separately, per network.
- **Not a replacement for the human.** Direction, priority, and resource rulings remain the human's;
  the manager aggregates, ranks, and flags.
- **Not a per-project debugger.** It observes and coordinates across projects; it does not fix any
  single project's code or CI.
description: "The THIRD (manager) layer of the fast-mode loop — a cross-project coordinator that ships with the quay plugin but is NOT started by a project's cold start (one network = one manager). Crystallizes the manager cadence (daily review, calendar-anchored), the three functions (planning / prioritization / trend), and the two verified rules (§1.5 ask-vs-act, §1.6 event triage) extracted from orchestration/manager-loop-tick.md — Use when multiple projects/networks need a coordinating layer: who plans overall, who prioritizes across projects, who trend-watches"
allowed-tools: Bash, Read, Monitor
---

# quay-manager —— 第三层：跨项目协调层

**这是 fast-mode 循环的第三层。** 实跑三层、交付两层的历史缺口（`gap-productize-the-manager-layer`）
的产物：manager 层从此是 **plugin 交付物的一部分**（本 SKILL 在 `plugin/skills/manager/`，随 plugin
安装），不再是 quay 本地资产。

**角色定位**：多个项目（quay / archguard / meta-cc …）的管理者。**不是任何一个项目的外层。**
**跨项目**（SPEC-manager-productization C2）：它的家、状态、身份都不属于任何单个项目。

---

## 1. 节奏：每日复盘（cadence = daily review）

**每天一次、按日历挂钩**——不按任务量「攒到 N 个 tick 再复盘」。机制已 done：
`orchestration/REVIEW-cadence.md`（频率/角色/三项清单）。触发形态：

- 每个自然日由管理者在当日 tick 里发起一次；
- 或当出现下列任一时立即跑（不等日历）：任何人问「外层/整体有没有在做分析、规划、设计」；
  一条新 `FINDING-*` / `RESEARCH-*` 落盘；一次批量 gap 任务关闭完成。

**角色**：管理者**发起并汇总**，外层**参与作答**，人**接收结果并保留方向裁定权**。

**三项清单**（每次复盘逐项跑）：

| # | 清单 | 机制 |
|---|---|---|
| 3a | 机械检查战略文档是否过期 + 池晋级候选是否引用已退休机制 | `plugin/scripts/strategic-doc-staleness-check.ts` |
| 3b | 近窗口 `gap-*` 任务可追溯性（可追溯 vs 纯反应式） | REVIEW-cadence §3b |
| 3c | 复核记录扩方向：方向本身有没有偏 | REVIEW-cadence §3c（outer/manager-phase-goal 各加两行） |

---

## 2. 三职能（planning / prioritization / trend —— 各自机制挂接点）

| 职能 | 机制挂接点 |
|---|---|
| **规划（planning）** | 挂**活的** fast-mode 战略参照：`docs/proposals/fast-mode-cross-project-portability.md`
  （AC5 锚点，`gap-fast-mode-cross-project-portability-strategic-question` 钉住的战略问题容器）。
  复盘/规划时**对照这个锚点**回答「往哪走」，**不临场推**。旧路线图
  `docs/proposals/quay-harness-crystallization-roadmap.md` 已 **SUPERSEDED by ADR-022**，只作历史。 |
| **排序（prioritization）** | 跨项目资源仲裁：`.halt` 是仲裁手段（写 `<repo>/.halt` 暂停、`rm` 恢复）；
  优先级 **quay > archguard/meta-cc**（人 2026-08-03 裁定）；跨项目重活由
  `plugin/scripts/resource-gate.sh` 按负载门控（`heavy-op-token.sh` 已于 2026-08-06 退休）。 |
| **看趋势（trend）** | 网络级存活观测（session-liveness 事件 / `monitor-mount-check.sh`，每观察者自己的
  stdout 事件流——2026-08-06 起共享 events.jsonl 已移除）；每次 tick 记当时 `cpu some avg10`（AC4 判据 =
  连续两次 tick 超 80）；REVIEW-cadence 3b 的「纯反应式」信号（同族纯反应式反复出现 = 战略层信号）。 |

---

## 3. 两条已验证规则（从 `orchestration/manager-loop-tick.md` 提取）

### 3.1 ask-vs-act（§1.5）——什么时候自己做，什么时候问人

**判据：这件事是不是我自己已声明的 AC 所【蕴含】的。**

- **蕴含 ⇒ 直接做。** 若不做，某条 AC 的判据将**永远不可能被满足**，那它就不是一个选项。
- **改变 AC 本身 ⇒ 问人。** 范围、优先级、资源裁定、目标方向——这些是人的。

**自查问法**：「若我不做这件事，我哪条 AC 的判据会变成永远不可能满足？」
**答得出来 ⇒ 别问，做。** 答不出来、或答案是「会让某条 AC 更难但仍可能」⇒ 才值得问。

### 3.2 监视器事件的分级处置（§1.6）——事件 triage

**判据不是事件本身，是「有没有出现本该动而没动的东西」。**

| 事件 | 处置 |
|---|---|
| `SESSION-RESUMED` | **不查。** 会话恢复活动是它在正常工作，不是异常 |
| `SESSION-IDLE` | **不查**，除非同一会话 `IDLE` 连续出现、心跳停更、**且 `git log --since` 也为空** |
| `SESSION-GONE` / `HEARTBEAT-OVERDUE` / `NO-COMMIT` | **查。** 这三类才是「本该动而没动」 |

**这条要机械执行，不靠临场判断**——临场判断已连续失败 4 次，且每次单看都是合理的
（「侵蚀按机会计数、不按小时计数」：4 条通知 = 4 次机会 = 4 次全败）。

---

## 4. 边界：管理者不做什么（§0）

1. **不写任务体、AC、DoD** —— 那是项目外层的活
2. **不跑验证、不构造负控制、不逐条核实声称** —— 同上
3. **不替任何项目调试它自己的代码/测试/CI** —— 人 2026-08-03 明确划的线
4. **不直接改任何项目的代码**

**唯一例外**：跨项目的共享机件（各项目 `.halt` 约定、tmux 布局约定——`heavy-op-token.sh` 已于 2026-08-06 退休）——
那些没有别的主人。

**越界的机械信号**（SPEC-manager-productization §5）：manager 若需要一个新的观测/判定能力，
它的产出应当是一条**转给外层的需求**，而不是一个自己写的脚本——manager 手里出现 `.sh`/`.ts`
实现即为越界信号（手工观测判据连续四次不如已有机制严谨：pane 哈希、heartbeat、`pgrep -f` 自匹配）。

---

## 5. 启动配置（可安装）——部落知识 → 交付物

启动参数**只存在于检查进仓库的** `.claude/launch.settings.json`（settings-schema 键 + `_launchSpec`
扩展），由本 skill 的内部启动器物化为真实命令——**永不手打一行 shell**；启动脚本是 skill 背后的
内部实现，不是用户/agent 直接调用面（启动走 `quay-session-topology` skill 的 Method）。

- **outer / inner**：`claude-deepseek --model deepseek-v4-flash` + `CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000`
  （launcher 统一追加 `--prompt-suggestions false`——**REQUIRED**，ghost-suggestion 故障 6 从源头消除，
  `gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false`；`_launchSpec.promptSuggestions:false`）
- **manager**：`claude`（Anthropic 默认模型，不带 917k 覆盖——917k 只给 deepseek 角色，避免真实窗口
  之上压缩过晚导致 API 报错，session-launch-recipes §5）

**冷启动向量（bare-metal，gap-manager-layer-no-verified-install-vector）**：第三方裸机（无 quay 开发树）
装 manager 的**已验证路径**是 `npm i -g <quay.tgz>` 后 `quay manager start`——CLI 从安装包定位
`plugin/scripts/manager-start.sh`，它建独立 tmux 会话（`quay-manager`）+ 自己的家
（`$QUAY_GLOBAL_DIR/manager/`）+ 武装 loop 锚点。启动 settings 在裸机取**出厂拷贝**
`plugin/.claude/launch.settings.json`（npm 产物不带包根 `.claude/`，启动器回退到 plugin 出厂份；
dev-tree 仍优先包根份——manager 角色 `claude`/`quay-manager` 两份一致）。武装锚点的 prompt 是指针：dev-tree/`--loop --manager` 消费项目指
`orchestration/manager-loop-tick.md`；裸机包（无 orchestration/）由 `manager-arm-loop.sh`
按存在性解析指针目标（AC4 不铺虚空武装器——指针解析在脚本内，SKILL 不引 bundle 源码路径）。

---

## 6. 交付 vs 启动独立（AC8）——一个 network 一个 manager

**交付**：plugin **包含** manager 层（本 SKILL 随 plugin 交付，`npm pack` 产物里也有）——更多开发者
同样需要跨项目协调；**不交付 = 人人重发明**。

**启动**：项目的 cold-start（`plugin/skills/cold-start/SKILL.md`）**不得启动** manager——manager 不属
项目冷启动范围，**一个 network 一个 manager 就够**。项目拓扑工厂 `plugin/scripts/quay-topology.sh`
只建 `outer inner` 两窗口（`ROLES="outer inner"`）；cold-start 的 `TOPOLOGY-IN-PLACE` 键明示
「manager is cross-project and NOT part of this topology」。机械复制 quay 三窗口到 meta-cc/archguard
已犯过（管理者自陈 + 自查改回 bash/outer/inner）——**交付物里有 manager 不意味着冷启动要启动它。**

---

## 6.5 冷启动可证伪判据（observable consequences，对齐 outer 的 7 条）

**外层的冷启动有 7 条可证伪判据（cold-start/SKILL.md observable consequences），manager 曾经一条
都没有——「说启动了」没有任何可以被证伪的完成定义。** 本条补上：**manager 冷启动完成后，以下
七条必须全部为真**；任何一条为假 = 冷启动未完成。报告每条为 `<KEY>: true|false` + 一行证据。
（判据的正本随包，`quay manager start` 写的 `idle-watch-mount.txt` 与 `manager-arm-loop.sh --verify`
是本清单的机械执行面。）

| # | Key | 可证伪判据（checkable definition） | 证据 |
|---|---|---|---|
| 1 | `HOME-IN-PLACE` | manager 家 `$QUAY_GLOBAL_DIR/manager/` 三件套齐：`identity`（role=manager）+ `loop-registry.txt`（arm 后恰一条 `[manager-tick]`）+ `manager-tick-log.md`（tick 落行） | `ls` 三个文件 + `grep -c '\[manager-tick\]' loop-registry.txt` |
| 2 | `IDLE-WATCH-MOUNTED` | 常驻观测者已挂：`bash <quay>/plugin/scripts/monitor-mount-check.sh --json` 报 `mounted=true` 且 `targetOk=true`（真机制 = `session-liveness-mount.sh` + Monitor 事件，非 `idle-watch.sh`——那脚本不存在） | `--json` 输出两条 |
| 3 | `IDLE-WATCH-DELIVERING` | 观测者能产事件：`bash <quay>/plugin/scripts/session-liveness.sh --once` 至少一条 `SESSION-STATUS`（确定性接缝；稳态会话不发射转换事件是正常的，别等 ~90s） | `--once` 的 `SESSION-STATUS` 行逐字 |
| 4 | `CRON-CREATED` | `CronList` 恰一 `[manager-tick]`（agent 在会话内确认；bash 看不到） | `CronList` 输出 |
| 5 | `REGISTRY-MATCHES` | 注册表 ↔ 真 cron 可核实：`bash <quay>/plugin/scripts/manager-arm-loop.sh --verify --home <home>` 报 `registry-verified`（恰一哨兵 + 新鲜 CronCreate 收据；`registry-only` = 注册表说武装了但没核实 = 缺陷） | `--verify` 输出 |
| 6 | `FIRST-TICK-LANDED` | 首轮 tick 落行：`bash <quay>/plugin/scripts/manager-tick-log-check.sh --log <home>/manager-tick-log.md` PASS | check 输出 |
| 7 | `NOT-STARTED-BY-PROJECT` | manager 是跨项目第三层，**不属于任何项目的 `outer`+`inner` 拓扑**——`topology-check.sh --session <proj>` 只报两窗口，`quay manager start` 拒收项目参数（start/adopt 分离，C5） | topology `--json` + start 拒绝输出 |

判据能机械回答的四问：**idle-watch 发事件?（#2/#3）cron 存在?（#4/#5）首轮 tick 留痕?（#6）
家目录三件套齐?（#1）**——没有一条是「agent 说完成了」。

## 7. 方法论来源（AC6）——SPEC 索引唯一正本 = 上文 "Methodology sources"，不批量结晶

SPEC-*.md 的索引**唯一正本**见上文 "Methodology sources" bullet list，逐个按需结晶，不批量。
本节原有一张中文索引表，是同一份索引的**陈旧副本**（表头写死「17 份」，实盘数量随文件增删已漂移，
而 AC6 只扫 `src.includes(spec)`、分不清「索引了一次」与「索引在陈旧副本里」⇒ 无任何检查报出），
已于 2026-08-13 删除；不写数量字面量（硬规则 4 推论二）。各行的落点映射见删除提交。

**引用约定**：本 SKILL 引用的 `orchestration/` 文件（REVIEW-cadence.md、manager-loop-tick.md、SPEC-*）
是 quay 的参考文档，**逐个按需结晶，不批量**，不是 loop 机制交付物——已在 `plugin/skills/init/SKILL.md`
声明为 `reference-doc`（verify-referenced-landed 不变量：被引用的文件要么被铺设、要么被声明）。

---

## 8. 每个 tick 必做

1. 看一眼自己的目标/AC（`orchestration/manager-phase-goal.md` 或对应阶段文件）——有没有已达成而没勾、
   已失效而没改；
2. 各项目外层状态一次读（`.halt`、`cpu some avg10`、load）；
3. 各外层最新 tick 日志（`grep -m1 '^| 2026' <项目>/orchestration/tick-log.md`）——只看 mtime 只能知道
   「跑了」，知不到「跑出了什么」；
4. 聚合升级项（去重、排序、判断哪些需要人；**不解决它们**）；
5. 资源仲裁（`.halt`）；
6. 必写一行到 tick 日志（时刻 / 动作类 / 三项目一句话 / 仲裁了什么 / 升级项变化）。

**停下叫人的条件**：连续 3 个 tick 无任何项目推进任务状态（附三次各自看到了什么）；任一项目外层进程
消失（立即报，不等三次）；`.halt` 解除条件已满足但没人解除（提醒一次，不自行解除高优先级之外）。

---

## 9. 工具复用强制挂载点（capability-catalog 前置检查，AC2）

**这一节是 §4「越界的机械信号」的可执行落地**（`orchestration/SPEC-manager-productization-2026-08-05.md`
§5）——该节作为散文规则被证明无效：2026-08-06 晚，同一个读过该节的会话仍手写 8 个已有能力的替代品
（证据见 `tasks/gap-manager-skill-missing-mandatory-tool-reuse-checklist.md` AC4）。从本行起，这不是提醒，是步骤。

**硬规则（Step 0 前置检查，写脚本前必做）**：任何 `.sh`/`.ts` 写入（哪怕是一次性诊断脚本）都必须先执行
`bash plugin/scripts/capability-catalog.sh | grep -i <关键词>`，确认没有既有能力。找不到对应既有工具才允许写；
找到则必须复用（调用产品化工具，而不是再造一个劣质版本）。这条是**前置检查动作**，不是自觉提醒。

**8 项已知复用对照（2026-08-06 实测；速查，非完备清单）**：权威来源是上面命令查出的能力目录本身（以文件系统
派生、随包更新，本 SKILL 不维护完备性）——下表是本次已确认的「手工做过 → 已有工具」映射，下一位 manager
（或换了上下文的同一位）直接查这里：

| 想手工做的事（越界信号） | 已有工具（用这个） |
|---|---|
| 肉眼读 `capture-pane` 判断忙/闲 | `pane-state-classify.ts` |
| 拼进程 CPU + git log 判断循环死活 | `dead-loop-check.sh` |
| 每轮 tick 手工数 AC10 | `prefriction-count.sh` |
| 每轮 tick 手工问生成器问句 | `axis-generator.ts --criteria` |
| 手写 tmux 泄漏扫描逻辑 | `tmux-leak-scan.sh` |
| 手写 `git rev-list --left-right` 判断落后/领先 | `sync-lag-check.sh` |
| 裸 `tmux send-keys` 三步 | `send-keys-reliable.sh` |
| 用 `send-keys-reliable.sh` 而非窄接口 | `supervisor-deliver.sh` |
| 肉眼判断截图像不像设计稿 / 有没有硬编码色值 | `orchestration/manager-visual-check.py`（见 §10——写它之前已跑过本表要求的 `capability-catalog.sh` 检查，命中 0） |

---

## 10. 视觉核查工具 `orchestration/manager-visual-check.py`（§9 边界的结构性例外，人 2026-08-17 指示建）

**为什么这不是 §9「manager 手里出现 `.sh`/`.ts` 即越界」的又一次违规**：本工具必须调用操作者
**个人的**阿里云 Token Plan 订阅（`~/.local/etc/aliyun-api-key`，只存在于本机，绑定个人付费额度）。
产品代码（`packages/quay/src/` 或接进 `scripts/test.sh` 的 `plugin/scripts/`）必须对任何跑 quay 的人
都能用，**不能依赖某一个人的私人付费 key**——这个能力在结构上不可能被 inner/outer 收进产品交付面。
**⇒ 与 §4「唯一例外：没有别的主人的机件」同一逻辑，只是这次"没有别的主人"的原因是个人凭证依赖，
不是跨项目共享。** 写入前已按 §9 Step-0 跑过 `capability-catalog.sh | grep -i visual|screenshot|...`，
命中 0——确认是真空白才写。

**⛔ 若这个能力有一天要变成产品级机械化视觉回归检查**（例如接进某条 AC 的判据、或 `scripts/test.sh`），
**必须走正常路径**：manager 把需求转给 outer，由 inner 实现、走测试与 anti-drift，
用一把不依赖个人订阅的 key（项目自己的服务账号）——**不是把这份个人工具原样搬过去当产品代码**。

**用法**：
```
python3 orchestration/manager-visual-check.py <截图> [参照图] [--question "..."] [--model qwen3.6-flash]
```
单图 = 视觉审计（配色/布局/是否有刺眼硬编码色值）；双图 = 参照 vs 候选的差异比对。
`stdout` 是模型给出的 JSON（自动剥掉 ` ```json ` 围栏，可直接 `json.load`）；`stderr` 是 token 用量
（成本可见，同硬规则「别用总 token 判贵贱」）。退出码：0=调用成功（无论视觉判断内容），1=传输/鉴权/
解析失败（fail loud，⛔ 不返回一个看起来合格的空值）。

**key 来源（2026-08-17 通用化，人指示——⛔ 不写死单一路径）**，按优先级先到先得：
```
1. --api-key <值>          （最高优先；⚠️ 会留在 shell 历史/进程列表，仅建议本地临时用）
2. $ALIYUN_API_KEY          （环境变量直传值）
3. --key-file <路径>        （显式指定文件——每行一个 key，或兼容旧 export ALIYUN_API_KEY=... 格式）
4. $ALIYUN_API_KEY_FILE     （环境变量指向一个文件）
5. ~/.local/etc/aliyun-api-key（默认兜底，本工具最初实现时的写死路径，保留向后兼容）
```
五条路径均已实测跑通（含默认兜底回归 + 断绝所有来源触发 `exit 1` 的 fail-loud 校验）。

**背后的服务**：阿里云百炼 Token Plan Personal（`https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，
OpenAI 兼容格式），当前用 `qwen3.6-flash`（实测含视觉理解，2026-08-17 核实；`qwen3.7-flash` 不存在，
`⛔` 别猜成存在——docs 页面列的是 `qwen3.6-flash`）。

**持续维护承诺**：manager 负责这个工具，不是写完就扔。若阿里云的 endpoint / 模型清单 / key 格式变化
（Token Plan 到期后重新订阅会换发新 key，见其官方文档），下次使用前先用 `curl .../v1/models` 核实一遍
——不要凭记忆里硬编码的模型名继续用。这正是当晚建它之前做的三次验证（错端点→找到正确端点→端到端
真调用）的同一套纪律，⛔ 别把"建过一次"当成"永远有效"。
