---
id: gap-goal-list-no-thin-projection-no-since
title: goal list --json 无瘦投影/无增量：397 条 786ms/1.28MB，criterion/expect/origin/body
  是外部消费者用不到的长字段
status: todo
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

- [ ] AC1（瘦投影）：`quay goal list --json --no-body` 存在，每条记录只保留 `id/title/status/kind/goal/updatedAt`（+ 存在时的 `statusLog`），⛔ 不含 `body/criterion/expect/origin`；在本仓库实测输出字节数 ≤ 现 `--no-evidence` 输出的 40%，贴前后两条命令的输出字节数与耗时。
- [ ] AC2（增量）：`quay goal list --json --since <ISO8601|epoch-ms>` 按 `updatedAt` 过滤；贴一次双向实跑：一个已知时间点之后改一条记录 ⇒ 该记录出现；该时间点之前不出现。
- [ ] AC3（合并读面）：新增 `quay goal log [--since <ISO8601>] --json`，合并所有记录的 `statusLog`，按 `at` 升序返回 `{id,goal,kind,at,from,to,actor,reason}`；贴实跑输出，并给出「返回条数 = 各记录 statusLog 长度之和」的核对读数。
- [ ] AC4（三态）：goals 目录缺失/不可读 ⇒ 与「读到 0 条」不同的取值（非零退出或 `evaluated:false`），⛔ 不得返回空数组冒充「无变化」。
- [ ] AC5（回归）：默认 `quay goal list --json` 的输出逐字不变，贴改动前后 `sha256`。

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