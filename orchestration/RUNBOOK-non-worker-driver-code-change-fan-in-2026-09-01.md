# RUNBOOK：非 worker-driver 驱动的代码变更 + fan-in（直接变更落地协议）

**日期**：2026-09-01｜**来源**：2026-08-31 实测执行（`MAIN_TAIL_STALL_PCT` 默认 3→6 + suite-params 第 7 旋钮 config 化）
**正本关系**：worker-driver 驱动的 fan-in 正本是 `SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md`；本 RUNBOOK **只**覆盖**非 worker-driver 驱动**的直接变更，是那条机械编排路径之外的一个旁路，不是替代。

---

## 0. 一句话

**直接改代码（不经任务 worker 机制）后的落地协议：拿 fan-in lock → merge develop → 全量套件（机械调用参数）→ ff develop → 释放 lock。**

⛔ **只适用于非 worker-driver 驱动的变更。worker-driver 驱动的 worker 和 fan-in 一律走 `runMechanicalFanIn`**（锁 / merge / delta / typecheck / scoped / suite / ff 全由 driver 机械编排），**不得套用本协议**——二次拿锁 + 绕过 driver 编排 + 状态二次翻 = 冲突与审计断裂。

## 1. 适用边界

| 场景 | 用本协议？ | 原因 |
|---|---|---|
| 人 / Claude 会话直接改产品/套件代码（不立任务、不走 worker） | ✅ | 没有 worker 承载 fan-in，锁/suite/ff 无人编排 |
| worker-driver 派发的任务 worker（建树→实现→fan-in） | ⛔ | driver 已编排 worktree + fan-in 全套 |
| 机械 fan-in（`worker-driver.ts` `runMechanicalFanIn`） | ⛔ | 全套已含，套用即重复拿锁/重复 ff |
| fan-in-execute workflow（机械失败后的语义兜底） | ⛔ | 只由 driver 在失败路径唤起 |

**判据（一条）**：变更有没有 taskId + 派发 worktree？有 → 走 driver；没有 → 本协议。

## 2. 前置：worktree 正确基线 + provisioning

- ⛔ `EnterWorktree` 默认基于 `origin/master`，可能落后 develop 数十条（实测：`MAIN_TAIL_STALL_PCT` 特性在 develop 上、master 上没有，裸建 worktree 里 grep 不到目标行）。**先 `git checkout -b <branch> develop` 改挂正确基线**；切分支前把 worktree 自带的 `.quay/config.yml` stash 掉（gitignored、非本变更）。
- 裸 worktree（EnterWorktree 建）缺三样东西，跑全量套件必红：
  - **node_modules symlink**——`dispatch-worktree-setup.sh` 只给派发 worktree 建。缺了则 driver-cli / npm-pack-e2e 等经 temp-root 解析 `yaml` 等依赖时 `ERR_MODULE_NOT_FOUND`。补：`ln -s <main>/node_modules <worktree>/node_modules`。
  - **`--state-dir`**——跑套件时显式传 `<main>/.quay`。缺省则套件基础设施（full-suite.log + suite-load sampler）写到 worktree 的 .quay，**污染 help-contract 的「.quay mtime 不变」负对照**。
  - **位置**——worktree 在 `.claude/worktrees/` 下会触发 loop-shipping 等 walker 类测试误判（把整个仓库当 `.claude/worktrees/` 容器跳过，corpus 只扫到 10 个文件）。**全量套件应从派发样式 worktree（`quay-worktrees/<id>`、有 node_modules symlink + config）跑**。

## 3. 变更 + 快验证

- 改动文件的单元测试（如 suite-params 15/15）、packages typecheck（`for d in packages/*/; do npx tsc --noEmit -p "$d"`）、scoped 测试。
- 改 config 默认值/旋钮时顺手验 env 覆盖语义（`VAR="${VAR:-default}"` 形态）。

## 4. fan-in 协议（核心）

1. **拿 fan-in lock**：写 holder（`flock -x .git/fan-in.lock` + 阻塞，向 `.quay/fan-in-lock-events.jsonl` 发 acquire/release 事件）后台跑，排队等锁。⚠️ holder 用 `cat >/dev/null` 阻塞（别用 `sleep infinity` 子进程——它继承锁 fd）。
2. **merge develop** 进分支。develop 是权威基线、可能已前进——merge 前 `git diff --name-only <base> develop` 核对与变更文件的重叠；不重叠则 merge 必干净。
3. **全量套件**（⛔ 用机械 fan-in 的调用参数，勿简化为裸 `full-suite-runner.ts --root <wt>`）：
   ```
   node --no-warnings --experimental-strip-types <wt>/plugin/scripts/full-suite-runner.ts \
     --root <wt> --state-dir <main>/.quay --runner inner --run-id <runId>
   ```
   从派发样式 worktree 跑（§2）。绿 → 继续；红 → 先读 verification-round failures[] 归因（可能是别的任务/环境的静态检查红），别急着重实现。
4. **ff develop**：`git push . <branch>:develop`（仅当 develop 是本分支祖先）。
5. **释放 lock**：杀 holder + 补 release 事件。⚠️ 勿用 `pkill -f 'sleep infinity'`（自匹配会把执行 shell 一起杀）；且要连继承锁 fd 的子进程一起清。

## 5. 与机械 fan-in 的对应

| 机械 fan-in（`runMechanicalFanIn`） | 本协议手工对应 |
|---|---|
| acquire-fan-in-lock | holder + acquire/release 事件 |
| merge develop → delta 判定 | `git merge develop` + `git diff --name-only` 核对 |
| ts-typecheck 闸 | 单元 + typecheck |
| scoped 门 | 改动文件 scoped 测试 |
| 全量 suite（`defaultMechanicalSuiteCommand` 参数） | 同参数手动调用（§4.3） |
| ff（fan-in-ff-merge.sh） | `git push . <branch>:develop` |
| 状态翻转 + 记录 | ⛔ 本协议无 taskId、不翻状态；verification-round 的 taskId=None |

## 6. 踩坑清单（2026-08-31 实测，全部真实发生）

- ⛔ **没拿 fan-in lock 就跑 suite** = 协议违规（人纠正）。锁/suite/ff 是原子段。
- 缺 node_modules symlink → driver-cli 等红（补后 9/9 绿）；缺 `--state-dir` → help-contract 红；`.claude/worktrees/` 位置 → loop-shipping 红。
- **环境退化期先排环境**：负对照——loop 自己的 develop 轮（rounds 802/803/806）在同一窗口也全红（session-liveness flake）。改的测试文件与我的文件无关，且单独跑绿 ⇒ 环境，非代码。
- **develop 前进竞态**：merge 后 develop 又动 → 重 merge + 判 delta。**只有代码变化才重跑套件**；task 文件/状态翻转（如 `tasks/*.md`）不算代码，跳过重验证（delta-scope 的 doc-only skip 同理）。
- **config.yml 值**（gitignored、per-workspace、主检出）：机制走代码（SUITE_KNOBS 等），**值手工加**（`suite: main_tail_stall_pct: 6`）。不加也生效（test.sh 字面默认是兜底），加了才显式/可审计。

## 7. 红线（与 worker-driver 驱动的区隔）

- worker-driver 的 `runMechanicalFanIn` 已编排：锁 / merge / delta / typecheck / archguard 结构闸 / scoped / suite / ff（正本 `SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md`）。
- 本协议**不产生 taskId、不翻状态**——落地轮的 verification-round 记录 taskId=None（round 807 实测）。
- **worker 和 fan-in 由 driver 驱动时，任何本协议的手工步骤都是重复/冲突**：锁二次拿、状态二次翻、审计断裂。本 RUNBOOK 是给「没有 worker 承载」的直接变更用的旁路，不是给 driver 流程的替代品。
