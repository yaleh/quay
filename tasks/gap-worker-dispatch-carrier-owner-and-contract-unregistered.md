---
id: gap-worker-dispatch-carrier-owner-and-contract-unregistered
title: .quay/worker-dispatch.json 在 carrier registry 里 owner=unowned-yet /
  readers=unaudited，外部读者无法判断「在飞」与「崩溃残留」
status: ready
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

- [x] AC1（登记）：`docs/carrier-registry.json` 的条目改为真实 owner（`plugin/scripts/worker-driver.ts`），`readers` 不再是 `unaudited`（枚举真实读者：`plugin/scripts/duration-report.ts`、worker-driver 自身的 orphan reconcile、外部只读消费者）。
- [x] AC2（schema）：每条 dispatch 记录带稳定 `schema` 标记（如 `"worker-dispatch-record/v1"`），或文件级版本声明；⛔ 不得依赖「字段形状」作为版本判别。贴一条真实记录。
- [x] AC3（写入时机 + 原子性）：契约正文写明 spawn 后写、终态删、tmp+rename 原子替换，外部读者永远看不到半截文件；点名 `readDispatchStore` / `writeDispatchStore` 的实现位置。
- [x] AC4（残留判定，三态）：给出只读判定 `live`（pid 存活且 cmdline 匹配）/ `residue`（记录在但 pid 已死或 cmdline 不匹配）/ `not-evaluated`（文件缺失或不可读），⛔ 不得把 `residue` 或 `not-evaluated` 折成「无在飞」。至少一个 `node:test` 用伪造 pid / 伪造 cmdline 两条反向 fixture 覆盖。
- [x] AC5（不含 phase 的边界）：契约正文明确写「本载体不提供 phase」，并点名 phase 的唯一来源是 `lanes` / `driver live`（或后续 live-state）；⛔ 不允许消费者用 pid 存活自行推断 phase 而误读。

## Evidence

- L_D import-graph-check（本轮 worktree 实跑）: valueSccs=0 typeSccs=0 reverseEdges=0, ok=true
  （`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json`；dependency 结构未新增环/反向边）
- AC1：`docs/carrier-registry.json` → `{"name":"worker-dispatch.json","kind":"state-json","owner":"plugin/scripts/worker-driver.ts","readers":["plugin/scripts/worker-driver.ts","plugin/scripts/duration-report.ts"]}`；
  `plugin/test/carrier-registry-completeness.test.mjs` 7/7 绿（含 readers 枚举闸 + 伪造 reader / 裸字符串两条负控制）。
- AC2：写入侧（`upsertDispatchRecord`，单一盖章点）产出的真实记录：
  `{"gap-demo":{"taskId":"gap-demo","runId":"r1","workerPid":4242,"selectorReason":"demo","startedAtMs":1792930000000,"timeoutDeadlineMs":0,"cmdlineFingerprint":"claude -n quay-task-worker -p Task: gap-demo","schema":"worker-dispatch-record/v1"}}`；
  legacy 记录（c 字段引入前写的，如盘上生产载体）读取时 `schema: null`，⛔ 不靠字段形状判版本。
- AC3：契约正文 `docs/references/worker-dispatch-carrier.md` §3 点名 `writeDispatchStore`（tmp+rename）/
  `readDispatchStore` / `upsertDispatchRecord` / `removeDispatchRecord` 与 spawn/终态调用点。
- AC4：`plugin/test/duration-report.test.mjs` 9/9 绿；「AC4 三态」用例用伪造 procDir 造 live（pid 241 命中）、
  residue（pid 243 不存在；pid 242 cmdline 指向别的 task）、not-evaluated（缺 workerPid / 文件缺失 / 解析失败）
  三种取值，并断言报告层 `residue` 单列、右删失集只含 live。
- AC5：契约正文 §5「本载体**不**提供 phase」+ phase 唯一来源 `lanes` / `driver live`（或后续 live-state）。
- 作用域门：`bash scripts/test.sh --for-task gap-worker-dispatch-carrier-owner-and-contract-unregistered --allow-thin`
  → EXIT=0（178 tests pass, 0 fail）。anti-drift Touches check → 8 个实际改动文件全部在声明内（9 globs）。
- **2026-10-25 二次落地轮（上轮 exited-not-landed 的根因复核）**：
  - 上轮 suite 红的 4 个文件里，只有 `plugin/test/driver-runtime-control-plane.test.mjs` 被判为「任务引入」
    （delta-relatedness 报 RELATED 只是因为它 one-hop import 了本任务改动的 `driver-shared.ts`）。
    **本轮单跑该文件：6/6 pass**（AC2/AC4 production path 522ms 通过，实测端口
    promotion=12391 worker=9993 outer=19719 quality=1311 meta=5229 goal=22427）。
  - **真因（宿主 flake，与本 delta 无关）**：失败是 `fetch failed / cause: Error: bad port`，
    发生在 `callTool(started[kind].url, "halt", …)`。`serveKindControlPlane` 以 `port: 0` 由内核分配
    （`plugin/scripts/driver-runtime.ts:857`），本机 `ip_local_port_range=1024 65535` 覆盖了 undici fetch
    的 prohibited-port 表（2049/3659/4045/5060/5061/6000/6566/6665-6669/6679/6697/10080），
    六个 supervisor 里任一拿到这类端口 ⇒ 客户端 `new URL()` 后请求即被拒。**develop 上同样存在**
    （本 delta 未触碰 `driver-runtime.ts` / `control-plane-http.ts`）。⚠️ 未在本任务修（超出 Touches）；
    需要一条独立 gap：控制面绑到 prohibited port 时应重绑定或直接判失败重取。
  - 另 3 个红（`task-granularity-advice` / `full-suite-runner-cgroup` / `needs-human-parking-recheck`）
    在 develop 基线**同为红**（数据/负载依赖：语料无欠采样 bin、lane 实测 <128、盘上无 needs-human 任务），
    不在本任务的 added 集里。
  - 本轮 `git merge develop` 后重跑同一作用域门：EXIT=0（178 pass / 0 fail）；anti-drift 仍 OK（8 files ⊂ 9 globs）。

## DoD

- 登记落在 `docs/carrier-registry.json`；契约正文落在 `docs/references/` **或** `plugin/scripts/worker-driver.ts` 的 `DispatchRecord` 注释，**单一正本**，⛔ 不在两处各写一份。
- `plugin/scripts/duration-report.ts` 的既有读者与新登记语义一致（同一份 `classifyOrphanDispatch`，⛔ 不新增第二套 pid 判定）。
- `plugin/test/duration-report.test.mjs`（或 `plugin/test/worker-driver.test.mjs`）覆盖 AC4 三态。
- 契约正文写明该登记从哪个版本起生效。

## Touches

- `tasks/gap-worker-dispatch-carrier-owner-and-contract-unregistered.md`（自指）
- `docs/carrier-registry.json`（条目 owner/readers + 版本）
- `docs/references/worker-dispatch-carrier.md`（新增：契约单一正本）
- `plugin/scripts/worker-driver.ts`（re-export 保持旧 import 面）
- `plugin/scripts/driver-shared.ts`（dispatch 载体 + worker 身份判定落点；duration-report 经它复用同一份 classifyOrphanDispatch）
- `plugin/scripts/duration-report.ts`（既有读者对齐三态）
- `plugin/test/duration-report.test.mjs`（AC4 三态 + 两条反向 fixture）
- `plugin/test/worker-driver.test.mjs`（schema 标记断言）
- `plugin/test/carrier-registry-completeness.test.mjs`（readers 枚举 schema + 回归闸）

## Blocker

**2026-10-25T14:19:35.422Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: at least one bin is under-sampled (otherwise the rule is vacuous) [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/driver-runtime-control-plane.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：beb10389-ef2e-4896-9203-9a3c301ab90a
- **2026-10-25 二次轮复核：该 blocker 未复现**——`driver-runtime-control-plane.test.mjs` 单跑 6/6 绿，
  真因是内核分配端口落入 undici prohibited-port 表的宿主 flake（详见 Evidence 末条），⛔ 不是本 delta 引入。
