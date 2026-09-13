---
id: gap-ac203-record-schema-has-no-kind-dimension
title: AC-203「driver 在第三方项目真活」的记录 schema 没有 kind 维度 —— 三条证据无法区分验的是哪个 driver
  kind，而 goal/quality/meta 当场复现了它声称已排除的形态
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**症状（2026-09-13 实测，人裁定「所有 driver 都应作为产品化的一部分分发，并在目标项目开发过程中实际运行」后当场撞到）**：

在 ad-arm1 的 archguard（真实第三方项目）上启动 `goal` / `quality` / `meta` 三个 driver kind，三次全部打印：

```
started: supervisor pid=4035869 kind=goal run_id=gl-prod-1789266411
```

并 **退出 0**，而紧随的 status 是：

```json
{"supervisor_alive":0,"driver_alive":0,"alive":0,"running":0,"carrier_records":0}
```

直接量交叉核实（⛔ 不采信 status 自述）：三个 kind 的实际进程数 **全为 0**，三个载体 `goal-round.jsonl`/`quality-round.jsonl`/`meta-driver-round.jsonl` **全部不存在**。

真实死因**只写在目标项目内部日志** `.quay/<kind>-driver-supervisor.log`，全文仅 54 字节一行：

```
/usr/bin/node: bad option: --experimental-strip-types
```

**这与 GOAL-009 背景第 2 条逐字记载的形态完全相同**（当时是 promotion kind、根因是 `driver-runtime.ts:986` 把路径锚在 `opts.root`）：「**`quay driver start` 报成功、退出 0，而 driver 根本没活**」。

**而 `AC-203`（「driver 在无 `plugin/` 的第三方项目里真活——判据读载体，⛔ 不读 start 退出码」）已 achieved。**

**⚠️ 本任务的主体不是「AC-203 漏了几个 kind」，而是比那更硬的一条 —— 它的记录 schema 里根本没有 kind 这个维度**（实测）：

```
载体中 ac=GOAL-009-AC-203 的记录数：3
字段集：{ts, host, project_root, has_plugin_dir, driver_alive, carrier_records, build_sha}
含 kind 字段的记录数：0
```

⇒ 该 AC 结构上**不可能**区分「验的是 promotion 还是 goal」。它的绿只能说明「**某一个**（未记录是哪个）driver kind 在第三方项目里活过」，⛔ 不能说明「driver 在第三方项目里真活」这个它标题声称的命题。

**同一模式的第三次出现（⛔ 不是孤例）**：该 AC 三条记录的 `project_root` 分别是
`/home/yale/quay-verify-coldstart-63ee9681-root`、`-b95bd6f1-root`、`-4a9654a1-root`
——**全部是 `quay-init` 造的一次性项目**。与 `AC-234`（web 第三方渲染，三条证据同样全来自 `quay-verify-coldstart-*-root`）、`AC-206`（goals+tasks 双载体）构成同一族：**AC 在一个天然具备 quay 自身形状的子集上取得绿，被当成了全集的保证。**

**为什么现在必须修（发生率已给出，⛔ 不是假想）**：人 2026-09-13 裁定所有 driver 都要在目标项目实际运行 ⇒ 该 AC 覆盖的对象从 1 个 kind 扩到 5 个（promotion/worker/goal/quality/meta；outer 已于 2026-09-04 退役）。**扩容当天，三个新 kind 全部复现了该 AC 声称已排除的形态。**

## Plan

1. **先取直接量**：打印载体中 `GOAL-009-AC-203` 全部记录的完整字段集与取值（⛔ 不只报数量），标出缺哪些维度。
2. **补 kind 维度**：让该 AC 的记录能区分 driver kind；**并决定该 AC 的语义边界** —— 是「每个 kind 各需一条记录」还是「一条记录携带已验证 kind 的集合」，给出选择理由，⛔ 不要两种都做。
3. **⛔ 不得只改判据文本而不改产出侧**：产出侧（写记录的那一处）与判据（读记录的那一处）必须同时覆盖新维度，否则就是本仓库已立案的 `gap-ac-record-schema-duplicated-between-criterion-and-writer` 那类两处漂移。
4. **start 的存活确认**（与 kind 维度同源、一并处理）：`quay driver start` 在 driver 未能存活时**不得**打印 `started:` 并以 0 退出。给出你选的形态（启动后短暂等待再确认 / 读 supervisor 首轮日志 / 其他），并说明它为什么不会把「慢启动」误判为「死亡」。
5. **负控制**：构造一个必死的启动（例如 PATH 中放一个不支持 `--experimental-strip-types` 的 node），`start` 必须以非零退出或明确报错；正常启动仍须成功。

## Acceptance Criteria

- [x] AC1 能取假：载体中存在**至少两条** `GOAL-009-AC-203` 记录，其 kind 维度取值**不同**（例如 promotion 与 goal 各一条）；打印两条记录原文。今天此项为假（全部 3 条无 kind 字段）。
- [x] AC2 产出侧与判据侧同时覆盖：打印「判据实际读取的字段集」与「产出侧实际写入的字段集」的**两向差集**，差集为空。
- [x] AC3 start 存活确认能取假：注入一个必死的 driver 启动 ⇒ `start` 非零退出且报出死因；移除注入后 ⇒ 正常启动成功。**两态输出逐字贴出。**
- [x] AC4 慢启动不误判：构造一个启动耗时明显长于确认窗口的 driver ⇒ 必须**不**被判为死亡（贴出该用例的实际耗时与判定结果）。

## Definition of Done

- 四条 AC 满足，AC3/AC4 的两态输出有实际留档。
- ⛔ 不得通过放宽 AC-203 判据（例如删掉 `driver_alive` 断言）来满足任何一条。
- ⛔ 本任务不负责让五个 kind 全部在 archguard 上跑起来——那已于 2026-09-13 手工完成（五个 supervisor 均存活）；本任务只负责让「**报成功但实际死亡**」这件事今后会被机械拦下。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## Evidence（本轮实测留档）

### AC1 —— kind 维度真能取假（真判据 + 真写入通道）

判据本体（`goals/AC-203-*.md`）加了两条：① 合格记录必须带非空 `kind`（缺 kind 的记录**不计入**，⛔ 不是当作合格）；② 合格记录的 kind 取值**至少两个不同**。

可失败控制（`--selfcheck`，驱动【产品函数】+【真判据】：夹具根带 `.quay/productization-verification.jsonl` + 从本仓库拷入的真 `goals/AC-203-*.md`，经 `ac_record_finalize` 复跑真判据、退出码落 `AC_RECORD_RERUN_RC`）：

```
selfcheck: ac203-kind-criterion(one-kind) rerun_rc=1 (expect 1 — 单 kind 记录集不满足「>=2 个不同 kind」)
selfcheck: ac203-kind-criterion(two-distinct-kinds) rerun_rc=0 (expect 0 — promotion+goal ⇒ 真判据翻绿)
selfcheck: ac203-kind-criterion(two-SAME-kind) rerun_rc=1 (expect 1 — 两条同 kind 不算能区分; 负控制, ⛔ 少了它上一条可以是恒绿)
```

两条记录原文（`selfcheck: ac203-kind-record(…)` 逐字打印）：

```
{"build_sha":"0123456789abcdef0123456789abcdef01234567","ts":"2026-09-09T00:00:00Z","ac":"GOAL-009-AC-203","host":"hostB-fake","project_root":"/tmp/third-party-fake","has_plugin_dir":false,"driver_alive":1,"carrier_records":5,"kind":"promotion"}
{"build_sha":"0123456789abcdef0123456789abcdef01234567","ts":"2026-09-09T00:00:00Z","ac":"GOAL-009-AC-203","host":"hostB-fake","project_root":"/tmp/third-party-fake","has_plugin_dir":false,"driver_alive":1,"carrier_records":5,"kind":"goal"}
```

写入侧 fail-closed（缺值 ≠ 合格）：

```
selfcheck: ac203-record(kind-empty) wrote=0 (expect 0 — 空 kind 拒写)
selfcheck: ac203-record(kind-ill-formed) wrote=0 (expect 0 — 'Promotion X' 形状非法, 拒写)
```

⚠️ **边界如实**：**生产载体** `.quay/productization-verification.jsonl` 的 3 条 AC-203 记录**仍是旧 schema（无 kind）**（host=orangevps，`project_root` 全是 `quay-verify-coldstart-*-root`）⇒ 按新判据该 AC **今天不再是绿的** —— 这是如实的（那三条本来就不能区分 kind，它们的绿本来就只说明「某一个 kind 活过」）。产出侧已补齐：step④ 现在按 `AC203_KINDS`（缺省 `promotion goal`）逐个 `driver start` 并【按 kind 各写一条】⇒ 下一次 e2e 即产出「两个不同 kind」的记录集。⛔ 本任务不负责在 archguard 上把五个 kind 跑起来（见 DoD）。

### AC2 —— 两向差集为空

`bash plugin/scripts/verify-deliver-coldstart.sh --ac-record-schema-report`（rc=0）：

```
  GOAL-009-AC-203    [ok] criterion=6 schema=6 writer=6
AC-RECORD-SCHEMA-REPORT: 14 AC registered, 14 producer(s) in script, missing(criterion-vs-schema)=0 missing(criterion-vs-writer)=0 missing(schema-vs-writer)=0 surplus=1 unregistered=0 not-evaluated=0
```

（`surplus=1` 是 AC-239 的既有在案项，⛔ 与本任务无关；AC-203 三侧同为 6 个字段、两向差集为空。）

### AC3 —— start 存活确认，两态逐字

夹具：plugin root 有 `scripts/` 但**没有** driver 脚本（⇒ supervisor 找不到 driver、打印 `driver-runtime: driver not found at …` 并退出 —— 这正是 GOAL-009 记载的那条死亡形态，且是**确定性**的，⛔ 不是「等一会看看」）。

**注入态（必死）** `exit=1`，stdout **为空**（⛔ 没有 `started:`），stderr：

```
start-failed: kind=promotion — supervisor 已退出且无 driver 存活（elapsed_ms=760）。死因（/tmp/dr-ac3-dead-pUZ8n0/.quay/promotion-driver-supervisor.log 尾）:
driver-runtime: driver not found at /tmp/dr-ac3-dead-pUZ8n0/plugin/scripts/promotion-driver.ts
```

**移除注入（正常态）** `exit=0`：

```
started: supervisor pid=468562 kind=promotion run_id=dr-ac3-live driver pid=468665 confirmed_ms=1010
{"kind":"promotion","supervisor_pid":468562,"driver_pid":468665,"supervisor_alive":1,"driver_alive":1,"alive":1,"running":1,…}
```

（测试：`plugin/test/driver-runtime.test.mjs` 的 `AC3 (gap-ac203)`；两态都在 stdout 逐字打印 ⇒ 有留档。）

### AC4 —— 慢启动不判死

夹具：前 3 秒「起来即退」（用 stamp 文件跨 respawn 记住首次启动时刻），3 秒后转入常驻 —— 即「driver 约需 3s 才就绪」。

**窗口 1s（明显短于启动耗时）** `exit=1`、`wall_ms=1519`，stdout 为空，stderr：

```
start-pending: kind=promotion — 确认窗口 1s 用尽，driver 未被确认存活（supervisor alive=1，driver pid=469095 alive=0，elapsed_ms=1013）。⛔ 这不是死亡判定（慢启动 / 驱动崩溃-重拉循环与此同形）；复读用 quay driver status --kind promotion。日志尾:
```

**同一夹具、窗口 30s** `exit=0`：

```
already-running: supervisor pid=468986
already-running: confirmed driver pid=469455 confirmed_ms=2780
{…"supervisor_alive":1,"driver_alive":1,"alive":1,"running":1,…}
```

⇒ ①里的进程确实只是慢（2780ms > 1000ms 窗口），⛔ 没有被判死。

### 实现要点与取舍

1. **kind 的语义边界 = 「每个 kind 各一条记录、判据取并集」**（⛔ 不是「一条记录携带已验证 kind 的集合」）。理由：产出路径本来就是一次 `driver start --kind <k>` 写一条 append-only 的原子观测（各带自己的 host/ts/build_sha，AC-214 的新鲜度锚正是逐条读的）；把 N 次观测压进一条记录，会要求 writer 去**拼**一个它自己没验过的集合。AC1 自己给的例子（「promotion 与 goal 各一条」）也是这个形状。阈值取「≥2 个不同」是本 AC 逐字给的边界（不是「五个全要」）；判据对 kind 个数通用，将来收紧只改一处。
2. **产出侧与判据侧同时改**（⛔ 不制造两处漂移）：`AC_RECORD_SCHEMA` 的 AC-203 行加 `kind:str`、`write_ac203_record` 加第 6 个参数（值来自调用点真正 start 过的那个 `--kind`）、`goals/AC-203-*.md` 的 criterion 读它。`--ac-record-schema-report` 的三侧差集为空即为此的机械判据（AC2）。**⛔ 不在 writer/脚本里再抄一份 kind 词表** —— 词表的单一真源是 `cli/driver.ts` 的 `KINDS`。
3. **start 的存活确认形态**：三个**可区分**取值（⛔ 不是布尔）—— `started:`（supervisor ∧ driver 双活，且该读数被**连续两次**轮询读到）/ `start-failed:`（**决断信号**：我们 spawn 的 supervisor 进程已退出且无 driver）/ `start-pending:`（窗口用尽而 supervisor 仍活）。**判死只发生在决断信号上，⛔ 窗口本身永不判死** ⇒ 慢启动天然不会被误判（AC4）。「连续两次」是因为 `pidAlive` 对「刚 spawn 出来、还没 import 完就自己退了」的进程会读到一次 true —— 一次采样分不开「起来了」与「短暂存在过」。
4. **`already-running` 路径同样确认**（硬规则 5b：缺陷成簇）：supervisor 在而 driver 死在重拉间隙里，旧实现照样 `exit 0` —— 同一种「报成功但实际死亡」。现两条路径共用同一份 `awaitDriverConfirmation`（⛔ 不写第二份判定）。
5. **Plan 第 5 条点名的 PATH 注入形态本环境取不到**（`process.execPath` 固定为运行本进程的 node，PATH 换不掉它）⇒ 改用上面那条**确定性**的「driver not found」注入（同属 GOAL-009 记载的死亡形态）。**⚠️ 顺带发现（⛔ 本任务未改，留给后续）**：Proposal 引的那条 `/usr/bin/node: bad option: --experimental-strip-types` 的真因是 `startKind` 给 supervisor **硬编码**了 `--experimental-strip-types`（dist 安装下 kernel 是 `.js`、目标机的 node 不认这个 flag ⇒ supervisor 秒死）。本任务让这件事**不再静默**（日志尾被贴出来 + 非零退出），但**没有**改那处硬编码 —— 它改变每一条生产 supervisor 的解释器，需要自己的 AC（含 dist / 旧 node 矩阵），⛔ 不塞进本任务蒙混过关。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/driver-runtime.ts
- packages/quay/src/cli/driver.ts
- goals/AC-203-driver-在无-plugin-的第三方项目里真活-判据读载体-不读-start-退出码.md
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/driver-runtime.test.mjs
- tasks/gap-ac203-record-schema-has-no-kind-dimension.md
