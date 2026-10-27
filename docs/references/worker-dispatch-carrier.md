# `.quay/worker-dispatch.json` —— dispatch 持久记录载体契约

**Status:** live contract（单一正本）。登记：`docs/carrier-registry.json`（`name: "worker-dispatch.json"`）。
**生效版本：** quay **0.23.0**（`plugin/VERSION` = `0.23.0-dev` 的本次变更；`worker-dispatch-record/v1`
标记与本契约同版生效。v1 之前写下的记录没有 `schema` 字段，按 **legacy-unversioned** 读取。）

**任务：** `tasks/gap-worker-dispatch-carrier-owner-and-contract-unregistered.md`。

**Non-goals：** 本文不描述 driver 的派发选择算法、不描述 fan-in、不重复 `worker-outcome.jsonl` 的字段
（那份记录的正本在 `plugin/scripts/worker-driver.ts` 的 `computeOutcome`）。本文只冻结**这个载体本身**
的四件事：谁写、何时写、外部读者能问什么、以及它**不**回答什么。

---

## 1. 它是什么 / 谁写、谁读

`.quay/worker-dispatch.json` 是一个 **JSON object**（按 `taskId` 索引的单文件 map），gitignored，
与 `worker-outcome.jsonl` / `worker-round.jsonl` 同族：**运行时状态，不是配置**。

| 角色 | 主体 |
|---|---|
| **writer（唯一）** | `plugin/scripts/worker-driver.ts`（spawn 后写、终态删） |
| **reader —— orphan reconcile** | `plugin/scripts/worker-driver.ts` 的 `reconcileOrphanDispatches`（adopt / finalize 孤儿） |
| **reader —— 只读报告** | `plugin/scripts/duration-report.ts`（右删失 / 在飞尝试读数） |
| **外部只读消费者** | 任何诊断/UI/后续 live-state：**只准**经 §4 的只读三态入口读取，⛔ 不得自己解析 pid |

实现位置（单一实现，⛔ 不新增第二套判定）：`plugin/scripts/driver-shared.ts` 的
`DispatchRecord` / `WORKER_DISPATCH_RECORD_SCHEMA` / `dispatchStoreFile` / `readDispatchStore` /
`writeDispatchStore` / `upsertDispatchRecord` / `removeDispatchRecord` / `readDispatchStoreClassified`；
`worker-driver.ts` re-export 这些符号以保持既有 import 面。
⚠️ 为什么判定逻辑在 `driver-shared.ts` 而不是 `worker-driver.ts`：`duration-report.ts` 必须用**同一份**
`classifyOrphanDispatch`，而 `worker-driver → relaxed-dispatch-ledger → duration-report` 已是一条值边；
反向 import 会成值环（`plugin/scripts/import-graph-check.ts` 的 `valueSccs` 棘轮钉在 0）。

## 2. 记录形状与版本标记（AC2）

**一条 v1 之后写入的真实记录**（`schema` 由 `upsertDispatchRecord` 盖章，这是它与 legacy 记录的**唯一**
版本差别）：

```json
{
  "gap-live-read-cost-linear-in-round-carrier": {
    "schema": "worker-dispatch-record/v1",
    "taskId": "gap-live-read-cost-linear-in-round-carrier",
    "runId": "wk-prod-anchor",
    "workerPid": 554719,
    "selectorReason": "…（一句话：为什么派它）",
    "startedAtMs": 1792934871715,
    "timeoutDeadlineMs": 0,
    "cmdlineFingerprint": "claude-fjdac --settings … -n quay-task-worker … Task: gap-live-read-cost-linear-in-round-carrier"
  }
}
```

- `schema` —— **稳定版本标记**（`worker-dispatch-record/v1`）。由 `upsertDispatchRecord` 在**单一写入口**
  盖章，⛔ 不靠每个调用点记得填。
- ⛔ **不得用「字段形状」判别版本**：读者的版本判别只看 `schema` 这个取值；缺该字段的记录 = v1 之前写的
  （`legacy-unversioned`），按同一份读取逻辑处理并**如实报 `schema: null`**（`readDispatchStoreClassified`
  的 `entries[].schema`）。**本契约落地前**写入的生产记录（例如本文件撰写时盘上的那一份）就**没有**
  `schema` 字段——这正是 legacy 形态，不是「版本不明」。（字段含义：`timeoutDeadlineMs = 0` ⇒ 无超时；非 0 ⇒
  `startedAtMs + timeoutMs`，adopt 时**沿用**、⛔ 不重置。）

## 3. 写入时机与原子性（AC3）

1. **spawn 成功后立刻写一条**：`plugin/scripts/worker-driver.ts` 的 `runOneWorker`（`if (workerPid) { upsertDispatchRecord(...) }`）。
   `workerPid` 为 null（spawn 失败）⇒ **不写**——没有可被孤儿的进程。
2. **终态计算后删对应条目**：`removeDispatchRecord(...)`，调用点在 `worker-driver.ts` 的终态处置路径
   （正常退出 fan-in 完成、orphan finalize、adopt 终态、超时/异常终态）。记录**持有到 outcome 写完为止**：
   先 `appendOutcomeToFile`、后 `removeDispatchRecord`（顺序由 `worker-driver.test.mjs` 的源文本断言钉住）。
3. **写入永远原子**：`writeDispatchStore` 走 **tmp + rename**（先写 `<file>.tmp-<pid>-<ts>-<rand>`，再
   `renameSync`）⇒ 外部读者**永远看不到半截文件**。`upsert`/`remove` 都是「读整份 → 改 → 原子替换」，
   由 driver 进程内同步调用串行化。
4. **崩溃语义**：driver 在 worker 存活期间死掉 ⇒ 记录**残留**。残留条目**不**等价于在飞，见 §4。

## 4. 只读判定：三态 `live` / `residue` / `not-evaluated`（AC4）

外部读者的唯一入口：**`readDispatchStoreClassified(file, procDir?, workerName?)`**（`driver-shared.ts`）。

| 取值 | 判据 | 含义 |
|---|---|---|
| `live` | `classifyOrphanDispatch(record) === "adopt"`：`/proc/<workerPid>/cmdline` 可读，且同时含本 workspace 的 worker `-n` 名与该 task id（词边界匹配） | 这条派发**仍在飞** |
| `residue` | 记录在，但 pid 已死 / cmdline 已不匹配（pid 复用）/ `/proc` 读不懂 | **不是**在飞；也**不是**「没有在飞」 |
| `not-evaluated` | 文件缺失（`fileState:"missing"`）、不可读（`"unreadable"`）、解析失败（`"malformed"`）；或单条记录结构不可读（缺可用 `workerPid`/`taskId`，计入 `notEvaluatedRecords`） | 这一问**没查成** |

规则：

- ⛔ **`residue` 与 `not-evaluated` 不得折成「无在飞」。** 报告必须三态并列（`duration-report.ts` 的
  `dispatchStore` 段即此形状：`live` / `residue` / `notEvaluatedRecords` + `fileState`）。
- ⛔ **不得新增第二套 pid 判定**：`residue` 与 `live` 都从 `classifyOrphanDispatch` 派生（`classifyDispatchEntry`
  是它唯一的取值映射）；改判定只改这一处。
- `workerName` 必须来自 `resolveWorkerProcessName(root)`（`.quay/profiles.yml` 的 `roles["task-worker"].name`），
  ⛔ 不用写死的 `quay-task-worker`——第三方项目改名后写死字面量会让**在飞** worker 恒判 `residue`
  （2026-09-13 quay-fleet 实测事故）。
- 单向对照测试（`plugin/test/duration-report.test.mjs`）：伪造 pid / 伪造 cmdline 两条反向 fixture，
  同一条记录除 cmdline 外逐字相同 ⇒ 一条 `live`、一条 `residue`（判据能取假）。

## 5. 边界：本载体**不**提供 phase（AC5）

`worker-dispatch.json` 只回答「**有一条派发记录、它此刻是否还活着**」。它**不**含
`implementing` / `fan-in` / `awaiting-land` 之类的**阶段**。

- **phase 的唯一来源**是 `lanes` / `driver live`（或后续专门的 live-state 载体）。
- ⛔ **不允许**消费者用「pid 存活」自推 phase：一个 worker 活着既可能是 `implementing`、也可能已经进入
  fan-in 的等待段；pid 存活对该问题**不携带信息**。
- 本任务不改变 phase 的取数面，只把这条边界写清——想回答 phase 的消费者请读那两份正本，不要在本载体上
  加字段。

---

## 6. 相关正本

- 登记与完整性闸：`docs/carrier-registry.json` + `plugin/test/carrier-registry-completeness.test.mjs`。
- 孤儿 adopt/finalize 的语义：`plugin/scripts/worker-driver.ts` 的 `reconcileOrphanDispatches` /
  `finalizeOrphanDispatch` / `adoptOrphanWorker`。
- 只读报告的消费面：`plugin/scripts/duration-report.ts` 的 `readDispatchStoreState` / `dispatchStore` 段。
