---
id: gap-goal-list-no-thin-projection-no-since
title: goal list --json 无瘦投影/无增量：397 条 786ms/1.28MB，criterion/expect/origin/body
  是外部消费者用不到的长字段
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

`quay goal list --json` 既没有瘦投影也没有增量读：

- 本仓库 298 条记录，`--no-evidence` 仍返回 0.62s、且携带全部 `body/criterion/expect/origin`；不带 `--no-evidence` 时 1.53s（代价 ∝ `gate-events.jsonl` 账本大小，本仓库 64.9 万行）。
- 消费方 claudecodeui 实测 397 行 786ms/1.28MB；`--kind goal` 仍 740ms/287KB——过滤发生在 Provider 返回之后，所以不省时。
- 外部只读消费者（工作区标题栏常驻面板）只需要 `id/title/status/kind/goal/updatedAt`；`criterion`/`expect` 还是多行命令串。

goal/AC 的状态迁移历史**已经存在**且是单源 append-only：每条记录 frontmatter 的 `statusLog: [{at,from,to,actor,reason}]`（`packages/quay/src/core/goal-store.ts:2444-2470` 在 `statusChanged` 时追加），`goal show <id> --json` 已原样暴露。因此**不需要**新增 `goal-status-events.jsonl` 第二载体；缺的是一个跨记录合并的读面。

`updatedAt` 是文件 mtime（`packages/quay/src/core/goal-store.ts:1243` 的 `fs.statSync(p).mtimeMs`）。git checkout/merge 会让它变大 ⇒ 以它为 `--since` 过滤只会**多报**不会漏报，方向安全。

## AC

- [x] AC1（瘦投影）：`quay goal list --json --no-body` 存在，每条记录只保留 `id/title/status/kind/goal/updatedAt`，⛔ 不含 `body/criterion/expect/origin/statusLog`——历史迁移由 AC3 的 `goal log` 提供，列表读不需要它。需要 statusLog 时用显式开关 `--with-status-log`（默认关闭）。在本仓库实测：瘦投影输出字节数 ≤ 现 `--no-evidence` 输出的 40%（不含 statusLog），并同时贴一条 `--no-body --with-status-log` 的字节数作为对照（消费方实测 138KB → 253KB，+83%）。
  - 实测（本任务 worktree，298 条记录，同一棵树同一时刻）：`--no-evidence` = 1,383,114 B；`--no-body` = 81,902 B = **5.92%**（≤40%）；`--no-body --with-status-log` = 193,315 B（相对瘦投影 +136.0%）。
  - 投影是**白名单**（`THIN_LIST_FIELDS`），不是"减四个键"；`packages/quay/test/cli-goal-read-surface.test.mjs` AC1 逐条断言「只有白名单键」，并用**对照组**（同 fixture 不带 flag 时 `body/criterion/expect/origin/statusLog` 全部在场）证明缺席断言非空转。
- [x] AC2（增量）：`quay goal list --json --since <ISO8601|epoch-ms>` 按 `updatedAt` 过滤；贴一次双向实跑：一个已知时间点之后改一条记录 ⇒ 该记录出现；该时间点之前不出现。
  - 实跑（298 条真实记录的临时 workspace 快照，`--no-body`）：取 cut=`2026-10-25T13:51:39.618Z` → **0 条**；`touch` 记录 `AC-202` 之后再跑同一 cut → **1 条，且恰为 `AC-202`**；反向对照 cut=`2026-10-01T00:00:00Z`（早于全部 mtime）→ **298 条**（不会漏报）；cut=`2026-11-01`（晚于全部）→ 0 条。
  - epoch-ms 形式（`--since 1792936299618`）与 ISO 形式结果逐字节一致（消费方可直接回喂它刚读到的 `updatedAt`）；无法解析的 `--since` → 退出码 **2**（usage error），⛔ 不静默退化成"不过滤"把全表当成功读返回。
  - mtime 读不到的记录**包含**而非丢弃（同「只多报不漏报」方向），已在 `updatedAtOrAfter` 注释与测试中固定。
- [x] AC3（合并读面）：新增 `quay goal log [--since <ISO8601>] --json`，合并所有记录的 `statusLog`，按 `at` 升序返回 `{id,goal,kind,at,from,to,actor,reason}`；贴实跑输出，并给出「返回条数 = 各记录 statusLog 长度之和」的核对读数。
  - 实跑（本仓库 `/goals`）：`quay goal log --json` → **451 条**；独立核对（直接读 carrier 文件、按 `- at:` 计数、**不经合并代码**）232 条记录共 **451** 条 ⇒ 451 = 451。
  - 排序与字段：`at` 严格非降（同刻用 id 做确定性 tie-break）；每行键恰为 `{id,goal,kind,at,from,to,actor,reason}`；AC 行的 `goal` 是其所属 GOAL，GOAL 行为 `null`（无自指）；`--since` 按每条迁移自己的 `at` 过滤。
  - 合并只有一个实现（`mergeStatusLog`），⛔ 没有第二套 statusLog 解析、也没有第二载体。
- [x] AC4（三态）：goals 目录缺失/不可读 ⇒ 与「读到 0 条」不同的取值（非零退出或 `evaluated:false`），⛔ 不得返回空数组冒充「无变化」。
  - 缺失目录：`--no-body` / `--since` / `goal log` 三者都输出 `{"evaluated":false,"reason":"goal carrier directory does not exist: <dir>"}` 且退出码 **3**（= NOT-EVALUATED，与 `goal check --stale-pass` 同码）。
  - 对照（同 workspace，空 `goals/`）：同一命令 → `[]` 且退出码 **0** ⇒ 两个读数可区分。
  - 不可读目录（`chmod 000`，非 root 实测）：`{"evaluated":false,"reason":"… unreadable (EACCES) …"}` + 退出码 3。
  - 探针在**连接 Provider 之前**执行：store 构造函数 `mkdirSync` 会把"缺失"改写成"空"，这正是必须前置探测的原因（代码注释已钉死）。
  - 默认 `quay goal list --json` 面**不加探针**，其既有行为逐字不变。
- [x] AC5（回归）：默认 `quay goal list --json` 的输出逐字不变，贴改动前后 `sha256`。
  - 改动前：`56fa8bcb07fe1085afce8fb6cb6165e446bd7637b6497bf62d6c4b3984945c87`（1,386,474 B，298 条）
  - 改动后：`56fa8bcb07fe1085afce8fb6cb6165e446bd7637b6497bf62d6c4b3984945c87`（同字节数）
  - `--no-evidence` 面亦不变：`3556e5751398f144193d1cafc2097f6a7bfc9e60d88f6dfc48dcf8ea0685c85c` 前后一致。

## ADR-007 axis

- L_D import-graph-check（本任务 worktree 全树，含本任务改动）: valueSccs=0 typeSccs=0 reverseEdges=0 files=511 edges=1531 gateLayerViolations=0（与 headBaseline 一致；新增的 `../config.ts` / `../gate/config/loader.ts` 引用未引入新环）

## DoD

- 改动落在 `packages/quay/src/cli/goal.ts`（投影与过滤）与 `packages/quay/src/cli/help.ts`（登记），⛔ 不改 Provider ABI 的 `GoalRecord` 形状——投影在 CLI 层完成。
- `packages/quay/test/` 有 `node:test` 覆盖 AC1/AC2/AC4，fixture 用临时 workspace（真 `.quay/config.yml` + `goals/`），文件头 `// @test-group product`。
- `quay goal log` 的合并逻辑只有一个实现，⛔ 不新增第二套 statusLog 解析。

## Touches

- `tasks/gap-goal-list-no-thin-projection-no-since.md`（自指）
- `packages/quay/src/cli/goal.ts`（投影 / `--since` / `goal log`）
- `packages/quay/src/cli/help.ts`（两个新 flag 与 `goal log` 的登记）
- `packages/quay/test/cli-goal-read-surface.test.mjs`（新测试：投影、`--since`、三态、`goal log` 合并计数）
- `packages/quay/test/cli.test.mjs`（若既有 goal list 断言需要同步）
