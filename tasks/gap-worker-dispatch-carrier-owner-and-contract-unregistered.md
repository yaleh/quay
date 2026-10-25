---
id: gap-worker-dispatch-carrier-owner-and-contract-unregistered
title: .quay/worker-dispatch.json 在 carrier registry 里 owner=unowned-yet /
  readers=unaudited，外部读者无法判断「在飞」与「崩溃残留」
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

`.quay/worker-dispatch.json` 已经是「当前在飞」的**直接量**：worker-driver 在 spawn 后原子写（`plugin/scripts/worker-driver.ts:5617` 的 `upsertDispatchRecord`），终态时删除（`:4820` / `:4997` / `:5076` / `:5513`），按 taskId 索引，字段 `taskId/runId/workerPid/selectorReason/startedAtMs/timeoutDeadlineMs/cmdlineFingerprint`。外部消费者实测它只有 5.6KB，读它是字节级成本。

但它**没有登记成契约**：

- `docs/carrier-registry.json:581` 的条目仍是 `owner: "unowned-yet"`、`readers: "unaudited"`；
- 记录里没有 schema/version 标记；写入时机（spawn 后、终态前；崩溃时残留）与「残留条目不是在飞」的判定（`classifyOrphanDispatch`：`workerPid` 存活 + `/proc/<pid>/cmdline` 仍匹配本任务，`worker-driver.ts:4630-4643`）只存在于实现里，外部读者只能反推；
- 文件缺失 / 空 map `{}` / 有残留条目三种状态，外部读者没有统一取值；
- 它**不含 phase**：`implementing`/`fan-in`/`awaiting-land` 仍必须来自 `lanes` / `driver live`（或后续 live-state）；本任务不改变这一点，只把边界写清。

## AC

- [ ] AC1（登记）：`docs/carrier-registry.json` 的条目改为真实 owner（`plugin/scripts/worker-driver.ts`），`readers` 不再是 `unaudited`（枚举真实读者：`plugin/scripts/duration-report.ts`、worker-driver 自身的 orphan reconcile、外部只读消费者）。
- [ ] AC2（schema）：每条 dispatch 记录带稳定 `schema` 标记（如 `"worker-dispatch-record/v1"`），或文件级版本声明；⛔ 不得依赖「字段形状」作为版本判别。贴一条真实记录。
- [ ] AC3（写入时机 + 原子性）：契约正文写明 spawn 后写、终态删、tmp+rename 原子替换，外部读者永远看不到半截文件；点名 `readDispatchStore` / `writeDispatchStore` 的实现位置。
- [ ] AC4（残留判定，三态）：给出只读判定 `live`（pid 存活且 cmdline 匹配）/ `residue`（记录在但 pid 已死或 cmdline 不匹配）/ `not-evaluated`（文件缺失或不可读），⛔ 不得把 `residue` 或 `not-evaluated` 折成「无在飞」。至少一个 `node:test` 用伪造 pid / 伪造 cmdline 两条反向 fixture 覆盖。
- [ ] AC5（不含 phase 的边界）：契约正文明确写「本载体不提供 phase」，并点名 phase 的唯一来源是 `lanes` / `driver live`（或后续 live-state）；⛔ 不允许消费者用 pid 存活自行推断 phase 而误读。

## DoD

- 登记落在 `docs/carrier-registry.json`；契约正文落在 `docs/references/` **或** `plugin/scripts/worker-driver.ts` 的 `DispatchRecord` 注释，**单一正本**，⛔ 不在两处各写一份。
- `plugin/scripts/duration-report.ts` 的既有读者与新登记语义一致（同一份 `classifyOrphanDispatch`，⛔ 不新增第二套 pid 判定）。
- `plugin/test/duration-report.test.mjs`（或 `plugin/test/worker-driver.test.mjs`）覆盖 AC4 三态。
- 契约正文写明该登记从哪个版本起生效。

## Touches

- `tasks/gap-worker-dispatch-carrier-owner-and-contract-unregistered.md`（自指）
- `docs/carrier-registry.json`
- `plugin/scripts/worker-driver.ts`（`DispatchRecord` 契约注释 + schema 字段）
- `plugin/scripts/duration-report.ts`（既有读者对齐）
- `plugin/test/duration-report.test.mjs`
- `plugin/test/worker-driver.test.mjs`