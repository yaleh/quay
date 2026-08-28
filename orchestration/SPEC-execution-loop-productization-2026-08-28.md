# SPEC：执行环产品化——任务执行→fan-in 业务过程集中到 quay CLI/MCP

**作者**：manager｜**日期**：2026-08-28｜**状态**：proposal，待人裁定排期
**来源**：人 2026-08-28 逐字「实际上，我们应当减少 .sh 和分散的 .ts 使用，而把主要业务过程集中到 quay cli/mcp 中」+「这比 ADR-034 大」→ 本 SPEC 为伞，ADR-034 是其锁子项。

---

## 0. 一句话

**把任务执行 → fan-in 的整套业务过程（worker 派发、机械 fan-in、套件、锁、ff）从 plugin/scripts 的分散 `.sh`/`.ts`/workflow 三套并行实现，产品化为 `quay` CLI verb + MCP 工具（packages/quay，TS），一个业务过程一套实现，执行链从 9 次 shell-out 收敛为一次 verb 调用。**

---

## 1. 人的裁定（本 SPEC 的来源）

> 2026-08-28 人逐字：「**实际上，我们应当减少 .sh 和分散的 .ts 使用，而把主要业务过程集中到 quay cli/mcp 中**。检查当前的 quay cli/mcp 实现，分析从任务执行到 fan-in 的过程是否足够紧凑。」
>
> 2026-08-28 人逐字：「这比 ADR-034 大。创建 SPEC 并提交/合并，再发 outer 立案。」

关联裁定：**ADR-034**（2026-08-28 accepted）「锁的生命周期 = 工作的进程生命周期——fan-in workflow 锁收进 driver，释放只靠进程退出」——本 SPEC 的锁子项，Phase 1 先决。

⊕ 一条贯穿性的既有裁定（SPEC-worker-driven-inner §1，人 2026-08-16 逐字，本 SPEC 的方向盘）：
> **「现有许多检查机制是为了在现有模式下给不可靠的 LLM 驱动的开发过程做保底。我希望这样的操作在新模式下可以减少，或者集中到驱动内部，而不是散落在多个工具相关的机制中。」**

本 SPEC 与它同源：检查/执行业务散落 = 保底机制散落；集中 = 净减少。

---

## 2. 现状（2026-08-28 实测，不是理论）

**任务执行 → fan-in 调用链（实测 9 步、6+ 文件、~5,150 行）：**

```
worker-driver.ts (2200 行 TS，61 处 .sh 引用)
  runMechanicalFanIn 每步一次 shell-out（mechSh，各带超时 120s/600s/300s/Infinity）：
  1  acquire-workflow-lock  → bash fan-in-ff-merge.sh        (721 行 bash)
  2  merge develop          → git
  3  delta 判定             → anti-drift/classify .ts
  4  ts-typecheck           → .ts
  5  scoped 门              → bash scripts/test.sh --for-task  (1542 行 bash)
  6  doc 检查               → bash test.sh --static-checks-doc
  7  suite                  → suite-driver.ts (539 行 TS) + suite-slot-lib.sh (152 行 bash) spawn bash test.sh --buckets
  8  anti-drift land+AC 闸  → .ts + flip done → git
  9  ff                     → bash fan-in-ff-merge.sh（读 suite-capture 证书）
  失败回退 → fan-in-execute.js workflow（1072 行 × 双副本 plugin/workflows + .claude/workflows）
```

**四个不紧凑的实测证据：**
1. **同一业务过程 3 套实现**：机械（worker-driver TS + bash 原语）· workflow 兜底（fan-in-execute.js 1072×2 双副本）· bash 原语（ff-merge.sh 的锁/ff/clean-tree/escalation 业务）。三套必须保持行为一致。
2. **一次 fan-in = 9 次进程跳、6+ 文件**，每次 mechSh 带独立超时配置。
3. **锁协议分裂 4 文件**：workflow 锁（ff-merge.sh）· full-suite 锁（suite-slot-lib.sh + test.sh + suite-driver.ts）——`suite-slot-ssot-check.ts` 的存在本身就是分裂的证据。
4. **quay CLI/MCP 对执行环零参与**：`packages/quay/src/mcp-server.ts` 仅 373 行、单 instrument 工具；`quay driver`（cli/driver.ts 178 行）是薄壳——spawn `plugin/scripts/driver-runtime.ts`；`quay run`（QENG-4）只跑 gate meter，不派发 worker、不跑 fan-in。执行机制全部在 plugin/scripts（实验层）。

**执行核参与的 plugin/scripts 面（实测行数）：** worker-driver 2200 · ready-pool-check 2555 · slot-refill 1471 · driver-runtime 1239 · promotion-driver 845 · fan-in-ff-merge.sh 721 · suite-driver 539 · concurrent-batch-scheduler 523 · suite-slot-lib.sh 152 · dispatch-worktree-setup.sh 121。执行核相关 `.sh` ~5 个、~2,550 行承载核心业务。

---

## 3. 目标形态

**一个业务过程一套实现，落在 `packages/quay`（产品面）。**

1. **`quay task fan-in` CLI verb + MCP 工具**（TS in packages/quay）：吸收 acquire-lock → merge develop → delta 判定 → ts-typecheck → scoped 门 → suite → anti-drift → AC 闸 → flip done → ff 全步骤。driver 调这一个 verb，替代 9 次 mechSh + bash ff-merge。
2. **锁按 ADR-034**：由 driver 自身持有（受监督、可重启的常驻进程），释放只靠进程退出——bash 锁包装器与 flag 协议消失。
3. **workflow 兜底降级为纯调用**：driver 机械失败时调 `quay task fan-in --semantic-fallback`，不再是平行实现；删 fan-in-execute.js 双副本。
4. **套件入口收进 TS**：full-suite-runner.ts 已是 TS；`scripts/test.sh`（1542 行 bash）收窄为薄转发或并入 TS runner。
5. **dispatch 侧（slot-refill / ready-pool-check / concurrent-batch-scheduler）** 逐步并入同一产品面（分阶段，见 §4），消除「派发计算读盘上任务体」与「CLI 读 provider」两个真相源。

**清晰的分层：** 产品面（packages/quay）拥有执行环业务；实验层（plugin/scripts）保留方法论 checker / instrument（capability-catalog 仍注册），但不再拥有执行环业务过程。

---

## 4. 分阶段（增量，happy-path 先——沿用 SPEC-fan-in-driver-mechanical-orchestration 的「先跑通再搬语义」先例）

| Phase | 内容 | 判据（能取假） |
|---|---|---|
| **P1** | ADR-034 落地：锁收进 driver（自身持锁 / 非分离直接子进程），废除分离 holder + flag 协议 | driver 被杀 → 锁自动释放（负控制单测）；一次真实 fan-in 全程无孤儿 holder |
| **P2** | `runMechanicalFanIn` 产品化为 `quay task fan-in`（吸收 ff-merge.sh 的锁/clean-tree/escalation/ff 业务），删 fan-in-ff-merge.sh | 一次真实 fan-in 经新 verb 落地；旧 .sh 删除后无引用 |
| **P3** | workflow 兜底降级为 `--semantic-fallback` 纯调用；删 fan-in-execute.js 双副本 | 机械失败时语义兜底仍生效；双副本删净 |
| **P4** | suite 入口收进 TS；dispatch 侧（ready-pool-check/slot-refill）产品化 | 全量 suite 不回归；派发计算单一真相源 |

**贯穿判据**：每阶段业务行为不变（全量 suite 绿 + 一次真实 fan-in 落地）+ **执行环文件净减少**（SPEC-worker-driven-inner §1 的「检查/执行机制净减少」成功判据延伸）。

---

## 5. 成功判据（最终态）

1. 执行环 **3 实现 → 1**（fan-in 只有一个实现）。
2. 执行核 bash 业务面 ~2,550 行 → **近 0**（只剩薄转发）。
3. 一次 fan-in 从 **9 次 shell-out → 1 次 verb 调用**。
4. 锁逻辑**单点**（driver 持有），无时间阈值整类（ADR-034）。
5. 全量 suite 不回归；capability-catalog 注册数随删减下降。
6. quay CLI/MCP 拥有「从任务执行到 fan-in」的完整业务入口（可被第三方 provider 复用）。

---

## 6. 非目标（明确不做）

- **语义/LLM 判断不产品化**：pool 质量闸、冲突归因、止损判断等留在 loop（agent workflow），产品面只做确定性业务。
- **provider-agnostic ABI 不破坏**：执行环产品化后仍通过 Provider ABI 读写任务，不把 native 存储耦合进 Core。
- **方法论 checker/instrument 不删**：capability-catalog 的检查器保留，只是从「执行环的组成部分」降级为「对执行环的观测器」。

---

## 7. 与 ADR-034 的关系

- **ADR-034** = 锁生命周期裁定（driver 持有、进程退出即释放、无时间阈值）——本 SPEC 的 **P1 先决**，且是整个集中化的地基（锁收进 driver 后 bash 锁包装器才可删）。
- **本 SPEC** = 伞：执行环整体产品化（P2–P4 在 P1 之上）。ADR-034 的任务与 P1 合一或先行，outer 排期时注意依赖。

---

## 8. 一处必须写进任务前提的架构张力

`packages/quay` 是 **provider 无关的产品**，而 worker 派发（spawn Claude subagent、worktree 管理、套件）目前是实验层方法论。产品化执行环的前提是先把 **driver/fan-in 裁定为产品能力**（现有 `quay driver` + DRIVER_KINDS registry 其实已站了产品位置），而非实验特有逻辑。**若此裁定不成立，P2–P4 会产品化到一半又退回 plugin**——立案时必须在任务前提里写明，由人裁定后再动。
